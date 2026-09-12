import base64
import hashlib
import hmac
import json
import mimetypes
import os
import re
import unicodedata
import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Optional

import requests
from django.conf import settings
from django.core.files.storage import default_storage
from django.db import transaction
from django.db.models import Count, F, Prefetch, Q
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from ninja import File, Router, Schema
from ninja.errors import HttpError
from ninja.files import UploadedFile

from accounts.security import (
    get_allowed_entity_ids,
    get_current_capa,
    plan_has_feature,
    require_admin_access,
    require_plan_feature,
    require_plan_module,
    require_write_access,
)
from billing.background_jobs import enqueue_background_job
from billing.services import registrar_consumo_saas
from crm.models import Cliente
from empresas.models import CapaNegocio, EntidadNegocio
from finanzas.eventos import apply_financial_event, upsert_financial_event
from finanzas.models import CuentaPorCobrar, EventoFinanciero, PagoCuentaPorCobrar
from finanzas.services import decimal_to_float, register_payment_for_entity

from .email_provider import get_email_delivery_overview
from .models import (
    CanalPermitido,
    CanalWhatsappOficial,
    CasoProcesamiento,
    ConfiguracionComunicacion,
    EvidenciaPago,
    HistorialEnvio,
    MensajeEntrante,
    PlantillaMensaje,
    ReglaAutomatizacionMensaje,
    WebhookEntrante,
)
from .outbound import build_portal_url, normalize_whatsapp_destination, send_whatsapp_message

router = Router()


def require_cobranza_access(request) -> None:
    require_plan_module(request, "cobranza")


def require_whatsapp_automation_access(request) -> None:
    require_plan_feature(request, "whatsapp_automation")


def has_whatsapp_automation_access(request) -> bool:
    return plan_has_feature(request, "whatsapp_automation")


def require_ai_copy_access(request) -> None:
    require_plan_feature(request, "ai_copy")


def require_whatsapp_channel_access(request, channel: str | None) -> None:
    normalized = (channel or "").strip().upper()
    if "WHATSAPP" in normalized:
        require_whatsapp_automation_access(request)


DEFAULT_GREEN_API_URL = "https://api.green-api.com"
DEFAULT_WHATSAPP_PROVIDER = "META_CLOUD_API"
COLLECTION_OPT_OUT_REASON = "Baja solicitada por WhatsApp"
COLLECTION_OPT_OUT_MAX_LENGTH = 120
COLLECTION_OPT_OUT_EXACT_PHRASES = {
    "BAJA",
    "STOP",
    "NO ENVIAR",
    "NO ENVIAR MAS",
    "NO ENVIAR MENSAJES",
    "NO ENVIAR MAS MENSAJES",
    "NO ME ENVIEN",
    "NO ME ENVIEN MENSAJES",
    "NO ENVIEN",
    "NO ENVIEN MENSAJES",
    "NO MANDAR",
    "NO MANDAR MENSAJES",
}
COLLECTION_OPT_OUT_CONTAINS_PHRASES = {
    "NO ENVIAR MENSAJES",
    "NO ENVIAR MAS",
    "NO ENVIAR MAS MENSAJES",
    "NO ME ENVIEN",
    "NO ENVIEN MENSAJES",
    "NO MANDAR MENSAJES",
}
PORTAL_ASSISTANT_MAX_LENGTH = 240
PORTAL_ASSISTANT_MENU_EXACT_PHRASES = {
    "HOLA",
    "BUENAS",
    "BUEN DIA",
    "BUENOS DIAS",
    "BUENA TARDE",
    "BUENAS TARDES",
    "BUENA NOCHE",
    "BUENAS NOCHES",
    "AYUDA",
    "MENU",
    "OPCIONES",
}
PORTAL_ASSISTANT_ACCESS_BUTTON_ID = "betterp_portal_access"
PORTAL_ASSISTANT_EXACT_PHRASES = {
    "ABRIR PORTAL",
    "ABRIR MI PORTAL",
    "SOLICITAR ACCESO",
    "SOLICITAR LINK",
    "SOLICITAR LIGA",
    "SOLICITAR URL",
    "PORTAL",
    "LINK",
    "LIGA",
    "URL",
    "ENLACE",
    "ACCESO",
    "AUTOSERVICIO",
    "AUTO SERVICIO",
    "MI PORTAL",
    "MI LINK",
    "MI LIGA",
    "MI CUENTA",
    "ESTADO DE CUENTA",
}
PORTAL_ASSISTANT_CONTAINS_PHRASES = {
    "LINK DEL PORTAL",
    "LIGA DEL PORTAL",
    "URL DEL PORTAL",
    "ENLACE DEL PORTAL",
    "ACCESO AL PORTAL",
    "ENTRAR AL PORTAL",
    "ABRIR EL PORTAL",
    "PORTAL DE AUTOSERVICIO",
    "PORTAL CLIENTE",
    "ESTADO DE CUENTA",
    "DATOS DE PAGO",
    "MIS FACTURAS",
    "MI FACTURA",
    "SUBIR COMPROBANTE",
    "CARGAR COMPROBANTE",
}
PORTAL_ASSISTANT_REQUEST_WORDS = {
    "MANDAME",
    "ENVIAME",
    "PASAME",
    "COMPARTEME",
    "NECESITO",
    "QUIERO",
    "SOLICITO",
    "PUEDO",
    "OCUPO",
    "DAME",
    "VER",
    "CONSULTAR",
    "ENTRAR",
    "ACCEDER",
    "ABRIR",
}
PORTAL_ASSISTANT_OBJECT_WORDS = {
    "PORTAL",
    "LINK",
    "LIGA",
    "URL",
    "ENLACE",
    "ACCESO",
    "AUTOSERVICIO",
    "CUENTA",
    "FACTURA",
    "FACTURAS",
    "COMPROBANTE",
    "COMPROBANTES",
    "PAGO",
    "PAGOS",
}
PORTAL_ASSISTANT_INTENT_MENU = "MENU"
PORTAL_ASSISTANT_INTENT_ACCESS = "ACCESS"
STRONG_PAYMENT_KEYWORDS = {
    "renta": "RENTA",
    "deposito": "DEPOSITO",
    "abono": "ABONO",
    "transferencia": "TRANSFERENCIA",
    "pago": "PAGO",
    "mensualidad": "RENTA",
    "inquilino": "RENTA",
    "habitacion": "RENTA",
    "departamento": "RENTA",
    "depto": "RENTA",
}
STRONG_EXPENSE_KEYWORDS = {
    "luz": "LUZ",
    "agua": "AGUA",
    "internet": "INTERNET",
    "nomina": "NOMINA",
    "sueldo": "NOMINA",
    "limpieza": "LIMPIEZA",
    "basura": "BASURA",
    "mantenimiento": "MANTENIMIENTO",
    "cfe": "LUZ",
    "telmex": "INTERNET",
    "totalplay": "INTERNET",
    "megacable": "INTERNET",
    "gas": "GAS",
    "honorarios": "HONORARIOS",
    "poliza": "POLIZA",
}
EVIDENCE_MESSAGE_TYPES = {
    "imageMessage",
    "documentMessage",
    "videoMessage",
    "audioMessage",
}
AI_RECEIPT_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
AI_RECEIPT_TEXT_LIMIT = 5000
DEFAULT_RECEIPT_AI_MODEL = "gpt-4o-mini"
AI_RECEIPT_IMAGE_DOWNLOAD_MAX_BYTES = 10 * 1024 * 1024
GOOGLE_VISION_ANNOTATE_URL = "https://vision.googleapis.com/v1/images:annotate"
GOOGLE_VISION_RECEIPT_FEATURE = "DOCUMENT_TEXT_DETECTION"
EVIDENCE_UPLOAD_ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".pdf"}
EVIDENCE_UPLOAD_ALLOWED_CONTENT_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "application/pdf",
}
EVIDENCE_UPLOAD_MAX_BYTES = 15 * 1024 * 1024
EVIDENCE_UPLOAD_PDF_TEXT_LIMIT = 4000
AMOUNT_PATTERN = re.compile(
    r"(?<!\d)(\d{1,3}(?:[ ,]\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)"
)
AMOUNT_CONTEXT_KEYWORDS = {
    "abono",
    "cantidad",
    "cargo",
    "deposito",
    "importe",
    "monto",
    "mxn",
    "pagado",
    "pagar",
    "pago",
    "recibido",
    "saldo",
    "total",
    "transferencia",
    "transferido",
    "transfirio",
}
REFERENCE_PATTERNS = [
    re.compile(
        r"(?:spei|ref(?:erencia)?|folio|operaci[oó]n)[^A-Z0-9]{0,6}([A-Z0-9\-]{4,})",
        re.IGNORECASE,
    ),
]
REFERENCE_PATTERNS.insert(
    0,
    re.compile(
        r"(?:folio\s+(?:de\s+la\s+)?operaci[oó]n|folio|ref(?:erencia)?|spei|operaci[oó]n)[\s:#.-]*([A-Z0-9\-]{4,})",
        re.IGNORECASE,
    ),
)
SPANISH_MONTHS = {
    "ene": 1,
    "enero": 1,
    "feb": 2,
    "febrero": 2,
    "mar": 3,
    "marzo": 3,
    "abr": 4,
    "abril": 4,
    "mayo": 5,
    "jun": 6,
    "junio": 6,
    "jul": 7,
    "julio": 7,
    "ago": 8,
    "agosto": 8,
    "sep": 9,
    "sept": 9,
    "septiembre": 9,
    "setiembre": 9,
    "oct": 10,
    "octubre": 10,
    "nov": 11,
    "noviembre": 11,
    "dic": 12,
    "diciembre": 12,
}
BANK_KEYWORDS = [
    "BBVA",
    "NU MEXICO",
    "BANORTE",
    "SANTANDER",
    "HSBC",
    "SCOTIABANK",
    "BANBAJIO",
    "BANREGIO",
    "BANAMEX",
    "CITIBANAMEX",
    "AFIRME",
    "INBURSA",
    "AZTECA",
]


class WebhookEntranteIn(Schema):
    payload_completo: dict


class ConfiguracionComunicacionIn(Schema):
    clave: str = "PRINCIPAL"
    green_api_api_url: str = ""
    green_api_instance_id: str = ""
    green_api_token: str = ""
    green_api_webhook_url: str = ""
    green_api_webhook_token: str = ""
    green_api_modo_filtro: str = "SOLO_PERMITIDOS"
    green_api_sync_settings: bool = False
    procesar_webhooks_async: bool = True
    make_webhook_url: str = ""
    openai_model: str = ""
    prompt_extraccion: str = ""
    auto_detectar_comprobantes: bool = True
    auto_crear_eventos: bool = True
    auto_aplicar_eventos_confiables: bool = False
    auto_conciliar_eventos: bool = False
    umbral_confianza_autoaplicacion: Decimal = Decimal("85")
    ventana_match_dias: int = 7
    tolerancia_monto: Decimal = Decimal("0")
    email_activo: bool = False
    email_remitente_nombre: str = ""
    email_remitente: str = ""
    email_responder_a: str = ""
    respetar_bajas_whatsapp: bool = True
    portal_token_horas: int = 168
    activo: bool = True


class CanalWhatsappOficialIn(Schema):
    nombre: str
    nombre_interno: str = ""
    display_phone_number: str = ""
    numero_wa_id: str = ""
    phone_number_id: str = ""
    business_account_id: str = ""
    waba_id: str = ""
    access_token: str = ""
    entidad_id: Optional[int] = None
    cliente_id: Optional[int] = None
    estado: str = "PENDIENTE"
    puede_enviar: bool = True
    puede_recibir: bool = True
    es_principal: bool = False
    activo: bool = True
    metadata: Optional[dict] = None


class CanalPermitidoIn(Schema):
    canal: str = "GRUPO_WHATSAPP"
    nombre: str
    identificador_externo: str
    entidad_id: Optional[int] = None
    cliente_id: Optional[int] = None
    tipo_movimiento_default: str = "AUTO"
    capturar_evidencias: bool = True
    descripcion: str = ""
    activo: bool = True


class CasoProcesamientoIn(Schema):
    entidad_id: Optional[int] = None
    cliente_id: Optional[int] = None
    clave_externa: str = ""
    grupo_externo_id: str = ""
    canal: str = "WHATSAPP"
    remitente: str
    remitente_nombre: str = ""
    texto_consolidado: str = ""
    caption_consolidado: str = ""
    metadata: Optional[dict] = None
    estatus: str = "NUEVO"
    fecha_ultimo_mensaje: Optional[datetime] = None


class CasoEstatusIn(Schema):
    estatus: str


class MensajeEntranteIn(Schema):
    webhook_id: Optional[int] = None
    caso_id: Optional[int] = None
    caso_clave_externa: Optional[str] = None
    grupo_externo_id: Optional[str] = None
    entidad_id: Optional[int] = None
    cliente_id: Optional[int] = None
    origen_externo_id: Optional[str] = None
    canal: str = "WHATSAPP"
    remitente: str
    remitente_nombre: str = ""
    fecha_mensaje: Optional[datetime] = None
    texto: str = ""
    url_adjunto: str = ""
    metadata: Optional[dict] = None


class EvidenciaPagoIn(Schema):
    entidad_id: Optional[int] = None
    cliente_id: Optional[int] = None
    mensaje_id: Optional[int] = None
    caso_id: Optional[int] = None
    caso_clave_externa: Optional[str] = None
    grupo_externo_id: Optional[str] = None
    canal: str = "WHATSAPP"
    tipo_movimiento: str = "INGRESO"
    url_archivo: str = ""
    hash_archivo: str = ""
    monto_reportado: Optional[Decimal] = None
    fecha_pago_reportada: Optional[date] = None
    referencia_reportada: str = ""
    texto_extraido: str = ""
    origen_deteccion: str = "MANUAL"
    confianza_clasificacion: Optional[Decimal] = None
    requiere_revision_manual: bool = True
    categoria_sugerida: str = ""
    metadata: Optional[dict] = None
    observaciones: str = ""


class EvidenciaClasificacionIn(Schema):
    tipo_movimiento: str
    entidad_id: Optional[int] = None
    cliente_id: Optional[int] = None
    categoria_sugerida: str = ""
    monto_reportado: Optional[Decimal] = None
    fecha_pago_reportada: Optional[date] = None
    referencia_reportada: Optional[str] = None
    confianza_clasificacion: Optional[Decimal] = None
    requiere_revision_manual: bool = False
    observaciones: str = ""
    estatus: Optional[str] = None
    crear_evento: bool = True
    aplicar_evento: bool = False


class EvidenciaAplicacionCxcIn(Schema):
    cuenta_id: int
    monto: Optional[Decimal] = None
    fecha_pago: Optional[date] = None
    referencia: str = ""
    notas: str = ""
    confirmar_duplicado: bool = False


class ProcesarWebhookIn(Schema):
    webhook_id: int


def clamp_money(value: Decimal | None) -> Decimal:
    if value is None:
        return Decimal("0")
    return max(value, Decimal("0"))


def get_or_create_main_config(request=None) -> ConfiguracionComunicacion:
    capa = None
    if request is not None and getattr(request, "auth", None) is not None:
        capa = get_current_capa(request)

    if capa is not None:
        config = ConfiguracionComunicacion.objects.filter(
            capa_negocio=capa,
            clave="PRINCIPAL",
        ).first()
        if config:
            return config
        return ConfiguracionComunicacion.objects.create(
            capa_negocio=capa,
            clave="PRINCIPAL",
            green_api_api_url=DEFAULT_GREEN_API_URL,
        )

    config = (
        ConfiguracionComunicacion.objects.filter(capa_negocio__isnull=True)
        .order_by("id")
        .first()
    )
    if config:
        return config
    return ConfiguracionComunicacion.objects.create(
        clave="PRINCIPAL",
        green_api_api_url=DEFAULT_GREEN_API_URL,
    )


def get_or_create_config_for_capa(
    capa: CapaNegocio | None,
) -> ConfiguracionComunicacion:
    if capa is None:
        return get_or_create_main_config()

    config = ConfiguracionComunicacion.objects.filter(
        capa_negocio=capa,
        clave="PRINCIPAL",
    ).first()
    if config:
        return config
    return ConfiguracionComunicacion.objects.create(
        capa_negocio=capa,
        clave="PRINCIPAL",
        green_api_api_url=DEFAULT_GREEN_API_URL,
    )


def get_cached_allowed_entity_ids(request) -> list[int]:
    cached_ids = getattr(request, "_betterp_comunicaciones_allowed_entity_ids", None)
    if cached_ids is None:
        cached_ids = get_allowed_entity_ids(request)
        setattr(request, "_betterp_comunicaciones_allowed_entity_ids", cached_ids)
    return cached_ids


def scoped_entity_queryset(request):
    return EntidadNegocio.objects.filter(id__in=get_cached_allowed_entity_ids(request))


def get_scoped_entity_or_none(request, entidad_id: int | None):
    if not entidad_id:
        return None
    return get_object_or_404(scoped_entity_queryset(request), id=entidad_id)


def scoped_client_queryset(request):
    return Cliente.objects.select_related("entidad_relacionada").filter(
        activo=True,
        entidad_relacionada_id__in=get_cached_allowed_entity_ids(request),
    )


def get_scoped_client_or_none(request, cliente_id: int | None):
    if not cliente_id:
        return None
    return get_object_or_404(scoped_client_queryset(request), id=cliente_id)


def scoped_allowed_channel_queryset(request):
    return CanalPermitido.objects.filter(
        configuracion_relacionada=get_or_create_main_config(request),
    )


def case_scope_filter(allowed_entity_ids: list[int]) -> Q:
    return Q(entidad_relacionada_id__in=allowed_entity_ids) | Q(
        entidad_relacionada__isnull=True,
        cliente_relacionado__entidad_relacionada_id__in=allowed_entity_ids,
    )


def evidence_scope_filter(allowed_entity_ids: list[int]) -> Q:
    return Q(entidad_relacionada_id__in=allowed_entity_ids) | Q(
        entidad_relacionada__isnull=True,
        cliente_relacionado__entidad_relacionada_id__in=allowed_entity_ids,
    )


def scoped_case_queryset(request):
    return CasoProcesamiento.objects.filter(
        case_scope_filter(get_cached_allowed_entity_ids(request))
    ).distinct()


def case_is_in_scope(caso: CasoProcesamiento, allowed_entity_ids: list[int]) -> bool:
    allowed_ids = set(allowed_entity_ids)
    if caso.entidad_relacionada_id in allowed_ids:
        return True
    cliente = getattr(caso, "cliente_relacionado", None)
    return bool(
        caso.entidad_relacionada_id is None
        and cliente
        and cliente.entidad_relacionada_id in allowed_ids
    )


def get_scoped_case_by_id(request, caso_id: int) -> CasoProcesamiento:
    caso = get_object_or_404(
        CasoProcesamiento.objects.select_related(
            "entidad_relacionada",
            "cliente_relacionado",
        ),
        id=caso_id,
    )
    if not case_is_in_scope(caso, get_cached_allowed_entity_ids(request)):
        raise HttpError(404, "Caso no encontrado.")
    return caso


def scoped_evidence_queryset(request):
    return EvidenciaPago.objects.filter(
        evidence_scope_filter(get_cached_allowed_entity_ids(request))
    ).distinct()


def evidence_is_in_scope(evidencia: EvidenciaPago, allowed_entity_ids: list[int]) -> bool:
    allowed_ids = set(allowed_entity_ids)
    if evidencia.entidad_relacionada_id in allowed_ids:
        return True
    cliente = getattr(evidencia, "cliente_relacionado", None)
    return bool(
        evidencia.entidad_relacionada_id is None
        and cliente
        and cliente.entidad_relacionada_id in allowed_ids
    )


def get_existing_evidence_by_hash(request, hash_archivo: str) -> EvidenciaPago | None:
    evidencia = (
        EvidenciaPago.objects.select_related("cliente_relacionado")
        .filter(hash_archivo=hash_archivo)
        .first()
    )
    if not evidencia:
        return None
    if not evidence_is_in_scope(evidencia, get_cached_allowed_entity_ids(request)):
        raise HttpError(400, "El hash de archivo ya esta registrado.")
    return evidencia


def sanitize_evidence_filename(filename: str) -> str:
    basename = os.path.basename(filename or "comprobante")
    sanitized = re.sub(r"[^A-Za-z0-9._-]+", "_", basename).strip("._")
    return (sanitized or "comprobante")[:140]


def build_public_storage_url(request, storage_path: str) -> str:
    public_domain = (
        getattr(settings, "R2_PUBLIC_DOMAIN", "")
        or os.environ.get("R2_PUBLIC_DOMAIN", "")
        or ""
    ).rstrip("/")
    if public_domain:
        return f"{public_domain}/{storage_path.lstrip('/')}"
    url = default_storage.url(storage_path)
    if str(url).startswith(("http://", "https://")):
        return str(url)
    return request.build_absolute_uri(url)


def validate_evidence_upload(file: UploadedFile) -> tuple[str, str, str]:
    filename = sanitize_evidence_filename(getattr(file, "name", "") or "comprobante")
    extension = os.path.splitext(filename)[1].lower()
    content_type = (getattr(file, "content_type", "") or "").lower()
    if extension not in EVIDENCE_UPLOAD_ALLOWED_EXTENSIONS:
        raise HttpError(
            400,
            "El comprobante debe ser imagen o PDF (.jpg, .jpeg, .png, .webp, .pdf).",
        )
    if content_type and content_type not in EVIDENCE_UPLOAD_ALLOWED_CONTENT_TYPES:
        raise HttpError(400, "El tipo de archivo no es compatible para comprobantes.")
    file_size = getattr(file, "size", None)
    if file_size is not None and file_size > EVIDENCE_UPLOAD_MAX_BYTES:
        raise HttpError(400, "El comprobante no puede superar 15 MB.")
    return filename, extension, content_type or "application/octet-stream"


def hash_uploaded_file(file: UploadedFile) -> str:
    digest = hashlib.sha256()
    try:
        file.seek(0)
    except Exception:
        pass
    for chunk in file.chunks():
        digest.update(chunk)
    try:
        file.seek(0)
    except Exception:
        pass
    return digest.hexdigest()


def extract_pdf_text_from_upload(file: UploadedFile) -> str:
    try:
        import pdfplumber
    except Exception:
        return ""
    try:
        file.seek(0)
        text_parts: list[str] = []
        with pdfplumber.open(file.file) as pdf:
            for page in pdf.pages[:3]:
                page_text = page.extract_text() or ""
                if page_text.strip():
                    text_parts.append(page_text.strip())
                if sum(len(item) for item in text_parts) >= EVIDENCE_UPLOAD_PDF_TEXT_LIMIT:
                    break
        return "\n\n".join(text_parts)[:EVIDENCE_UPLOAD_PDF_TEXT_LIMIT]
    except Exception:
        return ""
    finally:
        try:
            file.seek(0)
        except Exception:
            pass


def scoped_message_queryset(request):
    allowed_entity_ids = get_cached_allowed_entity_ids(request)
    return MensajeEntrante.objects.filter(
        Q(entidad_relacionada_id__in=allowed_entity_ids)
        | Q(
            entidad_relacionada__isnull=True,
            cliente_relacionado__entidad_relacionada_id__in=allowed_entity_ids,
        )
        | Q(caso_relacionado__entidad_relacionada_id__in=allowed_entity_ids)
        | Q(
            caso_relacionado__entidad_relacionada__isnull=True,
            caso_relacionado__cliente_relacionado__entidad_relacionada_id__in=allowed_entity_ids,
        )
    ).distinct()


def scoped_webhook_queryset(request):
    allowed_entity_ids = get_cached_allowed_entity_ids(request)
    config = get_or_create_main_config(request)
    allowed_chat_ids = {
        value
        for value in CanalPermitido.objects.filter(
            configuracion_relacionada=config,
            activo=True,
        ).values_list("identificador_externo", flat=True)
        if value
    }
    for channel in scoped_whatsapp_channel_queryset(request).filter(activo=True):
        for value in (
            channel.phone_number_id,
            channel.display_phone_number,
            channel.numero_wa_id,
        ):
            if value:
                allowed_chat_ids.add(str(value).strip())

    scope = (
        Q(mensajes_normalizados__entidad_relacionada_id__in=allowed_entity_ids)
        | Q(
            mensajes_normalizados__entidad_relacionada__isnull=True,
            mensajes_normalizados__cliente_relacionado__entidad_relacionada_id__in=allowed_entity_ids,
        )
        | Q(
            mensajes_normalizados__caso_relacionado__entidad_relacionada_id__in=allowed_entity_ids,
        )
        | Q(
            mensajes_normalizados__caso_relacionado__entidad_relacionada__isnull=True,
            mensajes_normalizados__caso_relacionado__cliente_relacionado__entidad_relacionada_id__in=allowed_entity_ids,
        )
    )
    if allowed_chat_ids:
        scope |= Q(chat_id__in=allowed_chat_ids) | Q(remitente__in=allowed_chat_ids)
    return WebhookEntrante.objects.filter(scope).distinct()


