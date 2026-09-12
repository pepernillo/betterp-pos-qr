import base64
import csv
import io
import os
import re
import unicodedata
from calendar import monthrange
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import List, Optional

from django.db import transaction
from django.db.models import (
    Count,
    DecimalField,
    ExpressionWrapper,
    F,
    Q,
    Sum,
    Value,
)
from django.db.models.functions import Coalesce, Greatest
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.text import slugify
from ninja import File, Router, Schema
from ninja.errors import HttpError
from ninja.files import UploadedFile
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.worksheet.datavalidation import DataValidation

from accounts.audit import audit
from accounts.security import (
    get_accessible_capas_queryset,
    get_allowed_entity_ids,
    get_current_capa,
    require_admin_access,
    require_backup_access,
    require_plan_feature,
    require_plan_module,
    require_write_access,
)
from billing.plan_limits import (
    assert_plan_capacity,
    get_current_limit,
    is_plan_limit_exempt,
)
from crm.models import Cliente
from pos.models import PuntoVenta, Ticket
from finanzas.models import (
    CuentaPorCobrar,
    CuentaPorPagar,
    ProgramacionCuentaPorPagar,
)

from .backup_export import build_capa_backup_workbook
from .models import CapaNegocio, EntidadNegocio, PERIODICIDAD_CHOICES, ReglaMarcoNegocio, ReglaNegocio

router = Router()

BATCH_IMPORT_FALLBACK_ROW_LIMIT = 1000
BATCH_IMPORT_ABSOLUTE_ROW_LIMIT = 2000
BATCH_EMAIL_ALLOWED_SUFFIXES = (
    ".com",
    ".net",
    ".org",
    ".mx",
    ".com.mx",
    ".edu",
    ".edu.mx",
    ".gob.mx",
    ".io",
    ".co",
)


def require_batch_import_access(request) -> None:
    require_plan_feature(request, "batch_import")


def require_entities_access(request) -> None:
    require_plan_module(request, "entidades")


def require_entities_write_access(request) -> None:
    require_entities_access(request)
    require_write_access(request)


def require_cfdi_access_if_enabled(request, payload: "CapaIn") -> None:
    if payload.facturacion_activa:
        require_plan_module(request, "facturacion_cfdi")


BANK_CODE_CATALOG = {
    "002": {"label": "Banamex", "aliases": {"citibanamex", "banco nacional de mexico"}},
    "006": {"label": "Bancomext", "aliases": {"banco nacional de comercio exterior"}},
    "009": {"label": "Banobras", "aliases": {"banco nacional de obras"}},
    "012": {"label": "BBVA Mexico", "aliases": {"bbva", "bancomer"}},
    "014": {"label": "Santander", "aliases": {"banco santander"}},
    "019": {"label": "Banjercito", "aliases": {"banco nacional del ejercito"}},
    "021": {"label": "HSBC", "aliases": {"hsbc mexico"}},
    "030": {"label": "Banco del Bajio", "aliases": {"bajio", "banbajio"}},
    "036": {"label": "Inbursa", "aliases": {"banco inbursa"}},
    "042": {"label": "Mifel", "aliases": {"banca mifel"}},
    "044": {"label": "Scotiabank", "aliases": {"scotiabank inverlat"}},
    "058": {"label": "Banregio", "aliases": {"banco regional"}},
    "059": {"label": "Invex", "aliases": {"banco invex"}},
    "060": {"label": "Bansi", "aliases": {"banco bansi"}},
    "062": {"label": "Afirme", "aliases": {"banca afirme"}},
    "072": {"label": "Banorte", "aliases": {"ixe", "grupo financiero banorte"}},
    "103": {"label": "American Express", "aliases": {"amex"}},
    "106": {"label": "Bankaool", "aliases": {"agrofinanzas"}},
    "108": {"label": "MUFG Bank", "aliases": {"tokyo", "bank of tokyo"}},
    "110": {"label": "JP Morgan", "aliases": {"jpmorgan"}},
    "112": {"label": "Monex", "aliases": {"banco monex"}},
    "113": {"label": "Ve por Mas", "aliases": {"bx+", "banco ve por mas"}},
    "126": {"label": "Credit Suisse", "aliases": set()},
    "127": {"label": "Banco Azteca", "aliases": {"azteca"}},
    "128": {"label": "Autofin", "aliases": {"banco autofin"}},
    "129": {"label": "Barclays", "aliases": set()},
    "130": {"label": "Compartamos Banco", "aliases": {"compartamos"}},
    "132": {"label": "Multiva", "aliases": {"banco multiva"}},
    "133": {"label": "Actinver", "aliases": {"banca actinver"}},
    "136": {"label": "Intercam Banco", "aliases": {"intercam"}},
    "137": {"label": "BanCoppel", "aliases": {"bancoppel"}},
    "138": {"label": "ABC Capital", "aliases": set()},
    "140": {"label": "Consubanco", "aliases": set()},
    "143": {"label": "CIBanco", "aliases": {"ci banco"}},
    "145": {"label": "Banco Base", "aliases": {"base"}},
    "147": {"label": "Bankaool", "aliases": set()},
    "148": {"label": "Pagatodo", "aliases": set()},
    "150": {"label": "Inmobiliario Mexicano", "aliases": {"inmobiliario"}},
    "151": {"label": "Donde Banco", "aliases": {"donde"}},
    "152": {"label": "Bancrea", "aliases": set()},
    "154": {"label": "Banco Covalto", "aliases": {"covalto", "accendo"}},
    "155": {"label": "ICBC", "aliases": set()},
    "156": {"label": "Sabadell", "aliases": {"banco sabadell"}},
    "157": {"label": "Shinhan", "aliases": {"shinhan bank"}},
    "158": {"label": "Mizuho Bank", "aliases": {"mizuho"}},
    "160": {"label": "Banco S3", "aliases": {"s3"}},
    "166": {"label": "Banco del Bienestar", "aliases": {"bienestar", "bansefi"}},
    "168": {"label": "Hipotecaria Federal", "aliases": {"shf"}},
    "600": {"label": "MonexCB", "aliases": {"monex casa de bolsa"}},
    "601": {"label": "GBM", "aliases": {"gbm+"}},
    "602": {"label": "Masari", "aliases": set()},
    "605": {"label": "Value", "aliases": set()},
    "606": {"label": "Estructuradores", "aliases": set()},
    "607": {"label": "Tiber", "aliases": set()},
    "608": {"label": "Vector", "aliases": set()},
    "610": {"label": "B&B", "aliases": set()},
    "614": {"label": "Intercam Casa de Bolsa", "aliases": set()},
    "615": {"label": "Merrill Lynch", "aliases": set()},
    "616": {"label": "Finamex", "aliases": set()},
    "617": {"label": "Valmex", "aliases": set()},
    "618": {"label": "Unica", "aliases": set()},
    "619": {"label": "Mapfre", "aliases": set()},
    "620": {"label": "Profuturo", "aliases": set()},
    "621": {"label": "CB Actinver", "aliases": set()},
    "622": {"label": "Oactin", "aliases": set()},
    "623": {"label": "Skandia", "aliases": set()},
    "626": {"label": "CBDEUTSCHE", "aliases": {"deutsche"}},
    "627": {"label": "ZURICH", "aliases": set()},
    "628": {"label": "ZURICHVI", "aliases": set()},
    "629": {"label": "SU CASITA", "aliases": set()},
    "630": {"label": "CB INTERCAM", "aliases": set()},
    "631": {"label": "CI BOLSA", "aliases": set()},
    "632": {"label": "BULLTICK CB", "aliases": set()},
    "633": {"label": "STERLING", "aliases": set()},
    "634": {"label": "FINCOMUN", "aliases": set()},
    "636": {"label": "HDI Seguros", "aliases": {"hdi"}},
    "637": {"label": "ORDER", "aliases": set()},
    "638": {"label": "AKALA", "aliases": set()},
    "640": {"label": "CB JPMORGAN", "aliases": set()},
    "642": {"label": "REFORMA", "aliases": set()},
    "646": {"label": "STP", "aliases": {"sistema de transferencias y pagos"}},
    "647": {"label": "Telecomm", "aliases": set()},
    "648": {"label": "Evercore", "aliases": set()},
    "649": {"label": "Skandia", "aliases": set()},
    "651": {"label": "SEGMTY", "aliases": set()},
    "652": {"label": "ASEA", "aliases": set()},
    "653": {"label": "KUSPIT", "aliases": set()},
    "655": {"label": "SOFIEXPRESS", "aliases": set()},
    "656": {"label": "UNAGRA", "aliases": set()},
    "659": {"label": "OPCIONES EMPRESARIALES", "aliases": set()},
    "670": {"label": "LIBERTAD", "aliases": set()},
    "901": {"label": "CLS", "aliases": set()},
    "902": {"label": "INDEVAL", "aliases": set()},
}


def normalize_catalog_text(value: str) -> str:
    return (
        unicodedata.normalize("NFD", value or "")
        .encode("ascii", "ignore")
        .decode("ascii")
        .lower()
        .replace("+", " plus ")
        .strip()
    )


def clabe_control_digit(clabe_prefix: str) -> int:
    weights = (3, 7, 1)
    total = 0
    for index, character in enumerate(clabe_prefix):
        total += (int(character) * weights[index % 3]) % 10
    return (10 - (total % 10)) % 10


def validate_clabe_or_raise(clabe: str, bank_name: str = "") -> None:
    if not clabe:
        return
    if len(clabe) != 18:
        raise HttpError(400, "La CLABE debe tener exactamente 18 digitos.")
    if clabe_control_digit(clabe[:17]) != int(clabe[-1]):
        raise HttpError(400, "La CLABE no supera la validacion bancaria.")

    bank_code = clabe[:3]
    bank_info = BANK_CODE_CATALOG.get(bank_code)
    if not bank_info or not bank_name:
        return

    normalized_bank = normalize_catalog_text(bank_name)
    if normalized_bank in {"otro", "otro banco", "banco no listado", "otro banco no listado"}:
        return

    possible_names = {bank_info["label"], *bank_info["aliases"]}
    normalized_possible_names = {normalize_catalog_text(name) for name in possible_names}
    if not any(
        candidate and (candidate in normalized_bank or normalized_bank in candidate)
        for candidate in normalized_possible_names
    ):
        raise HttpError(
            400,
            f"La CLABE pertenece a {bank_info['label']}; revisa el banco seleccionado.",
        )


def is_valid_clabe_value(clabe: str | None) -> bool:
    normalized = re.sub(r"\D", "", clabe or "")
    return len(normalized) == 18 and clabe_control_digit(normalized[:17]) == int(
        normalized[-1]
    )

HEADER_ALIASES = {
    "ciudad": {
        "ciudad",
        "ubicacion",
        "plaza",
        "localidad",
        "estado",
    },
    "nombre_comercial": {
        "unidad negocio",
        "unidad de negocio",
        "entidad",
        "nombre entidad",
        "entidad negocio",
        "nombre comercial",
    },
    "tipo_fecha_corte": {
        "tipo corte",
        "tipo de corte",
        "tipo fecha corte",
        "corte",
    },
    "codigo_espacio": {
        "habitacion",
        "habitacion o depto",
        "numero habitacion",
        "numero de habitacion",
        "codigo espacio",
        "espacio",
        "numero espacio",
        "depto",
        "departamento",
        "unidad",
    },
    "precio_lista": {
        "precio lista",
        "precio de lista",
        "renta",
        "renta base",
        "precio",
        "costo",
    },
    "deposito_base": {
        "deposito base",
        "deposito",
        "deposito sugerido",
    },
    "tipo_espacio": {
        "tipo espacio",
        "tipo de espacio",
        "categoria espacio",
        "categoria",
    },
    "estatus": {
        "estatus",
        "estado espacio",
        "disponibilidad",
        "disponiblidad",
    },
    "observaciones": {
        "observaciones",
        "comentarios",
        "notas",
        "nota",
    },
    "cliente_nombre": {
        "cliente",
        "cliente nombre",
        "nombre cliente",
        "cliente: nombre",
    },
    "cliente_whatsapp": {
        "whats app",
        "whatsapp",
        "wathsapp",
        "telefono whatsapp",
        "telefono",
        "celular",
        "numero celular",
        "numero celular ligado a whatsapp",
        "numero celular ligado a wathsapp",
    },
    "cliente_correo": {
        "correo electronico",
        "correo",
        "email",
        "correo cliente",
        "correo electronico para recibir notificaciones",
        "correo electronico para recibiri notificaciones",
    },
    "cliente_identificador": {
        "contrato",
        "identificador",
        "folio contrato",
        "folio",
    },
    "cliente_dia_corte": {
        "fecha",
        "fecha corte",
        "fecha de corte",
        "dia corte",
        "dia de corte",
        "vencimiento",
        "fecha de corte dia de vencimiento del pago",
    },
}

