import csv
import base64
import io
import os
import re
import unicodedata
import uuid
from decimal import Decimal, InvalidOperation
from typing import Dict, Iterable, List, Optional, Tuple

import boto3
import pdfplumber
import requests
from django.conf import settings
from django.db.models import (
    DecimalField,
    Exists,
    ExpressionWrapper,
    F,
    OuterRef,
    Prefetch,
    Q,
    Sum,
    Value,
)
from django.db.models.functions import Coalesce
from django.core.files.storage import default_storage
from django.http import HttpResponse
from django.utils import timezone
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font
from ninja import File, Router, Schema
from ninja.errors import HttpError
from ninja.files import UploadedFile

from accounts.audit import audit
from accounts.security import (
    get_allowed_entity_ids,
    require_plan_feature,
    require_plan_module,
    require_write_access,
)
from billing.background_jobs import enqueue_background_job, store_background_upload
from billing.services import normalize_platform_app_base_url, platform_app_base_url
from comunicaciones.models import ConfiguracionComunicacion
from comunicaciones.outbound import build_portal_payload, build_portal_token
from core.fiscal import (
    FISCAL_REGIME_CODES,
    GENERIC_PUBLIC_NAME,
    GENERIC_PUBLIC_REGIME,
    GENERIC_PUBLIC_RFC,
    is_generic_public_rfc,
    normalize_fiscal_regime_code,
)
from empresas.models import EntidadNegocio

from .models import Cliente

router = Router()

CONTRACT_ALLOWED_EXTENSIONS = {".pdf", ".doc", ".docx", ".jpg", ".jpeg", ".png"}
CONTRACT_MAX_SIZE_BYTES = 15 * 1024 * 1024
GOOGLE_VISION_ANNOTATE_URL = "https://vision.googleapis.com/v1/images:annotate"
GOOGLE_VISION_CSF_FEATURE = "DOCUMENT_TEXT_DETECTION"
CSF_GOOGLE_VISION_MAX_PAGES = 3

REGIMEN_ALIAS_PATTERNS = {
    "601": (
        "regimen general de ley personas morales",
        "general de ley personas morales",
    ),
    "603": (
        "personas morales con fines no lucrativos",
    ),
    "605": (
        "sueldos y salarios",
        "ingresos asimilados a salarios",
    ),
    "606": (
        "arrendamiento",
    ),
    "612": (
        "actividades empresariales y profesionales",
        "actividad empresarial y profesional",
        "actividad empresarial",
    ),
    "621": (
        "incorporacion fiscal",
    ),
    "625": (
        "plataformas tecnologicas",
        "ingresos a traves de plataformas tecnologicas",
        "actividades empresariales con ingresos a traves de plataformas tecnologicas",
    ),
    "626": (
        "regimen simplificado de confianza",
        "resico",
    ),
}


def require_clientes_access(request):
    return require_plan_module(request, "clientes")


def require_clientes_write_access(request):
    require_clientes_access(request)
    return require_write_access(request)


def require_clientes_batch_access(request):
    require_clientes_write_access(request)
    return require_plan_feature(request, "batch_import")

KNOWN_REGIMENES = (
    "Regimen Simplificado de Confianza",
    "Regimen de las Actividades Empresariales y Profesionales",
    "Regimen General de Ley Personas Morales",
    "Regimen de las Personas Morales con Fines no Lucrativos",
    "Regimen de Arrendamiento",
    "Sueldos y Salarios e Ingresos Asimilados a Salarios",
    "Regimen de Incorporacion Fiscal",
)

KNOWN_LABELS = (
    "rfc",
    "curp",
    "denominacion/razon social",
    "denominacion o razon social",
    "nombre (s)",
    "nombre(s)",
    "nombre",
    "primer apellido",
    "segundo apellido",
    "fecha inicio de operaciones",
    "estatus en el padron",
    "fecha de ultimo cambio de estado",
    "nombre comercial",
    "datos del domicilio registrado",
    "regimen fiscal",
    "regimenes",
    "regimen",
    "regimen capital",
    "codigo postal",
    "tipo de vialidad",
    "nombre de vialidad",
    "numero exterior",
    "numero interior",
    "nombre de la colonia",
    "nombre de la localidad",
    "nombre del municipio o demarcacion territorial",
    "nombre de la entidad federativa",
    "actividades economicas",
    "obligaciones",
    "descripcion de la obligacion",
    "descripcion",
    "vencimiento",
    "fecha inicio",
    "fecha fin",
    "pagina",
    "cadena original sello",
    "sello digital",
    "sus datos personales",
    "correo electronico",
    "entre calle",
    "y calle",
)

ACCENT_INSENSITIVE_MAP = {
    "a": "[aáàäâ]",
    "e": "[eéèëê]",
    "i": "[iíìïî]",
    "o": "[oóòöô]",
    "u": "[uúùüû]",
    "n": "[nñ]",
}

COMMON_PREFIX_TOKENS = (
    "DANIEL",
    "ANTONIO",
    "JOSE",
    "MARIA",
    "JUAN",
    "CARLOS",
    "MIGUEL",
    "LUIS",
    "ALVARO",
    "BENITO",
    "CIUDAD",
    "SANTA",
    "SAN",
)

SAT_HEADER_NAME_NOISE = (
    "constancia de situacion fiscal",
    "cedula de identificacion fiscal",
    "valida tu informacion fiscal",
    "datos de identificacion del contribuyente",
    "registro federal de contribuyentes",
    "sus datos personales",
)

CLIENT_BATCH_HEADERS = [
    "Cliente ID",
    "Entidad ID",
    "Entidad",
    "Activo",
    "Es persona moral",
    "Nombre comercial",
    "Razon social",
    "RFC",
    "Regimen fiscal",
    "Identificador",
    "Condiciones pago",
    "Archivo CSF URL",
    "Correo principal",
    "Codigo pais",
    "Telefono",
    "Pais",
    "Estado",
    "Ciudad",
    "Colonia",
    "Calle",
    "Numero exterior",
    "Numero interior",
    "Codigo postal",
    "Agente cobranza",
    "Dia corte individual",
    "Dias gracia",
]

CLIENT_HEADER_ALIASES = {
    "cliente_id": {"cliente id", "id cliente", "id"},
    "entidad_id": {"entidad id", "unidad id"},
    "entidad": {"entidad", "unidad negocio", "unidad de negocio"},
    "activo": {"activo", "estatus", "estado"},
    "es_persona_moral": {"es persona moral", "persona moral", "tipo persona"},
    "nombre_comercial": {"nombre comercial"},
    "razon_social": {"razon social", "nombre", "nombre o razon social"},
    "rfc": {"rfc"},
    "regimen_fiscal": {"regimen fiscal"},
    "identificador": {"identificador"},
    "condiciones_pago": {"condiciones pago", "condiciones de pago"},
    "archivo_csf_url": {"archivo csf url", "csf url", "archivo csf"},
    "correo_principal": {"correo principal", "correo electronico", "correo"},
    "codigo_pais": {"codigo pais", "lada"},
    "telefono": {"telefono", "whatsapp", "celular"},
    "pais": {"pais"},
    "estado": {"estado"},
    "ciudad": {"ciudad", "localidad"},
    "colonia": {"colonia"},
    "calle": {"calle"},
    "numero_exterior": {"numero exterior", "no exterior"},
    "numero_interior": {"numero interior", "no interior"},
    "codigo_postal": {"codigo postal", "cp"},
    "agente_cobranza": {"agente cobranza"},
    "dia_corte_individual": {"dia corte individual", "dia corte", "fecha corte"},
    "dias_gracia": {"dias gracia", "gracia"},
}


class EntityOptionOut(Schema):
    id: int
    nombre: str


class ClienteListItemOut(Schema):
    id: int
    entidad_id: int
    identificador: Optional[str] = None
    nombre: str
    razon_social: str
    nombre_comercial: Optional[str] = None
    rfc: str
    entidad: str
    saldo: float
    estatus: str
    datosFiscalesCompletos: bool
    correo_principal: Optional[str] = None
    telefono: str
    activo: bool
    contrato_digital_url: Optional[str] = None
    contrato_digital_nombre: Optional[str] = None
    contrato_digital_cargado: bool = False
    consentimiento_cobranza_aceptado: bool = False
    consentimiento_cobranza_fecha: Optional[str] = None
    no_contactar_cobranza: bool = False
    no_contactar_cobranza_motivo: Optional[str] = None
    no_contactar_cobranza_fecha: Optional[str] = None


class ClienteListResponseOut(Schema):
    items: List[ClienteListItemOut]
    total: int
    page: int
    page_size: int
    total_pages: int
    entidades: List[EntityOptionOut]


class ClienteDetailOut(Schema):
    id: int
    entidad_relacionada_id: int
    entidad_relacionada_nombre: str
    es_persona_moral: bool
    nombre_comercial: Optional[str] = None
    razon_social: str
    rfc: str
    regimen_fiscal: Optional[str] = None
    identificador: Optional[str] = None
    condiciones_pago: Optional[str] = None
    archivo_csf_url: Optional[str] = None
    contrato_digital_url: Optional[str] = None
    contrato_digital_nombre: Optional[str] = None
    correo_principal: Optional[str] = None
    codigo_pais: str
    telefono: str
    pais: str
    estado: Optional[str] = None
    ciudad: Optional[str] = None
    colonia: Optional[str] = None
    calle: Optional[str] = None
    numero_exterior: Optional[str] = None
    numero_interior: Optional[str] = None
    codigo_postal: Optional[str] = None
    agente_cobranza: Optional[str] = None
    dia_corte_individual: Optional[int] = None
    dias_gracia: int
    consentimiento_cobranza_aceptado: bool = False
    consentimiento_cobranza_fecha: Optional[str] = None
    no_contactar_cobranza: bool = False
    no_contactar_cobranza_motivo: Optional[str] = None
    no_contactar_cobranza_fecha: Optional[str] = None
    activo: bool


