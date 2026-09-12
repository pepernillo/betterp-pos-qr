from datetime import date, timedelta
from decimal import Decimal

from django.db import transaction
from django.db.models import Count, Exists, OuterRef, Prefetch, Q
from django.utils import timezone

from crm.models import Cliente
from empresas.models import EntidadNegocio

from .models import (
    CuentaPorCobrar,
    CuentaPorPagar,
    EventoFinanciero,
    EventoFinancieroPartida,
    PagoCuentaPorCobrar,
    PagoCuentaPorPagar,
    SaldoCliente,
    Transaccion,
)
from .services import (
    AUTO_MATCH_SCORE_THRESHOLDS,
    build_match_confidence_band,
    clamp_money,
    decimal_to_float,
    evaluate_scored_candidates,
    get_open_cxc_queryset,
    get_or_create_saldo_cliente,
    meaningful_match_words,
    normalize_lookup_text,
    normalize_reference_token,
    payment_starts_validated,
    resolve_evidence,
    refresh_evidence_status,
    register_payment_for_entity,
    register_payment_for_payable,
    serialize_payment_cxc,
    serialize_payment_cxp,
    serialize_transaction,
    validate_payable_payment,
    validate_receivable_payment,
)


def resolve_event_payment_channel(origen_evento: str) -> str:
    if origen_evento == "WHATSAPP":
        return "WHATSAPP"
    if origen_evento == "AJUSTE_SISTEMA":
        return "AJUSTE_SISTEMA"
    return "MANUAL"


def resolve_event_payment_method(event: EventoFinanciero) -> str:
    if event.tipo_movimiento == "EGRESO":
        return "TRANSFERENCIA"

    raw_text = normalize_lookup_text(event.texto_consolidado)
    if "efectivo" in raw_text:
        return "EFECTIVO"
    if "deposito" in raw_text:
        return "DEPOSITO"
    return "TRANSFERENCIA"


def serialize_event_partida(partida: EventoFinancieroPartida) -> dict:
    return {
        "id": partida.id,
        "orden": partida.orden,
        "tipo_destino": partida.tipo_destino,
        "entidad_id": partida.entidad_relacionada_id,
        "entidad_nombre": (
            partida.entidad_relacionada.nombre_comercial
            if partida.entidad_relacionada
            else None
        ),
        "cliente_id": partida.cliente_relacionado_id,
        "cliente_nombre": (
            partida.cliente_relacionado.razon_social
            or partida.cliente_relacionado.nombre_comercial
            if partida.cliente_relacionado
            else None
        ),
        "cuenta_cxc_id": partida.cuenta_por_cobrar_relacionada_id,
        "cuenta_cxp_id": partida.cuenta_por_pagar_relacionada_id,
        "concepto": partida.concepto,
        "beneficiario": partida.beneficiario,
        "unidad_referencia": partida.unidad_referencia,
        "periodo_referencia": partida.periodo_referencia,
        "monto_partida": decimal_to_float(partida.monto_partida),
        "confianza": decimal_to_float(partida.confianza),
        "requiere_revision_manual": partida.requiere_revision_manual,
        "estatus": partida.estatus,
        "metadata": partida.metadata or {},
        "observaciones": partida.observaciones,
    }


def serialize_event(event: EventoFinanciero) -> dict:
    partidas_count = getattr(event, "partidas_count", None)
    partidas_aplicadas = getattr(event, "partidas_aplicadas", None)
    if partidas_count is None or partidas_aplicadas is None:
        partidas = list(event.partidas.all())
        partidas_count = len(partidas)
        partidas_aplicadas = len(
            [item for item in partidas if item.estatus in {"APLICADA", "CONCILIADA"}]
        )
    return {
        "id": event.id,
        "estatus": event.estatus,
        "origen_evento": event.origen_evento,
        "tipo_movimiento": event.tipo_movimiento,
        "entidad_id": event.entidad_relacionada_id,
        "entidad_nombre": (
            event.entidad_relacionada.nombre_comercial
            if event.entidad_relacionada
            else None
        ),
        "cliente_id": event.cliente_relacionado_id,
        "cliente_nombre": (
            event.cliente_relacionado.razon_social
            or event.cliente_relacionado.nombre_comercial
            if event.cliente_relacionado
            else None
        ),
        "caso_id": event.caso_relacionado_id,
        "evidencia_id": event.evidencia_pago_relacionada_id,
        "transaccion_id": event.transaccion_relacionada_id,
        "duplicado_de_id": event.duplicado_de_id,
        "unidad_detectada": event.unidad_detectada,
        "beneficiario_principal": event.beneficiario_principal,
        "referencia_principal": event.referencia_principal,
        "fecha_evento": event.fecha_evento,
        "monto_total_reportado": decimal_to_float(event.monto_total_reportado),
        "confianza_global": decimal_to_float(event.confianza_global),
        "requiere_revision_manual": event.requiere_revision_manual,
        "texto_consolidado": event.texto_consolidado,
        "observaciones": event.observaciones,
        "raw_data": event.raw_data or {},
        "partidas_count": partidas_count,
        "partidas_aplicadas": partidas_aplicadas,
    }


def serialize_event_detail(event: EventoFinanciero) -> dict:
    cxc_candidates: list[dict] = []
    cxp_candidates: list[dict] = []
    include_candidates = event.estatus not in {
        "APLICADO",
        "CONCILIADO",
        "DESCARTADO",
        "DUPLICADO",
    }

    if include_candidates and event.entidad_relacionada and event.cliente_relacionado:
        for cuenta in (
            get_open_cxc_queryset(event.entidad_relacionada, event.cliente_relacionado_id)
            .order_by("fecha_vencimiento", "id")[:10]
        ):
            cxc_candidates.append(
                {
                    "id": cuenta.id,
                    "concepto": cuenta.concepto,
                    "fecha_vencimiento": cuenta.fecha_vencimiento,
                    "saldo_pendiente": decimal_to_float(cuenta.saldo_pendiente),
                }
            )

    if include_candidates and event.entidad_relacionada:
        for cuenta in (
            CuentaPorPagar.objects.filter(entidad_relacionada=event.entidad_relacionada)
            .exclude(estatus__in=["PAGADO", "CANCELADO"])
            .order_by("fecha_vencimiento", "id")[:10]
        ):
            cxp_candidates.append(
                {
                    "id": cuenta.id,
                    "concepto": cuenta.concepto,
                    "proveedor_nombre": cuenta.proveedor_nombre,
                    "categoria": cuenta.categoria,
                    "fecha_vencimiento": cuenta.fecha_vencimiento,
                    "saldo_pendiente": decimal_to_float(cuenta.saldo_pendiente),
                }
            )

    return {
        **serialize_event(event),
        "partidas": [serialize_event_partida(item) for item in event.partidas.all()],
        "pagos_cxc": [serialize_payment_cxc(item) for item in event.pagos_cxc.all()],
        "pagos_cxp": [serialize_payment_cxp(item) for item in event.pagos_cxp.all()],
        "transaccion": (
            serialize_transaction(event.transaccion_relacionada)
            if event.transaccion_relacionada
            else None
        ),
        "evidencia": (
            {
                "id": event.evidencia_pago_relacionada.id,
                "estatus": event.evidencia_pago_relacionada.estatus,
                "monto_reportado": decimal_to_float(
                    event.evidencia_pago_relacionada.monto_reportado
                ),
                "fecha_pago_reportada": event.evidencia_pago_relacionada.fecha_pago_reportada,
                "referencia_reportada": event.evidencia_pago_relacionada.referencia_reportada,
                "url_archivo": event.evidencia_pago_relacionada.url_archivo,
            }
            if event.evidencia_pago_relacionada
            else None
        ),
        "caso": (
            {
                "id": event.caso_relacionado.id,
                "estatus": event.caso_relacionado.estatus,
                "canal": event.caso_relacionado.canal,
                "remitente": event.caso_relacionado.remitente,
                "remitente_nombre": event.caso_relacionado.remitente_nombre,
                "texto_consolidado": event.caso_relacionado.texto_consolidado,
                "caption_consolidado": event.caso_relacionado.caption_consolidado,
            }
            if event.caso_relacionado
            else None
        ),
        "candidatos": {
            "cxc": cxc_candidates,
            "cxp": cxp_candidates,
        },
    }


