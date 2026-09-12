import logging
import os
import hashlib
import re
import secrets
from datetime import date, timedelta
from decimal import Decimal
from typing import Optional

import requests
from django.conf import settings
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.db import transaction
from django.db.models import Count, F, Q
from django.http import HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from ninja import File, Form, Router, Schema
from ninja.errors import HttpError
from ninja.files import UploadedFile

from accounts.security import (
    get_allowed_entity_ids,
    get_auth_context,
    get_current_capa,
    get_request_ip,
    get_request_user_agent,
    is_platform_admin_user,
    require_admin_access,
    require_plan_feature,
    require_plan_module,
)
from billing.models import CronRunLog
from crm.api import apply_csf_data_to_cliente, extract_csf_data_from_upload, upload_csf_to_r2
from crm.models import Cliente
from core.fiscal import normalize_fiscal_regime_code
from empresas.models import CapaNegocio, EntidadNegocio
from facturacion.models import FacturaEmitida
from facturacion.services import (
    build_cxc_invoice_draft,
    download_invoice_file,
    emit_invoice,
    find_existing_cxc_invoice,
    serialize_invoice,
)
from finanzas.eventos import upsert_financial_event
from finanzas.models import CuentaPorCobrar, PagoCuentaPorCobrar
from finanzas.services import decimal_to_float, register_payment_for_entity

from .email_provider import verify_resend_webhook_signature
from .legal import (
    accept_whatsapp_shared_number_agreement,
    build_whatsapp_shared_number_agreement_state,
    channel_uses_whatsapp,
    get_portal_collection_consent_payload,
    require_whatsapp_shared_number_agreement_for_capa,
    require_whatsapp_shared_number_agreement_for_request,
)
from .models import (
    AcuerdoUsoComunicacion,
    CanalWhatsappOficial,
    ConfiguracionComunicacion,
    ContactoPruebaWhatsapp,
    EvidenciaPago,
    HistorialEnvio,
    PlantillaMensaje,
    PortalOtpChallenge,
    ReglaAutomatizacionMensaje,
)
from .api import (
    apply_receipt_analysis_to_evidence,
    build_evidence_cxc_candidates,
    build_rule_receipt_analysis,
    call_google_vision_receipt_analysis,
    call_openai_receipt_analysis,
    get_google_vision_api_key,
    register_receipt_ai_usage,
)
from .outbound import (
    TOKEN_PATTERN,
    build_automation_preview,
    build_outbound_usage_limits,
    build_portal_payload,
    build_portal_url,
    build_preview_items,
    build_whatsapp_chat_id,
    client_display_name,
    decode_portal_token,
    dispatch_preview_items,
    execute_due_automations,
    format_long_date_es,
    format_money,
    format_month_year_es,
    get_whatsapp_outbound_allowed_numbers,
    is_whatsapp_destination_allowed,
    normalize_whatsapp_destination,
    register_history,
    render_template,
    resolve_collection_message_stage,
    send_whatsapp_message,
)

router = Router(tags=["comunicaciones-salientes"])
logger = logging.getLogger(__name__)

RESEND_EVENT_STATUS_MAP = {
    "email.sent": ("ENVIADO", 10),
    "email.delivery_delayed": ("ERROR", 15),
    "email.delivered": ("ENTREGADO", 20),
    "email.opened": ("LEIDO", 30),
    "email.clicked": ("LEIDO", 31),
    "email.failed": ("ERROR", 100),
    "email.bounced": ("ERROR_SPAM", 110),
    "email.complained": ("ERROR_SPAM", 120),
}

PAYMENT_REMINDER_CRON_KEY = "payment_reminders"
PAYMENT_REMINDER_EXPECTED_HOURS = 30
COBRANZA_ONBOARDING_REVIEW_TYPE = "COBRANZA_ONBOARDING_REVIEW"
COBRANZA_ONBOARDING_REVIEW_VERSION = "2026-06-19"
COBRANZA_ONBOARDING_REVIEW_TITLE = "Cierre operativo del onboarding de cobranza"
COBRANZA_ONBOARDING_REVIEW_HASH = hashlib.sha256(
    f"{COBRANZA_ONBOARDING_REVIEW_TYPE}:{COBRANZA_ONBOARDING_REVIEW_VERSION}".encode(
        "utf-8"
    )
).hexdigest()
SAFE_CRON_METADATA_KEYS = {
    "configs",
    "fecha",
    "capa_id",
    "dry_run",
    "sent",
    "skipped",
    "errors",
    "max_envios",
    "max_envios_por_capa",
    "fail_on_errors",
    "require_whatsapp_ready",
    "readiness_errors",
    "skipped_by_send_window",
    "send_window",
}

PORTAL_UPLOAD_MAX_BYTES = 10 * 1024 * 1024
PORTAL_UPLOAD_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg", ".webp"}
PORTAL_CSF_MAX_BYTES = 10 * 1024 * 1024

AUTOMATION_SEGMENT_LABELS = {
    "TODOS_ACTIVOS": "todos los clientes activos",
    "CXC_ABIERTA": "cuentas abiertas",
    "POR_VENCER": "por vencer",
    "EN_GRACIA": "en periodo de gracia",
    "VENCIDA_CON_RECARGO": "con recargo",
}

AUTOMATION_STAGE_LABELS = {
    "PREVENTIVO": "antes del vencimiento",
    "VENCE_HOY": "dia de vencimiento",
    "GRACIA": "periodo de gracia",
    "RECARGO": "recargo o atraso",
}

AUTOMATION_EVENT_LABELS = {
    "FECHA_VENCIMIENTO": "fecha de vencimiento",
    "FECHA_LIMITE_GRACIA": "fecha limite de gracia",
}


def require_cobranza_access(request) -> None:
    require_plan_module(request, "cobranza")


def require_whatsapp_automation_access(request) -> None:
    require_plan_feature(request, "whatsapp_automation")


def require_whatsapp_channel_access(request, channel: str | None) -> None:
    normalized = (channel or "").strip().upper()
    if "WHATSAPP" in normalized:
        require_whatsapp_automation_access(request)


def _automation_open_cxc_queryset(
    *,
    config: ConfiguracionComunicacion,
    rule: ReglaAutomatizacionMensaje,
    allowed_entity_ids: list[int] | None,
):
    queryset = (
        CuentaPorCobrar.objects.filter(
            cliente_relacionado__activo=True,
            monto_total__gt=F("monto_pagado"),
        )
        .exclude(estatus_adeudo__in=["CANCELADO", "INCOBRABLE"])
        .filter(
            Q(entidad_relacionada__capa_negocio=config.capa_negocio)
            | Q(
                entidad_relacionada__isnull=True,
                cliente_relacionado__entidad_relacionada__capa_negocio=config.capa_negocio,
            )
        )
    )
    if allowed_entity_ids is not None:
        queryset = queryset.filter(
            Q(entidad_relacionada_id__in=allowed_entity_ids)
            | Q(
                entidad_relacionada__isnull=True,
                cliente_relacionado__entidad_relacionada_id__in=allowed_entity_ids,
            )
        )
    if rule.entidad_relacionada_id:
        queryset = queryset.filter(
            Q(entidad_relacionada_id=rule.entidad_relacionada_id)
            | Q(
                entidad_relacionada__isnull=True,
                cliente_relacionado__entidad_relacionada_id=rule.entidad_relacionada_id,
            )
        )
    return queryset


def _build_automation_no_candidate_diagnostic(
    *,
    config: ConfiguracionComunicacion,
    rule: ReglaAutomatizacionMensaje,
    allowed_entity_ids: list[int] | None,
    reference_date: date,
) -> dict:
    open_queryset = _automation_open_cxc_queryset(
        config=config,
        rule=rule,
        allowed_entity_ids=allowed_entity_ids,
    )
    open_count = open_queryset.count()
    event_label = AUTOMATION_EVENT_LABELS.get(rule.evento_base, rule.evento_base)
    segment_label = AUTOMATION_SEGMENT_LABELS.get(rule.segmento, rule.segmento)
    stage = resolve_collection_message_stage(
        template=rule.plantilla_relacionada,
        segment=rule.segmento,
        rule=rule,
    )
    stage_label = AUTOMATION_STAGE_LABELS.get(stage, "sin etapa especial")
    target_date = None
    target_count = None

    if rule.evento_base == "FECHA_VENCIMIENTO":
        target_date = reference_date - timedelta(days=rule.desplazamiento_dias)
        target_count = open_queryset.filter(fecha_vencimiento=target_date).count()

    if open_count == 0:
        reason = "No hay cuentas por cobrar abiertas para esta capa."
        detail = (
            "La simulacion solo considera CxC activas con saldo pendiente y clientes activos."
        )
    elif target_date and target_count == 0:
        reason = (
            f"No hay CxC abiertas con {event_label} "
            f"{format_long_date_es(target_date)}."
        )
        detail = (
            f"Para ejecutar esta regla el {format_long_date_es(reference_date)}, "
            f"el sistema busca cuentas con {event_label} "
            f"{format_long_date_es(target_date)} por el desfase de "
            f"{rule.desplazamiento_dias} dia(s)."
        )
    elif target_date:
        reason = "Hay CxC en la fecha objetivo, pero no pasan los filtros de la regla."
        detail = (
            f"Se encontraron {target_count} cuenta(s) con {event_label} "
            f"{format_long_date_es(target_date)}, pero no coincidieron con el segmento "
            f"{segment_label} y la etapa {stage_label} para "
            f"{format_long_date_es(reference_date)}."
        )
    else:
        reason = "No hay candidatos para la fecha y regla seleccionadas."
        detail = (
            f"La regla usa {event_label}, segmento {segment_label} y etapa "
            f"{stage_label}. Revisa que existan cuentas abiertas en esa ventana."
        )

    return {
        "motivo_sin_candidatos": reason,
        "detalle_sin_candidatos": detail,
        "fecha_objetivo": target_date.isoformat() if target_date else None,
        "cuentas_fecha_objetivo": target_count,
        "cuentas_abiertas": open_count,
    }


def is_template_governance_locked_for_request(request) -> bool:
    if not getattr(settings, "LOCK_TENANT_MESSAGE_TEMPLATES", False):
        return False
    context = get_auth_context(request)
    return not is_platform_admin_user(context.user)


def normalize_cobranza_lab_value(value: object) -> str:
    return str(value or "").strip().lower()


def scoped_whatsapp_lab_contact_queryset(request):
    capa = get_current_capa(request)
    if not capa:
        return ContactoPruebaWhatsapp.objects.none()
    return ContactoPruebaWhatsapp.objects.filter(capa_negocio=capa, activo=True)


def serialize_whatsapp_lab_contact(contact: ContactoPruebaWhatsapp) -> dict:
    return {
        "id": contact.id,
        "nombre": contact.nombre,
        "telefono": contact.telefono,
        "telefono_normalizado": contact.telefono_normalizado,
        "notas": contact.notas or "",
        "consentimiento_confirmado": contact.consentimiento_confirmado,
        "activo": contact.activo,
        "fecha_creacion": contact.fecha_creacion,
        "fecha_actualizacion": contact.fecha_actualizacion,
    }


def get_cobranza_lab_whatsapp_contacts(request) -> list[dict]:
    return [
        serialize_whatsapp_lab_contact(contact)
        for contact in scoped_whatsapp_lab_contact_queryset(request).order_by(
            "nombre", "telefono_normalizado"
        )
    ]


def split_whatsapp_lab_phone_number(destination: str) -> tuple[str, str]:
    digits = re.sub(r"\D", "", destination or "")
    if digits.startswith("52") and len(digits) > 10:
        return "+52", digits[2:]
    if digits.startswith("1") and len(digits) > 10:
        return "+1", digits[1:]
    return "+52", digits[-10:] if len(digits) > 10 else digits


def find_client_by_whatsapp_destination(queryset, destination: str) -> Cliente | None:
    normalized_destination = normalize_whatsapp_destination(destination)
    if not normalized_destination:
        return None
    for client in queryset:
        client_destination = normalize_whatsapp_destination(
            f"{client.codigo_pais or ''}{client.telefono or ''}"
        )
        if client_destination == normalized_destination:
            return client
    return None






def get_or_create_whatsapp_lab_client(
    *,
    request,
    contact: ContactoPruebaWhatsapp,
    destination: str,
) -> Cliente:
    clients = scoped_client_queryset(request).select_related(
        "entidad_relacionada",
        "entidad_relacionada__capa_negocio",
    )
    existing = find_client_by_whatsapp_destination(clients, destination)
    if existing:
        update_fields: list[str] = []
        if not existing.nombre_comercial:
            existing.nombre_comercial = contact.nombre
            update_fields.append("nombre_comercial")
        if not existing.razon_social:
            existing.razon_social = contact.nombre
            update_fields.append("razon_social")
        if not existing.identificador:
            existing.identificador = f"LAB-WA-{contact.id}"
            update_fields.append("identificador")
        if update_fields:
            existing.save(update_fields=update_fields)
        return existing

    entity = scoped_entity_queryset(request).order_by("nombre_comercial", "id").first()
    if not entity:
        raise HttpError(
            400,
            "Crea una unidad de negocio antes de enviar demos WhatsApp con portal.",
        )

    country_code, national_number = split_whatsapp_lab_phone_number(destination)
    return Cliente.objects.create(
        entidad_relacionada=entity,
        razon_social=contact.nombre,
        nombre_comercial=contact.nombre,
        rfc="XAXX010101000",
        identificador=f"LAB-WA-{contact.id}",
        correo_principal=f"demo.whatsapp.{contact.id}@betterp.local",
        codigo_pais=country_code,
        telefono=national_number,
        dia_corte_individual=10,
        dias_gracia=3,
    )


def is_portal_lab_whatsapp_destination_allowed(
    cliente: Cliente,
    destination: str,
) -> bool:
    normalized_destination = normalize_whatsapp_destination(destination)
    if not normalized_destination:
        return False
    match = re.fullmatch(r"LAB-WA-(\d+)", str(cliente.identificador or ""))
    if not match:
        return False
    capa = getattr(getattr(cliente, "entidad_relacionada", None), "capa_negocio", None)
    if not capa:
        return False
    return ContactoPruebaWhatsapp.objects.filter(
        id=int(match.group(1)),
        capa_negocio=capa,
        telefono_normalizado=normalized_destination,
        consentimiento_confirmado=True,
        activo=True,
    ).exists()


def is_portal_whatsapp_destination_allowed(
    cliente: Cliente,
    destination: str,
) -> bool:
    return is_whatsapp_destination_allowed(
        destination
    ) or is_portal_lab_whatsapp_destination_allowed(cliente, destination)


def get_cobranza_lab_allowed_numbers(request) -> set[str]:
    numbers = set(get_whatsapp_outbound_allowed_numbers())
    for contact in scoped_whatsapp_lab_contact_queryset(request).only(
        "telefono_normalizado"
    ):
        if normalized := normalize_whatsapp_destination(contact.telefono_normalizado):
            numbers.add(normalized)
    return numbers


def build_cobranza_test_lab_state(request) -> dict[str, object]:
    context = get_auth_context(request)
    user = context.user
    capa = get_current_capa(request)
    allowed_emails = {
        normalize_cobranza_lab_value(item)
        for item in getattr(settings, "COBRANZA_TEST_LAB_ALLOWED_EMAILS", [])
    }
    allowed_capas = {
        normalize_cobranza_lab_value(item)
        for item in getattr(settings, "COBRANZA_TEST_LAB_ALLOWED_CAPAS", [])
    }
    user_email = normalize_cobranza_lab_value(
        getattr(user, "email", "") or getattr(user, "username", "")
    )
    capa_name = normalize_cobranza_lab_value(getattr(capa, "nombre", ""))
    capa_id = normalize_cobranza_lab_value(getattr(capa, "id", ""))
    feature_enabled = bool(getattr(settings, "COBRANZA_TEST_LAB_ENABLED", True))
    user_allowed = bool(user_email and user_email in allowed_emails)
    capa_allowed = bool(capa and (capa_name in allowed_capas or capa_id in allowed_capas))
    enabled = bool(feature_enabled and user_allowed and capa_allowed)

    if not feature_enabled:
        reason = "El laboratorio de cobranza esta apagado por configuracion."
    elif not user_allowed and not capa_allowed:
        reason = "El laboratorio solo esta disponible para la cuenta y capa autorizadas."
    elif not user_allowed:
        reason = "El laboratorio solo esta disponible para la cuenta autorizada."
    elif not capa_allowed:
        reason = "El laboratorio solo esta disponible para la capa autorizada."
    else:
        reason = "Laboratorio habilitado para pruebas controladas."

    return {
        "habilitado": enabled,
        "feature_activa": feature_enabled,
        "usuario_autorizado": user_allowed,
        "capa_autorizada": capa_allowed,
        "usuario_actual": user_email or None,
        "capa_actual": getattr(capa, "nombre", None),
        "motivo": reason,
        "contactos_whatsapp_prueba": (
            get_cobranza_lab_whatsapp_contacts(request) if enabled else []
        ),
    }


def require_cobranza_test_lab_access_for_whatsapp(request, channel: str | None) -> None:
    if not channel_uses_whatsapp(channel):
        return
    if not get_whatsapp_outbound_allowed_numbers():
        return
    state = build_cobranza_test_lab_state(request)
    if state["habilitado"]:
        return
    raise HttpError(
        403,
        "El laboratorio de cobranza por WhatsApp solo esta habilitado para "
        "01.agodinez@gmail.com en la capa Maya Coliving.",
    )


def require_template_management_access(request) -> None:
    require_admin_access(request)
    if is_template_governance_locked_for_request(request):
        raise HttpError(
            403,
            "Las plantillas de mensajes son administradas por BetterP. "
            "Solicita la creacion o ajuste de plantilla a soporte.",
        )


def enforce_manual_template_governance(request, payload: "PreviewEnvioIn") -> None:
    if not is_template_governance_locked_for_request(request):
        return
    if not payload.plantilla_id:
        raise HttpError(
            400,
            "Selecciona una plantilla aprobada por BetterP para enviar mensajes.",
        )
    if payload.asunto.strip() or payload.mensaje.strip() or payload.url_media.strip():
        raise HttpError(
            400,
            "No puedes modificar el texto, asunto o adjuntos de una plantilla "
            "aprobada por BetterP.",
        )


def ensure_whatsapp_shared_number_terms_for_active_rule(
    request,
    payload: "ReglaAutomatizacionMensajeIn",
) -> None:
    if not payload.activo or not channel_uses_whatsapp(payload.canal):
        return
    require_whatsapp_shared_number_agreement_for_request(request, payload.canal)


def portal_otp_required() -> bool:
    return bool(getattr(settings, "PORTAL_OTP_REQUIRED", True))


def hash_portal_secret(purpose: str, value: str) -> str:
    raw = f"{settings.SECRET_KEY}:{purpose}:{value}".encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def hash_portal_token(token: str) -> str:
    return hash_portal_secret("portal-token", token)


def hash_portal_session_token(session_token: str) -> str:
    return hash_portal_secret("portal-session", session_token)


def hash_portal_otp_code(*, cliente_id: int, token_hash: str, code: str) -> str:
    return hash_portal_secret("portal-otp", f"{cliente_id}:{token_hash}:{code}")


def get_portal_token_hours() -> int:
    config = ConfiguracionComunicacion.objects.order_by("id").first()
    return max((config.portal_token_horas if config else 168) or 168, 1)


def get_portal_otp_minutes() -> int:
    return max(int(getattr(settings, "PORTAL_OTP_EXPIRATION_MINUTES", 10) or 10), 1)


def get_portal_session_hours() -> int:
    return max(int(getattr(settings, "PORTAL_SESSION_HOURS", 24) or 24), 1)


