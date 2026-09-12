import re
import time
from collections import defaultdict
from datetime import date, datetime, timedelta
from decimal import Decimal
from urllib.parse import urlparse

import requests
from django.conf import settings
from django.core import signing
from django.db.models import Count, F, Q
from django.utils import timezone
from ninja.errors import HttpError

from billing.models import ConsumoSaaS, SuscripcionCapa
from billing.services import normalize_platform_app_base_url, platform_app_base_url
from crm.models import Cliente
from finanzas.models import CuentaPorCobrar
from finanzas.services import (
    build_cxc_customer_detail,
    build_cxc_row,
    default_interest_context,
    decimal_to_float,
    resolve_interest_rules_for_entities,
)
from .email_provider import (
    get_email_provider,
    send_email_transport,
)
from .legal import (
    get_portal_collection_consent_payload,
    has_whatsapp_shared_number_agreement,
    require_whatsapp_shared_number_agreement_for_capa,
)

from .models import (
    CanalWhatsappOficial,
    ConfiguracionComunicacion,
    EvidenciaPago,
    HistorialEnvio,
    PlantillaMensaje,
    ReglaAutomatizacionMensaje,
)

DEFAULT_GREEN_API_URL = "https://api.green-api.com"
PORTAL_CLIENTE_SALT = "betterp.portal.cliente"
TOKEN_PATTERN = re.compile(r"{{\s*([a-zA-Z0-9_]+)\s*}}")
MONTH_NAMES_ES = [
    "",
    "Enero",
    "Febrero",
    "Marzo",
    "Abril",
    "Mayo",
    "Junio",
    "Julio",
    "Agosto",
    "Septiembre",
    "Octubre",
    "Noviembre",
    "Diciembre",
]
OUTBOUND_USAGE_CHANNELS = {
    "WHATSAPP": {
        "categoria": "WHATSAPP_OUTBOUND",
        "plan_field": "whatsapp_mensajes_incluidos",
        "adjustment_field": "whatsapp_mensajes_enviados_ajuste",
        "label": "WhatsApp",
    },
    "EMAIL": {
        "categoria": "EMAIL_OUTBOUND",
        "plan_field": "emails_incluidos",
        "adjustment_field": "emails_enviados_ajuste",
        "label": "email",
    },
}
SUCCESSFUL_OUTBOUND_STATUSES = ("ENVIADO", "ENTREGADO", "LEIDO")
COLLECTION_MESSAGE_COOLDOWN_HOURS = 24
COLLECTION_MESSAGE_COOLDOWN_REASON = (
    "Ventana de proteccion de 24 horas activa para este cliente"
)
COLLECTION_NO_CONTACT_REASON = "Cliente marcado como no contactar para cobranza"
COLLECTION_CONSENT_REQUIRED_REASON = (
    "Consentimiento de cobranza pendiente o desactualizado"
)
COLLECTION_CONSENT_INVITATION_TEMPLATE_NAMES = {"betterp_portal_bienvenida"}
COLLECTION_CONSENT_INVITATION_TEMPLATE_TYPES = {"PORTAL_AUTOSERVICIO"}
COLLECTION_STAGE_PREVENTIVE = "PREVENTIVO"
COLLECTION_STAGE_DUE_TODAY = "VENCE_HOY"
COLLECTION_STAGE_GRACE = "GRACIA"
COLLECTION_STAGE_OVERDUE = "RECARGO"


class TransientOutboundError(ValueError):
    pass


def resolve_outbound_period_bounds(reference_datetime=None) -> tuple[str, datetime, datetime]:
    current = reference_datetime or timezone.now()
    if isinstance(current, date) and not isinstance(current, datetime):
        current = datetime(current.year, current.month, current.day)
    if timezone.is_naive(current):
        current = timezone.make_aware(current, timezone.get_current_timezone())
    period = f"{current.year:04d}-{current.month:02d}"
    start = current.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if start.month == 12:
        end = start.replace(year=start.year + 1, month=1)
    else:
        end = start.replace(month=start.month + 1)
    return period, start, end


def build_outbound_usage_limits(
    config: ConfiguracionComunicacion,
    *,
    reference_datetime=None,
) -> dict[str, dict]:
    capa_id = config.capa_negocio_id
    if not capa_id:
        return {}

    subscription = (
        SuscripcionCapa.objects.select_related("plan")
        .filter(capa_negocio_id=capa_id)
        .first()
    )
    if not subscription:
        return {}

    period, period_start, period_end = resolve_outbound_period_bounds(reference_datetime)
    history_rows = (
        HistorialEnvio.objects.filter(
            Q(entidad_relacionada__capa_negocio_id=capa_id)
            | Q(
                entidad_relacionada__isnull=True,
                cliente_relacionado__entidad_relacionada__capa_negocio_id=capa_id,
            ),
            fecha_envio__gte=period_start,
            fecha_envio__lt=period_end,
            estatus__in=SUCCESSFUL_OUTBOUND_STATUSES,
            canal__in=OUTBOUND_USAGE_CHANNELS.keys(),
        )
        .values("canal")
        .annotate(total=Count("id"))
    )
    history_counts = {
        str(row["canal"]): int(row["total"] or 0)
        for row in history_rows
    }
    consumo = ConsumoSaaS.objects.filter(capa_negocio_id=capa_id).first()

    limits: dict[str, dict] = {}
    for channel, definition in OUTBOUND_USAGE_CHANNELS.items():
        included = int(getattr(subscription.plan, definition["plan_field"], 0) or 0)
        adjustment = (
            int(getattr(consumo, definition["adjustment_field"], 0) or 0)
            if consumo
            else 0
        )
        used = int(history_counts.get(channel, 0)) + adjustment
        remaining = max(included - used, 0)
        limits[channel] = {
            "canal": channel,
            "categoria": definition["categoria"],
            "label": definition["label"],
            "periodo": period,
            "incluido": included,
            "usado": used,
            "restante": remaining,
            "enforced": True,
            "subscription_id": subscription.id,
            "plan_id": subscription.plan_id,
            "plan_nombre": subscription.plan.nombre,
        }
    return limits


def serialize_outbound_usage_limit(limit: dict | None) -> dict | None:
    if not limit:
        return None
    return {
        "canal": limit["canal"],
        "categoria": limit["categoria"],
        "periodo": limit["periodo"],
        "incluido": limit["incluido"],
        "usado": limit["usado"],
        "restante": limit["restante"],
        "plan_nombre": limit.get("plan_nombre"),
    }


def resolve_collection_message_cooldown() -> timedelta:
    raw_hours = getattr(
        settings,
        "COLLECTION_MESSAGE_COOLDOWN_HOURS",
        COLLECTION_MESSAGE_COOLDOWN_HOURS,
    )
    try:
        hours = float(raw_hours)
    except (TypeError, ValueError):
        hours = COLLECTION_MESSAGE_COOLDOWN_HOURS
    return timedelta(hours=max(hours, 0))


def collection_consent_required_for_whatsapp() -> bool:
    return bool(
        getattr(
            settings,
            "COLLECTION_REQUIRE_CONSENT_FOR_WHATSAPP",
            getattr(settings, "IS_PRODUCTION", False),
        )
    )


def cliente_has_current_collection_consent(cliente: Cliente) -> bool:
    consent = get_portal_collection_consent_payload()
    return bool(
        cliente.consentimiento_cobranza_aceptado
        and cliente.consentimiento_cobranza_version == consent["version"]
        and cliente.consentimiento_cobranza_texto_hash == consent["texto_hash"]
    )


def is_collection_consent_invitation_template(
    template: PlantillaMensaje | None,
) -> bool:
    if template is None:
        return False
    template_name = (template.whatsapp_template_name or "").strip().lower()
    template_type = (template.tipo_plantilla or "").strip().upper()
    return (
        template_name in COLLECTION_CONSENT_INVITATION_TEMPLATE_NAMES
        or template_type in COLLECTION_CONSENT_INVITATION_TEMPLATE_TYPES
    )


def get_portal_otp_template_names() -> set[str]:
    configured_name = (
        getattr(settings, "PORTAL_OTP_WHATSAPP_TEMPLATE_NAME", "")
        or "betterp_portal_otp"
    )
    names = {"betterp_portal_otp"}
    if configured_name:
        names.add(str(configured_name).strip().lower())
    return names


def is_collection_cooldown_exempt_history(history: HistorialEnvio) -> bool:
    metadata = history.metadata if isinstance(history.metadata, dict) else {}
    if metadata.get("portal_otp") is True:
        return True

    otp_template_names = get_portal_otp_template_names()
    metadata_template_name = str(metadata.get("template_name") or "").strip().lower()
    if metadata_template_name and metadata_template_name in otp_template_names:
        return True

    template = history.plantilla_usada
    if template is None:
        return False

    template_name = (template.whatsapp_template_name or "").strip().lower()
    template_type = (template.tipo_plantilla or "").strip().upper()
    return (
        template_name in COLLECTION_CONSENT_INVITATION_TEMPLATE_NAMES
        or template_name in otp_template_names
        or template_type in COLLECTION_CONSENT_INVITATION_TEMPLATE_TYPES
    )


def build_collection_consent_metadata(*, item: dict, cliente: Cliente) -> dict:
    consent = get_portal_collection_consent_payload()
    return {
        "reason": COLLECTION_CONSENT_REQUIRED_REASON,
        "segmento": item["segmento"],
        "referencia_pago": item.get("referencia_pago"),
        "cxc_ids": item.get("cxc_ids") or [],
        "primary_cxc_id": item.get("primary_cxc_id"),
        "total_exigible": item.get("total_exigible"),
        "consentimiento_aceptado": bool(cliente.consentimiento_cobranza_aceptado),
        "consentimiento_version_cliente": cliente.consentimiento_cobranza_version,
        "consentimiento_version_actual": consent["version"],
        "consentimiento_fecha": (
            cliente.consentimiento_cobranza_fecha.isoformat()
            if cliente.consentimiento_cobranza_fecha
            else None
        ),
    }


