from __future__ import annotations

import hashlib
import json
import re
from datetime import date, datetime, timedelta
from decimal import Decimal, ROUND_CEILING
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from django.conf import settings
from django.apps import apps
from django.core import signing
from django.db import IntegrityError, transaction
from django.db.utils import DatabaseError, ProgrammingError
from django.db.models import Count, F, Max, Q, Sum, Window
from django.db.models.functions import Coalesce, RowNumber
from django.utils import timezone

from accounts.models import EventoAuditoria, MembresiaCapaNegocio
from accounts.security import (
    PLAN_OVERRIDE_METADATA_KEY,
    get_effective_plan_features,
    get_effective_plan_modules,
    get_subscription_capability_overrides,
    normalize_capability_keys,
)
from comunicaciones.models import HistorialEnvio
from empresas.models import BackupCapaExport, CapaNegocio
from catalogo.models import Producto

from .models import (
    CambioPlanSaaS,
    ConfiguracionPagoPlataforma,
    ConsumoSaaS,
    EventoBilling,
    GoLiveApproval,
    MovimientoConsumoSaaS,
    PlanSaaS,
    ProspectoComercial,
    Solucion,
    SuscripcionCapa,
)


DEFAULT_TRIAL_DAYS = 10
DEFAULT_PLATFORM_BILLING_CAPA_NAME = "Better Business"
SUCCESSFUL_OUTBOUND_STATUSES = ("ENVIADO", "ENTREGADO", "LEIDO")
BILLABLE_USAGE_CATEGORIES = [
    "OPENAI_TOKENS",
    "WHATSAPP_OUTBOUND",
    "WHATSAPP_COMPROBANTE",
    "FACTURA_TIMBRE",
    "EMAIL_OUTBOUND",
    "BANK_PDF_PARSE",
    "OTRO",
]
SOLUTION_POS_QR_KEY = "pos_qr"
POS_QR_SYNC_METADATA_KEY = "pos_qr_sync"
DEFAULT_BETTERP_APP_BASE_URL = "https://posqr.betterp.net"
POS_QR_ENTRY_PATH = "/pos-qr/caja"
LEGACY_BETTERP_APP_BASE_URL = "https://app.betterp.net"




COMMERCIAL_FOLLOWUP_METADATA_KEY = "commercial_followup"
COMMERCIAL_AUDIT_ACTIONS = {
    "SUSCRIPCION_BACKOFFICE_CREADA",
    "SUSCRIPCION_BACKOFFICE_ACTUALIZADA",
    "SUSCRIPCION_FUNCIONES_ACTUALIZADAS",
    "SUSCRIPCION_MKT_ADMINISTRADO_ACTUALIZADO",
}
COMMERCIAL_BILLING_EVENT_TYPES = {
    "subscription.backoffice.created",
    "subscription.backoffice.updated",
    "subscription.capabilities.updated",
    "subscription.managed_marketing.updated",
}

DEFAULT_SOLUTIONS = [
    {
        "clave": SOLUTION_POS_QR_KEY,
        "nombre": "BetterP POS QR",
        "descripcion": (
            "Punto de venta para mostrador y restaurantes: catalogo de productos, "
            "inventario, caja con turnos, mesas y comandas, menu por codigo QR y "
            "cobro por QR."
        ),
        "estatus": "ACTIVA",
        "tipo": "INTERNA",
        "repo_origen": "pepernillo/betterp-pos-qr",
        "branch_origen": "main",
        "url_app": DEFAULT_BETTERP_APP_BASE_URL,
        "url_api": "",
        "metadata": {
            "platform_role": "primary_solution",
            "segmento": "pos_qr_restaurantes",
            "capabilities": [
                "product_master",
                "commercial_catalogs",
                "inventory",
                "pos_cashier",
                "qr_payments",
                "restaurant_tables",
                "qr_menu",
                "billing",
                "sales_reporting",
            ],
        },
    },
]


def normalize_stripe_mode(value: str | None) -> str:
    return "LIVE" if (value or "").strip().upper() == "LIVE" else "TEST"


def infer_stripe_mode_from_settings() -> str:
    configured_mode = normalize_stripe_mode(getattr(settings, "STRIPE_MODE", ""))
    if (getattr(settings, "STRIPE_MODE", "") or "").strip():
        return configured_mode
    legacy_key = (getattr(settings, "STRIPE_SECRET_KEY", "") or "").strip()
    return "LIVE" if legacy_key.startswith("sk_live_") else "TEST"


def get_payment_gateway_config() -> ConfiguracionPagoPlataforma | None:
    return ConfiguracionPagoPlataforma.objects.order_by("id").first()


def get_or_create_payment_gateway_config() -> ConfiguracionPagoPlataforma:
    config = get_payment_gateway_config()
    if config:
        return config
    return ConfiguracionPagoPlataforma.objects.create(
        nombre="default",
        stripe_modo=infer_stripe_mode_from_settings(),
    )


def get_or_create_platform_billing_capa() -> CapaNegocio:
    config = get_or_create_payment_gateway_config()
    configured_id = int(getattr(settings, "BETTERP_BILLING_CAPA_ID", 0) or 0)
    if configured_id:
        configured_capa = CapaNegocio.objects.filter(id=configured_id).first()
        if configured_capa:
            if config.capa_facturacion_id != configured_capa.id:
                config.capa_facturacion = configured_capa
                config.save(update_fields=["capa_facturacion", "fecha_actualizacion"])
            return configured_capa

    if config.capa_facturacion_id:
        capa = CapaNegocio.objects.filter(id=config.capa_facturacion_id).first()
        if capa:
            return capa

    platform_name = (
        getattr(settings, "BETTERP_BILLING_CAPA_NAME", "") or DEFAULT_PLATFORM_BILLING_CAPA_NAME
    ).strip()
    capa, _ = CapaNegocio.objects.get_or_create(
        nombre=platform_name,
        defaults={
            "tipo_capa": "EMPRESA",
            "nombre_administrador": "Backoffice BetterP",
            "pais_fiscal": "Mexico",
            "facturacion_activa": False,
            "facturacion_modo": "MANUAL",
            "facturacion_pac_proveedor": "SIN_PROVEEDOR",
            "facturacion_serie_ingresos": "BP",
            "facturacion_producto_servicio": "81112100",
            "facturacion_unidad": "E48",
            "facturacion_uso_cfdi_default": "G03",
            "facturacion_metodo_pago_default": "PUE",
            "facturacion_forma_pago_default": "03",
            "referencia_transferencia_prefijo": "BETTERP",
            "activo": True,
        },
    )
    config.capa_facturacion = capa
    config.save(update_fields=["capa_facturacion", "fecha_actualizacion"])
    return capa


def get_active_stripe_mode() -> str:
    config = get_payment_gateway_config()
    if config:
        return normalize_stripe_mode(config.stripe_modo)
    return infer_stripe_mode_from_settings()


def get_stripe_secret_key_for_mode(mode: str | None = None) -> str:
    active_mode = normalize_stripe_mode(mode or get_active_stripe_mode())
    legacy_key = (getattr(settings, "STRIPE_SECRET_KEY", "") or "").strip()
    if active_mode == "LIVE":
        return (
            (getattr(settings, "STRIPE_LIVE_SECRET_KEY", "") or "").strip()
            or (legacy_key if legacy_key.startswith("sk_live_") else "")
        )
    return (
        (getattr(settings, "STRIPE_TEST_SECRET_KEY", "") or "").strip()
        or (legacy_key if legacy_key and not legacy_key.startswith("sk_live_") else "")
    )


def get_stripe_webhook_secret_for_mode(mode: str | None = None) -> str:
    active_mode = normalize_stripe_mode(mode or get_active_stripe_mode())
    legacy_secret = (getattr(settings, "STRIPE_WEBHOOK_SECRET", "") or "").strip()
    if active_mode == "LIVE":
        return (
            (getattr(settings, "STRIPE_LIVE_WEBHOOK_SECRET", "") or "").strip()
            or legacy_secret
        )
    return (
        (getattr(settings, "STRIPE_TEST_WEBHOOK_SECRET", "") or "").strip()
        or legacy_secret
    )


def ensure_default_solutions() -> list[Solucion]:
    solutions: list[Solucion] = []
    for solution_data in DEFAULT_SOLUTIONS:
        data = dict(solution_data)
        clave = data.pop("clave")
        solution, _ = Solucion.objects.update_or_create(
            clave=clave,
            defaults=data,
        )
        solutions.append(solution)
    return solutions


def get_default_solution() -> Solucion:
    ensure_default_solutions()
    return Solucion.objects.get(clave=SOLUTION_POS_QR_KEY)


def get_plan_solution_identity(plan: PlanSaaS) -> dict:
    solution = getattr(plan, "solution", None)
    if solution:
        return {
            "solution_id": solution.id,
            "solution_key": solution.clave,
            "solution_name": solution.nombre,
        }
    return {
        "solution_id": None,
        "solution_key": SOLUTION_POS_QR_KEY,
        "solution_name": "BetterP POS QR",
    }


def normalize_platform_app_base_url(value: str | None) -> str:
    base_url = (value or "").strip().rstrip("/")
    if not base_url:
        return DEFAULT_BETTERP_APP_BASE_URL
    try:
        legacy_host = urlsplit(LEGACY_BETTERP_APP_BASE_URL).netloc.lower()
        parsed = urlsplit(base_url)
        if parsed.netloc.lower() == legacy_host:
            return DEFAULT_BETTERP_APP_BASE_URL
    except ValueError:
        return DEFAULT_BETTERP_APP_BASE_URL
    if base_url.lower() == LEGACY_BETTERP_APP_BASE_URL:
        return DEFAULT_BETTERP_APP_BASE_URL
    return base_url


def platform_app_base_url() -> str:
    configured = (
        (getattr(settings, "BETTERP_PLATFORM_BASE_URL", "") or "").strip()
        or (getattr(settings, "FRONTEND_BASE_URL", "") or "").strip()
    )
    return normalize_platform_app_base_url(configured)


def append_query_params(url: str, params: dict[str, str]) -> str:
    parts = urlsplit((url or "").strip())
    current_query = dict(parse_qsl(parts.query, keep_blank_values=True))
    current_query.update({key: value for key, value in params.items() if value})
    path = parts.path or "/"
    return urlunsplit(
        (
            parts.scheme,
            parts.netloc,
            path,
            urlencode(current_query),
            parts.fragment,
        )
    )


def catalogo_account_external_id(subscription: SuscripcionCapa) -> str:
    metadata = subscription.metadata or {}
    sync = metadata.get(POS_QR_SYNC_METADATA_KEY) or {}
    if not isinstance(sync, dict):
        sync = {}
    return str(
        sync.get("account_external_id") or f"betterp-capa-{subscription.capa_negocio_id}"
    )


def catalogo_app_base_url(subscription: SuscripcionCapa | None = None) -> str:
    """El POS vive dentro de esta misma plataforma; no hay servicio externo."""
    solution = getattr(getattr(subscription, "plan", None), "solution", None)
    if solution and solution.url_app:
        return str(solution.url_app).strip().rstrip("/")
    return platform_app_base_url()


def build_catalogo_launch_url(subscription: SuscripcionCapa) -> str:
    """URL de entrada al segmento POS QR para la capa suscrita."""
    return append_query_params(
        f"{catalogo_app_base_url(subscription)}{POS_QR_ENTRY_PATH}",
        {"capa_negocio_id": str(subscription.capa_negocio_id)},
    )












def serialize_solution(solution: Solucion) -> dict:
    return {
        "id": solution.id,
        "code": solution.clave,
        "clave": solution.clave,
        "nombre": solution.nombre,
        "descripcion": solution.descripcion,
        "estatus": solution.estatus,
        "tipo": solution.tipo,
        "repo_origen": solution.repo_origen,
        "branch_origen": solution.branch_origen,
        "url_app": solution.url_app,
        "url_api": solution.url_api,
        "metadata": solution.metadata or {},
        "planes_count": int(getattr(solution, "planes_count", 0) or 0),
        "planes_activos": int(getattr(solution, "planes_activos", 0) or 0),
        "clientes_count": int(getattr(solution, "clientes_count", 0) or 0),
        "clientes_activos": int(getattr(solution, "clientes_activos", 0) or 0),
        "fecha_creacion": solution.fecha_creacion,
        "fecha_actualizacion": solution.fecha_actualizacion,
    }


PLAN_MODULE_DEFINITIONS = [
    {
        "clave": "dashboard",
        "nombre": "Tablero de venta",
        "descripcion": "Venta del dia, ticket promedio, productos mas vendidos y estado de caja.",
    },
    {
        "clave": "catalogo",
        "nombre": "Productos y catalogos",
        "descripcion": "Alta de productos, categorias, precios y catalogos por punto de venta.",
    },
    {
        "clave": "inventario",
        "nombre": "Inventario",
        "descripcion": "Bodegas, existencias, ajustes y movimientos derivados de la venta.",
    },
    {
        "clave": "pos_caja",
        "nombre": "Caja",
        "descripcion": "Cobro en mostrador, tickets, turnos de caja y corte.",
    },
    {
        "clave": "cobro_qr",
        "nombre": "Cobro por QR",
        "descripcion": "Generacion de codigos QR de cobro y confirmacion de pago.",
    },
    {
        "clave": "restaurante",
        "nombre": "Restaurante",
        "descripcion": "Mesas, comandas, cuentas por mesa y menu publico por codigo QR.",
    },
    {
        "clave": "clientes",
        "nombre": "Clientes",
        "descripcion": "Cartera de clientes para ticket nominativo y facturacion.",
    },
    {
        "clave": "facturacion_cfdi",
        "nombre": "Facturacion CFDI",
        "descripcion": "Timbrado de tickets, borradores fiscales y seguimiento de facturas.",
    },
    {
        "clave": "finanzas",
        "nombre": "Finanzas",
        "descripcion": "Cuentas bancarias, cortes, conciliacion y cartera.",
    },
    {
        "clave": "reportes",
        "nombre": "Reportes de venta",
        "descripcion": "Venta por periodo, por producto, por caja y por forma de pago.",
    },
]