def resolve_portal_cliente_from_token(token: str) -> Cliente:
    payload = decode_portal_token(token, horas=get_portal_token_hours())
    cliente = (
        Cliente.objects.select_related(
            "entidad_relacionada",
            "entidad_relacionada__capa_negocio",
        )
        .filter(id=payload.get("cliente_id"), activo=True)
        .first()
    )
    if not cliente:
        raise HttpError(404, "El cliente del portal ya no existe.")
    if payload.get("entidad_id") and cliente.entidad_relacionada_id != payload["entidad_id"]:
        raise HttpError(400, "El enlace del portal ya no es valido.")
    capa_id = getattr(cliente.entidad_relacionada, "capa_negocio_id", None)
    if payload.get("capa_id") and capa_id != payload["capa_id"]:
        raise HttpError(400, "El enlace del portal ya no es valido.")
    return cliente


def resolve_portal_payload_and_cliente(token: str) -> tuple[dict, Cliente]:
    payload = build_portal_payload(token=token)
    cliente = (
        Cliente.objects.select_related("entidad_relacionada")
        .filter(id=payload["cliente"]["id"], activo=True)
        .first()
    )
    if not cliente:
        raise HttpError(404, "El cliente del portal ya no existe.")
    return payload, cliente


def mask_portal_phone(value: str | None) -> str | None:
    digits = re.sub(r"\D", "", value or "")
    if not digits:
        return None
    if len(digits) <= 4:
        return f"terminacion {digits}"
    return f"terminacion {digits[-4:]}"


def get_portal_session_header(request) -> str:
    if hasattr(request, "headers"):
        value = request.headers.get("X-Portal-Session", "")
        if value:
            return value.strip()
    return str(request.META.get("HTTP_X_PORTAL_SESSION", "") or "").strip()


def get_valid_portal_session(
    request,
    *,
    token: str,
    cliente: Cliente,
) -> PortalOtpChallenge | None:
    if not portal_otp_required():
        return None
    session_token = get_portal_session_header(request)
    if not session_token:
        return None
    return (
        PortalOtpChallenge.objects.filter(
            cliente=cliente,
            token_hash=hash_portal_token(token),
            session_token_hash=hash_portal_session_token(session_token),
            estado="VERIFICADO",
            fecha_expiracion__gt=timezone.now(),
        )
        .order_by("-fecha_verificacion", "-id")
        .first()
    )


def require_portal_otp_session(request, *, token: str, cliente: Cliente) -> None:
    if not portal_otp_required():
        return
    if get_valid_portal_session(request, token=token, cliente=cliente):
        return
    raise HttpError(
        403,
        "Valida el codigo enviado por WhatsApp antes de continuar en el portal.",
    )


def build_portal_auth_state(
    *,
    cliente: Cliente,
    verified: bool,
    detail: str = "",
) -> dict[str, object]:
    destination = build_whatsapp_chat_id(cliente)
    can_request_code = bool(
        destination and is_portal_whatsapp_destination_allowed(cliente, destination)
    )
    masked_phone = mask_portal_phone(destination or cliente.telefono)
    return {
        "required": portal_otp_required(),
        "verified": bool(verified or not portal_otp_required()),
        "channel": "WHATSAPP",
        "masked_phone": masked_phone,
        "can_request_code": can_request_code,
        "resend_seconds": max(
            int(getattr(settings, "PORTAL_OTP_RESEND_SECONDS", 60) or 60),
            1,
        ),
        "code_expires_minutes": get_portal_otp_minutes(),
        "session_hours": get_portal_session_hours(),
        "detail": detail,
    }


def attach_portal_auth_state(
    payload: dict,
    *,
    cliente: Cliente,
    verified: bool,
    detail: str = "",
) -> dict:
    payload["portal_auth"] = build_portal_auth_state(
        cliente=cliente,
        verified=verified,
        detail=detail,
    )
    return payload


def build_locked_portal_payload(
    *,
    cliente: Cliente,
    detail: str = "",
) -> dict[str, object]:
    return {
        "cliente": {
            "id": None,
            "nombre": "Cliente BetterP",
            "rfc": None,
            "entidad_nombre": "",
            "correo": None,
            "telefono": None,
        },
        "resumen": {
            "saldo_vivo": 0,
            "recargos_activos": 0,
            "total_pagado": 0,
            "total_facturado": 0,
            "score_pago": 0,
            "score_label": "Protegido",
            "cuentas_totales": 0,
            "cuentas_vencidas_abiertas": 0,
            "cuentas_en_gracia": 0,
            "puntualidad_porcentaje": 0,
            "morosidad_porcentaje": 0,
        },
        "comportamiento": {},
        "tendencia_periodos": [],
        "pagos_recientes": [],
        "cuentas": [],
        "facturas_recientes": [],
        "comprobantes_recientes": [],
        "portal": {
            "token_horas": get_portal_token_hours(),
            "generado_en": timezone.now(),
        },
        "consentimiento_cobranza": None,
        "facturacion": {
            "activa": False,
            "pac_proveedor": None,
            "uso_cfdi_default": None,
            "metodo_pago_default": None,
            "forma_pago_default": None,
        },
        "datos_fiscales": {
            "rfc": None,
            "razon_social": None,
            "regimen_fiscal": None,
            "regimenes_fiscales_detectados": [],
            "regimen_fiscal_pendiente_seleccion": False,
            "codigo_postal": None,
            "correo": None,
            "archivo_csf_url": None,
        },
        "transferencia": {
            "beneficiario": None,
            "banco": None,
            "clabe": None,
            "referencia": None,
        },
        "portal_auth": build_portal_auth_state(
            cliente=cliente,
            verified=False,
            detail=detail,
        ),
    }


def build_authenticated_portal_payload(request, *, token: str, cliente: Cliente) -> dict:
    require_portal_otp_session(request, token=token, cliente=cliente)
    payload = build_portal_payload(token=token)
    return attach_portal_auth_state(payload, cliente=cliente, verified=True)


def cliente_has_current_collection_consent(cliente: Cliente) -> bool:
    consent = get_portal_collection_consent_payload()
    return bool(
        cliente.consentimiento_cobranza_aceptado
        and cliente.consentimiento_cobranza_version == consent["version"]
        and cliente.consentimiento_cobranza_texto_hash == consent["texto_hash"]
    )


def require_portal_collection_consent(cliente: Cliente) -> None:
    if cliente_has_current_collection_consent(cliente):
        return
    raise HttpError(
        403,
        "Para continuar en el portal, acepta primero el consentimiento de "
        "comunicaciones de cobranza y autoservicio.",
    )


def safe_portal_filename(filename: str, fallback: str) -> str:
    base = os.path.basename(filename or fallback).strip() or fallback
    cleaned = "".join(char if char.isalnum() or char in "._-" else "-" for char in base)
    return cleaned[:120] or fallback


def run_portal_receipt_analysis(
    *,
    evidencia: EvidenciaPago,
    config: ConfiguracionComunicacion,
    file_content: bytes | None = None,
    filename: str = "",
    content_type: str = "",
) -> dict[str, object]:
    google_vision_configured = bool(get_google_vision_api_key())
    openai_configured = bool(settings.OPENAI_API_KEY)
    analysis, google_vision_failure_reason = call_google_vision_receipt_analysis(
        config=config,
        evidencia=evidencia,
        file_content=file_content,
        filename=filename,
        content_type=content_type,
    )
    if analysis is None:
        analysis = call_openai_receipt_analysis(config=config, evidencia=evidencia)
    if analysis is None:
        fallback_reasons = [
            google_vision_failure_reason
            if google_vision_configured
            else "Google Vision OCR no esta configurado.",
            (
                "No se pudo completar la lectura visual con OpenAI."
                if openai_configured
                else "OpenAI no esta configurado."
            ),
            "Se usaron reglas sin lectura visual.",
        ]
        analysis = build_rule_receipt_analysis(
            config=config,
            evidencia=evidencia,
            fallback_reason=" ".join(fallback_reasons),
        )

    apply_receipt_analysis_to_evidence(
        evidencia=evidencia,
        config=config,
        analysis=analysis,
    )
    register_receipt_ai_usage(config=config, evidencia=evidencia, analysis=analysis)
    evidencia.refresh_from_db()
    return analysis


def portal_receipt_has_required_reading(evidencia: EvidenciaPago) -> bool:
    return bool(
        evidencia.monto_reportado
        and evidencia.monto_reportado > 0
        and evidencia.fecha_pago_reportada
        and not evidencia.requiere_revision_manual
    )


def portal_receipt_has_auto_apply_reading(
    evidencia: EvidenciaPago,
    config: ConfiguracionComunicacion | None = None,
) -> bool:
    threshold = (
        config.umbral_confianza_autoaplicacion
        if config and config.umbral_confianza_autoaplicacion is not None
        else Decimal("90")
    )
    confidence = evidencia.confianza_clasificacion or Decimal("0")
    return bool(
        evidencia.monto_reportado
        and evidencia.monto_reportado > 0
        and evidencia.fecha_pago_reportada
        and confidence >= threshold
    )


def find_portal_auto_apply_account(
    *,
    evidencia: EvidenciaPago,
    explicit_account: CuentaPorCobrar | None = None,
) -> tuple[CuentaPorCobrar | None, list[dict]]:
    if explicit_account is not None:
        return explicit_account, []
    if not portal_receipt_has_required_reading(evidencia):
        return None, []

    candidates = build_evidence_cxc_candidates(evidencia, limit=5)
    exact_candidates = [
        candidate
        for candidate in candidates
        if "monto exacto" in [str(reason).lower() for reason in candidate.get("motivos", [])]
    ]
    open_accounts = (
        CuentaPorCobrar.objects.select_related("entidad_relacionada", "cliente_relacionado")
        .filter(
            cliente_relacionado=evidencia.cliente_relacionado,
            monto_total__gt=F("monto_pagado"),
        )
        .order_by("fecha_vencimiento", "fecha_emision", "id")
    )
    if not open_accounts.exists():
        return None, candidates

    exact_ids = [candidate.get("id") for candidate in exact_candidates if candidate.get("id")]
    if exact_ids:
        account = open_accounts.filter(id__in=exact_ids).first()
        if account:
            return account, candidates

    if len(candidates) == 1:
        account_id = candidates[0].get("id")
        account = open_accounts.filter(id=account_id).first() if account_id else None
        if account:
            return account, candidates

    account = open_accounts.first()
    if not account:
        return None, candidates
    return account, candidates


def serialize_portal_cxc_candidates(candidates: list[dict]) -> list[dict]:
    serialized = []
    for candidate in candidates:
        item = {}
        for key, value in candidate.items():
            if isinstance(value, date):
                item[key] = value.isoformat()
            else:
                item[key] = value
        serialized.append(item)
    return serialized


def portal_receipt_unreadable_message(evidencia: EvidenciaPago) -> str:
    missing_parts = []
    if not evidencia.monto_reportado or evidencia.monto_reportado <= 0:
        missing_parts.append("monto")
    if not evidencia.fecha_pago_reportada:
        missing_parts.append("fecha")
    if missing_parts:
        return (
            "Recibimos tu comprobante, pero no pudimos leer todos los datos necesarios "
            "con suficiente claridad. Sube una imagen o PDF mas claro donde se vean "
            "monto, fecha y banco, o espera a que administracion lo revise."
        )
    if evidencia.requiere_revision_manual:
        return (
            "Comprobante recibido y leido. Detectamos monto y fecha; "
            "administracion lo revisara antes de aplicarlo."
        )
    return (
        "Comprobante recibido y leido. Administracion revisara la cuenta por cobrar "
        "antes de aplicarlo."
    )


def create_portal_reconciliation_event(
    *,
    evidencia: EvidenciaPago,
    cuenta: CuentaPorCobrar | None,
    aplicaciones: list[dict[str, object]],
    saldo_a_favor: float,
    monto: Decimal,
    fecha_pago: date,
    referencia: str,
    notas: str,
):
    if not aplicaciones and not saldo_a_favor:
        return None

    cliente = (cuenta.cliente_relacionado if cuenta else None) or evidencia.cliente_relacionado
    entidad = (cuenta.entidad_relacionada if cuenta else None) or evidencia.entidad_relacionada
    if not cliente or not entidad:
        return None

    partidas: list[dict[str, object]] = []
    payment_ids: list[int] = []
    for item in aplicaciones:
        pago_id = item.get("pago_id")
        cuenta_id = item.get("cuenta_id")
        if pago_id:
            payment_ids.append(int(pago_id))
        partidas.append(
            {
                "tipo_destino": "CXC",
                "entidad_id": entidad.id,
                "cliente_id": cliente.id,
                "cuenta_cxc_id": int(cuenta_id) if cuenta_id else (cuenta.id if cuenta else None),
                "concepto": str(
                    item.get("concepto")
                    or (cuenta.concepto if cuenta else None)
                    or "Pago portal"
                ),
                "beneficiario": cliente.razon_social or cliente.nombre_comercial or "",
                "monto_partida": Decimal(str(item.get("monto_aplicado") or "0")),
                "periodo_referencia": fecha_pago.strftime("%B %Y"),
                "estatus": "APLICADA",
                "metadata": {
                    "origen": "PORTAL_CLIENTE",
                    "pago_id": pago_id,
                    "cuenta_id": cuenta_id,
                },
                "observaciones": (
                    "Pago aplicado desde portal cliente; pendiente de conciliacion bancaria."
                ),
            }
        )

    if saldo_a_favor:
        partidas.append(
            {
                "tipo_destino": "SALDO_A_FAVOR",
                "entidad_id": entidad.id,
                "cliente_id": cliente.id,
                "concepto": "Saldo a favor desde portal cliente",
                "beneficiario": cliente.razon_social or cliente.nombre_comercial or "",
                "monto_partida": Decimal(str(saldo_a_favor)),
                "periodo_referencia": fecha_pago.strftime("%B %Y"),
                "estatus": "APLICADA",
                "metadata": {"origen": "PORTAL_CLIENTE"},
            }
        )

    event = upsert_financial_event(
        evidencia_id=evidencia.id,
        entidad_id=entidad.id,
        cliente_id=cliente.id,
        origen_evento="ESTADO_CUENTA",
        tipo_movimiento="INGRESO",
        beneficiario_principal=cliente.razon_social or cliente.nombre_comercial or "",
        referencia_principal=referencia.strip(),
        fecha_evento=fecha_pago,
        monto_total_reportado=monto,
        confianza_global=Decimal("100"),
        requiere_revision_manual=False,
        texto_consolidado=notas.strip() or "Comprobante recibido desde portal cliente.",
        raw_data={
            "origen": "PORTAL_CLIENTE",
            "evidencia_id": evidencia.id,
            "cuenta_id": cuenta.id if cuenta else None,
            "aplicaciones": aplicaciones,
            "saldo_a_favor": saldo_a_favor,
        },
        observaciones="Pago aplicado desde portal cliente; pendiente de conciliacion bancaria.",
        estatus="APLICADO",
        partidas=partidas,
    )
    if payment_ids:
        PagoCuentaPorCobrar.objects.filter(id__in=payment_ids).update(
            evento_financiero_relacionado=event
        )
    return event


class PlantillaMensajeIn(Schema):
    nombre: str
    descripcion: str = ""
    canal: str = "WHATSAPP"
    tipo_plantilla: str = "MENSAJE_PERSONALIZADO"
    asunto: str = ""
    cuerpo: str
    incluye_link_portal: bool = True
    url_media: str = ""
    whatsapp_template_name: str = ""
    whatsapp_template_language: str = "es_MX"
    whatsapp_template_category: str = ""
    whatsapp_template_status: str = "NO_CONFIGURADA"
    whatsapp_template_notes: str = ""
    activo: bool = True


class ReglaAutomatizacionMensajeIn(Schema):
    nombre: str
    descripcion: str = ""
    plantilla_id: int
    entidad_id: Optional[int] = None
    canal: str = "WHATSAPP"
    evento_base: str = "FECHA_VENCIMIENTO"
    desplazamiento_dias: int = 0
    segmento: str = "CXC_ABIERTA"
    activo: bool = True


class PreviewEnvioIn(Schema):
    plantilla_id: Optional[int] = None
    entidad_id: Optional[int] = None
    cliente_ids: list[int] = []
    segmento: str = "CXC_ABIERTA"
    canal: str = "WHATSAPP"
    asunto: str = ""
    mensaje: str = ""
    incluye_link_portal: bool = True
    url_media: str = ""
    fecha_referencia: Optional[date] = None


class WhatsappSharedNumberAgreementAcceptIn(Schema):
    acepta_contacto_autorizado: bool
    acepta_datos_correctos: bool
    acepta_politicas_whatsapp: bool
    acepta_suspension_por_riesgo: bool


class WhatsappLabTestIn(Schema):
    plantilla_id: int
    numero_destino: str
    cliente_id: Optional[int] = None


class WhatsappLabContactIn(Schema):
    nombre: str
    telefono: str
    notas: str = ""
    consentimiento_confirmado: bool = False


class CobranzaDemoMetaIn(Schema):
    entidad_id: Optional[int] = None
    entidad_nombre: str = ""
    numero_destino: str = ""
    cliente_nombre: str = ""
    correo: str = ""
    monto: str = ""
    fecha_referencia: Optional[date] = None
    dry_run: bool = False


class CobranzaLabResetIn(Schema):
    entidad_id: Optional[int] = None
    numero_destino: str = ""
    fecha_referencia: Optional[date] = None
    recrear_demo: bool = True


class CobranzaOnboardingCloseIn(Schema):
    progreso: int = 0
    pasos_completos: int = 0
    pasos_totales: int = 0
    bloqueantes: list[str] = []
    pasos: list[dict] = []


class PortalCollectionConsentIn(Schema):
    acepta_comunicaciones_cobranza: bool
    acepta_actualizacion_contacto: bool


class PortalOtpVerifyIn(Schema):
    codigo: str


class HistorialEnvioRevisionIn(Schema):
    nota: str = ""


def get_or_create_main_config(request) -> ConfiguracionComunicacion:
    capa = get_current_capa(request)
    config = ConfiguracionComunicacion.objects.filter(
        capa_negocio=capa,
        clave="PRINCIPAL",
    ).first()
    if config:
        return config
    return ConfiguracionComunicacion.objects.create(
        capa_negocio=capa,
        clave="PRINCIPAL",
    )


def get_or_create_portal_config(cliente: Cliente) -> ConfiguracionComunicacion:
    entidad = getattr(cliente, "entidad_relacionada", None)
    capa = getattr(entidad, "capa_negocio", None) if entidad else None
    if capa:
        config = ConfiguracionComunicacion.objects.filter(
            capa_negocio=capa,
            clave="PRINCIPAL",
        ).first()
        if config:
            return config
        return ConfiguracionComunicacion.objects.create(
            capa_negocio=capa,
            clave="PRINCIPAL",
        )
    config = ConfiguracionComunicacion.objects.filter(clave="PRINCIPAL").first()
    if config:
        return config
    return ConfiguracionComunicacion.objects.create(clave="PRINCIPAL")


def serialize_cobranza_onboarding_state(capa: CapaNegocio) -> dict:
    agreement = (
        AcuerdoUsoComunicacion.objects.filter(
            capa_negocio=capa,
            tipo_acuerdo=COBRANZA_ONBOARDING_REVIEW_TYPE,
            version=COBRANZA_ONBOARDING_REVIEW_VERSION,
            texto_hash=COBRANZA_ONBOARDING_REVIEW_HASH,
        )
        .order_by("-fecha_aceptacion", "-id")
        .first()
    )
    state = agreement.metadata if agreement and isinstance(agreement.metadata, dict) else {}
    closed_at = state.get("closed_at")
    return {
        "closed": bool(closed_at),
        "closed_at": closed_at,
        "closed_by_id": state.get("closed_by_id"),
        "closed_by_email": state.get("closed_by_email"),
        "closed_by_name": state.get("closed_by_name"),
        "progress": int(state.get("progress") or 0),
        "completed_steps": int(state.get("completed_steps") or 0),
        "total_steps": int(state.get("total_steps") or 0),
        "blockers": state.get("blockers") if isinstance(state.get("blockers"), list) else [],
        "steps": state.get("steps") if isinstance(state.get("steps"), list) else [],
        "reopened_at": state.get("reopened_at"),
        "reopened_by_email": state.get("reopened_by_email"),
    }


