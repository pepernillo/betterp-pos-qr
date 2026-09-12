"""API del punto de venta QR.

Cubre la operacion de caja (cajas, mesas, turnos y corte), la cuenta del cliente
(tickets, comandas, cobro por QR y pagos) y el menu publico por codigo QR que el
comensal abre desde su telefono.
"""

import json
from datetime import timedelta
from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.db.models import Count, Q, Sum
from django.shortcuts import get_object_or_404
from django.utils import timezone
from ninja import Router, Schema
from ninja.errors import HttpError

from accounts.audit import audit
from accounts.security import (
    get_auth_context,
    get_current_capa,
    get_current_subscription,
    require_admin_access,
    require_plan_feature,
)
from catalogo.api import (
    CATALOGO_ORDERS_MODULE,
    require_pos_plan_module,
)
from catalogo.models import Bodega, InventarioItem, Orden, OrdenItem, Producto
from empresas.models import CapaNegocio, EntidadNegocio

from .models import (
    CobroQR,
    Mesa,
    PagoTicket,
    PuntoVenta,
    Ticket,
    TicketItem,
    Turno,
    quantize_money,
    quantize_quantity,
)

router = Router(tags=["pos"])

POS_MODULE = "pos_caja"
QR_MODULE = "cobro_qr"
RESTAURANT_MODULE = "restaurante"
MENU_QR_FEATURE = "menu_qr_publico"
TABLE_ORDER_FEATURE = "pedido_desde_mesa"
TIPS_FEATURE = "propinas"
SPLIT_FEATURE = "cuenta_dividida"
DISCOUNT_FEATURE = "descuentos"

QR_DEFAULT_TTL_MINUTES = 30
MAX_PAGE_SIZE = 100


# --------------------------------------------------------------------------
# utilidades
# --------------------------------------------------------------------------


def to_decimal(value, field: str) -> Decimal:
    try:
        return Decimal(str(value if value is not None else 0))
    except (InvalidOperation, ValueError, TypeError) as exc:
        raise HttpError(400, f"El valor de {field} no es un numero valido.") from exc


def page_size(value: int | None) -> int:
    if not value or value <= 0:
        return 50
    return min(int(value), MAX_PAGE_SIZE)


def registrar_evento(request, capa, accion: str, recurso_tipo: str, recurso_id=None, **metadata):
    audit(
        actor=actor_for(request),
        capa=capa,
        accion=accion,
        recurso_tipo=recurso_tipo,
        recurso_id=recurso_id,
        metadata=metadata,
    )


def actor_for(request):
    context = get_auth_context(request, require=False)
    return getattr(context, "user", None) if context else None


def plan_has_feature(request, feature: str) -> bool:
    try:
        require_plan_feature(request, feature)
        return True
    except HttpError:
        return False


def puntos_venta_for_capa(capa: CapaNegocio):
    return PuntoVenta.objects.filter(capa_negocio=capa)


def tickets_for_capa(capa: CapaNegocio):
    return Ticket.objects.filter(capa_negocio=capa)


def resolve_punto_venta(capa: CapaNegocio, punto_venta_id: int) -> PuntoVenta:
    return get_object_or_404(puntos_venta_for_capa(capa), id=punto_venta_id)


def resolve_ticket(capa: CapaNegocio, ticket_id: int) -> Ticket:
    return get_object_or_404(
        tickets_for_capa(capa).select_related("punto_venta", "mesa", "turno"),
        id=ticket_id,
    )


def turno_abierto(punto: PuntoVenta):
    return punto.turnos.filter(estado="ABIERTO").first()


def next_folio(punto: PuntoVenta) -> str:
    """Folio consecutivo por caja, con el codigo de la caja como prefijo."""
    ultimo = (
        Ticket.objects.filter(punto_venta=punto)
        .order_by("-id")
        .values_list("folio", flat=True)
        .first()
    )
    consecutivo = 1
    if ultimo and "-" in ultimo:
        try:
            consecutivo = int(ultimo.rsplit("-", 1)[1]) + 1
        except ValueError:
            consecutivo = Ticket.objects.filter(punto_venta=punto).count() + 1
    return f"{punto.codigo}-{consecutivo:06d}"


def build_qr_payload(cobro: CobroQR, punto: PuntoVenta) -> str:
    """Contenido del QR. El front lo pinta como codigo; aqui solo se define."""
    return json.dumps(
        {
            "tipo": "betterp.pos.cobro",
            "referencia": cobro.referencia,
            "monto": str(cobro.monto),
            "moneda": punto.moneda,
            "caja": punto.codigo,
            "metodo": cobro.metodo,
        },
        ensure_ascii=False,
        separators=(",", ":"),
    )


# --------------------------------------------------------------------------
# serializadores
# --------------------------------------------------------------------------


def serialize_mesa(mesa: Mesa) -> dict:
    return {
        "id": mesa.id,
        "punto_venta_id": mesa.punto_venta_id,
        "nombre": mesa.nombre,
        "zona": mesa.zona,
        "capacidad": mesa.capacidad,
        "estado": mesa.estado,
        "qr_token": mesa.qr_token,
        "activo": mesa.activo,
    }


def serialize_punto_venta(punto: PuntoVenta, *, incluir_mesas: bool = False) -> dict:
    turno = turno_abierto(punto)
    data = {
        "id": punto.id,
        "codigo": punto.codigo,
        "nombre": punto.nombre,
        "entidad_id": punto.entidad_id,
        "bodega_id": punto.bodega_id,
        "bodega_nombre": punto.bodega.nombre if punto.bodega_id else None,
        "tipo_servicio": punto.tipo_servicio,
        "es_restaurante": punto.es_restaurante,
        "acepta_cobro_qr": punto.acepta_cobro_qr,
        "menu_qr_activo": punto.menu_qr_activo,
        "menu_token": punto.menu_token,
        "moneda": punto.moneda,
        "porcentaje_propina_sugerido": str(punto.porcentaje_propina_sugerido),
        "activo": punto.activo,
        "turno_abierto_id": turno.id if turno else None,
    }
    if incluir_mesas:
        data["mesas"] = [serialize_mesa(mesa) for mesa in punto.mesas.filter(activo=True)]
    return data