class ClientePortalPreviewOut(Schema):
    cliente: Dict[str, object]
    resumen: Dict[str, object]
    comportamiento: Dict[str, object]
    tendencia_periodos: List[Dict[str, object]]
    pagos_recientes: List[Dict[str, object]]
    cuentas: List[Dict[str, object]]
    portal: Dict[str, object]
    facturacion: Dict[str, object]
    transferencia: Dict[str, object]
    datos_fiscales: Dict[str, object]


class ClienteIn(Schema):
    entidad_relacionada_id: int
    es_persona_moral: bool = False
    nombre_comercial: Optional[str] = None
    razon_social: str
    rfc: str = ""
    regimen_fiscal: Optional[str] = None
    identificador: Optional[str] = None
    condiciones_pago: Optional[str] = None
    archivo_csf_url: Optional[str] = None
    correo_principal: Optional[str] = None
    codigo_pais: str = "+52"
    telefono: str
    pais: str = "Mexico"
    estado: Optional[str] = None
    ciudad: Optional[str] = None
    colonia: Optional[str] = None
    calle: Optional[str] = None
    numero_exterior: Optional[str] = None
    numero_interior: Optional[str] = None
    codigo_postal: Optional[str] = None
    agente_cobranza: Optional[str] = None
    dia_corte_individual: Optional[int] = None
    dias_gracia: int = 0
    no_contactar_cobranza: bool = False
    no_contactar_cobranza_motivo: Optional[str] = None
    activo: bool = True


def normalize_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value or "")
    without_accents = "".join(
        char for char in normalized if not unicodedata.combining(char)
    )
    return re.sub(r"\s+", " ", without_accents).strip().lower()


def clean_value(value: Optional[str]) -> str:
    if not value:
        return ""
    return re.sub(r"\s+", " ", value).strip(" :;\t")


def flatten_text(raw_text: str) -> str:
    return re.sub(r"\s+", " ", raw_text or "").strip()


def split_text_lines(raw_text: str) -> List[Tuple[str, str]]:
    lines: List[Tuple[str, str]] = []
    for line in raw_text.splitlines():
        raw_line = clean_value(line)
        if raw_line:
            lines.append((raw_line, normalize_text(raw_line)))
    return lines


def looks_like_label(normalized_line: str) -> bool:
    return any(normalized_line.startswith(label) for label in KNOWN_LABELS)


def get_next_value(lines: List[Tuple[str, str]], start_index: int) -> str:
    for raw_line, normalized_line in lines[start_index : start_index + 3]:
        if normalized_line and not looks_like_label(normalized_line):
            return clean_value(raw_line)
    return ""


def extract_field(lines: List[Tuple[str, str]], labels: Iterable[str]) -> str:
    normalized_labels = tuple(normalize_text(label).rstrip(":") for label in labels)

    for index, (raw_line, normalized_line) in enumerate(lines):
        for label in normalized_labels:
            if normalized_line.startswith(f"{label}:"):
                after_colon = clean_value(raw_line.split(":", 1)[1])
                if after_colon and not looks_like_label(normalize_text(after_colon)):
                    return after_colon
                return get_next_value(lines, index + 1)

            if normalized_line == label:
                return get_next_value(lines, index + 1)

    return ""


def accent_insensitive_pattern(value: str) -> str:
    pattern_parts: List[str] = []
    for char in normalize_text(value):
        if char in ACCENT_INSENSITIVE_MAP:
            pattern_parts.append(ACCENT_INSENSITIVE_MAP[char])
        elif char.isspace():
            pattern_parts.append(r"\s*")
        else:
            pattern_parts.append(re.escape(char))
    return "".join(pattern_parts)


def extract_field_from_flat_text(flat_text: str, labels: Iterable[str]) -> str:
    if not flat_text:
        return ""

    stop_pattern = "|".join(
        accent_insensitive_pattern(label)
        for label in sorted(KNOWN_LABELS, key=len, reverse=True)
    )

    for label in labels:
        label_pattern = accent_insensitive_pattern(label)
        pattern = rf"(?<![A-Za-z]){label_pattern}(?![A-Za-z])\s*:?\s*(.*?)\s*(?=(?:{stop_pattern})\s*:?\s*|$)"
        match = re.search(pattern, flat_text, re.IGNORECASE)
        if match:
            return clean_value(match.group(1))

    return ""


def is_compacted_name(value: str) -> bool:
    cleaned = re.sub(r"[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]", "", value or "")
    return " " not in (value or "") and len(cleaned) >= 8


def restore_common_spacing(value: str) -> str:
    cleaned = clean_value(value)
    if not cleaned:
        return ""

    if re.search(r"\s", cleaned):
        return re.sub(r"\s+", " ", cleaned).strip()

    upper_value = cleaned.upper()
    replacements = (
        ("DELOS", " DE LOS "),
        ("DELAS", " DE LAS "),
        ("DELA", " DE LA "),
        ("CIUDADDE", "CIUDAD DE "),
    )

    for source, target in replacements:
        upper_value = upper_value.replace(source, target)

    upper_value = re.sub(r"\s+", " ", upper_value).strip()
    if " " in upper_value:
        return upper_value

    for token in sorted(COMMON_PREFIX_TOKENS, key=len, reverse=True):
        if upper_value.startswith(token) and len(upper_value) > len(token) + 3:
            return f"{token} {upper_value[len(token):]}"

    return cleaned


def clean_fiscal_name_candidate(
    value: Optional[str],
    rfc: str = "",
    *,
    allow_digits: bool = False,
) -> str:
    candidate = clean_value(value)
    if not candidate:
        return ""

    normalized = normalize_text(candidate)
    if any(noise in normalized for noise in SAT_HEADER_NAME_NOISE):
        return ""
    if "idcif" in normalized:
        return ""
    if rfc and rfc.lower() in normalized:
        return ""
    if re.search(r"\b[A-Z&]{3,4}\d{6}[A-Z0-9]{3}\b", candidate.upper()):
        return ""
    if not allow_digits and re.search(r"\d", candidate):
        return ""

    return candidate


def extract_best_value(
    lines: List[Tuple[str, str]],
    flat_text: str,
    labels: Iterable[str],
    prefer_flat: bool = False,
    compacted_name_fallback: bool = False,
) -> str:
    line_value = extract_field(lines, labels)
    flat_value = extract_field_from_flat_text(flat_text, labels)

    if prefer_flat and flat_value:
        return flat_value

    if compacted_name_fallback and is_compacted_name(line_value) and flat_value:
        return flat_value

    return line_value or flat_value


def extract_rfc(lines: List[Tuple[str, str]], flat_text: str, fallback_text: str) -> str:
    rfc_value = extract_best_value(lines, flat_text, ("RFC",), prefer_flat=True)
    if rfc_value:
        match = re.search(r"\b([A-Z&]{3,4}\d{6}[A-Z0-9]{3})\b", rfc_value.upper())
        if match:
            return match.group(1).strip()

    match = re.search(r"\b([A-Z&]{3,4}\d{6}[A-Z0-9]{3})\b", fallback_text.upper())
    if match:
        return match.group(1).strip()

    return ""


def build_regimen_option(code: str) -> Dict[str, str]:
    label = FISCAL_REGIME_CODES.get(code, code)
    return {
        "codigo": code,
        "descripcion": label,
        "label": f"{code} - {label}",
    }


def extract_regimen_options(
    texto_extraido: str,
    flat_text: str,
) -> List[Dict[str, str]]:
    combined_text = f"{texto_extraido} {flat_text}"
    normalized_combined = normalize_text(combined_text)
    matches: List[Tuple[int, str]] = []

    for code in FISCAL_REGIME_CODES:
        code_match = re.search(rf"\b{re.escape(code)}\b", combined_text)
        if code_match:
            matches.append((code_match.start(), code))

    for code, label in FISCAL_REGIME_CODES.items():
        normalized_label = normalize_text(label)
        index = normalized_combined.find(normalized_label)
        if index >= 0:
            matches.append((index, code))

    for regimen in KNOWN_REGIMENES:
        code = normalize_fiscal_regime_code(regimen)
        if code not in FISCAL_REGIME_CODES:
            continue
        index = normalized_combined.find(normalize_text(regimen))
        if index >= 0:
            matches.append((index, code))

    for code, patterns in REGIMEN_ALIAS_PATTERNS.items():
        for pattern in patterns:
            index = normalized_combined.find(normalize_text(pattern))
            if index >= 0:
                matches.append((index, code))
                break

    ordered_codes: List[str] = []
    for _index, code in sorted(matches, key=lambda item: item[0]):
        if code not in ordered_codes:
            ordered_codes.append(code)

    return [build_regimen_option(code) for code in ordered_codes]


def extract_regimen(
    texto_extraido: str,
    lines: List[Tuple[str, str]],
    flat_text: str,
) -> str:
    regimen_options = extract_regimen_options(texto_extraido, flat_text)
    if regimen_options:
        return regimen_options[0]["descripcion"]

    regimen_directo = extract_best_value(
        lines,
        flat_text,
        ("Regimen Fiscal", "Regimenes", "Regimen"),
        prefer_flat=True,
    )
    return clean_value(regimen_directo)