def build_events_dashboard(
    *,
    estatus: str | None = None,
    tipo_movimiento: str | None = None,
    entidad_id: int | None = None,
    cliente_id: int | None = None,
    busqueda: str | None = None,
    allowed_entity_ids: list[int] | None = None,
) -> dict:
    scoped_partidas = None
    if allowed_entity_ids is not None:
        scoped_partidas = EventoFinancieroPartida.objects.filter(
            evento_relacionado_id=OuterRef("pk")
        ).filter(
            Q(entidad_relacionada_id__in=allowed_entity_ids)
            | Q(cliente_relacionado__entidad_relacionada_id__in=allowed_entity_ids)
            | Q(cuenta_por_cobrar_relacionada__entidad_relacionada_id__in=allowed_entity_ids)
            | Q(
                cuenta_por_cobrar_relacionada__entidad_relacionada__isnull=True,
                cuenta_por_cobrar_relacionada__cliente_relacionado__entidad_relacionada_id__in=allowed_entity_ids,
            )
            | Q(cuenta_por_pagar_relacionada__entidad_relacionada_id__in=allowed_entity_ids)
        )

    queryset = (
        EventoFinanciero.objects.select_related(
            "entidad_relacionada",
            "cliente_relacionado",
            "caso_relacionado",
            "evidencia_pago_relacionada",
            "transaccion_relacionada",
            "duplicado_de",
        )
        .annotate(
            partidas_count=Count("partidas", distinct=True),
            partidas_aplicadas=Count(
                "partidas",
                filter=Q(partidas__estatus__in=["APLICADA", "CONCILIADA"]),
                distinct=True,
            ),
        )
        .order_by(
            "-fecha_evento",
            "-id",
        )
    )
    if allowed_entity_ids is not None:
        queryset = queryset.annotate(
            has_scoped_partida=Exists(scoped_partidas)
        ).filter(
            Q(entidad_relacionada_id__in=allowed_entity_ids)
            | Q(
                entidad_relacionada__isnull=True,
                cliente_relacionado__entidad_relacionada_id__in=allowed_entity_ids,
            )
            | Q(has_scoped_partida=True)
        )

    if estatus:
        queryset = queryset.filter(estatus=estatus)
    if tipo_movimiento:
        queryset = queryset.filter(tipo_movimiento=tipo_movimiento)
    if entidad_id:
        queryset = queryset.filter(entidad_relacionada_id=entidad_id)
    if cliente_id:
        queryset = queryset.filter(cliente_relacionado_id=cliente_id)
    if busqueda:
        queryset = queryset.filter(
            Q(referencia_principal__icontains=busqueda)
            | Q(beneficiario_principal__icontains=busqueda)
            | Q(unidad_detectada__icontains=busqueda)
            | Q(texto_consolidado__icontains=busqueda)
            | Q(cliente_relacionado__razon_social__icontains=busqueda)
            | Q(cliente_relacionado__nombre_comercial__icontains=busqueda)
        )

    events = list(queryset[:150])
    metrics = {
        "total": len(events),
        "nuevos": 0,
        "propuestos": 0,
        "pendientes_aplicacion": 0,
        "aplicados": 0,
        "conciliados": 0,
        "ambiguos": 0,
        "duplicados": 0,
        "no_identificados": 0,
    }
    for event in events:
        if event.estatus == "NUEVO":
            metrics["nuevos"] += 1
        elif event.estatus == "PROPUESTO":
            metrics["propuestos"] += 1
        elif event.estatus == "PENDIENTE_APLICACION":
            metrics["pendientes_aplicacion"] += 1
        elif event.estatus == "APLICADO":
            metrics["aplicados"] += 1
        elif event.estatus == "CONCILIADO":
            metrics["conciliados"] += 1
        elif event.estatus == "AMBIGUO":
            metrics["ambiguos"] += 1
        elif event.estatus == "DUPLICADO":
            metrics["duplicados"] += 1
        elif event.estatus == "NO_IDENTIFICADO":
            metrics["no_identificados"] += 1

    pending_transactions_queryset = Transaccion.objects.filter(
        estatus_conciliacion__in=["EN_ESPERA", "NO_IDENTIFICADO"]
    ).select_related(
        "carga_relacionada",
        "cuenta_bancaria_relacionada",
        "cuenta_por_cobrar_relacionada",
        "cuenta_por_pagar_relacionada",
        "evento_relacionado",
    ).prefetch_related(
        Prefetch(
            "pagos_cxc",
            queryset=PagoCuentaPorCobrar.objects.exclude(
                estatus_validacion="RECHAZADO"
            ).only("id", "monto", "estatus_validacion", "transaccion_relacionada_id"),
            to_attr="_pagos_cxc_vivos",
        ),
        Prefetch(
            "pagos_cxp",
            queryset=PagoCuentaPorPagar.objects.exclude(
                estatus_validacion="RECHAZADO"
            ).only("id", "monto", "estatus_validacion", "transaccion_relacionada_id"),
            to_attr="_pagos_cxp_vivos",
        ),
    )
    if allowed_entity_ids is not None:
        scoped_event_partidas = EventoFinancieroPartida.objects.filter(
            evento_relacionado_id=OuterRef("evento_relacionado_id")
        ).filter(
            Q(entidad_relacionada_id__in=allowed_entity_ids)
            | Q(cliente_relacionado__entidad_relacionada_id__in=allowed_entity_ids)
            | Q(cuenta_por_cobrar_relacionada__entidad_relacionada_id__in=allowed_entity_ids)
            | Q(
                cuenta_por_cobrar_relacionada__entidad_relacionada__isnull=True,
                cuenta_por_cobrar_relacionada__cliente_relacionado__entidad_relacionada_id__in=allowed_entity_ids,
            )
            | Q(cuenta_por_pagar_relacionada__entidad_relacionada_id__in=allowed_entity_ids)
        )
        pending_transactions_queryset = pending_transactions_queryset.annotate(
            event_has_scoped_partida=Exists(scoped_event_partidas)
        ).filter(
            Q(cuenta_por_cobrar_relacionada__entidad_relacionada_id__in=allowed_entity_ids)
            | Q(
                cuenta_por_cobrar_relacionada__entidad_relacionada__isnull=True,
                cuenta_por_cobrar_relacionada__cliente_relacionado__entidad_relacionada_id__in=allowed_entity_ids,
            )
            | Q(cuenta_por_pagar_relacionada__entidad_relacionada_id__in=allowed_entity_ids)
            | Q(cuenta_bancaria_relacionada__entidad_relacionada_id__in=allowed_entity_ids)
            | Q(evento_relacionado__entidad_relacionada_id__in=allowed_entity_ids)
            | Q(
                evento_relacionado__entidad_relacionada__isnull=True,
                evento_relacionado__cliente_relacionado__entidad_relacionada_id__in=allowed_entity_ids,
            )
            | Q(event_has_scoped_partida=True)
        )
    pending_transactions = [
        serialize_transaction(item)
        for item in pending_transactions_queryset.order_by("-fecha_pago", "-id")[:50]
    ]

    return {
        "metricas": metrics,
        "items": [serialize_event(item) for item in events],
        "transacciones_pendientes": pending_transactions,
    }