SUGGESTED_ONBOARDING_RULES = [
    {
        "nombre": "Interes moratorio mensual",
        "tipo_calculo": "PORCENTAJE_RECARGO",
        "valor": Decimal("5.00"),
        "periodicidad": "MENSUAL",
        "aplica_a_todos": True,
        "dias_condicion": 3,
        "descripcion": "Recargo porcentual para adeudos que ya pasaron la ventana de gracia.",
    },
    {
        "nombre": "Penalizacion administrativa por atraso",
        "tipo_calculo": "CARGO_FIJO",
        "valor": Decimal("0.00"),
        "periodicidad": "UNICO",
        "aplica_a_todos": False,
        "dias_condicion": 10,
        "descripcion": "Plantilla editable para cargos o bloqueo operativo despues de atraso severo.",
    },
    {
        "nombre": "Cobro extraordinario o amenity",
        "tipo_calculo": "CARGO_FIJO",
        "valor": Decimal("0.00"),
        "periodicidad": "UNICO",
        "aplica_a_todos": False,
        "dias_condicion": None,
        "descripcion": "Base para lavanderia, estacionamiento, limpieza, amenidades u otros extras.",
    },
    {
        "nombre": "Deposito de garantia",
        "tipo_calculo": "CARGO_FIJO",
        "valor": Decimal("0.00"),
        "periodicidad": "UNICO",
        "aplica_a_todos": False,
        "dias_condicion": None,
        "descripcion": "Referencia para estandarizar depositos al migrar o dar de alta operaciones.",
    },
]


def header_matches(logical_name: str, normalized: str) -> bool:
    aliases = HEADER_ALIASES[logical_name]
    if normalized in aliases:
        return True

    if logical_name == "cliente_nombre":
        return "cliente" in normalized and "nombre" in normalized

    if logical_name == "cliente_whatsapp":
        return any(token in normalized for token in ("whatsapp", "wathsapp", "whats app"))

    if logical_name == "cliente_correo":
        return (
            "correo" in normalized and "electronico" in normalized
        ) or "email" in normalized

    if logical_name == "cliente_identificador":
        return "contrato" in normalized or "identificador" in normalized

    if logical_name == "cliente_dia_corte":
        return (
            "fecha de corte" in normalized
            or "dia de corte" in normalized
            or ("fecha" in normalized and "vencimiento" in normalized)
            or ("corte" in normalized and "vencimiento" in normalized)
        )

    return False


class EntidadOut(Schema):
    id: int
    nombre_comercial: str
    ciudad: Optional[str] = None
    rfc: Optional[str] = None
    regimen_fiscal: Optional[str] = None
    logo_url: Optional[str] = None
    capa_negocio_id: Optional[int] = None
    capa_negocio_nombre: Optional[str] = None
    capa_negocio_tipo: Optional[str] = None
    capa_nombre_administrador: Optional[str] = None
    capa_razon_social: Optional[str] = None
    capa_rfc: Optional[str] = None
    capa_regimen_fiscal: Optional[str] = None
    capa_correo_contacto: Optional[str] = None
    capa_telefono_contacto: Optional[str] = None
    capa_logo_url: Optional[str] = None
    capa_plazo_meses_default: Optional[int] = None
    capa_periodicidad_cobro_default: Optional[str] = None
    capa_dia_vencimiento_default: Optional[int] = None
    capa_dias_gracia_default: Optional[int] = None
    capa_auto_renueva_default: Optional[bool] = None
    capa_aplicacion_pagos: Optional[str] = None
    tipo_fecha_corte: str
    activo: bool
    fecha_pausa: Optional[date] = None
    clientes_count: int = 0
    espacios_total: int = 0
    espacios_ocupados: int = 0
    espacios_disponibles: int = 0
    espacios_reservados: int = 0
    espacios_mantenimiento: int = 0
    facturacion_activa: float = 0
    cxp_total: float = 0
    cxp_pagado: float = 0
    cxp_pendiente: float = 0
    cxp_vencido: float = 0
    cxp_por_conciliar: float = 0
    cxp_abierta: float = 0
    cxp_registros_abiertos: int = 0


class CapaOut(Schema):
    id: int
    nombre: str
    tipo_capa: str
    nombre_administrador: Optional[str] = None
    es_persona_moral: Optional[bool] = None
    razon_social: Optional[str] = None
    rfc: Optional[str] = None
    regimen_fiscal: Optional[str] = None
    correo_contacto: Optional[str] = None
    telefono_contacto: Optional[str] = None
    logo_url: Optional[str] = None
    pais_fiscal: Optional[str] = None
    codigo_postal_fiscal: Optional[str] = None
    estado_fiscal: Optional[str] = None
    municipio_fiscal: Optional[str] = None
    colonia_fiscal: Optional[str] = None
    calle_fiscal: Optional[str] = None
    numero_exterior_fiscal: Optional[str] = None
    numero_interior_fiscal: Optional[str] = None
    facturacion_activa: bool
    facturacion_modo: str
    facturacion_pac_proveedor: str
    facturacion_serie_ingresos: str
    facturacion_lugar_expedicion: Optional[str] = None
    facturacion_producto_servicio: Optional[str] = None
    facturacion_unidad: str
    facturacion_uso_cfdi_default: str
    facturacion_metodo_pago_default: str
    facturacion_forma_pago_default: str
    portal_clientes_activo: bool
    portal_clientes_url_base: Optional[str] = None
    seguridad_doble_factor_activa: bool
    clabe_transferencias: Optional[str] = None
    banco_transferencias: Optional[str] = None
    beneficiario_transferencias: Optional[str] = None
    referencia_transferencia_prefijo: str
    plazo_meses_default: int
    periodicidad_cobro_default: str
    fecha_vencimiento_modo: str
    dia_vencimiento_default: Optional[int] = None
    dias_gracia_default: int
    auto_renueva_default: bool
    aplicacion_pagos: str
    activo: bool
    entidades_count: int = 0


class CapaIn(Schema):
    nombre: str
    tipo_capa: str = "OPERADORA"
    nombre_administrador: str = ""
    es_persona_moral: Optional[bool] = None
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
    facturacion_serie_ingresos: str = "A"
    facturacion_lugar_expedicion: str = ""
    facturacion_producto_servicio: str = ""
    facturacion_unidad: str = "E48"
    facturacion_uso_cfdi_default: str = "G03"
    facturacion_metodo_pago_default: str = "PUE"
    facturacion_forma_pago_default: str = "03"
    portal_clientes_activo: bool = False
    portal_clientes_url_base: str = ""
    seguridad_doble_factor_activa: bool = False
    clabe_transferencias: str = ""
    banco_transferencias: str = ""
    beneficiario_transferencias: str = ""
    referencia_transferencia_prefijo: str = "BETT"
    plazo_meses_default: int = 12
    periodicidad_cobro_default: str = "MENSUAL"
    fecha_vencimiento_modo: Optional[str] = None
    dia_vencimiento_default: Optional[int] = None
    dias_gracia_default: int = 0
    auto_renueva_default: bool = False
    aplicacion_pagos: str = "ADEUDO_MAS_ANTIGUO"
    activo: bool = True


class EntidadIn(Schema):
    nombre_comercial: str
    ciudad: str = ""
    rfc: str = ""
    regimen_fiscal: str = ""
    logo_url: str = ""
    capa_negocio_id: Optional[int] = None
    desvincular_capa_negocio: bool = False
    capa_negocio_nombre: str = ""
    capa_negocio_tipo: str = "OPERADORA"
    capa_nombre_administrador: str = ""
    capa_razon_social: str = ""
    capa_rfc: str = ""
    capa_regimen_fiscal: str = ""
    capa_correo_contacto: str = ""
    capa_telefono_contacto: str = ""
    capa_logo_url: str = ""
    capa_plazo_meses_default: int = 12
    capa_periodicidad_cobro_default: str = "MENSUAL"
    capa_dia_vencimiento_default: Optional[int] = None
    capa_dias_gracia_default: int = 0
    capa_auto_renueva_default: bool = False
    capa_aplicacion_pagos: str = "ADEUDO_MAS_ANTIGUO"
    tipo_fecha_corte: str = "INDIVIDUAL"
    activo: bool = True
    fecha_pausa: Optional[date] = None


class ReglaOut(Schema):
    id: int
    nombre: str
    tipo_calculo: str
    valor: Decimal
    periodicidad: str
    aplica_a_todos: bool
    dias_condicion: Optional[int] = None
    activo: bool
    origen: str = "LOCAL"
    regla_marco_id: Optional[int] = None
    capa_negocio_id: Optional[int] = None
    capa_negocio_nombre: Optional[str] = None
    editable_en_entidad: bool = True


class ReglaIn(Schema):
    nombre: str
    tipo_calculo: str
    valor: Decimal
    periodicidad: str
    aplica_a_todos: bool = False
    dias_condicion: Optional[int] = None
    activo: bool = True


class ReglaPersonalizadaIn(ReglaIn):
    regla_marco_id: int


class EntidadResumenChartItemOut(Schema):
    label: str
    value: float
    color: str


class EntidadResumenDetalleOut(Schema):
    espacio_id: int
    espacio_codigo: str
    espacio_estatus: str
    tipo_espacio: Optional[str] = None
    cliente_id: int
    cliente_nombre: str
    cliente_telefono: Optional[str] = None
    cliente_correo: Optional[str] = None
    fecha_inicio: date
    renta_pactada: float
    deposito_pactado: float
    cuenta_por_cobrar_id: Optional[int] = None
    concepto: Optional[str] = None
    fecha_vencimiento: Optional[date] = None
    monto_facturado: float
    monto_pagado: float
    saldo_pendiente: float
    categoria_cobro: str
    estatus_adeudo: Optional[str] = None


class EntidadResumenOut(Schema):
    entidad_id: int
    nombre_comercial: str
    ciudad: Optional[str] = None
    total_espacios: int
    ocupados: int
    disponibles: int
    reservados: int
    mantenimiento: int
    clientes_activos: int
    ocupacion_porcentaje: float
    facturacion_activa: float
    cargos_registrados: float
    pagado: float
    por_conciliar: float
    pendiente: float
    vencido: float
    sin_cxc: float
    cxp_total: float
    cxp_pagado: float
    cxp_pendiente: float
    cxp_vencido: float
    cxp_por_conciliar: float
    cxp_abierta: float
    cxp_registros_abiertos: int
    chart_data: List[EntidadResumenChartItemOut]
    detalle: List[EntidadResumenDetalleOut]


def normalize_text(value: object) -> str:
    if value is None:
        return ""

    if isinstance(value, float) and value.is_integer():
        return str(int(value))

    if isinstance(value, Decimal) and value == value.to_integral():
        return str(int(value))

    return str(value).strip()


def normalize_header(value: object) -> str:
    normalized = normalize_text(value).lower()
    normalized = unicodedata.normalize("NFKD", normalized)
    normalized = "".join(char for char in normalized if not unicodedata.combining(char))
    normalized = re.sub(r"[^\w\s]", " ", normalized)
    normalized = normalized.replace("_", " ").replace("-", " ").replace("/", " ")
    normalized = " ".join(normalized.split())
    return normalized


def parse_decimal(value: object) -> Optional[Decimal]:
    text = normalize_text(value)
    if not text:
        return None

    cleaned = (
        text.replace("$", "")
        .replace(",", "")
        .replace("MXN", "")
        .replace("mxn", "")
        .strip()
    )
    if not cleaned:
        return None

    try:
        return Decimal(cleaned)
    except InvalidOperation as exc:
        raise ValueError(f"No se pudo interpretar el monto '{text}'.") from exc


def validate_import_money(
    value: Optional[Decimal],
    label: str,
    *,
    required: bool = False,
    min_value: Decimal = Decimal("0"),
    max_value: Decimal = Decimal("10000000"),
) -> None:
    if value is None:
        if required:
            raise ValueError(f"{label} es obligatorio.")
        return
    if value < min_value:
        if min_value == Decimal("0"):
            raise ValueError(f"{label} no puede ser negativo.")
        raise ValueError(f"{label} debe ser mayor a {min_value}.")
    if value > max_value:
        raise ValueError(f"{label} no puede superar {max_value}.")
    if value.as_tuple().exponent < -2:
        raise ValueError(f"{label} solo acepta hasta 2 decimales.")


def parse_tipo_corte(value: object) -> Optional[str]:
    normalized = normalize_header(value)
    if not normalized:
        return None
    if normalized.startswith("general"):
        return "GENERAL"
    if normalized.startswith("individual"):
        return "INDIVIDUAL"
    raise ValueError(
        "El tipo de corte debe ser GENERAL o INDIVIDUAL."
    )


def parse_estatus(value: object) -> Optional[str]:
    normalized = normalize_header(value)
    if not normalized:
        return None

    mapping = {
        "disponible": "DISPONIBLE",
        "libre": "DISPONIBLE",
        "ocupado": "OCUPADO",
        "ocupada": "OCUPADO",
        "rentado": "OCUPADO",
        "reservado": "RESERVADO",
        "reservada": "RESERVADO",
        "mantenimiento": "MANTENIMIENTO",
    }
    if normalized in mapping:
        return mapping[normalized]

    raise ValueError(
        "El estatus debe ser Disponible, Ocupado, Reservado o Mantenimiento."
    )


