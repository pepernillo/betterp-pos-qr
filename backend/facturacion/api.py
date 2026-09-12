from __future__ import annotations

import logging
from typing import Optional

from django.db import transaction
from django.db.models import Q
from django.http import Http404, HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST
from ninja import File, Router, Schema
from ninja.errors import HttpError
from ninja.files import UploadedFile

from accounts.security import (
    AccessBearerAuth,
    ROLE_OWNER_ADMIN,
    ensure_membership_for_capa,
    get_accessible_capas_queryset,
    get_allowed_entity_ids,
    get_current_capa,
    require_admin_access,
    require_plan_module,
    require_platform_admin_access,
)
from billing.models import SuscripcionCapa
from core.fiscal import (
    GENERIC_PUBLIC_NAME,
    GENERIC_PUBLIC_REGIME,
    GENERIC_PUBLIC_RFC,
    is_generic_public_rfc,
    normalize_fiscal_regime_code,
)
from finanzas.models import CuentaPorCobrar

from .models import FacturaEmitida
from .services import (
    build_cxc_invoice_draft,
    build_facturama_status,
    build_issuer_from_capa,
    build_receiver_from_cliente,
    build_saas_invoice_draft,
    download_invoice_file,
    emit_invoice,
    find_existing_cxc_invoice,
    persist_invoice_from_draft,
    resolve_platform_billing_capa,
    save_uploaded_csd,
    serialize_csd,
    serialize_draft,
    serialize_invoice,
    validate_party,
)

router = Router(tags=["facturacion"])
logger = logging.getLogger(__name__)


class ClienteFiscalIn(Schema):
    razon_social: str = ""
    rfc: str = ""
    regimen_fiscal: str = ""
    codigo_postal: str = ""
    archivo_csf_url: str = ""
    es_persona_moral: bool | None = None


def _resolve_admin_capa(request, capa_id: Optional[int] = None):
    require_plan_module(request, "facturacion_cfdi")
    require_admin_access(request)
    capa = (
        get_object_or_404(get_accessible_capas_queryset(request), id=capa_id)
        if capa_id
        else get_current_capa(request)
    )
    membresia = ensure_membership_for_capa(request, capa)
    if membresia.rol != ROLE_OWNER_ADMIN:
        raise HttpError(403, "Solo un administrador puede revisar configuracion fiscal.")
    return capa


def _cxc_queryset_for_request(request):
    require_plan_module(request, "facturacion_cfdi")
    allowed_entity_ids = get_allowed_entity_ids(request)
    return CuentaPorCobrar.objects.select_related(
        "cliente_relacionado",
        "entidad_relacionada",
        "entidad_relacionada__capa_negocio",
    ).filter(
        Q(entidad_relacionada_id__in=allowed_entity_ids)
        | Q(cliente_relacionado__entidad_relacionada_id__in=allowed_entity_ids)
    )


def _factura_emitida_for_request(request, factura_id: int) -> FacturaEmitida:
    require_plan_module(request, "facturacion_cfdi")
    require_admin_access(request)
    allowed_entity_ids = get_allowed_entity_ids(request)
    return get_object_or_404(
        FacturaEmitida.objects.prefetch_related("partidas").filter(
            Q(capa_emisora=get_current_capa(request))
            | Q(cuenta_por_cobrar__entidad_relacionada_id__in=allowed_entity_ids)
            | Q(cuenta_por_cobrar__cliente_relacionado__entidad_relacionada_id__in=allowed_entity_ids)
        ).distinct(),
        id=factura_id,
    )