def serialize_turno(turno) -> dict:
    return {
        "id": turno.id,
        "punto_venta_id": turno.punto_venta_id,
        "estado": turno.estado,
        "fondo_inicial": str(turno.fondo_inicial),
        "efectivo_declarado": (
            str(turno.efectivo_declarado) if turno.efectivo_declarado is not None else None
        ),
        "fecha_apertura": turno.fecha_apertura,
        "fecha_cierre": turno.fecha_cierre,
        "abierto_por": getattr(turno.abierto_por, "email", None),
        "cerrado_por": getattr(turno.cerrado_por, "email", None),
        "notas": turno.notas,
        "corte": turno.corte or {},
    }


def serialize_ticket_item(item: TicketItem) -> dict:
    return {
        "id": item.id,
        "producto_id": item.producto_id,
        "descripcion": item.descripcion,
        "cantidad": str(item.cantidad),
        "precio_unitario": str(item.precio_unitario),
        "descuento": str(item.descuento),
        "importe": str(item.importe),
        "estado": item.estado,
        "notas": item.notas,
    }


def serialize_cobro_qr(cobro: CobroQR) -> dict:
    return {
        "id": cobro.id,
        "referencia": cobro.referencia,
        "monto": str(cobro.monto),
        "estado": cobro.estado,
        "metodo": cobro.metodo,
        "qr_payload": cobro.qr_payload,
        "expira_en": cobro.expira_en,
        "fecha_pago": cobro.fecha_pago,
    }


def serialize_pago(pago: PagoTicket) -> dict:
    return {
        "id": pago.id,
        "forma": pago.forma,
        "monto": str(pago.monto),
        "recibido": str(pago.recibido) if pago.recibido is not None else None,
        "cambio": str(pago.cambio),
        "referencia": pago.referencia,
        "cobro_qr_id": pago.cobro_qr_id,
        "fecha": pago.fecha_creacion,
    }


def serialize_ticket(ticket: Ticket, *, detalle: bool = True) -> dict:
    data = {
        "id": ticket.id,
        "folio": ticket.folio,
        "estado": ticket.estado,
        "origen": ticket.origen,
        "tipo_servicio": ticket.tipo_servicio,
        "comensales": ticket.comensales,
        "punto_venta_id": ticket.punto_venta_id,
        "punto_venta_codigo": ticket.punto_venta.codigo if ticket.punto_venta_id else None,
        "turno_id": ticket.turno_id,
        "mesa_id": ticket.mesa_id,
        "mesa_nombre": ticket.mesa.nombre if ticket.mesa_id else None,
        "cliente_id": ticket.cliente_id,
        "orden_id": ticket.orden_id,
        "subtotal": str(ticket.subtotal),
        "descuento": str(ticket.descuento),
        "propina": str(ticket.propina),
        "total": str(ticket.total),
        "pagado": str(ticket.pagado),
        "saldo": str(ticket.saldo),
        "notas": ticket.notas,
        "fecha_creacion": ticket.fecha_creacion,
        "fecha_cobro": ticket.fecha_cobro,
    }
    if detalle:
        data["items"] = [serialize_ticket_item(item) for item in ticket.items.all()]
        data["pagos"] = [serialize_pago(pago) for pago in ticket.pagos.all()]
        data["cobros_qr"] = [serialize_cobro_qr(c) for c in ticket.cobros_qr.all()]
    return data


# --------------------------------------------------------------------------
# esquemas de entrada
# --------------------------------------------------------------------------


class PuntoVentaIn(Schema):
    codigo: str
    nombre: str
    bodega_id: int
    entidad_id: int | None = None
    tipo_servicio: str = "MOSTRADOR"
    acepta_cobro_qr: bool = True
    menu_qr_activo: bool = False
    moneda: str = "MXN"
    porcentaje_propina_sugerido: str = "10.00"


class PuntoVentaUpdateIn(Schema):
    nombre: str | None = None
    bodega_id: int | None = None
    entidad_id: int | None = None
    tipo_servicio: str | None = None
    acepta_cobro_qr: bool | None = None
    menu_qr_activo: bool | None = None
    porcentaje_propina_sugerido: str | None = None
    activo: bool | None = None


class MesaIn(Schema):
    nombre: str
    zona: str = ""
    capacidad: int = 4


class MesaUpdateIn(Schema):
    nombre: str | None = None
    zona: str | None = None
    capacidad: int | None = None
    estado: str | None = None
    activo: bool | None = None


class TurnoAbrirIn(Schema):
    punto_venta_id: int
    fondo_inicial: str = "0"
    notas: str = ""


class TurnoCerrarIn(Schema):
    efectivo_declarado: str | None = None
    notas: str = ""


class TicketIn(Schema):
    punto_venta_id: int
    mesa_id: int | None = None
    cliente_id: int | None = None
    tipo_servicio: str = "COMER_AQUI"
    comensales: int = 1
    notas: str = ""


class TicketItemIn(Schema):
    producto_id: int
    cantidad: str = "1"
    precio_unitario: str | None = None
    descuento: str = "0"
    notas: str = ""


class TicketItemUpdateIn(Schema):
    cantidad: str | None = None
    descuento: str | None = None
    estado: str | None = None
    notas: str | None = None


class TicketAjusteIn(Schema):
    descuento: str | None = None
    propina: str | None = None
    comensales: int | None = None
    cliente_id: int | None = None
    notas: str | None = None


