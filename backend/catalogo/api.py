import hmac
from datetime import timedelta
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.models import Count, Prefetch, Q, Sum
from django.shortcuts import get_object_or_404
from django.utils import timezone
from ninja import Router, Schema
from ninja.errors import HttpError

from accounts.models import EventoAuditoria
from accounts.security import (
    get_current_capa,
    get_current_subscription,
    get_effective_plan_features,
    get_effective_plan_modules,
    get_subscription_capability_overrides,
    require_plan_module,
    require_platform_admin_access,
)
from billing.models import Solucion, SuscripcionCapa
from billing.services import (
    SOLUTION_POS_QR_KEY,
    build_subscription_entitlement_summary,
    build_catalogo_plan_profile,
    ensure_default_solutions,
)
from empresas.models import CapaNegocio
from pos.models import PuntoVenta

from .models import (
    Bodega,
    CalidadIncidencia,
    Categoria,
    InventarioItem,
    InventarioMovimiento,
    Orden,
    OrdenItem,
    Producto,
    ProductoImagen,
)
from .services import (
    build_quality_assistance,
    extract_external_code,
    infer_quality_issue_type,
    infer_quality_priority,
    normalize_missing_fields,
    catalogo_bodegas_for_capa,
    catalogo_calidad_incidencias_for_capa,
    catalogo_categorias_for_capa,
    catalogo_inventario_items_for_capa,
    catalogo_inventario_movimientos_for_capa,
    catalogo_ordenes_for_capa,
    catalogo_productos_for_capa,
)

router = Router(tags=["catalogo"])

CATALOGO_PRODUCTOS_MODULE = "catalogo"
CATALOGO_INVENTARIO_MODULE = "inventario"
CATALOGO_ORDERS_MODULE = "pos_caja"
CATALOGO_FACTURACION_MODULE = "facturacion_cfdi"
CATALOGO_QUALITY_FEATURE = "catalogo_ai_enrichment"
CATALOGO_BULK_SYNC_FEATURE = "catalogo_bulk_sync"
CATALOGO_THIRD_PARTY_API_FEATURE = "catalogo_third_party_api"
CATALOGO_MODULES = {
    CATALOGO_PRODUCTOS_MODULE,
    CATALOGO_INVENTARIO_MODULE,
    CATALOGO_ORDERS_MODULE,
    CATALOGO_FACTURACION_MODULE,
}
CATALOGO_FEATURE_PREFIX = "catalogo_"
CATALOGO_CONTRACT_VERSION = "betterp.posqr.entitlements.v1"
MAX_PAGE_SIZE = 100

CATALOGO_CAPABILITY_LABELS = {
    CATALOGO_PRODUCTOS_MODULE: "catalogo de productos",
    CATALOGO_INVENTARIO_MODULE: "inventario y stock",
    CATALOGO_ORDERS_MODULE: "ordenes y ventas",
    CATALOGO_FACTURACION_MODULE: "facturacion",
    CATALOGO_QUALITY_FEATURE: "asistencia de calidad con IA",
    CATALOGO_BULK_SYNC_FEATURE: "sincronizacion masiva",
    CATALOGO_THIRD_PARTY_API_FEATURE: "API de terceros",
}


class PlatformContextRequest(Schema):
    capa_negocio_id: int


class PlatformEventIn(Schema):
    event_type: str
    status: str = "INFO"
    source: str = "catalogo"
    capa_negocio_id: int | None = None
    resource_type: str = "catalogo.integration"
    resource_id: str | None = None
    message: str = ""
    metadata: dict[str, Any] = {}


class CategoryUpsertIn(Schema):
    nombre: str
    parent_id: int | None = None
    activo: bool = True
    metadata: dict[str, Any] = {}


class ProductUpsertIn(Schema):
    internal_sku: str
    nombre: str
    brand_sku: str | None = None
    descripcion: str | None = None
    marca: str | None = None
    categoria_id: int | None = None
    precio_base: Decimal = Decimal("0")
    peso: Decimal = Decimal("0")
    largo: Decimal = Decimal("0")
    ancho: Decimal = Decimal("0")
    alto: Decimal = Decimal("0")
    master_attributes: dict[str, Any] = {}
    source: str = "manual"
    activo: bool = True


class WarehouseUpsertIn(Schema):
    codigo: str
    nombre: str
    tipo: str = "INTERNA"
    direccion: str = ""
    activo: bool = True
    metadata: dict[str, Any] = {}


class InventoryAdjustmentIn(Schema):
    producto_id: int
    bodega_id: int
    cantidad: Decimal
    tipo: str = "AJUSTE"
    referencia_tipo: str = "manual"
    referencia_id: str = ""
    nota: str = ""
    costo_promedio: Decimal | None = None
    ultimo_costo: Decimal | None = None
    metadata: dict[str, Any] = {}


class OrderItemIn(Schema):
    producto_id: int | None = None
    internal_sku: str | None = None
    bodega_id: int | None = None
    cantidad: Decimal
    precio_unitario: Decimal | None = None
    external_item_id: str = ""
    titulo: str = ""
    metadata: dict[str, Any] = {}


class OrderCreateIn(Schema):
    canal: str = "MANUAL"
    external_order_id: str = ""
    cliente_nombre: str = ""
    cliente_email: str = ""
    cliente_telefono: str = ""
    moneda: str = "MXN"
    subtotal: Decimal | None = None
    envio: Decimal = Decimal("0")
    descuento: Decimal = Decimal("0")
    total: Decimal | None = None
    payment_status: str = "PENDIENTE"
    reservar: bool = True
    items: list[OrderItemIn]
    metadata: dict[str, Any] = {}


class OrderBridgeIn(OrderCreateIn):
    capa_negocio_id: int


class OrderTransitionIn(Schema):
    payment_status: str | None = None
    nota: str = ""
    restock: bool = False
    metadata: dict[str, Any] = {}


class QualityIssueCreateIn(Schema):
    producto_id: int | None = None
    internal_sku: str | None = None
    canal: str = ""
    external_resource_id: str = ""
    external_code: str = ""
    issue_type: str = "PUBLICACION_RECHAZADA"
    prioridad: str | None = None
    titulo: str | None = None
    descripcion: str = ""
    raw_error: str = ""
    missing_fields: list[str] = []
    metadata: dict[str, Any] = {}


class QualityIssueBridgeIn(QualityIssueCreateIn):
    capa_negocio_id: int


class QualityIssueUpdateIn(Schema):
    estatus: str = "EN_REVISION"
    prioridad: str | None = None
    nota: str = ""


class QualityIssueCorrectionIn(Schema):
    categoria_id: int | None = None
    descripcion: str | None = None
    master_attributes: dict[str, Any] = {}
    nota: str = ""
    resolver: bool = True


class MercadoLibreConfigIn(Schema):
    activo: bool = True
    category_id: str = ""
    listing_type_id: str = "gold_special"
    currency_id: str = "MXN"
    buying_mode: str = "buy_it_now"
    item_condition: str = "new"
    shipping: dict[str, Any] = {}
    payload_template: dict[str, Any] = {}
    notas: str = ""


class MercadoLibreOAuthCallbackIn(Schema):
    code: str = ""
    state: str = ""
    error: str = ""
    error_description: str = ""


class MercadoLibrePublishIn(Schema):
    publicar: bool = False
    force: bool = False
    category_id: str = ""
    listing_type_id: str = ""




def get_pos_solution() -> Solucion | None:
    ensure_default_solutions()
    return Solucion.objects.filter(clave=SOLUTION_POS_QR_KEY).first()


def get_subscription_for_capa(capa: CapaNegocio) -> SuscripcionCapa | None:
    return (
        SuscripcionCapa.objects.select_related("plan", "plan__solution")
        .filter(capa_negocio=capa)
        .first()
    )


def require_capa_module(capa: CapaNegocio, module: str) -> None:
    subscription = get_subscription_for_capa(capa)
    if module not in get_effective_plan_modules(subscription):
        notice = build_capability_upgrade_notice(
            subscription,
            kind="module",
            key=module,
            enabled=False,
        )
        raise HttpError(403, f"{notice['message']} {notice['action']}")


def positive_int(value: Any) -> int:
    try:
        return max(int(value or 0), 0)
    except (TypeError, ValueError):
        return 0


def subscription_has_feature(
    subscription: SuscripcionCapa | None,
    feature: str,
    *,
    default: bool = False,
) -> bool:
    if not subscription or not subscription.plan:
        return default
    return feature in get_effective_plan_features(subscription)


def catalogo_capability_label(key: str) -> str:
    return CATALOGO_CAPABILITY_LABELS.get(key, key.replace("_", " ").replace(".", " "))


def plan_name_for_message(subscription: SuscripcionCapa | None) -> str:
    if subscription and subscription.plan:
        return subscription.plan.nombre
    return "actual"


def build_upgrade_action() -> str:
    return (
        "Actualiza el plan desde BetterP o agrega un override comercial temporal "
        "si el cliente ya tiene autorizada la capacidad."
    )


def build_capability_upgrade_notice(
    subscription: SuscripcionCapa | None,
    *,
    kind: str,
    key: str,
    enabled: bool,
) -> dict[str, Any]:
    label = catalogo_capability_label(key)
    plan_name = plan_name_for_message(subscription)
    kind_label = "modulo" if kind == "module" else "funcion"
    return {
        "kind": kind,
        "key": key,
        "label": label,
        "enabled": enabled,
        "upgrade_recommended": not enabled,
        "title": f"{label.capitalize()} {'incluido' if enabled else 'no incluido'}",
        "message": (
            f"El plan {plan_name} permite usar el {kind_label} {label}."
            if enabled
            else f"El plan {plan_name} no incluye el {kind_label} {label}."
        ),
        "action": "" if enabled else build_upgrade_action(),
    }


def build_limit_upgrade_notice(
    subscription: SuscripcionCapa | None,
    *,
    resource: str,
    label: str,
    used: int,
    limit: int,
    projected: int | None = None,
) -> dict[str, Any]:
    plan_name = plan_name_for_message(subscription)
    safe_projected = projected if projected is not None else used
    blocked = (limit <= 0 and safe_projected > 0) or (limit > 0 and safe_projected > limit)
    near_limit = limit > 0 and used / limit >= 0.8
    return {
        "kind": "limit",
        "key": resource,
        "label": label,
        "used": used,
        "limit": limit,
        "projected": safe_projected,
        "upgrade_recommended": blocked or near_limit,
        "title": (
            f"Limite de {label} alcanzado"
            if blocked
            else f"{label.capitalize()} cerca del limite"
            if near_limit
            else f"{label.capitalize()} dentro del plan"
        ),
        "message": (
            f"El plan {plan_name} no incluye {label}."
            if limit <= 0
            else f"El plan {plan_name} permite hasta {limit} {label}; uso actual {used}."
        ),
        "action": build_upgrade_action() if blocked or near_limit else "",
    }