def serialize_configuracion(
    config: ConfiguracionComunicacion,
    request=None,
    *,
    include_email_overview: bool = True,
    include_whatsapp_overview: bool = True,
    whatsapp_channels: list[CanalWhatsappOficial] | None = None,
) -> dict:
    payload = {
        "id": config.id,
        "clave": config.clave,
        "green_api_api_url": config.green_api_api_url or DEFAULT_GREEN_API_URL,
        "green_api_instance_id": config.green_api_instance_id,
        "green_api_token": config.green_api_token,
        "green_api_webhook_url": config.green_api_webhook_url,
        "green_api_webhook_token": config.green_api_webhook_token,
        "green_api_modo_filtro": config.green_api_modo_filtro,
        "green_api_sync_settings": config.green_api_sync_settings,
        "procesar_webhooks_async": config.procesar_webhooks_async,
        "make_webhook_url": config.make_webhook_url,
        "openai_model": config.openai_model,
        "prompt_extraccion": config.prompt_extraccion,
        "auto_detectar_comprobantes": config.auto_detectar_comprobantes,
        "auto_crear_eventos": config.auto_crear_eventos,
        "auto_aplicar_eventos_confiables": config.auto_aplicar_eventos_confiables,
        "auto_conciliar_eventos": config.auto_conciliar_eventos,
        "umbral_confianza_autoaplicacion": float(
            config.umbral_confianza_autoaplicacion or Decimal("0")
        ),
        "ventana_match_dias": config.ventana_match_dias,
        "tolerancia_monto": float(config.tolerancia_monto or Decimal("0")),
        "email_activo": config.email_activo,
        "email_remitente_nombre": config.email_remitente_nombre,
        "email_remitente": config.email_remitente,
        "email_responder_a": config.email_responder_a,
        "respetar_bajas_whatsapp": config.respetar_bajas_whatsapp,
        "portal_token_horas": config.portal_token_horas,
        "activo": config.activo,
        "fecha_actualizacion": config.fecha_actualizacion,
    }
    if include_email_overview:
        payload.update(get_email_delivery_overview(request))
    if (
        include_whatsapp_overview
        and request is not None
        and has_whatsapp_automation_access(request)
    ):
        payload["whatsapp_cloud"] = serialize_whatsapp_overview(
            request,
            channels=whatsapp_channels,
        )
    return payload


def serialize_canal(canal: CanalPermitido) -> dict:
    return {
        "id": canal.id,
        "configuracion_id": canal.configuracion_relacionada_id,
        "canal": canal.canal,
        "nombre": canal.nombre,
        "identificador_externo": canal.identificador_externo,
        "entidad_id": canal.entidad_relacionada_id,
        "entidad_nombre": (
            canal.entidad_relacionada.nombre_comercial
            if canal.entidad_relacionada
            else None
        ),
        "cliente_id": canal.cliente_relacionado_id,
        "cliente_nombre": (
            canal.cliente_relacionado.razon_social or canal.cliente_relacionado.nombre_comercial
            if canal.cliente_relacionado
            else None
        ),
        "tipo_movimiento_default": canal.tipo_movimiento_default,
        "capturar_evidencias": canal.capturar_evidencias,
        "descripcion": canal.descripcion,
        "activo": canal.activo,
        "fecha_creacion": canal.fecha_creacion,
    }


def serialize_whatsapp_channel(canal: CanalWhatsappOficial) -> dict:
    return {
        "id": canal.id,
        "capa_id": canal.capa_negocio_id,
        "proveedor": canal.proveedor,
        "nombre": canal.nombre,
        "nombre_interno": canal.nombre_interno,
        "display_phone_number": canal.display_phone_number,
        "numero_wa_id": canal.numero_wa_id,
        "phone_number_id": canal.phone_number_id,
        "business_account_id": canal.business_account_id,
        "waba_id": canal.waba_id,
        "entidad_id": canal.entidad_relacionada_id,
        "entidad_nombre": (
            canal.entidad_relacionada.nombre_comercial
            if canal.entidad_relacionada
            else None
        ),
        "cliente_id": canal.cliente_relacionado_id,
        "cliente_nombre": (
            canal.cliente_relacionado.razon_social or canal.cliente_relacionado.nombre_comercial
            if canal.cliente_relacionado
            else None
        ),
        "estado": canal.estado,
        "puede_enviar": canal.puede_enviar,
        "puede_recibir": canal.puede_recibir,
        "es_principal": canal.es_principal,
        "activo": canal.activo,
        "metadata": canal.metadata or {},
        "webhook_fields": canal.webhook_fields or {},
        "access_token_configurado": bool((canal.access_token or "").strip()),
        "fecha_conexion": canal.fecha_conexion,
        "fecha_ultimo_check": canal.fecha_ultimo_check,
        "fecha_actualizacion": canal.fecha_actualizacion,
    }


def serialize_whatsapp_overview(
    request,
    *,
    channels: list[CanalWhatsappOficial] | None = None,
) -> dict:
    capa = get_current_capa(request)
    backend_base = (settings.BACKEND_PUBLIC_BASE_URL or "").rstrip("/")
    webhook_url = (
        f"{backend_base}/api/comunicaciones/whatsapp-cloud/webhook/"
        if backend_base
        else ""
    )
    active_channels = (
        [channel for channel in channels if channel.activo]
        if channels is not None
        else list(
            CanalWhatsappOficial.objects.select_related(
                "entidad_relacionada",
                "cliente_relacionado",
            ).filter(
                capa_negocio=capa,
                activo=True,
            )
        )
    )
    primary_channel = next(
        (channel for channel in active_channels if channel.es_principal),
        None,
    )
    whatsapp_templates = PlantillaMensaje.objects.filter(
        Q(canal__in=["WHATSAPP", "AMBOS"]),
        capa_negocio=capa,
        activo=True,
        tipo_plantilla__in=["RECORDATORIO_PAGO", "AVISO_INTERES"],
        whatsapp_template_name__isnull=False,
    ).exclude(whatsapp_template_name="")
    template_counts = whatsapp_templates.aggregate(
        total=Count("id"),
        approved=Count("id", filter=Q(whatsapp_template_status="APROBADA")),
    )
    active_automations_count = ReglaAutomatizacionMensaje.objects.filter(
        Q(canal__in=["WHATSAPP", "AMBOS"]),
        configuracion_relacionada__capa_negocio=capa,
        activo=True,
    ).count()
    app_id_ready = bool((settings.WHATSAPP_META_APP_ID or "").strip())
    app_secret_ready = bool((settings.WHATSAPP_META_APP_SECRET or "").strip())
    verify_token_ready = bool((settings.WHATSAPP_WEBHOOK_VERIFY_TOKEN or "").strip())
    webhook_ready = bool(backend_base and verify_token_ready)
    waba_subscription = (
        (primary_channel.metadata or {}).get("waba_subscription")
        if primary_channel
        else None
    )
    waba_subscription_ready = bool(
        waba_subscription
        and (
            waba_subscription.get("suscrita")
            or waba_subscription.get("subscribed")
        )
    )
    primary_ready = bool(
        primary_channel
        and primary_channel.puede_enviar
        and primary_channel.puede_recibir
        and primary_channel.estado == "CONECTADO"
        and (primary_channel.phone_number_id or "").strip()
        and (primary_channel.business_account_id or "").strip()
        and (primary_channel.access_token or "").strip()
    )
    checklist = [
        {
            "id": "meta_app",
            "titulo": "App de Meta configurada",
            "descripcion": "App ID y App Secret disponibles en Render.",
            "listo": app_id_ready and app_secret_ready,
            "detalle": "Lista" if app_id_ready and app_secret_ready else "Faltan variables de app.",
        },
        {
            "id": "webhook",
            "titulo": "Webhook publico verificado",
            "descripcion": "Callback y verify token preparados para recibir eventos.",
            "listo": webhook_ready,
            "detalle": webhook_url or "Falta BACKEND_PUBLIC_BASE_URL o verify token.",
        },
        {
            "id": "numero_principal",
            "titulo": "Numero definitivo registrado como principal",
            "descripcion": "Debe tener Phone Number ID, WABA, token y envio/recepcion activos.",
            "listo": primary_ready,
            "detalle": (
                primary_channel.display_phone_number
                if primary_ready and primary_channel
                else "Pendiente registrar o validar el numero real."
            ),
        },
        {
            "id": "waba_subscription",
            "titulo": "WABA suscrito a la app",
            "descripcion": "El WABA debe estar suscrito a la app de Meta para entregar mensajes entrantes al webhook.",
            "listo": waba_subscription_ready,
            "detalle": (
                "Suscripcion confirmada con Meta."
                if waba_subscription_ready
                else "Verifica o alinea la suscripcion del WABA en Webhook y eventos."
            ),
        },
        {
            "id": "plantillas_aprobadas",
            "titulo": "Plantillas WhatsApp aprobadas por Meta",
            "descripcion": "Necesario para iniciar conversaciones fuera de la ventana de 24 horas.",
            "listo": template_counts["approved"] > 0,
            "detalle": f"{template_counts['approved']} aprobada(s) de {template_counts['total']} configurada(s).",
        },
        {
            "id": "automatizaciones_pausadas",
            "titulo": "Automatizaciones sin activar",
            "descripcion": "El corte queda preparado, pero no se prenden envios automaticos todavia.",
            "listo": active_automations_count == 0,
            "detalle": (
                "Sin automatizaciones activas."
                if active_automations_count == 0
                else f"{active_automations_count} automatizacion(es) activas."
            ),
        },
    ]
    blockers = [
        item["titulo"]
        for item in checklist
        if not item["listo"] and item["id"] != "automatizaciones_pausadas"
    ]
    return {
        "provider": "WhatsApp Cloud API (Meta)",
        "backend_public_base_url": backend_base or None,
        "webhook_url": webhook_url or None,
        "app_id": (settings.WHATSAPP_META_APP_ID or "").strip() or None,
        "embedded_signup_config_id": (
            settings.WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID or ""
        ).strip()
        or None,
        "verify_token_configurado": bool(
            (settings.WHATSAPP_WEBHOOK_VERIFY_TOKEN or "").strip()
        ),
        "app_id_configurada": bool((settings.WHATSAPP_META_APP_ID or "").strip()),
        "app_secret_configurado": bool(
            (settings.WHATSAPP_META_APP_SECRET or "").strip()
        ),
        "config_id_configurada": bool(
            (settings.WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID or "").strip()
        ),
        "embedded_signup_ready": bool(
            (settings.WHATSAPP_META_APP_ID or "").strip()
            and (settings.WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID or "").strip()
        ),
        "graph_api_base_url": settings.WHATSAPP_CLOUD_API_BASE_URL,
        "graph_api_version": settings.WHATSAPP_CLOUD_API_VERSION,
        "canales_activos": len(active_channels),
        "canales_principales": sum(1 for channel in active_channels if channel.es_principal),
        "waba_subscription": waba_subscription,
        "produccion_checklist": checklist,
        "produccion_preparacion": {
            "modo": "PREPARACION",
            "activo": False,
            "listo_para_cambio": not blockers,
            "bloqueantes": blockers,
            "nota": "Preparado para corte, sin activar envios automaticos.",
            "numero_principal": (
                serialize_whatsapp_channel(primary_channel) if primary_channel else None
            ),
            "plantillas_whatsapp": template_counts["total"],
            "plantillas_meta_aprobadas": template_counts["approved"],
            "automatizaciones_activas": active_automations_count,
        },
    }


def serialize_mensaje(mensaje: MensajeEntrante) -> dict:
    return {
        "id": mensaje.id,
        "caso_id": mensaje.caso_relacionado_id,
        "entidad_id": mensaje.entidad_relacionada_id,
        "cliente_id": mensaje.cliente_relacionado_id,
        "chat_id": mensaje.chat_id,
        "origen_externo_id": mensaje.origen_externo_id,
        "canal": mensaje.canal,
        "tipo_mensaje": mensaje.tipo_mensaje,
        "remitente": mensaje.remitente,
        "remitente_nombre": mensaje.remitente_nombre,
        "fecha_mensaje": mensaje.fecha_mensaje,
        "texto": mensaje.texto,
        "url_adjunto": mensaje.url_adjunto,
        "metadata": mensaje.metadata or {},
        "procesado": mensaje.procesado,
    }


def build_evidence_trace(evidencia: EvidenciaPago) -> dict:
    cxc_payments = list(evidencia.pagos_cxc.all())
    cxp_payments = list(evidencia.pagos_cxp.all())
    payments = cxc_payments + cxp_payments
    active_payments = [
        payment for payment in payments if payment.estatus_validacion != "RECHAZADO"
    ]
    validated_payments = [
        payment for payment in active_payments if payment.estatus_validacion == "VALIDADO"
    ]
    events = list(evidencia.eventos_financieros.all())
    active_events = [
        event for event in events if event.estatus not in {"DESCARTADO", "DUPLICADO"}
    ]
    linked_transactions = {
        payment.transaccion_relacionada_id
        for payment in active_payments
        if payment.transaccion_relacionada_id
    }
    linked_transactions.update(
        event.transaccion_relacionada_id
        for event in active_events
        if event.transaccion_relacionada_id
    )
    applied = bool(active_payments) or any(
        event.estatus in {"APLICADO", "CONCILIADO"} for event in active_events
    )
    reconciled = bool(linked_transactions) or any(
        event.estatus == "CONCILIADO" for event in active_events
    )
    validated = (
        evidencia.estatus in {"VALIDADA", "APLICADA"}
        or bool(validated_payments)
        or any(event.estatus in {"APLICADO", "CONCILIADO"} for event in active_events)
    )

    if evidencia.estatus == "DESCARTADA":
        current_stage = "DESCARTADO"
    elif reconciled:
        current_stage = "CONCILIADO"
    elif applied:
        current_stage = "APLICADO"
    elif validated:
        current_stage = "VALIDADO"
    elif evidencia.requiere_revision_manual:
        current_stage = "REVISION"
    else:
        current_stage = "RECIBIDO"

    return {
        "etapa_actual": current_stage,
        "pasos": [
            {"clave": "RECIBIDO", "completo": True},
            {"clave": "VALIDADO", "completo": validated},
            {"clave": "APLICADO", "completo": applied},
            {"clave": "CONCILIADO", "completo": reconciled},
        ],
        "pagos": {
            "total": len(payments),
            "activos": len(active_payments),
            "validados": len(validated_payments),
            "rechazados": len(payments) - len(active_payments),
        },
        "eventos": {
            "total": len(events),
            "activos": len(active_events),
            "conciliados": sum(1 for event in active_events if event.estatus == "CONCILIADO"),
        },
        "transacciones": {
            "total": len(linked_transactions),
            "ids": sorted(linked_transactions),
        },
        "evento_id": active_events[0].id if active_events else None,
        "transaccion_id": sorted(linked_transactions)[0] if linked_transactions else None,
    }


def get_evidence_effective_entity(evidencia: EvidenciaPago) -> EntidadNegocio | None:
    if evidencia.entidad_relacionada_id:
        return evidencia.entidad_relacionada
    if evidencia.cliente_relacionado_id and evidencia.cliente_relacionado:
        return evidencia.cliente_relacionado.entidad_relacionada
    return None


def build_evidence_duplicate_state(evidencia: EvidenciaPago) -> dict:
    checks = Q()
    reasons: list[str] = []
    if evidencia.hash_archivo:
        checks |= Q(hash_archivo=evidencia.hash_archivo)
        reasons.append("mismo archivo")
    if (
        evidencia.cliente_relacionado_id
        and evidencia.monto_reportado
        and evidencia.fecha_pago_reportada
    ):
        checks |= Q(
            cliente_relacionado_id=evidencia.cliente_relacionado_id,
            monto_reportado=evidencia.monto_reportado,
            fecha_pago_reportada=evidencia.fecha_pago_reportada,
        )
        reasons.append("mismo cliente, monto y fecha")
    if evidencia.referencia_reportada and evidencia.cliente_relacionado_id:
        checks |= Q(
            cliente_relacionado_id=evidencia.cliente_relacionado_id,
            referencia_reportada__iexact=evidencia.referencia_reportada,
        )
        reasons.append("misma referencia del cliente")

    if not checks:
        return {"posible": False, "evidencia_ids": [], "motivos": []}

    matches = list(
        EvidenciaPago.objects.filter(checks)
        .exclude(id=evidencia.id)
        .exclude(estatus="DESCARTADA")
        .order_by("-fecha_registro", "-id")
        .values_list("id", flat=True)[:5]
    )
    return {
        "posible": bool(matches),
        "evidencia_ids": matches,
        "motivos": reasons if matches else [],
    }


def build_cxc_candidate_prefetch_queryset():
    return (
        CuentaPorCobrar.objects.select_related(
            "entidad_relacionada",
            "cliente_relacionado",
            "cliente_relacionado__entidad_relacionada",
        )
        .filter(monto_total__gt=F("monto_pagado"))
        .exclude(estatus_adeudo__in=["CONCILIADO", "CANCELADO", "INCOBRABLE"])
        .order_by("fecha_vencimiento", "id")
    )


def build_evidence_cxc_candidates(evidencia: EvidenciaPago, *, limit: int = 5) -> list[dict]:
    if not evidencia.cliente_relacionado_id:
        return []
    entity = get_evidence_effective_entity(evidencia)
    prefetched_accounts = None
    if evidencia.cliente_relacionado_id and evidencia.cliente_relacionado:
        prefetched_accounts = getattr(
            evidencia.cliente_relacionado,
            "_prefetched_open_cxc_accounts",
            None,
        )

    if prefetched_accounts is not None:
        accounts = list(prefetched_accounts)
        if entity:
            scoped_accounts = [
                cuenta
                for cuenta in accounts
                if cuenta.entidad_relacionada_id == entity.id
                or (
                    cuenta.entidad_relacionada_id is None
                    and cuenta.cliente_relacionado.entidad_relacionada_id == entity.id
                )
            ]
            if scoped_accounts:
                accounts = scoped_accounts
            else:
                accounts = [
                    cuenta
                    for cuenta in accounts
                    if (
                        cuenta.entidad_relacionada
                        and cuenta.entidad_relacionada.capa_negocio_id == entity.capa_negocio_id
                    )
                    or (
                        cuenta.entidad_relacionada_id is None
                        and cuenta.cliente_relacionado.entidad_relacionada
                        and cuenta.cliente_relacionado.entidad_relacionada.capa_negocio_id
                        == entity.capa_negocio_id
                    )
                ]
        queryset = sorted(accounts, key=lambda cuenta: (cuenta.fecha_vencimiento, cuenta.id))[
            :limit
        ]
    else:
        base_queryset = build_cxc_candidate_prefetch_queryset().filter(
            cliente_relacionado_id=evidencia.cliente_relacionado_id,
        )
        if entity:
            scoped_queryset = base_queryset.filter(
                Q(entidad_relacionada=entity)
                | Q(
                    entidad_relacionada__isnull=True,
                    cliente_relacionado__entidad_relacionada=entity,
                )
            )
            if scoped_queryset.exists():
                queryset = scoped_queryset
            else:
                queryset = base_queryset.filter(
                    Q(entidad_relacionada__capa_negocio=entity.capa_negocio)
                    | Q(
                        entidad_relacionada__isnull=True,
                        cliente_relacionado__entidad_relacionada__capa_negocio=entity.capa_negocio,
                    )
                )
        else:
            queryset = base_queryset
        queryset = queryset[:limit]
    amount = evidencia.monto_reportado or Decimal("0")
    reference = (evidencia.referencia_reportada or "").strip().lower()
    candidates = []
    for cuenta in queryset:
        saldo = cuenta.saldo_pendiente
        reasons = []
        if amount > 0 and saldo == amount:
            reasons.append("monto exacto")
        elif amount > 0 and amount < saldo:
            reasons.append("pago parcial posible")
        elif amount > 0 and amount > saldo:
            reasons.append("excedente aplicable")
        if reference and (
            reference in (cuenta.referencia_unica or "").lower()
            or reference in (cuenta.concepto or "").lower()
        ):
            reasons.append("referencia compatible")
        if not reasons:
            reasons.append("misma cartera del cliente")
        candidates.append(
            {
                "id": cuenta.id,
                "concepto": cuenta.concepto,
                "entidad_nombre": (
                    cuenta.entidad_relacionada.nombre_comercial
                    if cuenta.entidad_relacionada
                    else (
                        entity.nombre_comercial
                        if entity
                        else cuenta.cliente_relacionado.entidad_relacionada.nombre_comercial
                    )
                ),
                "fecha_periodo_inicio": cuenta.fecha_periodo_inicio,
                "fecha_periodo_fin": cuenta.fecha_periodo_fin,
                "fecha_vencimiento": cuenta.fecha_vencimiento,
                "monto_total": decimal_to_float(cuenta.monto_total),
                "monto_pagado": decimal_to_float(cuenta.monto_pagado),
                "saldo_pendiente": decimal_to_float(saldo),
                "estatus_adeudo": cuenta.estatus_adeudo,
                "referencia_unica": cuenta.referencia_unica,
                "motivos": reasons,
            }
        )
    return candidates


def create_evidence_cxc_financial_event(
    *,
    evidencia: EvidenciaPago,
    cuenta: CuentaPorCobrar,
    payment_result: dict[str, object],
    monto: Decimal,
    fecha_pago: date,
    referencia: str,
    notas: str,
) -> EventoFinanciero | None:
    aplicaciones = payment_result.get("aplicaciones") or []
    saldo_a_favor = Decimal(str(payment_result.get("saldo_a_favor") or "0"))
    if not aplicaciones and saldo_a_favor <= 0:
        return None
    cliente = cuenta.cliente_relacionado or evidencia.cliente_relacionado
    entidad = cuenta.entidad_relacionada or get_evidence_effective_entity(evidencia)
    if not cliente or not entidad:
        return None

    payment_ids: list[int] = []
    partidas = []
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
                "cuenta_cxc_id": int(cuenta_id) if cuenta_id else cuenta.id,
                "concepto": str(item.get("concepto") or cuenta.concepto or "Pago CxC"),
                "beneficiario": cliente.razon_social or cliente.nombre_comercial or "",
                "monto_partida": Decimal(str(item.get("monto_aplicado") or "0")),
                "periodo_referencia": fecha_pago.strftime("%B %Y"),
                "estatus": "APLICADA",
                "metadata": {
                    "origen": "COMPROBANTE_COBRANZA",
                    "pago_id": pago_id,
                    "cuenta_id": cuenta_id,
                    "evidencia_id": evidencia.id,
                },
                "observaciones": (
                    "Pago aplicado desde bandeja de comprobantes; pendiente de "
                    "conciliacion bancaria."
                ),
            }
        )

    if saldo_a_favor > 0:
        partidas.append(
            {
                "tipo_destino": "SALDO_A_FAVOR",
                "entidad_id": entidad.id,
                "cliente_id": cliente.id,
                "concepto": "Saldo a favor por excedente de comprobante",
                "beneficiario": cliente.razon_social or cliente.nombre_comercial or "",
                "monto_partida": saldo_a_favor,
                "periodo_referencia": fecha_pago.strftime("%B %Y"),
                "estatus": "APLICADA",
                "metadata": {
                    "origen": "COMPROBANTE_COBRANZA",
                    "evidencia_id": evidencia.id,
                    "saldo_a_favor": decimal_to_float(saldo_a_favor),
                },
                "observaciones": "Excedente guardado como saldo a favor del cliente.",
            }
        )

    event = upsert_financial_event(
        caso_id=evidencia.caso_relacionado_id,
        evidencia_id=evidencia.id,
        entidad_id=entidad.id,
        cliente_id=cliente.id,
        origen_evento="WHATSAPP" if evidencia.canal == "WHATSAPP" else "MANUAL",
        tipo_movimiento="INGRESO",
        beneficiario_principal=cliente.razon_social or cliente.nombre_comercial or "",
        referencia_principal=referencia.strip(),
        fecha_evento=fecha_pago,
        monto_total_reportado=monto,
        confianza_global=evidencia.confianza_clasificacion or Decimal("0"),
        requiere_revision_manual=False,
        texto_consolidado="\n".join(
            item
            for item in [evidencia.texto_extraido, evidencia.observaciones]
            if isinstance(item, str) and item.strip()
        ),
        raw_data={
            "origen": "COMPROBANTE_COBRANZA",
            "evidencia_id": evidencia.id,
            "cuenta_id": cuenta.id,
            "aplicaciones": aplicaciones,
            "saldo_a_favor": decimal_to_float(saldo_a_favor),
        },
        observaciones=notas.strip()
        or "Pago aplicado desde bandeja de comprobantes.",
        estatus="APLICADO",
        partidas=partidas,
    )
    if payment_ids:
        PagoCuentaPorCobrar.objects.filter(id__in=payment_ids).update(
            evento_financiero_relacionado=event
        )
    return event


