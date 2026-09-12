import hashlib
import hmac
import json
import logging
import re
import secrets
from datetime import date, datetime, timedelta
from decimal import Decimal
from urllib.parse import urlencode

import requests
from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.management import call_command
from django.db import DatabaseError, IntegrityError, transaction
from django.db.models import Avg, Count, Max, Q
from django.http import HttpResponseRedirect
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime
from django.utils.text import slugify
from ninja import File, Router, Schema
from ninja.errors import HttpError
from ninja.files import UploadedFile

from accounts.audit import audit
from accounts.models import EventoAuditoria
from accounts.security import (
    PLAN_OVERRIDE_METADATA_KEY,
    get_auth_context,
    get_subscription_capability_overrides,
    get_current_capa,
    is_platform_admin_user,
    require_admin_access,
    require_platform_admin_access,
)
from core.health import build_health_payload
from core.request_observability import (
    classify_http_request,
    is_exploratory_not_found_path,
)
from empresas.backup_export import build_capa_backup_workbook
from empresas.backup_inspection import inspect_backup_workbook
from empresas.backup_storage import (
    build_backup_object,
    download_backup_from_r2,
    upload_backup_to_r2,
)
from empresas.models import BackupCapaExport, CapaNegocio
from comunicaciones.models import (
    CanalWhatsappOficial,
    CasoProcesamiento,
    EvidenciaPago,
    HistorialEnvio,
    MensajeEntrante,
    PlantillaMensaje,
    ReglaAutomatizacionMensaje,
    WebhookEntrante,
)
from comunicaciones.email_provider import send_email_transport
from .saas_automation_manifest import SAAS_AUTOMATION_DEFINITIONS
from .background_jobs import enqueue_background_job, run_job_by_id_async
from .emails import queue_purchase_confirmation_email
from .models import (
    AsignacionComercialSaaS,
    BackgroundJob,
    BackendRequestMetric,
    CambioPlanSaaS,
    CronRunLog,
    CostoOperativoSaaS,
    EventoBilling,
    FrontendClientError,
    FrontendWebVitalMetric,
    GoLiveApproval,
    PlanSaaS,
    ProspectoComercial,
    Solucion,
    SuscripcionCapa,
    VendedorBetterP,
)
from .services import (
    POS_QR_ENTRY_PATH,
    PLAN_FEATURE_DEFINITIONS,
    PLAN_MODULE_DEFINITIONS,
    build_customer_account_status_map,
    build_customer_account_summary,
    build_customer_health_map,
    build_saas_usage_map,
    build_solution_usage_map,
    build_subscription_usage_map,
    build_usage_statement,
    build_catalogo_launch_url,
    build_checkout_payload,
    ensure_default_plans,
    ensure_default_solutions,
    expire_trial_if_needed,
    get_active_stripe_mode,
    get_default_solution,
    get_or_create_subscription_for_capa,
    get_or_create_payment_gateway_config,
    get_or_create_platform_billing_capa,
    get_plan_solution_identity,
    get_stripe_secret_key_for_mode,
    get_stripe_webhook_secret_for_mode,
    is_retired_solution,
    is_catalogo_plan,
    mark_subscription_event,
    platform_app_base_url,
    normalize_stripe_mode,
    resolve_price_id_for_plan,
    serialize_go_live_approval,
    serialize_plan,
    serialize_prospect,
    serialize_solution,
    serialize_subscription,
    serialize_subscription_admin,
    SOLUTION_POS_QR_KEY,
)

router = Router(tags=["billing"])

BACKOFFICE_EXPECTED_BACKEND_FEATURES = (
    "crm_portal_link",
    "capa_backup_streaming_export",
)
SMOKE_MONITOR_DEFINITIONS = [
    {
        "key": "production_smoke",
        "name": "Smoke produccion",
        "expected_hours": 30,
        "required": True,
    },
    {
        "key": "backend_deploy_smoke",
        "name": "Smoke post-deploy backend",
        "expected_hours": 168,
        "required": False,
    },
    {
        "key": "demo_smoke",
        "name": "Smoke demo",
        "expected_hours": 30,
        "required": False,
    },
]
SMOKE_MONITOR_KEYS = tuple(item["key"] for item in SMOKE_MONITOR_DEFINITIONS)


class CheckoutIn(Schema):
    plan_id: int
    periodicidad: str = "MENSUAL"
    success_url: str = ""
    cancel_url: str = ""


class WebVitalMetricIn(Schema):
    id: str = ""
    name: str
    value: float
    delta: float = 0
    rating: str = "unknown"
    path: str = ""
    navigation_type: str = ""
    app_env: str = ""
    build_id: str = ""
    visibility_state: str = ""


class FrontendClientErrorIn(Schema):
    source: str = "unknown"
    error_name: str = ""
    message: str
    path: str = ""
    stack: str = ""
    component_stack: str = ""


class SmokeReportIn(Schema):
    ok: bool
    generated_at: str | None = None
    total: int = 0
    failures: int = 0
    api_base: str | None = None
    app_base: str | None = None
    selected_capa_id: str | None = None
    deploy_commit: str | None = None
    deploy_commit_strict: bool = False
    required_backend_features: list[str] | None = None
    total_duration_ms: int = 0
    slowest_checks: list[dict] | None = None
    failed_checks: list[dict] | None = None
    source: str | None = None
    workflow: str | None = None
    git_commit: str | None = None


TOKENISH_PATH_SEGMENT = re.compile(r"^[A-Za-z0-9_-]{32,}$|^[a-f0-9-]{24,}$", re.IGNORECASE)


def normalize_web_vital_path(path: str) -> str:
    raw_path = (path or "/").strip().split("?", 1)[0].split("#", 1)[0] or "/"
    normalized_segments = []
    for segment in raw_path.split("/"):
        if not segment:
            continue
        if segment.isdigit():
            normalized_segments.append(":id")
        elif TOKENISH_PATH_SEGMENT.match(segment):
            normalized_segments.append(":token")
        else:
            normalized_segments.append(segment[:80])
    normalized_path = "/" + "/".join(normalized_segments)
    return normalized_path[:240] or "/"


class CheckoutConfirmIn(Schema):
    checkout_session_id: str = ""


class PlanChangeIn(Schema):
    plan_id: int
    periodicidad: str = "MENSUAL"
    modo: str = "INMEDIATO"
    preferencia_credito: str = "SALDO"
    incluir_preview_stripe: bool = False
    stripe_proration_date: int | None = None
    confirmacion_live: str = ""


class ProspectLeadIn(Schema):
    nombre: str
    empresa: str = ""
    email: str
    telefono: str = ""
    mensaje: str = ""
    origen: str = "LANDING"
    solution_key: str = ""
    solution: str = ""
    utm_source: str = ""
    utm_medium: str = ""
    utm_campaign: str = ""
    utm_content: str = ""
    utm_term: str = ""
    landing_url: str = ""
    landing_referrer: str = ""
    first_touch_at: str = ""
    operation_type: str = ""
    spaces_count: str = ""
    collection_method: str = ""
    main_pain: str = ""
    urgency: str = ""


class ProspectUpdateIn(Schema):
    etapa: str
    notas_internas: str = ""
    solution_key: str | None = None
    lost_reason: str = ""
    commercial_objection: str = ""
    excluded_from_learning: bool | None = None


class AdminCaseUpdateIn(Schema):
    estatus: str
    nota_admin: str = ""


class AdminPaymentRequestUpdateIn(Schema):
    estatus: str
    observaciones: str = ""


class AdminPlanUpsertIn(Schema):
    solution_id: int | None = None
    clave: str = ""
    nombre: str
    descripcion: str = ""
    precio_mensual: float
    precio_anual: float
    max_usuarios: int = 3
    max_entidades: int = 3
    max_productos: int = 30
    dias_prueba: int = 10
    openai_tokens_incluidos: int = 0
    whatsapp_mensajes_incluidos: int = 0
    comprobantes_whatsapp_incluidos: int = 0
    timbres_facturacion_incluidos: int = 0
    emails_incluidos: int = 0
    precio_openai_1k_tokens_extra: float = 0
    precio_whatsapp_mensaje_extra: float = 0
    precio_comprobante_whatsapp_extra: float = 0
    precio_timbre_facturacion_extra: float = 0
    precio_email_extra: float = 0
    activo: bool = True
    es_default: bool = False
    permite_google_login: bool = True
    permite_webhooks: bool = True
    modulos_habilitados: list[str] = []
    funciones_habilitadas: list[str] = []
    stripe_test_price_id_mensual: str = ""
    stripe_test_price_id_anual: str = ""
    stripe_price_id_mensual: str = ""
    stripe_price_id_anual: str = ""


class AdminSubscriptionProvisionIn(Schema):
    nombre: str
    tipo_capa: str = "EMPRESA"
    nombre_administrador: str = ""
    correo_contacto: str = ""
    telefono_contacto: str = ""
    plan_id: int
    estatus: str = "TRIAL"
    periodicidad: str = "MENSUAL"
    fecha_inicio: date | None = None
    fecha_fin_periodo_actual: date | None = None
    auto_renueva: bool = False
    notas: str = ""
    seguimiento_estado: str = "SIN_SEGUIMIENTO"
    seguimiento_prioridad: str = "MEDIA"
    seguimiento_responsable: str = ""
    seguimiento_fecha: date | None = None
    seguimiento_resultado: str = ""
    source_prospect_id: int | None = None


class AdminSubscriptionCommercialUpdateIn(Schema):
    nombre: str = ""
    tipo_capa: str = ""
    nombre_administrador: str = ""
    correo_contacto: str = ""
    telefono_contacto: str = ""
    plan_id: int | None = None
    estatus: str = ""
    periodicidad: str = ""
    fecha_inicio: date | None = None
    fecha_fin_periodo_actual: date | None = None
    auto_renueva: bool | None = None
    notas: str = ""
    seguimiento_estado: str = "SIN_SEGUIMIENTO"
    seguimiento_prioridad: str = "MEDIA"
    seguimiento_responsable: str = ""
    seguimiento_fecha: date | None = None
    seguimiento_resultado: str = ""
    source_prospect_id: int | None = None


class AdminSubscriptionCapabilityOverridesIn(Schema):
    modulos_agregados: list[str] = []
    modulos_bloqueados: list[str] = []
    funciones_agregadas: list[str] = []
    funciones_bloqueadas: list[str] = []
    nota: str = ""
    managed_marketing_enabled: bool | None = None
    managed_marketing_scope: str | None = None
    managed_marketing_responsable: str | None = None
    managed_marketing_nota: str | None = None
    managed_marketing_actualizado_en: str | None = None
    managed_marketing_actualizado_por: str | None = None


class AdminVendeFacilLegacyAdoptionIn(Schema):
    dry_run: bool = True
    confirmation_text: str = ""
    include_products: bool = True
    include_catalogs: bool = True
    include_warehouses: bool = True
    include_connections: bool = True
    include_orders: bool = True




class AdminVendeFacilProvisioningCheckIn(Schema):
    sync_first: bool = True


class PaymentGatewayConfigIn(Schema):
    stripe_modo: str = "TEST"


class AdminBackupGenerateIn(Schema):
    motivo: str = ""


class AdminBackupRestoreValidationIn(Schema):
    confirmacion: bool = False
    confirmacion_texto: str = ""
    motivo: str = ""


class AdminGoLiveApprovalIn(Schema):
    estatus: str = "PENDIENTE"
    fecha_go_live: date | None = None
    responsable_betterp: str = ""
    responsable_cliente: str = ""
    smoke_previo: str = ""
    smoke_posterior: str = ""
    backup_referencia: str = ""
    backup_restore_validado: bool = False
    automatizaciones_activas: bool = False
    post_go_live_dia_1_validado: bool = False
    post_go_live_dia_7_validado: bool = False
    post_go_live_notas: str = ""
    post_go_live_tarea_estado: str = "SIN_TAREA"
    post_go_live_responsable: str = ""
    post_go_live_fecha_objetivo: date | None = None
    post_go_live_prioridad: str = "MEDIA"
    pendientes: str = ""
    decision: str = ""


class PlatformBillingProfileIn(Schema):
    nombre: str = "Better Business"
    nombre_administrador: str = ""
    razon_social: str = ""
    rfc: str = ""
    regimen_fiscal: str = ""
    correo_contacto: str = ""
    telefono_contacto: str = ""
    logo_url: str = ""
    pais_fiscal: str = "Mexico"
    codigo_postal_fiscal: str = ""
    estado_fiscal: str = ""
    municipio_fiscal: str = ""
    colonia_fiscal: str = ""
    calle_fiscal: str = ""
    numero_exterior_fiscal: str = ""
    numero_interior_fiscal: str = ""
    facturacion_activa: bool = False
    facturacion_modo: str = "MANUAL"
    facturacion_pac_proveedor: str = "SIN_PROVEEDOR"
    facturacion_serie_ingresos: str = "BP"
    facturacion_lugar_expedicion: str = ""
    facturacion_producto_servicio: str = "81112100"
    facturacion_unidad: str = "E48"
    facturacion_uso_cfdi_default: str = "G03"
    facturacion_metodo_pago_default: str = "PUE"
    facturacion_forma_pago_default: str = "03"
    clabe_transferencias: str = ""
    banco_transferencias: str = ""
    beneficiario_transferencias: str = ""
    referencia_transferencia_prefijo: str = "BETTERP"










































class SellerUpsertIn(Schema):
    nombre: str
    email: str
    telefono: str = ""
    activo: bool = True
    porcentaje_comision_default: float = 0
    notas_internas: str = ""


class SalesAssignmentUpsertIn(Schema):
    vendedor_id: int | None = None
    origen: str = "ORGANICO"
    porcentaje_comision: float = 0
    comision_activa: bool = False
    fecha_inicio: str = ""
    fecha_fin: str = ""
    notas_internas: str = ""


class OperationalCostUpsertIn(Schema):
    suscripcion_id: int
    categoria: str
    concepto: str
    monto_mensual: float
    activo: bool = True
    fecha_inicio: str = ""
    fecha_fin: str = ""
    notas_internas: str = ""


for _schema in (
    CheckoutIn,
    CheckoutConfirmIn,
    PlanChangeIn,
    ProspectLeadIn,
    ProspectUpdateIn,
    AdminCaseUpdateIn,
    AdminPaymentRequestUpdateIn,
    AdminPlanUpsertIn,
    PaymentGatewayConfigIn,
    AdminBackupGenerateIn,
    SellerUpsertIn,
    SalesAssignmentUpsertIn,
    OperationalCostUpsertIn,
):
    _schema.model_rebuild()


def stripe_headers() -> dict[str, str]:
    stripe_mode = get_active_stripe_mode()
    return {
        "Authorization": f"Bearer {get_stripe_secret_key_for_mode(stripe_mode)}",
        "Content-Type": "application/x-www-form-urlencoded",
    }


def payment_migration_error_message() -> str:
    return (
        "La base de datos de produccion todavia no tiene aplicada la migracion de pagos. "
        "Ejecuta `python manage.py migrate` en Render y vuelve a intentar."
    )


def checkout_configuration_error_message(exc: ValueError) -> str:
    detail = str(exc)
    if "secret key" in detail.lower() or "STRIPE_SECRET_KEY" in detail:
        return (
            f"La pasarela de pagos todavia no esta activa para modo {get_active_stripe_mode()}. "
            "Configura la secret key correspondiente en Render y vuelve a desplegar."
        )
    if "price id" in detail.lower():
        return (
            f"Este plan todavia no tiene un Price ID activo para modo {get_active_stripe_mode()}. "
            "Completa el precio mensual o anual correspondiente en Backoffice > Planes."
        )
    return "No se pudo preparar el checkout de este plan."


def ensure_checkout_session_success_url(success_url: str) -> str:
    if "{CHECKOUT_SESSION_ID}" in success_url or "session_id=" in success_url:
        return success_url
    separator = "&" if "?" in success_url else "?"
    return f"{success_url}{separator}session_id={{CHECKOUT_SESSION_ID}}"


def parse_stripe_error_response(response: requests.Response) -> tuple[dict, str]:
    try:
        body = response.json()
    except ValueError:
        body = {"raw": response.text[:500]}

    stripe_error = body.get("error") if isinstance(body, dict) else None
    if isinstance(stripe_error, dict):
        message = str(stripe_error.get("message") or "").strip()
    else:
        message = ""
    if not message and isinstance(body, dict):
        message = str(body.get("message") or body.get("detail") or "").strip()
    return body if isinstance(body, dict) else {"raw": str(body)[:500]}, message


def stripe_api_request(
    secret_key: str,
    method: str,
    path: str,
    *,
    data: dict | None = None,
    params: dict | None = None,
) -> dict:
    try:
        response = requests.request(
            method,
            f"{settings.STRIPE_API_BASE_URL.rstrip('/')}/{path.lstrip('/')}",
            headers={
                "Authorization": f"Bearer {secret_key}",
                "Content-Type": "application/x-www-form-urlencoded",
            },
            data=data,
            params=params,
            timeout=25,
        )
    except requests.RequestException as exc:
        raise ValueError(f"No se pudo conectar con Stripe: {exc}") from exc

    if response.status_code >= 400:
        body, message = parse_stripe_error_response(response)
        detail = message or str(body.get("raw") or body)[:300]
        raise ValueError(detail)

    try:
        body = response.json()
    except ValueError as exc:
        raise ValueError("Stripe no devolvio una respuesta valida.") from exc
    return body if isinstance(body, dict) else {"raw": body}


def clone_stripe_live_price_to_test(
    *,
    plan: PlanSaaS,
    periodicidad: str,
    live_price_id: str,
    live_secret_key: str,
    test_secret_key: str,
    test_product_id: str | None = None,
) -> tuple[str, str]:
    live_price = stripe_api_request(
        live_secret_key,
        "GET",
        f"/v1/prices/{live_price_id}",
        params={"expand[]": "product"},
    )
    recurring = live_price.get("recurring") if isinstance(live_price, dict) else None
    if not isinstance(recurring, dict):
        raise ValueError("El precio live no es recurrente.")

    if not test_product_id:
        live_product = live_price.get("product")
        if isinstance(live_product, str):
            live_product = stripe_api_request(
                live_secret_key,
                "GET",
                f"/v1/products/{live_product}",
            )
        if not isinstance(live_product, dict):
            live_product = {}

        product_payload = {
            "name": str(live_product.get("name") or f"BetterP {plan.nombre}").strip(),
            "active": "true",
            "metadata[betterp_plan_id]": str(plan.id),
            "metadata[betterp_plan_clave]": plan.clave,
            "metadata[clonado_desde]": "stripe_live",
        }
        product_description = str(live_product.get("description") or plan.descripcion or "").strip()
        if product_description:
            product_payload["description"] = product_description
        test_product = stripe_api_request(
            test_secret_key,
            "POST",
            "/v1/products",
            data=product_payload,
        )
        test_product_id = str(test_product.get("id") or "").strip()
        if not test_product_id:
            raise ValueError("Stripe no devolvio el producto de prueba creado.")

    price_payload = {
        "currency": str(live_price.get("currency") or "mxn").lower(),
        "product": test_product_id,
        "active": "true",
        "nickname": f"BetterP {plan.nombre} {periodicidad.lower()} test",
        "metadata[betterp_plan_id]": str(plan.id),
        "metadata[betterp_plan_clave]": plan.clave,
        "metadata[periodicidad]": periodicidad,
        "metadata[live_price_id]": live_price_id,
    }
    unit_amount_decimal = live_price.get("unit_amount_decimal")
    unit_amount = live_price.get("unit_amount")
    if unit_amount_decimal:
        price_payload["unit_amount_decimal"] = str(unit_amount_decimal)
    elif unit_amount is not None:
        price_payload["unit_amount"] = str(unit_amount)
    else:
        raise ValueError("El precio live no tiene monto fijo clonable.")

    interval = recurring.get("interval")
    if interval:
        price_payload["recurring[interval]"] = str(interval)
    interval_count = recurring.get("interval_count")
    if interval_count:
        price_payload["recurring[interval_count]"] = str(interval_count)
    usage_type = recurring.get("usage_type")
    if usage_type:
        price_payload["recurring[usage_type]"] = str(usage_type)
    trial_period_days = recurring.get("trial_period_days")
    if trial_period_days:
        price_payload["recurring[trial_period_days]"] = str(trial_period_days)

    tax_behavior = live_price.get("tax_behavior")
    if tax_behavior in {"inclusive", "exclusive"}:
        price_payload["tax_behavior"] = tax_behavior

    test_price = stripe_api_request(
        test_secret_key,
        "POST",
        "/v1/prices",
        data=price_payload,
    )
    test_price_id = str(test_price.get("id") or "").strip()
    if not test_price_id:
        raise ValueError("Stripe no devolvio el precio de prueba creado.")
    return test_price_id, test_product_id


def stripe_checkout_error_message(stripe_body: dict, stripe_message: str) -> str:
    stripe_error = stripe_body.get("error")
    error_code = ""
    error_type = ""
    if isinstance(stripe_error, dict):
        error_code = str(stripe_error.get("code") or "").lower()
        error_type = str(stripe_error.get("type") or "").lower()
    message = (stripe_message or "").lower()

    if "no such price" in message or ("price" in message and error_code == "resource_missing"):
        return (
            "El Price ID configurado para este plan no existe en la cuenta o modo "
            "de Stripe conectado. Revisa que el precio guardado en Backoffice > "
            f"Planes pertenezca al modo {get_active_stripe_mode()} activo."
        )
    if "no such customer" in message or ("customer" in message and error_code == "resource_missing"):
        return (
            "El cliente de Stripe guardado para esta cuenta ya no existe. "
            "Intenta iniciar el checkout de nuevo o limpia la referencia de Stripe."
        )
    if "api key" in message or "invalid api key" in message or "authentication" in error_type:
        return (
            "La clave secreta de Stripe no es valida para este entorno. "
            "Revisa STRIPE_TEST_SECRET_KEY o STRIPE_LIVE_SECRET_KEY en Render y vuelve a desplegar."
        )
    if "recurring" in message:
        return (
            "El precio de Stripe seleccionado no esta configurado como recurrente. "
            "Crea un precio mensual/anual recurrente y guarda ese Price ID en BetterP."
        )
    if "success_url" in message or "cancel_url" in message or "url" in message:
        return (
            "Stripe rechazo la URL de regreso del checkout. Revisa que el dominio "
            "publico de la app este configurado correctamente."
        )
    return (
        "Stripe no pudo iniciar el checkout para este plan. Revisa que la secret key "
        "y los Price IDs correspondan al mismo entorno de Stripe."
    )


MONEY_ZERO = Decimal("0.00")
MONEY_QUANT = Decimal("0.01")
ACTIVE_PLAN_CHANGE_STATUSES = {"EN_PROCESO", "PENDIENTE_RENOVACION", "REEMBOLSO_SOLICITADO"}
STRIPE_LIVE_PLAN_CHANGE_CONFIRMATION = "STRIPE_LIVE_OK"
COMMERCIAL_FOLLOWUP_METADATA_KEY = "commercial_followup"
COMMERCIAL_FOLLOWUP_STATUSES = {
    "SIN_SEGUIMIENTO",
    "CONTACTAR",
    "PROPUESTA",
    "EN_NEGOCIACION",
    "APROBADO",
    "DESCARTADO",
    "CERRADO",
}
COMMERCIAL_FOLLOWUP_PRIORITIES = {"BAJA", "MEDIA", "ALTA"}


def normalize_subscription_periodicity(value: str | None) -> str:
    return "ANUAL" if (value or "").strip().upper() == "ANUAL" else "MENSUAL"


def normalize_plan_change_mode(value: str | None) -> str:
    requested = (value or "").strip().upper()
    return "AL_RENOVAR" if requested == "AL_RENOVAR" else "INMEDIATO"


def normalize_credit_preference(value: str | None) -> str:
    requested = (value or "").strip().upper()
    valid_preferences = {choice for choice, _ in CambioPlanSaaS.PREFERENCIA_CREDITO_CHOICES}
    return requested if requested in valid_preferences else "SALDO"


def quantize_money(value: Decimal) -> Decimal:
    return Decimal(value or 0).quantize(MONEY_QUANT)


def plan_price_for_periodicity(plan: PlanSaaS, periodicidad: str) -> Decimal:
    if normalize_subscription_periodicity(periodicidad) == "ANUAL":
        return quantize_money(Decimal(plan.precio_anual or 0))
    return quantize_money(Decimal(plan.precio_mensual or 0))


def resolve_period_window(subscription: SuscripcionCapa, periodicidad: str) -> tuple[date, date, int, int]:
    today = timezone.localdate()
    fallback_days = 365 if normalize_subscription_periodicity(periodicidad) == "ANUAL" else 30
    start = subscription.fecha_inicio or today
    end = subscription.fecha_fin_periodo_actual or (today + timedelta(days=fallback_days))
    if end <= today:
        return start, end, fallback_days, 0
    total_days = max((end - start).days, 1)
    if total_days < 2:
        total_days = fallback_days
    days_left = max((end - today).days, 0)
    return start, end, total_days, days_left


def resolve_plan_change_proration_date(value: int | None = None) -> int:
    try:
        proration_date = int(value or 0)
    except (TypeError, ValueError):
        proration_date = 0
    if proration_date <= 0:
        proration_date = int(timezone.now().timestamp())
    return proration_date


def format_plan_change_proration_date(value: int) -> str:
    return datetime.fromtimestamp(
        value,
        tz=timezone.get_current_timezone(),
    ).isoformat()


def build_plan_change_preview(
    subscription: SuscripcionCapa,
    plan: PlanSaaS,
    periodicidad: str,
    *,
    stripe_proration_date: int | None = None,
) -> dict:
    periodicidad = normalize_subscription_periodicity(periodicidad)
    proration_date = resolve_plan_change_proration_date(stripe_proration_date)
    current_price = plan_price_for_periodicity(subscription.plan, subscription.periodicidad)
    new_price = plan_price_for_periodicity(plan, periodicidad)
    _, _, total_days, days_left = resolve_period_window(subscription, subscription.periodicidad)
    ratio = Decimal(days_left) / Decimal(total_days or 1)
    current_credit = quantize_money(current_price * ratio)
    new_charge = quantize_money(new_price * ratio)
    net_amount = quantize_money(new_charge - current_credit)
    amount_to_pay = net_amount if net_amount > MONEY_ZERO else MONEY_ZERO
    credit_balance = quantize_money(abs(net_amount)) if net_amount < MONEY_ZERO else MONEY_ZERO
    if plan.id == subscription.plan_id and periodicidad == subscription.periodicidad:
        change_type = "MISMO_PLAN"
    elif new_price > current_price:
        change_type = "UPGRADE"
    elif new_price < current_price:
        change_type = "DOWNGRADE"
    else:
        change_type = "CAMBIO_CICLO"

    return {
        "plan_actual": serialize_plan(subscription.plan),
        "plan_nuevo": serialize_plan(plan),
        "periodicidad_actual": subscription.periodicidad,
        "periodicidad_nueva": periodicidad,
        "tipo": change_type,
        "dias_totales_periodo": total_days,
        "dias_restantes_periodo": days_left,
        "precio_actual_periodo": float(current_price),
        "precio_nuevo_periodo": float(new_price),
        "credito_plan_actual": float(current_credit),
        "cargo_plan_nuevo": float(new_charge),
        "neto_estimado": float(net_amount),
        "monto_a_pagar": float(amount_to_pay),
        "saldo_a_favor_estimado": float(credit_balance),
        "requiere_pago": amount_to_pay > MONEY_ZERO,
        "genera_saldo_a_favor": credit_balance > MONEY_ZERO,
        "stripe_subscription_id": subscription.stripe_subscription_id,
        "stripe_proration_date": proration_date,
        "stripe_proration_date_iso": format_plan_change_proration_date(proration_date),
    }


def get_active_plan_change(subscription: SuscripcionCapa) -> CambioPlanSaaS | None:
    return (
        CambioPlanSaaS.objects.select_related("plan_anterior", "plan_nuevo")
        .filter(suscripcion=subscription, estatus__in=ACTIVE_PLAN_CHANGE_STATUSES)
        .order_by("-fecha_creacion", "-id")
        .first()
    )


def build_plan_change_review_status(change: CambioPlanSaaS) -> dict:
    metadata = change.metadata or {}
    pendiente_renovacion = metadata.get("pendiente_renovacion")
    fecha_siguiente_revision = None
    if isinstance(pendiente_renovacion, dict):
        fecha_siguiente_revision = pendiente_renovacion.get("fecha_fin_periodo_actual")

    dias_en_revision = max((timezone.now() - change.fecha_creacion).days, 0)
    bloquea_nuevo_cambio = change.estatus in ACTIVE_PLAN_CHANGE_STATUSES
    tiene_invoice = bool(change.stripe_invoice_id)
    tiene_refund = bool(change.stripe_refund_id)
    referencia = (
        change.stripe_refund_id
        or change.stripe_invoice_id
        or change.stripe_subscription_id
        or None
    )

    if change.estatus == "REEMBOLSO_SOLICITADO":
        if tiene_refund:
            estado_operativo = "REEMBOLSO_REGISTRADO"
            requiere_revision_manual = True
            accion_recomendada = (
                "Verificar el reembolso en Stripe y cerrar la revision si ya fue compensado."
            )
        else:
            estado_operativo = "REVISION_REEMBOLSO"
            requiere_revision_manual = True
            accion_recomendada = (
                "Revisar saldo a favor y emitir reembolso o nota de credito en Stripe."
            )
    elif change.estatus == "PENDIENTE_RENOVACION":
        estado_operativo = "PENDIENTE_RENOVACION"
        requiere_revision_manual = False
        accion_recomendada = "Aplicar o confirmar el cambio al cierre del periodo actual."
    elif change.estatus == "EN_PROCESO":
        estado_operativo = "ESPERANDO_STRIPE"
        requiere_revision_manual = False
        accion_recomendada = "Esperar confirmacion de pago o actualizacion de Stripe."
    elif change.estatus == "ERROR":
        estado_operativo = "ERROR"
        requiere_revision_manual = True
        accion_recomendada = (
            "Corregir la configuracion o reenviar el cambio despues de revisar Stripe."
        )
    elif change.estatus == "APLICADO":
        estado_operativo = "APLICADO"
        requiere_revision_manual = False
        accion_recomendada = "Sin accion operativa pendiente."
    else:
        estado_operativo = "PREVIEW"
        requiere_revision_manual = False
        accion_recomendada = "Sin accion operativa pendiente."

    return {
        "estado_operativo": estado_operativo,
        "requiere_revision_manual": requiere_revision_manual,
        "accion_recomendada": accion_recomendada,
        "bloquea_nuevo_cambio": bloquea_nuevo_cambio,
        "tiene_invoice": tiene_invoice,
        "tiene_refund": tiene_refund,
        "referencia_stripe_principal": referencia,
        "fecha_siguiente_revision": fecha_siguiente_revision,
        "dias_en_revision": dias_en_revision,
    }


def build_plan_change_readiness(
    subscription: SuscripcionCapa,
    plan: PlanSaaS,
    periodicidad: str,
    preview: dict,
) -> dict:
    stripe_mode = get_active_stripe_mode()
    price_id = resolve_price_id_for_plan(plan, periodicidad, stripe_mode=stripe_mode)
    pending_change = get_active_plan_change(subscription)
    secret_configured = bool(get_stripe_secret_key_for_mode(stripe_mode))
    has_stripe_subscription = bool(subscription.stripe_subscription_id)
    is_active_status = subscription.estatus in {"ACTIVA", "PAST_DUE"}
    warnings: list[str] = []

    if preview["tipo"] == "MISMO_PLAN":
        warnings.append("La cuenta ya usa este plan y ciclo de cobro.")
    if not is_active_status:
        warnings.append("La suscripcion debe estar activa o past due para cambiar plan.")
    if pending_change:
        warnings.append("Ya existe un cambio de plan pendiente o en revision.")
    if not secret_configured:
        warnings.append(f"Falta configurar Stripe en modo {stripe_mode}.")
    if not price_id:
        warnings.append(f"El plan no tiene Price ID para modo {stripe_mode}.")
    if not has_stripe_subscription:
        warnings.append("La cuenta no tiene una suscripcion activa en Stripe.")

    can_schedule = is_active_status and preview["tipo"] != "MISMO_PLAN" and not pending_change
    can_apply_immediately = (
        can_schedule
        and secret_configured
        and bool(price_id)
        and has_stripe_subscription
    )
    requires_live_confirmation = stripe_mode == "LIVE" and can_apply_immediately
    recommended_mode = "INMEDIATO" if can_apply_immediately else "AL_RENOVAR"
    if preview.get("genera_saldo_a_favor"):
        recommended_mode = "AL_RENOVAR"

    return {
        "stripe_modo": stripe_mode,
        "price_id_configurado": bool(price_id),
        "stripe_secret_configurada": secret_configured,
        "stripe_subscription_configurada": has_stripe_subscription,
        "puede_aplicar_inmediato": can_apply_immediately,
        "puede_programar_renovacion": can_schedule,
        "requiere_confirmacion_live": requires_live_confirmation,
        "confirmacion_live_requerida": (
            STRIPE_LIVE_PLAN_CHANGE_CONFIRMATION if requires_live_confirmation else ""
        ),
        "modo_recomendado": recommended_mode,
        "advertencias": warnings,
        "cambio_pendiente": serialize_plan_change(pending_change) if pending_change else None,
    }


def serialize_plan_change(change: CambioPlanSaaS) -> dict:
    return {
        "id": change.id,
        "suscripcion_id": change.suscripcion_id,
        "plan_anterior": serialize_plan(change.plan_anterior),
        "plan_nuevo": serialize_plan(change.plan_nuevo),
        "periodicidad_anterior": change.periodicidad_anterior,
        "periodicidad_nueva": change.periodicidad_nueva,
        "tipo": change.tipo,
        "modo": change.modo,
        "preferencia_credito": change.preferencia_credito,
        "estatus": change.estatus,
        "dias_totales_periodo": change.dias_totales_periodo,
        "dias_restantes_periodo": change.dias_restantes_periodo,
        "credito_plan_actual": float(change.credito_plan_actual),
        "cargo_plan_nuevo": float(change.cargo_plan_nuevo),
        "neto_estimado": float(change.total_estimado),
        "monto_a_pagar": float(change.total_estimado if change.total_estimado > 0 else 0),
        "saldo_a_favor_estimado": float(change.saldo_a_favor_estimado),
        "stripe_modo": change.stripe_modo,
        "stripe_subscription_id": change.stripe_subscription_id,
        "stripe_invoice_id": change.stripe_invoice_id,
        "stripe_refund_id": change.stripe_refund_id,
        "detalle_error": change.detalle_error,
        "metadata": change.metadata or {},
        "revision": build_plan_change_review_status(change),
        "fecha_creacion": change.fecha_creacion,
    }


def build_plan_change_record(
    *,
    request,
    subscription: SuscripcionCapa,
    plan: PlanSaaS,
    periodicidad: str,
    modo: str,
    preferencia_credito: str,
    estatus: str = "PREVIEW",
    stripe_proration_date: int | None = None,
) -> CambioPlanSaaS:
    preview = build_plan_change_preview(
        subscription,
        plan,
        periodicidad,
        stripe_proration_date=stripe_proration_date,
    )
    auth = getattr(request, "auth", None)
    user = getattr(auth, "user", None) or getattr(request, "user", None)
    return CambioPlanSaaS.objects.create(
        suscripcion=subscription,
        plan_anterior=subscription.plan,
        plan_nuevo=plan,
        periodicidad_anterior=subscription.periodicidad,
        periodicidad_nueva=preview["periodicidad_nueva"],
        tipo=preview["tipo"],
        modo=modo,
        preferencia_credito=preferencia_credito,
        estatus=estatus,
        dias_totales_periodo=preview["dias_totales_periodo"],
        dias_restantes_periodo=preview["dias_restantes_periodo"],
        credito_plan_actual=quantize_money(Decimal(str(preview["credito_plan_actual"]))),
        cargo_plan_nuevo=quantize_money(Decimal(str(preview["cargo_plan_nuevo"]))),
        total_estimado=quantize_money(Decimal(str(preview["neto_estimado"]))),
        saldo_a_favor_estimado=quantize_money(
            Decimal(str(preview["saldo_a_favor_estimado"]))
        ),
        stripe_modo=get_active_stripe_mode(),
        stripe_subscription_id=subscription.stripe_subscription_id,
        metadata={"preview": preview},
        creado_por=user if getattr(user, "is_authenticated", False) else None,
    )


def resolve_stripe_subscription_item_id(stripe_subscription: dict) -> str:
    items = stripe_subscription.get("items", {})
    if not isinstance(items, dict):
        raise ValueError("Stripe no devolvio partidas de suscripcion.")
    item_rows = items.get("data") or []
    if not item_rows:
        raise ValueError("La suscripcion de Stripe no tiene un precio editable.")
    item_id = str(item_rows[0].get("id") or "").strip()
    if not item_id:
        raise ValueError("No se pudo identificar la partida de suscripcion en Stripe.")
    return item_id


def build_stripe_plan_change_update_payload(
    *,
    item_id: str,
    price_id: str,
    capa: CapaNegocio,
    subscription: SuscripcionCapa,
    change: CambioPlanSaaS,
    stripe_mode: str,
    proration_date: int | None = None,
) -> dict[str, str]:
    plan_identity = get_plan_solution_identity(change.plan_nuevo)
    payload = {
        "items[0][id]": item_id,
        "items[0][price]": price_id,
        "items[0][quantity]": "1",
        "proration_behavior": "always_invoice",
        "payment_behavior": "pending_if_incomplete",
        "metadata[capa_negocio_id]": str(capa.id),
        "metadata[suscripcion_id]": str(subscription.id),
        "metadata[plan_id]": str(change.plan_nuevo_id),
        "metadata[plan_clave]": change.plan_nuevo.clave,
        "metadata[betterp_plan_id]": str(change.plan_nuevo_id),
        "metadata[betterp_plan_clave]": change.plan_nuevo.clave,
        "metadata[solution_key]": plan_identity["solution_key"],
        "metadata[solution_name]": plan_identity["solution_name"],
        "metadata[betterp_solution_key]": plan_identity["solution_key"],
        "metadata[periodicidad]": change.periodicidad_nueva,
        "metadata[stripe_modo]": stripe_mode,
        "metadata[cambio_plan_id]": str(change.id),
        "metadata[tipo_cambio_plan]": change.tipo,
        "metadata[preferencia_credito]": change.preferencia_credito,
        "metadata[neto_estimado]": str(change.total_estimado),
        "metadata[saldo_a_favor_estimado]": str(change.saldo_a_favor_estimado),
    }
    if proration_date:
        payload["proration_date"] = str(proration_date)
        payload["metadata[stripe_proration_date]"] = str(proration_date)
    return payload


def stripe_amount_to_money(value: int | float | str | None) -> float:
    try:
        amount = Decimal(str(value or 0))
    except Exception:
        amount = MONEY_ZERO
    return float(quantize_money(amount / Decimal("100")))