def resolve_event_entity(partida: EventoFinancieroPartida) -> EntidadNegocio | None:
    if partida.entidad_relacionada:
        return partida.entidad_relacionada
    if partida.evento_relacionado.entidad_relacionada:
        return partida.evento_relacionado.entidad_relacionada
    if partida.cliente_relacionado and partida.cliente_relacionado.entidad_relacionada:
        return partida.cliente_relacionado.entidad_relacionada
    if (
        partida.evento_relacionado.cliente_relacionado
        and partida.evento_relacionado.cliente_relacionado.entidad_relacionada
    ):
        return partida.evento_relacionado.cliente_relacionado.entidad_relacionada
    return None


def resolve_event_client(partida: EventoFinancieroPartida) -> Cliente | None:
    if partida.cliente_relacionado:
        return partida.cliente_relacionado
    return partida.evento_relacionado.cliente_relacionado


def get_receivable_effective_entity_id(cuenta: CuentaPorCobrar) -> int | None:
    if cuenta.entidad_relacionada_id:
        return cuenta.entidad_relacionada_id
    cliente = getattr(cuenta, "cliente_relacionado", None)
    return cliente.entidad_relacionada_id if cliente else None


def build_receivable_candidate_context(
    partidas: list[EventoFinancieroPartida],
) -> dict[tuple[int, int], list[CuentaPorCobrar]]:
    pairs: set[tuple[int, int]] = set()
    for partida in partidas:
        if partida.tipo_destino != "CXC" or partida.estatus == "OMITIDA":
            continue
        entidad = resolve_event_entity(partida)
        cliente = resolve_event_client(partida)
        if entidad and cliente:
            pairs.add((entidad.id, cliente.id))
    if not pairs:
        return {}

    entity_ids = {entity_id for entity_id, _ in pairs}
    client_ids = {client_id for _, client_id in pairs}
    queryset = (
        CuentaPorCobrar.objects.filter(cliente_relacionado_id__in=client_ids)
        .filter(
            Q(entidad_relacionada_id__in=entity_ids)
            | Q(
                entidad_relacionada__isnull=True,
                cliente_relacionado__entidad_relacionada_id__in=entity_ids,
            )
        )
        .exclude(estatus_adeudo__in=["CONCILIADO", "CANCELADO", "INCOBRABLE"])
        .select_related(
            "entidad_relacionada",
            "cliente_relacionado",
            "cliente_relacionado__entidad_relacionada",
        )
        .order_by("fecha_vencimiento", "id")
    )

    candidates: dict[tuple[int, int], list[CuentaPorCobrar]] = {}
    for cuenta in queryset:
        entity_id = get_receivable_effective_entity_id(cuenta)
        if not entity_id:
            continue
        key = (entity_id, cuenta.cliente_relacionado_id)
        if key in pairs:
            candidates.setdefault(key, []).append(cuenta)
    return candidates


def build_payable_candidate_context(
    partidas: list[EventoFinancieroPartida],
) -> dict[int, list[CuentaPorPagar]]:
    entity_ids: set[int] = set()
    for partida in partidas:
        if partida.tipo_destino != "CXP" or partida.estatus == "OMITIDA":
            continue
        entidad = resolve_event_entity(partida)
        if entidad:
            entity_ids.add(entidad.id)
    if not entity_ids:
        return {}

    queryset = (
        CuentaPorPagar.objects.filter(entidad_relacionada_id__in=entity_ids)
        .exclude(estatus__in=["PAGADO", "CANCELADO"])
        .select_related("entidad_relacionada")
        .order_by("fecha_vencimiento", "id")
    )
    candidates: dict[int, list[CuentaPorPagar]] = {}
    for cuenta in queryset:
        candidates.setdefault(cuenta.entidad_relacionada_id, []).append(cuenta)
    return candidates


def resolve_best_receivable_for_partida(
    partida: EventoFinancieroPartida,
    *,
    candidate_context: dict[tuple[int, int], list[CuentaPorCobrar]] | None = None,
) -> CuentaPorCobrar | None:
    entidad = resolve_event_entity(partida)
    cliente = resolve_event_client(partida)
    if not entidad or not cliente:
        return None
    context_candidates = (
        candidate_context.get((entidad.id, cliente.id))
        if candidate_context is not None
        else None
    )

    if partida.cuenta_por_cobrar_relacionada_id:
        cuenta_relacionada = getattr(partida, "cuenta_por_cobrar_relacionada", None)
        cuenta_entidad_id = None
        if cuenta_relacionada:
            cuenta_entidad_id = cuenta_relacionada.entidad_relacionada_id
            if cuenta_entidad_id is None:
                cuenta_cliente = getattr(cuenta_relacionada, "cliente_relacionado", None)
                cuenta_entidad_id = (
                    cuenta_cliente.entidad_relacionada_id if cuenta_cliente else None
                )
        if (
            cuenta_relacionada
            and cuenta_entidad_id == entidad.id
            and cuenta_relacionada.cliente_relacionado_id == cliente.id
            and cuenta_relacionada.estatus_adeudo
            not in {"CONCILIADO", "CANCELADO", "INCOBRABLE"}
        ):
            return cuenta_relacionada
        if context_candidates is not None:
            return next(
                (
                    cuenta
                    for cuenta in context_candidates
                    if cuenta.id == partida.cuenta_por_cobrar_relacionada_id
                ),
                None,
            )
        queryset = get_open_cxc_queryset(entidad, cliente.id).order_by(
            "fecha_vencimiento",
            "id",
        )
        return queryset.filter(id=partida.cuenta_por_cobrar_relacionada_id).first()

    candidates = (
        context_candidates
        if context_candidates is not None
        else list(get_open_cxc_queryset(entidad, cliente.id).order_by("fecha_vencimiento", "id"))
    )
    if partida.periodo_referencia:
        normalized_period = normalize_lookup_text(partida.periodo_referencia)
        for cuenta in candidates:
            if normalized_period and normalized_period in normalize_lookup_text(cuenta.concepto):
                return cuenta

    normalized_concept = normalize_lookup_text(partida.concepto)
    if normalized_concept:
        for cuenta in candidates:
            if normalized_concept in normalize_lookup_text(cuenta.concepto):
                return cuenta

    return candidates[0] if candidates else None