def serialize_evidencia(evidencia: EvidenciaPago) -> dict:
    return {
        "id": evidencia.id,
        "caso_id": evidencia.caso_relacionado_id,
        "entidad_id": evidencia.entidad_relacionada_id,
        "entidad_nombre": (
            evidencia.entidad_relacionada.nombre_comercial
            if evidencia.entidad_relacionada
            else None
        ),
        "cliente_id": evidencia.cliente_relacionado_id,
        "cliente_nombre": (
            evidencia.cliente_relacionado.razon_social
            or evidencia.cliente_relacionado.nombre_comercial
            if evidencia.cliente_relacionado
            else None
        ),
        "mensaje_id": evidencia.mensaje_relacionado_id,
        "canal": evidencia.canal,
        "tipo_movimiento": evidencia.tipo_movimiento,
        "origen_deteccion": evidencia.origen_deteccion,
        "url_archivo": evidencia.url_archivo,
        "hash_archivo": evidencia.hash_archivo,
        "monto_reportado": float(evidencia.monto_reportado or Decimal("0")),
        "fecha_pago_reportada": evidencia.fecha_pago_reportada,
        "referencia_reportada": evidencia.referencia_reportada,
        "texto_extraido": evidencia.texto_extraido,
        "confianza_clasificacion": float(
            evidencia.confianza_clasificacion or Decimal("0")
        ),
        "requiere_revision_manual": evidencia.requiere_revision_manual,
        "categoria_sugerida": evidencia.categoria_sugerida,
        "metadata": evidencia.metadata or {},
        "observaciones": evidencia.observaciones,
        "estatus": evidencia.estatus,
        "trazabilidad": build_evidence_trace(evidencia),
        "duplicado_posible": build_evidence_duplicate_state(evidencia),
        "cxc_candidatas": build_evidence_cxc_candidates(evidencia),
        "fecha_registro": evidencia.fecha_registro,
    }


def serialize_webhook(webhook: WebhookEntrante) -> dict:
    return {
        "id": webhook.id,
        "proveedor": webhook.proveedor,
        "tipo_webhook": webhook.tipo_webhook,
        "origen_externo_id": webhook.origen_externo_id,
        "chat_id": webhook.chat_id,
        "remitente": webhook.remitente,
        "estatus_procesamiento": webhook.estatus_procesamiento,
        "intentos_procesamiento": webhook.intentos_procesamiento,
        "error_procesamiento": webhook.error_procesamiento,
        "procesado": webhook.procesado,
        "fecha_recepcion": webhook.fecha_recepcion,
        "fecha_procesamiento": webhook.fecha_procesamiento,
    }


def serialize_caso(caso: CasoProcesamiento) -> dict:
    mensajes_count = getattr(caso, "mensajes_count", None)
    if mensajes_count is None:
        mensajes_count = caso.mensajes.count()
    evidencias_count = getattr(caso, "evidencias_count", None)
    if evidencias_count is None:
        evidencias_count = caso.evidencias.count()
    eventos_count = getattr(caso, "eventos_count", None)
    if eventos_count is None:
        eventos_count = caso.eventos_financieros.count()

    return {
        "id": caso.id,
        "entidad_id": caso.entidad_relacionada_id,
        "entidad_nombre": (
            caso.entidad_relacionada.nombre_comercial
            if caso.entidad_relacionada
            else None
        ),
        "cliente_id": caso.cliente_relacionado_id,
        "cliente_nombre": (
            caso.cliente_relacionado.razon_social or caso.cliente_relacionado.nombre_comercial
            if caso.cliente_relacionado
            else None
        ),
        "clave_externa": caso.clave_externa,
        "grupo_externo_id": caso.grupo_externo_id,
        "canal": caso.canal,
        "remitente": caso.remitente,
        "remitente_nombre": caso.remitente_nombre,
        "estatus": caso.estatus,
        "texto_consolidado": caso.texto_consolidado,
        "caption_consolidado": caso.caption_consolidado,
        "metadata": caso.metadata or {},
        "fecha_ultimo_mensaje": caso.fecha_ultimo_mensaje,
        "fecha_registro": caso.fecha_registro,
        "fecha_actualizacion": caso.fecha_actualizacion,
        "mensajes_count": mensajes_count,
        "evidencias_count": evidencias_count,
        "eventos_count": eventos_count,
    }


def serialize_caso_detail(caso: CasoProcesamiento) -> dict:
    mensajes = getattr(caso, "_prefetched_detail_messages", None)
    if mensajes is None:
        mensajes = caso.mensajes.order_by("-fecha_mensaje", "-id")[:50]
    else:
        mensajes = mensajes[:50]

    evidencias = getattr(caso, "_prefetched_detail_evidences", None)
    if evidencias is None:
        evidencias = (
            caso.evidencias.select_related(
                "entidad_relacionada",
                "cliente_relacionado",
                "cliente_relacionado__entidad_relacionada",
                "mensaje_relacionado",
            )
            .prefetch_related(
                "pagos_cxc",
                "pagos_cxp",
                "eventos_financieros",
                Prefetch(
                    "cliente_relacionado__cuentas_por_cobrar",
                    queryset=build_cxc_candidate_prefetch_queryset(),
                    to_attr="_prefetched_open_cxc_accounts",
                ),
            )
            .order_by("-fecha_registro", "-id")[:25]
        )
    else:
        evidencias = evidencias[:25]

    eventos = getattr(caso, "_prefetched_detail_events", None)
    if eventos is None:
        eventos = caso.eventos_financieros.order_by("-fecha_evento", "-id")[:15]
    else:
        eventos = eventos[:15]

    return {
        **serialize_caso(caso),
        "mensajes": [serialize_mensaje(item) for item in mensajes],
        "evidencias": [
            serialize_evidencia(item)
            for item in evidencias
        ],
        "eventos": [
            {
                "id": evento.id,
                "estatus": evento.estatus,
                "tipo_movimiento": evento.tipo_movimiento,
                "monto_total_reportado": float(evento.monto_total_reportado or Decimal("0")),
                "fecha_evento": evento.fecha_evento,
                "transaccion_id": evento.transaccion_relacionada_id,
            }
            for evento in eventos
        ],
    }


def apply_configuracion_payload(
    config: ConfiguracionComunicacion,
    payload: ConfiguracionComunicacionIn,
) -> ConfiguracionComunicacion:
    config.clave = payload.clave.strip() or "PRINCIPAL"
    config.green_api_api_url = payload.green_api_api_url.strip() or DEFAULT_GREEN_API_URL
    config.green_api_instance_id = payload.green_api_instance_id.strip() or None
    config.green_api_token = payload.green_api_token.strip() or None
    config.green_api_webhook_url = payload.green_api_webhook_url.strip() or None
    config.green_api_webhook_token = payload.green_api_webhook_token.strip() or None
    config.green_api_modo_filtro = payload.green_api_modo_filtro
    config.green_api_sync_settings = payload.green_api_sync_settings
    config.procesar_webhooks_async = payload.procesar_webhooks_async
    config.make_webhook_url = payload.make_webhook_url.strip() or None
    config.openai_model = payload.openai_model.strip() or None
    config.prompt_extraccion = payload.prompt_extraccion.strip() or None
    config.auto_detectar_comprobantes = payload.auto_detectar_comprobantes
    config.auto_crear_eventos = payload.auto_crear_eventos
    config.auto_aplicar_eventos_confiables = payload.auto_aplicar_eventos_confiables
    config.auto_conciliar_eventos = payload.auto_conciliar_eventos
    config.umbral_confianza_autoaplicacion = clamp_money(
        payload.umbral_confianza_autoaplicacion
    )
    config.ventana_match_dias = max(payload.ventana_match_dias, 1)
    config.tolerancia_monto = clamp_money(payload.tolerancia_monto)
    config.email_activo = payload.email_activo
    config.email_remitente_nombre = payload.email_remitente_nombre.strip() or None
    config.email_remitente = payload.email_remitente.strip() or None
    config.email_responder_a = payload.email_responder_a.strip() or None
    config.respetar_bajas_whatsapp = payload.respetar_bajas_whatsapp
    config.portal_token_horas = max(payload.portal_token_horas, 1)
    config.activo = payload.activo
    return config


def append_text(existing: str | None, new_value: str | None) -> str | None:
    new_text = (new_value or "").strip()
    if not new_text:
        return existing
    current = (existing or "").strip()
    if not current:
        return new_text
    if new_text in current:
        return current
    return f"{current}\n{new_text}"


def split_observation_fragments(value: str | None) -> list[str]:
    fragments: list[str] = []
    for line in (value or "").splitlines():
        for part in line.split(";"):
            fragment = part.strip()
            if fragment:
                fragments.append(fragment)
    return fragments


def append_observations(existing: str | None, new_value: str | None) -> str | None:
    fragments: list[str] = []
    seen: set[str] = set()
    for fragment in [
        *split_observation_fragments(existing),
        *split_observation_fragments(new_value),
    ]:
        key = normalize_lookup_text(fragment)
        if not key or key in seen:
            continue
        seen.add(key)
        fragments.append(fragment)
    return "; ".join(fragments) if fragments else None


def clean_analysis_observation_history(existing: str | None) -> str | None:
    technical_markers = [
        "archivo cargado",
        "el mensaje trae un archivo",
        "se detecto un monto utilizable",
        "se detectaron palabras clave",
        "openai no esta configurado",
        "google vision rechazo",
        "google vision ocr leyo",
        "no se pudo completar la lectura visual",
        "se usaron reglas sin lectura visual",
        "requiere ia visual",
        "sin texto utilizable por reglas",
        "descartado desde cobranza",
        "validado desde cobranza",
        "clasificado desde cobranza",
        "datos del comprobante corregidos manualmente",
    ]
    fragments: list[str] = []
    for fragment in split_observation_fragments(existing):
        normalized = normalize_lookup_text(fragment)
        if any(marker in normalized for marker in technical_markers):
            continue
        fragments.append(fragment)
    return append_observations(None, "; ".join(fragments))


def build_receipt_analysis_observation_summary(
    *,
    source_name: str,
    amount: Decimal | None,
    payment_date: date | None,
    reference: str,
    requires_review: bool,
    observations: str,
) -> str:
    normalized_source = source_name.strip().lower()
    if normalized_source in {"google_vision", "openai"}:
        source_label = "Google Vision OCR" if normalized_source == "google_vision" else "OpenAI"
        detected = []
        if amount:
            detected.append(f"monto {amount}")
        if payment_date:
            detected.append(f"fecha {payment_date.isoformat()}")
        if reference:
            detected.append(f"referencia {reference}")
        detail = f" Datos detectados: {', '.join(detected)}." if detected else ""
        review_note = (
            " Requiere revision humana antes de aplicar."
            if requires_review
            else " Lista para revision operativa."
        )
        return f"Lectura visual completada con {source_label}.{detail}{review_note}"
    return observations


def normalize_lookup_text(value: str | None) -> str:
    source = (
        unicodedata.normalize("NFKD", value or "")
        .encode("ascii", "ignore")
        .decode("ascii")
        .lower()
    )
    return re.sub(r"[^a-z0-9]+", " ", source).strip()


def amount_match_has_context(value: str, start: int, end: int) -> bool:
    window = value[max(0, start - 35) : min(len(value), end + 35)]
    if "$" in window:
        return True
    normalized_window = normalize_lookup_text(window)
    return any(keyword in normalized_window for keyword in AMOUNT_CONTEXT_KEYWORDS)


def extract_amount_from_text(*values: str | None) -> Decimal | None:
    candidates: list[Decimal] = []
    for value in values:
        text = value or ""
        for match in AMOUNT_PATTERN.finditer(text):
            if not amount_match_has_context(text, match.start(), match.end()):
                continue
            normalized = match.group(1).replace(" ", "").replace(",", "")
            try:
                amount = Decimal(normalized)
            except Exception:
                continue
            if amount > 0:
                candidates.append(amount)
    if not candidates:
        return None
    return max(candidates)


def extract_reference_from_text(*values: str | None) -> str | None:
    rejected_values = {
        "CLABE",
        "CONCEPTO",
        "CUENTA",
        "DESTINO",
        "ENTIDAD",
        "ESTATUS",
        "FECHA",
        "HORA",
        "IMPORTE",
        "NOMBRE",
        "ORIGEN",
        "SPEI",
        "TIPO",
    }
    for value in values:
        text = value or ""
        normalized = normalize_lookup_text(text)
        normalized_match = re.search(
            r"\b(?:numero de referencia|referencia de pago|referencia interna|referencia|"
            r"folio de la operacion|folio|clave de rastreo|spei|operacion)\s+"
            r"([a-z0-9][a-z0-9\-]{3,})\b",
            normalized,
            re.IGNORECASE,
        )
        if normalized_match:
            reference = normalized_match.group(1).strip().upper()
            if reference not in rejected_values:
                return reference
        for pattern in REFERENCE_PATTERNS:
            match = pattern.search(text)
            if not match:
                continue
            reference = match.group(1).strip().upper()
            if reference in rejected_values:
                continue
            return reference
    return None


def extract_payment_date_from_text(*values: str | None) -> date | None:
    combined = "\n".join(value or "" for value in values)
    for match in re.finditer(
        r"\b(\d{1,2})\s+(?:de\s+)?("
        + "|".join(SPANISH_MONTHS)
        + r")\s+(?:de\s+)?(\d{4})\b",
        combined,
        re.IGNORECASE,
    ):
        day = int(match.group(1))
        month = SPANISH_MONTHS[match.group(2).lower()]
        year = int(match.group(3))
        try:
            return date(year, month, day)
        except ValueError:
            continue
    for match in re.finditer(r"\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b", combined):
        day = int(match.group(1))
        month = int(match.group(2))
        year = int(match.group(3))
        if year < 100:
            year += 2000
        try:
            return date(year, month, day)
        except ValueError:
            continue
    return None


def extract_bank_from_text(*values: str | None) -> str:
    normalized = normalize_lookup_text("\n".join(value or "" for value in values))
    compact = normalized.replace(" ", "")
    for bank in BANK_KEYWORDS:
        if normalize_lookup_text(bank).replace(" ", "") in compact:
            return bank
    return ""


def extract_labeled_receipt_value(text: str, *labels: str) -> str:
    lines = [line.strip() for line in (text or "").splitlines() if line.strip()]
    normalized_labels = {normalize_lookup_text(label) for label in labels}
    for index, line in enumerate(lines):
        normalized = normalize_lookup_text(line)
        for label in normalized_labels:
            if normalized == label and index + 1 < len(lines):
                return lines[index + 1][:180]
            if normalized.startswith(label):
                remainder = line[len(label) :].strip(" :#-")
                if remainder:
                    return remainder[:180]
    return ""


def infer_receipt_image_content_type(url: str, response_content_type: str = "") -> str:
    content_type = (response_content_type or "").split(";", 1)[0].strip().lower()
    if content_type in {"image/jpeg", "image/png", "image/webp"}:
        return content_type
    guessed, _encoding = mimetypes.guess_type(url.split("?", 1)[0])
    if guessed in {"image/jpeg", "image/png", "image/webp"}:
        return guessed
    return "image/jpeg"


def download_receipt_image_content(
    url: str | None,
) -> tuple[bytes | None, str, dict[str, object]]:
    normalized_url = (url or "").strip()
    if not is_ai_receipt_image_url(normalized_url):
        return None, "", {
            "modo": "sin_imagen",
            "motivo": "El archivo no es una imagen compatible.",
        }
    try:
        response = requests.get(normalized_url, timeout=20)
    except Exception as error:
        return None, "", {
            "modo": "url",
            "motivo": f"No se pudo descargar la imagen: {error}",
        }
    if response.status_code >= 400 or not response.content:
        return None, "", {
            "modo": "url",
            "motivo": "No se pudo descargar la imagen; se envio URL publica.",
        }
    content = response.content[: AI_RECEIPT_IMAGE_DOWNLOAD_MAX_BYTES + 1]
    if len(content) > AI_RECEIPT_IMAGE_DOWNLOAD_MAX_BYTES:
        return None, "", {
            "modo": "url",
            "motivo": "La imagen excede el limite para inline.",
        }
    content_type = infer_receipt_image_content_type(
        normalized_url,
        response.headers.get("Content-Type", ""),
    )
    return content, content_type, {
        "modo": "base64",
        "content_type": content_type,
        "bytes": len(content),
    }


def build_openai_receipt_image_input(
    evidencia: EvidenciaPago,
) -> tuple[dict[str, str] | None, dict[str, object]]:
    url = evidencia.url_archivo or ""
    content, content_type, image_meta = download_receipt_image_content(url)
    if content:
        encoded = base64.b64encode(content).decode("ascii")
        return (
            {
                "type": "input_image",
                "image_url": f"data:{content_type};base64,{encoded}",
            },
            image_meta,
        )
    if image_meta.get("modo") == "sin_imagen":
        return None, image_meta
    return (
        {"type": "input_image", "image_url": url},
        image_meta,
    )


def extract_response_output_text(response_data: dict) -> str:
    if isinstance(response_data.get("output_text"), str):
        return response_data["output_text"]
    for output in response_data.get("output", []) or []:
        for content in output.get("content", []) or []:
            if content.get("type") == "output_text" and content.get("text"):
                return content["text"]
    return ""


def parse_json_object(raw_text: str) -> dict:
    text = (raw_text or "").strip()
    if not text:
        return {}
    try:
        payload = json.loads(text)
        return payload if isinstance(payload, dict) else {}
    except json.JSONDecodeError:
        decoder = json.JSONDecoder()
        for index, char in enumerate(text):
            if char != "{":
                continue
            try:
                payload, _end = decoder.raw_decode(text[index:])
                if isinstance(payload, dict):
                    return payload
            except json.JSONDecodeError:
                continue
    return {}


def parse_decimal_value(value) -> Decimal | None:
    if value in (None, ""):
        return None
    try:
        parsed = Decimal(str(value).replace("$", "").replace(",", "").strip())
    except Exception:
        return None
    return parsed if parsed > 0 else None


def parse_date_value(value) -> date | None:
    raw_value = str(value or "").strip()
    if not raw_value:
        return None
    try:
        return date.fromisoformat(raw_value[:10])
    except ValueError:
        normalized_value = re.sub(
            r"\b([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{3,})\.",
            r"\1",
            raw_value,
        )
        return extract_payment_date_from_text(normalized_value)


def clamp_confidence(value) -> Decimal:
    parsed = clamp_money(parse_decimal_value(value) or Decimal("0"))
    return min(parsed, Decimal("99.99"))


def is_ai_receipt_image_url(url: str | None) -> bool:
    path = os.path.splitext((url or "").split("?", 1)[0])[1].lower()
    return path in AI_RECEIPT_IMAGE_EXTENSIONS


def build_receipt_analysis_context(evidencia: EvidenciaPago) -> dict:
    return {
        "evidencia_id": evidencia.id,
        "cliente": (
            evidencia.cliente_relacionado.razon_social
            or evidencia.cliente_relacionado.nombre_comercial
            if evidencia.cliente_relacionado
            else ""
        ),
        "entidad": (
            evidencia.entidad_relacionada.nombre_comercial
            if evidencia.entidad_relacionada
            else ""
        ),
        "monto_reportado_actual": str(evidencia.monto_reportado or ""),
        "fecha_pago_reportada_actual": (
            evidencia.fecha_pago_reportada.isoformat()
            if evidencia.fecha_pago_reportada
            else ""
        ),
        "referencia_reportada_actual": evidencia.referencia_reportada or "",
        "texto_existente": (evidencia.texto_extraido or "")[:AI_RECEIPT_TEXT_LIMIT],
        "observaciones_previas": (evidencia.observaciones or "")[:AI_RECEIPT_TEXT_LIMIT],
        "url_archivo": evidencia.url_archivo or "",
        "metadata": evidencia.metadata or {},
    }


def clean_rule_receipt_text(value: str | None) -> str:
    lines: list[str] = []
    for line in (value or "").splitlines():
        clean_line = line.strip()
        normalized = clean_line.lower()
        if not clean_line:
            continue
        if normalized.startswith(("http://", "https://")):
            continue
        if normalized.startswith("archivo cargado:"):
            continue
        if "el mensaje trae un archivo" in normalized:
            continue
        if "se detecto un monto utilizable" in normalized:
            continue
        if "openai no esta configurado" in normalized:
            continue
        if "no se pudo completar la lectura visual" in normalized:
            continue
        if "requiere ia visual" in normalized:
            continue
        if re.search(r"\.(jpg|jpeg|png|webp|pdf)(\s|$)", normalized):
            continue
        lines.append(clean_line)
    return "\n".join(lines)


def previous_amount_looks_like_rule_guess(evidencia: EvidenciaPago) -> bool:
    metadata = evidencia.metadata or {}
    reading = metadata.get("lectura_ia") if isinstance(metadata, dict) else None
    if not isinstance(reading, dict):
        return False
    return bool(
        reading.get("fuente") == "reglas"
        and reading.get("requiere_revision_manual")
        and evidencia.monto_reportado
        and not evidencia.fecha_pago_reportada
        and not evidencia.referencia_reportada
    )


def build_rule_receipt_analysis(
    *,
    config: ConfiguracionComunicacion,
    evidencia: EvidenciaPago,
    fallback_reason: str = "",
    source_text_override: str | None = None,
    source_label: str = "reglas",
    source_model: str | None = None,
    source_raw: dict[str, object] | None = None,
    archivo_visual: dict[str, object] | None = None,
) -> dict[str, object]:
    context = build_receipt_analysis_context(evidencia)
    if source_text_override is None:
        source_text = clean_rule_receipt_text(
            "\n".join(
                str(context.get(key) or "")
                for key in [
                    "texto_existente",
                    "referencia_reportada_actual",
                ]
            )
        )
    else:
        source_text = clean_rule_receipt_text(source_text_override)
    classification = classify_financial_message(
        config=config,
        canal=None,
        text_value=source_text,
        has_attachment=bool(evidencia.url_archivo),
    )
    confidence = clamp_confidence(classification["confianza"])
    clear_previous_amount = previous_amount_looks_like_rule_guess(evidencia)
    amount = (
        None
        if clear_previous_amount
        else evidencia.monto_reportado
    ) or classification.get("monto_reportado")
    payment_date = evidencia.fecha_pago_reportada or extract_payment_date_from_text(source_text)
    reference = evidencia.referencia_reportada or classification.get("referencia_reportada")
    if not reference:
        reference = extract_labeled_receipt_value(
            source_text,
            "Folio de la operacion",
            "Folio de la operación",
            "Numero de referencia",
            "Número de referencia",
            "Referencia",
            "Referencia de pago",
            "Clave de rastreo",
        ) or extract_reference_from_text(source_text)
    bank = extract_bank_from_text(source_text)
    emitter = extract_labeled_receipt_value(
        source_text,
        "Cuenta de origen",
        "Nombre del ordenante",
        "Ordenante",
        "Emisor",
    )
    receiver = extract_labeled_receipt_value(
        source_text,
        "Nombre del beneficiario",
        "Beneficiario",
        "Receptor",
    )
    missing_core = not amount or not payment_date
    observations = list(classification["razones"])
    if source_label == "google_vision" and source_text.strip():
        observations.append("Google Vision OCR leyo el archivo visual del comprobante.")
        if not missing_core:
            confidence = max(confidence, Decimal("92.00"))
    if fallback_reason:
        observations.append(fallback_reason)
    if evidencia.url_archivo and not source_text.strip():
        observations.append(
            "El archivo es imagen/PDF sin texto utilizable por reglas; requiere IA visual o revision manual."
        )
    threshold = clamp_money(config.umbral_confianza_autoaplicacion)
    return {
        "fuente": source_label,
        "modelo": source_model,
        "tokens": 0,
        "tipo_movimiento": classification["tipo_movimiento"],
        "monto": str(amount or ""),
        "fecha_pago": payment_date.isoformat() if payment_date else "",
        "referencia": reference or "",
        "banco": bank,
        "emisor": emitter,
        "receptor": receiver,
        "concepto": classification["categoria"],
        "texto_extraido": source_text.strip()[:AI_RECEIPT_TEXT_LIMIT],
        "confianza": str(confidence),
        "requiere_revision_manual": bool(confidence < threshold or missing_core),
        "observaciones": "; ".join(observations),
        "limpiar_monto": bool(clear_previous_amount and not amount),
        "archivo_visual": archivo_visual or {},
        "raw": source_raw or {"clasificacion_reglas": classification},
    }


def get_google_vision_api_key() -> str:
    return (
        (getattr(settings, "GOOGLE_VISION_API_KEY", "") or "").strip()
        or (getattr(settings, "GOOGLE_API_KEY", "") or "").strip()
    )


def extract_google_vision_text(response_data: dict) -> str:
    responses = response_data.get("responses") or []
    if not responses or not isinstance(responses[0], dict):
        return ""
    first_response = responses[0]
    if first_response.get("error"):
        return ""
    full_text = first_response.get("fullTextAnnotation") or {}
    if isinstance(full_text.get("text"), str) and full_text["text"].strip():
        return full_text["text"].strip()
    annotations = first_response.get("textAnnotations") or []
    if annotations and isinstance(annotations[0], dict):
        description = annotations[0].get("description")
        if isinstance(description, str):
            return description.strip()
    return ""


def extract_google_vision_error(response_data: dict) -> str:
    error = response_data.get("error")
    if isinstance(error, dict):
        message = str(error.get("message") or "").strip()
        status = str(error.get("status") or "").strip()
        if message and status:
            return f"{status}: {message}"
        if message:
            return message
    responses = response_data.get("responses") or []
    if responses and isinstance(responses[0], dict):
        response_error = responses[0].get("error")
        if isinstance(response_error, dict):
            message = str(response_error.get("message") or "").strip()
            code = response_error.get("code")
            if message and code:
                return f"{code}: {message}"
            if message:
                return message
    return ""