def build_razon_social(
    lines: List[Tuple[str, str]],
    flat_text: str,
    rfc: str,
) -> Tuple[str, bool]:
    razon_social = extract_best_value(
        lines,
        flat_text,
        (
            "Denominacion/Razon Social",
            "Denominacion o Razon Social",
        ),
        prefer_flat=True,
    )
    razon_social = clean_fiscal_name_candidate(razon_social, rfc, allow_digits=True)
    if razon_social:
        return restore_common_spacing(razon_social), True

    nombres = extract_best_value(
        lines,
        flat_text,
        ("Nombre (s)", "Nombre(s)"),
        prefer_flat=True,
        compacted_name_fallback=True,
    )
    nombres = clean_fiscal_name_candidate(nombres, rfc)
    if not nombres:
        nombres = clean_fiscal_name_candidate(extract_field(lines, ("Nombre",)), rfc)
    if not nombres and rfc:
        search_text = flat_text
        rfc_index = flat_text.upper().find(rfc.upper())
        if rfc_index >= 0:
            search_text = flat_text[rfc_index + len(rfc) :]
        labelled_name_match = re.search(
            r"Nombre\s*(?:\(\s*s\s*\))?\s*:?\s*([A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ\s]{1,100}?)\s+Primer\s*Apellido\s*:",
            search_text,
            re.IGNORECASE,
        )
        if labelled_name_match:
            nombres = clean_fiscal_name_candidate(labelled_name_match.group(1), rfc)
        compacted_match = re.search(
            r"([A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ\s]{3,80}?)\s+Primer\s*Apellido\s*:",
            search_text,
            re.IGNORECASE,
        )
        if not nombres and compacted_match:
            compacted_nombre = clean_fiscal_name_candidate(compacted_match.group(1), rfc)
            if compacted_nombre and not looks_like_label(normalize_text(compacted_nombre)):
                nombres = compacted_nombre
    primer_apellido = extract_best_value(
        lines,
        flat_text,
        ("Primer Apellido",),
        prefer_flat=True,
    )
    segundo_apellido = extract_best_value(
        lines,
        flat_text,
        ("Segundo Apellido",),
        prefer_flat=True,
    )
    primer_apellido = clean_fiscal_name_candidate(primer_apellido, rfc)
    segundo_apellido = clean_fiscal_name_candidate(segundo_apellido, rfc)

    nombre_completo = " ".join(
        part
        for part in (
            restore_common_spacing(nombres),
            restore_common_spacing(primer_apellido),
            restore_common_spacing(segundo_apellido),
        )
        if clean_value(part)
    ).strip()

    if nombre_completo:
        return nombre_completo, False

    if len(rfc) == 12:
        return "", True

    return "", False


def extract_csf_data_from_text(
    texto_extraido: str,
    flat_text: Optional[str] = None,
) -> Dict[str, object]:
    lines = split_text_lines(texto_extraido)
    flat_text = flatten_text(flat_text or texto_extraido)
    combined_text = f"{texto_extraido} {flat_text}"
    regimen_options = extract_regimen_options(texto_extraido, flat_text)
    regimen_pendiente_seleccion = len(regimen_options) > 1

    rfc = extract_rfc(lines, flat_text, combined_text)
    razon_social, es_persona_moral = build_razon_social(lines, flat_text, rfc)

    tipo_vialidad = restore_common_spacing(
        extract_best_value(
            lines,
            flat_text,
            ("Tipo de Vialidad",),
            prefer_flat=True,
        )
    )
    nombre_vialidad = restore_common_spacing(
        extract_best_value(
            lines,
            flat_text,
            ("Nombre de Vialidad",),
            prefer_flat=True,
        )
    )
    calle = nombre_vialidad
    if tipo_vialidad and nombre_vialidad:
        prefijo = normalize_text(tipo_vialidad)
        if not normalize_text(nombre_vialidad).startswith(prefijo):
            calle = f"{tipo_vialidad} {nombre_vialidad}".strip()

    localidad = restore_common_spacing(
        extract_best_value(
            lines,
            flat_text,
            ("Nombre de la Localidad",),
            prefer_flat=True,
        )
    )
    municipio = restore_common_spacing(
        extract_best_value(
            lines,
            flat_text,
            ("Nombre del Municipio o Demarcacion Territorial",),
            prefer_flat=True,
        )
    )
    correo = extract_best_value(
        lines,
        flat_text,
        ("Correo Electronico",),
        prefer_flat=True,
    )
    codigo_postal = extract_best_value(
        lines,
        flat_text,
        ("Codigo Postal",),
        prefer_flat=True,
    )
    if codigo_postal:
        codigo_postal = re.sub(r"\D", "", codigo_postal)[:5]

    datos: Dict[str, object] = {
        "rfc": rfc.upper(),
        "razon_social": razon_social,
        "regimen_fiscal": ""
        if regimen_pendiente_seleccion
        else extract_regimen(texto_extraido, lines, flat_text),
        "regimenes_fiscales_detectados": regimen_options,
        "regimen_fiscal_pendiente_seleccion": regimen_pendiente_seleccion,
        "codigo_postal": codigo_postal,
        "archivo_csf_url": "",
        "es_persona_moral": es_persona_moral or len(rfc) == 12,
        "pais": "Mexico",
        "estado": restore_common_spacing(
            extract_best_value(
                lines,
                flat_text,
                ("Nombre de la Entidad Federativa",),
                prefer_flat=True,
            )
        ),
        "ciudad": localidad or municipio,
        "colonia": restore_common_spacing(
            extract_best_value(
                lines,
                flat_text,
                ("Nombre de la Colonia",),
                prefer_flat=True,
            )
        ),
        "calle": restore_common_spacing(calle),
        "numero_exterior": extract_best_value(
            lines,
            flat_text,
            ("Numero Exterior",),
            prefer_flat=True,
        ),
        "numero_interior": extract_best_value(
            lines,
            flat_text,
            ("Numero Interior",),
            prefer_flat=True,
        ),
        "correo_principal": correo,
    }

    if len(rfc) == 13:
        datos["es_persona_moral"] = False

    return datos


def sanitize_cliente_data(data: Dict[str, object]) -> Dict[str, object]:
    datos_cliente = dict(data)

    strip_fields = (
        "nombre_comercial",
        "razon_social",
        "rfc",
        "regimen_fiscal",
        "identificador",
        "condiciones_pago",
        "archivo_csf_url",
        "correo_principal",
        "codigo_pais",
        "telefono",
        "pais",
        "estado",
        "ciudad",
        "colonia",
        "calle",
        "numero_exterior",
        "numero_interior",
        "codigo_postal",
        "agente_cobranza",
        "no_contactar_cobranza_motivo",
    )

    for field in strip_fields:
        value = datos_cliente.get(field)
        if isinstance(value, str):
            datos_cliente[field] = clean_value(value)

    datos_cliente["rfc"] = str(datos_cliente.get("rfc", "")).upper()
    if is_generic_public_rfc(datos_cliente["rfc"]):
        datos_cliente["rfc"] = GENERIC_PUBLIC_RFC
        datos_cliente["razon_social"] = GENERIC_PUBLIC_NAME
        datos_cliente["regimen_fiscal"] = GENERIC_PUBLIC_REGIME
        datos_cliente["codigo_postal"] = ""
        datos_cliente["es_persona_moral"] = False
        return datos_cliente

    codigo_postal = str(datos_cliente.get("codigo_postal", ""))
    if codigo_postal:
        datos_cliente["codigo_postal"] = re.sub(r"\D", "", codigo_postal)[:5]

    datos_cliente["dias_gracia"] = max(int(datos_cliente.get("dias_gracia") or 0), 0)
    datos_cliente["no_contactar_cobranza"] = bool(
        datos_cliente.get("no_contactar_cobranza")
    )
    motivo = clean_value(str(datos_cliente.get("no_contactar_cobranza_motivo") or ""))
    datos_cliente["no_contactar_cobranza_motivo"] = (
        motivo[:240] if datos_cliente["no_contactar_cobranza"] and motivo else None
    )
    dia_corte = datos_cliente.get("dia_corte_individual")
    if dia_corte in ("", None):
        datos_cliente["dia_corte_individual"] = None
    else:
        datos_cliente["dia_corte_individual"] = int(dia_corte)

    return datos_cliente


def sanitize_cliente_payload(payload: ClienteIn) -> Dict[str, object]:
    return sanitize_cliente_data(payload.dict(exclude={"entidad_relacionada_id"}))


def cliente_nombre(cliente: Cliente) -> str:
    for candidate in (cliente.nombre_comercial, cliente.razon_social):
        value = clean_value(candidate)
        normalized = normalize_text(value)
        if not value:
            continue
        if "idcif" in normalized or any(
            noise in normalized for noise in SAT_HEADER_NAME_NOISE
        ):
            continue
        return value

    return clean_value(cliente.rfc) or clean_value(cliente.identificador) or "Sin nombre"


def datos_fiscales_completos(cliente: Cliente) -> bool:
    if is_generic_public_rfc(cliente.rfc):
        return bool(clean_value(cliente.razon_social) and clean_value(cliente.regimen_fiscal or ""))
    return bool(
        clean_value(cliente.razon_social)
        and clean_value(cliente.rfc)
        and clean_value(cliente.regimen_fiscal or "")
        and clean_value(cliente.codigo_postal or "")
    )


def saldo_field():
    return DecimalField(max_digits=12, decimal_places=2)


def cliente_open_balance_filter() -> Q:
    return Q(
        cuentas_por_cobrar__estatus_adeudo__in=[
            "PENDIENTE",
            "PARCIAL",
            "VENCIDO",
            "POR_CONCILIAR",
        ],
    )




def build_client_queryset(allowed_entity_ids: Optional[list[int]] = None):
    queryset = Cliente.objects.select_related("entidad_relacionada")
    if allowed_entity_ids is not None:
        queryset = queryset.filter(entidad_relacionada_id__in=allowed_entity_ids)
    return queryset