def require_pos_plan_module(request, module: str):
    try:
        return require_plan_module(request, module)
    except HttpError as exc:
        if getattr(exc, "status_code", None) == 403:
            subscription = get_current_subscription(request)
            notice = build_capability_upgrade_notice(
                subscription,
                kind="module",
                key=module,
                enabled=False,
            )
            raise HttpError(403, f"{notice['message']} {notice['action']}") from exc
        raise


def resolve_catalogo_limits(subscription: SuscripcionCapa | None) -> dict[str, int]:
    if not subscription or not subscription.plan:
        return {}
    profile = build_catalogo_plan_profile(subscription.plan) or {}
    commercial_limits = profile.get("commercial_limits") or {}
    modules = set(get_effective_plan_modules(subscription))
    return {
        "productos": positive_int(
            commercial_limits.get("productos", subscription.plan.max_productos)
        ),
        "bodegas": positive_int(
            commercial_limits.get("bodegas", subscription.plan.max_entidades)
        ),
        "cajas": positive_int(
            commercial_limits.get(
                "cajas",
                1 if CATALOGO_ORDERS_MODULE in modules else 0,
            )
        ),
        "usuarios": positive_int(subscription.plan.max_usuarios),
        "ordenes_mensuales_referencia": positive_int(
            commercial_limits.get("ordenes_mensuales_referencia")
        ),
    }


def serialize_limit_state(
    *,
    key: str,
    label: str,
    used: int,
    limit: int,
) -> dict[str, Any]:
    remaining = max(limit - used, 0) if limit > 0 else 0
    status = "OK"
    if limit <= 0 and used > 0:
        status = "EXCEEDED"
    elif limit > 0 and used > limit:
        status = "EXCEEDED"
    elif limit > 0 and used >= limit:
        status = "FULL"
    elif limit > 0 and used / limit >= 0.8:
        status = "NEAR_LIMIT"
    return {
        "key": key,
        "label": label,
        "used": used,
        "limit": limit,
        "remaining": remaining,
        "status": status,
    }


def build_catalogo_policy(capa: CapaNegocio) -> dict[str, Any]:
    subscription = get_subscription_for_capa(capa)
    modules = get_effective_plan_modules(subscription)
    features = get_effective_plan_features(subscription)
    limits = resolve_catalogo_limits(subscription)
    module_states = {
        "productos": CATALOGO_PRODUCTOS_MODULE in modules,
        "inventario": CATALOGO_INVENTARIO_MODULE in modules,
        "ordenes": CATALOGO_ORDERS_MODULE in modules,
        "facturacion": CATALOGO_FACTURACION_MODULE in modules,
    }
    feature_states = {
        "quality_ai": CATALOGO_QUALITY_FEATURE in features,
        "bulk_sync": CATALOGO_BULK_SYNC_FEATURE in features,
        "third_party_api": CATALOGO_THIRD_PARTY_API_FEATURE in features,
    }
    usage = {
        "productos": catalogo_productos_for_capa(capa).count(),
        "bodegas": catalogo_bodegas_for_capa(capa).count(),
        "cajas": PuntoVenta.objects.filter(capa_negocio=capa, activo=True).count(),
    }
    resource_limits = {
        "productos": serialize_limit_state(
            key="productos",
            label="Productos",
            used=usage["productos"],
            limit=positive_int(limits.get("productos")),
        ),
        "bodegas": serialize_limit_state(
            key="bodegas",
            label="Bodegas",
            used=usage["bodegas"],
            limit=positive_int(limits.get("bodegas")),
        ),
        "cajas": serialize_limit_state(
            key="cajas",
            label="Cajas",
            used=usage["cajas"],
            limit=positive_int(limits.get("cajas")),
        ),
    }
    return {
        "contract_version": CATALOGO_CONTRACT_VERSION,
        "modules": module_states,
        "features": feature_states,
        "limits": resource_limits,
        "raw_limits": limits,
        "plan_guidance": {
            "modules": [
                build_capability_upgrade_notice(
                    subscription,
                    kind="module",
                    key=module_key,
                    enabled=module_states[state_key],
                )
                for state_key, module_key in [
                    ("productos", CATALOGO_PRODUCTOS_MODULE),
                    ("inventario", CATALOGO_INVENTARIO_MODULE),
                    ("ordenes", CATALOGO_ORDERS_MODULE),
                    ("facturacion", CATALOGO_FACTURACION_MODULE),
                ]
            ],
            "features": [
                build_capability_upgrade_notice(
                    subscription,
                    kind="feature",
                    key=feature_key,
                    enabled=feature_states[state_key],
                )
                for state_key, feature_key in [
                    ("quality_ai", CATALOGO_QUALITY_FEATURE),
                    ("bulk_sync", CATALOGO_BULK_SYNC_FEATURE),
                    ("third_party_api", CATALOGO_THIRD_PARTY_API_FEATURE),
                ]
            ],
            "limits": [
                build_limit_upgrade_notice(
                    subscription,
                    resource=resource,
                    label=state["label"].lower(),
                    used=positive_int(state["used"]),
                    limit=positive_int(state["limit"]),
                )
                for resource, state in resource_limits.items()
            ],
        },
    }


def audit_catalogo_limit_blocked(
    *,
    capa: CapaNegocio,
    subscription: SuscripcionCapa | None,
    resource: str,
    used: int,
    limit: int,
    actor=None,
) -> None:
    EventoAuditoria.objects.create(
        actor=actor,
        capa_negocio=capa,
        accion="catalogo.plan_limit_blocked",
        recurso_tipo="catalogo.plan_limit",
        recurso_id=resource,
        metadata={
            "solution": SOLUTION_POS_QR_KEY,
            "subscription_id": subscription.id if subscription else None,
            "plan_id": subscription.plan_id if subscription else None,
            "resource": resource,
            "used": used,
            "limit": limit,
        },
    )


def require_catalogo_capacity(
    *,
    capa: CapaNegocio,
    subscription: SuscripcionCapa | None,
    resource: str,
    label: str,
    used: int,
    additional: int = 1,
    actor=None,
) -> None:
    if not subscription or not subscription.plan:
        return
    limits = resolve_catalogo_limits(subscription)
    limit = positive_int(limits.get(resource))
    projected = used + max(int(additional or 0), 0)
    if (limit <= 0 and projected > 0) or (limit > 0 and projected > limit):
        audit_catalogo_limit_blocked(
            capa=capa,
            subscription=subscription,
            resource=resource,
            used=used,
            limit=limit,
            actor=actor,
        )
        notice = build_limit_upgrade_notice(
            subscription,
            resource=resource,
            label=label,
            used=used,
            limit=limit,
            projected=projected,
        )
        raise HttpError(
            403,
            f"{notice['message']} {notice['action']}",
        )


def quality_ai_enabled_for_request(request) -> bool:
    return subscription_has_feature(
        get_current_subscription(request),
        CATALOGO_QUALITY_FEATURE,
        default=True,
    )


def quality_ai_enabled_for_capa(capa: CapaNegocio) -> bool:
    return subscription_has_feature(
        get_subscription_for_capa(capa),
        CATALOGO_QUALITY_FEATURE,
        default=False,
    )


def validation_error_detail(exc: ValidationError | IntegrityError) -> str:
    if isinstance(exc, ValidationError):
        if hasattr(exc, "message_dict"):
            parts = []
            for field, messages in exc.message_dict.items():
                field_messages = ", ".join(str(message) for message in messages)
                parts.append(f"{field}: {field_messages}")
            return "; ".join(parts) or "Datos invalidos."
        if getattr(exc, "messages", None):
            return "; ".join(str(message) for message in exc.messages)
    return str(exc) or "Datos invalidos."


def save_or_400(instance):
    try:
        instance.save()
    except (ValidationError, IntegrityError) as exc:
        raise HttpError(400, validation_error_detail(exc)) from exc
    return instance


def resolve_category_for_capa(capa: CapaNegocio, category_id: int | None) -> Categoria | None:
    if category_id is None:
        return None
    return get_object_or_404(catalogo_categorias_for_capa(capa), id=category_id)


def resolve_product_for_capa(capa: CapaNegocio, product_id: int) -> Producto:
    return get_object_or_404(catalogo_productos_for_capa(capa), id=product_id)


def resolve_optional_quality_product(
    capa: CapaNegocio,
    *,
    product_id: int | None = None,
    internal_sku: str | None = None,
) -> Producto | None:
    if product_id is not None:
        return resolve_product_for_capa(capa, product_id)
    clean_sku = (internal_sku or "").strip()
    if not clean_sku:
        return None
    return get_object_or_404(catalogo_productos_for_capa(capa), internal_sku=clean_sku)


def resolve_warehouse_for_capa(capa: CapaNegocio, warehouse_id: int) -> Bodega:
    return get_object_or_404(catalogo_bodegas_for_capa(capa), id=warehouse_id)


def resolve_quality_issue_for_capa(capa: CapaNegocio, issue_id: int) -> CalidadIncidencia:
    return get_object_or_404(catalogo_calidad_incidencias_for_capa(capa), id=issue_id)






def resolve_order_for_capa(capa: CapaNegocio, order_id: int) -> Orden:
    return get_object_or_404(catalogo_ordenes_for_capa(capa), id=order_id)


def normalize_order_channel(value: str) -> str:
    channel = (value or "MANUAL").strip().upper()
    allowed = {choice[0] for choice in Orden.CHANNEL_CHOICES}
    if channel not in allowed:
        raise HttpError(400, f"Canal de venta no soportado: {channel}.")
    return channel