def build_preview_contact_validation(
    *,
    cliente: Cliente,
    channels: list[tuple[str, str]],
    template_payload: dict[str, object],
) -> dict:
    requested_channel = str(template_payload.get("channel") or "").upper()
    requested_whatsapp = requested_channel in {"WHATSAPP", "AMBOS"}
    whatsapp_destination = next(
        (destination for channel, destination in channels if channel == "WHATSAPP"),
        "",
    )
    email_destination = next(
        (destination for channel, destination in channels if channel == "EMAIL"),
        "",
    )
    template_name = (
        str(template_payload.get("whatsapp_template_name") or "").strip().lower()
    )
    template_type = str(template_payload.get("tipo_plantilla") or "").strip().upper()
    is_consent_invitation = (
        template_name in COLLECTION_CONSENT_INVITATION_TEMPLATE_NAMES
        or template_type in COLLECTION_CONSENT_INVITATION_TEMPLATE_TYPES
    )
    consent = get_portal_collection_consent_payload()
    consent_required = (
        requested_whatsapp
        and collection_consent_required_for_whatsapp()
        and not is_consent_invitation
    )
    consent_current = cliente_has_current_collection_consent(cliente)
    no_contact = bool(getattr(cliente, "no_contactar_cobranza", False))
    blockers: list[str] = []
    if no_contact:
        blockers.append("NO_CONTACTAR")
    if requested_whatsapp and not whatsapp_destination:
        blockers.append("WHATSAPP_SIN_TELEFONO")
    if consent_required and not consent_current:
        blockers.append("CONSENTIMIENTO_PENDIENTE")

    raw_phone = f"{cliente.codigo_pais or ''} {cliente.telefono or ''}".strip()
    normalized_phone = normalize_whatsapp_destination(whatsapp_destination or raw_phone)
    return {
        "telefono": {
            "registrado": cliente.telefono or "",
            "codigo_pais": cliente.codigo_pais or "",
            "display": raw_phone,
            "destino_whatsapp": whatsapp_destination,
            "normalizado": normalized_phone,
            "presente": bool(whatsapp_destination),
            "requerido": requested_whatsapp,
        },
        "correo": {
            "registrado": cliente.correo_principal or "",
            "destino": email_destination,
            "presente": bool(email_destination),
        },
        "consentimiento_cobranza": {
            "requerido": consent_required,
            "aceptado": consent_current,
            "bloquea_whatsapp": bool(consent_required and not consent_current),
            "plantilla_invitacion": is_consent_invitation,
            "version_actual": consent["version"],
            "version_cliente": cliente.consentimiento_cobranza_version,
            "fecha_aceptacion": (
                cliente.consentimiento_cobranza_fecha.isoformat()
                if cliente.consentimiento_cobranza_fecha
                else None
            ),
        },
        "no_contactar_cobranza": {
            "bloqueado": no_contact,
            "motivo": cliente.no_contactar_cobranza_motivo,
            "fecha": (
                cliente.no_contactar_cobranza_fecha.isoformat()
                if cliente.no_contactar_cobranza_fecha
                else None
            ),
        },
        "bloqueantes": blockers,
        "listo_para_envio": not blockers,
    }


def template_payload_is_collection_consent_invitation(
    template_payload: dict[str, object],
) -> bool:
    template_name = (
        str(template_payload.get("whatsapp_template_name") or "").strip().lower()
    )
    template_type = str(template_payload.get("tipo_plantilla") or "").strip().upper()
    return (
        template_name in COLLECTION_CONSENT_INVITATION_TEMPLATE_NAMES
        or template_type in COLLECTION_CONSENT_INVITATION_TEMPLATE_TYPES
    )


def build_preview_billing_validation(
    *,
    candidate: dict,
    context: dict[str, object],
    template_payload: dict[str, object],
    segment: str,
) -> dict:
    rows = candidate.get("rows") or []
    primary_row = candidate.get("primary_row") or (rows[0] if rows else None)
    requires_open_cxc = (
        segment != "TODOS_ACTIVOS"
        and not template_payload_is_collection_consent_invitation(template_payload)
    )
    total_exigible = Decimal(str(context.get("total_exigible") or 0))
    saldo_vivo = Decimal(str(context.get("saldo_vivo") or 0))
    due_date = primary_row.get("fecha_vencimiento") if primary_row else None
    due_date_present = isinstance(due_date, date)
    blockers: list[str] = []

    if requires_open_cxc and not rows:
        blockers.append("SIN_CXC_ABIERTA")
    if requires_open_cxc and total_exigible <= 0:
        blockers.append("SALDO_NO_POSITIVO")
    if requires_open_cxc and not due_date_present:
        blockers.append("SIN_VENCIMIENTO")

    return {
        "requerida": requires_open_cxc,
        "cuentas": {
            "abiertas": len(rows),
            "primary_cxc_id": primary_row.get("id") if primary_row else None,
        },
        "saldo": {
            "saldo_vivo": decimal_to_float(saldo_vivo),
            "saldo_vivo_formato": format_money(saldo_vivo),
            "total_exigible": decimal_to_float(total_exigible),
            "total_exigible_formato": format_money(total_exigible),
            "positivo": total_exigible > 0,
        },
        "vencimiento": {
            "fecha": context.get("fecha_vencimiento") or "",
            "fecha_larga": context.get("fecha_vencimiento_larga") or "",
            "limite_gracia": context.get("fecha_limite_gracia") or "",
            "limite_gracia_larga": context.get("fecha_limite_gracia_larga") or "",
            "presente": due_date_present,
        },
        "referencia_pago": context.get("referencia_pago") or "",
        "bloqueantes": blockers,
        "listo_para_envio": not blockers,
    }


def build_recent_collection_contact_index(
    *,
    client_ids: set[int],
    cooldown: timedelta,
    reference_datetime=None,
) -> dict[int, HistorialEnvio]:
    if not client_ids or cooldown.total_seconds() <= 0:
        return {}

    now = reference_datetime or timezone.now()
    cutoff = now - cooldown
    recent_by_client: dict[int, HistorialEnvio] = {}
    for history in (
        HistorialEnvio.objects.filter(
            cliente_relacionado_id__in=client_ids,
            canal__in=OUTBOUND_USAGE_CHANNELS.keys(),
            estatus__in=SUCCESSFUL_OUTBOUND_STATUSES,
            fecha_envio__gte=cutoff,
        )
        .select_related("plantilla_usada")
        .order_by("-fecha_envio", "-id")
    ):
        if is_collection_cooldown_exempt_history(history):
            continue
        recent_by_client.setdefault(history.cliente_relacionado_id, history)
    return recent_by_client


def build_cooldown_metadata(
    *,
    item: dict,
    recent_history: HistorialEnvio,
    cooldown: timedelta,
) -> dict:
    unlock_at = recent_history.fecha_envio + cooldown
    return {
        "reason": COLLECTION_MESSAGE_COOLDOWN_REASON,
        "segmento": item["segmento"],
        "referencia_pago": item.get("referencia_pago"),
        "cxc_ids": item.get("cxc_ids") or [],
        "primary_cxc_id": item.get("primary_cxc_id"),
        "total_exigible": item.get("total_exigible"),
        "last_history_id": recent_history.id,
        "last_channel": recent_history.canal,
        "last_send_type": recent_history.tipo_envio,
        "last_status": recent_history.estatus,
        "last_sent_at": recent_history.fecha_envio.isoformat(),
        "cooldown_hours": cooldown.total_seconds() / 3600,
        "available_after": unlock_at.isoformat(),
    }


def consume_outbound_usage_limit(limits: dict[str, dict], channel: str) -> dict | None:
    limit = limits.get(channel)
    if not limit:
        return None
    limit["usado"] = int(limit.get("usado") or 0) + 1
    limit["restante"] = max(int(limit.get("incluido") or 0) - limit["usado"], 0)
    return limit


def get_outbound_retry_config() -> tuple[int, float]:
    attempts = max(int(getattr(settings, "OUTBOUND_SEND_MAX_ATTEMPTS", 3) or 1), 1)
    base_seconds = max(
        float(getattr(settings, "OUTBOUND_SEND_RETRY_BASE_SECONDS", 0.5) or 0),
        0,
    )
    return attempts, base_seconds


def is_transient_outbound_error(exc: Exception) -> bool:
    if isinstance(exc, TransientOutboundError):
        return True
    if isinstance(exc, requests.RequestException):
        return True
    text = str(exc)
    status_match = re.search(r"\((\d{3})\)", text)
    if not status_match:
        return False
    status_code = int(status_match.group(1))
    return status_code == 429 or status_code >= 500


def execute_with_outbound_retries(send_callable):
    max_attempts, base_seconds = get_outbound_retry_config()
    last_exc: Exception | None = None
    for attempt in range(1, max_attempts + 1):
        try:
            response = send_callable()
            return response, attempt
        except Exception as exc:  # pragma: no cover - defensive provider retry wrapper
            last_exc = exc
            if attempt >= max_attempts or not is_transient_outbound_error(exc):
                setattr(exc, "outbound_attempts", attempt)
                raise
            if base_seconds:
                time.sleep(base_seconds * (2 ** (attempt - 1)))
    if last_exc:
        raise last_exc
    raise RuntimeError("No se pudo ejecutar el envio saliente.")


def client_display_name(cliente: Cliente) -> str:
    return cliente.nombre_comercial or cliente.razon_social or f"Cliente {cliente.id}"


def build_reference_label(cliente: Cliente) -> str:
    capa = getattr(getattr(cliente, "entidad_relacionada", None), "capa_negocio", None)
    prefix = (getattr(capa, "referencia_transferencia_prefijo", "") or "BETT").strip().upper()
    suffix = (cliente.identificador or f"{cliente.id:05d}").strip().upper()
    return f"{prefix}-{suffix}"


def build_whatsapp_chat_id(cliente: Cliente) -> str | None:
    digits = re.sub(r"\D", "", f"{cliente.codigo_pais or '+52'}{cliente.telefono or ''}")
    if not digits:
        return None
    if digits.startswith("52") and not digits.startswith("521"):
        digits = f"521{digits[2:]}"
    return f"{digits}@c.us"


def normalize_whatsapp_destination(value: str | None) -> str:
    digits = re.sub(r"\D", "", value or "")
    if digits.startswith("521") and len(digits) > 12:
        return f"52{digits[3:]}"
    return digits


def get_whatsapp_outbound_allowed_numbers() -> set[str]:
    return {
        normalized
        for raw_value in getattr(settings, "OUTBOUND_WHATSAPP_ALLOWED_NUMBERS", [])
        if (normalized := normalize_whatsapp_destination(str(raw_value)))
    }