def resolve_best_payable_for_partida(
    partida: EventoFinancieroPartida,
    *,
    candidate_context: dict[int, list[CuentaPorPagar]] | None = None,
) -> CuentaPorPagar | None:
    entidad = resolve_event_entity(partida)
    if not entidad:
        return None
    context_candidates = (
        candidate_context.get(entidad.id) if candidate_context is not None else None
    )

    if partida.cuenta_por_pagar_relacionada_id:
        cuenta_relacionada = getattr(partida, "cuenta_por_pagar_relacionada", None)
        if (
            cuenta_relacionada
            and cuenta_relacionada.entidad_relacionada_id == entidad.id
            and cuenta_relacionada.estatus not in {"PAGADO", "CANCELADO"}
        ):
            return cuenta_relacionada
        if context_candidates is not None:
            return next(
                (
                    cuenta
                    for cuenta in context_candidates
                    if cuenta.id == partida.cuenta_por_pagar_relacionada_id
                ),
                None,
            )
        queryset = (
            CuentaPorPagar.objects.filter(entidad_relacionada=entidad)
            .exclude(estatus__in=["PAGADO", "CANCELADO"])
            .order_by("fecha_vencimiento", "id")
        )
        return queryset.filter(id=partida.cuenta_por_pagar_relacionada_id).first()

    candidates = (
        context_candidates
        if context_candidates is not None
        else list(
            CuentaPorPagar.objects.filter(entidad_relacionada=entidad)
            .exclude(estatus__in=["PAGADO", "CANCELADO"])
            .order_by("fecha_vencimiento", "id")
        )
    )
    normalized_concept = normalize_lookup_text(partida.concepto)
    normalized_beneficiary = normalize_lookup_text(partida.beneficiario)

    for cuenta in candidates:
        if normalized_beneficiary and normalized_beneficiary in normalize_lookup_text(
            cuenta.proveedor_nombre
        ):
            return cuenta
        if normalized_concept and (
            normalized_concept in normalize_lookup_text(cuenta.concepto)
            or normalized_concept in normalize_lookup_text(cuenta.categoria)
        ):
            return cuenta

    return candidates[0] if candidates else None


def update_event_case_status(event: EventoFinanciero) -> None:
    caso = event.caso_relacionado
    if not caso:
        return

    previous_status = caso.estatus
    if event.estatus == "CONCILIADO":
        caso.estatus = "CONCILIADO"
    elif event.estatus in {"APLICADO", "PROPUESTO", "PENDIENTE_APLICACION"}:
        caso.estatus = "VINCULADO"
    elif event.estatus == "DESCARTADO":
        caso.estatus = "DESCARTADO"
    elif event.estatus == "NUEVO":
        caso.estatus = "NUEVO"
    else:
        caso.estatus = "EN_REVISION"
    if caso.estatus == previous_status:
        return
    caso.save(update_fields=["estatus", "fecha_actualizacion"])


def get_event_partidas_for_processing(
    event: EventoFinanciero,
) -> list[EventoFinancieroPartida]:
    prefetched = getattr(event, "_prefetched_objects_cache", None)
    if prefetched and "partidas" in prefetched:
        partidas = sorted(
            prefetched["partidas"],
            key=lambda item: (item.orden, item.id or 0),
        )
        for partida in partidas:
            partida.evento_relacionado = event
        return partidas
    return list(
        event.partidas.select_related(
            "evento_relacionado",
            "evento_relacionado__entidad_relacionada",
            "evento_relacionado__cliente_relacionado",
            "evento_relacionado__cliente_relacionado__entidad_relacionada",
            "entidad_relacionada",
            "cliente_relacionado",
            "cliente_relacionado__entidad_relacionada",
            "cuenta_por_cobrar_relacionada",
            "cuenta_por_cobrar_relacionada__entidad_relacionada",
            "cuenta_por_cobrar_relacionada__cliente_relacionado",
            "cuenta_por_cobrar_relacionada__cliente_relacionado__entidad_relacionada",
            "cuenta_por_pagar_relacionada",
            "cuenta_por_pagar_relacionada__entidad_relacionada",
        ).order_by("orden", "id")
    )


def refresh_event_status_from_parts(
    event: EventoFinanciero,
    *,
    partidas: list[EventoFinancieroPartida] | None = None,
    sync_case_status: bool = True,
) -> EventoFinanciero:
    prefetched = getattr(event, "_prefetched_objects_cache", None)
    if prefetched is not None and partidas is None:
        prefetched.pop("partidas", None)
    if partidas is None:
        partidas = list(event.partidas.only("id", "estatus").all())
    if not partidas:
        if event.estatus == "CONCILIADO":
            return event
        event.estatus = "NUEVO" if not event.propuesta_ia else "PROPUESTO"
    elif all(item.estatus == "CONCILIADA" for item in partidas):
        event.estatus = "CONCILIADO"
    elif all(item.estatus in {"APLICADA", "CONCILIADA"} for item in partidas):
        event.estatus = "APLICADO"
    elif any(item.estatus == "REQUIERE_REVISION" for item in partidas):
        event.estatus = "PENDIENTE_APLICACION"
    else:
        event.estatus = "PROPUESTO"

    event.save(update_fields=["estatus", "fecha_actualizacion"])
    if sync_case_status:
        update_event_case_status(event)
    return event