def call_google_vision_receipt_analysis(
    *,
    config: ConfiguracionComunicacion,
    evidencia: EvidenciaPago,
    file_content: bytes | None = None,
    filename: str = "",
    content_type: str = "",
) -> tuple[dict[str, object] | None, str]:
    api_key = get_google_vision_api_key()
    if not api_key:
        return None, "Google Vision OCR no esta configurado."

    if file_content:
        normalized_content_type = (content_type or "").split(";", 1)[0].strip().lower()
        extension = os.path.splitext(filename or "")[1].lower()
        if normalized_content_type not in {"image/jpeg", "image/png", "image/webp"} and extension not in {
            ".jpg",
            ".jpeg",
            ".png",
            ".webp",
        }:
            return None, "El archivo no es una imagen compatible para Google Vision OCR."
        content = file_content[: AI_RECEIPT_IMAGE_DOWNLOAD_MAX_BYTES + 1]
        if len(content) > AI_RECEIPT_IMAGE_DOWNLOAD_MAX_BYTES:
            return None, "La imagen excede el limite para inline."
        image_meta = {
            "modo": "upload_directo",
            "content_type": normalized_content_type or infer_receipt_image_content_type(filename),
            "filename": filename,
            "bytes": len(content),
        }
    else:
        content, _content_type, image_meta = download_receipt_image_content(
            evidencia.url_archivo,
        )
    if not content:
        reason = str(image_meta.get("motivo") or "").strip()
        return None, reason or "Google Vision no pudo descargar la imagen del comprobante."
    encoded = base64.b64encode(content).decode("ascii")
    request_payload = {
        "requests": [
            {
                "image": {"content": encoded},
                "features": [
                    {
                        "type": GOOGLE_VISION_RECEIPT_FEATURE,
                        "maxResults": 1,
                    }
                ],
                "imageContext": {"languageHints": ["es"]},
            }
        ]
    }
    try:
        response = requests.post(
            GOOGLE_VISION_ANNOTATE_URL,
            params={"key": api_key},
            json=request_payload,
            timeout=40,
        )
        response_data = response.json()
        if response.status_code >= 400:
            detail = extract_google_vision_error(response_data)
            return (
                None,
                f"Google Vision rechazo la solicitud ({response.status_code}): {detail or response.text[:300]}",
            )
        response_error = extract_google_vision_error(response_data)
        if response_error:
            return None, f"Google Vision regreso error: {response_error}"
        ocr_text = extract_google_vision_text(response_data)
        if not ocr_text:
            return None, "Google Vision no detecto texto utilizable en la imagen."
        return (
            build_rule_receipt_analysis(
                config=config,
                evidencia=evidencia,
                source_text_override=ocr_text,
                source_label="google_vision",
                source_model=GOOGLE_VISION_RECEIPT_FEATURE,
                source_raw={"google_vision": response_data},
                archivo_visual=image_meta,
            ),
            "",
        )
    except Exception as error:
        return None, f"No se pudo completar Google Vision: {error}"


def call_openai_receipt_analysis(
    *,
    config: ConfiguracionComunicacion,
    evidencia: EvidenciaPago,
) -> dict[str, object] | None:
    api_key = settings.OPENAI_API_KEY
    if not api_key:
        return None

    model = (config.openai_model or "").strip() or DEFAULT_RECEIPT_AI_MODEL
    context = build_receipt_analysis_context(evidencia)
    prompt = (
        (config.prompt_extraccion or "").strip()
        or "Extrae monto, fecha, referencia, banco, emisor y confianza del comprobante."
    )
    content = [
        {
            "type": "input_text",
            "text": (
                f"{prompt}\n\n"
                "Devuelve datos del comprobante de pago en espanol de Mexico. "
                "No inventes campos: si un dato no se ve, regresalo vacio y baja la confianza. "
                "La fecha debe ser YYYY-MM-DD. El monto debe ser decimal sin simbolo. "
                "Si parece pago de cliente, tipo_movimiento debe ser INGRESO.\n\n"
                f"Contexto BetterP:\n{json.dumps(context, ensure_ascii=True)}"
            ),
        }
    ]
    image_meta: dict[str, object] = {"modo": "sin_imagen"}
    image_input, image_meta = build_openai_receipt_image_input(evidencia)
    if image_input:
        content.append(image_input)

    request_payload = {
        "model": model,
        "input": [
            {
                "role": "system",
                "content": (
                    "Eres un extractor de comprobantes bancarios para un modulo "
                    "de cobranza. Responde solamente JSON valido conforme al esquema. "
                    "Prioriza seguridad: si hay duda, marca revision manual."
                ),
            },
            {"role": "user", "content": content},
        ],
        "max_output_tokens": 700,
        "text": {
            "format": {
                "type": "json_schema",
                "name": "receipt_payment_extraction",
                "strict": True,
                "schema": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "tipo_movimiento": {"type": "string"},
                        "monto": {"type": "string"},
                        "fecha_pago": {"type": "string"},
                        "referencia": {"type": "string"},
                        "banco": {"type": "string"},
                        "emisor": {"type": "string"},
                        "receptor": {"type": "string"},
                        "concepto": {"type": "string"},
                        "texto_extraido": {"type": "string"},
                        "confianza": {"type": "number"},
                        "requiere_revision_manual": {"type": "boolean"},
                        "observaciones": {"type": "string"},
                    },
                    "required": [
                        "tipo_movimiento",
                        "monto",
                        "fecha_pago",
                        "referencia",
                        "banco",
                        "emisor",
                        "receptor",
                        "concepto",
                        "texto_extraido",
                        "confianza",
                        "requiere_revision_manual",
                        "observaciones",
                    ],
                },
            }
        },
    }
    try:
        response = requests.post(
            "https://api.openai.com/v1/responses",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=request_payload,
            timeout=40,
        )
        if response.status_code >= 400:
            return None
        response_data = response.json()
        parsed = parse_json_object(extract_response_output_text(response_data))
        if not parsed:
            return None
        usage = response_data.get("usage") or {}
        token_count = int(
            usage.get("total_tokens")
            or int(usage.get("input_tokens") or 0)
            + int(usage.get("output_tokens") or 0)
        )
        parsed["fuente"] = "openai"
        parsed["modelo"] = model
        parsed["tokens"] = token_count
        parsed["archivo_visual"] = image_meta
        parsed["raw"] = response_data
        return parsed
    except Exception:
        return None


def register_receipt_ai_usage(
    *,
    config: ConfiguracionComunicacion,
    evidencia: EvidenciaPago,
    analysis: dict[str, object],
) -> None:
    token_count = int(analysis.get("tokens") or 0)
    if token_count <= 0:
        return
    capa = (
        evidencia.entidad_relacionada.capa_negocio
        if evidencia.entidad_relacionada_id
        else config.capa_negocio
    )
    if capa is None:
        return
    registrar_consumo_saas(
        capa=capa,
        categoria="OPENAI_TOKENS",
        cantidad=token_count,
        descripcion="Lectura IA de comprobante de pago",
        origen_modelo="comunicaciones.EvidenciaPago",
        origen_id=evidencia.id,
        metadata={
            "evidencia_id": evidencia.id,
            "modelo": analysis.get("modelo"),
            "fuente": analysis.get("fuente"),
        },
    )


def apply_receipt_analysis_to_evidence(
    *,
    evidencia: EvidenciaPago,
    config: ConfiguracionComunicacion,
    analysis: dict[str, object],
) -> None:
    amount = parse_decimal_value(analysis.get("monto"))
    payment_date = parse_date_value(analysis.get("fecha_pago"))
    reference = str(analysis.get("referencia") or "").strip()[:120]
    confidence = clamp_confidence(analysis.get("confianza"))
    threshold = clamp_money(config.umbral_confianza_autoaplicacion)
    missing_core = not amount or not payment_date
    source_name = str(analysis.get("fuente") or "").strip()
    provider_requires_review = bool(analysis.get("requiere_revision_manual"))
    ignore_provider_review = (
        source_name.lower() == "google_vision"
        and not missing_core
        and confidence >= threshold
    )
    requires_review = bool(
        (provider_requires_review and not ignore_provider_review)
        or confidence < threshold
        or missing_core
    )

    if amount:
        evidencia.monto_reportado = amount
    elif analysis.get("limpiar_monto"):
        evidencia.monto_reportado = None
    if payment_date:
        evidencia.fecha_pago_reportada = payment_date
    if reference:
        evidencia.referencia_reportada = reference
    raw_movement_type = (
        str(analysis.get("tipo_movimiento") or evidencia.tipo_movimiento or "INGRESO")
        .strip()
        .upper()
    )
    evidencia.tipo_movimiento = (
        raw_movement_type if raw_movement_type in {"INGRESO", "EGRESO"} else "INGRESO"
    )
    evidencia.confianza_clasificacion = confidence
    evidencia.requiere_revision_manual = requires_review
    categoria = str(analysis.get("concepto") or "").strip()
    if categoria:
        evidencia.categoria_sugerida = categoria[:120]
    extracted_text = str(analysis.get("texto_extraido") or "").strip()
    if extracted_text:
        if source_name.lower() in {"google_vision", "openai"}:
            evidencia.texto_extraido = extracted_text[:AI_RECEIPT_TEXT_LIMIT]
        else:
            evidencia.texto_extraido = append_text(evidencia.texto_extraido, extracted_text)
    observations = str(analysis.get("observaciones") or "").strip()
    observations = build_receipt_analysis_observation_summary(
        source_name=source_name,
        amount=amount,
        payment_date=payment_date,
        reference=reference,
        requires_review=requires_review,
        observations=observations,
    )
    if observations:
        current_observations = (
            clean_analysis_observation_history(evidencia.observaciones)
            if source_name.lower() in {"google_vision", "openai"}
            else evidencia.observaciones
        )
        evidencia.observaciones = append_observations(
            current_observations,
            observations,
        )
    metadata = evidencia.metadata or {}
    metadata["lectura_ia"] = {
        "fuente": analysis.get("fuente"),
        "modelo": analysis.get("modelo"),
        "tokens": analysis.get("tokens") or 0,
        "confianza": str(confidence),
        "requiere_revision_manual": requires_review,
        "monto": str(amount or ""),
        "fecha_pago": payment_date.isoformat() if payment_date else "",
        "referencia": reference,
        "banco": str(analysis.get("banco") or "").strip(),
        "emisor": str(analysis.get("emisor") or "").strip(),
        "receptor": str(analysis.get("receptor") or "").strip(),
        "archivo_visual": analysis.get("archivo_visual") or {},
    }
    evidencia.metadata = metadata
    if evidencia.estatus not in {"APLICADA", "DESCARTADA"}:
        evidencia.estatus = "NUEVA"
    evidencia.save(
        update_fields=[
            "tipo_movimiento",
            "monto_reportado",
            "fecha_pago_reportada",
            "referencia_reportada",
            "texto_extraido",
            "confianza_clasificacion",
            "requiere_revision_manual",
            "categoria_sugerida",
            "metadata",
            "observaciones",
            "estatus",
        ]
    )


def extract_green_api_text(message_data: dict) -> tuple[str, str]:
    type_message = str(message_data.get("typeMessage") or "").strip()
    file_data = message_data.get("fileMessageData") or {}
    text_blocks = [
        (message_data.get("textMessageData") or {}).get("textMessage"),
        (message_data.get("extendedTextMessageData") or {}).get("text"),
        (message_data.get("extendedTextMessageData") or {}).get("description"),
        file_data.get("caption"),
        (message_data.get("quotedMessage") or {}).get("textMessage"),
    ]
    text_value = "\n".join(
        item.strip()
        for item in text_blocks
        if isinstance(item, str) and item.strip()
    )
    return text_value, type_message


def build_green_api_file_url(message_data: dict) -> str | None:
    file_data = message_data.get("fileMessageData") or {}
    download_url = file_data.get("downloadUrl")
    if isinstance(download_url, str) and download_url.strip():
        return download_url.strip()
    return None


def normalize_phone_digits(value: str | None) -> str:
    return re.sub(r"\D", "", value or "")


def build_phone_match_variants(value: str | None) -> set[str]:
    digits = normalize_phone_digits(value)
    variants = {digits} if digits else set()
    if not digits:
        return variants
    if len(digits) >= 10:
        variants.add(digits[-10:])
    if digits.startswith("521") and len(digits) > 3:
        national = digits[3:]
        variants.add(national)
        variants.add(f"52{national}")
    elif digits.startswith("52") and len(digits) > 2:
        national = digits[2:]
        variants.add(national)
        if len(national) == 10:
            variants.add(f"521{national}")
    elif digits.startswith("1") and len(digits) == 11:
        national = digits[1:]
        variants.add(national)
        variants.add(f"52{national}")
        variants.add(f"521{national}")
    return {item for item in variants if item}


def normalize_collection_opt_out_text(value: str | None) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    normalized = unicodedata.normalize("NFKD", raw)
    normalized = "".join(
        char for char in normalized if not unicodedata.combining(char)
    )
    normalized = normalized.upper()
    normalized = re.sub(r"[^A-Z0-9]+", " ", normalized)
    return " ".join(normalized.split())


def detect_collection_opt_out_keyword(text_value: str | None) -> str | None:
    normalized = normalize_collection_opt_out_text(text_value)
    if not normalized or len(normalized) > COLLECTION_OPT_OUT_MAX_LENGTH:
        return None
    if normalized in COLLECTION_OPT_OUT_EXACT_PHRASES:
        return normalized
    if normalized.startswith("BAJA ") or normalized.startswith("STOP "):
        return normalized.split(" ", 1)[0]
    for phrase in COLLECTION_OPT_OUT_CONTAINS_PHRASES:
        if phrase in normalized:
            return phrase
    return None


def detect_portal_assistant_intent(text_value: str | None) -> str | None:
    normalized = normalize_collection_opt_out_text(text_value)
    if not normalized or len(normalized) > PORTAL_ASSISTANT_MAX_LENGTH:
        return None
    if normalized in PORTAL_ASSISTANT_MENU_EXACT_PHRASES:
        return PORTAL_ASSISTANT_INTENT_MENU
    if normalized in PORTAL_ASSISTANT_EXACT_PHRASES:
        return PORTAL_ASSISTANT_INTENT_ACCESS
    for phrase in PORTAL_ASSISTANT_CONTAINS_PHRASES:
        if phrase in normalized:
            return PORTAL_ASSISTANT_INTENT_ACCESS
    words = set(normalized.split())
    if (
        words.intersection(PORTAL_ASSISTANT_REQUEST_WORDS)
        and words.intersection(PORTAL_ASSISTANT_OBJECT_WORDS)
    ):
        return PORTAL_ASSISTANT_INTENT_ACCESS
    return None


def detect_portal_access_request(text_value: str | None) -> bool:
    return detect_portal_assistant_intent(text_value) == PORTAL_ASSISTANT_INTENT_ACCESS


def build_portal_assistant_menu_reply(*, cliente: Cliente) -> str:
    client_name = (
        cliente.nombre_comercial
        or cliente.razon_social
        or f"Cliente {cliente.id}"
    )
    return (
        f"Hola {client_name}.\n\n"
        "Si quieres acceder a tu portal de autoservicio para revisar "
        "estado de cuenta, datos de pago, comprobantes o facturas, "
        "toca el boton de abajo."
    )


def build_portal_assistant_reply(
    *,
    cliente: Cliente,
    config: ConfiguracionComunicacion,
) -> tuple[str, str]:
    portal_url = build_portal_url(cliente=cliente, config=config)
    client_name = (
        cliente.nombre_comercial
        or cliente.razon_social
        or f"Cliente {cliente.id}"
    )
    message = (
        f"Hola {client_name}.\n\n"
        "Si quieres acceder a tu portal de autoservicio para revisar "
        "tu estado de cuenta, datos de pago, comprobantes o facturas, "
        "toca el boton de abajo.\n\n"
        "Por seguridad, al abrirlo te pediremos un codigo por WhatsApp. "
        "Si este numero no es correcto o no reconoces esta solicitud, "
        "contacta a administracion."
    )
    return portal_url, message


def apply_portal_access_assistant_from_message(
    *,
    cliente: Cliente | None,
    mensaje: MensajeEntrante,
    caso: CasoProcesamiento | None,
    text_value: str | None,
    message_type: str | None,
    provider: str,
    sender: str | None,
    config: ConfiguracionComunicacion,
    reference_datetime: datetime | None = None,
) -> bool:
    if not getattr(settings, "WHATSAPP_PORTAL_ASSISTANT_ENABLED", True):
        return False
    if (message_type or "").strip() not in {"text", "button", "interactive"}:
        return False
    assistant_intent = detect_portal_assistant_intent(text_value)
    if not assistant_intent:
        return False

    assistant_metadata: dict[str, object] = {
        "detected": True,
        "intent": assistant_intent,
        "provider": provider,
        "sender": sender,
        "cliente_id": cliente.id if cliente else None,
        "requested_at": (reference_datetime or timezone.now()).isoformat(),
    }
    if not cliente:
        assistant_metadata["status"] = "NO_CLIENTE"
        assistant_metadata["reason"] = (
            "No se encontro un cliente activo asociado al WhatsApp solicitante."
        )
    else:
        portal_url: str | None = None
        portal_url, reply = build_portal_assistant_reply(
            cliente=cliente,
            config=config,
        )
        subject = "Link de autoservicio solicitado por WhatsApp"
        assistant_metadata["portal_url"] = portal_url
        send_kwargs = {
            "interactive_button_text": "Abrir portal",
            "interactive_url": portal_url,
        }
        destination = normalize_whatsapp_destination(sender) or normalize_whatsapp_destination(
            f"{cliente.codigo_pais or ''}{cliente.telefono or ''}"
        )
        try:
            provider_response = send_whatsapp_message(
                config=config,
                cliente=cliente,
                chat_id=destination,
                message=reply,
                **send_kwargs,
                enforce_allowed_numbers=bool(
                    getattr(
                        settings,
                        "WHATSAPP_PORTAL_ASSISTANT_ENFORCE_ALLOWED_NUMBERS",
                        False,
                    )
                ),
            )
            provider_name = str(provider_response.get("provider") or provider)
            messages = provider_response.get("messages") or []
            first_message = messages[0] if messages else {}
            reference = str(
                first_message.get("id")
                or provider_response.get("idMessage")
                or provider_response.get("id")
                or ""
            ).strip()
            assistant_metadata.update(
                {
                    "status": "ENVIADO",
                    "provider_response": provider_response,
                    "referencia_envio": reference or None,
                }
            )
            HistorialEnvio.objects.create(
                configuracion_relacionada=config,
                cliente_relacionado=cliente,
                entidad_relacionada=cliente.entidad_relacionada,
                canal="WHATSAPP",
                tipo_envio="MANUAL",
                proveedor=provider_name,
                destinatario=destination,
                asunto=subject,
                cuerpo_renderizado=reply,
                referencia_envio=reference or None,
                metadata={
                    "portal_assistant": True,
                    "portal_assistant_intent": assistant_intent,
                    "portal_url": portal_url,
                    "incoming_message_id": mensaje.id,
                    "incoming_provider": provider,
                },
                estatus="ENVIADO",
            )
        except Exception as exc:  # pragma: no cover - defensive network handling
            fallback_reply = (
                f"{reply}\n\n{portal_url}"
                if portal_url
                else f"{reply}\n\nResponde PORTAL para recibir tu liga de acceso."
            )
            try:
                fallback_response = send_whatsapp_message(
                    config=config,
                    cliente=cliente,
                    chat_id=destination,
                    message=fallback_reply,
                    enforce_allowed_numbers=bool(
                        getattr(
                            settings,
                            "WHATSAPP_PORTAL_ASSISTANT_ENFORCE_ALLOWED_NUMBERS",
                            False,
                        )
                    ),
                )
                provider_name = str(fallback_response.get("provider") or provider)
                messages = fallback_response.get("messages") or []
                first_message = messages[0] if messages else {}
                reference = str(
                    first_message.get("id")
                    or fallback_response.get("idMessage")
                    or fallback_response.get("id")
                    or ""
                ).strip()
                assistant_metadata.update(
                    {
                        "status": "ENVIADO_FALLBACK",
                        "interactive_error": str(exc),
                        "provider_response": fallback_response,
                        "referencia_envio": reference or None,
                    }
                )
                HistorialEnvio.objects.create(
                    configuracion_relacionada=config,
                    cliente_relacionado=cliente,
                    entidad_relacionada=cliente.entidad_relacionada,
                    canal="WHATSAPP",
                    tipo_envio="MANUAL",
                    proveedor=provider_name,
                    destinatario=destination,
                    asunto=subject,
                    cuerpo_renderizado=fallback_reply,
                    referencia_envio=reference or None,
                    metadata={
                        "portal_assistant": True,
                        "portal_assistant_intent": assistant_intent,
                        "portal_assistant_fallback": True,
                        "portal_url": portal_url,
                        "incoming_message_id": mensaje.id,
                        "incoming_provider": provider,
                        "interactive_error": str(exc),
                    },
                    estatus="ENVIADO",
                )
            except Exception as fallback_exc:
                assistant_metadata.update(
                    {
                        "status": "ERROR",
                        "error": str(fallback_exc),
                        "interactive_error": str(exc),
                    }
                )
                HistorialEnvio.objects.create(
                    configuracion_relacionada=config,
                    cliente_relacionado=cliente,
                    entidad_relacionada=cliente.entidad_relacionada,
                    canal="WHATSAPP",
                    tipo_envio="MANUAL",
                    proveedor=provider,
                    destinatario=destination,
                    asunto=subject,
                    cuerpo_renderizado=fallback_reply,
                    metadata={
                        "portal_assistant": True,
                        "portal_assistant_intent": assistant_intent,
                        "portal_url": portal_url,
                        "incoming_message_id": mensaje.id,
                        "incoming_provider": provider,
                        "interactive_error": str(exc),
                        "error": str(fallback_exc),
                    },
                    estatus="ERROR",
                )

    message_metadata = mensaje.metadata or {}
    message_metadata["portal_access_assistant"] = assistant_metadata
    mensaje.metadata = message_metadata
    mensaje.save(update_fields=["metadata"])

    if caso:
        case_metadata = caso.metadata or {}
        case_metadata["portal_access_assistant"] = assistant_metadata
        caso.metadata = case_metadata
        caso.save(update_fields=["metadata", "fecha_actualizacion"])
    return True


def resolve_incoming_whatsapp_cliente(
    sender: str | None,
    *,
    official_channel: CanalWhatsappOficial | None = None,
    allowed_channel: CanalPermitido | None = None,
    entidad: EntidadNegocio | None = None,
    config: ConfiguracionComunicacion | None = None,
) -> Cliente | None:
    if allowed_channel and allowed_channel.cliente_relacionado_id:
        return allowed_channel.cliente_relacionado
    if official_channel and official_channel.cliente_relacionado_id:
        return official_channel.cliente_relacionado

    variants = build_phone_match_variants(sender)
    if not variants:
        return None

    queryset = Cliente.objects.select_related(
        "entidad_relacionada",
        "entidad_relacionada__capa_negocio",
    ).filter(activo=True)
    target_entidad = entidad
    if not target_entidad and allowed_channel and allowed_channel.entidad_relacionada_id:
        target_entidad = allowed_channel.entidad_relacionada
    if not target_entidad and official_channel and official_channel.entidad_relacionada_id:
        target_entidad = official_channel.entidad_relacionada

    if target_entidad:
        queryset = queryset.filter(entidad_relacionada=target_entidad)
    elif official_channel and official_channel.capa_negocio_id:
        queryset = queryset.filter(
            entidad_relacionada__capa_negocio=official_channel.capa_negocio
        )
    elif config and config.capa_negocio_id:
        queryset = queryset.filter(entidad_relacionada__capa_negocio=config.capa_negocio)

    for cliente in queryset.only(
        "id",
        "entidad_relacionada",
        "codigo_pais",
        "telefono",
        "activo",
    ):
        cliente_variants = build_phone_match_variants(cliente.telefono)
        cliente_variants.update(
            build_phone_match_variants(
                f"{cliente.codigo_pais or ''}{cliente.telefono or ''}"
            )
        )
        if variants.intersection(cliente_variants):
            return cliente
    return None


def apply_collection_opt_out_from_message(
    *,
    cliente: Cliente | None,
    mensaje: MensajeEntrante,
    caso: CasoProcesamiento | None,
    text_value: str | None,
    provider: str,
    sender: str | None,
    config: ConfiguracionComunicacion | None = None,
    reference_datetime: datetime | None = None,
) -> bool:
    keyword = detect_collection_opt_out_keyword(text_value)
    if not keyword:
        return False

    applied_at = reference_datetime or timezone.now()
    reason = f"{COLLECTION_OPT_OUT_REASON}: {keyword}"[:240]
    should_apply = bool(getattr(config, "respetar_bajas_whatsapp", True))
    applied = bool(cliente and should_apply)
    if applied and cliente:
        cliente.no_contactar_cobranza = True
        cliente.no_contactar_cobranza_motivo = reason
        cliente.no_contactar_cobranza_fecha = applied_at
        cliente.save(
            update_fields=[
                "no_contactar_cobranza",
                "no_contactar_cobranza_motivo",
                "no_contactar_cobranza_fecha",
            ]
        )

    opt_out_metadata = {
        "detected": True,
        "keyword": keyword,
        "provider": provider,
        "sender": sender,
        "cliente_id": cliente.id if cliente else None,
        "applied": applied,
        "policy_mode": "AUTO_BLOCK" if should_apply else "AUDIT_ONLY",
        "reason": reason,
    }
    if applied:
        opt_out_metadata["applied_at"] = applied_at.isoformat()
    message_metadata = mensaje.metadata or {}
    message_metadata["collection_opt_out"] = opt_out_metadata
    mensaje.metadata = message_metadata
    mensaje.save(update_fields=["metadata"])

    if caso:
        case_metadata = caso.metadata or {}
        case_metadata["collection_opt_out"] = opt_out_metadata
        caso.metadata = case_metadata
        caso.save(update_fields=["metadata", "fecha_actualizacion"])
    return True