class CobroQRIn(Schema):
    monto: str | None = None
    metodo: str = "SPEI"
    minutos_vigencia: int = QR_DEFAULT_TTL_MINUTES


class CobroQRConfirmIn(Schema):
    referencia_externa: str = ""


class PagoIn(Schema):
    forma: str = "EFECTIVO"
    monto: str
    recibido: str | None = None
    referencia: str = ""
    cobro_qr_id: int | None = None


class MenuPedidoItemIn(Schema):
    producto_id: int
    cantidad: str = "1"
    notas: str = ""


class MenuPedidoIn(Schema):
    items: list[MenuPedidoItemIn]
    comensales: int = 1
    notas: str = ""


# --------------------------------------------------------------------------
# contexto
# --------------------------------------------------------------------------


@router.get("/contexto/")
def contexto_pos(request):
    """Lo que la caja necesita al abrir: cajas, turno vigente y capacidades."""
    capa = get_current_capa(request)
    subscription = get_current_subscription(request)
    puntos = list(
        puntos_venta_for_capa(capa)
        .select_related("bodega")
        .prefetch_related("mesas")
        .order_by("codigo")
    )
    return {
        "capa_negocio": {"id": capa.id, "nombre": capa.nombre},
        "plan": (
            {
                "clave": subscription.plan.clave,
                "nombre": subscription.plan.nombre,
                "modulos": subscription.plan.modulos_habilitados or [],
                "funciones": subscription.plan.funciones_habilitadas or [],
            }
            if subscription and subscription.plan
            else None
        ),
        "capacidades": {
            "menu_qr": plan_has_feature(request, MENU_QR_FEATURE),
            "pedido_desde_mesa": plan_has_feature(request, TABLE_ORDER_FEATURE),
            "propinas": plan_has_feature(request, TIPS_FEATURE),
            "cuenta_dividida": plan_has_feature(request, SPLIT_FEATURE),
            "descuentos": plan_has_feature(request, DISCOUNT_FEATURE),
        },
        "puntos_venta": [
            serialize_punto_venta(punto, incluir_mesas=True) for punto in puntos
        ],
    }


# --------------------------------------------------------------------------
# cajas y mesas
# --------------------------------------------------------------------------


@router.get("/puntos-venta/")
def listar_puntos_venta(request):
    capa = get_current_capa(request)
    puntos = (
        puntos_venta_for_capa(capa)
        .select_related("bodega")
        .prefetch_related("mesas")
        .order_by("codigo")
    )
    return {"items": [serialize_punto_venta(p, incluir_mesas=True) for p in puntos]}


@router.post("/puntos-venta/")
def crear_punto_venta(request, payload: PuntoVentaIn):
    require_admin_access(request)
    require_pos_plan_module(request, POS_MODULE)
    capa = get_current_capa(request)
    bodega = get_object_or_404(Bodega.objects.filter(capa_negocio=capa), id=payload.bodega_id)
    entidad = None
    if payload.entidad_id is not None:
        entidad = get_object_or_404(
            EntidadNegocio.objects.filter(capa_negocio=capa), id=payload.entidad_id
        )
    punto = PuntoVenta(
        capa_negocio=capa,
        entidad=entidad,
        bodega=bodega,
        codigo=payload.codigo,
        nombre=payload.nombre,
        tipo_servicio=(payload.tipo_servicio or "MOSTRADOR").strip().upper(),
        acepta_cobro_qr=payload.acepta_cobro_qr,
        menu_qr_activo=payload.menu_qr_activo,
        moneda=payload.moneda,
        porcentaje_propina_sugerido=to_decimal(
            payload.porcentaje_propina_sugerido, "porcentaje_propina_sugerido"
        ),
    )
    punto.save()
    registrar_evento(request, capa, "pos.punto_venta.creado", "pos.punto_venta", punto.id)
    return serialize_punto_venta(punto, incluir_mesas=True)


@router.patch("/puntos-venta/{punto_venta_id}/")
def actualizar_punto_venta(request, punto_venta_id: int, payload: PuntoVentaUpdateIn):
    require_admin_access(request)
    capa = get_current_capa(request)
    punto = resolve_punto_venta(capa, punto_venta_id)
    if payload.nombre is not None:
        punto.nombre = payload.nombre
    if payload.bodega_id is not None:
        punto.bodega = get_object_or_404(
            Bodega.objects.filter(capa_negocio=capa), id=payload.bodega_id
        )
    if payload.entidad_id is not None:
        punto.entidad = get_object_or_404(
            EntidadNegocio.objects.filter(capa_negocio=capa), id=payload.entidad_id
        )
    if payload.tipo_servicio is not None:
        punto.tipo_servicio = payload.tipo_servicio.strip().upper()
    if payload.acepta_cobro_qr is not None:
        punto.acepta_cobro_qr = payload.acepta_cobro_qr
    if payload.menu_qr_activo is not None:
        punto.menu_qr_activo = payload.menu_qr_activo
    if payload.porcentaje_propina_sugerido is not None:
        punto.porcentaje_propina_sugerido = to_decimal(
            payload.porcentaje_propina_sugerido, "porcentaje_propina_sugerido"
        )
    if payload.activo is not None:
        punto.activo = payload.activo
    punto.save()
    return serialize_punto_venta(punto, incluir_mesas=True)


@router.post("/puntos-venta/{punto_venta_id}/mesas/")
def crear_mesa(request, punto_venta_id: int, payload: MesaIn):
    require_admin_access(request)
    require_pos_plan_module(request, RESTAURANT_MODULE)
    capa = get_current_capa(request)
    punto = resolve_punto_venta(capa, punto_venta_id)
    mesa = Mesa(
        punto_venta=punto,
        nombre=payload.nombre,
        zona=payload.zona,
        capacidad=payload.capacidad,
    )
    mesa.save()
    return serialize_mesa(mesa)