def is_whatsapp_destination_allowed(destination: str | None) -> bool:
    allowed_numbers = get_whatsapp_outbound_allowed_numbers()
    if not allowed_numbers:
        return True
    return normalize_whatsapp_destination(destination) in allowed_numbers


def resolve_whatsapp_channel_for_cliente(cliente: Cliente) -> CanalWhatsappOficial | None:
    entidad = getattr(cliente, "entidad_relacionada", None)
    capa = getattr(entidad, "capa_negocio", None) if entidad else None
    if capa is None:
        return None

    queryset = CanalWhatsappOficial.objects.filter(
        capa_negocio=capa,
        activo=True,
        puede_enviar=True,
    ).order_by("-es_principal", "id")

    if entidad:
        entity_match = queryset.filter(entidad_relacionada=entidad).first()
        if entity_match:
            return entity_match

    return queryset.first()


def has_whatsapp_provider_for_config(config: ConfiguracionComunicacion) -> bool:
    if getattr(settings, "DISABLE_OUTBOUND_INTEGRATIONS", False):
        return True
    capa_id = config.capa_negocio_id
    if capa_id:
        has_official_channel = CanalWhatsappOficial.objects.filter(
            capa_negocio_id=capa_id,
            activo=True,
            puede_enviar=True,
            phone_number_id__isnull=False,
            access_token__isnull=False,
        ).exclude(phone_number_id="").exclude(access_token="").exists()
        if has_official_channel:
            return True
    return bool((config.green_api_instance_id or "").strip() and (config.green_api_token or "").strip())


def build_whatsapp_automation_readiness(
    *,
    config: ConfiguracionComunicacion,
    allowed_entity_ids: list[int] | None = None,
) -> dict:
    rules = (
        ReglaAutomatizacionMensaje.objects.select_related(
            "plantilla_relacionada",
            "entidad_relacionada",
        )
        .filter(
            configuracion_relacionada=config,
            activo=True,
            canal__in=["WHATSAPP", "AMBOS"],
            plantilla_relacionada__activo=True,
        )
        .order_by("nombre", "id")
    )
    if allowed_entity_ids is not None:
        rules = rules.filter(
            Q(entidad_relacionada__isnull=True) | Q(entidad_relacionada_id__in=allowed_entity_ids)
        )

    issues: list[dict] = []
    rule_count = 0
    for rule in rules:
        rule_count += 1
        template = rule.plantilla_relacionada
        template_name = (template.whatsapp_template_name or "").strip()
        template_status = (template.whatsapp_template_status or "").strip()
        if not template_name:
            issues.append(
                {
                    "type": "TEMPLATE_NAME_MISSING",
                    "rule_id": rule.id,
                    "rule_name": rule.nombre,
                    "template_id": template.id,
                    "template_name": template.nombre,
                    "detail": "La regla usa WhatsApp pero la plantilla no tiene nombre Meta configurado.",
                }
            )
        if template_status != "APROBADA":
            issues.append(
                {
                    "type": "TEMPLATE_NOT_APPROVED",
                    "rule_id": rule.id,
                    "rule_name": rule.nombre,
                    "template_id": template.id,
                    "template_name": template.nombre,
                    "template_status": template_status or "NO_CONFIGURADA",
                    "detail": "La regla usa WhatsApp pero la plantilla Meta no esta APROBADA.",
                }
            )

    provider_ready = has_whatsapp_provider_for_config(config)
    if rule_count and not provider_ready:
        issues.append(
            {
                "type": "PROVIDER_NOT_CONFIGURED",
                "detail": "Hay reglas WhatsApp activas, pero no hay canal oficial Meta ni Green API listo para envio.",
            }
        )
    agreement_ready = has_whatsapp_shared_number_agreement(config.capa_negocio)
    if rule_count and not agreement_ready:
        issues.append(
            {
                "type": "LEGAL_AGREEMENT_MISSING",
                "detail": (
                    "Falta aceptar el acuerdo de uso de comunicaciones y "
                    "cobranza por WhatsApp para esta capa."
                ),
            }
        )

    return {
        "ok": not issues,
        "active_whatsapp_rules": rule_count,
        "provider_ready": provider_ready,
        "legal_agreement_ready": agreement_ready,
        "issues": issues,
    }


def build_portal_token(*, cliente: Cliente, horas: int) -> str:
    payload = {
        "cliente_id": cliente.id,
        "entidad_id": cliente.entidad_relacionada_id,
        "capa_id": getattr(cliente.entidad_relacionada, "capa_negocio_id", None),
        "email": (cliente.correo_principal or "").strip().lower(),
    }
    return signing.dumps(payload, salt=PORTAL_CLIENTE_SALT, compress=False)


def decode_portal_token(token: str, *, horas: int) -> dict:
    try:
        return signing.loads(token, salt=PORTAL_CLIENTE_SALT, max_age=max(horas, 1) * 3600)
    except signing.BadSignature as exc:
        raise HttpError(400, "El enlace del portal ya no es valido.") from exc


def build_portal_url(*, cliente: Cliente, config: ConfiguracionComunicacion) -> str:
    capa = getattr(getattr(cliente, "entidad_relacionada", None), "capa_negocio", None)
    portal_base = (
        getattr(capa, "portal_clientes_url_base", None)
        or getattr(settings, "FRONTEND_BASE_URL", None)
        or platform_app_base_url()
    )
    portal_base = normalize_platform_app_base_url(str(portal_base))
    token = build_portal_token(
        cliente=cliente,
        horas=max(config.portal_token_horas or 168, 1),
    )
    return f"{portal_base.rstrip('/')}/portal-cliente/{token}"


def render_template(content: str | None, context: dict[str, object]) -> str:
    template = content or ""

    def replace(match: re.Match[str]) -> str:
        key = match.group(1)
        value = context.get(key, "")
        if value is None:
            return ""
        return str(value)

    return TOKEN_PATTERN.sub(replace, template).strip()


def resolve_recipient_channels(
    canal: str,
    cliente: Cliente,
    *,
    config: ConfiguracionComunicacion | None = None,
) -> list[tuple[str, str]]:
    recipients: list[tuple[str, str]] = []
    normalized = (canal or "WHATSAPP").strip().upper()
    if normalized in {"WHATSAPP", "AMBOS"}:
        chat_id = build_whatsapp_chat_id(cliente)
        if chat_id:
            recipients.append(("WHATSAPP", chat_id))
    email_enabled = True if config is None else bool(config.email_activo)
    if normalized in {"EMAIL", "AMBOS"} and email_enabled:
        email = (cliente.correo_principal or "").strip().lower()
        if email:
            recipients.append(("EMAIL", email))
    return recipients


def format_money(value: Decimal | float | int) -> str:
    amount = Decimal(str(value or 0))
    return f"${amount:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def format_percentage(value: Decimal | float | int) -> str:
    amount = Decimal(str(value or 0)).quantize(Decimal("0.01"))
    text = f"{amount:.2f}".rstrip("0").rstrip(".").replace(".", ",")
    return f"{text}%"


def format_date(value: date | datetime | None) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime):
        value = value.date()
    return value.strftime("%d/%m/%Y")


def format_month_year_es(value: date | datetime | None) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime):
        value = value.date()
    return f"{MONTH_NAMES_ES[value.month]} {value.year}"


def format_long_date_es(value: date | datetime | None) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime):
        value = value.date()
    return f"{value.day} de {MONTH_NAMES_ES[value.month]} del {value.year}"


def build_recargo_description(rows: list[dict], recargos: Decimal) -> str:
    rates = sorted(
        {
            Decimal(str(item.get("interes_porcentaje") or 0))
            for item in rows
            if Decimal(str(item.get("interes_porcentaje") or 0)) > 0
        }
    )
    if len(rates) == 1:
        return f"{format_percentage(rates[0])} sobre saldo vencido"
    if len(rates) > 1:
        return "Porcentajes variables sobre saldo vencido"
    if recargos > 0:
        return "Cargo moratorio fijo o ajuste"
    return "Sin cargos moratorios"


def build_candidate_context(
    *,
    cliente: Cliente,
    rows: list[dict],
    config: ConfiguracionComunicacion,
    reference_date: date,
) -> dict[str, object]:
    ordered_rows = sorted(
        rows,
        key=lambda item: (
            item.get("fecha_vencimiento") or date.max,
            int(item.get("id") or 0),
        ),
    )
    principal = ordered_rows[0] if ordered_rows else None
    entidad = getattr(cliente, "entidad_relacionada", None)
    capa = getattr(entidad, "capa_negocio", None) if entidad else None
    saldo_vivo = sum(Decimal(str(item.get("monto_base") or 0)) for item in ordered_rows)
    recargos = sum(Decimal(str(item.get("interes_monto") or 0)) for item in ordered_rows)
    total_exigible = sum(Decimal(str(item.get("total_a_pagar") or 0)) for item in ordered_rows)
    concepto = (principal.get("concepto") if principal else None) or "Sin concepto"
    periodo = ""
    periodo_pago = ""
    if principal:
        inicio = principal.get("fecha_periodo_inicio")
        fin = principal.get("fecha_periodo_fin")
        if inicio and fin:
            periodo = f"{format_date(inicio)} al {format_date(fin)}"
        elif principal.get("fecha_vencimiento"):
            periodo = format_date(principal["fecha_vencimiento"])
        periodo_pago = format_month_year_es(
            inicio or principal.get("fecha_vencimiento")
        )

    portal_url = build_portal_url(cliente=cliente, config=config)
    fecha_vencimiento = principal.get("fecha_vencimiento") if principal else None
    fecha_limite_gracia = principal.get("fecha_limite_gracia") if principal else None
    return {
        "cliente_id": cliente.id,
        "cliente_nombre": client_display_name(cliente),
        "cliente_rfc": cliente.rfc or "",
        "cliente_identificador": cliente.identificador or "",
        "cliente_email": cliente.correo_principal or "",
        "cliente_telefono": cliente.telefono or "",
        "entidad_nombre": getattr(entidad, "nombre_comercial", "") if entidad else "",
        "capa_negocio": capa.nombre if capa else "",
        "espacio_codigo": principal.get("espacio_codigo") if principal else "",
        "concepto": concepto,
        "periodo": periodo,
        "periodo_pago": periodo_pago,
        "fecha_vencimiento": format_date(fecha_vencimiento),
        "fecha_vencimiento_larga": format_long_date_es(fecha_vencimiento),
        "fecha_limite_gracia": format_date(fecha_limite_gracia),
        "fecha_limite_gracia_larga": format_long_date_es(fecha_limite_gracia),
        "dias_gracia": principal.get("dias_gracia") if principal else 0,
        "dias_atraso": principal.get("dias_atraso") if principal else 0,
        "dias_atraso_post_gracia": principal.get("dias_atraso_post_gracia") if principal else 0,
        "saldo_vivo": decimal_to_float(saldo_vivo),
        "saldo_vivo_formato": format_money(saldo_vivo),
        "recargo_total": decimal_to_float(recargos),
        "recargo_total_formato": format_money(recargos),
        "recargo_descripcion": build_recargo_description(ordered_rows, recargos),
        "total_exigible": decimal_to_float(total_exigible),
        "total_exigible_formato": format_money(total_exigible),
        "cuentas_abiertas": len(ordered_rows),
        "portal_url": portal_url,
        "referencia_pago": build_reference_label(cliente),
        "banco_transferencia": getattr(capa, "banco_transferencias", "") or "",
        "clabe_transferencia": getattr(capa, "clabe_transferencias", "") or "",
        "beneficiario_transferencia": getattr(capa, "beneficiario_transferencias", "") or "",
        "fecha_referencia": format_date(reference_date),
        "facturacion_activa": bool(getattr(capa, "facturacion_activa", False)),
    }