def ensure_single_primary_channel(canal: CanalWhatsappOficial) -> None:
    if not canal.es_principal:
        return
    CanalWhatsappOficial.objects.filter(
        capa_negocio=canal.capa_negocio,
        es_principal=True,
    ).exclude(id=canal.id).update(es_principal=False)


def apply_whatsapp_channel_payload(
    canal: CanalWhatsappOficial,
    payload: CanalWhatsappOficialIn,
    *,
    request,
) -> CanalWhatsappOficial:
    canal.capa_negocio = get_current_capa(request)
    canal.nombre = payload.nombre.strip()
    canal.nombre_interno = payload.nombre_interno.strip() or None
    canal.display_phone_number = payload.display_phone_number.strip() or None
    canal.numero_wa_id = normalize_phone_digits(payload.numero_wa_id) or None
    canal.phone_number_id = payload.phone_number_id.strip() or None
    canal.business_account_id = payload.business_account_id.strip() or None
    canal.waba_id = payload.waba_id.strip() or None
    next_access_token = payload.access_token.strip()
    if next_access_token:
        canal.access_token = next_access_token
    elif not canal.pk:
        canal.access_token = None
    canal.entidad_relacionada = get_scoped_entity_or_none(request, payload.entidad_id)
    canal.cliente_relacionado = get_scoped_client_or_none(request, payload.cliente_id)
    canal.estado = payload.estado
    canal.puede_enviar = payload.puede_enviar
    canal.puede_recibir = payload.puede_recibir
    canal.es_principal = payload.es_principal
    canal.activo = payload.activo
    canal.metadata = payload.metadata or {}
    if canal.access_token and canal.estado in {"BORRADOR", "PENDIENTE"}:
        canal.estado = "CONECTADO"
    if canal.estado == "CONECTADO" and canal.fecha_conexion is None:
        canal.fecha_conexion = timezone.now()
    return canal


def scoped_whatsapp_channel_queryset(request):
    capa = get_current_capa(request)
    return CanalWhatsappOficial.objects.select_related(
        "entidad_relacionada",
        "cliente_relacionado",
    ).filter(capa_negocio=capa)


def resolve_meta_subscription_channel(request) -> CanalWhatsappOficial:
    channel = (
        scoped_whatsapp_channel_queryset(request)
        .filter(
            proveedor=DEFAULT_WHATSAPP_PROVIDER,
            activo=True,
            estado="CONECTADO",
        )
        .exclude(access_token__isnull=True)
        .exclude(access_token="")
        .filter(Q(waba_id__isnull=False) | Q(business_account_id__isnull=False))
        .order_by("-es_principal", "nombre", "id")
        .first()
    )
    if not channel:
        raise HttpError(
            400,
            "Configura un canal WhatsApp conectado con WABA ID y access token antes de verificar Meta.",
        )
    return channel


def read_meta_graph_json(response: requests.Response, default_message: str) -> dict:
    try:
        payload = response.json()
    except ValueError as exc:
        raise HttpError(502, "Meta respondio con un formato inesperado.") from exc
    if response.ok:
        return payload if isinstance(payload, dict) else {"data": payload}
    error_payload = payload.get("error") if isinstance(payload, dict) else None
    detail = ""
    if isinstance(error_payload, dict):
        detail = str(error_payload.get("message") or "").strip()
    if not detail:
        detail = (response.text or "").strip()[:260]
    raise HttpError(
        502,
        f"{default_message}: {detail or response.status_code}",
    )


def build_waba_subscribed_apps_endpoint(
    channel: CanalWhatsappOficial,
) -> tuple[str, str]:
    waba_id = (channel.waba_id or channel.business_account_id or "").strip()
    if not waba_id:
        raise HttpError(400, "El canal no tiene WABA ID o Business Account ID.")
    base_url = (settings.WHATSAPP_CLOUD_API_BASE_URL or "").rstrip("/")
    version = (settings.WHATSAPP_CLOUD_API_VERSION or "").strip("/")
    if not base_url or not version:
        raise HttpError(
            400,
            "Faltan WHATSAPP_CLOUD_API_BASE_URL o WHATSAPP_CLOUD_API_VERSION.",
        )
    return f"{base_url}/{version}/{waba_id}/subscribed_apps", waba_id


def serialize_waba_subscription_state(
    *,
    channel: CanalWhatsappOficial,
    waba_id: str,
    apps: list[dict],
    checked_at=None,
    action: dict | None = None,
) -> dict:
    expected_app_id = (settings.WHATSAPP_META_APP_ID or "").strip()
    normalized_apps = [
        {
            "id": str(app.get("id") or "").strip() or None,
            "name": str(app.get("name") or "").strip() or None,
            "link": str(app.get("link") or "").strip() or None,
        }
        for app in apps
        if isinstance(app, dict)
    ]
    subscribed = bool(
        expected_app_id
        and any(str(app.get("id") or "").strip() == expected_app_id for app in apps)
    )
    if not expected_app_id and normalized_apps:
        subscribed = True
    timestamp = checked_at or timezone.now()
    return {
        "success": True,
        "canal_id": channel.id,
        "canal_nombre": channel.nombre,
        "waba_id": waba_id,
        "app_id_esperada": expected_app_id or None,
        "suscrita": subscribed,
        "apps": normalized_apps,
        "checked_at": timestamp.isoformat(),
        "mensaje": (
            "El WABA esta suscrito a la app esperada."
            if subscribed
            else "El WABA no muestra la app esperada en subscribed_apps."
        ),
        "accion": action,
    }


def persist_waba_subscription_state(
    channel: CanalWhatsappOficial,
    state: dict,
) -> None:
    metadata = channel.metadata or {}
    metadata["waba_subscription"] = state
    channel.metadata = metadata
    channel.fecha_ultimo_check = timezone.now()
    channel.save(update_fields=["metadata", "fecha_ultimo_check", "fecha_actualizacion"])


def fetch_waba_subscription_state(channel: CanalWhatsappOficial) -> dict:
    token = (channel.access_token or "").strip()
    if not token:
        raise HttpError(400, "El canal no tiene access token de Meta configurado.")
    endpoint, waba_id = build_waba_subscribed_apps_endpoint(channel)
    try:
        response = requests.get(
            endpoint,
            headers={"Authorization": f"Bearer {token}"},
            params={"fields": "id,name,link"},
            timeout=20,
        )
    except requests.RequestException as exc:
        raise HttpError(502, f"No se pudo conectar con Meta: {exc}") from exc
    payload = read_meta_graph_json(
        response,
        "No se pudo consultar la suscripcion del WABA",
    )
    apps = payload.get("data") if isinstance(payload.get("data"), list) else []
    return serialize_waba_subscription_state(
        channel=channel,
        waba_id=waba_id,
        apps=apps,
    )


def subscribe_waba_to_meta_app(channel: CanalWhatsappOficial) -> dict:
    token = (channel.access_token or "").strip()
    if not token:
        raise HttpError(400, "El canal no tiene access token de Meta configurado.")
    endpoint, _waba_id = build_waba_subscribed_apps_endpoint(channel)
    try:
        response = requests.post(
            endpoint,
            headers={"Authorization": f"Bearer {token}"},
            timeout=20,
        )
    except requests.RequestException as exc:
        raise HttpError(502, f"No se pudo conectar con Meta: {exc}") from exc
    return read_meta_graph_json(
        response,
        "No se pudo suscribir la app al WABA",
    )


def resolve_whatsapp_channel_for_incoming(
    *,
    phone_number_id: str | None,
    display_phone_number: str | None = None,
) -> CanalWhatsappOficial | None:
    queryset = CanalWhatsappOficial.objects.select_related(
        "entidad_relacionada",
        "cliente_relacionado",
    ).filter(
        proveedor=DEFAULT_WHATSAPP_PROVIDER,
        activo=True,
        puede_recibir=True,
    )
    if phone_number_id:
        channel = queryset.filter(phone_number_id=str(phone_number_id).strip()).first()
        if channel:
            return channel
    normalized_display = normalize_phone_digits(display_phone_number)
    if normalized_display:
        return queryset.filter(numero_wa_id=normalized_display).first()
    return None


def build_meta_media_proxy_url(*, canal_id: int, media_id: str) -> str | None:
    backend_base = (settings.BACKEND_PUBLIC_BASE_URL or "").rstrip("/")
    if not backend_base:
        return None
    return (
        f"{backend_base}/api/comunicaciones/whatsapp-cloud/media/"
        f"{canal_id}/{media_id}/"
    )


def extract_meta_message_text(message: dict) -> tuple[str, str]:
    message_type = str(message.get("type") or "").strip()
    if message_type == "text":
        return str((message.get("text") or {}).get("body") or "").strip(), message_type
    if message_type in {"image", "video", "document"}:
        media_block = message.get(message_type) or {}
        caption = str(media_block.get("caption") or "").strip()
        return caption, message_type
    if message_type == "button":
        return str((message.get("button") or {}).get("text") or "").strip(), message_type
    if message_type == "interactive":
        interactive = message.get("interactive") or {}
        button_reply = interactive.get("button_reply") or {}
        list_reply = interactive.get("list_reply") or {}
        return (
            str(button_reply.get("title") or list_reply.get("title") or "").strip(),
            message_type,
        )
    return "", message_type


def extract_meta_media_id(message: dict, message_type: str) -> str | None:
    if message_type not in {"image", "video", "document", "audio", "sticker"}:
        return None
    media_block = message.get(message_type) or {}
    media_id = str(media_block.get("id") or "").strip()
    return media_id or None


def map_meta_status_to_historial(status: str) -> str:
    normalized = (status or "").strip().lower()
    if normalized == "sent":
        return "ENVIADO"
    if normalized == "delivered":
        return "ENTREGADO"
    if normalized == "read":
        return "LEIDO"
    if normalized in {"failed", "undeliverable"}:
        return "ERROR"
    return "ENVIADO"


def verify_meta_webhook_signature(request) -> None:
    app_secret = (settings.WHATSAPP_META_APP_SECRET or "").strip()
    if not app_secret:
        return
    signature = (request.headers.get("X-Hub-Signature-256") or "").strip()
    if not signature.startswith("sha256="):
        raise HttpError(401, "Firma de webhook de Meta invalida.")
    digest = hmac.new(
        app_secret.encode("utf-8"),
        request.body,
        hashlib.sha256,
    ).hexdigest()
    if signature != f"sha256={digest}":
        raise HttpError(401, "La firma del webhook de Meta no coincide.")


def classify_financial_message(
    *,
    config: ConfiguracionComunicacion,
    canal: CanalPermitido | None,
    text_value: str,
    has_attachment: bool,
) -> dict[str, object]:
    normalized = normalize_lookup_text(text_value)
    payment_hits = {
        keyword: category
        for keyword, category in STRONG_PAYMENT_KEYWORDS.items()
        if keyword in normalized
    }
    expense_hits = {
        keyword: category
        for keyword, category in STRONG_EXPENSE_KEYWORDS.items()
        if keyword in normalized
    }

    if canal and canal.tipo_movimiento_default in {"INGRESO", "EGRESO"}:
        tipo_movimiento = canal.tipo_movimiento_default
        categoria = (
            next(iter(payment_hits.values()), "CANAL_CONFIGURADO")
            if tipo_movimiento == "INGRESO"
            else next(iter(expense_hits.values()), "CANAL_CONFIGURADO")
        )
        confidence = Decimal("97.00")
        reasons = ["Se uso el tipo por defecto configurado en el canal permitido."]
    elif payment_hits and not expense_hits:
        tipo_movimiento = "INGRESO"
        categoria = next(iter(payment_hits.values()))
        confidence = Decimal("90.00") if has_attachment else Decimal("82.00")
        reasons = ["Se detectaron palabras clave asociadas a pagos o rentas."]
    elif expense_hits and not payment_hits:
        tipo_movimiento = "EGRESO"
        categoria = next(iter(expense_hits.values()))
        confidence = Decimal("90.00") if has_attachment else Decimal("82.00")
        reasons = ["Se detectaron palabras clave asociadas a gastos operativos."]
    elif has_attachment:
        tipo_movimiento = "INGRESO"
        categoria = "POR_REVISAR"
        confidence = Decimal("55.00")
        reasons = [
            "El mensaje trae un archivo, pero no hubo suficientes pistas para clasificarlo con certeza."
        ]
    else:
        tipo_movimiento = "INGRESO"
        categoria = "TEXTO_GENERAL"
        confidence = Decimal("40.00")
        reasons = ["No hubo archivo ni señales financieras claras en el texto."]

    amount = extract_amount_from_text(text_value)
    if amount:
        confidence += Decimal("3.00")
        reasons.append("Se detecto un monto utilizable dentro del texto.")

    confidence = min(confidence, Decimal("99.99"))
    threshold = clamp_money(config.umbral_confianza_autoaplicacion)
    requires_review = confidence < threshold
    return {
        "tipo_movimiento": tipo_movimiento,
        "categoria": categoria,
        "confianza": confidence,
        "requiere_revision_manual": requires_review,
        "monto_reportado": amount,
        "referencia_reportada": extract_reference_from_text(text_value),
        "razones": reasons,
    }


def should_create_evidence(
    *,
    config: ConfiguracionComunicacion,
    canal: CanalPermitido | None,
    type_message: str,
    text_value: str,
) -> bool:
    if not config.auto_detectar_comprobantes:
        return False
    if canal and not canal.capturar_evidencias:
        return False
    normalized = normalize_lookup_text(text_value)
    if type_message in EVIDENCE_MESSAGE_TYPES:
        return True
    return any(
        keyword in normalized
        for keyword in (*STRONG_PAYMENT_KEYWORDS.keys(), *STRONG_EXPENSE_KEYWORDS.keys())
    )


def record_whatsapp_evidence_usage(
    *,
    config: ConfiguracionComunicacion,
    evidencia: EvidenciaPago,
    provider: str,
    reference_datetime,
) -> None:
    capa = (
        evidencia.entidad_relacionada.capa_negocio
        if evidencia.entidad_relacionada_id
        else config.capa_negocio
    )
    if capa is None:
        return
    registrar_consumo_saas(
        capa=capa,
        categoria="WHATSAPP_COMPROBANTE",
        cantidad=1,
        descripcion=f"Comprobante recibido por WhatsApp ({provider})",
        fecha_consumo=reference_datetime,
        referencia_unica=f"{provider}:evidencia:{evidencia.id}",
        origen_modelo="comunicaciones.EvidenciaPago",
        origen_id=evidencia.id,
        metadata={
            "proveedor": provider,
            "evidencia_id": evidencia.id,
            "mensaje_id": evidencia.mensaje_relacionado_id,
            "caso_id": evidencia.caso_relacionado_id,
            "monto_reportado": str(evidencia.monto_reportado or ""),
            "tipo_movimiento": evidencia.tipo_movimiento,
        },
    )


def normalize_green_api_auth_token(token: str) -> list[str]:
    value = token.strip()
    if not value:
        return []
    if value.lower().startswith("basic ") or value.lower().startswith("bearer "):
        return [value]
    return [value, f"Bearer {value}"]


def validate_green_api_authorization(request, config: ConfiguracionComunicacion) -> None:
    expected_token = (config.green_api_webhook_token or "").strip()
    if not expected_token:
        return
    authorization = (request.headers.get("Authorization") or "").strip()
    if authorization not in normalize_green_api_auth_token(expected_token):
        raise HttpError(401, "Authorization invalida para el webhook de Green API.")


def get_green_api_instance_id_from_payload(payload: dict) -> str | None:
    direct_value = str(payload.get("idInstance") or "").strip()
    if direct_value:
        return direct_value
    instance_data = payload.get("instanceData") or {}
    return str(instance_data.get("idInstance") or "").strip() or None


def find_green_api_config_by_authorization(
    authorization: str,
) -> ConfiguracionComunicacion | None:
    if not authorization:
        return None
    queryset = ConfiguracionComunicacion.objects.filter(
        activo=True,
        green_api_webhook_token__isnull=False,
    ).exclude(green_api_webhook_token="")
    for config in queryset.select_related("capa_negocio").order_by("id"):
        if authorization in normalize_green_api_auth_token(
            config.green_api_webhook_token or ""
        ):
            return config
    return None


def find_green_api_config_from_payload_metadata(
    payload: dict,
) -> ConfiguracionComunicacion | None:
    config_id = payload.get("_betterp_config_id")
    if not config_id:
        return None
    try:
        parsed_config_id = int(config_id)
    except (TypeError, ValueError):
        return None
    return (
        ConfiguracionComunicacion.objects.select_related("capa_negocio")
        .filter(id=parsed_config_id, activo=True)
        .first()
    )


def find_green_api_config_by_instance(
    payload: dict,
) -> ConfiguracionComunicacion | None:
    instance_id = get_green_api_instance_id_from_payload(payload)
    if not instance_id:
        return None
    return (
        ConfiguracionComunicacion.objects.select_related("capa_negocio")
        .filter(
            activo=True,
            green_api_instance_id=str(instance_id),
        )
        .order_by("id")
        .first()
    )


def find_allowed_channel_across_configs(
    *,
    chat_id: str | None,
    sender: str | None,
) -> CanalPermitido | None:
    identifiers = [value for value in [chat_id, sender] if value]
    if not identifiers:
        return None
    channels = list(
        CanalPermitido.objects.select_related(
            "configuracion_relacionada",
            "configuracion_relacionada__capa_negocio",
            "entidad_relacionada",
            "cliente_relacionado",
        )
        .filter(
            activo=True,
            configuracion_relacionada__activo=True,
            identificador_externo__in=identifiers,
        )
        .order_by("id")[:2]
    )
    if len(channels) == 1:
        return channels[0]
    return None


def resolve_green_api_config(
    *,
    request=None,
    payload: dict | None = None,
    chat_id: str | None = None,
    sender: str | None = None,
) -> ConfiguracionComunicacion:
    payload = payload or {}
    config = find_green_api_config_from_payload_metadata(payload)
    if config:
        return config

    if request is not None:
        authorization = (request.headers.get("Authorization") or "").strip()
        if authorization:
            config = find_green_api_config_by_authorization(authorization)
            if not config:
                raise HttpError(401, "Authorization invalida para el webhook de Green API.")
            return config

    config = find_green_api_config_by_instance(payload)
    if config:
        return config

    channel = find_allowed_channel_across_configs(chat_id=chat_id, sender=sender)
    if channel:
        return channel.configuracion_relacionada

    return get_or_create_main_config()


def resolve_allowed_channel(
    config: ConfiguracionComunicacion,
    *,
    chat_id: str | None,
    sender: str | None,
) -> CanalPermitido | None:
    active_channels = list(
        config.canales_permitidos.select_related(
            "entidad_relacionada",
            "cliente_relacionado",
        )
        .filter(activo=True)
        .order_by("id")
    )
    if not active_channels:
        return None
    for channel in active_channels:
        if channel.identificador_externo == (chat_id or ""):
            return channel
    for channel in active_channels:
        if channel.canal == "CHAT_WHATSAPP" and channel.identificador_externo == (sender or ""):
            return channel
    return None


def build_green_api_settings_payload(config: ConfiguracionComunicacion) -> dict[str, object]:
    if not config.green_api_webhook_url:
        raise ValueError("Define la URL publica del webhook antes de sincronizar Green API.")
    return {
        "webhookUrl": config.green_api_webhook_url,
        "webhookUrlToken": config.green_api_webhook_token or "",
        "incomingWebhook": "yes",
        "outgoingWebhook": "yes",
        "outgoingMessageWebhook": "yes",
        "outgoingAPIMessageWebhook": "yes",
        "stateWebhook": "yes",
        "incomingCallWebhook": "no",
        "editedMessageWebhook": "no",
        "deletedMessageWebhook": "no",
        "markIncomingMessagesReaded": "no",
    }


def sync_green_api_settings(config: ConfiguracionComunicacion) -> dict[str, object]:
    if not config.green_api_instance_id or not config.green_api_token:
        raise ValueError("Completa Instance ID y Token antes de sincronizar Green API.")
    api_url = (config.green_api_api_url or DEFAULT_GREEN_API_URL).rstrip("/")
    endpoint = (
        f"{api_url}/waInstance{config.green_api_instance_id}/setSettings/"
        f"{config.green_api_token}"
    )
    payload = build_green_api_settings_payload(config)
    response = requests.post(endpoint, json=payload, timeout=20)
    if response.status_code >= 400:
        raise ValueError(
            f"Green API rechazo la sincronizacion ({response.status_code}): {response.text}"
        )
    try:
        body = response.json()
    except Exception:
        body = {"raw": response.text}
    return {
        "endpoint": endpoint,
        "payload": payload,
        "response": body,
    }


def spawn_webhook_processing(webhook_id: int) -> None:
    enqueue_background_job(
        kind="webhook.process",
        payload={"webhook_id": webhook_id},
        max_attempts=3,
    )


def resolve_case(
    *,
    caso_id: int | None = None,
    caso_clave_externa: str | None = None,
    grupo_externo_id: str | None = None,
    remitente: str = "",
    remitente_nombre: str = "",
    canal: str = "WHATSAPP",
    entidad: EntidadNegocio | None = None,
    cliente: Cliente | None = None,
    create_if_missing: bool = False,
    reference_datetime: datetime | None = None,
    request=None,
) -> CasoProcesamiento | None:
    case_queryset = scoped_case_queryset(request) if request is not None else CasoProcesamiento.objects
    if caso_id:
        if request is not None:
            return get_scoped_case_by_id(request, caso_id)
        return get_object_or_404(case_queryset, id=caso_id)

    normalized_key = (caso_clave_externa or "").strip()
    if normalized_key:
        caso = case_queryset.filter(clave_externa=normalized_key).first()
        if caso:
            return caso
        if create_if_missing:
            return CasoProcesamiento.objects.create(
                entidad_relacionada=entidad,
                cliente_relacionado=cliente,
                clave_externa=normalized_key,
                grupo_externo_id=(grupo_externo_id or "").strip() or None,
                canal=canal,
                remitente=remitente.strip(),
                remitente_nombre=remitente_nombre.strip() or None,
                fecha_ultimo_mensaje=reference_datetime or timezone.now(),
            )

    normalized_group = (grupo_externo_id or "").strip()
    normalized_sender = remitente.strip()
    if normalized_group and normalized_sender:
        caso = (
            case_queryset.filter(
                grupo_externo_id=normalized_group,
                remitente=normalized_sender,
                canal=canal,
            )
            .exclude(estatus__in=["CONCILIADO", "DESCARTADO"])
            .order_by("-fecha_ultimo_mensaje", "-id")
            .first()
        )
        if caso:
            return caso
        if create_if_missing:
            return CasoProcesamiento.objects.create(
                entidad_relacionada=entidad,
                cliente_relacionado=cliente,
                grupo_externo_id=normalized_group,
                canal=canal,
                remitente=normalized_sender,
                remitente_nombre=remitente_nombre.strip() or None,
                fecha_ultimo_mensaje=reference_datetime or timezone.now(),
            )

    return None


def apply_case_payload(
    caso: CasoProcesamiento,
    payload: CasoProcesamientoIn,
    request=None,
) -> CasoProcesamiento:
    cliente = (
        (
            get_scoped_client_or_none(request, payload.cliente_id)
            if request is not None
            else get_object_or_404(
                Cliente.objects.select_related("entidad_relacionada"),
                id=payload.cliente_id,
            )
        )
        if payload.cliente_id
        else None
    )
    entidad = None
    if payload.entidad_id:
        if cliente and cliente.entidad_relacionada_id == payload.entidad_id:
            entidad = cliente.entidad_relacionada
        elif request is not None:
            entidad = get_scoped_entity_or_none(request, payload.entidad_id)
        else:
            entidad = get_object_or_404(EntidadNegocio, id=payload.entidad_id)
    caso.entidad_relacionada = entidad
    caso.cliente_relacionado = cliente
    caso.clave_externa = payload.clave_externa.strip() or None
    caso.grupo_externo_id = payload.grupo_externo_id.strip() or None
    caso.canal = payload.canal
    caso.remitente = payload.remitente.strip()
    caso.remitente_nombre = payload.remitente_nombre.strip() or None
    caso.texto_consolidado = payload.texto_consolidado.strip() or None
    caso.caption_consolidado = payload.caption_consolidado.strip() or None
    caso.metadata = payload.metadata
    caso.estatus = payload.estatus
    caso.fecha_ultimo_mensaje = payload.fecha_ultimo_mensaje or timezone.now()
    return caso