PLAN_FEATURE_DEFINITIONS = [
    {
        "clave": "menu_qr_publico",
        "nombre": "Menu QR publico",
        "descripcion": "Menu digital por mesa que el comensal abre escaneando un codigo QR.",
    },
    {
        "clave": "pedido_desde_mesa",
        "nombre": "Pedido desde la mesa",
        "descripcion": "El comensal levanta su propio pedido desde el menu QR y entra a comanda.",
    },
    {
        "clave": "propinas",
        "nombre": "Propinas",
        "descripcion": "Captura de propina en el cobro y reporte por turno.",
    },
    {
        "clave": "cuenta_dividida",
        "nombre": "Cuenta dividida",
        "descripcion": "Dividir una cuenta entre varias formas de pago o comensales.",
    },
    {
        "clave": "descuentos",
        "nombre": "Descuentos y promociones",
        "descripcion": "Descuentos por linea o por ticket con autorizacion.",
    },
    {
        "clave": "multi_caja",
        "nombre": "Varias cajas",
        "descripcion": "Mas de un punto de venta por unidad de negocio.",
    },
    {
        "clave": "impresion_tickets",
        "nombre": "Impresion de tickets",
        "descripcion": "Formato de ticket para impresora termica y comanda de cocina.",
    },
    {
        "clave": "batch_import",
        "nombre": "Carga masiva",
        "descripcion": "Importacion masiva de productos, precios y existencias.",
    },
    {
        "clave": "whatsapp_automation",
        "nombre": "WhatsApp automatizado",
        "descripcion": "Envio del ticket o del comprobante de pago por WhatsApp.",
    },
    {
        "clave": "webhooks_api",
        "nombre": "API y webhooks",
        "descripcion": "Acceso programatico e integracion con sistemas externos.",
    },
    {
        "clave": "advanced_users",
        "nombre": "Usuarios y permisos avanzados",
        "descripcion": "Roles de cajero, mesero y gerente con permisos por operacion.",
    },
    {
        "clave": "priority_support",
        "nombre": "Soporte prioritario",
        "descripcion": "Atencion con prioridad y acompanamiento de puesta en marcha.",
    },
]


def capability_scope_for_key(key: str, plan: PlanSaaS | None = None) -> str:
    if key.startswith("pos_") or key.startswith("catalogo.") or key in {
        "dashboard",
        "catalogo",
        "inventario",
        "cobro_qr",
        "restaurante",
        "clientes",
        "facturacion_cfdi",
        "finanzas",
        "reportes",
    }:
        return SOLUTION_POS_QR_KEY
    solution = getattr(plan, "solution", None)
    if solution and getattr(solution, "clave", ""):
        return solution.clave
    return "platform"


def resolve_capability_item(
    key: str,
    definitions: list[dict],
    *,
    plan: PlanSaaS | None = None,
    source: str = "PLAN",
    enabled: bool = True,
) -> dict:
    definition = next((item for item in definitions if item["clave"] == key), None)
    return {
        "clave": key,
        "nombre": (definition or {}).get("nombre") or key,
        "descripcion": (definition or {}).get("descripcion") or "",
        "scope": capability_scope_for_key(key, plan),
        "source": source,
        "enabled": enabled,
    }


def capability_coverage(items: list[dict]) -> list[dict]:
    by_scope: dict[str, dict] = {}
    for item in items:
        scope = item["scope"]
        if scope not in by_scope:
            by_scope[scope] = {
                "scope": scope,
                "enabled": 0,
                "blocked": 0,
                "extra": 0,
            }
        if item["enabled"]:
            by_scope[scope]["enabled"] += 1
        else:
            by_scope[scope]["blocked"] += 1
        if item["source"] == "EXTRA":
            by_scope[scope]["extra"] += 1
    return list(by_scope.values())


def resolve_entitlement_solution_key(plan: PlanSaaS, items: list[dict]) -> str | None:
    solution = getattr(plan, "solution", None)
    if solution and getattr(solution, "clave", ""):
        return solution.clave
    scopes = {item["scope"] for item in items}
    if SOLUTION_POS_QR_KEY in scopes:
        return SOLUTION_POS_QR_KEY
    return None


def build_plan_entitlement_summary(plan: PlanSaaS) -> dict:
    modules = [
        resolve_capability_item(key, PLAN_MODULE_DEFINITIONS, plan=plan)
        for key in normalize_capability_keys(plan.modulos_habilitados or [])
    ]
    features = [
        resolve_capability_item(key, PLAN_FEATURE_DEFINITIONS, plan=plan)
        for key in normalize_capability_keys(plan.funciones_habilitadas or [])
    ]
    items = [*modules, *features]
    return {
        "solution_key": resolve_entitlement_solution_key(plan, items),
        "modules_count": len(modules),
        "features_count": len(features),
        "modules": modules,
        "features": features,
        "coverage": capability_coverage(items),
        "has_overrides": False,
        "overrides_summary": {
            "modulos_agregados": 0,
            "modulos_bloqueados": 0,
            "funciones_agregadas": 0,
            "funciones_bloqueadas": 0,
        },
    }


def build_effective_capability_items(
    *,
    plan: PlanSaaS,
    definitions: list[dict],
    base_keys: list[str],
    effective_keys: list[str],
    added_keys: list[str],
    blocked_keys: list[str],
) -> list[dict]:
    ordered_keys = normalize_capability_keys(
        [
            *base_keys,
            *added_keys,
            *blocked_keys,
            *effective_keys,
        ]
    )
    items = []
    effective = set(effective_keys)
    added = set(added_keys)
    blocked = set(blocked_keys)
    for key in ordered_keys:
        source = "PLAN"
        enabled = key in effective
        if key in blocked:
            source = "BLOCKED"
            enabled = False
        elif key in added and key not in base_keys:
            source = "EXTRA"
        items.append(
            resolve_capability_item(
                key,
                definitions,
                plan=plan,
                source=source,
                enabled=enabled,
            )
        )
    return items


def build_subscription_entitlement_summary(
    subscription: SuscripcionCapa,
    *,
    effective_modules: list[str],
    effective_features: list[str],
    overrides: dict,
) -> dict:
    plan = subscription.plan
    module_items = build_effective_capability_items(
        plan=plan,
        definitions=PLAN_MODULE_DEFINITIONS,
        base_keys=normalize_capability_keys(plan.modulos_habilitados or []),
        effective_keys=effective_modules,
        added_keys=overrides["modulos_agregados"],
        blocked_keys=overrides["modulos_bloqueados"],
    )
    feature_items = build_effective_capability_items(
        plan=plan,
        definitions=PLAN_FEATURE_DEFINITIONS,
        base_keys=normalize_capability_keys(plan.funciones_habilitadas or []),
        effective_keys=effective_features,
        added_keys=overrides["funciones_agregadas"],
        blocked_keys=overrides["funciones_bloqueadas"],
    )
    overrides_summary = {
        "modulos_agregados": len(overrides["modulos_agregados"]),
        "modulos_bloqueados": len(overrides["modulos_bloqueados"]),
        "funciones_agregadas": len(overrides["funciones_agregadas"]),
        "funciones_bloqueadas": len(overrides["funciones_bloqueadas"]),
    }
    items = [*module_items, *feature_items]
    return {
        "solution_key": resolve_entitlement_solution_key(plan, items),
        "modules_count": len(effective_modules),
        "features_count": len(effective_features),
        "modules": module_items,
        "features": feature_items,
        "coverage": capability_coverage(items),
        "has_overrides": any(overrides_summary.values()),
        "overrides_summary": overrides_summary,
        "nota": overrides.get("nota", ""),
    }


POS_QR_BASE_MODULES = [
    "dashboard",
    "catalogo",
    "inventario",
    "pos_caja",
    "cobro_qr",
]

POS_QR_RESTAURANT_MODULES = POS_QR_BASE_MODULES + ["restaurante", "clientes"]

POS_QR_FULL_MODULES = POS_QR_RESTAURANT_MODULES + [
    "facturacion_cfdi",
    "finanzas",
    "reportes",
]



DEFAULT_PLAN_MODULES = {
    "pos_inicial": POS_QR_BASE_MODULES,
    "pos_negocio": POS_QR_RESTAURANT_MODULES + ["reportes"],
    "pos_restaurante": POS_QR_FULL_MODULES,
    "pos_multisucursal": POS_QR_FULL_MODULES,
}


DEFAULT_PLAN_FEATURES = {
    "pos_inicial": ["menu_qr_publico", "impresion_tickets"],
    "pos_negocio": [
        "menu_qr_publico",
        "impresion_tickets",
        "descuentos",
        "propinas",
        "batch_import",
    ],
    "pos_restaurante": [
        "menu_qr_publico",
        "pedido_desde_mesa",
        "impresion_tickets",
        "descuentos",
        "propinas",
        "cuenta_dividida",
        "batch_import",
        "whatsapp_automation",
        "advanced_users",
    ],
    "pos_multisucursal": [
        "menu_qr_publico",
        "pedido_desde_mesa",
        "impresion_tickets",
        "descuentos",
        "propinas",
        "cuenta_dividida",
        "multi_caja",
        "batch_import",
        "whatsapp_automation",
        "webhooks_api",
        "advanced_users",
        "priority_support",
    ],
}


DEFAULT_PLANS = [
    {
        "clave": "pos_inicial",
        "nombre": "POS Inicial",
        "descripcion": "Una caja con catalogo chico, cobro por QR y menu QR para arrancar.",
        "precio_mensual": Decimal("299.00"),
        "precio_anual": Decimal("2990.00"),
        "max_usuarios": 2,
        "max_entidades": 1,
        "max_productos": 50,
        "dias_prueba": DEFAULT_TRIAL_DAYS,
        "openai_tokens_incluidos": 20000,
        "whatsapp_mensajes_incluidos": 50,
        "comprobantes_whatsapp_incluidos": 20,
        "timbres_facturacion_incluidos": 10,
        "emails_incluidos": 100,
        "precio_openai_1k_tokens_extra": Decimal("0.0800"),
        "precio_whatsapp_mensaje_extra": Decimal("0.8000"),
        "precio_comprobante_whatsapp_extra": Decimal("1.5000"),
        "precio_timbre_facturacion_extra": Decimal("2.5000"),
        "precio_email_extra": Decimal("0.1200"),
        "es_default": True,
        "modulos_habilitados": DEFAULT_PLAN_MODULES["pos_inicial"],
        "funciones_habilitadas": DEFAULT_PLAN_FEATURES["pos_inicial"],
    },
    {
        "clave": "pos_negocio",
        "nombre": "POS Negocio",
        "descripcion": "Mostrador con catalogo completo, mesas, propinas y reportes de venta.",
        "precio_mensual": Decimal("899.00"),
        "precio_anual": Decimal("8990.00"),
        "max_usuarios": 5,
        "max_entidades": 1,
        "max_productos": 500,
        "dias_prueba": DEFAULT_TRIAL_DAYS,
        "openai_tokens_incluidos": 60000,
        "whatsapp_mensajes_incluidos": 200,
        "comprobantes_whatsapp_incluidos": 100,
        "timbres_facturacion_incluidos": 50,
        "emails_incluidos": 500,
        "precio_openai_1k_tokens_extra": Decimal("0.0800"),
        "precio_whatsapp_mensaje_extra": Decimal("0.8000"),
        "precio_comprobante_whatsapp_extra": Decimal("1.5000"),
        "precio_timbre_facturacion_extra": Decimal("2.5000"),
        "precio_email_extra": Decimal("0.1200"),
        "es_default": False,
        "modulos_habilitados": DEFAULT_PLAN_MODULES["pos_negocio"],
        "funciones_habilitadas": DEFAULT_PLAN_FEATURES["pos_negocio"],
    },
    {
        "clave": "pos_restaurante",
        "nombre": "POS Restaurante",
        "descripcion": "Restaurante completo: comandas, cuenta dividida, facturacion y finanzas.",
        "precio_mensual": Decimal("1799.00"),
        "precio_anual": Decimal("17990.00"),
        "max_usuarios": 15,
        "max_entidades": 2,
        "max_productos": 2000,
        "dias_prueba": DEFAULT_TRIAL_DAYS,
        "openai_tokens_incluidos": 150000,
        "whatsapp_mensajes_incluidos": 500,
        "comprobantes_whatsapp_incluidos": 250,
        "timbres_facturacion_incluidos": 200,
        "emails_incluidos": 1500,
        "precio_openai_1k_tokens_extra": Decimal("0.0800"),
        "precio_whatsapp_mensaje_extra": Decimal("0.8000"),
        "precio_comprobante_whatsapp_extra": Decimal("1.5000"),
        "precio_timbre_facturacion_extra": Decimal("2.5000"),
        "precio_email_extra": Decimal("0.1200"),
        "es_default": False,
        "modulos_habilitados": DEFAULT_PLAN_MODULES["pos_restaurante"],
        "funciones_habilitadas": DEFAULT_PLAN_FEATURES["pos_restaurante"],
    },
    {
        "clave": "pos_multisucursal",
        "nombre": "POS Multisucursal",
        "descripcion": "Varias sucursales y cajas, API, webhooks y soporte prioritario.",
        "precio_mensual": Decimal("3499.00"),
        "precio_anual": Decimal("34990.00"),
        "max_usuarios": 50,
        "max_entidades": 10,
        "max_productos": 20000,
        "dias_prueba": DEFAULT_TRIAL_DAYS,
        "openai_tokens_incluidos": 400000,
        "whatsapp_mensajes_incluidos": 1500,
        "comprobantes_whatsapp_incluidos": 750,
        "timbres_facturacion_incluidos": 800,
        "emails_incluidos": 5000,
        "precio_openai_1k_tokens_extra": Decimal("0.0800"),
        "precio_whatsapp_mensaje_extra": Decimal("0.8000"),
        "precio_comprobante_whatsapp_extra": Decimal("1.5000"),
        "precio_timbre_facturacion_extra": Decimal("2.5000"),
        "precio_email_extra": Decimal("0.1200"),
        "es_default": False,
        "modulos_habilitados": DEFAULT_PLAN_MODULES["pos_multisucursal"],
        "funciones_habilitadas": DEFAULT_PLAN_FEATURES["pos_multisucursal"],
    },
]






POS_QR_PLAN_SEGMENTS = {
    "pos_inicial": {
        "segmento": "Arranque",
        "resumen": "Una caja, catalogo chico y cobro por QR.",
        "cajas_incluidas": 1,
        "tickets_mensuales_referencia": 500,
    },
    "pos_negocio": {
        "segmento": "Negocio",
        "resumen": "Mostrador con catalogo completo, mesas y reportes.",
        "cajas_incluidas": 2,
        "tickets_mensuales_referencia": 3000,
    },
    "pos_restaurante": {
        "segmento": "Restaurante",
        "resumen": "Comandas, cuenta dividida, facturacion y finanzas.",
        "cajas_incluidas": 4,
        "tickets_mensuales_referencia": 12000,
    },
    "pos_multisucursal": {
        "segmento": "Multisucursal",
        "resumen": "Varias sucursales y cajas con API y soporte prioritario.",
        "cajas_incluidas": 25,
        "tickets_mensuales_referencia": 90000,
    },
}


