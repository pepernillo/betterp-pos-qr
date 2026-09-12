import hashlib
import re
import unicodedata
from calendar import monthrange
from collections.abc import Callable, Sequence
from datetime import date, timedelta
from decimal import Decimal

from django.db import IntegrityError, transaction
from django.db.models import (
    DecimalField,
    Exists,
    ExpressionWrapper,
    F,
    OuterRef,
    Prefetch,
    Q,
    Window,
)
from django.db.models.functions import Coalesce, RowNumber
from django.utils import timezone

from comunicaciones.models import HistorialEnvio
from crm.models import Cliente
from empresas.models import EntidadNegocio, ReglaMarcoNegocio, ReglaNegocio

from .models import (
    CargaConciliacion,
    CuentaBancaria,
    CuentaPorCobrar,
    CuentaPorPagar,
    EventoFinanciero,
    PagoCuentaPorCobrar,
    PagoCuentaPorPagar,
    ProgramacionCuentaPorPagar,
    SaldoCliente,
    Transaccion,
)

MONTH_LABELS_ES = [
    "Ene",
    "Feb",
    "Mar",
    "Abr",
    "May",
    "Jun",
    "Jul",
    "Ago",
    "Sep",
    "Oct",
    "Nov",
    "Dic",
]

AUTO_MATCH_ENGINE_VERSION = "2026.04.28"

AUTO_MATCH_STOPWORDS = {
    "abono",
    "cargo",
    "cargos",
    "cuenta",
    "de",
    "del",
    "deposito",
    "enviado",
    "enviados",
    "envio",
    "informacion",
    "la",
    "las",
    "los",
    "mercado",
    "nomina",
    "pago",
    "recibido",
    "recibidos",
    "referencia",
    "renta",
    "sin",
    "spei",
    "tercero",
    "transferencia",
}
AUTO_MATCH_SCORE_THRESHOLDS = {
    "EVENTO": 350,
    "CXC": 540,
    "CXP": 540,
}
AUTO_MATCH_SCORE_MARGIN = {
    "EVENTO": 40,
    "CXC": 40,
    "CXP": 40,
}
AUTO_MATCH_HIGH_CONFIDENCE_BUFFER = {
    "EVENTO": 40,
    "CXC": 80,
    "CXP": 80,
}
AUTO_MATCH_CANDIDATE_PREVIEW_LIMIT = 5
AUTO_MATCH_CANDIDATE_SCAN_LIMIT = 250


def clamp_money(value: Decimal | None) -> Decimal:
    if value is None:
        return Decimal("0")
    return max(value, Decimal("0"))


def decimal_to_float(value: Decimal | None) -> float:
    return float(value or Decimal("0"))


def normalize_lookup_text(value: str | None) -> str:
    normalized = unicodedata.normalize("NFKD", value or "")
    return "".join(
        char for char in normalized if not unicodedata.combining(char)
    ).lower()