def is_stripe_proration_line(line: dict) -> bool:
    parent = line.get("parent") if isinstance(line.get("parent"), dict) else {}
    subscription_item_details = parent.get("subscription_item_details")
    invoice_item_details = parent.get("invoice_item_details")
    if not isinstance(subscription_item_details, dict):
        subscription_item_details = {}
    if not isinstance(invoice_item_details, dict):
        invoice_item_details = {}
    return bool(
        line.get("proration")
        or subscription_item_details.get("proration")
        or invoice_item_details.get("proration")
    )


def serialize_stripe_invoice_preview(invoice: dict, proration_date: int) -> dict:
    lines = invoice.get("lines") if isinstance(invoice.get("lines"), dict) else {}
    line_rows = lines.get("data") if isinstance(lines, dict) else []
    proration_lines = []
    for line in line_rows or []:
        if not isinstance(line, dict) or not is_stripe_proration_line(line):
            continue
        proration_lines.append(
            {
                "id": line.get("id"),
                "descripcion": str(line.get("description") or "").strip(),
                "importe": stripe_amount_to_money(line.get("amount")),
                "currency": str(line.get("currency") or invoice.get("currency") or "").upper(),
                "periodo_inicio": line.get("period", {}).get("start")
                if isinstance(line.get("period"), dict)
                else None,
                "periodo_fin": line.get("period", {}).get("end")
                if isinstance(line.get("period"), dict)
                else None,
            }
        )

    return {
        "available": True,
        "id": invoice.get("id"),
        "currency": str(invoice.get("currency") or "").upper(),
        "amount_due": stripe_amount_to_money(invoice.get("amount_due")),
        "subtotal": stripe_amount_to_money(invoice.get("subtotal")),
        "total": stripe_amount_to_money(invoice.get("total")),
        "starting_balance": stripe_amount_to_money(invoice.get("starting_balance")),
        "ending_balance": stripe_amount_to_money(invoice.get("ending_balance")),
        "proration_date": proration_date,
        "lineas_prorrateo": proration_lines[:8],
    }


def build_stripe_plan_change_invoice_preview(
    *,
    secret_key: str,
    subscription: SuscripcionCapa,
    price_id: str,
    proration_date: int,
) -> dict:
    stripe_subscription = stripe_api_request(
        secret_key,
        "GET",
        f"/v1/subscriptions/{subscription.stripe_subscription_id}",
        params={"expand[]": "items.data.price"},
    )
    item_id = resolve_stripe_subscription_item_id(stripe_subscription)
    preview = stripe_api_request(
        secret_key,
        "POST",
        "/v1/invoices/create_preview",
        data={
            "subscription": subscription.stripe_subscription_id,
            "subscription_details[items][0][id]": item_id,
            "subscription_details[items][0][price]": price_id,
            "subscription_details[items][0][quantity]": "1",
            "subscription_details[proration_behavior]": "always_invoice",
            "subscription_details[proration_date]": str(proration_date),
        },
        params={"expand[]": "lines.data.parent.subscription_item_details"},
    )
    return serialize_stripe_invoice_preview(preview, proration_date)


def update_local_subscription_after_plan_change(
    subscription: SuscripcionCapa,
    change: CambioPlanSaaS,
    stripe_subscription: dict,
) -> SuscripcionCapa:
    if not stripe_subscription.get("pending_update"):
        subscription.plan = change.plan_nuevo
        subscription.periodicidad = change.periodicidad_nueva
    status_map = {
        "active": "ACTIVA",
        "trialing": "TRIAL",
        "past_due": "PAST_DUE",
        "unpaid": "PAST_DUE",
        "canceled": "CANCELADA",
        "paused": "PAUSADA",
        "incomplete": "PENDIENTE_PAGO",
    }
    subscription.estatus = status_map.get(
        str(stripe_subscription.get("status") or "").lower(),
        subscription.estatus,
    )
    if stripe_subscription.get("current_period_end"):
        subscription.fecha_fin_periodo_actual = datetime.fromtimestamp(
            int(stripe_subscription["current_period_end"]),
            tz=timezone.get_current_timezone(),
        ).date()
    if stripe_subscription.get("current_period_start") and not subscription.fecha_inicio:
        subscription.fecha_inicio = datetime.fromtimestamp(
            int(stripe_subscription["current_period_start"]),
            tz=timezone.get_current_timezone(),
        ).date()
    latest_invoice = stripe_subscription.get("latest_invoice")
    latest_invoice_id = latest_invoice.get("id") if isinstance(latest_invoice, dict) else latest_invoice
    subscription_metadata = {**(subscription.metadata or {})}
    subscription_metadata.pop("plan_change_pending", None)
    subscription.metadata = {
        **subscription_metadata,
        "last_plan_change": {
            "id": change.id,
            "plan_id": change.plan_nuevo_id,
            "periodicidad": change.periodicidad_nueva,
            "tipo": change.tipo,
            "modo": change.modo,
            "preferencia_credito": change.preferencia_credito,
            "stripe_invoice_id": latest_invoice_id,
            "updated_at": timezone.now().isoformat(),
        },
    }
    subscription.save()
    return subscription


def get_pending_plan_change_due_date(change: CambioPlanSaaS) -> date | None:
    metadata = change.metadata or {}
    pending_metadata = metadata.get("pendiente_renovacion")
    raw_date = None
    if isinstance(pending_metadata, dict):
        raw_date = pending_metadata.get("fecha_fin_periodo_actual")
    due_date = parse_date(str(raw_date)) if raw_date else None
    return due_date or change.suscripcion.fecha_fin_periodo_actual


def apply_pending_plan_change_at_renewal(
    change: CambioPlanSaaS,
    *,
    run_date: date | None = None,
    generated_by: str = "scheduled-plan-change",
    dry_run: bool = False,
) -> dict:
    run_date = run_date or timezone.localdate()
    subscription = change.suscripcion
    capa = subscription.capa_negocio
    due_date = get_pending_plan_change_due_date(change)
    result = {
        "change_id": change.id,
        "subscription_id": subscription.id,
        "capa_id": capa.id,
        "capa_nombre": capa.nombre,
        "due_date": due_date.isoformat() if due_date else None,
        "status": "SKIPPED",
        "reason": "",
        "dry_run": dry_run,
    }
    if change.estatus != "PENDIENTE_RENOVACION":
        result["reason"] = f"estatus={change.estatus}"
        return result
    if not due_date:
        result["reason"] = "sin_fecha_fin_periodo"
        return result
    if due_date > run_date:
        result["reason"] = "aun_no_vencido"
        return result

    stripe_mode = change.stripe_modo or get_active_stripe_mode()
    stripe_secret_key = get_stripe_secret_key_for_mode(stripe_mode)
    price_id = resolve_price_id_for_plan(
        change.plan_nuevo,
        change.periodicidad_nueva,
        stripe_mode=stripe_mode,
    )
    if not stripe_secret_key:
        message = f"Falta configurar Stripe en modo {stripe_mode}."
    elif not price_id:
        message = f"El plan no tiene Price ID para modo {stripe_mode}."
    elif not subscription.stripe_subscription_id:
        message = "La cuenta no tiene una suscripcion activa en Stripe."
    else:
        message = ""
    if message:
        if dry_run:
            result["status"] = "ERROR"
            result["reason"] = message
            return result
        change.estatus = "ERROR"
        change.detalle_error = message
        change.metadata = {
            **(change.metadata or {}),
            "renovacion_error": {
                "run_date": run_date.isoformat(),
                "generated_by": generated_by,
                "detalle": message,
            },
        }
        change.save(
            update_fields=[
                "estatus",
                "detalle_error",
                "metadata",
                "fecha_actualizacion",
            ]
        )
        mark_subscription_event(
            capa=capa,
            subscription=subscription,
            proveedor="SISTEMA",
            tipo_evento="subscription.plan_change.renewal_failed",
            referencia_externa=str(change.id),
            payload={"change_id": change.id, "error": message},
            estatus="ERROR",
            detalle_error=message,
        )
        result["status"] = "ERROR"
        result["reason"] = message
        return result

    if dry_run:
        result["status"] = "DUE"
        result["reason"] = "dry_run"
        result["price_id"] = price_id
        return result

    try:
        stripe_subscription = stripe_api_request(
            stripe_secret_key,
            "GET",
            f"/v1/subscriptions/{subscription.stripe_subscription_id}",
            params={"expand[]": "items.data.price"},
        )
        item_id = resolve_stripe_subscription_item_id(stripe_subscription)
        update_payload = build_stripe_plan_change_update_payload(
            item_id=item_id,
            price_id=price_id,
            capa=capa,
            subscription=subscription,
            change=change,
            stripe_mode=stripe_mode,
        )
        update_payload["proration_behavior"] = "none"
        update_payload["metadata[cambio_plan_aplicacion]"] = "renovacion_programada"
        update_payload["metadata[cambio_plan_aplicado_por]"] = generated_by
        stripe_subscription = stripe_api_request(
            stripe_secret_key,
            "POST",
            f"/v1/subscriptions/{subscription.stripe_subscription_id}",
            data=update_payload,
            params={"expand[]": "latest_invoice.payment_intent"},
        )
    except ValueError as exc:
        message = str(exc)[:1000]
        change.estatus = "ERROR"
        change.detalle_error = message
        change.metadata = {
            **(change.metadata or {}),
            "renovacion_error": {
                "run_date": run_date.isoformat(),
                "generated_by": generated_by,
                "detalle": message,
            },
        }
        change.save(
            update_fields=[
                "estatus",
                "detalle_error",
                "metadata",
                "fecha_actualizacion",
            ]
        )
        mark_subscription_event(
            capa=capa,
            subscription=subscription,
            proveedor="STRIPE",
            tipo_evento="subscription.plan_change.renewal_failed",
            referencia_externa=subscription.stripe_subscription_id,
            payload={"change_id": change.id, "error": message},
            estatus="ERROR",
            detalle_error=message,
        )
        result["status"] = "ERROR"
        result["reason"] = message
        return result

    latest_invoice = stripe_subscription.get("latest_invoice")
    latest_invoice_id = latest_invoice.get("id") if isinstance(latest_invoice, dict) else latest_invoice
    change.stripe_invoice_id = latest_invoice_id or change.stripe_invoice_id
    change.estatus = "EN_PROCESO" if stripe_subscription.get("pending_update") else "APLICADO"
    change.metadata = {
        **(change.metadata or {}),
        "renovacion_aplicada": {
            "run_date": run_date.isoformat(),
            "generated_by": generated_by,
            "price_id": price_id,
            "stripe_status": stripe_subscription.get("status"),
            "stripe_invoice_id": latest_invoice_id,
            "aplicado_en": timezone.now().isoformat(),
        },
        "stripe_subscription_update": stripe_subscription,
    }
    change.save(
        update_fields=[
            "estatus",
            "stripe_invoice_id",
            "metadata",
            "fecha_actualizacion",
        ]
    )
    subscription = update_local_subscription_after_plan_change(
        subscription,
        change,
        stripe_subscription,
    )
    mark_subscription_event(
        capa=capa,
        subscription=subscription,
        proveedor="STRIPE",
        tipo_evento="subscription.plan_change.renewal_applied",
        referencia_externa=subscription.stripe_subscription_id,
        payload={
            "change_id": change.id,
            "stripe_subscription": stripe_subscription,
        },
    )
    audit(
        actor=None,
        capa=capa,
        accion="SUSCRIPCION_CAMBIO_PLAN_RENOVACION_APLICADO",
        recurso_tipo="CambioPlanSaaS",
        recurso_id=change.id,
        metadata={
            "plan_id": change.plan_nuevo_id,
            "periodicidad": change.periodicidad_nueva,
            "generated_by": generated_by,
        },
    )
    result["status"] = change.estatus
    result["reason"] = "aplicado"
    result["price_id"] = price_id
    result["stripe_invoice_id"] = change.stripe_invoice_id
    return result


def run_pending_plan_changes_at_renewal(
    *,
    run_date: date | None = None,
    generated_by: str = "scheduled-plan-change",
    dry_run: bool = False,
    limit: int | None = None,
) -> dict:
    run_date = run_date or timezone.localdate()
    queryset = (
        CambioPlanSaaS.objects.select_related(
            "suscripcion__capa_negocio",
            "plan_anterior",
            "plan_nuevo",
        )
        .filter(estatus="PENDIENTE_RENOVACION")
        .order_by("fecha_creacion", "id")
    )
    if limit:
        queryset = queryset[:limit]

    results = []
    for change in queryset:
        with transaction.atomic():
            locked_change = (
                CambioPlanSaaS.objects.select_for_update()
                .select_related("suscripcion__capa_negocio", "plan_anterior", "plan_nuevo")
                .get(id=change.id)
            )
            results.append(
                apply_pending_plan_change_at_renewal(
                    locked_change,
                    run_date=run_date,
                    generated_by=generated_by,
                    dry_run=dry_run,
                )
            )

    return {
        "run_date": run_date.isoformat(),
        "reviewed": len(results),
        "due": sum(1 for item in results if item["status"] in {"DUE", "APLICADO", "EN_PROCESO", "ERROR"}),
        "applied": sum(1 for item in results if item["status"] == "APLICADO"),
        "in_process": sum(1 for item in results if item["status"] == "EN_PROCESO"),
        "errors": sum(1 for item in results if item["status"] == "ERROR"),
        "skipped": sum(1 for item in results if item["status"] == "SKIPPED"),
        "dry_run": dry_run,
        "items": results,
    }


def find_plan_change_from_stripe_event(
    subscription: SuscripcionCapa | None,
    data: dict,
) -> CambioPlanSaaS | None:
    metadata = data.get("metadata") if isinstance(data.get("metadata"), dict) else {}
    subscription_details = data.get("subscription_details")
    if isinstance(subscription_details, dict) and isinstance(
        subscription_details.get("metadata"),
        dict,
    ):
        metadata = {**metadata, **subscription_details["metadata"]}
    raw_change_id = metadata.get("cambio_plan_id")
    if raw_change_id:
        return CambioPlanSaaS.objects.filter(id=raw_change_id).first()
    if not subscription:
        return None
    return (
        CambioPlanSaaS.objects.filter(
            suscripcion=subscription,
            estatus__in=["EN_PROCESO", "REEMBOLSO_SOLICITADO"],
        )
        .order_by("-fecha_creacion", "-id")
        .first()
    )