def resolve_payload_relations(
    request,
    *,
    entidad_id: int | None,
    cliente_id: int | None,
    known_case: CasoProcesamiento | None = None,
    known_message: MensajeEntrante | None = None,
) -> tuple[EntidadNegocio | None, Cliente | None]:
    cliente = None
    if cliente_id:
        if known_case and known_case.cliente_relacionado_id == cliente_id:
            cliente = known_case.cliente_relacionado
        elif known_message and known_message.cliente_relacionado_id == cliente_id:
            cliente = known_message.cliente_relacionado
        else:
            cliente = get_scoped_client_or_none(request, cliente_id)

    entidad = None
    if entidad_id:
        if known_case and known_case.entidad_relacionada_id == entidad_id:
            entidad = known_case.entidad_relacionada
        elif known_message and known_message.entidad_relacionada_id == entidad_id:
            entidad = known_message.entidad_relacionada
        elif cliente and cliente.entidad_relacionada_id == entidad_id:
            entidad = cliente.entidad_relacionada
        else:
            entidad = get_scoped_entity_or_none(request, entidad_id)

    return entidad, cliente


def refresh_case_from_message(
    caso: CasoProcesamiento,
    *,
    entidad: EntidadNegocio | None,
    cliente: Cliente | None,
    texto: str | None,
    fecha_mensaje: datetime,
    grupo_externo_id: str | None = None,
) -> None:
    update_fields = ["fecha_actualizacion"]
    if entidad and caso.entidad_relacionada_id != entidad.id:
        caso.entidad_relacionada = entidad
        update_fields.append("entidad_relacionada")
    if cliente and caso.cliente_relacionado_id != cliente.id:
        caso.cliente_relacionado = cliente
        update_fields.append("cliente_relacionado")
    if grupo_externo_id and caso.grupo_externo_id != grupo_externo_id.strip():
        caso.grupo_externo_id = grupo_externo_id.strip()
        update_fields.append("grupo_externo_id")

    next_text = append_text(caso.texto_consolidado, texto)
    if next_text != caso.texto_consolidado:
        caso.texto_consolidado = next_text
        update_fields.append("texto_consolidado")

    if fecha_mensaje > caso.fecha_ultimo_mensaje:
        caso.fecha_ultimo_mensaje = fecha_mensaje
        update_fields.append("fecha_ultimo_mensaje")

    if caso.estatus not in {"CONCILIADO", "DESCARTADO"}:
        caso.estatus = "NUEVO"
        update_fields.append("estatus")

    caso.save(update_fields=list(dict.fromkeys(update_fields)))


def refresh_case_from_evidence(
    caso: CasoProcesamiento,
    *,
    entidad: EntidadNegocio | None,
    cliente: Cliente | None,
    texto_extraido: str | None,
    reference_datetime: datetime | None = None,
) -> None:
    update_fields = ["fecha_actualizacion"]
    if entidad and caso.entidad_relacionada_id != entidad.id:
        caso.entidad_relacionada = entidad
        update_fields.append("entidad_relacionada")
    if cliente and caso.cliente_relacionado_id != cliente.id:
        caso.cliente_relacionado = cliente
        update_fields.append("cliente_relacionado")

    next_text = append_text(caso.texto_consolidado, texto_extraido)
    if next_text != caso.texto_consolidado:
        caso.texto_consolidado = next_text
        update_fields.append("texto_consolidado")

    reference_time = reference_datetime or timezone.now()
    if reference_time > caso.fecha_ultimo_mensaje:
        caso.fecha_ultimo_mensaje = reference_time
        update_fields.append("fecha_ultimo_mensaje")

    if caso.estatus not in {"CONCILIADO", "DESCARTADO"}:
        caso.estatus = "EN_REVISION"
        update_fields.append("estatus")

    caso.save(update_fields=list(dict.fromkeys(update_fields)))


def build_evidence_hash(
    *,
    provider: str,
    external_message_id: str,
    download_url: str | None,
    text_value: str | None,
) -> str:
    seed = "|".join(
        [
            provider,
            external_message_id,
            download_url or "",
            (text_value or "")[:250],
        ]
    )
    return hashlib.sha256(seed.encode("utf-8")).hexdigest()


def upsert_event_from_evidence(
    *,
    config: ConfiguracionComunicacion,
    evidencia: EvidenciaPago,
    caso: CasoProcesamiento | None,
    remitente_nombre: str | None = None,
    apply_override: bool | None = None,
) -> dict[str, object]:
    concepto = evidencia.categoria_sugerida or "COMPROBANTE"
    beneficiario = (
        evidencia.cliente_relacionado.razon_social
        if evidencia.cliente_relacionado_id and evidencia.cliente_relacionado
        else (remitente_nombre or (caso.remitente_nombre if caso else None))
    )
    texto_fuente = "\n".join(
        item
        for item in [
            caso.texto_consolidado if caso else None,
            evidencia.texto_extraido,
            evidencia.observaciones,
        ]
        if isinstance(item, str) and item.strip()
    )
    tipo_destino = (
        "CXC"
        if evidencia.tipo_movimiento == "INGRESO"
        else "CXP"
    )
    if evidencia.tipo_movimiento == "INGRESO" and not evidencia.cliente_relacionado_id:
        tipo_destino = "NO_IDENTIFICADO"

    partidas = []
    if evidencia.monto_reportado:
        partidas.append(
            {
                "tipo_destino": tipo_destino,
                "entidad_id": evidencia.entidad_relacionada_id,
                "cliente_id": evidencia.cliente_relacionado_id if tipo_destino == "CXC" else None,
                "concepto": concepto,
                "beneficiario": beneficiario or "",
                "monto_partida": evidencia.monto_reportado,
                "periodo_referencia": (
                    evidencia.fecha_pago_reportada.strftime("%B %Y")
                    if evidencia.fecha_pago_reportada
                    else ""
                ),
            }
        )

    event = upsert_financial_event(
        caso_id=caso.id if caso else None,
        evidencia_id=evidencia.id,
        entidad_id=evidencia.entidad_relacionada_id,
        cliente_id=evidencia.cliente_relacionado_id,
        origen_evento="WHATSAPP",
        tipo_movimiento=evidencia.tipo_movimiento,
        beneficiario_principal=beneficiario or "",
        referencia_principal=evidencia.referencia_reportada or "",
        fecha_evento=evidencia.fecha_pago_reportada or timezone.localdate(),
        monto_total_reportado=evidencia.monto_reportado,
        confianza_global=evidencia.confianza_clasificacion,
        requiere_revision_manual=evidencia.requiere_revision_manual,
        texto_consolidado=texto_fuente,
        raw_data=evidencia.metadata or {},
        propuesta_ia=None,
        observaciones=evidencia.observaciones or "",
        estatus="PROPUESTO",
        partidas=partidas,
    )

    applied = False
    if (
        (config.auto_aplicar_eventos_confiables if apply_override is None else apply_override)
        and not evidencia.requiere_revision_manual
        and partidas
    ):
        apply_financial_event(event)
        event.refresh_from_db()
        applied = event.estatus in {"APLICADO", "CONCILIADO"}
        if applied:
            evidencia.estatus = "APLICADA"
            evidencia.save(update_fields=["estatus"])

    return {
        "event_id": event.id,
        "event_status": event.estatus,
        "applied": applied,
    }


def process_meta_status_updates(payload: dict) -> int:
    updated = 0
    for entry in payload.get("entry") or []:
        for change in entry.get("changes") or []:
            value = change.get("value") or {}
            for status_item in value.get("statuses") or []:
                message_id = str(status_item.get("id") or "").strip()
                if not message_id:
                    continue
                history = (
                    HistorialEnvio.objects.filter(
                        proveedor="META_CLOUD_API",
                        referencia_envio=message_id,
                    )
                    .order_by("-id")
                    .first()
                )
                if not history:
                    continue
                metadata = history.metadata or {}
                metadata["meta_status_payload"] = status_item
                metadata["meta_status"] = status_item.get("status")
                metadata["meta_conversation"] = status_item.get("conversation") or {}
                metadata["meta_pricing"] = status_item.get("pricing") or {}
                history.metadata = metadata
                history.estatus = map_meta_status_to_historial(
                    str(status_item.get("status") or "")
                )
                history.save(update_fields=["estatus", "metadata"])
                updated += 1
    return updated


def process_meta_cloud_webhook(webhook: WebhookEntrante) -> dict[str, object]:
    payload = webhook.payload_completo or {}
    status_updates = process_meta_status_updates(payload)

    processed_messages = 0
    created_evidences = 0
    created_events = 0

    for entry in payload.get("entry") or []:
        for change in entry.get("changes") or []:
            if change.get("field") != "messages":
                continue
            value = change.get("value") or {}
            metadata = value.get("metadata") or {}
            phone_number_id = str(metadata.get("phone_number_id") or "").strip() or None
            display_phone_number = (
                str(metadata.get("display_phone_number") or "").strip() or None
            )
            channel = resolve_whatsapp_channel_for_incoming(
                phone_number_id=phone_number_id,
                display_phone_number=display_phone_number,
            )
            config = get_or_create_config_for_capa(
                channel.capa_negocio if channel else None
            )
            contacts = value.get("contacts") or []
            contact_name = (
                str(((contacts[0] or {}).get("profile") or {}).get("name") or "").strip()
                if contacts
                else None
            )

            for message in value.get("messages") or []:
                sender = str(message.get("from") or "").strip() or "desconocido"
                text_value, message_type = extract_meta_message_text(message)
                media_id = extract_meta_media_id(message, message_type)
                file_url = (
                    build_meta_media_proxy_url(canal_id=channel.id, media_id=media_id)
                    if channel and media_id
                    else None
                )
                timestamp = message.get("timestamp")
                if isinstance(timestamp, str) and timestamp.isdigit():
                    fecha_mensaje = datetime.fromtimestamp(
                        int(timestamp),
                        tz=timezone.get_current_timezone(),
                    )
                else:
                    fecha_mensaje = timezone.now()

                entidad = channel.entidad_relacionada if channel else None
                cliente = resolve_incoming_whatsapp_cliente(
                    sender,
                    official_channel=channel,
                    entidad=entidad,
                    config=config,
                )
                if cliente and not entidad:
                    entidad = cliente.entidad_relacionada
                case_key = (
                    f"meta:{phone_number_id or 'phone'}:{sender}"
                )
                caso = resolve_case(
                    caso_clave_externa=case_key,
                    grupo_externo_id=phone_number_id or display_phone_number,
                    remitente=sender,
                    remitente_nombre=contact_name or "",
                    canal="WHATSAPP",
                    entidad=entidad,
                    cliente=cliente,
                    create_if_missing=True,
                    reference_datetime=fecha_mensaje,
                )
                external_message_id = (
                    str(message.get("id") or webhook.origen_externo_id or webhook.id)
                )
                incoming_metadata = {
                    "meta_payload": message,
                    "phone_number_id": phone_number_id,
                    "display_phone_number": display_phone_number,
                    "channel_id": channel.id if channel else None,
                    "contact": contacts[0] if contacts else {},
                }
                mensaje, _ = MensajeEntrante.objects.update_or_create(
                    origen_externo_id=external_message_id,
                    defaults={
                        "webhook_relacionado": webhook,
                        "caso_relacionado": caso,
                        "entidad_relacionada": entidad,
                        "cliente_relacionado": cliente,
                        "chat_id": phone_number_id or display_phone_number,
                        "canal": "WHATSAPP",
                        "tipo_mensaje": message_type or None,
                        "remitente": sender,
                        "remitente_nombre": contact_name,
                        "fecha_mensaje": fecha_mensaje,
                        "texto": text_value or None,
                        "url_adjunto": file_url,
                        "metadata": incoming_metadata,
                    },
                )
                refresh_case_from_message(
                    caso,
                    entidad=entidad,
                    cliente=cliente,
                    texto=text_value,
                    fecha_mensaje=fecha_mensaje,
                    grupo_externo_id=phone_number_id or display_phone_number,
                )
                processed_messages += 1
                if apply_collection_opt_out_from_message(
                    cliente=cliente,
                    mensaje=mensaje,
                    caso=caso,
                    text_value=text_value,
                    provider="META_CLOUD_API",
                    sender=sender,
                    config=config,
                    reference_datetime=fecha_mensaje,
                ):
                    continue

                if apply_portal_access_assistant_from_message(
                    cliente=cliente,
                    mensaje=mensaje,
                    caso=caso,
                    text_value=text_value,
                    message_type=message_type,
                    provider="META_CLOUD_API",
                    sender=sender,
                    config=config,
                    reference_datetime=fecha_mensaje,
                ):
                    continue

                if not should_create_evidence(
                    config=config,
                    canal=None,
                    type_message=message_type,
                    text_value=text_value,
                ):
                    continue

                classification = classify_financial_message(
                    config=config,
                    canal=None,
                    text_value=text_value,
                    has_attachment=bool(file_url),
                )
                evidence_hash = build_evidence_hash(
                    provider="META_CLOUD_API",
                    external_message_id=external_message_id,
                    download_url=file_url,
                    text_value=text_value,
                )
                evidencia, created = EvidenciaPago.objects.get_or_create(
                    hash_archivo=evidence_hash,
                    defaults={
                        "entidad_relacionada": entidad,
                        "caso_relacionado": caso,
                        "cliente_relacionado": cliente,
                        "mensaje_relacionado": mensaje,
                        "canal": "WHATSAPP",
                        "tipo_movimiento": str(classification["tipo_movimiento"]),
                        "origen_deteccion": "META_CLOUD_API",
                        "url_archivo": file_url,
                        "monto_reportado": classification["monto_reportado"],
                        "fecha_pago_reportada": fecha_mensaje.date(),
                        "referencia_reportada": classification["referencia_reportada"],
                        "texto_extraido": text_value or None,
                        "confianza_clasificacion": classification["confianza"],
                        "requiere_revision_manual": bool(
                            classification["requiere_revision_manual"]
                        ),
                        "categoria_sugerida": str(classification["categoria"]),
                        "metadata": {
                            "meta_payload": message,
                            "channel_id": channel.id if channel else None,
                            "classification_reasons": classification["razones"],
                            "message_type": message_type,
                            "media_id": media_id,
                        },
                        "observaciones": (
                            "Creada automaticamente desde WhatsApp Cloud API. "
                            + " ".join(classification["razones"])
                        ),
                    },
                )
                if not created:
                    update_fields = []
                    if evidencia.mensaje_relacionado_id != mensaje.id:
                        evidencia.mensaje_relacionado = mensaje
                        update_fields.append("mensaje_relacionado")
                    if caso and evidencia.caso_relacionado_id != caso.id:
                        evidencia.caso_relacionado = caso
                        update_fields.append("caso_relacionado")
                    if update_fields:
                        evidencia.save(update_fields=update_fields)
                else:
                    record_whatsapp_evidence_usage(
                        config=config,
                        evidencia=evidencia,
                        provider="META_CLOUD_API",
                        reference_datetime=fecha_mensaje,
                    )
                created_evidences += 1
                refresh_case_from_evidence(
                    caso,
                    entidad=evidencia.entidad_relacionada,
                    cliente=evidencia.cliente_relacionado,
                    texto_extraido=evidencia.texto_extraido,
                    reference_datetime=fecha_mensaje,
                )
                if config.auto_crear_eventos:
                    event_result = upsert_event_from_evidence(
                        config=config,
                        evidencia=evidencia,
                        caso=caso,
                        remitente_nombre=contact_name,
                    )
                    if event_result.get("event_id"):
                        created_events += 1

    if processed_messages == 0 and status_updates > 0:
        webhook.estatus_procesamiento = "PROCESADO"
        webhook.procesado = True
        webhook.fecha_procesamiento = timezone.now()
        webhook.error_procesamiento = None
        webhook.save(
            update_fields=[
                "estatus_procesamiento",
                "procesado",
                "fecha_procesamiento",
                "error_procesamiento",
            ]
        )
        return {"status_updates": status_updates, "messages": 0}

    if processed_messages == 0:
        webhook.estatus_procesamiento = "IGNORADO"
        webhook.procesado = True
        webhook.fecha_procesamiento = timezone.now()
        webhook.error_procesamiento = "Webhook de Meta sin mensajes utilizables."
        webhook.save(
            update_fields=[
                "estatus_procesamiento",
                "procesado",
                "fecha_procesamiento",
                "error_procesamiento",
            ]
        )
        return {"ignored": True, "status_updates": status_updates}

    webhook.estatus_procesamiento = "PROCESADO"
    webhook.procesado = True
    webhook.fecha_procesamiento = timezone.now()
    webhook.error_procesamiento = None
    webhook.save(
        update_fields=[
            "estatus_procesamiento",
            "procesado",
            "fecha_procesamiento",
            "error_procesamiento",
        ]
    )
    return {
        "status_updates": status_updates,
        "messages": processed_messages,
        "evidences": created_evidences,
        "events": created_events,
    }


def process_green_api_webhook(webhook: WebhookEntrante) -> dict[str, object]:
    payload = webhook.payload_completo or {}
    webhook_type = str(payload.get("typeWebhook") or "").strip() or None
    sender_data = payload.get("senderData") or {}
    message_data = payload.get("messageData") or {}
    chat_id = str(sender_data.get("chatId") or "").strip() or None
    sender = str(sender_data.get("sender") or "").strip() or None
    sender_name = (
        str(sender_data.get("senderContactName") or "").strip()
        or str(sender_data.get("senderName") or "").strip()
        or None
    )
    text_value, type_message = extract_green_api_text(message_data)
    file_url = build_green_api_file_url(message_data)
    config = resolve_green_api_config(
        payload=payload,
        chat_id=chat_id,
        sender=sender,
    )
    channel = resolve_allowed_channel(config, chat_id=chat_id, sender=sender)

    if webhook_type != "incomingMessageReceived":
        webhook.estatus_procesamiento = "IGNORADO"
        webhook.procesado = True
        webhook.fecha_procesamiento = timezone.now()
        webhook.error_procesamiento = "Tipo de webhook fuera del flujo financiero."
        webhook.save(
            update_fields=[
                "estatus_procesamiento",
                "procesado",
                "fecha_procesamiento",
                "error_procesamiento",
            ]
        )
        return {"ignored": True, "reason": "typeWebhook_no_soportado"}

    if config.green_api_modo_filtro == "SOLO_PERMITIDOS" and not channel:
        webhook.estatus_procesamiento = "IGNORADO"
        webhook.procesado = True
        webhook.fecha_procesamiento = timezone.now()
        webhook.error_procesamiento = "Chat o remitente fuera de los canales permitidos."
        webhook.save(
            update_fields=[
                "estatus_procesamiento",
                "procesado",
                "fecha_procesamiento",
                "error_procesamiento",
            ]
        )
        return {"ignored": True, "reason": "chat_no_permitido"}

    entidad = channel.entidad_relacionada if channel else None
    cliente = resolve_incoming_whatsapp_cliente(
        sender or chat_id,
        allowed_channel=channel,
        entidad=entidad,
        config=config,
    )
    if cliente and not entidad:
        entidad = cliente.entidad_relacionada
    timestamp = payload.get("timestamp")
    if isinstance(timestamp, (int, float)):
        fecha_mensaje = datetime.fromtimestamp(
            timestamp,
            tz=timezone.get_current_timezone(),
        )
    else:
        fecha_mensaje = timezone.now()

    external_message_id = str(payload.get("idMessage") or webhook.origen_externo_id or webhook.id)
    case_key = f"green:{chat_id or 'chat'}:{sender or 'remitente'}"
    caso = resolve_case(
        caso_clave_externa=case_key,
        grupo_externo_id=chat_id,
        remitente=sender or chat_id or "desconocido",
        remitente_nombre=sender_name or "",
        canal="WHATSAPP",
        entidad=entidad,
        cliente=cliente,
        create_if_missing=True,
        reference_datetime=fecha_mensaje,
    )

    mensaje_defaults = {
        "webhook_relacionado": webhook,
        "caso_relacionado": caso,
        "entidad_relacionada": entidad,
        "cliente_relacionado": cliente,
        "chat_id": chat_id,
        "canal": "WHATSAPP",
        "tipo_mensaje": type_message or None,
        "remitente": sender or chat_id or "desconocido",
        "remitente_nombre": sender_name,
        "fecha_mensaje": fecha_mensaje,
        "texto": text_value or None,
        "url_adjunto": file_url,
        "metadata": {
            "green_api": payload,
            "channel_id": channel.id if channel else None,
        },
    }
    mensaje, _ = MensajeEntrante.objects.update_or_create(
        origen_externo_id=external_message_id,
        defaults=mensaje_defaults,
    )
    refresh_case_from_message(
        caso,
        entidad=entidad,
        cliente=cliente,
        texto=text_value,
        fecha_mensaje=fecha_mensaje,
        grupo_externo_id=chat_id,
    )

    result: dict[str, object] = {
        "mensaje_id": mensaje.id,
        "caso_id": caso.id,
        "evidencia_id": None,
        "event_id": None,
    }
    if apply_collection_opt_out_from_message(
        cliente=cliente,
        mensaje=mensaje,
        caso=caso,
        text_value=text_value,
        provider="GREEN_API",
        sender=sender or chat_id,
        config=config,
        reference_datetime=fecha_mensaje,
    ):
        result["opt_out"] = True
        webhook.estatus_procesamiento = "PROCESADO"
        webhook.procesado = True
        webhook.fecha_procesamiento = timezone.now()
        webhook.error_procesamiento = None
        webhook.save(
            update_fields=[
                "estatus_procesamiento",
                "procesado",
                "fecha_procesamiento",
                "error_procesamiento",
            ]
        )
        return result

    if apply_portal_access_assistant_from_message(
        cliente=cliente,
        mensaje=mensaje,
        caso=caso,
        text_value=text_value,
        message_type=type_message,
        provider="GREEN_API",
        sender=sender or chat_id,
        config=config,
        reference_datetime=fecha_mensaje,
    ):
        result["portal_assistant"] = True
        webhook.estatus_procesamiento = "PROCESADO"
        webhook.procesado = True
        webhook.fecha_procesamiento = timezone.now()
        webhook.error_procesamiento = None
        webhook.save(
            update_fields=[
                "estatus_procesamiento",
                "procesado",
                "fecha_procesamiento",
                "error_procesamiento",
            ]
        )
        return result

    if should_create_evidence(
        config=config,
        canal=channel,
        type_message=type_message,
        text_value=text_value,
    ):
        classification = classify_financial_message(
            config=config,
            canal=channel,
            text_value=text_value,
            has_attachment=bool(file_url),
        )
        evidence_hash = build_evidence_hash(
            provider="GREEN_API",
            external_message_id=external_message_id,
            download_url=file_url,
            text_value=text_value,
        )
        evidencia, created = EvidenciaPago.objects.get_or_create(
            hash_archivo=evidence_hash,
            defaults={
                "entidad_relacionada": entidad,
                "caso_relacionado": caso,
                "cliente_relacionado": cliente,
                "mensaje_relacionado": mensaje,
                "canal": "WHATSAPP",
                "tipo_movimiento": str(classification["tipo_movimiento"]),
                "origen_deteccion": "GREEN_API",
                "url_archivo": file_url,
                "monto_reportado": classification["monto_reportado"],
                "fecha_pago_reportada": fecha_mensaje.date(),
                "referencia_reportada": classification["referencia_reportada"],
                "texto_extraido": text_value or None,
                "confianza_clasificacion": classification["confianza"],
                "requiere_revision_manual": bool(
                    classification["requiere_revision_manual"]
                ),
                "categoria_sugerida": str(classification["categoria"]),
                "metadata": {
                    "green_api": payload,
                    "channel_id": channel.id if channel else None,
                    "classification_reasons": classification["razones"],
                    "message_type": type_message,
                },
                "observaciones": (
                    "Creada automaticamente desde Green API. "
                    + " ".join(classification["razones"])
                ),
            },
        )
        if not created:
            updates = []
            if evidencia.mensaje_relacionado_id != mensaje.id:
                evidencia.mensaje_relacionado = mensaje
                updates.append("mensaje_relacionado")
            if caso and evidencia.caso_relacionado_id != caso.id:
                evidencia.caso_relacionado = caso
                updates.append("caso_relacionado")
            if updates:
                evidencia.save(update_fields=updates)
        else:
            record_whatsapp_evidence_usage(
                config=config,
                evidencia=evidencia,
                provider="GREEN_API",
                reference_datetime=fecha_mensaje,
            )

        refresh_case_from_evidence(
            caso,
            entidad=evidencia.entidad_relacionada,
            cliente=evidencia.cliente_relacionado,
            texto_extraido=evidencia.texto_extraido,
            reference_datetime=fecha_mensaje,
        )
        result["evidencia_id"] = evidencia.id

        if config.auto_crear_eventos:
            event_result = upsert_event_from_evidence(
                config=config,
                evidencia=evidencia,
                caso=caso,
                remitente_nombre=sender_name,
            )
            result["event_id"] = event_result["event_id"]

    webhook.estatus_procesamiento = "PROCESADO"
    webhook.procesado = True
    webhook.fecha_procesamiento = timezone.now()
    webhook.error_procesamiento = None
    webhook.save(
        update_fields=[
            "estatus_procesamiento",
            "procesado",
            "fecha_procesamiento",
            "error_procesamiento",
        ]
    )
    return result