def parse_day_of_month(value: object) -> Optional[int]:
    if value in (None, ""):
        return None

    if isinstance(value, datetime):
        day = value.day
    elif isinstance(value, date):
        day = value.day
    else:
        text = normalize_text(value)
        if not text:
            return None
        if not re.fullmatch(r"\d+(\.0+)?", text):
            raise ValueError(f"No se pudo interpretar la fecha de corte '{text}'.")
        day = int(Decimal(text))

    if day < 1 or day > 31:
        raise ValueError("La fecha de corte debe estar entre 1 y 31.")

    return day


def normalize_email(value: object) -> str:
    return normalize_text(value).lower()


def validate_email_or_raise(email: str) -> None:
    if not email:
        return
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]{2,}", email):
        raise ValueError(f"El correo '{email}' no tiene formato valido.")
    if not email.endswith(BATCH_EMAIL_ALLOWED_SUFFIXES):
        suffixes = ", ".join(BATCH_EMAIL_ALLOWED_SUFFIXES[:5])
        raise ValueError(
            f"El correo debe terminar en un dominio valido, por ejemplo {suffixes}."
        )


def normalize_phone(value: object) -> str:
    text = normalize_text(value)
    if not text:
        return ""

    if re.search(r"[A-Za-z]", text):
        raise ValueError("WhatsApp o telefono solo acepta numeros y el signo + inicial.")
    if re.search(r"[^\d\s()+-]", text):
        raise ValueError("WhatsApp o telefono solo acepta numeros y el signo + inicial.")
    if "+" in text[1:]:
        raise ValueError("El signo + solo puede ir al inicio del telefono.")

    if text.startswith("+"):
        digits = "".join(char for char in text if char.isdigit())
        normalized = f"+{digits}" if digits else ""
    else:
        normalized = "".join(char for char in text if char.isdigit())

    digit_count = len(re.sub(r"\D", "", normalized))
    if digit_count < 10 or digit_count > 15:
        raise ValueError("WhatsApp o telefono debe tener de 10 a 15 digitos.")

    return normalized


def normalize_match_key(value: Optional[str]) -> str:
    normalized = normalize_text(value or "").lower()
    normalized = unicodedata.normalize("NFKD", normalized)
    normalized = "".join(char for char in normalized if not unicodedata.combining(char))
    return " ".join(normalized.split())




def decimal_to_float(value: Decimal | None) -> float:
    return float(value or Decimal("0"))


def choice_label(choices: list[tuple[str, str]], value: str) -> str:
    return dict(choices).get(value, value)


def serialize_onboarding_regla_marco(rule: ReglaMarcoNegocio) -> dict:
    return {
        "id": rule.id,
        "nombre": rule.nombre,
        "tipo_calculo": rule.tipo_calculo,
        "tipo_calculo_label": choice_label(
            ReglaMarcoNegocio.TIPO_CALCULO_CHOICES,
            rule.tipo_calculo,
        ),
        "valor": decimal_to_float(rule.valor),
        "periodicidad": rule.periodicidad,
        "periodicidad_label": choice_label(PERIODICIDAD_CHOICES, rule.periodicidad),
        "aplica_a_todos": rule.aplica_a_todos,
        "dias_condicion": rule.dias_condicion,
        "activo": rule.activo,
    }


def clamp_money(value: Decimal | None) -> Decimal:
    if value is None:
        return Decimal("0")
    return max(value, Decimal("0"))


def has_value(value: object) -> bool:
    return bool(str(value or "").strip())


def percent(part: int, total: int) -> int:
    if total <= 0:
        return 0
    return max(0, min(100, round((part / total) * 100)))


def onboarding_step_status(progress: int) -> str:
    if progress >= 100:
        return "COMPLETO"
    if progress > 0:
        return "EN_PROCESO"
    return "PENDIENTE"


def build_onboarding_step(
    step_id: str,
    title: str,
    description: str,
    why_it_matters: str,
    progress: int,
    action_label: str,
    action_href: str,
    blockers: list[str],
    metrics: list[dict],
) -> dict:
    return {
        "id": step_id,
        "titulo": title,
        "descripcion": description,
        "por_que_importa": why_it_matters,
        "progreso": progress,
        "estado": onboarding_step_status(progress),
        "accion_label": action_label,
        "accion_href": action_href,
        "bloqueos": blockers,
        "metricas": metrics,
    }


ONBOARDING_PROFILES = {
    "HOTEL": {
        "titulo": "Arranque hotelero",
        "descripcion": "Prioriza ocupacion, espacios, cobros recurrentes y portal para huespedes o residentes.",
        "prioridades": [
            "Carga habitaciones o espacios con estatus real.",
            "Migra ocupacion vigente antes de generar cartera.",
            "Activa portal y datos de transferencia para reducir soporte.",
        ],
        "modulos_clave": ["renta_espacios", "cxc", "portal_cliente", "cxp"],
    },
    "ADMINISTRADORA": {
        "titulo": "Arranque administradora",
        "descripcion": "Enfoca la puesta en marcha por unidad administrada, cobranza y compromisos por pagar.",
        "prioridades": [
            "Carga unidades administradas y sus reglas heredables.",
            "Importa clientes, ocupacion y cortes por unidad.",
            "Prepara CxP recurrente para compromisos operativos.",
        ],
        "modulos_clave": ["entidades", "clientes", "cxc", "cxp"],
    },
    "EMPRESA": {
        "titulo": "Arranque empresa",
        "descripcion": "Ordena clientes, facturacion, cuentas por cobrar y pagos operativos sin depender de espacios.",
        "prioridades": [
            "Completa datos fiscales y cuenta bancaria.",
            "Carga clientes con contacto y condiciones de pago.",
            "Usa CxC y CxP como centro operativo inicial.",
        ],
        "modulos_clave": ["clientes", "cxc", "cxp", "facturacion"],
    },
    "GRUPO": {
        "titulo": "Arranque multiunidad",
        "descripcion": "Estandariza reglas por grupo y luego ajusta excepciones por unidad de negocio.",
        "prioridades": [
            "Define reglas marco antes de importar unidades.",
            "Carga cada unidad con sus espacios y responsables.",
            "Revisa dashboard consolidado despues de migrar cartera.",
        ],
        "modulos_clave": ["entidades", "renta_espacios", "dashboard", "cxc"],
    },
    "OPERADORA": {
        "titulo": "Arranque operadora",
        "descripcion": "Configura la base operativa completa: unidades, espacios, clientes, cartera y pagos.",
        "prioridades": [
            "Define datos y reglas generales de la capa.",
            "Migra operacion con carga batch para evitar captura manual.",
            "Activa portal, cobranza y reportes una vez validada la cartera.",
        ],
        "modulos_clave": ["entidades", "renta_espacios", "clientes", "cxc"],
    },
}


def build_onboarding_profile(capa: CapaNegocio) -> dict:
    profile = ONBOARDING_PROFILES.get(capa.tipo_capa, ONBOARDING_PROFILES["OPERADORA"])
    return {
        "tipo_capa": capa.tipo_capa,
        **profile,
    }




def serialize_capa(capa: CapaNegocio, entidades_count: int = 0) -> dict:
    return {
        "id": capa.id,
        "nombre": capa.nombre,
        "tipo_capa": capa.tipo_capa,
        "nombre_administrador": capa.nombre_administrador,
        "es_persona_moral": capa.es_persona_moral,
        "razon_social": capa.razon_social,
        "rfc": capa.rfc,
        "regimen_fiscal": capa.regimen_fiscal,
        "correo_contacto": capa.correo_contacto,
        "telefono_contacto": capa.telefono_contacto,
        "logo_url": capa.logo_url,
        "pais_fiscal": capa.pais_fiscal,
        "codigo_postal_fiscal": capa.codigo_postal_fiscal,
        "estado_fiscal": capa.estado_fiscal,
        "municipio_fiscal": capa.municipio_fiscal,
        "colonia_fiscal": capa.colonia_fiscal,
        "calle_fiscal": capa.calle_fiscal,
        "numero_exterior_fiscal": capa.numero_exterior_fiscal,
        "numero_interior_fiscal": capa.numero_interior_fiscal,
        "facturacion_activa": capa.facturacion_activa,
        "facturacion_modo": capa.facturacion_modo,
        "facturacion_pac_proveedor": capa.facturacion_pac_proveedor,
        "facturacion_serie_ingresos": capa.facturacion_serie_ingresos,
        "facturacion_lugar_expedicion": capa.facturacion_lugar_expedicion,
        "facturacion_producto_servicio": capa.facturacion_producto_servicio,
        "facturacion_unidad": capa.facturacion_unidad,
        "facturacion_uso_cfdi_default": capa.facturacion_uso_cfdi_default,
        "facturacion_metodo_pago_default": capa.facturacion_metodo_pago_default,
        "facturacion_forma_pago_default": capa.facturacion_forma_pago_default,
        "portal_clientes_activo": capa.portal_clientes_activo,
        "portal_clientes_url_base": capa.portal_clientes_url_base,
        "seguridad_doble_factor_activa": capa.seguridad_doble_factor_activa,
        "clabe_transferencias": capa.clabe_transferencias,
        "banco_transferencias": capa.banco_transferencias,
        "beneficiario_transferencias": capa.beneficiario_transferencias,
        "referencia_transferencia_prefijo": capa.referencia_transferencia_prefijo,
        "plazo_meses_default": capa.plazo_meses_default,
        "periodicidad_cobro_default": capa.periodicidad_cobro_default,
        "fecha_vencimiento_modo": capa.fecha_vencimiento_modo,
        "dia_vencimiento_default": capa.dia_vencimiento_default,
        "dias_gracia_default": capa.dias_gracia_default,
        "auto_renueva_default": capa.auto_renueva_default,
        "aplicacion_pagos": capa.aplicacion_pagos,
        "activo": capa.activo,
        "entidades_count": entidades_count,
    }


def apply_capa_payload(capa: CapaNegocio, payload: CapaIn) -> CapaNegocio:
    capa.nombre = payload.nombre.strip()
    capa.tipo_capa = payload.tipo_capa
    capa.nombre_administrador = payload.nombre_administrador.strip() or None
    if payload.es_persona_moral is not None:
        capa.es_persona_moral = payload.es_persona_moral
    capa.razon_social = payload.razon_social.strip() or None
    capa.rfc = payload.rfc.strip() or None
    capa.regimen_fiscal = payload.regimen_fiscal.strip() or None
    capa.correo_contacto = payload.correo_contacto.strip() or None
    capa.telefono_contacto = payload.telefono_contacto.strip() or None
    capa.logo_url = payload.logo_url.strip() or None
    capa.pais_fiscal = payload.pais_fiscal.strip() or "Mexico"
    capa.codigo_postal_fiscal = payload.codigo_postal_fiscal.strip() or None
    capa.estado_fiscal = payload.estado_fiscal.strip() or None
    capa.municipio_fiscal = payload.municipio_fiscal.strip() or None
    capa.colonia_fiscal = payload.colonia_fiscal.strip() or None
    capa.calle_fiscal = payload.calle_fiscal.strip() or None
    capa.numero_exterior_fiscal = payload.numero_exterior_fiscal.strip() or None
    capa.numero_interior_fiscal = payload.numero_interior_fiscal.strip() or None
    capa.facturacion_activa = payload.facturacion_activa
    capa.facturacion_modo = payload.facturacion_modo
    capa.facturacion_pac_proveedor = payload.facturacion_pac_proveedor
    capa.facturacion_serie_ingresos = payload.facturacion_serie_ingresos.strip() or "A"
    capa.facturacion_lugar_expedicion = payload.facturacion_lugar_expedicion.strip() or None
    capa.facturacion_producto_servicio = payload.facturacion_producto_servicio.strip() or None
    capa.facturacion_unidad = payload.facturacion_unidad.strip() or "E48"
    capa.facturacion_uso_cfdi_default = payload.facturacion_uso_cfdi_default.strip() or "G03"
    capa.facturacion_metodo_pago_default = payload.facturacion_metodo_pago_default.strip() or "PUE"
    capa.facturacion_forma_pago_default = payload.facturacion_forma_pago_default.strip() or "03"
    capa.portal_clientes_activo = payload.portal_clientes_activo
    capa.portal_clientes_url_base = payload.portal_clientes_url_base.strip() or None
    capa.seguridad_doble_factor_activa = payload.seguridad_doble_factor_activa
    clabe_transferencias = re.sub(r"\D", "", payload.clabe_transferencias or "")
    banco_transferencias = payload.banco_transferencias.strip()
    validate_clabe_or_raise(clabe_transferencias, banco_transferencias)
    capa.clabe_transferencias = clabe_transferencias or None
    capa.banco_transferencias = banco_transferencias or None
    capa.beneficiario_transferencias = payload.beneficiario_transferencias.strip() or None
    capa.referencia_transferencia_prefijo = (
        payload.referencia_transferencia_prefijo.strip().upper() or "BETT"
    )
    capa.plazo_meses_default = max(payload.plazo_meses_default, 1)
    capa.periodicidad_cobro_default = payload.periodicidad_cobro_default
    fecha_vencimiento_modo = payload.fecha_vencimiento_modo
    if fecha_vencimiento_modo is None:
        if payload.dia_vencimiento_default:
            fecha_vencimiento_modo = "GLOBAL"
        elif capa.fecha_vencimiento_modo == "INDIVIDUAL":
            fecha_vencimiento_modo = "INDIVIDUAL"
        else:
            fecha_vencimiento_modo = "PENDIENTE"
    if fecha_vencimiento_modo not in {"PENDIENTE", "GLOBAL", "INDIVIDUAL"}:
        fecha_vencimiento_modo = "PENDIENTE"
    if fecha_vencimiento_modo == "PENDIENTE" and payload.dia_vencimiento_default:
        fecha_vencimiento_modo = "GLOBAL"
    if fecha_vencimiento_modo == "GLOBAL" and payload.dia_vencimiento_default:
        capa.dia_vencimiento_default = payload.dia_vencimiento_default
    else:
        capa.dia_vencimiento_default = None
    capa.fecha_vencimiento_modo = fecha_vencimiento_modo
    capa.dias_gracia_default = max(payload.dias_gracia_default, 0)
    capa.auto_renueva_default = payload.auto_renueva_default
    capa.aplicacion_pagos = payload.aplicacion_pagos
    capa.activo = payload.activo
    return capa