POS_QR_CAPABILITY_MATRIX = [
    {"key": "catalogo", "label": "Alta de productos y catalogos", "module": "catalogo"},
    {"key": "inventario", "label": "Inventario y existencias", "module": "inventario"},
    {"key": "caja", "label": "Caja, tickets y turnos", "module": "pos_caja"},
    {"key": "cobro_qr", "label": "Cobro por codigo QR", "module": "cobro_qr"},
    {"key": "mesas", "label": "Mesas y comandas", "module": "restaurante"},
    {"key": "menu_qr", "label": "Menu QR publico", "feature": "menu_qr_publico"},
    {"key": "pedido_mesa", "label": "Pedido desde la mesa", "feature": "pedido_desde_mesa"},
    {"key": "propinas", "label": "Propinas", "feature": "propinas"},
    {"key": "cuenta_dividida", "label": "Cuenta dividida", "feature": "cuenta_dividida"},
    {"key": "multi_caja", "label": "Varias cajas", "feature": "multi_caja"},
    {"key": "facturacion", "label": "Facturacion CFDI", "module": "facturacion_cfdi"},
    {"key": "reportes", "label": "Reportes de venta", "module": "reportes"},
]












def is_retired_solution(solution: Solucion | None) -> bool:
    if solution is None:
        return False
    metadata = solution.metadata if isinstance(solution.metadata, dict) else {}
    return bool(
        metadata.get("retired_into")
        or metadata.get("platform_role") == "legacy_commerce_alias"
    )


def ensure_default_plans() -> list[PlanSaaS]:
    ensure_default_solutions()
    solution = Solucion.objects.get(clave=SOLUTION_POS_QR_KEY)
    plans: list[PlanSaaS] = []

    for plan_data in DEFAULT_PLANS:
        defaults = dict(plan_data)
        defaults["solution"] = solution
        existing = PlanSaaS.objects.filter(clave=plan_data["clave"]).first()
        if existing:
            defaults["es_default"] = existing.es_default
        plan, _ = PlanSaaS.objects.update_or_create(
            clave=plan_data["clave"],
            defaults=defaults,
        )
        plans.append(plan)

    has_default = PlanSaaS.objects.filter(
        solution=solution,
        activo=True,
        es_default=True,
    ).exists()
    if not has_default:
        default_key = next(
            (p["clave"] for p in DEFAULT_PLANS if p.get("es_default")),
            None,
        )
        if default_key:
            PlanSaaS.objects.filter(clave=default_key, solution=solution).update(
                es_default=True
            )
    return plans


def get_default_plan(solution_key: str | None = None) -> PlanSaaS:
    ensure_default_plans()
    queryset = PlanSaaS.objects.select_related("solution").filter(activo=True)
    if solution_key:
        queryset = queryset.filter(solution__clave=solution_key)
    default_plan = queryset.filter(es_default=True).order_by("id").first()
    if default_plan:
        return default_plan
    return queryset.order_by("precio_mensual", "id").first()


def resolve_trial_days(plan: PlanSaaS) -> int:
    return max(int(plan.dias_prueba or 0), 0)


def build_trial_metadata(plan: PlanSaaS, *, created_at=None) -> dict:
    today = created_at or timezone.localdate()
    trial_days = resolve_trial_days(plan)
    return {
        "source": "trial",
        "trial_days": trial_days,
        "trial_started_on": today.isoformat(),
        "trial_ends_on": (today + timedelta(days=trial_days)).isoformat(),
    }


def expire_trial_if_needed(subscription: SuscripcionCapa) -> SuscripcionCapa:
    if subscription.estatus != "TRIAL":
        return subscription
    today = timezone.localdate()
    trial_end = subscription.fecha_fin_periodo_actual
    if not trial_end or trial_end >= today:
        return subscription

    subscription.estatus = "PENDIENTE_PAGO"
    subscription.auto_renueva = False
    subscription.metadata = {
        **(subscription.metadata or {}),
        "trial_expired_on": trial_end.isoformat(),
        "payment_required_since": today.isoformat(),
    }
    subscription.save(
        update_fields=[
            "estatus",
            "auto_renueva",
            "metadata",
            "fecha_actualizacion",
        ]
    )
    mark_subscription_event(
        capa=subscription.capa_negocio,
        subscription=subscription,
        proveedor="SISTEMA",
        tipo_evento="subscription.trial.expired",
        payload={
            "trial_expired_on": trial_end.isoformat(),
            "payment_required_since": today.isoformat(),
        },
    )
    return subscription


def get_or_create_subscription_for_capa(capa: CapaNegocio) -> SuscripcionCapa:
    default_plan = get_default_plan()
    today = timezone.localdate()
    trial_days = resolve_trial_days(default_plan)
    initial_status = "TRIAL" if trial_days > 0 else "PENDIENTE_PAGO"
    subscription, created = SuscripcionCapa.objects.get_or_create(
        capa_negocio=capa,
        defaults={
            "plan": default_plan,
            "estatus": initial_status,
            "periodicidad": "MENSUAL",
            "fecha_inicio": today,
            "fecha_fin_periodo_actual": today + timedelta(days=trial_days),
            "auto_renueva": trial_days > 0,
            "metadata": build_trial_metadata(default_plan, created_at=today),
        },
    )
    if created:
        EventoBilling.objects.create(
            capa_negocio=capa,
            suscripcion_relacionada=subscription,
            proveedor="SISTEMA",
            tipo_evento="subscription.created.default",
            payload={"plan": default_plan.clave},
            estatus="PROCESADO",
            procesado_en=timezone.now(),
        )
    return expire_trial_if_needed(subscription)


def create_pending_checkout_subscription_for_capa(
    capa: CapaNegocio,
    *,
    plan: PlanSaaS | None = None,
    periodicidad: str = "MENSUAL",
) -> SuscripcionCapa:
    selected_plan = plan or get_default_plan()
    today = timezone.localdate()
    billing_cycle = "ANUAL" if periodicidad == "ANUAL" else "MENSUAL"
    subscription = SuscripcionCapa.objects.create(
        capa_negocio=capa,
        plan=selected_plan,
        estatus="PENDIENTE_PAGO",
        periodicidad=billing_cycle,
        fecha_inicio=None,
        fecha_fin_periodo_actual=None,
        auto_renueva=False,
        metadata={
            "source": "checkout",
            "payment_required_since": today.isoformat(),
            "requested_plan_id": selected_plan.id,
            "requested_plan_clave": selected_plan.clave,
            "requested_periodicidad": billing_cycle,
        },
    )
    EventoBilling.objects.create(
        capa_negocio=capa,
        suscripcion_relacionada=subscription,
        proveedor="SISTEMA",
        tipo_evento="subscription.created.checkout_pending",
        payload={
            "plan": selected_plan.clave,
            "periodicidad": billing_cycle,
        },
        estatus="PROCESADO",
        procesado_en=timezone.now(),
    )
    return subscription


def is_catalogo_plan(plan: PlanSaaS) -> bool:
    solution = getattr(plan, "solution", None)
    return bool(solution and solution.clave == SOLUTION_POS_QR_KEY)




def build_catalogo_plan_profile(plan: PlanSaaS) -> dict | None:
    if not is_catalogo_plan(plan):
        return None
    modules = set(plan.modulos_habilitados or [])
    features = set(plan.funciones_habilitadas or [])
    segment = POS_QR_PLAN_SEGMENTS.get(
        plan.clave,
        {
            "segmento": "A medida",
            "resumen": plan.descripcion or "Configuracion comercial personalizada.",
            "cajas_incluidas": 0,
            "tickets_mensuales_referencia": 0,
        },
    )
    capabilities = []
    for capability in POS_QR_CAPABILITY_MATRIX:
        module_key = capability.get("module")
        feature_key = capability.get("feature")
        capabilities.append(
            {
                **capability,
                "enabled": bool(
                    (module_key and module_key in modules)
                    or (feature_key and feature_key in features)
                ),
            }
        )

    return {
        "solution_key": SOLUTION_POS_QR_KEY,
        "segmento": segment["segmento"],
        "resumen": segment["resumen"],
        "primary_resource": "productos",
        "primary_resource_label": "Productos",
        "commercial_limits": {
            "productos": int(plan.max_productos or 0),
            "usuarios": int(plan.max_usuarios or 0),
            "bodegas": int(plan.max_entidades or 0),
            "cajas": int(segment["cajas_incluidas"] or 0),
            "tickets_mensuales_referencia": int(
                segment["tickets_mensuales_referencia"] or 0
            ),
        },
        "capabilities": capabilities,
    }




def build_solution_plan_profile(plan: PlanSaaS) -> dict | None:
    return build_catalogo_plan_profile(plan)


def _safe_int(value) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0






def serialize_plan(plan: PlanSaaS) -> dict:
    solution = getattr(plan, "solution", None)
    return {
        "id": plan.id,
        "clave": plan.clave,
        "nombre": plan.nombre,
        "descripcion": plan.descripcion,
        "solution": serialize_solution(solution) if solution else None,
        "activo": plan.activo,
        "es_default": plan.es_default,
        "precio_mensual": float(plan.precio_mensual or Decimal("0")),
        "precio_anual": float(plan.precio_anual or Decimal("0")),
        "max_usuarios": plan.max_usuarios,
        "max_entidades": plan.max_entidades,
        "max_productos": plan.max_productos,
        "dias_prueba": plan.dias_prueba,
        "openai_tokens_incluidos": plan.openai_tokens_incluidos,
        "whatsapp_mensajes_incluidos": plan.whatsapp_mensajes_incluidos,
        "comprobantes_whatsapp_incluidos": plan.comprobantes_whatsapp_incluidos,
        "timbres_facturacion_incluidos": plan.timbres_facturacion_incluidos,
        "emails_incluidos": plan.emails_incluidos,
        "precio_openai_1k_tokens_extra": float(plan.precio_openai_1k_tokens_extra),
        "precio_whatsapp_mensaje_extra": float(plan.precio_whatsapp_mensaje_extra),
        "precio_comprobante_whatsapp_extra": float(
            plan.precio_comprobante_whatsapp_extra
        ),
        "precio_timbre_facturacion_extra": float(plan.precio_timbre_facturacion_extra),
        "precio_email_extra": float(plan.precio_email_extra),
        "permite_google_login": plan.permite_google_login,
        "permite_webhooks": plan.permite_webhooks,
        "modulos_habilitados": plan.modulos_habilitados or [],
        "funciones_habilitadas": plan.funciones_habilitadas or [],
        "solution_profile": build_solution_plan_profile(plan),
        "entitlements": build_plan_entitlement_summary(plan),
        "stripe_test_price_id_mensual": plan.stripe_test_price_id_mensual,
        "stripe_test_price_id_anual": plan.stripe_test_price_id_anual,
        "stripe_price_id_mensual": plan.stripe_price_id_mensual,
        "stripe_price_id_anual": plan.stripe_price_id_anual,
    }


def build_subscription_usage_map(subscriptions: list[SuscripcionCapa]) -> dict[int, dict]:
    capa_ids = [subscription.capa_negocio_id for subscription in subscriptions]
    usage_map = {
        capa_id: {
            "usuarios_activos": 0,
            "entidades_activas": 0,
            "productos_activos": 0,
        }
        for capa_id in capa_ids
    }
    if not capa_ids:
        return usage_map

    membership_rows = (
        MembresiaCapaNegocio.objects.filter(capa_negocio_id__in=capa_ids, activo=True)
        .values("capa_negocio_id")
        .annotate(total=Count("id"))
    )
    for row in membership_rows:
        usage_map[row["capa_negocio_id"]]["usuarios_activos"] = row["total"]

    entity_rows = (
        CapaNegocio.objects.filter(id__in=capa_ids, entidades__activo=True)
        .values("id")
        .annotate(total=Count("entidades"))
    )
    for row in entity_rows:
        usage_map[row["id"]]["entidades_activas"] = row["total"]

    product_rows = (
        Producto.objects.filter(capa_negocio_id__in=capa_ids, activo=True)
        .values("capa_negocio_id")
        .annotate(total=Count("id"))
    )
    for row in product_rows:
        usage_map[row["capa_negocio_id"]]["productos_activos"] = row["total"]

    return usage_map


def serialize_backup_health(backup: BackupCapaExport | None) -> dict | None:
    if backup is None:
        return None
    return {
        "id": backup.id,
        "estatus": backup.estatus,
        "fecha": backup.fecha_creacion,
        "storage_backend": backup.storage_backend,
        "detalle_error": backup.detalle_error,
    }


def get_subscription_period_price(subscription: SuscripcionCapa) -> Decimal:
    plan = subscription.plan
    if subscription.periodicidad == "ANUAL":
        return Decimal(plan.precio_anual or 0).quantize(Decimal("0.01"))
    return Decimal(plan.precio_mensual or 0).quantize(Decimal("0.01"))


def get_subscription_mrr(subscription: SuscripcionCapa) -> Decimal:
    plan = subscription.plan
    if subscription.periodicidad == "ANUAL":
        return (Decimal(plan.precio_anual or 0) / Decimal("12")).quantize(
            Decimal("0.01")
        )
    return Decimal(plan.precio_mensual or 0).quantize(Decimal("0.01"))


def build_period_usage_totals_map(
    capa_ids: list[int],
    *,
    period: str,
    period_start,
    period_end,
) -> dict[int, dict[str, int]]:
    totals_map = {
        capa_id: {
            category: 0
            for category, _label in MovimientoConsumoSaaS.CATEGORIA_CHOICES
        }
        for capa_id in capa_ids
    }
    if not capa_ids:
        return totals_map

    movement_rows = (
        MovimientoConsumoSaaS.objects.filter(
            capa_negocio_id__in=capa_ids,
            periodo=period,
        )
        .values("capa_negocio_id", "categoria")
        .annotate(total=Sum("cantidad"))
    )

    for row in movement_rows:
        capa_id = row["capa_negocio_id"]
        if capa_id in totals_map:
            totals_map[capa_id][row["categoria"]] = int(row["total"] or 0)

    historial_rows = (
        HistorialEnvio.objects.annotate(
            capa_saas_id=Coalesce(
                F("entidad_relacionada__capa_negocio_id"),
                F("cliente_relacionado__entidad_relacionada__capa_negocio_id"),
            )
        )
        .filter(
            capa_saas_id__in=capa_ids,
            fecha_envio__gte=period_start,
            fecha_envio__lt=period_end,
            estatus__in=SUCCESSFUL_OUTBOUND_STATUSES,
        )
        .values("capa_saas_id", "canal")
        .annotate(total=Count("id"))
    )
    for row in historial_rows:
        capa_id = row["capa_saas_id"]
        if capa_id not in totals_map:
            continue
        if row["canal"] == "WHATSAPP":
            totals_map[capa_id]["WHATSAPP_OUTBOUND"] += int(row["total"] or 0)
        elif row["canal"] == "EMAIL":
            totals_map[capa_id]["EMAIL_OUTBOUND"] += int(row["total"] or 0)

    return totals_map