def _register_csd_payload(request, cer_file, key_file) -> dict:
    raw_capa_id = (request.POST.get("capa_id") or "").strip()
    capa_id = int(raw_capa_id) if raw_capa_id.isdigit() else None
    capa = _resolve_admin_capa(request, capa_id)
    proveedor = (request.POST.get("proveedor") or capa.facturacion_pac_proveedor or "FACTURAMA").strip().upper()
    modo = (request.POST.get("modo") or capa.facturacion_modo or "SANDBOX").strip().upper()
    password = (request.POST.get("password") or "").strip()
    if proveedor != "FACTURAMA":
        raise HttpError(400, "Por ahora el adaptador operativo para CSD es Facturama.")
    if modo not in {"SANDBOX", "PRODUCCION"}:
        raise HttpError(400, "El modo debe ser SANDBOX o PRODUCCION.")
    if not capa.rfc:
        raise HttpError(400, "Completa el RFC de la capa antes de cargar el CSD.")
    missing_fiscal_fields = [
        label
        for label, value in (
            ("razon social fiscal", capa.razon_social),
            ("regimen fiscal", capa.regimen_fiscal),
            ("codigo postal fiscal", capa.codigo_postal_fiscal),
        )
        if not str(value or "").strip()
    ]
    if missing_fiscal_fields:
        raise HttpError(
            400,
            "Completa y guarda antes de registrar el CSD: "
            + ", ".join(missing_fiscal_fields)
            + ".",
        )
    if not password:
        raise HttpError(400, "Ingresa la contrasena de la llave privada.")
    if not cer_file or not key_file:
        raise HttpError(400, "Selecciona archivo .cer y archivo .key.")

    try:
        csd = save_uploaded_csd(
            capa=capa,
            proveedor=proveedor,
            modo=modo,
            cer_file=cer_file,
            key_file=key_file,
            password=password,
        )
    except Exception as exc:
        logger.exception("Error inesperado registrando CSD de la capa %s.", capa.id)
        raise HttpError(
            400,
            "No se pudo registrar el CSD. Revisa que las migraciones de facturacion "
            "esten aplicadas y que el storage este disponible.",
        ) from exc
    return {
        "mensaje": (
            "CSD validado y activado correctamente."
            if csd.estatus == "VALIDADO"
            else "El CSD se guardo con error; revisa el detalle del proveedor."
        ),
        "csd": serialize_csd(csd),
        "status": build_facturama_status(capa),
    }


def _authenticate_direct_bearer_request(request) -> None:
    authorization = (request.headers.get("Authorization") or "").strip()
    prefix, _, token = authorization.partition(" ")
    if prefix.lower() != "bearer" or not token.strip():
        raise HttpError(401, "Debes iniciar sesion para acceder a este recurso.")
    context = AccessBearerAuth().authenticate(request, token.strip())
    if context is None:
        raise HttpError(401, "Sesion invalida o expirada.")
    request.auth = context


def _http_error_response(error: HttpError) -> JsonResponse:
    detail = getattr(error, "message", "") or str(error)
    status_code = int(getattr(error, "status_code", 400) or 400)
    return JsonResponse({"detail": detail}, status=status_code)


def _unexpected_error_response(message: str, exc: Exception) -> JsonResponse:
    logger.exception(message)
    return JsonResponse(
        {
            "detail": f"{message} {exc}",
            "error_type": exc.__class__.__name__,
        },
        status=500,
    )


def _serialize_cxc_invoice_preview(cuenta: CuentaPorCobrar) -> dict:
    capa = cuenta.entidad_relacionada.capa_negocio if cuenta.entidad_relacionada else None
    cliente = cuenta.cliente_relacionado
    existing_invoice = find_existing_cxc_invoice(cuenta)
    bloqueos: list[str] = []
    faltantes: list[str] = []
    draft = None

    if not capa:
        bloqueos.append("La CxC no tiene entidad emisora.")
    else:
        status = build_facturama_status(capa)
        bloqueos.extend(status.get("pendientes") or [])
        if cuenta.saldo_pendiente > 0 and cuenta.estatus_adeudo not in {"CONCILIADO", "POR_CONCILIAR"}:
            bloqueos.append("Solo se recomienda facturar CxC pagadas, conciliadas o por conciliar.")
        issuer = build_issuer_from_capa(capa)
        receiver = build_receiver_from_cliente(cuenta)
        faltantes = validate_party(issuer, role="emisor") + validate_party(receiver, role="receptor")
        if not bloqueos and not faltantes:
            draft = serialize_draft(build_cxc_invoice_draft(cuenta))

    return {
        "cuenta": {
            "id": cuenta.id,
            "concepto": cuenta.concepto,
            "periodicidad": cuenta.periodicidad,
            "fecha_periodo_inicio": cuenta.fecha_periodo_inicio.isoformat() if cuenta.fecha_periodo_inicio else None,
            "fecha_periodo_fin": cuenta.fecha_periodo_fin.isoformat() if cuenta.fecha_periodo_fin else None,
            "fecha_vencimiento": cuenta.fecha_vencimiento.isoformat() if cuenta.fecha_vencimiento else None,
            "monto_total": float(cuenta.monto_total or 0),
            "monto_pagado": float(cuenta.monto_pagado or 0),
            "saldo_pendiente": float(cuenta.saldo_pendiente),
            "estatus": cuenta.estatus_adeudo,
        },
        "cliente": {
            "id": cliente.id,
            "entidad_relacionada_id": cliente.entidad_relacionada_id,
            "razon_social": cliente.razon_social or "",
            "nombre_comercial": cliente.nombre_comercial or "",
            "rfc": cliente.rfc or "",
            "regimen_fiscal": cliente.regimen_fiscal or "",
            "codigo_postal": cliente.codigo_postal or "",
            "archivo_csf_url": cliente.archivo_csf_url or "",
            "es_persona_moral": cliente.es_persona_moral,
        },
        "faltantes": faltantes,
        "bloqueos": bloqueos,
        "factura_existente": serialize_invoice(existing_invoice) if existing_invoice else None,
        "ya_timbrada": existing_invoice.estatus == "TIMBRADA" if existing_invoice else False,
        "puede_timbrar": bool(draft and not (existing_invoice and existing_invoice.estatus == "TIMBRADA")),
        "draft": draft,
    }