def payload_has_capa_data(payload: EntidadIn) -> bool:
    return payload.capa_negocio_id is not None or bool(
        normalize_text(payload.capa_negocio_nombre)
    )


def get_or_build_capa_for_payload(payload: EntidadIn) -> Optional[CapaNegocio]:
    capa_id = payload.capa_negocio_id
    capa_nombre = normalize_text(payload.capa_negocio_nombre)

    if capa_id:
        capa = get_object_or_404(CapaNegocio, id=capa_id)
    elif capa_nombre:
        capa, _ = CapaNegocio.objects.get_or_create(
            nombre=capa_nombre,
            defaults={"tipo_capa": payload.capa_negocio_tipo or "OPERADORA"},
        )
    else:
        return None

    capa.tipo_capa = payload.capa_negocio_tipo or capa.tipo_capa
    capa.nombre_administrador = normalize_text(payload.capa_nombre_administrador) or None
    capa.razon_social = normalize_text(payload.capa_razon_social) or None
    capa.rfc = normalize_text(payload.capa_rfc) or None
    capa.regimen_fiscal = normalize_text(payload.capa_regimen_fiscal) or None
    capa.correo_contacto = normalize_text(payload.capa_correo_contacto) or None
    capa.telefono_contacto = normalize_text(payload.capa_telefono_contacto) or None
    capa.logo_url = normalize_text(payload.capa_logo_url) or None
    capa.plazo_meses_default = max(int(payload.capa_plazo_meses_default or 12), 1)
    capa.periodicidad_cobro_default = (
        payload.capa_periodicidad_cobro_default or capa.periodicidad_cobro_default
    )
    capa.dia_vencimiento_default = payload.capa_dia_vencimiento_default
    if payload.capa_dia_vencimiento_default:
        capa.fecha_vencimiento_modo = "GLOBAL"
    capa.dias_gracia_default = max(int(payload.capa_dias_gracia_default or 0), 0)
    capa.auto_renueva_default = payload.capa_auto_renueva_default
    capa.aplicacion_pagos = payload.capa_aplicacion_pagos or capa.aplicacion_pagos
    capa.save()
    return capa


def serialize_regla_local(regla: ReglaNegocio) -> dict:
    capa = regla.entidad.capa_negocio if regla.entidad_id else None
    return {
        "id": regla.id,
        "nombre": regla.nombre,
        "tipo_calculo": regla.tipo_calculo,
        "valor": regla.valor,
        "periodicidad": regla.periodicidad,
        "aplica_a_todos": regla.aplica_a_todos,
        "dias_condicion": regla.dias_condicion,
        "activo": regla.activo,
        "origen": "OVERRIDE" if regla.regla_marco_id else "LOCAL",
        "regla_marco_id": regla.regla_marco_id,
        "capa_negocio_id": capa.id if capa else None,
        "capa_negocio_nombre": capa.nombre if capa else None,
        "editable_en_entidad": True,
    }


def serialize_regla_marco(rule: ReglaMarcoNegocio, *, editable_en_entidad: bool) -> dict:
    return {
        "id": rule.id,
        "nombre": rule.nombre,
        "tipo_calculo": rule.tipo_calculo,
        "valor": rule.valor,
        "periodicidad": rule.periodicidad,
        "aplica_a_todos": rule.aplica_a_todos,
        "dias_condicion": rule.dias_condicion,
        "activo": rule.activo,
        "origen": "GLOBAL",
        "regla_marco_id": rule.id,
        "capa_negocio_id": rule.capa_negocio_id,
        "capa_negocio_nombre": rule.capa_negocio.nombre,
        "editable_en_entidad": editable_en_entidad,
    }


def apply_regla_marco_payload(
    rule: ReglaMarcoNegocio,
    capa: CapaNegocio,
    payload: ReglaIn,
) -> ReglaMarcoNegocio:
    nombre = normalize_text(payload.nombre)
    if not nombre:
        raise HttpError(400, "La regla necesita un nombre.")

    if payload.tipo_calculo not in dict(ReglaMarcoNegocio.TIPO_CALCULO_CHOICES):
        raise HttpError(400, "El tipo de calculo no es valido.")

    if payload.periodicidad not in dict(PERIODICIDAD_CHOICES):
        raise HttpError(400, "La periodicidad no es valida.")

    valor = payload.valor or Decimal("0")
    if valor <= Decimal("0"):
        raise HttpError(400, "El valor debe ser mayor a cero.")
    if valor > Decimal("10000000"):
        raise HttpError(400, "El valor no puede superar 10000000.")
    if valor.as_tuple().exponent < -2:
        raise HttpError(400, "El valor solo acepta hasta 2 decimales.")

    dias_condicion = payload.dias_condicion
    if dias_condicion is not None and dias_condicion < 0:
        raise HttpError(400, "Los dias de condicion no pueden ser negativos.")
    if dias_condicion is not None and dias_condicion > 365:
        raise HttpError(400, "Los dias de condicion no pueden superar 365.")

    duplicate = ReglaMarcoNegocio.objects.filter(
        capa_negocio=capa,
        nombre__iexact=nombre,
    )
    if rule.id:
        duplicate = duplicate.exclude(id=rule.id)
    if duplicate.exists():
        raise HttpError(400, "Ya existe una regla con ese nombre en esta capa.")

    rule.capa_negocio = capa
    rule.nombre = nombre
    rule.tipo_calculo = payload.tipo_calculo
    rule.valor = valor
    rule.periodicidad = payload.periodicidad
    rule.aplica_a_todos = payload.aplica_a_todos
    rule.dias_condicion = dias_condicion
    rule.activo = payload.activo
    return rule


def build_effective_entity_rules(entidad: EntidadNegocio) -> list[dict]:
    local_rules = list(
        ReglaNegocio.objects.filter(entidad=entidad)
        .select_related("regla_marco", "entidad__capa_negocio")
        .order_by("-fecha_creacion", "-id")
    )
    overrides_by_marco = {
        rule.regla_marco_id: rule for rule in local_rules if rule.regla_marco_id
    }
    payload: list[dict] = []

    if entidad.capa_negocio_id:
        marco_rules = list(
            ReglaMarcoNegocio.objects.filter(capa_negocio=entidad.capa_negocio)
            .select_related("capa_negocio")
            .order_by("nombre")
        )
        for marco_rule in marco_rules:
            if marco_rule.id in overrides_by_marco:
                payload.append(serialize_regla_local(overrides_by_marco[marco_rule.id]))
            else:
                payload.append(
                    serialize_regla_marco(marco_rule, editable_en_entidad=False)
                )

    for local_rule in local_rules:
        if local_rule.regla_marco_id:
            continue
        payload.append(serialize_regla_local(local_rule))

    return payload


def current_charge_category(
    cuenta: Optional[CuentaPorCobrar],
    saldo: Decimal,
    today: date,
) -> str:
    if not cuenta:
        return "SIN_CXC"

    if cuenta.estatus_adeudo == "POR_CONCILIAR":
        return "POR_CONCILIAR"

    if cuenta.estatus_adeudo == "INCOBRABLE":
        return "VENCIDO"

    if saldo <= 0 or cuenta.estatus_adeudo == "CONCILIADO":
        return "PAGADO"

    if cuenta.estatus_adeudo == "VENCIDO" or cuenta.fecha_vencimiento < today:
        return "VENCIDO"

    return "PENDIENTE"


def build_entity_metrics_map(entidad_ids: list[int]) -> dict[int, dict[str, Decimal | int]]:
    """Metricas por unidad de negocio en clave POS: catalogo, cajas y venta."""
    metrics: dict[int, dict[str, Decimal | int]] = {
        entidad_id: {
            "clientes_count": 0,
            "productos_total": 0,
            "puntos_venta_total": 0,
            "puntos_venta_activos": 0,
            "mesas_total": 0,
            "tickets_cobrados": 0,
            "venta_cobrada": Decimal("0"),
            "cxp_total": Decimal("0"),
            "cxp_pagado": Decimal("0"),
            "cxp_pendiente": Decimal("0"),
            "cxp_vencido": Decimal("0"),
            "cxp_por_conciliar": Decimal("0"),
            "cxp_abierta": Decimal("0"),
            "cxp_registros_abiertos": 0,
        }
        for entidad_id in entidad_ids
    }

    if not entidad_ids:
        return metrics

    client_counts = Cliente.objects.filter(
        entidad_relacionada_id__in=entidad_ids,
        activo=True,
    ).values("entidad_relacionada_id").annotate(count=Count("id"))

    for item in client_counts:
        metrics[item["entidad_relacionada_id"]]["clientes_count"] = item["count"]

    puntos = (
        PuntoVenta.objects.filter(entidad_id__in=entidad_ids)
        .values("entidad_id")
        .annotate(
            total=Count("id"),
            activos=Count("id", filter=Q(activo=True)),
            mesas=Count("mesas", filter=Q(mesas__activo=True)),
        )
    )
    for item in puntos:
        bucket = metrics[item["entidad_id"]]
        bucket["puntos_venta_total"] = item["total"]
        bucket["puntos_venta_activos"] = item["activos"]
        bucket["mesas_total"] = item["mesas"]

    ventas = (
        Ticket.objects.filter(
            punto_venta__entidad_id__in=entidad_ids,
            estado="COBRADO",
        )
        .values("punto_venta__entidad_id")
        .annotate(total=Sum("total"), tickets=Count("id"))
    )
    for item in ventas:
        bucket = metrics[item["punto_venta__entidad_id"]]
        bucket["venta_cobrada"] = clamp_money(item["total"])
        bucket["tickets_cobrados"] = item["tickets"]

    money_field = DecimalField(max_digits=12, decimal_places=2)
    zero_money = Value(Decimal("0.00"), output_field=money_field)
    open_statuses = {"PENDIENTE", "PARCIAL", "VENCIDO", "POR_CONCILIAR"}
    payables = (
        CuentaPorPagar.objects.filter(
            entidad_relacionada_id__in=entidad_ids,
        )
        .exclude(estatus="CANCELADO")
        .annotate(
            total_calculado=Coalesce(
                "monto_real",
                "monto_proyectado",
                output_field=money_field,
            ),
            pagado_calculado=Coalesce(
                "monto_pagado",
                zero_money,
                output_field=money_field,
            ),
        )
        .annotate(
            saldo_calculado=Greatest(
                ExpressionWrapper(
                    F("total_calculado") - F("pagado_calculado"),
                    output_field=money_field,
                ),
                zero_money,
                output_field=money_field,
            )
        )
        .values(
            "entidad_relacionada_id",
            "estatus",
        )
        .annotate(
            total=Sum("total_calculado"),
            paid=Sum("pagado_calculado"),
            balance=Sum("saldo_calculado"),
            count=Count("id"),
        )
    )

    for item in payables:
        bucket = metrics[item["entidad_relacionada_id"]]
        total = clamp_money(item["total"])
        paid = clamp_money(item["paid"])
        balance = clamp_money(item["balance"])
        status = item["estatus"]

        bucket["cxp_total"] = clamp_money(bucket["cxp_total"]) + total
        bucket["cxp_pagado"] = clamp_money(bucket["cxp_pagado"]) + paid
        if status in {"PENDIENTE", "PARCIAL"}:
            bucket["cxp_pendiente"] = clamp_money(bucket["cxp_pendiente"]) + balance
        elif status == "VENCIDO":
            bucket["cxp_vencido"] = clamp_money(bucket["cxp_vencido"]) + balance
        elif status == "POR_CONCILIAR":
            bucket["cxp_por_conciliar"] = (
                clamp_money(bucket["cxp_por_conciliar"]) + total
            )

        if status in open_statuses:
            bucket["cxp_registros_abiertos"] = (
                int(bucket["cxp_registros_abiertos"]) + item["count"]
            )

    for bucket in metrics.values():
        bucket["cxp_abierta"] = (
            clamp_money(bucket["cxp_pendiente"])
            + clamp_money(bucket["cxp_vencido"])
            + clamp_money(bucket["cxp_por_conciliar"])
        )

    return metrics