@router.patch("/mesas/{mesa_id}/")
def actualizar_mesa(request, mesa_id: int, payload: MesaUpdateIn):
    capa = get_current_capa(request)
    mesa = get_object_or_404(
        Mesa.objects.filter(punto_venta__capa_negocio=capa), id=mesa_id
    )
    if payload.nombre is not None:
        mesa.nombre = payload.nombre
    if payload.zona is not None:
        mesa.zona = payload.zona
    if payload.capacidad is not None:
        mesa.capacidad = payload.capacidad
    if payload.estado is not None:
        mesa.estado = payload.estado.strip().upper()
    if payload.activo is not None:
        mesa.activo = payload.activo
    mesa.save()
    return serialize_mesa(mesa)


# --------------------------------------------------------------------------
# turnos y corte de caja
# --------------------------------------------------------------------------


def build_corte(turno) -> dict:
    """Totales del turno por forma de pago, mas el efectivo esperado en caja."""
    tickets = Ticket.objects.filter(turno=turno)
    cobrados = tickets.filter(estado="COBRADO")
    totales = cobrados.aggregate(
        venta=Sum("total"),
        propinas=Sum("propina"),
        descuentos=Sum("descuento"),
        subtotal=Sum("subtotal"),
    )
    por_forma = {
        row["forma"]: {
            "monto": str(quantize_money(row["monto"])),
            "operaciones": row["operaciones"],
        }
        for row in PagoTicket.objects.filter(ticket__turno=turno)
        .values("forma")
        .annotate(monto=Sum("monto"), operaciones=Count("id"))
    }
    efectivo = quantize_money(
        Decimal(por_forma.get("EFECTIVO", {}).get("monto", "0"))
    )
    esperado = quantize_money((turno.fondo_inicial or 0) + efectivo)
    declarado = turno.efectivo_declarado
    return {
        "tickets_cobrados": cobrados.count(),
        "tickets_abiertos": tickets.filter(estado="ABIERTO").count(),
        "tickets_cancelados": tickets.filter(estado="CANCELADO").count(),
        "subtotal": str(quantize_money(totales["subtotal"])),
        "descuentos": str(quantize_money(totales["descuentos"])),
        "propinas": str(quantize_money(totales["propinas"])),
        "venta_total": str(quantize_money(totales["venta"])),
        "por_forma_pago": por_forma,
        "fondo_inicial": str(quantize_money(turno.fondo_inicial)),
        "efectivo_esperado": str(esperado),
        "efectivo_declarado": str(quantize_money(declarado)) if declarado is not None else None,
        "diferencia": (
            str(quantize_money(Decimal(declarado) - esperado))
            if declarado is not None
            else None
        ),
    }


@router.post("/turnos/abrir/")
def abrir_turno(request, payload: TurnoAbrirIn):
    require_pos_plan_module(request, POS_MODULE)
    capa = get_current_capa(request)
    punto = resolve_punto_venta(capa, payload.punto_venta_id)
    if not punto.activo:
        raise HttpError(400, "El punto de venta esta inactivo.")
    if turno_abierto(punto):
        raise HttpError(409, "Esta caja ya tiene un turno abierto.")
    turno = Turno(
        punto_venta=punto,
        abierto_por=actor_for(request),
        fondo_inicial=to_decimal(payload.fondo_inicial, "fondo_inicial"),
        notas=payload.notas,
    )
    turno.save()
    registrar_evento(request, capa, "pos.turno.abierto", "pos.turno", turno.id, punto_venta=punto.codigo)
    return serialize_turno(turno)


@router.get("/turnos/{turno_id}/corte/")
def consultar_corte(request, turno_id: int):
    capa = get_current_capa(request)
    turno = get_object_or_404(
        Turno.objects.filter(punto_venta__capa_negocio=capa), id=turno_id
    )
    data = serialize_turno(turno)
    data["corte"] = turno.corte or build_corte(turno)
    return data


@router.post("/turnos/{turno_id}/cerrar/")
def cerrar_turno(request, turno_id: int, payload: TurnoCerrarIn):
    require_pos_plan_module(request, POS_MODULE)
    capa = get_current_capa(request)
    turno = get_object_or_404(
        Turno.objects.filter(punto_venta__capa_negocio=capa), id=turno_id
    )
    if turno.estado == "CERRADO":
        raise HttpError(409, "El turno ya esta cerrado.")
    abiertos = Ticket.objects.filter(turno=turno, estado="ABIERTO").count()
    if abiertos:
        raise HttpError(
            409,
            f"No se puede cerrar el turno: hay {abiertos} cuenta(s) abierta(s).",
        )
    if payload.efectivo_declarado is not None:
        turno.efectivo_declarado = to_decimal(payload.efectivo_declarado, "efectivo_declarado")
    turno.estado = "CERRADO"
    turno.fecha_cierre = timezone.now()
    turno.cerrado_por = actor_for(request)
    if payload.notas:
        turno.notas = payload.notas
    turno.corte = build_corte(turno)
    turno.save()
    registrar_evento(request, capa, "pos.turno.cerrado", "pos.turno", turno.id)
    return serialize_turno(turno)


# --------------------------------------------------------------------------
# cuentas (tickets) y comanda
# --------------------------------------------------------------------------


@router.get("/tickets/")
def listar_tickets(request, estado: str = "", punto_venta_id: int | None = None,
                   turno_id: int | None = None, mesa_id: int | None = None,
                   limit: int = 50, offset: int = 0):
    capa = get_current_capa(request)
    queryset = tickets_for_capa(capa).select_related("punto_venta", "mesa")
    if estado:
        queryset = queryset.filter(estado=estado.strip().upper())
    if punto_venta_id:
        queryset = queryset.filter(punto_venta_id=punto_venta_id)
    if turno_id:
        queryset = queryset.filter(turno_id=turno_id)
    if mesa_id:
        queryset = queryset.filter(mesa_id=mesa_id)
    total = queryset.count()
    size = page_size(limit)
    items = queryset[offset : offset + size]
    return {
        "total": total,
        "items": [serialize_ticket(t, detalle=False) for t in items],
    }