def annotate_client_balances(queryset):
    saldo_expression = ExpressionWrapper(
        F("cuentas_por_cobrar__monto_total") - F("cuentas_por_cobrar__monto_pagado"),
        output_field=saldo_field(),
    )
    return queryset.annotate(
        saldo_pendiente=Coalesce(
            Sum(
                saldo_expression,
                filter=cliente_open_balance_filter(),
            ),
            Value(Decimal("0.00"), output_field=saldo_field()),
        )
    )


def serialize_cliente_list_item(cliente: Cliente) -> Dict[str, object]:
    return {
        "id": cliente.id,
        "entidad_id": cliente.entidad_relacionada_id,
        "identificador": cliente.identificador,
        "nombre": cliente_nombre(cliente),
        "razon_social": cliente.razon_social,
        "nombre_comercial": cliente.nombre_comercial,
        "rfc": cliente.rfc,
        "entidad": cliente.entidad_relacionada.nombre_comercial,
        "saldo": float(getattr(cliente, "saldo_pendiente", Decimal("0")) or Decimal("0")),
        "estatus": "Activo" if cliente.activo else "Inactivo",
        "datosFiscalesCompletos": datos_fiscales_completos(cliente),
        "correo_principal": cliente.correo_principal,
        "telefono": cliente.telefono,
        "activo": cliente.activo,
        "contrato_digital_url": cliente.contrato_digital_url,
        "contrato_digital_nombre": cliente.contrato_digital_nombre,
        "contrato_digital_cargado": bool(clean_value(cliente.contrato_digital_url)),
        "consentimiento_cobranza_aceptado": bool(
            cliente.consentimiento_cobranza_aceptado
        ),
        "consentimiento_cobranza_fecha": (
            cliente.consentimiento_cobranza_fecha.isoformat()
            if cliente.consentimiento_cobranza_fecha
            else None
        ),
        "no_contactar_cobranza": bool(cliente.no_contactar_cobranza),
        "no_contactar_cobranza_motivo": cliente.no_contactar_cobranza_motivo,
        "no_contactar_cobranza_fecha": (
            cliente.no_contactar_cobranza_fecha.isoformat()
            if cliente.no_contactar_cobranza_fecha
            else None
        ),
    }


def serialize_cliente_detail(cliente: Cliente) -> Dict[str, object]:
    return {
        "id": cliente.id,
        "entidad_relacionada_id": cliente.entidad_relacionada_id,
        "entidad_relacionada_nombre": cliente.entidad_relacionada.nombre_comercial,
        "es_persona_moral": cliente.es_persona_moral,
        "nombre_comercial": cliente.nombre_comercial,
        "razon_social": cliente.razon_social,
        "rfc": cliente.rfc,
        "regimen_fiscal": cliente.regimen_fiscal,
        "identificador": cliente.identificador,
        "condiciones_pago": cliente.condiciones_pago,
        "archivo_csf_url": cliente.archivo_csf_url,
        "contrato_digital_url": cliente.contrato_digital_url,
        "contrato_digital_nombre": cliente.contrato_digital_nombre,
        "correo_principal": cliente.correo_principal,
        "codigo_pais": cliente.codigo_pais,
        "telefono": cliente.telefono,
        "pais": cliente.pais,
        "estado": cliente.estado,
        "ciudad": cliente.ciudad,
        "colonia": cliente.colonia,
        "calle": cliente.calle,
        "numero_exterior": cliente.numero_exterior,
        "numero_interior": cliente.numero_interior,
        "codigo_postal": cliente.codigo_postal,
        "agente_cobranza": cliente.agente_cobranza,
        "dia_corte_individual": cliente.dia_corte_individual,
        "dias_gracia": cliente.dias_gracia,
        "consentimiento_cobranza_aceptado": bool(
            cliente.consentimiento_cobranza_aceptado
        ),
        "consentimiento_cobranza_fecha": (
            cliente.consentimiento_cobranza_fecha.isoformat()
            if cliente.consentimiento_cobranza_fecha
            else None
        ),
        "no_contactar_cobranza": bool(cliente.no_contactar_cobranza),
        "no_contactar_cobranza_motivo": cliente.no_contactar_cobranza_motivo,
        "no_contactar_cobranza_fecha": (
            cliente.no_contactar_cobranza_fecha.isoformat()
            if cliente.no_contactar_cobranza_fecha
            else None
        ),
        "activo": cliente.activo,
    }


def apply_cliente_payload(cliente: Cliente, entidad: EntidadNegocio, payload: ClienteIn) -> Cliente:
    datos_cliente = sanitize_cliente_payload(payload)
    cliente.entidad_relacionada = entidad
    for field, value in datos_cliente.items():
        setattr(cliente, field, value)
    return cliente


def get_cliente_portal_config(capa) -> ConfiguracionComunicacion:
    return (
        ConfiguracionComunicacion.objects.filter(capa_negocio=capa, activo=True)
        .order_by("clave", "id")
        .first()
        or ConfiguracionComunicacion.objects.filter(capa_negocio__isnull=True, activo=True)
        .order_by("id")
        .first()
        or ConfiguracionComunicacion(portal_token_horas=168)
    )


def build_cliente_portal_link(
    cliente: Cliente,
    *,
    config: ConfiguracionComunicacion | None = None,
) -> Dict[str, object]:
    capa = cliente.entidad_relacionada.capa_negocio
    config = config or get_cliente_portal_config(capa)
    token_horas = max(getattr(config, "portal_token_horas", 168) or 168, 1)
    token = build_portal_token(cliente=cliente, horas=token_horas)
    portal_base = (
        getattr(capa, "portal_clientes_url_base", None)
        or os.getenv("FRONTEND_BASE_URL")
        or platform_app_base_url()
    )
    portal_base = normalize_platform_app_base_url(str(portal_base))
    return {
        "token": token,
        "url": f"{str(portal_base).strip().rstrip('/')}/portal-cliente/{token}",
        "token_horas": token_horas,
    }


def build_cliente_portal_preview(cliente: Cliente) -> Dict[str, object]:
    capa = cliente.entidad_relacionada.capa_negocio
    config = get_cliente_portal_config(capa)
    portal_link = build_cliente_portal_link(cliente, config=config)
    payload = build_portal_payload(token=str(portal_link["token"]))
    payload["portal"] = {
        **payload.get("portal", {}),
        **portal_link,
    }
    return payload


def get_google_vision_api_key() -> str:
    return (
        (getattr(settings, "GOOGLE_VISION_API_KEY", "") or "").strip()
        or (getattr(settings, "GOOGLE_API_KEY", "") or "").strip()
    )


def extract_google_vision_text(response_data: dict) -> str:
    responses = response_data.get("responses") or []
    text_parts: List[str] = []
    for response in responses:
        if not isinstance(response, dict) or response.get("error"):
            continue
        full_text = response.get("fullTextAnnotation") or {}
        if isinstance(full_text.get("text"), str) and full_text["text"].strip():
            text_parts.append(full_text["text"].strip())
            continue
        annotations = response.get("textAnnotations") or []
        if annotations and isinstance(annotations[0], dict):
            description = annotations[0].get("description")
            if isinstance(description, str) and description.strip():
                text_parts.append(description.strip())
    return "\n\n".join(text_parts).strip()


def extract_google_vision_error(response_data: dict) -> str:
    error = response_data.get("error")
    if isinstance(error, dict):
        message = str(error.get("message") or "").strip()
        status = str(error.get("status") or "").strip()
        if message and status:
            return f"{status}: {message}"
        return message
    responses = response_data.get("responses") or []
    for response in responses:
        if not isinstance(response, dict):
            continue
        response_error = response.get("error")
        if isinstance(response_error, dict):
            message = str(response_error.get("message") or "").strip()
            code = response_error.get("code")
            if message and code:
                return f"{code}: {message}"
            if message:
                return message
    return ""


def render_pdf_pages_for_vision(raw_content: bytes) -> List[bytes]:
    try:
        import pypdfium2 as pdfium
    except Exception:
        return []

    rendered_pages: List[bytes] = []
    try:
        pdf = pdfium.PdfDocument(raw_content)
        page_count = min(len(pdf), CSF_GOOGLE_VISION_MAX_PAGES)
        for index in range(page_count):
            page = pdf[index]
            bitmap = page.render(scale=2.0)
            image = bitmap.to_pil()
            output = io.BytesIO()
            image.save(output, format="PNG")
            rendered_pages.append(output.getvalue())
    except Exception:
        return rendered_pages
    return rendered_pages


def extract_csf_text_with_google_vision(raw_content: bytes) -> Tuple[str, str]:
    api_key = get_google_vision_api_key()
    if not api_key:
        return "", ""

    rendered_pages = render_pdf_pages_for_vision(raw_content)
    if not rendered_pages:
        return "", "No se pudo preparar la CSF para lectura visual con Google Vision."

    request_payload = {
        "requests": [
            {
                "image": {
                    "content": base64.b64encode(page_content).decode("ascii"),
                },
                "features": [{"type": GOOGLE_VISION_CSF_FEATURE, "maxResults": 1}],
                "imageContext": {"languageHints": ["es"]},
            }
            for page_content in rendered_pages
        ]
    }
    try:
        response = requests.post(
            GOOGLE_VISION_ANNOTATE_URL,
            params={"key": api_key},
            json=request_payload,
            timeout=45,
        )
        response_data = response.json()
        if response.status_code >= 400:
            detail = extract_google_vision_error(response_data)
            return "", f"Google Vision rechazo la CSF ({response.status_code}): {detail or response.text[:300]}"
        response_error = extract_google_vision_error(response_data)
        if response_error:
            return "", f"Google Vision regreso error al leer la CSF: {response_error}"
        return extract_google_vision_text(response_data), ""
    except Exception as error:
        return "", f"No se pudo completar la lectura visual de la CSF: {error}"