def serialize_entidades_dashboard(entidad_ids: Optional[list[int]] = None) -> list[dict]:
    queryset = EntidadNegocio.objects.select_related("capa_negocio").all().order_by("-id")
    if entidad_ids is not None:
        queryset = queryset.filter(id__in=entidad_ids)

    entidades = list(queryset)
    metrics_by_entidad = build_entity_metrics_map([entidad.id for entidad in entidades])

    payload = []
    for entidad in entidades:
        metrics = metrics_by_entidad.get(entidad.id, {})
        payload.append(
            {
                "id": entidad.id,
                "nombre_comercial": entidad.nombre_comercial,
                "ciudad": entidad.ciudad,
                "rfc": entidad.rfc,
                "regimen_fiscal": entidad.regimen_fiscal,
                "logo_url": entidad.logo_url,
                "capa_negocio_id": entidad.capa_negocio_id,
                "capa_negocio_nombre": (
                    entidad.capa_negocio.nombre if entidad.capa_negocio else None
                ),
                "capa_negocio_tipo": (
                    entidad.capa_negocio.tipo_capa if entidad.capa_negocio else None
                ),
                "capa_nombre_administrador": (
                    entidad.capa_negocio.nombre_administrador
                    if entidad.capa_negocio
                    else None
                ),
                "capa_razon_social": (
                    entidad.capa_negocio.razon_social if entidad.capa_negocio else None
                ),
                "capa_rfc": entidad.capa_negocio.rfc if entidad.capa_negocio else None,
                "capa_regimen_fiscal": (
                    entidad.capa_negocio.regimen_fiscal if entidad.capa_negocio else None
                ),
                "capa_correo_contacto": (
                    entidad.capa_negocio.correo_contacto
                    if entidad.capa_negocio
                    else None
                ),
                "capa_telefono_contacto": (
                    entidad.capa_negocio.telefono_contacto
                    if entidad.capa_negocio
                    else None
                ),
                "capa_logo_url": (
                    entidad.capa_negocio.logo_url if entidad.capa_negocio else None
                ),
                "capa_plazo_meses_default": (
                    entidad.capa_negocio.plazo_meses_default
                    if entidad.capa_negocio
                    else None
                ),
                "capa_periodicidad_cobro_default": (
                    entidad.capa_negocio.periodicidad_cobro_default
                    if entidad.capa_negocio
                    else None
                ),
                "capa_dia_vencimiento_default": (
                    entidad.capa_negocio.dia_vencimiento_default
                    if entidad.capa_negocio
                    else None
                ),
                "capa_dias_gracia_default": (
                    entidad.capa_negocio.dias_gracia_default
                    if entidad.capa_negocio
                    else None
                ),
                "capa_auto_renueva_default": (
                    entidad.capa_negocio.auto_renueva_default
                    if entidad.capa_negocio
                    else None
                ),
                "capa_aplicacion_pagos": (
                    entidad.capa_negocio.aplicacion_pagos
                    if entidad.capa_negocio
                    else None
                ),
                "tipo_fecha_corte": entidad.tipo_fecha_corte,
                "activo": entidad.activo,
                "fecha_pausa": entidad.fecha_pausa,
                "clientes_count": metrics.get("clientes_count", 0),
                "espacios_total": metrics.get("espacios_total", 0),
                "espacios_ocupados": metrics.get("espacios_ocupados", 0),
                "espacios_disponibles": metrics.get("espacios_disponibles", 0),
                "espacios_reservados": metrics.get("espacios_reservados", 0),
                "espacios_mantenimiento": metrics.get("espacios_mantenimiento", 0),
                "facturacion_activa": decimal_to_float(
                    metrics.get("facturacion_activa")  # type: ignore[arg-type]
                ),
                "cxp_total": decimal_to_float(
                    metrics.get("cxp_total")  # type: ignore[arg-type]
                ),
                "cxp_pagado": decimal_to_float(
                    metrics.get("cxp_pagado")  # type: ignore[arg-type]
                ),
                "cxp_pendiente": decimal_to_float(
                    metrics.get("cxp_pendiente")  # type: ignore[arg-type]
                ),
                "cxp_vencido": decimal_to_float(
                    metrics.get("cxp_vencido")  # type: ignore[arg-type]
                ),
                "cxp_por_conciliar": decimal_to_float(
                    metrics.get("cxp_por_conciliar")  # type: ignore[arg-type]
                ),
                "cxp_abierta": decimal_to_float(
                    metrics.get("cxp_abierta")  # type: ignore[arg-type]
                ),
                "cxp_registros_abiertos": metrics.get("cxp_registros_abiertos", 0),
            }
        )

    return payload


def sum_receivable_balance(queryset) -> Decimal:
    totals = queryset.aggregate(
        total=Sum("monto_total"),
        paid=Sum("monto_pagado"),
    )
    return max(
        clamp_money(totals.get("total")) - clamp_money(totals.get("paid")),
        Decimal("0"),
    )


def sum_payable_balance(queryset) -> Decimal:
    totals = queryset.aggregate(
        total=Sum(
            Coalesce("monto_real", "monto_proyectado"),
            output_field=DecimalField(max_digits=12, decimal_places=2),
        ),
        paid=Sum("monto_pagado"),
    )
    return max(
        clamp_money(totals.get("total")) - clamp_money(totals.get("paid")),
        Decimal("0"),
    )




def build_entity_summary(entidad: EntidadNegocio) -> dict:
    """Resumen operativo de una unidad de negocio: cajas, venta y cartera."""
    metrics = build_entity_metrics_map([entidad.id]).get(entidad.id, {})

    puntos = list(
        PuntoVenta.objects.filter(entidad=entidad)
        .select_related("bodega")
        .order_by("codigo", "id")
    )
    punto_ids = [punto.id for punto in puntos]

    ventas_por_punto: dict[int, dict] = {}
    if punto_ids:
        for row in (
            Ticket.objects.filter(punto_venta_id__in=punto_ids, estado="COBRADO")
            .values("punto_venta_id")
            .annotate(
                tickets=Count("id"),
                venta=Sum("total"),
                propinas=Sum("propina"),
            )
        ):
            ventas_por_punto[row["punto_venta_id"]] = row

    abiertos_por_punto: dict[int, int] = {}
    if punto_ids:
        for row in (
            Ticket.objects.filter(punto_venta_id__in=punto_ids, estado="ABIERTO")
            .values("punto_venta_id")
            .annotate(total=Count("id"))
        ):
            abiertos_por_punto[row["punto_venta_id"]] = row["total"]

    detalle = []
    for punto in puntos:
        venta = ventas_por_punto.get(punto.id, {})
        turno_abierto = punto.turnos.filter(estado="ABIERTO").first()
        detalle.append(
            {
                "punto_venta_id": punto.id,
                "codigo": punto.codigo,
                "nombre": punto.nombre,
                "tipo_servicio": punto.tipo_servicio,
                "bodega": punto.bodega.nombre if punto.bodega_id else None,
                "activo": punto.activo,
                "acepta_cobro_qr": punto.acepta_cobro_qr,
                "menu_qr_activo": punto.menu_qr_activo,
                "mesas": punto.mesas.filter(activo=True).count(),
                "turno_abierto_id": turno_abierto.id if turno_abierto else None,
                "tickets_abiertos": abiertos_por_punto.get(punto.id, 0),
                "tickets_cobrados": int(venta.get("tickets") or 0),
                "venta_cobrada": decimal_to_float(clamp_money(venta.get("venta"))),
                "propinas": decimal_to_float(clamp_money(venta.get("propinas"))),
            }
        )

    venta_cobrada = clamp_money(metrics.get("venta_cobrada"))  # type: ignore[arg-type]
    cxp_total = clamp_money(metrics.get("cxp_total"))  # type: ignore[arg-type]
    cxp_pagado = clamp_money(metrics.get("cxp_pagado"))  # type: ignore[arg-type]
    cxp_pendiente = clamp_money(metrics.get("cxp_pendiente"))  # type: ignore[arg-type]
    cxp_vencido = clamp_money(metrics.get("cxp_vencido"))  # type: ignore[arg-type]
    cxp_por_conciliar = clamp_money(metrics.get("cxp_por_conciliar"))  # type: ignore[arg-type]
    cxp_abierta = clamp_money(metrics.get("cxp_abierta"))  # type: ignore[arg-type]

    chart_data = [
        {
            "label": "Venta cobrada",
            "value": decimal_to_float(venta_cobrada),
            "color": "#10b981",
        },
        {
            "label": "CxP pendiente",
            "value": decimal_to_float(cxp_pendiente),
            "color": "#f59e0b",
        },
        {
            "label": "CxP vencido",
            "value": decimal_to_float(cxp_vencido),
            "color": "#ef4444",
        },
        {
            "label": "CxP por conciliar",
            "value": decimal_to_float(cxp_por_conciliar),
            "color": "#38bdf8",
        },
    ]

    return {
        "entidad_id": entidad.id,
        "nombre_comercial": entidad.nombre_comercial,
        "ciudad": entidad.ciudad,
        "puntos_venta_total": int(metrics.get("puntos_venta_total", 0)),
        "puntos_venta_activos": int(metrics.get("puntos_venta_activos", 0)),
        "mesas_total": int(metrics.get("mesas_total", 0)),
        "tickets_cobrados": int(metrics.get("tickets_cobrados", 0)),
        "venta_cobrada": decimal_to_float(venta_cobrada),
        "clientes_activos": int(metrics.get("clientes_count", 0)),
        "cxp_total": decimal_to_float(cxp_total),
        "cxp_pagado": decimal_to_float(cxp_pagado),
        "cxp_pendiente": decimal_to_float(cxp_pendiente),
        "cxp_vencido": decimal_to_float(cxp_vencido),
        "cxp_por_conciliar": decimal_to_float(cxp_por_conciliar),
        "cxp_abierta": decimal_to_float(cxp_abierta),
        "cxp_registros_abiertos": int(metrics.get("cxp_registros_abiertos", 0)),
        "chart_data": chart_data,
        "detalle": detalle,
    }


def build_entity_summary_workbook(summary: dict) -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Resumen"

    rows = [
        ["Entidad", summary["nombre_comercial"]],
        ["Ciudad", summary["ciudad"] or "Sin ciudad"],
        ["Total espacios", summary["total_espacios"]],
        ["Ocupados", summary["ocupados"]],
        ["Disponibles", summary["disponibles"]],
        ["Reservados", summary["reservados"]],
        ["Mantenimiento", summary["mantenimiento"]],
        ["Clientes activos", summary["clientes_activos"]],
        ["Ocupacion %", summary["ocupacion_porcentaje"]],
        ["Facturacion activa", summary["facturacion_activa"]],
        ["Cargos registrados", summary["cargos_registrados"]],
        ["Pagado", summary["pagado"]],
        ["Por conciliar", summary["por_conciliar"]],
        ["Pendiente", summary["pendiente"]],
        ["Vencido", summary["vencido"]],
        ["Sin CxC", summary["sin_cxc"]],
        ["CxP total", summary["cxp_total"]],
        ["CxP pagado", summary["cxp_pagado"]],
        ["CxP pendiente", summary["cxp_pendiente"]],
        ["CxP vencido", summary["cxp_vencido"]],
        ["CxP por conciliar", summary["cxp_por_conciliar"]],
        ["CxP abierta", summary["cxp_abierta"]],
        ["CxP registros abiertos", summary["cxp_registros_abiertos"]],
    ]

    sheet.append(["Resumen entidad", "Valor"])
    sheet["A1"].font = Font(bold=True)
    sheet["B1"].font = Font(bold=True)
    for row in rows:
        sheet.append(row)

    chart_sheet = workbook.create_sheet("Distribucion")
    chart_sheet.append(["Categoria", "Monto"])
    chart_sheet["A1"].font = Font(bold=True)
    chart_sheet["B1"].font = Font(bold=True)
    for item in summary["chart_data"]:
        chart_sheet.append([item["label"], item["value"]])

    detail_sheet = workbook.create_sheet("Detalle")
    detail_headers = [
        "Espacio",
        "Estatus espacio",
        "Tipo espacio",
        "Cliente",
        "Telefono",
        "Correo",
        "Fecha inicio",
        "Renta pactada",
        "Deposito pactado",
        "Cuenta por cobrar ID",
        "Concepto",
        "Fecha vencimiento",
        "Monto facturado",
        "Monto pagado",
        "Saldo pendiente",
        "Categoria cobro",
        "Estatus adeudo",
    ]
    detail_sheet.append(detail_headers)
    for column in range(1, len(detail_headers) + 1):
        detail_sheet.cell(row=1, column=column).font = Font(bold=True)

    for item in summary["detalle"]:
        detail_sheet.append(
            [
                item["espacio_codigo"],
                item["espacio_estatus"],
                item["tipo_espacio"],
                item["cliente_nombre"],
                item["cliente_telefono"],
                item["cliente_correo"],
                item["fecha_inicio"].isoformat() if item["fecha_inicio"] else "",
                item["renta_pactada"],
                item["deposito_pactado"],
                item["cuenta_por_cobrar_id"],
                item["concepto"],
                item["fecha_vencimiento"].isoformat()
                if item["fecha_vencimiento"]
                else "",
                item["monto_facturado"],
                item["monto_pagado"],
                item["saldo_pendiente"],
                item["categoria_cobro"],
                item["estatus_adeudo"],
            ]
        )

    for worksheet in workbook.worksheets:
        for column_cells in worksheet.columns:
            max_length = 0
            column_letter = column_cells[0].column_letter
            for cell in column_cells:
                cell_value = "" if cell.value is None else str(cell.value)
                max_length = max(max_length, len(cell_value))
            worksheet.column_dimensions[column_letter].width = min(max(max_length + 2, 14), 28)

    output = io.BytesIO()
    workbook.save(output)
    return output.getvalue()