@router.post("/tickets/")
def crear_ticket(request, payload: TicketIn):
    require_pos_plan_module(request, POS_MODULE)
    capa = get_current_capa(request)
    punto = resolve_punto_venta(capa, payload.punto_venta_id)
    turno = turno_abierto(punto)
    if turno is None:
        raise HttpError(409, "Abre un turno de caja antes de registrar ventas.")

    mesa = None
    if payload.mesa_id is not None:
        mesa = get_object_or_404(Mesa.objects.filter(punto_venta=punto), id=payload.mesa_id)
        abierto = Ticket.objects.filter(mesa=mesa, estado="ABIERTO").first()
        if abierto:
            raise HttpError(409, f"La mesa ya tiene la cuenta {abierto.folio} abierta.")

    with transaction.atomic():
        ticket = Ticket(
            capa_negocio=capa,
            punto_venta=punto,
            turno=turno,
            mesa=mesa,
            cliente_id=payload.cliente_id,
            folio=next_folio(punto),
            tipo_servicio=(payload.tipo_servicio or "COMER_AQUI").strip().upper(),
            comensales=max(1, payload.comensales or 1),
            notas=payload.notas,
            abierto_por=actor_for(request),
        )
        ticket.save()
        if mesa:
            mesa.estado = "OCUPADA"
            mesa.save()
    registrar_evento(request, capa, "pos.ticket.abierto", "pos.ticket", ticket.id, folio=ticket.folio)
    return serialize_ticket(ticket)


@router.get("/tickets/{ticket_id}/")
def obtener_ticket(request, ticket_id: int):
    capa = get_current_capa(request)
    return serialize_ticket(resolve_ticket(capa, ticket_id))


@router.post("/tickets/{ticket_id}/items/")
def agregar_item(request, ticket_id: int, payload: TicketItemIn):
    require_pos_plan_module(request, POS_MODULE)
    capa = get_current_capa(request)
    ticket = resolve_ticket(capa, ticket_id)
    if ticket.estado != "ABIERTO":
        raise HttpError(409, "Solo se pueden agregar productos a una cuenta abierta.")
    producto = get_object_or_404(
        Producto.objects.filter(capa_negocio=capa, activo=True), id=payload.producto_id
    )
    precio = (
        to_decimal(payload.precio_unitario, "precio_unitario")
        if payload.precio_unitario is not None
        else producto.precio_base
    )
    descuento = to_decimal(payload.descuento, "descuento")
    if descuento > 0 and not plan_has_feature(request, DISCOUNT_FEATURE):
        raise HttpError(403, "Tu plan no incluye descuentos en caja.")

    with transaction.atomic():
        item = TicketItem(
            ticket=ticket,
            producto=producto,
            cantidad=to_decimal(payload.cantidad, "cantidad"),
            precio_unitario=precio,
            descuento=descuento,
            notas=payload.notas,
        )
        item.save()
        ticket.recalcular_totales()
    return serialize_ticket(ticket)


@router.patch("/tickets/{ticket_id}/items/{item_id}/")
def actualizar_item(request, ticket_id: int, item_id: int, payload: TicketItemUpdateIn):
    capa = get_current_capa(request)
    ticket = resolve_ticket(capa, ticket_id)
    item = get_object_or_404(ticket.items, id=item_id)
    if ticket.estado != "ABIERTO" and payload.estado is None:
        raise HttpError(409, "La cuenta ya no admite cambios de importe.")
    if payload.cantidad is not None:
        item.cantidad = to_decimal(payload.cantidad, "cantidad")
    if payload.descuento is not None:
        if to_decimal(payload.descuento, "descuento") > 0 and not plan_has_feature(
            request, DISCOUNT_FEATURE
        ):
            raise HttpError(403, "Tu plan no incluye descuentos en caja.")
        item.descuento = to_decimal(payload.descuento, "descuento")
    if payload.estado is not None:
        item.estado = payload.estado.strip().upper()
    if payload.notas is not None:
        item.notas = payload.notas
    with transaction.atomic():
        item.save()
        ticket.recalcular_totales()
    return serialize_ticket(ticket)


@router.delete("/tickets/{ticket_id}/items/{item_id}/")
def eliminar_item(request, ticket_id: int, item_id: int):
    capa = get_current_capa(request)
    ticket = resolve_ticket(capa, ticket_id)
    if ticket.estado != "ABIERTO":
        raise HttpError(409, "Solo se pueden quitar productos de una cuenta abierta.")
    item = get_object_or_404(ticket.items, id=item_id)
    with transaction.atomic():
        item.delete()
        ticket.recalcular_totales()
    return serialize_ticket(ticket)


@router.patch("/tickets/{ticket_id}/")
def ajustar_ticket(request, ticket_id: int, payload: TicketAjusteIn):
    capa = get_current_capa(request)
    ticket = resolve_ticket(capa, ticket_id)
    if ticket.estado != "ABIERTO":
        raise HttpError(409, "La cuenta ya fue cobrada o cancelada.")
    if payload.descuento is not None:
        if to_decimal(payload.descuento, "descuento") > 0 and not plan_has_feature(
            request, DISCOUNT_FEATURE
        ):
            raise HttpError(403, "Tu plan no incluye descuentos en caja.")
        ticket.descuento = to_decimal(payload.descuento, "descuento")
    if payload.propina is not None:
        if to_decimal(payload.propina, "propina") > 0 and not plan_has_feature(
            request, TIPS_FEATURE
        ):
            raise HttpError(403, "Tu plan no incluye captura de propinas.")
        ticket.propina = to_decimal(payload.propina, "propina")
    if payload.comensales is not None:
        ticket.comensales = max(1, payload.comensales)
    if payload.cliente_id is not None:
        ticket.cliente_id = payload.cliente_id
    if payload.notas is not None:
        ticket.notas = payload.notas
    ticket.recalcular_totales()
    return serialize_ticket(ticket)