def extract_csf_data_from_upload(file: UploadedFile) -> Dict[str, object]:
    if not file.name.lower().endswith(".pdf"):
        raise HttpError(400, "El archivo debe ser un PDF.")

    texto_extraido = ""
    texto_lineal = ""
    raw_content = file.read()
    file.seek(0)

    try:
        with pdfplumber.open(io.BytesIO(raw_content)) as pdf:
            for page in pdf.pages:
                page_text = page.extract_text() or ""
                texto_extraido += page_text + "\n"

                words = page.extract_words() or []
                if words:
                    words_text = " ".join(
                        word["text"] for word in words if word.get("text")
                    )
                    texto_lineal += f"{flatten_text(page_text)} {words_text}\n"
                else:
                    texto_lineal += flatten_text(page_text) + "\n"
    except Exception as error:
        raise HttpError(400, f"No se pudo leer el PDF: {error}")

    pdf_text_available = bool(texto_extraido.strip() or texto_lineal.strip())
    vision_error = ""
    vision_text = ""
    if get_google_vision_api_key():
        vision_text, vision_error = extract_csf_text_with_google_vision(raw_content)
        if vision_text:
            texto_extraido = f"{texto_extraido}\n{vision_text}".strip()
            texto_lineal = f"{texto_lineal}\n{flatten_text(vision_text)}".strip()

    texto_prueba = normalize_text(f"{texto_extraido} {texto_lineal}")
    es_csf = (
        "constancia de situacion" in texto_prueba
        or "cedula de identificacion" in texto_prueba
    )
    if not es_csf:
        raise HttpError(
            400,
            "El documento no parece ser una Constancia de Situacion Fiscal del SAT.",
        )

    datos = extract_csf_data_from_text(texto_extraido, texto_lineal)
    datos["csf_lectura"] = {
        "fuentes": [
            fuente
            for fuente, texto in (
                ("pdf_text", "ok" if pdf_text_available else ""),
                ("google_vision", vision_text),
            )
            if texto
        ],
        "google_vision_error": vision_error,
    }
    return datos


def upload_csf_to_r2(file: UploadedFile) -> str:
    s3 = boto3.client(
        "s3",
        endpoint_url=os.environ.get("R2_ENDPOINT_URL"),
        aws_access_key_id=os.environ.get("R2_ACCESS_KEY_ID"),
        aws_secret_access_key=os.environ.get("R2_SECRET_ACCESS_KEY"),
        region_name="auto",
    )

    nombre_archivo = f"csf/{uuid.uuid4()}_{file.name.replace(' ', '_')}"
    bucket_name = "betterp-storage"

    file.seek(0)
    s3.upload_fileobj(
        file,
        bucket_name,
        nombre_archivo,
        ExtraArgs={"ContentType": "application/pdf"},
    )

    dominio_publico = os.environ.get("R2_PUBLIC_DOMAIN", "https://tu-dominio-r2.com")
    return f"{dominio_publico}/{nombre_archivo}"


def sanitize_upload_filename(filename: str, fallback: str = "archivo") -> str:
    basename = os.path.basename(filename or fallback)
    sanitized = re.sub(r"[^A-Za-z0-9._-]+", "_", basename).strip("._")
    return (sanitized or fallback)[:140]


def validate_contract_upload(file: UploadedFile) -> str:
    filename = sanitize_upload_filename(getattr(file, "name", "") or "contrato")
    extension = os.path.splitext(filename)[1].lower()
    if extension not in CONTRACT_ALLOWED_EXTENSIONS:
        raise HttpError(
            400,
            "El contrato debe ser PDF, Word o imagen (.pdf, .doc, .docx, .jpg, .jpeg, .png).",
        )

    file_size = getattr(file, "size", None)
    if file_size is not None and file_size > CONTRACT_MAX_SIZE_BYTES:
        raise HttpError(400, "El contrato no puede superar 15 MB.")

    return filename


def upload_contract_to_r2(file: UploadedFile, cliente_id: int) -> Tuple[str, str]:
    filename = validate_contract_upload(file)
    content_type = getattr(file, "content_type", None) or "application/octet-stream"

    s3 = boto3.client(
        "s3",
        endpoint_url=os.environ.get("R2_ENDPOINT_URL"),
        aws_access_key_id=os.environ.get("R2_ACCESS_KEY_ID"),
        aws_secret_access_key=os.environ.get("R2_SECRET_ACCESS_KEY"),
        region_name="auto",
    )

    nombre_archivo = f"contratos/clientes/{cliente_id}/{uuid.uuid4()}_{filename}"
    bucket_name = "betterp-storage"

    file.seek(0)
    s3.upload_fileobj(
        file,
        bucket_name,
        nombre_archivo,
        ExtraArgs={"ContentType": content_type},
    )

    dominio_publico = os.environ.get("R2_PUBLIC_DOMAIN", "https://tu-dominio-r2.com")
    return f"{dominio_publico}/{nombre_archivo}", filename


def apply_csf_data_to_cliente(cliente: Cliente, datos: Dict[str, object]) -> List[str]:
    previous_display_name = clean_value(cliente_nombre(cliente))
    previous_razon_social = clean_value(cliente.razon_social)
    should_preserve_display_name = (
        "razon_social" in datos
        and not clean_value(cliente.nombre_comercial)
        and previous_razon_social
        and previous_display_name == previous_razon_social
    )
    fields = [
        "es_persona_moral",
        "razon_social",
        "rfc",
        "regimen_fiscal",
        "regimenes_fiscales_detectados",
        "regimen_fiscal_pendiente_seleccion",
        "estado",
        "ciudad",
        "colonia",
        "calle",
        "numero_exterior",
        "numero_interior",
        "codigo_postal",
        "archivo_csf_url",
    ]
    changed_fields = []
    if should_preserve_display_name:
        cliente.nombre_comercial = previous_display_name
        changed_fields.append("nombre_comercial")

    for field in fields:
        if field not in datos:
            continue
        value = datos.get(field)
        if (
            value in (None, "")
            and field not in ("archivo_csf_url", "regimen_fiscal")
        ):
            continue
        if field == "regimen_fiscal" and datos.get("regimen_fiscal_pendiente_seleccion"):
            value = ""
        if field == "rfc" and value:
            value = str(value).upper()
        setattr(cliente, field, value)
        changed_fields.append(field)

    if changed_fields:
        cliente.save(update_fields=changed_fields)
    return changed_fields


def normalize_header(value: object) -> str:
    text = str(value or "").strip().lower()
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return " ".join(text.split())


def load_rows_from_file(upload: UploadedFile) -> List[List[object]]:
    return load_rows_from_file_object(upload.file, upload.name or "")


def load_rows_from_file_object(file_object, file_name: str) -> List[List[object]]:
    extension = os.path.splitext(file_name or "")[1].lower()
    if extension in {".xlsx", ".xlsm"}:
        file_object.seek(0)
        workbook = load_workbook(file_object, data_only=True)
        sheet = workbook.active
        return [list(row) for row in sheet.iter_rows(values_only=True)]

    if extension == ".csv":
        file_object.seek(0)
        content = file_object.read().decode("utf-8-sig")
        reader = csv.reader(io.StringIO(content))
        return [list(row) for row in reader]

    raise HttpError(400, "Solo se permiten archivos .xlsx, .xlsm o .csv.")


def is_blank_row(row: List[object]) -> bool:
    return all(clean_value(str(value or "")) == "" for value in row)


def get_row_value(row: List[object], mapping: Dict[str, int], key: str) -> object:
    index = mapping.get(key)
    if index is None or index >= len(row):
        return None
    return row[index]


def resolve_batch_header_mapping(rows: List[List[object]]) -> Tuple[int, Dict[str, int]]:
    required_keys = {"razon_social"}

    for row_index, row in enumerate(rows, start=1):
        mapping: Dict[str, int] = {}
        for column_index, value in enumerate(row):
            normalized = normalize_header(value)
            if not normalized:
                continue
            for logical_name, aliases in CLIENT_HEADER_ALIASES.items():
                if normalized in aliases and logical_name not in mapping:
                    mapping[logical_name] = column_index
                    break

        if required_keys.issubset(mapping.keys()) and (
            "entidad_id" in mapping or "entidad" in mapping or "cliente_id" in mapping
        ):
            return row_index, mapping

    raise HttpError(
        400,
        "No se encontraron encabezados validos. Descarga la plantilla actualizada de clientes y vuelve a intentarlo.",
    )


def parse_bool_cell(value: object, default: bool = False) -> bool:
    if value in (None, ""):
        return default
    if isinstance(value, bool):
        return value

    normalized = normalize_text(str(value))
    if normalized in {
        "1",
        "true",
        "si",
        "yes",
        "activo",
        "activa",
        "moral",
        "persona moral",
    }:
        return True
    if normalized in {
        "0",
        "false",
        "no",
        "inactivo",
        "inactiva",
        "fisica",
        "persona fisica",
    }:
        return False
    return default


def parse_optional_int_cell(value: object) -> Optional[int]:
    if value in (None, ""):
        return None
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)

    text = clean_value(str(value))
    if not text:
        return None

    try:
        return int(float(text))
    except ValueError as exc:
        raise ValueError(f"No se pudo interpretar el numero '{text}'.") from exc