@transaction.atomic
def reconcile_event_with_transaction(
    event: EventoFinanciero,
    transaction_item: Transaccion,
    *,
    notes: str = "",
    finalize_transaction_status: bool = False,
) -> EventoFinanciero:
    cxc_payments = getattr(event, "_prefetched_reconciliation_cxc_payments", None)
    if cxc_payments is None:
        cxc_payments = list(
            event.pagos_cxc.select_related("cuenta_por_cobrar").order_by("fecha_pago", "id")
        )
    else:
        cxc_payments = list(cxc_payments)
    cxp_payments = getattr(event, "_prefetched_reconciliation_cxp_payments", None)
    if cxp_payments is None:
        cxp_payments = list(
            event.pagos_cxp.select_related("cuenta_por_pagar").order_by("fecha_pago", "id")
        )
    else:
        cxp_payments = list(cxp_payments)
    evidence_ids = {
        payment.evidencia_pago_relacionada_id
        for payment in [*cxc_payments, *cxp_payments]
        if payment.evidencia_pago_relacionada_id
    }
    cxc_payment_ids = [payment.id for payment in cxc_payments if payment.id]
    cxc_account_ids = {
        payment.cuenta_por_cobrar_id
        for payment in cxc_payments
        if payment.cuenta_por_cobrar_id
    }
    cxc_accounts_with_pending_payments = (
        set(
            PagoCuentaPorCobrar.objects.filter(
                cuenta_por_cobrar_id__in=cxc_account_ids,
                estatus_validacion="APLICADO",
            )
            .exclude(id__in=cxc_payment_ids)
            .values_list("cuenta_por_cobrar_id", flat=True)
            .distinct()
        )
        if cxc_account_ids
        else set()
    )
    cxp_payment_ids = [payment.id for payment in cxp_payments if payment.id]
    cxp_account_ids = {
        payment.cuenta_por_pagar_id
        for payment in cxp_payments
        if payment.cuenta_por_pagar_id
    }
    cxp_accounts_with_pending_payments = (
        set(
            PagoCuentaPorPagar.objects.filter(
                cuenta_por_pagar_id__in=cxp_account_ids,
                estatus_validacion="APLICADO",
            )
            .exclude(id__in=cxp_payment_ids)
            .values_list("cuenta_por_pagar_id", flat=True)
            .distinct()
        )
        if cxp_account_ids
        else set()
    )

    if cxc_payments and len(cxc_payments) == 1 and not cxp_payments:
        validate_receivable_payment(
            cxc_payments[0],
            transaction_item=transaction_item,
            notes=notes,
            sync_transaction=False,
            update_transaction_status=False,
            refresh_evidence=False,
            pagos_pendientes_validacion=(
                cxc_payments[0].cuenta_por_cobrar_id
                in cxc_accounts_with_pending_payments
            ),
        )
    else:
        for payment in cxc_payments:
            validate_receivable_payment(
                payment,
                notes=notes,
                update_transaction_status=False,
                refresh_evidence=False,
                pagos_pendientes_validacion=(
                    payment.cuenta_por_cobrar_id
                    in cxc_accounts_with_pending_payments
                ),
            )

    if cxp_payments and len(cxp_payments) == 1 and not cxc_payments:
        validate_payable_payment(
            cxp_payments[0],
            transaction_item=transaction_item,
            notes=notes,
            sync_transaction=False,
            update_transaction_status=False,
            refresh_evidence=False,
            pagos_pendientes_validacion=(
                cxp_payments[0].cuenta_por_pagar_id
                in cxp_accounts_with_pending_payments
            ),
        )
    else:
        for payment in cxp_payments:
            validate_payable_payment(
                payment,
                notes=notes,
                update_transaction_status=False,
                refresh_evidence=False,
                pagos_pendientes_validacion=(
                    payment.cuenta_por_pagar_id
                    in cxp_accounts_with_pending_payments
                ),
            )

    transaction_item.evento_relacionado = event
    transaction_item.estatus_conciliacion = (
        "VALIDADO" if finalize_transaction_status else "VINCULADO"
    )
    update_fields = ["evento_relacionado", "estatus_conciliacion"]
    if finalize_transaction_status:
        transaction_item.fecha_validacion = timezone.now()
        update_fields.append("fecha_validacion")
    if len(cxc_payments) == 1 and not cxp_payments:
        transaction_item.cuenta_por_cobrar_relacionada = cxc_payments[0].cuenta_por_cobrar
        update_fields.append("cuenta_por_cobrar_relacionada")
    if len(cxp_payments) == 1 and not cxc_payments:
        transaction_item.cuenta_por_pagar_relacionada = cxp_payments[0].cuenta_por_pagar
        update_fields.append("cuenta_por_pagar_relacionada")
    transaction_item.save(update_fields=update_fields)

    event.transaccion_relacionada = transaction_item
    event.estatus = "CONCILIADO"
    event.save(update_fields=["transaccion_relacionada", "estatus", "fecha_actualizacion"])

    event.partidas.exclude(estatus="OMITIDA").update(estatus="CONCILIADA")
    for evidencia_id in evidence_ids:
        refresh_evidence_status(evidencia_id)
    update_event_case_status(event)
    return event