def is_empty_row(row: list[object]) -> bool:
    return all(not normalize_text(value) for value in row)


def get_row_value(row: list[object], mapping: dict[str, int], key: str) -> object:
    index = mapping.get(key)
    if index is None or index >= len(row):
        return None
    return row[index]


def find_header_mapping(rows: list[list[object]]) -> tuple[int, dict[str, int]]:
    required_keys = {"nombre_comercial", "codigo_espacio"}

    for row_index, row in enumerate(rows, start=1):
        mapping: dict[str, int] = {}
        for column_index, value in enumerate(row):
            normalized = normalize_header(value)
            if not normalized:
                continue
            for logical_name, aliases in HEADER_ALIASES.items():
                if header_matches(logical_name, normalized) and logical_name not in mapping:
                    mapping[logical_name] = column_index
                    break

        if required_keys.issubset(mapping.keys()):
            return row_index, mapping

    raise HttpError(
        400,
        "No se encontraron encabezados validos. La plantilla debe incluir "
        "'Unidad Negocio' y 'Habitacion' o sus equivalentes.",
    )


def load_rows_from_file(upload: UploadedFile) -> list[list[object]]:
    extension = os.path.splitext(upload.name or "")[1].lower()

    if extension in {".xlsx", ".xlsm"}:
        upload.file.seek(0)
        workbook = load_workbook(upload.file, data_only=True)
        sheet = workbook.active
        return [list(row) for row in sheet.iter_rows(values_only=True)]

    if extension == ".csv":
        upload.file.seek(0)
        content = upload.file.read().decode("utf-8-sig")
        reader = csv.reader(io.StringIO(content))
        return [list(row) for row in reader]

    raise HttpError(400, "Solo se permiten archivos .xlsx, .xlsm o .csv.")




def get_batch_import_row_limit(capa: CapaNegocio | None) -> int:
    if capa and not is_plan_limit_exempt(capa):
        plan_space_limit = get_current_limit(capa, "espacios")
        if plan_space_limit and plan_space_limit > 0:
            return min(plan_space_limit, BATCH_IMPORT_ABSOLUTE_ROW_LIMIT)
    return BATCH_IMPORT_FALLBACK_ROW_LIMIT


def count_batch_data_rows(rows: list[list[object]], header_row_index: int) -> int:
    return sum(1 for row in rows[header_row_index:] if not is_empty_row(row))


def assert_batch_upload_size(
    capa: CapaNegocio,
    rows: list[list[object]],
    header_row_index: int,
) -> None:
    data_row_count = count_batch_data_rows(rows, header_row_index)
    row_limit = get_batch_import_row_limit(capa)
    if data_row_count <= row_limit:
        return

    raise HttpError(
        413,
        (
            f"El archivo contiene {data_row_count} filas con datos. "
            f"Tu plan permite procesar hasta {row_limit} espacios por carga. "
            "Divide la migracion en varios archivos o actualiza tu plan."
        ),
    )


def validate_text_length(
    value: str,
    label: str,
    max_length: int,
    *,
    min_length: int = 0,
    required: bool = False,
) -> None:
    if not value:
        if required:
            raise ValueError(f"{label} es obligatorio.")
        return
    if len(value) < min_length:
        raise ValueError(f"{label} debe tener al menos {min_length} caracteres.")
    if len(value) > max_length:
        raise ValueError(f"{label} no debe superar {max_length} caracteres.")


def parse_batch_row(row: list[object], mapping: dict[str, int]) -> tuple[dict[str, object], list[str]]:
    errors: list[str] = []

    def capture(label: str, callback):
        try:
            return callback()
        except ValueError as exc:
            errors.append(f"{label}: {exc}")
            return None

    entidad_nombre = normalize_text(get_row_value(row, mapping, "nombre_comercial"))
    espacio_codigo = normalize_text(get_row_value(row, mapping, "codigo_espacio"))
    validate_errors: list[tuple[str, str, int, int, bool]] = [
        ("Unidad Negocio", entidad_nombre, 150, 2, True),
        ("Codigo Espacio", espacio_codigo, 100, 1, True),
    ]
    for label, value, max_length, min_length, required in validate_errors:
        try:
            validate_text_length(
                value,
                label,
                max_length,
                min_length=min_length,
                required=required,
            )
        except ValueError as exc:
            errors.append(str(exc))

    ciudad = normalize_text(get_row_value(row, mapping, "ciudad")) or None
    tipo_nombre = normalize_text(get_row_value(row, mapping, "tipo_espacio")) or None
    cliente_nombre = normalize_text(get_row_value(row, mapping, "cliente_nombre"))
    cliente_identificador = normalize_text(
        get_row_value(row, mapping, "cliente_identificador")
    )
    observaciones = normalize_text(get_row_value(row, mapping, "observaciones")) or None

    for label, value, max_length in (
        ("Ciudad", ciudad or "", 100),
        ("Tipo Espacio", tipo_nombre or "", 150),
        ("Cliente", cliente_nombre, 200),
        ("Contrato", cliente_identificador, 100),
        ("Observaciones", observaciones or "", 500),
    ):
        try:
            validate_text_length(value, label, max_length)
        except ValueError as exc:
            errors.append(str(exc))

    tipo_corte = capture(
        "Tipo Corte",
        lambda: parse_tipo_corte(get_row_value(row, mapping, "tipo_fecha_corte")),
    )
    precio_lista = capture(
        "Precio Lista",
        lambda: parse_decimal(get_row_value(row, mapping, "precio_lista")),
    )
    if precio_lista is not None:
        capture(
            "Precio Lista",
            lambda: validate_import_money(
                precio_lista,
                "Precio Lista",
                min_value=Decimal("0.01"),
            ),
        )
    deposito_base = capture(
        "Deposito Base",
        lambda: parse_decimal(get_row_value(row, mapping, "deposito_base")),
    )
    if deposito_base is not None:
        capture(
            "Deposito Base",
            lambda: validate_import_money(deposito_base, "Deposito Base"),
        )
    estatus = capture(
        "Estatus",
        lambda: parse_estatus(get_row_value(row, mapping, "estatus")),
    )
    cliente_whatsapp = capture(
        "WhatsApp",
        lambda: normalize_phone(get_row_value(row, mapping, "cliente_whatsapp")),
    )
    cliente_correo = normalize_email(get_row_value(row, mapping, "cliente_correo"))
    capture("Correo Electronico", lambda: validate_email_or_raise(cliente_correo))
    cliente_dia_corte = capture(
        "Fecha de corte",
        lambda: parse_day_of_month(get_row_value(row, mapping, "cliente_dia_corte")),
    )

    return (
        {
            "entidad_nombre": entidad_nombre,
            "espacio_codigo": espacio_codigo,
            "ciudad": ciudad,
            "tipo_corte": tipo_corte,
            "tipo_nombre": tipo_nombre,
            "precio_lista": precio_lista,
            "deposito_base": deposito_base,
            "estatus": estatus,
            "cliente_nombre": cliente_nombre,
            "cliente_whatsapp": cliente_whatsapp or "",
            "cliente_correo": cliente_correo,
            "cliente_identificador": cliente_identificador,
            "cliente_dia_corte": cliente_dia_corte,
            "observaciones": observaciones,
        },
        errors,
    )


def build_batch_error_workbook(
    headers: list[str],
    error_rows: list[dict[str, object]],
) -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Filas con errores"
    output_headers = ["Fila original", *headers, "Comentario de error", "Instruccion"]
    sheet.append(output_headers)
    for cell in sheet[1]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor="7F1D1D")
        cell.alignment = Alignment(wrap_text=True, vertical="top")

    for item in error_rows:
        row_values = list(item["row"])
        if len(row_values) < len(headers):
            row_values.extend([""] * (len(headers) - len(row_values)))
        row_values = row_values[: len(headers)]
        sheet.append(
            [
                item["row_number"],
                *row_values,
                item["message"],
                "Corrige los campos indicados y vuelve a subir este archivo o copia las filas corregidas a la plantilla.",
            ]
        )

    instructions = workbook.create_sheet("Como corregir")
    instructions.append(["Paso", "Detalle"])
    instructions.append(["1", "Revisa la columna Comentario de error para cada fila no procesada."])
    instructions.append(["2", "Corrige los datos en esa misma fila."])
    instructions.append(["3", "Vuelve a subir solo las filas corregidas o pegala en la plantilla oficial."])
    for cell in instructions[1]:
        cell.font = Font(bold=True)

    for worksheet in workbook.worksheets:
        for column_cells in worksheet.columns:
            max_length = 0
            column_letter = column_cells[0].column_letter
            for cell in column_cells:
                cell_value = "" if cell.value is None else str(cell.value)
                max_length = max(max_length, len(cell_value))
                cell.alignment = Alignment(wrap_text=True, vertical="top")
            worksheet.column_dimensions[column_letter].width = min(max(max_length + 2, 14), 48)

    output = io.BytesIO()
    workbook.save(output)
    return output.getvalue()