def parse_decimal_cell(value: object) -> Decimal:
    if value in (None, ""):
        return Decimal("0")
    if isinstance(value, Decimal):
        return value
    if isinstance(value, (int, float)):
        return Decimal(str(value))

    text = clean_value(str(value)).replace("$", "").replace(",", "")
    if not text:
        return Decimal("0")

    try:
        return Decimal(text)
    except InvalidOperation as exc:
        raise ValueError(f"No se pudo interpretar el valor '{text}'.") from exc


def resolve_entity_for_batch(
    *,
    entity_id_value: object,
    entity_name_value: object,
    existing_cliente: Optional[Cliente],
    allowed_entity_ids: list[int],
) -> EntidadNegocio:
    entity_id = parse_optional_int_cell(entity_id_value)
    entity_name = clean_value(str(entity_name_value or ""))

    if entity_id:
        entidad = EntidadNegocio.objects.filter(
            id=entity_id,
            id__in=allowed_entity_ids,
        ).first()
        if not entidad:
            raise ValueError(f"No existe la entidad con ID {entity_id}.")
        return entidad

    if entity_name:
        entidad = EntidadNegocio.objects.filter(
            id__in=allowed_entity_ids,
            nombre_comercial__iexact=entity_name
        ).first()
        if not entidad:
            raise ValueError(f"No existe la entidad '{entity_name}'.")
        return entidad

    if (
        existing_cliente
        and existing_cliente.entidad_relacionada_id in allowed_entity_ids
    ):
        return existing_cliente.entidad_relacionada

    raise ValueError("Cada fila debe indicar Entidad ID o Entidad.")


def find_existing_cliente_for_batch(
    *,
    entidad: Optional[EntidadNegocio],
    cliente_id_value: object,
    rfc_value: str,
    identificador_value: str,
    correo_value: str,
    telefono_value: str,
    allowed_entity_ids: list[int],
) -> Optional[Cliente]:
    cliente_id = parse_optional_int_cell(cliente_id_value)
    queryset = Cliente.objects.select_related("entidad_relacionada").filter(
        entidad_relacionada_id__in=allowed_entity_ids
    )
    if cliente_id:
        return queryset.filter(id=cliente_id).first()

    if entidad:
        queryset = queryset.filter(entidad_relacionada=entidad)

    if rfc_value:
        cliente = queryset.filter(rfc__iexact=rfc_value).first()
        if cliente:
            return cliente

    if identificador_value:
        cliente = queryset.filter(identificador__iexact=identificador_value).first()
        if cliente:
            return cliente

    if correo_value:
        cliente = queryset.filter(correo_principal__iexact=correo_value).first()
        if cliente:
            return cliente

    if telefono_value:
        cliente = queryset.filter(telefono=telefono_value).first()
        if cliente:
            return cliente

    return None


def build_cliente_batch_workbook(allowed_entity_ids: list[int]) -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Clientes"
    sheet.append(CLIENT_BATCH_HEADERS)

    for column in range(1, len(CLIENT_BATCH_HEADERS) + 1):
        sheet.cell(row=1, column=column).font = Font(bold=True)

    clientes = (
        Cliente.objects.select_related("entidad_relacionada")
        .filter(entidad_relacionada_id__in=allowed_entity_ids)
        .order_by("entidad_relacionada__nombre_comercial", "razon_social", "id")
    )

    for cliente in clientes:
        sheet.append(
            [
                cliente.id,
                cliente.entidad_relacionada_id,
                cliente.entidad_relacionada.nombre_comercial,
                "Si" if cliente.activo else "No",
                "Si" if cliente.es_persona_moral else "No",
                cliente.nombre_comercial,
                cliente.razon_social,
                cliente.rfc,
                cliente.regimen_fiscal,
                cliente.identificador,
                cliente.condiciones_pago,
                cliente.archivo_csf_url,
                cliente.correo_principal,
                cliente.codigo_pais,
                cliente.telefono,
                cliente.pais,
                cliente.estado,
                cliente.ciudad,
                cliente.colonia,
                cliente.calle,
                cliente.numero_exterior,
                cliente.numero_interior,
                cliente.codigo_postal,
                cliente.agente_cobranza,
                cliente.dia_corte_individual,
                cliente.dias_gracia,
            ]
        )

    for column_cells in sheet.columns:
        max_length = 0
        column_letter = column_cells[0].column_letter
        for cell in column_cells:
            cell_value = "" if cell.value is None else str(cell.value)
            max_length = max(max_length, len(cell_value))
        sheet.column_dimensions[column_letter].width = min(max(max_length + 2, 14), 28)

    output = io.BytesIO()
    workbook.save(output)
    return output.getvalue()




@router.get("/cliente/{cliente_id}/", response=ClienteDetailOut)
def obtener_cliente(request, cliente_id: int):
    require_clientes_access(request)
    cliente = (
        Cliente.objects.select_related("entidad_relacionada")
        .filter(id=cliente_id, entidad_relacionada_id__in=get_allowed_entity_ids(request))
        .first()
    )
    if not cliente:
        raise HttpError(404, "No se encontro el cliente solicitado.")
    return serialize_cliente_detail(cliente)


@router.get("/cliente/{cliente_id}/portal-preview/", response=ClientePortalPreviewOut)
def obtener_portal_cliente_preview(request, cliente_id: int):
    require_clientes_access(request)
    cliente = (
        Cliente.objects.select_related(
            "entidad_relacionada",
            "entidad_relacionada__capa_negocio",
        )
        .filter(id=cliente_id, entidad_relacionada_id__in=get_allowed_entity_ids(request))
        .first()
    )
    if not cliente:
        raise HttpError(404, "No se encontro el cliente solicitado.")
    if not cliente.activo:
        raise HttpError(400, "El portal solo esta disponible para clientes activos.")

    return build_cliente_portal_preview(cliente)


@router.get("/cliente/{cliente_id}/portal-link/")
def obtener_portal_cliente_link(request, cliente_id: int):
    require_clientes_access(request)
    cliente = (
        Cliente.objects.select_related(
            "entidad_relacionada",
            "entidad_relacionada__capa_negocio",
        )
        .filter(id=cliente_id, entidad_relacionada_id__in=get_allowed_entity_ids(request))
        .first()
    )
    if not cliente:
        raise HttpError(404, "No se encontro el cliente solicitado.")
    if not cliente.activo:
        raise HttpError(400, "El portal solo esta disponible para clientes activos.")

    return {
        "cliente": {
            "id": cliente.id,
            "nombre": cliente.razon_social or cliente.nombre_comercial or "Sin nombre",
        },
        "portal": build_cliente_portal_link(cliente),
    }


@router.post("/crear/")
def crear_cliente(request, payload: ClienteIn):
    require_clientes_write_access(request)
    try:
        entidad = EntidadNegocio.objects.get(
            id=payload.entidad_relacionada_id,
            id__in=get_allowed_entity_ids(request),
        )
        datos_cliente = sanitize_cliente_payload(payload)
        nuevo_cliente = Cliente.objects.create(
            entidad_relacionada=entidad,
            **datos_cliente,
        )
        if nuevo_cliente.no_contactar_cobranza and not nuevo_cliente.no_contactar_cobranza_fecha:
            nuevo_cliente.no_contactar_cobranza_fecha = timezone.now()
            nuevo_cliente.save(update_fields=["no_contactar_cobranza_fecha"])
        audit(
            actor=request.auth.user,
            capa=entidad.capa_negocio,
            accion="CLIENTE_CREADO",
            recurso_tipo="Cliente",
            recurso_id=nuevo_cliente.id,
            metadata={
                "entidad_id": entidad.id,
                "razon_social": nuevo_cliente.razon_social,
                "rfc": nuevo_cliente.rfc,
            },
        )
        return {"id": nuevo_cliente.id, "mensaje": "Cliente guardado con exito"}
    except EntidadNegocio.DoesNotExist:
        raise HttpError(404, f"No existe la Entidad con ID {payload.entidad_relacionada_id}.")
    except Exception as error:
        raise HttpError(500, f"Error interno: {error}")


@router.put("/cliente/{cliente_id}/")
def actualizar_cliente(request, cliente_id: int, payload: ClienteIn):
    require_clientes_write_access(request)
    allowed_entity_ids = get_allowed_entity_ids(request)
    cliente = (
        Cliente.objects.select_related("entidad_relacionada")
        .filter(id=cliente_id, entidad_relacionada_id__in=allowed_entity_ids)
        .first()
    )
    if not cliente:
        raise HttpError(404, "No se encontro el cliente solicitado.")

    try:
        previous_no_contactar = bool(cliente.no_contactar_cobranza)
        previous_motivo = cliente.no_contactar_cobranza_motivo
        entidad = EntidadNegocio.objects.get(
            id=payload.entidad_relacionada_id,
            id__in=allowed_entity_ids,
        )
        cliente = apply_cliente_payload(cliente, entidad, payload)
        current_no_contactar = bool(cliente.no_contactar_cobranza)
        if current_no_contactar and (
            not previous_no_contactar or not cliente.no_contactar_cobranza_fecha
        ):
            cliente.no_contactar_cobranza_fecha = timezone.now()
        elif not current_no_contactar:
            cliente.no_contactar_cobranza_fecha = None
            cliente.no_contactar_cobranza_motivo = None
        cliente.save()
        audit(
            actor=request.auth.user,
            capa=entidad.capa_negocio,
            accion="CLIENTE_ACTUALIZADO",
            recurso_tipo="Cliente",
            recurso_id=cliente.id,
            metadata={"entidad_id": entidad.id, "razon_social": cliente.razon_social},
        )
        if (
            previous_no_contactar != current_no_contactar
            or previous_motivo != cliente.no_contactar_cobranza_motivo
        ):
            audit(
                actor=request.auth.user,
                capa=entidad.capa_negocio,
                accion="CLIENTE_COBRANZA_CONTACTO_ACTUALIZADO",
                recurso_tipo="Cliente",
                recurso_id=cliente.id,
                metadata={
                    "entidad_id": entidad.id,
                    "bloqueado": current_no_contactar,
                    "motivo": cliente.no_contactar_cobranza_motivo,
                },
            )
        return {"success": True, "mensaje": "Cliente actualizado con exito."}
    except EntidadNegocio.DoesNotExist:
        raise HttpError(404, f"No existe la Entidad con ID {payload.entidad_relacionada_id}.")
    except Exception as error:
        raise HttpError(500, f"Error interno: {error}")