@router.post("/tickets/{ticket_id}/cancelar/")
def cancelar_ticket(request, ticket_id: int):
    require_admin_access(request)
    capa = get_current_capa(request)
    ticket = resolve_ticket(capa, ticket_id)
    if ticket.estado == "COBRADO":
        raise HttpError(409, "Una cuenta cobrada no se cancela; genera una devolucion.")
    with transaction.atomic():
        ticket.estado = "CANCELADO"
        ticket.save()
        ticket.cobros_qr.filter(estado="PENDIENTE").update(estado="CANCELADO")
        if ticket.mesa_id:
            ticket.mesa.estado = "LIBRE"
            ticket.mesa.save()
    registrar_evento(request, capa, "pos.ticket.cancelado", "pos.ticket", ticket.id, folio=ticket.folio)
    return serialize_ticket(ticket)


@router.get("/comandas/")
def listar_comandas(request, punto_venta_id: int | None = None):
    """Vista de cocina: lineas pendientes y en preparacion, mas antiguas primero."""
    require_pos_plan_module(request, RESTAURANT_MODULE)
    capa = get_current_capa(request)
    queryset = TicketItem.objects.filter(
        ticket__capa_negocio=capa,
        ticket__estado="ABIERTO",
        estado__in=["PENDIENTE", "EN_PREPARACION"],
    ).select_related("ticket", "ticket__mesa", "producto")
    if punto_venta_id:
        queryset = queryset.filter(ticket__punto_venta_id=punto_venta_id)
    return {
        "items": [
            {
                **serialize_ticket_item(item),
                "ticket_id": item.ticket_id,
                "folio": item.ticket.folio,
                "mesa": item.ticket.mesa.nombre if item.ticket.mesa_id else None,
                "solicitado_en": item.fecha_creacion,
            }
            for item in queryset.order_by("fecha_creacion", "id")
        ]
    }


# --------------------------------------------------------------------------
# cobro por QR
# --------------------------------------------------------------------------


@router.post("/tickets/{ticket_id}/cobro-qr/")
def generar_cobro_qr(request, ticket_id: int, payload: CobroQRIn):
    require_pos_plan_module(request, QR_MODULE)
    capa = get_current_capa(request)
    ticket = resolve_ticket(capa, ticket_id)
    if ticket.estado != "ABIERTO":
        raise HttpError(409, "Solo se genera cobro QR sobre una cuenta abierta.")
    if not ticket.punto_venta.acepta_cobro_qr:
        raise HttpError(400, "Esta caja no tiene habilitado el cobro por QR.")

    monto = (
        to_decimal(payload.monto, "monto") if payload.monto is not None else ticket.saldo
    )
    if monto <= 0:
        raise HttpError(400, "El monto del cobro debe ser mayor a cero.")
    if monto > ticket.saldo:
        raise HttpError(400, "El monto excede el saldo de la cuenta.")

    minutos = max(1, min(int(payload.minutos_vigencia or QR_DEFAULT_TTL_MINUTES), 1440))
    with transaction.atomic():
        cobro = CobroQR(
            ticket=ticket,
            monto=quantize_money(monto),
            metodo=(payload.metodo or "SPEI").strip().upper(),
            expira_en=timezone.now() + timedelta(minutes=minutos),
        )
        cobro.save()
        cobro.qr_payload = build_qr_payload(cobro, ticket.punto_venta)
        cobro.save()
    registrar_evento(request, capa, "pos.cobro_qr.generado", "pos.cobro_qr", cobro.id, referencia=cobro.referencia)
    return serialize_cobro_qr(cobro)


@router.post("/cobros-qr/{referencia}/confirmar/")
def confirmar_cobro_qr(request, referencia: str, payload: CobroQRConfirmIn):
    """Confirma el pago de un QR y lo aplica a la cuenta."""
    require_pos_plan_module(request, QR_MODULE)
    capa = get_current_capa(request)
    cobro = get_object_or_404(
        CobroQR.objects.select_related("ticket", "ticket__punto_venta").filter(
            ticket__capa_negocio=capa
        ),
        referencia=referencia,
    )
    if cobro.estado == "PAGADO":
        return serialize_cobro_qr(cobro)
    if cobro.estado != "PENDIENTE":
        raise HttpError(409, f"El cobro esta {cobro.estado.lower()}.")
    if cobro.expira_en and cobro.expira_en < timezone.now():
        cobro.estado = "EXPIRADO"
        cobro.save()
        raise HttpError(409, "El cobro QR expiro; genera uno nuevo.")

    with transaction.atomic():
        cobro.estado = "PAGADO"
        cobro.fecha_pago = timezone.now()
        if payload.referencia_externa:
            cobro.detalle = {**(cobro.detalle or {}), "referencia_externa": payload.referencia_externa}
        cobro.save()
        aplicar_pago(
            request,
            cobro.ticket,
            forma="QR",
            monto=cobro.monto,
            referencia=payload.referencia_externa or cobro.referencia,
            cobro_qr=cobro,
        )
    registrar_evento(request, capa, "pos.cobro_qr.pagado", "pos.cobro_qr", cobro.id, referencia=cobro.referencia)
    return serialize_cobro_qr(cobro)


