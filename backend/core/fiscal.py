import re
import unicodedata


GENERIC_PUBLIC_RFC = "XAXX010101000"
GENERIC_PUBLIC_NAME = "PUBLICO EN GENERAL"
GENERIC_PUBLIC_REGIME = "616"
GENERIC_PUBLIC_CFDI_USE = "S01"

FISCAL_REGIME_CODES = {
    "601": "General de Ley Personas Morales",
    "603": "Personas Morales con Fines no Lucrativos",
    "605": "Sueldos y Salarios e Ingresos Asimilados a Salarios",
    "606": "Arrendamiento",
    "607": "Enajenacion o Adquisicion de Bienes",
    "608": "Demas ingresos",
    "610": "Residentes en el Extranjero sin Establecimiento Permanente en Mexico",
    "611": "Ingresos por Dividendos",
    "612": "Personas Fisicas con Actividades Empresariales y Profesionales",
    "614": "Ingresos por intereses",
    "615": "Ingresos por obtencion de premios",
    "616": "Sin obligaciones fiscales",
    "620": "Sociedades Cooperativas de Produccion que optan por diferir ingresos",
    "621": "Incorporacion Fiscal",
    "622": "Actividades Agricolas, Ganaderas, Silvicolas y Pesqueras",
    "623": "Opcional para Grupos de Sociedades",
    "624": "Coordinados",
    "625": "Plataformas Tecnologicas",
    "626": "Regimen Simplificado de Confianza",
}

_FISCAL_REGIME_PATTERN = re.compile(
    r"\b(" + "|".join(sorted(FISCAL_REGIME_CODES.keys())) + r")\b"
)

_LEGAL_ENTITY_SUFFIX_PATTERNS = [
    re.compile(pattern)
    for pattern in (
        r"\bSOCIEDAD ANONIMA PROMOTORA DE INVERSION DE CAPITAL VARIABLE$",
        r"\bSOCIEDAD ANONIMA DE CAPITAL VARIABLE$",
        r"\bSOCIEDAD DE RESPONSABILIDAD LIMITADA DE CAPITAL VARIABLE$",
        r"\bSOCIEDAD CIVIL$",
        r"\bASOCIACION CIVIL$",
        r"\bSAPI DE CV$",
        r"\bSA DE CV$",
        r"\bS DE RL DE CV$",
        r"\bS RL DE CV$",
        r"\bSAS DE CV$",
        r"\bSAS$",
        r"\bSC$",
        r"\bAC$",
    )
]


def normalize_fiscal_text(value: object) -> str:
    text = str(value or "").strip()
    decomposed = unicodedata.normalize("NFD", text)
    without_accents = "".join(char for char in decomposed if unicodedata.category(char) != "Mn")
    return re.sub(r"[^a-zA-Z0-9]+", " ", without_accents).strip().lower()


def normalize_fiscal_name(value: object) -> str:
    text = str(value or "").strip().upper()
    decomposed = unicodedata.normalize("NFD", text)
    without_accents = "".join(char for char in decomposed if unicodedata.category(char) != "Mn")
    without_dots = without_accents.replace(".", "")
    without_punctuation = re.sub(r"[^A-Z0-9& ]+", " ", without_dots)
    normalized = re.sub(r"\s+", " ", without_punctuation).strip()
    previous = ""
    while normalized and normalized != previous:
        previous = normalized
        for pattern in _LEGAL_ENTITY_SUFFIX_PATTERNS:
            normalized = pattern.sub("", normalized).strip()
        normalized = re.sub(r"\s+", " ", normalized).strip()
    return normalized


def is_generic_public_rfc(value: object) -> bool:
    return str(value or "").strip().upper() == GENERIC_PUBLIC_RFC


def normalize_fiscal_regime_code(value: object) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    match = _FISCAL_REGIME_PATTERN.search(text)
    if match:
        return match.group(1)

    normalized = normalize_fiscal_text(text)
    for code, label in FISCAL_REGIME_CODES.items():
        normalized_label = normalize_fiscal_text(label)
        if normalized == normalized_label or normalized in normalized_label or normalized_label in normalized:
            return code
    return text


def is_valid_fiscal_regime_code(value: object) -> bool:
    return normalize_fiscal_regime_code(value) in FISCAL_REGIME_CODES