def matches_segment(*, segment: str, row: dict) -> bool:
    categoria = row.get("categoria_tablero")
    if segment == "TODOS_ACTIVOS":
        return True
    if segment == "CXC_ABIERTA":
        return categoria in {"POR_VENCER", "EN_GRACIA", "VENCIDA_CON_RECARGO"}
    return categoria == segment


def resolve_collection_message_stage(
    *,
    template: PlantillaMensaje | None,
    segment: str,
    rule: ReglaAutomatizacionMensaje | None = None,
) -> str | None:
    source = " ".join(
        str(item or "")
        for item in [
            getattr(template, "whatsapp_template_name", ""),
            getattr(template, "nombre", ""),
            getattr(template, "tipo_plantilla", ""),
            getattr(rule, "nombre", ""),
        ]
    ).lower()
    if "recibid" in source or "parcial" in source or "acuse" in source:
        return None
    if "prevent" in source or "anticip" in source:
        return COLLECTION_STAGE_PREVENTIVE
    if "vence_hoy" in source or "vence hoy" in source or "dia de vencimiento" in source:
        return COLLECTION_STAGE_DUE_TODAY
    if "gracia" in source:
        return COLLECTION_STAGE_GRACE
    if "atras" in source or "recargo" in source or "bloque" in source or "moratori" in source:
        return COLLECTION_STAGE_OVERDUE
    if segment == "POR_VENCER":
        if rule and rule.desplazamiento_dias == 0:
            return COLLECTION_STAGE_DUE_TODAY
        return COLLECTION_STAGE_PREVENTIVE
    if segment == "EN_GRACIA":
        return COLLECTION_STAGE_GRACE
    if segment == "VENCIDA_CON_RECARGO":
        return COLLECTION_STAGE_OVERDUE
    return None


def collection_row_matches_stage(
    *,
    row: dict,
    stage: str | None,
    reference_date: date,
) -> bool:
    if not stage:
        return True
    due_date = row.get("fecha_vencimiento")
    grace_limit = row.get("fecha_limite_gracia") or due_date
    if not isinstance(due_date, date):
        return False
    if not isinstance(grace_limit, date):
        grace_limit = due_date
    if stage == COLLECTION_STAGE_PREVENTIVE:
        return reference_date < due_date
    if stage == COLLECTION_STAGE_DUE_TODAY:
        return reference_date == due_date
    if stage == COLLECTION_STAGE_GRACE:
        return due_date < reference_date <= grace_limit
    if stage == COLLECTION_STAGE_OVERDUE:
        return reference_date > grace_limit
    return True


def filter_candidate_by_collection_stage(
    *,
    candidate: dict,
    stage: str | None,
    config: ConfiguracionComunicacion,
    reference_date: date,
) -> dict | None:
    if not stage:
        return candidate
    rows = candidate.get("rows") or []
    allowed_rows = [
        row
        for row in rows
        if collection_row_matches_stage(
            row=row,
            stage=stage,
            reference_date=reference_date,
        )
    ]
    if not allowed_rows:
        return None
    cliente: Cliente = candidate["cliente"]
    filtered = dict(candidate)
    filtered["rows"] = allowed_rows
    filtered["primary_row"] = allowed_rows[0]
    filtered["context"] = build_candidate_context(
        cliente=cliente,
        rows=allowed_rows,
        config=config,
        reference_date=reference_date,
    )
    return filtered


def materialize_entities(entity_ids: list[int], reference_date: date) -> None:
    """Sin generacion automatica de cargos: la cartera POS se crea desde la venta."""
    return None


def resolve_materialization_entity_ids(
    *,
    allowed_entity_ids: list[int] | None,
    entity_id: int | None,
    client_ids: list[int] | None,
) -> list[int]:
    if entity_id:
        if allowed_entity_ids is not None and entity_id not in allowed_entity_ids:
            return []
        return [entity_id]

    if client_ids:
        queryset = Cliente.objects.filter(id__in=client_ids, entidad_relacionada_id__isnull=False)
        if allowed_entity_ids is not None:
            queryset = queryset.filter(entidad_relacionada_id__in=allowed_entity_ids)
        return list(
            queryset.values_list("entidad_relacionada_id", flat=True).distinct()
        )

    return list(allowed_entity_ids or [])


def build_campaign_candidates(
    *,
    config: ConfiguracionComunicacion,
    allowed_entity_ids: list[int] | None,
    entity_id: int | None,
    client_ids: list[int] | None,
    segment: str,
    channel: str,
    reference_date: date,
    materialize: bool = True,
) -> list[dict]:
    if materialize:
        materialize_entities(
            resolve_materialization_entity_ids(
                allowed_entity_ids=allowed_entity_ids,
                entity_id=entity_id,
                client_ids=client_ids,
            ),
            reference_date,
        )

    client_queryset = Cliente.objects.select_related(
        "entidad_relacionada",
        "entidad_relacionada__capa_negocio",
    ).filter(activo=True)
    if allowed_entity_ids is not None:
        client_queryset = client_queryset.filter(entidad_relacionada_id__in=allowed_entity_ids)
    if entity_id:
        client_queryset = client_queryset.filter(entidad_relacionada_id=entity_id)
    if client_ids:
        client_queryset = client_queryset.filter(id__in=client_ids)

    if segment == "TODOS_ACTIVOS":
        rows_by_client: dict[int, list[dict]] = defaultdict(list)
        candidates = []
        for cliente in client_queryset.order_by("razon_social", "nombre_comercial", "id"):
            context = build_candidate_context(
                cliente=cliente,
                rows=rows_by_client.get(cliente.id, []),
                config=config,
                reference_date=reference_date,
            )
            channels = resolve_recipient_channels(channel, cliente, config=config)
            candidates.append(
                {
                    "cliente": cliente,
                    "rows": rows_by_client.get(cliente.id, []),
                    "context": context,
                    "channels": channels,
                    "primary_row": None,
                }
            )
        return candidates

    account_queryset = (
        CuentaPorCobrar.objects.select_related(
            "cliente_relacionado",
            "cliente_relacionado__entidad_relacionada",
            "cliente_relacionado__entidad_relacionada__capa_negocio",
            "entidad_relacionada",
            "entidad_relacionada__capa_negocio",
        )
        .filter(monto_total__gt=F("monto_pagado"))
        .exclude(estatus_adeudo__in=["CANCELADO", "INCOBRABLE"])
        .order_by("fecha_vencimiento", "id")
    )
    if allowed_entity_ids is not None:
        account_queryset = account_queryset.filter(
            Q(entidad_relacionada_id__in=allowed_entity_ids)
            | Q(
                entidad_relacionada__isnull=True,
                cliente_relacionado__entidad_relacionada_id__in=allowed_entity_ids,
            )
        )
    if entity_id:
        account_queryset = account_queryset.filter(
            Q(entidad_relacionada_id=entity_id)
            | Q(
                entidad_relacionada__isnull=True,
                cliente_relacionado__entidad_relacionada_id=entity_id,
            )
        )
    if client_ids:
        account_queryset = account_queryset.filter(cliente_relacionado_id__in=client_ids)

    rows_by_client: dict[int, list[dict]] = defaultdict(list)
    primary_row_by_client: dict[int, dict] = {}

    accounts = list(account_queryset)
    entity_map = {}
    for cuenta in accounts:
        entidad = cuenta.entidad_relacionada or cuenta.cliente_relacionado.entidad_relacionada
        if entidad and entidad.id:
            entity_map[entidad.id] = entidad

    interest_contexts = resolve_interest_rules_for_entities(list(entity_map.values()))

    for cuenta in accounts:
        entidad = cuenta.entidad_relacionada or cuenta.cliente_relacionado.entidad_relacionada
        interest_context = interest_contexts.get(entidad.id) if entidad else None
        if interest_context is None:
            interest_context = default_interest_context()
        row = build_cxc_row(
            cuenta,
            today=reference_date,
            interest_context=interest_context,
            include_invoice=False,
        )
        if not matches_segment(segment=segment, row=row):
            continue
        rows_by_client[cuenta.cliente_relacionado_id].append(row)
        primary_row_by_client.setdefault(cuenta.cliente_relacionado_id, row)

    candidates: list[dict] = []
    if not rows_by_client:
        return candidates

    client_map = {
        cliente.id: cliente
        for cliente in client_queryset.filter(id__in=rows_by_client.keys()).order_by(
            "razon_social", "nombre_comercial", "id"
        )
    }
    for cliente_id, rows in rows_by_client.items():
        cliente = client_map.get(cliente_id)
        if not cliente:
            continue
        channels = resolve_recipient_channels(channel, cliente, config=config)
        context = build_candidate_context(
            cliente=cliente,
            rows=rows,
            config=config,
            reference_date=reference_date,
        )
        candidates.append(
            {
                "cliente": cliente,
                "rows": rows,
                "context": context,
                "channels": channels,
                "primary_row": primary_row_by_client.get(cliente_id),
            }
        )
    return candidates