@csrf_exempt
@require_POST
def cargar_certificado_sello_digital_django(request):
    try:
        _authenticate_direct_bearer_request(request)
        with transaction.atomic():
            payload = _register_csd_payload(
                request,
                request.FILES.get("cer_file"),
                request.FILES.get("key_file"),
            )
        return JsonResponse(payload, status=200)
    except HttpError as exc:
        return _http_error_response(exc)
    except Exception as exc:
        logger.exception("Error no controlado en carga directa de CSD.")
        return JsonResponse(
            {
                "detail": (
                    "No se pudo registrar el CSD por un error interno. "
                    "Revisa los logs del backend despues de este intento."
                ),
                "error_type": exc.__class__.__name__,
            },
            status=400,
        )


@router.get("/proveedor/status/")
def obtener_estado_proveedor(request, capa_id: Optional[int] = None):
    capa = _resolve_admin_capa(request, capa_id)

    if capa.facturacion_pac_proveedor == "FACTURAMA":
        return build_facturama_status(capa)

    return {
        "proveedor": capa.facturacion_pac_proveedor,
        "modo": capa.facturacion_modo,
        "entorno_url": "",
        "credenciales_configuradas": False,
        "credenciales_env": {},
        "campos_negocio_listos": False,
        "listo_para_sandbox": False,
        "pendientes": ["Selecciona Facturama como proveedor PAC."],
        "recomendacion": "El adaptador activo preparado es Facturama sandbox.",
    }