def build_customer_account_status_map(
    subscriptions: list[SuscripcionCapa],
    *,
    customer_health_map: dict[int, dict] | None = None,
    reference_datetime=None,
) -> dict[int, dict]:
    period = resolve_usage_period(reference_datetime)
    period_start, period_end = resolve_period_bounds(period)
    capa_ids = [subscription.capa_negocio_id for subscription in subscriptions]
    totals_map = build_period_usage_totals_map(
        capa_ids,
        period=period,
        period_start=period_start,
        period_end=period_end,
    )
    health_map = customer_health_map or build_customer_health_map(subscriptions)
    today = timezone.localdate()
    account_map: dict[int, dict] = {}

    for subscription in subscriptions:
        plan = subscription.plan
        capa_id = subscription.capa_negocio_id
        totals = totals_map.get(capa_id, {})
        extra_total = Decimal("0")
        exceeded_categories: list[str] = []
        preventive_categories: list[str] = []
        for category in BILLABLE_USAGE_CATEGORIES:
            total = int(totals.get(category, 0) or 0)
            included = get_usage_allowance(plan, category)
            extra = max(total - included, 0)
            unit_price = get_usage_unit_price(plan, category)
            extra_total += (Decimal(extra) * unit_price).quantize(Decimal("0.0001"))
            if included > 0 and total >= included:
                exceeded_categories.append(category)
            elif included > 0 and total >= int(included * 0.8):
                preventive_categories.append(category)

        health = health_map.get(capa_id) or {}
        period_price = get_subscription_period_price(subscription)
        mrr = get_subscription_mrr(subscription)
        days_to_renewal = (
            (subscription.fecha_fin_periodo_actual - today).days
            if subscription.fecha_fin_periodo_actual
            else None
        )

        account_state = "AL_CORRIENTE"
        recommended_action = "Mantener seguimiento normal de la cuenta."
        if subscription.estatus in {"PAST_DUE", "CANCELADA", "PAUSADA"}:
            account_state = "CRITICO"
            recommended_action = "Resolver estado de pago o acceso antes de nuevas ampliaciones."
        elif subscription.estatus == "PENDIENTE_PAGO":
            account_state = "PENDIENTE_ACTIVACION"
            recommended_action = "Dar seguimiento al checkout y confirmar primer pago."
        elif health.get("status") == "ERROR":
            account_state = "CRITICO"
            recommended_action = health.get("primary_action") or recommended_action
        elif extra_total > 0:
            account_state = "ATENCION"
            recommended_action = "Revisar consumo extra del periodo y evaluar upgrade."
        elif health.get("status") == "WARN" or exceeded_categories or preventive_categories:
            account_state = "ATENCION"
            recommended_action = health.get("primary_action") or (
                "Revisar senales preventivas antes del siguiente corte."
            )
        elif (
            days_to_renewal is not None
            and days_to_renewal <= 7
            and not subscription.auto_renueva
        ):
            account_state = "ATENCION"
            recommended_action = "Agendar renovacion manual antes del vencimiento."

        account_map[capa_id] = {
            "periodo": period,
            "estado": account_state,
            "mrr_estimado": float(mrr),
            "arr_estimado": float((mrr * Decimal("12")).quantize(Decimal("0.01"))),
            "cargo_base_periodo": float(period_price),
            "extras_estimados_periodo": float(extra_total.quantize(Decimal("0.01"))),
            "total_estimado_periodo": float(
                (period_price + extra_total).quantize(Decimal("0.01"))
            ),
            "alertas_consumo": len(exceeded_categories) + len(preventive_categories),
            "rubros_excedidos": exceeded_categories,
            "rubros_preventivos": preventive_categories,
            "dias_para_renovacion": days_to_renewal,
            "renovacion": "AUTO" if subscription.auto_renueva else "MANUAL",
            "accion_recomendada": recommended_action,
        }

    return account_map


def build_customer_account_summary(account_status_map: dict[int, dict]) -> dict:
    items = list(account_status_map.values())
    return {
        "total": len(items),
        "al_corriente": sum(1 for item in items if item["estado"] == "AL_CORRIENTE"),
        "atencion": sum(1 for item in items if item["estado"] == "ATENCION"),
        "critico": sum(1 for item in items if item["estado"] == "CRITICO"),
        "pendiente_activacion": sum(
            1 for item in items if item["estado"] == "PENDIENTE_ACTIVACION"
        ),
        "mrr_estimado": float(
            sum(
                (Decimal(str(item["mrr_estimado"])) for item in items),
                Decimal("0"),
            ).quantize(
                Decimal("0.01")
            )
        ),
        "arr_estimado": float(
            sum(
                (Decimal(str(item["arr_estimado"])) for item in items),
                Decimal("0"),
            ).quantize(
                Decimal("0.01")
            )
        ),
        "extras_estimados_periodo": float(
            sum(
                (Decimal(str(item["extras_estimados_periodo"])) for item in items),
                Decimal("0"),
            ).quantize(Decimal("0.01"))
        ),
        "clientes_con_extras": sum(
            1 for item in items if item["extras_estimados_periodo"] > 0
        ),
    }


def build_customer_health_map(
    subscriptions: list[SuscripcionCapa],
    *,
    subscription_usage_map: dict[int, dict] | None = None,
    solution_usage_map: dict[int, dict] | None = None,
) -> dict[int, dict]:
    capa_ids = [subscription.capa_negocio_id for subscription in subscriptions]
    usage_map = subscription_usage_map or build_subscription_usage_map(subscriptions)
    has_catalogo = any(
        is_catalogo_plan(subscription.plan)
        for subscription in subscriptions
    )
    solution_usage_by_capa = (
        solution_usage_map
        if solution_usage_map is not None
        else build_solution_usage_map(subscriptions)
        if has_catalogo
        else {}
    )
    today = timezone.localdate()
    now = timezone.now()
    latest_backup_by_capa: dict[int, BackupCapaExport] = {}
    billing_errors_by_capa = {capa_id: 0 for capa_id in capa_ids}
    access_denials_by_capa = {capa_id: 0 for capa_id in capa_ids}
    plan_denials_by_capa = {capa_id: 0 for capa_id in capa_ids}
    activity_by_capa = {
        capa_id: {"events_14d": 0, "last_activity_at": None}
        for capa_id in capa_ids
    }

    if capa_ids:
        for backup in (
            BackupCapaExport.objects.filter(capa_negocio_id__in=capa_ids)
            .annotate(
                health_rank=Window(
                    expression=RowNumber(),
                    partition_by=[F("capa_negocio_id")],
                    order_by=[F("fecha_creacion").desc(), F("id").desc()],
                )
            )
            .filter(health_rank=1)
        ):
            latest_backup_by_capa[backup.capa_negocio_id] = backup

        billing_rows = (
            EventoBilling.objects.filter(
                capa_negocio_id__in=capa_ids,
                estatus="ERROR",
                fecha_creacion__gte=now - timedelta(days=30),
            )
            .values("capa_negocio_id")
            .annotate(total=Count("id"))
        )
        for row in billing_rows:
            billing_errors_by_capa[row["capa_negocio_id"]] = row["total"]

        audit_rows = (
            EventoAuditoria.objects.filter(
                capa_negocio_id__in=capa_ids,
                fecha_creacion__gte=now - timedelta(days=14),
            )
            .values("capa_negocio_id")
            .annotate(
                access_denials_7d=Count(
                    "id",
                    filter=Q(
                        accion="ACCESO_DENEGADO",
                        fecha_creacion__gte=now - timedelta(days=7),
                    ),
                ),
                plan_denials_7d=Count(
                    "id",
                    filter=Q(
                        accion__in=[
                            "PLAN_MODULO_DENEGADO",
                            "PLAN_FUNCION_DENEGADA",
                        ],
                        fecha_creacion__gte=now - timedelta(days=7),
                    ),
                ),
                events_14d=Count("id"),
                last_activity_at=Max("fecha_creacion"),
            )
        )
        for row in audit_rows:
            capa_id = row["capa_negocio_id"]
            access_denials_by_capa[capa_id] = int(row["access_denials_7d"] or 0)
            plan_denials_by_capa[capa_id] = int(row["plan_denials_7d"] or 0)
            activity_by_capa[capa_id] = {
                "events_14d": int(row["events_14d"] or 0),
                "last_activity_at": row["last_activity_at"],
            }

    health_map: dict[int, dict] = {}
    for subscription in subscriptions:
        issues: list[dict] = []
        usage = usage_map.get(subscription.capa_negocio_id) or {}
        solution_usage = solution_usage_by_capa.get(subscription.capa_negocio_id) or {}
        plan = subscription.plan
        is_pos_plan = is_catalogo_plan(plan)
        active_subscription = subscription.estatus in {"ACTIVA", "TRIAL", "PAST_DUE"}
        domains = build_customer_health_domains()

        def add_issue(
            status: str,
            code: str,
            title: str,
            detail: str,
            action: str,
            *,
            domain: str,
            owner: str,
        ) -> None:
            issue = {
                "status": status,
                "code": code,
                "title": title,
                "detail": detail,
                "action": action,
                "domain": domain,
                "owner": owner,
            }
            issues.append(issue)
            register_customer_domain_issue(domains, issue)

        if subscription.estatus == "PAST_DUE":
            add_issue(
                "ERROR",
                "subscription_past_due",
                "Pago vencido",
                "La suscripcion esta past due y requiere seguimiento de cobranza.",
                "Contactar al cliente y revisar Stripe antes de mantener el acceso sin control.",
                domain="billing",
                owner="Billing",
            )
        elif subscription.estatus == "PENDIENTE_PAGO":
            add_issue(
                "WARN",
                "subscription_pending_payment",
                "Pago pendiente",
                "La cuenta todavia no completa el primer pago.",
                "Dar seguimiento comercial o reenviar checkout.",
                domain="comercial",
                owner="Comercial",
            )

        if subscription.estatus == "TRIAL" and subscription.fecha_fin_periodo_actual:
            days_left = (subscription.fecha_fin_periodo_actual - today).days
            if days_left <= 3:
                add_issue(
                    "WARN",
                    "trial_ending",
                    "Trial por vencer",
                    f"Quedan {max(days_left, 0)} dias de prueba.",
                    "Contactar al cliente para convertir o ajustar el plan.",
                    domain="comercial",
                    owner="Comercial",
                )

        if (
            subscription.estatus in {"ACTIVA", "PAST_DUE"}
            and subscription.fecha_fin_periodo_actual
        ):
            days_left = (subscription.fecha_fin_periodo_actual - today).days
            if days_left < 0:
                add_issue(
                    "ERROR",
                    "period_expired",
                    "Periodo vencido",
                    "El periodo contratado ya termino.",
                    "Revisar renovacion, Stripe y estado comercial de la cuenta.",
                    domain="billing",
                    owner="Billing",
                )
            elif days_left <= 7 and not subscription.auto_renueva:
                add_issue(
                    "WARN",
                    "manual_renewal_due",
                    "Renovacion manual cercana",
                    f"El periodo vence en {days_left} dias y no auto-renueva.",
                    "Agendar seguimiento de renovacion manual.",
                    domain="comercial",
                    owner="Comercial",
                )


        capacity_resources = [
            ("usuarios", "Usuarios", usage.get("usuarios_activos", 0), plan.max_usuarios),
        ]
        if is_pos_plan:
            for item in solution_usage.get("capacity") or []:
                capacity_resources.append(
                    (
                        f"pos_{item.get('key')}",
                        item.get("label") or str(item.get("key") or "Recurso"),
                        item.get("used", 0),
                        item.get("limit", 0),
                    )
                )
        else:
            capacity_resources.extend(
                [
                    (
                        "entidades",
                        "Entidades",
                        usage.get("entidades_activas", 0),
                        plan.max_entidades,
                    ),
                    (
                        "productos",
                        "Productos",
                        usage.get("productos_activos", 0),
                        plan.max_productos,
                    ),
                ]
            )

        for resource, label, used, limit in capacity_resources:
            ratio = (used / limit) if limit else (1 if used else 0)
            if limit and ratio > 1:
                add_issue(
                    "ERROR",
                    f"capacity_{resource}_exceeded",
                    f"{label} excedidos",
                    f"Usa {used} de {limit} incluidos en el plan.",
                    "Liberar capacidad o actualizar el plan del cliente.",
                    domain="capacidad",
                    owner="Soporte",
                )
            elif limit and ratio >= 0.8:
                add_issue(
                    "WARN",
                    f"capacity_{resource}_near_limit",
                    f"{label} cerca del limite",
                    f"Usa {used} de {limit} incluidos en el plan.",
                    "Preparar upgrade preventivo o depurar registros inactivos.",
                    domain="capacidad",
                    owner="Soporte",
                )

        if is_pos_plan and active_subscription and solution_usage.get("available", True):
            summary = solution_usage.get("summary") or {}
            limits = solution_usage.get("limits") or {}
            products_total = int(summary.get("productos_total") or 0)
            products_without_inventory = int(summary.get("productos_sin_inventario") or 0)
            tickets_open = int(summary.get("tickets_abiertos") or 0)
            qr_pending = int(summary.get("cobros_qr_pendientes") or 0)
            quality_open = int(summary.get("incidencias_calidad_abiertas") or 0)
            quality_blockers = int(summary.get("incidencias_calidad_bloqueantes") or 0)
            orders_total = int(summary.get("ordenes_total") or 0)
            orders_cancelled = int(summary.get("ordenes_canceladas") or 0)
            orders_confirmed = int(summary.get("ordenes_confirmadas") or 0)

            if products_total == 0:
                add_issue(
                    "WARN",
                    "catalogo_catalog_empty",
                    "Catalogo vacio",
                    "La cuenta no tiene productos cargados para operar ventas.",
                    "Cargar o importar el catalogo base antes de abrir la caja.",
                    domain="actividad",
                    owner="Customer Success",
                )
            elif products_without_inventory:
                add_issue(
                    "WARN",
                    "catalogo_inventory_incomplete",
                    "Productos sin inventario",
                    f"{products_without_inventory} producto(s) activo(s) no tienen stock asociado.",
                    "Abrir inventario y completar stock por bodega.",
                    domain="tecnico",
                    owner="Soporte",
                )

            if tickets_open >= 20:
                add_issue(
                    "WARN",
                    "pos_tickets_abiertos",
                    "Tickets abiertos acumulados",
                    f"{tickets_open} ticket(s) siguen abiertos sin cobrar.",
                    "Revisar cuentas abiertas y cerrar turno para no distorsionar el corte.",
                    domain="actividad",
                    owner="Operaciones",
                )

            if qr_pending >= 10:
                add_issue(
                    "WARN",
                    "pos_cobros_qr_pendientes",
                    "Cobros QR sin confirmar",
                    f"{qr_pending} cobro(s) por QR siguen pendientes de confirmacion.",
                    "Verificar la conciliacion de pagos QR y expirar los que ya no apliquen.",
                    domain="integraciones",
                    owner="Soporte",
                )

            if quality_blockers:
                add_issue(
                    "ERROR",
                    "catalogo_quality_blockers",
                    "Calidad bloqueante en catalogo",
                    f"{quality_blockers} incidencia(s) bloquean publicacion o venta.",
                    "Resolver las incidencias de calidad del catalogo.",
                    domain="tecnico",
                    owner="Operaciones",
                )
            elif quality_open:
                add_issue(
                    "WARN",
                    "catalogo_quality_open",
                    "Calidad de catalogo pendiente",
                    f"{quality_open} incidencia(s) abiertas o en revision.",
                    "Completar atributos, precio, imagenes o categoria del producto.",
                    domain="tecnico",
                    owner="Operaciones",
                )

            if orders_total >= 3 and orders_cancelled > orders_confirmed:
                add_issue(
                    "WARN",
                    "catalogo_cancellation_ratio",
                    "Cancelaciones elevadas",
                    f"{orders_cancelled} cancelada(s) vs {orders_confirmed} confirmada(s).",
                    "Revisar stock, reservas y flujo de confirmacion de venta.",
                    domain="actividad",
                    owner="Customer Success",
                )

        latest_backup = latest_backup_by_capa.get(subscription.capa_negocio_id)
        if subscription.estatus in {"ACTIVA", "TRIAL", "PAST_DUE"}:
            if latest_backup is None:
                add_issue(
                    "WARN",
                    "backup_missing",
                    "Sin backup registrado",
                    "No hay respaldos generados para esta cuenta.",
                    "Generar un backup desde Clientes SaaS.",
                    domain="backups",
                    owner="Operaciones",
                )
            elif latest_backup.estatus == "ERROR":
                add_issue(
                    "ERROR",
                    "backup_error",
                    "Ultimo backup con error",
                    latest_backup.detalle_error or "El respaldo mas reciente fallo.",
                    "Revisar R2 y regenerar respaldo.",
                    domain="backups",
                    owner="Operaciones",
                )
            elif latest_backup.fecha_creacion < now - timedelta(days=35):
                add_issue(
                    "WARN",
                    "backup_stale",
                    "Backup antiguo",
                    "El ultimo respaldo tiene mas de 35 dias.",
                    "Generar un respaldo actualizado.",
                    domain="backups",
                    owner="Operaciones",
                )

        billing_errors = billing_errors_by_capa.get(subscription.capa_negocio_id, 0)
        if billing_errors:
            add_issue(
                "WARN",
                "billing_errors",
                "Errores de billing recientes",
                f"{billing_errors} evento(s) de billing con error en 30 dias.",
                "Revisar eventos de Stripe y trazas de facturacion.",
                domain="billing",
                owner="Billing",
            )

        access_denials = access_denials_by_capa.get(subscription.capa_negocio_id, 0)
        if access_denials:
            add_issue(
                "WARN",
                "permission_denials",
                "Accesos bloqueados por rol",
                f"{access_denials} intento(s) denegado(s) por permisos en 7 dias.",
                "Revisar usuarios, roles y auditoria de la capa.",
                domain="permisos",
                owner="Soporte",
            )

        plan_denials = plan_denials_by_capa.get(subscription.capa_negocio_id, 0)
        if plan_denials:
            add_issue(
                "WARN",
                "plan_capability_denials",
                "Funciones bloqueadas por plan",
                f"{plan_denials} intento(s) bloqueado(s) por plan en 7 dias.",
                "Revisar plan contratado, modulos habilitados u overrides.",
                domain="permisos",
                owner="Soporte",
            )

        activity = activity_by_capa.get(subscription.capa_negocio_id) or {
            "events_14d": 0,
            "last_activity_at": None,
        }
        solution_summary = solution_usage.get("summary") or {}
        solution_activity = (
            int(solution_summary.get("productos_total") or 0)
            + int(solution_summary.get("puntos_venta_total") or 0)
            + int(solution_summary.get("ordenes_total") or 0)
        )
        if (
            subscription.estatus in {"ACTIVA", "TRIAL"}
            and not activity["events_14d"]
            and not solution_activity
        ):
            add_issue(
                "WARN",
                "activity_missing",
                "Sin actividad reciente",
                "No hay eventos auditados de la capa en los ultimos 14 dias.",
                "Confirmar adopcion con el cliente o revisar si la cuenta quedo inactiva.",
                domain="actividad",
                owner="Customer Success",
            )

        status = "OK"
        if any(issue["status"] == "ERROR" for issue in issues):
            status = "ERROR"
        elif issues:
            status = "WARN"

        severity_weight = {"ERROR": 35, "WARN": 15}
        score = max(
            0,
            100 - sum(severity_weight.get(issue["status"], 0) for issue in issues),
        )
        primary_action = (
            issues[0]["action"]
            if issues
            else "Cuenta sin senales criticas. Mantener monitoreo operativo normal."
        )
        risk_domains = [
            domain
            for domain in domains
            if domain["status"] != "OK"
        ]
        primary_owner = issues[0]["owner"] if issues else "Soporte"
        health_map[subscription.capa_negocio_id] = {
            "status": status,
            "score": score,
            "issues": issues,
            "domains": domains,
            "risk_domains": [domain["key"] for domain in risk_domains],
            "primary_owner": primary_owner,
            "primary_action": primary_action,
            "last_backup": serialize_backup_health(latest_backup),
            "billing_errors_30d": billing_errors,
            "access_denials_7d": access_denials,
            "plan_denials_7d": plan_denials,
            "activity_events_14d": activity["events_14d"],
            "last_activity_at": activity["last_activity_at"],
        }

    return health_map