def add_months(current: date, months: int) -> date:
    year = current.year + ((current.month - 1 + months) // 12)
    month = ((current.month - 1 + months) % 12) + 1
    day = min(current.day, monthrange(year, month)[1])
    return date(year, month, day)


def resolve_due_date(cycle_start: date, due_day: int | None) -> date:
    if not due_day:
        return cycle_start
    last_day = monthrange(cycle_start.year, cycle_start.month)[1]
    if int(due_day) >= 31:
        return date(cycle_start.year, cycle_start.month, last_day)
    return date(cycle_start.year, cycle_start.month, min(due_day, last_day))








def build_programacion_cycles(
    programacion: ProgramacionCuentaPorPagar,
    through_date: date,
) -> list[tuple[date, date, date]]:
    limit = through_date
    if programacion.fecha_fin:
        limit = min(limit, programacion.fecha_fin)
    if limit < programacion.fecha_inicio:
        return []

    periodicidad = programacion.periodicidad or "MENSUAL"
    cycles: list[tuple[date, date, date]] = []

    if periodicidad == "UNICO":
        due_date = resolve_due_date(programacion.fecha_inicio, programacion.dia_vencimiento)
        return [(programacion.fecha_inicio, limit, due_date)]

    if periodicidad in {"SEMANAL", "QUINCENAL"}:
        step_days = 7 if periodicidad == "SEMANAL" else 15
        cycle_start = programacion.fecha_inicio
        while cycle_start <= limit:
            cycle_end = min(cycle_start + timedelta(days=step_days - 1), limit)
            due_date = resolve_due_date(cycle_start, programacion.dia_vencimiento)
            cycles.append((cycle_start, cycle_end, due_date))
            cycle_start = cycle_end + timedelta(days=1)
        return cycles

    step_months = {
        "MENSUAL": 1,
        "BIMESTRAL": 2,
        "ANUAL": 12,
    }.get(periodicidad, 1)
    cycle_start = programacion.fecha_inicio
    while cycle_start <= limit:
        next_cycle = add_months(cycle_start, step_months)
        cycle_end = min(next_cycle - timedelta(days=1), limit)
        due_date = resolve_due_date(cycle_start, programacion.dia_vencimiento)
        cycles.append((cycle_start, cycle_end, due_date))
        cycle_start = next_cycle
    return cycles


def get_or_create_saldo_cliente(cliente_id: int, entidad: EntidadNegocio) -> SaldoCliente:
    saldo, _ = SaldoCliente.objects.get_or_create(
        cliente_relacionado_id=cliente_id,
        defaults={"entidad_relacionada": entidad},
    )
    if saldo.entidad_relacionada_id != entidad.id:
        saldo.entidad_relacionada = entidad
        saldo.save(update_fields=["entidad_relacionada", "fecha_actualizacion"])
    return saldo


def normalize_reference_token(value: str | None) -> str:
    normalized = unicodedata.normalize("NFKD", str(value or ""))
    cleaned = "".join(
        char.lower()
        for char in normalized
        if not unicodedata.combining(char) and char.isalnum()
    )
    return cleaned


def normalize_reference_words(value: str | None) -> list[str]:
    normalized = unicodedata.normalize("NFKD", str(value or ""))
    plain = "".join(char.lower() for char in normalized if not unicodedata.combining(char))
    return [word for word in re.findall(r"[a-z0-9]+", plain) if len(word) >= 3]


def meaningful_match_words(value: str | None) -> set[str]:
    return {word for word in normalize_reference_words(value) if word not in AUTO_MATCH_STOPWORDS}


def extract_digits(value: str | None) -> str:
    return "".join(char for char in str(value or "") if char.isdigit())


def as_decimal(value: object, default: Decimal | None = None) -> Decimal:
    if value in (None, ""):
        return default or Decimal("0")
    try:
        return Decimal(str(value))
    except Exception:
        return default or Decimal("0")


def compute_transaction_hash(
    *,
    cuenta_bancaria_id: int | None,
    tipo_movimiento: str,
    fecha_pago: date,
    monto: Decimal,
    numero_referencia: str | None,
    concepto_bancario: str | None,
    folio_bancario: str | None = None,
    saldo_resultante: Decimal | None = None,
    metadata: dict[str, object] | None = None,
) -> str | None:
    referencia = normalize_reference_token(numero_referencia)
    concepto = normalize_reference_token(concepto_bancario)
    folio = normalize_reference_token(folio_bancario)
    saldo_token = ""
    metadata_token = ""
    if saldo_resultante is not None:
        saldo_token = f"{clamp_money(saldo_resultante):.2f}"
    if metadata:
        parser = normalize_reference_token(str(metadata.get("parser") or ""))
        source_page = normalize_reference_token(str(metadata.get("source_page") or ""))
        fecha_liquidacion = normalize_reference_token(str(metadata.get("fecha_liquidacion") or ""))
        codigo_bancario = normalize_reference_token(str(metadata.get("codigo_bancario") or ""))
        lineas_origen = metadata.get("lineas_origen")
        if isinstance(lineas_origen, list):
            normalized_lines = [
                normalize_reference_token(str(linea))
                for linea in lineas_origen
                if str(linea).strip()
            ]
            metadata_token = "|".join(
                [
                    parser,
                    source_page,
                    fecha_liquidacion,
                    codigo_bancario,
                    "#".join(normalized_lines),
                ]
            )
    if not referencia and not folio and len(concepto) < 15:
        return None

    seed = "|".join(
        [
            str(cuenta_bancaria_id or 0),
            tipo_movimiento,
            fecha_pago.isoformat(),
            f"{clamp_money(monto):.2f}",
            referencia,
            folio,
            concepto,
            saldo_token,
            metadata_token,
        ]
    )
    return hashlib.sha256(seed.encode("utf-8")).hexdigest()


def get_transaction_saldo_a_favor_applied(transaction_item: Transaccion) -> Decimal:
    metadata = transaction_item.metadata or {}
    return clamp_money(as_decimal(metadata.get("saldo_a_favor_aplicado"), Decimal("0")))


def build_transaction_payment_snapshot(transaction_item: Transaccion) -> dict[str, object]:
    applied = Decimal("0")
    live_count = 0
    validated_count = 0

    pagos_cxc = getattr(transaction_item, "_pagos_cxc_vivos", None)
    if pagos_cxc is None:
        pagos_cxc = PagoCuentaPorCobrar.objects.filter(
            transaccion_relacionada_id=transaction_item.id
        ).exclude(estatus_validacion="RECHAZADO").values_list(
            "monto",
            "estatus_validacion",
        )
    pagos_cxp = getattr(transaction_item, "_pagos_cxp_vivos", None)
    if pagos_cxp is None:
        pagos_cxp = PagoCuentaPorPagar.objects.filter(
            transaccion_relacionada_id=transaction_item.id
        ).exclude(estatus_validacion="RECHAZADO").values_list(
            "monto",
            "estatus_validacion",
        )

    for payment in pagos_cxc:
        monto, estatus = (
            (payment.monto, payment.estatus_validacion)
            if hasattr(payment, "monto")
            else payment
        )
        applied += clamp_money(monto)
        live_count += 1
        if estatus == "VALIDADO":
            validated_count += 1
    for payment in pagos_cxp:
        monto, estatus = (
            (payment.monto, payment.estatus_validacion)
            if hasattr(payment, "monto")
            else payment
        )
        applied += clamp_money(monto)
        live_count += 1
        if estatus == "VALIDADO":
            validated_count += 1

    saldo_a_favor = get_transaction_saldo_a_favor_applied(transaction_item)
    applied += saldo_a_favor
    applied = clamp_money(applied)
    return {
        "applied_amount": applied,
        "available_amount": clamp_money(clamp_money(transaction_item.monto) - applied),
        "saldo_a_favor": saldo_a_favor,
        "live_count": live_count,
        "validated_count": validated_count,
    }


def get_transaction_payment_snapshot(transaction_item: Transaccion) -> dict[str, object]:
    snapshot = getattr(transaction_item, "_transaction_payment_snapshot", None)
    if snapshot is None:
        snapshot = build_transaction_payment_snapshot(transaction_item)
        transaction_item._transaction_payment_snapshot = snapshot
    return snapshot


def attach_live_payment_to_transaction_snapshot(
    transaction_item: Transaccion | None,
    *,
    attr_name: str,
    payment: PagoCuentaPorCobrar | PagoCuentaPorPagar,
) -> None:
    if transaction_item is None or payment.estatus_validacion == "RECHAZADO":
        return
    prefetched_payments = getattr(transaction_item, attr_name, None)
    if prefetched_payments is not None:
        prefetched_payments.append(payment)
    if hasattr(transaction_item, "_transaction_payment_snapshot"):
        delattr(transaction_item, "_transaction_payment_snapshot")


def get_transaction_applied_amount(transaction_item: Transaccion) -> Decimal:
    snapshot = get_transaction_payment_snapshot(transaction_item)
    return clamp_money(snapshot["applied_amount"])


def get_transaction_available_amount(transaction_item: Transaccion) -> Decimal:
    snapshot = get_transaction_payment_snapshot(transaction_item)
    return clamp_money(snapshot["available_amount"])


def has_live_transaction_links(transaction_item: Transaccion) -> bool:
    if transaction_item.evento_relacionado_id:
        return True
    if transaction_item.pagos_cxc.exclude(estatus_validacion="RECHAZADO").exists():
        return True
    if transaction_item.pagos_cxp.exclude(estatus_validacion="RECHAZADO").exists():
        return True
    return False


def update_transaction_reconciliation_status(
    transaction_item: Transaccion,
    *,
    persist: bool = True,
    extra_update_fields: list[str] | None = None,
) -> str:
    if transaction_item.duplicado_de_id:
        status = "DUPLICADO"
    elif transaction_item.estatus_conciliacion == "RECHAZADO":
        status = "RECHAZADO"
    else:
        snapshot = build_transaction_payment_snapshot(transaction_item)
        transaction_item._transaction_payment_snapshot = snapshot
        available = clamp_money(snapshot["available_amount"])
        has_payment_links = bool(snapshot["live_count"]) or snapshot["saldo_a_favor"] > 0
        has_links = bool(transaction_item.evento_relacionado_id or has_payment_links)
        has_validated_payment = bool(snapshot["validated_count"])
        event_validated = bool(
            transaction_item.evento_relacionado_id
            and transaction_item.evento_relacionado
            and transaction_item.evento_relacionado.estatus == "CONCILIADO"
        )

        if not has_links:
            status = (
                "NO_IDENTIFICADO"
                if transaction_item.estatus_conciliacion == "NO_IDENTIFICADO"
                else "EN_ESPERA"
            )
        elif available > 0:
            status = "PARCIAL" if has_payment_links else "VINCULADO"
        else:
            status = "VALIDADO" if has_validated_payment or event_validated else "VINCULADO"

    if persist:
        update_fields = list(extra_update_fields or [])
        update_fields.append("estatus_conciliacion")
        transaction_item.estatus_conciliacion = status
        if status == "VALIDADO":
            transaction_item.fecha_validacion = timezone.now()
            update_fields.append("fecha_validacion")
        elif transaction_item.fecha_validacion and status != "VALIDADO":
            transaction_item.fecha_validacion = None
            update_fields.append("fecha_validacion")
        transaction_item.save(update_fields=list(dict.fromkeys(update_fields)))
    return status


def register_transaction_credit(
    transaction_item: Transaccion,
    *,
    cliente_id: int,
    saldo_aplicado: Decimal,
) -> None:
    if saldo_aplicado <= 0:
        return
    metadata = transaction_item.metadata or {}
    metadata["saldo_a_favor_aplicado"] = decimal_to_float(
        clamp_money(as_decimal(metadata.get("saldo_a_favor_aplicado"), Decimal("0"))) + saldo_aplicado
    )
    metadata["saldo_a_favor_cliente_id"] = cliente_id
    transaction_item.metadata = metadata
    transaction_item.save(update_fields=["metadata"])


def serialize_bank_account(account: CuentaBancaria) -> dict:
    has_latest_load_annotations = hasattr(account, "ultimo_periodo_hasta")
    latest_load = None
    if not has_latest_load_annotations:
        latest_load = (
            account.cargas_conciliacion.order_by("-fecha_hasta", "-fecha_carga", "-id").first()
        )
    lotes_cargados = getattr(account, "lotes_cargados_count", None)
    if lotes_cargados is None:
        lotes_cargados = account.cargas_conciliacion.count()
    movimientos_registrados = getattr(account, "movimientos_registrados_count", None)
    if movimientos_registrados is None:
        movimientos_registrados = account.transacciones.count()

    ultimo_periodo_desde = (
        getattr(account, "ultimo_periodo_desde", None)
        if has_latest_load_annotations
        else (latest_load.fecha_desde if latest_load else None)
    )
    ultimo_periodo_hasta = (
        getattr(account, "ultimo_periodo_hasta", None)
        if has_latest_load_annotations
        else (latest_load.fecha_hasta if latest_load else None)
    )
    ultimo_saldo_inicial = (
        getattr(account, "ultimo_saldo_inicial", None)
        if has_latest_load_annotations
        else (latest_load.saldo_inicial if latest_load else None)
    )
    ultimo_saldo_final = (
        getattr(account, "ultimo_saldo_final", None)
        if has_latest_load_annotations
        else (latest_load.saldo_final if latest_load else None)
    )
    ultimo_total_ingresos = (
        getattr(account, "ultimo_total_ingresos", None)
        if has_latest_load_annotations
        else (latest_load.total_ingresos if latest_load else None)
    )
    ultimo_total_egresos = (
        getattr(account, "ultimo_total_egresos", None)
        if has_latest_load_annotations
        else (latest_load.total_egresos if latest_load else None)
    )

    return {
        "id": account.id,
        "capa_id": account.capa_negocio_id,
        "capa_nombre": account.capa_negocio.nombre if account.capa_negocio_id else None,
        "entidad_id": account.entidad_relacionada_id,
        "entidad_nombre": account.entidad_relacionada.nombre_comercial
        if account.entidad_relacionada_id
        else None,
        "nombre": account.nombre,
        "alias": account.alias,
        "banco": account.banco,
        "numero_cuenta": account.numero_cuenta,
        "clabe": account.clabe,
        "ultima_4": account.ultima_4,
        "moneda": account.moneda,
        "activa": account.activa,
        "lotes_cargados": int(lotes_cargados or 0),
        "movimientos_registrados": int(movimientos_registrados or 0),
        "ultimo_periodo_desde": ultimo_periodo_desde,
        "ultimo_periodo_hasta": ultimo_periodo_hasta,
        "ultimo_saldo_inicial": (
            decimal_to_float(ultimo_saldo_inicial)
            if ultimo_saldo_inicial is not None
            else None
        ),
        "ultimo_saldo_final": (
            decimal_to_float(ultimo_saldo_final)
            if ultimo_saldo_final is not None
            else None
        ),
        "ultimo_total_ingresos": (
            decimal_to_float(ultimo_total_ingresos)
            if ultimo_total_ingresos is not None
            else None
        ),
        "ultimo_total_egresos": (
            decimal_to_float(ultimo_total_egresos)
            if ultimo_total_egresos is not None
            else None
        ),
    }


def serialize_reconciliation_load(load: CargaConciliacion) -> dict:
    return {
        "id": load.id,
        "cuenta_bancaria_id": load.cuenta_bancaria_relacionada_id,
        "cuenta_bancaria_nombre": str(load.cuenta_bancaria_relacionada)
        if load.cuenta_bancaria_relacionada_id
        else None,
        "nombre_archivo": load.nombre_archivo,
        "formato_archivo": load.formato_archivo,
        "fecha_carga": load.fecha_carga,
        "fecha_desde": load.fecha_desde,
        "fecha_hasta": load.fecha_hasta,
        "saldo_inicial": decimal_to_float(load.saldo_inicial),
        "saldo_final": decimal_to_float(load.saldo_final),
        "saldo_calculado": decimal_to_float(load.saldo_calculado),
        "total_ingresos": decimal_to_float(load.total_ingresos),
        "total_egresos": decimal_to_float(load.total_egresos),
        "estatus_procesamiento": load.estatus_procesamiento,
        "estatus_cuadre": load.estatus_cuadre,
        "registros_detectados": load.registros_detectados,
        "registros_conciliados": load.registros_conciliados,
        "registros_pendientes": load.registros_pendientes,
        "registros_no_identificados": load.registros_no_identificados,
        "registros_duplicados": load.registros_duplicados,
        "errores_detectados": load.errores_detectados,
        "observaciones": load.observaciones,
        "metadata": load.metadata,
    }


def payment_starts_validated(metodo: str, canal_origen: str) -> bool:
    return metodo == "AJUSTE" or canal_origen in {"SALDO_A_FAVOR", "AJUSTE_SISTEMA"}


def resolve_payment_application_mode(entidad: EntidadNegocio) -> str:
    capa = getattr(entidad, "capa_negocio", None)
    if capa and capa.aplicacion_pagos:
        return capa.aplicacion_pagos
    return "ADEUDO_MAS_ANTIGUO"


def resolve_evidence(evidencia_id: int | None):
    if not evidencia_id:
        return None
    from comunicaciones.models import EvidenciaPago

    evidencia = EvidenciaPago.objects.filter(id=evidencia_id).first()
    if not evidencia:
        raise ValueError("La evidencia de pago seleccionada no existe.")
    return evidencia


def refresh_evidence_status(evidencia_id: int | None) -> None:
    if not evidencia_id:
        return

    from comunicaciones.models import EvidenciaPago

    evidencia = EvidenciaPago.objects.only("id", "estatus").filter(id=evidencia_id).first()
    if not evidencia:
        return

    payment_statuses = [
        *PagoCuentaPorCobrar.objects.filter(
            evidencia_pago_relacionada_id=evidencia_id
        ).values_list("estatus_validacion", flat=True),
        *PagoCuentaPorPagar.objects.filter(
            evidencia_pago_relacionada_id=evidencia_id
        ).values_list("estatus_validacion", flat=True),
    ]
    if not payment_statuses:
        nuevo_estatus = "NUEVA"
    elif all(status == "VALIDADO" for status in payment_statuses):
        nuevo_estatus = "VALIDADA"
    elif all(status == "RECHAZADO" for status in payment_statuses):
        nuevo_estatus = "DESCARTADA"
    else:
        nuevo_estatus = "APLICADA"
    if evidencia.estatus != nuevo_estatus:
        evidencia.estatus = nuevo_estatus
        evidencia.save(update_fields=["estatus"])


@transaction.atomic
def apply_available_credit_to_cxc(cuenta: CuentaPorCobrar) -> Decimal:
    if cuenta.estatus_adeudo in {"CANCELADO", "INCOBRABLE"}:
        return Decimal("0")

    saldo_cliente = get_or_create_saldo_cliente(
        cuenta.cliente_relacionado_id,
        cuenta.entidad_relacionada or cuenta.cliente_relacionado.entidad_relacionada,
    )
    disponible = clamp_money(saldo_cliente.saldo_a_favor)
    if disponible <= 0:
        return Decimal("0")

    aplicado = min(disponible, cuenta.saldo_pendiente)
    if aplicado <= 0:
        return Decimal("0")

    PagoCuentaPorCobrar.objects.create(
        cuenta_por_cobrar=cuenta,
        monto=aplicado,
        fecha_pago=cuenta.fecha_emision,
        metodo="AJUSTE",
        canal_origen="SALDO_A_FAVOR",
        estatus_validacion="VALIDADO",
        fecha_validacion=timezone.now(),
        referencia="SALDO_A_FAVOR",
        notas="Aplicacion automatica de saldo a favor.",
        notas_validacion="Saldo a favor aplicado y validado por sistema.",
    )
    cuenta.monto_pagado = clamp_money(cuenta.monto_pagado) + aplicado
    cuenta.saldo_a_favor_aplicado = clamp_money(cuenta.saldo_a_favor_aplicado) + aplicado
    cuenta.estatus_adeudo = cuenta.recalcular_estatus()
    cuenta.save(
        update_fields=[
            "monto_pagado",
            "saldo_a_favor_aplicado",
            "estatus_adeudo",
        ]
    )

    saldo_cliente.saldo_a_favor = disponible - aplicado
    saldo_cliente.save(update_fields=["saldo_a_favor", "fecha_actualizacion"])
    return aplicado


def cxc_reference(origen: str, asignacion_id: int, period_start: date | None = None) -> str:
    if period_start:
        return f"{origen}:{asignacion_id}:{period_start.isoformat()}"
    return f"{origen}:{asignacion_id}"


def generated_cxc_has_locking_activity(cuenta: CuentaPorCobrar) -> bool:
    from facturacion.models import FacturaEmitida

    state = (
        CuentaPorCobrar.objects.filter(pk=cuenta.pk)
        .annotate(
            has_payments=Exists(
                PagoCuentaPorCobrar.objects.filter(cuenta_por_cobrar_id=OuterRef("pk"))
            ),
            has_invoices=Exists(
                FacturaEmitida.objects.filter(cuenta_por_cobrar_id=OuterRef("pk"))
            ),
        )
        .values("has_payments", "has_invoices")
        .first()
    )
    return bool(state and (state["has_payments"] or state["has_invoices"]))


def recalculate_cxc_status_without_payment_lookup(cuenta: CuentaPorCobrar) -> str:
    if cuenta.estatus_adeudo in {"CANCELADO", "INCOBRABLE"}:
        return cuenta.estatus_adeudo
    if cuenta.saldo_pendiente <= 0:
        return "CONCILIADO"
    if cuenta.monto_pagado > 0:
        return "VENCIDO" if cuenta.fecha_vencimiento < timezone.localdate() else "PARCIAL"
    return "VENCIDO" if cuenta.fecha_vencimiento < timezone.localdate() else "PENDIENTE"


def sync_generated_cxc_if_open(cuenta: CuentaPorCobrar, expected: dict[str, object]) -> bool:
    if cuenta.estatus_adeudo in {"CONCILIADO", "POR_CONCILIAR", "CANCELADO", "INCOBRABLE"}:
        return False
    if clamp_money(cuenta.monto_pagado) > 0:
        return False

    update_fields: list[str] = []
    for field, value in expected.items():
        if getattr(cuenta, field) != value:
            setattr(cuenta, field, value)
            update_fields.append(field)

    recalculated_status = recalculate_cxc_status_without_payment_lookup(cuenta)
    if cuenta.estatus_adeudo != recalculated_status:
        cuenta.estatus_adeudo = recalculated_status
        if "estatus_adeudo" not in update_fields:
            update_fields.append("estatus_adeudo")

    if not update_fields:
        return False
    if generated_cxc_has_locking_activity(cuenta):
        return False

    cuenta.save(update_fields=update_fields)
    return True




def cxp_reference(programacion_id: int, period_start: date | None = None) -> str:
    if period_start:
        return f"CXP:{programacion_id}:{period_start.isoformat()}"
    return f"CXP:{programacion_id}"








def get_open_cxc_queryset(entidad: EntidadNegocio, cliente_id: int | None = None):
    queryset = CuentaPorCobrar.objects.filter(
        Q(entidad_relacionada=entidad)
        | Q(
            entidad_relacionada__isnull=True,
            cliente_relacionado__entidad_relacionada=entidad,
        )
    ).exclude(estatus_adeudo__in=["CONCILIADO", "CANCELADO", "INCOBRABLE"])
    if cliente_id:
        queryset = queryset.filter(cliente_relacionado_id=cliente_id)
    return queryset.select_related(
        "entidad_relacionada",
        "cliente_relacionado",
        "cliente_relacionado__entidad_relacionada",
    )


def get_open_cxp_queryset(entidad: EntidadNegocio):
    return (
        CuentaPorPagar.objects.filter(entidad_relacionada=entidad)
        .exclude(estatus__in=["PAGADO", "CANCELADO"])
        .select_related("entidad_relacionada")
    )




def build_payment_reference_candidates(referencia: str | None, notas: str | None) -> set[str]:
    candidates = set()
    for value in (referencia, notas):
        token = normalize_reference_token(value)
        if token:
            candidates.add(token)
    return candidates


def build_transaction_reference_candidates(
    transaction_reference: str | None,
    transaction_concept: str | None,
) -> set[str]:
    return {
        token
        for token in (
            normalize_reference_token(transaction_reference),
            normalize_reference_token(transaction_concept),
        )
        if token
    }


def build_match_confidence_band(*, scope: str, score: int | None) -> str:
    if score is None:
        return "SIN_CANDIDATO"

    threshold = AUTO_MATCH_SCORE_THRESHOLDS.get(scope, 0)
    high_cutoff = threshold + AUTO_MATCH_HIGH_CONFIDENCE_BUFFER.get(scope, 0)
    if score >= high_cutoff:
        return "ALTA"
    if score >= threshold:
        return "MEDIA"
    return "BAJA"


def extract_match_score(item: tuple[int, object, dict]) -> int:
    return int(item[0])


def extract_match_sort_date(item: tuple[int, object, dict]) -> date:
    candidate = item[1]
    candidate_date = getattr(candidate, "fecha_pago", None) or getattr(
        candidate, "fecha_evento", None
    )
    return candidate_date or date.max


def evaluate_scored_candidates[T](
    candidates: list[tuple[int, T, dict]],
    *,
    scope: str,
    serializer: Callable[[T, int, dict], dict],
) -> dict[str, object]:
    if not candidates:
        return {
            "status": "NONE",
            "selected": None,
            "best_score": None,
            "score_margin": None,
            "confidence_band": "SIN_CANDIDATO",
            "candidates": [],
        }

    ordered = sorted(
        candidates,
        key=lambda item: (-extract_match_score(item), extract_match_sort_date(item), getattr(item[1], "id")),
    )
    best_score, best_candidate, best_analysis = ordered[0]
    second_score = ordered[1][0] if len(ordered) > 1 else None
    score_margin = (best_score - second_score) if second_score is not None else None
    min_score = AUTO_MATCH_SCORE_THRESHOLDS[scope]
    min_margin = AUTO_MATCH_SCORE_MARGIN[scope]

    if best_score < min_score:
        status = "LOW_CONFIDENCE"
        selected = None
    elif second_score is not None and score_margin is not None and score_margin < min_margin:
        status = "AMBIGUOUS"
        selected = None
    else:
        status = "MATCHED"
        selected = best_candidate

    return {
        "status": status,
        "selected": selected,
        "best_score": best_score,
        "score_margin": score_margin,
        "confidence_band": build_match_confidence_band(scope=scope, score=best_score),
        "best_analysis": best_analysis,
        "candidates": [
            serializer(candidate, score, analysis)
            for score, candidate, analysis in ordered[:AUTO_MATCH_CANDIDATE_PREVIEW_LIMIT]
        ],
    }


def analyze_payment_candidate(
    *,
    payment_amount: Decimal,
    payment_date: date,
    payment_reference: str | None,
    payment_notes: str | None,
    transaction_amount: Decimal,
    transaction_date: date,
    transaction_reference: str | None,
    transaction_concept: str | None,
    transaction_tokens: set[str] | None = None,
) -> dict[str, object]:
    reasons: list[str] = []
    if clamp_money(payment_amount) != clamp_money(transaction_amount):
        return {
            "eligible": False,
            "score": -1,
            "date_distance": None,
            "reference_match": False,
            "reasons": ["El monto del pago no coincide con el movimiento bancario."],
        }

    reasons.append("Monto exacto contra el estado de cuenta.")

    distance = abs((payment_date - transaction_date).days)
    if distance > 7:
        return {
            "eligible": False,
            "score": -1,
            "date_distance": distance,
            "reference_match": False,
            "reasons": [
                "Monto exacto contra el estado de cuenta.",
                "La fecha del pago queda fuera de la ventana maxima de 7 dias.",
            ],
        }

    score = max(0, 100 - distance)
    reasons.append(f"Fecha dentro de la ventana permitida ({distance} dia(s) de diferencia).")
    if transaction_tokens is None:
        transaction_tokens = build_transaction_reference_candidates(
            transaction_reference,
            transaction_concept,
        )
    payment_tokens = build_payment_reference_candidates(payment_reference, payment_notes)
    reference_match = False

    if transaction_tokens and payment_tokens:
        if any(
            transaction_token in payment_token or payment_token in transaction_token
            for transaction_token in transaction_tokens
            for payment_token in payment_tokens
        ):
            score += 500
            reference_match = True
            reasons.append("Referencia o concepto con coincidencia fuerte.")
        else:
            score -= 25
            reasons.append("No hubo coincidencia fuerte entre referencia y concepto.")
    else:
        reasons.append("Sin referencias suficientes para validar por texto.")

    if payment_date == transaction_date:
        score += 50
        reasons.append("La fecha del pago es exactamente la misma del movimiento.")

    return {
        "eligible": True,
        "score": score,
        "date_distance": distance,
        "reference_match": reference_match,
        "reasons": reasons,
    }


def serialize_receivable_payment_match_candidate(
    payment: PagoCuentaPorCobrar,
    score: int,
    analysis: dict,
) -> dict:
    return {
        "id": payment.id,
        "scope": "CXC",
        "cuenta_id": payment.cuenta_por_cobrar_id,
        "cliente_id": payment.cuenta_por_cobrar.cliente_relacionado_id,
        "cliente_nombre": payment.cuenta_por_cobrar.cliente_relacionado.razon_social
        or payment.cuenta_por_cobrar.cliente_relacionado.nombre_comercial,
        "concepto": payment.cuenta_por_cobrar.concepto,
        "monto": decimal_to_float(payment.monto),
        "fecha_pago": payment.fecha_pago.isoformat(),
        "referencia": payment.referencia,
        "score": score,
        "date_distance": analysis.get("date_distance"),
        "reference_match": analysis.get("reference_match", False),
        "reasons": analysis.get("reasons", []),
    }


def serialize_payable_payment_match_candidate(
    payment: PagoCuentaPorPagar,
    score: int,
    analysis: dict,
) -> dict:
    return {
        "id": payment.id,
        "scope": "CXP",
        "cuenta_id": payment.cuenta_por_pagar_id,
        "proveedor_nombre": payment.cuenta_por_pagar.proveedor_nombre,
        "concepto": payment.cuenta_por_pagar.concepto,
        "monto": decimal_to_float(payment.monto),
        "fecha_pago": payment.fecha_pago.isoformat(),
        "referencia": payment.referencia,
        "score": score,
        "date_distance": analysis.get("date_distance"),
        "reference_match": analysis.get("reference_match", False),
        "reasons": analysis.get("reasons", []),
    }


def match_receivable_payment_for_transaction(
    transaction_item: Transaccion,
) -> dict[str, object]:
    candidates: list[tuple[int, PagoCuentaPorCobrar, dict]] = []
    start_date = transaction_item.fecha_pago - timedelta(days=7)
    end_date = transaction_item.fecha_pago + timedelta(days=7)
    transaction_tokens = build_transaction_reference_candidates(
        transaction_item.numero_referencia,
        transaction_item.concepto_bancario,
    )
    queryset = (
        PagoCuentaPorCobrar.objects.select_related(
            "cuenta_por_cobrar",
            "cuenta_por_cobrar__cliente_relacionado",
            "cuenta_por_cobrar__cliente_relacionado__entidad_relacionada",
        )
        .filter(
            estatus_validacion="APLICADO",
            transaccion_relacionada__isnull=True,
            monto=clamp_money(transaction_item.monto),
            fecha_pago__range=(start_date, end_date),
        )
    )
    inferred_entity = infer_transaction_entity(transaction_item)
    if inferred_entity:
        queryset = queryset.filter(
            Q(cuenta_por_cobrar__entidad_relacionada_id=inferred_entity.id)
            | Q(
                cuenta_por_cobrar__entidad_relacionada__isnull=True,
                cuenta_por_cobrar__cliente_relacionado__entidad_relacionada_id=inferred_entity.id,
            )
        )
    queryset = queryset.order_by("fecha_pago", "id")[:AUTO_MATCH_CANDIDATE_SCAN_LIMIT]
    for payment in queryset:
        analysis = analyze_payment_candidate(
            payment_amount=payment.monto,
            payment_date=payment.fecha_pago,
            payment_reference=payment.referencia,
            payment_notes=payment.notas,
            transaction_amount=transaction_item.monto,
            transaction_date=transaction_item.fecha_pago,
            transaction_reference=transaction_item.numero_referencia,
            transaction_concept=transaction_item.concepto_bancario,
            transaction_tokens=transaction_tokens,
        )
        score = int(analysis["score"])
        if score >= 0:
            candidates.append((score, payment, analysis))
    return evaluate_scored_candidates(
        candidates,
        scope="CXC",
        serializer=serialize_receivable_payment_match_candidate,
    )


def match_payable_payment_for_transaction(
    transaction_item: Transaccion,
) -> dict[str, object]:
    candidates: list[tuple[int, PagoCuentaPorPagar, dict]] = []
    start_date = transaction_item.fecha_pago - timedelta(days=7)
    end_date = transaction_item.fecha_pago + timedelta(days=7)
    transaction_tokens = build_transaction_reference_candidates(
        transaction_item.numero_referencia,
        transaction_item.concepto_bancario,
    )
    queryset = (
        PagoCuentaPorPagar.objects.select_related(
            "cuenta_por_pagar",
            "cuenta_por_pagar__entidad_relacionada",
        )
        .filter(
            estatus_validacion="APLICADO",
            transaccion_relacionada__isnull=True,
            monto=clamp_money(transaction_item.monto),
            fecha_pago__range=(start_date, end_date),
        )
    )
    inferred_entity = infer_transaction_entity(transaction_item)
    if inferred_entity:
        queryset = queryset.filter(cuenta_por_pagar__entidad_relacionada_id=inferred_entity.id)
    queryset = queryset.order_by("fecha_pago", "id")[:AUTO_MATCH_CANDIDATE_SCAN_LIMIT]
    for payment in queryset:
        analysis = analyze_payment_candidate(
            payment_amount=payment.monto,
            payment_date=payment.fecha_pago,
            payment_reference=payment.referencia,
            payment_notes=payment.notas,
            transaction_amount=transaction_item.monto,
            transaction_date=transaction_item.fecha_pago,
            transaction_reference=transaction_item.numero_referencia,
            transaction_concept=transaction_item.concepto_bancario,
            transaction_tokens=transaction_tokens,
        )
        score = int(analysis["score"])
        if score >= 0:
            candidates.append((score, payment, analysis))
    return evaluate_scored_candidates(
        candidates,
        scope="CXP",
        serializer=serialize_payable_payment_match_candidate,
    )


@transaction.atomic
def validate_receivable_payment(
    payment: PagoCuentaPorCobrar,
    *,
    transaction_item: Transaccion | None = None,
    notes: str = "",
    sync_transaction: bool = True,
    update_transaction_status: bool = True,
    refresh_evidence: bool = True,
    pagos_pendientes_validacion: bool | None = None,
) -> PagoCuentaPorCobrar:
    if payment.estatus_validacion == "VALIDADO":
        return payment

    payment.estatus_validacion = "VALIDADO"
    payment.fecha_validacion = timezone.now()
    payment.notas_validacion = notes or payment.notas_validacion
    if transaction_item:
        payment.transaccion_relacionada = transaction_item
    payment.save(
        update_fields=[
            "estatus_validacion",
            "fecha_validacion",
            "notas_validacion",
            "transaccion_relacionada",
        ]
    )
    if transaction_item and sync_transaction:
        transaction_item.cuenta_por_cobrar_relacionada = payment.cuenta_por_cobrar
        transaction_item.save(update_fields=["cuenta_por_cobrar_relacionada"])
    if transaction_item and update_transaction_status:
        update_transaction_reconciliation_status(transaction_item)

    cuenta = payment.cuenta_por_cobrar
    nuevo_estatus = cuenta.recalcular_estatus(
        pagos_pendientes_validacion=pagos_pendientes_validacion
    )
    if cuenta.estatus_adeudo != nuevo_estatus:
        cuenta.estatus_adeudo = nuevo_estatus
        cuenta.save(update_fields=["estatus_adeudo"])
    if refresh_evidence:
        refresh_evidence_status(payment.evidencia_pago_relacionada_id)
    return payment


@transaction.atomic
def validate_payable_payment(
    payment: PagoCuentaPorPagar,
    *,
    transaction_item: Transaccion | None = None,
    notes: str = "",
    sync_transaction: bool = True,
    update_transaction_status: bool = True,
    refresh_evidence: bool = True,
    pagos_pendientes_validacion: bool | None = None,
) -> PagoCuentaPorPagar:
    if payment.estatus_validacion == "VALIDADO":
        return payment

    payment.estatus_validacion = "VALIDADO"
    payment.fecha_validacion = timezone.now()
    payment.notas_validacion = notes or payment.notas_validacion
    if transaction_item:
        payment.transaccion_relacionada = transaction_item
    payment.save(
        update_fields=[
            "estatus_validacion",
            "fecha_validacion",
            "notas_validacion",
            "transaccion_relacionada",
        ]
    )
    if transaction_item and sync_transaction:
        transaction_item.cuenta_por_pagar_relacionada = payment.cuenta_por_pagar
        transaction_item.save(update_fields=["cuenta_por_pagar_relacionada"])
    if transaction_item and update_transaction_status:
        update_transaction_reconciliation_status(transaction_item)

    cuenta = payment.cuenta_por_pagar
    nuevo_estatus = cuenta.recalcular_estatus(
        pagos_pendientes_validacion=pagos_pendientes_validacion
    )
    if cuenta.estatus != nuevo_estatus:
        cuenta.estatus = nuevo_estatus
        cuenta.save(update_fields=["estatus"])
    if refresh_evidence:
        refresh_evidence_status(payment.evidencia_pago_relacionada_id)
    return payment


@transaction.atomic
def reject_receivable_payment(payment: PagoCuentaPorCobrar, *, reason: str = "") -> PagoCuentaPorCobrar:
    if payment.estatus_validacion == "RECHAZADO":
        return payment

    cuenta = payment.cuenta_por_cobrar
    cuenta.monto_pagado = clamp_money(cuenta.monto_pagado) - clamp_money(payment.monto)
    cuenta.estatus_adeudo = cuenta.recalcular_estatus()
    cuenta.save(update_fields=["monto_pagado", "estatus_adeudo"])

    payment.estatus_validacion = "RECHAZADO"
    payment.notas_validacion = reason or payment.notas_validacion
    payment.fecha_validacion = timezone.now()
    payment.save(
        update_fields=["estatus_validacion", "notas_validacion", "fecha_validacion"]
    )
    if payment.transaccion_relacionada_id:
        transaction_item = payment.transaccion_relacionada
        if (
            transaction_item.cuenta_por_cobrar_relacionada_id == cuenta.id
            and not transaction_item.pagos_cxc.exclude(estatus_validacion="RECHAZADO").exists()
        ):
            transaction_item.cuenta_por_cobrar_relacionada = None
            transaction_item.save(update_fields=["cuenta_por_cobrar_relacionada"])
        update_transaction_reconciliation_status(transaction_item)
    refresh_evidence_status(payment.evidencia_pago_relacionada_id)
    return payment


@transaction.atomic
def reject_payable_payment(payment: PagoCuentaPorPagar, *, reason: str = "") -> PagoCuentaPorPagar:
    if payment.estatus_validacion == "RECHAZADO":
        return payment

    cuenta = payment.cuenta_por_pagar
    cuenta.monto_pagado = clamp_money(cuenta.monto_pagado) - clamp_money(payment.monto)
    cuenta.estatus = cuenta.recalcular_estatus()
    cuenta.save(update_fields=["monto_pagado", "estatus"])

    payment.estatus_validacion = "RECHAZADO"
    payment.notas_validacion = reason or payment.notas_validacion
    payment.fecha_validacion = timezone.now()
    payment.save(
        update_fields=["estatus_validacion", "notas_validacion", "fecha_validacion"]
    )
    if payment.transaccion_relacionada_id:
        transaction_item = payment.transaccion_relacionada
        if (
            transaction_item.cuenta_por_pagar_relacionada_id == cuenta.id
            and not transaction_item.pagos_cxp.exclude(estatus_validacion="RECHAZADO").exists()
        ):
            transaction_item.cuenta_por_pagar_relacionada = None
            transaction_item.save(update_fields=["cuenta_por_pagar_relacionada"])
        update_transaction_reconciliation_status(transaction_item)
    refresh_evidence_status(payment.evidencia_pago_relacionada_id)
    return payment


def record_transaction_auto_match(
    transaction_item: Transaccion,
    *,
    scope: str,
    match_status: str,
    matched: bool,
    confidence_score: int | None,
    confidence_band: str,
    score_margin: int | None = None,
    matched_id: int | None = None,
    matched_type: str | None = None,
    reasons: list[str] | None = None,
    candidates: list[dict] | None = None,
) -> dict:
    metadata = dict(transaction_item.metadata or {})
    auto_match_data = {
        "engine_version": AUTO_MATCH_ENGINE_VERSION,
        "updated_at": timezone.now().isoformat(),
        "scope": scope,
        "match_status": match_status,
        "matched": matched,
        "confidence_score": confidence_score,
        "confidence_band": confidence_band,
        "score_margin": score_margin,
        "matched_id": matched_id,
        "matched_type": matched_type,
        "reasons": reasons or [],
        "candidates": candidates or [],
    }
    metadata["auto_match"] = auto_match_data
    transaction_item.metadata = metadata
    transaction_item.save(update_fields=["metadata"])
    return auto_match_data


@transaction.atomic
def auto_match_bank_transaction(transaction_item: Transaccion) -> dict[str, object]:
    from .eventos import try_auto_reconcile_transaction

    event_result = try_auto_reconcile_transaction(transaction_item)
    if event_result["matched"]:
        if not event_result.get("transaction_status_finalized"):
            update_transaction_reconciliation_status(transaction_item)
        record_transaction_auto_match(
            transaction_item,
            scope="EVENTO",
            match_status=str(event_result["match_status"]),
            matched=True,
            confidence_score=event_result.get("confidence_score"),
            confidence_band=str(event_result.get("confidence_band") or "ALTA"),
            score_margin=event_result.get("score_margin"),
            matched_id=event_result.get("event_id"),
            matched_type="EVENTO",
            reasons=event_result.get("reasons"),
            candidates=event_result.get("candidates"),
        )
        return {
            "matched": True,
            "payment_type": "EVENTO",
            "event_id": event_result["event_id"],
            "payment_id": event_result["event_id"],
            "match_status": event_result["match_status"],
            "confidence_score": event_result.get("confidence_score"),
            "confidence_band": event_result.get("confidence_band"),
        }

    if event_result["match_status"] in {"AMBIGUOUS", "PENDING", "LOW_CONFIDENCE"}:
        transaction_item.estatus_conciliacion = "EN_ESPERA"
        transaction_item.save(update_fields=["estatus_conciliacion"])
        record_transaction_auto_match(
            transaction_item,
            scope="EVENTO",
            match_status=str(event_result["match_status"]),
            matched=False,
            confidence_score=event_result.get("confidence_score"),
            confidence_band=str(event_result.get("confidence_band") or "BAJA"),
            score_margin=event_result.get("score_margin"),
            matched_id=event_result.get("event_id"),
            matched_type="EVENTO" if event_result.get("event_id") else None,
            reasons=event_result.get("reasons"),
            candidates=event_result.get("candidates"),
        )
        return {
            "matched": False,
            "payment_type": "EVENTO",
            "event_id": event_result["event_id"],
            "payment_id": event_result["event_id"],
            "match_status": event_result["match_status"],
            "confidence_score": event_result.get("confidence_score"),
            "confidence_band": event_result.get("confidence_band"),
        }

    if transaction_item.tipo_movimiento == "INGRESO":
        payment_scope = "CXC"
        payment_result = match_receivable_payment_for_transaction(transaction_item)
        payment = payment_result["selected"]
        if payment:
            validate_receivable_payment(
                payment,
                transaction_item=transaction_item,
                notes="Validado automaticamente desde estado de cuenta.",
                sync_transaction=False,
                update_transaction_status=False,
            )
            transaction_item.cuenta_por_cobrar_relacionada = payment.cuenta_por_cobrar
            transaction_item.estatus_conciliacion = "VALIDADO"
            transaction_item.fecha_validacion = timezone.now()
            transaction_item.save(
                update_fields=[
                    "cuenta_por_cobrar_relacionada",
                    "estatus_conciliacion",
                    "fecha_validacion",
                ]
            )
            record_transaction_auto_match(
                transaction_item,
                scope=payment_scope,
                match_status=str(payment_result["status"]),
                matched=True,
                confidence_score=payment_result.get("best_score"),
                confidence_band=str(payment_result.get("confidence_band") or "ALTA"),
                score_margin=payment_result.get("score_margin"),
                matched_id=payment.id,
                matched_type=payment_scope,
                reasons=payment_result.get("best_analysis", {}).get("reasons"),
                candidates=payment_result.get("candidates"),
            )
            return {
                "matched": True,
                "payment_type": payment_scope,
                "event_id": None,
                "payment_id": payment.id,
                "match_status": payment_result["status"],
                "confidence_score": payment_result.get("best_score"),
                "confidence_band": payment_result.get("confidence_band"),
            }
        transaction_item.estatus_conciliacion = (
            "EN_ESPERA"
            if payment_result["status"] in {"AMBIGUOUS", "LOW_CONFIDENCE"}
            else "NO_IDENTIFICADO"
        )
        transaction_item.save(update_fields=["estatus_conciliacion"])
        record_transaction_auto_match(
            transaction_item,
            scope=payment_scope,
            match_status=str(payment_result["status"]),
            matched=False,
            confidence_score=payment_result.get("best_score"),
            confidence_band=str(payment_result.get("confidence_band") or "SIN_CANDIDATO"),
            score_margin=payment_result.get("score_margin"),
            reasons=payment_result.get("best_analysis", {}).get("reasons"),
            candidates=payment_result.get("candidates"),
        )
        return {
            "matched": False,
            "payment_type": payment_scope,
            "event_id": None,
            "payment_id": None,
            "match_status": payment_result["status"],
            "confidence_score": payment_result.get("best_score"),
            "confidence_band": payment_result.get("confidence_band"),
        }

    payment_scope = "CXP"
    payment_result = match_payable_payment_for_transaction(transaction_item)
    payment = payment_result["selected"]
    if payment:
        validate_payable_payment(
            payment,
            transaction_item=transaction_item,
            notes="Validado automaticamente desde estado de cuenta.",
            sync_transaction=False,
            update_transaction_status=False,
        )
        transaction_item.cuenta_por_pagar_relacionada = payment.cuenta_por_pagar
        transaction_item.estatus_conciliacion = "VALIDADO"
        transaction_item.fecha_validacion = timezone.now()
        transaction_item.save(
            update_fields=[
                "cuenta_por_pagar_relacionada",
                "estatus_conciliacion",
                "fecha_validacion",
            ]
        )
        record_transaction_auto_match(
            transaction_item,
            scope=payment_scope,
            match_status=str(payment_result["status"]),
            matched=True,
            confidence_score=payment_result.get("best_score"),
            confidence_band=str(payment_result.get("confidence_band") or "ALTA"),
            score_margin=payment_result.get("score_margin"),
            matched_id=payment.id,
            matched_type=payment_scope,
            reasons=payment_result.get("best_analysis", {}).get("reasons"),
            candidates=payment_result.get("candidates"),
        )
        return {
            "matched": True,
            "payment_type": payment_scope,
            "event_id": None,
            "payment_id": payment.id,
            "match_status": payment_result["status"],
            "confidence_score": payment_result.get("best_score"),
            "confidence_band": payment_result.get("confidence_band"),
        }

    transaction_item.estatus_conciliacion = (
        "EN_ESPERA"
        if payment_result["status"] in {"AMBIGUOUS", "LOW_CONFIDENCE"}
        else "NO_IDENTIFICADO"
    )
    transaction_item.save(update_fields=["estatus_conciliacion"])
    record_transaction_auto_match(
        transaction_item,
        scope=payment_scope,
        match_status=str(payment_result["status"]),
        matched=False,
        confidence_score=payment_result.get("best_score"),
        confidence_band=str(payment_result.get("confidence_band") or "SIN_CANDIDATO"),
        score_margin=payment_result.get("score_margin"),
        reasons=payment_result.get("best_analysis", {}).get("reasons"),
        candidates=payment_result.get("candidates"),
    )
    return {
        "matched": False,
        "payment_type": payment_scope,
        "event_id": None,
        "payment_id": None,
        "match_status": payment_result["status"],
        "confidence_score": payment_result.get("best_score"),
        "confidence_band": payment_result.get("confidence_band"),
    }


@transaction.atomic
def import_bank_transactions(
    *,
    movimientos: list[dict[str, object]],
    nombre_archivo: str = "",
    cuenta_bancaria: CuentaBancaria | None = None,
    formato_archivo: str | None = None,
    fecha_desde: date | None = None,
    fecha_hasta: date | None = None,
    saldo_inicial: Decimal | None = None,
    saldo_final: Decimal | None = None,
    observaciones: str = "",
    attempt_auto_match: bool = True,
) -> dict[str, object]:
    carga = CargaConciliacion.objects.create(
        archivo_excel_url="local-upload",
        cuenta_bancaria_relacionada=cuenta_bancaria,
        nombre_archivo=nombre_archivo or None,
        formato_archivo=formato_archivo or None,
        fecha_desde=fecha_desde,
        fecha_hasta=fecha_hasta,
        saldo_inicial=saldo_inicial,
        saldo_final=saldo_final,
        observaciones=observaciones or None,
    )
    conciliados = 0
    pendientes = 0
    no_identificados = 0
    duplicados = 0
    total_ingresos = Decimal("0")
    total_egresos = Decimal("0")
    movimientos_creados: list[Transaccion] = []
    duplicados_resumen: list[dict[str, object]] = []
    initial_existing_hashes = set(
        Transaccion.objects.exclude(hash_movimiento__isnull=True).exclude(hash_movimiento="").values_list(
            "hash_movimiento", flat=True
        )
    )
    existing_hashes = set(initial_existing_hashes)

    for movement in movimientos:
        movement_amount = clamp_money(as_decimal(movement.get("monto")))
        movement_date = movement["fecha_pago"]  # type: ignore[index]
        movement_type = str(movement["tipo_movimiento"])
        movement_balance_raw = movement.get("saldo_resultante")
        movement_balance = (
            Decimal(str(movement_balance_raw))
            if movement_balance_raw not in (None, "")
            else None
        )
        movement_metadata = movement.get("metadata")
        if not isinstance(movement_metadata, dict):
            movement_metadata = None

        hash_movimiento = compute_transaction_hash(
            cuenta_bancaria_id=cuenta_bancaria.id if cuenta_bancaria else None,
            tipo_movimiento=movement_type,
            fecha_pago=movement_date,  # type: ignore[arg-type]
            monto=movement_amount,
            numero_referencia=movement.get("numero_referencia"),  # type: ignore[arg-type]
            concepto_bancario=movement.get("concepto_bancario"),  # type: ignore[arg-type]
            folio_bancario=movement.get("folio_bancario"),  # type: ignore[arg-type]
            saldo_resultante=movement_balance,
            metadata=movement_metadata,
        )
        if hash_movimiento and hash_movimiento in existing_hashes:
            duplicados += 1
            if hash_movimiento in initial_existing_hashes:
                if movement_type == "INGRESO":
                    total_ingresos += movement_amount
                else:
                    total_egresos += movement_amount
            if len(duplicados_resumen) < 20:
                duplicados_resumen.append(
                    {
                        "fecha_pago": movement_date.isoformat(),
                        "monto": decimal_to_float(movement_amount),
                        "tipo_movimiento": movement_type,
                        "numero_referencia": movement.get("numero_referencia"),
                        "concepto_bancario": movement.get("concepto_bancario"),
                        "saldo_resultante": decimal_to_float(movement_balance),
                    }
                )
            continue

        try:
            transaction_item = Transaccion.objects.create(
                carga_relacionada=carga,
                origen="ESTADO_CUENTA",
                cuenta_bancaria_relacionada=cuenta_bancaria,
                tipo_movimiento=movement_type,
                monto=movement_amount,
                fecha_pago=movement_date,  # type: ignore[arg-type]
                concepto_bancario=movement.get("concepto_bancario"),
                numero_referencia=movement.get("numero_referencia"),
                folio_bancario=movement.get("folio_bancario"),
                saldo_resultante=movement.get("saldo_resultante"),
                hash_movimiento=hash_movimiento,
                estatus_conciliacion="EN_ESPERA",
                metadata=movement_metadata,
            )
        except IntegrityError:
            duplicados += 1
            if len(duplicados_resumen) < 20:
                duplicados_resumen.append(
                    {
                        "fecha_pago": movement_date.isoformat(),
                        "monto": decimal_to_float(movement_amount),
                        "tipo_movimiento": movement_type,
                        "numero_referencia": movement.get("numero_referencia"),
                        "concepto_bancario": movement.get("concepto_bancario"),
                        "saldo_resultante": decimal_to_float(movement_balance),
                    }
                )
            continue
        if hash_movimiento:
            existing_hashes.add(hash_movimiento)
        movimientos_creados.append(transaction_item)
        if movement_type == "INGRESO":
            total_ingresos += movement_amount
        else:
            total_egresos += movement_amount
        if not attempt_auto_match:
            pendientes += 1
            continue

        match_result = auto_match_bank_transaction(transaction_item)
        if match_result["matched"]:
            conciliados += 1
        elif transaction_item.estatus_conciliacion == "NO_IDENTIFICADO":
            no_identificados += 1
        else:
            pendientes += 1

    if movimientos_creados:
        ordered_dates = sorted(item.fecha_pago for item in movimientos_creados)
        carga.fecha_desde = fecha_desde or ordered_dates[0]
        carga.fecha_hasta = fecha_hasta or ordered_dates[-1]
    saldo_calculado = None
    if saldo_inicial is not None:
        saldo_calculado = clamp_money(saldo_inicial) + total_ingresos - total_egresos

    carga.registros_detectados = len(movimientos)
    carga.registros_conciliados = conciliados
    carga.registros_pendientes = pendientes
    carga.registros_no_identificados = no_identificados
    carga.registros_duplicados = duplicados
    carga.total_ingresos = total_ingresos
    carga.total_egresos = total_egresos
    carga.saldo_calculado = saldo_calculado
    if saldo_inicial is not None and saldo_final is not None and saldo_calculado is not None:
        carga.estatus_cuadre = (
            "CUADRADO"
            if saldo_calculado == clamp_money(saldo_final)
            else "CON_DIFERENCIA"
        )
    else:
        carga.estatus_cuadre = "SIN_SALDO"
    carga.estatus_procesamiento = (
        "COMPLETADO_CON_ERRORES" if no_identificados else "COMPLETADO"
    )
    carga.metadata = {
        "duplicados_detectados": duplicados_resumen,
        "movimientos_creados": len(movimientos_creados),
        "auto_match_aplicado": attempt_auto_match,
    }
    carga.save(
        update_fields=[
            "fecha_desde",
            "fecha_hasta",
            "registros_detectados",
            "registros_conciliados",
            "registros_pendientes",
            "registros_no_identificados",
            "registros_duplicados",
            "total_ingresos",
            "total_egresos",
            "saldo_calculado",
            "estatus_cuadre",
            "estatus_procesamiento",
            "metadata",
        ]
    )
    return {
        "carga_id": carga.id,
        "registros_detectados": carga.registros_detectados,
        "registros_conciliados": carga.registros_conciliados,
        "registros_pendientes": carga.registros_pendientes,
        "registros_no_identificados": carga.registros_no_identificados,
        "registros_duplicados": carga.registros_duplicados,
        "estatus_cuadre": carga.estatus_cuadre,
        "saldo_calculado": decimal_to_float(carga.saldo_calculado),
    }


@transaction.atomic
def register_payment_for_entity(
    entidad: EntidadNegocio,
    *,
    monto: Decimal,
    fecha_pago: date,
    metodo: str,
    referencia: str = "",
    notas: str = "",
    cliente_id: int | None = None,
    cuenta_id: int | None = None,
    canal_origen: str = "MANUAL",
    evidencia_id: int | None = None,
    evento_financiero_id: int | None = None,
    transaccion_relacionada: Transaccion | None = None,
    validar_automaticamente: bool = False,
    solo_cuenta_prioritaria: bool = False,
    cuenta_prioritaria_obj: CuentaPorCobrar | None = None,
    cuentas_abiertas_obj: Sequence[CuentaPorCobrar] | None = None,
    refresh_evidence: bool = True,
    evidencia_obj=None,
) -> dict[str, object]:
    restante = clamp_money(monto)
    aplicaciones: list[dict[str, object]] = []
    cuenta_prioritaria = None
    evidencia = (
        evidencia_obj
        if evidencia_obj and evidencia_obj.id == evidencia_id
        else resolve_evidence(evidencia_id)
    )
    auto_validated_payment = bool(validar_automaticamente and transaccion_relacionada)
    starts_validated = payment_starts_validated(metodo, canal_origen)
    initial_status = "VALIDADO" if auto_validated_payment or starts_validated else "APLICADO"
    validation_timestamp = timezone.now() if initial_status == "VALIDADO" else None
    validation_notes = None
    if auto_validated_payment:
        validation_notes = "Validado automaticamente desde conciliacion bancaria."
    elif starts_validated:
        validation_notes = "Validado automaticamente por origen del pago."
    linked_receivable: CuentaPorCobrar | None = None

    if restante <= 0:
        return {"aplicaciones": aplicaciones, "saldo_a_favor": 0.0}

    closed_receivable_statuses = {"CONCILIADO", "CANCELADO", "INCOBRABLE"}
    cuentas_abiertas_queryset = None
    cuentas_abiertas_cache: list[CuentaPorCobrar] | None = None

    def get_receivable_entity_id(cuenta: CuentaPorCobrar) -> int | None:
        if cuenta.entidad_relacionada_id:
            return cuenta.entidad_relacionada_id
        cuenta_cliente = getattr(cuenta, "cliente_relacionado", None)
        return cuenta_cliente.entidad_relacionada_id if cuenta_cliente else None

    def receivable_matches_scope(cuenta: CuentaPorCobrar) -> bool:
        return (
            cuenta.estatus_adeudo not in closed_receivable_statuses
            and get_receivable_entity_id(cuenta) == entidad.id
            and (not cliente_id or cuenta.cliente_relacionado_id == cliente_id)
        )

    def get_cuentas_abiertas_queryset():
        nonlocal cuentas_abiertas_queryset
        if cuentas_abiertas_queryset is None:
            cuentas_abiertas_queryset = get_open_cxc_queryset(entidad, cliente_id)
        return cuentas_abiertas_queryset

    def get_ordered_cuentas_abiertas() -> list[CuentaPorCobrar]:
        nonlocal cuentas_abiertas_cache
        if cuentas_abiertas_cache is None:
            if cuentas_abiertas_obj is not None:
                cuentas_abiertas_cache = sorted(
                    (
                        cuenta
                        for cuenta in cuentas_abiertas_obj
                        if receivable_matches_scope(cuenta)
                    ),
                    key=lambda cuenta: (cuenta.fecha_vencimiento, cuenta.id),
                )
            else:
                cuentas_abiertas_cache = list(
                    get_cuentas_abiertas_queryset().order_by("fecha_vencimiento", "id")
                )
        return cuentas_abiertas_cache

    def find_open_receivable(cuenta_id: int) -> CuentaPorCobrar | None:
        if cuentas_abiertas_obj is not None:
            return next(
                (
                    cuenta
                    for cuenta in get_ordered_cuentas_abiertas()
                    if cuenta.id == cuenta_id
                ),
                None,
            )
        return get_cuentas_abiertas_queryset().filter(id=cuenta_id).first()

    if cuenta_id:
        if (
            cuenta_prioritaria_obj
            and cuenta_prioritaria_obj.id == cuenta_id
            and receivable_matches_scope(cuenta_prioritaria_obj)
        ):
            cuenta_prioritaria = cuenta_prioritaria_obj
        else:
            cuenta_prioritaria = find_open_receivable(cuenta_id)
        if not cuenta_prioritaria:
            raise ValueError("La cuenta por cobrar seleccionada no esta disponible para pago.")

    if (
        not cuenta_prioritaria
        and cliente_id
        and resolve_payment_application_mode(entidad) == "SALDO_A_FAVOR"
    ):
        saldo_cliente = get_or_create_saldo_cliente(cliente_id, entidad)
        saldo_cliente.saldo_a_favor = clamp_money(saldo_cliente.saldo_a_favor) + restante
        saldo_cliente.save(update_fields=["saldo_a_favor", "fecha_actualizacion"])
        return {
            "aplicaciones": aplicaciones,
            "saldo_a_favor": decimal_to_float(restante),
        }

    ordered_accounts: list[CuentaPorCobrar] = []
    priority_covers_payment = False
    if cuenta_prioritaria:
        ordered_accounts.append(cuenta_prioritaria)
        priority_covers_payment = clamp_money(cuenta_prioritaria.saldo_pendiente) >= restante
    if not (
        cuenta_prioritaria
        and (solo_cuenta_prioritaria or priority_covers_payment)
    ):
        for cuenta in get_ordered_cuentas_abiertas():
            if cuenta_prioritaria and cuenta.id == cuenta_prioritaria.id:
                continue
            ordered_accounts.append(cuenta)

    for cuenta in ordered_accounts:
        if restante <= 0:
            break

        saldo = cuenta.saldo_pendiente
        if saldo <= 0:
            continue

        aplicado = min(restante, saldo)
        payment = PagoCuentaPorCobrar.objects.create(
            cuenta_por_cobrar=cuenta,
            evento_financiero_relacionado_id=evento_financiero_id,
            transaccion_relacionada=transaccion_relacionada,
            monto=aplicado,
            fecha_pago=fecha_pago,
            metodo=metodo,
            canal_origen=canal_origen,
            estatus_validacion=initial_status,
            fecha_validacion=validation_timestamp,
            referencia=referencia or None,
            notas=notas or None,
            notas_validacion=validation_notes,
            evidencia_pago_relacionada=evidencia,
        )
        attach_live_payment_to_transaction_snapshot(
            transaccion_relacionada,
            attr_name="_pagos_cxc_vivos",
            payment=payment,
        )
        cuenta.monto_pagado = clamp_money(cuenta.monto_pagado) + aplicado
        cuenta.estatus_adeudo = cuenta.recalcular_estatus(
            pagos_pendientes_validacion=(
                True if initial_status == "APLICADO" else None
            )
        )
        cuenta.save(update_fields=["monto_pagado", "estatus_adeudo"])
        payment_started_validated = initial_status == "VALIDADO"
        if auto_validated_payment:
            linked_receivable = cuenta
        elif validar_automaticamente and transaccion_relacionada:
            validate_receivable_payment(
                payment,
                transaction_item=transaccion_relacionada,
                notes="Validado automaticamente desde conciliacion bancaria.",
                update_transaction_status=False,
            )
        if refresh_evidence and (not validar_automaticamente or payment_started_validated):
            refresh_evidence_status(payment.evidencia_pago_relacionada_id)

        restante -= aplicado
        aplicaciones.append(
            {
                "pago_id": payment.id,
                "cuenta_id": cuenta.id,
                "cliente_id": cuenta.cliente_relacionado_id,
                "cliente_nombre": (
                    cuenta.cliente_relacionado.razon_social
                    or cuenta.cliente_relacionado.nombre_comercial
                    or "Sin nombre"
                ),
                "concepto": cuenta.concepto,
                "monto_aplicado": decimal_to_float(aplicado),
                "saldo_restante_cuenta": decimal_to_float(cuenta.saldo_pendiente),
                "estatus_validacion": payment.estatus_validacion,
            }
        )

    saldo_a_favor = Decimal("0")
    if restante > 0 and cliente_id:
        saldo_cliente = get_or_create_saldo_cliente(cliente_id, entidad)
        saldo_cliente.saldo_a_favor = clamp_money(saldo_cliente.saldo_a_favor) + restante
        saldo_cliente.save(update_fields=["saldo_a_favor", "fecha_actualizacion"])
        if transaccion_relacionada:
            register_transaction_credit(
                transaccion_relacionada,
                cliente_id=cliente_id,
                saldo_aplicado=restante,
            )
        saldo_a_favor = restante
        restante = Decimal("0")

    if transaccion_relacionada:
        extra_update_fields = []
        if (
            linked_receivable
            and transaccion_relacionada.cuenta_por_cobrar_relacionada_id
            != linked_receivable.id
        ):
            transaccion_relacionada.cuenta_por_cobrar_relacionada = linked_receivable
            extra_update_fields.append("cuenta_por_cobrar_relacionada")
        update_transaction_reconciliation_status(
            transaccion_relacionada,
            extra_update_fields=extra_update_fields,
        )

    return {
        "aplicaciones": aplicaciones,
        "saldo_a_favor": decimal_to_float(saldo_a_favor),
    }


@transaction.atomic
def generate_payables_for_entity(
    entidad: EntidadNegocio,
    *,
    through_date: date | None = None,
) -> dict[str, int]:
    today = through_date or timezone.localdate()
    totals = {"creados": 0, "existentes": 0}
    programaciones = ProgramacionCuentaPorPagar.objects.filter(
        entidad_relacionada=entidad,
        activo=True,
    ).order_by("id")

    for programacion in programaciones:
        for cycle_start, cycle_end, due_date in build_programacion_cycles(programacion, today):
            referencia = cxp_reference(programacion.id, cycle_start)
            _, created = CuentaPorPagar.objects.get_or_create(
                referencia_unica=referencia,
                defaults={
                    "entidad_relacionada": entidad,
                    "programacion_relacionada": programacion,
                    "proveedor_nombre": programacion.proveedor_nombre,
                    "banco_pago": programacion.banco_pago,
                    "cuenta_pago": programacion.cuenta_pago,
                    "clabe_pago": programacion.clabe_pago,
                    "prioridad": programacion.prioridad,
                    "categoria": programacion.categoria,
                    "naturaleza": programacion.naturaleza,
                    "concepto": (
                        f"{programacion.nombre} | "
                        f"{cycle_start.isoformat()} al {cycle_end.isoformat()}"
                    ),
                    "periodicidad": programacion.periodicidad,
                    "tipo_registro": "PROGRAMADO",
                    "fecha_periodo_inicio": cycle_start,
                    "fecha_periodo_fin": cycle_end,
                    "fecha_programada": cycle_start,
                    "fecha_emision": cycle_start,
                    "fecha_vencimiento": due_date,
                    "monto_proyectado": clamp_money(programacion.monto_base),
                    "dias_gracia": programacion.dias_gracia,
                    "genera_recargo": programacion.genera_recargo,
                    "estatus": "PENDIENTE",
                    "observaciones": programacion.observaciones,
                },
            )
            if created:
                totals["creados"] += 1
            else:
                totals["existentes"] += 1

    return totals


@transaction.atomic
def register_payment_for_payable(
    cuenta: CuentaPorPagar,
    *,
    monto: Decimal,
    fecha_pago: date,
    metodo: str,
    referencia: str = "",
    notas: str = "",
    canal_origen: str = "MANUAL",
    evidencia_id: int | None = None,
    evento_financiero_id: int | None = None,
    transaccion_relacionada: Transaccion | None = None,
    validar_automaticamente: bool = False,
    refresh_evidence: bool = True,
    evidencia_obj=None,
) -> dict[str, float]:
    aplicado = min(clamp_money(monto), cuenta.saldo_pendiente)
    if aplicado <= 0:
        return {
            "monto_aplicado": 0.0,
            "saldo_restante": decimal_to_float(cuenta.saldo_pendiente),
        }

    evidencia = (
        evidencia_obj
        if evidencia_obj and evidencia_obj.id == evidencia_id
        else resolve_evidence(evidencia_id)
    )
    auto_validated_payment = bool(validar_automaticamente and transaccion_relacionada)
    starts_validated = payment_starts_validated(metodo, canal_origen)
    initial_status = "VALIDADO" if auto_validated_payment or starts_validated else "APLICADO"
    validation_timestamp = timezone.now() if initial_status == "VALIDADO" else None
    validation_notes = None
    if auto_validated_payment:
        validation_notes = "Validado automaticamente desde conciliacion bancaria."
    elif starts_validated:
        validation_notes = "Validado automaticamente por origen del pago."
    payment = PagoCuentaPorPagar.objects.create(
        cuenta_por_pagar=cuenta,
        evento_financiero_relacionado_id=evento_financiero_id,
        transaccion_relacionada=transaccion_relacionada,
        monto=aplicado,
        fecha_pago=fecha_pago,
        metodo=metodo,
        canal_origen=canal_origen,
        estatus_validacion=initial_status,
        fecha_validacion=validation_timestamp,
        referencia=referencia or None,
        notas=notas or None,
        notas_validacion=validation_notes,
        evidencia_pago_relacionada=evidencia,
    )
    attach_live_payment_to_transaction_snapshot(
        transaccion_relacionada,
        attr_name="_pagos_cxp_vivos",
        payment=payment,
    )
    cuenta.monto_pagado = clamp_money(cuenta.monto_pagado) + aplicado
    cuenta.estatus = cuenta.recalcular_estatus(
        pagos_pendientes_validacion=True if initial_status == "APLICADO" else None
    )
    cuenta.save(update_fields=["monto_pagado", "estatus"])
    payment_started_validated = initial_status == "VALIDADO"
    if not auto_validated_payment and validar_automaticamente and transaccion_relacionada:
        validate_payable_payment(
            payment,
            transaction_item=transaccion_relacionada,
            notes="Validado automaticamente desde conciliacion bancaria.",
            update_transaction_status=False,
        )
    if refresh_evidence and (not validar_automaticamente or payment_started_validated):
        refresh_evidence_status(payment.evidencia_pago_relacionada_id)
    if transaccion_relacionada:
        extra_update_fields = []
        if transaccion_relacionada.cuenta_por_pagar_relacionada_id != cuenta.id:
            transaccion_relacionada.cuenta_por_pagar_relacionada = cuenta
            extra_update_fields.append("cuenta_por_pagar_relacionada")
        update_transaction_reconciliation_status(
            transaccion_relacionada,
            extra_update_fields=extra_update_fields,
        )
    return {
        "pago_id": payment.id,
        "monto_aplicado": decimal_to_float(aplicado),
        "saldo_restante": decimal_to_float(cuenta.saldo_pendiente),
    }


def score_text_overlap(base_tokens: set[str], text: str) -> int:
    if not base_tokens:
        return 0
    haystack = normalize_reference_token(text)
    return sum(80 for token in base_tokens if token and token in haystack)


def build_transaction_search_tokens(transaction_item: Transaccion) -> set[str]:
    tokens = set()
    for source in (
        transaction_item.numero_referencia,
        transaction_item.concepto_bancario,
        transaction_item.folio_bancario,
    ):
        normalized = normalize_reference_token(source)
        if normalized:
            tokens.add(normalized)
    return tokens


def build_transaction_match_text(transaction_item: Transaccion) -> str:
    return normalize_reference_token(
        " ".join(
            [
                transaction_item.numero_referencia or "",
                transaction_item.concepto_bancario or "",
                transaction_item.folio_bancario or "",
            ]
        )
    )


def text_contains_meaningful_token(text: str, token: str, *, min_length: int = 4) -> bool:
    return len(token) >= min_length and (token in text or text in token)


def score_orderless_words(
    transaction_words: set[str],
    label: str,
    value: str | None,
    *,
    minimum_matches: int = 2,
) -> tuple[int, str | None]:
    candidate_words = meaningful_match_words(value)
    if not candidate_words:
        return 0, None
    matched = transaction_words & candidate_words
    if not matched:
        return 0, None

    required_matches = minimum_matches
    if len(candidate_words) == 1:
        required_matches = 1 if len(next(iter(candidate_words))) >= 5 else 2
    if len(matched) < required_matches:
        return 0, None

    ratio = len(matched) / len(candidate_words)
    if len(candidate_words) >= 4 and ratio < 0.5:
        return 0, None
    if len(candidate_words) <= 3 and len(matched) < len(candidate_words):
        return 0, None

    score = 120 + (35 * len(matched))
    if ratio >= 0.75:
        score += 40
    return score, f"Palabras de {label} coinciden sin depender del orden."


def score_account_digits(transaction_text: str, label: str, value: str | None) -> tuple[int, str | None]:
    digits = extract_digits(value)
    if len(digits) < 4:
        return 0, None
    if len(digits) >= 12 and digits in transaction_text:
        return 520, f"{label} completa detectada en el movimiento."
    if len(digits) >= 8 and digits in transaction_text:
        return 430, f"{label} detectada en el movimiento."
    if len(digits) >= 8 and digits[-6:] in transaction_text:
        return 170, f"Ultimos 6 digitos de {label} detectados."
    if len(digits) >= 6 and digits[-4:] in transaction_text:
        return 70, f"Ultimos 4 digitos de {label} detectados."
    return 0, None


def select_high_confidence_candidate(scored: list[tuple[int, object, list[str]]]) -> object | None:
    strong = [item for item in scored if item[0] >= 420]
    if len(strong) == 1:
        return strong[0][1]
    if len(strong) > 1 and (strong[0][0] - strong[1][0]) >= 180:
        return strong[0][1]
    return None


def resolve_text_entity_candidates(
    transaction_item: Transaccion,
    *,
    allowed_entity_ids: list[int],
) -> list[EntidadNegocio]:
    transaction_text = build_transaction_match_text(transaction_item)
    if not transaction_text:
        return []

    matches: list[EntidadNegocio] = []
    for entity in EntidadNegocio.objects.filter(id__in=allowed_entity_ids).order_by("id"):
        entity_tokens = {
            normalize_reference_token(entity.nombre_comercial),
            normalize_reference_token(entity.ciudad),
            normalize_reference_token(entity.rfc),
        }
        if any(text_contains_meaningful_token(transaction_text, token) for token in entity_tokens):
            matches.append(entity)
    return matches


def infer_transaction_entity(transaction_item: Transaccion) -> EntidadNegocio | None:
    if transaction_item.cuenta_bancaria_relacionada_id and transaction_item.cuenta_bancaria_relacionada.entidad_relacionada_id:
        return transaction_item.cuenta_bancaria_relacionada.entidad_relacionada
    if transaction_item.cuenta_por_cobrar_relacionada_id and transaction_item.cuenta_por_cobrar_relacionada.entidad_relacionada_id:
        return transaction_item.cuenta_por_cobrar_relacionada.entidad_relacionada
    if transaction_item.cuenta_por_pagar_relacionada_id:
        return transaction_item.cuenta_por_pagar_relacionada.entidad_relacionada
    if transaction_item.evento_relacionado_id and transaction_item.evento_relacionado.entidad_relacionada_id:
        return transaction_item.evento_relacionado.entidad_relacionada
    return None


def score_receivable_direct_match(transaction_item: Transaccion, cuenta: CuentaPorCobrar) -> tuple[int, list[str]]:
    text = build_transaction_match_text(transaction_item)
    words = meaningful_match_words(
        " ".join(
            [
                transaction_item.numero_referencia or "",
                transaction_item.concepto_bancario or "",
                transaction_item.folio_bancario or "",
            ]
        )
    )
    reasons: list[str] = []
    score = 0
    if clamp_money(cuenta.saldo_pendiente) == clamp_money(transaction_item.monto):
        score += 300
        reasons.append("Monto exacto contra saldo pendiente.")

    entity = cuenta.entidad_relacionada or cuenta.cliente_relacionado.entidad_relacionada
    tokens = [
        cuenta.referencia_unica,
        cuenta.cliente_relacionado.razon_social,
        cuenta.cliente_relacionado.nombre_comercial,
        cuenta.cliente_relacionado.identificador,
        cuenta.cliente_relacionado.rfc,
        cuenta.cliente_relacionado.telefono,
        cuenta.concepto,
        entity.nombre_comercial if entity else "",
    ]
    for token_value in tokens:
        token = normalize_reference_token(token_value)
        if text_contains_meaningful_token(text, token):
            score += 140 if len(token) >= 8 else 80
            reasons.append(f"Texto coincide con '{token_value}'.")

    ordered_name_candidates = [
        ("cliente", cuenta.cliente_relacionado.razon_social),
        ("cliente", cuenta.cliente_relacionado.nombre_comercial),
    ]
    for label, value in ordered_name_candidates:
        word_score, reason = score_orderless_words(words, label, value)
        if word_score:
            score += word_score
            if reason:
                reasons.append(reason)

    if cuenta.fecha_vencimiento:
        distance = abs((cuenta.fecha_vencimiento - transaction_item.fecha_pago).days)
        if distance <= 45:
            score += max(0, 45 - distance)
            reasons.append("Fecha cercana al vencimiento.")
    return score, reasons


def score_payable_direct_match(transaction_item: Transaccion, cuenta: CuentaPorPagar) -> tuple[int, list[str]]:
    text = build_transaction_match_text(transaction_item)
    words = meaningful_match_words(
        " ".join(
            [
                transaction_item.numero_referencia or "",
                transaction_item.concepto_bancario or "",
                transaction_item.folio_bancario or "",
            ]
        )
    )
    reasons: list[str] = []
    score = 0
    if clamp_money(cuenta.saldo_pendiente) == clamp_money(transaction_item.monto):
        score += 300
        reasons.append("Monto exacto contra saldo pendiente.")

    tokens = [
        cuenta.referencia_unica,
        cuenta.proveedor_nombre,
        cuenta.concepto,
        cuenta.categoria,
        cuenta.banco_pago,
        cuenta.cuenta_pago,
        cuenta.clabe_pago,
        cuenta.entidad_relacionada.nombre_comercial,
    ]
    for token_value in tokens:
        token = normalize_reference_token(token_value)
        if text_contains_meaningful_token(text, token):
            score += 140 if len(token) >= 8 else 80
            reasons.append(f"Texto coincide con '{token_value}'.")

    for label, value in [
        ("proveedor", cuenta.proveedor_nombre),
        ("concepto", cuenta.concepto),
        ("entidad", cuenta.entidad_relacionada.nombre_comercial),
    ]:
        word_score, reason = score_orderless_words(words, label, value)
        if word_score:
            score += word_score
            if reason:
                reasons.append(reason)
    for label, value in [("cuenta de pago", cuenta.cuenta_pago), ("CLABE", cuenta.clabe_pago)]:
        digit_score, reason = score_account_digits(text, label, value)
        if digit_score:
            score += digit_score
            if reason:
                reasons.append(reason)

    if cuenta.fecha_vencimiento:
        distance = abs((cuenta.fecha_vencimiento - transaction_item.fecha_pago).days)
        if distance <= 45:
            score += max(0, 45 - distance)
            reasons.append("Fecha cercana al vencimiento.")
    return score, reasons


def receivable_candidate_scope_filter(allowed_entity_ids: list[int]) -> Q:
    return Q(entidad_relacionada_id__in=allowed_entity_ids) | Q(
        entidad_relacionada__isnull=True,
        cliente_relacionado__entidad_relacionada_id__in=allowed_entity_ids,
    )


def get_receivable_effective_entity_id(cuenta: CuentaPorCobrar) -> int | None:
    if cuenta.entidad_relacionada_id:
        return cuenta.entidad_relacionada_id
    cliente = getattr(cuenta, "cliente_relacionado", None)
    return cliente.entidad_relacionada_id if cliente else None


def list_receivable_candidates_for_transaction(
    transaction_item: Transaccion,
    *,
    limit: int = 8,
    allowed_entity_ids: list[int] | None = None,
    candidate_accounts: Sequence[CuentaPorCobrar] | None = None,
) -> list[dict]:
    entidad = infer_transaction_entity(transaction_item)
    if allowed_entity_ids is not None:
        if not allowed_entity_ids:
            return []
        if entidad and entidad.id not in allowed_entity_ids:
            return []

    if candidate_accounts is not None:
        source_accounts = [
            cuenta
            for cuenta in candidate_accounts
            if (
                (not entidad or get_receivable_effective_entity_id(cuenta) == entidad.id)
                and (
                    allowed_entity_ids is None
                    or get_receivable_effective_entity_id(cuenta) in allowed_entity_ids
                )
            )
        ][:120]
    else:
        queryset = (
            get_open_cxc_queryset(entidad)  # type: ignore[arg-type]
            if entidad
            else CuentaPorCobrar.objects.exclude(
                estatus_adeudo__in=["CONCILIADO", "CANCELADO", "INCOBRABLE"]
            ).select_related(
                "entidad_relacionada",
                "cliente_relacionado",
                "cliente_relacionado__entidad_relacionada",
            )
        )
        if allowed_entity_ids is not None and not entidad:
            queryset = queryset.filter(receivable_candidate_scope_filter(allowed_entity_ids))
        source_accounts = list(queryset.order_by("fecha_vencimiento", "id")[:120])

    tokens = build_transaction_search_tokens(transaction_item)
    candidates: list[tuple[int, CuentaPorCobrar, list[str]]] = []
    for cuenta in source_accounts:
        score = 0
        reasons: list[str] = []
        amount_distance = abs(float(cuenta.saldo_pendiente) - float(transaction_item.monto))
        score += max(
            0,
            120 - int(amount_distance),
        )
        if clamp_money(cuenta.saldo_pendiente) == clamp_money(transaction_item.monto):
            reasons.append("Monto exacto contra saldo pendiente.")
        elif amount_distance <= 500:
            reasons.append("Monto cercano al movimiento bancario.")

        date_distance = abs((cuenta.fecha_vencimiento - transaction_item.fecha_pago).days)
        score += max(0, 30 - date_distance)
        if date_distance <= 30:
            reasons.append("Fecha cercana al vencimiento.")

        text_score = score_text_overlap(
            tokens,
            " ".join(
                [
                    cuenta.concepto or "",
                    cuenta.cliente_relacionado.razon_social or "",
                    cuenta.cliente_relacionado.nombre_comercial or "",
                ]
            ),
        )
        score += text_score
        if text_score > 0:
            reasons.append("Referencia o concepto coincide con datos de la CxC.")
        direct_score, direct_reasons = score_receivable_direct_match(transaction_item, cuenta)
        score += direct_score
        reasons.extend(reason for reason in direct_reasons if reason not in reasons)
        if score > 0:
            candidates.append((score, cuenta, reasons))
    candidates.sort(key=lambda item: (-item[0], item[1].fecha_vencimiento, item[1].id))
    return [
        {
            **build_reconciliation_candidate_assistance(
                score=score,
                amount_difference=abs(
                    clamp_money(cuenta.saldo_pendiente) - clamp_money(transaction_item.monto)
                ),
                reasons=reasons,
            ),
            "id": cuenta.id,
            "entidad_id": cuenta.entidad_relacionada_id,
            "entidad_nombre": cuenta.entidad_relacionada.nombre_comercial
            if cuenta.entidad_relacionada_id
            else (
                cuenta.cliente_relacionado.entidad_relacionada.nombre_comercial
                if cuenta.cliente_relacionado.entidad_relacionada_id
                else None
            ),
            "cliente_id": cuenta.cliente_relacionado_id,
            "cliente_nombre": cuenta.cliente_relacionado.razon_social
            or cuenta.cliente_relacionado.nombre_comercial,
            "concepto": cuenta.concepto,
            "fecha_vencimiento": cuenta.fecha_vencimiento,
            "saldo_pendiente": decimal_to_float(cuenta.saldo_pendiente),
            "score": score,
            "reasons": reasons,
        }
        for score, cuenta, reasons in candidates[:limit]
    ]


def list_payable_candidates_for_transaction(
    transaction_item: Transaccion,
    *,
    limit: int = 8,
    allowed_entity_ids: list[int] | None = None,
    candidate_accounts: Sequence[CuentaPorPagar] | None = None,
) -> list[dict]:
    entidad = infer_transaction_entity(transaction_item)
    if allowed_entity_ids is not None:
        if not allowed_entity_ids:
            return []
        if entidad and entidad.id not in allowed_entity_ids:
            return []

    if candidate_accounts is not None:
        source_accounts = [
            cuenta
            for cuenta in candidate_accounts
            if (
                (not entidad or cuenta.entidad_relacionada_id == entidad.id)
                and (
                    allowed_entity_ids is None
                    or cuenta.entidad_relacionada_id in allowed_entity_ids
                )
            )
        ][:120]
    else:
        queryset = (
            get_open_cxp_queryset(entidad)  # type: ignore[arg-type]
            if entidad
            else CuentaPorPagar.objects.exclude(
                estatus__in=["PAGADO", "CANCELADO"]
            ).select_related("entidad_relacionada")
        )
        if allowed_entity_ids is not None and not entidad:
            queryset = queryset.filter(entidad_relacionada_id__in=allowed_entity_ids)
        source_accounts = list(queryset.order_by("fecha_vencimiento", "id")[:120])

    tokens = build_transaction_search_tokens(transaction_item)
    candidates: list[tuple[int, CuentaPorPagar, list[str]]] = []
    for cuenta in source_accounts:
        score = 0
        reasons: list[str] = []
        amount_distance = abs(float(cuenta.saldo_pendiente) - float(transaction_item.monto))
        score += max(
            0,
            120 - int(amount_distance),
        )
        if clamp_money(cuenta.saldo_pendiente) == clamp_money(transaction_item.monto):
            reasons.append("Monto exacto contra saldo pendiente.")
        elif amount_distance <= 500:
            reasons.append("Monto cercano al movimiento bancario.")

        date_distance = abs((cuenta.fecha_vencimiento - transaction_item.fecha_pago).days)
        score += max(0, 30 - date_distance)
        if date_distance <= 30:
            reasons.append("Fecha cercana al vencimiento.")

        text_score = score_text_overlap(
            tokens,
            " ".join([cuenta.proveedor_nombre or "", cuenta.concepto or "", cuenta.categoria or ""]),
        )
        score += text_score
        if text_score > 0:
            reasons.append("Referencia o concepto coincide con datos de la CxP.")
        direct_score, direct_reasons = score_payable_direct_match(transaction_item, cuenta)
        score += direct_score
        reasons.extend(reason for reason in direct_reasons if reason not in reasons)
        if score > 0:
            candidates.append((score, cuenta, reasons))
    candidates.sort(key=lambda item: (-item[0], item[1].fecha_vencimiento, item[1].id))
    return [
        {
            **build_reconciliation_candidate_assistance(
                score=score,
                amount_difference=abs(
                    clamp_money(cuenta.saldo_pendiente) - clamp_money(transaction_item.monto)
                ),
                reasons=reasons,
            ),
            "id": cuenta.id,
            "entidad_id": cuenta.entidad_relacionada_id,
            "entidad_nombre": cuenta.entidad_relacionada.nombre_comercial,
            "proveedor_nombre": cuenta.proveedor_nombre,
            "categoria": cuenta.categoria,
            "concepto": cuenta.concepto,
            "fecha_vencimiento": cuenta.fecha_vencimiento,
            "saldo_pendiente": decimal_to_float(cuenta.saldo_pendiente),
            "score": score,
            "reasons": reasons,
        }
        for score, cuenta, reasons in candidates[:limit]
    ]


@transaction.atomic
def apply_bank_transaction_to_receivables(
    transaction_item: Transaccion,
    *,
    entidad_id: int | None = None,
    cliente_id: int | None = None,
    cuenta_id: int | None = None,
    cuenta_obj: CuentaPorCobrar | None = None,
    monto: Decimal | None = None,
    notas: str = "",
) -> dict[str, object]:
    if transaction_item.tipo_movimiento != "INGRESO":
        raise ValueError("Solo los ingresos pueden aplicarse a cuentas por cobrar.")
    if transaction_item.duplicado_de_id:
        raise ValueError("La transaccion esta marcada como duplicada y no puede aplicarse.")

    cuenta = None
    entidad = None
    resolved_cliente_id = cliente_id
    if cuenta_id:
        cuenta = cuenta_obj if cuenta_obj and cuenta_obj.id == cuenta_id else None
        if cuenta is None:
            cuenta = CuentaPorCobrar.objects.select_related(
                "cliente_relacionado",
                "entidad_relacionada",
                "cliente_relacionado__entidad_relacionada",
            ).filter(id=cuenta_id).first()
        if not cuenta:
            raise ValueError("La cuenta por cobrar seleccionada no existe.")
        entidad = cuenta.entidad_relacionada or cuenta.cliente_relacionado.entidad_relacionada
        resolved_cliente_id = cuenta.cliente_relacionado_id
    elif entidad_id:
        entidad = EntidadNegocio.objects.filter(id=entidad_id).first()
    else:
        entidad = infer_transaction_entity(transaction_item)

    if not entidad:
        raise ValueError("Selecciona una entidad para aplicar el deposito.")

    disponible = get_transaction_available_amount(transaction_item)
    if disponible <= 0:
        raise ValueError("La transaccion ya no tiene saldo disponible para aplicar.")

    monto_objetivo = min(disponible, clamp_money(monto) if monto is not None else disponible)
    if monto_objetivo <= 0:
        raise ValueError("El monto a aplicar debe ser mayor a cero.")

    resultado = register_payment_for_entity(
        entidad,
        monto=monto_objetivo,
        fecha_pago=transaction_item.fecha_pago,
        metodo="TRANSFERENCIA",
        referencia=transaction_item.numero_referencia or transaction_item.folio_bancario or "",
        notas=notas or "Aplicado desde conciliacion bancaria.",
        cliente_id=resolved_cliente_id,
        cuenta_id=cuenta_id,
        canal_origen="ESTADO_CUENTA",
        transaccion_relacionada=transaction_item,
        validar_automaticamente=True,
        solo_cuenta_prioritaria=bool(cuenta_id),
        cuenta_prioritaria_obj=cuenta,
    )
    if notas.strip():
        transaction_item.notas_conciliacion = notas.strip()
        transaction_item.save(update_fields=["notas_conciliacion"])
    return {
        **resultado,
        "estatus_conciliacion": transaction_item.estatus_conciliacion,
        "monto_aplicado_total": decimal_to_float(get_transaction_applied_amount(transaction_item)),
        "monto_disponible": decimal_to_float(get_transaction_available_amount(transaction_item)),
    }


@transaction.atomic
def apply_bank_transaction_to_payable(
    transaction_item: Transaccion,
    *,
    cuenta_id: int,
    cuenta_obj: CuentaPorPagar | None = None,
    monto: Decimal | None = None,
    notas: str = "",
) -> dict[str, object]:
    if transaction_item.tipo_movimiento != "EGRESO":
        raise ValueError("Solo los egresos pueden aplicarse a cuentas por pagar.")
    if transaction_item.duplicado_de_id:
        raise ValueError("La transaccion esta marcada como duplicada y no puede aplicarse.")

    cuenta = cuenta_obj if cuenta_obj and cuenta_obj.id == cuenta_id else None
    if cuenta is None:
        cuenta = CuentaPorPagar.objects.select_related("entidad_relacionada").filter(id=cuenta_id).first()
    if not cuenta:
        raise ValueError("La cuenta por pagar seleccionada no existe.")

    disponible = get_transaction_available_amount(transaction_item)
    if disponible <= 0:
        raise ValueError("La transaccion ya no tiene saldo disponible para aplicar.")

    monto_objetivo = min(disponible, clamp_money(monto) if monto is not None else disponible)
    if monto_objetivo <= 0:
        raise ValueError("El monto a aplicar debe ser mayor a cero.")

    resultado = register_payment_for_payable(
        cuenta,
        monto=monto_objetivo,
        fecha_pago=transaction_item.fecha_pago,
        metodo="TRANSFERENCIA",
        referencia=transaction_item.numero_referencia or transaction_item.folio_bancario or "",
        notas=notas or "Aplicado desde conciliacion bancaria.",
        canal_origen="ESTADO_CUENTA",
        transaccion_relacionada=transaction_item,
        validar_automaticamente=True,
    )
    if notas.strip():
        transaction_item.notas_conciliacion = notas.strip()
        transaction_item.save(update_fields=["notas_conciliacion"])
    return {
        **resultado,
        "estatus_conciliacion": transaction_item.estatus_conciliacion,
        "monto_aplicado_total": decimal_to_float(get_transaction_applied_amount(transaction_item)),
        "monto_disponible": decimal_to_float(get_transaction_available_amount(transaction_item)),
    }


def build_direct_match_response(
    *,
    status: str,
    scope: str,
    matched: bool,
    selected_id: int | None = None,
    reasons: list[str] | None = None,
    candidates: list[dict] | None = None,
    applied: dict | None = None,
) -> dict[str, object]:
    return {
        "status": status,
        "scope": scope,
        "matched": matched,
        "selected_id": selected_id,
        "reasons": reasons or [],
        "candidates": candidates or [],
        "applied": applied,
    }


def build_reconciliation_candidate_assistance(
    *,
    score: int,
    amount_difference: Decimal,
    reasons: list[str],
) -> dict[str, object]:
    signals = list(dict.fromkeys(reasons[:5]))
    warnings: list[str] = []
    next_steps: list[str] = []
    if amount_difference > 0:
        warnings.append(
            f"La diferencia de monto es {decimal_to_float(amount_difference)}; revisar si hay pago parcial, comision o saldo remanente."
        )
    if not reasons:
        warnings.append("No hay coincidencias de texto, referencia o fecha.")
    if score < 220:
        warnings.append("El score no alcanza el umbral recomendado para aplicar sin revision.")

    if score >= 320 and amount_difference == 0:
        next_steps = [
            "Confirmar que el cliente/proveedor y la referencia corresponden.",
            "Aplicar la sugerencia desde conciliacion bancaria.",
            "Validar que la transaccion quede sin saldo disponible.",
        ]
        recommended_action = "Aplicar si la referencia y el cliente/proveedor corresponden."
        return {
            "confidence_band": "ALTA",
            "amount_difference": decimal_to_float(amount_difference),
            "recommended_action": recommended_action,
            "review_required": False,
            "signals": signals,
            "warnings": warnings,
            "next_steps": next_steps,
            "apply_readiness": build_reconciliation_apply_readiness(
                confidence_band="ALTA",
                score=score,
                amount_difference=amount_difference,
                reasons=reasons,
                recommended_action=recommended_action,
                review_required=False,
            ),
        }
    if score >= 220 or amount_difference <= Decimal("500.00"):
        next_steps = [
            "Comparar referencia, fecha y saldo contra el estado de cuenta.",
            "Revisar si el monto corresponde a un pago parcial o agrupado.",
            "Aplicar solo despues de confirmar el cliente/proveedor correcto.",
        ]
        recommended_action = "Revisar referencia, fecha y saldo antes de aplicar."
        return {
            "confidence_band": "MEDIA",
            "amount_difference": decimal_to_float(amount_difference),
            "recommended_action": recommended_action,
            "review_required": True,
            "signals": signals,
            "warnings": warnings,
            "next_steps": next_steps,
            "apply_readiness": build_reconciliation_apply_readiness(
                confidence_band="MEDIA",
                score=score,
                amount_difference=amount_difference,
                reasons=reasons,
                recommended_action=recommended_action,
                review_required=True,
            ),
        }
    if reasons:
        action = "Usar solo como pista; faltan senales fuertes para aplicar."
    else:
        action = "Buscar manualmente por cliente, proveedor, referencia o monto."
    next_steps = [
        "Buscar manualmente por referencia, cliente/proveedor o monto.",
        "No aplicar automaticamente esta sugerencia.",
        "Marcar como no identificado si no hay evidencia suficiente.",
    ]
    return {
        "confidence_band": "BAJA",
        "amount_difference": decimal_to_float(amount_difference),
        "recommended_action": action,
        "review_required": True,
        "signals": signals,
        "warnings": warnings,
        "next_steps": next_steps,
        "apply_readiness": build_reconciliation_apply_readiness(
            confidence_band="BAJA",
            score=score,
            amount_difference=amount_difference,
            reasons=reasons,
            recommended_action=action,
            review_required=True,
        ),
    }


def build_reconciliation_apply_readiness(
    *,
    confidence_band: str,
    score: int,
    amount_difference: Decimal,
    reasons: list[str],
    recommended_action: str,
    review_required: bool,
) -> dict[str, object]:
    reason_preview = "; ".join(reasons[:3])
    amount_exact = amount_difference == 0
    if confidence_band == "ALTA" and amount_exact and not review_required:
        state = "LISTA"
        label = "Lista para aplicar"
        detail = "Monto exacto y senales suficientes para aplicar despues de validar visualmente la referencia."
        checklist = [
            "Referencia revisada contra el banco.",
            "Cliente/proveedor confirmado.",
            "Monto disponible igual al saldo sugerido.",
        ]
    elif confidence_band == "MEDIA":
        state = "REVISAR"
        label = "Requiere revision"
        detail = "Hay senales utiles, pero conviene confirmar el soporte antes de aplicar."
        checklist = [
            "Comparar fecha y referencia.",
            "Confirmar si hay pago parcial, agrupado o comision.",
            "Agregar una nota de aplicacion con el criterio usado.",
        ]
    else:
        state = "NO_APLICAR_DIRECTO"
        label = "No aplicar directo"
        detail = "La sugerencia debe usarse como pista y resolverse manualmente si no hay evidencia suficiente."
        checklist = [
            "Buscar por cliente/proveedor, referencia o monto.",
            "Abrir el movimiento antes de decidir.",
            "Marcar como no identificado si sigue sin soporte.",
        ]
    note_parts = [
        "Sugerencia aplicada desde conciliacion bancaria.",
        f"Estado asistido: {label}.",
        f"Score {score}.",
        f"Diferencia {decimal_to_float(amount_difference)}.",
        f"Criterio: {recommended_action}",
        f"Razones: {reason_preview}." if reason_preview else "",
    ]
    return {
        "state": state,
        "label": label,
        "detail": detail,
        "requires_manual_review": review_required,
        "score": score,
        "amount_difference": decimal_to_float(amount_difference),
        "checklist": checklist,
        "note_template": " ".join(part for part in note_parts if part).strip(),
    }


def serialize_direct_cxc_candidate(cuenta: CuentaPorCobrar, score: int, reasons: list[str]) -> dict:
    entity = cuenta.entidad_relacionada or cuenta.cliente_relacionado.entidad_relacionada
    amount_difference = Decimal("0")
    return {
        "id": cuenta.id,
        "scope": "CXC",
        "entidad_id": entity.id if entity else None,
        "entidad_nombre": entity.nombre_comercial if entity else None,
        "cliente_id": cuenta.cliente_relacionado_id,
        "cliente_nombre": cuenta.cliente_relacionado.razon_social
        or cuenta.cliente_relacionado.nombre_comercial,
        "concepto": cuenta.concepto,
        "fecha_vencimiento": cuenta.fecha_vencimiento.isoformat(),
        "saldo_pendiente": decimal_to_float(cuenta.saldo_pendiente),
        "score": score,
        "reasons": reasons,
        **build_reconciliation_candidate_assistance(
            score=score,
            amount_difference=amount_difference,
            reasons=reasons,
        ),
    }


def serialize_direct_cxp_candidate(cuenta: CuentaPorPagar, score: int, reasons: list[str]) -> dict:
    amount_difference = Decimal("0")
    return {
        "id": cuenta.id,
        "scope": "CXP",
        "entidad_id": cuenta.entidad_relacionada_id,
        "entidad_nombre": cuenta.entidad_relacionada.nombre_comercial,
        "proveedor_nombre": cuenta.proveedor_nombre,
        "categoria": cuenta.categoria,
        "concepto": cuenta.concepto,
        "fecha_vencimiento": cuenta.fecha_vencimiento.isoformat(),
        "saldo_pendiente": decimal_to_float(cuenta.saldo_pendiente),
        "score": score,
        "reasons": reasons,
        **build_reconciliation_candidate_assistance(
            score=score,
            amount_difference=amount_difference,
            reasons=reasons,
        ),
    }


def annotate_receivable_balance_match(queryset):
    money_field = DecimalField(max_digits=12, decimal_places=2)
    return queryset.annotate(
        saldo_pendiente_match=ExpressionWrapper(
            F("monto_total") - F("monto_pagado"),
            output_field=money_field,
        )
    )


def annotate_payable_balance_match(queryset):
    money_field = DecimalField(max_digits=12, decimal_places=2)
    return queryset.annotate(
        saldo_pendiente_match=ExpressionWrapper(
            Coalesce("monto_real", "monto_proyectado", output_field=money_field)
            - F("monto_pagado"),
            output_field=money_field,
        )
    )


def exact_receivable_balance_queryset(queryset, amount: Decimal):
    return annotate_receivable_balance_match(queryset).filter(
        saldo_pendiente_match=clamp_money(amount)
    )


def exact_payable_balance_queryset(queryset, amount: Decimal):
    return annotate_payable_balance_match(queryset).filter(
        saldo_pendiente_match=clamp_money(amount)
    )


def get_direct_context_receivables(
    candidate_context: dict[str, object],
    *,
    amount: Decimal,
    scoped_entity_ids: list[int],
    allowed_entity_ids: list[int],
) -> list[CuentaPorCobrar]:
    accounts = candidate_context.get("receivables_by_amount", {}).get(clamp_money(amount), [])
    entity_ids = set(scoped_entity_ids or allowed_entity_ids)
    return [
        cuenta
        for cuenta in accounts
        if get_receivable_effective_entity_id(cuenta) in entity_ids
    ][:1200]


def get_direct_context_payables(
    candidate_context: dict[str, object],
    *,
    amount: Decimal,
    scoped_entity_ids: list[int],
    allowed_entity_ids: list[int],
) -> list[CuentaPorPagar]:
    accounts = candidate_context.get("payables_by_amount", {}).get(clamp_money(amount), [])
    entity_ids = set(scoped_entity_ids or allowed_entity_ids)
    return [
        cuenta for cuenta in accounts if cuenta.entidad_relacionada_id in entity_ids
    ][:1200]


def remove_direct_context_account(
    candidate_context: dict[str, object] | None,
    *,
    scope: str,
    amount: Decimal,
    account_id: int,
) -> None:
    if candidate_context is None:
        return
    key = "receivables_by_amount" if scope == "CXC" else "payables_by_amount"
    accounts = candidate_context.get(key, {}).get(clamp_money(amount), [])
    if accounts:
        accounts[:] = [account for account in accounts if account.id != account_id]


@transaction.atomic
def direct_reconcile_bank_transaction(
    transaction_item: Transaccion,
    *,
    allowed_entity_ids: list[int],
    candidate_context: dict[str, object] | None = None,
) -> dict[str, object]:
    if transaction_item.duplicado_de_id:
        return build_direct_match_response(
            status="DUPLICADO",
            scope=transaction_item.tipo_movimiento,
            matched=False,
            reasons=["El movimiento esta marcado como duplicado."],
        )
    if transaction_item.estatus_conciliacion == "VALIDADO":
        return build_direct_match_response(
            status="YA_VALIDADO",
            scope=transaction_item.tipo_movimiento,
            matched=False,
            reasons=["El movimiento ya esta validado."],
        )

    available = get_transaction_available_amount(transaction_item)
    if available <= 0:
        update_transaction_reconciliation_status(transaction_item)
        return build_direct_match_response(
            status="SIN_SALDO_DISPONIBLE",
            scope=transaction_item.tipo_movimiento,
            matched=False,
            reasons=["El movimiento ya no tiene saldo disponible."],
        )

    scoped_entity_ids = []
    inferred_entity = infer_transaction_entity(transaction_item)
    if inferred_entity and inferred_entity.id in allowed_entity_ids:
        scoped_entity_ids = [inferred_entity.id]
    else:
        text_entities = resolve_text_entity_candidates(
            transaction_item,
            allowed_entity_ids=allowed_entity_ids,
        )
        if len(text_entities) == 1:
            scoped_entity_ids = [text_entities[0].id]

    if transaction_item.tipo_movimiento == "INGRESO":
        queryset = CuentaPorCobrar.objects.select_related(
            "entidad_relacionada",
            "cliente_relacionado",
            "cliente_relacionado__entidad_relacionada",
        ).filter(receivable_scope_filter_ids(allowed_entity_ids)).exclude(
            estatus_adeudo__in=["CONCILIADO", "CANCELADO", "INCOBRABLE"]
        )
        if scoped_entity_ids:
            queryset = queryset.filter(
                Q(entidad_relacionada_id__in=scoped_entity_ids)
                | Q(
                    entidad_relacionada__isnull=True,
                    cliente_relacionado__entidad_relacionada_id__in=scoped_entity_ids,
                )
            )
        if candidate_context is not None:
            exact_accounts = get_direct_context_receivables(
                candidate_context,
                amount=available,
                scoped_entity_ids=scoped_entity_ids,
                allowed_entity_ids=allowed_entity_ids,
            )
        else:
            exact_accounts = list(
                exact_receivable_balance_queryset(queryset, available).order_by(
                    "fecha_vencimiento",
                    "id",
                )[:1200]
            )
        scored = [
            (score, cuenta, reasons)
            for cuenta in exact_accounts
            for score, reasons in [score_receivable_direct_match(transaction_item, cuenta)]
        ]
        scored.sort(key=lambda item: (-item[0], item[1].fecha_vencimiento, item[1].id))
        candidates = [
            serialize_direct_cxc_candidate(cuenta, score, reasons)
            for score, cuenta, reasons in scored[:5]
        ]
        selected = select_high_confidence_candidate(scored)
        if selected is None and scoped_entity_ids and len(exact_accounts) == 1:
            selected = exact_accounts[0]
            selected_score, _, selected_reasons = scored[0]
            selected_reasons = selected_reasons + ["Unica CxC con monto exacto dentro de la entidad detectada."]
            scored[0] = (selected_score + 100, selected, selected_reasons)
            candidates = [
                serialize_direct_cxc_candidate(cuenta, score, reasons)
                for score, cuenta, reasons in scored[:5]
            ]
        if selected:
            applied = apply_bank_transaction_to_receivables(
                transaction_item,
                cuenta_id=selected.id,
                cuenta_obj=selected,
                monto=available,
                notas="Conciliado automaticamente por monto exacto y candidato unico.",
            )
            remove_direct_context_account(
                candidate_context,
                scope="CXC",
                amount=available,
                account_id=selected.id,
            )
            transaction_item.refresh_from_db()
            record_transaction_auto_match(
                transaction_item,
                scope="CXC_DIRECT",
                match_status="MATCHED",
                matched=True,
                confidence_score=scored[0][0] if scored else 0,
                confidence_band="ALTA",
                matched_id=selected.id,
                matched_type="CXC",
                reasons=scored[0][2] if scored else [],
                candidates=candidates,
            )
            return build_direct_match_response(
                status="MATCHED",
                scope="CXC",
                matched=True,
                selected_id=selected.id,
                reasons=scored[0][2] if scored else [],
                candidates=candidates,
                applied=applied,
            )
        status = "AMBIGUO" if len(exact_accounts) > 1 else "SIN_CANDIDATO"
        transaction_item.estatus_conciliacion = "EN_ESPERA" if status == "AMBIGUO" else "NO_IDENTIFICADO"
        transaction_item.save(update_fields=["estatus_conciliacion"])
        record_transaction_auto_match(
            transaction_item,
            scope="CXC_DIRECT",
            match_status=status,
            matched=False,
            confidence_score=scored[0][0] if scored else None,
            confidence_band="MEDIA" if status == "AMBIGUO" else "SIN_CANDIDATO",
            reasons=["Hay mas de una CxC con el mismo monto."] if status == "AMBIGUO" else ["No se encontro CxC exacta."],
            candidates=candidates,
        )
        return build_direct_match_response(
            status=status,
            scope="CXC",
            matched=False,
            reasons=["Hay mas de una CxC con el mismo monto."] if status == "AMBIGUO" else ["No se encontro CxC exacta."],
            candidates=candidates,
        )

    queryset = CuentaPorPagar.objects.select_related("entidad_relacionada").filter(
        entidad_relacionada_id__in=allowed_entity_ids
    ).exclude(estatus__in=["PAGADO", "CANCELADO"])
    if scoped_entity_ids:
        queryset = queryset.filter(entidad_relacionada_id__in=scoped_entity_ids)
    if candidate_context is not None:
        exact_accounts = get_direct_context_payables(
            candidate_context,
            amount=available,
            scoped_entity_ids=scoped_entity_ids,
            allowed_entity_ids=allowed_entity_ids,
        )
    else:
        exact_accounts = list(
            exact_payable_balance_queryset(queryset, available).order_by(
                "fecha_vencimiento",
                "id",
            )[:1200]
        )
    scored = [
        (score, cuenta, reasons)
        for cuenta in exact_accounts
        for score, reasons in [score_payable_direct_match(transaction_item, cuenta)]
    ]
    scored.sort(key=lambda item: (-item[0], item[1].fecha_vencimiento, item[1].id))
    candidates = [
        serialize_direct_cxp_candidate(cuenta, score, reasons)
        for score, cuenta, reasons in scored[:5]
    ]
    selected = select_high_confidence_candidate(scored)
    if selected is None and scoped_entity_ids and len(exact_accounts) == 1:
        selected = exact_accounts[0]
        selected_score, _, selected_reasons = scored[0]
        selected_reasons = selected_reasons + ["Unica CxP con monto exacto dentro de la entidad detectada."]
        scored[0] = (selected_score + 100, selected, selected_reasons)
        candidates = [
            serialize_direct_cxp_candidate(cuenta, score, reasons)
            for score, cuenta, reasons in scored[:5]
        ]
    if selected:
        applied = apply_bank_transaction_to_payable(
            transaction_item,
            cuenta_id=selected.id,
            cuenta_obj=selected,
            monto=available,
            notas="Conciliado automaticamente por monto exacto y candidato unico.",
        )
        remove_direct_context_account(
            candidate_context,
            scope="CXP",
            amount=available,
            account_id=selected.id,
        )
        transaction_item.refresh_from_db()
        record_transaction_auto_match(
            transaction_item,
            scope="CXP_DIRECT",
            match_status="MATCHED",
            matched=True,
            confidence_score=scored[0][0] if scored else 0,
            confidence_band="ALTA",
            matched_id=selected.id,
            matched_type="CXP",
            reasons=scored[0][2] if scored else [],
            candidates=candidates,
        )
        return build_direct_match_response(
            status="MATCHED",
            scope="CXP",
            matched=True,
            selected_id=selected.id,
            reasons=scored[0][2] if scored else [],
            candidates=candidates,
            applied=applied,
        )
    status = "AMBIGUO" if len(exact_accounts) > 1 else "SIN_CANDIDATO"
    transaction_item.estatus_conciliacion = "EN_ESPERA" if status == "AMBIGUO" else "NO_IDENTIFICADO"
    transaction_item.save(update_fields=["estatus_conciliacion"])
    record_transaction_auto_match(
        transaction_item,
        scope="CXP_DIRECT",
        match_status=status,
        matched=False,
        confidence_score=scored[0][0] if scored else None,
        confidence_band="MEDIA" if status == "AMBIGUO" else "SIN_CANDIDATO",
        reasons=["Hay mas de una CxP con el mismo monto."] if status == "AMBIGUO" else ["No se encontro CxP exacta."],
        candidates=candidates,
    )
    return build_direct_match_response(
        status=status,
        scope="CXP",
        matched=False,
        reasons=["Hay mas de una CxP con el mismo monto."] if status == "AMBIGUO" else ["No se encontro CxP exacta."],
        candidates=candidates,
    )


def receivable_scope_filter_ids(allowed_entity_ids: list[int]) -> Q:
    return Q(entidad_relacionada_id__in=allowed_entity_ids) | Q(
        entidad_relacionada__isnull=True,
        cliente_relacionado__entidad_relacionada_id__in=allowed_entity_ids,
    )


def build_direct_reconciliation_context(
    transactions: Sequence[Transaccion],
    *,
    allowed_entity_ids: list[int],
) -> dict[str, object]:
    ingreso_amounts: set[Decimal] = set()
    egreso_amounts: set[Decimal] = set()
    for transaction_item in transactions:
        amount = get_transaction_available_amount(transaction_item)
        if amount <= 0:
            continue
        if transaction_item.tipo_movimiento == "INGRESO":
            ingreso_amounts.add(clamp_money(amount))
        elif transaction_item.tipo_movimiento == "EGRESO":
            egreso_amounts.add(clamp_money(amount))

    receivables_by_amount: dict[Decimal, list[CuentaPorCobrar]] = {}
    if ingreso_amounts:
        queryset = (
            CuentaPorCobrar.objects.select_related(
                "entidad_relacionada",
                "cliente_relacionado",
                "cliente_relacionado__entidad_relacionada",
            )
            .filter(receivable_scope_filter_ids(allowed_entity_ids))
            .exclude(estatus_adeudo__in=["CONCILIADO", "CANCELADO", "INCOBRABLE"])
        )
        queryset = annotate_receivable_balance_match(queryset).filter(
            saldo_pendiente_match__in=ingreso_amounts
        )
        for cuenta in queryset.order_by("saldo_pendiente_match", "fecha_vencimiento", "id"):
            receivables_by_amount.setdefault(clamp_money(cuenta.saldo_pendiente), []).append(
                cuenta
            )

    payables_by_amount: dict[Decimal, list[CuentaPorPagar]] = {}
    if egreso_amounts:
        queryset = (
            CuentaPorPagar.objects.select_related("entidad_relacionada")
            .filter(entidad_relacionada_id__in=allowed_entity_ids)
            .exclude(estatus__in=["PAGADO", "CANCELADO"])
        )
        queryset = annotate_payable_balance_match(queryset).filter(
            saldo_pendiente_match__in=egreso_amounts
        )
        for cuenta in queryset.order_by("saldo_pendiente_match", "fecha_vencimiento", "id"):
            payables_by_amount.setdefault(clamp_money(cuenta.saldo_pendiente), []).append(
                cuenta
            )

    return {
        "receivables_by_amount": receivables_by_amount,
        "payables_by_amount": payables_by_amount,
    }


def auto_reconcile_pending_bank_transactions(
    *,
    allowed_entity_ids: list[int],
    cuenta_bancaria_id: int | None = None,
    carga_id: int | None = None,
    limit: int = 300,
) -> dict[str, object]:
    queryset = Transaccion.objects.select_related(
        "cuenta_bancaria_relacionada",
        "cuenta_bancaria_relacionada__entidad_relacionada",
        "cuenta_por_cobrar_relacionada",
        "cuenta_por_cobrar_relacionada__entidad_relacionada",
        "cuenta_por_cobrar_relacionada__cliente_relacionado",
        "cuenta_por_cobrar_relacionada__cliente_relacionado__entidad_relacionada",
        "cuenta_por_pagar_relacionada",
        "cuenta_por_pagar_relacionada__entidad_relacionada",
        "evento_relacionado",
        "evento_relacionado__entidad_relacionada",
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
    ).filter(
        estatus_conciliacion__in=["EN_ESPERA", "NO_IDENTIFICADO", "PARCIAL"]
    ).exclude(duplicado_de__isnull=False)
    if cuenta_bancaria_id:
        queryset = queryset.filter(cuenta_bancaria_relacionada_id=cuenta_bancaria_id)
    if carga_id:
        queryset = queryset.filter(carga_relacionada_id=carga_id)

    transactions = list(queryset.order_by("fecha_pago", "id")[: max(1, min(limit, 1000))])
    candidate_context = build_direct_reconciliation_context(
        transactions,
        allowed_entity_ids=allowed_entity_ids,
    )

    totals = {
        "procesados": 0,
        "aplicados": 0,
        "ambiguos": 0,
        "sin_candidato": 0,
        "omitidos": 0,
    }
    details: list[dict] = []
    for transaction_item in transactions:
        totals["procesados"] += 1
        try:
            result = direct_reconcile_bank_transaction(
                transaction_item,
                allowed_entity_ids=allowed_entity_ids,
                candidate_context=candidate_context,
            )
        except Exception as exc:
            totals["omitidos"] += 1
            error_message = str(exc) or exc.__class__.__name__
            record_transaction_auto_match(
                transaction_item,
                scope=transaction_item.tipo_movimiento,
                match_status="ERROR",
                matched=False,
                confidence_score=None,
                confidence_band="ERROR",
                reasons=[f"No se pudo evaluar el movimiento: {error_message}"],
                candidates=[],
            )
            details.append(
                {
                    "transaccion_id": transaction_item.id,
                    "tipo_movimiento": transaction_item.tipo_movimiento,
                    "monto": decimal_to_float(transaction_item.monto),
                    "status": "ERROR",
                    "scope": transaction_item.tipo_movimiento,
                    "matched": False,
                    "selected_id": None,
                    "candidates": [],
                    "error": error_message,
                }
            )
            continue
        if result["matched"]:
            totals["aplicados"] += 1
        elif result["status"] == "AMBIGUO":
            totals["ambiguos"] += 1
        elif result["status"] == "SIN_CANDIDATO":
            totals["sin_candidato"] += 1
        else:
            totals["omitidos"] += 1
        details.append(
            {
                "transaccion_id": transaction_item.id,
                "tipo_movimiento": transaction_item.tipo_movimiento,
                "monto": decimal_to_float(transaction_item.monto),
                "status": result["status"],
                "scope": result["scope"],
                "matched": result["matched"],
                "selected_id": result["selected_id"],
                "candidates": result["candidates"],
            }
        )
    return {**totals, "detalles": details[:50]}


@transaction.atomic
def set_bank_transaction_status(
    transaction_item: Transaccion,
    *,
    status: str,
    notes: str = "",
) -> Transaccion:
    valid_statuses = {"EN_ESPERA", "NO_IDENTIFICADO", "VALIDADO", "RECHAZADO"}
    if status not in valid_statuses:
        raise ValueError("El estatus solicitado no es valido para movimientos bancarios.")
    clean_notes = notes.strip()
    if status in {"NO_IDENTIFICADO", "RECHAZADO"} and len(clean_notes) < 3:
        raise ValueError("Agrega una nota breve para justificar el estatus del movimiento.")
    if status == "VALIDADO":
        if get_transaction_available_amount(transaction_item) > 0:
            raise ValueError("La transaccion aun tiene saldo sin aplicar.")
        if not has_live_transaction_links(transaction_item):
            raise ValueError("Primero vincula o aplica la transaccion antes de validarla.")
        transaction_item.fecha_validacion = timezone.now()
    elif status != "VALIDADO":
        transaction_item.fecha_validacion = None
    transaction_item.estatus_conciliacion = status
    transaction_item.notas_conciliacion = clean_notes or transaction_item.notas_conciliacion
    transaction_item.save(
        update_fields=["estatus_conciliacion", "fecha_validacion", "notas_conciliacion"]
    )
    return transaction_item


def build_bank_transaction_detail(
    transaction_item: Transaccion,
    *,
    allowed_entity_ids: list[int] | None = None,
) -> dict:
    pagos_cxc = list(
        transaction_item.pagos_cxc.select_related(
            "cuenta_por_cobrar",
            "cuenta_por_cobrar__cliente_relacionado",
        ).order_by("id")
    )
    pagos_cxp = list(
        transaction_item.pagos_cxp.select_related("cuenta_por_pagar").order_by("id")
    )
    transaction_item._pagos_cxc_vivos = [
        payment for payment in pagos_cxc if payment.estatus_validacion != "RECHAZADO"
    ]
    transaction_item._pagos_cxp_vivos = [
        payment for payment in pagos_cxp if payment.estatus_validacion != "RECHAZADO"
    ]
    cxc_candidates = (
        list_receivable_candidates_for_transaction(
            transaction_item,
            allowed_entity_ids=allowed_entity_ids,
        )
        if transaction_item.tipo_movimiento == "INGRESO"
        else []
    )
    cxp_candidates = (
        list_payable_candidates_for_transaction(
            transaction_item,
            allowed_entity_ids=allowed_entity_ids,
        )
        if transaction_item.tipo_movimiento == "EGRESO"
        else []
    )
    return {
        "transaccion": serialize_transaction(transaction_item),
        "auto_match": (transaction_item.metadata or {}).get("auto_match"),
        "candidatos": {
            "cxc": cxc_candidates,
            "cxp": cxp_candidates,
        },
        "pagos_cxc": [
            {
                "id": payment.id,
                "cuenta_id": payment.cuenta_por_cobrar_id,
                "concepto": payment.cuenta_por_cobrar.concepto,
                "cliente_nombre": payment.cuenta_por_cobrar.cliente_relacionado.razon_social
                or payment.cuenta_por_cobrar.cliente_relacionado.nombre_comercial,
                "monto": decimal_to_float(payment.monto),
                "estatus_validacion": payment.estatus_validacion,
                "fecha_pago": payment.fecha_pago,
            }
            for payment in pagos_cxc
        ],
        "pagos_cxp": [
            {
                "id": payment.id,
                "cuenta_id": payment.cuenta_por_pagar_id,
                "concepto": payment.cuenta_por_pagar.concepto,
                "proveedor_nombre": payment.cuenta_por_pagar.proveedor_nombre,
                "monto": decimal_to_float(payment.monto),
                "estatus_validacion": payment.estatus_validacion,
                "fecha_pago": payment.fecha_pago,
            }
            for payment in pagos_cxp
        ],
    }


def build_receivable_suggestion_candidate_pool(
    allowed_entity_ids: list[int],
    *,
    per_entity_limit: int = 120,
) -> list[CuentaPorCobrar]:
    if not allowed_entity_ids:
        return []
    queryset = (
        CuentaPorCobrar.objects.filter(receivable_candidate_scope_filter(allowed_entity_ids))
        .exclude(estatus_adeudo__in=["CONCILIADO", "CANCELADO", "INCOBRABLE"])
        .select_related(
            "entidad_relacionada",
            "cliente_relacionado",
            "cliente_relacionado__entidad_relacionada",
        )
        .annotate(
            suggestion_entity_id=Coalesce(
                "entidad_relacionada_id",
                "cliente_relacionado__entidad_relacionada_id",
            )
        )
        .annotate(
            suggestion_rank=Window(
                expression=RowNumber(),
                partition_by=[
                    Coalesce(
                        "entidad_relacionada_id",
                        "cliente_relacionado__entidad_relacionada_id",
                    )
                ],
                order_by=[F("fecha_vencimiento").asc(), F("id").asc()],
            )
        )
        .filter(suggestion_rank__lte=per_entity_limit)
        .order_by("suggestion_entity_id", "fecha_vencimiento", "id")
    )
    return list(queryset)


def build_payable_suggestion_candidate_pool(
    allowed_entity_ids: list[int],
    *,
    per_entity_limit: int = 120,
) -> list[CuentaPorPagar]:
    if not allowed_entity_ids:
        return []
    queryset = (
        CuentaPorPagar.objects.filter(entidad_relacionada_id__in=allowed_entity_ids)
        .exclude(estatus__in=["PAGADO", "CANCELADO"])
        .select_related("entidad_relacionada")
        .annotate(
            suggestion_rank=Window(
                expression=RowNumber(),
                partition_by=[F("entidad_relacionada_id")],
                order_by=[F("fecha_vencimiento").asc(), F("id").asc()],
            )
        )
        .filter(suggestion_rank__lte=per_entity_limit)
        .order_by("entidad_relacionada_id", "fecha_vencimiento", "id")
    )
    return list(queryset)


def build_reconciliation_suggestion_summary(items: list[dict]) -> dict[str, object]:
    by_type = {"CXC": 0, "CXP": 0}
    by_confidence = {
        "ALTA": 0,
        "MEDIA": 0,
        "BAJA": 0,
        "SIN_BANDA": 0,
    }
    by_readiness = {
        "LISTA": 0,
        "REVISAR": 0,
        "NO_APLICAR_DIRECTO": 0,
        "SIN_ESTADO": 0,
    }
    amount_by_readiness = {
        "LISTA": Decimal("0"),
        "REVISAR": Decimal("0"),
        "NO_APLICAR_DIRECTO": Decimal("0"),
        "SIN_ESTADO": Decimal("0"),
    }
    warning_counts: dict[str, int] = {}
    first_ready_id = None
    first_review_id = None
    first_blocked_id = None
    first_ids_by_readiness = {
        "LISTA": None,
        "REVISAR": None,
        "NO_APLICAR_DIRECTO": None,
        "SIN_ESTADO": None,
    }

    for item in items:
        item_type = str(item.get("tipo") or "")
        if item_type in by_type:
            by_type[item_type] += 1

        confidence = str(item.get("confidence_band") or "SIN_BANDA")
        if confidence not in by_confidence:
            confidence = "SIN_BANDA"
        by_confidence[confidence] += 1

        readiness = item.get("apply_readiness") or {}
        readiness_state = str(readiness.get("state") or "SIN_ESTADO")
        if readiness_state not in by_readiness:
            readiness_state = "SIN_ESTADO"
        by_readiness[readiness_state] += 1

        raw_candidate = item.get("candidato") or {}
        candidate = raw_candidate if isinstance(raw_candidate, dict) else {}
        amount_by_readiness[readiness_state] += clamp_money(
            as_decimal(candidate.get("saldo_pendiente") or item.get("amount_difference"))
        )

        if readiness_state == "LISTA" and first_ready_id is None:
            first_ready_id = item.get("id")
        elif readiness_state == "REVISAR" and first_review_id is None:
            first_review_id = item.get("id")
        elif readiness_state == "NO_APLICAR_DIRECTO" and first_blocked_id is None:
            first_blocked_id = item.get("id")
        if first_ids_by_readiness.get(readiness_state) is None:
            first_ids_by_readiness[readiness_state] = item.get("id")

        for warning in (candidate.get("warnings") or item.get("warnings") or [])[:3]:
            warning_text = str(warning or "").strip()
            if warning_text:
                warning_counts[warning_text] = warning_counts.get(warning_text, 0) + 1

    ready_count = by_readiness["LISTA"]
    review_count = by_readiness["REVISAR"]
    blocked_count = by_readiness["NO_APLICAR_DIRECTO"]
    total = len(items)
    if ready_count:
        primary_queue = "LISTA"
        recommended_focus = (
            f"Aplicar primero {ready_count} sugerencia(s) listas, empezando por "
            f"{first_ready_id}."
        )
    elif review_count:
        primary_queue = "REVISAR"
        recommended_focus = (
            f"Revisar {review_count} sugerencia(s) con señales mixtas antes de aplicar."
        )
    elif blocked_count:
        primary_queue = "NO_APLICAR_DIRECTO"
        recommended_focus = (
            f"Resolver manualmente {blocked_count} sugerencia(s) de baja confianza."
        )
    else:
        primary_queue = "VACIA"
        recommended_focus = "No hay sugerencias pendientes con el alcance actual."

    if blocked_count:
        risk_level = "ALTO"
    elif review_count:
        risk_level = "MEDIO"
    else:
        risk_level = "BAJO" if ready_count else "SIN_DATOS"

    return {
        "total": total,
        "by_type": by_type,
        "by_confidence": by_confidence,
        "by_readiness": by_readiness,
        "amount_by_readiness": {
            key: decimal_to_float(value)
            for key, value in amount_by_readiness.items()
        },
        "primary_queue": primary_queue,
        "risk_level": risk_level,
        "recommended_focus": recommended_focus,
        "first_ready_id": first_ready_id,
        "first_review_id": first_review_id,
        "first_blocked_id": first_blocked_id,
        "top_blockers": [
            {"label": label, "count": count}
            for label, count in sorted(
                warning_counts.items(),
                key=lambda item: (-item[1], item[0]),
            )[:4]
        ],
        "decision_queue": [
            build_reconciliation_decision_queue_row(
                state=state,
                count=by_readiness[state],
                amount=amount_by_readiness[state],
                first_id=first_ids_by_readiness[state],
            )
            for state in ("LISTA", "REVISAR", "NO_APLICAR_DIRECTO", "SIN_ESTADO")
            if by_readiness[state]
        ],
    }


def build_reconciliation_decision_queue_row(
    *,
    state: str,
    count: int,
    amount: Decimal,
    first_id,
) -> dict[str, object]:
    if state == "LISTA":
        return {
            "state": state,
            "label": "Listas para aplicar",
            "count": count,
            "amount": decimal_to_float(amount),
            "first_id": first_id,
            "next_action": "Aplicar despues de confirmar visualmente referencia y cliente/proveedor.",
            "operator_focus": "Procesar de mayor confianza a menor monto pendiente.",
        }
    if state == "REVISAR":
        return {
            "state": state,
            "label": "Requieren revision",
            "count": count,
            "amount": decimal_to_float(amount),
            "first_id": first_id,
            "next_action": "Abrir detalle, comparar soporte bancario y aplicar con nota.",
            "operator_focus": "Priorizar diferencias de monto y referencias parciales.",
        }
    if state == "NO_APLICAR_DIRECTO":
        return {
            "state": state,
            "label": "Resolver manualmente",
            "count": count,
            "amount": decimal_to_float(amount),
            "first_id": first_id,
            "next_action": "No aplicar directo; buscar manualmente o marcar no identificado.",
            "operator_focus": "Reducir riesgo antes de tocar saldos.",
        }
    return {
        "state": state,
        "label": "Sin estado",
        "count": count,
        "amount": decimal_to_float(amount),
        "first_id": first_id,
        "next_action": "Abrir detalle antes de decidir.",
        "operator_focus": "Completar analisis de conciliacion.",
    }


def build_reconciliation_suggestion_decision(item: dict, *, queue_position: int) -> dict[str, object]:
    readiness = item.get("apply_readiness") or {}
    state = str(readiness.get("state") or "SIN_ESTADO")
    suggestion_type = str(item.get("tipo") or "")
    score = int(item.get("score") or 0)
    warnings = [str(value) for value in (item.get("warnings") or []) if str(value).strip()]
    checklist = [
        str(value)
        for value in (readiness.get("checklist") or [])
        if str(value).strip()
    ][:4]
    if state == "LISTA":
        action = "APLICAR"
        label = f"Aplicar a {suggestion_type}"
        detail = "Lista para aplicar con verificacion visual previa."
        priority = 3000 + score
    elif state == "REVISAR":
        action = "REVISAR_Y_APLICAR"
        label = "Revisar y aplicar"
        detail = "Requiere confirmacion de referencia, fecha o monto antes de aplicar."
        priority = 2000 + score
    elif state == "NO_APLICAR_DIRECTO":
        action = "RESOLVER_MANUAL"
        label = "Resolver manualmente"
        detail = "No conviene aplicar directo; usar como pista y decidir desde el movimiento."
        priority = 1000 + score
    else:
        action = "ABRIR_DETALLE"
        label = "Abrir detalle"
        detail = "Falta estado asistido; revisar el movimiento antes de decidir."
        priority = score

    return {
        "queue": state,
        "queue_position": queue_position,
        "priority": priority,
        "action": action,
        "label": label,
        "detail": detail,
        "requires_note": state in {"REVISAR", "NO_APLICAR_DIRECTO"},
        "checklist": checklist,
        "blockers": warnings[:4],
    }


def build_bank_reconciliation_suggestions(
    *,
    allowed_entity_ids: list[int],
    capa_id: int | None = None,
    cuenta_bancaria_id: int | None = None,
    limit: int = 80,
) -> dict[str, object]:
    queryset = Transaccion.objects.select_related(
        "carga_relacionada",
        "cuenta_bancaria_relacionada",
        "cuenta_bancaria_relacionada__entidad_relacionada",
        "cuenta_por_cobrar_relacionada",
        "cuenta_por_cobrar_relacionada__entidad_relacionada",
        "cuenta_por_cobrar_relacionada__cliente_relacionado",
        "cuenta_por_cobrar_relacionada__cliente_relacionado__entidad_relacionada",
        "cuenta_por_pagar_relacionada",
        "cuenta_por_pagar_relacionada__entidad_relacionada",
        "evento_relacionado",
        "evento_relacionado__entidad_relacionada",
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
    ).filter(
        estatus_conciliacion__in=["EN_ESPERA", "NO_IDENTIFICADO", "PARCIAL"]
    ).exclude(duplicado_de__isnull=False)
    scope_filter = (
        Q(cuenta_por_cobrar_relacionada__entidad_relacionada_id__in=allowed_entity_ids)
        | Q(cuenta_por_pagar_relacionada__entidad_relacionada_id__in=allowed_entity_ids)
        | Q(evento_relacionado__entidad_relacionada_id__in=allowed_entity_ids)
    )
    if capa_id:
        scope_filter |= Q(cuenta_bancaria_relacionada__capa_negocio_id=capa_id)
    queryset = queryset.filter(scope_filter)
    if cuenta_bancaria_id:
        queryset = queryset.filter(cuenta_bancaria_relacionada_id=cuenta_bancaria_id)

    transactions = list(queryset.order_by("-fecha_pago", "-id")[: max(1, min(limit, 200))])
    receivable_candidates = (
        build_receivable_suggestion_candidate_pool(allowed_entity_ids)
        if any(item.tipo_movimiento == "INGRESO" for item in transactions)
        else []
    )
    payable_candidates = (
        build_payable_suggestion_candidate_pool(allowed_entity_ids)
        if any(item.tipo_movimiento == "EGRESO" for item in transactions)
        else []
    )

    items: list[dict] = []
    serialized_transactions: dict[int, dict] = {}
    for transaction_item in transactions:
        candidates = (
            list_receivable_candidates_for_transaction(
                transaction_item,
                limit=4,
                allowed_entity_ids=allowed_entity_ids,
                candidate_accounts=receivable_candidates,
            )
            if transaction_item.tipo_movimiento == "INGRESO"
            else list_payable_candidates_for_transaction(
                transaction_item,
                limit=4,
                allowed_entity_ids=allowed_entity_ids,
                candidate_accounts=payable_candidates,
            )
        )
        for candidate in candidates:
            entity_id = candidate.get("entidad_id")
            if entity_id is not None and entity_id not in allowed_entity_ids:
                continue
            suggestion_type = "CXC" if transaction_item.tipo_movimiento == "INGRESO" else "CXP"
            if transaction_item.id not in serialized_transactions:
                serialized_transactions[transaction_item.id] = serialize_transaction(
                    transaction_item
                )
            serialized_transaction = serialized_transactions[transaction_item.id]
            item = {
                "id": f"{transaction_item.id}-{suggestion_type.lower()}-{candidate['id']}",
                "tipo": suggestion_type,
                "transaccion": serialized_transaction,
                "candidato": candidate,
                "score": candidate.get("score", 0),
                "reasons": candidate.get("reasons", []),
                "confidence_band": candidate.get("confidence_band"),
                "amount_difference": candidate.get("amount_difference"),
                "recommended_action": candidate.get("recommended_action"),
                "review_required": candidate.get("review_required", True),
                "apply_readiness": candidate.get("apply_readiness"),
                "warnings": candidate.get("warnings", []),
            }
            items.append(item)
    items.sort(key=lambda item: (-int(item.get("score") or 0), item["transaccion"]["fecha_pago"]))
    limited_items = items[:limit]
    for position, item in enumerate(limited_items, start=1):
        item["decision"] = build_reconciliation_suggestion_decision(
            item,
            queue_position=position,
        )
    return {
        "items": limited_items,
        "total": len(items),
        "summary": build_reconciliation_suggestion_summary(limited_items),
    }


def cxc_status_for_summary(cuenta: CuentaPorCobrar, today: date) -> str:
    if cuenta.estatus_adeudo in {"CANCELADO", "INCOBRABLE", "POR_CONCILIAR"}:
        return cuenta.estatus_adeudo
    if cuenta.saldo_pendiente <= 0:
        return "CONCILIADO"
    if cuenta.fecha_vencimiento < today:
        grace_limit = cuenta.fecha_vencimiento + timedelta(
            days=resolve_grace_days_for_account(cuenta)
        )
        if today <= grace_limit:
            return "EN_GRACIA"
        return "VENCIDO"
    if clamp_money(cuenta.monto_pagado) > 0:
        return "PARCIAL"
    return "PENDIENTE"


def cxp_status_for_summary(cuenta: CuentaPorPagar, today: date) -> str:
    if cuenta.estatus in {"CANCELADO", "POR_CONCILIAR"}:
        return cuenta.estatus
    if cuenta.saldo_pendiente <= 0:
        return "PAGADO"
    if cuenta.fecha_vencimiento < today:
        return "VENCIDO"
    if clamp_money(cuenta.monto_pagado) > 0:
        return "PARCIAL"
    return "PENDIENTE"


def serialize_cxc(cuenta: CuentaPorCobrar, *, today: date) -> dict:
    cliente_nombre = (
        cuenta.cliente_relacionado.razon_social
        or cuenta.cliente_relacionado.nombre_comercial
        or "Sin nombre"
    )
    return {
        "id": cuenta.id,
        "cliente_id": cuenta.cliente_relacionado_id,
        "cliente_nombre": cliente_nombre,
        "concepto": cuenta.concepto,
        "origen": cuenta.origen,
        "periodicidad": cuenta.periodicidad,
        "fecha_periodo_inicio": cuenta.fecha_periodo_inicio,
        "fecha_periodo_fin": cuenta.fecha_periodo_fin,
        "fecha_vencimiento": cuenta.fecha_vencimiento,
        "monto_total": decimal_to_float(cuenta.monto_total),
        "monto_pagado": decimal_to_float(cuenta.monto_pagado),
        "saldo_pendiente": decimal_to_float(cuenta.saldo_pendiente),
        "estatus": cxc_status_for_summary(cuenta, today),
        "referencia_unica": cuenta.referencia_unica,
    }


def serialize_cxp(cuenta: CuentaPorPagar, *, today: date) -> dict:
    return {
        "id": cuenta.id,
        "entidad_id": cuenta.entidad_relacionada_id,
        "entidad_nombre": cuenta.entidad_relacionada.nombre_comercial,
        "programacion_id": cuenta.programacion_relacionada_id,
        "proveedor_nombre": cuenta.proveedor_nombre,
        "banco_pago": cuenta.banco_pago,
        "cuenta_pago": cuenta.cuenta_pago,
        "clabe_pago": cuenta.clabe_pago,
        "prioridad": cuenta.prioridad,
        "categoria": cuenta.categoria,
        "naturaleza": cuenta.naturaleza,
        "concepto": cuenta.concepto,
        "periodicidad": cuenta.periodicidad,
        "fecha_periodo_inicio": cuenta.fecha_periodo_inicio,
        "fecha_periodo_fin": cuenta.fecha_periodo_fin,
        "fecha_vencimiento": cuenta.fecha_vencimiento,
        "monto_proyectado": decimal_to_float(cuenta.monto_proyectado),
        "monto_real": decimal_to_float(cuenta.monto_real),
        "monto_total": decimal_to_float(cuenta.monto_total),
        "monto_pagado": decimal_to_float(cuenta.monto_pagado),
        "saldo_pendiente": decimal_to_float(cuenta.saldo_pendiente),
        "dias_gracia": cuenta.dias_gracia,
        "genera_recargo": cuenta.genera_recargo,
        "estatus": cxp_status_for_summary(cuenta, today),
        "tipo_registro": cuenta.tipo_registro,
        "referencia_unica": cuenta.referencia_unica,
    }


def serialize_payment_cxc(payment: PagoCuentaPorCobrar) -> dict:
    account = payment.cuenta_por_cobrar
    entidad = account.entidad_relacionada or account.cliente_relacionado.entidad_relacionada
    return {
        "id": payment.id,
        "entidad_id": entidad.id if entidad else None,
        "entidad_nombre": entidad.nombre_comercial if entidad else None,
        "cliente_id": account.cliente_relacionado_id,
        "cliente_nombre": (
            account.cliente_relacionado.razon_social
            or account.cliente_relacionado.nombre_comercial
            or "Sin nombre"
        ),
        "cuenta_id": account.id,
        "concepto": account.concepto,
        "monto": decimal_to_float(payment.monto),
        "fecha_pago": payment.fecha_pago,
        "metodo": payment.metodo,
        "canal_origen": payment.canal_origen,
        "estatus_validacion": payment.estatus_validacion,
        "fecha_validacion": payment.fecha_validacion,
        "referencia": payment.referencia,
        "transaccion_id": payment.transaccion_relacionada_id,
        "evidencia_id": payment.evidencia_pago_relacionada_id,
        "evento_id": payment.evento_financiero_relacionado_id,
    }


def serialize_payment_cxp(payment: PagoCuentaPorPagar) -> dict:
    account = payment.cuenta_por_pagar
    return {
        "id": payment.id,
        "entidad_id": account.entidad_relacionada_id,
        "entidad_nombre": account.entidad_relacionada.nombre_comercial,
        "cuenta_id": account.id,
        "proveedor_nombre": account.proveedor_nombre,
        "concepto": account.concepto,
        "monto": decimal_to_float(payment.monto),
        "fecha_pago": payment.fecha_pago,
        "metodo": payment.metodo,
        "canal_origen": payment.canal_origen,
        "estatus_validacion": payment.estatus_validacion,
        "fecha_validacion": payment.fecha_validacion,
        "referencia": payment.referencia,
        "transaccion_id": payment.transaccion_relacionada_id,
        "evidencia_id": payment.evidencia_pago_relacionada_id,
        "evento_id": payment.evento_financiero_relacionado_id,
    }


def serialize_transaction(transaction_item: Transaccion) -> dict:
    monto_aplicado = get_transaction_applied_amount(transaction_item)
    monto_disponible = clamp_money(clamp_money(transaction_item.monto) - monto_aplicado)
    return {
        "id": transaction_item.id,
        "carga_id": transaction_item.carga_relacionada_id,
        "carga_nombre": transaction_item.carga_relacionada.nombre_archivo
        if transaction_item.carga_relacionada_id
        else None,
        "origen": transaction_item.origen,
        "cuenta_bancaria_id": transaction_item.cuenta_bancaria_relacionada_id,
        "cuenta_bancaria_nombre": str(transaction_item.cuenta_bancaria_relacionada)
        if transaction_item.cuenta_bancaria_relacionada_id
        else None,
        "tipo_movimiento": transaction_item.tipo_movimiento,
        "monto": decimal_to_float(transaction_item.monto),
        "monto_aplicado": decimal_to_float(monto_aplicado),
        "monto_disponible": decimal_to_float(monto_disponible),
        "fecha_pago": transaction_item.fecha_pago,
        "concepto_bancario": transaction_item.concepto_bancario,
        "numero_referencia": transaction_item.numero_referencia,
        "folio_bancario": transaction_item.folio_bancario,
        "saldo_resultante": decimal_to_float(transaction_item.saldo_resultante),
        "hash_movimiento": transaction_item.hash_movimiento,
        "estatus_conciliacion": transaction_item.estatus_conciliacion,
        "cuenta_por_cobrar_id": transaction_item.cuenta_por_cobrar_relacionada_id,
        "cuenta_por_pagar_id": transaction_item.cuenta_por_pagar_relacionada_id,
        "evento_id": transaction_item.evento_relacionado_id,
        "duplicado_de_id": transaction_item.duplicado_de_id,
        "fecha_registro": transaction_item.fecha_registro,
        "fecha_validacion": transaction_item.fecha_validacion,
        "notas_conciliacion": transaction_item.notas_conciliacion,
        "auto_match": (transaction_item.metadata or {}).get("auto_match"),
    }


def serialize_programacion(programacion: ProgramacionCuentaPorPagar) -> dict:
    return {
        "id": programacion.id,
        "nombre": programacion.nombre,
        "categoria": programacion.categoria,
        "naturaleza": programacion.naturaleza,
        "proveedor_nombre": programacion.proveedor_nombre,
        "banco_pago": programacion.banco_pago,
        "cuenta_pago": programacion.cuenta_pago,
        "clabe_pago": programacion.clabe_pago,
        "prioridad": programacion.prioridad,
        "periodicidad": programacion.periodicidad,
        "fecha_inicio": programacion.fecha_inicio,
        "fecha_fin": programacion.fecha_fin,
        "dia_vencimiento": programacion.dia_vencimiento,
        "monto_base": decimal_to_float(programacion.monto_base),
        "dias_gracia": programacion.dias_gracia,
        "genera_recargo": programacion.genera_recargo,
        "prorrateable": programacion.prorrateable,
        "activo": programacion.activo,
        "observaciones": programacion.observaciones,
    }


def is_interest_rule_name(name: str | None) -> bool:
    normalized = normalize_lookup_text(name)
    return any(token in normalized for token in ("interes", "moratorio", "recargo"))


def rank_interest_rule(rule: ReglaNegocio | ReglaMarcoNegocio) -> tuple[int, int]:
    score = 0
    if rule.tipo_calculo == "PORCENTAJE_RECARGO":
        score += 10
    if is_interest_rule_name(rule.nombre):
        score += 5
    if rule.dias_condicion is not None and rule.dias_condicion >= 0:
        score += 2
    return (score, int(rule.valor or 0))


def resolve_interest_rule_for_entity(entidad: EntidadNegocio) -> dict[str, object]:
    local_rules = list(
        ReglaNegocio.objects.filter(entidad=entidad, activo=True)
        .select_related("regla_marco")
        .order_by("-id")
    )
    local_candidates = [
        rule for rule in local_rules if rule.tipo_calculo == "PORCENTAJE_RECARGO"
    ]
    if local_candidates:
        selected = max(local_candidates, key=rank_interest_rule)
        return {
            "nombre": selected.nombre,
            "porcentaje": clamp_money(selected.valor),
            "dias_condicion": max(selected.dias_condicion or 0, 0),
        }

    override_marco_ids = {
        rule.regla_marco_id for rule in local_rules if rule.regla_marco_id
    }
    if entidad.capa_negocio_id:
        marco_rules = list(
            ReglaMarcoNegocio.objects.filter(
                capa_negocio=entidad.capa_negocio,
                activo=True,
                tipo_calculo="PORCENTAJE_RECARGO",
            )
            .exclude(id__in=override_marco_ids)
            .order_by("-id")
        )
        if marco_rules:
            selected = max(marco_rules, key=rank_interest_rule)
            return {
                "nombre": selected.nombre,
                "porcentaje": clamp_money(selected.valor),
                "dias_condicion": max(selected.dias_condicion or 0, 0),
            }

    return {
        "nombre": None,
        "porcentaje": Decimal("0"),
        "dias_condicion": 0,
    }


def default_interest_context() -> dict[str, object]:
    return {
        "nombre": None,
        "porcentaje": Decimal("0"),
        "dias_condicion": 0,
    }


def serialize_interest_rule(rule: ReglaNegocio | ReglaMarcoNegocio) -> dict[str, object]:
    return {
        "nombre": rule.nombre,
        "porcentaje": clamp_money(rule.valor),
        "dias_condicion": max(rule.dias_condicion or 0, 0),
    }


def resolve_interest_rules_for_entities(
    entidades: list[EntidadNegocio],
) -> dict[int, dict[str, object]]:
    if not entidades:
        return {}

    entity_map = {entidad.id: entidad for entidad in entidades if entidad.id}
    entity_ids = list(entity_map.keys())
    local_rules_by_entity: dict[int, list[ReglaNegocio]] = {entity_id: [] for entity_id in entity_ids}
    override_marco_ids_by_entity: dict[int, set[int]] = {entity_id: set() for entity_id in entity_ids}

    local_rules = (
        ReglaNegocio.objects.filter(entidad_id__in=entity_ids, activo=True)
        .select_related("regla_marco")
        .order_by("-id")
    )
    for rule in local_rules:
        local_rules_by_entity.setdefault(rule.entidad_id, []).append(rule)
        if rule.regla_marco_id:
            override_marco_ids_by_entity.setdefault(rule.entidad_id, set()).add(rule.regla_marco_id)

    contexts: dict[int, dict[str, object]] = {}
    pending_entity_ids: list[int] = []
    for entity_id in entity_ids:
        local_candidates = [
            rule
            for rule in local_rules_by_entity.get(entity_id, [])
            if rule.tipo_calculo == "PORCENTAJE_RECARGO"
        ]
        if local_candidates:
            contexts[entity_id] = serialize_interest_rule(max(local_candidates, key=rank_interest_rule))
        else:
            pending_entity_ids.append(entity_id)

    capa_ids = {
        entity_map[entity_id].capa_negocio_id
        for entity_id in pending_entity_ids
        if entity_map[entity_id].capa_negocio_id
    }
    marco_rules_by_capa: dict[int, list[ReglaMarcoNegocio]] = {capa_id: [] for capa_id in capa_ids}
    if capa_ids:
        marco_rules = ReglaMarcoNegocio.objects.filter(
            capa_negocio_id__in=capa_ids,
            activo=True,
            tipo_calculo="PORCENTAJE_RECARGO",
        ).order_by("-id")
        for rule in marco_rules:
            marco_rules_by_capa.setdefault(rule.capa_negocio_id, []).append(rule)

    for entity_id in pending_entity_ids:
        entidad = entity_map[entity_id]
        override_ids = override_marco_ids_by_entity.get(entity_id, set())
        marco_candidates = [
            rule
            for rule in marco_rules_by_capa.get(entidad.capa_negocio_id, [])
            if rule.id not in override_ids
        ]
        contexts[entity_id] = (
            serialize_interest_rule(max(marco_candidates, key=rank_interest_rule))
            if marco_candidates
            else default_interest_context()
        )
    return contexts


def resolve_grace_days_for_account(cuenta: CuentaPorCobrar) -> int:
    cliente_days = cuenta.cliente_relacionado.dias_gracia or 0
    if cliente_days > 0:
        return cliente_days
    entidad = cuenta.entidad_relacionada or cuenta.cliente_relacionado.entidad_relacionada
    capa = getattr(entidad, "capa_negocio", None)
    return max(getattr(capa, "dias_gracia_default", 0) or 0, 0)


def resolve_paginated_slice(
    rows: list[dict],
    *,
    page: int,
    page_size: int,
) -> tuple[list[dict], int, int, int]:
    safe_page_size = min(max(page_size, 10), 100)
    total = len(rows)
    total_pages = max((total + safe_page_size - 1) // safe_page_size, 1)
    safe_page = min(max(page, 1), total_pages)
    start = (safe_page - 1) * safe_page_size
    end = start + safe_page_size
    return rows[start:end], total, total_pages, safe_page


AGING_BUCKETS = (
    ("0_7", "0 a 7 dias", 0, 7),
    ("8_15", "8 a 15 dias", 8, 15),
    ("16_30", "16 a 30 dias", 16, 30),
    ("mas_30", "Mas de 30 dias", 31, None),
)


def empty_aging_buckets() -> dict[str, dict[str, Decimal | int | str | None]]:
    return {
        key: {
            "key": key,
            "label": label,
            "dias_min": days_min,
            "dias_max": days_max,
            "cuentas": 0,
            "saldo": Decimal("0"),
            "recargos": Decimal("0"),
            "total": Decimal("0"),
        }
        for key, label, days_min, days_max in AGING_BUCKETS
    }


def aging_bucket_for_days(days_overdue: int) -> str:
    for key, _label, days_min, days_max in AGING_BUCKETS:
        if days_overdue >= days_min and (days_max is None or days_overdue <= days_max):
            return key
    return "mas_30"


def add_aging_balance(
    buckets: dict[str, dict[str, Decimal | int | str | None]],
    *,
    due_date: date | str | None,
    today: date,
    saldo: Decimal,
    recargos: Decimal = Decimal("0"),
) -> None:
    if saldo <= 0 or not due_date:
        return

    if isinstance(due_date, str):
        try:
            parsed_due_date = date.fromisoformat(due_date)
        except ValueError:
            return
    else:
        parsed_due_date = due_date

    if parsed_due_date > today:
        return

    days_overdue = max((today - parsed_due_date).days, 0)
    bucket = buckets[aging_bucket_for_days(days_overdue)]
    bucket["cuentas"] = int(bucket["cuentas"]) + 1
    bucket["saldo"] = Decimal(str(bucket["saldo"])) + saldo
    bucket["recargos"] = Decimal(str(bucket["recargos"])) + recargos
    bucket["total"] = Decimal(str(bucket["total"])) + saldo + recargos


def serialize_aging_buckets(
    buckets: dict[str, dict[str, Decimal | int | str | None]],
) -> list[dict[str, object]]:
    return [
        {
            "key": bucket["key"],
            "label": bucket["label"],
            "dias_min": bucket["dias_min"],
            "dias_max": bucket["dias_max"],
            "cuentas": bucket["cuentas"],
            "saldo": decimal_to_float(Decimal(str(bucket["saldo"]))),
            "recargos": decimal_to_float(Decimal(str(bucket["recargos"]))),
            "total": decimal_to_float(Decimal(str(bucket["total"]))),
        }
        for key, *_rest in AGING_BUCKETS
        if (bucket := buckets[key])
    ]


def build_cxc_metrics(rows: list[dict]) -> dict[str, object]:
    def empty_bucket() -> dict[str, Decimal | int]:
        return {
            "count": 0,
            "base": Decimal("0"),
            "interes": Decimal("0"),
            "total": Decimal("0"),
        }

    def empty_month_bucket() -> dict[str, object]:
        return {
            "cuentas": 0,
            "clientes": set(),
            "pagadas": 0,
            "abiertas": 0,
            "cargos": Decimal("0"),
            "cobrado": Decimal("0"),
            "saldo": Decimal("0"),
            "recargos": Decimal("0"),
            "exigible": Decimal("0"),
            "facturado": Decimal("0"),
        }

    def row_month_key(row: dict) -> str:
        value = row.get("fecha_periodo_inicio") or row.get("fecha_vencimiento")
        if isinstance(value, date):
            return value.strftime("%Y-%m")
        if isinstance(value, str) and len(value) >= 7:
            return value[:7]
        return "Sin periodo"

    metrics = {
        "registros": len(rows),
        "clientes": len({row["cliente_id"] for row in rows}),
        "pagadas": empty_bucket(),
        "vencidas": empty_bucket(),
        "en_gracia": empty_bucket(),
        "por_vencer": empty_bucket(),
        "totales": {
            "cargos": Decimal("0"),
            "cobrado": Decimal("0"),
            "saldo": Decimal("0"),
            "recargos": Decimal("0"),
            "exigible": Decimal("0"),
            "facturado": Decimal("0"),
            "cuentas_abiertas": 0,
            "cuentas_pagadas": 0,
        },
    }
    monthly: dict[str, dict[str, object]] = {}
    aging_buckets = empty_aging_buckets()
    today = timezone.localdate()

    for row in rows:
        bucket_name = (
            "pagadas"
            if row["categoria_tablero"] == "PAGADA"
            else "vencidas"
            if row["categoria_tablero"] == "VENCIDA_CON_RECARGO"
            else "en_gracia"
            if row["categoria_tablero"] == "EN_GRACIA"
            else "por_vencer"
        )
        bucket = metrics[bucket_name]
        bucket["count"] += 1
        bucket["base"] += Decimal(str(row["monto_base"]))
        bucket["interes"] += Decimal(str(row["interes_monto"]))
        bucket["total"] += Decimal(str(row["total_a_pagar"]))

        monto_original = Decimal(str(row["monto_original"]))
        monto_pagado = Decimal(str(row["monto_pagado"]))
        monto_base = Decimal(str(row["monto_base"]))
        interes_monto = Decimal(str(row["interes_monto"]))
        total_a_pagar = Decimal(str(row["total_a_pagar"]))
        factura = row.get("factura") or {}
        factura_total = (
            Decimal(str(factura.get("total") or 0))
            if factura.get("estatus") == "TIMBRADA"
            else Decimal("0")
        )
        is_paid = row["categoria_tablero"] == "PAGADA"

        totals = metrics["totales"]
        totals["cargos"] += monto_original
        totals["cobrado"] += monto_pagado
        totals["saldo"] += monto_base
        totals["recargos"] += interes_monto
        totals["exigible"] += total_a_pagar
        totals["facturado"] += factura_total
        totals["cuentas_pagadas"] += 1 if is_paid else 0
        totals["cuentas_abiertas"] += 0 if is_paid else 1
        if not is_paid:
            add_aging_balance(
                aging_buckets,
                due_date=row.get("fecha_vencimiento"),
                today=today,
                saldo=monto_base,
                recargos=interes_monto,
            )

        month_key = row_month_key(row)
        month_bucket = monthly.setdefault(month_key, empty_month_bucket())
        month_bucket["cuentas"] += 1
        month_bucket["clientes"].add(row["cliente_id"])  # type: ignore[union-attr]
        month_bucket["pagadas"] += 1 if is_paid else 0
        month_bucket["abiertas"] += 0 if is_paid else 1
        month_bucket["cargos"] += monto_original
        month_bucket["cobrado"] += monto_pagado
        month_bucket["saldo"] += monto_base
        month_bucket["recargos"] += interes_monto
        month_bucket["exigible"] += total_a_pagar
        month_bucket["facturado"] += factura_total

    open_debtors: dict[int, dict[str, object]] = {}
    for row in rows:
        if row["categoria_tablero"] == "PAGADA":
            continue
        client_id = int(row["cliente_id"])
        debtor = open_debtors.setdefault(
            client_id,
            {
                "cliente_id": client_id,
                "cliente_nombre": row["cliente_nombre"],
                "entidad_nombre": row["entidad_nombre"],
                "total_a_pagar": Decimal("0"),
                "cuentas": 0,
                "dias_atraso_post_gracia": 0,
                "fecha_vencimiento": row.get("fecha_vencimiento"),
            },
        )
        debtor["total_a_pagar"] = Decimal(str(debtor["total_a_pagar"])) + Decimal(
            str(row["total_a_pagar"])
        )
        debtor["cuentas"] = int(debtor["cuentas"]) + 1
        debtor["dias_atraso_post_gracia"] = max(
            int(debtor["dias_atraso_post_gracia"]),
            int(row["dias_atraso_post_gracia"] or 0),
        )
        current_due_date = debtor.get("fecha_vencimiento")
        row_due_date = row.get("fecha_vencimiento")
        if row_due_date and (not current_due_date or row_due_date < current_due_date):
            debtor["fecha_vencimiento"] = row_due_date

    top_debtors = [
        {
            **debtor,
            "total_a_pagar": decimal_to_float(Decimal(str(debtor["total_a_pagar"]))),
        }
        for debtor in sorted(
            open_debtors.values(),
            key=lambda item: Decimal(str(item["total_a_pagar"])),
            reverse=True,
        )[:6]
    ]

    return {
        "registros": metrics["registros"],
        "clientes": metrics["clientes"],
        "totales": {
            "cargos": decimal_to_float(metrics["totales"]["cargos"]),
            "cobrado": decimal_to_float(metrics["totales"]["cobrado"]),
            "saldo": decimal_to_float(metrics["totales"]["saldo"]),
            "recargos": decimal_to_float(metrics["totales"]["recargos"]),
            "exigible": decimal_to_float(metrics["totales"]["exigible"]),
            "facturado": decimal_to_float(metrics["totales"]["facturado"]),
            "cuentas_abiertas": metrics["totales"]["cuentas_abiertas"],
            "cuentas_pagadas": metrics["totales"]["cuentas_pagadas"],
        },
        "antiguedad_saldo": serialize_aging_buckets(aging_buckets),
        "por_mes": [
            {
                "periodo": period,
                "cuentas": bucket["cuentas"],
                "clientes": len(bucket["clientes"]),  # type: ignore[arg-type]
                "pagadas": bucket["pagadas"],
                "abiertas": bucket["abiertas"],
                "cargos": decimal_to_float(bucket["cargos"]),  # type: ignore[arg-type]
                "cobrado": decimal_to_float(bucket["cobrado"]),  # type: ignore[arg-type]
                "saldo": decimal_to_float(bucket["saldo"]),  # type: ignore[arg-type]
                "recargos": decimal_to_float(bucket["recargos"]),  # type: ignore[arg-type]
                "exigible": decimal_to_float(bucket["exigible"]),  # type: ignore[arg-type]
                "facturado": decimal_to_float(bucket["facturado"]),  # type: ignore[arg-type]
            }
            for period, bucket in sorted(monthly.items(), reverse=True)
        ],
        "pagadas": {
            "count": metrics["pagadas"]["count"],
            "base": decimal_to_float(metrics["pagadas"]["base"]),
            "interes": decimal_to_float(metrics["pagadas"]["interes"]),
            "total": decimal_to_float(metrics["pagadas"]["total"]),
        },
        "vencidas": {
            "count": metrics["vencidas"]["count"],
            "base": decimal_to_float(metrics["vencidas"]["base"]),
            "interes": decimal_to_float(metrics["vencidas"]["interes"]),
            "total": decimal_to_float(metrics["vencidas"]["total"]),
        },
        "en_gracia": {
            "count": metrics["en_gracia"]["count"],
            "base": decimal_to_float(metrics["en_gracia"]["base"]),
            "interes": decimal_to_float(metrics["en_gracia"]["interes"]),
            "total": decimal_to_float(metrics["en_gracia"]["total"]),
        },
        "por_vencer": {
            "count": metrics["por_vencer"]["count"],
            "base": decimal_to_float(metrics["por_vencer"]["base"]),
            "interes": decimal_to_float(metrics["por_vencer"]["interes"]),
            "total": decimal_to_float(metrics["por_vencer"]["total"]),
        },
        "deudores_principales": top_debtors,
    }


def resolve_account_paid_in_full_date(cuenta: CuentaPorCobrar) -> date | None:
    acumulado = Decimal("0")
    payments = getattr(cuenta, "valid_cxc_payments", None)
    if payments is None:
        payments = cuenta.pagos_aplicados.exclude(
            estatus_validacion="RECHAZADO"
        ).order_by("fecha_pago", "id")
    for pago in payments:
        acumulado += clamp_money(pago.monto)
        if acumulado >= clamp_money(cuenta.monto_total):
            return pago.fecha_pago
    return None


def classify_cxc_behavior(
    cuenta: CuentaPorCobrar,
    *,
    today: date,
) -> tuple[str, int, date, date | None]:
    grace_days = resolve_grace_days_for_account(cuenta)
    grace_limit = cuenta.fecha_vencimiento + timedelta(days=grace_days)
    paid_in_full_date = resolve_account_paid_in_full_date(cuenta)

    if cuenta.estatus_adeudo == "INCOBRABLE":
        return ("ABIERTA_VENCIDA", grace_days, grace_limit, paid_in_full_date)

    if paid_in_full_date:
        if paid_in_full_date <= cuenta.fecha_vencimiento:
            return ("PAGADA_A_TIEMPO", grace_days, grace_limit, paid_in_full_date)
        if paid_in_full_date <= grace_limit:
            return ("PAGADA_EN_GRACIA", grace_days, grace_limit, paid_in_full_date)
        return ("PAGADA_TARDE", grace_days, grace_limit, paid_in_full_date)

    if today <= cuenta.fecha_vencimiento:
        return ("ABIERTA_POR_VENCER", grace_days, grace_limit, paid_in_full_date)
    if today <= grace_limit:
        return ("ABIERTA_EN_GRACIA", grace_days, grace_limit, paid_in_full_date)
    return ("ABIERTA_VENCIDA", grace_days, grace_limit, paid_in_full_date)


def score_cxc_behavior(behavior_counts: dict[str, int]) -> tuple[int, str]:
    total = sum(behavior_counts.values())
    if total <= 0:
        return (100, "Sin incidencias")

    weighted_total = (
        behavior_counts["PAGADA_A_TIEMPO"] * Decimal("1.00")
        + behavior_counts["PAGADA_EN_GRACIA"] * Decimal("0.85")
        + behavior_counts["PAGADA_TARDE"] * Decimal("0.45")
        + behavior_counts["ABIERTA_POR_VENCER"] * Decimal("0.70")
        + behavior_counts["ABIERTA_EN_GRACIA"] * Decimal("0.35")
    )
    score = int((weighted_total / Decimal(total) * Decimal("100")).quantize(Decimal("1")))

    if score >= 85:
        label = "Muy puntual"
    elif score >= 70:
        label = "Estable"
    elif score >= 50:
        label = "Con riesgo"
    else:
        label = "Morosidad alta"

    return (score, label)


CXC_INVOICE_CONTEXTS_FOR_SUMMARY = {"CLIENTE_CXC", "PORTAL_CLIENTE"}


def cxc_invoice_summary_prefetch() -> Prefetch:
    from facturacion.models import FacturaEmitida

    return Prefetch(
        "facturas_emitidas",
        queryset=(
            FacturaEmitida.objects.filter(contexto__in=CXC_INVOICE_CONTEXTS_FOR_SUMMARY)
            .exclude(estatus="CANCELADA")
            .only(
                "id",
                "cuenta_por_cobrar_id",
                "contexto",
                "estatus",
                "serie",
                "folio",
                "uuid",
                "proveedor_factura_id",
                "total",
                "fecha_timbrado",
                "fecha_emision",
                "pdf_url",
                "xml_url",
                "error_proveedor",
            )
        ),
        to_attr="cxc_invoice_candidates",
    )


def valid_cxc_payment_prefetch() -> Prefetch:
    return Prefetch(
        "pagos_aplicados",
        queryset=PagoCuentaPorCobrar.objects.exclude(
            estatus_validacion="RECHAZADO"
        ).order_by("fecha_pago", "id"),
        to_attr="valid_cxc_payments",
    )


def cxc_invoice_summary(cuenta: CuentaPorCobrar) -> dict | None:
    invoices = getattr(cuenta, "cxc_invoice_candidates", None)
    if invoices is None:
        invoices = list(
            cuenta.facturas_emitidas.filter(
                contexto__in=CXC_INVOICE_CONTEXTS_FOR_SUMMARY
            ).exclude(estatus="CANCELADA")
        )
    if not invoices:
        return None

    invoice = max(
        invoices,
        key=lambda item: (
            item.fecha_timbrado or item.fecha_emision or timezone.now(),
            item.id,
        ),
    )
    return serialize_cxc_invoice_summary(invoice)


def serialize_cxc_invoice_summary(invoice) -> dict:
    return {
        "id": invoice.id,
        "estatus": invoice.estatus,
        "serie": invoice.serie,
        "folio": invoice.folio,
        "uuid": invoice.uuid,
        "proveedor_factura_id": invoice.proveedor_factura_id,
        "total": decimal_to_float(invoice.total),
        "fecha_timbrado": invoice.fecha_timbrado.isoformat() if invoice.fecha_timbrado else None,
        "pdf_url": invoice.pdf_url,
        "xml_url": invoice.xml_url,
        "error_proveedor": invoice.error_proveedor,
    }


def build_cxc_invoice_summary_map(account_ids: set[int]) -> dict[int, dict]:
    if not account_ids:
        return {}

    from facturacion.models import FacturaEmitida

    latest_by_account: dict[int, object] = {}
    invoices = (
        FacturaEmitida.objects.filter(
            cuenta_por_cobrar_id__in=account_ids,
            contexto__in=CXC_INVOICE_CONTEXTS_FOR_SUMMARY,
        )
        .exclude(estatus="CANCELADA")
        .only(
            "id",
            "cuenta_por_cobrar_id",
            "contexto",
            "estatus",
            "serie",
            "folio",
            "uuid",
            "proveedor_factura_id",
            "total",
            "fecha_timbrado",
            "fecha_emision",
            "pdf_url",
            "xml_url",
            "error_proveedor",
        )
        .order_by("cuenta_por_cobrar_id", "-fecha_timbrado", "-fecha_emision", "-id")
    )
    for invoice in invoices:
        latest_by_account.setdefault(invoice.cuenta_por_cobrar_id, invoice)
    return {
        account_id: serialize_cxc_invoice_summary(invoice)
        for account_id, invoice in latest_by_account.items()
    }


def attach_cxc_invoice_summaries(rows: list[dict]) -> list[dict]:
    account_ids: set[int] = set()
    for row in rows:
        if row.get("tipo_fila") == "AGRUPADA":
            account_ids.update(
                int(item["id"]) for item in row.get("cuentas", []) if item.get("id")
            )
            continue
        if row.get("id") and int(row["id"]) > 0:
            account_ids.add(int(row["id"]))

    invoice_map = build_cxc_invoice_summary_map(account_ids)
    for row in rows:
        if row.get("tipo_fila") == "AGRUPADA":
            for item in row.get("cuentas", []):
                item["factura"] = invoice_map.get(int(item["id"]))
            row["factura"] = None
            continue
        if row.get("id") and int(row["id"]) > 0:
            row["factura"] = invoice_map.get(int(row["id"]))
    return rows


def build_cxc_row(
    cuenta: CuentaPorCobrar,
    *,
    today: date,
    interest_context: dict[str, object],
    include_invoice: bool = True,
) -> dict:
    saldo_base = cuenta.saldo_pendiente
    grace_days = resolve_grace_days_for_account(cuenta)
    grace_limit = cuenta.fecha_vencimiento + timedelta(days=grace_days)
    days_overdue = max((today - cuenta.fecha_vencimiento).days, 0)
    days_after_grace = max((today - grace_limit).days, 0)
    interest_rate = (
        clamp_money(interest_context.get("porcentaje"))  # type: ignore[arg-type]
        if days_after_grace > 0 and saldo_base > 0
        else Decimal("0")
    )
    interest_amount = (
        (saldo_base * interest_rate / Decimal("100"))
        if interest_rate > 0
        else Decimal("0")
    )
    total_due = saldo_base + interest_amount

    if saldo_base <= 0 or cuenta.estatus_adeudo == "CONCILIADO":
        category = "PAGADA"
    elif days_after_grace > 0:
        category = "VENCIDA_CON_RECARGO"
    elif days_overdue > 0:
        category = "EN_GRACIA"
    else:
        category = "POR_VENCER"

    entidad = cuenta.entidad_relacionada or cuenta.cliente_relacionado.entidad_relacionada
    return {
        "id": cuenta.id,
        "entidad_id": entidad.id if entidad else None,
        "entidad_nombre": entidad.nombre_comercial if entidad else "Sin entidad",
        "cliente_id": cuenta.cliente_relacionado_id,
        "cliente_nombre": (
            cuenta.cliente_relacionado.razon_social
            or cuenta.cliente_relacionado.nombre_comercial
            or "Sin nombre"
        ),
        "cliente_identificador": cuenta.cliente_relacionado.identificador,
        "concepto": cuenta.concepto,
        "origen": cuenta.origen,
        "periodicidad": cuenta.periodicidad,
        "fecha_periodo_inicio": cuenta.fecha_periodo_inicio,
        "fecha_periodo_fin": cuenta.fecha_periodo_fin,
        "fecha_vencimiento": cuenta.fecha_vencimiento,
        "dias_gracia": grace_days,
        "fecha_limite_gracia": grace_limit,
        "dias_atraso": days_overdue,
        "dias_atraso_post_gracia": days_after_grace,
        "monto_base": decimal_to_float(saldo_base),
        "monto_original": decimal_to_float(cuenta.monto_total),
        "monto_pagado": decimal_to_float(cuenta.monto_pagado),
        "interes_nombre": interest_context.get("nombre"),
        "interes_porcentaje": decimal_to_float(interest_rate),
        "interes_monto": decimal_to_float(interest_amount),
        "total_a_pagar": decimal_to_float(total_due),
        "estatus": cxc_status_for_summary(cuenta, today),
        "categoria_tablero": category,
        "referencia_unica": cuenta.referencia_unica,
        "factura": cxc_invoice_summary(cuenta) if include_invoice else None,
    }


def build_cxc_rows_from_accounts(
    cuentas: list[CuentaPorCobrar],
    *,
    today: date,
    include_invoice: bool = False,
) -> list[dict]:
    entity_map: dict[int, EntidadNegocio] = {}
    for cuenta in cuentas:
        entidad = cuenta.entidad_relacionada or cuenta.cliente_relacionado.entidad_relacionada
        if entidad:
            entity_map[entidad.id] = entidad
    entity_interest_map = resolve_interest_rules_for_entities(list(entity_map.values()))

    rows: list[dict] = []
    for cuenta in cuentas:
        entidad = cuenta.entidad_relacionada or cuenta.cliente_relacionado.entidad_relacionada
        entidad_key = entidad.id if entidad else 0
        rows.append(
            build_cxc_row(
                cuenta,
                today=today,
                interest_context=entity_interest_map.get(
                    entidad_key,
                    default_interest_context(),
                ),
                include_invoice=include_invoice,
            )
        )
    return rows


COMPACT_CXC_METRIC_FIELDS = (
    "id",
    "entidad_relacionada_id",
    "entidad_relacionada__nombre_comercial",
    "entidad_relacionada__capa_negocio__dias_gracia_default",
    "cliente_relacionado_id",
    "cliente_relacionado__razon_social",
    "cliente_relacionado__nombre_comercial",
    "cliente_relacionado__dias_gracia",
    "cliente_relacionado__entidad_relacionada_id",
    "cliente_relacionado__entidad_relacionada__nombre_comercial",
    "cliente_relacionado__entidad_relacionada__capa_negocio__dias_gracia_default",
    "fecha_periodo_inicio",
    "fecha_vencimiento",
    "monto_total",
    "monto_pagado",
    "estatus_adeudo",
)


def compact_cxc_entity_id(row: dict) -> int | None:
    return row["entidad_relacionada_id"] or row[
        "cliente_relacionado__entidad_relacionada_id"
    ]


def compact_cxc_entity_name(row: dict) -> str:
    return (
        row["entidad_relacionada__nombre_comercial"]
        or row["cliente_relacionado__entidad_relacionada__nombre_comercial"]
        or "Sin entidad"
    )


def compact_cxc_client_name(row: dict) -> str:
    return (
        row["cliente_relacionado__razon_social"]
        or row["cliente_relacionado__nombre_comercial"]
        or "Sin nombre"
    )


def compact_cxc_grace_days(row: dict) -> int:
    client_days = row["cliente_relacionado__dias_gracia"] or 0
    if client_days > 0:
        return client_days
    default_days = (
        row["entidad_relacionada__capa_negocio__dias_gracia_default"]
        if row["entidad_relacionada_id"]
        else row[
            "cliente_relacionado__entidad_relacionada__capa_negocio__dias_gracia_default"
        ]
    )
    return max(default_days or 0, 0)


def compact_cxc_financial_context(
    row: dict,
    *,
    today: date,
    entity_interest_map: dict[int, dict[str, object]],
) -> dict[str, object]:
    entity_id = compact_cxc_entity_id(row)
    monto_original = clamp_money(row["monto_total"])
    monto_pagado = clamp_money(row["monto_pagado"])
    saldo_base = max(monto_original - monto_pagado, Decimal("0"))
    due_date = row["fecha_vencimiento"]
    grace_days = compact_cxc_grace_days(row)
    grace_limit = due_date + timedelta(days=grace_days)
    days_overdue = max((today - due_date).days, 0)
    days_after_grace = max((today - grace_limit).days, 0)
    interest_context = entity_interest_map.get(
        entity_id or 0,
        default_interest_context(),
    )
    interest_rate = (
        clamp_money(interest_context.get("porcentaje"))  # type: ignore[arg-type]
        if days_after_grace > 0 and saldo_base > 0
        else Decimal("0")
    )
    interest_amount = (
        (saldo_base * interest_rate / Decimal("100"))
        if interest_rate > 0
        else Decimal("0")
    )
    total_due = saldo_base + interest_amount

    if saldo_base <= 0 or row["estatus_adeudo"] == "CONCILIADO":
        category = "PAGADA"
    elif days_after_grace > 0:
        category = "VENCIDA_CON_RECARGO"
    elif days_overdue > 0:
        category = "EN_GRACIA"
    else:
        category = "POR_VENCER"

    return {
        "entity_id": entity_id,
        "monto_original": monto_original,
        "monto_pagado": monto_pagado,
        "saldo_base": saldo_base,
        "due_date": due_date,
        "days_after_grace": days_after_grace,
        "interest_amount": interest_amount,
        "total_due": total_due,
        "category": category,
    }


def resolve_compact_cxc_interest_map(queryset) -> dict[int, dict[str, object]]:
    entity_ids: set[int] = set()
    for row in queryset.values(
        "entidad_relacionada_id",
        "cliente_relacionado__entidad_relacionada_id",
    ).distinct():
        entity_id = row["entidad_relacionada_id"] or row[
            "cliente_relacionado__entidad_relacionada_id"
        ]
        if entity_id:
            entity_ids.add(entity_id)
    entities = list(
        EntidadNegocio.objects.select_related("capa_negocio").filter(id__in=entity_ids)
    )
    return resolve_interest_rules_for_entities(entities)


def collect_compact_cxc_account_ids_by_status(
    queryset,
    *,
    today: date,
    status: str,
) -> list[int]:
    entity_interest_map = resolve_compact_cxc_interest_map(queryset)
    account_ids: list[int] = []
    for row in queryset.values(*COMPACT_CXC_METRIC_FIELDS).iterator(chunk_size=1000):
        context = compact_cxc_financial_context(
            row,
            today=today,
            entity_interest_map=entity_interest_map,
        )
        if context["category"] == status:
            account_ids.append(int(row["id"]))
    return account_ids


COMPACT_CXC_GROUP_FIELDS = (
    "id",
    "entidad_relacionada_id",
    "cliente_relacionado_id",
    "cliente_relacionado__entidad_relacionada_id",
)


def collect_compact_cxc_space_groups(queryset) -> list[dict[str, object]]:
    grouped: dict[tuple[object, str], list[int]] = {}
    for row in queryset.values(*COMPACT_CXC_GROUP_FIELDS).iterator(chunk_size=1000):
        entity_id = compact_cxc_entity_id(row)
        group_key = (entity_id, f"cliente-{row['cliente_relacionado_id']}")
        grouped.setdefault(group_key, []).append(int(row["id"]))
    return [
        {"group_key": group_key, "account_ids": account_ids}
        for group_key, account_ids in grouped.items()
    ]


def build_compact_cxc_metrics(
    queryset,
    *,
    today: date,
) -> tuple[dict[str, object], list[tuple[int, str]], list[tuple[int, str]]]:
    def empty_bucket() -> dict[str, Decimal | int]:
        return {
            "count": 0,
            "base": Decimal("0"),
            "interes": Decimal("0"),
            "total": Decimal("0"),
        }

    def empty_month_bucket() -> dict[str, object]:
        return {
            "cuentas": 0,
            "clientes": set(),
            "pagadas": 0,
            "abiertas": 0,
            "cargos": Decimal("0"),
            "cobrado": Decimal("0"),
            "saldo": Decimal("0"),
            "recargos": Decimal("0"),
            "exigible": Decimal("0"),
            "facturado": Decimal("0"),
        }

    def month_key(fecha_periodo_inicio: date | None, fecha_vencimiento: date | None) -> str:
        value = fecha_periodo_inicio or fecha_vencimiento
        if isinstance(value, date):
            return value.strftime("%Y-%m")
        return "Sin periodo"

    metric_totals = {
        "registros": 0,
        "clientes": set(),
        "pagadas": empty_bucket(),
        "vencidas": empty_bucket(),
        "en_gracia": empty_bucket(),
        "por_vencer": empty_bucket(),
        "totales": {
            "cargos": Decimal("0"),
            "cobrado": Decimal("0"),
            "saldo": Decimal("0"),
            "recargos": Decimal("0"),
            "exigible": Decimal("0"),
            "facturado": Decimal("0"),
            "cuentas_abiertas": 0,
            "cuentas_pagadas": 0,
        },
    }
    monthly: dict[str, dict[str, object]] = {}
    aging_buckets = empty_aging_buckets()
    open_debtors: dict[int, dict[str, object]] = {}
    entity_options: set[tuple[int, str]] = set()
    client_options: set[tuple[int, str]] = set()
    entity_interest_map = resolve_compact_cxc_interest_map(queryset)

    for row in queryset.values(*COMPACT_CXC_METRIC_FIELDS).iterator(chunk_size=1000):
        entity_id = compact_cxc_entity_id(row)
        entity_name = compact_cxc_entity_name(row)
        client_id = int(row["cliente_relacionado_id"])
        client_name = compact_cxc_client_name(row)
        monto_original = clamp_money(row["monto_total"])
        monto_pagado = clamp_money(row["monto_pagado"])
        saldo_base = max(monto_original - monto_pagado, Decimal("0"))
        due_date = row["fecha_vencimiento"]
        grace_days = compact_cxc_grace_days(row)
        grace_limit = due_date + timedelta(days=grace_days)
        days_overdue = max((today - due_date).days, 0)
        days_after_grace = max((today - grace_limit).days, 0)
        interest_context = entity_interest_map.get(
            entity_id or 0,
            default_interest_context(),
        )
        interest_rate = (
            clamp_money(interest_context.get("porcentaje"))  # type: ignore[arg-type]
            if days_after_grace > 0 and saldo_base > 0
            else Decimal("0")
        )
        interest_amount = (
            (saldo_base * interest_rate / Decimal("100"))
            if interest_rate > 0
            else Decimal("0")
        )
        total_due = saldo_base + interest_amount

        if saldo_base <= 0 or row["estatus_adeudo"] == "CONCILIADO":
            category = "PAGADA"
        elif days_after_grace > 0:
            category = "VENCIDA_CON_RECARGO"
        elif days_overdue > 0:
            category = "EN_GRACIA"
        else:
            category = "POR_VENCER"

        bucket_name = (
            "pagadas"
            if category == "PAGADA"
            else "vencidas"
            if category == "VENCIDA_CON_RECARGO"
            else "en_gracia"
            if category == "EN_GRACIA"
            else "por_vencer"
        )
        bucket = metric_totals[bucket_name]
        bucket["count"] += 1
        bucket["base"] += saldo_base
        bucket["interes"] += interest_amount
        bucket["total"] += total_due

        is_paid = category == "PAGADA"
        metric_totals["registros"] += 1
        metric_totals["clientes"].add(client_id)  # type: ignore[union-attr]
        if entity_id:
            entity_options.add((entity_id, entity_name))
        client_options.add((client_id, client_name))

        totals = metric_totals["totales"]
        totals["cargos"] += monto_original
        totals["cobrado"] += monto_pagado
        totals["saldo"] += saldo_base
        totals["recargos"] += interest_amount
        totals["exigible"] += total_due
        totals["cuentas_pagadas"] += 1 if is_paid else 0
        totals["cuentas_abiertas"] += 0 if is_paid else 1
        if not is_paid:
            add_aging_balance(
                aging_buckets,
                due_date=due_date,
                today=today,
                saldo=saldo_base,
                recargos=interest_amount,
            )

        period = month_key(row["fecha_periodo_inicio"], due_date)
        month_bucket = monthly.setdefault(period, empty_month_bucket())
        month_bucket["cuentas"] += 1
        month_bucket["clientes"].add(client_id)  # type: ignore[union-attr]
        month_bucket["pagadas"] += 1 if is_paid else 0
        month_bucket["abiertas"] += 0 if is_paid else 1
        month_bucket["cargos"] += monto_original
        month_bucket["cobrado"] += monto_pagado
        month_bucket["saldo"] += saldo_base
        month_bucket["recargos"] += interest_amount
        month_bucket["exigible"] += total_due

        if not is_paid:
            debtor = open_debtors.setdefault(
                client_id,
                {
                    "cliente_id": client_id,
                    "cliente_nombre": client_name,
                    "entidad_nombre": entity_name,
                    "total_a_pagar": Decimal("0"),
                    "cuentas": 0,
                    "dias_atraso_post_gracia": 0,
                    "fecha_vencimiento": due_date,
                },
            )
            debtor["total_a_pagar"] = Decimal(str(debtor["total_a_pagar"])) + total_due
            debtor["cuentas"] = int(debtor["cuentas"]) + 1
            debtor["dias_atraso_post_gracia"] = max(
                int(debtor["dias_atraso_post_gracia"]),
                days_after_grace,
            )
            current_due_date = debtor.get("fecha_vencimiento")
            if due_date and (not current_due_date or due_date < current_due_date):
                debtor["fecha_vencimiento"] = due_date

    top_debtors = [
        {
            **debtor,
            "total_a_pagar": decimal_to_float(Decimal(str(debtor["total_a_pagar"]))),
        }
        for debtor in sorted(
            open_debtors.values(),
            key=lambda item: Decimal(str(item["total_a_pagar"])),
            reverse=True,
        )[:6]
    ]

    metrics = {
        "registros": metric_totals["registros"],
        "clientes": len(metric_totals["clientes"]),
        "totales": {
            "cargos": decimal_to_float(metric_totals["totales"]["cargos"]),
            "cobrado": decimal_to_float(metric_totals["totales"]["cobrado"]),
            "saldo": decimal_to_float(metric_totals["totales"]["saldo"]),
            "recargos": decimal_to_float(metric_totals["totales"]["recargos"]),
            "exigible": decimal_to_float(metric_totals["totales"]["exigible"]),
            "facturado": decimal_to_float(metric_totals["totales"]["facturado"]),
            "cuentas_abiertas": metric_totals["totales"]["cuentas_abiertas"],
            "cuentas_pagadas": metric_totals["totales"]["cuentas_pagadas"],
        },
        "antiguedad_saldo": serialize_aging_buckets(aging_buckets),
        "por_mes": [
            {
                "periodo": period,
                "cuentas": bucket["cuentas"],
                "clientes": len(bucket["clientes"]),  # type: ignore[arg-type]
                "pagadas": bucket["pagadas"],
                "abiertas": bucket["abiertas"],
                "cargos": decimal_to_float(bucket["cargos"]),  # type: ignore[arg-type]
                "cobrado": decimal_to_float(bucket["cobrado"]),  # type: ignore[arg-type]
                "saldo": decimal_to_float(bucket["saldo"]),  # type: ignore[arg-type]
                "recargos": decimal_to_float(bucket["recargos"]),  # type: ignore[arg-type]
                "exigible": decimal_to_float(bucket["exigible"]),  # type: ignore[arg-type]
                "facturado": decimal_to_float(bucket["facturado"]),  # type: ignore[arg-type]
            }
            for period, bucket in sorted(monthly.items(), reverse=True)
        ],
        "pagadas": {
            "count": metric_totals["pagadas"]["count"],
            "base": decimal_to_float(metric_totals["pagadas"]["base"]),
            "interes": decimal_to_float(metric_totals["pagadas"]["interes"]),
            "total": decimal_to_float(metric_totals["pagadas"]["total"]),
        },
        "vencidas": {
            "count": metric_totals["vencidas"]["count"],
            "base": decimal_to_float(metric_totals["vencidas"]["base"]),
            "interes": decimal_to_float(metric_totals["vencidas"]["interes"]),
            "total": decimal_to_float(metric_totals["vencidas"]["total"]),
        },
        "en_gracia": {
            "count": metric_totals["en_gracia"]["count"],
            "base": decimal_to_float(metric_totals["en_gracia"]["base"]),
            "interes": decimal_to_float(metric_totals["en_gracia"]["interes"]),
            "total": decimal_to_float(metric_totals["en_gracia"]["total"]),
        },
        "por_vencer": {
            "count": metric_totals["por_vencer"]["count"],
            "base": decimal_to_float(metric_totals["por_vencer"]["base"]),
            "interes": decimal_to_float(metric_totals["por_vencer"]["interes"]),
            "total": decimal_to_float(metric_totals["por_vencer"]["total"]),
        },
        "deudores_principales": top_debtors,
    }
    return (
        metrics,
        sorted(entity_options, key=lambda item: item[1]),
        sorted(client_options, key=lambda item: item[1]),
    )


def group_cxc_rows_by_space(rows: list[dict]) -> list[dict]:
    grouped: dict[tuple[object, str], list[dict]] = {}
    ordered_keys: list[tuple[object, str]] = []

    for row in rows:
        space_key = row.get("espacio_codigo") or f"sin-espacio-{row['cliente_id']}-{row['id']}"
        group_key = (row.get("entidad_id"), str(space_key))
        if group_key not in grouped:
            grouped[group_key] = []
            ordered_keys.append(group_key)
        grouped[group_key].append(row)

    output_rows: list[dict] = []
    priority = {
        "PAGADA": 0,
        "POR_VENCER": 1,
        "EN_GRACIA": 2,
        "VENCIDA_CON_RECARGO": 3,
    }

    for group_key in ordered_keys:
        group_rows = grouped[group_key]
        if len(group_rows) == 1:
            output_rows.append({**group_rows[0], "tipo_fila": "CUENTA"})
            continue

        ordered_group_rows = sorted(
            group_rows,
            key=lambda row: (
                row.get("fecha_periodo_inicio") or row.get("fecha_vencimiento"),
                row["id"],
            ),
            reverse=True,
        )
        first = ordered_group_rows[0]
        category = max(
            (row["categoria_tablero"] for row in ordered_group_rows),
            key=lambda item: priority.get(item, 0),
        )
        client_ids = {row["cliente_id"] for row in ordered_group_rows}
        client_names = sorted({row["cliente_nombre"] for row in ordered_group_rows})
        period_starts = [
            row.get("fecha_periodo_inicio") or row.get("fecha_vencimiento")
            for row in ordered_group_rows
        ]
        period_ends = [
            row.get("fecha_periodo_fin") or row.get("fecha_vencimiento")
            for row in ordered_group_rows
        ]
        due_dates = [row.get("fecha_vencimiento") for row in ordered_group_rows]
        grace_limits = [row.get("fecha_limite_gracia") for row in ordered_group_rows]
        paid_count = sum(
            1 for row in ordered_group_rows if row["categoria_tablero"] == "PAGADA"
        )
        open_count = len(ordered_group_rows) - paid_count

        output_rows.append(
            {
                **first,
                "id": -(len(output_rows) + 1),
                "tipo_fila": "AGRUPADA",
                "group_key": f"espacio:{group_key[0]}:{group_key[1]}",
                "cuentas": ordered_group_rows,
                "cuentas_count": len(ordered_group_rows),
                "clientes_count": len(client_ids),
                "periodos_count": len(
                    {
                        (
                            row.get("fecha_periodo_inicio"),
                            row.get("fecha_periodo_fin"),
                        )
                        for row in ordered_group_rows
                    }
                ),
                "cliente_id": first["cliente_id"],
                "cliente_nombre": (
                    client_names[0] if len(client_names) == 1 else f"{len(client_names)} clientes"
                ),
                "cliente_identificador": (
                    first.get("cliente_identificador") if len(client_ids) == 1 else None
                ),
                "concepto": f"{len(ordered_group_rows)} cuentas por cobrar",
                "origen": "HISTORICO",
                "periodicidad": "VARIOS",
                "fecha_periodo_inicio": min(period_starts),
                "fecha_periodo_fin": max(period_ends),
                "fecha_vencimiento": max(due_dates),
                "fecha_limite_gracia": max(grace_limits),
                "dias_gracia": max(row["dias_gracia"] for row in ordered_group_rows),
                "dias_atraso": max(row["dias_atraso"] for row in ordered_group_rows),
                "dias_atraso_post_gracia": max(
                    row["dias_atraso_post_gracia"] for row in ordered_group_rows
                ),
                "monto_base": decimal_to_float(
                    sum(Decimal(str(row["monto_base"])) for row in ordered_group_rows)
                ),
                "monto_original": decimal_to_float(
                    sum(Decimal(str(row["monto_original"])) for row in ordered_group_rows)
                ),
                "monto_pagado": decimal_to_float(
                    sum(Decimal(str(row["monto_pagado"])) for row in ordered_group_rows)
                ),
                "interes_monto": decimal_to_float(
                    sum(Decimal(str(row["interes_monto"])) for row in ordered_group_rows)
                ),
                "total_a_pagar": decimal_to_float(
                    sum(Decimal(str(row["total_a_pagar"])) for row in ordered_group_rows)
                ),
                "estatus": f"{open_count} abiertas / {paid_count} pagadas",
                "categoria_tablero": category,
                "referencia_unica": f"ESPACIO:{group_key[0]}:{group_key[1]}",
                "factura": None,
            }
        )

    return output_rows


def serialize_cxc_followup(history: HistorialEnvio, *, today: date, linked_by: str) -> dict:
    elapsed_days = max((today - history.fecha_envio.date()).days, 0)
    if history.estatus in {"ERROR", "ERROR_SPAM"}:
        status = "ERROR"
        action = "Revisar error y reintentar aviso."
    elif history.estatus == "OMITIDO":
        status = "OMITIDO"
        action = "Completar canal de contacto o revisar regla."
    elif elapsed_days >= 3:
        status = "REQUIERE_SEGUIMIENTO"
        action = "Dar seguimiento si no hay pago aplicado."
    else:
        status = "AVISO_RECIENTE"
        action = "Esperar respuesta o comprobante."
    return {
        "estado": status,
        "accion": action,
        "vinculo": linked_by,
        "ultimo_envio": {
            "id": history.id,
            "canal": history.canal,
            "proveedor": history.proveedor,
            "estatus": history.estatus,
            "fecha": history.fecha_envio,
            "automatizacion": history.automatizacion_relacionada.nombre
            if history.automatizacion_relacionada
            else None,
            "plantilla": history.plantilla_usada.nombre if history.plantilla_usada else None,
            "detalle": (history.metadata or {}).get("error")
            or (history.metadata or {}).get("reason")
            or (history.metadata or {}).get("motivo"),
        },
    }


def empty_cxc_followup() -> dict:
    return {
        "estado": "SIN_AVISO",
        "accion": "Preparar primer aviso de cobranza.",
        "vinculo": "ninguno",
        "ultimo_envio": None,
    }


def build_cxc_followup_map(account_rows: list[dict], *, today: date) -> dict[int, dict]:
    account_ids = {int(row["id"]) for row in account_rows if row.get("tipo_fila") != "ESPACIO" and row.get("id")}
    client_ids = {int(row["cliente_id"]) for row in account_rows if row.get("cliente_id")}
    if not account_ids and not client_ids:
        return {}
    latest_by_client: dict[int, HistorialEnvio] = {}
    latest_by_account: dict[int, HistorialEnvio] = {}
    histories = (
        HistorialEnvio.objects.select_related("automatizacion_relacionada", "plantilla_usada")
        .filter(cliente_relacionado_id__in=client_ids, tipo_envio="AUTOMATICO")
        .order_by("-fecha_envio", "-id")[: max(len(client_ids) * 3, 20)]
    )
    for history in histories:
        latest_by_client.setdefault(history.cliente_relacionado_id, history)
        metadata = history.metadata or {}
        linked_ids = set()
        for raw_id in metadata.get("cxc_ids") or []:
            try:
                linked_ids.add(int(raw_id))
            except (TypeError, ValueError):
                continue
        try:
            if metadata.get("primary_cxc_id"):
                linked_ids.add(int(metadata["primary_cxc_id"]))
        except (TypeError, ValueError):
            pass
        for account_id in linked_ids & account_ids:
            latest_by_account.setdefault(account_id, history)

    followups: dict[int, dict] = {}
    for row in account_rows:
        if row.get("tipo_fila") == "ESPACIO" or not row.get("id"):
            continue
        account_id = int(row["id"])
        history = latest_by_account.get(account_id)
        if history:
            followups[account_id] = serialize_cxc_followup(history, today=today, linked_by="cuenta")
            continue
        history = latest_by_client.get(int(row["cliente_id"]))
        if not history:
            followups[account_id] = empty_cxc_followup()
            continue
        followups[account_id] = serialize_cxc_followup(history, today=today, linked_by="cliente")
    return followups


def build_global_cxc_dashboard(
    *,
    entidad_id: int | None = None,
    cliente_id: int | None = None,
    status: str | None = None,
    fecha_desde: date | None = None,
    fecha_hasta: date | None = None,
    busqueda: str | None = None,
    page: int = 1,
    page_size: int = 20,
    agrupacion: str | None = None,
    allowed_entity_ids: list[int] | None = None,
    include_items: bool = True,
) -> dict:
    today = timezone.localdate()
    current_month_end = date(
        today.year,
        today.month,
        monthrange(today.year, today.month)[1],
    )
    queryset = (
        CuentaPorCobrar.objects.select_related(
            "cliente_relacionado",
            "entidad_relacionada",
            "entidad_relacionada__capa_negocio",
            "cliente_relacionado__entidad_relacionada",
            "cliente_relacionado__entidad_relacionada__capa_negocio",
        )
        .order_by("fecha_vencimiento", "id")
    )
    if allowed_entity_ids is not None:
        queryset = queryset.filter(
            Q(entidad_relacionada_id__in=allowed_entity_ids)
            | Q(
                entidad_relacionada__isnull=True,
                cliente_relacionado__entidad_relacionada_id__in=allowed_entity_ids,
            )
        )

    if entidad_id:
        queryset = queryset.filter(
            Q(entidad_relacionada_id=entidad_id)
            | Q(
                entidad_relacionada__isnull=True,
                cliente_relacionado__entidad_relacionada_id=entidad_id,
            )
        )
    if cliente_id:
        queryset = queryset.filter(cliente_relacionado_id=cliente_id)

    queryset = queryset.filter(
        Q(fecha_periodo_inicio__lte=current_month_end)
        | Q(fecha_periodo_inicio__isnull=True, fecha_vencimiento__lte=current_month_end)
    )

    if fecha_desde:
        queryset = queryset.filter(
            Q(fecha_periodo_fin__gte=fecha_desde)
            | Q(fecha_periodo_fin__isnull=True, fecha_vencimiento__gte=fecha_desde)
        )
    if fecha_hasta:
        queryset = queryset.filter(
            Q(fecha_periodo_inicio__lte=fecha_hasta)
            | Q(fecha_periodo_inicio__isnull=True, fecha_vencimiento__lte=fecha_hasta)
        )
    if busqueda:
        queryset = queryset.filter(
            Q(cliente_relacionado__razon_social__icontains=busqueda)
            | Q(cliente_relacionado__nombre_comercial__icontains=busqueda)
            | Q(cliente_relacionado__identificador__icontains=busqueda)
            | Q(concepto__icontains=busqueda)
        )

    filtered_account_ids = (
        collect_compact_cxc_account_ids_by_status(queryset, today=today, status=status)
        if status
        else None
    )
    filtered_queryset = (
        queryset.filter(id__in=filtered_account_ids)
        if filtered_account_ids is not None
        else queryset
    )
    metrics, entities, clients = build_compact_cxc_metrics(filtered_queryset, today=today)
    total = int(metrics["registros"])
    safe_page_size = min(max(page_size, 10), 100)
    total_pages = max((total + safe_page_size - 1) // safe_page_size, 1)
    current_page = min(max(page, 1), total_pages)
    paginated_rows: list[dict] = []

    if include_items and agrupacion == "espacio":
        space_groups = collect_compact_cxc_space_groups(filtered_queryset)
        total = len(space_groups)
        total_pages = max((total + safe_page_size - 1) // safe_page_size, 1)
        current_page = min(max(page, 1), total_pages)
        start = (current_page - 1) * safe_page_size
        page_groups = space_groups[start : start + safe_page_size]
        page_account_ids = [
            account_id
            for group in page_groups
            for account_id in group["account_ids"]  # type: ignore[union-attr]
        ]
        page_accounts = (
            list(filtered_queryset.filter(id__in=page_account_ids))
            if page_account_ids
            else []
        )
        page_rows = build_cxc_rows_from_accounts(
            page_accounts,
            today=today,
            include_invoice=False,
        )
        paginated_rows = group_cxc_rows_by_space(page_rows)
        followup_map = build_cxc_followup_map(paginated_rows, today=today)
        paginated_rows = [
            {
                **row,
                "seguimiento_cobranza": followup_map.get(
                    row.get("id"),
                    empty_cxc_followup(),
                ),
            }
            for row in paginated_rows
        ]
        paginated_rows = attach_cxc_invoice_summaries(paginated_rows)
    elif include_items:
        start = (current_page - 1) * safe_page_size
        if filtered_account_ids is not None:
            page_account_ids = filtered_account_ids[start : start + safe_page_size]
            page_accounts = (
                list(filtered_queryset.filter(id__in=page_account_ids))
                if page_account_ids
                else []
            )
        else:
            page_accounts = list(filtered_queryset[start : start + safe_page_size])
        paginated_rows = build_cxc_rows_from_accounts(
            page_accounts,
            today=today,
            include_invoice=False,
        )
        followup_map = build_cxc_followup_map(paginated_rows, today=today)
        paginated_rows = [
            {
                **row,
                "seguimiento_cobranza": followup_map.get(
                    row.get("id"),
                    empty_cxc_followup(),
                ),
            }
            for row in paginated_rows
        ]
        paginated_rows = attach_cxc_invoice_summaries(paginated_rows)

    if status:
        paginated_rows = [
            row
            for row in paginated_rows
            if row.get("categoria_tablero") == status or row.get("tipo_fila") == "AGRUPADA"
        ]

    return {
        "fecha_referencia": today,
        "filtros": {
            "entidad_id": entidad_id,
            "cliente_id": cliente_id,
            "status": status,
            "fecha_desde": fecha_desde,
            "fecha_hasta": fecha_hasta,
            "busqueda": busqueda or "",
            "agrupacion": agrupacion or "",
        },
        "metricas": metrics,
        "entidades": [
            {"id": entity_id, "nombre": entity_name} for entity_id, entity_name in entities
        ],
        "clientes": [
            {"id": client_id, "nombre": client_name} for client_id, client_name in clients
        ],
        "page": current_page,
        "page_size": safe_page_size,
        "total": total,
        "total_pages": total_pages,
        "items": paginated_rows,
    }


def build_cxc_customer_detail(
    *,
    cliente_id: int,
    entidad_id: int | None = None,
    fecha_desde: date | None = None,
    fecha_hasta: date | None = None,
    allowed_entity_ids: list[int] | None = None,
) -> dict:
    today = timezone.localdate()
    cliente_queryset = Cliente.objects.select_related("entidad_relacionada").filter(id=cliente_id)
    if allowed_entity_ids is not None:
        cliente_queryset = cliente_queryset.filter(
            entidad_relacionada_id__in=allowed_entity_ids
        )
    cliente = cliente_queryset.first()
    if not cliente:
        raise ValueError("El cliente solicitado no existe.")

    queryset = CuentaPorCobrar.objects.select_related(
        "cliente_relacionado",
        "entidad_relacionada",
        "entidad_relacionada__capa_negocio",
        "cliente_relacionado__entidad_relacionada",
        "cliente_relacionado__entidad_relacionada__capa_negocio",
    ).prefetch_related(
        cxc_invoice_summary_prefetch(),
        valid_cxc_payment_prefetch(),
    ).filter(cliente_relacionado_id=cliente_id).order_by(
        "fecha_vencimiento",
        "id",
    )
    if allowed_entity_ids is not None:
        queryset = queryset.filter(
            Q(entidad_relacionada_id__in=allowed_entity_ids)
            | Q(
                entidad_relacionada__isnull=True,
                cliente_relacionado__entidad_relacionada_id__in=allowed_entity_ids,
            )
        )

    if entidad_id:
        queryset = queryset.filter(
            Q(entidad_relacionada_id=entidad_id)
            | Q(
                entidad_relacionada__isnull=True,
                cliente_relacionado__entidad_relacionada_id=entidad_id,
            )
        )
    if fecha_desde:
        queryset = queryset.filter(
            Q(fecha_periodo_fin__gte=fecha_desde)
            | Q(fecha_periodo_fin__isnull=True, fecha_vencimiento__gte=fecha_desde)
        )
    if fecha_hasta:
        queryset = queryset.filter(
            Q(fecha_periodo_inicio__lte=fecha_hasta)
            | Q(fecha_periodo_inicio__isnull=True, fecha_vencimiento__lte=fecha_hasta)
        )

    cuentas = list(queryset)
    entity_map: dict[int, EntidadNegocio] = {}
    for cuenta in cuentas:
        entidad = cuenta.entidad_relacionada or cuenta.cliente_relacionado.entidad_relacionada
        if entidad:
            entity_map[entidad.id] = entidad
    entity_interest_map = resolve_interest_rules_for_entities(list(entity_map.values()))

    detail_rows: list[dict] = []
    behavior_counts = {
        "PAGADA_A_TIEMPO": 0,
        "PAGADA_EN_GRACIA": 0,
        "PAGADA_TARDE": 0,
        "ABIERTA_POR_VENCER": 0,
        "ABIERTA_EN_GRACIA": 0,
        "ABIERTA_VENCIDA": 0,
    }
    trend_map: dict[date, dict[str, Decimal | str]] = {}

    total_facturado = Decimal("0")
    total_pagado = Decimal("0")
    total_pendiente = Decimal("0")
    total_recargos = Decimal("0")

    for cuenta in cuentas:
        entidad = cuenta.entidad_relacionada or cuenta.cliente_relacionado.entidad_relacionada
        entidad_key = entidad.id if entidad else 0

        row = build_cxc_row(
            cuenta,
            today=today,
            interest_context=entity_interest_map.get(
                entidad_key,
                default_interest_context(),
            ),
        )
        behavior, _, _, paid_in_full_date = classify_cxc_behavior(cuenta, today=today)
        behavior_counts[behavior] += 1

        row["comportamiento_pago"] = behavior
        row["fecha_liquidacion"] = paid_in_full_date
        detail_rows.append(row)

        total_facturado += Decimal(str(row["monto_original"]))
        total_pagado += Decimal(str(row["monto_pagado"]))
        total_pendiente += Decimal(str(row["monto_base"]))
        total_recargos += Decimal(str(row["interes_monto"]))

        period_anchor = cuenta.fecha_periodo_inicio or cuenta.fecha_vencimiento
        month_key = period_anchor.replace(day=1)
        if month_key not in trend_map:
            trend_map[month_key] = {
                "periodo": month_key,
                "label": f"{MONTH_LABELS_ES[month_key.month - 1]} {month_key.year}",
                "facturado": Decimal("0"),
                "pagado": Decimal("0"),
                "pendiente": Decimal("0"),
            }
        trend_map[month_key]["facturado"] += Decimal(str(row["monto_original"]))
        trend_map[month_key]["pagado"] += Decimal(str(row["monto_pagado"]))
        trend_map[month_key]["pendiente"] += Decimal(str(row["monto_base"]))

    payments_queryset = (
        PagoCuentaPorCobrar.objects.select_related(
            "cuenta_por_cobrar",
            "cuenta_por_cobrar__cliente_relacionado",
            "cuenta_por_cobrar__entidad_relacionada",
            "cuenta_por_cobrar__cliente_relacionado__entidad_relacionada",
        )
        .filter(cuenta_por_cobrar__cliente_relacionado_id=cliente_id)
        .exclude(estatus_validacion="RECHAZADO")
        .order_by("-fecha_pago", "-id")
    )
    if allowed_entity_ids is not None:
        payments_queryset = payments_queryset.filter(
            Q(cuenta_por_cobrar__entidad_relacionada_id__in=allowed_entity_ids)
            | Q(
                cuenta_por_cobrar__entidad_relacionada__isnull=True,
                cuenta_por_cobrar__cliente_relacionado__entidad_relacionada_id__in=allowed_entity_ids,
            )
        )
    if entidad_id:
        payments_queryset = payments_queryset.filter(
            Q(cuenta_por_cobrar__entidad_relacionada_id=entidad_id)
            | Q(
                cuenta_por_cobrar__entidad_relacionada__isnull=True,
                cuenta_por_cobrar__cliente_relacionado__entidad_relacionada_id=entidad_id,
            )
        )
    payment_history = [serialize_payment_cxc(payment) for payment in payments_queryset[:20]]

    score, score_label = score_cxc_behavior(behavior_counts)
    cuentas_liquidadas = (
        behavior_counts["PAGADA_A_TIEMPO"]
        + behavior_counts["PAGADA_EN_GRACIA"]
        + behavior_counts["PAGADA_TARDE"]
    )
    puntualidad = (
        (
            behavior_counts["PAGADA_A_TIEMPO"]
            + behavior_counts["PAGADA_EN_GRACIA"]
        )
        / cuentas_liquidadas
        * 100
        if cuentas_liquidadas
        else 0
    )
    morosidad = (
        (
            behavior_counts["PAGADA_TARDE"]
            + behavior_counts["ABIERTA_VENCIDA"]
        )
        / max(len(detail_rows), 1)
        * 100
        if detail_rows
        else 0
    )
    trend = [
        {
            "periodo": item["periodo"],
            "label": item["label"],
            "facturado": decimal_to_float(item["facturado"]),
            "pagado": decimal_to_float(item["pagado"]),
            "pendiente": decimal_to_float(item["pendiente"]),
        }
        for _, item in sorted(trend_map.items(), key=lambda entry: entry[0])[-6:]
    ]

    entidad = cliente.entidad_relacionada
    return {
        "cliente": {
            "id": cliente.id,
            "nombre": cliente.razon_social or cliente.nombre_comercial or "Sin nombre",
            "identificador": cliente.identificador,
            "rfc": cliente.rfc,
            "entidad_id": entidad.id if entidad else None,
            "entidad_nombre": entidad.nombre_comercial if entidad else "Sin entidad",
        },
        "resumen": {
            "score_pago": score,
            "score_label": score_label,
            "puntualidad_porcentaje": round(puntualidad, 1),
            "morosidad_porcentaje": round(morosidad, 1),
            "cuentas_totales": len(detail_rows),
            "cuentas_liquidadas": cuentas_liquidadas,
            "cuentas_vencidas_abiertas": behavior_counts["ABIERTA_VENCIDA"],
            "cuentas_en_gracia": behavior_counts["ABIERTA_EN_GRACIA"],
            "saldo_vivo": decimal_to_float(total_pendiente),
            "total_facturado": decimal_to_float(total_facturado),
            "total_pagado": decimal_to_float(total_pagado),
            "recargos_activos": decimal_to_float(total_recargos),
        },
        "comportamiento": {
            "pagadas_a_tiempo": behavior_counts["PAGADA_A_TIEMPO"],
            "pagadas_en_gracia": behavior_counts["PAGADA_EN_GRACIA"],
            "pagadas_tarde": behavior_counts["PAGADA_TARDE"],
            "abiertas_por_vencer": behavior_counts["ABIERTA_POR_VENCER"],
            "abiertas_en_gracia": behavior_counts["ABIERTA_EN_GRACIA"],
            "abiertas_vencidas": behavior_counts["ABIERTA_VENCIDA"],
        },
        "tendencia_periodos": trend,
        "pagos_recientes": payment_history,
        "cuentas": detail_rows,
    }


def build_global_cxp_dashboard(
    *,
    entidad_id: int | None = None,
    status: str | None = None,
    categoria: str | None = None,
    fecha_desde: date | None = None,
    fecha_hasta: date | None = None,
    busqueda: str | None = None,
    page: int = 1,
    page_size: int = 20,
    allowed_entity_ids: list[int] | None = None,
    include_items: bool = True,
) -> dict:
    today = timezone.localdate()
    queryset = (
        CuentaPorPagar.objects.select_related(
            "entidad_relacionada",
            "programacion_relacionada",
        )
        .order_by("fecha_vencimiento", "id")
    )
    if allowed_entity_ids is not None:
        queryset = queryset.filter(entidad_relacionada_id__in=allowed_entity_ids)
    if entidad_id:
        queryset = queryset.filter(entidad_relacionada_id=entidad_id)
    if categoria:
        queryset = queryset.filter(categoria=categoria)
    if fecha_desde:
        queryset = queryset.filter(
            Q(fecha_periodo_fin__gte=fecha_desde)
            | Q(fecha_periodo_fin__isnull=True, fecha_vencimiento__gte=fecha_desde)
        )
    if fecha_hasta:
        queryset = queryset.filter(
            Q(fecha_periodo_inicio__lte=fecha_hasta)
            | Q(fecha_periodo_inicio__isnull=True, fecha_vencimiento__lte=fecha_hasta)
        )
    if busqueda:
        queryset = queryset.filter(
            Q(proveedor_nombre__icontains=busqueda)
            | Q(concepto__icontains=busqueda)
        )

    entity_queryset = EntidadNegocio.objects.all()
    if allowed_entity_ids is not None:
        entity_queryset = entity_queryset.filter(id__in=allowed_entity_ids)
    entities = list(entity_queryset.order_by("nombre_comercial").values_list("id", "nombre_comercial"))
    categorias = [choice[0] for choice in ProgramacionCuentaPorPagar.CATEGORIA_CHOICES]

    metrics = {
        "registros": 0,
        "proyectado": Decimal("0"),
        "pagado": Decimal("0"),
        "pendiente": Decimal("0"),
        "vencido": Decimal("0"),
        "por_conciliar": Decimal("0"),
    }
    status_counts: dict[str, int] = {}
    priority_accounts: list[dict[str, object]] = []
    aging_buckets = empty_aging_buckets()
    filtered_accounts: list[CuentaPorPagar] = []
    for cuenta in queryset:
        resolved_status = cxp_status_for_summary(cuenta, today)
        if status and resolved_status != status:
            continue

        filtered_accounts.append(cuenta)
        status_counts[resolved_status] = status_counts.get(resolved_status, 0) + 1
        saldo_pendiente = cuenta.saldo_pendiente
        metrics["proyectado"] += cuenta.monto_total or Decimal("0")
        metrics["pagado"] += cuenta.monto_pagado or Decimal("0")
        if resolved_status == "VENCIDO":
            metrics["vencido"] += saldo_pendiente
        elif resolved_status == "POR_CONCILIAR":
            metrics["por_conciliar"] += saldo_pendiente
        elif resolved_status in {"PENDIENTE", "PARCIAL"}:
            metrics["pendiente"] += saldo_pendiente
        if resolved_status != "PAGADO":
            add_aging_balance(
                aging_buckets,
                due_date=cuenta.fecha_vencimiento,
                today=today,
                saldo=saldo_pendiente,
            )
        if saldo_pendiente > 0:
            priority_accounts.append(
                {
                    "id": cuenta.id,
                    "entidad_id": cuenta.entidad_relacionada_id,
                    "entidad_nombre": cuenta.entidad_relacionada.nombre_comercial,
                    "proveedor_nombre": cuenta.proveedor_nombre,
                    "concepto": cuenta.concepto,
                    "fecha_vencimiento": cuenta.fecha_vencimiento,
                    "saldo_pendiente": decimal_to_float(saldo_pendiente),
                    "estatus": resolved_status,
                    "prioridad": cuenta.prioridad,
                }
            )
    metrics["registros"] = len(filtered_accounts)

    def priority_rank(item: dict[str, object]) -> int:
        status_value = item.get("estatus")
        if status_value == "VENCIDO":
            return 0
        if status_value == "POR_CONCILIAR":
            return 1
        if status_value in {"PENDIENTE", "PARCIAL"}:
            return 2
        return 3

    cuentas_prioritarias = sorted(
        priority_accounts,
        key=lambda item: (
            priority_rank(item),
            item["fecha_vencimiento"],
            -Decimal(str(item["saldo_pendiente"])),
        ),
    )[:6]

    if include_items:
        paginated_accounts, total, total_pages, current_page = resolve_paginated_slice(
            filtered_accounts,
            page=page,
            page_size=page_size,
        )
        items = [serialize_cxp(cuenta, today=today) for cuenta in paginated_accounts]
    else:
        safe_page_size = min(max(page_size, 10), 100)
        total = len(filtered_accounts)
        total_pages = max((total + safe_page_size - 1) // safe_page_size, 1)
        current_page = min(max(page, 1), total_pages)
        items = []

    return {
        "fecha_referencia": today,
        "metricas": {
            "registros": metrics["registros"],
            "proyectado": decimal_to_float(metrics["proyectado"]),
            "pagado": decimal_to_float(metrics["pagado"]),
            "pendiente": decimal_to_float(metrics["pendiente"]),
            "vencido": decimal_to_float(metrics["vencido"]),
            "por_conciliar": decimal_to_float(metrics["por_conciliar"]),
            "antiguedad_saldo": serialize_aging_buckets(aging_buckets),
            "conteo_estatus": status_counts,
            "cuentas_prioritarias": cuentas_prioritarias,
        },
        "entidades": [
            {"id": entity_id, "nombre": entity_name} for entity_id, entity_name in entities
        ],
        "categorias": categorias,
        "page": current_page,
        "page_size": min(max(page_size, 10), 100),
        "total": total,
        "total_pages": total_pages,
        "items": items,
    }


def build_finance_summary(
    entidad: EntidadNegocio,
    *,
    include_cxc: bool = True,
    include_cxp: bool = True,
) -> dict:
    today = timezone.localdate()
    month_start = today.replace(day=1)
    month_end = date(today.year, today.month, monthrange(today.year, today.month)[1])

    cxc_qs = (
        list(
            CuentaPorCobrar.objects.filter(
                Q(entidad_relacionada=entidad)
                | Q(
                    entidad_relacionada__isnull=True,
                    cliente_relacionado__entidad_relacionada=entidad,
                )
            )
            .select_related("cliente_relacionado")
            .order_by("fecha_vencimiento", "id")
        )
        if include_cxc
        else []
    )
    cxp_qs = (
        list(
            CuentaPorPagar.objects.filter(entidad_relacionada=entidad)
            .select_related("programacion_relacionada")
            .order_by("fecha_vencimiento", "id")
        )
        if include_cxp
        else []
    )
    programaciones = (
        list(
            ProgramacionCuentaPorPagar.objects.filter(entidad_relacionada=entidad).order_by(
                "nombre"
            )
        )
        if include_cxp
        else []
    )
    saldos = (
        list(
            SaldoCliente.objects.filter(entidad_relacionada=entidad).select_related(
                "cliente_relacionado"
            )
        )
        if include_cxc
        else []
    )

    cobranza_acumulado = {
        "facturado": Decimal("0"),
        "cobrado": Decimal("0"),
        "pendiente": Decimal("0"),
        "vencido": Decimal("0"),
        "por_conciliar": Decimal("0"),
        "incobrable": Decimal("0"),
    }
    cobranza_mes = {
        "facturado": Decimal("0"),
        "cobrado": Decimal("0"),
        "pendiente": Decimal("0"),
        "vencido": Decimal("0"),
    }
    for cuenta in cxc_qs:
        status = cxc_status_for_summary(cuenta, today)
        total = clamp_money(cuenta.monto_total)
        pagado = clamp_money(cuenta.monto_pagado)
        saldo = cuenta.saldo_pendiente

        if status != "CANCELADO":
            cobranza_acumulado["facturado"] += total
            cobranza_acumulado["cobrado"] += pagado
        if status == "POR_CONCILIAR":
            cobranza_acumulado["por_conciliar"] += saldo
        elif status == "INCOBRABLE":
            cobranza_acumulado["incobrable"] += saldo
        elif status == "VENCIDO":
            cobranza_acumulado["vencido"] += saldo
        elif status in {"PENDIENTE", "PARCIAL", "EN_GRACIA"}:
            cobranza_acumulado["pendiente"] += saldo

        if month_start <= cuenta.fecha_vencimiento <= month_end and status != "CANCELADO":
            cobranza_mes["facturado"] += total
            cobranza_mes["cobrado"] += pagado
            if status == "VENCIDO":
                cobranza_mes["vencido"] += saldo
            elif status in {"PENDIENTE", "PARCIAL", "POR_CONCILIAR", "EN_GRACIA"}:
                cobranza_mes["pendiente"] += saldo

    gastos_acumulado = {
        "proyectado": Decimal("0"),
        "pagado": Decimal("0"),
        "pendiente": Decimal("0"),
        "vencido": Decimal("0"),
        "por_conciliar": Decimal("0"),
    }
    gastos_mes = {
        "proyectado": Decimal("0"),
        "pagado": Decimal("0"),
        "pendiente": Decimal("0"),
        "vencido": Decimal("0"),
        "por_conciliar": Decimal("0"),
    }
    for cuenta in cxp_qs:
        status = cxp_status_for_summary(cuenta, today)
        total = clamp_money(cuenta.monto_total)
        pagado = clamp_money(cuenta.monto_pagado)
        saldo = cuenta.saldo_pendiente

        if status != "CANCELADO":
            gastos_acumulado["proyectado"] += total
            gastos_acumulado["pagado"] += pagado
        if status == "VENCIDO":
            gastos_acumulado["vencido"] += saldo
        elif status == "POR_CONCILIAR":
            gastos_acumulado["por_conciliar"] += saldo
        elif status in {"PENDIENTE", "PARCIAL"}:
            gastos_acumulado["pendiente"] += saldo

        if month_start <= cuenta.fecha_vencimiento <= month_end and status != "CANCELADO":
            gastos_mes["proyectado"] += total
            gastos_mes["pagado"] += pagado
            if status == "VENCIDO":
                gastos_mes["vencido"] += saldo
            elif status == "POR_CONCILIAR":
                gastos_mes["por_conciliar"] += saldo
            elif status in {"PENDIENTE", "PARCIAL"}:
                gastos_mes["pendiente"] += saldo

    saldo_favor_total = sum((clamp_money(item.saldo_a_favor) for item in saldos), Decimal("0"))
    balance = {
        "neto_proyectado_mes": decimal_to_float(
            cobranza_mes["facturado"] - gastos_mes["proyectado"]
        ),
        "neto_real_mes": decimal_to_float(
            cobranza_mes["cobrado"] - gastos_mes["pagado"]
        ),
        "neto_proyectado_acumulado": decimal_to_float(
            cobranza_acumulado["facturado"] - gastos_acumulado["proyectado"]
        ),
        "neto_real_acumulado": decimal_to_float(
            cobranza_acumulado["cobrado"] - gastos_acumulado["pagado"]
        ),
    }

    return {
        "entidad_id": entidad.id,
        "entidad_nombre": entidad.nombre_comercial,
        "fecha_corte_resumen": today,
        "cobranza": {
            "acumulado": {key: decimal_to_float(value) for key, value in cobranza_acumulado.items()},
            "mes_actual": {key: decimal_to_float(value) for key, value in cobranza_mes.items()},
            "saldo_a_favor": decimal_to_float(saldo_favor_total),
        },
        "gastos": {
            "acumulado": {key: decimal_to_float(value) for key, value in gastos_acumulado.items()},
            "mes_actual": {key: decimal_to_float(value) for key, value in gastos_mes.items()},
        },
        "balance": balance,
        "cuentas_por_cobrar": [serialize_cxc(cuenta, today=today) for cuenta in cxc_qs],
        "cuentas_por_pagar": [serialize_cxp(cuenta, today=today) for cuenta in cxp_qs],
        "programaciones_cxp": [serialize_programacion(item) for item in programaciones],
        "saldos_clientes": [
            {
                "cliente_id": saldo.cliente_relacionado_id,
                "cliente_nombre": (
                    saldo.cliente_relacionado.razon_social
                    or saldo.cliente_relacionado.nombre_comercial
                    or "Sin nombre"
                ),
                "saldo_a_favor": decimal_to_float(saldo.saldo_a_favor),
            }
            for saldo in saldos
            if clamp_money(saldo.saldo_a_favor) > 0
        ],
    }