@transaction.atomic
def apply_financial_event(
    event: EventoFinanciero,
    *,
    refresh_evidence: bool = True,
    sync_case_status: bool = True,
) -> EventoFinanciero:
    if event.estatus in {"DESCARTADO", "DUPLICADO"}:
        return event

    payment_method = resolve_event_payment_method(event)
    payment_channel = resolve_event_payment_channel(event.origen_evento)
    evidence_id = event.evidencia_pago_relacionada_id
    evidence = resolve_evidence(evidence_id) if evidence_id else None
    evidence_ids_to_refresh: set[int] = set()

    partidas = get_event_partidas_for_processing(event)
    receivable_candidate_context = build_receivable_candidate_context(partidas)
    payable_candidate_context = build_payable_candidate_context(partidas)
    for partida in partidas:
        if partida.estatus == "OMITIDA":
            continue

        monto = clamp_money(partida.monto_partida)
        if monto <= 0:
            partida.estatus = "REQUIERE_REVISION"
            partida.observaciones = "La partida no tiene monto valido."
            partida.save(update_fields=["estatus", "observaciones", "fecha_actualizacion"])
            continue

        if partida.tipo_destino == "NO_IDENTIFICADO":
            partida.estatus = "REQUIERE_REVISION"
            partida.save(update_fields=["estatus", "fecha_actualizacion"])
            continue

        if partida.tipo_destino == "SALDO_A_FAVOR":
            entidad = resolve_event_entity(partida)
            cliente = resolve_event_client(partida)
            if not entidad or not cliente:
                partida.estatus = "REQUIERE_REVISION"
                partida.observaciones = "No hay entidad y cliente para saldo a favor."
                partida.save(update_fields=["estatus", "observaciones", "fecha_actualizacion"])
                continue

            saldo_cliente = get_or_create_saldo_cliente(cliente.id, entidad)
            saldo_cliente.saldo_a_favor = clamp_money(saldo_cliente.saldo_a_favor) + monto
            saldo_cliente.save(update_fields=["saldo_a_favor", "fecha_actualizacion"])
            partida.metadata = {
                **(partida.metadata or {}),
                "saldo_a_favor_generado": decimal_to_float(monto),
            }
            partida.estatus = "APLICADA"
            partida.save(update_fields=["metadata", "estatus", "fecha_actualizacion"])
            continue

        if partida.tipo_destino == "CXC":
            entidad = resolve_event_entity(partida)
            cliente = resolve_event_client(partida)
            if not entidad or not cliente:
                partida.estatus = "REQUIERE_REVISION"
                partida.observaciones = "No hay entidad y cliente para aplicar CxC."
                partida.save(update_fields=["estatus", "observaciones", "fecha_actualizacion"])
                continue

            cuenta = resolve_best_receivable_for_partida(
                partida,
                candidate_context=receivable_candidate_context,
            )
            resultado = register_payment_for_entity(
                entidad,
                monto=monto,
                fecha_pago=event.fecha_evento,
                metodo=payment_method,
                referencia=event.referencia_principal or "",
                notas=event.observaciones or "",
                cliente_id=cliente.id,
                cuenta_id=cuenta.id if cuenta else None,
                canal_origen=payment_channel,
                evidencia_id=evidence_id,
                evento_financiero_id=event.id,
                cuenta_prioritaria_obj=cuenta,
                cuentas_abiertas_obj=receivable_candidate_context.get(
                    (entidad.id, cliente.id),
                    [],
                ),
                refresh_evidence=False,
                evidencia_obj=evidence,
            )
            if resultado["aplicaciones"]:
                if evidence_id:
                    evidence_ids_to_refresh.add(evidence_id)
                primera_aplicacion = resultado["aplicaciones"][0]
                if not partida.cuenta_por_cobrar_relacionada_id:
                    partida.cuenta_por_cobrar_relacionada_id = primera_aplicacion["cuenta_id"]
                partida.metadata = {
                    **(partida.metadata or {}),
                    "aplicaciones": resultado["aplicaciones"],
                    "saldo_a_favor": resultado["saldo_a_favor"],
                }
                partida.estatus = (
                    "APLICADA"
                    if len(resultado["aplicaciones"]) == 1 and not resultado["saldo_a_favor"]
                    else "REQUIERE_REVISION"
                )
                if partida.estatus == "REQUIERE_REVISION":
                    partida.observaciones = (
                        "La partida genero multiples aplicaciones o saldo a favor."
                    )
            else:
                partida.estatus = "REQUIERE_REVISION"
                partida.observaciones = "No se encontro una cuenta CxC para aplicar."
            partida.save(
                update_fields=[
                    "cuenta_por_cobrar_relacionada",
                    "metadata",
                    "estatus",
                    "observaciones",
                    "fecha_actualizacion",
                ]
            )
            continue

        if partida.tipo_destino == "CXP":
            cuenta = resolve_best_payable_for_partida(
                partida,
                candidate_context=payable_candidate_context,
            )
            if not cuenta:
                partida.estatus = "REQUIERE_REVISION"
                partida.observaciones = "No se encontro una cuenta CxP para aplicar."
                partida.save(update_fields=["estatus", "observaciones", "fecha_actualizacion"])
                continue

            resultado = register_payment_for_payable(
                cuenta,
                monto=monto,
                fecha_pago=event.fecha_evento,
                metodo=payment_method,
                referencia=event.referencia_principal or "",
                notas=event.observaciones or "",
                canal_origen=payment_channel,
                evidencia_id=evidence_id,
                evento_financiero_id=event.id,
                refresh_evidence=False,
                evidencia_obj=evidence,
            )
            if evidence_id and resultado["monto_aplicado"] > 0:
                evidence_ids_to_refresh.add(evidence_id)
            partida.cuenta_por_pagar_relacionada = cuenta
            partida.metadata = {
                **(partida.metadata or {}),
                "monto_aplicado": resultado["monto_aplicado"],
                "saldo_restante": resultado["saldo_restante"],
            }
            if resultado["monto_aplicado"] > 0 and resultado["saldo_restante"] >= 0:
                partida.estatus = (
                    "APLICADA"
                    if Decimal(str(resultado["monto_aplicado"])) == monto
                    else "REQUIERE_REVISION"
                )
                if partida.estatus == "REQUIERE_REVISION":
                    partida.observaciones = "La partida se aplico parcialmente."
            else:
                partida.estatus = "REQUIERE_REVISION"
                partida.observaciones = "No se pudo aplicar la partida CxP."
            partida.save(
                update_fields=[
                    "cuenta_por_pagar_relacionada",
                    "metadata",
                    "estatus",
                    "observaciones",
                    "fecha_actualizacion",
                ]
            )

    refresh_event_status_from_parts(
        event,
        partidas=partidas,
        sync_case_status=sync_case_status,
    )
    if refresh_evidence:
        for evidence_id_to_refresh in evidence_ids_to_refresh:
            refresh_evidence_status(evidence_id_to_refresh)
    if event.transaccion_relacionada and event.estatus == "APLICADO":
        reconcile_event_with_transaction(
            event,
            event.transaccion_relacionada,
            notes="Conciliado despues de aplicar el evento financiero.",
        )
    return event


def build_event_transaction_match_context(transaction_item: Transaccion) -> dict[str, object]:
    return {
        "tokens": {
            token
            for token in (
                normalize_reference_token(transaction_item.numero_referencia),
                normalize_reference_token(transaction_item.concepto_bancario),
            )
            if token
        },
        "words": meaningful_match_words(
            " ".join(
                value
                for value in (
                    transaction_item.numero_referencia,
                    transaction_item.concepto_bancario,
                )
                if value
            )
        ),
    }


def analyze_event_candidate(
    event: EventoFinanciero,
    transaction_item: Transaccion,
    *,
    transaction_tokens: set[str] | None = None,
    transaction_words: set[str] | None = None,
) -> dict[str, object]:
    reasons: list[str] = []
    if clamp_money(event.monto_total_reportado) != clamp_money(transaction_item.monto):
        return {
            "eligible": False,
            "score": -1,
            "date_distance": None,
            "reference_match": False,
            "reasons": ["El monto del evento no coincide con el movimiento bancario."],
        }

    reasons.append("Monto exacto entre evento y movimiento.")

    distance = abs((event.fecha_evento - transaction_item.fecha_pago).days)
    if distance > 7:
        return {
            "eligible": False,
            "score": -1,
            "date_distance": distance,
            "reference_match": False,
            "reasons": [
                "Monto exacto entre evento y movimiento.",
                "La fecha del evento queda fuera de la ventana maxima de 7 dias.",
            ],
        }

    score = max(0, 100 - distance)
    reasons.append(f"Fecha dentro de la ventana permitida ({distance} dia(s) de diferencia).")
    is_portal_event = (event.raw_data or {}).get("origen") == "PORTAL_CLIENTE"
    event_tokens = {
        token
        for token in (
            normalize_reference_token(event.referencia_principal),
            normalize_reference_token(event.beneficiario_principal),
            normalize_reference_token(event.unidad_detectada),
            normalize_reference_token(event.texto_consolidado),
        )
        if token
    }
    if transaction_tokens is None or transaction_words is None:
        match_context = build_event_transaction_match_context(transaction_item)
        if transaction_tokens is None:
            transaction_tokens = match_context["tokens"]
        if transaction_words is None:
            transaction_words = match_context["words"]
    event_words: set[str] = set()
    for value in (
        event.referencia_principal,
        event.beneficiario_principal,
        event.unidad_detectada,
        event.texto_consolidado,
        event.observaciones,
        event.cliente_relacionado.razon_social if event.cliente_relacionado else None,
        event.cliente_relacionado.nombre_comercial if event.cliente_relacionado else None,
    ):
        event_words.update(meaningful_match_words(value))
    for partida in event.partidas.all():
        for value in (
            partida.concepto,
            partida.beneficiario,
            partida.unidad_referencia,
            partida.periodo_referencia,
            partida.observaciones,
        ):
            event_words.update(meaningful_match_words(value))
    reference_match = False
    if event_tokens and transaction_tokens:
        if any(
            event_token in transaction_token or transaction_token in event_token
            for event_token in event_tokens
            for transaction_token in transaction_tokens
        ):
            score += 300
            reference_match = True
            reasons.append("Referencia, beneficiario o texto con coincidencia fuerte.")
        else:
            score -= 20
            reasons.append("No hubo coincidencia fuerte de texto o referencia.")
    else:
        reasons.append("Sin referencias suficientes para validar por texto.")

    shared_words = event_words & transaction_words
    if shared_words:
        word_score = min(220, 90 + (45 * len(shared_words)))
        score += word_score
        reasons.append(
            "Coincidencia por cliente, concepto o unidad: "
            + ", ".join(sorted(shared_words)[:4])
            + "."
        )

    if is_portal_event:
        score += 80
        reasons.append("Evento creado desde portal cliente con pago CxC ya aplicado.")

    if event.fecha_evento == transaction_item.fecha_pago:
        score += 50
        reasons.append("La fecha del evento es exactamente la misma del movimiento.")

    return {
        "eligible": True,
        "score": score,
        "date_distance": distance,
        "reference_match": reference_match,
        "reasons": reasons,
    }