def process_webhook_safe(webhook_id: int) -> None:
    try:
        with transaction.atomic():
            webhook = WebhookEntrante.objects.select_for_update().get(id=webhook_id)
            if webhook.estatus_procesamiento == "PROCESADO":
                return
            webhook.estatus_procesamiento = "PROCESANDO"
            webhook.intentos_procesamiento += 1
            webhook.error_procesamiento = None
            webhook.save(
                update_fields=[
                    "estatus_procesamiento",
                    "intentos_procesamiento",
                    "error_procesamiento",
                ]
            )
        webhook = WebhookEntrante.objects.get(id=webhook_id)
        if webhook.proveedor == "META_CLOUD_API":
            process_meta_cloud_webhook(webhook)
        else:
            process_green_api_webhook(webhook)
    except Exception as exc:
        WebhookEntrante.objects.filter(id=webhook_id).update(
            estatus_procesamiento="ERROR",
            error_procesamiento=str(exc),
            fecha_procesamiento=timezone.now(),
        )


@router.get("/configuracion/")
def obtener_configuracion(request):
    require_cobranza_access(request)
    require_admin_access(request)
    config = get_or_create_main_config(request)
    whatsapp_access = has_whatsapp_automation_access(request)
    canales = (
        CanalPermitido.objects.select_related("entidad_relacionada", "cliente_relacionado")
        .filter(configuracion_relacionada=config)
        .order_by("nombre", "id")
    )
    canales_whatsapp = list(
        scoped_whatsapp_channel_queryset(request).order_by("-es_principal", "nombre", "id")
    ) if whatsapp_access else []
    canales_permitidos = list(canales)
    payload = serialize_configuracion(
        config,
        request,
        include_whatsapp_overview=whatsapp_access,
        whatsapp_channels=canales_whatsapp,
    )
    return {
        **payload,
        "canales_permitidos": [serialize_canal(item) for item in canales_permitidos],
        "canales_whatsapp": [serialize_whatsapp_channel(item) for item in canales_whatsapp],
    }


@router.put("/configuracion/")
def actualizar_configuracion(
    request,
    payload: ConfiguracionComunicacionIn,
    include_overview: bool = False,
):
    require_cobranza_access(request)
    if payload.openai_model.strip() or payload.auto_detectar_comprobantes:
        require_ai_copy_access(request)
    require_admin_access(request)
    config = get_or_create_main_config(request)
    apply_configuracion_payload(config, payload)
    config.save()
    config_payload = serialize_configuracion(
        config,
        request if include_overview else None,
        include_email_overview=include_overview,
        include_whatsapp_overview=include_overview,
    )
    return {
        "success": True,
        "mensaje": "Configuracion de comunicaciones actualizada correctamente.",
        "configuracion": config_payload,
    }


@router.get("/configuracion/whatsapp-cloud/canales/")
def listar_canales_whatsapp_oficiales(request):
    require_cobranza_access(request)
    require_whatsapp_automation_access(request)
    require_admin_access(request)
    queryset = scoped_whatsapp_channel_queryset(request)
    return [serialize_whatsapp_channel(item) for item in queryset]


@router.get("/configuracion/whatsapp-cloud/waba-subscription/")
def verificar_suscripcion_waba_meta(request):
    require_cobranza_access(request)
    require_whatsapp_automation_access(request)
    require_admin_access(request)
    channel = resolve_meta_subscription_channel(request)
    state = fetch_waba_subscription_state(channel)
    persist_waba_subscription_state(channel, state)
    return state


@router.post("/configuracion/whatsapp-cloud/waba-subscription/")
def alinear_suscripcion_waba_meta(request):
    require_cobranza_access(request)
    require_whatsapp_automation_access(request)
    require_admin_access(request)
    channel = resolve_meta_subscription_channel(request)
    action_payload = subscribe_waba_to_meta_app(channel)
    state = fetch_waba_subscription_state(channel)
    state["accion"] = action_payload
    state["mensaje"] = (
        "Solicitud enviada a Meta y suscripcion confirmada."
        if state.get("suscrita")
        else "Meta acepto la solicitud, pero la app esperada aun no aparece suscrita."
    )
    persist_waba_subscription_state(channel, state)
    return state


@router.post("/configuracion/whatsapp-cloud/canales/")
def crear_canal_whatsapp_oficial(request, payload: CanalWhatsappOficialIn):
    require_cobranza_access(request)
    require_whatsapp_automation_access(request)
    require_admin_access(request)
    canal = apply_whatsapp_channel_payload(
        CanalWhatsappOficial(proveedor=DEFAULT_WHATSAPP_PROVIDER),
        payload,
        request=request,
    )
    canal.save()
    ensure_single_primary_channel(canal)
    canal.refresh_from_db()
    return {
        "id": canal.id,
        "mensaje": "Numero oficial de WhatsApp guardado correctamente.",
        "canal": serialize_whatsapp_channel(canal),
    }


@router.put("/configuracion/whatsapp-cloud/canales/{canal_id}/")
def actualizar_canal_whatsapp_oficial(request, canal_id: int, payload: CanalWhatsappOficialIn):
    require_cobranza_access(request)
    require_whatsapp_automation_access(request)
    require_admin_access(request)
    canal = get_object_or_404(scoped_whatsapp_channel_queryset(request), id=canal_id)
    apply_whatsapp_channel_payload(canal, payload, request=request)
    canal.save()
    ensure_single_primary_channel(canal)
    canal.refresh_from_db()
    return {
        "success": True,
        "mensaje": "Numero oficial actualizado correctamente.",
        "canal": serialize_whatsapp_channel(canal),
    }


@router.post("/configuracion/whatsapp-cloud/canales/{canal_id}/principal/")
def marcar_canal_whatsapp_principal(request, canal_id: int):
    require_cobranza_access(request)
    require_whatsapp_automation_access(request)
    require_admin_access(request)
    canal = get_object_or_404(scoped_whatsapp_channel_queryset(request), id=canal_id)
    canal.es_principal = True
    canal.save(update_fields=["es_principal", "fecha_actualizacion"])
    ensure_single_primary_channel(canal)
    return {
        "success": True,
        "mensaje": "Este numero ya es el principal para envios salientes.",
        "canal": serialize_whatsapp_channel(canal),
    }


@router.delete("/configuracion/whatsapp-cloud/canales/{canal_id}/")
def eliminar_canal_whatsapp_oficial(request, canal_id: int):
    require_cobranza_access(request)
    require_whatsapp_automation_access(request)
    require_admin_access(request)
    canal = get_object_or_404(scoped_whatsapp_channel_queryset(request), id=canal_id)
    canal.delete()
    return {"success": True, "mensaje": "Numero oficial eliminado correctamente."}


@router.get("/configuracion/canales/")
def listar_canales_permitidos(request):
    require_cobranza_access(request)
    require_admin_access(request)
    config = get_or_create_main_config(request)
    queryset = (
        CanalPermitido.objects.select_related("entidad_relacionada", "cliente_relacionado")
        .filter(configuracion_relacionada=config)
        .order_by("nombre", "id")
    )
    return [serialize_canal(item) for item in queryset]


@router.get("/catalogos/")
def listar_catalogos_comunicaciones(request):
    require_cobranza_access(request)
    allowed_entity_ids = get_cached_allowed_entity_ids(request)
    entidades = list(
        EntidadNegocio.objects.filter(id__in=allowed_entity_ids)
        .order_by("nombre_comercial", "id")
        .values("id", "nombre_comercial")
    )
    clientes = list(
        Cliente.objects.filter(
            activo=True,
            entidad_relacionada_id__in=allowed_entity_ids,
        )
        .order_by("razon_social", "nombre_comercial", "id")
        .values("id", "razon_social", "nombre_comercial", "entidad_relacionada_id")
    )
    client_space_map: dict[int, str] = {}
    return {
        "entidades": [
            {"id": item["id"], "nombre": item["nombre_comercial"]}
            for item in entidades
        ],
        "clientes": [
            {
                "id": item["id"],
                "nombre": item["razon_social"] or item["nombre_comercial"] or f"Cliente {item['id']}",
                "entidad_id": item["entidad_relacionada_id"],
                "espacio_codigo": client_space_map.get(item["id"]),
            }
            for item in clientes
        ],
    }


@router.post("/configuracion/canales/")
def crear_canal_permitido(request, payload: CanalPermitidoIn):
    require_cobranza_access(request)
    require_whatsapp_channel_access(request, payload.canal)
    require_admin_access(request)
    config = get_or_create_main_config(request)
    canal = CanalPermitido.objects.create(
        configuracion_relacionada=config,
        canal=payload.canal,
        nombre=payload.nombre.strip(),
        identificador_externo=payload.identificador_externo.strip(),
        entidad_relacionada=get_scoped_entity_or_none(request, payload.entidad_id),
        cliente_relacionado=get_scoped_client_or_none(request, payload.cliente_id),
        tipo_movimiento_default=payload.tipo_movimiento_default,
        capturar_evidencias=payload.capturar_evidencias,
        descripcion=payload.descripcion.strip() or None,
        activo=payload.activo,
    )
    return {
        "id": canal.id,
        "mensaje": "Canal permitido creado correctamente.",
        "canal": serialize_canal(canal),
    }


@router.put("/configuracion/canales/{canal_id}/")
def actualizar_canal_permitido(request, canal_id: int, payload: CanalPermitidoIn):
    require_cobranza_access(request)
    require_whatsapp_channel_access(request, payload.canal)
    require_admin_access(request)
    canal = get_object_or_404(scoped_allowed_channel_queryset(request), id=canal_id)
    canal.canal = payload.canal
    canal.nombre = payload.nombre.strip()
    canal.identificador_externo = payload.identificador_externo.strip()
    canal.entidad_relacionada = get_scoped_entity_or_none(request, payload.entidad_id)
    canal.cliente_relacionado = get_scoped_client_or_none(request, payload.cliente_id)
    canal.tipo_movimiento_default = payload.tipo_movimiento_default
    canal.capturar_evidencias = payload.capturar_evidencias
    canal.descripcion = payload.descripcion.strip() or None
    canal.activo = payload.activo
    canal.save()
    return {
        "success": True,
        "mensaje": "Canal permitido actualizado correctamente.",
        "canal": serialize_canal(canal),
    }


@router.delete("/configuracion/canales/{canal_id}/")
def eliminar_canal_permitido(request, canal_id: int):
    require_cobranza_access(request)
    require_admin_access(request)
    canal = get_object_or_404(scoped_allowed_channel_queryset(request), id=canal_id)
    canal.delete()
    return {"success": True, "mensaje": "Canal permitido eliminado correctamente."}


@router.post("/configuracion/green-api/sync/")
def sincronizar_green_api(request):
    require_cobranza_access(request)
    require_whatsapp_automation_access(request)
    require_admin_access(request)
    config = get_or_create_main_config(request)
    try:
        result = sync_green_api_settings(config)
        return {
            "success": True,
            "mensaje": "Configuracion sincronizada con Green API correctamente.",
            "resultado": result,
        }
    except ValueError as exc:
        raise HttpError(400, str(exc))
    except Exception as exc:
        raise HttpError(500, f"No se pudo sincronizar Green API: {exc}")


@router.get("/casos/")
def listar_casos(
    request,
    entidad_id: Optional[int] = None,
    cliente_id: Optional[int] = None,
    estatus: Optional[str] = None,
    canal: Optional[str] = None,
    busqueda: str = "",
):
    require_cobranza_access(request)
    allowed_entity_ids = get_cached_allowed_entity_ids(request)
    if entidad_id and entidad_id not in allowed_entity_ids:
        raise HttpError(404, "La entidad solicitada no pertenece a tu capa activa.")
    queryset = (
        scoped_case_queryset(request)
        .select_related("entidad_relacionada", "cliente_relacionado")
        .annotate(
            mensajes_count=Count("mensajes", distinct=True),
            evidencias_count=Count("evidencias", distinct=True),
            eventos_count=Count("eventos_financieros", distinct=True),
        )
        .order_by("-fecha_ultimo_mensaje", "-id")
    )
    if entidad_id:
        queryset = queryset.filter(entidad_relacionada_id=entidad_id)
    if cliente_id:
        queryset = queryset.filter(cliente_relacionado_id=cliente_id)
    if estatus:
        queryset = queryset.filter(estatus=estatus)
    if canal:
        queryset = queryset.filter(canal=canal)
    if busqueda.strip():
        queryset = queryset.filter(
            Q(remitente__icontains=busqueda)
            | Q(remitente_nombre__icontains=busqueda)
            | Q(texto_consolidado__icontains=busqueda)
            | Q(caption_consolidado__icontains=busqueda)
            | Q(grupo_externo_id__icontains=busqueda)
            | Q(clave_externa__icontains=busqueda)
            | Q(cliente_relacionado__razon_social__icontains=busqueda)
            | Q(cliente_relacionado__nombre_comercial__icontains=busqueda)
            | Q(entidad_relacionada__nombre_comercial__icontains=busqueda)
        )

    return [serialize_caso(item) for item in queryset[:100]]


@router.get("/casos/{caso_id}/")
def obtener_caso(request, caso_id: int):
    require_cobranza_access(request)
    caso = get_object_or_404(
        scoped_case_queryset(request)
        .select_related("entidad_relacionada", "cliente_relacionado")
        .annotate(
            mensajes_count=Count("mensajes", distinct=True),
            evidencias_count=Count("evidencias", distinct=True),
            eventos_count=Count("eventos_financieros", distinct=True),
        )
        .prefetch_related(
            Prefetch(
                "mensajes",
                queryset=MensajeEntrante.objects.order_by("-fecha_mensaje", "-id"),
                to_attr="_prefetched_detail_messages",
            ),
            Prefetch(
                "evidencias",
                queryset=EvidenciaPago.objects.select_related(
                    "entidad_relacionada",
                    "cliente_relacionado",
                    "cliente_relacionado__entidad_relacionada",
                    "mensaje_relacionado",
                )
                .prefetch_related(
                    "pagos_cxc",
                    "pagos_cxp",
                    "eventos_financieros",
                    Prefetch(
                        "cliente_relacionado__cuentas_por_cobrar",
                        queryset=build_cxc_candidate_prefetch_queryset(),
                        to_attr="_prefetched_open_cxc_accounts",
                    ),
                )
                .order_by("-fecha_registro", "-id"),
                to_attr="_prefetched_detail_evidences",
            ),
            Prefetch(
                "eventos_financieros",
                queryset=EventoFinanciero.objects.order_by("-fecha_evento", "-id"),
                to_attr="_prefetched_detail_events",
            ),
        ),
        id=caso_id,
    )
    return serialize_caso_detail(caso)


@router.post("/casos/")
def crear_caso(request, payload: CasoProcesamientoIn):
    require_cobranza_access(request)
    require_write_access(request)
    try:
        caso = apply_case_payload(CasoProcesamiento(), payload, request=request)
        caso.save()
        caso.mensajes_count = 0
        caso.evidencias_count = 0
        caso.eventos_count = 0
        return {
            "id": caso.id,
            "mensaje": "Caso registrado correctamente.",
            "caso": {
                **serialize_caso(caso),
                "mensajes": [],
                "evidencias": [],
                "eventos": [],
            },
        }
    except Exception as exc:
        raise HttpError(500, f"No se pudo registrar el caso: {exc}")


@router.put("/casos/{caso_id}/")
def actualizar_caso(request, caso_id: int, payload: CasoProcesamientoIn):
    require_cobranza_access(request)
    require_write_access(request)
    caso = get_object_or_404(scoped_case_queryset(request), id=caso_id)
    try:
        apply_case_payload(caso, payload, request=request)
        caso.save()
        return {
            "success": True,
            "mensaje": "Caso actualizado correctamente.",
            "caso": serialize_caso_detail(caso),
        }
    except Exception as exc:
        raise HttpError(500, f"No se pudo actualizar el caso: {exc}")


@router.post("/casos/{caso_id}/estatus/")
def actualizar_estatus_caso(request, caso_id: int, payload: CasoEstatusIn):
    require_cobranza_access(request)
    require_write_access(request)
    caso = get_object_or_404(scoped_case_queryset(request), id=caso_id)
    caso.estatus = payload.estatus
    caso.save(update_fields=["estatus", "fecha_actualizacion"])
    return {
        "success": True,
        "mensaje": "Estatus del caso actualizado correctamente.",
        "caso": serialize_caso(caso),
    }


@router.get("/whatsapp-cloud/webhook/", auth=None)
def verificar_webhook_whatsapp_cloud(
    request,
    hub_mode: str = "",
    hub_verify_token: str = "",
    hub_challenge: str = "",
):
    mode = request.GET.get("hub.mode", hub_mode)
    verify_token = request.GET.get("hub.verify_token", hub_verify_token)
    challenge = request.GET.get("hub.challenge", hub_challenge)
    expected_token = (settings.WHATSAPP_WEBHOOK_VERIFY_TOKEN or "").strip()

    if mode == "subscribe" and expected_token and verify_token == expected_token:
        return HttpResponse(challenge or "", status=200, content_type="text/plain")
    return HttpResponse("forbidden", status=403, content_type="text/plain")


@router.post("/whatsapp-cloud/webhook/", auth=None)
def recibir_webhook_whatsapp_cloud(request):
    verify_meta_webhook_signature(request)
    try:
        payload = json.loads(request.body.decode("utf-8") or "{}")
    except Exception as exc:
        raise HttpError(400, f"Payload invalido para WhatsApp Cloud API: {exc}")

    status_updates = process_meta_status_updates(payload)
    created_ids: list[int] = []
    for entry in payload.get("entry") or []:
        for change in entry.get("changes") or []:
            value = change.get("value") or {}
            metadata = value.get("metadata") or {}
            phone_number_id = str(metadata.get("phone_number_id") or "").strip() or None
            display_phone_number = (
                str(metadata.get("display_phone_number") or "").strip() or None
            )
            sender = None
            messages = value.get("messages") or []
            if messages:
                sender = str((messages[0] or {}).get("from") or "").strip() or None
            origin_id = None
            if messages:
                origin_id = str((messages[0] or {}).get("id") or "").strip() or None
            defaults = {
                "tipo_webhook": str(change.get("field") or "messages"),
                "chat_id": phone_number_id or display_phone_number,
                "remitente": sender,
                "payload_completo": payload,
                "estatus_procesamiento": "PENDIENTE" if messages else "PROCESADO",
                "procesado": False if messages else True,
                "error_procesamiento": None,
            }
            if origin_id:
                webhook, _ = WebhookEntrante.objects.update_or_create(
                    proveedor=DEFAULT_WHATSAPP_PROVIDER,
                    origen_externo_id=origin_id,
                    defaults=defaults,
                )
            else:
                webhook = WebhookEntrante.objects.create(
                    proveedor=DEFAULT_WHATSAPP_PROVIDER,
                    origen_externo_id=None,
                    **defaults,
                )
            created_ids.append(webhook.id)
            if messages:
                if getattr(settings, "WHATSAPP_WEBHOOK_PROCESS_INLINE", True):
                    process_webhook_safe(webhook.id)
                else:
                    spawn_webhook_processing(webhook.id)

    return {
        "success": True,
        "accepted": True,
        "webhook_ids": created_ids,
        "status_updates": status_updates,
    }


@router.get("/whatsapp-cloud/media/{canal_id}/{media_id}/")
def obtener_media_whatsapp_cloud(request, canal_id: int, media_id: str):
    require_cobranza_access(request)
    require_whatsapp_automation_access(request)
    require_admin_access(request)
    canal = get_object_or_404(scoped_whatsapp_channel_queryset(request), id=canal_id)
    if not canal.access_token or not canal.phone_number_id:
        raise HttpError(400, "El canal oficial no tiene token activo para descargar medios.")

    meta_url = (
        f"{settings.WHATSAPP_CLOUD_API_BASE_URL.rstrip('/')}/"
        f"{settings.WHATSAPP_CLOUD_API_VERSION.strip('/')}/{media_id}"
    )
    headers = {"Authorization": f"Bearer {(canal.access_token or '').strip()}"}
    meta_response = requests.get(meta_url, headers=headers, timeout=20)
    if meta_response.status_code >= 400:
        raise HttpError(
            400,
            "No se pudo resolver el medio desde WhatsApp Cloud API.",
        )
    media_payload = meta_response.json()
    media_download_url = str(media_payload.get("url") or "").strip()
    if not media_download_url:
        raise HttpError(404, "El medio solicitado ya no esta disponible.")

    download_response = requests.get(media_download_url, headers=headers, timeout=30)
    if download_response.status_code >= 400:
        raise HttpError(400, "No se pudo descargar el medio desde Meta.")

    content_type = download_response.headers.get("Content-Type", "application/octet-stream")
    return HttpResponse(download_response.content, content_type=content_type)


@router.post("/webhooks/entrantes/", auth=None)
def registrar_webhook_entrante(request, payload: WebhookEntranteIn):
    raw_payload = payload.payload_completo or {}
    webhook_type = str(raw_payload.get("typeWebhook") or "").strip() or None
    origin_id = str(raw_payload.get("idMessage") or "").strip() or None
    sender_data = raw_payload.get("senderData") or {}
    defaults = {
        "tipo_webhook": webhook_type,
        "chat_id": str(sender_data.get("chatId") or "").strip() or None,
        "remitente": str(sender_data.get("sender") or "").strip() or None,
        "payload_completo": raw_payload,
        "estatus_procesamiento": "PENDIENTE",
        "procesado": False,
    }
    if origin_id:
        webhook, created = WebhookEntrante.objects.update_or_create(
            proveedor="GREEN_API",
            origen_externo_id=origin_id,
            defaults=defaults,
        )
    else:
        webhook = WebhookEntrante.objects.create(
            proveedor="GREEN_API",
            origen_externo_id=None,
            **defaults,
        )
        created = True
    return {
        "id": webhook.id,
        "created": created,
        "mensaje": "Webhook registrado correctamente.",
    }


@router.post("/green-api/webhook/", auth=None)
def recibir_webhook_green_api(request):
    try:
        payload = json.loads(request.body.decode("utf-8") or "{}")
    except Exception as exc:
        raise HttpError(400, f"Payload invalido para Green API: {exc}")

    webhook_type = str(payload.get("typeWebhook") or "").strip() or None
    origin_id = str(payload.get("idMessage") or "").strip() or None
    sender_data = payload.get("senderData") or {}
    chat_id = str(sender_data.get("chatId") or "").strip() or None
    sender = str(sender_data.get("sender") or "").strip() or None
    config = resolve_green_api_config(
        request=request,
        payload=payload,
        chat_id=chat_id,
        sender=sender,
    )
    validate_green_api_authorization(request, config)
    payload = {
        **payload,
        "_betterp_config_id": config.id,
        "_betterp_capa_id": config.capa_negocio_id,
    }
    defaults = {
        "tipo_webhook": webhook_type,
        "chat_id": chat_id,
        "remitente": sender,
        "payload_completo": payload,
        "estatus_procesamiento": "PENDIENTE",
        "procesado": False,
        "error_procesamiento": None,
    }
    if origin_id:
        webhook, created = WebhookEntrante.objects.update_or_create(
            proveedor="GREEN_API",
            origen_externo_id=origin_id,
            defaults=defaults,
        )
    else:
        webhook = WebhookEntrante.objects.create(
            proveedor="GREEN_API",
            payload_completo=payload,
            tipo_webhook=webhook_type,
            chat_id=defaults["chat_id"],
            remitente=defaults["remitente"],
            estatus_procesamiento="PENDIENTE",
            procesado=False,
        )
        created = True

    if config.procesar_webhooks_async:
        spawn_webhook_processing(webhook.id)

    return {
        "success": True,
        "accepted": True,
        "created": created,
        "webhook_id": webhook.id,
        "estatus_procesamiento": webhook.estatus_procesamiento,
    }


@router.get("/webhooks/entrantes/")
def listar_webhooks_entrantes(
    request,
    proveedor: Optional[str] = None,
    estatus: Optional[str] = None,
    limit: int = 50,
):
    require_cobranza_access(request)
    require_admin_access(request)
    queryset = scoped_webhook_queryset(request).order_by("-fecha_recepcion", "-id")
    if proveedor:
        queryset = queryset.filter(proveedor=proveedor)
    if estatus:
        queryset = queryset.filter(estatus_procesamiento=estatus)
    items = list(queryset[: max(1, min(limit, 100))])
    base_queryset = scoped_webhook_queryset(request)
    if proveedor:
        base_queryset = base_queryset.filter(proveedor=proveedor)
    return {
        "metricas": {
            "pendientes": base_queryset.filter(estatus_procesamiento="PENDIENTE").count(),
            "procesando": base_queryset.filter(estatus_procesamiento="PROCESANDO").count(),
            "procesados": base_queryset.filter(estatus_procesamiento="PROCESADO").count(),
            "ignorados": base_queryset.filter(estatus_procesamiento="IGNORADO").count(),
            "errores": base_queryset.filter(estatus_procesamiento="ERROR").count(),
        },
        "items": [serialize_webhook(item) for item in items],
    }