def build_customer_health_domains() -> list[dict]:
    return [
        build_customer_health_domain("tecnico", "Tecnico", "Soporte tecnico"),
        build_customer_health_domain("integraciones", "Integraciones", "Bridge, APIs y conectores"),
        build_customer_health_domain("comercial", "Comercial", "Seguimiento comercial"),
        build_customer_health_domain("capacidad", "Capacidad", "Capacidad del plan"),
        build_customer_health_domain("billing", "Billing", "Pagos, Stripe y facturacion"),
        build_customer_health_domain("backups", "Backups", "Respaldo y restore"),
        build_customer_health_domain("permisos", "Permisos", "Roles y accesos"),
        build_customer_health_domain("actividad", "Actividad", "Adopcion y uso reciente"),
    ]


def build_customer_health_domain(key: str, label: str, description: str) -> dict:
    return {
        "key": key,
        "label": label,
        "description": description,
        "status": "OK",
        "score": 100,
        "issues": 0,
        "action": "Sin accion inmediata.",
    }


def register_customer_domain_issue(domains: list[dict], issue: dict) -> None:
    domain = next(
        (item for item in domains if item["key"] == issue["domain"]),
        None,
    )
    if domain is None:
        return
    if issue["status"] == "ERROR" or domain["status"] == "OK":
        domain["status"] = issue["status"]
    domain["issues"] += 1
    domain["score"] = max(
        0,
        domain["score"] - (35 if issue["status"] == "ERROR" else 15),
    )
    if domain["action"] == "Sin accion inmediata." or issue["status"] == "ERROR":
        domain["action"] = issue["action"]


def _commercial_audit_iso(value) -> str | None:
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def _commercial_audit_actor(actor) -> str:
    if not actor:
        return "Sistema"
    return actor.email or actor.username or "Usuario BetterP"


def _commercial_audit_int(value) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _commercial_audit_plan_label(plan_id, plans_by_id: dict[int, PlanSaaS]) -> str:
    resolved_id = _commercial_audit_int(plan_id)
    if resolved_id is None:
        return "Sin plan"
    plan = plans_by_id.get(resolved_id)
    if plan:
        return plan.nombre
    return f"Plan #{resolved_id}"


def _commercial_audit_override_count(overrides: dict | None) -> int:
    if not isinstance(overrides, dict):
        return 0
    return sum(
        len(normalize_capability_keys(overrides.get(key)))
        for key in (
            "modulos_agregados",
            "modulos_bloqueados",
            "funciones_agregadas",
            "funciones_bloqueadas",
        )
    )


def _commercial_audit_entry(
    *,
    kind: str,
    title: str,
    detail: str,
    actor: str,
    status: str,
    fecha,
) -> dict:
    return {
        "kind": kind,
        "title": title,
        "detail": detail,
        "actor": actor,
        "status": status,
        "fecha": _commercial_audit_iso(fecha),
    }


def serialize_subscription_commercial_audit(
    subscription: SuscripcionCapa,
    *,
    limit: int = 6,
) -> dict:
    safe_limit = min(max(limit, 1), 12)
    metadata = subscription.metadata or {}
    raw_override_metadata = metadata.get(PLAN_OVERRIDE_METADATA_KEY) or {}
    if not isinstance(raw_override_metadata, dict):
        raw_override_metadata = {}
    active_overrides = get_subscription_capability_overrides(subscription)
    active_override_count = _commercial_audit_override_count(active_overrides)
    missing_override_note = active_override_count > 0 and not active_overrides.get("nota")

    audit_events = list(
        EventoAuditoria.objects.select_related("actor")
        .filter(
            capa_negocio=subscription.capa_negocio,
            recurso_tipo="SuscripcionCapa",
            recurso_id=str(subscription.id),
            accion__in=COMMERCIAL_AUDIT_ACTIONS,
        )
        .order_by("-fecha_creacion", "-id")[: safe_limit * 2]
    )
    plan_changes = list(
        CambioPlanSaaS.objects.select_related("plan_anterior", "plan_nuevo", "creado_por")
        .filter(suscripcion=subscription)
        .order_by("-fecha_creacion", "-id")[:safe_limit]
    )

    plan_ids = {subscription.plan_id}
    for event in audit_events:
        event_metadata = event.metadata or {}
        plan_ids.add(_commercial_audit_int(event_metadata.get("previous_plan_id")))
        plan_ids.add(_commercial_audit_int(event_metadata.get("new_plan_id")))
        plan_ids.add(_commercial_audit_int(event_metadata.get("plan_id")))
    for change in plan_changes:
        plan_ids.add(change.plan_anterior_id)
        plan_ids.add(change.plan_nuevo_id)
    plans_by_id = {
        plan.id: plan
        for plan in PlanSaaS.objects.filter(id__in=[plan_id for plan_id in plan_ids if plan_id])
    }

    items: list[dict] = []
    for event in audit_events:
        event_metadata = event.metadata or {}
        actor_label = _commercial_audit_actor(event.actor)
        status = "OK"
        if event.accion == "SUSCRIPCION_BACKOFFICE_CREADA":
            title = "Suscripcion creada"
            detail = (
                f"Alta en {_commercial_audit_plan_label(event_metadata.get('plan_id'), plans_by_id)} "
                f"con estado {event_metadata.get('estatus') or 'sin estado'}."
            )
            kind = "PLAN_CREATED"
        elif event.accion == "SUSCRIPCION_FUNCIONES_ACTUALIZADAS":
            overrides = event_metadata.get("overrides") or {}
            override_count = _commercial_audit_override_count(overrides)
            note = (overrides.get("nota") or "").strip() if isinstance(overrides, dict) else ""
            title = "Funciones ajustadas"
            detail = (
                f"{override_count} override(s) documentado(s)."
                if note
                else f"{override_count} override(s) sin nota interna."
            )
            kind = "OVERRIDE_UPDATE"
            status = "OK" if note or override_count == 0 else "WARN"
        elif event.accion == "SUSCRIPCION_MKT_ADMINISTRADO_ACTUALIZADO":
            managed = event_metadata.get("managed_marketing") or {}
            is_enabled = bool(managed.get("enabled")) if isinstance(managed, dict) else False
            scope = (managed.get("scope") or "sin alcance") if isinstance(managed, dict) else "sin alcance"
            responsible = (
                (managed.get("responsable") or "sin responsable")
                if isinstance(managed, dict)
                else "sin responsable"
            )
            note = (managed.get("nota") or "").strip() if isinstance(managed, dict) else ""
            title = "MKT administrado actualizado"
            detail = (
                f"{'Activo' if is_enabled else 'Inactivo'} | alcance {scope} | responsable {responsible}."
            )
            kind = "MANAGED_MARKETING"
            status = "OK" if not is_enabled or note else "WARN"
        else:
            previous_plan = _commercial_audit_plan_label(
                event_metadata.get("previous_plan_id"),
                plans_by_id,
            )
            new_plan = _commercial_audit_plan_label(
                event_metadata.get("new_plan_id"),
                plans_by_id,
            )
            previous_status = event_metadata.get("previous_status") or "sin estado"
            new_status = event_metadata.get("new_status") or "sin estado"
            title = "Plan o estado actualizado"
            detail = f"{previous_plan} -> {new_plan} | {previous_status} -> {new_status}."
            kind = "PLAN_UPDATE"
        items.append(
            _commercial_audit_entry(
                kind=kind,
                title=title,
                detail=detail,
                actor=actor_label,
                status=status,
                fecha=event.fecha_creacion,
            )
        )

    for change in plan_changes:
        status = "ERROR" if change.estatus == "ERROR" else "WARN"
        if change.estatus == "APLICADO":
            status = "OK"
        items.append(
            _commercial_audit_entry(
                kind="PLAN_CHANGE",
                title=f"Cambio de plan {change.estatus.lower().replace('_', ' ')}",
                detail=(
                    f"{change.plan_anterior.nombre} -> {change.plan_nuevo.nombre} | "
                    f"{change.tipo.lower().replace('_', ' ')}."
                ),
                actor=_commercial_audit_actor(change.creado_por),
                status=status,
                fecha=change.fecha_creacion,
            )
        )

    has_override_item = any(item["kind"] == "OVERRIDE_UPDATE" for item in items)
    if active_override_count and not has_override_item:
        items.append(
            _commercial_audit_entry(
                kind="OVERRIDE_ACTIVE",
                title="Overrides comerciales activos",
                detail=active_overrides.get("nota") or "Pendiente documentar motivo interno.",
                actor=active_overrides.get("actualizado_por") or "Backoffice",
                status="OK" if active_overrides.get("nota") else "WARN",
                fecha=active_overrides.get("actualizado_en"),
            )
        )
    items.sort(key=lambda item: item.get("fecha") or "", reverse=True)
    items = items[:safe_limit]

    billing_events = EventoBilling.objects.filter(
        suscripcion_relacionada=subscription,
        tipo_evento__in=COMMERCIAL_BILLING_EVENT_TYPES,
    )
    failed_billing_events = billing_events.filter(estatus="ERROR").count()
    pending_plan_changes = sum(
        1
        for change in plan_changes
        if change.estatus in {"PREVIEW", "EN_PROCESO", "PENDIENTE_RENOVACION"}
    )
    failed_plan_changes = sum(1 for change in plan_changes if change.estatus == "ERROR")

    status = "OK"
    primary_action = "Sin cambios comerciales recientes."
    if missing_override_note:
        status = "ERROR"
        primary_action = "Documentar motivo y responsable de los overrides activos."
    elif failed_billing_events or failed_plan_changes:
        status = "ERROR"
        primary_action = "Revisar eventos comerciales o cambios de plan con error."
    elif pending_plan_changes:
        status = "WARN"
        primary_action = "Completar o resolver cambios de plan pendientes."
    elif active_override_count:
        status = "WARN"
        primary_action = "Revisar vigencia de overrides comerciales activos."
    elif items:
        primary_action = "Bitacora comercial con evidencia reciente."

    return {
        "status": status,
        "primary_action": primary_action,
        "latest_at": items[0]["fecha"] if items else None,
        "total_recent": len(items),
        "plan_changes": sum(
            1 for item in items if item["kind"] in {"PLAN_CREATED", "PLAN_UPDATE", "PLAN_CHANGE"}
        ),
        "override_changes": sum(
            1 for item in items if item["kind"] in {"OVERRIDE_UPDATE", "OVERRIDE_ACTIVE"}
        ),
        "billing_events": billing_events.count(),
        "failed_billing_events": failed_billing_events,
        "pending_plan_changes": pending_plan_changes,
        "active_overrides": active_override_count,
        "missing_override_note": missing_override_note,
        "last_override_at": active_overrides.get("actualizado_en"),
        "last_override_by": active_overrides.get("actualizado_por"),
        "items": items,
    }