@router.delete("/cliente/{cliente_id}/")
def eliminar_cliente(request, cliente_id: int):
    require_clientes_write_access(request)
    cliente = (
        Cliente.objects.select_related("entidad_relacionada")
        .filter(id=cliente_id, entidad_relacionada_id__in=get_allowed_entity_ids(request))
        .first()
    )
    if not cliente:
        raise HttpError(404, "No se encontro el cliente solicitado.")

    tiene_historial = (
        cliente.cuentas_por_cobrar.exists()
        or cliente.servicios_contratados.exists()
    )

    if tiene_historial:
        if cliente.activo:
            cliente.activo = False
            cliente.save(update_fields=["activo"])
        audit(
            actor=request.auth.user,
            capa=cliente.entidad_relacionada.capa_negocio,
            accion="CLIENTE_DESACTIVADO",
            recurso_tipo="Cliente",
            recurso_id=cliente.id,
            metadata={"entidad_id": cliente.entidad_relacionada_id, "con_historial": True},
        )
        return {
            "success": True,
            "accion": "desactivado",
            "mensaje": "El cliente tiene historial relacionado. Se desactivo para conservar integridad operativa.",
        }

    audit(
        actor=request.auth.user,
        capa=cliente.entidad_relacionada.capa_negocio,
        accion="CLIENTE_ELIMINADO",
        recurso_tipo="Cliente",
        recurso_id=cliente.id,
        metadata={"entidad_id": cliente.entidad_relacionada_id, "con_historial": False},
    )
    cliente.delete()
    return {
        "success": True,
        "accion": "eliminado",
        "mensaje": "Cliente eliminado correctamente.",
    }


@router.post("/cliente/{cliente_id}/reactivar/")
def reactivar_cliente(request, cliente_id: int):
    require_clientes_write_access(request)
    cliente = (
        Cliente.objects.select_related("entidad_relacionada")
        .filter(id=cliente_id, entidad_relacionada_id__in=get_allowed_entity_ids(request))
        .first()
    )
    if not cliente:
        raise HttpError(404, "No se encontro el cliente solicitado.")

    if not cliente.activo:
        cliente.activo = True
        cliente.save(update_fields=["activo"])

    audit(
        actor=request.auth.user,
        capa=cliente.entidad_relacionada.capa_negocio,
        accion="CLIENTE_REACTIVADO",
        recurso_tipo="Cliente",
        recurso_id=cliente.id,
        metadata={"entidad_id": cliente.entidad_relacionada_id},
    )
    return {
        "success": True,
        "accion": "reactivado",
        "mensaje": "Cliente reactivado correctamente.",
    }


@router.post("/cliente/{cliente_id}/contrato/")
def cargar_contrato_cliente(request, cliente_id: int, file: UploadedFile = File(...)):
    require_clientes_write_access(request)
    cliente = (
        Cliente.objects.select_related("entidad_relacionada")
        .filter(id=cliente_id, entidad_relacionada_id__in=get_allowed_entity_ids(request))
        .first()
    )
    if not cliente:
        raise HttpError(404, "No se encontro el cliente solicitado.")

    try:
        contrato_url, contrato_nombre = upload_contract_to_r2(file, cliente.id)
        cliente.contrato_digital_url = contrato_url
        cliente.contrato_digital_nombre = contrato_nombre
        cliente.save(update_fields=["contrato_digital_url", "contrato_digital_nombre"])
        audit(
            actor=request.auth.user,
            capa=cliente.entidad_relacionada.capa_negocio,
            accion="CLIENTE_CONTRATO_DIGITAL_CARGADO",
            recurso_tipo="Cliente",
            recurso_id=cliente.id,
            metadata={
                "entidad_id": cliente.entidad_relacionada_id,
                "cliente": cliente_nombre(cliente),
                "archivo": contrato_nombre,
            },
        )
    except HttpError:
        raise
    except Exception as error:
        raise HttpError(500, f"No se pudo guardar el contrato digital: {error}")

    return {
        "success": True,
        "mensaje": "Contrato digital cargado correctamente.",
        "contrato_digital_url": contrato_url,
        "contrato_digital_nombre": contrato_nombre,
    }