def build_batch_template(capa: CapaNegocio | None = None) -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Carga Batch"
    row_limit = get_batch_import_row_limit(capa)
    validation_end_row = row_limit + 2
    descriptions = [
        "Ciudad o plaza donde opera la unidad.",
        "Nombre de la unidad de negocio, condominio, edificio o propiedad.",
        "Selecciona GENERAL si todos comparten corte; INDIVIDUAL si cada cliente tiene su propio dia.",
        "Clave unica del espacio dentro de la unidad.",
        "Renta, cuota o precio mensual base del espacio.",
        "Deposito sugerido o garantia inicial. Puede quedar vacio.",
        "Categoria comercial del espacio: departamento, habitacion, local, suite, etc.",
        "Estado operativo del espacio; controla si se crea ocupacion o queda libre.",
        "Nombre del cliente, residente, inquilino o propietario. Opcional si esta libre.",
        "Telefono para contacto o WhatsApp. Opcional.",
        "Correo para avisos, cobranza o portal. Opcional.",
        "Dia del mes en que vence el pago: 1 a 31. Se usa para generar CxC.",
        "Folio, contrato o identificador interno para evitar duplicados.",
        "Notas internas de migracion, condiciones o aclaraciones.",
    ]
    headers = [
        "Ciudad",
        "Unidad Negocio",
        "Tipo Corte",
        "Codigo Espacio",
        "Precio Lista",
        "Deposito Base",
        "Tipo Espacio",
        "Estatus",
        "Cliente",
        "WhatsApp",
        "Correo Electronico",
        "Fecha de corte",
        "Contrato",
        "Observaciones",
    ]
    example_rows = [
        [
            "CDMX",
            "Edificio Ejemplo Norte",
            "GENERAL",
            "A-101",
            8500,
            8500,
            "Departamento",
            "OCUPADO",
            "Cliente Ejemplo 01",
            "5511002200",
            "cliente01@example.com",
            5,
            "EJ-NORTE-A101",
            "Cuota mensual con corte general.",
        ],
        [
            "CDMX",
            "Edificio Ejemplo Norte",
            "GENERAL",
            "A-102",
            8500,
            8500,
            "Departamento",
            "DISPONIBLE",
            "",
            "",
            "",
            "",
            "",
            "Disponible para asignar despues.",
        ],
        [
            "Guadalajara",
            "Lofts Ejemplo Delta",
            "INDIVIDUAL",
            "L-08",
            12000,
            12000,
            "Loft",
            "OCUPADO",
            "Cliente Ejemplo 02",
            "3312345678",
            "cliente02@example.com",
            18,
            "EJ-DELTA-L08",
            "Contrato con corte individual.",
        ],
        [
            "Monterrey",
            "Suites Ejemplo Centro",
            "INDIVIDUAL",
            "S-02",
            9800,
            9800,
            "Suite",
            "RESERVADO",
            "Cliente Ejemplo 03",
            "8112223344",
            "cliente03@example.com",
            22,
            "EJ-SUITE-S02",
            "Reserva pendiente de activacion.",
        ],
        [
            "Puebla",
            "Condominio Ejemplo Lirio",
            "GENERAL",
            "PH-01",
            15000,
            15000,
            "Penthouse",
            "MANTENIMIENTO",
            "",
            "",
            "",
            10,
            "",
            "Fuera de operacion temporalmente.",
        ],
    ]

    sheet.append(descriptions)
    sheet.append(headers)
    for row in example_rows:
        sheet.append(row)

    description_fill = PatternFill("solid", fgColor="EAF7FF")
    header_fill = PatternFill("solid", fgColor="0F172A")
    for cell in sheet[1]:
        cell.font = Font(italic=True, color="334155")
        cell.fill = description_fill
        cell.alignment = Alignment(wrap_text=True, vertical="top")
    for cell in sheet[2]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center", vertical="center")
    sheet.freeze_panes = "A3"
    sheet.row_dimensions[1].height = 58
    sheet.row_dimensions[2].height = 24

    catalog = workbook.create_sheet("Catalogos")
    catalog.append(["Tipo Corte", "Estatus", "Tipo Espacio"])
    for index, value in enumerate(["GENERAL", "INDIVIDUAL"], start=2):
        catalog.cell(row=index, column=1, value=value)
    for index, value in enumerate(["DISPONIBLE", "OCUPADO", "RESERVADO", "MANTENIMIENTO"], start=2):
        catalog.cell(row=index, column=2, value=value)
    for index, value in enumerate(
        [
            "Departamento",
            "Habitacion",
            "Suite",
            "Loft",
            "Local",
            "Oficina",
            "Penthouse",
            "Bodega",
            "Estacionamiento",
            "Otro",
        ],
        start=2,
    ):
        catalog.cell(row=index, column=3, value=value)
    catalog.sheet_state = "hidden"

    tipo_corte_validation = DataValidation(
        type="list",
        formula1="=Catalogos!$A$2:$A$3",
        allow_blank=False,
    )
    tipo_corte_validation.promptTitle = "Tipo de corte"
    tipo_corte_validation.prompt = "GENERAL usa un dia para la unidad; INDIVIDUAL usa el dia de cada cliente."
    tipo_corte_validation.errorTitle = "Tipo de corte invalido"
    tipo_corte_validation.error = "Selecciona GENERAL o INDIVIDUAL."
    estatus_validation = DataValidation(
        type="list",
        formula1="=Catalogos!$B$2:$B$5",
        allow_blank=False,
    )
    estatus_validation.promptTitle = "Estatus del espacio"
    estatus_validation.prompt = "OCUPADO crea ocupacion; DISPONIBLE no vincula cliente."
    estatus_validation.errorTitle = "Estatus invalido"
    estatus_validation.error = "Selecciona un estatus del catalogo."
    tipo_espacio_validation = DataValidation(
        type="list",
        formula1="=Catalogos!$C$2:$C$11",
        allow_blank=True,
    )
    tipo_espacio_validation.promptTitle = "Tipo de espacio"
    tipo_espacio_validation.prompt = "Usa una categoria del catalogo; Otro permite ajustar despues."
    unidad_validation = DataValidation(
        type="textLength",
        operator="between",
        formula1="2",
        formula2="150",
        allow_blank=False,
    )
    unidad_validation.promptTitle = "Unidad de negocio"
    unidad_validation.prompt = "Campo obligatorio. Usa de 2 a 150 caracteres."
    unidad_validation.errorTitle = "Unidad invalida"
    unidad_validation.error = "Unidad Negocio es obligatoria y debe tener de 2 a 150 caracteres."
    codigo_validation = DataValidation(
        type="textLength",
        operator="between",
        formula1="1",
        formula2="100",
        allow_blank=False,
    )
    codigo_validation.promptTitle = "Codigo de espacio"
    codigo_validation.prompt = "Campo obligatorio. Usa una clave unica de hasta 100 caracteres."
    codigo_validation.errorTitle = "Codigo invalido"
    codigo_validation.error = "Codigo Espacio es obligatorio y no debe superar 100 caracteres."
    ciudad_validation = DataValidation(
        type="textLength",
        operator="lessThanOrEqual",
        formula1="100",
        allow_blank=True,
    )
    ciudad_validation.errorTitle = "Ciudad invalida"
    ciudad_validation.error = "Ciudad no debe superar 100 caracteres."
    cliente_validation = DataValidation(
        type="textLength",
        operator="lessThanOrEqual",
        formula1="200",
        allow_blank=True,
    )
    cliente_validation.errorTitle = "Cliente invalido"
    cliente_validation.error = "Cliente no debe superar 200 caracteres."
    telefono_validation = DataValidation(
        type="custom",
        formula1='=OR(J3="",AND(LEN(SUBSTITUTE(J3,"+",""))>=10,LEN(SUBSTITUTE(J3,"+",""))<=15,LEN(J3)-LEN(SUBSTITUTE(J3,"+",""))<=1,OR(LEFT(J3,1)="+",ISERROR(FIND("+",J3))),ISNUMBER(--SUBSTITUTE(J3,"+",""))))',
        allow_blank=True,
    )
    telefono_validation.promptTitle = "WhatsApp o telefono"
    telefono_validation.prompt = "Opcional. Usa solo numeros, o + al inicio, de 10 a 15 digitos."
    telefono_validation.errorTitle = "Telefono invalido"
    telefono_validation.error = "WhatsApp solo acepta numeros, o + al inicio, de 10 a 15 digitos."
    correo_validation = DataValidation(
        type="custom",
        formula1='=OR(K3="",AND(ISERROR(FIND(" ",K3)),LEN(K3)-LEN(SUBSTITUTE(K3,"@",""))=1,FIND("@",K3)>1,ISERROR(FIND("@.",K3)),OR(RIGHT(LOWER(K3),4)=".com",RIGHT(LOWER(K3),4)=".net",RIGHT(LOWER(K3),4)=".org",RIGHT(LOWER(K3),3)=".mx")))',
        allow_blank=True,
    )
    correo_validation.promptTitle = "Correo electronico"
    correo_validation.prompt = "Opcional. Captura un correo valido con @ y dominio."
    correo_validation.errorTitle = "Correo invalido"
    correo_validation.error = "Captura un correo valido."
    contrato_validation = DataValidation(
        type="textLength",
        operator="lessThanOrEqual",
        formula1="100",
        allow_blank=True,
    )
    contrato_validation.errorTitle = "Contrato invalido"
    contrato_validation.error = "Contrato no debe superar 100 caracteres."
    observaciones_validation = DataValidation(
        type="textLength",
        operator="lessThanOrEqual",
        formula1="500",
        allow_blank=True,
    )
    observaciones_validation.errorTitle = "Observaciones invalidas"
    observaciones_validation.error = "Observaciones no debe superar 500 caracteres."
    precio_validation = DataValidation(
        type="custom",
        formula1='=OR(E3="",AND(ISNUMBER(E3),E3>0,E3<=10000000,ROUND(E3,2)=E3))',
        allow_blank=True,
    )
    precio_validation.promptTitle = "Precio lista"
    precio_validation.prompt = "Renta, cuota o precio mensual base. Usa un monto mayor a 0 y hasta 2 decimales."
    precio_validation.errorTitle = "Monto invalido"
    precio_validation.error = "Precio Lista debe ser numerico, mayor a 0 y con maximo 2 decimales."
    deposito_validation = DataValidation(
        type="custom",
        formula1='=OR(F3="",AND(ISNUMBER(F3),F3>=0,F3<=10000000,ROUND(F3,2)=F3))',
        allow_blank=True,
    )
    deposito_validation.promptTitle = "Deposito base"
    deposito_validation.prompt = "Puede quedar vacio o en 0 si no aplica deposito. Maximo 2 decimales."
    deposito_validation.errorTitle = "Deposito invalido"
    deposito_validation.error = "Deposito Base debe ser numerico, no negativo y con maximo 2 decimales."
    dia_corte_validation = DataValidation(
        type="custom",
        formula1='=OR(L3="",AND(ISNUMBER(L3),L3=INT(L3),L3>=1,L3<=31))',
        allow_blank=True,
    )
    dia_corte_validation.promptTitle = "Fecha de corte"
    dia_corte_validation.prompt = "Captura solo el dia entero del mes, del 1 al 31."
    dia_corte_validation.errorTitle = "Dia invalido"
    dia_corte_validation.error = "Fecha de corte debe ser un numero entero entre 1 y 31."
    for validation, cell_range in (
        (ciudad_validation, f"A3:A{validation_end_row}"),
        (unidad_validation, f"B3:B{validation_end_row}"),
        (tipo_corte_validation, f"C3:C{validation_end_row}"),
        (codigo_validation, f"D3:D{validation_end_row}"),
        (precio_validation, f"E3:E{validation_end_row}"),
        (deposito_validation, f"F3:F{validation_end_row}"),
        (tipo_espacio_validation, f"G3:G{validation_end_row}"),
        (estatus_validation, f"H3:H{validation_end_row}"),
        (cliente_validation, f"I3:I{validation_end_row}"),
        (telefono_validation, f"J3:J{validation_end_row}"),
        (correo_validation, f"K3:K{validation_end_row}"),
        (dia_corte_validation, f"L3:L{validation_end_row}"),
        (contrato_validation, f"M3:M{validation_end_row}"),
        (observaciones_validation, f"N3:N{validation_end_row}"),
    ):
        sheet.add_data_validation(validation)
        validation.add(cell_range)

    for row_number in range(3, validation_end_row + 1):
        sheet.cell(row=row_number, column=5).number_format = '#,##0.00'
        sheet.cell(row=row_number, column=6).number_format = '#,##0.00'

    widths = {
        "A": 16,
        "B": 26,
        "C": 18,
        "D": 18,
        "E": 16,
        "F": 16,
        "G": 18,
        "H": 18,
        "I": 22,
        "J": 18,
        "K": 30,
        "L": 16,
        "M": 18,
        "N": 34,
    }
    for column, width in widths.items():
        sheet.column_dimensions[column].width = width

    instructions = workbook.create_sheet("Instrucciones")
    instructions.append(["Paso", "Detalle"])
    instructions.append(
        [
            "1",
            "Llena una fila por espacio. Puedes repetir la entidad en varias filas.",
        ]
    )
    instructions.append(
        [
            "2",
            "Unidad Negocio crea o actualiza la entidad. Codigo Espacio crea o actualiza el espacio.",
        ]
    )
    instructions.append(
        [
            "3",
            "Precio Lista se guarda como renta por espacio. Deposito Base es opcional.",
        ]
    )
    instructions.append(
        [
            "4",
            "Cliente, WhatsApp, Correo Electronico y Fecha de corte son opcionales. Si existe cliente, el import tambien lo vincula al espacio.",
        ]
    )
    instructions.append(
        [
            "5",
            "Contrato es opcional y se usa como identificador interno para evitar duplicados de cliente.",
        ]
    )
    instructions.append(
        [
            "6",
            "Tipo Corte, Tipo Espacio y Estatus tienen selectores. Si necesitas otro tipo de espacio, usa Otro y ajustalo despues.",
        ]
    )
    instructions.append(
        [
            "7",
            "La primera fila explica cada columna. No la borres; los encabezados que importa BetterP estan en la fila 2.",
        ]
    )
    instructions.append(
        [
            "8",
            "La plantilla valida campos obligatorios, montos, dias, telefono y correo para reducir errores antes de subir.",
        ]
    )
    instructions.append(
        [
            "9",
            "Si una fila no se puede procesar, BetterP importara las filas validas y devolvera un archivo con las filas erroneas y el motivo de correccion.",
        ]
    )
    instructions.append(
        [
            "10",
            f"Esta plantilla permite capturar hasta {row_limit} filas de espacios por carga segun el limite del plan actual.",
        ]
    )
    for column in range(1, 3):
        instructions.cell(row=1, column=column).font = Font(bold=True)
        instructions.column_dimensions[instructions.cell(row=1, column=column).column_letter].width = 32

    output = io.BytesIO()
    workbook.save(output)
    return output.getvalue()