def serialize_event_match_candidate(
    event: EventoFinanciero,
    score: int,
    analysis: dict,
) -> dict:
    return {
        "id": event.id,
        "scope": "EVENTO",
        "beneficiario_principal": event.beneficiario_principal,
        "referencia_principal": event.referencia_principal,
        "monto_total_reportado": decimal_to_float(event.monto_total_reportado),
        "fecha_evento": event.fecha_evento.isoformat(),
        "estatus": event.estatus,
        "score": score,
        "date_distance": analysis.get("date_distance"),
        "reference_match": analysis.get("reference_match", False),
        "reasons": analysis.get("reasons", []),
    }


def resolve_transaction_entity_ids(transaction_item: Transaccion) -> list[int]:
    entity_ids: set[int] = set()

    bank_account = getattr(transaction_item, "cuenta_bancaria_relacionada", None)
    if bank_account and bank_account.entidad_relacionada_id:
        entity_ids.add(bank_account.entidad_relacionada_id)

    receivable = getattr(transaction_item, "cuenta_por_cobrar_relacionada", None)
    if receivable:
        if receivable.entidad_relacionada_id:
            entity_ids.add(receivable.entidad_relacionada_id)
        else:
            cliente = getattr(receivable, "cliente_relacionado", None)
            if cliente and cliente.entidad_relacionada_id:
                entity_ids.add(cliente.entidad_relacionada_id)

    payable = getattr(transaction_item, "cuenta_por_pagar_relacionada", None)
    if payable and payable.entidad_relacionada_id:
        entity_ids.add(payable.entidad_relacionada_id)

    event = getattr(transaction_item, "evento_relacionado", None)
    if event:
        if event.entidad_relacionada_id:
            entity_ids.add(event.entidad_relacionada_id)
        else:
            cliente = getattr(event, "cliente_relacionado", None)
            if cliente and cliente.entidad_relacionada_id:
                entity_ids.add(cliente.entidad_relacionada_id)

    return list(entity_ids)


def auto_match_event_for_transaction(
    transaction_item: Transaccion,
) -> dict[str, object]:
    candidates: list[tuple[int, EventoFinanciero, dict]] = []
    transaction_amount = clamp_money(transaction_item.monto)
    start_date = transaction_item.fecha_pago - timedelta(days=7)
    end_date = transaction_item.fecha_pago + timedelta(days=7)
    match_context = build_event_transaction_match_context(transaction_item)
    queryset = (
        EventoFinanciero.objects.select_related(
            "entidad_relacionada",
            "cliente_relacionado",
        )
        .prefetch_related(
            Prefetch(
                "partidas",
                queryset=EventoFinancieroPartida.objects.order_by("orden", "id"),
            )
        )
        .filter(
            tipo_movimiento=transaction_item.tipo_movimiento,
            transaccion_relacionada__isnull=True,
            monto_total_reportado=transaction_amount,
            fecha_evento__range=(start_date, end_date),
        )
        .exclude(estatus__in=["CONCILIADO", "DESCARTADO", "DUPLICADO"])
    )
    entity_ids = resolve_transaction_entity_ids(transaction_item)
    if entity_ids:
        scoped_partidas = EventoFinancieroPartida.objects.filter(
            evento_relacionado_id=OuterRef("pk")
        ).filter(
            Q(entidad_relacionada_id__in=entity_ids)
            | Q(cliente_relacionado__entidad_relacionada_id__in=entity_ids)
            | Q(cuenta_por_cobrar_relacionada__entidad_relacionada_id__in=entity_ids)
            | Q(
                cuenta_por_cobrar_relacionada__entidad_relacionada__isnull=True,
                cuenta_por_cobrar_relacionada__cliente_relacionado__entidad_relacionada_id__in=entity_ids,
            )
            | Q(cuenta_por_pagar_relacionada__entidad_relacionada_id__in=entity_ids)
        )
        queryset = queryset.annotate(
            has_scoped_partida=Exists(scoped_partidas)
        ).filter(
            Q(entidad_relacionada_id__in=entity_ids)
            | Q(
                entidad_relacionada__isnull=True,
                cliente_relacionado__entidad_relacionada_id__in=entity_ids,
            )
            | Q(has_scoped_partida=True)
        )

    for event in queryset:
        analysis = analyze_event_candidate(
            event,
            transaction_item,
            transaction_tokens=match_context["tokens"],
            transaction_words=match_context["words"],
        )
        score = int(analysis["score"])
        if score >= 0:
            candidates.append((score, event, analysis))

    return evaluate_scored_candidates(
        candidates,
        scope="EVENTO",
        serializer=serialize_event_match_candidate,
    )


@transaction.atomic
def try_auto_reconcile_transaction(transaction_item: Transaccion) -> dict[str, object]:
    result = auto_match_event_for_transaction(transaction_item)
    status = str(result["status"])
    event = result["selected"]
    if not event:
        return {
            "matched": False,
            "match_status": status,
            "event_id": None,
            "confidence_score": result.get("best_score"),
            "confidence_band": result.get("confidence_band")
            or build_match_confidence_band(scope="EVENTO", score=None),
            "score_margin": result.get("score_margin"),
            "reasons": result.get("best_analysis", {}).get("reasons", []),
            "candidates": result.get("candidates", []),
        }

    if event.estatus in {"NUEVO", "PROPUESTO", "PENDIENTE_APLICACION"}:
        apply_financial_event(event)

    if event.estatus == "APLICADO":
        reconcile_event_with_transaction(
            event,
            transaction_item,
            notes="Conciliado automaticamente contra evento financiero.",
            finalize_transaction_status=True,
        )
        return {
            "matched": True,
            "transaction_status_finalized": True,
            "match_status": status,
            "event_id": event.id,
            "confidence_score": result.get("best_score"),
            "confidence_band": result.get("confidence_band")
            or build_match_confidence_band(
                scope="EVENTO",
                score=result.get("best_score"),
            ),
            "score_margin": result.get("score_margin"),
            "reasons": result.get("best_analysis", {}).get("reasons", []),
            "candidates": result.get("candidates", []),
        }

    confidence_score = result.get("best_score")
    confidence_band = result.get("confidence_band") or build_match_confidence_band(
        scope="EVENTO",
        score=confidence_score if isinstance(confidence_score, int) else None,
    )
    if confidence_score is not None and confidence_score < AUTO_MATCH_SCORE_THRESHOLDS["EVENTO"]:
        status = "LOW_CONFIDENCE"
    else:
        status = "PENDING"

    return {
        "matched": False,
        "match_status": status,
        "event_id": event.id,
        "confidence_score": confidence_score,
        "confidence_band": confidence_band,
        "score_margin": result.get("score_margin"),
        "reasons": result.get("best_analysis", {}).get("reasons", []),
        "candidates": result.get("candidates", []),
    }