def serialize_subscription_commercial_followup(subscription: SuscripcionCapa) -> dict:
    metadata = subscription.metadata or {}
    followup = metadata.get(COMMERCIAL_FOLLOWUP_METADATA_KEY)
    if not isinstance(followup, dict):
        followup = {}
    return {
        "estado": followup.get("estado") or "SIN_SEGUIMIENTO",
        "prioridad": followup.get("prioridad") or "MEDIA",
        "responsable": followup.get("responsable") or "",
        "fecha_objetivo": followup.get("fecha_objetivo"),
        "resultado_esperado": followup.get("resultado_esperado") or "",
        "actualizado_por": followup.get("actualizado_por") or "",
        "actualizado_en": followup.get("actualizado_en"),
    }




def serialize_subscription(
    subscription: SuscripcionCapa,
    *,
    usage: dict | None = None,
) -> dict:
    subscription = expire_trial_if_needed(subscription)
    capa = subscription.capa_negocio
    resolved_usage = usage or build_subscription_usage_map([subscription])[
        subscription.capa_negocio_id
    ]
    plan = subscription.plan
    today = timezone.localdate()
    trial_ends_on = subscription.fecha_fin_periodo_actual if subscription.estatus == "TRIAL" else None
    period_start = subscription.fecha_inicio or today
    period_end = subscription.fecha_fin_periodo_actual
    period_days_total = (
        max((period_end - period_start).days, 1)
        if period_end and period_end > period_start
        else 0
    )
    period_days_remaining = (
        max((period_end - today).days, 0)
        if period_end
        else 0
    )
    next_payment_on = (
        period_end
        if subscription.estatus in {"ACTIVA", "PAST_DUE"} and subscription.auto_renueva
        else None
    )
    next_payment_days_remaining = (
        period_days_remaining
        if next_payment_on
        else None
    )
    trial_days_remaining = (
        max((trial_ends_on - today).days, 0)
        if trial_ends_on
        else 0
    )
    overrides = get_subscription_capability_overrides(subscription)
    effective_modules = get_effective_plan_modules(subscription)
    effective_features = get_effective_plan_features(subscription)
    metadata = subscription.metadata or {}
    source_prospect_id = metadata.get("source_prospect_id")
    return {
        "id": subscription.id,
        "estatus": subscription.estatus,
        "acceso_activo": subscription.estatus in {"ACTIVA", "TRIAL", "PAST_DUE"},
        "pago_requerido": subscription.estatus in {
            "PENDIENTE_PAGO",
            "PAST_DUE",
            "CANCELADA",
            "PAUSADA",
        },
        "trial_activo": subscription.estatus == "TRIAL",
        "trial_dias_restantes": trial_days_remaining,
        "trial_finaliza_en": trial_ends_on,
        "periodicidad": subscription.periodicidad,
        "fecha_inicio": subscription.fecha_inicio,
        "fecha_fin_periodo_actual": subscription.fecha_fin_periodo_actual,
        "periodo_dias_totales": period_days_total,
        "periodo_dias_restantes": period_days_remaining,
        "periodo_actual_vencido": bool(period_end and period_end <= today),
        "fecha_siguiente_pago": next_payment_on,
        "siguiente_pago_dias_restantes": next_payment_days_remaining,
        "auto_renueva": subscription.auto_renueva,
        "stripe_customer_id": subscription.stripe_customer_id,
        "stripe_subscription_id": subscription.stripe_subscription_id,
        "stripe_checkout_session_id": subscription.stripe_checkout_session_id,
        "metadata": metadata,
        "source_prospect": {
            "id": source_prospect_id,
            "email": metadata.get("source_prospect_email") or "",
            "nombre": metadata.get("source_prospect_name") or "",
            "empresa": metadata.get("source_prospect_company") or "",
        }
        if source_prospect_id
        else None,
        "commercial_followup": serialize_subscription_commercial_followup(subscription),
        "plan_capability_overrides": overrides,
        "plan": serialize_plan(plan),
        "effective_plan": {
            "modulos_habilitados": effective_modules,
            "funciones_habilitadas": effective_features,
        },
        "effective_entitlements": build_subscription_entitlement_summary(
            subscription,
            effective_modules=effective_modules,
            effective_features=effective_features,
            overrides=overrides,
        ),
        "usage": resolved_usage,
        "limits": {
            "usuarios": plan.max_usuarios,
            "entidades": plan.max_entidades,
            "espacios": plan.max_productos,
        },
    }


def serialize_subscription_admin(
    subscription: SuscripcionCapa,
    saas_usage: dict | None = None,
    subscription_usage: dict | None = None,
    solution_usage: dict | None = None,
    customer_health: dict | None = None,
    account_status: dict | None = None,
) -> dict:
    resolved_saas_usage = saas_usage or build_saas_usage_map([subscription])[
        subscription.capa_negocio_id
    ]
    serialized = serialize_subscription(subscription, usage=subscription_usage)
    capa = subscription.capa_negocio
    try:
        go_live_approval = capa.go_live_approval
    except GoLiveApproval.DoesNotExist:
        go_live_approval = None
    serialized.update(
        {
            "capa_negocio": {
                "id": capa.id,
                "nombre": capa.nombre,
                "tipo_capa": capa.tipo_capa,
                "nombre_administrador": capa.nombre_administrador,
                "correo_contacto": capa.correo_contacto,
                "telefono_contacto": capa.telefono_contacto,
                "activo": capa.activo,
            },
            "saas_usage": resolved_saas_usage,
            "solution_usage": solution_usage
            if solution_usage is not None
            else build_solution_usage_map([subscription])[subscription.capa_negocio_id],
            "commercial_audit": serialize_subscription_commercial_audit(subscription),
            "health": customer_health
            or build_customer_health_map(
                [subscription],
                subscription_usage_map={subscription.capa_negocio_id: serialized["usage"]},
                solution_usage_map=(
                    {subscription.capa_negocio_id: solution_usage}
                    if solution_usage is not None
                    else None
                ),
            )[subscription.capa_negocio_id],
            "account_status": account_status
            or build_customer_account_status_map(
                [subscription],
                customer_health_map=(
                    {
                        subscription.capa_negocio_id: customer_health,
                    }
                    if customer_health
                    else None
                ),
            )[subscription.capa_negocio_id],
            "go_live": serialize_go_live_approval(go_live_approval),
        }
    )
    return serialized


def serialize_go_live_approval(approval: GoLiveApproval | None) -> dict:
    if approval is None:
        return {
            "id": None,
            "estatus": "PENDIENTE",
            "fecha_go_live": None,
            "responsable_betterp": "",
            "responsable_cliente": "",
            "smoke_previo": "",
            "smoke_posterior": "",
            "backup_referencia": "",
            "backup_restore_validado": False,
            "automatizaciones_activas": False,
            "post_go_live_dia_1_validado": False,
            "post_go_live_dia_7_validado": False,
            "fecha_post_go_live_dia_1": None,
            "fecha_post_go_live_dia_7": None,
            "post_go_live_notas": "",
            "post_go_live_tarea_estado": "SIN_TAREA",
            "post_go_live_responsable": "",
            "post_go_live_fecha_objetivo": None,
            "post_go_live_prioridad": "MEDIA",
            "post_go_live_ready": False,
            "pendientes": "",
            "decision": "",
            "aprobado_por": None,
            "fecha_aprobacion": None,
            "fecha_actualizacion": None,
            "ready_for_handoff": False,
        }
    return {
        "id": approval.id,
        "estatus": approval.estatus,
        "fecha_go_live": approval.fecha_go_live,
        "responsable_betterp": approval.responsable_betterp or "",
        "responsable_cliente": approval.responsable_cliente or "",
        "smoke_previo": approval.smoke_previo or "",
        "smoke_posterior": approval.smoke_posterior or "",
        "backup_referencia": approval.backup_referencia or "",
        "backup_restore_validado": approval.backup_restore_validado,
        "automatizaciones_activas": approval.automatizaciones_activas,
        "post_go_live_dia_1_validado": approval.post_go_live_dia_1_validado,
        "post_go_live_dia_7_validado": approval.post_go_live_dia_7_validado,
        "fecha_post_go_live_dia_1": approval.fecha_post_go_live_dia_1,
        "fecha_post_go_live_dia_7": approval.fecha_post_go_live_dia_7,
        "post_go_live_notas": approval.post_go_live_notas or "",
        "post_go_live_tarea_estado": approval.post_go_live_tarea_estado,
        "post_go_live_responsable": approval.post_go_live_responsable or "",
        "post_go_live_fecha_objetivo": approval.post_go_live_fecha_objetivo,
        "post_go_live_prioridad": approval.post_go_live_prioridad,
        "post_go_live_ready": approval.estatus in {"APROBADO", "APROBADO_CON_PENDIENTES"}
        and approval.post_go_live_dia_1_validado
        and approval.post_go_live_dia_7_validado,
        "pendientes": approval.pendientes or "",
        "decision": approval.decision or "",
        "aprobado_por": (
            {
                "id": approval.aprobado_por_id,
                "email": approval.aprobado_por.email,
                "nombre": approval.aprobado_por.get_full_name() or approval.aprobado_por.username,
            }
            if approval.aprobado_por_id and approval.aprobado_por
            else None
        ),
        "fecha_aprobacion": approval.fecha_aprobacion,
        "fecha_actualizacion": approval.fecha_actualizacion,
        "ready_for_handoff": approval.estatus in {"APROBADO", "APROBADO_CON_PENDIENTES"},
    }


def _empty_solution_usage() -> dict:
    return {
        "available": False,
        "solution_key": "",
        "summary": {},
        "limits": {},
        "capacity": [],
        "status": "OK",
        "primary_action": "Sin consumo especifico de solucion.",
    }


def _decimal_to_usage_text(value: Decimal) -> str:
    return format(value.normalize(), "f")


def _solution_capacity_item(
    *,
    key: str,
    label: str,
    used: int,
    limit: int,
) -> dict:
    ratio = (used / limit) if limit > 0 else (1 if used > 0 else 0)
    status = "OK"
    if limit <= 0 and used > 0:
        status = "ERROR"
    elif limit > 0 and used > limit:
        status = "ERROR"
    elif ratio >= 0.8:
        status = "WARN"
    return {
        "key": key,
        "label": label,
        "used": used,
        "limit": limit,
        "usage_ratio": round(ratio, 4),
        "status": status,
    }


def _build_catalogo_usage_defaults(subscription: SuscripcionCapa) -> dict:
    profile = build_catalogo_plan_profile(subscription.plan) or {}
    limits = profile.get("commercial_limits") or {}
    return {
        "available": True,
        "solution_key": SOLUTION_POS_QR_KEY,
        "segmento": profile.get("segmento", "A medida"),
        "summary": {
            "productos_total": 0,
            "productos_activos": 0,
            "categorias_total": 0,
            "bodegas_total": 0,
            "inventario_items": 0,
            "productos_con_inventario": 0,
            "productos_sin_inventario": 0,
            "stock_total": "0",
            "reservado_total": "0",
            "disponible_total": "0",
            "puntos_venta_total": 0,
            "puntos_venta_activos": 0,
            "mesas_total": 0,
            "turnos_abiertos": 0,
            "tickets_total": 0,
            "tickets_abiertos": 0,
            "tickets_cobrados": 0,
            "tickets_cancelados": 0,
            "cobros_qr_pendientes": 0,
            "cobros_qr_pagados": 0,
            "incidencias_calidad_abiertas": 0,
            "incidencias_calidad_bloqueantes": 0,
            "ordenes_total": 0,
            "ordenes_reservadas": 0,
            "ordenes_confirmadas": 0,
            "ordenes_canceladas": 0,
            "ordenes_activas": 0,
            "ventas_confirmadas_total": "0.00",
        },
        "limits": limits,
        "capacity": [],
        "status": "OK",
        "primary_action": "Mantener seguimiento comercial normal.",
    }