@router.get("/batch/plantilla/")
def descargar_plantilla_batch(request):
    require_entities_access(request)
    require_batch_import_access(request)
    require_admin_access(request)
    current_capa = get_current_capa(request)
    content = build_batch_template(current_capa)
    response = HttpResponse(
        content,
        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    response["Content-Disposition"] = (
        'attachment; filename="plantilla-entidades-espacios.xlsx"'
    )
    return response
















@router.get("/capas/backup/exportar/")
def exportar_backup_capa(request):
    require_backup_access(request)
    capa = get_current_capa(request)
    content = build_capa_backup_workbook(capa)
    filename = slugify(capa.nombre) or f"capa-{capa.id}"
    today = timezone.localdate().isoformat()

    response = HttpResponse(
        content,
        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    response["Content-Disposition"] = (
        f'attachment; filename="backup-{filename}-{today}.xlsx"'
    )
    return response


@router.get("/lista/", response=List[EntidadOut])
def listar_entidades(request):
    require_entities_access(request)
    return serialize_entidades_dashboard(get_allowed_entity_ids(request))


@router.get("/capas/", response=List[CapaOut])
def listar_capas(request):
    capas = list(
        get_accessible_capas_queryset(request)
        .annotate(entidades_count=Count("entidades"))
        .order_by("nombre")
    )
    return [serialize_capa(capa, getattr(capa, "entidades_count", 0)) for capa in capas]


@router.get("/capas/{capa_id}/", response=CapaOut)
def obtener_capa(request, capa_id: int):
    capa = get_object_or_404(
        get_accessible_capas_queryset(request).annotate(entidades_count=Count("entidades")),
        id=capa_id,
    )
    return serialize_capa(capa, getattr(capa, "entidades_count", 0))


@router.post("/capas/")
def crear_capa(request, payload: CapaIn):
    context = require_admin_access(request)
    require_cfdi_access_if_enabled(request, payload)
    try:
        capa = apply_capa_payload(CapaNegocio(), payload)
        if capa.usuario_fundador_id is None:
            capa.usuario_fundador = context.user
        capa.save()
        audit(
            actor=context.user,
            capa=capa,
            accion="CAPA_CREADA",
            recurso_tipo="CapaNegocio",
            recurso_id=capa.id,
            metadata={"nombre": capa.nombre, "tipo_capa": capa.tipo_capa},
        )
        return {"id": capa.id, "mensaje": "Capa de negocio creada exitosamente"}
    except Exception as exc:
        raise HttpError(500, f"Error al crear capa de negocio: {exc}")


@router.put("/capas/{capa_id}/")
def actualizar_capa(request, capa_id: int, payload: CapaIn):
    context = require_admin_access(request)
    require_cfdi_access_if_enabled(request, payload)
    capa = get_object_or_404(get_accessible_capas_queryset(request), id=capa_id)
    try:
        apply_capa_payload(capa, payload)
        capa.save()
        audit(
            actor=context.user,
            capa=capa,
            accion="CAPA_ACTUALIZADA",
            recurso_tipo="CapaNegocio",
            recurso_id=capa.id,
            metadata={"nombre": capa.nombre, "tipo_capa": capa.tipo_capa},
        )
        return {"success": True, "mensaje": "Capa de negocio actualizada exitosamente"}
    except Exception as exc:
        raise HttpError(500, f"Error al actualizar capa de negocio: {exc}")


@router.delete("/capas/{capa_id}/")
def borrar_capa(request, capa_id: int):
    context = require_admin_access(request)
    capa = get_object_or_404(get_accessible_capas_queryset(request), id=capa_id)
    if capa.entidades.exists():
        raise HttpError(
            400,
            "No puedes eliminar esta capa porque todavia tiene entidades vinculadas.",
        )
    audit(
        actor=context.user,
        capa=capa,
        accion="CAPA_ELIMINADA",
        recurso_tipo="CapaNegocio",
        recurso_id=capa.id,
        metadata={"nombre": capa.nombre},
    )
    capa.delete()
    return {"success": True, "mensaje": "Capa de negocio eliminada"}


@router.post("/crear/")
def crear_entidad(request, payload: EntidadIn):
    require_entities_write_access(request)
    capa_negocio = get_current_capa(request)
    assert_plan_capacity(capa_negocio, "entidades")
    try:
        nueva_entidad = EntidadNegocio.objects.create(
            capa_negocio=capa_negocio,
            nombre_comercial=payload.nombre_comercial,
            ciudad=payload.ciudad or None,
            rfc=payload.rfc,
            regimen_fiscal=payload.regimen_fiscal,
            logo_url=payload.logo_url or None,
            tipo_fecha_corte=payload.tipo_fecha_corte,
            activo=payload.activo,
            fecha_pausa=payload.fecha_pausa,
        )
        audit(
            actor=request.auth.user,
            capa=capa_negocio,
            accion="ENTIDAD_CREADA",
            recurso_tipo="EntidadNegocio",
            recurso_id=nueva_entidad.id,
            metadata={"nombre_comercial": nueva_entidad.nombre_comercial},
        )
        return {"id": nueva_entidad.id, "mensaje": "Entidad de negocio creada exitosamente"}
    except Exception as exc:
        raise HttpError(500, f"Error al crear entidad: {exc}")


@router.get("/{entidad_id}/", response=EntidadOut)
def obtener_entidad(request, entidad_id: int):
    require_entities_access(request)
    entidad = get_object_or_404(EntidadNegocio, id=entidad_id, id__in=get_allowed_entity_ids(request))
    return serialize_entidades_dashboard([entidad.id])[0]


@router.get("/{entidad_id}/resumen/", response=EntidadResumenOut)
def obtener_resumen_entidad(request, entidad_id: int):
    require_entities_access(request)
    entidad = get_object_or_404(EntidadNegocio, id=entidad_id, id__in=get_allowed_entity_ids(request))
    return build_entity_summary(entidad)


@router.get("/{entidad_id}/resumen/exportar/")
def exportar_resumen_entidad(request, entidad_id: int):
    require_entities_access(request)
    entidad = get_object_or_404(EntidadNegocio, id=entidad_id, id__in=get_allowed_entity_ids(request))
    summary = build_entity_summary(entidad)
    content = build_entity_summary_workbook(summary)
    filename = slugify(entidad.nombre_comercial) or f"entidad-{entidad.id}"

    response = HttpResponse(
        content,
        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    response["Content-Disposition"] = (
        f'attachment; filename="resumen-{filename}.xlsx"'
    )
    return response


@router.put("/{entidad_id}/")
def actualizar_entidad(request, entidad_id: int, payload: EntidadIn):
    require_entities_write_access(request)
    entidad = get_object_or_404(EntidadNegocio, id=entidad_id, id__in=get_allowed_entity_ids(request))
    if payload.activo and not entidad.activo:
        assert_plan_capacity(get_current_capa(request), "entidades")
    try:
        entidad.capa_negocio = get_current_capa(request)
        entidad.nombre_comercial = payload.nombre_comercial
        entidad.ciudad = payload.ciudad or None
        entidad.rfc = payload.rfc
        entidad.regimen_fiscal = payload.regimen_fiscal
        entidad.logo_url = payload.logo_url or None
        entidad.tipo_fecha_corte = payload.tipo_fecha_corte
        entidad.activo = payload.activo
        entidad.fecha_pausa = payload.fecha_pausa
        entidad.save()
        audit(
            actor=request.auth.user,
            capa=entidad.capa_negocio,
            accion="ENTIDAD_ACTUALIZADA",
            recurso_tipo="EntidadNegocio",
            recurso_id=entidad.id,
            metadata={
                "nombre_comercial": entidad.nombre_comercial,
                "activo": entidad.activo,
            },
        )
        return {"success": True, "mensaje": "Entidad actualizada exitosamente"}
    except Exception as exc:
        raise HttpError(500, f"Error al actualizar entidad: {exc}")


@router.delete("/{entidad_id}/")
def borrar_entidad(request, entidad_id: int):
    require_entities_write_access(request)
    entidad = get_object_or_404(EntidadNegocio, id=entidad_id, id__in=get_allowed_entity_ids(request))
    audit(
        actor=request.auth.user,
        capa=entidad.capa_negocio,
        accion="ENTIDAD_ELIMINADA",
        recurso_tipo="EntidadNegocio",
        recurso_id=entidad.id,
        metadata={"nombre_comercial": entidad.nombre_comercial},
    )
    entidad.delete()
    return {"success": True, "mensaje": "Entidad eliminada"}


@router.get("/{entidad_id}/reglas/", response=List[ReglaOut])
def listar_reglas(request, entidad_id: int):
    require_entities_access(request)
    entidad = get_object_or_404(EntidadNegocio, id=entidad_id, id__in=get_allowed_entity_ids(request))
    return build_effective_entity_rules(entidad)


@router.get("/capas/{capa_id}/reglas/", response=List[ReglaOut])
def listar_reglas_marco(request, capa_id: int):
    require_entities_access(request)
    capa = get_object_or_404(get_accessible_capas_queryset(request), id=capa_id)
    reglas = (
        ReglaMarcoNegocio.objects.filter(capa_negocio=capa)
        .select_related("capa_negocio")
        .order_by("nombre")
    )
    return [serialize_regla_marco(regla, editable_en_entidad=True) for regla in reglas]


@router.post("/{entidad_id}/reglas/")
def crear_regla(request, entidad_id: int, payload: ReglaIn):
    require_entities_write_access(request)
    entidad = get_object_or_404(EntidadNegocio, id=entidad_id, id__in=get_allowed_entity_ids(request))
    try:
        nueva_regla = ReglaNegocio.objects.create(
            entidad=entidad,
            nombre=payload.nombre,
            tipo_calculo=payload.tipo_calculo,
            valor=payload.valor,
            periodicidad=payload.periodicidad,
            aplica_a_todos=payload.aplica_a_todos,
            dias_condicion=payload.dias_condicion,
            activo=payload.activo,
        )
        return {"id": nueva_regla.id, "mensaje": "Regla creada exitosamente"}
    except Exception as exc:
        raise HttpError(500, f"Error al crear regla: {exc}")


@router.post("/{entidad_id}/reglas/personalizar/")
def personalizar_regla_marco(request, entidad_id: int, payload: ReglaPersonalizadaIn):
    require_entities_write_access(request)
    entidad = get_object_or_404(
        EntidadNegocio.objects.select_related("capa_negocio"),
        id=entidad_id,
        id__in=get_allowed_entity_ids(request),
    )
    if not entidad.capa_negocio_id:
        raise HttpError(400, "La entidad no tiene una capa de negocio vinculada.")

    regla_marco = get_object_or_404(
        ReglaMarcoNegocio.objects.select_related("capa_negocio").filter(
            capa_negocio__in=get_accessible_capas_queryset(request)
        ),
        id=payload.regla_marco_id,
    )
    if regla_marco.capa_negocio_id != entidad.capa_negocio_id:
        raise HttpError(400, "La regla marco no pertenece a la capa de la entidad.")

    try:
        regla, created = ReglaNegocio.objects.update_or_create(
            entidad=entidad,
            regla_marco=regla_marco,
            defaults={
                "nombre": payload.nombre,
                "tipo_calculo": payload.tipo_calculo,
                "valor": payload.valor,
                "periodicidad": payload.periodicidad,
                "aplica_a_todos": payload.aplica_a_todos,
                "dias_condicion": payload.dias_condicion,
                "activo": payload.activo,
            },
        )
        message = (
            "Regla personalizada creada exitosamente"
            if created
            else "Regla personalizada actualizada exitosamente"
        )
        return {"id": regla.id, "mensaje": message}
    except Exception as exc:
        raise HttpError(500, f"Error al personalizar la regla: {exc}")


@router.post("/capas/{capa_id}/reglas/")
def crear_regla_marco(request, capa_id: int, payload: ReglaIn):
    require_entities_access(request)
    require_admin_access(request)
    capa = get_object_or_404(get_accessible_capas_queryset(request), id=capa_id)
    try:
        nueva_regla = ReglaMarcoNegocio.objects.create(
            capa_negocio=capa,
            nombre=payload.nombre,
            tipo_calculo=payload.tipo_calculo,
            valor=payload.valor,
            periodicidad=payload.periodicidad,
            aplica_a_todos=payload.aplica_a_todos,
            dias_condicion=payload.dias_condicion,
            activo=payload.activo,
        )
        return {"id": nueva_regla.id, "mensaje": "Regla marco creada exitosamente"}
    except Exception as exc:
        raise HttpError(500, f"Error al crear regla marco: {exc}")


@router.delete("/reglas/{regla_id}/")
def borrar_regla(request, regla_id: int):
    require_entities_write_access(request)
    regla = get_object_or_404(
        ReglaNegocio.objects.filter(entidad_id__in=get_allowed_entity_ids(request)),
        id=regla_id,
    )
    regla.delete()
    return {"success": True, "mensaje": "Regla eliminada"}


@router.delete("/capas/reglas/{regla_id}/")
def borrar_regla_marco(request, regla_id: int):
    require_entities_access(request)
    require_admin_access(request)
    regla = get_object_or_404(
        ReglaMarcoNegocio.objects.filter(capa_negocio__in=get_accessible_capas_queryset(request)),
        id=regla_id,
    )
    regla.delete()
    return {"success": True, "mensaje": "Regla marco eliminada"}


@router.put("/reglas/{regla_id}/")
def actualizar_regla(request, regla_id: int, payload: ReglaIn):
    require_entities_write_access(request)
    regla = get_object_or_404(
        ReglaNegocio.objects.filter(entidad_id__in=get_allowed_entity_ids(request)),
        id=regla_id,
    )
    try:
        regla.nombre = payload.nombre
        regla.tipo_calculo = payload.tipo_calculo
        regla.valor = payload.valor
        regla.periodicidad = payload.periodicidad
        regla.aplica_a_todos = payload.aplica_a_todos
        regla.dias_condicion = payload.dias_condicion
        regla.activo = payload.activo
        regla.save()
        return {"success": True, "mensaje": "Regla actualizada exitosamente"}
    except Exception as exc:
        raise HttpError(500, f"Error al actualizar regla: {exc}")


@router.put("/capas/reglas/{regla_id}/")
def actualizar_regla_marco(request, regla_id: int, payload: ReglaIn):
    require_entities_access(request)
    require_admin_access(request)
    regla = get_object_or_404(
        ReglaMarcoNegocio.objects.filter(capa_negocio__in=get_accessible_capas_queryset(request)),
        id=regla_id,
    )
    try:
        regla.nombre = payload.nombre
        regla.tipo_calculo = payload.tipo_calculo
        regla.valor = payload.valor
        regla.periodicidad = payload.periodicidad
        regla.aplica_a_todos = payload.aplica_a_todos
        regla.dias_condicion = payload.dias_condicion
        regla.activo = payload.activo
        regla.save()
        return {"success": True, "mensaje": "Regla marco actualizada exitosamente"}
    except Exception as exc:
        raise HttpError(500, f"Error al actualizar regla marco: {exc}")