def build_default_subject(segment: str, context: dict[str, object]) -> str:
    entity = str(context.get("entidad_nombre") or "tu entidad")
    if segment == "POR_VENCER":
        return f"Recordatorio de pago | {entity}"
    if segment == "EN_GRACIA":
        return f"Pago pendiente en gracia | {entity}"
    if segment == "VENCIDA_CON_RECARGO":
        return f"Aviso de recargo activo | {entity}"
    return f"Actualizacion de cuenta | {entity}"


def build_default_body(segment: str) -> str:
    if segment == "POR_VENCER":
        return (
            "Hola {{cliente_nombre}},\n\n"
            "Te recordamos que tu cargo de {{concepto}} para {{entidad_nombre}} vence el {{fecha_vencimiento}}.\n"
            "Saldo pendiente: {{saldo_vivo_formato}}.\n"
            "Puedes revisar tu estado de cuenta aqui: {{portal_url}}\n"
            "Referencia sugerida: {{referencia_pago}}."
        )
    if segment == "EN_GRACIA":
        return (
            "Hola {{cliente_nombre}},\n\n"
            "Tu cuenta de {{entidad_nombre}} ya entro en dias de gracia.\n"
            "Saldo pendiente: {{saldo_vivo_formato}}.\n"
            "Fecha limite de gracia: {{fecha_limite_gracia}}.\n"
            "Consulta el detalle aqui: {{portal_url}}"
        )
    if segment == "VENCIDA_CON_RECARGO":
        return (
            "Hola {{cliente_nombre}},\n\n"
            "Tu cuenta en {{entidad_nombre}} ya refleja recargo activo.\n"
            "Saldo base: {{saldo_vivo_formato}}.\n"
            "Recargo actual: {{recargo_total_formato}}.\n"
            "Total exigible: {{total_exigible_formato}}.\n"
            "Estado de cuenta: {{portal_url}}"
        )
    return (
        "Hola {{cliente_nombre}},\n\n"
        "Te compartimos una actualizacion de tu cuenta con {{entidad_nombre}}.\n"
        "Puedes revisarla aqui: {{portal_url}}"
    )


def resolve_template_payload(
    *,
    template: PlantillaMensaje | None,
    channel: str,
    segment: str,
    subject_override: str,
    body_override: str,
    include_portal: bool,
    media_url: str,
) -> dict[str, object]:
    body = body_override.strip() or (template.cuerpo if template else "") or build_default_body(segment)
    subject = subject_override.strip() or (template.asunto if template else "") or ""
    include_link = include_portal
    resolved_media = media_url.strip() or (template.url_media if template else "") or None
    return {
        "body": body,
        "subject": subject,
        "include_link": include_link,
        "media_url": resolved_media,
        "channel": channel,
        "tipo_plantilla": (template.tipo_plantilla if template else "") or "",
        "whatsapp_template_name": (template.whatsapp_template_name if template else "") or "",
        "whatsapp_template_language": (
            template.whatsapp_template_language if template else ""
        )
        or "es_MX",
        "whatsapp_template_status": (
            template.whatsapp_template_status if template else ""
        )
        or "NO_CONFIGURADA",
    }


def build_preview_item_from_candidate(
    *,
    candidate: dict,
    template_payload: dict[str, object],
    segment: str,
) -> dict:
    cliente: Cliente = candidate["cliente"]
    context = dict(candidate["context"])
    if not template_payload["include_link"]:
        context["portal_url"] = ""
    subject_template = str(template_payload["subject"] or "")
    if not subject_template.strip():
        subject_template = build_default_subject(segment, context)
    rendered_subject = render_template(subject_template, context)
    body_template = str(template_payload["body"])
    rendered_body = render_template(body_template, context)
    whatsapp_template_status = str(template_payload.get("whatsapp_template_status") or "")
    whatsapp_template_name = str(template_payload.get("whatsapp_template_name") or "")
    whatsapp_template_language = str(template_payload.get("whatsapp_template_language") or "es_MX")
    whatsapp_parameters = [
        str(context.get(match.group(1), "") or "")
        for match in TOKEN_PATTERN.finditer(body_template)
    ]
    channel_pairs = list(candidate["channels"])
    channels = [item[0] for item in channel_pairs]
    rows = candidate.get("rows") or []
    cxc_ids = [row["id"] for row in rows if row.get("id")]
    primary_row = candidate.get("primary_row") or (rows[0] if rows else None)
    return {
        "cliente_id": cliente.id,
        "cliente_nombre": client_display_name(cliente),
        "entidad_nombre": context["entidad_nombre"],
        "segmento": segment,
        "canales": channels,
        "destinos": [item[1] for item in channel_pairs],
        "asunto": rendered_subject,
        "mensaje": rendered_body,
        "url_media": template_payload["media_url"],
        "portal_url": context["portal_url"],
        "referencia_pago": context["referencia_pago"],
        "whatsapp_template_name": whatsapp_template_name,
        "whatsapp_template_language": whatsapp_template_language or "es_MX",
        "whatsapp_template_status": whatsapp_template_status,
        "whatsapp_template_parameters": whatsapp_parameters,
        "saldo_vivo": context["saldo_vivo"],
        "recargo_total": context["recargo_total"],
        "total_exigible": context["total_exigible"],
        "cuentas_abiertas": context["cuentas_abiertas"],
        "cxc_ids": cxc_ids,
        "primary_cxc_id": primary_row.get("id") if primary_row else None,
        "fecha_vencimiento": context["fecha_vencimiento"],
        "fecha_limite_gracia": context["fecha_limite_gracia"],
        "validacion_contacto": build_preview_contact_validation(
            cliente=cliente,
            channels=channel_pairs,
            template_payload=template_payload,
        ),
        "validacion_cobranza": build_preview_billing_validation(
            candidate=candidate,
            context=context,
            template_payload=template_payload,
            segment=segment,
        ),
    }


def build_preview_items(
    *,
    config: ConfiguracionComunicacion,
    template: PlantillaMensaje | None,
    allowed_entity_ids: list[int] | None,
    entity_id: int | None,
    client_ids: list[int] | None,
    segment: str,
    channel: str,
    subject_override: str,
    body_override: str,
    include_portal: bool,
    media_url: str,
    reference_date: date,
) -> list[dict]:
    template_payload = resolve_template_payload(
        template=template,
        channel=channel,
        segment=segment,
        subject_override=subject_override,
        body_override=body_override,
        include_portal=include_portal,
        media_url=media_url,
    )
    candidates = build_campaign_candidates(
        config=config,
        allowed_entity_ids=allowed_entity_ids,
        entity_id=entity_id,
        client_ids=client_ids,
        segment=segment,
        channel=channel,
        reference_date=reference_date,
    )

    collection_stage = resolve_collection_message_stage(
        template=template,
        segment=segment,
    )
    preview_items: list[dict] = []
    for candidate in candidates:
        candidate = filter_candidate_by_collection_stage(
            candidate=candidate,
            stage=collection_stage,
            config=config,
            reference_date=reference_date,
        )
        if not candidate:
            continue
        preview_items.append(
            build_preview_item_from_candidate(
                candidate=candidate,
                template_payload=template_payload,
                segment=segment,
            )
        )
    return preview_items