@router.get("/batch/plantilla/")
def descargar_plantilla_clientes(request):
    require_clientes_batch_access(request)
    content = build_cliente_batch_workbook(get_allowed_entity_ids(request))
    response = HttpResponse(
        content,
        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    response["Content-Disposition"] = 'attachment; filename="plantilla-clientes.xlsx"'
    return response


@router.post("/batch/importar/")
def importar_clientes_batch(request, file: UploadedFile = File(...), async_job: bool = False):
    require_clientes_batch_access(request)
    allowed_entity_ids = get_allowed_entity_ids(request)
    if async_job:
        upload_info = store_background_upload(file, prefix="crm-clientes")
        job = enqueue_background_job(
            kind="crm.clients_batch_import",
            payload={
                "file_path": upload_info["path"],
                "file_name": upload_info["original_name"],
                "allowed_entity_ids": allowed_entity_ids,
            },
            created_by=getattr(getattr(request, "auth", None), "user", None),
            max_attempts=1,
        )
        return {
            "accepted": True,
            "job_id": job.id,
            "status": job.status,
            "mensaje": "Importacion de clientes enviada a procesamiento en background.",
        }

    rows = load_rows_from_file(file)
    return import_clientes_batch_rows(rows, allowed_entity_ids=allowed_entity_ids)


def import_clientes_batch_from_storage(payload: dict[str, object]) -> dict[str, object]:
    file_path = str(payload.get("file_path") or "")
    file_name = str(payload.get("file_name") or file_path)
    allowed_entity_ids = [
        int(entity_id)
        for entity_id in payload.get("allowed_entity_ids") or []
        if str(entity_id).strip()
    ]
    if not file_path:
        raise ValueError("No se encontro el archivo de importacion.")
    try:
        with default_storage.open(file_path, "rb") as stored_file:
            rows = load_rows_from_file_object(stored_file, file_name)
            return import_clientes_batch_rows(rows, allowed_entity_ids=allowed_entity_ids)
    finally:
        if default_storage.exists(file_path):
            default_storage.delete(file_path)


def import_clientes_batch_rows(
    rows: List[List[object]],
    *,
    allowed_entity_ids: list[int],
) -> dict[str, object]:
    header_row, mapping = resolve_batch_header_mapping(rows)

    total_filas = 0
    clientes_creados = 0
    clientes_actualizados = 0
    filas_omitidas = 0
    errores: List[str] = []

    for row_number, row in enumerate(rows[header_row:], start=header_row + 1):
        if is_blank_row(row):
            continue
        total_filas += 1

        try:
            rfc_value = clean_value(str(get_row_value(row, mapping, "rfc") or "")).upper()
            identificador_value = clean_value(
                str(get_row_value(row, mapping, "identificador") or "")
            )
            correo_value = clean_value(
                str(get_row_value(row, mapping, "correo_principal") or "")
            )
            telefono_value = clean_value(
                str(get_row_value(row, mapping, "telefono") or "")
            )

            existing_cliente = find_existing_cliente_for_batch(
                entidad=None,
                cliente_id_value=get_row_value(row, mapping, "cliente_id"),
                rfc_value=rfc_value,
                identificador_value=identificador_value,
                correo_value=correo_value,
                telefono_value=telefono_value,
                allowed_entity_ids=allowed_entity_ids,
            )
            entidad = resolve_entity_for_batch(
                entity_id_value=get_row_value(row, mapping, "entidad_id"),
                entity_name_value=get_row_value(row, mapping, "entidad"),
                existing_cliente=existing_cliente,
                allowed_entity_ids=allowed_entity_ids,
            )

            if existing_cliente and existing_cliente.entidad_relacionada_id != entidad.id:
                existing_cliente.entidad_relacionada = entidad

            if not existing_cliente:
                existing_cliente = find_existing_cliente_for_batch(
                    entidad=entidad,
                    cliente_id_value=get_row_value(row, mapping, "cliente_id"),
                    rfc_value=rfc_value,
                    identificador_value=identificador_value,
                    correo_value=correo_value,
                    telefono_value=telefono_value,
                    allowed_entity_ids=allowed_entity_ids,
                )

            raw_payload: Dict[str, object] = {
                "es_persona_moral": parse_bool_cell(
                    get_row_value(row, mapping, "es_persona_moral"),
                    default=existing_cliente.es_persona_moral if existing_cliente else False,
                ),
                "nombre_comercial": get_row_value(row, mapping, "nombre_comercial")
                if get_row_value(row, mapping, "nombre_comercial") not in (None, "")
                else (existing_cliente.nombre_comercial if existing_cliente else ""),
                "razon_social": get_row_value(row, mapping, "razon_social")
                if get_row_value(row, mapping, "razon_social") not in (None, "")
                else (existing_cliente.razon_social if existing_cliente else ""),
                "rfc": rfc_value or (existing_cliente.rfc if existing_cliente else ""),
                "regimen_fiscal": get_row_value(row, mapping, "regimen_fiscal")
                if get_row_value(row, mapping, "regimen_fiscal") not in (None, "")
                else (existing_cliente.regimen_fiscal if existing_cliente else ""),
                "identificador": identificador_value
                or (existing_cliente.identificador if existing_cliente else ""),
                "condiciones_pago": get_row_value(row, mapping, "condiciones_pago")
                if get_row_value(row, mapping, "condiciones_pago") not in (None, "")
                else (existing_cliente.condiciones_pago if existing_cliente else ""),
                "archivo_csf_url": get_row_value(row, mapping, "archivo_csf_url")
                if get_row_value(row, mapping, "archivo_csf_url") not in (None, "")
                else (existing_cliente.archivo_csf_url if existing_cliente else ""),
                "correo_principal": correo_value
                or (existing_cliente.correo_principal if existing_cliente else ""),
                "codigo_pais": get_row_value(row, mapping, "codigo_pais")
                if get_row_value(row, mapping, "codigo_pais") not in (None, "")
                else (existing_cliente.codigo_pais if existing_cliente else "+52"),
                "telefono": telefono_value
                or (existing_cliente.telefono if existing_cliente else ""),
                "pais": get_row_value(row, mapping, "pais")
                if get_row_value(row, mapping, "pais") not in (None, "")
                else (existing_cliente.pais if existing_cliente else "Mexico"),
                "estado": get_row_value(row, mapping, "estado")
                if get_row_value(row, mapping, "estado") not in (None, "")
                else (existing_cliente.estado if existing_cliente else ""),
                "ciudad": get_row_value(row, mapping, "ciudad")
                if get_row_value(row, mapping, "ciudad") not in (None, "")
                else (existing_cliente.ciudad if existing_cliente else ""),
                "colonia": get_row_value(row, mapping, "colonia")
                if get_row_value(row, mapping, "colonia") not in (None, "")
                else (existing_cliente.colonia if existing_cliente else ""),
                "calle": get_row_value(row, mapping, "calle")
                if get_row_value(row, mapping, "calle") not in (None, "")
                else (existing_cliente.calle if existing_cliente else ""),
                "numero_exterior": get_row_value(row, mapping, "numero_exterior")
                if get_row_value(row, mapping, "numero_exterior") not in (None, "")
                else (existing_cliente.numero_exterior if existing_cliente else ""),
                "numero_interior": get_row_value(row, mapping, "numero_interior")
                if get_row_value(row, mapping, "numero_interior") not in (None, "")
                else (existing_cliente.numero_interior if existing_cliente else ""),
                "codigo_postal": get_row_value(row, mapping, "codigo_postal")
                if get_row_value(row, mapping, "codigo_postal") not in (None, "")
                else (existing_cliente.codigo_postal if existing_cliente else ""),
                "agente_cobranza": get_row_value(row, mapping, "agente_cobranza")
                if get_row_value(row, mapping, "agente_cobranza") not in (None, "")
                else (existing_cliente.agente_cobranza if existing_cliente else ""),
                "dia_corte_individual": (
                    parse_optional_int_cell(get_row_value(row, mapping, "dia_corte_individual"))
                    if get_row_value(row, mapping, "dia_corte_individual") not in (None, "")
                    else (
                        existing_cliente.dia_corte_individual
                        if existing_cliente
                        else None
                    )
                ),
                "dias_gracia": (
                    parse_optional_int_cell(get_row_value(row, mapping, "dias_gracia"))
                    if get_row_value(row, mapping, "dias_gracia") not in (None, "")
                    else (existing_cliente.dias_gracia if existing_cliente else 0)
                )
                or 0,
                "activo": parse_bool_cell(
                    get_row_value(row, mapping, "activo"),
                    default=existing_cliente.activo if existing_cliente else True,
                ),
            }

            datos_cliente = sanitize_cliente_data(raw_payload)
            if not clean_value(str(datos_cliente.get("razon_social") or "")):
                raise ValueError("La razon social es obligatoria.")
            if not clean_value(str(datos_cliente.get("rfc") or "")):
                raise ValueError("El RFC es obligatorio.")
            if not clean_value(str(datos_cliente.get("telefono") or "")):
                raise ValueError("El telefono es obligatorio.")

            if existing_cliente:
                for field, value in datos_cliente.items():
                    setattr(existing_cliente, field, value)
                existing_cliente.entidad_relacionada = entidad
                existing_cliente.save()
                clientes_actualizados += 1
            else:
                Cliente.objects.create(
                    entidad_relacionada=entidad,
                    **datos_cliente,
                )
                clientes_creados += 1
        except Exception as error:
            filas_omitidas += 1
            errores.append(f"Fila {row_number}: {error}")

    return {
        "mensaje": "Importacion de clientes completada",
        "total_filas": total_filas,
        "clientes_creados": clientes_creados,
        "clientes_actualizados": clientes_actualizados,
        "filas_omitidas": filas_omitidas,
        "errores": errores[:25],
    }


@router.post("/extraer-csf/")
def extraer_datos_csf(request, file: UploadedFile = File(...)):
    require_clientes_write_access(request)
    try:
        datos = extract_csf_data_from_upload(file)
        datos["archivo_csf_url"] = upload_csf_to_r2(file)
    except HttpError:
        raise
    except Exception as error:
        raise HttpError(500, f"Error al subir a Cloudflare R2: {error}")

    return {"success": True, "datos_extraidos": datos}


@router.post("/cliente/{cliente_id}/extraer-csf/")
def extraer_y_guardar_csf_cliente(request, cliente_id: int, file: UploadedFile = File(...)):
    require_clientes_write_access(request)
    cliente = (
        Cliente.objects.select_related(
            "entidad_relacionada",
            "entidad_relacionada__capa_negocio",
        )
        .filter(id=cliente_id, entidad_relacionada_id__in=get_allowed_entity_ids(request))
        .first()
    )
    if not cliente:
        raise HttpError(404, "No se encontro el cliente solicitado.")

    try:
        datos = extract_csf_data_from_upload(file)
        datos["archivo_csf_url"] = upload_csf_to_r2(file)
        changed_fields = apply_csf_data_to_cliente(cliente, datos)
        audit(
            actor=request.auth.user,
            capa=cliente.entidad_relacionada.capa_negocio,
            accion="CLIENTE_CSF_ACTUALIZADA",
            recurso_tipo="Cliente",
            recurso_id=cliente.id,
            metadata={
                "cliente": cliente_nombre(cliente),
                "campos_actualizados": changed_fields,
            },
        )
    except HttpError:
        raise
    except Exception as error:
        raise HttpError(500, f"No se pudo guardar la CSF del cliente: {error}")

    return {
        "success": True,
        "mensaje": "CSF cargada y datos fiscales actualizados.",
        "datos_extraidos": datos,
        "portal": build_cliente_portal_preview(cliente),
    }


@router.get("/lista/", response=ClienteListResponseOut)
def listar_clientes(
    request,
    page: int = 1,
    page_size: int = 20,
    search: str = "",
    entidad_id: Optional[int] = None,
    estatus: str = "ACTIVO",
    contrato: str = "TODOS",
    con_adeudo: bool = False,
    incompletos: bool = False,
):
    require_clientes_access(request)
    current_page = max(page, 1)
    current_page_size = min(max(page_size, 1), 100)

    allowed_entity_ids = get_allowed_entity_ids(request)
    clientes = build_client_queryset(allowed_entity_ids)
    if search:
        clientes = clientes.filter(
            Q(razon_social__icontains=search)
            | Q(nombre_comercial__icontains=search)
            | Q(rfc__icontains=search)
            | Q(identificador__icontains=search)
            | Q(telefono__icontains=search)
            | Q(correo_principal__icontains=search)
        )

    if entidad_id:
        clientes = clientes.filter(entidad_relacionada_id=entidad_id)

    estatus_normalizado = normalize_text(estatus or "ACTIVO")
    if estatus_normalizado == "inactivo":
        clientes = clientes.filter(activo=False)
    elif estatus_normalizado == "todos":
        pass
    else:
        clientes = clientes.filter(activo=True)

    contrato_normalizado = normalize_text(contrato or "TODOS")
    # el filtro por contrato de arrendamiento no aplica al segmento POS
    if con_adeudo:
        clientes = clientes.filter(
            cliente_open_balance_filter(),
            cuentas_por_cobrar__monto_total__gt=F("cuentas_por_cobrar__monto_pagado"),
        ).distinct()

    if incompletos:
        clientes = clientes.filter(
            Q(regimen_fiscal__isnull=True)
            | Q(regimen_fiscal="")
            | Q(codigo_postal__isnull=True)
            | Q(codigo_postal="")
            | Q(razon_social__isnull=True)
            | Q(razon_social="")
            | Q(rfc__isnull=True)
            | Q(rfc="")
            | Q(correo_principal__isnull=True)
            | Q(correo_principal="")
            | Q(telefono__isnull=True)
            | Q(telefono="")
            | Q(contrato_digital_url__isnull=True)
            | Q(contrato_digital_url="")
        )

    total = clientes.count()
    total_pages = max(1, (total + current_page_size - 1) // current_page_size)
    if current_page > total_pages:
        current_page = total_pages

    start = (current_page - 1) * current_page_size
    end = start + current_page_size
    items = list(annotate_client_balances(clientes).order_by("-id")[start:end])

    entidades = [
        {"id": entidad.id, "nombre": entidad.nombre_comercial}
        for entidad in EntidadNegocio.objects.filter(id__in=allowed_entity_ids).order_by("nombre_comercial")
    ]

    return {
        "items": [serialize_cliente_list_item(cliente) for cliente in items],
        "total": total,
        "page": current_page,
        "page_size": current_page_size,
        "total_pages": total_pages,
        "entidades": entidades,
    }