def quantize_money(value: Decimal | int | str | None) -> Decimal:
    raw_value = value if value is not None else Decimal("0")
    return Decimal(str(raw_value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def quantize_quantity(value: Decimal | int | str | None) -> Decimal:
    raw_value = value if value is not None else Decimal("0")
    return Decimal(str(raw_value)).quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)


def format_quantity(value: Decimal | int | str | None) -> str:
    return f"{quantize_quantity(value):.3f}"


def resolve_order_product_for_capa(
    capa: CapaNegocio,
    *,
    product_id: int | None = None,
    internal_sku: str | None = None,
) -> Producto:
    if product_id is not None:
        return resolve_product_for_capa(capa, product_id)
    clean_sku = (internal_sku or "").strip()
    if clean_sku:
        return get_object_or_404(catalogo_productos_for_capa(capa), internal_sku=clean_sku)
    raise HttpError(400, "Cada item debe indicar producto_id o internal_sku.")


def record_order_event(
    *,
    order: Orden,
    action: str,
    actor=None,
    metadata: dict[str, Any] | None = None,
) -> EventoAuditoria:
    return EventoAuditoria.objects.create(
        actor=actor,
        capa_negocio=order.capa_negocio,
        accion=f"catalogo.order_{action}"[:120],
        recurso_tipo="catalogo.order",
        recurso_id=str(order.id),
        metadata={
            "solution": SOLUTION_POS_QR_KEY,
            "canal": order.canal,
            "estatus": order.estatus,
            "payment_status": order.payment_status,
            "external_order_id": order.external_order_id,
            **(metadata or {}),
        },
    )


def create_order_for_capa(
    *,
    capa: CapaNegocio,
    payload: OrderCreateIn,
    actor=None,
) -> tuple[Orden, bool]:
    channel = normalize_order_channel(payload.canal)
    external_order_id = (payload.external_order_id or "").strip()[:120]
    if external_order_id:
        existing_order = (
            catalogo_ordenes_for_capa(capa)
            .filter(canal=channel, external_order_id=external_order_id)
            .select_related("creado_por")
            .prefetch_related("items__producto", "items__bodega", "items__inventario_item")
            .first()
        )
        if existing_order:
            return existing_order, False

    raw_items = list(payload.items or [])
    if not raw_items:
        raise HttpError(400, "La orden debe incluir al menos un item.")


    try:
        with transaction.atomic():
            order = Orden(
                capa_negocio=capa,
                canal=channel,
                external_order_id=external_order_id,
                estatus="NUEVA",
                payment_status=(payload.payment_status or "PENDIENTE").strip().upper(),
                cliente_nombre=payload.cliente_nombre or "",
                cliente_email=payload.cliente_email or "",
                cliente_telefono=payload.cliente_telefono or "",
                moneda=payload.moneda or "MXN",
                subtotal=Decimal("0"),
                envio=quantize_money(payload.envio),
                descuento=quantize_money(payload.descuento),
                total=Decimal("0"),
                metadata=payload.metadata if isinstance(payload.metadata, dict) else {},
                creado_por=actor,
            )
            save_or_400(order)

            computed_subtotal = Decimal("0")
            for item_payload in raw_items:
                product = resolve_order_product_for_capa(
                    capa,
                    product_id=item_payload.producto_id,
                    internal_sku=item_payload.internal_sku,
                )
                warehouse = None
                if item_payload.bodega_id is not None:
                    warehouse = resolve_warehouse_for_capa(capa, item_payload.bodega_id)
                unit_price = quantize_money(
                    item_payload.precio_unitario
                    if item_payload.precio_unitario is not None
                    else product.precio_base
                )
                line_subtotal = quantize_money((item_payload.cantidad or Decimal("0")) * unit_price)
                order_item = OrdenItem(
                    orden=order,
                    capa_negocio=capa,
                    producto=product,
                    bodega=warehouse,
                    external_item_id=item_payload.external_item_id or "",
                    titulo=item_payload.titulo or product.nombre,
                    cantidad=item_payload.cantidad,
                    precio_unitario=unit_price,
                    subtotal=line_subtotal,
                    metadata=(
                        item_payload.metadata if isinstance(item_payload.metadata, dict) else {}
                    ),
                )
                save_or_400(order_item)
                computed_subtotal += order_item.subtotal

            order.subtotal = quantize_money(
                payload.subtotal if payload.subtotal is not None else computed_subtotal
            )
            order.envio = quantize_money(payload.envio)
            order.descuento = quantize_money(payload.descuento)
            computed_total = order.subtotal + order.envio - order.descuento
            order.total = quantize_money(payload.total if payload.total is not None else computed_total)
            save_or_400(order)
            if payload.reservar:
                reserve_order_inventory(order, actor=actor, metadata={"source": "order_create"})
    except (ValidationError, IntegrityError) as exc:
        raise HttpError(400, validation_error_detail(exc)) from exc

    order.refresh_from_db()
    return order, True


def select_inventory_for_order_item(order_item: OrdenItem) -> InventarioItem:
    scoped_items = InventarioItem.objects.select_for_update().filter(
        capa_negocio=order_item.capa_negocio,
        producto=order_item.producto,
    )
    if order_item.inventario_item_id:
        inventory_item = scoped_items.filter(id=order_item.inventario_item_id).first()
        if inventory_item:
            return inventory_item
    if order_item.bodega_id:
        inventory_item = scoped_items.filter(bodega=order_item.bodega).first()
        if inventory_item:
            return inventory_item
        raise ValidationError({"inventario": "No existe inventario para la bodega indicada."})

    candidates = scoped_items.select_related("bodega").order_by("bodega__tipo", "bodega__id", "id")
    for inventory_item in candidates:
        if inventory_item.disponible >= order_item.cantidad:
            return inventory_item
    raise ValidationError({"inventario": "No hay inventario disponible para reservar el item."})


def create_order_inventory_movement(
    *,
    order: Orden,
    order_item: OrdenItem,
    inventory_item: InventarioItem,
    tipo: str,
    cantidad: Decimal,
    stock_anterior: Decimal,
    stock_nuevo: Decimal,
    actor=None,
    nota: str = "",
    metadata: dict[str, Any] | None = None,
) -> InventarioMovimiento:
    return InventarioMovimiento.objects.create(
        capa_negocio=order.capa_negocio,
        item=inventory_item,
        producto=order_item.producto,
        bodega=inventory_item.bodega,
        tipo=tipo,
        cantidad=cantidad,
        stock_anterior=stock_anterior,
        stock_nuevo=stock_nuevo,
        referencia_tipo="catalogo.orden",
        referencia_id=str(order.id),
        nota=nota,
        actor=actor,
        metadata={
            "order_id": order.id,
            "order_item_id": order_item.id,
            "external_order_id": order.external_order_id,
            "canal": order.canal,
            **(metadata or {}),
        },
    )


def reserve_order_inventory(
    order: Orden,
    *,
    actor=None,
    nota: str = "",
    metadata: dict[str, Any] | None = None,
) -> Orden:
    try:
        with transaction.atomic():
            locked_order = Orden.objects.select_for_update().get(id=order.id)
            if locked_order.estatus in {"RESERVADA", "CONFIRMADA"}:
                return locked_order
            if locked_order.estatus == "CANCELADA":
                raise ValidationError({"estatus": "No se puede reservar una orden cancelada."})

            order_items = list(
                locked_order.items.select_related("producto", "bodega", "inventario_item")
            )
            if not order_items:
                raise ValidationError({"items": "La orden no tiene items para reservar."})

            for order_item in order_items:
                inventory_item = select_inventory_for_order_item(order_item)
                if inventory_item.disponible < order_item.cantidad:
                    raise ValidationError(
                        {
                            "inventario": (
                                f"Stock insuficiente para {order_item.producto.internal_sku}. "
                                f"Disponible: {inventory_item.disponible}."
                            )
                        }
                    )
                stock_anterior = inventory_item.stock or Decimal("0")
                inventory_item.reservado = (inventory_item.reservado or Decimal("0")) + (
                    order_item.cantidad or Decimal("0")
                )
                inventory_item.save()
                order_item.inventario_item = inventory_item
                order_item.bodega = inventory_item.bodega
                order_item.save()
                create_order_inventory_movement(
                    order=locked_order,
                    order_item=order_item,
                    inventory_item=inventory_item,
                    tipo="RESERVA",
                    cantidad=order_item.cantidad,
                    stock_anterior=stock_anterior,
                    stock_nuevo=stock_anterior,
                    actor=actor,
                    nota=nota,
                    metadata=metadata,
                )

            locked_order.estatus = "RESERVADA"
            locked_order.fecha_reserva = locked_order.fecha_reserva or timezone.now()
            locked_order.ultimo_error = ""
            locked_order.save()
            return locked_order
    except (ValidationError, IntegrityError) as exc:
        raise HttpError(400, validation_error_detail(exc)) from exc


def confirm_order_inventory(
    order: Orden,
    *,
    actor=None,
    payment_status: str | None = None,
    nota: str = "",
    metadata: dict[str, Any] | None = None,
) -> Orden:
    if order.estatus == "NUEVA":
        order = reserve_order_inventory(order, actor=actor, nota=nota, metadata=metadata)

    try:
        with transaction.atomic():
            locked_order = Orden.objects.select_for_update().get(id=order.id)
            if locked_order.estatus == "CONFIRMADA":
                return locked_order
            if locked_order.estatus == "CANCELADA":
                raise ValidationError({"estatus": "No se puede confirmar una orden cancelada."})
            if locked_order.estatus != "RESERVADA":
                raise ValidationError({"estatus": "La orden debe estar reservada para confirmar."})

            for order_item in locked_order.items.select_related(
                "producto",
                "bodega",
                "inventario_item",
            ):
                inventory_item = select_inventory_for_order_item(order_item)
                quantity = order_item.cantidad or Decimal("0")
                if (inventory_item.reservado or Decimal("0")) < quantity:
                    raise ValidationError(
                        {"inventario": "La reserva no alcanza para confirmar la venta."}
                    )
                stock_anterior = inventory_item.stock or Decimal("0")
                stock_nuevo = stock_anterior - quantity
                inventory_item.stock = stock_nuevo
                inventory_item.reservado = (inventory_item.reservado or Decimal("0")) - quantity
                inventory_item.save()
                create_order_inventory_movement(
                    order=locked_order,
                    order_item=order_item,
                    inventory_item=inventory_item,
                    tipo="VENTA",
                    cantidad=-quantity,
                    stock_anterior=stock_anterior,
                    stock_nuevo=stock_nuevo,
                    actor=actor,
                    nota=nota,
                    metadata=metadata,
                )

            locked_order.estatus = "CONFIRMADA"
            if payment_status:
                locked_order.payment_status = payment_status.strip().upper()
            locked_order.fecha_confirmacion = locked_order.fecha_confirmacion or timezone.now()
            locked_order.ultimo_error = ""
            locked_order.save()
            return locked_order
    except (ValidationError, IntegrityError) as exc:
        raise HttpError(400, validation_error_detail(exc)) from exc


def cancel_order_inventory(
    order: Orden,
    *,
    actor=None,
    payment_status: str | None = None,
    nota: str = "",
    restock: bool = False,
    metadata: dict[str, Any] | None = None,
) -> Orden:
    try:
        with transaction.atomic():
            locked_order = Orden.objects.select_for_update().get(id=order.id)
            if locked_order.estatus == "CANCELADA":
                return locked_order

            if locked_order.estatus == "RESERVADA":
                for order_item in locked_order.items.select_related(
                    "producto",
                    "bodega",
                    "inventario_item",
                ):
                    inventory_item = select_inventory_for_order_item(order_item)
                    quantity = order_item.cantidad or Decimal("0")
                    if (inventory_item.reservado or Decimal("0")) < quantity:
                        raise ValidationError(
                            {"inventario": "La reserva no alcanza para cancelar la orden."}
                        )
                    stock_anterior = inventory_item.stock or Decimal("0")
                    inventory_item.reservado = (inventory_item.reservado or Decimal("0")) - quantity
                    inventory_item.save()
                    create_order_inventory_movement(
                        order=locked_order,
                        order_item=order_item,
                        inventory_item=inventory_item,
                        tipo="LIBERACION",
                        cantidad=-quantity,
                        stock_anterior=stock_anterior,
                        stock_nuevo=stock_anterior,
                        actor=actor,
                        nota=nota,
                        metadata=metadata,
                    )

            if locked_order.estatus == "CONFIRMADA" and restock:
                for order_item in locked_order.items.select_related(
                    "producto",
                    "bodega",
                    "inventario_item",
                ):
                    inventory_item = select_inventory_for_order_item(order_item)
                    quantity = order_item.cantidad or Decimal("0")
                    stock_anterior = inventory_item.stock or Decimal("0")
                    stock_nuevo = stock_anterior + quantity
                    inventory_item.stock = stock_nuevo
                    inventory_item.save()
                    create_order_inventory_movement(
                        order=locked_order,
                        order_item=order_item,
                        inventory_item=inventory_item,
                        tipo="CANCELACION",
                        cantidad=quantity,
                        stock_anterior=stock_anterior,
                        stock_nuevo=stock_nuevo,
                        actor=actor,
                        nota=nota,
                        metadata=metadata,
                    )

            locked_order.estatus = "CANCELADA"
            if payment_status:
                locked_order.payment_status = payment_status.strip().upper()
            locked_order.fecha_cancelacion = locked_order.fecha_cancelacion or timezone.now()
            locked_order.ultimo_error = ""
            locked_order.save()
            return locked_order
    except (ValidationError, IntegrityError) as exc:
        raise HttpError(400, validation_error_detail(exc)) from exc


def current_authenticated_actor(request):
    auth_context = getattr(request, "auth", None)
    actor = getattr(auth_context, "user", None)
    if getattr(actor, "is_authenticated", False):
        return actor
    actor = getattr(request, "user", None)
    if getattr(actor, "is_authenticated", False):
        return actor
    return None


def create_quality_issue(
    *,
    capa: CapaNegocio,
    payload: QualityIssueCreateIn,
    actor=None,
    ai_assisted: bool = True,
) -> CalidadIncidencia:
    product = resolve_optional_quality_product(
        capa,
        product_id=payload.producto_id,
        internal_sku=payload.internal_sku,
    )
    metadata = payload.metadata if isinstance(payload.metadata, dict) else {}
    raw_error = payload.raw_error or payload.descripcion or ""
    missing_fields = normalize_missing_fields(raw_error, metadata)
    explicit_missing = [
        str(field or "").strip().upper()
        for field in (payload.missing_fields or [])
        if str(field or "").strip()
    ]
    for field in explicit_missing:
        if field not in missing_fields:
            missing_fields.append(field)
    issue_type = infer_quality_issue_type(
        raw_error=raw_error,
        missing_fields=missing_fields,
        requested_type=payload.issue_type,
    )
    priority = (payload.prioridad or "").strip().upper() or infer_quality_priority(
        issue_type,
        missing_fields,
    )
    assistance = build_quality_assistance(
        product=product,
        issue_type=issue_type,
        raw_error=raw_error,
        missing_fields=missing_fields,
        metadata=metadata,
    )
    if not ai_assisted:
        assistance = {
            **assistance,
            "acciones_recomendadas": [],
            "campos_autocompletables": [],
            "nota_ia": (
                "La asistencia con IA no esta incluida en el plan actual; "
                "la incidencia queda disponible para revision manual."
            ),
        }
    title = (payload.titulo or assistance["summary"] or "Incidencia de calidad").strip()
    issue = CalidadIncidencia(
        capa_negocio=capa,
        producto=product,
        canal=(payload.canal or "").strip().lower(),
        external_resource_id=(payload.external_resource_id or "").strip(),
        external_code=extract_external_code(raw_error, payload.external_code),
        issue_type=issue_type,
        prioridad=priority,
        estatus="ABIERTA",
        titulo=title[:180],
        descripcion=payload.descripcion or assistance["summary"],
        raw_error=payload.raw_error or "",
        missing_fields=missing_fields,
        suggestions=assistance,
        ai_assisted=ai_assisted,
        requiere_revision_humana=True,
        creado_por=actor,
        metadata=metadata,
    )
    save_or_400(issue)
    return issue


def create_quality_issue_for_product(
    *,
    capa: CapaNegocio,
    product: Producto,
    raw_error: str,
    canal: str = "mercado_libre",
    external_code: str = "",
    metadata: dict[str, Any] | None = None,
    actor=None,
    ai_assisted: bool = True,
) -> CalidadIncidencia:
    return create_quality_issue(
        capa=capa,
        payload=QualityIssueCreateIn(
            producto_id=product.id,
            canal=canal,
            external_code=external_code,
            raw_error=raw_error,
            metadata=metadata or {},
        ),
        actor=actor,
        ai_assisted=ai_assisted,
    )


def serialize_solution_context(solution: Solucion | None) -> dict | None:
    if not solution:
        return None
    return {
        "id": solution.id,
        "code": solution.clave,
        "clave": solution.clave,
        "nombre": solution.nombre,
        "estatus": solution.estatus,
        "tipo": solution.tipo,
        "url_app": solution.url_app,
        "url_api": solution.url_api,
        "repo_origen": solution.repo_origen,
        "branch_origen": solution.branch_origen,
    }


def serialize_subscription_context(subscription: SuscripcionCapa | None) -> dict | None:
    if not subscription:
        return None
    modules = get_effective_plan_modules(subscription)
    features = get_effective_plan_features(subscription)
    overrides = get_subscription_capability_overrides(subscription)
    plan = subscription.plan
    return {
        "id": subscription.id,
        "estatus": subscription.estatus,
        "periodicidad": subscription.periodicidad,
        "fecha_inicio": subscription.fecha_inicio,
        "fecha_fin_periodo_actual": subscription.fecha_fin_periodo_actual,
        "plan": {
            "id": plan.id,
            "clave": plan.clave,
            "nombre": plan.nombre,
            "solution": serialize_solution_context(plan.solution),
        },
        "modulos_habilitados": modules,
        "funciones_habilitadas": features,
        "effective_entitlements": build_subscription_entitlement_summary(
            subscription,
            effective_modules=modules,
            effective_features=features,
            overrides=overrides,
        ),
    }


def build_platform_context(capa: CapaNegocio, subscription: SuscripcionCapa | None) -> dict:
    modules = get_effective_plan_modules(subscription)
    features = get_effective_plan_features(subscription)
    policy = build_catalogo_policy(capa)
    overrides = (
        get_subscription_capability_overrides(subscription)
        if subscription
        else {
            "modulos_agregados": [],
            "modulos_bloqueados": [],
            "funciones_agregadas": [],
            "funciones_bloqueadas": [],
            "nota": "",
        }
    )
    effective_entitlements = (
        build_subscription_entitlement_summary(
            subscription,
            effective_modules=modules,
            effective_features=features,
            overrides=overrides,
        )
        if subscription
        else None
    )
    pos_modules = [module for module in modules if module in CATALOGO_MODULES]
    pos_features = [
        feature
        for feature in features
        if feature.startswith(CATALOGO_FEATURE_PREFIX)
    ]
    has_access = CATALOGO_PRODUCTOS_MODULE in modules
    return {
        "solution": serialize_solution_context(get_pos_solution()),
        "capa_negocio": serialize_capa(capa),
        "subscription": serialize_subscription_context(subscription),
        "entitlements": {
            "has_access": has_access,
            "required_module": CATALOGO_PRODUCTOS_MODULE,
            "quality_feature": CATALOGO_QUALITY_FEATURE,
            "modules": pos_modules,
            "features": pos_features,
            "contract_version": CATALOGO_CONTRACT_VERSION,
            "matrix": effective_entitlements,
            "overrides": overrides,
            "policy": policy,
        },
        "contract": {
            "tenant_header": "X-BetterP-Capa-Id",
            "user_header": "X-BetterP-User-Id",
            "solution": SOLUTION_POS_QR_KEY,
        },
        "generated_at": timezone.now(),
    }


def serialize_capa(capa: CapaNegocio) -> dict:
    return {
        "id": capa.id,
        "nombre": capa.nombre,
        "tipo_capa": capa.tipo_capa,
        "activo": capa.activo,
    }


def serialize_category(category: Categoria) -> dict:
    return {
        "id": category.id,
        "nombre": category.nombre,
        "parent_id": category.parent_id,
        "parent_nombre": category.parent.nombre if category.parent_id else None,
        "activo": category.activo,
        "productos_count": int(getattr(category, "productos_count", 0) or 0),
        "fecha_creacion": category.fecha_creacion,
        "fecha_actualizacion": category.fecha_actualizacion,
    }


def serialize_image(image: ProductoImagen | None) -> dict | None:
    if image is None:
        return None
    return {
        "id": image.id,
        "is_main": image.is_main,
        "alt_text": image.alt_text,
        "public_url": image.public_url,
        "asset_status": image.asset_status,
        "content_type": image.content_type,
        "bytes_size": image.bytes_size,
        "width": image.width,
        "height": image.height,
        "last_verified_at": image.last_verified_at,
        "last_error": image.last_error,
    }


def serialize_product(product: Producto) -> dict:
    images = list(product.imagenes.all())
    main_image = next(
        (image for image in images if image.is_main),
        images[0] if images else None,
    )
    category = product.categoria
    return {
        "id": product.id,
        "internal_sku": product.internal_sku,
        "brand_sku": product.brand_sku,
        "nombre": product.nombre,
        "descripcion": product.descripcion,
        "marca": product.marca,
        "precio_base": str(product.precio_base),
        "peso": str(product.peso),
        "largo": str(product.largo),
        "ancho": str(product.ancho),
        "alto": str(product.alto),
        "master_attributes": product.master_attributes or {},
        "source": product.source,
        "activo": product.activo,
        "categoria": (
            {
                "id": category.id,
                "nombre": category.nombre,
                "parent_id": category.parent_id,
            }
            if category
            else None
        ),
        "imagenes_count": len(images),
        "imagen_principal": serialize_image(main_image),
        "fecha_creacion": product.fecha_creacion,
        "fecha_actualizacion": product.fecha_actualizacion,
    }


def serialize_tienda_facil_catalog_product(product: Producto) -> dict:
    images = list(product.imagenes.all())
    main_image = next(
        (image for image in images if image.is_main),
        images[0] if images else None,
    )
    inventory_items = list(product.inventario_items.all())
    available = sum((item.disponible for item in inventory_items), Decimal("0"))
    category = product.categoria
    return {
        "id": product.id,
        "internal_sku": product.internal_sku,
        "brand_sku": product.brand_sku,
        "nombre": product.nombre,
        "descripcion": product.descripcion or "",
        "marca": product.marca or "",
        "precio_base": str(product.precio_base),
        "currency": "MXN",
        "activo": product.activo,
        "categoria": (
            {
                "id": category.id,
                "nombre": category.nombre,
                "parent_id": category.parent_id,
            }
            if category
            else None
        ),
        "imagen_principal": serialize_image(main_image),
        "stock_disponible": str(available),
        "inventario_items_count": len(inventory_items),
        "source": product.source,
        "master_attributes": product.master_attributes or {},
        "fecha_actualizacion": product.fecha_actualizacion,
    }


def serialize_quality_issue(issue: CalidadIncidencia) -> dict:
    product = issue.producto
    return {
        "id": issue.id,
        "capa_negocio_id": issue.capa_negocio_id,
        "producto": (
            {
                "id": product.id,
                "internal_sku": product.internal_sku,
                "nombre": product.nombre,
                "marca": product.marca,
                "categoria_id": product.categoria_id,
            }
            if product
            else None
        ),
        "canal": issue.canal,
        "external_resource_id": issue.external_resource_id,
        "external_code": issue.external_code,
        "issue_type": issue.issue_type,
        "prioridad": issue.prioridad,
        "estatus": issue.estatus,
        "titulo": issue.titulo,
        "descripcion": issue.descripcion,
        "raw_error": issue.raw_error,
        "missing_fields": issue.missing_fields or [],
        "suggestions": issue.suggestions or {},
        "ai_assisted": issue.ai_assisted,
        "requiere_revision_humana": issue.requiere_revision_humana,
        "asignado_a": (
            {
                "id": issue.asignado_a_id,
                "email": issue.asignado_a.email,
            }
            if issue.asignado_a_id
            else None
        ),
        "creado_por": (
            {
                "id": issue.creado_por_id,
                "email": issue.creado_por.email,
            }
            if issue.creado_por_id
            else None
        ),
        "resuelto_por": (
            {
                "id": issue.resuelto_por_id,
                "email": issue.resuelto_por.email,
            }
            if issue.resuelto_por_id
            else None
        ),
        "metadata": issue.metadata or {},
        "fecha_creacion": issue.fecha_creacion,
        "fecha_actualizacion": issue.fecha_actualizacion,
        "fecha_resolucion": issue.fecha_resolucion,
    }






def serialize_warehouse(warehouse: Bodega) -> dict:
    return {
        "id": warehouse.id,
        "codigo": warehouse.codigo,
        "nombre": warehouse.nombre,
        "tipo": warehouse.tipo,
        "direccion": warehouse.direccion,
        "activo": warehouse.activo,
        "items_count": int(getattr(warehouse, "items_count", 0) or 0),
        "fecha_creacion": warehouse.fecha_creacion,
        "fecha_actualizacion": warehouse.fecha_actualizacion,
    }


def serialize_inventory_item(item: InventarioItem) -> dict:
    product = item.producto
    warehouse = item.bodega
    return {
        "id": item.id,
        "producto": {
            "id": product.id,
            "internal_sku": product.internal_sku,
            "brand_sku": product.brand_sku,
            "nombre": product.nombre,
            "marca": product.marca,
            "activo": product.activo,
        },
        "bodega": {
            "id": warehouse.id,
            "codigo": warehouse.codigo,
            "nombre": warehouse.nombre,
            "tipo": warehouse.tipo,
            "activo": warehouse.activo,
        },
        "stock": format_quantity(item.stock),
        "reservado": format_quantity(item.reservado),
        "disponible": format_quantity(item.disponible),
        "costo_promedio": str(item.costo_promedio),
        "ultimo_costo": str(item.ultimo_costo),
        "metadata": item.metadata or {},
        "fecha_creacion": item.fecha_creacion,
        "fecha_actualizacion": item.fecha_actualizacion,
    }


def serialize_inventory_movement(movement: InventarioMovimiento) -> dict:
    return {
        "id": movement.id,
        "tipo": movement.tipo,
        "cantidad": format_quantity(movement.cantidad),
        "stock_anterior": format_quantity(movement.stock_anterior),
        "stock_nuevo": format_quantity(movement.stock_nuevo),
        "referencia_tipo": movement.referencia_tipo,
        "referencia_id": movement.referencia_id,
        "nota": movement.nota,
        "producto": {
            "id": movement.producto_id,
            "internal_sku": movement.producto.internal_sku,
            "nombre": movement.producto.nombre,
        },
        "bodega": {
            "id": movement.bodega_id,
            "codigo": movement.bodega.codigo,
            "nombre": movement.bodega.nombre,
        },
        "actor": (
            {
                "id": movement.actor_id,
                "email": movement.actor.email,
            }
            if movement.actor_id
            else None
        ),
        "evento_auditoria_id": movement.evento_auditoria_id,
        "metadata": movement.metadata or {},
        "fecha_creacion": movement.fecha_creacion,
    }


def serialize_order_item(item: OrdenItem) -> dict:
    product = item.producto
    warehouse = item.bodega
    inventory_item = item.inventario_item
    return {
        "id": item.id,
        "external_item_id": item.external_item_id,
        "titulo": item.titulo,
        "cantidad": str(item.cantidad),
        "precio_unitario": str(item.precio_unitario),
        "subtotal": str(item.subtotal),
        "producto": {
            "id": product.id,
            "internal_sku": product.internal_sku,
            "brand_sku": product.brand_sku,
            "nombre": product.nombre,
            "marca": product.marca,
            "activo": product.activo,
        },
        "bodega": (
            {
                "id": warehouse.id,
                "codigo": warehouse.codigo,
                "nombre": warehouse.nombre,
                "tipo": warehouse.tipo,
            }
            if warehouse
            else None
        ),
        "inventario_item_id": inventory_item.id if inventory_item else None,
        "metadata": item.metadata or {},
        "fecha_creacion": item.fecha_creacion,
    }


def serialize_order(order: Orden) -> dict:
    items = list(order.items.all())
    return {
        "id": order.id,
        "capa_negocio_id": order.capa_negocio_id,
        "canal": order.canal,
        "external_order_id": order.external_order_id,
        "estatus": order.estatus,
        "payment_status": order.payment_status,
        "cliente": {
            "nombre": order.cliente_nombre,
            "email": order.cliente_email,
            "telefono": order.cliente_telefono,
        },
        "moneda": order.moneda,
        "subtotal": str(order.subtotal),
        "envio": str(order.envio),
        "descuento": str(order.descuento),
        "total": str(order.total),
        "items_count": len(items),
        "items": [serialize_order_item(item) for item in items],
        "metadata": order.metadata or {},
        "ultimo_error": order.ultimo_error,
        "creado_por": (
            {
                "id": order.creado_por_id,
                "email": order.creado_por.email,
            }
            if order.creado_por_id
            else None
        ),
        "fecha_reserva": order.fecha_reserva,
        "fecha_confirmacion": order.fecha_confirmacion,
        "fecha_cancelacion": order.fecha_cancelacion,
        "fecha_creacion": order.fecha_creacion,
        "fecha_actualizacion": order.fecha_actualizacion,
    }


def resolve_pagination(page: int, page_size: int) -> tuple[int, int]:
    safe_page = max(int(page or 1), 1)
    safe_page_size = min(max(int(page_size or 20), 1), MAX_PAGE_SIZE)
    return safe_page, safe_page_size


def build_catalog_response(
    capa: CapaNegocio,
    *,
    search: str = "",
    categoria_id: int | None = None,
    activo: bool | None = None,
    page: int = 1,
    page_size: int = 20,
) -> dict:
    safe_page, safe_page_size = resolve_pagination(page, page_size)
    categories_queryset = (
        catalogo_categorias_for_capa(capa)
        .select_related("parent")
        .annotate(productos_count=Count("productos", distinct=True))
    )
    products_queryset = (
        catalogo_productos_for_capa(capa)
        .select_related("categoria")
        .prefetch_related(
            Prefetch(
                "imagenes",
                queryset=ProductoImagen.objects.order_by("-is_main", "id"),
            )
        )
    )

    clean_search = (search or "").strip()
    if clean_search:
        products_queryset = products_queryset.filter(
            Q(internal_sku__icontains=clean_search)
            | Q(brand_sku__icontains=clean_search)
            | Q(nombre__icontains=clean_search)
            | Q(marca__icontains=clean_search)
        )
        categories_queryset = categories_queryset.filter(
            Q(nombre__icontains=clean_search)
            | Q(productos__internal_sku__icontains=clean_search)
            | Q(productos__brand_sku__icontains=clean_search)
            | Q(productos__nombre__icontains=clean_search)
            | Q(productos__marca__icontains=clean_search)
        ).distinct()

    if categoria_id is not None:
        category_exists = catalogo_categorias_for_capa(capa).filter(id=categoria_id).exists()
        if not category_exists:
            raise HttpError(404, "La categoria no existe en la capa solicitada.")
        products_queryset = products_queryset.filter(categoria_id=categoria_id)
        categories_queryset = categories_queryset.filter(id=categoria_id)

    if activo is not None:
        products_queryset = products_queryset.filter(activo=activo)
        categories_queryset = categories_queryset.filter(activo=activo)

    product_total = products_queryset.count()
    category_total = categories_queryset.count()
    total_pages = max((product_total + safe_page_size - 1) // safe_page_size, 1)
    current_page = min(safe_page, total_pages)
    start = (current_page - 1) * safe_page_size
    end = start + safe_page_size

    scoped_products = catalogo_productos_for_capa(capa)
    policy = build_catalogo_policy(capa)
    return {
        "capa_negocio": serialize_capa(capa),
        "capability": {
            "modulo_requerido": CATALOGO_PRODUCTOS_MODULE,
            "limit": policy["limits"]["productos"],
        },
        "resumen": {
            "categorias_total": catalogo_categorias_for_capa(capa).count(),
            "productos_total": scoped_products.count(),
            "productos_activos": scoped_products.filter(activo=True).count(),
            "productos_inactivos": scoped_products.filter(activo=False).count(),
            "imagenes_total": ProductoImagen.objects.filter(
                producto__capa_negocio=capa
            ).count(),
        },
        "filtros": {
            "search": clean_search,
            "categoria_id": categoria_id,
            "activo": activo,
        },
        "categorias": [serialize_category(category) for category in categories_queryset],
        "productos": [
            serialize_product(product)
            for product in products_queryset.order_by("nombre", "id")[start:end]
        ],
        "pagination": {
            "page": current_page,
            "page_size": safe_page_size,
            "total": product_total,
            "total_pages": total_pages,
        },
        "totales_filtrados": {
            "categorias": category_total,
            "productos": product_total,
        },
    }


def build_quality_response(
    capa: CapaNegocio,
    *,
    search: str = "",
    estatus: str | None = None,
    canal: str = "",
    producto_id: int | None = None,
    page: int = 1,
    page_size: int = 20,
) -> dict:
    safe_page, safe_page_size = resolve_pagination(page, page_size)
    issues_queryset = catalogo_calidad_incidencias_for_capa(capa).select_related(
        "producto",
        "asignado_a",
        "creado_por",
        "resuelto_por",
    )
    clean_search = (search or "").strip()
    if clean_search:
        issues_queryset = issues_queryset.filter(
            Q(titulo__icontains=clean_search)
            | Q(descripcion__icontains=clean_search)
            | Q(raw_error__icontains=clean_search)
            | Q(external_code__icontains=clean_search)
            | Q(producto__internal_sku__icontains=clean_search)
            | Q(producto__nombre__icontains=clean_search)
        )
    clean_status = (estatus or "").strip().upper()
    if clean_status:
        issues_queryset = issues_queryset.filter(estatus=clean_status)
    clean_channel = (canal or "").strip().lower()
    if clean_channel:
        issues_queryset = issues_queryset.filter(canal=clean_channel)
    if producto_id is not None:
        product_exists = catalogo_productos_for_capa(capa).filter(id=producto_id).exists()
        if not product_exists:
            raise HttpError(404, "El producto no existe en la capa solicitada.")
        issues_queryset = issues_queryset.filter(producto_id=producto_id)

    scoped_issues = catalogo_calidad_incidencias_for_capa(capa)
    total = issues_queryset.count()
    total_pages = max((total + safe_page_size - 1) // safe_page_size, 1)
    current_page = min(safe_page, total_pages)
    start = (current_page - 1) * safe_page_size
    end = start + safe_page_size
    policy = build_catalogo_policy(capa)
    return {
        "capa_negocio": serialize_capa(capa),
        "capability": {
            "modulo_requerido": CATALOGO_PRODUCTOS_MODULE,
            "feature_ia": CATALOGO_QUALITY_FEATURE,
            "ia_habilitada": bool(policy["features"]["quality_ai"]),
        },
        "resumen": {
            "total": scoped_issues.count(),
            "abiertas": scoped_issues.filter(estatus="ABIERTA").count(),
            "en_revision": scoped_issues.filter(estatus="EN_REVISION").count(),
            "resueltas": scoped_issues.filter(estatus="RESUELTA").count(),
            "bloqueantes": scoped_issues.filter(prioridad="BLOCKER").count(),
        },
        "filtros": {
            "search": clean_search,
            "estatus": clean_status or None,
            "canal": clean_channel,
            "producto_id": producto_id,
        },
        "items": [
            serialize_quality_issue(issue)
            for issue in issues_queryset.order_by("-fecha_creacion", "-id")[start:end]
        ],
        "pagination": {
            "page": current_page,
            "page_size": safe_page_size,
            "total": total,
            "total_pages": total_pages,
        },
    }




def build_inventory_response(
    capa: CapaNegocio,
    *,
    search: str = "",
    bodega_id: int | None = None,
    producto_id: int | None = None,
    page: int = 1,
    page_size: int = 20,
    movement_limit: int = 20,
) -> dict:
    safe_page, safe_page_size = resolve_pagination(page, page_size)
    safe_movement_limit = min(max(int(movement_limit or 20), 1), 100)
    warehouses_queryset = catalogo_bodegas_for_capa(capa).annotate(
        items_count=Count("inventario_items", distinct=True)
    )
    items_queryset = catalogo_inventario_items_for_capa(capa).select_related(
        "producto",
        "bodega",
    )
    movements_queryset = catalogo_inventario_movimientos_for_capa(capa).select_related(
        "producto",
        "bodega",
        "actor",
    )

    clean_search = (search or "").strip()
    if clean_search:
        items_queryset = items_queryset.filter(
            Q(producto__internal_sku__icontains=clean_search)
            | Q(producto__brand_sku__icontains=clean_search)
            | Q(producto__nombre__icontains=clean_search)
            | Q(bodega__codigo__icontains=clean_search)
            | Q(bodega__nombre__icontains=clean_search)
        )
        warehouses_queryset = warehouses_queryset.filter(
            Q(codigo__icontains=clean_search)
            | Q(nombre__icontains=clean_search)
            | Q(inventario_items__producto__internal_sku__icontains=clean_search)
            | Q(inventario_items__producto__nombre__icontains=clean_search)
        ).distinct()
        movements_queryset = movements_queryset.filter(
            Q(producto__internal_sku__icontains=clean_search)
            | Q(producto__nombre__icontains=clean_search)
            | Q(bodega__codigo__icontains=clean_search)
            | Q(referencia_id__icontains=clean_search)
        )

    if bodega_id is not None:
        warehouse_exists = catalogo_bodegas_for_capa(capa).filter(id=bodega_id).exists()
        if not warehouse_exists:
            raise HttpError(404, "La bodega no existe en la capa solicitada.")
        warehouses_queryset = warehouses_queryset.filter(id=bodega_id)
        items_queryset = items_queryset.filter(bodega_id=bodega_id)
        movements_queryset = movements_queryset.filter(bodega_id=bodega_id)

    if producto_id is not None:
        product_exists = catalogo_productos_for_capa(capa).filter(id=producto_id).exists()
        if not product_exists:
            raise HttpError(404, "El producto no existe en la capa solicitada.")
        items_queryset = items_queryset.filter(producto_id=producto_id)
        movements_queryset = movements_queryset.filter(producto_id=producto_id)

    scoped_items = catalogo_inventario_items_for_capa(capa)
    scoped_movements = catalogo_inventario_movimientos_for_capa(capa)
    policy = build_catalogo_policy(capa)
    inventory_totals = scoped_items.aggregate(
        stock_total=Sum("stock"),
        reservado_total=Sum("reservado"),
    )
    stock_total = inventory_totals["stock_total"] or Decimal("0")
    reservado_total = inventory_totals["reservado_total"] or Decimal("0")

    item_total = items_queryset.count()
    warehouse_total = warehouses_queryset.count()
    total_pages = max((item_total + safe_page_size - 1) // safe_page_size, 1)
    current_page = min(safe_page, total_pages)
    start = (current_page - 1) * safe_page_size
    end = start + safe_page_size

    items = list(items_queryset.order_by("producto__nombre", "bodega__nombre", "id")[start:end])
    movements = list(movements_queryset.order_by("-fecha_creacion", "-id")[:safe_movement_limit])
    return {
        "capa_negocio": serialize_capa(capa),
        "capability": {
            "modulo_requerido": CATALOGO_INVENTARIO_MODULE,
            "limit": policy["limits"]["bodegas"],
        },
        "resumen": {
            "bodegas_total": catalogo_bodegas_for_capa(capa).count(),
            "bodegas_activas": catalogo_bodegas_for_capa(capa).filter(activo=True).count(),
            "items_total": scoped_items.count(),
            "productos_con_stock": scoped_items.filter(stock__gt=0)
            .values("producto_id")
            .distinct()
            .count(),
            "stock_total": format_quantity(stock_total),
            "reservado_total": format_quantity(reservado_total),
            "disponible_total": format_quantity(stock_total - reservado_total),
            "movimientos_total": scoped_movements.count(),
        },
        "filtros": {
            "search": clean_search,
            "bodega_id": bodega_id,
            "producto_id": producto_id,
        },
        "bodegas": [serialize_warehouse(warehouse) for warehouse in warehouses_queryset],
        "items": [serialize_inventory_item(item) for item in items],
        "movimientos_recientes": [
            serialize_inventory_movement(movement) for movement in movements
        ],
        "pagination": {
            "page": current_page,
            "page_size": safe_page_size,
            "total": item_total,
            "total_pages": total_pages,
        },
        "totales_filtrados": {
            "bodegas": warehouse_total,
            "items": item_total,
            "movimientos": movements_queryset.count(),
        },
    }


def build_orders_response(
    capa: CapaNegocio,
    *,
    search: str = "",
    estatus: str | None = None,
    canal: str = "",
    page: int = 1,
    page_size: int = 20,
) -> dict:
    safe_page, safe_page_size = resolve_pagination(page, page_size)
    items_queryset = OrdenItem.objects.select_related(
        "producto",
        "bodega",
        "inventario_item",
    )
    orders_queryset = (
        catalogo_ordenes_for_capa(capa)
        .select_related("creado_por")
        .prefetch_related(Prefetch("items", queryset=items_queryset))
    )

    clean_search = (search or "").strip()
    if clean_search:
        orders_queryset = orders_queryset.filter(
            Q(external_order_id__icontains=clean_search)
            | Q(cliente_nombre__icontains=clean_search)
            | Q(cliente_email__icontains=clean_search)
            | Q(items__producto__internal_sku__icontains=clean_search)
            | Q(items__producto__nombre__icontains=clean_search)
        ).distinct()

    clean_status = (estatus or "").strip().upper()
    if clean_status:
        orders_queryset = orders_queryset.filter(estatus=clean_status)

    clean_channel = ""
    if canal:
        clean_channel = normalize_order_channel(canal)
        orders_queryset = orders_queryset.filter(canal=clean_channel)

    scoped_orders = catalogo_ordenes_for_capa(capa)
    totals = scoped_orders.aggregate(
        ventas_confirmadas=Sum("total", filter=Q(estatus="CONFIRMADA")),
        ventas_reservadas=Sum("total", filter=Q(estatus="RESERVADA")),
    )
    total = orders_queryset.count()
    total_pages = max((total + safe_page_size - 1) // safe_page_size, 1)
    current_page = min(safe_page, total_pages)
    start = (current_page - 1) * safe_page_size
    end = start + safe_page_size

    policy = build_catalogo_policy(capa)
    return {
        "capa_negocio": serialize_capa(capa),
        "capability": {
            "modulo_requerido": CATALOGO_ORDERS_MODULE,
            "features": {
                "bulk_sync": bool(policy["features"]["bulk_sync"]),
                "third_party_api": bool(policy["features"]["third_party_api"]),
            },
        },
        "resumen": {
            "total": scoped_orders.count(),
            "nuevas": scoped_orders.filter(estatus="NUEVA").count(),
            "reservadas": scoped_orders.filter(estatus="RESERVADA").count(),
            "confirmadas": scoped_orders.filter(estatus="CONFIRMADA").count(),
            "canceladas": scoped_orders.filter(estatus="CANCELADA").count(),
            "ventas_confirmadas": str(totals["ventas_confirmadas"] or Decimal("0")),
            "ventas_reservadas": str(totals["ventas_reservadas"] or Decimal("0")),
        },
        "filtros": {
            "search": clean_search,
            "estatus": clean_status or None,
            "canal": clean_channel,
        },
        "items": [
            serialize_order(order)
            for order in orders_queryset.order_by("-fecha_creacion", "-id")[start:end]
        ],
        "pagination": {
            "page": current_page,
            "page_size": safe_page_size,
            "total": total,
            "total_pages": total_pages,
        },
    }


@router.get("/platform/context/")
def platform_context_actual(request):
    capa = get_current_capa(request)
    subscription = get_current_subscription(request)
    return build_platform_context(capa, subscription)






def serialize_platform_event(event: EventoAuditoria) -> dict:
    return {
        "id": event.id,
        "accion": event.accion,
        "recurso_tipo": event.recurso_tipo,
        "recurso_id": event.recurso_id,
        "capa_negocio_id": event.capa_negocio_id,
        "metadata": event.metadata or {},
        "fecha_creacion": event.fecha_creacion,
    }








@router.get("/platform/events/")
def platform_events_admin(request, capa_id: int | None = None, limit: int = 30):
    require_platform_admin_access(request)
    safe_limit = min(max(int(limit or 30), 1), 100)
    qs = EventoAuditoria.objects.filter(accion__startswith="catalogo.").select_related(
        "capa_negocio"
    )
    if capa_id:
        qs = qs.filter(capa_negocio_id=capa_id)
    events = list(qs.order_by("-fecha_creacion", "-id")[:safe_limit])
    return {
        "items": [serialize_platform_event(event) for event in events],
        "total": qs.count(),
        "limit": safe_limit,
    }


@router.get("/catalogo/")
def catalogo_actual(
    request,
    search: str = "",
    categoria_id: int | None = None,
    activo: bool | None = None,
    page: int = 1,
    page_size: int = 20,
):
    require_pos_plan_module(request, CATALOGO_PRODUCTOS_MODULE)
    capa = get_current_capa(request)
    return build_catalog_response(
        capa,
        search=search,
        categoria_id=categoria_id,
        activo=activo,
        page=page,
        page_size=page_size,
    )


@router.post("/catalogo/categorias/")
def crear_categoria_actual(request, payload: CategoryUpsertIn):
    require_pos_plan_module(request, CATALOGO_PRODUCTOS_MODULE)
    capa = get_current_capa(request)
    category = Categoria(
        capa_negocio=capa,
        nombre=(payload.nombre or "").strip(),
        parent=resolve_category_for_capa(capa, payload.parent_id),
        activo=payload.activo,
        metadata=payload.metadata if isinstance(payload.metadata, dict) else {},
    )
    save_or_400(category)
    return {"created": True, "categoria": serialize_category(category)}


@router.patch("/catalogo/categorias/{category_id}/")
def actualizar_categoria_actual(request, category_id: int, payload: CategoryUpsertIn):
    require_pos_plan_module(request, CATALOGO_PRODUCTOS_MODULE)
    capa = get_current_capa(request)
    category = get_object_or_404(catalogo_categorias_for_capa(capa), id=category_id)
    category.nombre = (payload.nombre or "").strip()
    category.parent = resolve_category_for_capa(capa, payload.parent_id)
    category.activo = payload.activo
    category.metadata = payload.metadata if isinstance(payload.metadata, dict) else {}
    save_or_400(category)
    return {"updated": True, "categoria": serialize_category(category)}


@router.post("/catalogo/productos/")
def crear_producto_actual(request, payload: ProductUpsertIn):
    subscription = require_pos_plan_module(request, CATALOGO_PRODUCTOS_MODULE)
    capa = get_current_capa(request)
    require_catalogo_capacity(
        capa=capa,
        subscription=subscription,
        resource="productos",
        label="productos",
        used=catalogo_productos_for_capa(capa).count(),
        actor=current_authenticated_actor(request),
    )
    product = Producto(
        capa_negocio=capa,
        categoria=resolve_category_for_capa(capa, payload.categoria_id),
        internal_sku=(payload.internal_sku or "").strip(),
        brand_sku=(payload.brand_sku or "").strip() or None,
        nombre=(payload.nombre or "").strip(),
        descripcion=payload.descripcion,
        marca=(payload.marca or "").strip() or None,
        precio_base=payload.precio_base,
        peso=payload.peso,
        largo=payload.largo,
        ancho=payload.ancho,
        alto=payload.alto,
        master_attributes=(
            payload.master_attributes if isinstance(payload.master_attributes, dict) else {}
        ),
        source=(payload.source or "manual").strip(),
        activo=payload.activo,
    )
    save_or_400(product)
    return {"created": True, "producto": serialize_product(product)}


@router.patch("/catalogo/productos/{product_id}/")
def actualizar_producto_actual(request, product_id: int, payload: ProductUpsertIn):
    require_pos_plan_module(request, CATALOGO_PRODUCTOS_MODULE)
    capa = get_current_capa(request)
    product = resolve_product_for_capa(capa, product_id)
    product.categoria = resolve_category_for_capa(capa, payload.categoria_id)
    product.internal_sku = (payload.internal_sku or "").strip()
    product.brand_sku = (payload.brand_sku or "").strip() or None
    product.nombre = (payload.nombre or "").strip()
    product.descripcion = payload.descripcion
    product.marca = (payload.marca or "").strip() or None
    product.precio_base = payload.precio_base
    product.peso = payload.peso
    product.largo = payload.largo
    product.ancho = payload.ancho
    product.alto = payload.alto
    product.master_attributes = (
        payload.master_attributes if isinstance(payload.master_attributes, dict) else {}
    )
    product.source = (payload.source or "manual").strip()
    product.activo = payload.activo
    save_or_400(product)
    return {"updated": True, "producto": serialize_product(product)}


@router.get("/calidad/incidencias/")
def calidad_incidencias_actual(
    request,
    search: str = "",
    estatus: str | None = None,
    canal: str = "",
    producto_id: int | None = None,
    page: int = 1,
    page_size: int = 20,
):
    require_pos_plan_module(request, CATALOGO_PRODUCTOS_MODULE)
    capa = get_current_capa(request)
    return build_quality_response(
        capa,
        search=search,
        estatus=estatus,
        canal=canal,
        producto_id=producto_id,
        page=page,
        page_size=page_size,
    )


@router.post("/calidad/incidencias/")
def crear_calidad_incidencia_actual(request, payload: QualityIssueCreateIn):
    require_pos_plan_module(request, CATALOGO_PRODUCTOS_MODULE)
    capa = get_current_capa(request)
    issue = create_quality_issue(
        capa=capa,
        payload=payload,
        actor=current_authenticated_actor(request),
        ai_assisted=quality_ai_enabled_for_request(request),
    )
    EventoAuditoria.objects.create(
        actor=current_authenticated_actor(request),
        capa_negocio=capa,
        accion="catalogo.quality_issue_opened",
        recurso_tipo="catalogo.quality_issue",
        recurso_id=str(issue.id),
        metadata={
            "solution": SOLUTION_POS_QR_KEY,
            "channel": "authenticated_api",
            "canal": issue.canal,
            "external_code": issue.external_code,
            "producto_id": issue.producto_id,
            "missing_fields": issue.missing_fields or [],
        },
    )
    return {"created": True, "incidencia": serialize_quality_issue(issue)}


@router.patch("/calidad/incidencias/{issue_id}/")
def actualizar_calidad_incidencia_actual(
    request,
    issue_id: int,
    payload: QualityIssueUpdateIn,
):
    require_pos_plan_module(request, CATALOGO_PRODUCTOS_MODULE)
    capa = get_current_capa(request)
    issue = resolve_quality_issue_for_capa(capa, issue_id)
    actor = current_authenticated_actor(request)
    issue.estatus = (payload.estatus or "EN_REVISION").strip().upper()
    if payload.prioridad:
        issue.prioridad = payload.prioridad.strip().upper()
    if issue.estatus in {"RESUELTA", "IGNORADA"}:
        issue.resuelto_por = actor
        issue.fecha_resolucion = timezone.now()
    else:
        issue.resuelto_por = None
        issue.fecha_resolucion = None
    if payload.nota:
        issue.metadata = {
            **(issue.metadata or {}),
            "ultima_nota_operativa": payload.nota,
            "ultima_actualizacion_operativa": timezone.now().isoformat(),
        }
    save_or_400(issue)
    return {"updated": True, "incidencia": serialize_quality_issue(issue)}


@router.post("/calidad/incidencias/{issue_id}/corregir/")
def corregir_calidad_incidencia_actual(
    request,
    issue_id: int,
    payload: QualityIssueCorrectionIn,
):
    require_pos_plan_module(request, CATALOGO_PRODUCTOS_MODULE)
    capa = get_current_capa(request)
    issue = resolve_quality_issue_for_capa(capa, issue_id)
    if not issue.producto_id:
        raise HttpError(400, "La incidencia no esta vinculada a un producto.")
    actor = current_authenticated_actor(request)
    with transaction.atomic():
        product = resolve_product_for_capa(capa, issue.producto_id)
        if payload.categoria_id is not None:
            product.categoria = resolve_category_for_capa(capa, payload.categoria_id)
        if payload.descripcion is not None:
            product.descripcion = payload.descripcion
        if isinstance(payload.master_attributes, dict) and payload.master_attributes:
            product.master_attributes = {
                **(product.master_attributes or {}),
                **payload.master_attributes,
            }
        save_or_400(product)
        if payload.resolver:
            issue.estatus = "RESUELTA"
            issue.resuelto_por = actor
            issue.fecha_resolucion = timezone.now()
        else:
            issue.estatus = "EN_REVISION"
            issue.resuelto_por = None
            issue.fecha_resolucion = None
        issue.metadata = {
            **(issue.metadata or {}),
            "ultima_correccion": {
                "nota": payload.nota,
                "categoria_id": payload.categoria_id,
                "descripcion_actualizada": payload.descripcion is not None,
                "master_attributes": list((payload.master_attributes or {}).keys()),
                "actor_id": actor.id if actor else None,
                "fecha": timezone.now().isoformat(),
            },
        }
        save_or_400(issue)

    product.refresh_from_db()
    issue.refresh_from_db()
    return {
        "updated": True,
        "producto": serialize_product(product),
        "incidencia": serialize_quality_issue(issue),
    }


















@router.get("/inventario/")
def inventario_actual(
    request,
    search: str = "",
    bodega_id: int | None = None,
    producto_id: int | None = None,
    page: int = 1,
    page_size: int = 20,
    movement_limit: int = 20,
):
    require_pos_plan_module(request, CATALOGO_INVENTARIO_MODULE)
    capa = get_current_capa(request)
    return build_inventory_response(
        capa,
        search=search,
        bodega_id=bodega_id,
        producto_id=producto_id,
        page=page,
        page_size=page_size,
        movement_limit=movement_limit,
    )


@router.post("/inventario/bodegas/")
def crear_bodega_actual(request, payload: WarehouseUpsertIn):
    subscription = require_pos_plan_module(request, CATALOGO_INVENTARIO_MODULE)
    capa = get_current_capa(request)
    require_catalogo_capacity(
        capa=capa,
        subscription=subscription,
        resource="bodegas",
        label="bodegas",
        used=catalogo_bodegas_for_capa(capa).count(),
        actor=current_authenticated_actor(request),
    )
    warehouse = Bodega(
        capa_negocio=capa,
        codigo=(payload.codigo or "").strip(),
        nombre=(payload.nombre or "").strip(),
        tipo=(payload.tipo or "INTERNA").strip().upper(),
        direccion=payload.direccion or "",
        activo=payload.activo,
        metadata=payload.metadata if isinstance(payload.metadata, dict) else {},
    )
    save_or_400(warehouse)
    return {"created": True, "bodega": serialize_warehouse(warehouse)}


@router.patch("/inventario/bodegas/{warehouse_id}/")
def actualizar_bodega_actual(request, warehouse_id: int, payload: WarehouseUpsertIn):
    require_pos_plan_module(request, CATALOGO_INVENTARIO_MODULE)
    capa = get_current_capa(request)
    warehouse = resolve_warehouse_for_capa(capa, warehouse_id)
    warehouse.codigo = (payload.codigo or "").strip()
    warehouse.nombre = (payload.nombre or "").strip()
    warehouse.tipo = (payload.tipo or "INTERNA").strip().upper()
    warehouse.direccion = payload.direccion or ""
    warehouse.activo = payload.activo
    warehouse.metadata = payload.metadata if isinstance(payload.metadata, dict) else {}
    save_or_400(warehouse)
    return {"updated": True, "bodega": serialize_warehouse(warehouse)}


@router.post("/inventario/ajustes/")
def ajustar_inventario_actual(request, payload: InventoryAdjustmentIn):
    require_pos_plan_module(request, CATALOGO_INVENTARIO_MODULE)
    capa = get_current_capa(request)
    product = resolve_product_for_capa(capa, payload.producto_id)
    warehouse = resolve_warehouse_for_capa(capa, payload.bodega_id)
    actor = current_authenticated_actor(request)

    try:
        with transaction.atomic():
            item, _created = InventarioItem.objects.select_for_update().get_or_create(
                capa_negocio=capa,
                producto=product,
                bodega=warehouse,
                defaults={
                    "stock": Decimal("0"),
                    "reservado": Decimal("0"),
                    "metadata": {},
                },
            )
            stock_anterior = item.stock or Decimal("0")
            stock_nuevo = stock_anterior + payload.cantidad
            item.stock = stock_nuevo
            if payload.costo_promedio is not None:
                item.costo_promedio = payload.costo_promedio
            if payload.ultimo_costo is not None:
                item.ultimo_costo = payload.ultimo_costo
            if isinstance(payload.metadata, dict) and payload.metadata:
                item.metadata = {**(item.metadata or {}), **payload.metadata}
            item.save()
            movement = InventarioMovimiento.objects.create(
                capa_negocio=capa,
                item=item,
                producto=product,
                bodega=warehouse,
                tipo=(payload.tipo or "AJUSTE").strip().upper(),
                cantidad=payload.cantidad,
                stock_anterior=stock_anterior,
                stock_nuevo=stock_nuevo,
                referencia_tipo=(payload.referencia_tipo or "manual").strip()[:80],
                referencia_id=(payload.referencia_id or "").strip()[:120],
                nota=payload.nota or "",
                actor=actor,
                metadata=payload.metadata if isinstance(payload.metadata, dict) else {},
            )
            item.refresh_from_db()
            movement.refresh_from_db()
    except (ValidationError, IntegrityError) as exc:
        raise HttpError(400, validation_error_detail(exc)) from exc

    return {
        "updated": True,
        "item": serialize_inventory_item(item),
        "movimiento": serialize_inventory_movement(movement),
    }


@router.get("/ordenes/")
def ordenes_actual(
    request,
    search: str = "",
    estatus: str | None = None,
    canal: str = "",
    page: int = 1,
    page_size: int = 20,
):
    require_pos_plan_module(request, CATALOGO_ORDERS_MODULE)
    capa = get_current_capa(request)
    return build_orders_response(
        capa,
        search=search,
        estatus=estatus,
        canal=canal,
        page=page,
        page_size=page_size,
    )


@router.post("/ordenes/")
def crear_orden_actual(request, payload: OrderCreateIn):
    require_pos_plan_module(request, CATALOGO_ORDERS_MODULE)
    capa = get_current_capa(request)
    actor = current_authenticated_actor(request)
    order, created = create_order_for_capa(capa=capa, payload=payload, actor=actor)
    if created:
        record_order_event(
            order=order,
            action="created",
            actor=actor,
            metadata={
                "channel": "authenticated_api",
                "reservar": payload.reservar,
            },
        )
    return {
        "created": created,
        "orden": serialize_order(resolve_order_for_capa(capa, order.id)),
    }


@router.get("/ordenes/{order_id}/")
def orden_actual(request, order_id: int):
    require_pos_plan_module(request, CATALOGO_ORDERS_MODULE)
    capa = get_current_capa(request)
    order = (
        catalogo_ordenes_for_capa(capa)
        .filter(id=order_id)
        .select_related("creado_por")
        .prefetch_related(
            Prefetch(
                "items",
                queryset=OrdenItem.objects.select_related(
                    "producto",
                    "bodega",
                    "inventario_item",
                ),
            )
        )
        .first()
    )
    if order is None:
        raise HttpError(404, "Orden no encontrada.")
    return {"orden": serialize_order(order)}


@router.post("/ordenes/{order_id}/reservar/")
def reservar_orden_actual(request, order_id: int, payload: OrderTransitionIn):
    require_pos_plan_module(request, CATALOGO_ORDERS_MODULE)
    capa = get_current_capa(request)
    actor = current_authenticated_actor(request)
    order = reserve_order_inventory(
        resolve_order_for_capa(capa, order_id),
        actor=actor,
        nota=payload.nota,
        metadata=payload.metadata if isinstance(payload.metadata, dict) else {},
    )
    record_order_event(
        order=order,
        action="reserved",
        actor=actor,
        metadata={"channel": "authenticated_api"},
    )
    return {"updated": True, "orden": serialize_order(resolve_order_for_capa(capa, order.id))}

@router.post("/ordenes/{order_id}/confirmar/")
def confirmar_orden_actual(request, order_id: int, payload: OrderTransitionIn):
    require_pos_plan_module(request, CATALOGO_ORDERS_MODULE)
    capa = get_current_capa(request)
    actor = current_authenticated_actor(request)
    order = confirm_order_inventory(
        resolve_order_for_capa(capa, order_id),
        actor=actor,
        payment_status=payload.payment_status,
        nota=payload.nota,
        metadata=payload.metadata if isinstance(payload.metadata, dict) else {},
    )
    record_order_event(
        order=order,
        action="confirmed",
        actor=actor,
        metadata={"channel": "authenticated_api"},
    )
    return {"updated": True, "orden": serialize_order(resolve_order_for_capa(capa, order.id))}


@router.post("/ordenes/{order_id}/cancelar/")
def cancelar_orden_actual(request, order_id: int, payload: OrderTransitionIn):
    require_pos_plan_module(request, CATALOGO_ORDERS_MODULE)
    capa = get_current_capa(request)
    actor = current_authenticated_actor(request)
    order = cancel_order_inventory(
        resolve_order_for_capa(capa, order_id),
        actor=actor,
        payment_status=payload.payment_status,
        nota=payload.nota,
        restock=payload.restock,
        metadata=payload.metadata if isinstance(payload.metadata, dict) else {},
    )
    record_order_event(
        order=order,
        action="cancelled",
        actor=actor,
        metadata={
            "channel": "authenticated_api",
            "restock": payload.restock,
        },
    )
    return {"updated": True, "orden": serialize_order(resolve_order_for_capa(capa, order.id))}


@router.get("/admin/clientes/{capa_id}/catalogo/")
def admin_catalogo_cliente(
    request,
    capa_id: int,
    search: str = "",
    categoria_id: int | None = None,
    activo: bool | None = None,
    page: int = 1,
    page_size: int = 20,
):
    require_platform_admin_access(request)
    capa = get_object_or_404(CapaNegocio, id=capa_id)
    return build_catalog_response(
        capa,
        search=search,
        categoria_id=categoria_id,
        activo=activo,
        page=page,
        page_size=page_size,
    )


@router.get("/admin/clientes/{capa_id}/inventario/")
def admin_inventario_cliente(
    request,
    capa_id: int,
    search: str = "",
    bodega_id: int | None = None,
    producto_id: int | None = None,
    page: int = 1,
    page_size: int = 20,
    movement_limit: int = 20,
):
    require_platform_admin_access(request)
    capa = get_object_or_404(CapaNegocio, id=capa_id)
    return build_inventory_response(
        capa,
        search=search,
        bodega_id=bodega_id,
        producto_id=producto_id,
        page=page,
        page_size=page_size,
        movement_limit=movement_limit,
    )


@router.get("/admin/clientes/{capa_id}/ordenes/")
def admin_ordenes_cliente(
    request,
    capa_id: int,
    search: str = "",
    estatus: str | None = None,
    canal: str = "",
    page: int = 1,
    page_size: int = 20,
):
    require_platform_admin_access(request)
    capa = get_object_or_404(CapaNegocio, id=capa_id)
    return build_orders_response(
        capa,
        search=search,
        estatus=estatus,
        canal=canal,
        page=page,
        page_size=page_size,
    )


@router.post("/admin/clientes/{capa_id}/ordenes/{order_id}/reservar/")
def admin_reservar_orden_cliente(
    request,
    capa_id: int,
    order_id: int,
    payload: OrderTransitionIn,
):
    require_platform_admin_access(request)
    capa = get_object_or_404(CapaNegocio, id=capa_id)
    actor = current_authenticated_actor(request)
    order = reserve_order_inventory(
        resolve_order_for_capa(capa, order_id),
        actor=actor,
        nota=payload.nota,
        metadata=payload.metadata if isinstance(payload.metadata, dict) else {},
    )
    record_order_event(
        order=order,
        action="admin_reserved",
        actor=actor,
        metadata={"channel": "platform_admin"},
    )
    return {"updated": True, "orden": serialize_order(resolve_order_for_capa(capa, order.id))}


@router.post("/admin/clientes/{capa_id}/ordenes/{order_id}/confirmar/")
def admin_confirmar_orden_cliente(
    request,
    capa_id: int,
    order_id: int,
    payload: OrderTransitionIn,
):
    require_platform_admin_access(request)
    capa = get_object_or_404(CapaNegocio, id=capa_id)
    actor = current_authenticated_actor(request)
    order = confirm_order_inventory(
        resolve_order_for_capa(capa, order_id),
        actor=actor,
        payment_status=payload.payment_status,
        nota=payload.nota,
        metadata=payload.metadata if isinstance(payload.metadata, dict) else {},
    )
    record_order_event(
        order=order,
        action="admin_confirmed",
        actor=actor,
        metadata={"channel": "platform_admin"},
    )
    return {"updated": True, "orden": serialize_order(resolve_order_for_capa(capa, order.id))}


@router.post("/admin/clientes/{capa_id}/ordenes/{order_id}/cancelar/")
def admin_cancelar_orden_cliente(
    request,
    capa_id: int,
    order_id: int,
    payload: OrderTransitionIn,
):
    require_platform_admin_access(request)
    capa = get_object_or_404(CapaNegocio, id=capa_id)
    actor = current_authenticated_actor(request)
    order = cancel_order_inventory(
        resolve_order_for_capa(capa, order_id),
        actor=actor,
        payment_status=payload.payment_status,
        nota=payload.nota,
        restock=payload.restock,
        metadata=payload.metadata if isinstance(payload.metadata, dict) else {},
    )
    record_order_event(
        order=order,
        action="admin_cancelled",
        actor=actor,
        metadata={
            "channel": "platform_admin",
            "restock": payload.restock,
        },
    )
    return {"updated": True, "orden": serialize_order(resolve_order_for_capa(capa, order.id))}