def send_whatsapp_message(
    *,
    config: ConfiguracionComunicacion,
    cliente: Cliente,
    chat_id: str,
    message: str,
    media_url: str | None = None,
    template_name: str | None = None,
    template_language: str | None = None,
    template_parameters: list[str] | None = None,
    template_button_parameters: list[str] | None = None,
    interactive_button_text: str | None = None,
    interactive_url: str | None = None,
    interactive_reply_buttons: list[dict[str, str]] | None = None,
    enforce_allowed_numbers: bool = True,
) -> dict:
    if getattr(settings, "DISABLE_OUTBOUND_INTEGRATIONS", False):
        return {
            "provider": "DEMO_MODE",
            "messages": [{"id": f"demo-whatsapp-{timezone.now().timestamp()}"}],
            "contacts": [{"input": chat_id, "wa_id": normalize_whatsapp_destination(chat_id)}],
            "meta": {
                "simulado": True,
                "canal": "WHATSAPP",
                "media_url": media_url,
            },
        }

    if enforce_allowed_numbers and not is_whatsapp_destination_allowed(chat_id):
        raise ValueError(
            "Destino WhatsApp bloqueado por OUTBOUND_WHATSAPP_ALLOWED_NUMBERS."
        )

    official_channel = resolve_whatsapp_channel_for_cliente(cliente)
    if official_channel and official_channel.phone_number_id and official_channel.access_token:
        destination = normalize_whatsapp_destination(chat_id)
        if not destination:
            raise ValueError("No se pudo resolver el numero destino para WhatsApp.")

        endpoint = (
            f"{settings.WHATSAPP_CLOUD_API_BASE_URL.rstrip('/')}/"
            f"{settings.WHATSAPP_CLOUD_API_VERSION.strip('/')}/"
            f"{official_channel.phone_number_id}/messages"
        )
        headers = {
            "Authorization": f"Bearer {(official_channel.access_token or '').strip()}",
            "Content-Type": "application/json",
        }
        payload: dict[str, object] = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": destination,
        }
        if template_name:
            payload["type"] = "template"
            template_payload: dict[str, object] = {
                "name": template_name,
                "language": {"code": template_language or "es_MX"},
            }
            parameters = [
                {"type": "text", "text": str(value)}
                for value in (template_parameters or [])
            ]
            button_parameters = [
                {"type": "text", "text": str(value)}
                for value in (template_button_parameters or [])
            ]
            components: list[dict[str, object]] = []
            if parameters:
                components.append(
                    {
                        "type": "body",
                        "parameters": parameters,
                    }
                )
            if button_parameters:
                components.append(
                    {
                        "type": "button",
                        "sub_type": "url",
                        "index": "0",
                        "parameters": button_parameters,
                    }
                )
            if components:
                template_payload["components"] = components
            payload["template"] = template_payload
        elif media_url:
            parsed = urlparse(media_url)
            path = parsed.path.lower()
            media_type = "image"
            media_payload_key = "image"
            if path.endswith(".pdf") or path.endswith(".doc") or path.endswith(".docx"):
                media_type = "document"
                media_payload_key = "document"
            payload["type"] = media_type
            payload[media_payload_key] = {
                "link": media_url,
                "caption": message,
            }
        elif interactive_url:
            payload["type"] = "interactive"
            payload["interactive"] = {
                "type": "cta_url",
                "body": {"text": message},
                "action": {
                    "name": "cta_url",
                    "parameters": {
                        "display_text": (interactive_button_text or "Abrir portal")[:20],
                        "url": interactive_url,
                    },
                },
            }
        elif interactive_reply_buttons:
            buttons: list[dict[str, object]] = []
            for index, button in enumerate(interactive_reply_buttons[:3], start=1):
                button_id = str(button.get("id") or f"reply_{index}")[:256]
                title = str(button.get("title") or button_id)[:20]
                buttons.append(
                    {
                        "type": "reply",
                        "reply": {
                            "id": button_id,
                            "title": title,
                        },
                    }
                )
            payload["type"] = "interactive"
            payload["interactive"] = {
                "type": "button",
                "body": {"text": message},
                "action": {"buttons": buttons},
            }
        else:
            payload["type"] = "text"
            payload["text"] = {
                "preview_url": False,
                "body": message,
            }

        try:
            response = requests.post(endpoint, headers=headers, json=payload, timeout=20)
        except requests.RequestException as exc:
            raise TransientOutboundError(
                f"WhatsApp Cloud API no respondio: {exc}"
            ) from exc
        if response.status_code == 429 or response.status_code >= 500:
            raise TransientOutboundError(
                "WhatsApp Cloud API rechazo temporalmente el envio "
                f"({response.status_code}): {response.text[:220]}"
            )
        if response.status_code >= 400:
            raise ValueError(
                "WhatsApp Cloud API rechazo el envio "
                f"({response.status_code}): {response.text[:220]}"
            )
        body = response.json()
        return {
            "provider": "META_CLOUD_API",
            "channel_id": official_channel.id,
            "channel_name": official_channel.nombre,
            "messages": body.get("messages") or [],
            "contacts": body.get("contacts") or [],
            "meta": body,
        }

    api_url = (config.green_api_api_url or DEFAULT_GREEN_API_URL).rstrip("/")
    instance_id = (config.green_api_instance_id or "").strip()
    token = (config.green_api_token or "").strip()
    if not instance_id or not token:
        raise ValueError(
            "No hay un canal oficial de WhatsApp configurado ni Green API disponible para respaldo."
        )

    if media_url:
        endpoint = f"{api_url}/waInstance{instance_id}/sendFileByUrl/{token}"
        parsed = urlparse(media_url)
        file_name = parsed.path.rsplit("/", 1)[-1] or "adjunto.jpg"
        payload = {
            "chatId": chat_id,
            "urlFile": media_url,
            "fileName": file_name,
            "caption": message,
        }
    else:
        endpoint = f"{api_url}/waInstance{instance_id}/sendMessage/{token}"
        if interactive_url and interactive_url not in message:
            message = f"{message}\n\n{interactive_url}"
        if interactive_reply_buttons:
            options = "\n".join(
                f"- {button.get('title') or button.get('id')}"
                for button in interactive_reply_buttons[:3]
            )
            if options:
                message = f"{message}\n\nOpciones:\n{options}"
        payload = {"chatId": chat_id, "message": message}

    try:
        response = requests.post(endpoint, json=payload, timeout=20)
    except requests.RequestException as exc:
        raise TransientOutboundError(f"Green API no respondio: {exc}") from exc
    if response.status_code == 429 or response.status_code >= 500:
        raise TransientOutboundError(
            f"Green API rechazo temporalmente el envio ({response.status_code}): "
            f"{response.text[:180]}"
        )
    if response.status_code >= 400:
        raise ValueError(
            f"Green API rechazo el envio ({response.status_code}): {response.text[:180]}"
        )
    return response.json()


def send_email_message(
    *,
    config: ConfiguracionComunicacion,
    destination: str,
    subject: str,
    message: str,
    media_url: str | None = None,
) -> dict:
    if not config.email_activo:
        raise ValueError("El canal de correo esta desactivado en configuracion.")
    if getattr(settings, "DISABLE_OUTBOUND_INTEGRATIONS", False):
        return {
            "provider": "DEMO_MODE",
            "id": f"demo-email-{timezone.now().timestamp()}",
            "to": destination,
            "subject": subject,
            "simulado": True,
        }
    try:
        return send_email_transport(
            destination=destination,
            subject=subject,
            message=message,
            media_url=media_url,
            sender_email=config.email_remitente or settings.DEFAULT_FROM_EMAIL,
            sender_name=config.email_remitente_nombre or None,
            reply_to=config.email_responder_a or None,
        )
    except requests.RequestException as exc:
        raise TransientOutboundError(f"Proveedor de correo no respondio: {exc}") from exc
    except ValueError as exc:
        if is_transient_outbound_error(exc):
            raise TransientOutboundError(str(exc)) from exc
        raise


def register_history(
    *,
    config: ConfiguracionComunicacion,
    cliente: Cliente,
    template: PlantillaMensaje | None,
    automation: ReglaAutomatizacionMensaje | None,
    channel: str,
    provider: str,
    destination: str,
    subject: str,
    body: str,
    media_url: str | None,
    status: str,
    reference: str | None,
    dedupe_key: str | None,
    metadata: dict | None,
    send_type: str,
) -> HistorialEnvio:
    return HistorialEnvio.objects.create(
        configuracion_relacionada=config,
        cliente_relacionado=cliente,
        entidad_relacionada=cliente.entidad_relacionada,
        plantilla_usada=template,
        automatizacion_relacionada=automation,
        canal=channel,
        tipo_envio=send_type,
        proveedor=provider,
        destinatario=destination,
        asunto=subject or None,
        cuerpo_renderizado=body or None,
        url_media=media_url or None,
        referencia_envio=reference,
        llave_idempotencia=dedupe_key,
        metadata=metadata or {},
        estatus=status,
    )