def resolve_event_defaults(event: EventoFinanciero) -> EventoFinanciero:
    if not event.entidad_relacionada_id:
        if event.cliente_relacionado and event.cliente_relacionado.entidad_relacionada:
            event.entidad_relacionada = event.cliente_relacionado.entidad_relacionada
        elif event.caso_relacionado and event.caso_relacionado.entidad_relacionada:
            event.entidad_relacionada = event.caso_relacionado.entidad_relacionada
        elif event.evidencia_pago_relacionada and event.evidencia_pago_relacionada.entidad_relacionada:
            event.entidad_relacionada = event.evidencia_pago_relacionada.entidad_relacionada

    if not event.cliente_relacionado_id:
        if event.caso_relacionado and event.caso_relacionado.cliente_relacionado:
            event.cliente_relacionado = event.caso_relacionado.cliente_relacionado
        elif event.evidencia_pago_relacionada and event.evidencia_pago_relacionada.cliente_relacionado:
            event.cliente_relacionado = event.evidencia_pago_relacionada.cliente_relacionado

    return event


@transaction.atomic
def upsert_financial_event(
    *,
    event_id: int | None = None,
    caso_id: int | None = None,
    evidencia_id: int | None = None,
    entidad_id: int | None = None,
    cliente_id: int | None = None,
    transaccion_id: int | None = None,
    origen_evento: str = "MANUAL",
    tipo_movimiento: str = "INGRESO",
    unidad_detectada: str = "",
    beneficiario_principal: str = "",
    referencia_principal: str = "",
    fecha_evento: date | None = None,
    monto_total_reportado: Decimal | None = None,
    confianza_global: Decimal | None = None,
    requiere_revision_manual: bool = False,
    texto_consolidado: str = "",
    raw_data: dict | None = None,
    propuesta_ia: dict | None = None,
    observaciones: str = "",
    estatus: str = "PROPUESTO",
    partidas: list[dict] | None = None,
) -> EventoFinanciero:
    event_queryset = EventoFinanciero.objects.select_related(
        "caso_relacionado",
        "caso_relacionado__entidad_relacionada",
        "caso_relacionado__cliente_relacionado",
        "evidencia_pago_relacionada",
        "evidencia_pago_relacionada__entidad_relacionada",
        "evidencia_pago_relacionada__cliente_relacionado",
        "entidad_relacionada",
        "cliente_relacionado",
        "cliente_relacionado__entidad_relacionada",
        "transaccion_relacionada",
    )
    event = event_queryset.filter(id=event_id).first() if event_id else None

    if not event and evidencia_id:
        event = event_queryset.filter(evidencia_pago_relacionada_id=evidencia_id).first()
    if not event and caso_id:
        event = event_queryset.filter(caso_relacionado_id=caso_id).first()

    if not event:
        event = EventoFinanciero()

    event.caso_relacionado_id = (
        caso_id if caso_id else event.caso_relacionado_id
    )
    event.evidencia_pago_relacionada_id = (
        evidencia_id if evidencia_id else event.evidencia_pago_relacionada_id
    )
    event.entidad_relacionada_id = entidad_id if entidad_id else event.entidad_relacionada_id
    event.cliente_relacionado_id = cliente_id if cliente_id else event.cliente_relacionado_id
    event.transaccion_relacionada_id = (
        transaccion_id if transaccion_id else event.transaccion_relacionada_id
    )
    event.origen_evento = origen_evento
    event.tipo_movimiento = tipo_movimiento
    event.unidad_detectada = unidad_detectada.strip() or None
    event.beneficiario_principal = beneficiario_principal.strip() or None
    event.referencia_principal = referencia_principal.strip() or None
    event.fecha_evento = fecha_evento or event.fecha_evento or date.today()
    event.monto_total_reportado = clamp_money(monto_total_reportado)
    event.confianza_global = clamp_money(confianza_global)
    event.requiere_revision_manual = requiere_revision_manual
    event.texto_consolidado = texto_consolidado.strip() or None
    event.raw_data = raw_data
    event.propuesta_ia = propuesta_ia
    event.observaciones = observaciones.strip() or None
    event.estatus = estatus
    resolve_event_defaults(event)
    event.save()

    processed_partidas: list[EventoFinancieroPartida] | None = None
    if partidas is not None:
        event.partidas.all().delete()
        processed_partidas = [
            EventoFinancieroPartida(
                evento_relacionado=event,
                entidad_relacionada_id=item.get("entidad_id") or event.entidad_relacionada_id,
                cliente_relacionado_id=item.get("cliente_id") or event.cliente_relacionado_id,
                cuenta_por_cobrar_relacionada_id=item.get("cuenta_cxc_id") or None,
                cuenta_por_pagar_relacionada_id=item.get("cuenta_cxp_id") or None,
                orden=int(item.get("orden") or index),
                tipo_destino=item.get("tipo_destino") or "CXC",
                concepto=str(item.get("concepto") or "Sin concepto").strip(),
                beneficiario=str(item.get("beneficiario") or "").strip() or None,
                unidad_referencia=str(item.get("unidad_referencia") or "").strip() or None,
                periodo_referencia=str(item.get("periodo_referencia") or "").strip() or None,
                monto_partida=clamp_money(item.get("monto_partida")),  # type: ignore[arg-type]
                confianza=clamp_money(item.get("confianza")),  # type: ignore[arg-type]
                requiere_revision_manual=bool(item.get("requiere_revision_manual", False)),
                estatus=item.get("estatus") or "PROPUESTA",
                metadata=item.get("metadata"),
                observaciones=str(item.get("observaciones") or "").strip() or None,
            )
            for index, item in enumerate(partidas, start=1)
        ]
        if processed_partidas:
            EventoFinancieroPartida.objects.bulk_create(processed_partidas)
        prefetched = getattr(event, "_prefetched_objects_cache", None)
        if prefetched is not None:
            prefetched.pop("partidas", None)

    refresh_event_status_from_parts(event, partidas=processed_partidas)
    if event.transaccion_relacionada and event.estatus == "APLICADO":
        reconcile_event_with_transaction(
            event,
            event.transaccion_relacionada,
            notes="Conciliado al registrar el evento financiero.",
        )
    return event