def build_solution_usage_map(subscriptions: list[SuscripcionCapa]) -> dict[int, dict]:
    usage_map = {
        subscription.capa_negocio_id: _empty_solution_usage()
        for subscription in subscriptions
    }
    vende_subscriptions = [
        subscription for subscription in subscriptions if is_catalogo_plan(subscription.plan)
    ]
    if not vende_subscriptions:
        return usage_map

    capa_ids = [subscription.capa_negocio_id for subscription in vende_subscriptions]
    for subscription in vende_subscriptions:
        usage_map[subscription.capa_negocio_id] = _build_catalogo_usage_defaults(
            subscription
        )

    try:
        Categoria = apps.get_model("catalogo", "Categoria")
        Producto = apps.get_model("catalogo", "Producto")
        Bodega = apps.get_model("catalogo", "Bodega")
        InventarioItem = apps.get_model("catalogo", "InventarioItem")
        PuntoVenta = apps.get_model("pos", "PuntoVenta")
        Mesa = apps.get_model("pos", "Mesa")
        Turno = apps.get_model("pos", "Turno")
        Ticket = apps.get_model("pos", "Ticket")
        CobroQR = apps.get_model("pos", "CobroQR")
        CalidadIncidencia = apps.get_model("catalogo", "CalidadIncidencia")
        Orden = apps.get_model("catalogo", "Orden")

        for row in (
            Categoria.objects.filter(capa_negocio_id__in=capa_ids)
            .values("capa_negocio_id")
            .annotate(total=Count("id"))
        ):
            usage_map[row["capa_negocio_id"]]["summary"]["categorias_total"] = int(
                row["total"] or 0
            )

        for row in (
            Producto.objects.filter(capa_negocio_id__in=capa_ids)
            .values("capa_negocio_id")
            .annotate(
                total=Count("id"),
                activos=Count("id", filter=Q(activo=True)),
            )
        ):
            summary = usage_map[row["capa_negocio_id"]]["summary"]
            summary["productos_total"] = int(row["total"] or 0)
            summary["productos_activos"] = int(row["activos"] or 0)

        for row in (
            Bodega.objects.filter(capa_negocio_id__in=capa_ids)
            .values("capa_negocio_id")
            .annotate(total=Count("id"))
        ):
            usage_map[row["capa_negocio_id"]]["summary"]["bodegas_total"] = int(
                row["total"] or 0
            )

        for row in (
            InventarioItem.objects.filter(capa_negocio_id__in=capa_ids)
            .values("capa_negocio_id")
            .annotate(
                total=Count("id"),
                stock=Sum("stock"),
                reservado=Sum("reservado"),
                productos_con_inventario=Count("producto", distinct=True),
            )
        ):
            summary = usage_map[row["capa_negocio_id"]]["summary"]
            stock = Decimal(row["stock"] or 0)
            reservado = Decimal(row["reservado"] or 0)
            summary["inventario_items"] = int(row["total"] or 0)
            summary["productos_con_inventario"] = int(
                row["productos_con_inventario"] or 0
            )
            summary["stock_total"] = _decimal_to_usage_text(stock)
            summary["reservado_total"] = _decimal_to_usage_text(reservado)
            summary["disponible_total"] = _decimal_to_usage_text(stock - reservado)

        for row in (
            PuntoVenta.objects.filter(capa_negocio_id__in=capa_ids)
            .values("capa_negocio_id")
            .annotate(
                total=Count("id"),
                activos=Count("id", filter=Q(activo=True)),
            )
        ):
            summary = usage_map[row["capa_negocio_id"]]["summary"]
            summary["puntos_venta_total"] = int(row["total"] or 0)
            summary["puntos_venta_activos"] = int(row["activos"] or 0)

        for row in (
            Mesa.objects.filter(
                punto_venta__capa_negocio_id__in=capa_ids,
                activo=True,
            )
            .values("punto_venta__capa_negocio_id")
            .annotate(total=Count("id"))
        ):
            summary = usage_map[row["punto_venta__capa_negocio_id"]]["summary"]
            summary["mesas_total"] = int(row["total"] or 0)

        for row in (
            Turno.objects.filter(
                punto_venta__capa_negocio_id__in=capa_ids,
                estado="ABIERTO",
            )
            .values("punto_venta__capa_negocio_id")
            .annotate(total=Count("id"))
        ):
            summary = usage_map[row["punto_venta__capa_negocio_id"]]["summary"]
            summary["turnos_abiertos"] = int(row["total"] or 0)

        for row in (
            Ticket.objects.filter(capa_negocio_id__in=capa_ids)
            .values("capa_negocio_id")
            .annotate(
                total=Count("id"),
                abiertos=Count("id", filter=Q(estado="ABIERTO")),
                cobrados=Count("id", filter=Q(estado="COBRADO")),
                cancelados=Count("id", filter=Q(estado="CANCELADO")),
            )
        ):
            summary = usage_map[row["capa_negocio_id"]]["summary"]
            summary["tickets_total"] = int(row["total"] or 0)
            summary["tickets_abiertos"] = int(row["abiertos"] or 0)
            summary["tickets_cobrados"] = int(row["cobrados"] or 0)
            summary["tickets_cancelados"] = int(row["cancelados"] or 0)

        for row in (
            CobroQR.objects.filter(ticket__capa_negocio_id__in=capa_ids)
            .values("ticket__capa_negocio_id")
            .annotate(
                pendientes=Count("id", filter=Q(estado="PENDIENTE")),
                pagados=Count("id", filter=Q(estado="PAGADO")),
            )
        ):
            summary = usage_map[row["ticket__capa_negocio_id"]]["summary"]
            summary["cobros_qr_pendientes"] = int(row["pendientes"] or 0)
            summary["cobros_qr_pagados"] = int(row["pagados"] or 0)

        for row in (
            CalidadIncidencia.objects.filter(
                capa_negocio_id__in=capa_ids,
                estatus__in=["ABIERTA", "EN_REVISION"],
            )
            .values("capa_negocio_id")
            .annotate(
                abiertas=Count("id"),
                bloqueantes=Count("id", filter=Q(prioridad="BLOCKER")),
            )
        ):
            summary = usage_map[row["capa_negocio_id"]]["summary"]
            summary["incidencias_calidad_abiertas"] = int(row["abiertas"] or 0)
            summary["incidencias_calidad_bloqueantes"] = int(
                row["bloqueantes"] or 0
            )

        for row in (
            Orden.objects.filter(capa_negocio_id__in=capa_ids)
            .values("capa_negocio_id")
            .annotate(
                ordenes=Count("id"),
                reservadas=Count("id", filter=Q(estatus="RESERVADA")),
                confirmadas=Count("id", filter=Q(estatus="CONFIRMADA")),
                canceladas=Count("id", filter=Q(estatus="CANCELADA")),
                ventas_confirmadas=Sum("total", filter=Q(estatus="CONFIRMADA")),
            )
        ):
            summary = usage_map[row["capa_negocio_id"]]["summary"]
            summary["ordenes_total"] = int(row["ordenes"] or 0)
            summary["ordenes_reservadas"] = int(row["reservadas"] or 0)
            summary["ordenes_confirmadas"] = int(row["confirmadas"] or 0)
            summary["ordenes_canceladas"] = int(row["canceladas"] or 0)
            summary["ordenes_activas"] = int(row["reservadas"] or 0) + int(
                row["confirmadas"] or 0
            )
            summary["ventas_confirmadas_total"] = str(
                Decimal(row["ventas_confirmadas"] or 0).quantize(Decimal("0.01"))
            )
    except (DatabaseError, ProgrammingError, LookupError):
        for subscription in vende_subscriptions:
            usage = usage_map[subscription.capa_negocio_id]
            usage["available"] = False
            usage["primary_action"] = "Aplicar migraciones del catalogo POS para medir consumo."
        return usage_map

    for subscription in vende_subscriptions:
        usage = usage_map[subscription.capa_negocio_id]
        summary = usage["summary"]
        limits = usage["limits"]
        summary["productos_sin_inventario"] = max(
            int(summary["productos_activos"]) - int(summary["productos_con_inventario"]),
            0,
        )
        capacity = [
            _solution_capacity_item(
                key="productos",
                label="Productos",
                used=int(summary["productos_total"]),
                limit=int(limits.get("productos") or 0),
            ),
            _solution_capacity_item(
                key="bodegas",
                label="Bodegas",
                used=int(summary["bodegas_total"]),
                limit=int(limits.get("bodegas") or 0),
            ),
            _solution_capacity_item(
                key="cajas",
                label="Cajas",
                used=int(summary["puntos_venta_total"]),
                limit=int(limits.get("cajas") or 0),
            ),
        ]
        usage["capacity"] = capacity
        operational_errors = bool(
            int(summary["incidencias_calidad_bloqueantes"])
            or (
                int(summary["puntos_venta_total"])
                and not int(summary["puntos_venta_activos"])
            )
        )
        operational_warnings = bool(
            int(summary["incidencias_calidad_abiertas"])
            or int(summary["productos_sin_inventario"])
            or int(summary["cobros_qr_pendientes"]) >= 10
            or int(summary["tickets_abiertos"]) >= 20
        )
        if any(item["status"] == "ERROR" for item in capacity) or operational_errors:
            usage["status"] = "ERROR"
            usage["primary_action"] = (
                "Resolver bloqueos de caja, calidad o capacidad antes de ampliar venta."
            )
        elif any(item["status"] == "WARN" for item in capacity) or operational_warnings:
            usage["status"] = "WARN"
            usage["primary_action"] = (
                "Revisar inventario, cuentas abiertas y cobros QR antes del siguiente pico."
            )

    return usage_map


def build_saas_usage_map(subscriptions: list[SuscripcionCapa]) -> dict[int, dict]:
    capa_ids = [subscription.capa_negocio_id for subscription in subscriptions]
    usage_map = {
        capa_id: {
            "openai_tokens_consumidos": 0,
            "emails_enviados": 0,
            "whatsapp_mensajes_enviados": 0,
            "comprobantes_whatsapp_procesados": 0,
            "timbres_facturacion_usados": 0,
            "bank_pdf_parseos": 0,
        }
        for capa_id in capa_ids
    }
    if not capa_ids:
        return usage_map

    historial_rows = (
        HistorialEnvio.objects.annotate(
            capa_saas_id=Coalesce(
                F("entidad_relacionada__capa_negocio_id"),
                F("cliente_relacionado__entidad_relacionada__capa_negocio_id"),
            )
        )
        .filter(capa_saas_id__in=capa_ids)
        .filter(estatus__in=SUCCESSFUL_OUTBOUND_STATUSES)
        .values("capa_saas_id", "canal")
        .annotate(total=Count("id"))
    )
    for row in historial_rows:
        capa_id = row["capa_saas_id"]
        if capa_id not in usage_map:
            continue
        if row["canal"] == "EMAIL":
            usage_map[capa_id]["emails_enviados"] = row["total"]
        elif row["canal"] == "WHATSAPP":
            usage_map[capa_id]["whatsapp_mensajes_enviados"] = row["total"]

    for consumo in ConsumoSaaS.objects.filter(capa_negocio_id__in=capa_ids):
        usage_map[consumo.capa_negocio_id]["openai_tokens_consumidos"] = (
            consumo.openai_tokens_consumidos
        )
        usage_map[consumo.capa_negocio_id]["emails_enviados"] += (
            consumo.emails_enviados_ajuste
        )
        usage_map[consumo.capa_negocio_id]["whatsapp_mensajes_enviados"] += (
            consumo.whatsapp_mensajes_enviados_ajuste
        )

    movement_rows = (
        MovimientoConsumoSaaS.objects.filter(capa_negocio_id__in=capa_ids)
        .values("capa_negocio_id", "categoria")
        .annotate(total=Sum("cantidad"))
    )
    for row in movement_rows:
        capa_id = row["capa_negocio_id"]
        if capa_id not in usage_map:
            continue
        total = int(row["total"] or 0)
        if row["categoria"] == "WHATSAPP_COMPROBANTE":
            usage_map[capa_id]["comprobantes_whatsapp_procesados"] = total
        elif row["categoria"] == "FACTURA_TIMBRE":
            usage_map[capa_id]["timbres_facturacion_usados"] = total
        elif row["categoria"] == "BANK_PDF_PARSE":
            usage_map[capa_id]["bank_pdf_parseos"] = total

    return usage_map


def resolve_usage_period(reference_datetime=None) -> str:
    value = reference_datetime or timezone.now()
    if hasattr(value, "date"):
        value = value.date()
    return f"{value.year:04d}-{value.month:02d}"


def resolve_period_bounds(periodo: str) -> tuple[datetime, datetime]:
    try:
        year_text, month_text = periodo.split("-", 1)
        year = int(year_text)
        month = int(month_text)
        if month < 1 or month > 12:
            raise ValueError
    except ValueError as exc:
        raise ValueError("El periodo debe venir en formato YYYY-MM.") from exc
    start = timezone.make_aware(datetime(year, month, 1))
    if month == 12:
        end = timezone.make_aware(datetime(year + 1, 1, 1))
    else:
        end = timezone.make_aware(datetime(year, month + 1, 1))
    return start, end


def get_usage_unit_price(plan: PlanSaaS, categoria: str) -> Decimal:
    if categoria == "OPENAI_TOKENS":
        return Decimal(plan.precio_openai_1k_tokens_extra or 0) / Decimal("1000")
    if categoria == "WHATSAPP_OUTBOUND":
        return Decimal(plan.precio_whatsapp_mensaje_extra or 0)
    if categoria == "WHATSAPP_COMPROBANTE":
        return Decimal(plan.precio_comprobante_whatsapp_extra or 0)
    if categoria == "FACTURA_TIMBRE":
        return Decimal(plan.precio_timbre_facturacion_extra or 0)
    if categoria == "EMAIL_OUTBOUND":
        return Decimal(plan.precio_email_extra or 0)
    return Decimal("0")


def get_usage_allowance(plan: PlanSaaS, categoria: str) -> int:
    if categoria == "OPENAI_TOKENS":
        return int(plan.openai_tokens_incluidos or 0)
    if categoria == "WHATSAPP_OUTBOUND":
        return int(plan.whatsapp_mensajes_incluidos or 0)
    if categoria == "WHATSAPP_COMPROBANTE":
        return int(plan.comprobantes_whatsapp_incluidos or 0)
    if categoria == "FACTURA_TIMBRE":
        return int(plan.timbres_facturacion_incluidos or 0)
    if categoria == "EMAIL_OUTBOUND":
        return int(plan.emails_incluidos or 0)
    return 0


def get_usage_label(categoria: str) -> str:
    if categoria == "OPENAI_TOKENS":
        return "Operaciones inteligentes"
    return dict(MovimientoConsumoSaaS.CATEGORIA_CHOICES).get(categoria, categoria)