@router.get("/facturas/")
def listar_facturas_emitidas(
    request,
    capa_id: Optional[int] = None,
    contexto: str = "",
    estatus: str = "",
    page: int = 1,
    page_size: int = 25,
):
    capa = _resolve_admin_capa(request, capa_id)
    page = max(page, 1)
    page_size = min(max(page_size, 1), 100)
    queryset = FacturaEmitida.objects.filter(capa_emisora=capa).prefetch_related("partidas")
    if contexto:
        queryset = queryset.filter(contexto=contexto.strip().upper())
    if estatus:
        queryset = queryset.filter(estatus=estatus.strip().upper())
    total = queryset.count()
    offset = (page - 1) * page_size
    return {
        "items": [serialize_invoice(invoice) for invoice in queryset[offset : offset + page_size]],
        "page": page,
        "page_size": page_size,
        "total": total,
        "total_pages": max((total + page_size - 1) // page_size, 1),
    }


@router.get("/facturas/{factura_id}/")
def obtener_factura_emitida(request, factura_id: int):
    return serialize_invoice(_factura_emitida_for_request(request, factura_id))


@router.get("/facturas/{factura_id}/{formato}/")
def descargar_archivo_factura_emitida(request, factura_id: int, formato: str):
    factura = _factura_emitida_for_request(request, factura_id)
    content, content_type, filename = download_invoice_file(factura, formato)
    response = HttpResponse(content, content_type=content_type)
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response


@router.post("/emisor/csd/", include_in_schema=False)
@transaction.atomic
def cargar_certificado_sello_digital(
    request,
    cer_file: UploadedFile = File(...),
    key_file: UploadedFile = File(...),
):
    return _register_csd_payload(request, cer_file, key_file)


@router.get("/cxc/{cuenta_id}/preview/")
def preview_factura_cxc(request, cuenta_id: int):
    require_admin_access(request)
    cuenta = get_object_or_404(_cxc_queryset_for_request(request), id=cuenta_id)
    return _serialize_cxc_invoice_preview(cuenta)


@router.put("/cxc/{cuenta_id}/receptor-fiscal/")
def actualizar_receptor_fiscal_cxc(request, cuenta_id: int, payload: ClienteFiscalIn):
    require_admin_access(request)
    cuenta = get_object_or_404(_cxc_queryset_for_request(request), id=cuenta_id)
    cliente = cuenta.cliente_relacionado
    normalized_rfc = payload.rfc.strip().upper()
    if is_generic_public_rfc(normalized_rfc):
        cliente.razon_social = GENERIC_PUBLIC_NAME
        cliente.rfc = GENERIC_PUBLIC_RFC
        cliente.regimen_fiscal = GENERIC_PUBLIC_REGIME
        cliente.codigo_postal = ""
        cliente.es_persona_moral = False
    elif payload.razon_social.strip():
        cliente.razon_social = payload.razon_social.strip()
    if normalized_rfc and not is_generic_public_rfc(normalized_rfc):
        cliente.rfc = normalized_rfc
    if not is_generic_public_rfc(normalized_rfc):
        if payload.regimen_fiscal.strip():
            cliente.regimen_fiscal = normalize_fiscal_regime_code(payload.regimen_fiscal)
        if payload.codigo_postal.strip():
            cliente.codigo_postal = "".join(char for char in payload.codigo_postal if char.isdigit())[:5]
        if payload.es_persona_moral is not None:
            cliente.es_persona_moral = payload.es_persona_moral
    if payload.archivo_csf_url.strip():
        cliente.archivo_csf_url = payload.archivo_csf_url.strip()
    cliente.save(
        update_fields=[
            "razon_social",
            "rfc",
            "regimen_fiscal",
            "codigo_postal",
            "archivo_csf_url",
            "es_persona_moral",
        ]
    )
    return _serialize_cxc_invoice_preview(cuenta)


@router.post("/cxc/{cuenta_id}/preparar/")
def preparar_factura_cxc(request, cuenta_id: int):
    require_admin_access(request)
    cuenta = get_object_or_404(_cxc_queryset_for_request(request), id=cuenta_id)
    draft = build_cxc_invoice_draft(cuenta)
    invoice = persist_invoice_from_draft(
        draft=draft,
        capa=cuenta.entidad_relacionada.capa_negocio,
        cuenta=cuenta,
    )
    return {
        "draft": serialize_draft(draft),
        "factura": serialize_invoice(invoice),
    }


@router.post("/cxc/{cuenta_id}/emitir/")
def emitir_factura_cxc(request, cuenta_id: int):
    try:
        require_admin_access(request)
        cuenta = get_object_or_404(_cxc_queryset_for_request(request), id=cuenta_id)
        existing_invoice = find_existing_cxc_invoice(cuenta)
        if existing_invoice and existing_invoice.estatus == "TIMBRADA":
            return {
                "mensaje": "Esta CxC ya tenia una factura timbrada. No se genero duplicado.",
                "factura": serialize_invoice(existing_invoice),
            }
        draft = build_cxc_invoice_draft(cuenta)
        invoice = emit_invoice(
            draft=draft,
            capa=cuenta.entidad_relacionada.capa_negocio,
            cuenta=cuenta,
        )
        return {
            "mensaje": "Factura emitida correctamente.",
            "factura": serialize_invoice(invoice),
        }
    except HttpError as exc:
        return _http_error_response(exc)
    except Http404:
        return JsonResponse({"detail": "No se encontro la cuenta por cobrar."}, status=404)
    except Exception as exc:
        return _unexpected_error_response("No se pudo emitir la factura.", exc)


@router.post("/backoffice/suscripciones/{subscription_id}/preparar/")
def preparar_factura_saas(request, subscription_id: int, periodo: str = ""):
    require_platform_admin_access(request)
    subscription = get_object_or_404(
        SuscripcionCapa.objects.select_related("capa_negocio", "plan"),
        id=subscription_id,
    )
    issuer_capa = resolve_platform_billing_capa(get_current_capa(request, require=False))
    draft = build_saas_invoice_draft(
        subscription,
        issuer_capa=issuer_capa,
        periodo=periodo.strip() or None,
    )
    invoice = persist_invoice_from_draft(
        draft=draft,
        capa=issuer_capa,
        subscription=subscription,
    )
    return {
        "draft": serialize_draft(draft),
        "factura": serialize_invoice(invoice),
    }


@router.post("/backoffice/suscripciones/{subscription_id}/emitir/")
def emitir_factura_saas(request, subscription_id: int, periodo: str = ""):
    try:
        require_platform_admin_access(request)
        subscription = get_object_or_404(
            SuscripcionCapa.objects.select_related("capa_negocio", "plan"),
            id=subscription_id,
        )
        issuer_capa = resolve_platform_billing_capa(get_current_capa(request, require=False))
        draft = build_saas_invoice_draft(
            subscription,
            issuer_capa=issuer_capa,
            periodo=periodo.strip() or None,
        )
        invoice = emit_invoice(
            draft=draft,
            capa=issuer_capa,
            subscription=subscription,
        )
        return {
            "mensaje": "Factura SaaS emitida correctamente.",
            "factura": serialize_invoice(invoice),
        }
    except HttpError as exc:
        return _http_error_response(exc)
    except Http404:
        return JsonResponse({"detail": "No se encontro la suscripcion."}, status=404)
    except Exception as exc:
        return _unexpected_error_response("No se pudo emitir la factura SaaS.", exc)