def dispatch_preview_items(
    *,
    config: ConfiguracionComunicacion,
    template: PlantillaMensaje | None,
    automation: ReglaAutomatizacionMensaje | None,
    preview_items: list[dict],
    send_type: str,
    dedupe_prefix: str | None = None,
    max_sends: int | None = None,
    enforce_usage_limits: bool = True,
) -> dict:
    sent = 0
    skipped = 0
    errors: list[str] = []
    uses_whatsapp = any(
        channel == "WHATSAPP"
        for item in preview_items
        for channel in item.get("canales", [])
    )
    if uses_whatsapp:
        require_whatsapp_shared_number_agreement_for_capa(config.capa_negocio)
    usage_limits = (
        build_outbound_usage_limits(config)
        if enforce_usage_limits and preview_items
        else {}
    )
    client_ids = {
        int(item["cliente_id"])
        for item in preview_items
        if item.get("cliente_id")
    }
    clients_by_id = Cliente.objects.select_related("entidad_relacionada").in_bulk(
        client_ids
    )
    dedupe_keys: set[str] = set()
    if dedupe_prefix:
        for item in preview_items:
            for channel, _destination in zip(item["canales"], item["destinos"]):
                dedupe_keys.add(
                    f"{dedupe_prefix}:cliente:{item['cliente_id']}:canal:{channel}"
                )
    existing_dedupe_keys = (
        set(
            HistorialEnvio.objects.filter(
                llave_idempotencia__in=dedupe_keys
            ).values_list("llave_idempotencia", flat=True)
        )
        if dedupe_keys
        else set()
    )
    cooldown = resolve_collection_message_cooldown()
    recent_contact_by_client = build_recent_collection_contact_index(
        client_ids=client_ids,
        cooldown=cooldown,
    )
    is_consent_invitation = is_collection_consent_invitation_template(template)

    for item in preview_items:
        cliente = clients_by_id.get(int(item["cliente_id"]))
        if cliente is None:
            skipped += 1
            errors.append(f"Cliente {item['cliente_id']} no encontrado.")
            continue
        channels = list(zip(item["canales"], item["destinos"]))
        if not channels:
            skipped += 1
            register_history(
                config=config,
                cliente=cliente,
                template=template,
                automation=automation,
                channel="WHATSAPP",
                provider="MANUAL",
                destination="sin-destino",
                subject=item["asunto"],
                body=item["mensaje"],
                media_url=item["url_media"],
                status="OMITIDO",
                reference=None,
                dedupe_key=None,
                metadata={"reason": "Sin canal de contacto"},
                send_type=send_type,
            )
            continue
        if getattr(cliente, "no_contactar_cobranza", False):
            skipped += 1
            first_channel, first_destination = channels[0]
            register_history(
                config=config,
                cliente=cliente,
                template=template,
                automation=automation,
                channel=first_channel,
                provider="CONTACT_POLICY",
                destination=first_destination,
                subject=item["asunto"],
                body=item["mensaje"],
                media_url=item["url_media"],
                status="OMITIDO",
                reference=None,
                dedupe_key=None,
                metadata={
                    "reason": COLLECTION_NO_CONTACT_REASON,
                    "motivo": cliente.no_contactar_cobranza_motivo,
                    "fecha_bloqueo": (
                        cliente.no_contactar_cobranza_fecha.isoformat()
                        if cliente.no_contactar_cobranza_fecha
                        else None
                    ),
                    "segmento": item["segmento"],
                    "referencia_pago": item.get("referencia_pago"),
                    "cxc_ids": item.get("cxc_ids") or [],
                    "primary_cxc_id": item.get("primary_cxc_id"),
                    "total_exigible": item.get("total_exigible"),
                },
                send_type=send_type,
            )
            continue

        for channel, destination in channels:
            if max_sends is not None and sent >= max_sends:
                skipped += 1
                register_history(
                    config=config,
                    cliente=cliente,
                    template=template,
                    automation=automation,
                    channel=channel,
                    provider="MANUAL",
                    destination=destination,
                    subject=item["asunto"],
                    body=item["mensaje"],
                    media_url=item["url_media"],
                    status="OMITIDO",
                    reference=None,
                    dedupe_key=None,
                    metadata={
                        "reason": "Limite maximo de envios por corrida alcanzado",
                        "segmento": item["segmento"],
                        "referencia_pago": item.get("referencia_pago"),
                        "cxc_ids": item.get("cxc_ids") or [],
                        "primary_cxc_id": item.get("primary_cxc_id"),
                        "total_exigible": item.get("total_exigible"),
                        "max_sends": max_sends,
                    },
                    send_type=send_type,
                )
                continue
            if (
                channel == "WHATSAPP"
                and collection_consent_required_for_whatsapp()
                and not is_consent_invitation
                and not cliente_has_current_collection_consent(cliente)
            ):
                skipped += 1
                register_history(
                    config=config,
                    cliente=cliente,
                    template=template,
                    automation=automation,
                    channel=channel,
                    provider="CONTACT_POLICY",
                    destination=destination,
                    subject=item["asunto"],
                    body=item["mensaje"],
                    media_url=item["url_media"],
                    status="OMITIDO",
                    reference=None,
                    dedupe_key=None,
                    metadata=build_collection_consent_metadata(
                        item=item,
                        cliente=cliente,
                    ),
                    send_type=send_type,
                )
                continue
            if channel == "WHATSAPP" and not is_whatsapp_destination_allowed(
                destination
            ):
                skipped += 1
                register_history(
                    config=config,
                    cliente=cliente,
                    template=template,
                    automation=automation,
                    channel=channel,
                    provider="SAFETY_ALLOWLIST",
                    destination=destination,
                    subject=item["asunto"],
                    body=item["mensaje"],
                    media_url=item["url_media"],
                    status="OMITIDO",
                    reference=None,
                    dedupe_key=None,
                    metadata={
                        "reason": "Destino WhatsApp fuera de allowlist",
                        "segmento": item["segmento"],
                        "referencia_pago": item.get("referencia_pago"),
                        "cxc_ids": item.get("cxc_ids") or [],
                        "primary_cxc_id": item.get("primary_cxc_id"),
                        "total_exigible": item.get("total_exigible"),
                        "allowed_numbers_configured": True,
                    },
                    send_type=send_type,
                )
                continue
            recent_history = (
                None if is_consent_invitation else recent_contact_by_client.get(cliente.id)
            )
            if recent_history is not None:
                skipped += 1
                register_history(
                    config=config,
                    cliente=cliente,
                    template=template,
                    automation=automation,
                    channel=channel,
                    provider="MANUAL",
                    destination=destination,
                    subject=item["asunto"],
                    body=item["mensaje"],
                    media_url=item["url_media"],
                    status="OMITIDO",
                    reference=None,
                    dedupe_key=None,
                    metadata=build_cooldown_metadata(
                        item=item,
                        recent_history=recent_history,
                        cooldown=cooldown,
                    ),
                    send_type=send_type,
                )
                continue
            dedupe_key = None
            if dedupe_prefix:
                dedupe_key = f"{dedupe_prefix}:cliente:{cliente.id}:canal:{channel}"
                if dedupe_key in existing_dedupe_keys:
                    skipped += 1
                    continue
            usage_limit = usage_limits.get(channel)
            if usage_limit and int(usage_limit.get("restante") or 0) <= 0:
                skipped += 1
                register_history(
                    config=config,
                    cliente=cliente,
                    template=template,
                    automation=automation,
                    channel=channel,
                    provider="MANUAL",
                    destination=destination,
                    subject=item["asunto"],
                    body=item["mensaje"],
                    media_url=item["url_media"],
                    status="OMITIDO",
                    reference=None,
                    dedupe_key=None,
                    metadata={
                        "reason": "Limite mensual de consumo alcanzado",
                        "segmento": item["segmento"],
                        "referencia_pago": item.get("referencia_pago"),
                        "cxc_ids": item.get("cxc_ids") or [],
                        "primary_cxc_id": item.get("primary_cxc_id"),
                        "total_exigible": item.get("total_exigible"),
                        "consumo_saas": serialize_outbound_usage_limit(usage_limit),
                    },
                    send_type=send_type,
                )
                continue
            try:
                attempts = 1
                if channel == "WHATSAPP":
                    template_name = str(item.get("whatsapp_template_name") or "").strip()
                    template_status = str(item.get("whatsapp_template_status") or "").strip()
                    approved_template_name = (
                        template_name if template_name and template_status == "APROBADA" else None
                    )
                    if send_type == "AUTOMATICO":
                        if not template_name or template_status != "APROBADA":
                            raise ValueError(
                                "Envio automatico omitido: WhatsApp requiere una plantilla "
                                "Meta aprobada para notificaciones fuera de la ventana de servicio."
                            )
                    response, attempts = execute_with_outbound_retries(
                        lambda: send_whatsapp_message(
                            config=config,
                            cliente=cliente,
                            chat_id=destination,
                            message=item["mensaje"],
                            media_url=item["url_media"],
                            template_name=approved_template_name,
                            template_language=str(
                                item.get("whatsapp_template_language") or "es_MX"
                            ),
                            template_parameters=item.get("whatsapp_template_parameters") or [],
                        )
                    )
                    provider = str(response.get("provider") or "META_CLOUD_API")
                    messages = response.get("messages") or []
                    first_message = messages[0] if messages else {}
                    reference = str(
                        first_message.get("id")
                        or response.get("idMessage")
                        or response.get("id")
                        or ""
                    )
                else:
                    response, attempts = execute_with_outbound_retries(
                        lambda: send_email_message(
                            config=config,
                            destination=destination,
                            subject=item["asunto"],
                            message=item["mensaje"],
                            media_url=item["url_media"],
                        )
                    )
                    provider = str(response.get("provider") or "SMTP")
                    reference = str(response.get("id") or response.get("status") or "sent")
                consumed_limit = consume_outbound_usage_limit(usage_limits, channel)
                history = register_history(
                    config=config,
                    cliente=cliente,
                    template=template,
                    automation=automation,
                    channel=channel,
                    provider=provider,
                    destination=destination,
                    subject=item["asunto"],
                    body=item["mensaje"],
                    media_url=item["url_media"],
                    status="ENVIADO",
                    reference=reference or None,
                    dedupe_key=dedupe_key,
                    metadata={
                        "segmento": item["segmento"],
                        "portal_url": item["portal_url"],
                        "referencia_pago": item.get("referencia_pago"),
                        "cxc_ids": item.get("cxc_ids") or [],
                        "primary_cxc_id": item.get("primary_cxc_id"),
                        "total_exigible": item.get("total_exigible"),
                        "fecha_vencimiento": item.get("fecha_vencimiento"),
                        "fecha_limite_gracia": item.get("fecha_limite_gracia"),
                        "whatsapp_channel_id": response.get("channel_id")
                        if channel == "WHATSAPP"
                        else None,
                        "attempts": attempts,
                        "reintentos": max(attempts - 1, 0),
                        "consumo_saas": serialize_outbound_usage_limit(consumed_limit),
                    },
                    send_type=send_type,
                )
                if cooldown.total_seconds() > 0 and not is_consent_invitation:
                    recent_contact_by_client[cliente.id] = history
                if dedupe_key:
                    existing_dedupe_keys.add(dedupe_key)
                sent += 1
            except Exception as exc:  # pragma: no cover - defensive network handling
                errors.append(str(exc))
                attempts = int(getattr(exc, "outbound_attempts", 1) or 1)
                register_history(
                    config=config,
                    cliente=cliente,
                    template=template,
                    automation=automation,
                    channel=channel,
                    provider="META_CLOUD_API" if channel == "WHATSAPP" else get_email_provider(),
                    destination=destination,
                    subject=item["asunto"],
                    body=item["mensaje"],
                    media_url=item["url_media"],
                    status="ERROR",
                    reference=None,
                    dedupe_key=dedupe_key,
                    metadata={
                        "error": str(exc),
                        "segmento": item["segmento"],
                        "referencia_pago": item.get("referencia_pago"),
                        "cxc_ids": item.get("cxc_ids") or [],
                        "primary_cxc_id": item.get("primary_cxc_id"),
                        "total_exigible": item.get("total_exigible"),
                        "attempts": attempts,
                        "reintentos": max(attempts - 1, 0),
                        "transient": is_transient_outbound_error(exc),
                        "consumo_saas": serialize_outbound_usage_limit(
                            usage_limits.get(channel)
                        ),
                    },
                    send_type=send_type,
                )
                if dedupe_key:
                    existing_dedupe_keys.add(dedupe_key)
    return {
        "sent": sent,
        "skipped": skipped,
        "errors": errors,
    }


def resolve_anchor_date(*, rule: ReglaAutomatizacionMensaje, primary_row: dict | None) -> date | None:
    if not primary_row:
        return None
    if rule.evento_base == "FECHA_LIMITE_GRACIA":
        return primary_row.get("fecha_limite_gracia")
    return primary_row.get("fecha_vencimiento")