@router.get("/publico/cobro/{referencia}/", auth=None)
def consultar_cobro_publico(request, referencia: str):
    """Lo que ve quien escanea el QR: monto, negocio y estado del cobro."""
    cobro = get_object_or_404(
        CobroQR.objects.select_related("ticket", "ticket__punto_venta"),
        referencia=referencia,
    )
    if cobro.estado == "PENDIENTE" and cobro.expira_en and cobro.expira_en < timezone.now():
        cobro.estado = "EXPIRADO"
        cobro.save()
    punto = cobro.ticket.punto_venta
    return {
        "referencia": cobro.referencia,
        "estado": cobro.estado,
        "monto": str(cobro.monto),
        "moneda": punto.moneda,
        "metodo": cobro.metodo,
        "negocio": punto.nombre,
        "folio": cobro.ticket.folio,
        "expira_en": cobro.expira_en,
    }


# --------------------------------------------------------------------------
# pagos y cierre de la cuenta
# --------------------------------------------------------------------------


def crear_orden_de_ticket(ticket: Ticket, *, actor=None) -> Orden:
    """Refleja la venta como orden de catalogo para mover inventario."""
    orden = Orden(
        capa_negocio=ticket.capa_negocio,
        canal="POS_QR",
        external_order_id=ticket.folio,
        estatus="NUEVA",
        payment_status="PAGADA",
        cliente_nombre=ticket.cliente.razon_social if ticket.cliente_id else "",
        subtotal=ticket.subtotal,
        descuento=ticket.descuento,
        total=ticket.total,
        creado_por=actor,
    )
    orden.save()
    bodega = ticket.punto_venta.bodega
    for item in ticket.items.exclude(estado="CANCELADO").select_related("producto"):
        OrdenItem(
            orden=orden,
            capa_negocio=ticket.capa_negocio,
            producto=item.producto,
            bodega=bodega,
            titulo=item.descripcion,
            cantidad=item.cantidad,
            precio_unitario=item.precio_unitario,
            subtotal=item.importe,
        ).save()
    return orden


def cerrar_ticket_cobrado(ticket: Ticket, *, actor=None) -> Ticket:
    """Al saldar la cuenta: descuenta inventario, libera la mesa y cierra."""
    from catalogo.api import confirm_order_inventory

    orden = crear_orden_de_ticket(ticket, actor=actor)
    try:
        confirm_order_inventory(
            orden,
            actor=actor,
            payment_status="PAGADA",
            nota=f"Venta POS {ticket.folio}",
            metadata={"ticket_id": ticket.id, "punto_venta": ticket.punto_venta.codigo},
        )
    except HttpError:
        # Sin stock suficiente la venta no se bloquea: la cuenta ya se cobro.
        # La orden queda en NUEVA para que inventario la resuelva despues.
        pass
    ticket.orden = orden
    ticket.estado = "COBRADO"
    ticket.fecha_cobro = timezone.now()
    ticket.save()
    if ticket.mesa_id:
        ticket.mesa.estado = "LIBRE"
        ticket.mesa.save()
    return ticket


def aplicar_pago(request, ticket: Ticket, *, forma: str, monto: Decimal,
                 recibido: Decimal | None = None, referencia: str = "",
                 cobro_qr: CobroQR | None = None) -> PagoTicket:
    if ticket.estado != "ABIERTO":
        raise HttpError(409, "La cuenta ya fue cobrada o cancelada.")
    monto = quantize_money(monto)
    if monto <= 0:
        raise HttpError(400, "El monto del pago debe ser mayor a cero.")
    if monto > ticket.saldo:
        raise HttpError(400, "El pago excede el saldo de la cuenta.")
    if monto < ticket.saldo and not plan_has_feature(request, SPLIT_FEATURE):
        raise HttpError(403, "Tu plan no permite dividir la cuenta en varios pagos.")

    actor = actor_for(request)
    pago = PagoTicket(
        ticket=ticket,
        cobro_qr=cobro_qr,
        forma=forma.strip().upper(),
        monto=monto,
        recibido=recibido,
        referencia=referencia,
        registrado_por=actor,
    )
    pago.save()
    ticket.pagado = quantize_money((ticket.pagado or 0) + monto)
    ticket.save()
    if ticket.saldo <= 0:
        cerrar_ticket_cobrado(ticket, actor=actor)
    return pago


@router.post("/tickets/{ticket_id}/pagos/")
def registrar_pago(request, ticket_id: int, payload: PagoIn):
    require_pos_plan_module(request, POS_MODULE)
    capa = get_current_capa(request)
    ticket = resolve_ticket(capa, ticket_id)
    cobro = None
    if payload.cobro_qr_id is not None:
        cobro = get_object_or_404(ticket.cobros_qr, id=payload.cobro_qr_id)
    with transaction.atomic():
        aplicar_pago(
            request,
            ticket,
            forma=payload.forma,
            monto=to_decimal(payload.monto, "monto"),
            recibido=(
                to_decimal(payload.recibido, "recibido")
                if payload.recibido is not None
                else None
            ),
            referencia=payload.referencia,
            cobro_qr=cobro,
        )
    ticket.refresh_from_db()
    registrar_evento(request, capa, "pos.ticket.pago", "pos.ticket", ticket.id, folio=ticket.folio)
    return serialize_ticket(ticket)


# --------------------------------------------------------------------------
# menu publico por codigo QR
# --------------------------------------------------------------------------


def resolve_menu_punto(token: str) -> tuple[PuntoVenta, Mesa | None]:
    """El token puede ser el de la caja (menu general) o el de una mesa."""
    mesa = Mesa.objects.select_related("punto_venta").filter(qr_token=token, activo=True).first()
    if mesa:
        return mesa.punto_venta, mesa
    punto = PuntoVenta.objects.filter(menu_token=token, activo=True).first()
    if punto is None:
        raise HttpError(404, "El codigo QR no corresponde a un menu activo.")
    return punto, None