def persist_cobranza_onboarding_state(
    *,
    request,
    capa: CapaNegocio,
    user,
    state: dict,
) -> AcuerdoUsoComunicacion:
    agreement, _ = AcuerdoUsoComunicacion.objects.update_or_create(
        capa_negocio=capa,
        tipo_acuerdo=COBRANZA_ONBOARDING_REVIEW_TYPE,
        version=COBRANZA_ONBOARDING_REVIEW_VERSION,
        texto_hash=COBRANZA_ONBOARDING_REVIEW_HASH,
        defaults={
            "aceptado_por": user,
            "titulo": COBRANZA_ONBOARDING_REVIEW_TITLE,
            "ip_address": get_request_ip(request),
            "user_agent": get_request_user_agent(request),
            "metadata": state,
        },
    )
    return agreement


def scoped_entity_queryset(request):
    return EntidadNegocio.objects.filter(id__in=get_allowed_entity_ids(request))


def scoped_client_queryset(request):
    return Cliente.objects.filter(
        activo=True,
        entidad_relacionada_id__in=get_allowed_entity_ids(request),
    )


def serialize_template(template: PlantillaMensaje) -> dict:
    return {
        "id": template.id,
        "nombre": template.nombre,
        "descripcion": template.descripcion,
        "canal": template.canal,
        "tipo_plantilla": template.tipo_plantilla,
        "asunto": template.asunto,
        "cuerpo": template.cuerpo,
        "incluye_link_portal": template.incluye_link_portal,
        "url_media": template.url_media,
        "whatsapp_template_name": template.whatsapp_template_name,
        "whatsapp_template_language": template.whatsapp_template_language,
        "whatsapp_template_category": template.whatsapp_template_category,
        "whatsapp_template_status": template.whatsapp_template_status,
        "whatsapp_template_notes": template.whatsapp_template_notes,
        "activo": template.activo,
    }


def serialize_rule(rule: ReglaAutomatizacionMensaje) -> dict:
    return {
        "id": rule.id,
        "nombre": rule.nombre,
        "descripcion": rule.descripcion,
        "plantilla_id": rule.plantilla_relacionada_id,
        "plantilla_nombre": rule.plantilla_relacionada.nombre,
        "entidad_id": rule.entidad_relacionada_id,
        "entidad_nombre": (
            rule.entidad_relacionada.nombre_comercial if rule.entidad_relacionada else None
        ),
        "canal": rule.canal,
        "evento_base": rule.evento_base,
        "desplazamiento_dias": rule.desplazamiento_dias,
        "segmento": rule.segmento,
        "activo": rule.activo,
        "fecha_actualizacion": rule.fecha_actualizacion,
    }


def serialize_history(item: HistorialEnvio) -> dict:
    metadata = item.metadata or {}
    return {
        "id": item.id,
        "cliente_id": item.cliente_relacionado_id,
        "cliente_nombre": item.cliente_relacionado.razon_social
        or item.cliente_relacionado.nombre_comercial
        or f"Cliente {item.cliente_relacionado_id}",
        "entidad_id": item.entidad_relacionada_id,
        "entidad_nombre": item.entidad_relacionada.nombre_comercial if item.entidad_relacionada else None,
        "plantilla_id": item.plantilla_usada_id,
        "plantilla_nombre": item.plantilla_usada.nombre if item.plantilla_usada else None,
        "automatizacion_id": item.automatizacion_relacionada_id,
        "automatizacion_nombre": item.automatizacion_relacionada.nombre if item.automatizacion_relacionada else None,
        "canal": item.canal,
        "tipo_envio": item.tipo_envio,
        "proveedor": item.proveedor,
        "destinatario": item.destinatario,
        "asunto": item.asunto,
        "cuerpo_renderizado": item.cuerpo_renderizado,
        "url_media": item.url_media,
        "referencia_envio": item.referencia_envio,
        "estatus": item.estatus,
        "metadata": metadata,
        "revision_operativa": metadata.get("revision_operativa") or None,
        "fecha_envio": item.fecha_envio,
    }


def _safe_int(value, default: int = 0) -> int:
    try:
        return int(value or default)
    except (TypeError, ValueError):
        return default


def get_cron_layer_summary(metadata: dict, capa_id: int) -> dict | None:
    if _safe_int(metadata.get("capa_id")) == int(capa_id):
        return {
            "capa_id": int(capa_id),
            "sent": _safe_int(metadata.get("sent")),
            "skipped": _safe_int(metadata.get("skipped")),
            "errors": _safe_int(metadata.get("errors")),
            "rules": _safe_int(metadata.get("rules")),
            "candidates": _safe_int(metadata.get("candidates")),
            "limit_reached": bool(metadata.get("limit_reached")),
            "no_entities": bool(metadata.get("no_entities")),
            "dry_run": bool(metadata.get("dry_run")),
            "readiness": metadata.get("readiness") or {},
        }

    for row in metadata.get("capas") or []:
        if not isinstance(row, dict):
            continue
        if _safe_int(row.get("capa_id")) != int(capa_id):
            continue
        return {
            "capa_id": int(capa_id),
            "sent": _safe_int(row.get("sent")),
            "skipped": _safe_int(row.get("skipped")),
            "errors": _safe_int(row.get("errors")),
            "rules": _safe_int(row.get("rules")),
            "candidates": _safe_int(row.get("candidates")),
            "limit_reached": bool(row.get("limit_reached")),
            "no_entities": bool(row.get("no_entities")),
            "dry_run": bool(row.get("dry_run")),
            "readiness": row.get("readiness") or {},
        }
    return None


def cron_metadata_is_legacy_global(metadata: dict) -> bool:
    return "capa_id" not in metadata and "capas" not in metadata


def select_payment_reminder_cron_for_layer(
    runs: list[CronRunLog],
    *,
    capa_id: int,
) -> CronRunLog | None:
    for run in runs:
        metadata = run.metadata or {}
        if get_cron_layer_summary(metadata, capa_id):
            return run
        if cron_metadata_is_legacy_global(metadata):
            return run
    return None


def format_layer_cron_summary(layer_summary: dict | None) -> str | None:
    if not layer_summary:
        return None
    if layer_summary.get("no_entities"):
        return "Capa sin entidades activas en la ultima corrida."
    readiness = layer_summary.get("readiness") or {}
    if readiness and not readiness.get("ok", True):
        issues = readiness.get("issues") or []
        return f"WhatsApp no listo para envio automatico: {len(issues)} problema(s)."
    return (
        "Capa procesada. "
        f"Enviados: {layer_summary['sent']} | "
        f"Omitidos: {layer_summary['skipped']} | "
        f"Errores: {layer_summary['errors']} | "
        f"Reglas: {layer_summary['rules']} | "
        f"Candidatos: {layer_summary['candidates']}"
    )