def validate_stripe_signature(payload: bytes, signature_header: str | None) -> None:
    webhook_secret = get_stripe_webhook_secret_for_mode(get_active_stripe_mode())
    if not webhook_secret:
        return
    header = (signature_header or "").strip()
    if not header:
        raise HttpError(401, "Falta la firma del webhook de Stripe.")

    fragments = dict(
        part.split("=", 1)
        for part in header.split(",")
        if "=" in part
    )
    timestamp = fragments.get("t")
    signature = fragments.get("v1")
    if not timestamp or not signature:
        raise HttpError(401, "La firma del webhook de Stripe es invalida.")

    signed_payload = f"{timestamp}.{payload.decode('utf-8', errors='ignore')}".encode("utf-8")
    expected_signature = hmac.new(
        webhook_secret.encode("utf-8"),
        signed_payload,
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(expected_signature, signature):
        raise HttpError(401, "La firma del webhook de Stripe no coincide.")


def already_processed_stripe_event(provider_reference: str) -> bool:
    reference = (provider_reference or "").strip()
    if not reference:
        return False
    return EventoBilling.objects.filter(
        proveedor="STRIPE",
        referencia_externa=reference,
        estatus="PROCESADO",
    ).exists()


def resolve_sales_contact_email() -> str:
    return (
        (getattr(settings, "SALES_CONTACT_EMAIL", "") or "").strip()
        or (getattr(settings, "RESEND_REPLY_TO", "") or "").strip()
        or (getattr(settings, "DEFAULT_FROM_EMAIL", "") or "").strip()
    )


def resolve_operations_notify_email() -> str:
    return (
        (getattr(settings, "BETTERP_OPERATIONS_NOTIFY_EMAIL", "") or "").strip()
        or (getattr(settings, "BETTERP_SALES_NOTIFY_EMAIL", "") or "").strip()
        or (getattr(settings, "SALES_CONTACT_EMAIL", "") or "").strip()
    )


def build_prospect_notification_message(prospect: ProspectoComercial) -> str:
    solution = getattr(prospect, "solution", None)
    metadata = prospect.metadata or {}
    qualification = (
        metadata.get("lead_qualification")
        if isinstance(metadata, dict)
        else {}
    )
    lines = [
        "Nuevo prospecto capturado desde el landing de BettERP.",
        "",
        f"Nombre: {prospect.nombre}",
        f"Empresa: {prospect.empresa or 'No capturada'}",
        f"Correo: {prospect.email}",
        f"Telefono: {prospect.telefono or 'No capturado'}",
        f"Origen: {prospect.origen}",
        f"Solucion: {solution.nombre if solution else 'No clasificada'}",
        (
            "Calificacion: "
            f"{qualification.get('quality')} ({qualification.get('score')}/100)"
            if isinstance(qualification, dict) and qualification
            else "Calificacion: No capturada"
        ),
        (
            f"Perfil: {qualification.get('summary')}"
            if isinstance(qualification, dict) and qualification.get("summary")
            else "Perfil: No capturado"
        ),
        "",
        "Mensaje:",
        prospect.mensaje or "Sin mensaje adicional.",
    ]
    return "\n".join(lines)


def normalize_solution_key(value: str) -> str:
    key = slugify(value or "").replace("-", "_")
    aliases = {
        "posqr": SOLUTION_POS_QR_KEY,
        "pos": SOLUTION_POS_QR_KEY,
        "betterp_pos": SOLUTION_POS_QR_KEY,
        "betterp_pos_qr": SOLUTION_POS_QR_KEY,
    }
    return aliases.get(key, key)


LEAD_UTM_FIELDS = (
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_content",
    "utm_term",
)

logger = logging.getLogger(__name__)

LEAD_QUALIFICATION_LABELS = {
    "operation_type": {
        "condominios": "Condominios",
        "espacios_renta": "Espacios en renta",
        "coliving": "Coliving / habitaciones",
        "oficinas_cowork": "Oficinas / cowork",
        "bodegas_estacionamientos": "Bodegas / estacionamientos",
        "otro": "Otro",
    },
    "spaces_count": {
        "1_10": "1 a 10 espacios",
        "11_50": "11 a 50 espacios",
        "51_150": "51 a 150 espacios",
        "150_plus": "Mas de 150 espacios",
    },
    "collection_method": {
        "manual_calls_messages": "Llamadas, correos o mensajes",
        "sheets_bank": "Hojas de calculo y banco",
        "mixed_system": "Sistema actual con trabajo manual",
        "no_recurrent": "Sin cobranza recurrente",
    },
    "main_pain": {
        "overdue_accounts": "Cuentas vencidas",
        "pending_rents": "Rentas pendientes",
        "unregistered_payments": "Pagos no registrados",
        "self_service": "Autoservicio para clientes",
        "real_time_control": "Control en tiempo real",
    },
    "urgency": {
        "this_week": "Esta semana",
        "this_month": "Este mes",
        "this_quarter": "Este trimestre",
        "exploring": "Solo explorando",
    },
}

LEAD_QUALIFICATION_SCORES = {
    "operation_type": {
        "condominios": 35,
        "espacios_renta": 35,
        "coliving": 32,
        "oficinas_cowork": 28,
        "bodegas_estacionamientos": 24,
        "otro": 8,
    },
    "spaces_count": {
        "1_10": 10,
        "11_50": 18,
        "51_150": 24,
        "150_plus": 25,
    },
    "collection_method": {
        "manual_calls_messages": 25,
        "sheets_bank": 22,
        "mixed_system": 15,
        "no_recurrent": 0,
    },
    "main_pain": {
        "overdue_accounts": 15,
        "pending_rents": 15,
        "unregistered_payments": 15,
        "self_service": 10,
        "real_time_control": 10,
    },
    "urgency": {
        "this_week": 10,
        "this_month": 8,
        "this_quarter": 4,
        "exploring": 1,
    },
}


def build_lead_utm_metadata(payload: ProspectLeadIn) -> dict[str, str]:
    utm_values: dict[str, str] = {}
    for field in LEAD_UTM_FIELDS:
        value = (getattr(payload, field, "") or "").strip()
        if value:
            utm_values[field] = value[:180]
    return utm_values


def build_lead_attribution_metadata(payload: ProspectLeadIn) -> dict[str, str]:
    fields = {
        "landing_url": 500,
        "landing_referrer": 500,
        "first_touch_at": 80,
    }
    attribution: dict[str, str] = {}
    for field, limit in fields.items():
        value = str(getattr(payload, field, "") or "").strip()
        if value:
            attribution[field] = value[:limit]
    if attribution:
        attribution["source"] = "landing_client"
    return attribution


def build_lead_qualification_metadata(payload: ProspectLeadIn) -> dict[str, object]:
    qualification: dict[str, object] = {}
    score = 0
    for field, labels in LEAD_QUALIFICATION_LABELS.items():
        raw_value = (getattr(payload, field, "") or "").strip().lower()
        if raw_value not in labels:
            continue
        qualification[field] = raw_value
        qualification[f"{field}_label"] = labels[raw_value]
        score += LEAD_QUALIFICATION_SCORES.get(field, {}).get(raw_value, 0)

    if not qualification:
        return {}

    score = min(score, 100)
    if score >= 70:
        quality = "ALTA"
    elif score >= 45:
        quality = "MEDIA"
    else:
        quality = "BAJA"
    qualification["score"] = score
    qualification["quality"] = quality
    qualification["qualified"] = score >= 60
    qualification["summary"] = " | ".join(
        str(qualification.get(key) or "")
        for key in (
            "operation_type_label",
            "spaces_count_label",
            "collection_method_label",
            "main_pain_label",
            "urgency_label",
        )
        if qualification.get(key)
    )
    return qualification


def resolve_public_lead_solution(solution_key: str) -> Solucion | None:
    key = normalize_solution_key(solution_key)
    if not key:
        return None
    ensure_default_solutions()
    return Solucion.objects.filter(clave=key).first()


def resolve_admin_prospect_solution(solution_key: str) -> Solucion | None:
    key = normalize_solution_key(solution_key)
    if key in {"", "sin_clasificar", "sin_solucion", "none", "null"}:
        return None
    ensure_default_solutions()
    solution = Solucion.objects.filter(clave=key).first()
    if not solution:
        raise HttpError(400, "La solucion indicada no existe en el catalogo.")
    return solution


def serialize_inbound_case_admin(caso: CasoProcesamiento) -> dict:
    metadata = caso.metadata or {}
    nota_admin = metadata.get("nota_admin") if isinstance(metadata, dict) else None
    return {
        "id": caso.id,
        "canal": caso.canal,
        "estatus": caso.estatus,
        "remitente": caso.remitente,
        "remitente_nombre": caso.remitente_nombre,
        "cliente_id": caso.cliente_relacionado_id,
        "cliente_nombre": (
            caso.cliente_relacionado.razon_social or caso.cliente_relacionado.nombre_comercial
            if caso.cliente_relacionado
            else None
        ),
        "entidad_id": caso.entidad_relacionada_id,
        "entidad_nombre": (
            caso.entidad_relacionada.nombre_comercial
            if caso.entidad_relacionada
            else None
        ),
        "subject": metadata.get("subject") if isinstance(metadata, dict) else None,
        "texto_resumen": caso.texto_consolidado or caso.caption_consolidado or "",
        "grupo_externo_id": caso.grupo_externo_id,
        "mensajes_count": getattr(caso, "mensajes_count", 0),
        "evidencias_count": getattr(caso, "evidencias_count", 0),
        "nota_admin": nota_admin,
        "fecha_ultimo_mensaje": caso.fecha_ultimo_mensaje,
        "fecha_registro": caso.fecha_registro,
    }


def serialize_payment_request_admin(evidencia: EvidenciaPago) -> dict:
    return {
        "id": evidencia.id,
        "estatus": evidencia.estatus,
        "tipo_movimiento": evidencia.tipo_movimiento,
        "canal": evidencia.canal,
        "entidad_id": evidencia.entidad_relacionada_id,
        "entidad_nombre": (
            evidencia.entidad_relacionada.nombre_comercial
            if evidencia.entidad_relacionada
            else None
        ),
        "cliente_id": evidencia.cliente_relacionado_id,
        "cliente_nombre": (
            evidencia.cliente_relacionado.razon_social or evidencia.cliente_relacionado.nombre_comercial
            if evidencia.cliente_relacionado
            else None
        ),
        "caso_id": evidencia.caso_relacionado_id,
        "remitente": evidencia.caso_relacionado.remitente if evidencia.caso_relacionado else None,
        "monto_reportado": float(evidencia.monto_reportado or Decimal("0")),
        "fecha_pago_reportada": evidencia.fecha_pago_reportada,
        "referencia_reportada": evidencia.referencia_reportada,
        "requiere_revision_manual": evidencia.requiere_revision_manual,
        "observaciones": evidencia.observaciones,
        "texto_extraido": evidencia.texto_extraido,
        "url_archivo": evidencia.url_archivo,
        "fecha_registro": evidencia.fecha_registro,
    }


def resolve_uploaded_file_url(url: str | None) -> str | None:
    if not url:
        return None
    if url.startswith("http://") or url.startswith("https://"):
        return url
    backend_base = (getattr(settings, "BACKEND_PUBLIC_BASE_URL", "") or "").rstrip("/")
    if backend_base:
        return f"{backend_base}{url}"
    return url


def safe_decimal(value) -> Decimal:
    if value is None or value == "":
        return Decimal("0")
    try:
        return Decimal(str(value))
    except Exception:
        return Decimal("0")


def extract_stripe_amount(payload: dict | None) -> Decimal:
    if not isinstance(payload, dict):
        return Decimal("0")
    stripe_object = payload.get("data", {}).get("object", payload)
    if not isinstance(stripe_object, dict):
        return Decimal("0")
    for key in (
        "amount_paid",
        "amount_total",
        "amount_received",
        "total",
        "amount_due",
    ):
        if key not in stripe_object:
            continue
        amount = safe_decimal(stripe_object.get(key))
        if amount <= 0:
            continue
        return (amount / Decimal("100")).quantize(Decimal("0.01"))
    return Decimal("0")


def stripe_object_id(payload: dict | None) -> str | None:
    if not isinstance(payload, dict):
        return None
    stripe_object = payload.get("data", {}).get("object", payload)
    if not isinstance(stripe_object, dict):
        return None
    return stripe_object.get("id") or stripe_object.get("payment_intent")


def stripe_paid_events(start_at=None, end_at=None) -> list[EventoBilling]:
    invoice_types = {"invoice.payment_succeeded", "invoice.paid"}
    checkout_types = {"checkout.session.completed"}
    base_qs = EventoBilling.objects.filter(proveedor="STRIPE", estatus="PROCESADO")
    if start_at:
        base_qs = base_qs.filter(fecha_creacion__gte=start_at)
    if end_at:
        base_qs = base_qs.filter(fecha_creacion__lt=end_at)

    invoice_events = list(base_qs.filter(tipo_evento__in=invoice_types))
    source_events = invoice_events or list(base_qs.filter(tipo_evento__in=checkout_types))
    unique_events: list[EventoBilling] = []
    seen_references: set[str] = set()
    for event in source_events:
        reference = stripe_object_id(event.payload) or event.referencia_externa or str(event.id)
        if reference in seen_references:
            continue
        seen_references.add(reference)
        unique_events.append(event)
    return unique_events


def stripe_paid_total(start_at=None, end_at=None) -> Decimal:
    source_events = stripe_paid_events(start_at, end_at)
    return sum(
        (extract_stripe_amount(event.payload) for event in source_events),
        Decimal("0"),
    ).quantize(Decimal("0.01"))


def payload_metric_value(payload, metric_keys: set[str]) -> int:
    if isinstance(payload, dict):
        total = 0
        for key, value in payload.items():
            if str(key).lower() in metric_keys:
                try:
                    total += int(value or 0)
                    continue
                except Exception:
                    pass
            total += payload_metric_value(value, metric_keys)
        return total
    if isinstance(payload, list):
        return sum(payload_metric_value(item, metric_keys) for item in payload)
    return 0


def payload_money_value(payload, metric_keys: set[str]) -> Decimal:
    if isinstance(payload, dict):
        total = Decimal("0")
        for key, value in payload.items():
            if str(key).lower() in metric_keys:
                try:
                    total += Decimal(str(value or 0))
                    continue
                except Exception:
                    pass
            total += payload_money_value(value, metric_keys)
        return total
    if isinstance(payload, list):
        return sum(
            (payload_money_value(item, metric_keys) for item in payload),
            Decimal("0"),
        )
    return Decimal("0")






def clamp_marketing_metric(value: int | float | None) -> int:
    try:
        parsed = int(value or 0)
    except (TypeError, ValueError):
        parsed = 0
    return max(parsed, 0)


def normalize_marketing_traffic_type(value: str | None, *, spend: Decimal | None = None) -> str:
    normalized = (value or "").strip().lower()
    aliases = {
        "organico": "organic",
        "organica": "organic",
        "organic": "organic",
        "paid": "paid",
        "pagado": "paid",
        "pagada": "paid",
        "pauta": "paid",
        "mixed": "mixed",
        "mixto": "mixed",
        "mixta": "mixed",
    }
    if normalized in aliases:
        return aliases[normalized]
    if spend and spend > 0:
        return "paid"
    return "organic"


def normalize_marketing_metric_date(value: str | None) -> str:
    raw_value = (value or "").strip()
    if not raw_value:
        return ""
    parsed = parse_date(raw_value)
    return parsed.isoformat() if parsed else ""












def prospect_utm_metadata(prospect: ProspectoComercial) -> dict[str, str]:
    metadata = prospect.metadata or {}
    utm = metadata.get("utm") if isinstance(metadata, dict) else {}
    return utm if isinstance(utm, dict) else {}


def prospect_lead_qualification(prospect: ProspectoComercial) -> dict:
    metadata = prospect.metadata or {}
    qualification = metadata.get("lead_qualification") if isinstance(metadata, dict) else {}
    return qualification if isinstance(qualification, dict) else {}


def build_marketing_prospect_pipeline(prospects: list[ProspectoComercial]) -> dict:
    open_stages = {"NUEVO", "CONTACTADO", "DEMO", "PROPUESTA"}
    stage_labels = dict(ProspectoComercial.ETAPA_CHOICES)
    origin_labels = dict(ProspectoComercial.ORIGEN_CHOICES)
    by_stage = {
        key: {"etapa": key, "label": label, "total": 0}
        for key, label in ProspectoComercial.ETAPA_CHOICES
    }
    by_origin: dict[str, dict[str, int | str]] = {}
    by_utm_content: dict[str, dict[str, int | str]] = {}
    by_qualification: dict[str, dict[str, int | str]] = {
        "ALTA": {"quality": "ALTA", "label": "Alta", "total": 0},
        "MEDIA": {"quality": "MEDIA", "label": "Media", "total": 0},
        "BAJA": {"quality": "BAJA", "label": "Baja", "total": 0},
        "SIN_DATOS": {"quality": "SIN_DATOS", "label": "Sin datos", "total": 0},
    }
    by_audience: dict[str, dict[str, int | str]] = {}
    for prospect in prospects:
        by_stage.setdefault(
            prospect.etapa,
            {"etapa": prospect.etapa, "label": stage_labels.get(prospect.etapa, prospect.etapa), "total": 0},
        )
        by_stage[prospect.etapa]["total"] += 1

        origin = prospect.origen or "SIN_ORIGEN"
        by_origin.setdefault(
            origin,
            {"origen": origin, "label": origin_labels.get(origin, origin), "total": 0},
        )
        by_origin[origin]["total"] += 1

        utm = prospect_utm_metadata(prospect)
        content = str(utm.get("utm_content") or "sin_utm").strip() or "sin_utm"
        by_utm_content.setdefault(
            content,
            {
                "utm_content": content,
                "utm_source": str(utm.get("utm_source") or ""),
                "utm_campaign": str(utm.get("utm_campaign") or ""),
                "total": 0,
            },
        )
        by_utm_content[content]["total"] += 1

        qualification = prospect_lead_qualification(prospect)
        quality = str(qualification.get("quality") or "SIN_DATOS").upper()
        if quality not in by_qualification:
            quality = "SIN_DATOS"
        by_qualification[quality]["total"] += 1
        audience_key = str(qualification.get("operation_type") or "sin_datos")
        audience_label = str(qualification.get("operation_type_label") or "Sin datos")
        by_audience.setdefault(
            audience_key,
            {"audience": audience_key, "label": audience_label, "total": 0},
        )
        by_audience[audience_key]["total"] += 1

    return {
        "total": len(prospects),
        "open": sum(1 for prospect in prospects if prospect.etapa in open_stages),
        "new": sum(1 for prospect in prospects if prospect.etapa == "NUEVO"),
        "demos": sum(1 for prospect in prospects if prospect.etapa == "DEMO"),
        "won": sum(1 for prospect in prospects if prospect.etapa == "GANADO"),
        "lost": sum(1 for prospect in prospects if prospect.etapa == "PERDIDO"),
        "qualified": sum(
            1
            for prospect in prospects
            if prospect_lead_qualification(prospect).get("qualified") is True
        ),
        "by_stage": list(by_stage.values()),
        "by_origin": sorted(
            by_origin.values(),
            key=lambda item: (-int(item["total"]), str(item["origen"])),
        ),
        "by_utm_content": sorted(
            by_utm_content.values(),
            key=lambda item: (-int(item["total"]), str(item["utm_content"])),
        )[:8],
        "by_qualification": list(by_qualification.values()),
        "by_audience": sorted(
            by_audience.values(),
            key=lambda item: (-int(item["total"]), str(item["audience"])),
        )[:8],
        "daily_routine": [
            "Contactar prospectos NUEVO antes de 24 horas.",
            "Priorizar leads ALTA/MEDIA antes de invertir mas presupuesto.",
            "Mover CONTACTADO a DEMO o PERDIDO con nota concreta.",
            "Registrar objecion principal despues de cada demo o rechazo.",
            "Revisar UTMs con mas leads antes de generar la siguiente tanda.",
        ],
    }




def normalize_plan_clave(raw_clave: str, nombre: str, existing_plan_id: int | None = None) -> str:
    base = slugify((raw_clave or "").strip()) or slugify(nombre) or "plan-personalizado"
    candidate = base
    suffix = 2
    while PlanSaaS.objects.exclude(id=existing_plan_id).filter(clave=candidate).exists():
        candidate = f"{base}-{suffix}"
        suffix += 1
    return candidate


def sanitize_plan_keys(raw_keys: list[str], definitions: list[dict], field_label: str) -> list[str]:
    valid_keys = {item["clave"] for item in definitions}
    clean_keys: list[str] = []
    invalid_keys: list[str] = []
    for raw_key in raw_keys or []:
        key = str(raw_key or "").strip()
        if not key:
            continue
        if key not in valid_keys:
            invalid_keys.append(key)
            continue
        if key not in clean_keys:
            clean_keys.append(key)
    if invalid_keys:
        raise HttpError(
            400,
            f"{field_label} contiene valores no validos: {', '.join(invalid_keys[:5])}.",
        )
    return clean_keys


def build_subscription_capability_overrides(
    payload: AdminSubscriptionCapabilityOverridesIn,
) -> dict:
    added_modules = sanitize_plan_keys(
        payload.modulos_agregados,
        PLAN_MODULE_DEFINITIONS,
        "modulos_agregados",
    )
    blocked_modules = sanitize_plan_keys(
        payload.modulos_bloqueados,
        PLAN_MODULE_DEFINITIONS,
        "modulos_bloqueados",
    )
    added_features = sanitize_plan_keys(
        payload.funciones_agregadas,
        PLAN_FEATURE_DEFINITIONS,
        "funciones_agregadas",
    )
    blocked_features = sanitize_plan_keys(
        payload.funciones_bloqueadas,
        PLAN_FEATURE_DEFINITIONS,
        "funciones_bloqueadas",
    )
    module_conflicts = sorted(set(added_modules) & set(blocked_modules))
    feature_conflicts = sorted(set(added_features) & set(blocked_features))
    if module_conflicts:
        raise HttpError(
            400,
            f"No puedes agregar y bloquear el mismo modulo: {', '.join(module_conflicts[:5])}.",
        )
    if feature_conflicts:
        raise HttpError(
            400,
            f"No puedes agregar y bloquear la misma funcion: {', '.join(feature_conflicts[:5])}.",
        )
    note = (payload.nota or "").strip()
    has_overrides = any([added_modules, blocked_modules, added_features, blocked_features])
    if has_overrides and not note:
        raise HttpError(
            400,
            "Debes indicar una nota interna para justificar los overrides del cliente.",
        )
    return {
        "modulos_agregados": added_modules,
        "modulos_bloqueados": blocked_modules,
        "funciones_agregadas": added_features,
        "funciones_bloqueadas": blocked_features,
        "nota": note,
        "actualizado_en": timezone.now().isoformat(),
    }


MANAGED_MARKETING_SCOPE_CHOICES = {
    "CONTENIDO": "Contenido",
    "PUBLICACION": "Publicacion",
    "PAUTA": "Pauta",
    "COMPLETO": "Operacion completa",
    "SOPORTE": "Soporte puntual",
}


def payload_includes_managed_marketing(
    payload: AdminSubscriptionCapabilityOverridesIn,
) -> bool:
    return any(
        value is not None
        for value in (
            payload.managed_marketing_enabled,
            payload.managed_marketing_scope,
            payload.managed_marketing_responsable,
            payload.managed_marketing_nota,
        )
    )


def normalize_managed_marketing_scope(value: str | None) -> str:
    scope = (value or "").strip().upper()
    if not scope:
        return ""
    if scope not in MANAGED_MARKETING_SCOPE_CHOICES:
        raise HttpError(
            400,
            "El alcance de MKT administrado no es valido.",
        )
    return scope




def normalize_admin_subscription_status(value: str | None) -> str:
    requested = (value or "").strip().upper()
    valid_statuses = {choice for choice, _ in SuscripcionCapa.ESTATUS_CHOICES}
    if requested not in valid_statuses:
        raise HttpError(400, "Estatus de suscripcion invalido.")
    return requested


def normalize_admin_capa_type(value: str | None) -> str:
    requested = (value or "EMPRESA").strip().upper()
    valid_types = {choice for choice, _ in CapaNegocio.TIPO_CAPA_CHOICES}
    if requested not in valid_types:
        raise HttpError(400, "Tipo de capa invalido.")
    return requested


def normalize_commercial_followup_status(value: str | None) -> str:
    requested = (value or "SIN_SEGUIMIENTO").strip().upper()
    if requested not in COMMERCIAL_FOLLOWUP_STATUSES:
        raise HttpError(400, "Estado de seguimiento comercial invalido.")
    return requested


def normalize_commercial_followup_priority(value: str | None) -> str:
    requested = (value or "MEDIA").strip().upper()
    if requested not in COMMERCIAL_FOLLOWUP_PRIORITIES:
        raise HttpError(400, "Prioridad de seguimiento comercial invalida.")
    return requested


def build_commercial_followup_metadata(
    payload: AdminSubscriptionProvisionIn | AdminSubscriptionCommercialUpdateIn,
    *,
    actor_label: str,
) -> dict:
    status = normalize_commercial_followup_status(payload.seguimiento_estado)
    priority = normalize_commercial_followup_priority(payload.seguimiento_prioridad)
    target_date = payload.seguimiento_fecha
    result = (payload.seguimiento_resultado or "").strip()
    responsible = (payload.seguimiento_responsable or "").strip()
    has_tracking = any([responsible, target_date, result]) or status != "SIN_SEGUIMIENTO"
    return {
        "estado": status if has_tracking else "SIN_SEGUIMIENTO",
        "prioridad": priority,
        "responsable": responsible,
        "fecha_objetivo": target_date.isoformat() if target_date else None,
        "resultado_esperado": result,
        "actualizado_por": actor_label,
        "actualizado_en": timezone.now().isoformat(),
    }


def resolve_admin_subscription_window(
    plan: PlanSaaS,
    *,
    status: str,
    periodicidad: str,
    fecha_inicio: date | None,
    fecha_fin_periodo_actual: date | None,
) -> tuple[date | None, date | None]:
    start = fecha_inicio
    end = fecha_fin_periodo_actual
    if status in {"TRIAL", "ACTIVA", "PAST_DUE"} and start is None:
        start = timezone.localdate()
    if end is None and start is not None:
        if status == "TRIAL":
            trial_days = max(int(plan.dias_prueba or 0), 0)
            end = start + timedelta(days=trial_days)
        elif status in {"ACTIVA", "PAST_DUE"}:
            end = start + timedelta(days=365 if periodicidad == "ANUAL" else 30)
    if start and end and end < start:
        raise HttpError(400, "La fecha fin no puede ser anterior a la fecha de inicio.")
    return start, end


def resolve_plan_solution(payload: AdminPlanUpsertIn, existing_plan_id: int | None = None) -> Solucion:
    ensure_default_solutions()
    if payload.solution_id:
        solution = Solucion.objects.filter(id=payload.solution_id).first()
        if not solution:
            raise HttpError(400, "La solucion seleccionada no existe.")
        return solution
    if existing_plan_id:
        current_plan = PlanSaaS.objects.select_related("solution").filter(id=existing_plan_id).first()
        if current_plan and current_plan.solution_id:
            return current_plan.solution
    return get_default_solution()


def build_plan_defaults(payload: AdminPlanUpsertIn, existing_plan_id: int | None = None) -> dict:
    nombre = (payload.nombre or "").strip()
    if not nombre:
        raise HttpError(400, "Debes indicar el nombre del plan.")
    if payload.max_usuarios < 1 or payload.max_entidades < 1 or payload.max_productos < 1:
        raise HttpError(400, "Los limites del plan deben ser mayores a cero.")
    if int(payload.dias_prueba or 0) < 0:
        raise HttpError(400, "Los dias de prueba no pueden ser negativos.")
    usage_limits = [
        payload.openai_tokens_incluidos,
        payload.whatsapp_mensajes_incluidos,
        payload.comprobantes_whatsapp_incluidos,
        payload.timbres_facturacion_incluidos,
        payload.emails_incluidos,
    ]
    usage_prices = [
        payload.precio_openai_1k_tokens_extra,
        payload.precio_whatsapp_mensaje_extra,
        payload.precio_comprobante_whatsapp_extra,
        payload.precio_timbre_facturacion_extra,
        payload.precio_email_extra,
    ]
    if any(int(value or 0) < 0 for value in usage_limits):
        raise HttpError(400, "Los incluidos de consumo no pueden ser negativos.")
    if any(Decimal(str(value or 0)) < 0 for value in usage_prices):
        raise HttpError(400, "Los precios de excedente no pueden ser negativos.")
    solution = resolve_plan_solution(payload, existing_plan_id=existing_plan_id)

    return {
        "solution": solution,
        "clave": normalize_plan_clave(payload.clave, nombre, existing_plan_id=existing_plan_id),
        "nombre": nombre,
        "descripcion": (payload.descripcion or "").strip() or None,
        "precio_mensual": Decimal(str(payload.precio_mensual or 0)),
        "precio_anual": Decimal(str(payload.precio_anual or 0)),
        "max_usuarios": payload.max_usuarios,
        "max_entidades": payload.max_entidades,
        "max_productos": payload.max_productos,
        "dias_prueba": int(payload.dias_prueba or 0),
        "openai_tokens_incluidos": int(payload.openai_tokens_incluidos or 0),
        "whatsapp_mensajes_incluidos": int(payload.whatsapp_mensajes_incluidos or 0),
        "comprobantes_whatsapp_incluidos": int(
            payload.comprobantes_whatsapp_incluidos or 0
        ),
        "timbres_facturacion_incluidos": int(payload.timbres_facturacion_incluidos or 0),
        "emails_incluidos": int(payload.emails_incluidos or 0),
        "precio_openai_1k_tokens_extra": Decimal(
            str(payload.precio_openai_1k_tokens_extra or 0)
        ),
        "precio_whatsapp_mensaje_extra": Decimal(
            str(payload.precio_whatsapp_mensaje_extra or 0)
        ),
        "precio_comprobante_whatsapp_extra": Decimal(
            str(payload.precio_comprobante_whatsapp_extra or 0)
        ),
        "precio_timbre_facturacion_extra": Decimal(
            str(payload.precio_timbre_facturacion_extra or 0)
        ),
        "precio_email_extra": Decimal(str(payload.precio_email_extra or 0)),
        "activo": bool(payload.activo),
        "es_default": bool(payload.es_default),
        "permite_google_login": bool(payload.permite_google_login),
        "permite_webhooks": bool(payload.permite_webhooks),
        "modulos_habilitados": sanitize_plan_keys(
            payload.modulos_habilitados,
            PLAN_MODULE_DEFINITIONS,
            "modulos_habilitados",
        ),
        "funciones_habilitadas": sanitize_plan_keys(
            payload.funciones_habilitadas,
            PLAN_FEATURE_DEFINITIONS,
            "funciones_habilitadas",
        ),
        "stripe_test_price_id_mensual": (
            payload.stripe_test_price_id_mensual or ""
        ).strip()
        or None,
        "stripe_test_price_id_anual": (
            payload.stripe_test_price_id_anual or ""
        ).strip()
        or None,
        "stripe_price_id_mensual": (payload.stripe_price_id_mensual or "").strip() or None,
        "stripe_price_id_anual": (payload.stripe_price_id_anual or "").strip() or None,
    }


def clear_default_plans_for_solution(solution: Solucion | None, *, exclude_plan_id: int | None = None) -> int:
    queryset = PlanSaaS.objects.filter(solution=solution)
    if exclude_plan_id:
        queryset = queryset.exclude(id=exclude_plan_id)
    return queryset.update(es_default=False)






MARKETING_CAMPAIGN_SOLUTION_LABELS = {
    "betterp": "BetterP",
    "renta_facil": "Renta Facil",
    "tienda_facil": "BetterP Commerce",
    "pos_qr": "BetterP POS QR",
    "restaurantes": "BetterP Restaurantes",
    "b2b": "BetterP B2B",
}




def parse_optional_date(value: str | None, field_label: str) -> date | None:
    raw_value = (value or "").strip()
    if not raw_value:
        return None
    parsed = parse_date(raw_value)
    if not parsed:
        raise HttpError(400, f"{field_label} debe venir en formato YYYY-MM-DD.")
    return parsed


def decimal_percent(value: float | int | Decimal | None) -> Decimal:
    amount = Decimal(str(value or 0))
    if amount < 0 or amount > 100:
        raise HttpError(400, "El porcentaje de comision debe estar entre 0 y 100.")
    return amount.quantize(Decimal("0.01"))


def monthly_revenue_for_subscription(subscription: SuscripcionCapa) -> Decimal:
    if subscription.estatus in {"CANCELADA", "PAUSADA"}:
        return Decimal("0")
    if subscription.periodicidad == "ANUAL":
        annual_price = Decimal(subscription.plan.precio_anual or 0)
        return (annual_price / Decimal("12")).quantize(Decimal("0.01"))
    return Decimal(subscription.plan.precio_mensual or 0).quantize(Decimal("0.01"))


def date_window_is_active(start_date: date | None, end_date: date | None) -> bool:
    today = timezone.localdate()
    if start_date and start_date > today:
        return False
    if end_date and end_date < today:
        return False
    return True


def assignment_commission_active(assignment: AsignacionComercialSaaS | None) -> bool:
    if not assignment or not assignment.comision_activa or not assignment.vendedor_id:
        return False
    if not assignment.vendedor.activo:
        return False
    return date_window_is_active(assignment.fecha_inicio, assignment.fecha_fin)


def get_sales_assignment(subscription: SuscripcionCapa) -> AsignacionComercialSaaS | None:
    try:
        return subscription.asignacion_comercial
    except AsignacionComercialSaaS.DoesNotExist:
        return None


def operational_cost_active(cost: CostoOperativoSaaS) -> bool:
    return bool(cost.activo and date_window_is_active(cost.fecha_inicio, cost.fecha_fin))


def sales_metrics_for_subscription(subscription: SuscripcionCapa) -> dict:
    revenue = monthly_revenue_for_subscription(subscription)
    costs = sum(
        (Decimal(cost.monto_mensual or 0) for cost in subscription.costos_operativos.all() if operational_cost_active(cost)),
        Decimal("0"),
    ).quantize(Decimal("0.01"))
    gross_profit = (revenue - costs).quantize(Decimal("0.01"))
    assignment = get_sales_assignment(subscription)
    commission = Decimal("0")
    if assignment_commission_active(assignment):
        commission = (revenue * Decimal(assignment.porcentaje_comision or 0) / Decimal("100")).quantize(
            Decimal("0.01")
        )
    margin = Decimal("0")
    if revenue:
        margin = (gross_profit * Decimal("100") / revenue).quantize(Decimal("0.01"))
    return {
        "ingreso_mensual_estimado": float(revenue),
        "costos_operativos": float(costs),
        "utilidad_bruta": float(gross_profit),
        "comision_estimada": float(commission),
        "margen": float(margin),
    }


def serialize_seller(seller: VendedorBetterP, include_token: bool = True) -> dict:
    payload = {
        "id": seller.id,
        "nombre": seller.nombre,
        "email": seller.email,
        "telefono": seller.telefono,
        "activo": seller.activo,
        "porcentaje_comision_default": float(seller.porcentaje_comision_default or 0),
        "notas_internas": seller.notas_internas,
        "fecha_creacion": seller.fecha_creacion,
        "fecha_actualizacion": seller.fecha_actualizacion,
    }
    if include_token:
        payload["token_acceso"] = seller.token_acceso
    return payload


def serialize_sales_assignment(assignment: AsignacionComercialSaaS | None) -> dict | None:
    if not assignment:
        return None
    return {
        "id": assignment.id,
        "suscripcion_id": assignment.suscripcion_id,
        "vendedor_id": assignment.vendedor_id,
        "vendedor_nombre": assignment.vendedor.nombre if assignment.vendedor else None,
        "origen": assignment.origen,
        "porcentaje_comision": float(assignment.porcentaje_comision or 0),
        "comision_activa": assignment.comision_activa,
        "fecha_inicio": assignment.fecha_inicio,
        "fecha_fin": assignment.fecha_fin,
        "notas_internas": assignment.notas_internas,
        "fecha_actualizacion": assignment.fecha_actualizacion,
    }


def serialize_operational_cost(cost: CostoOperativoSaaS) -> dict:
    return {
        "id": cost.id,
        "suscripcion_id": cost.suscripcion_id,
        "capa_nombre": cost.suscripcion.capa_negocio.nombre,
        "categoria": cost.categoria,
        "concepto": cost.concepto,
        "monto_mensual": float(cost.monto_mensual or 0),
        "activo": cost.activo,
        "fecha_inicio": cost.fecha_inicio,
        "fecha_fin": cost.fecha_fin,
        "notas_internas": cost.notas_internas,
        "fecha_actualizacion": cost.fecha_actualizacion,
    }


def serialize_sales_subscription(subscription: SuscripcionCapa) -> dict:
    metrics = sales_metrics_for_subscription(subscription)
    return {
        **serialize_subscription_admin(subscription),
        "asignacion_comercial": serialize_sales_assignment(get_sales_assignment(subscription)),
        "costos_operativos": [
            serialize_operational_cost(cost)
            for cost in subscription.costos_operativos.all()
        ],
        "metricas_ventas": metrics,
    }


def split_subscription_scope(
    subscriptions: list[SuscripcionCapa],
) -> tuple[list[SuscripcionCapa], list[SuscripcionCapa]]:
    operational: list[SuscripcionCapa] = []
    historical: list[SuscripcionCapa] = []
    for subscription in subscriptions:
        if is_retired_solution(subscription.plan.solution):
            historical.append(subscription)
        else:
            operational.append(subscription)
    return operational, historical


def serialize_historical_subscription(
    subscription: SuscripcionCapa,
    *,
    include_sales: bool = False,
) -> dict:
    solution = subscription.plan.solution
    solution_metadata = solution.metadata if solution and isinstance(solution.metadata, dict) else {}
    payload = {
        "id": subscription.id,
        "estatus": subscription.estatus,
        "periodicidad": subscription.periodicidad,
        "fecha_inicio": subscription.fecha_inicio,
        "fecha_fin_periodo_actual": subscription.fecha_fin_periodo_actual,
        "auto_renueva": subscription.auto_renueva,
        "fecha_creacion": subscription.fecha_creacion,
        "fecha_actualizacion": subscription.fecha_actualizacion,
        "read_only": True,
        "history_reason": "retired_solution",
        "retired_into": solution_metadata.get("retired_into") or "tienda_facil",
        "capa_negocio": {
            "id": subscription.capa_negocio_id,
            "nombre": subscription.capa_negocio.nombre,
            "correo_contacto": subscription.capa_negocio.correo_contacto,
            "activo": subscription.capa_negocio.activo,
        },
        "plan": {
            "id": subscription.plan_id,
            "clave": subscription.plan.clave,
            "nombre": subscription.plan.nombre,
            "solution": {
                "id": solution.id if solution else None,
                "clave": solution.clave if solution else None,
                "nombre": solution.nombre if solution else "Solucion historica",
            },
        },
    }
    if include_sales:
        payload.update(
            {
                "asignacion_comercial": serialize_sales_assignment(
                    get_sales_assignment(subscription)
                ),
                "costos_operativos": [
                    serialize_operational_cost(cost)
                    for cost in subscription.costos_operativos.all()
                ],
                "metricas_ventas": sales_metrics_for_subscription(subscription),
            }
        )
    return payload


def require_operational_subscription(subscription: SuscripcionCapa) -> SuscripcionCapa:
    if is_retired_solution(subscription.plan.solution):
        raise HttpError(
            409,
            "Las suscripciones historicas se conservan como solo lectura.",
        )
    return subscription


def build_sales_summary(subscriptions: list[SuscripcionCapa]) -> dict:
    totals = {
        "ingreso_mensual_estimado": Decimal("0"),
        "costos_operativos": Decimal("0"),
        "utilidad_bruta": Decimal("0"),
        "comision_estimada": Decimal("0"),
    }
    assigned_count = 0
    for subscription in subscriptions:
        assignment = get_sales_assignment(subscription)
        if assignment and assignment.vendedor_id:
            assigned_count += 1
        metrics = sales_metrics_for_subscription(subscription)
        for key in totals:
            totals[key] += Decimal(str(metrics[key]))
    margin = Decimal("0")
    if totals["ingreso_mensual_estimado"]:
        margin = (
            totals["utilidad_bruta"] * Decimal("100") / totals["ingreso_mensual_estimado"]
        ).quantize(Decimal("0.01"))
    return {
        "clientes": len(subscriptions),
        "clientes_con_vendedor": assigned_count,
        "ingreso_mensual_estimado": float(totals["ingreso_mensual_estimado"].quantize(Decimal("0.01"))),
        "costos_operativos": float(totals["costos_operativos"].quantize(Decimal("0.01"))),
        "utilidad_bruta": float(totals["utilidad_bruta"].quantize(Decimal("0.01"))),
        "comision_estimada": float(totals["comision_estimada"].quantize(Decimal("0.01"))),
        "margen": float(margin),
    }


def month_start(value: date) -> date:
    return date(value.year, value.month, 1)


def add_months(value: date, months: int) -> date:
    month_index = value.month - 1 + months
    year = value.year + month_index // 12
    month = month_index % 12 + 1
    return date(year, month, 1)


def subscription_active_for_window(
    subscription: SuscripcionCapa,
    start_date: date,
    end_date: date,
) -> bool:
    if subscription.estatus in {"CANCELADA", "PAUSADA", "PENDIENTE_PAGO"}:
        return False
    subscription_start = subscription.fecha_inicio or subscription.fecha_creacion.date()
    if subscription_start >= end_date:
        return False
    if subscription.fecha_fin_periodo_actual and subscription.fecha_fin_periodo_actual < start_date:
        return False
    return True


def operational_cost_active_for_window(
    cost: CostoOperativoSaaS,
    start_date: date,
    end_date: date,
) -> bool:
    if not cost.activo:
        return False
    if cost.fecha_inicio and cost.fecha_inicio >= end_date:
        return False
    if cost.fecha_fin and cost.fecha_fin < start_date:
        return False
    return True


def estimated_revenue_for_window(
    subscriptions: list[SuscripcionCapa],
    start_date: date,
    end_date: date,
) -> Decimal:
    return sum(
        (
            monthly_revenue_for_subscription(subscription)
            for subscription in subscriptions
            if subscription_active_for_window(subscription, start_date, end_date)
        ),
        Decimal("0"),
    ).quantize(Decimal("0.01"))


def operational_costs_for_window(
    subscriptions: list[SuscripcionCapa],
    start_date: date,
    end_date: date,
) -> Decimal:
    total = Decimal("0")
    for subscription in subscriptions:
        if not subscription_active_for_window(subscription, start_date, end_date):
            continue
        total += sum(
            (
                Decimal(cost.monto_mensual or 0)
                for cost in subscription.costos_operativos.all()
                if operational_cost_active_for_window(cost, start_date, end_date)
            ),
            Decimal("0"),
        )
    return total.quantize(Decimal("0.01"))


def build_monthly_business_history(subscriptions: list[SuscripcionCapa]) -> list[dict]:
    current_month = month_start(timezone.localdate())
    periods = [add_months(current_month, offset) for offset in range(-5, 1)]
    history: list[dict] = []
    for period_start in periods:
        period_end = add_months(period_start, 1)
        paid = stripe_paid_total(
            timezone.make_aware(datetime.combine(period_start, datetime.min.time())),
            timezone.make_aware(datetime.combine(period_end, datetime.min.time())),
        )
        estimated = estimated_revenue_for_window(subscriptions, period_start, period_end)
        revenue = paid if paid > 0 else estimated
        costs = operational_costs_for_window(subscriptions, period_start, period_end)
        utility = (revenue - costs).quantize(Decimal("0.01"))
        active_clients = sum(
            1
            for subscription in subscriptions
            if subscription_active_for_window(subscription, period_start, period_end)
        )
        history.append(
            {
                "periodo": period_start.strftime("%Y-%m"),
                "etiqueta": period_start.strftime("%b %Y"),
                "ventas": float(revenue),
                "ventas_confirmadas": float(paid),
                "gastos": float(costs),
                "utilidad": float(utility),
                "clientes_activos": active_clients,
        "pagos_confirmados": len(
            stripe_paid_events(
                timezone.make_aware(datetime.combine(period_start, datetime.min.time())),
                timezone.make_aware(datetime.combine(period_end, datetime.min.time())),
            )
        ),
            }
        )
    return history


def build_prospect_pipeline() -> list[dict]:
    stage_counts = dict(
        ProspectoComercial.objects.values("etapa").annotate(total=Count("id")).values_list(
            "etapa",
            "total",
        )
    )
    return [
        {
            "etapa": value,
            "label": label,
            "total": int(stage_counts.get(value, 0) or 0),
        }
        for value, label in ProspectoComercial.ETAPA_CHOICES
    ]


def build_cost_breakdown(subscriptions: list[SuscripcionCapa]) -> list[dict]:
    totals: dict[str, Decimal] = {}
    labels = dict(CostoOperativoSaaS.CATEGORIA_CHOICES)
    for subscription in subscriptions:
        for cost in subscription.costos_operativos.all():
            if not operational_cost_active(cost):
                continue
            category = cost.categoria or "OTROS"
            totals[category] = totals.get(category, Decimal("0")) + Decimal(
                cost.monto_mensual or 0
            )
    return [
        {
            "categoria": category,
            "label": labels.get(category, category.title()),
            "monto_mensual": float(amount.quantize(Decimal("0.01"))),
        }
        for category, amount in sorted(
            totals.items(),
            key=lambda item: item[1],
            reverse=True,
        )
    ]


def build_plan_revenue_mix(subscriptions: list[SuscripcionCapa]) -> list[dict]:
    plan_totals: dict[int, dict] = {}
    for subscription in subscriptions:
        if subscription.estatus not in {"ACTIVA", "TRIAL", "PAST_DUE"}:
            continue
        solution_identity = get_plan_solution_identity(subscription.plan)
        plan_id = subscription.plan_id
        if plan_id not in plan_totals:
            plan_totals[plan_id] = {
                "plan_id": plan_id,
                "plan_nombre": subscription.plan.nombre,
                "solution_id": solution_identity["solution_id"],
                "solution_key": solution_identity["solution_key"],
                "solution_name": solution_identity["solution_name"],
                "clientes": 0,
                "mrr_estimado": Decimal("0"),
            }
        plan_totals[plan_id]["clientes"] += 1
        if subscription.estatus == "ACTIVA":
            plan_totals[plan_id]["mrr_estimado"] += monthly_revenue_for_subscription(
                subscription
            )
    return [
        {
            **item,
            "mrr_estimado": float(item["mrr_estimado"].quantize(Decimal("0.01"))),
        }
        for item in sorted(
            plan_totals.values(),
            key=lambda value: (value["mrr_estimado"], value["clientes"]),
            reverse=True,
        )
    ]


def stripe_paid_total_for_solution(
    solution_key: str,
    start_at=None,
    end_at=None,
) -> Decimal:
    total = Decimal("0")
    for event in stripe_paid_events(start_at, end_at):
        event_solution_key = ""
        if event.suscripcion_relacionada_id and event.suscripcion_relacionada.plan_id:
            event_solution_key = get_plan_solution_identity(
                event.suscripcion_relacionada.plan
            )["solution_key"]
        if not event_solution_key and isinstance(event.payload, dict):
            stripe_object = event.payload.get("data", {}).get("object", event.payload)
            if isinstance(stripe_object, dict):
                metadata = stripe_object.get("metadata") or {}
                if isinstance(metadata, dict):
                    event_solution_key = (
                        metadata.get("betterp_solution_key")
                        or metadata.get("solution_key")
                        or ""
                    )
        if event_solution_key == solution_key:
            total += extract_stripe_amount(event.payload)
    return total.quantize(Decimal("0.01"))


def build_solution_business_summary(
    subscriptions: list[SuscripcionCapa],
    prospects: list[ProspectoComercial],
    *,
    month_start_dt,
    next_month_dt,
) -> list[dict]:
    solutions = load_solution_catalog()
    rows: dict[str, dict] = {}

    def ensure_row(
        *,
        solution_key: str,
        solution_name: str,
        solution_id: int | None = None,
        solution_status: str = "",
        solution_type: str = "",
    ) -> dict:
        row = rows.get(solution_key)
        if row:
            return row
        row = {
            "solution_id": solution_id,
            "solution_key": solution_key,
            "solution_name": solution_name,
            "solution_status": solution_status,
            "solution_type": solution_type,
            "clientes": 0,
            "clientes_activos": 0,
            "clientes_trial": 0,
            "clientes_past_due": 0,
            "clientes_pendientes_pago": 0,
            "mrr_estimado": Decimal("0"),
            "arr_estimado": Decimal("0"),
            "cobranza_vencida": Decimal("0"),
            "ventas_mes_confirmadas": Decimal("0"),
            "ventas_mes_actual": Decimal("0"),
            "costos_servicios_mensuales": Decimal("0"),
            "utilidad_mes_estimada": Decimal("0"),
            "margen_utilidad": Decimal("0"),
            "prospectos_totales": 0,
            "prospectos_nuevos": 0,
            "prospectos_abiertos": 0,
            "planes": [],
            "status": "OK",
            "accion_recomendada": "Operacion comercial estable por solucion.",
            "participacion_mrr": Decimal("0"),
        }
        rows[solution_key] = row
        return row

    for solution in solutions:
        ensure_row(
            solution_id=solution.id,
            solution_key=solution.clave,
            solution_name=solution.nombre,
            solution_status=solution.estatus,
            solution_type=solution.tipo,
        )

    subscriptions_by_solution: dict[str, list[SuscripcionCapa]] = {}
    for subscription in subscriptions:
        identity = get_plan_solution_identity(subscription.plan)
        row = ensure_row(
            solution_id=identity["solution_id"],
            solution_key=identity["solution_key"],
            solution_name=identity["solution_name"],
        )
        subscriptions_by_solution.setdefault(identity["solution_key"], []).append(subscription)
        row["clientes"] += 1
        if subscription.estatus == "ACTIVA":
            row["clientes_activos"] += 1
            row["mrr_estimado"] += monthly_revenue_for_subscription(subscription)
        elif subscription.estatus == "TRIAL":
            row["clientes_trial"] += 1
        elif subscription.estatus == "PAST_DUE":
            row["clientes_past_due"] += 1
            row["cobranza_vencida"] += Decimal(subscription.plan.precio_mensual or 0)
        elif subscription.estatus == "PENDIENTE_PAGO":
            row["clientes_pendientes_pago"] += 1

    for prospect in prospects:
        solution = getattr(prospect, "solution", None)
        if solution:
            row = ensure_row(
                solution_id=solution.id,
                solution_key=solution.clave,
                solution_name=solution.nombre,
                solution_status=solution.estatus,
                solution_type=solution.tipo,
            )
        else:
            row = ensure_row(
                solution_key="sin_clasificar",
                solution_name="Sin clasificar",
                solution_status="PENDIENTE",
                solution_type="COMERCIAL",
            )
        row["prospectos_totales"] += 1
        if prospect.etapa == "NUEVO":
            row["prospectos_nuevos"] += 1
        if prospect.etapa not in {"GANADO", "PERDIDO"}:
            row["prospectos_abiertos"] += 1

    total_mrr = sum((row["mrr_estimado"] for row in rows.values()), Decimal("0"))
    for solution_key, row in rows.items():
        solution_subscriptions = subscriptions_by_solution.get(solution_key, [])
        row["ventas_mes_confirmadas"] = stripe_paid_total_for_solution(
            solution_key,
            month_start_dt,
            next_month_dt,
        )
        row["ventas_mes_actual"] = (
            row["ventas_mes_confirmadas"]
            if row["ventas_mes_confirmadas"] > 0
            else row["mrr_estimado"]
        ).quantize(Decimal("0.01"))
        row["costos_servicios_mensuales"] = sum(
            (
                Decimal(str(sales_metrics_for_subscription(subscription)["costos_operativos"]))
                for subscription in solution_subscriptions
            ),
            Decimal("0"),
        ).quantize(Decimal("0.01"))
        row["utilidad_mes_estimada"] = (
            row["ventas_mes_actual"] - row["costos_servicios_mensuales"]
        ).quantize(Decimal("0.01"))
        if row["ventas_mes_actual"]:
            row["margen_utilidad"] = (
                row["utilidad_mes_estimada"] * Decimal("100") / row["ventas_mes_actual"]
            ).quantize(Decimal("0.01"))
        row["arr_estimado"] = (row["mrr_estimado"] * Decimal("12")).quantize(
            Decimal("0.01")
        )
        if total_mrr:
            row["participacion_mrr"] = (
                row["mrr_estimado"] * Decimal("100") / total_mrr
            ).quantize(Decimal("0.01"))
        row["planes"] = build_plan_revenue_mix(solution_subscriptions)
        if row["clientes_past_due"] or row["clientes_pendientes_pago"]:
            row["status"] = "ERROR"
            row["accion_recomendada"] = "Priorizar cobranza y activacion de pagos."
        elif row["clientes_trial"] or row["prospectos_abiertos"]:
            row["status"] = "WARN"
            row["accion_recomendada"] = "Convertir trials y dar seguimiento al pipeline."

    decimal_fields = {
        "mrr_estimado",
        "arr_estimado",
        "cobranza_vencida",
        "ventas_mes_confirmadas",
        "ventas_mes_actual",
        "costos_servicios_mensuales",
        "utilidad_mes_estimada",
        "margen_utilidad",
        "participacion_mrr",
    }
    return [
        {
            key: float(value.quantize(Decimal("0.01")))
            if key in decimal_fields and isinstance(value, Decimal)
            else value
            for key, value in row.items()
        }
        for row in sorted(
            rows.values(),
            key=lambda item: (
                0 if item["clientes"] or item["prospectos_totales"] else 1,
                -item["mrr_estimado"],
                str(item["solution_name"]).lower(),
            ),
        )
    ]


def parse_commercial_followup_date(value: object) -> date | None:
    if isinstance(value, date):
        return value
    if isinstance(value, str) and value:
        return parse_date(value)
    return None


def commercial_followup_label(status: str) -> str:
    labels = {
        "CONTACTAR": "Contactar",
        "PROPUESTA": "Propuesta",
        "EN_NEGOCIACION": "En negociacion",
        "APROBADO": "Aprobado",
        "DESCARTADO": "Descartado",
        "CERRADO": "Cerrado",
    }
    return labels.get(status, "Sin seguimiento")


def build_commercial_followups(
    subscriptions: list[SuscripcionCapa],
    prospects: list[ProspectoComercial],
    today: date,
) -> list[dict]:
    followups: list[dict] = []
    renewal_limit = today + timedelta(days=7)
    for subscription in subscriptions:
        metadata = subscription.metadata or {}
        commercial_followup = metadata.get(COMMERCIAL_FOLLOWUP_METADATA_KEY)
        if isinstance(commercial_followup, dict):
            status = (commercial_followup.get("estado") or "SIN_SEGUIMIENTO").strip().upper()
            if status not in {"SIN_SEGUIMIENTO", "CERRADO", "DESCARTADO"}:
                responsible = (commercial_followup.get("responsable") or "").strip()
                expected = (commercial_followup.get("resultado_esperado") or "").strip()
                followups.append(
                    {
                        "tipo": "UPGRADE",
                        "prioridad": commercial_followup.get("prioridad") or "MEDIA",
                        "titulo": subscription.capa_negocio.nombre,
                        "detalle": (
                            f"{commercial_followup_label(status)}"
                            f"{f' con {responsible}' if responsible else ''}."
                            f"{f' {expected}' if expected else ''}"
                        ),
                        "accion": "Revisar oportunidad",
                        "href": "/backoffice/clientes",
                        "fecha": parse_commercial_followup_date(
                            commercial_followup.get("fecha_objetivo")
                        ),
                    }
                )
        if subscription.estatus == "PAST_DUE":
            followups.append(
                {
                    "tipo": "COBRANZA",
                    "prioridad": "ALTA",
                    "titulo": subscription.capa_negocio.nombre,
                    "detalle": "Suscripcion SaaS en atraso.",
                    "accion": "Revisar cobranza",
                    "href": "/backoffice/clientes",
                    "fecha": subscription.fecha_fin_periodo_actual,
                }
            )
        elif subscription.estatus == "PENDIENTE_PAGO":
            followups.append(
                {
                    "tipo": "ACTIVACION",
                    "prioridad": "ALTA",
                    "titulo": subscription.capa_negocio.nombre,
                    "detalle": "Cuenta pendiente de pago o activacion.",
                    "accion": "Validar pago",
                    "href": "/backoffice/clientes",
                    "fecha": subscription.fecha_fin_periodo_actual,
                }
            )
        elif (
            subscription.estatus in {"ACTIVA", "TRIAL"}
            and subscription.fecha_fin_periodo_actual
            and subscription.fecha_fin_periodo_actual <= renewal_limit
        ):
            followups.append(
                {
                    "tipo": "RENOVACION",
                    "prioridad": "MEDIA",
                    "titulo": subscription.capa_negocio.nombre,
                    "detalle": "Renovacion o fin de trial en los proximos 7 dias.",
                    "accion": "Dar seguimiento",
                    "href": "/backoffice/clientes",
                    "fecha": subscription.fecha_fin_periodo_actual,
                }
            )
    for prospect in prospects:
        if prospect.etapa not in {"NUEVO", "CONTACTADO", "DEMO", "PROPUESTA"}:
            continue
        priority = "ALTA" if prospect.etapa in {"NUEVO", "PROPUESTA"} else "MEDIA"
        followups.append(
            {
                "tipo": "PROSPECTO",
                "prioridad": priority,
                "titulo": prospect.empresa or prospect.nombre,
                "detalle": f"Etapa comercial: {prospect.get_etapa_display()}.",
                "accion": "Actualizar etapa",
                "href": "/backoffice/solicitudes",
                "fecha": prospect.fecha_actualizacion,
            }
        )
    priority_rank = {"ALTA": 0, "MEDIA": 1, "BAJA": 2}
    def followup_sort_value(item: dict) -> datetime:
        value = item.get("fecha")
        if isinstance(value, datetime):
            return value
        if isinstance(value, date):
            return timezone.make_aware(datetime.combine(value, datetime.min.time()))
        return timezone.now()

    followups.sort(
        key=lambda item: (
            priority_rank.get(item["prioridad"], 9),
            followup_sort_value(item),
        )
    )
    return followups[:10]


def build_seller_defaults(payload: SellerUpsertIn) -> dict:
    nombre = (payload.nombre or "").strip()
    email = (payload.email or "").strip().lower()
    if not nombre:
        raise HttpError(400, "Debes indicar el nombre del vendedor.")
    if not email or "@" not in email:
        raise HttpError(400, "Debes indicar un correo valido para el vendedor.")
    return {
        "nombre": nombre,
        "email": email,
        "telefono": (payload.telefono or "").strip() or None,
        "activo": bool(payload.activo),
        "porcentaje_comision_default": decimal_percent(payload.porcentaje_comision_default),
        "notas_internas": (payload.notas_internas or "").strip() or None,
    }


def build_assignment_defaults(payload: SalesAssignmentUpsertIn) -> dict:
    valid_origins = {choice for choice, _ in AsignacionComercialSaaS.ORIGEN_CHOICES}
    origin = (payload.origen or "").strip().upper()
    if origin not in valid_origins:
        raise HttpError(400, "El origen comercial indicado no es valido.")
    seller = None
    if payload.vendedor_id:
        seller = get_object_or_404(VendedorBetterP, id=payload.vendedor_id)
    if origin == "VENDEDOR" and seller is None:
        raise HttpError(400, "Selecciona un vendedor para una asignacion comisionable.")
    return {
        "vendedor": seller,
        "origen": origin,
        "porcentaje_comision": decimal_percent(payload.porcentaje_comision),
        "comision_activa": bool(payload.comision_activa and seller is not None),
        "fecha_inicio": parse_optional_date(payload.fecha_inicio, "fecha_inicio"),
        "fecha_fin": parse_optional_date(payload.fecha_fin, "fecha_fin"),
        "notas_internas": (payload.notas_internas or "").strip() or None,
    }


def build_cost_defaults(payload: OperationalCostUpsertIn) -> dict:
    valid_categories = {choice for choice, _ in CostoOperativoSaaS.CATEGORIA_CHOICES}
    category = (payload.categoria or "").strip().upper()
    if category not in valid_categories:
        raise HttpError(400, "La categoria de costo indicada no es valida.")
    concept = (payload.concepto or "").strip()
    if not concept:
        raise HttpError(400, "Debes indicar el concepto del costo.")
    amount = Decimal(str(payload.monto_mensual or 0)).quantize(Decimal("0.01"))
    if amount < 0:
        raise HttpError(400, "El costo mensual no puede ser negativo.")
    return {
        "categoria": category,
        "concepto": concept,
        "monto_mensual": amount,
        "activo": bool(payload.activo),
        "fecha_inicio": parse_optional_date(payload.fecha_inicio, "fecha_inicio"),
        "fecha_fin": parse_optional_date(payload.fecha_fin, "fecha_fin"),
        "notas_internas": (payload.notas_internas or "").strip() or None,
    }












def serialize_capa_backup_admin(backup: BackupCapaExport) -> dict:
    return {
        "id": backup.id,
        "capa_id": backup.capa_negocio_id,
        "capa_nombre": backup.capa_negocio.nombre if backup.capa_negocio_id else "",
        "archivo_nombre": backup.archivo_nombre,
        "storage_backend": backup.storage_backend,
        "bucket": backup.bucket,
        "object_key": backup.object_key,
        "size_bytes": backup.size_bytes,
        "checksum_sha256": backup.checksum_sha256,
        "estatus": backup.estatus,
        "detalle_error": backup.detalle_error,
        "generado_por": backup.generado_por,
        "metadata": backup.metadata or {},
        "fecha_creacion": backup.fecha_creacion,
    }


def resolve_pending_plan_from_metadata(metadata: dict) -> tuple[PlanSaaS | None, str]:
    plan = None
    raw_plan_id = metadata.get("plan_id") or metadata.get("betterp_plan_id")
    if raw_plan_id:
        plan = PlanSaaS.objects.filter(id=raw_plan_id, activo=True).first()
    periodicidad = "ANUAL" if metadata.get("periodicidad") == "ANUAL" else "MENSUAL"
    return plan, periodicidad


def upsert_subscription_from_stripe_payload(payload: dict) -> SuscripcionCapa | None:
    data = payload.get("data", {}).get("object", {})
    metadata = data.get("metadata", {}) or {}
    capa_id = metadata.get("capa_negocio_id")
    suscripcion_id = metadata.get("suscripcion_id")
    if not capa_id and not suscripcion_id:
        return None

    subscription = None
    if suscripcion_id:
        subscription = SuscripcionCapa.objects.filter(id=suscripcion_id).select_related(
            "capa_negocio",
            "plan",
        ).first()
    if subscription is None and capa_id:
        subscription = SuscripcionCapa.objects.filter(capa_negocio_id=capa_id).select_related(
            "capa_negocio",
            "plan",
        ).first()
    if subscription is None:
        return None

    status_map = {
        "incomplete": "PENDIENTE_PAGO",
        "incomplete_expired": "CANCELADA",
        "trialing": "TRIAL",
        "active": "ACTIVA",
        "past_due": "PAST_DUE",
        "canceled": "CANCELADA",
        "unpaid": "PAST_DUE",
        "paused": "PAUSADA",
    }
    subscription.stripe_subscription_id = data.get("id") or subscription.stripe_subscription_id
    subscription.stripe_customer_id = data.get("customer") or subscription.stripe_customer_id
    pending_plan, pending_periodicidad = resolve_pending_plan_from_metadata(metadata)
    if pending_plan is not None and not data.get("pending_update"):
        subscription.plan = pending_plan
        subscription.periodicidad = pending_periodicidad
    subscription.estatus = status_map.get(data.get("status"), subscription.estatus)
    if data.get("cancel_at_period_end") is not None:
        subscription.auto_renueva = not bool(data.get("cancel_at_period_end"))
    current_period_end = data.get("current_period_end")
    if current_period_end:
        subscription.fecha_fin_periodo_actual = datetime.fromtimestamp(
            int(current_period_end),
            tz=timezone.get_current_timezone(),
        ).date()
    if data.get("current_period_start") and not subscription.fecha_inicio:
        subscription.fecha_inicio = datetime.fromtimestamp(
            int(data["current_period_start"]),
            tz=timezone.get_current_timezone(),
        ).date()
    subscription.metadata = {
        **(subscription.metadata or {}),
        "stripe_payload": data,
    }
    subscription.save()
    return subscription


def apply_completed_checkout_session_to_subscription(
    *,
    subscription: SuscripcionCapa,
    session_data: dict,
) -> SuscripcionCapa:
    metadata = session_data.get("metadata", {}) or {}
    pending_plan, pending_periodicidad = resolve_pending_plan_from_metadata(metadata)
    if pending_plan is not None:
        subscription.plan = pending_plan
        subscription.periodicidad = pending_periodicidad

    stripe_subscription = session_data.get("subscription")
    stripe_subscription_data = stripe_subscription if isinstance(stripe_subscription, dict) else {}
    stripe_subscription_id = (
        stripe_subscription_data.get("id")
        if stripe_subscription_data
        else stripe_subscription
    )
    if stripe_subscription_id:
        subscription.stripe_subscription_id = stripe_subscription_id

    subscription.stripe_checkout_session_id = (
        session_data.get("id") or subscription.stripe_checkout_session_id
    )
    subscription.stripe_customer_id = (
        session_data.get("customer") or subscription.stripe_customer_id
    )

    payment_status = str(session_data.get("payment_status") or "").lower()
    session_status = str(session_data.get("status") or "").lower()
    subscription_status = str(stripe_subscription_data.get("status") or "").lower()
    checkout_paid = (
        session_status == "complete"
        and payment_status in {"paid", "no_payment_required"}
    ) or subscription_status in {"active", "trialing"}
    subscription.estatus = "ACTIVA" if checkout_paid else "PENDIENTE_PAGO"
    if checkout_paid and not subscription.fecha_inicio:
        subscription.fecha_inicio = timezone.localdate()

    current_period_end = stripe_subscription_data.get("current_period_end")
    if current_period_end:
        subscription.fecha_fin_periodo_actual = datetime.fromtimestamp(
            int(current_period_end),
            tz=timezone.get_current_timezone(),
        ).date()
    if stripe_subscription_data.get("cancel_at_period_end") is not None:
        subscription.auto_renueva = not bool(
            stripe_subscription_data.get("cancel_at_period_end")
        )

    subscription.metadata = {
        **(subscription.metadata or {}),
        "checkout_completed": session_data,
        "checkout_confirmed_at": timezone.now().isoformat(),
    }
    if checkout_paid:
        subscription.metadata.pop("checkout_pending", None)
    subscription.save()
    return subscription


@router.get("/planes/", auth=None)
def list_plans(request, solution: str = ""):
    ensure_default_plans()
    solution_key = (solution or "renta_facil").strip()
    plan_filters = Q(solution__clave=solution_key)
    if solution_key == "renta_facil":
        plan_filters |= Q(solution__isnull=True)
    plans = list(
        PlanSaaS.objects.select_related("solution")
        .filter(plan_filters, activo=True)
        .order_by("precio_mensual", "id")
    )
    items = []
    for plan in plans:
        item = serialize_plan(plan)
        item.pop("stripe_test_price_id_mensual", None)
        item.pop("stripe_test_price_id_anual", None)
        item.pop("stripe_price_id_mensual", None)
        item.pop("stripe_price_id_anual", None)
        items.append(item)
    return {
        "items": items,
        "modulos_disponibles": PLAN_MODULE_DEFINITIONS,
        "funciones_disponibles": PLAN_FEATURE_DEFINITIONS,
    }


@router.post("/prospectos/contacto/", auth=None)
@transaction.atomic
def capture_contact_lead(request, payload: ProspectLeadIn):
    nombre = (payload.nombre or "").strip()
    email = (payload.email or "").strip().lower()
    if not nombre:
        raise HttpError(400, "Debes compartir tu nombre para enviarte seguimiento.")
    if not email:
        raise HttpError(400, "Debes compartir un correo de contacto valido.")

    origin = (payload.origen or "LANDING").strip().upper()
    if origin not in {choice for choice, _ in ProspectoComercial.ORIGEN_CHOICES}:
        origin = "LANDING"

    requested_solution_key_raw = (payload.solution_key or payload.solution or "").strip()
    requested_solution_key = normalize_solution_key(requested_solution_key_raw)
    solution = resolve_public_lead_solution(requested_solution_key)
    metadata = {
        "user_agent": request.headers.get("User-Agent") or "",
        "referer": request.headers.get("Referer") or "",
        "requested_solution_key": requested_solution_key,
        "requested_solution_key_raw": requested_solution_key_raw,
        "resolved_solution_key": solution.clave if solution else "",
    }
    utm_metadata = build_lead_utm_metadata(payload)
    if utm_metadata:
        metadata["utm"] = utm_metadata
    attribution_metadata = build_lead_attribution_metadata(payload)
    if attribution_metadata:
        metadata["attribution"] = attribution_metadata
    if email.endswith("@betterp.net"):
        metadata["is_test"] = True
        metadata["excluded_from_learning"] = True
    qualification_metadata = build_lead_qualification_metadata(payload)
    if qualification_metadata:
        metadata["lead_qualification"] = qualification_metadata

    prospect = ProspectoComercial.objects.create(
        nombre=nombre,
        empresa=(payload.empresa or "").strip() or None,
        email=email,
        telefono=(payload.telefono or "").strip() or None,
        mensaje=(payload.mensaje or "").strip() or None,
        origen=origin,
        solution=solution,
        metadata=metadata,
    )

    notification_sent = False
    notification_error = None
    sales_contact_email = resolve_sales_contact_email()
    if sales_contact_email:
        try:
            send_email_transport(
                destination=sales_contact_email,
                subject=f"Nuevo prospecto BettERP | {prospect.empresa or prospect.nombre}",
                message=build_prospect_notification_message(prospect),
                reply_to=prospect.email,
            )
            notification_sent = True
        except Exception as exc:
            notification_error = str(exc)

    return {
        "mensaje": "Gracias. Recibimos tus datos y te contactaremos pronto.",
        "prospect_id": prospect.id,
        "solution_key": solution.clave if solution else None,
        "lead_qualification": qualification_metadata,
        "notification_sent": notification_sent,
        "notification_error": notification_error,
    }


@router.post("/web-vitals/", auth=None)
def capture_web_vital(request, payload: WebVitalMetricIn):
    metric_name = (payload.name or "").strip().upper()
    allowed_names = {choice[0] for choice in FrontendWebVitalMetric.METRIC_CHOICES}
    if metric_name not in allowed_names:
        return {"accepted": False}
    metric_id = (payload.id or "").strip()[:120] or None
    if metric_id and FrontendWebVitalMetric.objects.filter(metric_id=metric_id).exists():
        return {"accepted": True, "duplicate": True}
    path = normalize_web_vital_path(payload.path)
    rating = (payload.rating or "unknown").strip().lower()
    allowed_ratings = {choice[0] for choice in FrontendWebVitalMetric.RATING_CHOICES}
    if rating not in allowed_ratings:
        rating = "unknown"
    try:
        FrontendWebVitalMetric.objects.create(
            metric_id=metric_id,
            name=metric_name,
            value=max(float(payload.value or 0), 0),
            delta=float(payload.delta or 0),
            rating=rating,
            path=path,
            navigation_type=(payload.navigation_type or "").strip()[:80] or None,
            user_agent=(request.headers.get("User-Agent") or "")[:300] or None,
            metadata={
                "app_env": (payload.app_env or "").strip()[:40],
                "build_id": (payload.build_id or "").strip()[:80],
                "visibility_state": (payload.visibility_state or "").strip()[:40],
                "referer": (request.headers.get("Referer") or "")[:500],
            },
        )
    except DatabaseError:
        return {"accepted": False, "detail": "Web Vitals pendiente de migracion."}
    return {"accepted": True}


@router.post("/frontend-errors/", auth=None)
def capture_frontend_error(request, payload: FrontendClientErrorIn):
    allowed_sources = {choice[0] for choice in FrontendClientError.SOURCE_CHOICES}
    source = (payload.source or "unknown").strip().lower()
    if source not in allowed_sources:
        source = "unknown"
    message = (payload.message or "").strip()
    if not message:
        return {"accepted": False}
    stack = (payload.stack or "").strip()
    component_stack = (payload.component_stack or "").strip()
    stack_hash = (
        hashlib.sha256(f"{stack}|{component_stack}".encode("utf-8")).hexdigest()
        if stack or component_stack
        else None
    )
    path = (payload.path or "/").strip()[:240] or "/"
    try:
        FrontendClientError.objects.create(
            source=source,
            error_name=(payload.error_name or "").strip()[:120] or None,
            message=message[:500],
            path=path,
            stack_hash=stack_hash,
            user_agent=(request.headers.get("User-Agent") or "")[:300] or None,
            metadata={
                "stack": stack[:2000],
                "component_stack": component_stack[:2000],
                "referer": (request.headers.get("Referer") or "")[:500],
            },
        )
    except DatabaseError:
        return {"accepted": False, "detail": "Errores frontend pendientes de migracion."}
    return {"accepted": True}


@router.post("/operational/smoke-report/", auth=None)
def capture_smoke_report(request, payload: SmokeReportIn):
    expected_token = (getattr(settings, "SMOKE_REPORT_TOKEN", "") or "").strip()
    provided_token = (
        request.headers.get("X-BettERP-Smoke-Token")
        or request.headers.get("X-BetterP-Smoke-Token")
        or ""
    ).strip()
    if not expected_token:
        raise HttpError(404, "Registro de smoke no configurado.")
    if not provided_token or not hmac.compare_digest(provided_token, expected_token):
        raise HttpError(403, "Token smoke invalido.")
    run = record_smoke_report(payload)
    return {"accepted": True, "run": serialize_smoke_run(run)}


@router.get("/suscripcion/actual/")
def current_subscription(request):
    capa = get_current_capa(request)
    subscription = get_or_create_subscription_for_capa(capa)
    return serialize_subscription(subscription)




def percentile(values: list[float], ratio: float) -> float:
    if not values:
        return 0
    ordered = sorted(values)
    index = min(max(int(round((len(ordered) - 1) * ratio)), 0), len(ordered) - 1)
    return round(ordered[index], 3)


POST_GO_LIVE_REPORT_CRON_KEY = "post_go_live_tasks_report"
POST_GO_LIVE_REPORT_CRON_NAME = "Reporte tareas post go-live"
POST_GO_LIVE_REPORT_EXPECTED_HOURS = 30


CRON_MONITOR_DEFINITIONS = SAAS_AUTOMATION_DEFINITIONS


def serialize_cron_run(run: CronRunLog | None) -> dict | None:
    if not run:
        return None
    return {
        "id": run.id,
        "key": run.key,
        "name": run.name,
        "status": run.status,
        "started_at": run.started_at,
        "finished_at": run.finished_at,
        "duration_ms": run.duration_ms,
        "summary": run.summary,
        "error": run.error,
    }


def build_cron_monitor_summary(*, now) -> dict:
    try:
        latest_runs = list(CronRunLog.objects.order_by("-started_at")[:50])
    except DatabaseError:
        return {
            "available": False,
            "total": 0,
            "ok": 0,
            "warn": 0,
            "error": 0,
            "items": [],
            "recent": [],
            "detail": "Monitoreo de crons pendiente de migracion.",
        }

    latest_by_key: dict[str, CronRunLog] = {}
    for run in latest_runs:
        latest_by_key.setdefault(run.key, run)

    items = []
    for definition in CRON_MONITOR_DEFINITIONS:
        run = latest_by_key.get(definition["key"])
        expected_hours = int(definition["expected_hours"])
        overdue = False
        status = "WARN"
        state = "MISSING"
        detail = "Sin ejecucion registrada."
        if run:
            reference_time = run.finished_at or run.started_at
            overdue = reference_time < now - timedelta(hours=expected_hours)
            if run.status == "ERROR":
                status = "ERROR"
                state = "FAILED"
                detail = run.error or run.summary or "La ultima ejecucion fallo."
            elif run.status == "RUNNING":
                status = "WARN"
                state = "RUNNING_STALE" if overdue else "RUNNING"
                detail = (
                    f"La ejecucion lleva mas de {expected_hours} horas activa."
                    if overdue
                    else "La ejecucion sigue marcada como activa."
                )
            elif overdue:
                status = "WARN"
                state = "STALE"
                detail = f"No se ejecuta desde hace mas de {expected_hours} horas."
            else:
                status = "OK"
                state = "OK"
                detail = run.summary or "Ultima ejecucion correcta."

        items.append(
            {
                "key": definition["key"],
                "name": definition["name"],
                "category": definition.get("category", "operacion"),
                "schedule": definition.get("schedule", ""),
                "command": definition.get("command", ""),
                "expected_hours": expected_hours,
                "status": status,
                "state": state,
                "configured": run is not None,
                "overdue": overdue,
                "detail": detail,
                "action": definition.get("action", "Confirmar agenda del cron y reejecutar si aplica."),
                "last_run": serialize_cron_run(run),
            }
        )

    return {
        "available": True,
        "total": len(items),
        "ok": sum(1 for item in items if item["status"] == "OK"),
        "warn": sum(1 for item in items if item["status"] == "WARN"),
        "error": sum(1 for item in items if item["status"] == "ERROR"),
        "missing": sum(1 for item in items if item["state"] == "MISSING"),
        "stale": sum(1 for item in items if item["state"] in {"STALE", "RUNNING_STALE"}),
        "running": sum(1 for item in items if item["state"] in {"RUNNING", "RUNNING_STALE"}),
        "items": items,
        "recent": [serialize_cron_run(run) for run in latest_runs[:8]],
    }


def _smoke_source_key(source: str | None) -> str:
    value = (source or "production_smoke").strip().lower()
    value = re.sub(r"[^a-z0-9_-]+", "_", value).strip("_")
    value = (value or "production_smoke")[:80]
    return value if value in SMOKE_MONITOR_KEYS else "production_smoke"


def _smoke_source_name(key: str) -> str:
    names = {item["key"]: item["name"] for item in SMOKE_MONITOR_DEFINITIONS}
    return names.get(key, key.replace("_", " ").title()[:160])


def _compact_smoke_check(item: dict) -> dict:
    return {
        "name": str(item.get("name") or "")[:120],
        "ok": bool(item.get("ok")),
        "status": item.get("status"),
        "duration_ms": item.get("duration_ms") or 0,
        "detail": str(item.get("detail") or "")[:240],
    }


def _smoke_started_at(value: str | None):
    if value:
        parsed = parse_datetime(value)
        if parsed:
            if timezone.is_naive(parsed):
                parsed = timezone.make_aware(parsed, timezone=timezone.get_current_timezone())
            return parsed
    return timezone.now()


def record_smoke_report(payload: SmokeReportIn) -> CronRunLog:
    key = _smoke_source_key(payload.source)
    started_at = _smoke_started_at(payload.generated_at)
    duration_ms = max(int(payload.total_duration_ms or 0), 0)
    finished_at = started_at + timedelta(milliseconds=duration_ms)
    failures = max(int(payload.failures or 0), 0)
    total = max(int(payload.total or 0), 0)
    status = "SUCCESS" if payload.ok else "ERROR"
    summary = (
        f"{'OK' if payload.ok else 'FAIL'} {total - failures}/{total} | "
        f"fallas={failures} | duracion={duration_ms}ms"
    )
    failed_checks = [
        _compact_smoke_check(item)
        for item in (payload.failed_checks or [])
        if isinstance(item, dict)
    ][:8]
    slowest_checks = [
        _compact_smoke_check(item)
        for item in (payload.slowest_checks or [])
        if isinstance(item, dict)
    ][:8]
    metadata = {
        "api_base": payload.api_base,
        "app_base": payload.app_base,
        "selected_capa_id": payload.selected_capa_id,
        "deploy_commit": payload.deploy_commit,
        "deploy_commit_strict": payload.deploy_commit_strict,
        "git_commit": payload.git_commit,
        "workflow": payload.workflow,
        "required_backend_features": payload.required_backend_features or [],
        "total": total,
        "failures": failures,
        "failed_checks": failed_checks,
        "slowest_checks": slowest_checks,
    }
    return CronRunLog.objects.create(
        key=key,
        name=_smoke_source_name(key),
        status=status,
        started_at=started_at,
        finished_at=finished_at,
        duration_ms=duration_ms,
        summary=summary[:500],
        error=failed_checks[0]["detail"] if failed_checks else None,
        metadata=metadata,
    )


def serialize_smoke_run(run: CronRunLog | None) -> dict | None:
    if not run:
        return None
    metadata = run.metadata or {}
    return {
        **serialize_cron_run(run),
        "deploy_commit": metadata.get("deploy_commit") or metadata.get("git_commit"),
        "workflow": metadata.get("workflow"),
        "api_base": metadata.get("api_base"),
        "failures": metadata.get("failures", 0),
        "total": metadata.get("total", 0),
        "failed_checks": metadata.get("failed_checks") or [],
        "slowest_checks": metadata.get("slowest_checks") or [],
    }


def build_smoke_deploy_summary(*, now) -> dict:
    report_receiver_configured = bool((getattr(settings, "SMOKE_REPORT_TOKEN", "") or "").strip())
    try:
        latest_runs = list(
            CronRunLog.objects.filter(key__in=SMOKE_MONITOR_KEYS).order_by("-started_at")[:12]
        )
    except DatabaseError:
        return {
            "available": False,
            "status": "WARN",
            "total": 0,
            "ok": 0,
            "warn": 0,
            "error": 0,
            "items": [],
            "recent": [],
            "report_receiver_configured": report_receiver_configured,
            "detail": "Evidencia smoke/deploy pendiente de migracion.",
        }

    latest_by_key: dict[str, CronRunLog] = {}
    for run in latest_runs:
        latest_by_key.setdefault(run.key, run)

    items = []
    for definition in SMOKE_MONITOR_DEFINITIONS:
        run = latest_by_key.get(definition["key"])
        expected_hours = int(definition["expected_hours"])
        required = bool(definition.get("required"))
        overdue = False
        status = "OK"
        detail = "Sin ejecucion registrada."
        if run:
            reference_time = run.finished_at or run.started_at
            overdue = reference_time < now - timedelta(hours=expected_hours)
            if run.status == "ERROR":
                status = "ERROR"
                detail = run.error or run.summary or "La ultima corrida smoke fallo."
            elif run.status == "RUNNING":
                status = "WARN"
                detail = "La corrida sigue marcada como activa."
            elif overdue and required:
                status = "WARN"
                detail = f"No se ejecuta desde hace mas de {expected_hours} horas."
            else:
                status = "OK"
                detail = run.summary or "Ultima corrida correcta."
        elif required:
            status = "WARN"

        items.append(
            {
                "key": definition["key"],
                "name": definition["name"],
                "expected_hours": expected_hours,
                "required": required,
                "status": status,
                "overdue": overdue,
                "detail": detail,
                "last_run": serialize_smoke_run(run),
            }
        )

    computed_status = (
        "ERROR"
        if any(item["status"] == "ERROR" for item in items)
        else "WARN"
        if any(item["status"] == "WARN" for item in items) or not report_receiver_configured
        else "OK"
    )
    detail = (
        "SMOKE_REPORT_TOKEN no configurado; backoffice no puede recibir evidencia smoke."
        if not report_receiver_configured
        else "Evidencia de smoke productivo y smoke post-deploy."
    )
    return {
        "available": True,
        "status": computed_status,
        "total": len(items),
        "ok": sum(1 for item in items if item["status"] == "OK"),
        "warn": sum(1 for item in items if item["status"] == "WARN") + (0 if report_receiver_configured else 1),
        "error": sum(1 for item in items if item["status"] == "ERROR"),
        "items": items,
        "recent": [serialize_smoke_run(run) for run in latest_runs[:8]],
        "report_receiver_configured": report_receiver_configured,
        "detail": detail,
    }


def build_collection_activity_summary(*, since_24h, since_7d) -> dict:
    base_queryset = HistorialEnvio.objects.filter(tipo_envio="AUTOMATICO")
    summary = base_queryset.aggregate(
        envios_24h=Count("id", filter=Q(fecha_envio__gte=since_24h)),
        envios_7d=Count("id", filter=Q(fecha_envio__gte=since_7d)),
        errores_24h=Count("id", filter=Q(estatus__in=["ERROR", "ERROR_SPAM"], fecha_envio__gte=since_24h)),
        errores_7d=Count("id", filter=Q(estatus__in=["ERROR", "ERROR_SPAM"], fecha_envio__gte=since_7d)),
        omitidos_24h=Count("id", filter=Q(estatus="OMITIDO", fecha_envio__gte=since_24h)),
        omitidos_7d=Count("id", filter=Q(estatus="OMITIDO", fecha_envio__gte=since_7d)),
        whatsapp_7d=Count("id", filter=Q(canal="WHATSAPP", fecha_envio__gte=since_7d)),
        email_7d=Count("id", filter=Q(canal="EMAIL", fecha_envio__gte=since_7d)),
        ultimo_envio=Max("fecha_envio"),
    )
    recent = list(
        base_queryset.select_related(
            "cliente_relacionado",
            "entidad_relacionada",
            "automatizacion_relacionada",
            "plantilla_usada",
        ).order_by("-fecha_envio", "-id")[:8]
    )
    by_capa = list(
        base_queryset.filter(fecha_envio__gte=since_7d, entidad_relacionada__capa_negocio__isnull=False)
        .values("entidad_relacionada__capa_negocio_id", "entidad_relacionada__capa_negocio__nombre")
        .annotate(
            total=Count("id"),
            errores=Count("id", filter=Q(estatus__in=["ERROR", "ERROR_SPAM"])),
            omitidos=Count("id", filter=Q(estatus="OMITIDO")),
            ultimo_envio=Max("fecha_envio"),
        )
        .order_by("-errores", "-omitidos", "-total")[:6]
    )

    return {
        **summary,
        "capas": [
            {
                "capa_id": item["entidad_relacionada__capa_negocio_id"],
                "capa_nombre": item["entidad_relacionada__capa_negocio__nombre"],
                "total": item["total"],
                "errores": item["errores"],
                "omitidos": item["omitidos"],
                "ultimo_envio": item["ultimo_envio"],
            }
            for item in by_capa
        ],
        "recent": [
            {
                "id": item.id,
                "cliente": item.cliente_relacionado.razon_social
                or item.cliente_relacionado.nombre_comercial
                or f"Cliente {item.cliente_relacionado_id}",
                "entidad": item.entidad_relacionada.nombre_comercial if item.entidad_relacionada else None,
                "automatizacion": item.automatizacion_relacionada.nombre
                if item.automatizacion_relacionada
                else None,
                "plantilla": item.plantilla_usada.nombre if item.plantilla_usada else None,
                "canal": item.canal,
                "proveedor": item.proveedor,
                "estatus": item.estatus,
                "fecha": item.fecha_envio,
                "destinatario": item.destinatario,
                "detalle": (item.metadata or {}).get("error") or (item.metadata or {}).get("motivo"),
            }
            for item in recent
        ],
    }


def build_web_vitals_summary(*, since) -> dict:
    try:
        metrics = list(
            FrontendWebVitalMetric.objects.filter(fecha_creacion__gte=since)
            .only("name", "value", "rating", "path", "fecha_creacion")
            .order_by("-fecha_creacion")[:1000]
        )
    except DatabaseError:
        return {
            "available": False,
            "total": 0,
            "metrics": [],
            "routes": [],
            "detail": "Web Vitals pendiente de migracion.",
        }
    by_name: dict[str, list[FrontendWebVitalMetric]] = {}
    by_path: dict[str, dict[str, int]] = {}
    for metric in metrics:
        by_name.setdefault(metric.name, []).append(metric)
        path_bucket = by_path.setdefault(metric.path, {"total": 0, "poor": 0, "needs_improvement": 0})
        path_bucket["total"] += 1
        if metric.rating == "poor":
            path_bucket["poor"] += 1
        elif metric.rating == "needs-improvement":
            path_bucket["needs_improvement"] += 1

    return {
        "available": True,
        "total": len(metrics),
        "metrics": [
            {
                "name": name,
                "count": len(rows),
                "p75": percentile([row.value for row in rows], 0.75),
                "p90": percentile([row.value for row in rows], 0.90),
                "poor": sum(1 for row in rows if row.rating == "poor"),
                "needs_improvement": sum(1 for row in rows if row.rating == "needs-improvement"),
            }
            for name, rows in sorted(by_name.items())
        ],
        "routes": [
            {"path": path, **stats}
            for path, stats in sorted(
                by_path.items(),
                key=lambda item: (item[1]["poor"], item[1]["needs_improvement"], item[1]["total"]),
                reverse=True,
            )[:8]
        ],
    }


def build_frontend_errors_summary(*, since_24h, since_7d) -> dict:
    try:
        summary = FrontendClientError.objects.aggregate(
            errores_24h=Count("id", filter=Q(fecha_creacion__gte=since_24h)),
            errores_7d=Count("id", filter=Q(fecha_creacion__gte=since_7d)),
            ultima_fecha=Max("fecha_creacion"),
        )
        recent = list(FrontendClientError.objects.order_by("-fecha_creacion", "-id")[:5])
    except DatabaseError:
        return {
            "available": False,
            "errores_24h": 0,
            "errores_7d": 0,
            "ultima_fecha": None,
            "recent": [],
            "detail": "Errores frontend pendientes de migracion.",
        }
    return {
        "available": True,
        **summary,
        "recent": [
            {
                "id": item.id,
                "source": item.source,
                "error_name": item.error_name,
                "message": item.message,
                "path": item.path,
                "stack_hash": item.stack_hash,
                "fecha": item.fecha_creacion,
            }
            for item in recent
        ],
    }


def build_backend_deployment_summary() -> dict:
    health_payload = build_health_payload()
    deployment = health_payload.get("deployment") or {}
    features = health_payload.get("features") or {}
    if not isinstance(features, dict):
        features = {}
    missing_features = [
        feature
        for feature in BACKOFFICE_EXPECTED_BACKEND_FEATURES
        if not features.get(feature)
    ]
    git_commit_short = deployment.get("git_commit_short") if isinstance(deployment, dict) else None
    deploy_id = deployment.get("deploy_id") if isinstance(deployment, dict) else None
    platform = deployment.get("platform") if isinstance(deployment, dict) else "unknown"
    runtime = deployment.get("runtime") if isinstance(deployment, dict) else "unknown"
    log_backend = deployment.get("log_backend") if isinstance(deployment, dict) else "unknown"
    log_location = deployment.get("log_location") if isinstance(deployment, dict) else "unknown"
    is_production = getattr(settings, "APP_ENV", "development") == "production"

    status = "OK"
    detail = "Backend publicando contrato operativo esperado."
    if missing_features:
        status = "WARN"
        detail = f"Faltan features backend: {', '.join(missing_features)}."
    elif is_production and not git_commit_short:
        status = "WARN"
        detail = "Produccion no expone commit servido en health."
    elif is_production and not deploy_id:
        status = "WARN"
        detail = "Produccion no expone el identificador de la release activa."
    elif is_production and (
        platform in {None, "", "unknown"}
        or runtime in {None, "", "unknown"}
        or log_backend in {None, "", "unknown"}
        or log_location in {None, "", "unknown"}
    ):
        status = "WARN"
        detail = "Produccion no describe por completo runtime y destino de logs."
    elif is_production:
        detail = (
            f"Backend sirviendo {git_commit_short} en "
            f"{platform}/{runtime} con release {deploy_id}."
        )

    return {
        "status": status,
        "detail": detail,
        "environment": health_payload.get("environment"),
        "demo_mode": health_payload.get("demo_mode"),
        "render": bool(deployment.get("render")) if isinstance(deployment, dict) else False,
        "git_commit": deployment.get("git_commit") if isinstance(deployment, dict) else None,
        "git_commit_short": git_commit_short,
        "deploy_id": deploy_id,
        "platform": platform,
        "runtime": runtime,
        "log_backend": log_backend,
        "log_location": log_location,
        "features": features,
        "feature_count": sum(1 for enabled in features.values() if enabled),
        "expected_features": list(BACKOFFICE_EXPECTED_BACKEND_FEATURES),
        "missing_features": missing_features,
    }


def build_backend_request_metrics_summary(*, since_24h, since_7d) -> dict:
    slow_ms = int(getattr(settings, "REQUEST_METRICS_SLOW_MS", 1500))
    login_path = "/api/accounts/auth/login/"
    expected_denial_codes = [401, 403]
    excluded_client_error_codes = [401, 403, 404]
    try:
        summary = BackendRequestMetric.objects.aggregate(
            total_24h=Count("id", filter=Q(fecha_creacion__gte=since_24h)),
            total_7d=Count("id", filter=Q(fecha_creacion__gte=since_7d)),
            slow_24h=Count(
                "id",
                filter=Q(fecha_creacion__gte=since_24h, duration_ms__gte=slow_ms),
            ),
            server_errors_24h=Count(
                "id",
                filter=Q(fecha_creacion__gte=since_24h, status_code__gte=500),
            ),
            access_denied_24h=Count(
                "id",
                filter=Q(
                    fecha_creacion__gte=since_24h,
                    status_code__in=expected_denial_codes,
                ),
            ),
            not_found_24h=Count(
                "id",
                filter=Q(fecha_creacion__gte=since_24h, status_code=404),
            ),
            client_errors_24h=Count(
                "id",
                filter=(
                    Q(
                        fecha_creacion__gte=since_24h,
                        status_code__gte=400,
                        status_code__lt=500,
                    )
                    & ~Q(status_code__in=excluded_client_error_codes)
                ),
            ),
            max_duration_ms=Max("duration_ms", filter=Q(fecha_creacion__gte=since_24h)),
            avg_duration_ms=Avg("duration_ms", filter=Q(fecha_creacion__gte=since_24h)),
            ultima_fecha=Max("fecha_creacion"),
        )
        routes = list(
            BackendRequestMetric.objects.filter(fecha_creacion__gte=since_7d)
            .values("path")
            .annotate(
                total=Count("id"),
                server_errors=Count("id", filter=Q(status_code__gte=500)),
                access_denied=Count("id", filter=Q(status_code__in=expected_denial_codes)),
                not_found=Count("id", filter=Q(status_code=404)),
                client_errors=Count(
                    "id",
                    filter=(
                        Q(status_code__gte=400, status_code__lt=500)
                        & ~Q(status_code__in=excluded_client_error_codes)
                    ),
                ),
                max_duration_ms=Max("duration_ms"),
                avg_duration_ms=Avg("duration_ms"),
            )
            .order_by("-max_duration_ms", "-total")[:8]
        )
        recent = list(BackendRequestMetric.objects.order_by("-fecha_creacion", "-id")[:12])
        not_found_paths = list(
            BackendRequestMetric.objects.filter(
                fecha_creacion__gte=since_24h,
                status_code=404,
            )
            .values("path")
            .annotate(total=Count("id"))
        )
        login_metrics = list(
            BackendRequestMetric.objects.filter(
                fecha_creacion__gte=since_7d,
                path=login_path,
            )
            .only("duration_ms", "status_code", "request_id", "metadata", "fecha_creacion")
            .order_by("-fecha_creacion", "-id")[:200]
        )
    except DatabaseError:
        return {
            "available": False,
            "total_24h": 0,
            "total_7d": 0,
            "slow_24h": 0,
            "errors_24h": 0,
            "server_errors_24h": 0,
            "access_denied_24h": 0,
            "not_found_24h": 0,
            "exploratory_404_24h": 0,
            "application_404_24h": 0,
            "client_errors_24h": 0,
            "max_duration_ms": 0,
            "avg_duration_ms": 0,
            "ultima_fecha": None,
            "routes": [],
            "recent": [],
            "login_timings": build_login_timing_summary([], login_path=login_path),
            "detail": "Metricas backend pendientes de migracion.",
        }
    exploratory_404_24h = sum(
        int(item["total"] or 0)
        for item in not_found_paths
        if is_exploratory_not_found_path(item["path"])
    )
    not_found_24h = int(summary["not_found_24h"] or 0)
    server_errors_24h = int(summary["server_errors_24h"] or 0)
    return {
        "available": True,
        "slow_ms": slow_ms,
        "total_24h": summary["total_24h"] or 0,
        "total_7d": summary["total_7d"] or 0,
        "slow_24h": summary["slow_24h"] or 0,
        # Alias conservado para consumidores anteriores: desde BC-3 solo representa
        # incidentes 5xx reales, no rechazos de acceso ni rutas inexistentes.
        "errors_24h": server_errors_24h,
        "server_errors_24h": server_errors_24h,
        "access_denied_24h": int(summary["access_denied_24h"] or 0),
        "not_found_24h": not_found_24h,
        "exploratory_404_24h": exploratory_404_24h,
        "application_404_24h": max(not_found_24h - exploratory_404_24h, 0),
        "client_errors_24h": int(summary["client_errors_24h"] or 0),
        "max_duration_ms": summary["max_duration_ms"] or 0,
        "avg_duration_ms": round(float(summary["avg_duration_ms"] or 0), 1),
        "ultima_fecha": summary["ultima_fecha"],
        "routes": [
            {
                "path": item["path"],
                "total": item["total"],
                "errors": item["server_errors"],
                "server_errors": item["server_errors"],
                "access_denied": item["access_denied"],
                "not_found": item["not_found"],
                "exploratory_404": (
                    item["not_found"]
                    if is_exploratory_not_found_path(item["path"])
                    else 0
                ),
                "client_errors": item["client_errors"],
                "max_duration_ms": item["max_duration_ms"] or 0,
                "avg_duration_ms": round(float(item["avg_duration_ms"] or 0), 1),
            }
            for item in routes
        ],
        "recent": [
            {
                "id": item.id,
                "method": item.method,
                "path": item.path,
                "status_code": item.status_code,
                "duration_ms": item.duration_ms,
                "request_id": item.request_id,
                "fecha": item.fecha_creacion,
                "classification": classify_http_request(
                    status_code=item.status_code,
                    path=item.path,
                ),
                "timings_ms": (item.metadata or {}).get("timings_ms", {}),
            }
            for item in recent
        ],
        "login_timings": build_login_timing_summary(login_metrics, login_path=login_path),
    }






def build_login_timing_summary(metrics: list[BackendRequestMetric], *, login_path: str) -> dict:
    timing_values: dict[str, list[float]] = {}
    for metric in metrics:
        timings = (metric.metadata or {}).get("timings_ms", {})
        if not isinstance(timings, dict):
            continue
        for key, value in timings.items():
            if isinstance(value, (int, float)):
                timing_values.setdefault(str(key), []).append(float(value))

    items = []
    for key, values in timing_values.items():
        items.append(
            {
                "key": key,
                "count": len(values),
                "avg_ms": round(sum(values) / len(values), 1),
                "p90_ms": percentile(values, 0.90),
                "max_ms": round(max(values), 1),
            }
        )
    items.sort(key=lambda item: (item["max_ms"], item["avg_ms"]), reverse=True)
    durations = [metric.duration_ms for metric in metrics]
    return {
        "path": login_path,
        "sample_size": len(metrics),
        "avg_duration_ms": round(sum(durations) / len(durations), 1) if durations else 0,
        "max_duration_ms": max(durations) if durations else 0,
        "latest_fecha": metrics[0].fecha_creacion if metrics else None,
        "items": items[:12],
        "recent": [
            {
                "id": metric.id,
                "duration_ms": metric.duration_ms,
                "status_code": metric.status_code,
                "request_id": metric.request_id,
                "fecha": metric.fecha_creacion,
                "timings_ms": (metric.metadata or {}).get("timings_ms", {}),
            }
            for metric in metrics[:5]
        ],
    }


def build_subscription_capacity_summary(subscriptions: list[SuscripcionCapa]) -> dict:
    active_statuses = {"ACTIVA", "TRIAL", "PAST_DUE"}
    active_subscriptions = [
        subscription
        for subscription in subscriptions
        if subscription.estatus in active_statuses and subscription.plan_id
    ]
    usage_map = build_subscription_usage_map(active_subscriptions)
    solution_usage_map = build_solution_usage_map(active_subscriptions)
    issues = []
    for subscription in active_subscriptions:
        usage = usage_map.get(subscription.capa_negocio_id, {})
        solution_key = (
            subscription.plan.solution.clave
            if getattr(subscription.plan, "solution", None)
            else "renta_facil"
        )
        if solution_key == "catalogo":
            solution_usage = solution_usage_map.get(subscription.capa_negocio_id, {})
            summary = solution_usage.get("summary") or {}
            limits = solution_usage.get("limits") or {}
            resources = [
                (
                    "usuarios",
                    int(usage.get("usuarios_activos", 0) or 0),
                    int(subscription.plan.max_usuarios or 0),
                    "Usuarios",
                ),
                (
                    "bodegas",
                    int(summary.get("bodegas_total", 0) or 0),
                    int(subscription.plan.max_entidades or 0),
                    "Bodegas",
                ),
                (
                    "productos",
                    int(summary.get("productos_total", 0) or 0),
                    int(subscription.plan.max_productos or 0),
                    "Productos",
                ),
                (
                    "canales",
                    int(summary.get("canales_configurados", 0) or 0),
                    int(limits.get("canales") or 0),
                    "Canales",
                ),
            ]
        else:
            resources = [
                (
                    "usuarios",
                    int(usage.get("usuarios_activos", 0) or 0),
                    int(subscription.plan.max_usuarios or 0),
                    "Usuarios",
                ),
                (
                    "entidades",
                    int(usage.get("entidades_activas", 0) or 0),
                    int(subscription.plan.max_entidades or 0),
                    "Entidades",
                ),
                (
                    "espacios",
                    int(usage.get("espacios_activos", 0) or 0),
                    int(subscription.plan.max_productos or 0),
                    "Espacios",
                ),
            ]
        for key, used, limit, label in resources:
            if limit <= 0:
                if used > 0:
                    status = "ERROR"
                    ratio = 1
                else:
                    continue
            else:
                ratio = used / limit
                if used > limit:
                    status = "ERROR"
                elif ratio >= 0.8:
                    status = "WARN"
                else:
                    continue
            issues.append(
                {
                    "capa_id": subscription.capa_negocio_id,
                    "capa_nombre": subscription.capa_negocio.nombre,
                    "plan": subscription.plan.nombre,
                    "solution": solution_key,
                    "resource": key,
                    "label": label,
                    "used": used,
                    "limit": limit,
                    "usage_ratio": round(ratio, 4),
                    "status": status,
                }
            )
    issues.sort(
        key=lambda item: (
            0 if item["status"] == "ERROR" else 1,
            -item["usage_ratio"],
            item["capa_nombre"],
        )
    )
    return {
        "available": True,
        "evaluated": len(active_subscriptions),
        "warn": sum(1 for issue in issues if issue["status"] == "WARN"),
        "error": sum(1 for issue in issues if issue["status"] == "ERROR"),
        "items": issues[:20],
    }


def _go_live_item(
    *,
    key: str,
    title: str,
    category: str,
    status: str,
    detail: str,
    action: str,
    href: str | None = None,
) -> dict:
    return {
        "key": key,
        "title": title,
        "category": category,
        "status": status,
        "detail": detail,
        "action": action,
        "href": href,
    }


def build_go_live_readiness_summary(
    *,
    backend_deployment: dict,
    smoke_deploy: dict,
    stripe_config,
    backup_summary: dict,
    webhook_summary: dict,
    billing_summary: dict,
    subscription_summary: dict,
    cron_summary: dict,
    background_jobs_summary: dict,
    capacity_summary: dict,
    frontend_errors_summary: dict,
    web_vitals_summary: dict,
) -> dict:
    stripe_mode = stripe_config.stripe_modo
    stripe_secret_configured = bool(get_stripe_secret_key_for_mode(stripe_mode))
    stripe_webhook_configured = bool(get_stripe_webhook_secret_for_mode(stripe_mode))
    stripe_status = "WARN"
    stripe_detail = "Stripe esta en TEST; valido para pilotos sin cobro live."
    if stripe_mode == "LIVE":
        stripe_status = "OK" if stripe_secret_configured and stripe_webhook_configured else "ERROR"
        stripe_detail = (
            "Stripe live tiene secret key y webhook configurados."
            if stripe_status == "OK"
            else "Stripe live requiere secret key y webhook antes de cobrar a un cliente real."
        )

    backup_status = "OK"
    backup_detail = "Hay backup reciente y sin errores registrados."
    if backup_summary.get("errores"):
        backup_status = "ERROR"
        backup_detail = f"{backup_summary['errores']} backup(s) fallaron y deben revisarse."
    elif not backup_summary.get("ultimas_24h"):
        backup_status = "WARN"
        backup_detail = "No hay backup generado en las ultimas 24 horas."

    webhook_billing_status = "OK"
    webhook_billing_detail = "Webhooks y billing sin errores recientes."
    if webhook_summary.get("errores") or billing_summary.get("errores_24h"):
        webhook_billing_status = "ERROR"
        webhook_billing_detail = (
            f"{webhook_summary.get('errores', 0)} webhook(s) con error y "
            f"{billing_summary.get('errores_24h', 0)} evento(s) billing con error en 24h."
        )
    elif webhook_summary.get("pendientes") or webhook_summary.get("procesando"):
        webhook_billing_status = "WARN"
        webhook_billing_detail = (
            f"{webhook_summary.get('pendientes', 0)} webhook(s) pendientes y "
            f"{webhook_summary.get('procesando', 0)} en proceso."
        )

    subscription_status = "OK"
    subscription_detail = "Hay suscripciones activas o trial para operar."
    if not (subscription_summary.get("activas") or subscription_summary.get("trial")):
        subscription_status = "WARN"
        subscription_detail = "No hay suscripciones activas o trial listas para operar."
    elif subscription_summary.get("past_due") or subscription_summary.get("pendientes_pago"):
        subscription_status = "WARN"
        subscription_detail = (
            f"{subscription_summary.get('past_due', 0)} past due y "
            f"{subscription_summary.get('pendientes_pago', 0)} pendiente(s) de pago."
        )

    cron_status = "OK"
    cron_detail = "Crons esperados dentro de su ventana."
    if cron_summary.get("available") is False:
        cron_status = "WARN"
        cron_detail = cron_summary.get("detail") or "Monitoreo de crons pendiente."
    elif cron_summary.get("error"):
        cron_status = "ERROR"
        cron_detail = f"{cron_summary['error']} cron(s) fallaron en su ultima corrida."
    elif cron_summary.get("warn"):
        cron_status = "WARN"
        cron_detail = f"{cron_summary['warn']} cron(s) requieren ejecucion reciente o revision."

    worker_status = str(background_jobs_summary.get("worker", {}).get("status") or "UNKNOWN")
    jobs_status = "OK"
    jobs_detail = "Worker y cola background sin bloqueo visible."
    if background_jobs_summary.get("available") is False:
        jobs_status = "WARN"
        jobs_detail = background_jobs_summary.get("detail") or "Jobs background pendientes de migracion."
    elif background_jobs_summary.get("errores") or background_jobs_summary.get("stale_running"):
        jobs_status = "ERROR"
        jobs_detail = (
            f"{background_jobs_summary.get('errores', 0)} job(s) con error y "
            f"{background_jobs_summary.get('stale_running', 0)} detenido(s)."
        )
    elif background_jobs_summary.get("pendientes_vencidos") or worker_status in {"WARN", "ERROR", "UNKNOWN"}:
        jobs_status = "WARN"
        jobs_detail = (
            f"{background_jobs_summary.get('pendientes_vencidos', 0)} job(s) vencidos; "
            f"worker {worker_status}."
        )

    capacity_status = "OK"
    capacity_detail = "Capacidad SaaS dentro de limites contratados."
    if capacity_summary.get("error"):
        capacity_status = "ERROR"
        capacity_detail = f"{capacity_summary['error']} limite(s) de plan ya fueron excedidos."
    elif capacity_summary.get("warn"):
        capacity_status = "WARN"
        capacity_detail = f"{capacity_summary['warn']} limite(s) estan por arriba de 80%."

    frontend_status = "OK"
    frontend_detail = "Frontend sin errores recientes criticos."
    web_vital_issues = sum(
        (route.get("poor", 0) or 0) + (route.get("needs_improvement", 0) or 0)
        for route in web_vitals_summary.get("routes", [])
    )
    if frontend_errors_summary.get("errores_24h"):
        frontend_status = "ERROR"
        frontend_detail = f"{frontend_errors_summary['errores_24h']} error(es) frontend en 24h."
    elif web_vitals_summary.get("available") is False:
        frontend_status = "WARN"
        frontend_detail = web_vitals_summary.get("detail") or "Web Vitals pendiente de lectura."
    elif web_vital_issues:
        frontend_status = "WARN"
        frontend_detail = f"{web_vital_issues} muestra(s) Web Vitals requieren mejora."

    items = [
        _go_live_item(
            key="backend_contract",
            title="Backend desplegado",
            category="tecnico",
            status=backend_deployment.get("status", "WARN"),
            detail=backend_deployment.get("detail") or "Contrato backend pendiente.",
            action="Confirmar commit servido, features publicadas y health estable.",
            href="/backoffice/salud",
        ),
        _go_live_item(
            key="smoke_evidence",
            title="Smoke con evidencia",
            category="tecnico",
            status=smoke_deploy.get("status", "WARN"),
            detail=smoke_deploy.get("detail") or "Smoke productivo pendiente.",
            action="Ejecutar smoke productivo con publicacion de evidencia antes de entregar acceso.",
            href="/backoffice/salud",
        ),
        _go_live_item(
            key="stripe",
            title="Stripe y cobro SaaS",
            category="billing",
            status=stripe_status,
            detail=stripe_detail,
            action="Validar modo Stripe, Price IDs del plan contratado y webhook activo.",
            href="/backoffice/configuracion",
        ),
        _go_live_item(
            key="backups",
            title="Backup y restore",
            category="respaldo",
            status=backup_status,
            detail=backup_detail,
            action="Generar backup de la capa y validar restore antes del go-live.",
            href="/backoffice/clientes",
        ),
        _go_live_item(
            key="webhook_billing",
            title="Webhooks y billing",
            category="billing",
            status=webhook_billing_status,
            detail=webhook_billing_detail,
            action="Resolver webhooks/billing fallidos antes de activar cobro o automatizaciones.",
            href="/backoffice/configuracion",
        ),
        _go_live_item(
            key="subscriptions",
            title="Suscripciones cliente",
            category="cliente",
            status=subscription_status,
            detail=subscription_detail,
            action="Confirmar plan, estatus, periodicidad, limites y usuario responsable.",
            href="/backoffice/clientes",
        ),
        _go_live_item(
            key="crons",
            title="Crons programados",
            category="automatizacion",
            status=cron_status,
            detail=cron_detail,
            action="Confirmar agenda del scheduler de Vultr y reejecutar procesos pendientes si aplica.",
            href="/backoffice/salud",
        ),
        _go_live_item(
            key="background_jobs",
            title="Jobs background",
            category="automatizacion",
            status=jobs_status,
            detail=jobs_detail,
            action="Confirmar worker activo antes de cargas batch, correos o procesos diferidos.",
            href="/backoffice/salud",
        ),
        _go_live_item(
            key="capacity",
            title="Capacidad contratada",
            category="cliente",
            status=capacity_status,
            detail=capacity_detail,
            action="Ajustar plan o limpiar registros inactivos antes de crecimiento real.",
            href="/backoffice/clientes",
        ),
        _go_live_item(
            key="frontend",
            title="Frontend y Web Vitals",
            category="experiencia",
            status=frontend_status,
            detail=frontend_detail,
            action="Revisar errores de navegador y rutas con muestras malas antes de la sesion cliente.",
            href="/backoffice/salud",
        ),
    ]
    blockers = sum(1 for item in items if item["status"] == "ERROR")
    warnings = sum(1 for item in items if item["status"] == "WARN")
    completed = sum(1 for item in items if item["status"] == "OK")
    weighted_score = completed + (warnings * 0.5)
    total = len(items)
    status = "ERROR" if blockers else "WARN" if warnings else "OK"
    detail = (
        f"{blockers} bloqueante(s) antes de go-live."
        if blockers
        else f"{warnings} pendiente(s) preventivo(s) antes de go-live."
        if warnings
        else "Listo para go-live controlado con evidencia operativa."
    )
    return {
        "status": status,
        "score": round((weighted_score / total) * 100) if total else 0,
        "total": total,
        "completed": completed,
        "warnings": warnings,
        "blockers": blockers,
        "detail": detail,
        "runbook": "docs/puesta-en-marcha.md",
        "items": items,
    }


def _subscription_go_live_approval(subscription: SuscripcionCapa) -> GoLiveApproval | None:
    try:
        return subscription.capa_negocio.go_live_approval
    except GoLiveApproval.DoesNotExist:
        return None


def build_go_live_customer_summary(
    subscriptions: list[SuscripcionCapa],
    *,
    item_limit: int | None = 20,
) -> dict:
    operational_statuses = {"ACTIVA", "TRIAL", "PAST_DUE"}
    ready_statuses = {"APROBADO", "APROBADO_CON_PENDIENTES"}
    today = timezone.localdate()
    operational_subscriptions = [
        subscription
        for subscription in subscriptions
        if subscription.estatus in operational_statuses
    ]
    items = []
    approved = 0
    approved_with_pending = 0
    pending = 0
    blocked = 0
    active_without_closure = 0
    post_go_live_pending = 0
    post_go_live_open = 0
    post_go_live_overdue = 0
    for subscription in operational_subscriptions:
        approval = _subscription_go_live_approval(subscription)
        go_live_status = approval.estatus if approval else "PENDIENTE"
        ready = go_live_status in ready_statuses
        post_go_live_ready = (
            ready
            and approval is not None
            and approval.post_go_live_dia_1_validado
            and approval.post_go_live_dia_7_validado
        )
        post_task_status = approval.post_go_live_tarea_estado if approval else "SIN_TAREA"
        post_task_overdue = (
            ready
            and approval is not None
            and not post_go_live_ready
            and post_task_status != "CERRADA"
            and approval.post_go_live_fecha_objetivo is not None
            and approval.post_go_live_fecha_objetivo < today
        )
        if go_live_status == "APROBADO":
            approved += 1
        elif go_live_status == "APROBADO_CON_PENDIENTES":
            approved_with_pending += 1
        elif go_live_status == "BLOQUEADO":
            blocked += 1
        else:
            pending += 1
        if subscription.estatus == "ACTIVA" and not ready:
            active_without_closure += 1
        if ready and not post_go_live_ready:
            post_go_live_pending += 1
            if post_task_status != "CERRADA":
                post_go_live_open += 1
            if post_task_overdue:
                post_go_live_overdue += 1

        if go_live_status == "BLOQUEADO":
            detail = approval.decision if approval and approval.decision else "Go-live bloqueado."
            action = "Resolver decision de bloqueo antes de operar el cliente."
        elif not approval:
            detail = "Sin cierre de go-live registrado."
            action = "Abrir Clientes SaaS y capturar evidencia de go-live."
        elif go_live_status == "PENDIENTE":
            detail = approval.decision or "Cierre creado, pendiente de aprobacion."
            action = "Completar evidencia y guardar aprobacion."
        elif post_task_overdue:
            detail = approval.post_go_live_notas or "Tarea post go-live vencida."
            action = "Reasignar responsable o cerrar seguimiento post go-live."
        elif go_live_status == "APROBADO_CON_PENDIENTES":
            detail = approval.pendientes or "Aprobado con pendientes no bloqueantes."
            action = "Dar seguimiento a pendientes post go-live."
        elif ready and approval and not approval.post_go_live_dia_1_validado:
            detail = approval.decision or "Cierre aprobado; falta seguimiento del primer dia."
            action = "Registrar validacion del dia 1 post go-live y responsable de la tarea."
        elif ready and approval and not approval.post_go_live_dia_7_validado:
            detail = approval.post_go_live_notas or "Seguimiento de dia 1 completo; falta validacion de primeros 7 dias."
            action = "Registrar validacion de primeros 7 dias post go-live."
        else:
            detail = approval.decision or "Go-live aprobado para operacion."
            action = "Mantener evidencia y monitorear primer dia."

        if (
            go_live_status != "APROBADO"
            or subscription.estatus == "ACTIVA"
            or (ready and not post_go_live_ready)
        ):
            items.append(
                {
                    "subscription_id": subscription.id,
                    "capa_id": subscription.capa_negocio_id,
                    "capa_nombre": subscription.capa_negocio.nombre,
                    "subscription_status": subscription.estatus,
                    "plan": subscription.plan.nombre if subscription.plan_id else "",
                    "go_live_status": go_live_status,
                    "ready_for_handoff": ready,
                    "fecha_go_live": approval.fecha_go_live if approval else None,
                    "fecha_aprobacion": approval.fecha_aprobacion if approval else None,
                    "responsable_betterp": approval.responsable_betterp if approval else "",
                    "responsable_cliente": approval.responsable_cliente if approval else "",
                    "post_go_live_dia_1_validado": approval.post_go_live_dia_1_validado if approval else False,
                    "post_go_live_dia_7_validado": approval.post_go_live_dia_7_validado if approval else False,
                    "fecha_post_go_live_dia_1": approval.fecha_post_go_live_dia_1 if approval else None,
                    "fecha_post_go_live_dia_7": approval.fecha_post_go_live_dia_7 if approval else None,
                    "post_go_live_ready": post_go_live_ready,
                    "post_go_live_tarea_estado": post_task_status,
                    "post_go_live_responsable": approval.post_go_live_responsable if approval else "",
                    "post_go_live_fecha_objetivo": approval.post_go_live_fecha_objetivo if approval else None,
                    "post_go_live_prioridad": approval.post_go_live_prioridad if approval else "MEDIA",
                    "post_go_live_overdue": post_task_overdue,
                    "detail": detail,
                    "action": action,
                }
            )

    status = (
        "ERROR"
        if blocked
        else "WARN"
        if active_without_closure or pending or post_go_live_pending
        else "OK"
    )
    detail = (
        f"{blocked} cliente(s) con go-live bloqueado."
        if blocked
        else f"{active_without_closure} cliente(s) activo(s) sin cierre de go-live."
        if active_without_closure
        else f"{pending} cliente(s) trial/past due con go-live pendiente."
        if pending
        else f"{post_go_live_overdue} tarea(s) post go-live vencida(s)."
        if post_go_live_overdue
        else f"{post_go_live_pending} cliente(s) con seguimiento post go-live pendiente."
        if post_go_live_pending
        else "Clientes operativos con cierre de go-live registrado."
    )
    items.sort(
        key=lambda item: (
            0 if item["go_live_status"] == "BLOQUEADO" else 1,
            0 if item.get("post_go_live_overdue") else 1,
            0 if item["subscription_status"] == "ACTIVA" and not item["ready_for_handoff"] else 1,
            item["capa_nombre"],
        )
    )
    return {
        "available": True,
        "status": status,
        "total": len(operational_subscriptions),
        "activos": sum(1 for subscription in operational_subscriptions if subscription.estatus == "ACTIVA"),
        "ready": approved + approved_with_pending,
        "approved": approved,
        "approved_with_pending": approved_with_pending,
        "pending": pending,
        "blocked": blocked,
        "active_without_closure": active_without_closure,
        "post_go_live_pending": post_go_live_pending,
        "post_go_live_open": post_go_live_open,
        "post_go_live_overdue": post_go_live_overdue,
        "detail": detail,
        "items": items[:item_limit] if item_limit is not None else items,
    }


def _post_go_live_task_sort_key(item: dict) -> tuple:
    priority_order = {"CRITICA": 0, "ALTA": 1, "MEDIA": 2, "BAJA": 3}
    target_date = item.get("post_go_live_fecha_objetivo") or date.max
    return (
        0 if item.get("post_go_live_overdue") else 1,
        priority_order.get(item.get("post_go_live_prioridad") or "MEDIA", 2),
        target_date,
        item.get("capa_nombre") or "",
    )


def _serialize_post_go_live_task_item(item: dict) -> dict:
    target_date = item.get("post_go_live_fecha_objetivo")
    approved_at = item.get("fecha_aprobacion")
    return {
        "subscription_id": item.get("subscription_id"),
        "capa_id": item.get("capa_id"),
        "capa_nombre": item.get("capa_nombre") or "",
        "subscription_status": item.get("subscription_status") or "",
        "plan": item.get("plan") or "",
        "go_live_status": item.get("go_live_status") or "",
        "post_go_live_tarea_estado": item.get("post_go_live_tarea_estado") or "SIN_TAREA",
        "post_go_live_responsable": item.get("post_go_live_responsable") or "",
        "post_go_live_fecha_objetivo": target_date.isoformat() if target_date else None,
        "post_go_live_prioridad": item.get("post_go_live_prioridad") or "MEDIA",
        "post_go_live_overdue": bool(item.get("post_go_live_overdue")),
        "post_go_live_ready": bool(item.get("post_go_live_ready")),
        "fecha_aprobacion": approved_at.isoformat() if hasattr(approved_at, "isoformat") else approved_at,
        "detail": item.get("detail") or "",
        "action": item.get("action") or "",
    }


def _open_post_go_live_task_items(go_live_customer_summary: dict) -> list[dict]:
    task_items = [
        item
        for item in go_live_customer_summary.get("items", [])
        if item.get("ready_for_handoff")
        and not item.get("post_go_live_ready")
        and item.get("post_go_live_tarea_estado") != "CERRADA"
    ]
    task_items.sort(key=_post_go_live_task_sort_key)
    return task_items


def build_post_go_live_task_email_message(report: dict) -> str:
    lines = [
        "Reporte operativo de tareas post go-live de BetterP.",
        "",
        f"Tareas abiertas: {report['open']}",
        f"Tareas vencidas: {report['overdue']}",
        f"Clientes con seguimiento pendiente: {report['pending']}",
        "",
    ]
    if report["items"]:
        lines.append("Prioridad de atencion:")
        for item in report["items"][:12]:
            target = item.get("post_go_live_fecha_objetivo") or "sin fecha objetivo"
            owner = item.get("post_go_live_responsable") or "sin responsable"
            lines.extend(
                [
                    "",
                    f"- {item['capa_nombre']} | {item['post_go_live_prioridad']} | {item['post_go_live_tarea_estado']}",
                    f"  Responsable: {owner}",
                    f"  Fecha objetivo: {target}",
                    f"  Accion: {item['action']}",
                ]
            )
    else:
        lines.append("No hay tareas post go-live abiertas en clientes operativos.")
    return "\n".join(lines)


def _query_go_live_subscriptions() -> list[SuscripcionCapa]:
    return list(
        SuscripcionCapa.objects.select_related(
            "capa_negocio",
            "capa_negocio__go_live_approval",
            "capa_negocio__go_live_approval__aprobado_por",
            "plan",
        ).order_by("capa_negocio__nombre", "id")
    )


def build_post_go_live_task_report(
    *,
    subscriptions: list[SuscripcionCapa] | None = None,
    receiver: str | None = None,
    send_email: bool = False,
) -> dict:
    subscription_rows = subscriptions if subscriptions is not None else _query_go_live_subscriptions()
    go_live_summary = build_go_live_customer_summary(subscription_rows, item_limit=None)
    task_items = [
        _serialize_post_go_live_task_item(item)
        for item in _open_post_go_live_task_items(go_live_summary)
    ]
    receiver_email = (receiver or resolve_operations_notify_email()).strip()
    overdue = sum(1 for item in task_items if item["post_go_live_overdue"])
    report = {
        "available": True,
        "generated_at": timezone.now().isoformat(),
        "status": "WARN" if overdue else "OK",
        "total_clients": go_live_summary.get("total", 0),
        "pending": go_live_summary.get("post_go_live_pending", 0),
        "open": len(task_items),
        "overdue": overdue,
        "report_receiver_configured": bool(receiver_email),
        "receiver": receiver_email or None,
        "email_sent": False,
        "email_skipped_reason": None,
        "items": task_items[:20],
    }
    if send_email:
        if receiver_email:
            send_result = send_email_transport(
                destination=receiver_email,
                subject=(
                    "BetterP | Tareas post go-live: "
                    f"{overdue} vencida(s), {len(task_items)} abierta(s)"
                ),
                message=build_post_go_live_task_email_message(report),
            )
            report["email_sent"] = True
            report["email_provider"] = send_result.get("provider")
            report["email_id"] = send_result.get("id")
        else:
            report["email_skipped_reason"] = "Sin receptor operativo configurado."
    return report


def build_post_go_live_report_summary(*, now, go_live_customer_summary: dict) -> dict:
    receiver_email = resolve_operations_notify_email()
    latest_run = None
    try:
        latest_run = (
            CronRunLog.objects.filter(key=POST_GO_LIVE_REPORT_CRON_KEY)
            .order_by("-started_at", "-id")
            .first()
        )
    except DatabaseError:
        return {
            "available": False,
            "status": "WARN",
            "detail": "Reporte post go-live pendiente de migracion.",
            "report_receiver_configured": bool(receiver_email),
            "latest_run": None,
            "open": 0,
            "overdue": 0,
            "pending": 0,
            "items": [],
        }

    task_items = [
        _serialize_post_go_live_task_item(item)
        for item in _open_post_go_live_task_items(go_live_customer_summary)
    ]
    overdue = sum(1 for item in task_items if item["post_go_live_overdue"])
    status = "OK"
    detail = "Reporte automatico post go-live activo."
    if latest_run and latest_run.status == "ERROR":
        status = "ERROR"
        detail = latest_run.error or latest_run.summary or "La ultima corrida del reporte fallo."
    elif not receiver_email:
        status = "WARN"
        detail = "Configura BETTERP_OPERATIONS_NOTIFY_EMAIL para enviar el reporte."
    elif not latest_run:
        status = "WARN"
        detail = "Sin ejecucion registrada del reporte post go-live."
    else:
        reference_time = latest_run.finished_at or latest_run.started_at
        if reference_time < now - timedelta(hours=POST_GO_LIVE_REPORT_EXPECTED_HOURS):
            status = "WARN"
            detail = (
                "El reporte post go-live no se ejecuta desde hace mas de "
                f"{POST_GO_LIVE_REPORT_EXPECTED_HOURS} horas."
            )
        elif overdue:
            detail = f"{overdue} tarea(s) vencida(s) incluidas en el ultimo reporte."
        elif task_items:
            detail = f"{len(task_items)} tarea(s) abierta(s) incluidas en el ultimo reporte."

    return {
        "available": True,
        "status": status,
        "detail": detail,
        "report_receiver_configured": bool(receiver_email),
        "latest_run": serialize_cron_run(latest_run),
        "open": len(task_items),
        "overdue": overdue,
        "pending": go_live_customer_summary.get("post_go_live_pending", 0),
        "items": task_items[:10],
    }


AUDIT_ACCESS_CHANGE_ACTIONS = {
    "ACEPTAR_INVITACION",
    "CAMBIAR_CONTRASENA",
    "ELIMINAR_INVITACION",
    "INVITAR_USUARIO",
    "REEMPLAZAR_INVITACION",
    "RESTABLECER_CONTRASENA",
    "REVOCAR_INVITACION",
    "ACTUALIZAR_ROL_USUARIO",
    "DESACTIVAR_USUARIO",
    "ELIMINAR_USUARIO_CAPA",
    "INVITAR_ADMIN_PLATAFORMA",
    "REVOCAR_ADMIN_PLATAFORMA",
    "REVOCAR_INVITACION_ADMIN_PLATAFORMA",
}
AUDIT_PLAN_DENIAL_ACTIONS = {"PLAN_MODULO_DENEGADO", "PLAN_FUNCION_DENEGADA"}


def _humanize_audit_bucket(value: str) -> str:
    clean_value = (value or "SIN_DATO").replace("_", " ").strip()
    labels = {
        "admin": "Administracion",
        "auditoria": "Auditoria",
        "backups": "Backups",
        "platform admin": "Backoffice interno",
        "write": "Edicion",
        "sin dato": "Sin dato",
    }
    return labels.get(clean_value.lower(), clean_value.title())


def _build_audit_bucket(queryset, field: str, *, limit: int = 5) -> list[dict]:
    buckets = []
    rows = (
        queryset.order_by()
        .values(field)
        .annotate(count=Count("id"))
        .order_by("-count", field)[:limit]
    )
    for row in rows:
        value = str(row.get(field) or "SIN_DATO").strip()[:160] or "SIN_DATO"
        buckets.append(
            {
                "value": value,
                "label": _humanize_audit_bucket(value),
                "count": int(row.get("count") or 0),
            }
        )
    return buckets


def _serialize_security_audit_event(event: EventoAuditoria) -> dict:
    metadata = event.metadata or {}
    return {
        "id": event.id,
        "accion": event.accion,
        "actor_email": event.actor.email if event.actor_id else None,
        "capa_id": event.capa_negocio_id,
        "capa_nombre": event.capa_negocio.nombre if event.capa_negocio_id else None,
        "permiso": metadata.get("permiso_requerido") or event.recurso_id,
        "ruta": metadata.get("ruta") or "",
        "rol": metadata.get("rol_actual") or "",
        "scope": metadata.get("scope") or "",
        "fecha": event.fecha_creacion,
    }


def build_security_audit_summary(*, since_24h, since_7d) -> dict:
    try:
        base_events = EventoAuditoria.objects.filter(fecha_creacion__gte=since_7d)
        permission_denials = base_events.filter(accion="ACCESO_DENEGADO")
        plan_denials = base_events.filter(accion__in=AUDIT_PLAN_DENIAL_ACTIONS)
        access_changes = base_events.filter(accion__in=AUDIT_ACCESS_CHANGE_ACTIONS)
        counts = base_events.aggregate(
            permisos_denegados_24h=Count(
                "id",
                filter=Q(accion="ACCESO_DENEGADO", fecha_creacion__gte=since_24h),
            ),
            permisos_denegados_7d=Count("id", filter=Q(accion="ACCESO_DENEGADO")),
            plan_denegado_7d=Count("id", filter=Q(accion__in=AUDIT_PLAN_DENIAL_ACTIONS)),
            cambios_acceso_7d=Count("id", filter=Q(accion__in=AUDIT_ACCESS_CHANGE_ACTIONS)),
            denegaciones_platform_7d=Count(
                "id",
                filter=Q(accion="ACCESO_DENEGADO", metadata__scope="platform"),
            ),
        )
        latest_denials = [
            _serialize_security_audit_event(event)
            for event in permission_denials.select_related("actor", "capa_negocio")
            .only(
                "id",
                "accion",
                "recurso_id",
                "actor_id",
                "actor__email",
                "capa_negocio_id",
                "capa_negocio__nombre",
                "metadata",
                "fecha_creacion",
            )
            .order_by("-fecha_creacion", "-id")[:8]
        ]
    except DatabaseError:
        return {
            "available": False,
            "status": "WARN",
            "riesgo": "MEDIO",
            "detail": "Auditoria de seguridad pendiente de migracion.",
            "foco_recomendado": "Completar migracion de auditoria antes de ampliar roles.",
            "permisos_denegados_24h": 0,
            "permisos_denegados_7d": 0,
            "plan_denegado_7d": 0,
            "cambios_acceso_7d": 0,
            "denegaciones_platform_7d": 0,
            "permisos_mas_denegados": [],
            "rutas_mas_denegadas": [],
            "roles_con_friccion": [],
            "funciones_plan_bloqueadas": [],
            "ultimas_denegaciones": [],
        }

    permission_denials_24h = int(counts.get("permisos_denegados_24h") or 0)
    permission_denials_7d = int(counts.get("permisos_denegados_7d") or 0)
    plan_denials_7d = int(counts.get("plan_denegado_7d") or 0)
    access_changes_7d = int(counts.get("cambios_acceso_7d") or 0)
    platform_denials_7d = int(counts.get("denegaciones_platform_7d") or 0)
    top_permissions = _build_audit_bucket(permission_denials, "recurso_id")
    risk = "BAJO"
    status = "OK"
    detail = "Sin friccion relevante de permisos en los ultimos 7 dias."
    focus = "Mantener revision semanal de auditoria antes de cambios de roles."
    if permission_denials_24h >= 5 or permission_denials_7d >= 10 or platform_denials_7d:
        risk = "ALTO"
        status = "ERROR"
        detail = (
            f"{permission_denials_7d} denegacion(es) de permisos en 7 dias; "
            f"{permission_denials_24h} ocurrieron en 24h."
        )
        focus = "Revisar usuarios, roles, rutas bloqueadas y accesos de plataforma antes de ampliar permisos."
    elif permission_denials_7d or plan_denials_7d or access_changes_7d >= 5:
        risk = "MEDIO"
        status = "WARN"
        detail = (
            f"{permission_denials_7d} denegacion(es), {plan_denials_7d} bloqueo(s) "
            f"por plan y {access_changes_7d} cambio(s) de acceso en 7 dias."
        )
        focus = "Confirmar que las denegaciones corresponden al rol/plan esperado y documentar cambios de acceso."
    if plan_denials_7d and not permission_denials_7d:
        focus = "Revisar plan, overrides y funciones bloqueadas antes de escalar permisos de usuario."

    return {
        "available": True,
        "status": status,
        "riesgo": risk,
        "detail": detail,
        "foco_recomendado": focus,
        "permisos_denegados_24h": permission_denials_24h,
        "permisos_denegados_7d": permission_denials_7d,
        "plan_denegado_7d": plan_denials_7d,
        "cambios_acceso_7d": access_changes_7d,
        "denegaciones_platform_7d": platform_denials_7d,
        "permisos_mas_denegados": top_permissions,
        "rutas_mas_denegadas": _build_audit_bucket(permission_denials, "metadata__ruta"),
        "roles_con_friccion": _build_audit_bucket(permission_denials, "metadata__rol_actual"),
        "funciones_plan_bloqueadas": _build_audit_bucket(plan_denials, "metadata__capability_key"),
        "ultimas_denegaciones": latest_denials,
    }


def build_background_jobs_summary(*, now, since_24h) -> dict:
    stale_threshold = now - timedelta(minutes=30)
    worker_threshold = now - timedelta(minutes=10)
    try:
        summary = BackgroundJob.objects.aggregate(
            pendientes=Count("id", filter=Q(status="PENDING")),
            pendientes_vencidos=Count("id", filter=Q(status="PENDING", available_at__lte=now)),
            procesando=Count("id", filter=Q(status="RUNNING")),
            exitosos_24h=Count("id", filter=Q(status="SUCCESS", finished_at__gte=since_24h)),
            errores=Count("id", filter=Q(status="ERROR")),
            errores_24h=Count("id", filter=Q(status="ERROR", fecha_actualizacion__gte=since_24h)),
            stale_running=Count("id", filter=Q(status="RUNNING", locked_at__lt=stale_threshold)),
            ultima_fecha=Max("fecha_creacion"),
        )
        recent = list(BackgroundJob.objects.order_by("-fecha_creacion", "-id")[:8])
        latest_worker_run = (
            CronRunLog.objects.filter(key__startswith="background_worker_")
            .order_by("-started_at", "-id")
            .first()
        )
    except DatabaseError:
        return {
            "available": False,
            "pendientes": 0,
            "pendientes_vencidos": 0,
            "procesando": 0,
            "exitosos_24h": 0,
            "errores": 0,
            "errores_24h": 0,
            "stale_running": 0,
            "ultima_fecha": None,
            "worker": {"status": "UNKNOWN", "last_heartbeat": None},
            "recent": [],
            "detail": "Jobs background pendientes de migracion.",
        }
    worker_status = "UNKNOWN"
    last_heartbeat = None
    worker_detail = "Sin heartbeat registrado."
    if latest_worker_run:
        metadata = latest_worker_run.metadata or {}
        raw_heartbeat = metadata.get("last_heartbeat")
        last_heartbeat = parse_datetime(raw_heartbeat) if raw_heartbeat else None
        if last_heartbeat and timezone.is_naive(last_heartbeat):
            last_heartbeat = timezone.make_aware(last_heartbeat, timezone.get_current_timezone())
        if latest_worker_run.status == "ERROR":
            worker_status = "ERROR"
            worker_detail = latest_worker_run.error or "Ultimo worker termino con error."
        elif last_heartbeat and last_heartbeat >= worker_threshold:
            worker_status = "OK"
            worker_detail = latest_worker_run.summary or "Worker activo."
        elif last_heartbeat:
            worker_status = "WARN"
            worker_detail = "Worker sin heartbeat reciente."
        else:
            worker_status = "WARN"
            worker_detail = "Worker sin heartbeat registrado."
    return {
        "available": True,
        **summary,
        "worker": {
            "status": worker_status,
            "detail": worker_detail,
            "last_heartbeat": last_heartbeat,
            "last_run": serialize_cron_run(latest_worker_run),
        },
        "recent": [
            {
                "id": job.id,
                "kind": job.kind,
                "queue": job.queue,
                "status": job.status,
                "attempts": job.attempts,
                "max_attempts": job.max_attempts,
                "available_at": job.available_at,
                "locked_at": job.locked_at,
                "locked_by": job.locked_by,
                "finished_at": job.finished_at,
                "error": job.error,
            }
            for job in recent
        ],
    }


def serialize_background_job(job: BackgroundJob) -> dict:
    return {
        "id": job.id,
        "kind": job.kind,
        "queue": job.queue,
        "status": job.status,
        "file_name": job.payload.get("file_name") if isinstance(job.payload, dict) else None,
        "result": job.result,
        "error": job.error,
        "attempts": job.attempts,
        "max_attempts": job.max_attempts,
        "available_at": job.available_at,
        "started_at": job.started_at,
        "finished_at": job.finished_at,
        "fecha_creacion": job.fecha_creacion,
        "fecha_actualizacion": job.fecha_actualizacion,
    }


@router.get("/jobs/{job_id}/")
def get_background_job(request, job_id: int):
    user = getattr(getattr(request, "auth", None), "user", None)
    job = get_object_or_404(BackgroundJob, id=job_id)
    if job.created_by_id and user and job.created_by_id == user.id:
        return serialize_background_job(job)
    require_platform_admin_access(request)
    return serialize_background_job(job)


@router.get("/admin/salud/")
def business_admin_health(request):
    require_platform_admin_access(request)
    now = timezone.now()
    since_24h = now - timedelta(hours=24)
    since_7d = now - timedelta(days=7)

    all_subscription_rows = list(
        SuscripcionCapa.objects.select_related(
            "capa_negocio",
            "capa_negocio__go_live_approval",
            "capa_negocio__go_live_approval__aprobado_por",
            "plan",
            "plan__solution",
        )
    )
    subscription_rows, historical_subscription_rows = split_subscription_scope(
        all_subscription_rows
    )
    historical_subscription_ids = {
        subscription.id for subscription in historical_subscription_rows
    }
    historical_capa_ids = {
        subscription.capa_negocio_id for subscription in historical_subscription_rows
    }
    all_backups = BackupCapaExport.objects.all()
    backups = all_backups.exclude(capa_negocio_id__in=historical_capa_ids)
    historical_backups = all_backups.filter(capa_negocio_id__in=historical_capa_ids)
    webhooks = WebhookEntrante.objects.all()
    historical_billing_filter = Q(
        suscripcion_relacionada_id__in=historical_subscription_ids
    )
    all_billing_events = EventoBilling.objects.all()
    billing_events = all_billing_events.exclude(historical_billing_filter)
    historical_billing_events = all_billing_events.filter(historical_billing_filter)
    stripe_config = get_or_create_payment_gateway_config()

    backup_summary = backups.aggregate(
        total=Count("id"),
        errores=Count("id", filter=Q(estatus="ERROR")),
        ultimas_24h=Count("id", filter=Q(fecha_creacion__gte=since_24h)),
        ultima_fecha=Max("fecha_creacion"),
    )
    webhook_summary = webhooks.aggregate(
        pendientes=Count("id", filter=Q(estatus_procesamiento="PENDIENTE")),
        procesando=Count("id", filter=Q(estatus_procesamiento="PROCESANDO")),
        errores=Count("id", filter=Q(estatus_procesamiento="ERROR")),
        ultimas_24h=Count("id", filter=Q(fecha_recepcion__gte=since_24h)),
        ultima_fecha=Max("fecha_recepcion"),
    )
    billing_summary = billing_events.aggregate(
        errores_24h=Count("id", filter=Q(estatus="ERROR", fecha_creacion__gte=since_24h)),
        eventos_24h=Count("id", filter=Q(fecha_creacion__gte=since_24h)),
        ultima_fecha=Max("fecha_creacion"),
    )
    subscription_summary = {
        "activas": sum(1 for item in subscription_rows if item.estatus == "ACTIVA"),
        "trial": sum(1 for item in subscription_rows if item.estatus == "TRIAL"),
        "past_due": sum(1 for item in subscription_rows if item.estatus == "PAST_DUE"),
        "pendientes_pago": sum(
            1 for item in subscription_rows if item.estatus == "PENDIENTE_PAGO"
        ),
    }
    cron_summary = build_cron_monitor_summary(now=now)
    collection_summary = build_collection_activity_summary(since_24h=since_24h, since_7d=since_7d)
    frontend_errors_summary = build_frontend_errors_summary(
        since_24h=since_24h,
        since_7d=since_7d,
    )
    security_audit_summary = build_security_audit_summary(
        since_24h=since_24h,
        since_7d=since_7d,
    )
    web_vitals_summary = build_web_vitals_summary(since=since_24h)
    backend_requests_summary = build_backend_request_metrics_summary(
        since_24h=since_24h,
        since_7d=since_7d,
    )
    background_jobs_summary = build_background_jobs_summary(now=now, since_24h=since_24h)
    capacity_summary = build_subscription_capacity_summary(subscription_rows)
    backend_deployment_summary = build_backend_deployment_summary()
    smoke_deploy_summary = build_smoke_deploy_summary(now=now)
    go_live_customer_summary_full = build_go_live_customer_summary(
        subscription_rows,
        item_limit=None,
    )
    go_live_customer_summary = {
        **go_live_customer_summary_full,
        "items": go_live_customer_summary_full["items"][:20],
    }
    post_go_live_report_summary = build_post_go_live_report_summary(
        now=now,
        go_live_customer_summary=go_live_customer_summary_full,
    )
    go_live_readiness_summary = build_go_live_readiness_summary(
        backend_deployment=backend_deployment_summary,
        smoke_deploy=smoke_deploy_summary,
        stripe_config=stripe_config,
        backup_summary=backup_summary,
        webhook_summary=webhook_summary,
        billing_summary=billing_summary,
        subscription_summary=subscription_summary,
        cron_summary=cron_summary,
        background_jobs_summary=background_jobs_summary,
        capacity_summary=capacity_summary,
        frontend_errors_summary=frontend_errors_summary,
        web_vitals_summary=web_vitals_summary,
    )

    alerts = []
    if backend_deployment_summary["status"] != "OK":
        alerts.append(
            {
                "tipo": "WARN",
                "titulo": "Backend sin evidencia de deploy",
                "detalle": backend_deployment_summary["detail"],
                "href": "/backoffice/salud",
            }
        )
    if smoke_deploy_summary["status"] == "ERROR":
        alerts.append(
            {
                "tipo": "ERROR",
                "titulo": "Smoke productivo fallando",
                "detalle": "La ultima evidencia smoke/deploy registra error.",
                "href": "/backoffice/salud",
            }
        )
    elif smoke_deploy_summary["status"] == "WARN":
        alerts.append(
            {
                "tipo": "WARN",
                "titulo": "Smoke productivo sin evidencia reciente",
                "detalle": "No hay corrida smoke productiva reciente registrada.",
                "href": "/backoffice/salud",
            }
        )
    if webhook_summary["errores"]:
        alerts.append(
            {
                "tipo": "ERROR",
                "titulo": "Webhooks con error",
                "detalle": f"{webhook_summary['errores']} webhook(s) requieren revision.",
                "href": "/backoffice/marketing",
            }
        )
    if backup_summary["errores"]:
        alerts.append(
            {
                "tipo": "ERROR",
                "titulo": "Backups con error",
                "detalle": f"{backup_summary['errores']} backup(s) fallaron.",
                "href": "/backoffice/clientes",
            }
        )
    if subscription_summary["past_due"]:
        alerts.append(
            {
                "tipo": "WARN",
                "titulo": "Suscripciones vencidas",
                "detalle": f"{subscription_summary['past_due']} cliente(s) SaaS en past due.",
                "href": "/backoffice/clientes",
            }
        )
    if billing_summary["errores_24h"]:
        alerts.append(
            {
                "tipo": "ERROR",
                "titulo": "Errores de billing recientes",
                "detalle": f"{billing_summary['errores_24h']} evento(s) de billing fallaron en 24h.",
                "href": "/backoffice/configuracion",
            }
        )
    if collection_summary["errores_24h"]:
        alerts.append(
            {
                "tipo": "ERROR",
                "titulo": "Errores de cobranza automatizada",
                "detalle": f"{collection_summary['errores_24h']} envio(s) automatico(s) fallaron en 24h.",
                "href": "/cobranza",
            }
        )
    elif collection_summary["omitidos_24h"]:
        alerts.append(
            {
                "tipo": "WARN",
                "titulo": "Cobranza automatizada omitida",
                "detalle": f"{collection_summary['omitidos_24h']} envio(s) automatico(s) se omitieron en 24h.",
                "href": "/cobranza",
            }
        )
    if frontend_errors_summary.get("errores_24h"):
        alerts.append(
            {
                "tipo": "ERROR",
                "titulo": "Errores frontend recientes",
                "detalle": f"{frontend_errors_summary['errores_24h']} error(es) del navegador en 24h.",
                "href": "/backoffice/salud",
            }
        )
    if backend_requests_summary.get("errors_24h"):
        alerts.append(
            {
                "tipo": "ERROR",
                "titulo": "Incidentes backend 5xx",
                "detalle": f"{backend_requests_summary['errors_24h']} respuesta(s) 5xx ocurrieron en 24h.",
                "href": "/backoffice/salud",
            }
        )
    elif backend_requests_summary.get("slow_24h"):
        alerts.append(
            {
                "tipo": "WARN",
                "titulo": "Requests backend lentos",
                "detalle": (
                    f"{backend_requests_summary['slow_24h']} request(s) superaron "
                    f"{backend_requests_summary.get('slow_ms', 1500)}ms en 24h."
                ),
                "href": "/backoffice/salud",
            }
        )
    if security_audit_summary.get("status") == "ERROR":
        alerts.append(
            {
                "tipo": "ERROR",
                "titulo": "Riesgo alto en auditoria",
                "detalle": security_audit_summary["detail"],
                "href": "/backoffice/configuracion",
            }
        )
    elif security_audit_summary.get("status") == "WARN":
        alerts.append(
            {
                "tipo": "WARN",
                "titulo": "Friccion de permisos",
                "detalle": security_audit_summary["detail"],
                "href": "/backoffice/configuracion",
            }
        )
    if cron_summary.get("available") and cron_summary.get("error"):
        alerts.append(
            {
                "tipo": "ERROR",
                "titulo": "Crons con error",
                "detalle": f"{cron_summary['error']} proceso(s) programado(s) fallaron en su ultima ejecucion.",
                "href": "/backoffice/salud",
            }
        )
    if cron_summary.get("available") and cron_summary.get("warn"):
        alerts.append(
            {
                "tipo": "WARN",
                "titulo": "Crons por revisar",
                "detalle": f"{cron_summary['warn']} proceso(s) programado(s) no tienen ejecucion reciente o siguen activos.",
                "href": "/backoffice/salud",
            }
        )
    if background_jobs_summary.get("available") and background_jobs_summary.get("errores"):
        alerts.append(
            {
                "tipo": "ERROR",
                "titulo": "Jobs background con error",
                "detalle": f"{background_jobs_summary['errores']} job(s) requieren revision.",
                "href": "/backoffice/salud",
            }
        )
    if background_jobs_summary.get("available") and background_jobs_summary.get("stale_running"):
        alerts.append(
            {
                "tipo": "WARN",
                "titulo": "Jobs background detenidos",
                "detalle": f"{background_jobs_summary['stale_running']} job(s) llevan mas de 30 minutos en ejecucion.",
                "href": "/backoffice/salud",
            }
        )
    if capacity_summary.get("error"):
        alerts.append(
            {
                "tipo": "ERROR",
                "titulo": "Clientes excedieron limites",
                "detalle": f"{capacity_summary['error']} limite(s) de plan ya fueron rebasados.",
                "href": "/backoffice/clientes",
            }
        )
    elif capacity_summary.get("warn"):
        alerts.append(
            {
                "tipo": "WARN",
                "titulo": "Clientes cerca del limite",
                "detalle": f"{capacity_summary['warn']} limite(s) de plan estan por arriba de 80%.",
                "href": "/backoffice/clientes",
            }
        )
    if go_live_customer_summary.get("blocked"):
        alerts.append(
            {
                "tipo": "ERROR",
                "titulo": "Go-live cliente bloqueado",
                "detalle": f"{go_live_customer_summary['blocked']} cliente(s) tienen go-live bloqueado.",
                "href": "/backoffice/clientes",
            }
        )
    elif go_live_customer_summary.get("active_without_closure"):
        alerts.append(
            {
                "tipo": "WARN",
                "titulo": "Clientes activos sin go-live",
                "detalle": (
                    f"{go_live_customer_summary['active_without_closure']} cliente(s) activo(s) "
                    "no tienen cierre de go-live aprobado."
                ),
                "href": "/backoffice/clientes",
            }
        )
    elif go_live_customer_summary.get("post_go_live_overdue"):
        alerts.append(
            {
                "tipo": "WARN",
                "titulo": "Seguimiento post go-live vencido",
                "detalle": (
                    f"{go_live_customer_summary['post_go_live_overdue']} tarea(s) post go-live "
                    "pasaron su fecha objetivo."
                ),
                "href": "/backoffice/clientes",
            }
        )
    elif go_live_customer_summary.get("post_go_live_pending"):
        alerts.append(
            {
                "tipo": "WARN",
                "titulo": "Seguimiento post go-live pendiente",
                "detalle": (
                    f"{go_live_customer_summary['post_go_live_pending']} cliente(s) "
                    "requieren seguimiento de dia 1 o primeros 7 dias."
                ),
                "href": "/backoffice/clientes",
            }
        )
    if (
        background_jobs_summary.get("available")
        and background_jobs_summary.get("pendientes_vencidos")
        and background_jobs_summary.get("worker", {}).get("status") in {"WARN", "ERROR", "UNKNOWN"}
    ):
        alerts.append(
            {
                "tipo": "ERROR",
                "titulo": "Worker background sin actividad",
                "detalle": (
                    f"{background_jobs_summary['pendientes_vencidos']} job(s) estan listos "
                    "pero el worker no tiene heartbeat reciente."
                ),
                "href": "/backoffice/salud",
            }
        )
    elif (
        background_jobs_summary.get("available")
        and background_jobs_summary.get("pendientes_vencidos", 0) > 25
    ):
        alerts.append(
            {
                "tipo": "WARN",
                "titulo": "Cola background acumulada",
                "detalle": f"{background_jobs_summary['pendientes_vencidos']} job(s) estan esperando procesamiento.",
                "href": "/backoffice/salud",
            }
        )
    if not get_stripe_secret_key_for_mode(get_active_stripe_mode()):
        alerts.append(
            {
                "tipo": "WARN",
                "titulo": "Stripe incompleto",
                "detalle": f"Falta configurar secret key para modo {get_active_stripe_mode()}.",
                "href": "/backoffice/configuracion",
            }
        )

    operational_warn_titles = {
        "Suscripciones vencidas",
        "Clientes cerca del limite",
        "Stripe incompleto",
    }

    technical_warn_titles = {
        "Backend sin evidencia de deploy",
        "Smoke productivo sin evidencia reciente",
        "Cobranza automatizada omitida",
        "Requests backend lentos",
        "Friccion de permisos",
        "Crons por revisar",
        "Jobs background detenidos",
        "Clientes activos sin go-live",
        "Seguimiento post go-live vencido",
        "Seguimiento post go-live pendiente",
        "Cola background acumulada",
    }

    classified_alerts = []
    for alert in alerts:
        title = alert.get("titulo", "")
        if alert.get("tipo") == "ERROR":
            classified_alerts.append(
                {
                    **alert,
                    "audiencia": "OPERACION",
                    "prioridad": "CRITICA",
                    "visible_operacion": True,
                }
            )
        elif title in operational_warn_titles:
            classified_alerts.append(
                {
                    **alert,
                    "audiencia": "OPERACION",
                    "prioridad": "ATENCION",
                    "visible_operacion": True,
                }
            )
        elif title in technical_warn_titles:
            classified_alerts.append(
                {
                    **alert,
                    "audiencia": "BACKOFFICE",
                    "prioridad": "DIAGNOSTICO",
                    "visible_operacion": False,
                }
            )
        else:
            classified_alerts.append(
                {
                    **alert,
                    "audiencia": "BACKOFFICE",
                    "prioridad": "DIAGNOSTICO",
                    "visible_operacion": False,
                }
            )
    alerts = classified_alerts

    recent_backups = list(
        backups.select_related("capa_negocio").order_by("-fecha_creacion", "-id")[:5]
    )
    recent_webhooks = list(webhooks.order_by("-fecha_recepcion", "-id")[:5])
    recent_events = list(billing_events.order_by("-fecha_creacion", "-id")[:5])
    historical_activity_dates = [
        historical_backups.aggregate(value=Max("fecha_creacion"))["value"],
        historical_billing_events.aggregate(value=Max("fecha_creacion"))["value"],
        max(
            (
                subscription.fecha_actualizacion
                for subscription in historical_subscription_rows
            ),
            default=None,
        ),
    ]
    historical_last_activity = max(
        (value for value in historical_activity_dates if value is not None),
        default=None,
    )

    status = "OK"
    if any(alert["tipo"] == "ERROR" for alert in alerts):
        status = "ERROR"
    elif alerts:
        status = "WARN"

    return {
        "status": status,
        "generated_at": now,
        "window": {"last_24h": since_24h, "last_7d": since_7d},
        "request_logging": {
            "enabled": getattr(settings, "REQUEST_LOGGING_ENABLED", True),
            "slow_ms": getattr(settings, "REQUEST_LOGGING_SLOW_MS", 1500),
            "metrics_enabled": getattr(settings, "REQUEST_METRICS_ENABLED", True),
            "metrics_slow_ms": getattr(settings, "REQUEST_METRICS_SLOW_MS", 1500),
            "log_level": getattr(settings, "LOG_LEVEL", "INFO"),
        },
        "stripe": {
            "modo": stripe_config.stripe_modo,
            "secret_key_configurada": bool(get_stripe_secret_key_for_mode(stripe_config.stripe_modo)),
            "webhook_secret_configurado": bool(get_stripe_webhook_secret_for_mode(stripe_config.stripe_modo)),
        },
        "suscripciones": subscription_summary,
        "historical_scope": {
            "read_only": True,
            "solution_name": "Historico",
            "subscriptions": len(historical_subscription_rows),
            "backups": historical_backups.count(),
            "billing_events": historical_billing_events.count(),
            "last_activity_at": historical_last_activity,
        },
        "backups": backup_summary,
        "webhooks": webhook_summary,
        "billing": billing_summary,
        "crons": cron_summary,
        "cobranza_automatizada": collection_summary,
        "web_vitals": web_vitals_summary,
        "frontend_errors": frontend_errors_summary,
        "security_audit": security_audit_summary,
        "backend_requests": backend_requests_summary,
        "backend_deployment": backend_deployment_summary,
        "smoke_deploy": smoke_deploy_summary,
        "go_live_readiness": go_live_readiness_summary,
        "go_live_customers": go_live_customer_summary,
        "post_go_live_report": post_go_live_report_summary,
        "background_jobs": background_jobs_summary,
        "capacidad_planes": capacity_summary,
        "alerts": alerts,
        "recent": {
            "backups": [
                {
                    "id": backup.id,
                    "cliente": backup.capa_negocio.nombre,
                    "estatus": backup.estatus,
                    "storage_backend": backup.storage_backend,
                    "fecha": backup.fecha_creacion,
                    "detalle_error": backup.detalle_error,
                }
                for backup in recent_backups
            ],
            "webhooks": [
                {
                    "id": webhook.id,
                    "proveedor": webhook.proveedor,
                    "estatus": webhook.estatus_procesamiento,
                    "fecha": webhook.fecha_recepcion,
                    "error": webhook.error_procesamiento,
                }
                for webhook in recent_webhooks
            ],
            "billing_events": [
                {
                    "id": event.id,
                    "proveedor": event.proveedor,
                    "tipo_evento": event.tipo_evento,
                    "estatus": event.estatus,
                    "fecha": event.fecha_creacion,
                    "detalle_error": event.detalle_error,
                }
                for event in recent_events
            ],
        },
    }


@router.get("/admin/suscriptores/")
def business_admin_subscribers(request):
    require_platform_admin_access(request)
    all_subscriptions = list(
        SuscripcionCapa.objects.select_related(
            "capa_negocio",
            "capa_negocio__go_live_approval",
            "capa_negocio__go_live_approval__aprobado_por",
            "plan",
            "plan__solution",
        ).order_by(
            "capa_negocio__nombre",
            "id",
        )
    )
    subscriptions, historical_subscriptions = split_subscription_scope(all_subscriptions)
    subscriptions = [
        expire_trial_if_needed(subscription)
        for subscription in subscriptions
    ]
    usage_map = build_saas_usage_map(subscriptions)
    solution_usage_map = build_solution_usage_map(subscriptions)
    subscription_usage_map = build_subscription_usage_map(subscriptions)
    customer_health_map = build_customer_health_map(
        subscriptions,
        subscription_usage_map=subscription_usage_map,
        solution_usage_map=solution_usage_map,
    )
    account_status_map = build_customer_account_status_map(
        subscriptions,
        customer_health_map=customer_health_map,
    )
    return {
        "items": [
            serialize_subscription_admin(
                subscription,
                saas_usage=usage_map.get(subscription.capa_negocio_id),
                solution_usage=solution_usage_map.get(subscription.capa_negocio_id),
                subscription_usage=subscription_usage_map.get(subscription.capa_negocio_id),
                customer_health=customer_health_map.get(subscription.capa_negocio_id),
                account_status=account_status_map.get(subscription.capa_negocio_id),
            )
            for subscription in subscriptions
        ],
        "historical_items": [
            serialize_historical_subscription(subscription)
            for subscription in historical_subscriptions
        ],
        "scope": {
            "operational": len(subscriptions),
            "historical": len(historical_subscriptions),
        },
        "modulos_disponibles": PLAN_MODULE_DEFINITIONS,
        "funciones_disponibles": PLAN_FEATURE_DEFINITIONS,
    }


@router.get("/admin/clientes/")
def business_admin_customers(request):
    require_platform_admin_access(request)
    all_subscriptions = list(
        SuscripcionCapa.objects.select_related(
            "capa_negocio",
            "capa_negocio__go_live_approval",
            "capa_negocio__go_live_approval__aprobado_por",
            "plan",
            "plan__solution",
        ).order_by(
            "capa_negocio__nombre",
            "id",
        )
    )
    subscriptions, historical_subscriptions = split_subscription_scope(all_subscriptions)
    usage_map = build_saas_usage_map(subscriptions)
    solution_usage_map = build_solution_usage_map(subscriptions)
    subscription_usage_map = build_subscription_usage_map(subscriptions)
    customer_health_map = build_customer_health_map(
        subscriptions,
        subscription_usage_map=subscription_usage_map,
        solution_usage_map=solution_usage_map,
    )
    account_status_map = build_customer_account_status_map(
        subscriptions,
        customer_health_map=customer_health_map,
    )
    health_counts = {
        "ok": sum(1 for item in customer_health_map.values() if item["status"] == "OK"),
        "warn": sum(1 for item in customer_health_map.values() if item["status"] == "WARN"),
        "error": sum(1 for item in customer_health_map.values() if item["status"] == "ERROR"),
        "friccion_acceso_7d": sum(
            1
            for item in customer_health_map.values()
            if item.get("access_denials_7d") or item.get("plan_denials_7d")
        ),
    }
    return {
        "salud_clientes": {
            "total": len(subscriptions),
            **health_counts,
        },
        "estado_cuenta_clientes": build_customer_account_summary(account_status_map),
        "items": [
            serialize_subscription_admin(
                subscription,
                saas_usage=usage_map.get(subscription.capa_negocio_id),
                solution_usage=solution_usage_map.get(subscription.capa_negocio_id),
                subscription_usage=subscription_usage_map.get(subscription.capa_negocio_id),
                customer_health=customer_health_map.get(subscription.capa_negocio_id),
                account_status=account_status_map.get(subscription.capa_negocio_id),
            )
            for subscription in subscriptions
        ],
        "historical_items": [
            serialize_historical_subscription(subscription)
            for subscription in historical_subscriptions
        ],
        "scope": {
            "operational": len(subscriptions),
            "historical": len(historical_subscriptions),
        },
        "modulos_disponibles": PLAN_MODULE_DEFINITIONS,
        "funciones_disponibles": PLAN_FEATURE_DEFINITIONS,
    }


GO_LIVE_APPROVAL_STATUSES = {choice[0] for choice in GoLiveApproval.STATUS_CHOICES}
GO_LIVE_POST_TASK_STATUSES = {
    choice[0] for choice in GoLiveApproval.POST_GO_LIVE_TASK_STATUS_CHOICES
}
GO_LIVE_POST_TASK_PRIORITIES = {
    choice[0] for choice in GoLiveApproval.POST_GO_LIVE_PRIORITY_CHOICES
}
CATALOGO_GO_LIVE_BLOCKER_CODES = {
    "catalogo_quality_blockers",
    "pos_cobros_qr_pendientes",
    "capacity_pos_productos_exceeded",
    "capacity_pos_bodegas_exceeded",
    "capacity_pos_cajas_exceeded",
}
CATALOGO_GO_LIVE_WARNING_CODES = {
    "catalogo_catalog_empty",
    "catalogo_inventory_incomplete",
    "catalogo_quality_open",
    "catalogo_cancellation_ratio",
    "pos_tickets_abiertos",
    "capacity_pos_productos_near_limit",
    "capacity_pos_bodegas_near_limit",
    "capacity_pos_cajas_near_limit",
}
CATALOGO_GO_LIVE_ISSUE_CODES = (
    CATALOGO_GO_LIVE_BLOCKER_CODES | CATALOGO_GO_LIVE_WARNING_CODES
)


def get_customer_primary_subscription(capa: CapaNegocio) -> SuscripcionCapa | None:
    return (
        SuscripcionCapa.objects.select_related(
            "capa_negocio",
            "capa_negocio__go_live_approval",
            "capa_negocio__go_live_approval__aprobado_por",
            "plan",
            "plan__solution",
        )
        .filter(capa_negocio=capa)
        .order_by(
            "-fecha_inicio",
            "-id",
        )
        .first()
    )


def build_catalogo_go_live_readiness(subscription: SuscripcionCapa | None) -> dict:
    if subscription is None or not is_catalogo_plan(subscription.plan):
        return {
            "available": False,
            "solution_key": None,
            "status": "SKIPPED",
            "blockers": 0,
            "warnings": 0,
            "summary": {},
            "items": [],
            "blocker_items": [],
            "warning_items": [],
            "primary_action": "El checklist POS no aplica para esta solucion.",
        }

    solution_usage_map = build_solution_usage_map([subscription])
    solution_usage = solution_usage_map.get(subscription.capa_negocio_id) or {}
    health = build_customer_health_map(
        [subscription],
        solution_usage_map=solution_usage_map,
    ).get(subscription.capa_negocio_id) or {}
    summary = solution_usage.get("summary") or {}
    limits = solution_usage.get("limits") or {}

    relevant_issues = [
        issue for issue in health.get("issues", [])
        if issue.get("code") in CATALOGO_GO_LIVE_ISSUE_CODES
    ]
    blocker_items = [
        issue for issue in relevant_issues
        if issue.get("code") in CATALOGO_GO_LIVE_BLOCKER_CODES
        or issue.get("status") == "ERROR"
    ]
    warning_items = [
        issue for issue in relevant_issues
        if issue not in blocker_items
    ]
    status = "OK"
    if blocker_items:
        status = "ERROR"
    elif warning_items:
        status = "WARN"

    primary_action = (
        blocker_items[0]["action"]
        if blocker_items
        else warning_items[0]["action"]
        if warning_items
        else "Punto de venta listo para go-live comercial."
    )
    return {
        "available": True,
        "solution_key": "catalogo",
        "status": status,
        "blockers": len(blocker_items),
        "warnings": len(warning_items),
        "summary": {
            "productos_total": summary.get("productos_total", 0),
            "productos_sin_inventario": summary.get("productos_sin_inventario", 0),
            "stock_total": summary.get("stock_total", "0"),
            "disponible_total": summary.get("disponible_total", "0"),
            "canales_configurados": summary.get("canales_configurados", 0),
            "canales_conectados": summary.get("canales_conectados", 0),
            "canales_con_error": summary.get("canales_con_error", 0),
            "publicaciones_con_error": summary.get("publicaciones_con_error", 0),
            "incidencias_calidad_abiertas": summary.get(
                "incidencias_calidad_abiertas", 0
            ),
            "incidencias_calidad_bloqueantes": summary.get(
                "incidencias_calidad_bloqueantes", 0
            ),
            "ordenes_confirmadas": summary.get("ordenes_confirmadas", 0),
            "ventas_confirmadas_total": summary.get(
                "ventas_confirmadas_total", "0.00"
            ),
            "limite_productos": limits.get("productos", 0),
            "limite_cajas": limits.get("cajas", 0),
        },
        "items": relevant_issues,
        "blocker_items": blocker_items,
        "warning_items": warning_items,
        "primary_action": primary_action,
    }


def summarize_catalogo_go_live_issues(items: list[dict]) -> str:
    titles = [str(item.get("title") or item.get("code") or "pendiente") for item in items]
    if not titles:
        return "sin detalle disponible"
    extra = len(titles) - 3
    summary = ", ".join(titles[:3])
    if extra > 0:
        summary = f"{summary} y {extra} mas"
    return summary


def enforce_catalogo_go_live_readiness(status: str, readiness: dict) -> None:
    if not readiness.get("available") or status not in {"APROBADO", "APROBADO_CON_PENDIENTES"}:
        return
    blocker_items = readiness.get("blocker_items") or []
    warning_items = readiness.get("warning_items") or []
    if status == "APROBADO" and (blocker_items or warning_items):
        issues = blocker_items or warning_items
        raise HttpError(
            400,
            (
                "Para aprobar el go-live falta resolver: "
                f"{summarize_catalogo_go_live_issues(issues)}. "
                "Si son pendientes no bloqueantes, usa APROBADO_CON_PENDIENTES."
            ),
        )
    if status == "APROBADO_CON_PENDIENTES" and blocker_items:
        raise HttpError(
            400,
            (
                "No se puede aprobar con pendientes mientras existan bloqueos "
                f"Punto de venta: {summarize_catalogo_go_live_issues(blocker_items)}."
            ),
        )


def validate_go_live_payload(payload: AdminGoLiveApprovalIn) -> str:
    status = payload.estatus.strip().upper()
    if status not in GO_LIVE_APPROVAL_STATUSES:
        raise HttpError(400, "Estatus de go-live invalido.")
    task_status = payload.post_go_live_tarea_estado.strip().upper() or "SIN_TAREA"
    task_priority = payload.post_go_live_prioridad.strip().upper() or "MEDIA"
    if task_status not in GO_LIVE_POST_TASK_STATUSES:
        raise HttpError(400, "Estatus de tarea post go-live invalido.")
    if task_priority not in GO_LIVE_POST_TASK_PRIORITIES:
        raise HttpError(400, "Prioridad post go-live invalida.")
    if payload.post_go_live_dia_7_validado and not payload.post_go_live_dia_1_validado:
        raise HttpError(400, "Valida primero el seguimiento del dia 1.")
    if task_status in {"ABIERTA", "EN_PROCESO"}:
        if not payload.post_go_live_responsable.strip():
            raise HttpError(400, "Asigna un responsable para la tarea post go-live.")
        if payload.post_go_live_fecha_objetivo is None:
            raise HttpError(400, "Agrega fecha objetivo para la tarea post go-live.")
    if task_status == "CERRADA" and not (
        payload.post_go_live_dia_1_validado and payload.post_go_live_dia_7_validado
    ):
        raise HttpError(400, "Completa dia 1 y dia 7 antes de cerrar la tarea post go-live.")
    if status == "APROBADO":
        missing = []
        if not payload.responsable_betterp.strip():
            missing.append("responsable BetterP")
        if not payload.responsable_cliente.strip():
            missing.append("responsable cliente")
        if not payload.smoke_previo.strip():
            missing.append("smoke previo")
        if not payload.backup_referencia.strip():
            missing.append("backup")
        if missing:
            raise HttpError(400, f"Para aprobar go-live falta: {', '.join(missing)}.")
        if not payload.backup_restore_validado:
            raise HttpError(400, "Para aprobar go-live confirma restore validado.")
    if status == "APROBADO_CON_PENDIENTES" and not payload.pendientes.strip():
        raise HttpError(400, "Agrega pendientes no bloqueantes para aprobar con pendientes.")
    if status == "BLOQUEADO" and not payload.decision.strip():
        raise HttpError(400, "Explica la razon del bloqueo en decision.")
    return status


@router.get("/admin/clientes/{capa_id}/go-live/")
def business_admin_customer_go_live(request, capa_id: int):
    require_platform_admin_access(request)
    capa = get_object_or_404(CapaNegocio, id=capa_id)
    subscription = get_customer_primary_subscription(capa)
    catalogo_readiness = build_catalogo_go_live_readiness(subscription)
    approval = (
        GoLiveApproval.objects.select_related("aprobado_por")
        .filter(capa_negocio=capa)
        .first()
    )
    return {
        "capa": {"id": capa.id, "nombre": capa.nombre},
        "go_live": serialize_go_live_approval(approval),
        "subscription": serialize_subscription_admin(subscription) if subscription else None,
        "catalogo_readiness": catalogo_readiness,
    }


@router.put("/admin/clientes/{capa_id}/go-live/")
@transaction.atomic
def business_admin_update_customer_go_live(
    request,
    capa_id: int,
    payload: AdminGoLiveApprovalIn,
):
    context = require_platform_admin_access(request)
    capa = get_object_or_404(CapaNegocio, id=capa_id)
    subscription = get_customer_primary_subscription(capa)
    catalogo_readiness = build_catalogo_go_live_readiness(subscription)
    status = validate_go_live_payload(payload)
    enforce_catalogo_go_live_readiness(status, catalogo_readiness)
    approval, _created = GoLiveApproval.objects.select_related("aprobado_por").get_or_create(
        capa_negocio=capa,
    )
    previous_status = approval.estatus
    previous_post_day_1 = approval.post_go_live_dia_1_validado
    previous_post_day_7 = approval.post_go_live_dia_7_validado
    now = timezone.now()
    post_task_status = payload.post_go_live_tarea_estado.strip().upper() or "SIN_TAREA"
    post_task_priority = payload.post_go_live_prioridad.strip().upper() or "MEDIA"
    approval.estatus = status
    approval.fecha_go_live = payload.fecha_go_live
    approval.responsable_betterp = payload.responsable_betterp.strip() or None
    approval.responsable_cliente = payload.responsable_cliente.strip() or None
    approval.smoke_previo = payload.smoke_previo.strip() or None
    approval.smoke_posterior = payload.smoke_posterior.strip() or None
    approval.backup_referencia = payload.backup_referencia.strip() or None
    approval.backup_restore_validado = payload.backup_restore_validado
    approval.automatizaciones_activas = payload.automatizaciones_activas
    approval.post_go_live_notas = payload.post_go_live_notas.strip() or None
    if status in {"APROBADO", "APROBADO_CON_PENDIENTES"}:
        approval.post_go_live_dia_1_validado = payload.post_go_live_dia_1_validado
        approval.post_go_live_dia_7_validado = payload.post_go_live_dia_7_validado
        if approval.post_go_live_dia_1_validado and approval.post_go_live_dia_7_validado:
            post_task_status = "CERRADA"
        if approval.post_go_live_dia_1_validado and not previous_post_day_1:
            approval.fecha_post_go_live_dia_1 = now
        elif not approval.post_go_live_dia_1_validado:
            approval.fecha_post_go_live_dia_1 = None
        if approval.post_go_live_dia_7_validado and not previous_post_day_7:
            approval.fecha_post_go_live_dia_7 = now
        elif not approval.post_go_live_dia_7_validado:
            approval.fecha_post_go_live_dia_7 = None
    else:
        approval.post_go_live_dia_1_validado = False
        approval.post_go_live_dia_7_validado = False
        approval.fecha_post_go_live_dia_1 = None
        approval.fecha_post_go_live_dia_7 = None
        post_task_status = "SIN_TAREA"
    approval.post_go_live_tarea_estado = post_task_status
    approval.post_go_live_responsable = payload.post_go_live_responsable.strip() or None
    approval.post_go_live_fecha_objetivo = payload.post_go_live_fecha_objetivo
    approval.post_go_live_prioridad = post_task_priority
    approval.pendientes = payload.pendientes.strip() or None
    approval.decision = payload.decision.strip() or None
    approval.metadata = {
        **(approval.metadata or {}),
        "actualizado_por": context.user.email or context.user.username,
        "ultimo_cambio_at": now.isoformat(),
        "estatus_anterior": previous_status,
        "post_go_live_dia_1": approval.post_go_live_dia_1_validado,
        "post_go_live_dia_7": approval.post_go_live_dia_7_validado,
        "post_go_live_tarea_estado": approval.post_go_live_tarea_estado,
        "post_go_live_responsable": approval.post_go_live_responsable,
        "post_go_live_fecha_objetivo": (
            payload.post_go_live_fecha_objetivo.isoformat()
            if payload.post_go_live_fecha_objetivo
            else None
        ),
    }
    if catalogo_readiness.get("available"):
        approval.metadata["catalogo_go_live_readiness"] = catalogo_readiness
    if status in {"APROBADO", "APROBADO_CON_PENDIENTES"}:
        approval.aprobado_por = context.user
        approval.fecha_aprobacion = now
    elif status in {"PENDIENTE", "BLOQUEADO"}:
        approval.aprobado_por = None
        approval.fecha_aprobacion = None
    approval.save()

    audit(
        actor=context.user,
        capa=capa,
        accion="BACKOFFICE_GO_LIVE_ACTUALIZADO",
        recurso_tipo="GoLiveApproval",
        recurso_id=approval.id,
        metadata={
            "estatus": approval.estatus,
            "estatus_anterior": previous_status,
            "fecha_go_live": payload.fecha_go_live.isoformat() if payload.fecha_go_live else None,
            "post_go_live_dia_1": approval.post_go_live_dia_1_validado,
            "post_go_live_dia_7": approval.post_go_live_dia_7_validado,
            "post_go_live_tarea_estado": approval.post_go_live_tarea_estado,
            "post_go_live_responsable": approval.post_go_live_responsable,
            "post_go_live_fecha_objetivo": (
                payload.post_go_live_fecha_objetivo.isoformat()
                if payload.post_go_live_fecha_objetivo
                else None
            ),
        },
    )
    if subscription is not None:
        subscription = get_customer_primary_subscription(capa)
    return {
        "mensaje": "Cierre de go-live actualizado.",
        "go_live": serialize_go_live_approval(approval),
        "subscription": serialize_subscription_admin(subscription) if subscription else None,
        "catalogo_readiness": catalogo_readiness,
    }


@router.get("/admin/clientes/{capa_id}/backups/")
def business_admin_customer_backups(request, capa_id: int, limit: int = 20):
    require_platform_admin_access(request)
    capa = get_object_or_404(CapaNegocio, id=capa_id)
    safe_limit = min(max(limit, 1), 100)
    backups = list(
        BackupCapaExport.objects.select_related("capa_negocio")
        .filter(capa_negocio=capa)
        .order_by("-fecha_creacion", "-id")[:safe_limit]
    )
    return {
        "capa": {"id": capa.id, "nombre": capa.nombre},
        "items": [serialize_capa_backup_admin(backup) for backup in backups],
    }


@router.post("/admin/clientes/{capa_id}/backups/generar/")
@transaction.atomic
def business_admin_generate_customer_backup(
    request,
    capa_id: int,
    payload: AdminBackupGenerateIn,
):
    context = require_platform_admin_access(request)
    capa = get_object_or_404(CapaNegocio, id=capa_id)
    content = build_capa_backup_workbook(capa)
    backup = build_backup_object(capa, content)
    try:
        record = upload_backup_to_r2(
            capa=capa,
            backup=backup,
            generado_por=context.user.email or context.user.username,
            metadata={
                "origen": "manual_backoffice",
                "motivo": payload.motivo.strip(),
            },
        )
    except ValueError as exc:
        raise HttpError(400, str(exc)) from exc

    audit(
        actor=context.user,
        capa=capa,
        accion="BACKOFFICE_BACKUP_CAPA_GENERADO",
        recurso_tipo="BackupCapaExport",
        recurso_id=record.id,
        metadata={
            "bucket": record.bucket,
            "object_key": record.object_key,
            "motivo": payload.motivo.strip(),
        },
    )
    return {
        "mensaje": "Backup generado y guardado en R2.",
        "backup": serialize_capa_backup_admin(record),
    }


@router.post("/admin/clientes/{capa_id}/backups/{backup_id}/validar-restore/")
@transaction.atomic
def business_admin_validate_customer_backup_restore(
    request,
    capa_id: int,
    backup_id: int,
    payload: AdminBackupRestoreValidationIn,
):
    context = require_platform_admin_access(request)
    capa = get_object_or_404(CapaNegocio, id=capa_id)
    backup = get_object_or_404(
        BackupCapaExport.objects.select_related("capa_negocio"),
        id=backup_id,
        capa_negocio=capa,
        estatus="GENERADO",
    )
    if not payload.confirmacion:
        raise HttpError(400, "Confirma el primer paso antes de validar el restore.")
    if payload.confirmacion_texto.strip().upper() != "VALIDAR RESTORE":
        raise HttpError(400, "Escribe VALIDAR RESTORE para confirmar el segundo paso.")
    if backup.storage_backend != "R2" or not backup.bucket or not backup.object_key:
        raise HttpError(400, "Este backup no esta disponible en R2 para validacion.")

    try:
        content = download_backup_from_r2(
            bucket=backup.bucket,
            object_key=backup.object_key,
        )
        inspection = inspect_backup_workbook(
            content,
            expected_checksum=backup.checksum_sha256 or "",
        )
    except (ValueError, ValidationError) as exc:
        detail = exc.messages[0] if isinstance(exc, ValidationError) else str(exc)
        raise HttpError(400, detail) from exc

    backup.metadata = {
        **(backup.metadata or {}),
        "restore_validado_at": timezone.now().isoformat(),
        "restore_validado_por": context.user.email or context.user.username,
        "restore_motivo": payload.motivo.strip(),
        "restore_checksum": inspection["checksum_sha256"],
    }
    backup.save(update_fields=["metadata"])
    audit(
        actor=context.user,
        capa=capa,
        accion="BACKOFFICE_BACKUP_RESTORE_VALIDADO",
        recurso_tipo="BackupCapaExport",
        recurso_id=backup.id,
        metadata={
            "bucket": backup.bucket,
            "object_key": backup.object_key,
            "motivo": payload.motivo.strip(),
            "checksum_sha256": inspection["checksum_sha256"],
        },
    )
    return {
        "mensaje": "Backup validado para analisis de restore. No se modificaron datos.",
        "backup": serialize_capa_backup_admin(backup),
        "inspeccion": inspection,
    }


@router.post("/admin/suscripciones/")
@transaction.atomic
def create_business_admin_subscription(
    request,
    payload: AdminSubscriptionProvisionIn,
):
    context = require_platform_admin_access(request)
    nombre = (payload.nombre or "").strip()
    if not nombre:
        raise HttpError(400, "Debes indicar el nombre del cliente SaaS.")
    plan = get_object_or_404(
        PlanSaaS.objects.select_related("solution"),
        id=payload.plan_id,
        activo=True,
    )
    status = normalize_admin_subscription_status(payload.estatus)
    periodicidad = normalize_subscription_periodicity(payload.periodicidad)
    tipo_capa = normalize_admin_capa_type(payload.tipo_capa)
    fecha_inicio, fecha_fin = resolve_admin_subscription_window(
        plan,
        status=status,
        periodicidad=periodicidad,
        fecha_inicio=payload.fecha_inicio,
        fecha_fin_periodo_actual=payload.fecha_fin_periodo_actual,
    )
    if CapaNegocio.objects.filter(nombre__iexact=nombre).exists():
        raise HttpError(400, "Ya existe una capa con ese nombre.")

    source_prospect = None
    if payload.source_prospect_id:
        source_prospect = ProspectoComercial.objects.select_related("solution").filter(
            id=payload.source_prospect_id
        ).first()
        if not source_prospect:
            raise HttpError(400, "El prospecto origen no existe.")
        if (source_prospect.metadata or {}).get("converted_subscription_id"):
            raise HttpError(400, "Este prospecto ya fue convertido a cliente SaaS.")

    try:
        capa = CapaNegocio.objects.create(
            nombre=nombre,
            tipo_capa=tipo_capa,
            nombre_administrador=(payload.nombre_administrador or "").strip() or None,
            correo_contacto=(payload.correo_contacto or "").strip() or None,
            telefono_contacto=(payload.telefono_contacto or "").strip() or None,
            referencia_transferencia_prefijo=slugify(nombre)[:20].upper() or "BETTERP",
            activo=True,
        )
    except IntegrityError as exc:
        raise HttpError(400, "Ya existe una capa con ese nombre.") from exc

    actor_label = context.user.email or context.user.username
    followup = build_commercial_followup_metadata(payload, actor_label=actor_label)
    subscription = SuscripcionCapa.objects.create(
        capa_negocio=capa,
        plan=plan,
        estatus=status,
        periodicidad=periodicidad,
        fecha_inicio=fecha_inicio,
        fecha_fin_periodo_actual=fecha_fin,
        auto_renueva=payload.auto_renueva,
        metadata={
            "source": "backoffice_provisioning",
            "provisioned_by": actor_label,
            "provisioned_at": timezone.now().isoformat(),
            "solution_key": plan.solution.clave if plan.solution_id else "",
            "notes": (payload.notas or "").strip(),
            "source_prospect_id": source_prospect.id if source_prospect else None,
            "source_prospect_email": source_prospect.email if source_prospect else "",
            "source_prospect_name": source_prospect.nombre if source_prospect else "",
            "source_prospect_company": source_prospect.empresa if source_prospect else "",
            COMMERCIAL_FOLLOWUP_METADATA_KEY: followup,
        },
    )
    if source_prospect:
        prospect_metadata = source_prospect.metadata or {}
        prospect_metadata.update(
            {
                "converted_subscription_id": subscription.id,
                "converted_capa_id": capa.id,
                "converted_at": timezone.now().isoformat(),
                "converted_by": actor_label,
            }
        )
        conversion_note = f"Convertido a cliente SaaS #{subscription.id}: {capa.nombre}."
        existing_notes = (source_prospect.notas_internas or "").strip()
        source_prospect.etapa = "GANADO"
        source_prospect.notas_internas = (
            f"{existing_notes}\n{conversion_note}" if existing_notes else conversion_note
        )
        if plan.solution_id:
            source_prospect.solution = plan.solution
        source_prospect.atendido_por = context.user
        source_prospect.atendido_en = timezone.now()
        source_prospect.metadata = prospect_metadata
        source_prospect.save(
            update_fields=[
                "etapa",
                "notas_internas",
                "solution",
                "atendido_por",
                "atendido_en",
                "metadata",
                "fecha_actualizacion",
            ]
        )
    mark_subscription_event(
        capa=capa,
        subscription=subscription,
        proveedor="BACKOFFICE",
        tipo_evento="subscription.backoffice.created",
        payload={
            "plan_id": plan.id,
            "plan": plan.clave,
            "solution": plan.solution.clave if plan.solution_id else None,
            "estatus": status,
            "periodicidad": periodicidad,
        },
    )
    audit(
        actor=context.user,
        capa=capa,
        accion="SUSCRIPCION_BACKOFFICE_CREADA",
        recurso_tipo="SuscripcionCapa",
        recurso_id=subscription.id,
        metadata={
            "plan_id": plan.id,
            "solution": plan.solution.clave if plan.solution_id else None,
            "estatus": status,
            "periodicidad": periodicidad,
        },
    )
    if source_prospect:
        audit(
            actor=context.user,
            capa=capa,
            accion="PROSPECTO_COMERCIAL_CONVERTIDO",
            recurso_tipo="ProspectoComercial",
            recurso_id=source_prospect.id,
            metadata={
                "subscription_id": subscription.id,
                "plan_id": plan.id,
                "solution": plan.solution.clave if plan.solution_id else None,
            },
        )
    refreshed = SuscripcionCapa.objects.select_related(
        "capa_negocio",
        "plan",
        "plan__solution",
    ).get(id=subscription.id)
    return {
        "mensaje": "Cliente SaaS creado y plan asignado correctamente.",
        "subscription": serialize_subscription_admin(refreshed),
        "modulos_disponibles": PLAN_MODULE_DEFINITIONS,
        "funciones_disponibles": PLAN_FEATURE_DEFINITIONS,
    }


@router.patch("/admin/suscripciones/{subscription_id}/comercial/")
@transaction.atomic
def update_business_admin_subscription_commercial(
    request,
    subscription_id: int,
    payload: AdminSubscriptionCommercialUpdateIn,
):
    context = require_platform_admin_access(request)
    subscription = get_object_or_404(
        SuscripcionCapa.objects.select_related("capa_negocio", "plan", "plan__solution"),
        id=subscription_id,
    )
    require_operational_subscription(subscription)
    plan = subscription.plan
    if payload.plan_id:
        plan = get_object_or_404(
            PlanSaaS.objects.select_related("solution"),
            id=payload.plan_id,
            activo=True,
        )
    status = (
        normalize_admin_subscription_status(payload.estatus)
        if (payload.estatus or "").strip()
        else subscription.estatus
    )
    periodicidad = (
        normalize_subscription_periodicity(payload.periodicidad)
        if (payload.periodicidad or "").strip()
        else subscription.periodicidad
    )
    fecha_inicio, fecha_fin = resolve_admin_subscription_window(
        plan,
        status=status,
        periodicidad=periodicidad,
        fecha_inicio=payload.fecha_inicio or subscription.fecha_inicio,
        fecha_fin_periodo_actual=(
            payload.fecha_fin_periodo_actual or subscription.fecha_fin_periodo_actual
        ),
    )

    capa = subscription.capa_negocio
    capa_updates = []
    nombre = (payload.nombre or "").strip()
    if nombre and nombre != capa.nombre:
        if CapaNegocio.objects.filter(nombre__iexact=nombre).exclude(id=capa.id).exists():
            raise HttpError(400, "Ya existe otra capa con ese nombre.")
        capa.nombre = nombre
        capa_updates.append("nombre")
    if (payload.tipo_capa or "").strip():
        capa.tipo_capa = normalize_admin_capa_type(payload.tipo_capa)
        capa_updates.append("tipo_capa")
    capa.nombre_administrador = (payload.nombre_administrador or "").strip() or None
    capa.correo_contacto = (payload.correo_contacto or "").strip() or None
    capa.telefono_contacto = (payload.telefono_contacto or "").strip() or None
    capa_updates.extend(["nombre_administrador", "correo_contacto", "telefono_contacto"])
    capa.save(update_fields=sorted(set(capa_updates)))

    previous_plan_id = subscription.plan_id
    previous_status = subscription.estatus
    actor_label = context.user.email or context.user.username
    metadata = subscription.metadata or {}
    followup = build_commercial_followup_metadata(payload, actor_label=actor_label)
    metadata["backoffice_commercial_update"] = {
        "updated_by": actor_label,
        "updated_at": timezone.now().isoformat(),
        "previous_plan_id": previous_plan_id,
        "new_plan_id": plan.id,
        "previous_status": previous_status,
        "new_status": status,
        "notes": (payload.notas or "").strip(),
    }
    metadata[COMMERCIAL_FOLLOWUP_METADATA_KEY] = followup
    subscription.plan = plan
    subscription.estatus = status
    subscription.periodicidad = periodicidad
    subscription.fecha_inicio = fecha_inicio
    subscription.fecha_fin_periodo_actual = fecha_fin
    if payload.auto_renueva is not None:
        subscription.auto_renueva = payload.auto_renueva
    subscription.metadata = metadata
    subscription.save(
        update_fields=[
            "plan",
            "estatus",
            "periodicidad",
            "fecha_inicio",
            "fecha_fin_periodo_actual",
            "auto_renueva",
            "metadata",
            "fecha_actualizacion",
        ]
    )
    mark_subscription_event(
        capa=capa,
        subscription=subscription,
        proveedor="BACKOFFICE",
        tipo_evento="subscription.backoffice.updated",
        payload={
            "previous_plan_id": previous_plan_id,
            "new_plan_id": plan.id,
            "previous_status": previous_status,
            "new_status": status,
            "periodicidad": periodicidad,
            "notes": (payload.notas or "").strip(),
        },
    )
    audit(
        actor=context.user,
        capa=capa,
        accion="SUSCRIPCION_BACKOFFICE_ACTUALIZADA",
        recurso_tipo="SuscripcionCapa",
        recurso_id=subscription.id,
        metadata={
            "previous_plan_id": previous_plan_id,
            "new_plan_id": plan.id,
            "previous_status": previous_status,
            "new_status": status,
            "periodicidad": periodicidad,
            "notes": (payload.notas or "").strip(),
            "seguimiento_estado": followup["estado"],
            "seguimiento_prioridad": followup["prioridad"],
        },
    )
    refreshed = SuscripcionCapa.objects.select_related(
        "capa_negocio",
        "plan",
        "plan__solution",
    ).get(id=subscription.id)
    return {
        "mensaje": "Suscripcion actualizada correctamente.",
        "subscription": serialize_subscription_admin(refreshed),
        "modulos_disponibles": PLAN_MODULE_DEFINITIONS,
        "funciones_disponibles": PLAN_FEATURE_DEFINITIONS,
    }


@router.patch("/admin/suscripciones/{subscription_id}/capabilities/")
@transaction.atomic
def update_business_admin_subscription_capabilities(
    request,
    subscription_id: int,
    payload: AdminSubscriptionCapabilityOverridesIn,
):
    context = require_platform_admin_access(request)
    subscription = get_object_or_404(
        SuscripcionCapa.objects.select_related("capa_negocio", "plan", "plan__solution"),
        id=subscription_id,
    )
    require_operational_subscription(subscription)
    actor_label = context.user.email or context.user.username
    overrides = build_subscription_capability_overrides(payload)
    overrides["actualizado_por"] = actor_label
    metadata = {**(subscription.metadata or {})}
    metadata[PLAN_OVERRIDE_METADATA_KEY] = overrides
    subscription.metadata = metadata
    subscription.save(update_fields=["metadata", "fecha_actualizacion"])
    mark_subscription_event(
        capa=subscription.capa_negocio,
        subscription=subscription,
        proveedor="BACKOFFICE",
        tipo_evento="subscription.capabilities.updated",
        payload={
            "plan_id": subscription.plan_id,
            "overrides_count": sum(
                len(overrides.get(key) or [])
                for key in (
                    "modulos_agregados",
                    "modulos_bloqueados",
                    "funciones_agregadas",
                    "funciones_bloqueadas",
                )
            ),
        },
    )
    audit(
        actor=context.user,
        capa=subscription.capa_negocio,
        accion="SUSCRIPCION_FUNCIONES_ACTUALIZADAS",
        recurso_tipo="SuscripcionCapa",
        recurso_id=subscription.id,
        metadata={"overrides": overrides, "plan_id": subscription.plan_id},
    )
    refreshed = SuscripcionCapa.objects.select_related(
        "capa_negocio",
        "plan",
        "plan__solution",
    ).get(
        id=subscription.id
    )
    return {
        "mensaje": "Funciones y modulos personalizados guardados correctamente.",
        "overrides": get_subscription_capability_overrides(refreshed),
        "subscription": serialize_subscription_admin(refreshed),
        "modulos_disponibles": PLAN_MODULE_DEFINITIONS,
        "funciones_disponibles": PLAN_FEATURE_DEFINITIONS,
    }


@router.post("/admin/suscripciones/{subscription_id}/vende-facil/sync/")
def sync_business_admin_subscription_catalogo(request, subscription_id: int):
    require_platform_admin_access(request)
    raise HttpError(
        409,
        "Las suscripciones historicas se conservan como solo lectura.",
    )






@router.post("/admin/suscripciones/{subscription_id}/vende-facil/provisioning-check/")
def check_business_admin_subscription_catalogo_provisioning(
    request,
    subscription_id: int,
    payload: AdminVendeFacilProvisioningCheckIn,
):
    require_platform_admin_access(request)
    raise HttpError(
        409,
        "Las suscripciones historicas se conservan como solo lectura.",
    )


@router.post("/admin/suscripciones/{subscription_id}/vende-facil/legacy-adoption/")
def adopt_business_admin_subscription_catalogo_legacy(
    request,
    subscription_id: int,
    payload: AdminVendeFacilLegacyAdoptionIn,
):
    require_platform_admin_access(request)
    raise HttpError(
        409,
        "Las suscripciones historicas se conservan como solo lectura.",
    )


@router.get("/admin/consumo/{capa_id}/estado-cuenta/")
def business_admin_usage_statement(request, capa_id: int, periodo: str = ""):
    require_platform_admin_access(request)
    capa = get_object_or_404(CapaNegocio, id=capa_id)
    try:
        return build_usage_statement(capa, periodo.strip() or None)
    except ValueError as exc:
        raise HttpError(400, str(exc)) from exc


@router.get("/admin/ventas/")
def business_admin_sales(request):
    require_platform_admin_access(request)
    all_subscriptions = list(
        SuscripcionCapa.objects.select_related(
            "capa_negocio",
            "plan",
            "plan__solution",
            "asignacion_comercial__vendedor",
        )
        .prefetch_related("costos_operativos")
        .order_by("capa_negocio__nombre", "id")
    )
    subscriptions, historical_subscriptions = split_subscription_scope(all_subscriptions)
    sellers = list(VendedorBetterP.objects.order_by("nombre", "id"))
    today = timezone.localdate()
    current_month = month_start(today)
    next_month = add_months(current_month, 1)
    month_start_dt = timezone.make_aware(datetime.combine(current_month, datetime.min.time()))
    next_month_dt = timezone.make_aware(datetime.combine(next_month, datetime.min.time()))
    prospects = [
        prospect
        for prospect in ProspectoComercial.objects.select_related("solution").all()
        if not is_retired_solution(prospect.solution)
    ]
    return {
        "resumen": build_sales_summary(subscriptions),
        "resumen_por_solucion": build_solution_business_summary(
            subscriptions,
            prospects,
            month_start_dt=month_start_dt,
            next_month_dt=next_month_dt,
        ),
        "vendedores": [serialize_seller(seller) for seller in sellers],
        "clientes": [serialize_sales_subscription(subscription) for subscription in subscriptions],
        "historical_clients": [
            serialize_historical_subscription(subscription, include_sales=True)
            for subscription in historical_subscriptions
        ],
        "scope": {
            "operational": len(subscriptions),
            "historical": len(historical_subscriptions),
        },
        "origenes": [
            {"value": value, "label": label}
            for value, label in AsignacionComercialSaaS.ORIGEN_CHOICES
        ],
        "categorias_costo": [
            {"value": value, "label": label}
            for value, label in CostoOperativoSaaS.CATEGORIA_CHOICES
        ],
    }


@router.post("/admin/ventas/vendedores/")
@transaction.atomic
def create_business_admin_seller(request, payload: SellerUpsertIn):
    context = require_platform_admin_access(request)
    defaults = build_seller_defaults(payload)
    if VendedorBetterP.objects.filter(email=defaults["email"]).exists():
        raise HttpError(400, "Ya existe un vendedor con ese correo.")
    seller = VendedorBetterP.objects.create(**defaults, creado_por=context.user)
    return {
        "mensaje": "Vendedor registrado correctamente.",
        "vendedor": serialize_seller(seller),
    }


@router.patch("/admin/ventas/vendedores/{seller_id}/")
@transaction.atomic
def update_business_admin_seller(request, seller_id: int, payload: SellerUpsertIn):
    require_platform_admin_access(request)
    seller = get_object_or_404(VendedorBetterP, id=seller_id)
    defaults = build_seller_defaults(payload)
    if VendedorBetterP.objects.exclude(id=seller.id).filter(email=defaults["email"]).exists():
        raise HttpError(400, "Ya existe otro vendedor con ese correo.")
    for field, value in defaults.items():
        setattr(seller, field, value)
    seller.save()
    return {
        "mensaje": "Vendedor actualizado correctamente.",
        "vendedor": serialize_seller(seller),
    }


@router.post("/admin/ventas/vendedores/{seller_id}/rotar-token/")
@transaction.atomic
def rotate_business_admin_seller_token(request, seller_id: int):
    require_platform_admin_access(request)
    seller = get_object_or_404(VendedorBetterP, id=seller_id)
    seller.token_acceso = secrets.token_urlsafe(32)
    seller.save(update_fields=["token_acceso", "fecha_actualizacion"])
    return {
        "mensaje": "Link del vendedor actualizado correctamente.",
        "vendedor": serialize_seller(seller),
    }


@router.patch("/admin/ventas/asignaciones/{subscription_id}/")
@transaction.atomic
def upsert_business_admin_sales_assignment(
    request,
    subscription_id: int,
    payload: SalesAssignmentUpsertIn,
):
    context = require_platform_admin_access(request)
    subscription = require_operational_subscription(
        get_object_or_404(
            SuscripcionCapa.objects.select_related("plan__solution"),
            id=subscription_id,
        )
    )
    defaults = build_assignment_defaults(payload)
    assignment, created = AsignacionComercialSaaS.objects.get_or_create(
        suscripcion=subscription,
        defaults={**defaults, "creado_por": context.user},
    )
    if not created:
        for field, value in defaults.items():
            setattr(assignment, field, value)
        assignment.save()
    assignment = AsignacionComercialSaaS.objects.select_related("vendedor", "suscripcion").get(
        id=assignment.id
    )
    return {
        "mensaje": "Asignacion comercial guardada correctamente.",
        "asignacion": serialize_sales_assignment(assignment),
    }


@router.post("/admin/ventas/costos/")
@transaction.atomic
def create_business_admin_operational_cost(request, payload: OperationalCostUpsertIn):
    context = require_platform_admin_access(request)
    subscription = require_operational_subscription(
        get_object_or_404(
            SuscripcionCapa.objects.select_related("plan__solution"),
            id=payload.suscripcion_id,
        )
    )
    defaults = build_cost_defaults(payload)
    cost = CostoOperativoSaaS.objects.create(
        suscripcion=subscription,
        creado_por=context.user,
        **defaults,
    )
    cost = CostoOperativoSaaS.objects.select_related("suscripcion__capa_negocio").get(id=cost.id)
    return {
        "mensaje": "Costo operativo registrado correctamente.",
        "costo": serialize_operational_cost(cost),
    }


@router.patch("/admin/ventas/costos/{cost_id}/")
@transaction.atomic
def update_business_admin_operational_cost(
    request,
    cost_id: int,
    payload: OperationalCostUpsertIn,
):
    require_platform_admin_access(request)
    cost = get_object_or_404(
        CostoOperativoSaaS.objects.select_related("suscripcion__capa_negocio"),
        id=cost_id,
    )
    require_operational_subscription(cost.suscripcion)
    subscription = require_operational_subscription(
        get_object_or_404(
            SuscripcionCapa.objects.select_related("plan__solution"),
            id=payload.suscripcion_id,
        )
    )
    defaults = build_cost_defaults(payload)
    cost.suscripcion = subscription
    for field, value in defaults.items():
        setattr(cost, field, value)
    cost.save()
    cost = CostoOperativoSaaS.objects.select_related("suscripcion__capa_negocio").get(id=cost.id)
    return {
        "mensaje": "Costo operativo actualizado correctamente.",
        "costo": serialize_operational_cost(cost),
    }


@router.delete("/admin/ventas/costos/{cost_id}/")
@transaction.atomic
def deactivate_business_admin_operational_cost(request, cost_id: int):
    require_platform_admin_access(request)
    cost = get_object_or_404(
        CostoOperativoSaaS.objects.select_related("suscripcion__plan__solution"),
        id=cost_id,
    )
    require_operational_subscription(cost.suscripcion)
    cost.activo = False
    cost.save(update_fields=["activo", "fecha_actualizacion"])
    return {"mensaje": "Costo operativo desactivado correctamente."}


@router.get("/ventas/vendedor/{token}/", auth=None)
def seller_commission_portal(request, token: str):
    seller = get_object_or_404(VendedorBetterP, token_acceso=token, activo=True)
    subscriptions = [
        subscription
        for subscription in (
        SuscripcionCapa.objects.select_related(
            "capa_negocio",
            "plan",
            "plan__solution",
            "asignacion_comercial__vendedor",
        )
        .prefetch_related("costos_operativos")
        .filter(asignacion_comercial__vendedor=seller)
        .order_by("capa_negocio__nombre", "id")
        )
        if not is_retired_solution(subscription.plan.solution)
    ]
    return {
        "vendedor": serialize_seller(seller, include_token=False),
        "resumen": build_sales_summary(subscriptions),
        "clientes": [serialize_sales_subscription(subscription) for subscription in subscriptions],
    }


def load_solution_catalog(*, include_retired: bool = False) -> list[Solucion]:
    ensure_default_solutions()
    queryset = Solucion.objects.annotate(
            planes_count=Count("planes", distinct=True),
            planes_activos=Count(
                "planes",
                filter=Q(planes__activo=True),
                distinct=True,
            ),
            clientes_count=Count("planes__suscripciones", distinct=True),
            clientes_activos=Count(
                "planes__suscripciones",
                filter=Q(planes__suscripciones__estatus="ACTIVA"),
                distinct=True,
            ),
        ).order_by("nombre", "id")
    if not include_retired:
        queryset = queryset.exclude(
            Q(metadata__platform_role="legacy_commerce_alias")
            | Q(metadata__has_key="retired_into")
        )
    return list(queryset)


def _solution_launch_subscription_sort_key(subscription: SuscripcionCapa):
    status_priority = {
        "ACTIVA": 0,
        "TRIAL": 1,
        "PAST_DUE": 2,
        "PENDIENTE_PAGO": 3,
        "PAUSADA": 4,
        "CANCELADA": 5,
    }
    return (
        status_priority.get(subscription.estatus, 9),
        (subscription.capa_negocio.nombre or "").lower(),
        subscription.id,
    )


def _solution_launch_return_url(context) -> str:
    return_path = "/backoffice" if is_platform_admin_user(context.user) else "/dashboard"
    return f"{platform_app_base_url()}{return_path}"


@router.get("/solution-launch/{solution_key}/")
def solution_launch_context(request, solution_key: str):
    """Contexto de entrada al segmento POS QR para la capa activa del usuario."""
    context = get_auth_context(request)
    requested_solution = (solution_key or "").strip().lower().replace("-", "_")
    if requested_solution != SOLUTION_POS_QR_KEY:
        raise HttpError(404, "Solucion no encontrada.")

    capa_ids = [membership.capa_negocio_id for membership in context.memberships]
    if not capa_ids:
        raise HttpError(403, "Tu usuario no tiene capas de negocio activas.")

    candidates = list(
        SuscripcionCapa.objects.select_related("capa_negocio", "plan", "plan__solution")
        .filter(capa_negocio_id__in=capa_ids)
        .filter(estatus__in=["ACTIVA", "TRIAL", "PAST_DUE"])
        .filter(
            Q(plan__solution__clave=SOLUTION_POS_QR_KEY)
            | Q(plan__solution__isnull=True)
        )
    )
    candidates.sort(key=_solution_launch_subscription_sort_key)
    subscription = candidates[0] if candidates else None
    if subscription is None:
        raise HttpError(
            404,
            "No encontramos una capa activa con esa solucion para tu usuario.",
        )

    ensure_default_solutions()
    solution = subscription.plan.solution or get_default_solution()
    modules = set(subscription.plan.modulos_habilitados or [])
    ready = "pos_caja" in modules

    return {
        "solution": serialize_solution(solution),
        "capa_negocio": {
            "id": subscription.capa_negocio_id,
            "nombre": subscription.capa_negocio.nombre,
            "tipo_capa": subscription.capa_negocio.tipo_capa,
        },
        "subscription": {
            "id": subscription.id,
            "estatus": subscription.estatus,
            "plan": serialize_plan(subscription.plan),
        },
        "launch": {
            "mode": "internal",
            "ready": ready,
            "url": POS_QR_ENTRY_PATH if ready else "/pos-qr/productos",
            "detail": (
                "Abre la caja del punto de venta."
                if ready
                else "Tu plan aun no incluye el modulo de caja; da de alta tu catalogo mientras tanto."
            ),
        },
        "platform": None,
    }


@router.get("/admin/soluciones/")
def business_admin_solutions(request):
    require_platform_admin_access(request)
    try:
        all_solutions = load_solution_catalog(include_retired=True)
        solutions = [
            solution for solution in all_solutions if not is_retired_solution(solution)
        ]
        historical_solutions = [
            solution for solution in all_solutions if is_retired_solution(solution)
        ]
    except DatabaseError as exc:
        raise HttpError(503, payment_migration_error_message()) from exc
    return {
        "items": [serialize_solution(solution) for solution in solutions],
        "historical_items": [
            {
                **serialize_solution(solution),
                "read_only": True,
                "history_reason": "retired_solution",
                "retired_into": "tienda_facil",
            }
            for solution in historical_solutions
        ],
        "resumen": {
            "total": len(solutions),
            "activas": sum(1 for solution in solutions if solution.estatus == "ACTIVA"),
            "beta": sum(1 for solution in solutions if solution.estatus == "BETA"),
            "incubacion": sum(
                1 for solution in solutions if solution.estatus == "INCUBACION"
            ),
            "clientes_activos": sum(
                int(getattr(solution, "clientes_activos", 0) or 0)
                for solution in solutions
            ),
        },
    }


@router.get("/admin/planes/")
def business_admin_plans(request):
    require_platform_admin_access(request)
    try:
        ensure_default_plans()
        plans = [
            plan
            for plan in PlanSaaS.objects.select_related("solution").order_by("precio_mensual", "id")
            if not is_retired_solution(plan.solution)
        ]
        solutions = [
            solution
            for solution in load_solution_catalog()
            if not is_retired_solution(solution)
        ]
    except DatabaseError as exc:
        raise HttpError(503, payment_migration_error_message()) from exc
    return {
        "items": [serialize_plan(plan) for plan in plans],
        "soluciones": [serialize_solution(solution) for solution in solutions],
        "modulos_disponibles": PLAN_MODULE_DEFINITIONS,
        "funciones_disponibles": PLAN_FEATURE_DEFINITIONS,
    }


def build_stripe_status_payload() -> dict:
    ensure_default_plans()
    config = get_or_create_payment_gateway_config()
    active_mode = normalize_stripe_mode(config.stripe_modo)
    backend_base = (getattr(settings, "BACKEND_PUBLIC_BASE_URL", "") or "").strip().rstrip("/")
    webhook_path = "/api/billing/webhooks/stripe/"
    webhook_url = f"{backend_base}{webhook_path}" if backend_base else webhook_path
    plans = list(
        PlanSaaS.objects.select_related("solution")
        .filter(activo=True)
        .order_by("precio_mensual", "id")
    )
    plans = [plan for plan in plans if not is_retired_solution(plan.solution)]
    recent_events = list(
        EventoBilling.objects.filter(proveedor="STRIPE")
        .select_related("capa_negocio", "suscripcion_relacionada")
        .order_by("-fecha_creacion", "-id")[:12]
    )

    def missing_monthly(plan: PlanSaaS) -> bool:
        if active_mode == "TEST":
            return not plan.stripe_test_price_id_mensual
        return not plan.stripe_price_id_mensual

    def missing_annual(plan: PlanSaaS) -> bool:
        if active_mode == "TEST":
            return not plan.stripe_test_price_id_anual
        return not plan.stripe_price_id_anual

    def serialize_missing_plan(plan: PlanSaaS) -> dict:
        solution_identity = get_plan_solution_identity(plan)
        return {
            "id": plan.id,
            "nombre": plan.nombre,
            "clave": plan.clave,
            "solution_id": solution_identity["solution_id"],
            "solution_key": solution_identity["solution_key"],
            "solution_name": solution_identity["solution_name"],
        }

    monthly_missing = [serialize_missing_plan(plan) for plan in plans if missing_monthly(plan)]
    annual_missing = [serialize_missing_plan(plan) for plan in plans if missing_annual(plan)]
    solution_summaries: dict[str, dict] = {}
    for plan in plans:
        solution_identity = get_plan_solution_identity(plan)
        solution_key = solution_identity["solution_key"]
        monthly_is_missing = missing_monthly(plan)
        annual_is_missing = missing_annual(plan)
        summary = solution_summaries.setdefault(
            solution_key,
            {
                "solution_id": solution_identity["solution_id"],
                "solution_key": solution_key,
                "solution_name": solution_identity["solution_name"],
                "planes_activos": 0,
                "planes_sin_price_mensual": [],
                "planes_sin_price_anual": [],
                "missing_price_ids": 0,
                "ready": True,
            },
        )
        summary["planes_activos"] += 1
        if monthly_is_missing:
            summary["planes_sin_price_mensual"].append(serialize_missing_plan(plan))
            summary["missing_price_ids"] += 1
        if annual_is_missing:
            summary["planes_sin_price_anual"].append(serialize_missing_plan(plan))
            summary["missing_price_ids"] += 1
        summary["ready"] = summary["missing_price_ids"] == 0

    commerce_plans = [
        plan
        for plan in plans
        if get_plan_solution_identity(plan)["solution_key"] == SOLUTION_POS_QR_KEY
    ]
    commerce_test_missing_monthly = [
        serialize_missing_plan(plan)
        for plan in commerce_plans
        if not plan.stripe_test_price_id_mensual
    ]
    commerce_test_missing_annual = [
        serialize_missing_plan(plan)
        for plan in commerce_plans
        if not plan.stripe_test_price_id_anual
    ]
    commerce_test_blockers = []
    if active_mode != "TEST":
        commerce_test_blockers.append(
            {
                "code": "stripe_test_mode_inactive",
                "detail": "Cambia Stripe a modo prueba antes de iniciar el checkout controlado.",
            }
        )
    if not get_stripe_secret_key_for_mode("TEST"):
        commerce_test_blockers.append(
            {
                "code": "stripe_test_secret_missing",
                "detail": "Falta configurar la secret key de Stripe en modo prueba.",
            }
        )
    if not get_stripe_webhook_secret_for_mode("TEST"):
        commerce_test_blockers.append(
            {
                "code": "stripe_test_webhook_secret_missing",
                "detail": "Falta configurar la firma del webhook de Stripe en modo prueba.",
            }
        )
    if not commerce_plans:
        commerce_test_blockers.append(
            {
                "code": "commerce_plans_missing",
                "detail": "No existen planes activos de BetterP Commerce.",
            }
        )
    if commerce_test_missing_monthly or commerce_test_missing_annual:
        commerce_test_blockers.append(
            {
                "code": "commerce_test_prices_missing",
                "detail": "Completa los Price IDs de prueba de los planes activos de BetterP Commerce.",
            }
        )

    return {
        "proveedor": "STRIPE",
        "activo": bool(get_stripe_secret_key_for_mode(active_mode)),
        "modo": active_mode.lower(),
        "stripe_modo": active_mode,
        "secret_key_configurada": bool(get_stripe_secret_key_for_mode(active_mode)),
        "secret_key_test_configurada": bool(get_stripe_secret_key_for_mode("TEST")),
        "secret_key_live_configurada": bool(get_stripe_secret_key_for_mode("LIVE")),
        "webhook_secret_configurado": bool(get_stripe_webhook_secret_for_mode(active_mode)),
        "webhook_secret_test_configurado": bool(get_stripe_webhook_secret_for_mode("TEST")),
        "webhook_secret_live_configurado": bool(get_stripe_webhook_secret_for_mode("LIVE")),
        "api_base_url": getattr(settings, "STRIPE_API_BASE_URL", ""),
        "webhook_url": webhook_url,
        "planes_activos": len(plans),
        "planes_sin_price_mensual": monthly_missing,
        "planes_sin_price_anual": annual_missing,
        "soluciones": sorted(
            solution_summaries.values(),
            key=lambda item: (str(item["solution_name"]).lower(), str(item["solution_key"])),
        ),
        "betterp_commerce_test_readiness": {
            "contract": "betterp.commerce.stripe-test-readiness.v1",
            "ready": not commerce_test_blockers,
            "active_mode": active_mode,
            "plans_active": len(commerce_plans),
            "missing_price_ids": (
                len(commerce_test_missing_monthly) + len(commerce_test_missing_annual)
            ),
            "plans_missing_monthly": commerce_test_missing_monthly,
            "plans_missing_annual": commerce_test_missing_annual,
            "blockers": commerce_test_blockers,
        },
        "eventos_recientes": [
            {
                "id": event.id,
                "tipo_evento": event.tipo_evento,
                "estatus": event.estatus,
                "referencia_externa": event.referencia_externa,
                "cliente": event.capa_negocio.nombre if event.capa_negocio else None,
                "fecha_creacion": event.fecha_creacion,
                "detalle_error": event.detalle_error,
            }
            for event in recent_events
        ],
    }


def serialize_platform_billing_profile(capa: CapaNegocio) -> dict:
    config = get_or_create_payment_gateway_config()
    return {
        "capa_id": capa.id,
        "config_id": config.id,
        "nombre": capa.nombre,
        "nombre_administrador": capa.nombre_administrador or "",
        "razon_social": capa.razon_social or "",
        "rfc": capa.rfc or "",
        "regimen_fiscal": capa.regimen_fiscal or "",
        "correo_contacto": capa.correo_contacto or "",
        "telefono_contacto": capa.telefono_contacto or "",
        "logo_url": capa.logo_url or "",
        "pais_fiscal": capa.pais_fiscal or "Mexico",
        "codigo_postal_fiscal": capa.codigo_postal_fiscal or "",
        "estado_fiscal": capa.estado_fiscal or "",
        "municipio_fiscal": capa.municipio_fiscal or "",
        "colonia_fiscal": capa.colonia_fiscal or "",
        "calle_fiscal": capa.calle_fiscal or "",
        "numero_exterior_fiscal": capa.numero_exterior_fiscal or "",
        "numero_interior_fiscal": capa.numero_interior_fiscal or "",
        "facturacion_activa": bool(capa.facturacion_activa),
        "facturacion_modo": capa.facturacion_modo or "MANUAL",
        "facturacion_pac_proveedor": capa.facturacion_pac_proveedor or "SIN_PROVEEDOR",
        "facturacion_serie_ingresos": capa.facturacion_serie_ingresos or "BP",
        "facturacion_lugar_expedicion": capa.facturacion_lugar_expedicion or "",
        "facturacion_producto_servicio": capa.facturacion_producto_servicio or "",
        "facturacion_unidad": capa.facturacion_unidad or "E48",
        "facturacion_uso_cfdi_default": capa.facturacion_uso_cfdi_default or "G03",
        "facturacion_metodo_pago_default": capa.facturacion_metodo_pago_default or "PUE",
        "facturacion_forma_pago_default": capa.facturacion_forma_pago_default or "03",
        "clabe_transferencias": capa.clabe_transferencias or "",
        "banco_transferencias": capa.banco_transferencias or "",
        "beneficiario_transferencias": capa.beneficiario_transferencias or "",
        "referencia_transferencia_prefijo": capa.referencia_transferencia_prefijo or "BETTERP",
        "fecha_creacion": capa.fecha_creacion,
    }


def apply_platform_billing_profile_payload(
    capa: CapaNegocio,
    payload: PlatformBillingProfileIn,
) -> CapaNegocio:
    capa.nombre = (payload.nombre or "Better Business").strip()
    capa.tipo_capa = "EMPRESA"
    capa.nombre_administrador = (payload.nombre_administrador or "").strip() or None
    capa.razon_social = (payload.razon_social or "").strip() or None
    capa.rfc = (payload.rfc or "").strip().upper() or None
    capa.regimen_fiscal = (payload.regimen_fiscal or "").strip() or None
    capa.correo_contacto = (payload.correo_contacto or "").strip() or None
    capa.telefono_contacto = (payload.telefono_contacto or "").strip() or None
    capa.logo_url = (payload.logo_url or "").strip() or None
    capa.pais_fiscal = (payload.pais_fiscal or "").strip() or "Mexico"
    capa.codigo_postal_fiscal = (payload.codigo_postal_fiscal or "").strip() or None
    capa.estado_fiscal = (payload.estado_fiscal or "").strip() or None
    capa.municipio_fiscal = (payload.municipio_fiscal or "").strip() or None
    capa.colonia_fiscal = (payload.colonia_fiscal or "").strip() or None
    capa.calle_fiscal = (payload.calle_fiscal or "").strip() or None
    capa.numero_exterior_fiscal = (payload.numero_exterior_fiscal or "").strip() or None
    capa.numero_interior_fiscal = (payload.numero_interior_fiscal or "").strip() or None
    capa.facturacion_activa = bool(payload.facturacion_activa)
    capa.facturacion_modo = (payload.facturacion_modo or "MANUAL").strip().upper()
    capa.facturacion_pac_proveedor = (
        payload.facturacion_pac_proveedor or "SIN_PROVEEDOR"
    ).strip().upper()
    capa.facturacion_serie_ingresos = (
        payload.facturacion_serie_ingresos or "BP"
    ).strip().upper()
    capa.facturacion_lugar_expedicion = (
        payload.facturacion_lugar_expedicion or ""
    ).strip() or None
    capa.facturacion_producto_servicio = (
        payload.facturacion_producto_servicio or ""
    ).strip() or None
    capa.facturacion_unidad = (payload.facturacion_unidad or "E48").strip().upper()
    capa.facturacion_uso_cfdi_default = (
        payload.facturacion_uso_cfdi_default or "G03"
    ).strip().upper()
    capa.facturacion_metodo_pago_default = (
        payload.facturacion_metodo_pago_default or "PUE"
    ).strip().upper()
    capa.facturacion_forma_pago_default = (
        payload.facturacion_forma_pago_default or "03"
    ).strip()
    capa.clabe_transferencias = "".join(
        character for character in (payload.clabe_transferencias or "") if character.isdigit()
    )[:18] or None
    capa.banco_transferencias = (payload.banco_transferencias or "").strip() or None
    capa.beneficiario_transferencias = (
        payload.beneficiario_transferencias or ""
    ).strip() or None
    capa.referencia_transferencia_prefijo = (
        payload.referencia_transferencia_prefijo or "BETTERP"
    ).strip().upper()
    capa.activo = True
    return capa


@router.get("/admin/plataforma/facturacion/")
def business_admin_platform_billing_profile(request):
    require_platform_admin_access(request)
    try:
        return serialize_platform_billing_profile(get_or_create_platform_billing_capa())
    except DatabaseError as exc:
        raise HttpError(503, payment_migration_error_message()) from exc


@router.put("/admin/plataforma/facturacion/")
@transaction.atomic
def update_business_admin_platform_billing_profile(
    request,
    payload: PlatformBillingProfileIn,
):
    require_platform_admin_access(request)
    try:
        capa = get_or_create_platform_billing_capa()
        original_name = capa.nombre
        apply_platform_billing_profile_payload(capa, payload)
        try:
            capa.save()
        except Exception as exc:
            if capa.nombre != original_name:
                raise HttpError(
                    409,
                    "Ya existe una capa con ese nombre. Usa un nombre interno distinto para el emisor BetterP.",
                ) from exc
            raise
        config = get_or_create_payment_gateway_config()
        if config.capa_facturacion_id != capa.id:
            config.capa_facturacion = capa
            config.save(update_fields=["capa_facturacion", "fecha_actualizacion"])
        return serialize_platform_billing_profile(capa)
    except DatabaseError as exc:
        raise HttpError(503, payment_migration_error_message()) from exc


@router.get("/admin/pagos/stripe/")
def business_admin_stripe_status(request):
    require_platform_admin_access(request)
    try:
        return build_stripe_status_payload()
    except DatabaseError as exc:
        raise HttpError(503, payment_migration_error_message()) from exc


@router.patch("/admin/pagos/stripe/")
@transaction.atomic
def update_business_admin_stripe_status(request, payload: PaymentGatewayConfigIn):
    require_platform_admin_access(request)
    try:
        config = get_or_create_payment_gateway_config()
        config.stripe_modo = normalize_stripe_mode(payload.stripe_modo)
        config.save(update_fields=["stripe_modo", "fecha_actualizacion"])
        return build_stripe_status_payload()
    except DatabaseError as exc:
        raise HttpError(503, payment_migration_error_message()) from exc


@router.post("/admin/pagos/stripe/clonar-live-a-test/")
def clone_business_admin_stripe_live_prices_to_test(
    request,
    solution_key: str,
    expected_plan_count: int,
    expected_missing_price_count: int,
):
    require_platform_admin_access(request)
    requested_solution_key = normalize_solution_key(solution_key)
    if requested_solution_key not in {"renta_facil", SOLUTION_POS_QR_KEY}:
        raise HttpError(400, "La solucion solicitada no admite clonacion de precios.")
    if expected_plan_count < 1 or expected_missing_price_count < 1:
        raise HttpError(400, "Los conteos esperados deben ser mayores que cero.")
    try:
        ensure_default_plans()
    except DatabaseError as exc:
        raise HttpError(503, payment_migration_error_message()) from exc
    live_secret_key = get_stripe_secret_key_for_mode("LIVE")
    test_secret_key = get_stripe_secret_key_for_mode("TEST")
    if not live_secret_key or not test_secret_key:
        raise HttpError(
            400,
            "Configura STRIPE_LIVE_SECRET_KEY y STRIPE_TEST_SECRET_KEY en Render antes de clonar.",
        )

    result = {
        "clonados": 0,
        "omitidos": 0,
        "errores": [],
        "items": [],
    }
    try:
        plans = [
            plan
            for plan in PlanSaaS.objects.select_related("solution")
            .filter(activo=True, solution__clave=requested_solution_key)
            .order_by("precio_mensual", "id")
            if not is_retired_solution(plan.solution)
        ]
    except DatabaseError as exc:
        raise HttpError(503, payment_migration_error_message()) from exc

    missing_test_prices = sum(
        1
        for plan in plans
        for test_field in (
            "stripe_test_price_id_mensual",
            "stripe_test_price_id_anual",
        )
        if not (getattr(plan, test_field) or "").strip()
    )
    missing_live_prices = sum(
        1
        for plan in plans
        for live_field in (
            "stripe_price_id_mensual",
            "stripe_price_id_anual",
        )
        if not (getattr(plan, live_field) or "").strip()
    )
    if (
        len(plans) != expected_plan_count
        or missing_test_prices != expected_missing_price_count
        or missing_live_prices
    ):
        raise HttpError(
            409,
            (
                "El alcance de clonacion cambio; no se creo ningun recurso en Stripe. "
                f"planes={len(plans)}, faltantes_test={missing_test_prices}, "
                f"faltantes_live={missing_live_prices}."
            ),
        )

    result["scope"] = {
        "solution_key": requested_solution_key,
        "plan_count": len(plans),
        "missing_price_count": missing_test_prices,
    }
    for plan in plans:
        plan_result = {
            "id": plan.id,
            "nombre": plan.nombre,
            "clave": plan.clave,
            "mensual": "sin_cambios",
            "anual": "sin_cambios",
        }
        changed_fields = []
        test_product_id = None
        price_pairs = [
            (
                "MENSUAL",
                "stripe_price_id_mensual",
                "stripe_test_price_id_mensual",
                "mensual",
            ),
            (
                "ANUAL",
                "stripe_price_id_anual",
                "stripe_test_price_id_anual",
                "anual",
            ),
        ]
        for periodicidad, live_field, test_field, result_key in price_pairs:
            live_price_id = (getattr(plan, live_field) or "").strip()
            current_test_price_id = (getattr(plan, test_field) or "").strip()
            if current_test_price_id:
                plan_result[result_key] = "ya_tenia_price_test"
                result["omitidos"] += 1
                continue
            if not live_price_id:
                plan_result[result_key] = "sin_price_live"
                result["omitidos"] += 1
                continue
            try:
                test_price_id, test_product_id = clone_stripe_live_price_to_test(
                    plan=plan,
                    periodicidad=periodicidad,
                    live_price_id=live_price_id,
                    live_secret_key=live_secret_key,
                    test_secret_key=test_secret_key,
                    test_product_id=test_product_id,
                )
                setattr(plan, test_field, test_price_id)
                changed_fields.append(test_field)
                plan_result[result_key] = test_price_id
                result["clonados"] += 1
            except ValueError as exc:
                detail = str(exc)[:500]
                plan_result[result_key] = "error"
                result["errores"].append(
                    {
                        "plan": plan.nombre,
                        "periodicidad": periodicidad,
                        "detalle": detail,
                    }
                )

        if changed_fields:
            try:
                plan.save(update_fields=[*changed_fields, "fecha_actualizacion"])
            except DatabaseError as exc:
                raise HttpError(503, payment_migration_error_message()) from exc
        result["items"].append(plan_result)

    try:
        result["stripe"] = build_stripe_status_payload()
    except DatabaseError:
        result["stripe"] = None
    return result


@router.post("/admin/planes/")
@transaction.atomic
def create_business_admin_plan(request, payload: AdminPlanUpsertIn):
    require_platform_admin_access(request)
    defaults = build_plan_defaults(payload)
    if is_retired_solution(defaults["solution"]):
        raise HttpError(409, "Los planes historicos son de solo lectura.")
    if defaults["es_default"]:
        clear_default_plans_for_solution(defaults["solution"])
    plan = PlanSaaS.objects.create(**defaults)
    if plan.es_default:
        clear_default_plans_for_solution(plan.solution, exclude_plan_id=plan.id)
    return serialize_plan(plan)


@router.patch("/admin/planes/{plan_id}/")
@transaction.atomic
def update_business_admin_plan(request, plan_id: int, payload: AdminPlanUpsertIn):
    require_platform_admin_access(request)
    plan = get_object_or_404(PlanSaaS.objects.select_related("solution"), id=plan_id)
    if is_retired_solution(plan.solution):
        raise HttpError(409, "Los planes historicos son de solo lectura.")
    defaults = build_plan_defaults(payload, existing_plan_id=plan.id)
    if is_retired_solution(defaults["solution"]):
        raise HttpError(409, "Los planes historicos son de solo lectura.")
    if defaults["es_default"]:
        clear_default_plans_for_solution(defaults["solution"], exclude_plan_id=plan.id)
    for field, value in defaults.items():
        setattr(plan, field, value)
    plan.save()
    return serialize_plan(plan)


@router.get("/admin/prospectos/")
def business_admin_prospects(request):
    require_platform_admin_access(request)
    prospects = list(
        ProspectoComercial.objects.select_related("atendido_por", "solution").all()[:100]
    )
    return {"items": [serialize_prospect(prospect) for prospect in prospects]}


@router.get("/admin/solicitudes/")
def business_admin_requests(request):
    require_platform_admin_access(request)
    prospects = list(
        ProspectoComercial.objects.select_related("atendido_por", "solution").all()[:50]
    )
    cases_base_qs = (
        CasoProcesamiento.objects.select_related(
            "cliente_relacionado",
            "entidad_relacionada",
        )
        .annotate(
            mensajes_count=Count("mensajes", distinct=True),
            evidencias_count=Count("evidencias", distinct=True),
        )
    )
    whatsapp_cases = list(
        cases_base_qs.filter(canal="WHATSAPP")
        .order_by("-fecha_ultimo_mensaje", "-id")[:50]
    )
    email_cases = list(
        cases_base_qs.filter(canal="EMAIL")
        .order_by("-fecha_ultimo_mensaje", "-id")[:50]
    )
    payment_requests = list(
        EvidenciaPago.objects.select_related(
            "cliente_relacionado",
            "entidad_relacionada",
            "caso_relacionado",
        )
        .filter(Q(estatus="NUEVA") | Q(requiere_revision_manual=True))
        .order_by("-fecha_registro", "-id")[:50]
    )
    return {
        "metricas": {
            "web_nuevos": sum(1 for prospect in prospects if prospect.etapa == "NUEVO"),
            "email_abiertos": sum(
                1
                for caso in email_cases
                if caso.estatus not in {"CONCILIADO", "DESCARTADO"}
            ),
            "whatsapp_abiertos": sum(
                1
                for caso in whatsapp_cases
                if caso.estatus not in {"CONCILIADO", "DESCARTADO"}
            ),
            "pagos_revision": len(payment_requests),
        },
        "prospectos": [serialize_prospect(prospect) for prospect in prospects],
        "emails": [serialize_inbound_case_admin(caso) for caso in email_cases],
        "whatsapp": [serialize_inbound_case_admin(caso) for caso in whatsapp_cases],
        "pagos": [serialize_payment_request_admin(evidencia) for evidencia in payment_requests],
    }




























































































@router.patch("/admin/prospectos/{prospect_id}/")
@transaction.atomic
def update_business_admin_prospect(request, prospect_id: int, payload: ProspectUpdateIn):
    context = require_platform_admin_access(request)
    prospect = get_object_or_404(ProspectoComercial, id=prospect_id)
    next_stage = (payload.etapa or "").strip().upper()
    valid_stages = {choice for choice, _ in ProspectoComercial.ETAPA_CHOICES}
    if next_stage not in valid_stages:
        raise HttpError(400, "La etapa indicada no es valida para este prospecto.")

    prospect.etapa = next_stage
    prospect.notas_internas = (payload.notas_internas or "").strip() or None
    now = timezone.now()
    update_fields = [
        "etapa",
        "notas_internas",
        "atendido_por",
        "atendido_en",
        "fecha_actualizacion",
    ]
    objection_text = (
        (payload.lost_reason or "").strip()
        or (payload.commercial_objection or "").strip()
    )
    if objection_text:
        metadata = prospect.metadata if isinstance(prospect.metadata, dict) else {}
        metadata = {**metadata}
        metadata["commercial_objection"] = objection_text
        metadata["objecion_principal"] = objection_text
        if next_stage == "PERDIDO":
            metadata["lost_reason"] = objection_text
            metadata["lost_at"] = now.isoformat()
            metadata["lost_by"] = context.user.email or context.user.get_username()
        prospect.metadata = metadata
        update_fields.append("metadata")
    if payload.excluded_from_learning is not None:
        metadata = prospect.metadata if isinstance(prospect.metadata, dict) else {}
        metadata = {**metadata}
        metadata["excluded_from_learning"] = bool(payload.excluded_from_learning)
        metadata["learning_exclusion_updated_at"] = now.isoformat()
        metadata["learning_exclusion_updated_by"] = (
            context.user.email or context.user.get_username()
        )
        prospect.metadata = metadata
        if "metadata" not in update_fields:
            update_fields.append("metadata")
    if payload.solution_key is not None:
        prospect.solution = resolve_admin_prospect_solution(payload.solution_key)
        update_fields.append("solution")
    prospect.atendido_por = context.user
    prospect.atendido_en = now
    prospect.save(update_fields=update_fields)
    return serialize_prospect(prospect)


@router.patch("/admin/casos-whatsapp/{case_id}/")
@transaction.atomic
def update_business_admin_whatsapp_case(request, case_id: int, payload: AdminCaseUpdateIn):
    require_platform_admin_access(request)
    caso = get_object_or_404(CasoProcesamiento, id=case_id)
    next_status = (payload.estatus or "").strip().upper()
    valid_statuses = {choice for choice, _ in CasoProcesamiento.ESTATUS_CHOICES}
    if next_status not in valid_statuses:
        raise HttpError(400, "El estatus indicado no es valido para este caso.")

    metadata = caso.metadata or {}
    nota_admin = (payload.nota_admin or "").strip()
    if nota_admin:
        metadata["nota_admin"] = nota_admin
    elif "nota_admin" in metadata:
        metadata.pop("nota_admin")
    caso.estatus = next_status
    caso.metadata = metadata
    caso.save(update_fields=["estatus", "metadata", "fecha_actualizacion"])
    caso = (
        CasoProcesamiento.objects.select_related("cliente_relacionado", "entidad_relacionada")
        .annotate(
            mensajes_count=Count("mensajes", distinct=True),
            evidencias_count=Count("evidencias", distinct=True),
        )
        .get(id=caso.id)
    )
    return serialize_inbound_case_admin(caso)


@router.patch("/admin/solicitudes-pago/{payment_request_id}/")
@transaction.atomic
def update_business_admin_payment_request(
    request,
    payment_request_id: int,
    payload: AdminPaymentRequestUpdateIn,
):
    require_platform_admin_access(request)
    evidencia = get_object_or_404(EvidenciaPago, id=payment_request_id)
    next_status = (payload.estatus or "").strip().upper()
    valid_statuses = {choice for choice, _ in EvidenciaPago.ESTATUS_CHOICES}
    if next_status not in valid_statuses:
        raise HttpError(400, "El estatus indicado no es valido para esta solicitud.")

    evidencia.estatus = next_status
    evidencia.observaciones = (payload.observaciones or "").strip() or evidencia.observaciones
    evidencia.save(update_fields=["estatus", "observaciones"])
    evidencia = EvidenciaPago.objects.select_related(
        "cliente_relacionado",
        "entidad_relacionada",
        "caso_relacionado",
    ).get(id=evidencia.id)
    return serialize_payment_request_admin(evidencia)


@router.post("/suscripcion/checkout/")
@transaction.atomic
def create_checkout(request, payload: CheckoutIn):
    require_admin_access(request)
    capa = get_current_capa(request)
    subscription = get_or_create_subscription_for_capa(capa)
    plan = get_object_or_404(PlanSaaS, id=payload.plan_id, activo=True)
    periodicidad = "ANUAL" if payload.periodicidad == "ANUAL" else "MENSUAL"
    success_url = payload.success_url.strip() or f"{settings.FRONTEND_BASE_URL.rstrip('/')}/configuracion"
    success_url = ensure_checkout_session_success_url(success_url)
    cancel_url = payload.cancel_url.strip() or f"{settings.FRONTEND_BASE_URL.rstrip('/')}/configuracion"

    try:
        checkout_payload = build_checkout_payload(
            capa=capa,
            subscription=subscription,
            plan=plan,
            periodicidad=periodicidad,
            success_url=success_url,
            cancel_url=cancel_url,
        )
    except ValueError as exc:
        raise HttpError(400, checkout_configuration_error_message(exc)) from exc

    try:
        response = requests.post(
            f"{settings.STRIPE_API_BASE_URL.rstrip('/')}/v1/checkout/sessions",
            headers=stripe_headers(),
            data=checkout_payload,
            timeout=20,
        )
    except requests.RequestException as exc:
        raise HttpError(502, "No se pudo abrir la pasarela de pagos. Intenta de nuevo en unos minutos.") from exc

    if response.status_code >= 400:
        stripe_body, stripe_message = parse_stripe_error_response(response)
        mark_subscription_event(
            capa=capa,
            subscription=subscription,
            proveedor="STRIPE",
            tipo_evento="checkout.session.create_failed",
            payload={
                "status_code": response.status_code,
                "stripe_error": stripe_body,
                "plan_id": plan.id,
                "periodicidad": periodicidad,
            },
            estatus="ERROR",
            detalle_error=stripe_message[:1000]
            or "Stripe rechazo la creacion de la sesion de checkout.",
        )
        raise HttpError(400, stripe_checkout_error_message(stripe_body, stripe_message))

    data = response.json()
    subscription.stripe_checkout_session_id = data.get("id") or subscription.stripe_checkout_session_id
    if subscription.estatus in {"TRIAL", "PENDIENTE_PAGO", "CANCELADA", "PAUSADA"} or not subscription.stripe_subscription_id:
        subscription.estatus = "PENDIENTE_PAGO"
    solution_identity = get_plan_solution_identity(plan)
    subscription.metadata = {
        **(subscription.metadata or {}),
        "checkout_pending": {
            "checkout_session_id": data.get("id"),
            "plan_id": plan.id,
            "plan_clave": plan.clave,
            "plan_nombre": plan.nombre,
            "solution_key": solution_identity["solution_key"],
            "solution_name": solution_identity["solution_name"],
            "periodicidad": periodicidad,
            "created_at": timezone.now().isoformat(),
        },
    }
    subscription.save()
    mark_subscription_event(
        capa=capa,
        subscription=subscription,
        proveedor="STRIPE",
        tipo_evento="checkout.session.created",
        referencia_externa=data.get("id"),
        payload=data,
    )
    return {
        "checkout_session_id": data.get("id"),
        "checkout_url": data.get("url"),
        "subscription": serialize_subscription(subscription),
    }


@router.post("/suscripcion/checkout/confirmar/")
@transaction.atomic
def confirm_checkout(request, payload: CheckoutConfirmIn):
    require_admin_access(request)
    capa = get_current_capa(request)
    current_subscription = get_or_create_subscription_for_capa(capa)
    checkout_session_id = (payload.checkout_session_id or "").strip()
    if not checkout_session_id:
        checkout_session_id = current_subscription.stripe_checkout_session_id or ""
    if not checkout_session_id:
        raise HttpError(400, "Todavia no hay una sesion de checkout para confirmar.")

    stripe_mode = get_active_stripe_mode()
    stripe_secret_key = get_stripe_secret_key_for_mode(stripe_mode)
    if not stripe_secret_key:
        raise HttpError(400, f"Falta configurar Stripe en modo {stripe_mode}.")

    try:
        session_data = stripe_api_request(
            stripe_secret_key,
            "GET",
            f"/v1/checkout/sessions/{checkout_session_id}",
            params={"expand[]": "subscription"},
        )
    except ValueError as exc:
        raise HttpError(400, f"No se pudo confirmar el pago en Stripe: {exc}") from exc

    metadata = session_data.get("metadata", {}) or {}
    suscripcion_id = metadata.get("suscripcion_id")
    subscription = None
    if suscripcion_id:
        subscription = (
            SuscripcionCapa.objects.select_related("capa_negocio", "plan")
            .filter(id=suscripcion_id, capa_negocio=capa)
            .first()
        )
    if subscription is None:
        subscription = (
            SuscripcionCapa.objects.select_related("capa_negocio", "plan")
            .filter(capa_negocio=capa, stripe_checkout_session_id=checkout_session_id)
            .first()
        )
    if subscription is None and current_subscription.stripe_checkout_session_id == checkout_session_id:
        subscription = current_subscription
    if subscription is None:
        raise HttpError(404, "Esta sesion de pago no pertenece a tu cuenta BetterP.")

    subscription = apply_completed_checkout_session_to_subscription(
        subscription=subscription,
        session_data=session_data,
    )
    mark_subscription_event(
        capa=capa,
        subscription=subscription,
        proveedor="STRIPE",
        tipo_evento="checkout.session.confirmed",
        referencia_externa=checkout_session_id,
        payload=session_data,
    )
    if subscription.estatus == "ACTIVA":
        queue_purchase_confirmation_email(
            subscription.id,
            stripe_payload=session_data,
            source="checkout.confirmed",
        )
    return {"subscription": serialize_subscription(subscription)}


@router.post("/suscripcion/cambio-plan/preview/")
def preview_subscription_plan_change(request, payload: PlanChangeIn):
    require_admin_access(request)
    capa = get_current_capa(request)
    subscription = get_or_create_subscription_for_capa(capa)
    plan = get_object_or_404(PlanSaaS, id=payload.plan_id, activo=True)
    periodicidad = normalize_subscription_periodicity(payload.periodicidad)
    preview = build_plan_change_preview(
        subscription,
        plan,
        periodicidad,
        stripe_proration_date=payload.stripe_proration_date,
    )
    readiness = build_plan_change_readiness(subscription, plan, periodicidad, preview)
    if payload.incluir_preview_stripe and readiness["puede_aplicar_inmediato"]:
        price_id = resolve_price_id_for_plan(
            plan,
            periodicidad,
            stripe_mode=readiness["stripe_modo"],
        )
        stripe_secret_key = get_stripe_secret_key_for_mode(readiness["stripe_modo"])
        if price_id and stripe_secret_key:
            try:
                preview["stripe_preview"] = build_stripe_plan_change_invoice_preview(
                    secret_key=stripe_secret_key,
                    subscription=subscription,
                    price_id=price_id,
                    proration_date=preview["stripe_proration_date"],
                )
            except ValueError as exc:
                preview["stripe_preview_error"] = str(exc)[:300]
    return {
        "preview": preview,
        "readiness": readiness,
        "stripe_modo": readiness["stripe_modo"],
        "subscription": serialize_subscription(subscription),
    }


@router.post("/suscripcion/cambio-plan/")
@transaction.atomic
def change_subscription_plan(request, payload: PlanChangeIn):
    require_admin_access(request)
    capa = get_current_capa(request)
    subscription = get_or_create_subscription_for_capa(capa)
    if subscription.estatus not in {"ACTIVA", "PAST_DUE"}:
        raise HttpError(400, "Solo puedes cambiar un plan cuando la suscripcion ya esta activa.")

    plan = get_object_or_404(PlanSaaS, id=payload.plan_id, activo=True)
    periodicidad = normalize_subscription_periodicity(payload.periodicidad)
    modo = normalize_plan_change_mode(payload.modo)
    preference = normalize_credit_preference(payload.preferencia_credito)
    preview = build_plan_change_preview(
        subscription,
        plan,
        periodicidad,
        stripe_proration_date=payload.stripe_proration_date,
    )
    if preview["tipo"] == "MISMO_PLAN":
        raise HttpError(400, "Ya estas usando este plan y ciclo de cobro.")
    pending_change = get_active_plan_change(subscription)
    if pending_change:
        raise HttpError(
            409,
            "Ya existe un cambio de plan pendiente o en revision para esta suscripcion.",
        )

    stripe_mode = get_active_stripe_mode()
    if (
        modo == "INMEDIATO"
        and stripe_mode == "LIVE"
        and (payload.confirmacion_live or "").strip() != STRIPE_LIVE_PLAN_CHANGE_CONFIRMATION
    ):
        raise HttpError(
            400,
            (
                "Para aplicar un cambio inmediato en Stripe LIVE escribe "
                f"{STRIPE_LIVE_PLAN_CHANGE_CONFIRMATION}."
            ),
        )

    change = build_plan_change_record(
        request=request,
        subscription=subscription,
        plan=plan,
        periodicidad=periodicidad,
        modo=modo,
        preferencia_credito=preference,
        estatus="EN_PROCESO",
        stripe_proration_date=preview["stripe_proration_date"],
    )

    if modo == "AL_RENOVAR" or preference == "TIEMPO":
        change.estatus = "PENDIENTE_RENOVACION"
        change.metadata = {
            **(change.metadata or {}),
            "pendiente_renovacion": {
                "plan_id": plan.id,
                "plan_nombre": plan.nombre,
                "periodicidad": periodicidad,
                "fecha_fin_periodo_actual": subscription.fecha_fin_periodo_actual.isoformat()
                if subscription.fecha_fin_periodo_actual
                else None,
            },
        }
        change.save(update_fields=["estatus", "metadata", "fecha_actualizacion"])
        subscription.metadata = {
            **(subscription.metadata or {}),
            "plan_change_pending": {
                "id": change.id,
                "plan_id": plan.id,
                "periodicidad": periodicidad,
                "created_at": timezone.now().isoformat(),
            },
        }
        subscription.save(update_fields=["metadata", "fecha_actualizacion"])
        mark_subscription_event(
            capa=capa,
            subscription=subscription,
            proveedor="SISTEMA",
            tipo_evento="subscription.plan_change.scheduled",
            referencia_externa=str(change.id),
            payload=serialize_plan_change(change),
        )
        audit(
            actor=request.auth.user,
            capa=capa,
            accion="SUSCRIPCION_CAMBIO_PLAN_PROGRAMADO",
            recurso_tipo="CambioPlanSaaS",
            recurso_id=change.id,
            metadata={"plan_id": plan.id, "periodicidad": periodicidad},
        )
        return {
            "change": serialize_plan_change(change),
            "subscription": serialize_subscription(subscription),
            "mensaje": "El cambio quedo programado para revisar al cierre del periodo actual.",
        }

    stripe_secret_key = get_stripe_secret_key_for_mode(stripe_mode)
    price_id = resolve_price_id_for_plan(plan, periodicidad, stripe_mode=stripe_mode)
    if not stripe_secret_key:
        change.estatus = "ERROR"
        change.detalle_error = f"Falta configurar Stripe en modo {stripe_mode}."
        change.save(update_fields=["estatus", "detalle_error", "fecha_actualizacion"])
        raise HttpError(400, change.detalle_error)
    if not price_id:
        change.estatus = "ERROR"
        change.detalle_error = (
            f"Este plan todavia no tiene Price ID para modo {stripe_mode}."
        )
        change.save(update_fields=["estatus", "detalle_error", "fecha_actualizacion"])
        raise HttpError(400, change.detalle_error)
    if not subscription.stripe_subscription_id:
        change.estatus = "ERROR"
        change.detalle_error = "Esta cuenta no tiene una suscripcion activa en Stripe."
        change.save(update_fields=["estatus", "detalle_error", "fecha_actualizacion"])
        raise HttpError(400, change.detalle_error)

    try:
        stripe_subscription = stripe_api_request(
            stripe_secret_key,
            "GET",
            f"/v1/subscriptions/{subscription.stripe_subscription_id}",
            params={"expand[]": "items.data.price"},
        )
        item_id = resolve_stripe_subscription_item_id(stripe_subscription)
        update_payload = build_stripe_plan_change_update_payload(
            item_id=item_id,
            price_id=price_id,
            capa=capa,
            subscription=subscription,
            change=change,
            stripe_mode=stripe_mode,
            proration_date=preview["stripe_proration_date"],
        )
        stripe_subscription = stripe_api_request(
            stripe_secret_key,
            "POST",
            f"/v1/subscriptions/{subscription.stripe_subscription_id}",
            data=update_payload,
            params={"expand[]": "latest_invoice.payment_intent"},
        )
    except ValueError as exc:
        change.estatus = "ERROR"
        change.detalle_error = str(exc)[:1000]
        change.metadata = {
            **(change.metadata or {}),
            "stripe_error": str(exc),
        }
        change.save(update_fields=["estatus", "detalle_error", "metadata", "fecha_actualizacion"])
        mark_subscription_event(
            capa=capa,
            subscription=subscription,
            proveedor="STRIPE",
            tipo_evento="subscription.plan_change.failed",
            referencia_externa=subscription.stripe_subscription_id,
            payload={"change_id": change.id, "error": str(exc)},
            estatus="ERROR",
            detalle_error=str(exc)[:1000],
        )
        raise HttpError(400, "Stripe no pudo aplicar el cambio de plan. Revisa la configuracion de pagos.") from exc

    latest_invoice = stripe_subscription.get("latest_invoice")
    latest_invoice_id = latest_invoice.get("id") if isinstance(latest_invoice, dict) else latest_invoice
    change.stripe_invoice_id = latest_invoice_id or change.stripe_invoice_id
    if preference == "REEMBOLSO" and change.saldo_a_favor_estimado > MONEY_ZERO:
        change.estatus = "REEMBOLSO_SOLICITADO"
    elif stripe_subscription.get("pending_update"):
        change.estatus = "EN_PROCESO"
    else:
        change.estatus = "APLICADO"
    change.metadata = {
        **(change.metadata or {}),
        "stripe_subscription_update": stripe_subscription,
        "price_id": price_id,
        "stripe_proration_date": preview["stripe_proration_date"],
    }
    change.save(
        update_fields=[
            "estatus",
            "stripe_invoice_id",
            "metadata",
            "fecha_actualizacion",
        ]
    )
    subscription = update_local_subscription_after_plan_change(
        subscription,
        change,
        stripe_subscription,
    )
    mark_subscription_event(
        capa=capa,
        subscription=subscription,
        proveedor="STRIPE",
        tipo_evento="subscription.plan_change.updated",
        referencia_externa=subscription.stripe_subscription_id,
        payload={
            "change": serialize_plan_change(change),
            "stripe_subscription": stripe_subscription,
        },
    )
    audit(
        actor=request.auth.user,
        capa=capa,
        accion="SUSCRIPCION_CAMBIO_PLAN_SOLICITADO",
        recurso_tipo="CambioPlanSaaS",
        recurso_id=change.id,
        metadata={
            "plan_id": plan.id,
            "periodicidad": periodicidad,
            "estatus": change.estatus,
        },
    )
    return {
        "change": serialize_plan_change(change),
        "subscription": serialize_subscription(subscription),
        "mensaje": (
            "El cambio fue aplicado y queda solicitud de reembolso para validacion interna."
            if change.estatus == "REEMBOLSO_SOLICITADO"
            else "El cambio de plan fue enviado a Stripe."
        ),
    }


@router.post("/suscripcion/portal/")
def create_billing_portal(request):
    require_admin_access(request)
    capa = get_current_capa(request)
    subscription = get_or_create_subscription_for_capa(capa)
    stripe_mode = get_active_stripe_mode()
    if not get_stripe_secret_key_for_mode(stripe_mode):
        raise HttpError(400, f"Falta configurar Stripe en modo {stripe_mode}.")
    if not subscription.stripe_customer_id:
        raise HttpError(400, "La capa actual todavia no tiene customer de Stripe enlazado.")

    try:
        response = requests.post(
            f"{settings.STRIPE_API_BASE_URL.rstrip('/')}/v1/billing_portal/sessions",
            headers=stripe_headers(),
            data={
                "customer": subscription.stripe_customer_id,
                "return_url": f"{settings.FRONTEND_BASE_URL.rstrip('/')}/configuracion",
            },
            timeout=20,
        )
    except requests.RequestException as exc:
        raise HttpError(502, f"No se pudo abrir el portal de Stripe: {exc}") from exc

    if response.status_code >= 400:
        raise HttpError(400, f"Stripe no permitio abrir el portal: {response.text[:300]}")

    data = response.json()
    return {"url": data.get("url")}


@router.get("/consumo/estado-cuenta/")
def get_current_usage_statement(request, periodo: str = ""):
    require_admin_access(request)
    capa = get_current_capa(request)
    try:
        return build_usage_statement(capa, periodo.strip() or None)
    except ValueError as exc:
        raise HttpError(400, str(exc)) from exc


@router.get("/eventos/")
def list_billing_events(request):
    capa = get_current_capa(request)
    events = list(
        EventoBilling.objects.filter(capa_negocio=capa)
        .select_related("suscripcion_relacionada", "capa_negocio")
        .order_by("-fecha_creacion", "-id")[:50]
    )
    return {
        "items": [
            {
                "id": event.id,
                "proveedor": event.proveedor,
                "tipo_evento": event.tipo_evento,
                "referencia_externa": event.referencia_externa,
                "estatus": event.estatus,
                "detalle_error": event.detalle_error,
                "fecha_creacion": event.fecha_creacion,
            }
            for event in events
        ]
    }


@router.get("/suscripcion/cambios-plan/")
def list_subscription_plan_changes(request):
    require_admin_access(request)
    capa = get_current_capa(request)
    changes = list(
        CambioPlanSaaS.objects.select_related(
            "suscripcion",
            "suscripcion__capa_negocio",
            "plan_anterior",
            "plan_nuevo",
        )
        .filter(suscripcion__capa_negocio=capa)
        .order_by("-fecha_creacion", "-id")[:20]
    )
    return {"items": [serialize_plan_change(change) for change in changes]}


@router.post("/demo/reset/")
def reset_demo_environment(request):
    require_admin_access(request)
    if getattr(settings, "APP_ENV", "") != "demo" or not getattr(settings, "DEMO_MODE", False):
        raise HttpError(403, "El reinicio de demo solo esta disponible en entorno demo.")
    if not getattr(settings, "DISABLE_OUTBOUND_INTEGRATIONS", False):
        raise HttpError(
            403,
            "No se puede reiniciar demo con integraciones salientes activas.",
        )
    call_command("seed_demo_environment", reset=True)
    return {
        "mensaje": "Entorno demo reiniciado correctamente.",
        "usuario": "demo@betterp.net",
    }


@router.post("/webhooks/stripe/", auth=None)
@transaction.atomic
def stripe_webhook(request):
    payload = getattr(request, "body", b"") or b""
    validate_stripe_signature(payload, request.headers.get("Stripe-Signature"))
    try:
        event_data = json.loads(payload.decode("utf-8") or "{}")
    except Exception:
        event_data = None
    if not isinstance(event_data, dict):
        raise HttpError(400, "El webhook de Stripe debe enviar un objeto JSON valido.")

    event_type = str(event_data.get("type") or "")
    provider_reference = str(event_data.get("id") or "")
    if already_processed_stripe_event(provider_reference):
        return {"received": True, "duplicate": True}
    subscription = None
    capa = None
    try:
        if event_type.startswith("customer.subscription."):
            subscription = upsert_subscription_from_stripe_payload(event_data)
            capa = subscription.capa_negocio if subscription else None
            data = event_data.get("data", {}).get("object", {})
            change = find_plan_change_from_stripe_event(subscription, data)
            if (
                change
                and event_type == "customer.subscription.updated"
                and not data.get("pending_update")
                and change.estatus == "EN_PROCESO"
            ):
                change.estatus = "APLICADO"
                change.metadata = {
                    **(change.metadata or {}),
                    "stripe_subscription_webhook": data,
                }
                change.save(update_fields=["estatus", "metadata", "fecha_actualizacion"])
        elif event_type == "checkout.session.completed":
            data = event_data.get("data", {}).get("object", {})
            metadata = data.get("metadata", {}) or {}
            suscripcion_id = metadata.get("suscripcion_id")
            subscription = (
                SuscripcionCapa.objects.select_related("capa_negocio", "plan")
                .filter(id=suscripcion_id)
                .first()
            )
            if subscription:
                subscription.stripe_checkout_session_id = data.get("id") or subscription.stripe_checkout_session_id
                subscription.stripe_customer_id = data.get("customer") or subscription.stripe_customer_id
                pending_plan, pending_periodicidad = resolve_pending_plan_from_metadata(metadata)
                if pending_plan is not None:
                    subscription.plan = pending_plan
                    subscription.periodicidad = pending_periodicidad
                if data.get("subscription"):
                    subscription.stripe_subscription_id = data.get("subscription")
                subscription = apply_completed_checkout_session_to_subscription(
                    subscription=subscription,
                    session_data=data,
                )
                capa = subscription.capa_negocio
                if subscription.estatus == "ACTIVA":
                    queue_purchase_confirmation_email(
                        subscription.id,
                        stripe_payload=data,
                        source="checkout.session.completed",
                    )
        elif event_type in {"invoice.payment_succeeded", "invoice.paid"}:
            data = event_data.get("data", {}).get("object", {})
            stripe_subscription_id = data.get("subscription")
            subscription = (
                SuscripcionCapa.objects.select_related("capa_negocio", "plan")
                .filter(stripe_subscription_id=stripe_subscription_id)
                .first()
            )
            if subscription:
                subscription.estatus = "ACTIVA"
                if not subscription.fecha_inicio:
                    subscription.fecha_inicio = timezone.localdate()
                subscription.metadata = {
                    **(subscription.metadata or {}),
                    "last_invoice_paid": data,
                    "last_payment_confirmed_at": timezone.now().isoformat(),
                }
                subscription.save()
                capa = subscription.capa_negocio
                change = find_plan_change_from_stripe_event(subscription, data)
                if change:
                    if change.estatus == "EN_PROCESO":
                        change.estatus = "APLICADO"
                        subscription.plan = change.plan_nuevo
                        subscription.periodicidad = change.periodicidad_nueva
                        subscription.save(update_fields=["plan", "periodicidad", "fecha_actualizacion"])
                    change.stripe_invoice_id = data.get("id") or change.stripe_invoice_id
                    change.metadata = {
                        **(change.metadata or {}),
                        "invoice_paid": data,
                    }
                    change.save(
                        update_fields=[
                            "estatus",
                            "stripe_invoice_id",
                            "metadata",
                            "fecha_actualizacion",
                        ]
                    )
                queue_purchase_confirmation_email(
                    subscription.id,
                    stripe_payload=data,
                    source=event_type,
                )
        elif event_type == "invoice.payment_failed":
            data = event_data.get("data", {}).get("object", {})
            stripe_subscription_id = data.get("subscription")
            subscription = (
                SuscripcionCapa.objects.select_related("capa_negocio", "plan")
                .filter(stripe_subscription_id=stripe_subscription_id)
                .first()
            )
            if subscription:
                subscription.estatus = "PAST_DUE"
                subscription.metadata = {
                    **(subscription.metadata or {}),
                    "last_invoice_failed": data,
                }
                subscription.save()
                capa = subscription.capa_negocio
                change = find_plan_change_from_stripe_event(subscription, data)
                if change and change.estatus == "EN_PROCESO":
                    change.estatus = "ERROR"
                    change.detalle_error = "Stripe reporto fallo de pago para el cambio de plan."
                    change.metadata = {
                        **(change.metadata or {}),
                        "invoice_payment_failed": data,
                    }
                    change.save(
                        update_fields=[
                            "estatus",
                            "detalle_error",
                            "metadata",
                            "fecha_actualizacion",
                        ]
                    )
        elif event_type.startswith("credit_note.") or event_type.startswith("refund."):
            data = event_data.get("data", {}).get("object", {})
            change = find_plan_change_from_stripe_event(None, data)
            if change:
                subscription = change.suscripcion
                capa = subscription.capa_negocio
                refund_succeeded = False
                if event_type.startswith("refund."):
                    change.stripe_refund_id = data.get("id") or change.stripe_refund_id
                    refund_succeeded = (
                        event_type == "refund.succeeded"
                        or str(data.get("status") or "").lower() == "succeeded"
                    )
                    if change.estatus == "REEMBOLSO_SOLICITADO" and refund_succeeded:
                        change.estatus = "APLICADO"
                change.metadata = {
                    **(change.metadata or {}),
                    event_type.replace(".", "_"): data,
                }
                if (
                    refund_succeeded
                    and change.estatus == "APLICADO"
                    and change.preferencia_credito == "REEMBOLSO"
                ):
                    change.metadata = {
                        **(change.metadata or {}),
                        "revision_reembolso": {
                            "cerrado_por": event_type,
                            "stripe_refund_id": change.stripe_refund_id,
                            "estado_stripe": data.get("status"),
                            "cerrado_en": timezone.now().isoformat(),
                        },
                    }
                change.save(
                    update_fields=[
                        "estatus",
                        "stripe_refund_id",
                        "metadata",
                        "fecha_actualizacion",
                    ]
                )

        mark_subscription_event(
            capa=capa,
            subscription=subscription,
            proveedor="STRIPE",
            tipo_evento=event_type or "stripe.unknown",
            referencia_externa=provider_reference or None,
            payload=event_data,
            estatus="PROCESADO",
        )
    except Exception as exc:
        mark_subscription_event(
            capa=capa,
            subscription=subscription,
            proveedor="STRIPE",
            tipo_evento=event_type or "stripe.unknown",
            referencia_externa=provider_reference or None,
            payload={"raw": payload.decode("utf-8", errors="ignore")[:4000]},
            estatus="ERROR",
            detalle_error=str(exc),
        )
        raise

    return {"received": True}