@router.get("/publico/menu/{token}/", auth=None)
def menu_publico(request, token: str):
    """Menu que abre el comensal al escanear el QR de su mesa."""
    punto, mesa = resolve_menu_punto(token)
    if not punto.menu_qr_activo:
        raise HttpError(404, "El menu por QR no esta publicado para este negocio.")

    productos = (
        Producto.objects.filter(capa_negocio=punto.capa_negocio, activo=True)
        .select_related("categoria")
        .prefetch_related("imagenes")
        .order_by("categoria__nombre", "nombre")
    )
    categorias: dict[str, list] = {}
    for producto in productos:
        nombre_categoria = producto.categoria.nombre if producto.categoria_id else "Sin categoria"
        imagen = next((i for i in producto.imagenes.all() if i.is_main), None)
        categorias.setdefault(nombre_categoria, []).append(
            {
                "id": producto.id,
                "nombre": producto.nombre,
                "descripcion": producto.descripcion,
                "precio": str(producto.precio_base),
                "imagen_url": imagen.url if imagen else None,
            }
        )
    return {
        "negocio": punto.nombre,
        "moneda": punto.moneda,
        "mesa": serialize_mesa(mesa) if mesa else None,
        "permite_pedido": bool(mesa) and punto.es_restaurante,
        "propina_sugerida": str(punto.porcentaje_propina_sugerido),
        "categorias": [
            {"nombre": nombre, "productos": items}
            for nombre, items in categorias.items()
        ],
    }


@router.post("/publico/menu/{token}/pedido/", auth=None)
def pedido_desde_menu(request, token: str, payload: MenuPedidoIn):
    """El comensal levanta su pedido; entra como comanda a la cuenta de la mesa."""
    punto, mesa = resolve_menu_punto(token)
    if mesa is None:
        raise HttpError(400, "Este QR no permite levantar pedidos; escanea el de tu mesa.")
    if not punto.menu_qr_activo:
        raise HttpError(404, "El menu por QR no esta publicado para este negocio.")
    if not payload.items:
        raise HttpError(400, "El pedido debe incluir al menos un producto.")

    turno = turno_abierto(punto)
    if turno is None:
        raise HttpError(409, "El negocio no tiene una caja abierta en este momento.")

    with transaction.atomic():
        ticket = Ticket.objects.filter(mesa=mesa, estado="ABIERTO").first()
        if ticket is None:
            ticket = Ticket(
                capa_negocio=punto.capa_negocio,
                punto_venta=punto,
                turno=turno,
                mesa=mesa,
                folio=next_folio(punto),
                origen="MENU_QR",
                tipo_servicio="COMER_AQUI",
                comensales=max(1, payload.comensales or 1),
                notas=payload.notas,
            )
            ticket.save()
            mesa.estado = "OCUPADA"
            mesa.save()

        for linea in payload.items:
            producto = get_object_or_404(
                Producto.objects.filter(capa_negocio=punto.capa_negocio, activo=True),
                id=linea.producto_id,
            )
            TicketItem(
                ticket=ticket,
                producto=producto,
                cantidad=to_decimal(linea.cantidad, "cantidad"),
                precio_unitario=producto.precio_base,
                notas=linea.notas,
            ).save()
        ticket.recalcular_totales()

    return {
        "folio": ticket.folio,
        "mesa": mesa.nombre,
        "total": str(ticket.total),
        "mensaje": "Tu pedido se envio a cocina.",
        "items": [serialize_ticket_item(item) for item in ticket.items.all()],
    }


# --------------------------------------------------------------------------
# reportes
# --------------------------------------------------------------------------


@router.get("/reportes/venta/")
def reporte_venta(request, desde: str = "", hasta: str = "", punto_venta_id: int | None = None):
    """Venta del periodo por forma de pago y por producto."""
    capa = get_current_capa(request)
    queryset = tickets_for_capa(capa).filter(estado="COBRADO")
    if punto_venta_id:
        queryset = queryset.filter(punto_venta_id=punto_venta_id)
    if desde:
        queryset = queryset.filter(fecha_cobro__date__gte=desde)
    if hasta:
        queryset = queryset.filter(fecha_cobro__date__lte=hasta)

    totales = queryset.aggregate(
        venta=Sum("total"),
        propinas=Sum("propina"),
        descuentos=Sum("descuento"),
        tickets=Count("id"),
    )
    tickets_count = totales["tickets"] or 0
    venta = quantize_money(totales["venta"])
    por_forma = [
        {
            "forma": row["forma"],
            "monto": str(quantize_money(row["monto"])),
            "operaciones": row["operaciones"],
        }
        for row in PagoTicket.objects.filter(ticket__in=queryset)
        .values("forma")
        .annotate(monto=Sum("monto"), operaciones=Count("id"))
        .order_by("-monto")
    ]
    por_producto = [
        {
            "producto_id": row["producto_id"],
            "producto": row["producto__nombre"],
            "cantidad": str(quantize_quantity(row["cantidad"])),
            "importe": str(quantize_money(row["importe"])),
        }
        for row in TicketItem.objects.filter(ticket__in=queryset)
        .exclude(estado="CANCELADO")
        .values("producto_id", "producto__nombre")
        .annotate(cantidad=Sum("cantidad"), importe=Sum("importe"))
        .order_by("-importe")[:50]
    ]
    return {
        "tickets": tickets_count,
        "venta_total": str(venta),
        "propinas": str(quantize_money(totales["propinas"])),
        "descuentos": str(quantize_money(totales["descuentos"])),
        "ticket_promedio": str(
            quantize_money(venta / tickets_count) if tickets_count else Decimal("0")
        ),
        "por_forma_pago": por_forma,
        "por_producto": por_producto,
    }