def serialize_payment_reminder_cron(run: CronRunLog | None, *, capa_id: int, now) -> dict:
    if not run:
        return {
            "status": "SIN_CORRIDA",
            "detail": "Sin ejecucion registrada para esta capa.",
            "minutes_since_last_run": None,
            "last_run": None,
        }

    reference_time = run.finished_at or run.started_at
    minutes_since_last_run = max(int((now - reference_time).total_seconds() // 60), 0)
    overdue = reference_time < now - timedelta(hours=PAYMENT_REMINDER_EXPECTED_HOURS)
    status = "OK"
    detail = "Ultima ejecucion correcta."
    if run.status == "ERROR":
        status = "ERROR"
        detail = run.error or "La ultima ejecucion fallo."
    elif run.status == "RUNNING":
        status = "WARN"
        detail = "La ejecucion sigue marcada como activa."
    elif overdue:
        status = "WARN"
        detail = f"No se ejecuta desde hace mas de {PAYMENT_REMINDER_EXPECTED_HOURS} horas."

    metadata = run.metadata or {}
    is_layer_specific = _safe_int(metadata.get("capa_id")) == int(capa_id)
    layer_summary = get_cron_layer_summary(metadata, capa_id)
    legacy_global = cron_metadata_is_legacy_global(metadata)
    includes_current_layer = bool(is_layer_specific or layer_summary or legacy_global)
    if is_layer_specific:
        coverage = "CAPA"
    elif layer_summary:
        coverage = "GLOBAL_DETALLADO"
    elif legacy_global:
        coverage = "GLOBAL_LEGACY"
    else:
        coverage = "SIN_COBERTURA"
        if status == "OK":
            status = "WARN"
            detail = "La ultima ejecucion registrada no incluyo esta capa."
    safe_metadata = {
        key: value
        for key, value in metadata.items()
        if key in SAFE_CRON_METADATA_KEYS
    }
    tenant_summary = run.summary if is_layer_specific else format_layer_cron_summary(layer_summary)
    return {
        "status": status,
        "detail": detail,
        "minutes_since_last_run": minutes_since_last_run,
        "expected_hours": PAYMENT_REMINDER_EXPECTED_HOURS,
        "last_run": {
            "id": run.id,
            "key": run.key,
            "status": run.status,
            "started_at": run.started_at,
            "finished_at": run.finished_at,
            "duration_ms": run.duration_ms,
            "summary": tenant_summary,
            "error": run.error if run.status == "ERROR" else None,
            "metadata": safe_metadata,
            "global_run": not is_layer_specific,
            "includes_current_layer": includes_current_layer,
            "coverage": coverage,
            "layer_summary": layer_summary,
        },
    }


def build_alert(level: str, title: str, detail: str) -> dict:
    return {"tipo": level, "titulo": title, "detalle": detail}


def build_operational_action(
    level: str,
    title: str,
    detail: str,
    action: str,
) -> dict:
    return {
        "tipo": level,
        "titulo": title,
        "detalle": detail,
        "accion": action,
    }


def build_payment_reminder_actions(
    *,
    cron_status: dict,
    activity: dict,
    rule_summary: dict,
    blocked_whatsapp_rules: list,
    template_summary: dict,
    usage_limits: dict,
) -> list[dict]:
    actions: list[dict] = []
    last_run = cron_status.get("last_run") or {}
    layer_summary = last_run.get("layer_summary") or {}
    metadata = last_run.get("metadata") or {}
    send_window = metadata.get("send_window") if isinstance(metadata, dict) else {}
    if not isinstance(send_window, dict):
        send_window = {}

    if cron_status.get("status") == "SIN_CORRIDA":
        actions.append(
            build_operational_action(
                "ERROR",
                "Configurar primera corrida del cron",
                "Todavia no hay ejecuciones registradas para recordatorios de cobranza.",
                "Crea o ejecuta el Cron Job de Render con limites bajos y valida que aparezca en esta pantalla.",
            )
        )
    elif cron_status.get("status") == "ERROR":
        actions.append(
            build_operational_action(
                "ERROR",
                "Revisar logs de la ultima corrida",
                cron_status.get("detail") or "La ultima corrida termino con error.",
                "Abre los logs del Cron Job en Render, corrige la causa y ejecuta un dry-run antes de volver a enviar.",
            )
        )
    elif cron_status.get("status") == "WARN":
        actions.append(
            build_operational_action(
                "WARN",
                "Confirmar que el cron sigue programado",
                cron_status.get("detail") or "La ultima corrida requiere atencion.",
                "Ejecuta manualmente el Cron Job o revisa su horario en Render; despues actualiza este panel.",
            )
        )

    if metadata.get("skipped_by_send_window") or send_window.get("can_send") is False:
        actions.append(
            build_operational_action(
                "WARN",
                "Corrida omitida por ventana operativa",
                send_window.get("detail") or "La corrida se detuvo por horario permitido.",
                "No es un error si ocurrio fuera del horario de cobranza. Si fue intencional, ejecuta una prueba con --ignore-send-window.",
            )
        )

    if layer_summary:
        if layer_summary.get("dry_run"):
            actions.append(
                build_operational_action(
                    "INFO",
                    "Ultima corrida fue simulacion",
                    "El cron calculo candidatos sin enviar mensajes reales.",
                    "Cuando estes listo, ejecuta una corrida real limitada con maximo 1 envio.",
                )
            )
        if layer_summary.get("readiness") and not layer_summary["readiness"].get("ok", True):
            issue_count = len(layer_summary["readiness"].get("issues") or [])
            actions.append(
                build_operational_action(
                    "ERROR",
                    "Resolver readiness de WhatsApp",
                    f"La capa tiene {issue_count} problema(s) antes de enviar automaticos.",
                    "Sincroniza Meta, confirma canal oficial y revisa que cada regla use plantilla aprobada.",
                )
            )
        if layer_summary.get("limit_reached"):
            actions.append(
                build_operational_action(
                    "INFO",
                    "Limite por corrida alcanzado",
                    "La ultima corrida se detuvo por el tope configurado.",
                    "Si el piloto va bien, sube el limite gradualmente y revisa historial despues de cada corrida.",
                )
            )
        if (
            _safe_int(layer_summary.get("sent")) == 0
            and _safe_int(layer_summary.get("candidates")) == 0
            and _safe_int(layer_summary.get("rules")) > 0
        ):
            actions.append(
                build_operational_action(
                    "INFO",
                    "Sin candidatos para la fecha procesada",
                    "Las reglas estan activas, pero la ultima fecha no encontro cuentas en ventana.",
                    "Usa el simulador por fecha para confirmar preventivo, vence hoy, gracia y atraso.",
                )
            )
        if (
            _safe_int(layer_summary.get("sent")) == 0
            and _safe_int(layer_summary.get("candidates")) > 0
            and _safe_int(layer_summary.get("skipped")) > 0
        ):
            actions.append(
                build_operational_action(
                    "WARN",
                    "Candidatos omitidos",
                    "Hubo candidatos, pero ninguno se envio en la ultima corrida de la capa.",
                    "Revisa Ultimos envios para ver si fue por allowlist, consentimiento, baja, 24 horas o limite.",
                )
            )

    if _safe_int(activity.get("errores_24h")) > 0:
        actions.append(
            build_operational_action(
                "ERROR",
                "Atender errores de proveedor",
                f"{activity['errores_24h']} envio(s) automatico(s) fallaron en las ultimas 24 horas.",
                "Abre Ultimos envios, copia el error de Meta y corrige plantilla, parametros o token antes de subir volumen.",
            )
        )

    if _safe_int(rule_summary.get("activas")) == 0:
        actions.append(
            build_operational_action(
                "WARN",
                "Activar reglas de cobranza",
                "No hay automatizaciones activas para esta capa.",
                "Activa solo las reglas que ya tengan plantilla aprobada y que respeten las ventanas por fecha.",
            )
        )

    pending_templates = _safe_int(template_summary.get("whatsapp_pendientes"))
    if pending_templates > 0 or blocked_whatsapp_rules:
        actions.append(
            build_operational_action(
                "WARN",
                "Sincronizar o corregir plantillas Meta",
                f"{pending_templates} plantilla(s) siguen sin aprobar o no estan listas para reglas activas.",
                "Usa Sincronizar Meta y revisa los bloqueos por plantilla antes de automatizar.",
            )
        )

    for usage_limit in usage_limits.values():
        if int(usage_limit.get("incluido") or 0) > 0 and int(
            usage_limit.get("usado") or 0
        ) >= int(usage_limit["incluido"] * 0.8):
            actions.append(
                build_operational_action(
                    "WARN",
                    f"Vigilar cuota {usage_limit['label']}",
                    f"Restan {usage_limit['restante']} envio(s) del periodo {usage_limit['periodo']}.",
                    "Antes de aumentar volumen, confirma que el plan tenga capacidad suficiente.",
                )
            )

    if not actions:
        actions.append(
            build_operational_action(
                "OK",
                "Operacion automatica estable",
                "No hay bloqueantes operativos detectados en cron, plantillas, reglas o consumo.",
                "Mantén limites bajos durante el piloto y sube volumen solo despues de revisar historial y respuestas.",
            )
        )
    return actions[:8]


META_TEMPLATE_STATUS_MAP = {
    "APPROVED": "APROBADA",
    "ACTIVE": "APROBADA",
    "PENDING": "EN_REVISION",
    "IN_APPEAL": "EN_REVISION",
    "REJECTED": "RECHAZADA",
    "PAUSED": "PAUSADA",
    "DISABLED": "PAUSADA",
}


def scoped_template_queryset(request):
    return PlantillaMensaje.objects.filter(capa_negocio=get_current_capa(request))


def normalize_meta_template_status(value: str | None) -> str:
    normalized = str(value or "").strip().upper()
    if normalized in META_TEMPLATE_STATUS_MAP:
        return META_TEMPLATE_STATUS_MAP[normalized]
    if "APPROVED" in normalized or "ACTIVE" in normalized or "ACTIVA" in normalized:
        return "APROBADA"
    if "PENDING" in normalized or "REVIEW" in normalized or "REVISION" in normalized:
        return "EN_REVISION"
    if "REJECT" in normalized or "RECHAZ" in normalized:
        return "RECHAZADA"
    if "PAUS" in normalized or "DISABL" in normalized:
        return "PAUSADA"
    return "BORRADOR"


def normalize_template_key(name: str | None, language: str | None) -> tuple[str, str]:
    return (
        str(name or "").strip().lower(),
        str(language or "").strip().lower().replace("-", "_"),
    )


def ensure_whatsapp_template_ready_for_active_rule(
    template: PlantillaMensaje,
    payload: ReglaAutomatizacionMensajeIn,
) -> None:
    if not payload.activo or not channel_uses_whatsapp(payload.canal):
        return
    if (template.whatsapp_template_status or "").strip() != "APROBADA":
        raise HttpError(
            400,
            "No puedes activar esta regla todavia: la plantilla de WhatsApp "
            f"'{template.nombre}' no esta aprobada por Meta.",
        )


def resolve_meta_templates_channel(request) -> CanalWhatsappOficial:
    capa = get_current_capa(request)
    queryset = (
        CanalWhatsappOficial.objects.filter(
            capa_negocio=capa,
            activo=True,
            estado="CONECTADO",
        )
        .exclude(access_token__isnull=True)
        .exclude(access_token="")
        .filter(Q(waba_id__isnull=False) | Q(business_account_id__isnull=False))
        .order_by("-es_principal", "id")
    )
    channel = queryset.first()
    if not channel:
        raise HttpError(
            400,
            "Configura un canal de WhatsApp Cloud conectado, con WABA ID y token, "
            "antes de sincronizar plantillas.",
        )
    return channel


def read_meta_json(response: requests.Response) -> dict:
    try:
        payload = response.json()
    except ValueError as exc:
        raise HttpError(502, "Meta respondio con un formato inesperado.") from exc
    if response.ok:
        return payload
    error_payload = payload.get("error") if isinstance(payload, dict) else None
    detail = (
        error_payload.get("message")
        if isinstance(error_payload, dict)
        else response.text[:240]
    )
    raise HttpError(502, f"No se pudo consultar Meta: {detail or response.status_code}")


def fetch_meta_message_templates(channel: CanalWhatsappOficial) -> list[dict]:
    waba_id = (channel.waba_id or channel.business_account_id or "").strip()
    endpoint = (
        f"{settings.WHATSAPP_CLOUD_API_BASE_URL.rstrip('/')}/"
        f"{settings.WHATSAPP_CLOUD_API_VERSION.strip('/')}/{waba_id}/message_templates"
    )
    headers = {"Authorization": f"Bearer {channel.access_token}"}
    params = {
        "fields": "name,language,status,category,rejected_reason",
        "limit": "100",
    }
    templates: list[dict] = []
    next_url: str | None = endpoint
    while next_url:
        try:
            response = requests.get(
                next_url,
                headers=headers,
                params=params if next_url == endpoint else None,
                timeout=20,
            )
        except requests.RequestException as exc:
            raise HttpError(502, f"No se pudo conectar con Meta: {exc}") from exc
        payload = read_meta_json(response)
        templates.extend(payload.get("data") or [])
        paging = payload.get("paging") or {}
        next_url = str(paging.get("next") or "").strip() or None
        params = {}
    return templates


def sync_whatsapp_template_statuses(request) -> dict:
    ensure_default_templates(request)
    channel = resolve_meta_templates_channel(request)
    meta_templates = fetch_meta_message_templates(channel)

    by_exact_key: dict[tuple[str, str], dict] = {}
    by_name: dict[str, list[dict]] = {}
    for item in meta_templates:
        name = str(item.get("name") or "").strip()
        language = str(item.get("language") or "").strip()
        if not name:
            continue
        by_exact_key[normalize_template_key(name, language)] = item
        by_name.setdefault(name.lower(), []).append(item)

    updated = 0
    unchanged = 0
    missing: list[dict] = []
    synced_templates: list[dict] = []
    sync_date = timezone.localtime(timezone.now()).strftime("%Y-%m-%d %H:%M")

    queryset = scoped_template_queryset(request).filter(
        canal__in=["WHATSAPP", "AMBOS"],
        whatsapp_template_name__isnull=False,
    ).exclude(whatsapp_template_name="")
    for template in queryset:
        name = (template.whatsapp_template_name or "").strip()
        language = (template.whatsapp_template_language or "es_MX").strip()
        meta_item = by_exact_key.get(normalize_template_key(name, language))
        if not meta_item:
            name_matches = by_name.get(name.lower()) or []
            if len(name_matches) == 1:
                meta_item = name_matches[0]
        if not meta_item:
            missing.append(serialize_template(template))
            continue

        new_status = normalize_meta_template_status(str(meta_item.get("status") or ""))
        new_category = str(meta_item.get("category") or "").strip().upper() or None
        rejected_reason = str(meta_item.get("rejected_reason") or "").strip()
        note = f"Sincronizada con Meta el {sync_date}."
        if rejected_reason:
            note = f"Meta rechazo: {rejected_reason}"[:255]

        changed_fields: list[str] = []
        if template.whatsapp_template_status != new_status:
            template.whatsapp_template_status = new_status
            changed_fields.append("whatsapp_template_status")
        if new_category and template.whatsapp_template_category != new_category:
            template.whatsapp_template_category = new_category
            changed_fields.append("whatsapp_template_category")
        if template.whatsapp_template_notes != note:
            template.whatsapp_template_notes = note
            changed_fields.append("whatsapp_template_notes")

        if changed_fields:
            template.save(update_fields=[*changed_fields])
            updated += 1
        else:
            unchanged += 1
        synced_templates.append(serialize_template(template))

    channel.fecha_ultimo_check = timezone.now()
    channel.metadata = {
        **(channel.metadata or {}),
        "templates_last_sync": timezone.now().isoformat(),
        "templates_seen": len(meta_templates),
    }
    channel.save(update_fields=["fecha_ultimo_check", "metadata", "fecha_actualizacion"])

    return {
        "success": True,
        "canal": {
            "id": channel.id,
            "nombre": channel.nombre,
            "display_phone_number": channel.display_phone_number,
            "waba_id": channel.waba_id or channel.business_account_id,
        },
        "meta_total": len(meta_templates),
        "revisadas": queryset.count(),
        "actualizadas": updated,
        "sin_cambios": unchanged,
        "sin_coincidencia": len(missing),
        "plantillas": synced_templates,
        "faltantes": missing,
    }


def build_whatsapp_lab_context(
    *,
    request,
    cliente: Cliente,
    config: ConfiguracionComunicacion,
) -> dict[str, object]:
    today = timezone.localdate()
    payment_period_start = date(today.year, today.month, 1)
    if payment_period_start.month == 12:
        next_month_start = date(payment_period_start.year + 1, 1, 1)
    else:
        next_month_start = date(
            payment_period_start.year,
            payment_period_start.month + 1,
            1,
        )
    payment_period_end = next_month_start - timedelta(days=1)
    due_date = min(date(today.year, today.month, 10), payment_period_end)
    grace_date = min(due_date + timedelta(days=3), payment_period_end)

    entidad = getattr(cliente, "entidad_relacionada", None)
    capa = get_current_capa(request)
    saldo = Decimal("8500.00")
    recargo = Decimal("850.00")
    pago_parcial = Decimal("5000.00")
    total = saldo + recargo
    return {
        "cliente_id": cliente.id,
        "cliente_nombre": client_display_name(cliente),
        "cliente_rfc": cliente.rfc or "",
        "cliente_identificador": cliente.identificador or "",
        "cliente_email": cliente.correo_principal or "",
        "cliente_telefono": cliente.telefono or "",
        "entidad_nombre": (
            getattr(entidad, "nombre_comercial", "") if entidad else capa.nombre
        ),
        "capa_negocio": capa.nombre,
        "espacio_codigo": "Hab 01",
        "concepto": "Renta Hab 01",
        "periodo": (
            f"{payment_period_start:%d/%m/%Y} al {payment_period_end:%d/%m/%Y}"
        ),
        "periodo_pago": format_month_year_es(payment_period_start),
        "fecha_vencimiento": f"{due_date:%d/%m/%Y}",
        "fecha_vencimiento_larga": format_long_date_es(due_date),
        "fecha_limite_gracia": f"{grace_date:%d/%m/%Y}",
        "fecha_limite_gracia_larga": format_long_date_es(grace_date),
        "dias_gracia": 3,
        "dias_atraso": 3,
        "dias_atraso_post_gracia": 0,
        "saldo_vivo": float(saldo),
        "saldo_vivo_formato": format_money(saldo),
        "recargo_total": float(recargo),
        "recargo_total_formato": format_money(recargo),
        "recargo_descripcion": "10% sobre saldo vencido",
        "total_exigible": float(total),
        "total_exigible_formato": format_money(total),
        "monto_recibido": float(pago_parcial),
        "monto_recibido_formato": format_money(pago_parcial),
        "saldo_pendiente": float(saldo - pago_parcial),
        "saldo_pendiente_formato": format_money(saldo - pago_parcial),
        "cuentas_abiertas": 1,
        "portal_url": build_portal_url(cliente=cliente, config=config),
        "referencia_pago": "BETT-DEMO-001",
        "banco_transferencia": getattr(capa, "banco_transferencias", "") or "",
        "clabe_transferencia": getattr(capa, "clabe_transferencias", "") or "",
        "beneficiario_transferencia": (
            getattr(capa, "beneficiario_transferencias", "") or ""
        ),
        "fecha_referencia": f"{today:%d/%m/%Y}",
        "facturacion_activa": bool(getattr(capa, "facturacion_activa", False)),
        "modo_prueba": "Laboratorio seguro BetterP",
        "config_id": config.id,
    }


def build_template_parameter_values(
    template: PlantillaMensaje,
    context: dict[str, object],
) -> list[str]:
    return [
        str(context.get(match.group(1), "") or "")
        for match in TOKEN_PATTERN.finditer(template.cuerpo or "")
    ]


def send_payment_acknowledgement_if_ready(
    *,
    config: ConfiguracionComunicacion,
    cliente: Cliente,
    cuenta: CuentaPorCobrar | None,
    evidencia: EvidenciaPago,
    monto: Decimal,
    partial_payment: bool,
) -> dict:
    template_name = (
        "betterp_pago_parcial_recibido" if partial_payment else "betterp_pago_recibido"
    )
    account_key = cuenta.id if cuenta else "saldo-a-favor"
    dedupe_key = f"payment-ack:{evidencia.id}:{account_key}:{template_name}"
    if HistorialEnvio.objects.filter(llave_idempotencia=dedupe_key).exists():
        return {
            "enviado": False,
            "omitido": True,
            "motivo": "acuse_ya_registrado",
            "template_name": template_name,
        }

    template = (
        PlantillaMensaje.objects.filter(
            capa_negocio=config.capa_negocio,
            canal__in=["WHATSAPP", "AMBOS"],
            activo=True,
            whatsapp_template_name=template_name,
        )
        .order_by("-id")
        .first()
    )
    entidad = (
        cuenta.entidad_relacionada if cuenta else None
    ) or cliente.entidad_relacionada
    entidad_nombre = (
        getattr(entidad, "nombre_comercial", None)
        or getattr(entidad, "nombre", None)
        or getattr(config.capa_negocio, "nombre", None)
        or "BetterP"
    )
    saldo_pendiente = cuenta.saldo_pendiente if cuenta else Decimal("0")
    context = {
        "cliente_nombre": client_display_name(cliente),
        "entidad_nombre": entidad_nombre,
        "concepto": (cuenta.concepto if cuenta else "") or "Saldo a favor",
        "referencia_pago": (
            (cuenta.referencia_unica if cuenta else "")
            or evidencia.referencia_reportada
            or ""
        ),
        "monto_recibido": decimal_to_float(monto),
        "monto_recibido_formato": format_money(monto),
        "saldo_pendiente": decimal_to_float(saldo_pendiente),
        "saldo_pendiente_formato": format_money(saldo_pendiente),
        "portal_url": build_portal_url(cliente=cliente, config=config),
    }
    metadata = {
        "origen": "PORTAL_CLIENTE",
        "acuse_pago": True,
        "evidencia_id": evidencia.id,
        "cuenta_id": cuenta.id if cuenta else None,
        "template_name": template_name,
        "partial_payment": partial_payment,
        "saldo_a_favor": cuenta is None,
    }

    def omit(reason: str, body: str = "") -> dict:
        register_history(
            config=config,
            cliente=cliente,
            template=template,
            automation=None,
            channel="WHATSAPP",
            provider="META_CLOUD_API",
            destination=build_whatsapp_chat_id(cliente) or "",
            subject="",
            body=body,
            media_url=None,
            status="OMITIDO",
            reference=None,
            dedupe_key=dedupe_key,
            metadata={**metadata, "motivo": reason},
            send_type="AUTOMATICO",
        )
        return {
            "enviado": False,
            "omitido": True,
            "motivo": reason,
            "template_name": template_name,
        }

    if getattr(cliente, "no_contactar_cobranza", False):
        return omit("cliente_no_contactar_cobranza")
    destination = build_whatsapp_chat_id(cliente)
    if not destination:
        return omit("cliente_sin_telefono_whatsapp")
    lab_destination_allowed = is_portal_lab_whatsapp_destination_allowed(
        cliente,
        destination,
    )
    metadata["lab_destination_allowed"] = lab_destination_allowed
    if not template:
        return omit("plantilla_no_configurada")
    if (template.whatsapp_template_status or "").strip() != "APROBADA":
        return omit("plantilla_no_aprobada")

    rendered_body = render_template(template.cuerpo, context)
    parameters = build_template_parameter_values(template, context)
    metadata["whatsapp_template_parameters"] = parameters
    try:
        provider_response = send_whatsapp_message(
            config=config,
            cliente=cliente,
            chat_id=destination,
            message=rendered_body,
            template_name=template_name,
            template_language=(template.whatsapp_template_language or "es_MX").strip(),
            template_parameters=parameters,
            enforce_allowed_numbers=not lab_destination_allowed,
        )
    except Exception as exc:
        logger.exception("No se pudo enviar acuse WhatsApp de pago aplicado.")
        history = register_history(
            config=config,
            cliente=cliente,
            template=template,
            automation=None,
            channel="WHATSAPP",
            provider="META_CLOUD_API",
            destination=destination,
            subject="",
            body=rendered_body,
            media_url=None,
            status="ERROR",
            reference=None,
            dedupe_key=dedupe_key,
            metadata={**metadata, "error": str(exc)},
            send_type="AUTOMATICO",
        )
        return {
            "enviado": False,
            "omitido": False,
            "error": str(exc),
            "historial_id": history.id,
            "template_name": template_name,
        }

    messages = provider_response.get("messages") or []
    reference = None
    if messages and isinstance(messages[0], dict):
        reference = str(messages[0].get("id") or "").strip() or None
    provider = str(provider_response.get("provider") or "META_CLOUD_API")
    history = register_history(
        config=config,
        cliente=cliente,
        template=template,
        automation=None,
        channel="WHATSAPP",
        provider=provider,
        destination=destination,
        subject="",
        body=rendered_body,
        media_url=None,
        status="ENVIADO",
        reference=reference,
        dedupe_key=dedupe_key,
        metadata={**metadata, "provider_response": provider_response},
        send_type="AUTOMATICO",
    )
    return {
        "enviado": True,
        "omitido": False,
        "historial_id": history.id,
        "referencia": reference,
        "template_name": template_name,
    }


def ensure_default_templates(request) -> None:
    capa = get_current_capa(request)
    payment_notice = (
        "Si ya realizaste tu pago y aun no lo has notificado, por favor "
        "carga el comprobante desde la liga del portal. Si ya lo enviaste, "
        "puedes hacer caso omiso a este mensaje."
    )
    defaults = [
        {
            "nombre": "Bienvenida portal cliente WhatsApp",
            "canal": "WHATSAPP",
            "tipo_plantilla": "PORTAL_AUTOSERVICIO",
            "descripcion": "Invitacion inicial para entrar al portal, validar OTP y aceptar consentimiento.",
            "whatsapp_template_name": "betterp_portal_bienvenida",
            "whatsapp_template_language": "es_MX",
            "whatsapp_template_category": "UTILITY",
            "whatsapp_template_status": "NO_CONFIGURADA",
            "whatsapp_template_notes": "Crear en Meta como Utility. Esta plantilla puede enviarse antes del consentimiento para solicitarlo.",
            "cuerpo": (
                "Hola {{cliente_nombre}}.\n\n"
                "Te damos la bienvenida al portal de autoservicio de {{entidad_nombre}}.\n\n"
                "Aqui podras consultar tu estado de cuenta, datos de pago, comprobantes y facturas:\n"
                "{{portal_url}}\n\n"
                "Al entrar por primera vez, valida tu codigo de acceso y acepta el consentimiento "
                "de comunicaciones de cobranza y autoservicio.\n\n"
                "Si no reconoces esta relacion, ignora este mensaje o contacta a la administracion."
            ),
        },
        {
            "nombre": "Antes de vencimiento WhatsApp",
            "canal": "WHATSAPP",
            "tipo_plantilla": "RECORDATORIO_PAGO",
            "descripcion": "Recordatorio preventivo antes de la fecha de vencimiento.",
            "whatsapp_template_name": "betterp_pago_preventivo",
            "whatsapp_template_language": "es_MX",
            "whatsapp_template_category": "UTILITY",
            "whatsapp_template_status": "NO_CONFIGURADA",
            "whatsapp_template_notes": "Crear en Meta con las variables en el mismo orden del texto.",
            "cuerpo": (
                "Hola {{cliente_nombre}}.\n\n"
                "Te recordamos que tu cuenta de {{entidad_nombre}} por {{concepto}} "
                "vence el {{fecha_vencimiento_larga}}.\n\n"
                "Periodo de pago: {{periodo_pago}}\n"
                "Importe pendiente: {{saldo_vivo_formato}}\n"
                "Referencia de pago: {{referencia_pago}}\n\n"
                "Consulta tu estado de cuenta y carga tu comprobante aqui:\n"
                "{{portal_url}}\n\n"
                f"{payment_notice}"
            ),
        },
        {
            "nombre": "Dia de vencimiento WhatsApp",
            "canal": "WHATSAPP",
            "tipo_plantilla": "RECORDATORIO_PAGO",
            "descripcion": "Aviso para el dia exacto de vencimiento.",
            "whatsapp_template_name": "betterp_pago_vence_hoy",
            "whatsapp_template_language": "es_MX",
            "whatsapp_template_category": "UTILITY",
            "whatsapp_template_status": "NO_CONFIGURADA",
            "whatsapp_template_notes": "Crear en Meta con las variables en el mismo orden del texto.",
            "cuerpo": (
                "Hola {{cliente_nombre}}.\n\n"
                "Hoy vence tu cuenta de {{entidad_nombre}}.\n\n"
                "Total a pagar: {{total_exigible_formato}}\n"
                "Referencia de pago: {{referencia_pago}}\n\n"
                "Revisa el detalle y sube tu comprobante en tu portal de autoservicio:\n"
                "{{portal_url}}\n\n"
                f"{payment_notice}"
            ),
        },
        {
            "nombre": "Tres dias despues WhatsApp",
            "canal": "WHATSAPP",
            "tipo_plantilla": "RECORDATORIO_PAGO",
            "descripcion": "Seguimiento cuando la cuenta esta en gracia o atraso inicial.",
            "whatsapp_template_name": "betterp_pago_gracia",
            "whatsapp_template_language": "es_MX",
            "whatsapp_template_category": "UTILITY",
            "whatsapp_template_status": "NO_CONFIGURADA",
            "whatsapp_template_notes": "Crear en Meta con las variables en el mismo orden del texto.",
            "cuerpo": (
                "Hola {{cliente_nombre}}.\n\n"
                "Tu cuenta de {{entidad_nombre}} aparece pendiente despues del "
                "vencimiento.\n\n"
                "Periodo de pago: {{periodo_pago}}\n"
                "Saldo pendiente: {{saldo_vivo_formato}}\n"
                "Fecha limite de gracia: {{fecha_limite_gracia_larga}}\n"
                "Referencia de pago: {{referencia_pago}}\n\n"
                "Carga tu comprobante aqui:\n"
                "{{portal_url}}\n\n"
                f"{payment_notice}"
            ),
        },
        {
            "nombre": "Diez dias despues bloqueo WhatsApp",
            "canal": "WHATSAPP",
            "tipo_plantilla": "AVISO_INTERES",
            "descripcion": "Aviso de atraso avanzado y posible bloqueo de acceso.",
            "whatsapp_template_name": "betterp_pago_atraso_avanzado",
            "whatsapp_template_language": "es_MX",
            "whatsapp_template_category": "UTILITY",
            "whatsapp_template_status": "NO_CONFIGURADA",
            "whatsapp_template_notes": "Crear en Meta con las variables en el mismo orden del texto.",
            "cuerpo": (
                "Hola {{cliente_nombre}}.\n\n"
                "Tu cuenta de {{entidad_nombre}} sigue pendiente y ya puede generar "
                "intereses moratorios o revision administrativa segun las reglas "
                "del servicio.\n\n"
                "Periodo de pago: {{periodo_pago}}\n"
                "Saldo vencido: {{saldo_vivo_formato}}\n"
                "Cargos moratorios: {{recargo_total_formato}}\n"
                "Calculo del cargo: {{recargo_descripcion}}\n"
                "Total a pagar: {{total_exigible_formato}}\n"
                "Referencia de pago: {{referencia_pago}}\n\n"
                "Consulta tu estado de cuenta aqui:\n"
                "{{portal_url}}\n\n"
                f"{payment_notice}"
            ),
        },
        {
            "nombre": "Recordatorio pago WhatsApp",
            "canal": "WHATSAPP",
            "tipo_plantilla": "RECORDATORIO_PAGO",
            "descripcion": "Aviso simple para cartera abierta.",
            "cuerpo": (
                "Hola {{cliente_nombre}}, te recordamos tu pago pendiente en {{entidad_nombre}}. "
                "Saldo: {{saldo_vivo_formato}}. Referencia: {{referencia_pago}}. "
                "Portal: {{portal_url}}. "
                f"{payment_notice}"
            ),
        },
        {
            "nombre": "Aviso corte WhatsApp",
            "canal": "WHATSAPP",
            "tipo_plantilla": "RECORDATORIO_PAGO",
            "descripcion": "Mensaje para dia de corte o vencimiento.",
            "cuerpo": (
                "Hola {{cliente_nombre}}, hoy vence tu cuenta en {{entidad_nombre}}. "
                "Total a pagar: {{total_exigible_formato}}. Referencia: {{referencia_pago}}. "
                "Puedes consultar tu detalle y enviar comprobante aqui: {{portal_url}}. "
                f"{payment_notice}"
            ),
        },
        {
            "nombre": "Aviso interes WhatsApp",
            "canal": "WHATSAPP",
            "tipo_plantilla": "AVISO_INTERES",
            "descripcion": "Aviso cuando la cuenta ya tiene recargo.",
            "cuerpo": (
                "Hola {{cliente_nombre}}, tu cuenta en {{entidad_nombre}} ya tiene recargo activo. "
                "Total exigible: {{total_exigible_formato}}. Referencia: {{referencia_pago}}. "
                "Portal: {{portal_url}}. "
                f"{payment_notice}"
            ),
        },
        {
            "nombre": "Preaviso rescision WhatsApp",
            "canal": "WHATSAPP",
            "tipo_plantilla": "MENSAJE_PERSONALIZADO",
            "descripcion": "Preaviso administrativo para revision contractual.",
            "cuerpo": (
                "Hola {{cliente_nombre}}, seguimos sin recibir el pago de {{entidad_nombre}}. "
                "El saldo exigible es {{total_exigible_formato}} con referencia {{referencia_pago}}. "
                "Revisa el detalle o carga tu comprobante aqui: {{portal_url}}. "
                f"{payment_notice}"
            ),
        },
        {
            "nombre": "Confirmacion comprobante WhatsApp",
            "canal": "WHATSAPP",
            "tipo_plantilla": "RECORDATORIO_PAGO",
            "descripcion": "Acuse profesional cuando el cliente registra un pago o comprobante.",
            "whatsapp_template_name": "betterp_pago_recibido",
            "whatsapp_template_language": "es_MX",
            "whatsapp_template_category": "UTILITY",
            "whatsapp_template_status": "NO_CONFIGURADA",
            "whatsapp_template_notes": "Crear en Meta con las variables en el mismo orden del texto.",
            "cuerpo": (
                "Hola {{cliente_nombre}}. Hemos recibido tu comprobante de pago "
                "para {{entidad_nombre}}. Nuestro equipo lo revisara y, en cuanto "
                "quede validado, veras la actualizacion en tu estado de cuenta. "
                "Puedes consultar el seguimiento aqui: {{portal_url}}"
            ),
        },
        {
            "nombre": "Pago parcial recibido WhatsApp",
            "canal": "WHATSAPP",
            "tipo_plantilla": "RECORDATORIO_PAGO",
            "descripcion": "Acuse cuando se registra un pago parcial y queda saldo pendiente.",
            "whatsapp_template_name": "betterp_pago_parcial_recibido",
            "whatsapp_template_language": "es_MX",
            "whatsapp_template_category": "UTILITY",
            "whatsapp_template_status": "NO_CONFIGURADA",
            "whatsapp_template_notes": "Crear en Meta con monto recibido y saldo pendiente como variables.",
            "cuerpo": (
                "Hola {{cliente_nombre}}. Hemos recibido un pago por "
                "{{monto_recibido_formato}} para {{entidad_nombre}}. "
                "Tu saldo pendiente es {{saldo_pendiente_formato}}. "
                "Si el pago corresponde a una cuenta vencida, te recomendamos "
                "cubrir el pendiente para evitar recargos o restricciones. "
                "Puedes revisar tu estado de cuenta aqui: {{portal_url}}"
            ),
        },
        {
            "nombre": "Recordatorio pago Email",
            "canal": "EMAIL",
            "tipo_plantilla": "RECORDATORIO_PAGO",
            "descripcion": "Recordatorio por correo con liga al portal.",
            "asunto": "Recordatorio de pago | {{entidad_nombre}}",
            "cuerpo": (
                "Hola {{cliente_nombre}},\n\n"
                "Te compartimos tu saldo pendiente en {{entidad_nombre}} por {{saldo_vivo_formato}}.\n"
                "Referencia de pago: {{referencia_pago}}.\n"
                "Puedes revisar el detalle y cargar tu comprobante aqui: {{portal_url}}.\n\n"
                f"{payment_notice}"
            ),
        },
        {
            "nombre": "Aviso corte Email",
            "canal": "EMAIL",
            "tipo_plantilla": "RECORDATORIO_PAGO",
            "descripcion": "Correo para corte o vencimiento.",
            "asunto": "Aviso de corte | {{entidad_nombre}}",
            "cuerpo": (
                "Hola {{cliente_nombre}},\n\n"
                "Tu cuenta vence el {{fecha_vencimiento}}. "
                "Total a pagar: {{total_exigible_formato}}.\n\n"
                "Referencia de pago: {{referencia_pago}}.\n"
                "Consulta el detalle, referencia y carga de comprobante aqui: {{portal_url}}\n\n"
                f"{payment_notice}"
            ),
        },
    ]
    for item in defaults:
        defaults_payload = {
            **item,
            "incluye_link_portal": True,
            "activo": True,
        }
        template, created = PlantillaMensaje.objects.get_or_create(
            capa_negocio=capa,
            nombre=item["nombre"],
            defaults=defaults_payload,
        )
        if created:
            continue
        update_payload = {
            key: value
            for key, value in defaults_payload.items()
            if key
            not in {
                "whatsapp_template_status",
                "whatsapp_template_category",
                "whatsapp_template_notes",
            }
        }
        changed_fields = []
        for field, value in update_payload.items():
            if getattr(template, field) != value:
                setattr(template, field, value)
                changed_fields.append(field)
        if changed_fields:
            template.save(update_fields=changed_fields)


def ensure_default_automation_rules(request) -> None:
    ensure_default_templates(request)
    config = get_or_create_main_config(request)
    capa = get_current_capa(request)
    default_rules = [
        {
            "nombre": "Antes de vencimiento",
            "descripcion": "Recordatorio preventivo 3 dias antes del vencimiento.",
            "plantilla": "Antes de vencimiento WhatsApp",
            "canal": "WHATSAPP",
            "evento_base": "FECHA_VENCIMIENTO",
            "desplazamiento_dias": -3,
            "segmento": "POR_VENCER",
        },
        {
            "nombre": "Dia de vencimiento",
            "descripcion": "Aviso el mismo dia de vencimiento.",
            "plantilla": "Dia de vencimiento WhatsApp",
            "canal": "WHATSAPP",
            "evento_base": "FECHA_VENCIMIENTO",
            "desplazamiento_dias": 0,
            "segmento": "POR_VENCER",
        },
        {
            "nombre": "Tres dias despues",
            "descripcion": "Seguimiento 3 dias despues del vencimiento.",
            "plantilla": "Tres dias despues WhatsApp",
            "canal": "WHATSAPP",
            "evento_base": "FECHA_VENCIMIENTO",
            "desplazamiento_dias": 3,
            "segmento": "EN_GRACIA",
        },
        {
            "nombre": "Diez dias despues bloqueo",
            "descripcion": "Aviso de atraso avanzado y posible bloqueo de acceso.",
            "plantilla": "Diez dias despues bloqueo WhatsApp",
            "canal": "WHATSAPP",
            "evento_base": "FECHA_VENCIMIENTO",
            "desplazamiento_dias": 10,
            "segmento": "VENCIDA_CON_RECARGO",
        },
    ]
    templates = {
        item.nombre: item
        for item in PlantillaMensaje.objects.filter(
            capa_negocio=capa,
            nombre__in=[rule["plantilla"] for rule in default_rules],
        )
    }
    for rule in default_rules:
        template = templates.get(rule["plantilla"])
        if not template:
            continue
        ReglaAutomatizacionMensaje.objects.get_or_create(
            configuracion_relacionada=config,
            nombre=rule["nombre"],
            entidad_relacionada=None,
            defaults={
                "descripcion": rule["descripcion"],
                "plantilla_relacionada": template,
                "canal": rule["canal"],
                "evento_base": rule["evento_base"],
                "desplazamiento_dias": rule["desplazamiento_dias"],
                "segmento": rule["segmento"],
                "activo": False,
            },
        )


def get_resend_event_state(event_type: str) -> tuple[str, int]:
    return RESEND_EVENT_STATUS_MAP.get(event_type, ("ENVIADO", 0))


@router.get("/acuerdos/whatsapp-numero-compartido/")
def obtener_acuerdo_whatsapp_numero_compartido(request):
    require_cobranza_access(request)
    require_admin_access(request)
    return build_whatsapp_shared_number_agreement_state(request)


@router.post("/acuerdos/whatsapp-numero-compartido/aceptar/")
def aceptar_acuerdo_whatsapp_numero_compartido(
    request,
    payload: WhatsappSharedNumberAgreementAcceptIn,
):
    require_cobranza_access(request)
    require_admin_access(request)
    confirmations = {
        "acepta_contacto_autorizado": payload.acepta_contacto_autorizado,
        "acepta_datos_correctos": payload.acepta_datos_correctos,
        "acepta_politicas_whatsapp": payload.acepta_politicas_whatsapp,
        "acepta_suspension_por_riesgo": payload.acepta_suspension_por_riesgo,
    }
    if not all(confirmations.values()):
        raise HttpError(
            400,
            "Debes confirmar todos los puntos del acuerdo antes de usar el "
            "numero de BetterP para cobranza.",
        )
    accept_whatsapp_shared_number_agreement(
        request,
        metadata={"confirmaciones": confirmations},
    )
    return {
        "success": True,
        "mensaje": "Acuerdo de uso aceptado correctamente.",
        **build_whatsapp_shared_number_agreement_state(request),
    }


@router.get("/onboarding-cobranza/")
def obtener_onboarding_cobranza(request):
    require_cobranza_access(request)
    require_admin_access(request)
    return serialize_cobranza_onboarding_state(get_current_capa(request))


@router.post("/onboarding-cobranza/cerrar/")
def cerrar_onboarding_cobranza(request, payload: CobranzaOnboardingCloseIn):
    require_cobranza_access(request)
    require_admin_access(request)
    capa = get_current_capa(request)
    context = get_auth_context(request)
    user = context.user
    closed_at = timezone.now()
    user_name = (
        getattr(user, "get_full_name", lambda: "")()
        or getattr(user, "email", "")
        or getattr(user, "username", "")
    )
    state = {
        "closed_at": closed_at.isoformat(),
        "closed_by_id": getattr(user, "id", None),
        "closed_by_email": getattr(user, "email", "") or getattr(user, "username", ""),
        "closed_by_name": user_name,
        "progress": max(0, min(int(payload.progreso or 0), 100)),
        "completed_steps": max(0, int(payload.pasos_completos or 0)),
        "total_steps": max(0, int(payload.pasos_totales or 0)),
        "blockers": [str(item)[:240] for item in (payload.bloqueantes or [])[:20]],
        "steps": (payload.pasos or [])[:20],
    }
    persist_cobranza_onboarding_state(
        request=request,
        capa=capa,
        user=user,
        state=state,
    )
    return {
        "success": True,
        "mensaje": "Onboarding de cobranza cerrado correctamente.",
        "onboarding": serialize_cobranza_onboarding_state(capa),
    }


@router.post("/onboarding-cobranza/reabrir/")
def reabrir_onboarding_cobranza(request):
    require_cobranza_access(request)
    require_admin_access(request)
    capa = get_current_capa(request)
    context = get_auth_context(request)
    user = context.user
    current = serialize_cobranza_onboarding_state(capa)
    state = {
        **current,
        "closed_at": None,
        "closed_by_id": None,
        "closed_by_email": None,
        "closed_by_name": None,
        "reopened_at": timezone.now().isoformat(),
        "reopened_by_email": getattr(user, "email", "") or getattr(user, "username", ""),
    }
    persist_cobranza_onboarding_state(
        request=request,
        capa=capa,
        user=user,
        state=state,
    )
    return {
        "success": True,
        "mensaje": "Onboarding de cobranza reabierto para revision.",
        "onboarding": serialize_cobranza_onboarding_state(capa),
    }


@router.get("/plantillas/")
def listar_plantillas(request):
    require_cobranza_access(request)
    require_admin_access(request)
    ensure_default_templates(request)
    queryset = scoped_template_queryset(request).order_by("nombre", "id")
    return [serialize_template(item) for item in queryset]


@router.post("/plantillas/sincronizar-meta/")
def sincronizar_plantillas_meta(request):
    require_cobranza_access(request)
    require_whatsapp_automation_access(request)
    require_admin_access(request)
    return sync_whatsapp_template_statuses(request)


@router.get("/laboratorio/contactos-whatsapp/")
def listar_contactos_whatsapp_laboratorio(request):
    require_cobranza_access(request)
    require_whatsapp_automation_access(request)
    require_admin_access(request)
    require_cobranza_test_lab_access_for_whatsapp(request, "WHATSAPP")
    return get_cobranza_lab_whatsapp_contacts(request)


@router.post("/laboratorio/contactos-whatsapp/")
def crear_contacto_whatsapp_laboratorio(request, payload: WhatsappLabContactIn):
    require_cobranza_access(request)
    require_whatsapp_automation_access(request)
    require_admin_access(request)
    require_cobranza_test_lab_access_for_whatsapp(request, "WHATSAPP")

    capa = get_current_capa(request)
    if not capa:
        raise HttpError(400, "Selecciona una capa antes de agregar contactos demo.")

    name = payload.nombre.strip()
    if not name:
        raise HttpError(400, "Captura el nombre del contacto demo.")

    normalized = normalize_whatsapp_destination(payload.telefono)
    if not normalized or len(normalized) < 10:
        raise HttpError(400, "Captura un numero WhatsApp valido con lada.")

    if not payload.consentimiento_confirmado:
        raise HttpError(
            400,
            "Confirma que la persona autorizo recibir mensajes de prueba o demo.",
        )

    contact, created = ContactoPruebaWhatsapp.objects.update_or_create(
        capa_negocio=capa,
        telefono_normalizado=normalized,
        defaults={
            "nombre": name,
            "telefono": payload.telefono.strip() or normalized,
            "notas": payload.notas.strip() or None,
            "consentimiento_confirmado": True,
            "activo": True,
        },
    )
    auth_user = get_auth_context(request).user
    if (created or not contact.creado_por_id) and getattr(
        auth_user, "is_authenticated", False
    ):
        contact.creado_por = auth_user
        contact.save(update_fields=["creado_por"])

    return serialize_whatsapp_lab_contact(contact)


@router.delete("/laboratorio/contactos-whatsapp/{contact_id}/")
def eliminar_contacto_whatsapp_laboratorio(request, contact_id: int):
    require_cobranza_access(request)
    require_whatsapp_automation_access(request)
    require_admin_access(request)
    require_cobranza_test_lab_access_for_whatsapp(request, "WHATSAPP")

    contact = get_object_or_404(
        scoped_whatsapp_lab_contact_queryset(request),
        id=contact_id,
    )
    contact.activo = False
    contact.save(update_fields=["activo", "fecha_actualizacion"])
    return {"success": True}






@router.post("/laboratorio/whatsapp-prueba/")
def enviar_whatsapp_prueba_laboratorio(request, payload: WhatsappLabTestIn):
    require_cobranza_access(request)
    require_whatsapp_automation_access(request)
    require_admin_access(request)
    require_whatsapp_shared_number_agreement_for_request(request, "WHATSAPP")
    require_cobranza_test_lab_access_for_whatsapp(request, "WHATSAPP")

    allowed_numbers = get_cobranza_lab_allowed_numbers(request)
    if not allowed_numbers:
        raise HttpError(
            400,
            "Agrega al menos un numero permitido o contacto demo antes de enviar pruebas reales.",
        )
    destination = normalize_whatsapp_destination(payload.numero_destino)
    if not destination or destination not in allowed_numbers:
        raise HttpError(
            400,
            "Este numero no esta permitido para el laboratorio de cobranza.",
        )
    lab_contact = (
        scoped_whatsapp_lab_contact_queryset(request)
        .filter(telefono_normalizado=destination)
        .first()
    )

    template = get_object_or_404(
        scoped_template_queryset(request),
        id=payload.plantilla_id,
    )
    if not template.activo or not channel_uses_whatsapp(template.canal):
        raise HttpError(400, "Selecciona una plantilla WhatsApp activa.")
    if not (template.whatsapp_template_name or "").strip():
        raise HttpError(400, "La plantilla no tiene nombre Meta configurado.")
    if (template.whatsapp_template_status or "").strip() != "APROBADA":
        raise HttpError(400, "La plantilla todavia no esta aprobada por Meta.")

    clientes = scoped_client_queryset(request).select_related(
        "entidad_relacionada",
        "entidad_relacionada__capa_negocio",
    )
    if payload.cliente_id:
        cliente = get_object_or_404(clientes, id=payload.cliente_id)
    elif lab_contact:
        cliente = get_or_create_whatsapp_lab_client(
            request=request,
            contact=lab_contact,
            destination=destination,
        )
    else:
        cliente = clientes.order_by("razon_social", "nombre_comercial", "id").first()
    if not cliente:
        raise HttpError(
            400,
            "Crea o selecciona un cliente de prueba antes de enviar el laboratorio.",
        )

    config = get_or_create_main_config(request)
    context = build_whatsapp_lab_context(request=request, cliente=cliente, config=config)
    rendered_body = render_template(template.cuerpo, context)
    parameters = build_template_parameter_values(template, context)
    metadata = {
        "laboratorio_cobranza": True,
        "numero_permitido": destination,
        "plantilla_meta": template.whatsapp_template_name,
        "plantilla_estado": template.whatsapp_template_status,
        "whatsapp_template_parameters": parameters,
        "contacto_demo": (
            {
                "id": lab_contact.id,
                "nombre": lab_contact.nombre,
                "telefono_normalizado": lab_contact.telefono_normalizado,
            }
            if lab_contact
            else None
        ),
        "contexto_demo": {
            "cliente_nombre": context.get("cliente_nombre"),
            "entidad_nombre": context.get("entidad_nombre"),
            "periodo_pago": context.get("periodo_pago"),
            "referencia_pago": context.get("referencia_pago"),
            "portal_url": context.get("portal_url"),
        },
    }

    try:
        provider_response = send_whatsapp_message(
            config=config,
            cliente=cliente,
            chat_id=destination,
            message=rendered_body,
            template_name=(template.whatsapp_template_name or "").strip(),
            template_language=(template.whatsapp_template_language or "es_MX").strip(),
            template_parameters=parameters,
            enforce_allowed_numbers=False,
        )
    except ValueError as exc:
        history = register_history(
            config=config,
            cliente=cliente,
            template=template,
            automation=None,
            channel="WHATSAPP",
            provider="META_CLOUD_API",
            destination=destination,
            subject="",
            body=rendered_body,
            media_url=None,
            status="ERROR",
            reference=None,
            dedupe_key=None,
            metadata={**metadata, "error": str(exc)},
            send_type="MANUAL",
        )
        raise HttpError(400, str(exc)) from exc

    messages = provider_response.get("messages") or []
    reference = None
    if messages and isinstance(messages[0], dict):
        reference = str(messages[0].get("id") or "").strip() or None
    reference = (
        reference
        or str(provider_response.get("idMessage") or "").strip()
        or None
    )
    provider = (
        provider_response.get("provider")
        or ("GREEN_API" if provider_response.get("idMessage") else "META_CLOUD_API")
    )
    history = register_history(
        config=config,
        cliente=cliente,
        template=template,
        automation=None,
        channel="WHATSAPP",
        provider=str(provider),
        destination=destination,
        subject="",
        body=rendered_body,
        media_url=None,
        status="ENVIADO",
        reference=reference,
        dedupe_key=None,
        metadata={**metadata, "provider_response": provider_response},
        send_type="MANUAL",
    )
    return {
        "success": True,
        "mensaje": "Prueba enviada al numero seguro.",
        "destino": destination,
        "plantilla": serialize_template(template),
        "preview": rendered_body,
        "message_id": reference,
        "provider": provider,
        "historial": serialize_history(history),
    }


@router.post("/plantillas/")
def crear_plantilla(request, payload: PlantillaMensajeIn):
    require_cobranza_access(request)
    require_whatsapp_channel_access(request, payload.canal)
    require_template_management_access(request)
    template = PlantillaMensaje.objects.create(
        capa_negocio=get_current_capa(request),
        nombre=payload.nombre.strip(),
        descripcion=payload.descripcion.strip() or None,
        canal=payload.canal,
        tipo_plantilla=payload.tipo_plantilla,
        asunto=payload.asunto.strip() or None,
        cuerpo=payload.cuerpo.strip(),
        incluye_link_portal=payload.incluye_link_portal,
        url_media=payload.url_media.strip() or None,
        whatsapp_template_name=payload.whatsapp_template_name.strip() or None,
        whatsapp_template_language=payload.whatsapp_template_language.strip() or "es_MX",
        whatsapp_template_category=payload.whatsapp_template_category.strip() or None,
        whatsapp_template_status=payload.whatsapp_template_status.strip() or "NO_CONFIGURADA",
        whatsapp_template_notes=payload.whatsapp_template_notes.strip() or None,
        activo=payload.activo,
    )
    return {"success": True, "plantilla": serialize_template(template)}


@router.put("/plantillas/{template_id}/")
def actualizar_plantilla(request, template_id: int, payload: PlantillaMensajeIn):
    require_cobranza_access(request)
    require_whatsapp_channel_access(request, payload.canal)
    require_template_management_access(request)
    template = get_object_or_404(scoped_template_queryset(request), id=template_id)
    template.nombre = payload.nombre.strip()
    template.descripcion = payload.descripcion.strip() or None
    template.canal = payload.canal
    template.tipo_plantilla = payload.tipo_plantilla
    template.asunto = payload.asunto.strip() or None
    template.cuerpo = payload.cuerpo.strip()
    template.incluye_link_portal = payload.incluye_link_portal
    template.url_media = payload.url_media.strip() or None
    template.whatsapp_template_name = payload.whatsapp_template_name.strip() or None
    template.whatsapp_template_language = payload.whatsapp_template_language.strip() or "es_MX"
    template.whatsapp_template_category = payload.whatsapp_template_category.strip() or None
    template.whatsapp_template_status = payload.whatsapp_template_status.strip() or "NO_CONFIGURADA"
    template.whatsapp_template_notes = payload.whatsapp_template_notes.strip() or None
    template.activo = payload.activo
    template.save()
    return {"success": True, "plantilla": serialize_template(template)}


@router.delete("/plantillas/{template_id}/")
def eliminar_plantilla(request, template_id: int):
    require_cobranza_access(request)
    require_template_management_access(request)
    template = get_object_or_404(scoped_template_queryset(request), id=template_id)
    template.delete()
    return {"success": True}


@router.get("/automatizaciones/")
def listar_automatizaciones(request):
    require_cobranza_access(request)
    require_admin_access(request)
    ensure_default_automation_rules(request)
    allowed_entity_ids = get_allowed_entity_ids(request)
    queryset = (
        ReglaAutomatizacionMensaje.objects.select_related(
            "plantilla_relacionada",
            "entidad_relacionada",
        )
        .filter(configuracion_relacionada=get_or_create_main_config(request))
        .filter(
            Q(entidad_relacionada__isnull=True) | Q(entidad_relacionada_id__in=allowed_entity_ids)
        )
        .order_by("nombre", "id")
    )
    return [serialize_rule(item) for item in queryset]


@router.post("/automatizaciones/")
def crear_automatizacion(request, payload: ReglaAutomatizacionMensajeIn):
    require_cobranza_access(request)
    require_whatsapp_channel_access(request, payload.canal)
    require_admin_access(request)
    ensure_whatsapp_shared_number_terms_for_active_rule(request, payload)
    config = get_or_create_main_config(request)
    template = get_object_or_404(scoped_template_queryset(request), id=payload.plantilla_id)
    ensure_whatsapp_template_ready_for_active_rule(template, payload)
    entidad = (
        get_object_or_404(scoped_entity_queryset(request), id=payload.entidad_id)
        if payload.entidad_id
        else None
    )
    rule = ReglaAutomatizacionMensaje.objects.create(
        configuracion_relacionada=config,
        plantilla_relacionada=template,
        entidad_relacionada=entidad,
        nombre=payload.nombre.strip(),
        descripcion=payload.descripcion.strip() or None,
        canal=payload.canal,
        evento_base=payload.evento_base,
        desplazamiento_dias=payload.desplazamiento_dias,
        segmento=payload.segmento,
        activo=payload.activo,
    )
    return {"success": True, "regla": serialize_rule(rule)}


@router.put("/automatizaciones/{rule_id}/")
def actualizar_automatizacion(request, rule_id: int, payload: ReglaAutomatizacionMensajeIn):
    require_cobranza_access(request)
    require_whatsapp_channel_access(request, payload.canal)
    require_admin_access(request)
    ensure_whatsapp_shared_number_terms_for_active_rule(request, payload)
    rule = get_object_or_404(
        ReglaAutomatizacionMensaje.objects.select_related("entidad_relacionada")
        .filter(configuracion_relacionada=get_or_create_main_config(request)),
        id=rule_id,
    )
    if rule.entidad_relacionada_id and rule.entidad_relacionada_id not in get_allowed_entity_ids(request):
        raise HttpError(404, "La automatizacion no pertenece a tu capa activa.")
    template = get_object_or_404(
        scoped_template_queryset(request),
        id=payload.plantilla_id,
    )
    ensure_whatsapp_template_ready_for_active_rule(template, payload)
    rule.plantilla_relacionada = template
    rule.entidad_relacionada = (
        get_object_or_404(scoped_entity_queryset(request), id=payload.entidad_id)
        if payload.entidad_id
        else None
    )
    rule.nombre = payload.nombre.strip()
    rule.descripcion = payload.descripcion.strip() or None
    rule.canal = payload.canal
    rule.evento_base = payload.evento_base
    rule.desplazamiento_dias = payload.desplazamiento_dias
    rule.segmento = payload.segmento
    rule.activo = payload.activo
    rule.save()
    return {"success": True, "regla": serialize_rule(rule)}


@router.delete("/automatizaciones/{rule_id}/")
def eliminar_automatizacion(request, rule_id: int):
    require_cobranza_access(request)
    require_admin_access(request)
    rule = get_object_or_404(
        ReglaAutomatizacionMensaje.objects.filter(
            configuracion_relacionada=get_or_create_main_config(request),
        ),
        id=rule_id,
    )
    if rule.entidad_relacionada_id and rule.entidad_relacionada_id not in get_allowed_entity_ids(request):
        raise HttpError(404, "La automatizacion no pertenece a tu capa activa.")
    rule.delete()
    return {"success": True}


@router.get("/historial-envios/")
def listar_historial_envios(
    request,
    limit: int = 40,
    canal: Optional[str] = None,
    estatus: Optional[str] = None,
    busqueda: Optional[str] = None,
    fecha_desde: Optional[date] = None,
    fecha_hasta: Optional[date] = None,
):
    require_cobranza_access(request)
    require_admin_access(request)
    allowed_entity_ids = get_allowed_entity_ids(request)
    queryset = (
        HistorialEnvio.objects.select_related(
            "cliente_relacionado",
            "entidad_relacionada",
            "plantilla_usada",
            "automatizacion_relacionada",
        )
        .filter(entidad_relacionada_id__in=allowed_entity_ids)
        .order_by("-fecha_envio", "-id")
    )
    if canal:
        queryset = queryset.filter(canal=canal.strip().upper())
    if estatus:
        queryset = queryset.filter(estatus=estatus.strip().upper())
    if busqueda:
        search = busqueda.strip()
        if search:
            queryset = queryset.filter(
                Q(cliente_relacionado__razon_social__icontains=search)
                | Q(cliente_relacionado__nombre_comercial__icontains=search)
                | Q(entidad_relacionada__nombre_comercial__icontains=search)
                | Q(destinatario__icontains=search)
                | Q(asunto__icontains=search)
                | Q(cuerpo_renderizado__icontains=search)
                | Q(referencia_envio__icontains=search)
            )
    if fecha_desde:
        queryset = queryset.filter(fecha_envio__date__gte=fecha_desde)
    if fecha_hasta:
        queryset = queryset.filter(fecha_envio__date__lte=fecha_hasta)
    queryset = queryset[: max(min(limit, 100), 10)]
    return [serialize_history(item) for item in queryset]


@router.post("/historial-envios/{history_id}/revisar/")
def revisar_historial_envio(request, history_id: int, payload: HistorialEnvioRevisionIn):
    require_cobranza_access(request)
    context = require_admin_access(request)
    allowed_entity_ids = get_allowed_entity_ids(request)
    item = get_object_or_404(
        HistorialEnvio.objects.select_related(
            "cliente_relacionado",
            "entidad_relacionada",
            "plantilla_usada",
            "automatizacion_relacionada",
        ).filter(entidad_relacionada_id__in=allowed_entity_ids),
        id=history_id,
    )
    note = (payload.nota or "").strip()[:500]
    metadata = dict(item.metadata or {})
    metadata["revision_operativa"] = {
        "reviewed_at": timezone.now().isoformat(),
        "reviewed_by_id": context.user.id,
        "reviewed_by_email": context.user.email,
        "reviewed_by_name": context.user.get_full_name() or context.user.username,
        "note": note,
        "source": "cobranza_first_day",
    }
    item.metadata = metadata
    item.save(update_fields=["metadata"])
    return {
        "success": True,
        "mensaje": "Envio marcado como revisado.",
        "historial": serialize_history(item),
    }


@router.get("/automatizaciones-monitoreo/")
def monitoreo_automatizaciones(request):
    require_cobranza_access(request)
    require_whatsapp_automation_access(request)
    require_admin_access(request)

    capa = get_current_capa(request)
    config = get_or_create_main_config(request)
    allowed_entity_ids = get_allowed_entity_ids(request)
    now = timezone.now()
    since_24h = now - timedelta(hours=24)
    since_7d = now - timedelta(days=7)

    recent_crons = list(
        CronRunLog.objects.filter(key=PAYMENT_REMINDER_CRON_KEY)
        .order_by("-started_at", "-id")[:20]
    )
    latest_cron = select_payment_reminder_cron_for_layer(recent_crons, capa_id=capa.id)
    cron_status = serialize_payment_reminder_cron(latest_cron, capa_id=capa.id, now=now)

    history_queryset = HistorialEnvio.objects.filter(
        entidad_relacionada_id__in=allowed_entity_ids,
        tipo_envio="AUTOMATICO",
    )
    activity = history_queryset.aggregate(
        total_24h=Count("id", filter=Q(fecha_envio__gte=since_24h)),
        enviados_24h=Count("id", filter=Q(fecha_envio__gte=since_24h, estatus="ENVIADO")),
        entregados_24h=Count(
            "id",
            filter=Q(fecha_envio__gte=since_24h, estatus__in=["ENTREGADO", "LEIDO"]),
        ),
        omitidos_24h=Count("id", filter=Q(fecha_envio__gte=since_24h, estatus="OMITIDO")),
        errores_24h=Count(
            "id",
            filter=Q(fecha_envio__gte=since_24h, estatus__in=["ERROR", "ERROR_SPAM"]),
        ),
        total_7d=Count("id", filter=Q(fecha_envio__gte=since_7d)),
        enviados_7d=Count("id", filter=Q(fecha_envio__gte=since_7d, estatus="ENVIADO")),
        omitidos_7d=Count("id", filter=Q(fecha_envio__gte=since_7d, estatus="OMITIDO")),
        errores_7d=Count(
            "id",
            filter=Q(fecha_envio__gte=since_7d, estatus__in=["ERROR", "ERROR_SPAM"]),
        ),
        whatsapp_7d=Count("id", filter=Q(fecha_envio__gte=since_7d, canal="WHATSAPP")),
        email_7d=Count("id", filter=Q(fecha_envio__gte=since_7d, canal="EMAIL")),
    )
    by_status = list(
        history_queryset.filter(fecha_envio__gte=since_7d)
        .values("estatus")
        .annotate(total=Count("id"))
        .order_by("estatus")
    )
    by_channel = list(
        history_queryset.filter(fecha_envio__gte=since_7d)
        .values("canal")
        .annotate(total=Count("id"))
        .order_by("canal")
    )
    rule_activity = list(
        history_queryset.filter(
            fecha_envio__gte=since_7d,
            automatizacion_relacionada__isnull=False,
        )
        .values("automatizacion_relacionada_id", "automatizacion_relacionada__nombre")
        .annotate(
            total_7d=Count("id"),
            enviados_7d=Count("id", filter=Q(estatus="ENVIADO")),
            omitidos_7d=Count("id", filter=Q(estatus="OMITIDO")),
            errores_7d=Count("id", filter=Q(estatus__in=["ERROR", "ERROR_SPAM"])),
            whatsapp_7d=Count("id", filter=Q(canal="WHATSAPP")),
            email_7d=Count("id", filter=Q(canal="EMAIL")),
        )
        .order_by("-total_7d", "automatizacion_relacionada__nombre")[:8]
    )
    recent_errors = list(
        history_queryset.select_related(
            "cliente_relacionado",
            "entidad_relacionada",
            "plantilla_usada",
            "automatizacion_relacionada",
        )
        .filter(estatus__in=["ERROR", "ERROR_SPAM"])
        .order_by("-fecha_envio", "-id")[:5]
    )

    rules = ReglaAutomatizacionMensaje.objects.filter(
        configuracion_relacionada=config,
    ).filter(
        Q(entidad_relacionada__isnull=True)
        | Q(entidad_relacionada_id__in=allowed_entity_ids)
    )
    rule_summary = rules.aggregate(
        total=Count("id"),
        activas=Count("id", filter=Q(activo=True)),
        pausadas=Count("id", filter=Q(activo=False)),
        whatsapp_activas=Count("id", filter=Q(activo=True, canal__in=["WHATSAPP", "AMBOS"])),
        email_activas=Count("id", filter=Q(activo=True, canal__in=["EMAIL", "AMBOS"])),
    )
    blocked_whatsapp_rules = list(
        rules.select_related("plantilla_relacionada")
        .filter(activo=True, canal__in=["WHATSAPP", "AMBOS"])
        .exclude(plantilla_relacionada__whatsapp_template_status="APROBADA")
        .order_by("nombre", "id")[:8]
    )

    templates = PlantillaMensaje.objects.filter(capa_negocio=capa)
    meta_templates = templates.filter(
        canal__in=["WHATSAPP", "AMBOS"],
        tipo_plantilla__in=["RECORDATORIO_PAGO", "AVISO_INTERES"],
        whatsapp_template_name__isnull=False,
    ).exclude(whatsapp_template_name="")
    template_summary = templates.aggregate(
        total=Count("id"),
        activas=Count("id", filter=Q(activo=True)),
    )
    meta_template_summary = meta_templates.aggregate(
        whatsapp_total=Count("id"),
        whatsapp_aprobadas=Count(
            "id",
            filter=Q(whatsapp_template_status="APROBADA"),
        ),
        whatsapp_pendientes=Count(
            "id",
            filter=~Q(whatsapp_template_status="APROBADA"),
        ),
    )
    meta_template_rows = [
        {
            "id": template.id,
            "nombre": template.nombre,
            "tipo_plantilla": template.tipo_plantilla,
            "whatsapp_template_name": template.whatsapp_template_name,
            "whatsapp_template_language": template.whatsapp_template_language,
            "whatsapp_template_category": template.whatsapp_template_category,
            "whatsapp_template_status": template.whatsapp_template_status,
            "whatsapp_template_notes": template.whatsapp_template_notes,
            "activo": template.activo,
        }
        for template in meta_templates.order_by(
            "whatsapp_template_status",
            "whatsapp_template_name",
            "nombre",
        )
    ]
    meta_template_status_rows = list(
        meta_templates.values("whatsapp_template_status")
        .annotate(total=Count("id"))
        .order_by("whatsapp_template_status")
    )
    meta_channel = (
        CanalWhatsappOficial.objects.filter(capa_negocio=capa, activo=True)
        .filter(Q(estado="CONECTADO") | Q(fecha_ultimo_check__isnull=False))
        .order_by("-es_principal", "-fecha_ultimo_check", "id")
        .first()
    )
    meta_channel_metadata = (meta_channel.metadata or {}) if meta_channel else {}
    last_meta_sync = (
        meta_channel_metadata.get("templates_last_sync")
        if isinstance(meta_channel_metadata, dict)
        else None
    )
    if not last_meta_sync and meta_channel and meta_channel.fecha_ultimo_check:
        last_meta_sync = meta_channel.fecha_ultimo_check.isoformat()
    template_summary = {
        **template_summary,
        **meta_template_summary,
        "whatsapp_detalle": meta_template_rows,
        "whatsapp_por_estado": [
            {
                "estado": row["whatsapp_template_status"] or "NO_CONFIGURADA",
                "total": int(row["total"] or 0),
            }
            for row in meta_template_status_rows
        ],
        "ultima_sincronizacion_meta": last_meta_sync,
        "meta_total_visto": (
            meta_channel_metadata.get("templates_seen")
            if isinstance(meta_channel_metadata, dict)
            else None
        ),
        "canal_meta": (
            {
                "id": meta_channel.id,
                "nombre": meta_channel.nombre,
                "display_phone_number": meta_channel.display_phone_number,
                "waba_id": meta_channel.waba_id or meta_channel.business_account_id,
                "estado": meta_channel.estado,
            }
            if meta_channel
            else None
        ),
    }

    alerts = []
    usage_limits = build_outbound_usage_limits(config, reference_datetime=now)
    if cron_status["status"] == "ERROR":
        alerts.append(
            build_alert("ERROR", "Cron de recordatorios con error", cron_status["detail"])
        )
    elif cron_status["status"] != "OK":
        alerts.append(
            build_alert("WARN", "Cron de recordatorios pendiente", cron_status["detail"])
        )
    if int(activity["errores_24h"] or 0):
        alerts.append(
            build_alert(
                "ERROR",
                "Errores recientes de cobranza",
                f"{activity['errores_24h']} envio(s) automatico(s) fallaron en 24h.",
            )
        )
    if int(rule_summary["activas"] or 0) == 0:
        alerts.append(
            build_alert(
                "WARN",
                "Sin reglas activas",
                "No hay automatizaciones activas para cobranza.",
            )
        )
    layer_summary = (cron_status.get("last_run") or {}).get("layer_summary") or {}
    if layer_summary.get("no_entities"):
        alerts.append(
            build_alert(
                "WARN",
                "Capa sin entidades activas",
                "La ultima corrida encontro la capa, pero no encontro entidades activas para procesar.",
            )
        )
    layer_readiness = layer_summary.get("readiness") or {}
    if layer_readiness and not layer_readiness.get("ok", True):
        issues = layer_readiness.get("issues") or []
        alerts.append(
            build_alert(
                "ERROR",
                "WhatsApp no listo",
                f"La ultima corrida estricta encontro {len(issues)} problema(s) de plantillas o proveedor.",
            )
        )
    if blocked_whatsapp_rules:
        alerts.append(
            build_alert(
                "WARN",
                "Plantillas WhatsApp pendientes",
                f"{len(blocked_whatsapp_rules)} regla(s) activa(s) requieren plantilla Meta aprobada.",
            )
        )
    for usage_limit in usage_limits.values():
        if int(usage_limit.get("incluido") or 0) <= 0:
            alerts.append(
                build_alert(
                    "WARN",
                    f"Sin cuota {usage_limit['label']}",
                    f"El plan activo no incluye envios {usage_limit['label']}.",
                )
            )
        elif int(usage_limit.get("restante") or 0) <= 0:
            alerts.append(
                build_alert(
                    "ERROR",
                    f"Cuota {usage_limit['label']} agotada",
                    f"Ya se usaron {usage_limit['usado']} de {usage_limit['incluido']} envios del periodo {usage_limit['periodo']}.",
                )
            )
        elif int(usage_limit.get("usado") or 0) >= int(usage_limit["incluido"] * 0.8):
            alerts.append(
                build_alert(
                    "WARN",
                    f"Cuota {usage_limit['label']} cerca del limite",
                    f"Restan {usage_limit['restante']} envios del periodo {usage_limit['periodo']}.",
                )
            )

    status = "OK"
    if any(item["tipo"] == "ERROR" for item in alerts):
        status = "ERROR"
    elif alerts:
        status = "WARN"

    operational_actions = build_payment_reminder_actions(
        cron_status=cron_status,
        activity=activity,
        rule_summary=rule_summary,
        blocked_whatsapp_rules=blocked_whatsapp_rules,
        template_summary=template_summary,
        usage_limits=usage_limits,
    )

    lab_state = build_cobranza_test_lab_state(request)
    allowed_whatsapp_numbers = sorted(
        get_cobranza_lab_allowed_numbers(request)
        if lab_state["habilitado"]
        else get_whatsapp_outbound_allowed_numbers()
    )
    template_summary_payload = {
        key: int(template_summary.get(key) or 0)
        for key in [
            "total",
            "activas",
            "whatsapp_total",
            "whatsapp_aprobadas",
            "whatsapp_pendientes",
        ]
    }
    meta_total_seen = template_summary.get("meta_total_visto")
    template_summary_payload.update(
        {
            "whatsapp_detalle": template_summary.get("whatsapp_detalle") or [],
            "whatsapp_por_estado": template_summary.get("whatsapp_por_estado") or [],
            "ultima_sincronizacion_meta": template_summary.get(
                "ultima_sincronizacion_meta"
            ),
            "meta_total_visto": (
                _safe_int(meta_total_seen)
                if meta_total_seen is not None
                else None
            ),
            "canal_meta": template_summary.get("canal_meta"),
        }
    )

    return {
        "status": status,
        "generated_at": now,
        "modo_seguro": {
            "integraciones_deshabilitadas": bool(
                getattr(settings, "DISABLE_OUTBOUND_INTEGRATIONS", False)
            ),
            "solo_numeros_whatsapp_permitidos": bool(allowed_whatsapp_numbers),
            "numeros_whatsapp_permitidos": allowed_whatsapp_numbers,
            "plantillas_bloqueadas_para_clientes": bool(
                getattr(settings, "LOCK_TENANT_MESSAGE_TEMPLATES", False)
            ),
            "acuerdo_whatsapp_requerido": bool(
                getattr(settings, "REQUIRE_WHATSAPP_SHARED_NUMBER_AGREEMENT", True)
            ),
            "respetar_bajas_whatsapp": bool(
                getattr(config, "respetar_bajas_whatsapp", True)
            ),
            "laboratorio_cobranza": lab_state,
        },
        "cron": cron_status,
        "actividad": {
            **{key: int(value or 0) for key, value in activity.items()},
            "por_estatus_7d": by_status,
            "por_canal_7d": by_channel,
        },
        "reglas": {
            **{key: int(value or 0) for key, value in rule_summary.items()},
            "whatsapp_bloqueadas": [
                {
                    "id": rule.id,
                    "nombre": rule.nombre,
                    "plantilla_nombre": rule.plantilla_relacionada.nombre,
                    "plantilla_estado": rule.plantilla_relacionada.whatsapp_template_status,
                }
                for rule in blocked_whatsapp_rules
            ],
            "actividad_7d": [
                {
                    "id": row["automatizacion_relacionada_id"],
                    "nombre": row["automatizacion_relacionada__nombre"] or "Sin regla",
                    "total_7d": int(row["total_7d"] or 0),
                    "enviados_7d": int(row["enviados_7d"] or 0),
                    "omitidos_7d": int(row["omitidos_7d"] or 0),
                    "errores_7d": int(row["errores_7d"] or 0),
                    "whatsapp_7d": int(row["whatsapp_7d"] or 0),
                    "email_7d": int(row["email_7d"] or 0),
                }
                for row in rule_activity
            ],
        },
        "plantillas": template_summary_payload,
        "onboarding": serialize_cobranza_onboarding_state(capa),
        "consumo": {
            key: {
                "canal": value["canal"],
                "categoria": value["categoria"],
                "periodo": value["periodo"],
                "incluido": value["incluido"],
                "usado": value["usado"],
                "restante": value["restante"],
                "plan_nombre": value.get("plan_nombre"),
            }
            for key, value in usage_limits.items()
        },
        "alertas": alerts,
        "acciones_operativas": operational_actions,
        "errores_recientes": [serialize_history(item) for item in recent_errors],
    }


@router.post("/webhooks/resend/", auth=None)
def recibir_webhook_resend(request):
    raw_body = request.body.decode("utf-8") or "{}"
    headers = {key.lower(): value for key, value in request.headers.items()}

    try:
        payload = verify_resend_webhook_signature(raw_body, headers)
    except ValueError as exc:
        raise HttpError(400, str(exc)) from exc

    event_type = str(payload.get("type") or "").strip()
    event_data = payload.get("data") or {}
    email_id = str(event_data.get("email_id") or event_data.get("id") or "").strip()
    new_status, new_rank = get_resend_event_state(event_type)
    matched = 0

    if email_id:
        histories = HistorialEnvio.objects.filter(referencia_envio=email_id)
        for history in histories:
            metadata = dict(history.metadata or {})
            previous_rank = int(metadata.get("resend_event_rank") or 0)
            metadata.update(
                {
                    "resend_event_rank": max(previous_rank, new_rank),
                    "resend_last_event": event_type,
                    "resend_svix_id": headers.get("svix-id"),
                    "resend_payload": payload,
                }
            )

            update_fields = ["metadata"]
            if history.proveedor != "RESEND":
                history.proveedor = "RESEND"
                update_fields.append("proveedor")
            if new_rank >= previous_rank and history.estatus != new_status:
                history.estatus = new_status
                update_fields.append("estatus")

            history.metadata = metadata
            history.save(update_fields=update_fields)
            matched += 1

    return {
        "success": True,
        "event_type": event_type,
        "email_id": email_id or None,
        "matched": matched,
    }


@router.post("/envios/preview/")
def preview_envios(request, payload: PreviewEnvioIn):
    require_cobranza_access(request)
    require_whatsapp_channel_access(request, payload.canal)
    require_admin_access(request)
    enforce_manual_template_governance(request, payload)
    config = get_or_create_main_config(request)
    template = (
        get_object_or_404(scoped_template_queryset(request), id=payload.plantilla_id)
        if payload.plantilla_id
        else None
    )
    try:
        preview_items = build_preview_items(
            config=config,
            template=template,
            allowed_entity_ids=get_allowed_entity_ids(request),
            entity_id=payload.entidad_id,
            client_ids=payload.cliente_ids or None,
            segment=payload.segmento,
            channel=payload.canal,
            subject_override=payload.asunto,
            body_override=payload.mensaje,
            include_portal=payload.incluye_link_portal,
            media_url=payload.url_media,
            reference_date=payload.fecha_referencia or timezone.localdate(),
        )
    except HttpError:
        raise
    except Exception as exc:
        logger.exception("No se pudo generar la previsualizacion manual")
        raise HttpError(400, f"No se pudo generar la previsualizacion: {exc}") from exc
    return {
        "total": len(preview_items),
        "items": preview_items[:60],
    }


@router.post("/envios/masivo/")
def enviar_masivo(request, payload: PreviewEnvioIn):
    require_cobranza_access(request)
    require_whatsapp_channel_access(request, payload.canal)
    require_admin_access(request)
    require_cobranza_test_lab_access_for_whatsapp(request, payload.canal)
    require_whatsapp_shared_number_agreement_for_request(request, payload.canal)
    enforce_manual_template_governance(request, payload)
    config = get_or_create_main_config(request)
    template = (
        get_object_or_404(scoped_template_queryset(request), id=payload.plantilla_id)
        if payload.plantilla_id
        else None
    )
    try:
        preview_items = build_preview_items(
            config=config,
            template=template,
            allowed_entity_ids=get_allowed_entity_ids(request),
            entity_id=payload.entidad_id,
            client_ids=payload.cliente_ids or None,
            segment=payload.segmento,
            channel=payload.canal,
            subject_override=payload.asunto,
            body_override=payload.mensaje,
            include_portal=payload.incluye_link_portal,
            media_url=payload.url_media,
            reference_date=payload.fecha_referencia or timezone.localdate(),
        )
    except HttpError:
        raise
    except Exception as exc:
        logger.exception("No se pudo preparar la campana manual")
        raise HttpError(400, f"No se pudo preparar la campana: {exc}") from exc

    if not preview_items:
        raise HttpError(
            400,
            "No hay destinatarios para esta campana. Revisa que el cliente tenga CxC "
            "dentro del segmento seleccionado o usa el segmento Todos activos.",
        )

    try:
        result = dispatch_preview_items(
            config=config,
            template=template,
            automation=None,
            preview_items=preview_items,
            send_type="MANUAL",
        )
    except HttpError:
        raise
    except Exception as exc:
        logger.exception("No se pudo enviar la campana manual")
        raise HttpError(400, f"No se pudo enviar la campana: {exc}") from exc

    sent = int(result.get("sent") or 0)
    skipped = int(result.get("skipped") or 0)
    errors = result.get("errors") or []
    error_count = len(errors) if isinstance(errors, list) else 0

    if sent <= 0:
        if error_count:
            first_error = str(errors[0])[:260]
            detail = f"No se envio ningun mensaje. Primer error: {first_error}"
        elif skipped:
            detail = (
                "No se envio ningun mensaje. Los destinatarios fueron omitidos por "
                "falta de canal de contacto, por una regla de duplicados o por la "
                "ventana de proteccion de 24 horas por cliente."
            )
        else:
            detail = "No se envio ningun mensaje. No hubo destinatarios validos."
        raise HttpError(400, detail)

    summary_parts = [f"Campana enviada. Enviados: {sent}"]
    if skipped:
        summary_parts.append(f"Omitidos: {skipped}")
    if error_count:
        summary_parts.append(f"Errores: {error_count}")

    return {
        "success": True,
        "mensaje": " | ".join(summary_parts),
        **result,
    }


@router.post("/automatizaciones/ejecutar/")
def ejecutar_automatizaciones(request, fecha_referencia: Optional[date] = None):
    require_cobranza_access(request)
    require_whatsapp_automation_access(request)
    require_admin_access(request)
    config = get_or_create_main_config(request)
    active_whatsapp_rules = ReglaAutomatizacionMensaje.objects.filter(
        configuracion_relacionada=config,
        activo=True,
        canal__in=["WHATSAPP", "AMBOS"],
    ).exists()
    if active_whatsapp_rules:
        require_cobranza_test_lab_access_for_whatsapp(request, "WHATSAPP")
        require_whatsapp_shared_number_agreement_for_capa(config.capa_negocio)
    return execute_due_automations(
        config=config,
        allowed_entity_ids=get_allowed_entity_ids(request),
        reference_date=fecha_referencia or timezone.localdate(),
    )


@router.get("/automatizaciones-preview/")
def preview_automatizaciones(request, fecha_referencia: Optional[date] = None):
    require_cobranza_access(request)
    require_whatsapp_automation_access(request)
    require_admin_access(request)
    config = get_or_create_main_config(request)
    allowed_entity_ids = get_allowed_entity_ids(request)
    reference_date = fecha_referencia or timezone.localdate()
    rules = (
        ReglaAutomatizacionMensaje.objects.select_related(
            "plantilla_relacionada",
            "entidad_relacionada",
        )
        .filter(configuracion_relacionada=config, activo=True, plantilla_relacionada__activo=True)
        .filter(
            Q(entidad_relacionada__isnull=True) | Q(entidad_relacionada_id__in=allowed_entity_ids)
        )
        .order_by("nombre", "id")
    )

    rule_rows = []
    total_candidates = 0
    errors = []
    for rule in rules:
        preview = []
        error_detail = None
        try:
            preview = build_automation_preview(
                config=config,
                rule=rule,
                allowed_entity_ids=allowed_entity_ids,
                reference_date=reference_date,
                materialize_candidates=False,
                prefilter_anchor=True,
            )
        except Exception as exc:
            logger.exception(
                "No se pudo previsualizar la regla de cobranza %s", rule.id
            )
            error_detail = str(exc) or "No se pudo calcular esta regla."
            errors.append(
                {
                    "id": rule.id,
                    "nombre": rule.nombre,
                    "detalle": error_detail,
                }
            )
        total_candidates += len(preview)
        no_candidate_diagnostic = {}
        if not preview and not error_detail:
            no_candidate_diagnostic = _build_automation_no_candidate_diagnostic(
                config=config,
                rule=rule,
                allowed_entity_ids=allowed_entity_ids,
                reference_date=reference_date,
            )
        rule_rows.append(
            {
                "id": rule.id,
                "nombre": rule.nombre,
                "plantilla_nombre": rule.plantilla_relacionada.nombre,
                "canal": rule.canal,
                "segmento": rule.segmento,
                "evento_base": rule.evento_base,
                "desplazamiento_dias": rule.desplazamiento_dias,
                "candidatos": len(preview),
                "muestras": preview[:8],
                "error": error_detail,
                **no_candidate_diagnostic,
            }
        )

    return {
        "fecha_referencia": reference_date,
        "reglas_activas": len(rule_rows),
        "candidatos": total_candidates,
        "reglas": rule_rows,
        "errores": errors,
    }


@router.get("/portal/{token}/", auth=None)
def detalle_portal_cliente(request, token: str):
    cliente = resolve_portal_cliente_from_token(token)
    if not portal_otp_required() or get_valid_portal_session(
        request,
        token=token,
        cliente=cliente,
    ):
        payload = build_portal_payload(token=token)
        return attach_portal_auth_state(payload, cliente=cliente, verified=True)
    return build_locked_portal_payload(
        cliente=cliente,
        detail="Confirma tu identidad con un codigo enviado por WhatsApp.",
    )


@router.post("/portal/{token}/otp/request/", auth=None)
def solicitar_otp_portal_cliente(request, token: str):
    cliente = resolve_portal_cliente_from_token(token)
    if get_valid_portal_session(request, token=token, cliente=cliente):
        return {
            "success": True,
            "already_verified": True,
            "portal": attach_portal_auth_state(
                build_portal_payload(token=token),
                cliente=cliente,
                verified=True,
            ),
        }
    destination = build_whatsapp_chat_id(cliente)
    if not destination:
        raise HttpError(
            400,
            "Este portal no tiene un telefono WhatsApp registrado para enviar el codigo.",
        )
    lab_destination_allowed = is_portal_lab_whatsapp_destination_allowed(
        cliente,
        destination,
    )
    if not is_whatsapp_destination_allowed(destination) and not lab_destination_allowed:
        raise HttpError(
            403,
            "El telefono de este portal no esta permitido en la zona segura de pruebas.",
        )

    now = timezone.now()
    token_hash = hash_portal_token(token)
    resend_seconds = max(int(getattr(settings, "PORTAL_OTP_RESEND_SECONDS", 60) or 60), 1)
    recent_pending = (
        PortalOtpChallenge.objects.filter(
            cliente=cliente,
            token_hash=token_hash,
            estado="PENDIENTE",
            fecha_creacion__gt=now - timedelta(seconds=resend_seconds),
        )
        .order_by("-fecha_creacion", "-id")
        .first()
    )
    if recent_pending:
        wait_seconds = max(
            1,
            resend_seconds - int((now - recent_pending.fecha_creacion).total_seconds()),
        )
        raise HttpError(
            429,
            f"Ya enviamos un codigo. Espera {wait_seconds} segundo(s) antes de pedir otro.",
        )

    PortalOtpChallenge.objects.filter(
        cliente=cliente,
        token_hash=token_hash,
        estado="PENDIENTE",
    ).update(estado="EXPIRADO")

    code = f"{secrets.randbelow(1_000_000):06d}"
    challenge = PortalOtpChallenge.objects.create(
        cliente=cliente,
        token_hash=token_hash,
        codigo_hash=hash_portal_otp_code(
            cliente_id=cliente.id,
            token_hash=token_hash,
            code=code,
        ),
        destinatario=normalize_whatsapp_destination(destination),
        fecha_expiracion=now + timedelta(minutes=get_portal_otp_minutes()),
        metadata={
            "origen": "PORTAL_CLIENTE",
            "masked_phone": mask_portal_phone(destination),
            "ip": get_request_ip(request),
            "user_agent": get_request_user_agent(request),
        },
    )
    config = get_or_create_portal_config(cliente)
    template_name = (
        getattr(settings, "PORTAL_OTP_WHATSAPP_TEMPLATE_NAME", "")
        or "betterp_portal_otp"
    ).strip()
    template_language = (
        getattr(settings, "PORTAL_OTP_WHATSAPP_TEMPLATE_LANGUAGE", "")
        or "es_MX"
    ).strip()
    safe_body = (
        "Codigo de acceso al portal enviado por WhatsApp. "
        "El codigo no se guarda en claro."
    )
    try:
        provider_response = send_whatsapp_message(
            config=config,
            cliente=cliente,
            chat_id=destination,
            message=safe_body,
            template_name=template_name,
            template_language=template_language,
            template_parameters=[code],
            template_button_parameters=[code],
            enforce_allowed_numbers=not lab_destination_allowed,
        )
    except ValueError as exc:
        challenge.estado = "ERROR"
        challenge.metadata = {
            **(challenge.metadata or {}),
            "error": str(exc),
        }
        challenge.save(update_fields=["estado", "metadata", "fecha_actualizacion"])
        register_history(
            config=config,
            cliente=cliente,
            template=None,
            automation=None,
            channel="WHATSAPP",
            provider="META_CLOUD_API",
            destination=normalize_whatsapp_destination(destination),
            subject="",
            body=safe_body,
            media_url=None,
            status="ERROR",
            reference=None,
            dedupe_key=None,
            metadata={
                "portal_otp": True,
                "challenge_id": challenge.id,
                "template_name": template_name,
                "error": str(exc),
            },
            send_type="MANUAL",
        )
        raise HttpError(400, str(exc)) from exc

    messages = provider_response.get("messages") or []
    reference = None
    if messages and isinstance(messages[0], dict):
        reference = str(messages[0].get("id") or "").strip() or None
    provider = provider_response.get("provider") or "META_CLOUD_API"
    register_history(
        config=config,
        cliente=cliente,
        template=None,
        automation=None,
        channel="WHATSAPP",
        provider=str(provider),
        destination=normalize_whatsapp_destination(destination),
        subject="",
        body=safe_body,
        media_url=None,
        status="ENVIADO",
        reference=reference,
        dedupe_key=None,
        metadata={
            "portal_otp": True,
            "challenge_id": challenge.id,
            "template_name": template_name,
            "provider_response": provider_response,
        },
        send_type="MANUAL",
    )
    return {
        "success": True,
        "mensaje": "Codigo enviado por WhatsApp.",
        "masked_phone": mask_portal_phone(destination),
        "destino": normalize_whatsapp_destination(destination),
        "provider": str(provider),
        "message_id": reference,
        "template_name": template_name,
        "expires_minutes": get_portal_otp_minutes(),
        "resend_seconds": resend_seconds,
    }


@router.post("/portal/{token}/otp/verify/", auth=None)
def verificar_otp_portal_cliente(request, token: str, payload: PortalOtpVerifyIn):
    cliente = resolve_portal_cliente_from_token(token)
    token_hash = hash_portal_token(token)
    code = re.sub(r"\D", "", payload.codigo or "")
    if len(code) != 6:
        raise HttpError(400, "Ingresa el codigo de 6 digitos.")

    now = timezone.now()
    challenge = (
        PortalOtpChallenge.objects.filter(
            cliente=cliente,
            token_hash=token_hash,
            estado="PENDIENTE",
            fecha_expiracion__gt=now,
        )
        .order_by("-fecha_creacion", "-id")
        .first()
    )
    if not challenge:
        raise HttpError(
            400,
            "El codigo ya expiro o no existe. Solicita un codigo nuevo.",
        )

    max_attempts = max(int(getattr(settings, "PORTAL_OTP_MAX_ATTEMPTS", 5) or 5), 1)
    expected_hash = hash_portal_otp_code(
        cliente_id=cliente.id,
        token_hash=token_hash,
        code=code,
    )
    if not secrets.compare_digest(challenge.codigo_hash, expected_hash):
        challenge.intentos += 1
        if challenge.intentos >= max_attempts:
            challenge.estado = "BLOQUEADO"
        challenge.save(update_fields=["intentos", "estado", "fecha_actualizacion"])
        if challenge.estado == "BLOQUEADO":
            raise HttpError(
                429,
                "El codigo se bloqueo por demasiados intentos. Solicita uno nuevo.",
            )
        raise HttpError(400, "El codigo no coincide. Revisa e intenta de nuevo.")

    session_token = secrets.token_urlsafe(32)
    challenge.estado = "VERIFICADO"
    challenge.session_token_hash = hash_portal_session_token(session_token)
    challenge.fecha_verificacion = now
    challenge.fecha_expiracion = now + timedelta(hours=get_portal_session_hours())
    challenge.metadata = {
        **(challenge.metadata or {}),
        "verified_at": now.isoformat(),
    }
    challenge.save(
        update_fields=[
            "estado",
            "session_token_hash",
            "fecha_verificacion",
            "fecha_expiracion",
            "metadata",
            "fecha_actualizacion",
        ]
    )
    portal = attach_portal_auth_state(
        build_portal_payload(token=token),
        cliente=cliente,
        verified=True,
    )
    return {
        "success": True,
        "mensaje": "Acceso validado correctamente.",
        "portal_session_token": session_token,
        "session_hours": get_portal_session_hours(),
        "portal": portal,
    }


@router.post("/portal/{token}/consentimiento-cobranza/", auth=None)
def aceptar_consentimiento_cobranza_portal(
    request,
    token: str,
    payload: PortalCollectionConsentIn,
):
    _, cliente = resolve_portal_payload_and_cliente(token)
    require_portal_otp_session(request, token=token, cliente=cliente)
    if not payload.acepta_comunicaciones_cobranza:
        raise HttpError(
            400,
            "Debes aceptar las comunicaciones de cobranza para continuar.",
        )
    if not payload.acepta_actualizacion_contacto:
        raise HttpError(
            400,
            "Confirma que revisaras o actualizaras tus datos de contacto.",
        )

    consent = get_portal_collection_consent_payload()
    now = timezone.now()
    metadata = {
        "origen": "PORTAL_CLIENTE",
        "ip": get_request_ip(request),
        "user_agent": get_request_user_agent(request),
        "acepta_comunicaciones_cobranza": payload.acepta_comunicaciones_cobranza,
        "acepta_actualizacion_contacto": payload.acepta_actualizacion_contacto,
        "accepted_at": now.isoformat(),
    }
    cliente.consentimiento_cobranza_aceptado = True
    cliente.consentimiento_cobranza_fecha = now
    cliente.consentimiento_cobranza_version = consent["version"]
    cliente.consentimiento_cobranza_texto_hash = consent["texto_hash"]
    cliente.consentimiento_cobranza_metadata = metadata
    cliente.save(
        update_fields=[
            "consentimiento_cobranza_aceptado",
            "consentimiento_cobranza_fecha",
            "consentimiento_cobranza_version",
            "consentimiento_cobranza_texto_hash",
            "consentimiento_cobranza_metadata",
        ]
    )
    return {
        "success": True,
        "mensaje": "Consentimiento registrado correctamente.",
        "portal": build_authenticated_portal_payload(request, token=token, cliente=cliente),
    }


@router.get("/portal/{token}/facturas/{factura_id}/{formato}/", auth=None)
def descargar_factura_portal_cliente(request, token: str, factura_id: int, formato: str):
    _, cliente = resolve_portal_payload_and_cliente(token)
    require_portal_otp_session(request, token=token, cliente=cliente)
    require_portal_collection_consent(cliente)
    factura = get_object_or_404(
        FacturaEmitida.objects.prefetch_related("partidas").filter(
            id=factura_id,
            cliente_receptor=cliente,
        ).exclude(estatus="CANCELADA")
    )
    if factura.estatus != "TIMBRADA" or not factura.proveedor_factura_id:
        raise HttpError(
            400,
            "La factura aun no esta timbrada o no tiene archivos PDF/XML disponibles. "
            "Intenta generarla nuevamente desde el portal.",
        )
    content, content_type, filename = download_invoice_file(factura, formato)
    response = HttpResponse(content, content_type=content_type)
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response


@router.post("/portal/{token}/cuentas/{cuenta_id}/factura/", auth=None)
def emitir_factura_portal_cliente(request, token: str, cuenta_id: int):
    _, cliente = resolve_portal_payload_and_cliente(token)
    require_portal_otp_session(request, token=token, cliente=cliente)
    require_portal_collection_consent(cliente)
    cuenta = (
        CuentaPorCobrar.objects.select_related("entidad_relacionada", "cliente_relacionado")
        .filter(id=cuenta_id, cliente_relacionado=cliente)
        .first()
    )
    if not cuenta:
        raise HttpError(404, "La cuenta por cobrar seleccionada no existe.")

    existing_invoice = find_existing_cxc_invoice(cuenta)
    if existing_invoice and existing_invoice.estatus == "TIMBRADA":
        return {
            "mensaje": "Esta cuenta ya tiene factura timbrada.",
            "factura": serialize_invoice(existing_invoice),
            "portal": build_authenticated_portal_payload(request, token=token, cliente=cliente),
        }

    try:
        draft = build_cxc_invoice_draft(cuenta, contexto="PORTAL_CLIENTE")
        invoice = emit_invoice(
            draft=draft,
            capa=cuenta.entidad_relacionada.capa_negocio,
            cuenta=cuenta,
        )
    except HttpError as exc:
        invoice = find_existing_cxc_invoice(cuenta)
        return JsonResponse(
            {
                "detail": getattr(exc, "message", None) or str(exc),
                "factura": serialize_invoice(invoice) if invoice else None,
                "portal": build_authenticated_portal_payload(
                    request,
                    token=token,
                    cliente=cliente,
                ),
            },
            status=getattr(exc, "status_code", 500),
        )
    return {
        "mensaje": "Factura emitida correctamente.",
        "factura": serialize_invoice(invoice),
        "portal": build_authenticated_portal_payload(request, token=token, cliente=cliente),
    }


@router.post("/portal/{token}/csf/", auth=None)
def cargar_csf_portal_cliente(
    request,
    token: str,
    archivo: UploadedFile = File(...),
):
    _, cliente = resolve_portal_payload_and_cliente(token)
    require_portal_otp_session(request, token=token, cliente=cliente)
    require_portal_collection_consent(cliente)
    filename = safe_portal_filename(archivo.name or "", "csf.pdf")
    if not filename.lower().endswith(".pdf"):
        raise HttpError(400, "Solo se acepta la CSF en PDF.")

    raw_content = archivo.file.read()
    if not raw_content:
        raise HttpError(400, "El archivo de CSF esta vacio.")
    if len(raw_content) > PORTAL_CSF_MAX_BYTES:
        raise HttpError(400, "La CSF no puede exceder 10 MB.")

    archivo.file.seek(0)
    datos = extract_csf_data_from_upload(archivo)
    datos["archivo_csf_url"] = upload_csf_to_r2(archivo)
    changed_fields = apply_csf_data_to_cliente(cliente, datos)

    return {
        "mensaje": "Datos fiscales actualizados correctamente.",
        "campos_actualizados": changed_fields,
        "portal": build_authenticated_portal_payload(request, token=token, cliente=cliente),
    }


@router.post("/portal/{token}/csf/regimen/", auth=None)
def seleccionar_regimen_csf_portal_cliente(
    request,
    token: str,
    regimen_fiscal: str = Form(...),
):
    _, cliente = resolve_portal_payload_and_cliente(token)
    require_portal_otp_session(request, token=token, cliente=cliente)
    require_portal_collection_consent(cliente)
    options = cliente.regimenes_fiscales_detectados or []
    selected_code = normalize_fiscal_regime_code(regimen_fiscal)
    selected_option = None
    if options:
        for option in options:
            if not isinstance(option, dict):
                continue
            option_code = normalize_fiscal_regime_code(
                option.get("codigo") or option.get("label") or option.get("descripcion")
            )
            if option_code == selected_code:
                selected_option = option
                break
        if selected_option is None:
            raise HttpError(
                400,
                "Selecciona un regimen fiscal de los detectados en la CSF cargada.",
            )

    selected_label = ""
    if selected_option:
        selected_label = str(
            selected_option.get("label")
            or selected_option.get("descripcion")
            or selected_option.get("codigo")
            or ""
        ).strip()
    selected_label = selected_label or str(regimen_fiscal or "").strip()
    if not normalize_fiscal_regime_code(selected_label):
        raise HttpError(400, "Selecciona un regimen fiscal valido.")

    cliente.regimen_fiscal = selected_label
    cliente.regimen_fiscal_pendiente_seleccion = False
    cliente.save(update_fields=["regimen_fiscal", "regimen_fiscal_pendiente_seleccion"])

    return {
        "mensaje": "Regimen fiscal confirmado para facturacion.",
        "portal": build_authenticated_portal_payload(request, token=token, cliente=cliente),
    }


@router.delete("/portal/{token}/csf/", auth=None)
def quitar_csf_portal_cliente(request, token: str):
    _, cliente = resolve_portal_payload_and_cliente(token)
    require_portal_otp_session(request, token=token, cliente=cliente)
    require_portal_collection_consent(cliente)
    if not cliente.archivo_csf_url:
        return {
            "mensaje": "No hay una CSF cargada en este portal.",
            "portal": build_authenticated_portal_payload(request, token=token, cliente=cliente),
        }

    cliente.archivo_csf_url = ""
    cliente.save(update_fields=["archivo_csf_url"])

    return {
        "mensaje": "CSF retirada correctamente. Puedes cargar una nueva cuando lo necesites.",
        "portal": build_authenticated_portal_payload(request, token=token, cliente=cliente),
    }


@router.post("/portal/{token}/comprobantes/", auth=None)
@transaction.atomic
def cargar_comprobante_portal_cliente(
    request,
    token: str,
    cuenta_id: Optional[int] = Form(None),
    monto: Optional[Decimal] = Form(None),
    fecha_pago: Optional[date] = Form(None),
    referencia: str = Form(""),
    notas: str = Form(""),
    archivo: UploadedFile = File(...),
):
    _, cliente = resolve_portal_payload_and_cliente(token)
    require_portal_otp_session(request, token=token, cliente=cliente)
    require_portal_collection_consent(cliente)
    legacy_manual_payload = cuenta_id is not None or monto is not None
    cuenta = None
    if legacy_manual_payload:
        if cuenta_id is None or monto is None:
            raise HttpError(
                400,
                "Para aplicar manualmente un comprobante se requiere cuenta y monto.",
            )
        cuenta = (
            CuentaPorCobrar.objects.select_related("entidad_relacionada", "cliente_relacionado")
            .filter(id=cuenta_id, cliente_relacionado=cliente)
            .first()
        )
        if not cuenta:
            raise HttpError(404, "La cuenta por cobrar seleccionada no existe.")
        if cuenta.saldo_pendiente <= 0:
            raise HttpError(400, "Esta cuenta ya no tiene saldo pendiente.")
        if monto <= 0:
            raise HttpError(400, "El monto reportado debe ser mayor a cero.")
        if monto > cuenta.saldo_pendiente:
            raise HttpError(400, "El monto no puede exceder el saldo pendiente de la cuenta.")

    filename = safe_portal_filename(archivo.name or "", "comprobante.pdf")
    extension = os.path.splitext(filename)[1].lower()
    if extension not in PORTAL_UPLOAD_EXTENSIONS:
        raise HttpError(400, "Solo se aceptan comprobantes PDF o imagen.")

    raw_content = archivo.file.read()
    if not raw_content:
        raise HttpError(400, "El archivo del comprobante esta vacio.")
    if len(raw_content) > PORTAL_UPLOAD_MAX_BYTES:
        raise HttpError(400, "El comprobante no puede exceder 10 MB.")

    file_hash = hashlib.sha256(raw_content).hexdigest()
    if EvidenciaPago.objects.filter(hash_archivo=file_hash).exists():
        raise HttpError(
            400,
            (
                "Este comprobante ya fue recibido. Si estas probando el laboratorio, "
                "usa Reiniciar prueba completa para limpiar comprobantes enviados "
                "antes de subirlo otra vez."
            ),
        )

    storage_path = default_storage.save(
        f"portal-comprobantes/{cliente.id}/{file_hash[:16]}-{filename}",
        ContentFile(raw_content),
    )
    file_url = default_storage.url(storage_path)
    if file_url.startswith("/"):
        file_url = request.build_absolute_uri(file_url)
    entidad = (cuenta.entidad_relacionada if cuenta else None) or cliente.entidad_relacionada
    evidencia = EvidenciaPago.objects.create(
        entidad_relacionada=entidad,
        cliente_relacionado=cliente,
        canal="MANUAL",
        tipo_movimiento="INGRESO",
        origen_deteccion="MANUAL",
        url_archivo=file_url,
        hash_archivo=file_hash,
        monto_reportado=monto,
        fecha_pago_reportada=(fecha_pago or timezone.localdate()) if monto else fecha_pago,
        referencia_reportada=referencia.strip() or None,
        texto_extraido=None,
        confianza_clasificacion=Decimal("0"),
        requiere_revision_manual=True,
        categoria_sugerida="Comprobante portal cliente",
        metadata={
            "origen": "PORTAL_CLIENTE",
            "cuenta_id": cuenta.id if cuenta else None,
            "archivo_nombre": filename,
            "storage_path": storage_path,
            "modo_captura": "manual_legacy" if legacy_manual_payload else "archivo_ia",
        },
        observaciones=notas.strip() or None,
        estatus="NUEVA",
    )

    analysis = None
    portal_config = None
    candidates: list[dict] = []
    if not legacy_manual_payload:
        portal_config = get_or_create_portal_config(cliente)
        analysis = run_portal_receipt_analysis(
            evidencia=evidencia,
            config=portal_config,
            file_content=raw_content,
            filename=filename,
            content_type=getattr(archivo, "content_type", "") or "",
        )
        cuenta, candidates = find_portal_auto_apply_account(evidencia=evidencia)
        metadata = evidencia.metadata if isinstance(evidencia.metadata, dict) else {}
        if candidates:
            metadata["cxc_candidatas"] = serialize_portal_cxc_candidates(candidates)
        metadata["portal_lectura_automatica"] = {
            "fuente": analysis.get("fuente") if analysis else "",
            "requiere_revision_manual": evidencia.requiere_revision_manual,
            "cuenta_autoaplicable_id": cuenta.id if cuenta else None,
        }
        evidencia.metadata = metadata
        evidencia.save(update_fields=["metadata"])
    else:
        cuenta, candidates = find_portal_auto_apply_account(
            evidencia=evidencia,
            explicit_account=cuenta,
        )

    result = {"aplicaciones": [], "saldo_a_favor": Decimal("0")}
    event = None
    acknowledgement = None
    was_applied = False
    payment_recorded = False
    credit_recorded = False
    saldo_a_favor_amount = Decimal("0")
    amount_to_apply = evidencia.monto_reportado
    payment_date_to_apply = evidencia.fecha_pago_reportada
    reference_to_apply = evidencia.referencia_reportada or referencia.strip()
    payment_entity = (cuenta.entidad_relacionada if cuenta else None) or entidad
    can_register_payment = bool(
        payment_entity
        and amount_to_apply
        and amount_to_apply > 0
        and payment_date_to_apply
        and (
            legacy_manual_payload
            or portal_receipt_has_auto_apply_reading(evidencia, portal_config)
        )
    )

    if can_register_payment:
        result = register_payment_for_entity(
            payment_entity,
            monto=amount_to_apply,
            fecha_pago=payment_date_to_apply,
            metodo="TRANSFERENCIA",
            referencia=reference_to_apply or "",
            notas=notas.strip() or "Comprobante cargado desde portal cliente.",
            cliente_id=cliente.id,
            cuenta_id=cuenta.id if cuenta else None,
            canal_origen="ESTADO_CUENTA",
            evidencia_id=evidencia.id,
            solo_cuenta_prioritaria=bool(cuenta),
        )
    evidencia.refresh_from_db()
    saldo_a_favor_amount = Decimal(str(result.get("saldo_a_favor") or "0"))
    was_applied = bool(result["aplicaciones"])
    credit_recorded = saldo_a_favor_amount > 0
    payment_recorded = was_applied or credit_recorded
    if payment_recorded:
        update_fields = []
        if evidencia.requiere_revision_manual:
            evidencia.requiere_revision_manual = False
            update_fields.append("requiere_revision_manual")
        if credit_recorded and not was_applied and evidencia.estatus != "VALIDADA":
            evidencia.estatus = "VALIDADA"
            update_fields.append("estatus")
        if update_fields:
            evidencia.save(update_fields=update_fields)
    if payment_recorded:
        event = create_portal_reconciliation_event(
            evidencia=evidencia,
            cuenta=cuenta,
            aplicaciones=result["aplicaciones"],
            saldo_a_favor=float(result["saldo_a_favor"] or 0),
            monto=amount_to_apply,
            fecha_pago=payment_date_to_apply,
            referencia=reference_to_apply or "",
            notas=notas,
        )
    acknowledgement_account = cuenta
    if was_applied and not acknowledgement_account:
        first_application = next(
            (
                item
                for item in result["aplicaciones"]
                if isinstance(item, dict) and item.get("cuenta_id")
            ),
            None,
        )
        if first_application:
            acknowledgement_account = (
                CuentaPorCobrar.objects.select_related(
                    "entidad_relacionada",
                    "cliente_relacionado",
                )
                .filter(
                    id=first_application["cuenta_id"],
                    cliente_relacionado=cliente,
                )
                .first()
            )
    if acknowledgement_account:
        acknowledgement_account.refresh_from_db()
    partial_payment = (
        was_applied
        and acknowledgement_account
        and acknowledgement_account.saldo_pendiente > 0
    )
    if payment_recorded and (acknowledgement_account or credit_recorded):
        config = get_or_create_portal_config(cliente)
        acknowledgement = send_payment_acknowledgement_if_ready(
            config=config,
            cliente=cliente,
            cuenta=acknowledgement_account,
            evidencia=evidencia,
            monto=amount_to_apply,
            partial_payment=bool(partial_payment),
        )
        metadata = evidencia.metadata if isinstance(evidencia.metadata, dict) else {}
        metadata["acuse_whatsapp_pago"] = acknowledgement
        evidencia.metadata = metadata
        evidencia.save(update_fields=["metadata"])
    if partial_payment:
        portal_message = (
            "Comprobante recibido y pago parcial aplicado. "
            f"Saldo pendiente: {acknowledgement_account.saldo_pendiente}."
        )
    elif was_applied and credit_recorded:
        portal_message = (
            "Comprobante recibido, pago aplicado y excedente registrado como saldo a favor."
        )
    elif was_applied:
        portal_message = "Comprobante recibido y pago aplicado al estado de cuenta."
    elif credit_recorded:
        portal_message = "Comprobante recibido y saldo a favor registrado para tu cuenta."
    else:
        portal_message = portal_receipt_unreadable_message(evidencia)
    return {
        "mensaje": portal_message,
        "evidencia_id": evidencia.id,
        "estatus": evidencia.estatus,
        "resultado": "APLICADO" if payment_recorded else "EN_REVISION",
        "aviso": None if payment_recorded else "COMPROBANTE_PENDIENTE_LECTURA",
        "evento_id": event.id if event else None,
        "evento_estatus": event.estatus if event else None,
        "aplicaciones": result["aplicaciones"],
        "saldo_a_favor": result["saldo_a_favor"],
        "monto_reportado": decimal_to_float(evidencia.monto_reportado or Decimal("0")),
        "acuse_whatsapp_pago": acknowledgement,
        "portal": build_authenticated_portal_payload(request, token=token, cliente=cliente),
    }