def build_automation_preview(
    *,
    config: ConfiguracionComunicacion,
    rule: ReglaAutomatizacionMensaje,
    allowed_entity_ids: list[int] | None,
    reference_date: date,
    materialize_candidates: bool = True,
    prefilter_anchor: bool = False,
) -> list[dict]:
    template_payload = resolve_template_payload(
        template=rule.plantilla_relacionada,
        channel=rule.canal,
        segment=rule.segmento,
        subject_override="",
        body_override="",
        include_portal=rule.plantilla_relacionada.incluye_link_portal,
        media_url=rule.plantilla_relacionada.url_media or "",
    )
    client_ids = None
    if prefilter_anchor and rule.evento_base == "FECHA_VENCIMIENTO":
        anchor_date = reference_date - timedelta(days=rule.desplazamiento_dias)
        anchor_queryset = (
            CuentaPorCobrar.objects.filter(
                cliente_relacionado__activo=True,
                fecha_vencimiento=anchor_date,
                monto_total__gt=F("monto_pagado"),
            )
            .exclude(estatus_adeudo__in=["CANCELADO", "INCOBRABLE"])
        )
        if allowed_entity_ids is not None:
            anchor_queryset = anchor_queryset.filter(
                Q(entidad_relacionada_id__in=allowed_entity_ids)
                | Q(
                    entidad_relacionada__isnull=True,
                    cliente_relacionado__entidad_relacionada_id__in=allowed_entity_ids,
                )
            )
        if rule.entidad_relacionada_id:
            anchor_queryset = anchor_queryset.filter(
                Q(entidad_relacionada_id=rule.entidad_relacionada_id)
                | Q(
                    entidad_relacionada__isnull=True,
                    cliente_relacionado__entidad_relacionada_id=rule.entidad_relacionada_id,
                )
            )
        client_ids = list(
            anchor_queryset.values_list("cliente_relacionado_id", flat=True).distinct()
        )
        if not client_ids:
            return []

    candidates = build_campaign_candidates(
        config=config,
        allowed_entity_ids=allowed_entity_ids,
        entity_id=rule.entidad_relacionada_id,
        client_ids=client_ids,
        segment=rule.segmento,
        channel=rule.canal,
        reference_date=reference_date,
        materialize=materialize_candidates,
    )
    collection_stage = resolve_collection_message_stage(
        template=rule.plantilla_relacionada,
        segment=rule.segmento,
        rule=rule,
    )
    due_items: list[dict] = []
    for candidate in candidates:
        candidate = filter_candidate_by_collection_stage(
            candidate=candidate,
            stage=collection_stage,
            config=config,
            reference_date=reference_date,
        )
        if not candidate:
            continue
        anchor = resolve_anchor_date(rule=rule, primary_row=candidate.get("primary_row"))
        if anchor is None:
            continue
        if anchor + timedelta(days=rule.desplazamiento_dias) != reference_date:
            continue
        due_items.append(
            build_preview_item_from_candidate(
                candidate=candidate,
                template_payload=template_payload,
                segment=rule.segmento,
            )
        )
    return due_items


def execute_due_automations(
    *,
    config: ConfiguracionComunicacion,
    allowed_entity_ids: list[int] | None = None,
    reference_date: date | None = None,
    max_sends: int | None = None,
) -> dict:
    today = reference_date or timezone.localdate()
    rules = (
        ReglaAutomatizacionMensaje.objects.select_related(
            "plantilla_relacionada",
            "entidad_relacionada",
        )
        .filter(
            configuracion_relacionada=config,
            activo=True,
            plantilla_relacionada__activo=True,
        )
        .order_by("nombre", "id")
    )
    if allowed_entity_ids is not None:
        rules = rules.filter(
            Q(entidad_relacionada__isnull=True) | Q(entidad_relacionada_id__in=allowed_entity_ids)
        )
    whatsapp_rules_count = rules.filter(canal__in=["WHATSAPP", "AMBOS"]).count()
    if whatsapp_rules_count:
        try:
            require_whatsapp_shared_number_agreement_for_capa(config.capa_negocio)
        except HttpError as exc:
            detail = getattr(exc, "message", None) or str(exc)
            return {
                "fecha_referencia": today,
                "reglas": [],
                "sent": 0,
                "skipped": 0,
                "errors": [detail],
                "max_sends": max_sends,
                "limit_reached": False,
            }

    total_sent = 0
    total_skipped = 0
    errors: list[str] = []
    executed_rules: list[dict] = []
    limit_reached = False
    for rule in rules:
        preview = build_automation_preview(
            config=config,
            rule=rule,
            allowed_entity_ids=allowed_entity_ids,
            reference_date=today,
        )
        remaining_sends = None
        if max_sends is not None:
            remaining_sends = max(max_sends - total_sent, 0)
        dispatch = dispatch_preview_items(
            config=config,
            template=rule.plantilla_relacionada,
            automation=rule,
            preview_items=preview,
            send_type="AUTOMATICO",
            dedupe_prefix=f"auto:{rule.id}:{today.isoformat()}",
            max_sends=remaining_sends,
        )
        total_sent += dispatch["sent"]
        total_skipped += dispatch["skipped"]
        errors.extend(dispatch["errors"])
        if max_sends is not None and total_sent >= max_sends:
            limit_reached = True
        executed_rules.append(
            {
                "id": rule.id,
                "nombre": rule.nombre,
                "segmento": rule.segmento,
                "candidatos": len(preview),
                "enviados": dispatch["sent"],
                "omitidos": dispatch["skipped"],
                "limite_alcanzado": bool(limit_reached),
            }
        )
    return {
        "fecha_referencia": today,
        "reglas": executed_rules,
        "sent": total_sent,
        "skipped": total_skipped,
        "errors": errors,
        "max_sends": max_sends,
        "limit_reached": limit_reached,
    }


def build_portal_payload(*, token: str) -> dict:
    from facturacion.models import FacturaEmitida

    config = ConfiguracionComunicacion.objects.order_by("id").first() or ConfiguracionComunicacion(
        portal_token_horas=168
    )
    payload = decode_portal_token(token, horas=max(config.portal_token_horas or 168, 1))
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

    detail = build_cxc_customer_detail(cliente_id=cliente.id)
    invoices = (
        FacturaEmitida.objects.filter(cliente_receptor=cliente)
        .exclude(estatus="CANCELADA")
        .only(
            "id",
            "estatus",
            "serie",
            "folio",
            "uuid",
            "total",
            "fecha_emision",
            "fecha_timbrado",
            "pdf_url",
            "xml_url",
        )
        .order_by("-fecha_emision", "-id")[:20]
    )
    evidence_items = (
        EvidenciaPago.objects.filter(
            cliente_relacionado=cliente,
            metadata__origen="PORTAL_CLIENTE",
        )
        .only(
            "id",
            "metadata",
            "monto_reportado",
            "fecha_pago_reportada",
            "referencia_reportada",
            "estatus",
            "requiere_revision_manual",
            "fecha_registro",
        )
        .order_by("-fecha_registro", "-id")[:20]
    )
    entidad = cliente.entidad_relacionada
    capa = getattr(entidad, "capa_negocio", None) if entidad else None
    collection_consent = get_portal_collection_consent_payload()
    collection_consent_accepted = bool(
        cliente.consentimiento_cobranza_aceptado
        and cliente.consentimiento_cobranza_version == collection_consent["version"]
        and cliente.consentimiento_cobranza_texto_hash == collection_consent["texto_hash"]
    )
    return {
        "cliente": {
            **detail["cliente"],
            "nombre": client_display_name(cliente),
            "correo": cliente.correo_principal,
            "telefono": cliente.telefono,
        },
        "resumen": detail["resumen"],
        "comportamiento": detail["comportamiento"],
        "tendencia_periodos": detail["tendencia_periodos"],
        "pagos_recientes": detail["pagos_recientes"],
        "cuentas": detail["cuentas"],
        "facturas_recientes": [
            {
                "id": invoice.id,
                "estatus": invoice.estatus,
                "serie": invoice.serie,
                "folio": invoice.folio,
                "uuid": invoice.uuid,
                "total": decimal_to_float(invoice.total),
                "fecha_emision": invoice.fecha_emision.isoformat()
                if invoice.fecha_emision
                else None,
                "fecha_timbrado": invoice.fecha_timbrado.isoformat()
                if invoice.fecha_timbrado
                else None,
                "pdf_url": invoice.pdf_url,
                "xml_url": invoice.xml_url,
            }
            for invoice in invoices
        ],
        "comprobantes_recientes": [
            {
                "id": evidence.id,
                "cuenta_id": (evidence.metadata or {}).get("cuenta_id"),
                "archivo_nombre": (evidence.metadata or {}).get("archivo_nombre"),
                "monto_reportado": decimal_to_float(evidence.monto_reportado),
                "fecha_pago_reportada": evidence.fecha_pago_reportada,
                "referencia_reportada": evidence.referencia_reportada,
                "estatus": evidence.estatus,
                "requiere_revision_manual": evidence.requiere_revision_manual,
                "fecha_registro": evidence.fecha_registro,
                "mensaje": portal_evidence_status_message(evidence),
            }
            for evidence in evidence_items
        ],
        "portal": {
            "token_horas": max(config.portal_token_horas or 168, 1),
            "generado_en": timezone.now(),
        },
        "consentimiento_cobranza": {
            "requerido": True,
            "aceptado": collection_consent_accepted,
            "version": collection_consent["version"],
            "titulo": collection_consent["titulo"],
            "texto": collection_consent["texto"],
            "texto_hash": collection_consent["texto_hash"],
            "requerimientos": collection_consent["requerimientos"],
            "fecha_aceptacion": cliente.consentimiento_cobranza_fecha,
        },
        "facturacion": {
            "activa": bool(getattr(capa, "facturacion_activa", False)),
            "pac_proveedor": getattr(capa, "facturacion_pac_proveedor", None),
            "uso_cfdi_default": getattr(capa, "facturacion_uso_cfdi_default", None),
            "metodo_pago_default": getattr(capa, "facturacion_metodo_pago_default", None),
            "forma_pago_default": getattr(capa, "facturacion_forma_pago_default", None),
        },
        "datos_fiscales": {
            "rfc": cliente.rfc,
            "razon_social": cliente.razon_social,
            "regimen_fiscal": cliente.regimen_fiscal,
            "regimenes_fiscales_detectados": cliente.regimenes_fiscales_detectados or [],
            "regimen_fiscal_pendiente_seleccion": bool(
                cliente.regimen_fiscal_pendiente_seleccion
            ),
            "codigo_postal": cliente.codigo_postal,
            "correo": cliente.correo_principal,
            "archivo_csf_url": cliente.archivo_csf_url,
        },
        "transferencia": {
            "beneficiario": getattr(capa, "beneficiario_transferencias", None),
            "banco": getattr(capa, "banco_transferencias", None),
            "clabe": getattr(capa, "clabe_transferencias", None),
            "referencia": build_reference_label(cliente),
        },
    }


def portal_evidence_status_message(evidence: EvidenciaPago) -> str:
    if evidence.estatus == "APLICADA":
        return "Pago aplicado al estado de cuenta."
    if evidence.estatus == "VALIDADA":
        return "Comprobante validado; puede estar pendiente de conciliacion bancaria."
    if evidence.estatus == "DESCARTADA":
        return "Comprobante descartado. Contacta a administracion si necesitas aclararlo."
    if evidence.requiere_revision_manual:
        return "Comprobante recibido para revision."
    return "Comprobante recibido."