@router.post("/webhooks/entrantes/procesar-pendientes/")
def procesar_webhooks_pendientes(request, proveedor: Optional[str] = None):
    require_cobranza_access(request)
    require_whatsapp_automation_access(request)
    require_admin_access(request)
    queryset = scoped_webhook_queryset(request).filter(
        estatus_procesamiento__in=["PENDIENTE", "ERROR"],
    )
    if proveedor:
        queryset = queryset.filter(proveedor=proveedor)
    pending_ids = list(
        queryset.order_by("fecha_recepcion", "id").values_list("id", flat=True)[:25]
    )
    for webhook_id in pending_ids:
        spawn_webhook_processing(webhook_id)
    return {
        "success": True,
        "mensaje": "Procesamiento de pendientes disparado correctamente.",
        "total": len(pending_ids),
        "ids": pending_ids,
    }


@router.post("/webhooks/entrantes/{webhook_id}/reprocesar/")
def reprocesar_webhook_entrante(request, webhook_id: int):
    require_cobranza_access(request)
    require_whatsapp_automation_access(request)
    require_admin_access(request)
    webhook = get_object_or_404(scoped_webhook_queryset(request), id=webhook_id)
    webhook.estatus_procesamiento = "PENDIENTE"
    webhook.procesado = False
    webhook.error_procesamiento = None
    webhook.save(
        update_fields=["estatus_procesamiento", "procesado", "error_procesamiento"]
    )
    spawn_webhook_processing(webhook.id)
    return {
        "success": True,
        "mensaje": "Webhook enviado nuevamente a la cola de procesamiento.",
        "webhook": serialize_webhook(webhook),
    }


@router.post("/mensajes/")
def registrar_mensaje_entrante(request, payload: MensajeEntranteIn):
    require_cobranza_access(request)
    require_whatsapp_channel_access(request, payload.canal)
    require_write_access(request)
    webhook = (
        get_object_or_404(WebhookEntrante, id=payload.webhook_id)
        if payload.webhook_id
        else None
    )
    entidad = (
        get_scoped_entity_or_none(request, payload.entidad_id)
        if payload.entidad_id
        else None
    )
    cliente = (
        get_scoped_client_or_none(request, payload.cliente_id)
        if payload.cliente_id
        else None
    )
    fecha_mensaje = payload.fecha_mensaje or timezone.now()
    caso = resolve_case(
        caso_id=payload.caso_id,
        caso_clave_externa=payload.caso_clave_externa,
        grupo_externo_id=payload.grupo_externo_id,
        remitente=payload.remitente,
        remitente_nombre=payload.remitente_nombre,
        canal=payload.canal,
        entidad=entidad,
        cliente=cliente,
        create_if_missing=bool(
            payload.caso_id
            or (payload.caso_clave_externa or "").strip()
            or (payload.grupo_externo_id or "").strip()
        ),
        reference_datetime=fecha_mensaje,
        request=request,
    )

    defaults = {
        "webhook_relacionado": webhook,
        "caso_relacionado": caso,
        "entidad_relacionada": entidad,
        "cliente_relacionado": cliente,
        "chat_id": payload.grupo_externo_id.strip() or None,
        "canal": payload.canal,
        "tipo_mensaje": (payload.metadata or {}).get("type_message"),
        "remitente": payload.remitente.strip(),
        "remitente_nombre": payload.remitente_nombre.strip() or None,
        "fecha_mensaje": fecha_mensaje,
        "texto": payload.texto.strip() or None,
        "url_adjunto": payload.url_adjunto.strip() or None,
        "metadata": payload.metadata,
    }

    if payload.origen_externo_id:
        mensaje, created = MensajeEntrante.objects.update_or_create(
            origen_externo_id=payload.origen_externo_id.strip(),
            defaults=defaults,
        )
    else:
        mensaje = MensajeEntrante.objects.create(**defaults)
        created = True

    if webhook and not webhook.procesado:
        webhook.procesado = True
        webhook.save(update_fields=["procesado"])

    if caso:
        if mensaje.caso_relacionado_id != caso.id:
            mensaje.caso_relacionado = caso
            mensaje.save(update_fields=["caso_relacionado"])
        refresh_case_from_message(
            caso,
            entidad=entidad,
            cliente=cliente,
            texto=payload.texto,
            fecha_mensaje=fecha_mensaje,
            grupo_externo_id=payload.grupo_externo_id,
        )

    return {
        "id": mensaje.id,
        "caso_id": caso.id if caso else None,
        "created": created,
        "mensaje": "Mensaje entrante registrado correctamente.",
    }


@router.get("/evidencias/")
def listar_evidencias_pago(
    request,
    entidad_id: Optional[int] = None,
    cliente_id: Optional[int] = None,
    estatus: Optional[str] = None,
    canal: Optional[str] = None,
    caso_id: Optional[int] = None,
    vista: Optional[str] = None,
    origen: Optional[str] = None,
    busqueda: Optional[str] = None,
    fecha_desde: Optional[date] = None,
    fecha_hasta: Optional[date] = None,
    limit: int = 100,
):
    require_cobranza_access(request)
    allowed_entity_ids = get_cached_allowed_entity_ids(request)
    if entidad_id and entidad_id not in allowed_entity_ids:
        raise HttpError(404, "La entidad solicitada no pertenece a tu capa activa.")
    queryset = scoped_evidence_queryset(request).select_related(
        "entidad_relacionada",
        "cliente_relacionado",
        "mensaje_relacionado",
        "caso_relacionado",
    ).prefetch_related(
        "pagos_cxc",
        "pagos_cxp",
        "eventos_financieros",
    ).order_by("-fecha_registro", "-id")
    if entidad_id:
        queryset = queryset.filter(entidad_relacionada_id=entidad_id)
    if cliente_id:
        queryset = queryset.filter(cliente_relacionado_id=cliente_id)
    normalized_view = (vista or "").strip().upper()
    normalized_status = (estatus or "").strip().upper()
    if normalized_view == "PENDIENTES":
        queryset = queryset.filter(Q(requiere_revision_manual=True) | Q(estatus="NUEVA"))
    elif normalized_status:
        allowed_statuses = {choice[0] for choice in EvidenciaPago.ESTATUS_CHOICES}
        if normalized_status not in allowed_statuses:
            raise HttpError(400, "Estatus de comprobante no valido.")
        queryset = queryset.filter(estatus=normalized_status)
    if canal:
        queryset = queryset.filter(canal=canal)
    if caso_id:
        queryset = queryset.filter(caso_relacionado_id=caso_id)
    normalized_origin = (origen or "").strip().upper()
    if normalized_origin == "PORTAL":
        queryset = queryset.filter(
            Q(metadata__origen="PORTAL_CLIENTE")
            | Q(categoria_sugerida__iexact="Comprobante portal cliente")
        )
    elif normalized_origin == "WHATSAPP":
        queryset = queryset.filter(
            Q(canal="WHATSAPP")
            | Q(origen_deteccion__in=["GREEN_API", "META_CLOUD_API"])
        )
    elif normalized_origin == "MANUAL":
        queryset = queryset.filter(Q(canal="MANUAL") | Q(origen_deteccion="MANUAL"))
    search_term = (busqueda or "").strip()
    if search_term:
        queryset = queryset.filter(
            Q(cliente_relacionado__razon_social__icontains=search_term)
            | Q(cliente_relacionado__nombre_comercial__icontains=search_term)
            | Q(entidad_relacionada__nombre_comercial__icontains=search_term)
            | Q(referencia_reportada__icontains=search_term)
            | Q(texto_extraido__icontains=search_term)
            | Q(observaciones__icontains=search_term)
            | Q(url_archivo__icontains=search_term)
            | Q(hash_archivo__icontains=search_term)
        )
    if fecha_desde:
        queryset = queryset.filter(fecha_registro__date__gte=fecha_desde)
    if fecha_hasta:
        queryset = queryset.filter(fecha_registro__date__lte=fecha_hasta)
    safe_limit = min(max(limit or 100, 1), 200)

    return [serialize_evidencia(item) for item in queryset[:safe_limit]]


@router.post("/evidencias/archivo/")
def subir_archivo_evidencia_pago(request, file: UploadedFile = File(...)):
    require_cobranza_access(request)
    require_write_access(request)
    filename, extension, content_type = validate_evidence_upload(file)
    file_hash = hash_uploaded_file(file)
    existing_evidence = get_existing_evidence_by_hash(request, file_hash)
    if existing_evidence:
        return {
            "success": True,
            "mensaje": "Este archivo ya estaba registrado como comprobante.",
            "url": existing_evidence.url_archivo,
            "hash_archivo": file_hash,
            "nombre": filename,
            "content_type": content_type,
            "size": getattr(file, "size", 0) or 0,
            "texto_extraido": existing_evidence.texto_extraido or "",
            "evidencia_id": existing_evidence.id,
            "duplicado": True,
        }

    current_capa = get_current_capa(request)
    capa_id = current_capa.id if current_capa else "sin-capa"
    extracted_text = extract_pdf_text_from_upload(file) if extension == ".pdf" else ""
    storage_path = (
        f"comunicaciones/comprobantes/{capa_id}/"
        f"{timezone.now().strftime('%Y/%m')}/{uuid.uuid4().hex}_{filename}"
    )
    try:
        file.seek(0)
    except Exception:
        pass
    saved_path = default_storage.save(storage_path, file)
    return {
        "success": True,
        "mensaje": "Archivo cargado. Revisa los datos y registra el comprobante.",
        "url": build_public_storage_url(request, saved_path),
        "hash_archivo": file_hash,
        "nombre": filename,
        "content_type": content_type,
        "size": getattr(file, "size", 0) or 0,
        "texto_extraido": extracted_text,
        "evidencia_id": None,
        "duplicado": False,
    }


@router.post("/evidencias/")
def registrar_evidencia_pago(request, payload: EvidenciaPagoIn):
    require_cobranza_access(request)
    require_whatsapp_channel_access(request, payload.canal)
    require_write_access(request)
    mensaje = (
        get_object_or_404(
            scoped_message_queryset(request).select_related(
                "entidad_relacionada",
                "cliente_relacionado",
                "caso_relacionado",
            ),
            id=payload.mensaje_id,
        )
        if payload.mensaje_id
        else None
    )
    caso = None
    if mensaje and mensaje.caso_relacionado_id and (
        not payload.caso_id or payload.caso_id == mensaje.caso_relacionado_id
    ):
        caso = mensaje.caso_relacionado
    elif payload.caso_id:
        caso = resolve_case(caso_id=payload.caso_id, request=request)

    entidad, cliente = resolve_payload_relations(
        request,
        entidad_id=payload.entidad_id,
        cliente_id=payload.cliente_id,
        known_case=caso,
        known_message=mensaje,
    )
    evidencia_entidad = entidad or (mensaje.entidad_relacionada if mensaje else None)
    evidencia_cliente = cliente or (mensaje.cliente_relacionado if mensaje else None)
    if (
        payload.entidad_id
        and payload.cliente_id
        and evidencia_entidad
        and evidencia_cliente
        and evidencia_cliente.entidad_relacionada_id != evidencia_entidad.id
    ):
        raise HttpError(
            400,
            "El cliente seleccionado no pertenece a la unidad de negocio indicada.",
        )

    if not caso:
        caso = resolve_case(
            caso_clave_externa=payload.caso_clave_externa,
            grupo_externo_id=payload.grupo_externo_id,
            remitente=mensaje.remitente if mensaje else "",
            remitente_nombre=mensaje.remitente_nombre if mensaje else "",
            canal=payload.canal,
            entidad=evidencia_entidad,
            cliente=evidencia_cliente,
            create_if_missing=bool(
                payload.caso_id
                or (payload.caso_clave_externa or "").strip()
                or (payload.grupo_externo_id or "").strip()
            ),
            reference_datetime=timezone.now(),
            request=request,
        )

    hash_archivo = payload.hash_archivo.strip()
    if hash_archivo:
        evidencia_existente = get_existing_evidence_by_hash(request, hash_archivo)
        if evidencia_existente:
            if caso and evidencia_existente.caso_relacionado_id != caso.id:
                evidencia_existente.caso_relacionado = caso
                evidencia_existente.save(update_fields=["caso_relacionado"])
            return {
                "id": evidencia_existente.id,
                "created": False,
                "caso_id": evidencia_existente.caso_relacionado_id,
                "mensaje": "La evidencia ya existia y se reutilizo el registro.",
                "evidencia": serialize_evidencia(evidencia_existente),
            }

    evidencia = EvidenciaPago.objects.create(
        entidad_relacionada=evidencia_entidad,
        caso_relacionado=caso,
        cliente_relacionado=evidencia_cliente,
        mensaje_relacionado=mensaje,
        canal=payload.canal,
        tipo_movimiento=payload.tipo_movimiento,
        origen_deteccion=payload.origen_deteccion,
        url_archivo=payload.url_archivo.strip() or None,
        hash_archivo=hash_archivo or None,
        monto_reportado=payload.monto_reportado,
        fecha_pago_reportada=payload.fecha_pago_reportada,
        referencia_reportada=payload.referencia_reportada.strip() or None,
        texto_extraido=payload.texto_extraido.strip() or None,
        confianza_clasificacion=clamp_money(payload.confianza_clasificacion),
        requiere_revision_manual=payload.requiere_revision_manual,
        categoria_sugerida=payload.categoria_sugerida.strip() or None,
        metadata=payload.metadata,
        observaciones=payload.observaciones.strip() or None,
        estatus="NUEVA",
    )

    if mensaje:
        mensaje.procesado = True
        update_fields = ["procesado"]
        if caso and mensaje.caso_relacionado_id != caso.id:
            mensaje.caso_relacionado = caso
            update_fields.append("caso_relacionado")
        mensaje.save(update_fields=update_fields)
        if mensaje.webhook_relacionado_id:
            WebhookEntrante.objects.filter(
                id=mensaje.webhook_relacionado_id,
                procesado=False,
            ).update(procesado=True)

    if caso:
        refresh_case_from_evidence(
            caso,
            entidad=evidencia.entidad_relacionada,
            cliente=evidencia.cliente_relacionado,
            texto_extraido=evidencia.texto_extraido,
            reference_datetime=evidencia.fecha_registro,
        )

    return {
        "id": evidencia.id,
        "caso_id": caso.id if caso else None,
        "created": True,
        "mensaje": "Evidencia registrada correctamente.",
        "evidencia": serialize_evidencia(evidencia),
    }


@router.post("/evidencias/{evidencia_id}/clasificacion/")
def actualizar_clasificacion_evidencia(
    request,
    evidencia_id: int,
    payload: EvidenciaClasificacionIn,
):
    require_cobranza_access(request)
    require_write_access(request)
    evidencia = get_object_or_404(
        scoped_evidence_queryset(request).select_related(
            "caso_relacionado",
            "cliente_relacionado",
            "entidad_relacionada",
        ).prefetch_related(
            "pagos_cxc",
            "pagos_cxp",
            "eventos_financieros",
        ),
        id=evidencia_id,
    )
    evidencia.tipo_movimiento = payload.tipo_movimiento
    evidencia.entidad_relacionada = get_scoped_entity_or_none(request, payload.entidad_id)
    evidencia.cliente_relacionado = get_scoped_client_or_none(request, payload.cliente_id)
    evidencia.categoria_sugerida = payload.categoria_sugerida.strip() or None
    if payload.monto_reportado is not None:
        evidencia.monto_reportado = clamp_money(payload.monto_reportado)
    if payload.fecha_pago_reportada is not None:
        evidencia.fecha_pago_reportada = payload.fecha_pago_reportada
    if payload.referencia_reportada is not None:
        evidencia.referencia_reportada = payload.referencia_reportada.strip() or None
    evidencia.confianza_clasificacion = clamp_money(payload.confianza_clasificacion)
    evidencia.requiere_revision_manual = payload.requiere_revision_manual
    update_fields = [
        "tipo_movimiento",
        "entidad_relacionada",
        "cliente_relacionado",
        "categoria_sugerida",
        "monto_reportado",
        "fecha_pago_reportada",
        "referencia_reportada",
        "confianza_clasificacion",
        "requiere_revision_manual",
        "observaciones",
    ]
    if payload.estatus:
        normalized_status = payload.estatus.strip().upper()
        allowed_statuses = {choice[0] for choice in EvidenciaPago.ESTATUS_CHOICES}
        if normalized_status not in allowed_statuses:
            raise HttpError(400, "Estatus de comprobante no valido.")
        evidencia.estatus = normalized_status
        update_fields.append("estatus")
    evidencia.observaciones = append_text(
        evidencia.observaciones,
        payload.observaciones,
    )
    evidencia.save(update_fields=update_fields)

    event_result = None
    if payload.crear_evento:
        config = get_or_create_main_config(request)
        event_result = upsert_event_from_evidence(
            config=config,
            evidencia=evidencia,
            caso=evidencia.caso_relacionado,
            remitente_nombre=(
                evidencia.caso_relacionado.remitente_nombre
                if evidencia.caso_relacionado
                else None
            ),
            apply_override=payload.aplicar_evento,
        )

    return {
        "success": True,
        "mensaje": "Clasificacion de evidencia actualizada correctamente.",
        "evidencia": serialize_evidencia(evidencia),
        "evento": event_result,
    }


@router.post("/evidencias/{evidencia_id}/analisis-ia/")
def analizar_evidencia_pago(
    request,
    evidencia_id: int,
):
    require_cobranza_access(request)
    require_ai_copy_access(request)
    require_write_access(request)
    config = get_or_create_main_config(request)
    evidencia = get_object_or_404(
        scoped_evidence_queryset(request).select_related(
            "caso_relacionado",
            "cliente_relacionado",
            "cliente_relacionado__entidad_relacionada",
            "entidad_relacionada",
        ).prefetch_related(
            "pagos_cxc",
            "pagos_cxp",
            "eventos_financieros",
        ),
        id=evidencia_id,
    )
    if evidencia.estatus == "APLICADA":
        raise HttpError(400, "No se puede reanalizar un comprobante ya aplicado.")
    if not evidencia.url_archivo and not evidencia.texto_extraido and not evidencia.observaciones:
        raise HttpError(
            400,
            "El comprobante necesita archivo, texto extraido u observaciones para analizarse.",
        )

    google_vision_configured = bool(get_google_vision_api_key())
    openai_configured = bool(settings.OPENAI_API_KEY)
    analysis, google_vision_failure_reason = call_google_vision_receipt_analysis(
        config=config,
        evidencia=evidencia,
    )
    if analysis is None:
        analysis = call_openai_receipt_analysis(config=config, evidencia=evidencia)
    if analysis is None:
        fallback_reasons = []
        fallback_reasons.append(
            google_vision_failure_reason
            if google_vision_configured
            else "Google Vision OCR no esta configurado."
        )
        fallback_reasons.append(
            "No se pudo completar la lectura visual con OpenAI."
            if openai_configured
            else "OpenAI no esta configurado."
        )
        fallback_reasons.append("Se usaron reglas sin lectura visual.")
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
    return {
        "success": True,
        "mensaje": (
            "Lectura completada; requiere revision humana."
            if evidencia.requiere_revision_manual
            else "Lectura completada con confianza suficiente."
        ),
        "analisis": {
            key: value
            for key, value in analysis.items()
            if key not in {"raw"}
        },
        "evidencia": serialize_evidencia(evidencia),
    }


@router.post("/evidencias/{evidencia_id}/aplicar-cxc/")
@transaction.atomic
def aplicar_evidencia_a_cxc(
    request,
    evidencia_id: int,
    payload: EvidenciaAplicacionCxcIn,
):
    require_cobranza_access(request)
    require_write_access(request)
    allowed_entity_ids = get_cached_allowed_entity_ids(request)
    evidencia = get_object_or_404(
        scoped_evidence_queryset(request).select_related(
            "caso_relacionado",
            "cliente_relacionado",
            "cliente_relacionado__entidad_relacionada",
            "entidad_relacionada",
        ).prefetch_related(
            "pagos_cxc",
            "pagos_cxp",
            "eventos_financieros",
        ),
        id=evidencia_id,
    )
    if evidencia.estatus == "DESCARTADA":
        raise HttpError(400, "No se puede aplicar un comprobante descartado.")
    if evidencia.pagos_cxc.exclude(estatus_validacion="RECHAZADO").exists():
        raise HttpError(400, "Este comprobante ya tiene pagos CxC aplicados.")

    duplicate_state = build_evidence_duplicate_state(evidencia)
    if duplicate_state["posible"] and not payload.confirmar_duplicado:
        raise HttpError(
            409,
            "Este comprobante parece duplicado. Revisa los registros relacionados "
            "antes de aplicar o confirma la aplicacion manualmente.",
        )

    cuenta = get_object_or_404(
        CuentaPorCobrar.objects.select_related(
            "entidad_relacionada",
            "cliente_relacionado",
            "cliente_relacionado__entidad_relacionada",
        ).filter(
            Q(entidad_relacionada_id__in=allowed_entity_ids)
            | Q(
                entidad_relacionada__isnull=True,
                cliente_relacionado__entidad_relacionada_id__in=allowed_entity_ids,
            )
        ),
        id=payload.cuenta_id,
    )
    if cuenta.estatus_adeudo in {"CONCILIADO", "CANCELADO", "INCOBRABLE"}:
        raise HttpError(400, "La cuenta seleccionada no esta abierta para pago.")
    if evidencia.cliente_relacionado_id and (
        evidencia.cliente_relacionado_id != cuenta.cliente_relacionado_id
    ):
        raise HttpError(400, "La cuenta seleccionada pertenece a otro cliente.")

    entidad = cuenta.entidad_relacionada or cuenta.cliente_relacionado.entidad_relacionada
    if not entidad:
        raise HttpError(400, "La cuenta seleccionada no tiene entidad operativa.")

    monto = payload.monto if payload.monto is not None else evidencia.monto_reportado
    monto = clamp_money(monto)
    if monto <= 0:
        raise HttpError(400, "Define un monto mayor a cero para aplicar el comprobante.")
    saldo_cuenta_seleccionada = cuenta.saldo_pendiente

    fecha_pago = payload.fecha_pago or evidencia.fecha_pago_reportada or timezone.localdate()
    referencia = payload.referencia.strip() or evidencia.referencia_reportada or ""
    notas = payload.notas.strip() or "Pago aplicado desde bandeja de comprobantes."

    evidencia.entidad_relacionada = entidad
    evidencia.cliente_relacionado = cuenta.cliente_relacionado
    evidencia.monto_reportado = monto
    evidencia.fecha_pago_reportada = fecha_pago
    evidencia.referencia_reportada = referencia or None
    evidencia.requiere_revision_manual = False
    evidencia.categoria_sugerida = evidencia.categoria_sugerida or "COBRANZA"
    evidencia.observaciones = append_text(evidencia.observaciones, notas)
    metadata = evidencia.metadata or {}
    metadata["cuenta_id"] = cuenta.id
    metadata["aplicado_desde"] = "COBRANZA_COMPROBANTES"
    metadata["duplicado_confirmado"] = bool(payload.confirmar_duplicado)
    evidencia.metadata = metadata
    evidencia.save(
        update_fields=[
            "entidad_relacionada",
            "cliente_relacionado",
            "monto_reportado",
            "fecha_pago_reportada",
            "referencia_reportada",
            "requiere_revision_manual",
            "categoria_sugerida",
            "observaciones",
            "metadata",
        ]
    )

    result = register_payment_for_entity(
        entidad,
        monto=monto,
        fecha_pago=fecha_pago,
        metodo="TRANSFERENCIA",
        referencia=referencia,
        notas=notas,
        cliente_id=cuenta.cliente_relacionado_id,
        cuenta_id=cuenta.id,
        canal_origen="WHATSAPP" if evidencia.canal == "WHATSAPP" else "MANUAL",
        evidencia_id=evidencia.id,
        solo_cuenta_prioritaria=False,
        cuenta_prioritaria_obj=cuenta,
    )
    event = create_evidence_cxc_financial_event(
        evidencia=evidencia,
        cuenta=cuenta,
        payment_result=result,
        monto=monto,
        fecha_pago=fecha_pago,
        referencia=referencia,
        notas=notas,
    )
    evidencia.refresh_from_db()
    cuenta.refresh_from_db()
    aplicaciones = result.get("aplicaciones") or []
    saldo_a_favor = Decimal(str(result.get("saldo_a_favor") or "0"))
    if saldo_a_favor > 0:
        mensaje = "Comprobante aplicado y excedente guardado como saldo a favor."
    elif len(aplicaciones) > 1:
        mensaje = "Comprobante aplicado a varias CxC del cliente."
    elif monto < saldo_cuenta_seleccionada:
        mensaje = "Comprobante aplicado parcialmente a CxC."
    else:
        mensaje = "Comprobante aplicado a CxC; queda pendiente de conciliacion bancaria."
    return {
        "success": True,
        "mensaje": mensaje,
        "resultado": result,
        "evento_id": event.id if event else None,
        "cuenta": {
            "id": cuenta.id,
            "estatus_adeudo": cuenta.estatus_adeudo,
            "saldo_pendiente": decimal_to_float(cuenta.saldo_pendiente),
            "monto_pagado": decimal_to_float(cuenta.monto_pagado),
        },
        "evidencia": serialize_evidencia(evidencia),
    }