def convert_usage_for_customer(
    *,
    category: str,
    total: int,
    included: int,
    extra: int,
    unit_price: Decimal,
) -> dict:
    if category != "OPENAI_TOKENS":
        return {
            "consumido": total,
            "incluido": included,
            "excedente": extra,
            "unidad": "unidad",
            "precio_unitario_extra": unit_price,
        }

    divisor = Decimal("1000")
    total_ops = int((Decimal(total) / divisor).to_integral_value(rounding=ROUND_CEILING))
    included_ops = int(
        (Decimal(included) / divisor).to_integral_value(rounding=ROUND_CEILING)
    )
    extra_ops = int((Decimal(extra) / divisor).to_integral_value(rounding=ROUND_CEILING))
    return {
        "consumido": total_ops,
        "incluido": included_ops,
        "excedente": extra_ops,
        "unidad": "operacion",
        "precio_unitario_extra": unit_price * divisor,
    }


@transaction.atomic
def registrar_consumo_saas(
    *,
    capa: CapaNegocio,
    categoria: str,
    cantidad: int,
    descripcion: str,
    fecha_consumo=None,
    referencia_unica: str | None = None,
    origen_modelo: str | None = None,
    origen_id: int | None = None,
    metadata: dict | None = None,
) -> MovimientoConsumoSaaS:
    cantidad = max(int(cantidad or 0), 0)
    if cantidad <= 0:
        raise ValueError("La cantidad de consumo debe ser mayor a cero.")

    subscription = get_or_create_subscription_for_capa(capa)
    plan = subscription.plan
    period = resolve_usage_period(fecha_consumo)
    unit_price = get_usage_unit_price(plan, categoria)
    estimated_cost = (Decimal(cantidad) * unit_price).quantize(Decimal("0.0001"))
    defaults = {
        "suscripcion_relacionada": subscription,
        "periodo": period,
        "descripcion": descripcion[:220],
        "cantidad": cantidad,
        "unidad": "token" if categoria == "OPENAI_TOKENS" else "unidad",
        "costo_unitario": unit_price,
        "costo_estimado": estimated_cost,
        "origen_modelo": origen_modelo,
        "origen_id": origen_id,
        "metadata": metadata or {},
        "fecha_consumo": fecha_consumo or timezone.now(),
    }
    try:
        if referencia_unica:
            movement, created = MovimientoConsumoSaaS.objects.get_or_create(
                capa_negocio=capa,
                categoria=categoria,
                referencia_unica=referencia_unica,
                defaults=defaults,
            )
            if not created:
                return movement
        else:
            movement = MovimientoConsumoSaaS.objects.create(
                capa_negocio=capa,
                categoria=categoria,
                referencia_unica=None,
                **defaults,
            )
    except IntegrityError:
        movement = MovimientoConsumoSaaS.objects.get(
            capa_negocio=capa,
            categoria=categoria,
            referencia_unica=referencia_unica,
        )
        return movement

    consumo, _ = ConsumoSaaS.objects.get_or_create(capa_negocio=capa)
    if categoria == "OPENAI_TOKENS":
        ConsumoSaaS.objects.filter(id=consumo.id).update(
            openai_tokens_consumidos=F("openai_tokens_consumidos") + cantidad
        )
    elif categoria == "WHATSAPP_OUTBOUND":
        ConsumoSaaS.objects.filter(id=consumo.id).update(
            whatsapp_mensajes_enviados_ajuste=F("whatsapp_mensajes_enviados_ajuste")
            + cantidad
        )
    elif categoria == "EMAIL_OUTBOUND":
        ConsumoSaaS.objects.filter(id=consumo.id).update(
            emails_enviados_ajuste=F("emails_enviados_ajuste") + cantidad
        )
    return movement


def build_usage_statement(capa: CapaNegocio, periodo: str | None = None) -> dict:
    subscription = get_or_create_subscription_for_capa(capa)
    plan = subscription.plan
    period = periodo or resolve_usage_period()
    period_start, period_end = resolve_period_bounds(period)
    movements = list(
        MovimientoConsumoSaaS.objects.filter(
            capa_negocio=capa,
            periodo=period,
        ).order_by("-fecha_consumo", "-id")
    )
    totals = {
        choice: 0
        for choice, _label in MovimientoConsumoSaaS.CATEGORIA_CHOICES
    }
    for movement in movements:
        totals[movement.categoria] = totals.get(movement.categoria, 0) + int(
            movement.cantidad or 0
        )

    historial_rows = (
        HistorialEnvio.objects.annotate(
            capa_saas_id=Coalesce(
                F("entidad_relacionada__capa_negocio_id"),
                F("cliente_relacionado__entidad_relacionada__capa_negocio_id"),
            )
        )
        .filter(
            capa_saas_id=capa.id,
            fecha_envio__gte=period_start,
            fecha_envio__lt=period_end,
            estatus__in=SUCCESSFUL_OUTBOUND_STATUSES,
        )
        .values("canal")
        .annotate(total=Count("id"))
    )
    for row in historial_rows:
        if row["canal"] == "WHATSAPP":
            totals["WHATSAPP_OUTBOUND"] += int(row["total"] or 0)
        elif row["canal"] == "EMAIL":
            totals["EMAIL_OUTBOUND"] += int(row["total"] or 0)

    summary = []
    alerts = []
    grand_total = Decimal("0")
    for category in BILLABLE_USAGE_CATEGORIES:
        total = totals.get(category, 0)
        included = get_usage_allowance(plan, category)
        extra = max(total - included, 0)
        unit_price = get_usage_unit_price(plan, category)
        amount = (Decimal(extra) * unit_price).quantize(Decimal("0.0001"))
        customer_usage = convert_usage_for_customer(
            category=category,
            total=total,
            included=included,
            extra=extra,
            unit_price=unit_price,
        )
        grand_total += amount
        summary.append(
            {
                "categoria": category,
                "nombre": get_usage_label(category),
                "consumido": customer_usage["consumido"],
                "incluido": customer_usage["incluido"],
                "excedente": customer_usage["excedente"],
                "unidad": customer_usage["unidad"],
                "precio_unitario_extra": float(customer_usage["precio_unitario_extra"]),
                "importe_extra": float(amount),
            }
        )
        if included > 0 and total >= included:
            alerts.append(
                {
                    "nivel": "EXCEDIDO",
                    "categoria": category,
                    "nombre": get_usage_label(category),
                    "mensaje": (
                        f"{get_usage_label(category)} ya rebaso lo incluido en el plan. "
                        "El excedente puede generar cargos adicionales."
                    ),
                }
            )
        elif included > 0 and total >= int(included * 0.8):
            alerts.append(
                {
                    "nivel": "PREVENTIVA",
                    "categoria": category,
                    "nombre": get_usage_label(category),
                    "mensaje": (
                        f"{get_usage_label(category)} esta cerca del limite incluido. "
                        "Revisa si el volumen esperado justifica continuar con el mismo ritmo."
                    ),
                }
            )

    return {
        "periodo": period,
        "capa_negocio": {
            "id": capa.id,
            "nombre": capa.nombre,
        },
        "suscripcion": {
            "id": subscription.id,
            "estatus": subscription.estatus,
            "plan": serialize_plan(plan),
        },
        "resumen": summary,
        "alertas": alerts,
        "total_extras": float(grand_total.quantize(Decimal("0.01"))),
        "movimientos": [
            {
                "id": movement.id,
                "fecha_consumo": movement.fecha_consumo,
                "categoria": movement.categoria,
                "nombre": get_usage_label(movement.categoria),
                "descripcion": movement.descripcion,
                "cantidad": (
                    int(
                        (Decimal(movement.cantidad or 0) / Decimal("1000")).to_integral_value(
                            rounding=ROUND_CEILING
                        )
                    )
                    if movement.categoria == "OPENAI_TOKENS"
                    else movement.cantidad
                ),
                "unidad": (
                    "operacion"
                    if movement.categoria == "OPENAI_TOKENS"
                    else movement.unidad
                ),
                "costo_unitario": float(movement.costo_unitario),
                "costo_estimado": float(movement.costo_estimado),
                "referencia_unica": movement.referencia_unica,
                "origen_modelo": movement.origen_modelo,
                "origen_id": movement.origen_id,
                "metadata": movement.metadata or {},
            }
            for movement in movements[:500]
        ],
    }


def serialize_prospect(prospect: ProspectoComercial) -> dict:
    solution = getattr(prospect, "solution", None)
    metadata = prospect.metadata or {}
    converted_subscription_id = metadata.get("converted_subscription_id")
    utm = metadata.get("utm") if isinstance(metadata, dict) else {}
    lead_qualification = (
        metadata.get("lead_qualification") if isinstance(metadata, dict) else {}
    )
    attribution = metadata.get("attribution") if isinstance(metadata, dict) else {}
    commercial_objection = (
        metadata.get("commercial_objection")
        or metadata.get("objecion_principal")
        or metadata.get("sales_objection")
        or ""
    )
    return {
        "id": prospect.id,
        "nombre": prospect.nombre,
        "empresa": prospect.empresa,
        "email": prospect.email,
        "telefono": prospect.telefono,
        "mensaje": prospect.mensaje,
        "origen": prospect.origen,
        "solution_key": solution.clave if solution else None,
        "solution_name": solution.nombre if solution else None,
        "utm": utm if isinstance(utm, dict) else {},
        "attribution": attribution if isinstance(attribution, dict) else {},
        "excluded_from_learning": prospect.excluded_from_marketing_learning(),
        "lead_qualification": (
            lead_qualification if isinstance(lead_qualification, dict) else {}
        ),
        "lost_reason": metadata.get("lost_reason") or "",
        "commercial_objection": commercial_objection,
        "requested_solution_key": metadata.get("requested_solution_key"),
        "etapa": prospect.etapa,
        "notas_internas": prospect.notas_internas,
        "atendido_por": prospect.atendido_por.get_full_name() or prospect.atendido_por.email
        if prospect.atendido_por
        else None,
        "atendido_en": prospect.atendido_en,
        "converted": bool(converted_subscription_id),
        "converted_subscription_id": converted_subscription_id,
        "converted_capa_id": metadata.get("converted_capa_id"),
        "converted_at": metadata.get("converted_at"),
        "converted_by": metadata.get("converted_by"),
        "fecha_creacion": prospect.fecha_creacion,
        "fecha_actualizacion": prospect.fecha_actualizacion,
    }










def resolve_price_id_for_plan(
    plan: PlanSaaS,
    periodicidad: str,
    *,
    stripe_mode: str | None = None,
) -> str | None:
    mode = normalize_stripe_mode(stripe_mode or get_active_stripe_mode())
    if mode == "TEST":
        if periodicidad == "ANUAL":
            return plan.stripe_test_price_id_anual
        return plan.stripe_test_price_id_mensual
    if periodicidad == "ANUAL":
        return plan.stripe_price_id_anual
    return plan.stripe_price_id_mensual


def mark_subscription_event(
    *,
    capa: CapaNegocio | None,
    subscription: SuscripcionCapa | None,
    proveedor: str,
    tipo_evento: str,
    referencia_externa: str | None = None,
    payload: dict | None = None,
    estatus: str = "PROCESADO",
    detalle_error: str | None = None,
) -> EventoBilling:
    return EventoBilling.objects.create(
        capa_negocio=capa,
        suscripcion_relacionada=subscription,
        proveedor=proveedor,
        tipo_evento=tipo_evento,
        referencia_externa=referencia_externa,
        payload=make_json_safe(payload or {}),
        estatus=estatus,
        procesado_en=timezone.now() if estatus == "PROCESADO" else None,
        detalle_error=detalle_error,
    )


def make_json_safe(value):
    if isinstance(value, dict):
        return {str(key): make_json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [make_json_safe(item) for item in value]
    if isinstance(value, tuple):
        return [make_json_safe(item) for item in value]
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    return value


def build_checkout_payload(
    *,
    capa: CapaNegocio,
    subscription: SuscripcionCapa,
    plan: PlanSaaS,
    periodicidad: str,
    success_url: str,
    cancel_url: str,
) -> dict:
    stripe_mode = get_active_stripe_mode()
    stripe_secret_key = get_stripe_secret_key_for_mode(stripe_mode)
    price_id = resolve_price_id_for_plan(
        plan,
        periodicidad,
        stripe_mode=stripe_mode,
    )
    if not stripe_secret_key:
        raise ValueError(f"Falta configurar la secret key de Stripe para modo {stripe_mode}.")
    if not price_id:
        raise ValueError(
            f"El plan seleccionado todavia no tiene price id configurado en Stripe modo {stripe_mode}."
        )

    solution_identity = get_plan_solution_identity(plan)
    payload = {
        "mode": "subscription",
        "success_url": success_url,
        "cancel_url": cancel_url,
        "line_items[0][price]": price_id,
        "line_items[0][quantity]": "1",
        "client_reference_id": str(capa.id),
        "metadata[capa_negocio_id]": str(capa.id),
        "metadata[suscripcion_id]": str(subscription.id),
        "metadata[plan_id]": str(plan.id),
        "metadata[plan_clave]": plan.clave,
        "metadata[betterp_plan_id]": str(plan.id),
        "metadata[betterp_plan_clave]": plan.clave,
        "metadata[solution_key]": solution_identity["solution_key"],
        "metadata[solution_name]": solution_identity["solution_name"],
        "metadata[betterp_solution_key]": solution_identity["solution_key"],
        "metadata[periodicidad]": periodicidad,
        "metadata[stripe_modo]": stripe_mode,
        "subscription_data[metadata][capa_negocio_id]": str(capa.id),
        "subscription_data[metadata][suscripcion_id]": str(subscription.id),
        "subscription_data[metadata][plan_id]": str(plan.id),
        "subscription_data[metadata][plan_clave]": plan.clave,
        "subscription_data[metadata][betterp_plan_id]": str(plan.id),
        "subscription_data[metadata][betterp_plan_clave]": plan.clave,
        "subscription_data[metadata][solution_key]": solution_identity["solution_key"],
        "subscription_data[metadata][solution_name]": solution_identity["solution_name"],
        "subscription_data[metadata][betterp_solution_key]": solution_identity["solution_key"],
        "subscription_data[metadata][periodicidad]": periodicidad,
        "subscription_data[metadata][stripe_modo]": stripe_mode,
    }
    if subscription.stripe_customer_id:
        payload["customer"] = subscription.stripe_customer_id
    elif capa.correo_contacto:
        payload["customer_email"] = capa.correo_contacto
    return payload
