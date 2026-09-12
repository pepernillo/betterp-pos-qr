from __future__ import annotations

import base64
import hashlib
import logging
import os
import re
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Optional

import requests
from cryptography.fernet import Fernet
from django.conf import settings
from django.core.files.storage import default_storage
from django.db import transaction
from django.utils import timezone
from ninja.errors import HttpError

from billing.models import SuscripcionCapa
from billing.services import (
    build_usage_statement,
    get_or_create_platform_billing_capa,
    registrar_consumo_saas,
)
from core.fiscal import (
    GENERIC_PUBLIC_CFDI_USE,
    GENERIC_PUBLIC_NAME,
    GENERIC_PUBLIC_REGIME,
    GENERIC_PUBLIC_RFC,
    is_generic_public_rfc,
    is_valid_fiscal_regime_code,
    normalize_fiscal_name,
    normalize_fiscal_regime_code,
)
from empresas.models import CapaNegocio
from finanzas.models import CuentaPorCobrar

from .models import CertificadoSelloDigital, FacturaEmitida, FacturaPartida

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class FacturamaEnvironment:
    base_url: str
    username: str
    password: str
    username_env: str
    password_env: str

    @property
    def credentials_ready(self) -> bool:
        return bool(self.username and self.password)


@dataclass(frozen=True)
class InvoiceParty:
    rfc: str
    razon_social: str
    regimen_fiscal: str
    codigo_postal: str
    uso_cfdi: str = "G03"


@dataclass(frozen=True)
class InvoiceLine:
    descripcion: str
    cantidad: Decimal
    precio_unitario: Decimal
    clave_producto_servicio: str
    clave_unidad: str
    unidad: str = "Servicio"
    objeto_impuesto: str = "01"
    impuestos: Decimal = Decimal("0")

    @property
    def subtotal(self) -> Decimal:
        return (self.cantidad * self.precio_unitario).quantize(Decimal("0.01"))

    @property
    def total(self) -> Decimal:
        return (self.subtotal + self.impuestos).quantize(Decimal("0.01"))


@dataclass(frozen=True)
class InvoiceGlobalInformation:
    periodicity: str
    months: str
    year: str


@dataclass(frozen=True)
class InvoiceDraft:
    issuer: InvoiceParty
    receiver: InvoiceParty
    lines: list[InvoiceLine]
    contexto: str
    idempotency_key: str
    proveedor: str
    modo: str
    serie: str
    folio: str
    payment_form: str
    payment_method: str
    expedition_place: str
    currency: str = "MXN"
    cfdi_type: str = "I"
    use_multiissuer: bool = False
    global_information: InvoiceGlobalInformation | None = None
    metadata: dict = field(default_factory=dict)

    @property
    def subtotal(self) -> Decimal:
        return sum((line.subtotal for line in self.lines), Decimal("0")).quantize(Decimal("0.01"))

    @property
    def impuestos(self) -> Decimal:
        return sum((line.impuestos for line in self.lines), Decimal("0")).quantize(Decimal("0.01"))

    @property
    def total(self) -> Decimal:
        return sum((line.total for line in self.lines), Decimal("0")).quantize(Decimal("0.01"))


@dataclass(frozen=True)
class BillingProviderResult:
    proveedor_factura_id: str = ""
    uuid: str = ""
    serie: str = ""
    folio: str = ""
    pdf_url: str = ""
    xml_url: str = ""
    raw_response: dict = field(default_factory=dict)


class BillingProviderError(Exception):
    pass


class InvoiceFileFormatError(ValueError):
    pass


def _flatten_provider_errors(value: object, prefix: str = "") -> list[str]:
    if value in (None, ""):
        return []
    if isinstance(value, dict):
        messages: list[str] = []
        for key, nested in value.items():
            nested_prefix = f"{prefix}.{key}" if prefix else str(key)
            messages.extend(_flatten_provider_errors(nested, nested_prefix))
        return messages
    if isinstance(value, (list, tuple, set)):
        messages = []
        for item in value:
            messages.extend(_flatten_provider_errors(item, prefix))
        return messages

    text = str(value).strip()
    if not text:
        return []
    return [f"{prefix}: {text}" if prefix else text]


def _format_facturama_error(body: object, status_code: int) -> str:
    if not isinstance(body, dict):
        return f"Facturama rechazo la solicitud ({status_code}): {body}"

    headline = (
        body.get("Message")
        or body.get("message")
        or body.get("Error")
        or body.get("error")
        or body.get("Detail")
        or body.get("detail")
    )
    detail_candidates = [
        body.get("ModelState"),
        body.get("modelState"),
        body.get("Errors"),
        body.get("errors"),
        body.get("Messages"),
        body.get("messages"),
    ]
    details: list[str] = []
    for candidate in detail_candidates:
        details.extend(_flatten_provider_errors(candidate))

    parts = [str(headline).strip()] if headline else []
    parts.extend(detail for detail in details if detail not in parts)
    message = "; ".join(part for part in parts if part)
    if not message:
        message = str(body)
    return f"Facturama rechazo la solicitud ({status_code}): {message}"


def _clean_url(value: str) -> str:
    return (value or "").strip().rstrip("/")


def _clean_text(value: object) -> str:
    return str(value or "").strip()


def _money(value: object) -> Decimal:
    if isinstance(value, Decimal):
        return value.quantize(Decimal("0.01"))
    return Decimal(str(value or "0")).quantize(Decimal("0.01"))


def _sat_match(value: object, pattern: str, default: str) -> str:
    text = _clean_text(value).upper()
    if not text:
        return default
    match = re.search(pattern, text)
    return match.group(1) if match else text[:20]


def _product_service_code(value: object, default: str) -> str:
    return _sat_match(value, r"\b(\d{6,10})\b", default)


def _unit_code(value: object, default: str) -> str:
    return _sat_match(value, r"\b([A-Z0-9]{2,5})\b", default)


def _cfdi_use_code(value: object, default: str) -> str:
    return _sat_match(value, r"\b([A-Z]\d{2})\b", default)


def _receiver_cfdi_use_code(value: object, receiver_regime: str) -> str:
    cfdi_use = _cfdi_use_code(value, "G03")
    if cfdi_use == "G03" and receiver_regime in {"605", "616"}:
        return GENERIC_PUBLIC_CFDI_USE
    return cfdi_use


def _payment_method_code(value: object, default: str) -> str:
    return _sat_match(value, r"\b(PUE|PPD)\b", default)


def _payment_form_code(value: object, default: str) -> str:
    return _sat_match(value, r"\b(\d{2})\b", default)


def _invoice_description(value: object) -> str:
    text = _clean_text(value).replace("|", " - ")
    text = re.sub(r"[\x00-\x1f\x7f]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return (text or "Servicio")[:1000]


def _secret_cipher() -> Fernet:
    raw_key = str(settings.FACTURACION_ENCRYPTION_KEY or settings.SECRET_KEY).encode("utf-8")
    digest = hashlib.sha256(raw_key).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_secret(value: str) -> str:
    if not value:
        return ""
    return _secret_cipher().encrypt(value.encode("utf-8")).decode("utf-8")


def decrypt_secret(value: str | None) -> str:
    if not value:
        return ""
    return _secret_cipher().decrypt(value.encode("utf-8")).decode("utf-8")


def get_facturama_environment(mode: str) -> FacturamaEnvironment:
    if mode == "PRODUCCION":
        return FacturamaEnvironment(
            base_url=_clean_url(settings.FACTURAMA_PRODUCTION_BASE_URL),
            username=settings.FACTURAMA_PRODUCTION_USERNAME,
            password=settings.FACTURAMA_PRODUCTION_PASSWORD,
            username_env="FACTURAMA_PRODUCTION_USERNAME",
            password_env="FACTURAMA_PRODUCTION_PASSWORD",
        )

    return FacturamaEnvironment(
        base_url=_clean_url(settings.FACTURAMA_SANDBOX_BASE_URL),
        username=settings.FACTURAMA_SANDBOX_USERNAME,
        password=settings.FACTURAMA_SANDBOX_PASSWORD,
        username_env="FACTURAMA_SANDBOX_USERNAME",
        password_env="FACTURAMA_SANDBOX_PASSWORD",
    )


def _is_blank(value: str | None) -> bool:
    return not (value or "").strip()


def _active_csd_for_capa(capa: CapaNegocio) -> CertificadoSelloDigital | None:
    if capa.facturacion_pac_proveedor != "FACTURAMA":
        return None
    return (
        CertificadoSelloDigital.objects.filter(
            capa_negocio=capa,
            proveedor="FACTURAMA",
            modo=capa.facturacion_modo,
            activo=True,
        )
        .order_by("-actualizado_en", "-id")
        .first()
    )


def build_facturama_status(capa: CapaNegocio) -> dict:
    mode = capa.facturacion_modo or "MANUAL"
    environment = get_facturama_environment(mode)
    csd = _active_csd_for_capa(capa)
    pendientes: list[str] = []

    if capa.facturacion_pac_proveedor != "FACTURAMA":
        pendientes.append("Selecciona Facturama como proveedor PAC.")
    if mode not in {"SANDBOX", "PRODUCCION"}:
        pendientes.append("Selecciona modo PAC sandbox o produccion.")
    if not capa.facturacion_activa:
        pendientes.append("Activa la facturacion en esta capa de negocio.")
    if not environment.base_url:
        pendientes.append("Configura la URL base de Facturama.")
    if not environment.username:
        pendientes.append(f"Configura {environment.username_env} en variables de entorno.")
    if not environment.password:
        pendientes.append(f"Configura {environment.password_env} en variables de entorno.")

    campos_negocio = {
        "razon_social": capa.razon_social,
        "rfc": capa.rfc,
        "regimen_fiscal": capa.regimen_fiscal,
        "codigo_postal_fiscal": capa.codigo_postal_fiscal,
        "facturacion_lugar_expedicion": capa.facturacion_lugar_expedicion,
    }
    for field, value in campos_negocio.items():
        if _is_blank(value):
            pendientes.append(f"Completa el campo fiscal {field}.")

    if capa.facturacion_pac_proveedor == "FACTURAMA" and mode in {"SANDBOX", "PRODUCCION"}:
        if not csd:
            pendientes.append("Carga el CSD de esta capa para emitir como multiemisor.")
        elif csd.estatus == "ERROR":
            pendientes.append("El CSD activo tiene error y debe cargarse nuevamente.")

    listo = len(pendientes) == 0

    return {
        "proveedor": capa.facturacion_pac_proveedor,
        "modo": mode,
        "entorno_url": environment.base_url,
        "credenciales_configuradas": environment.credentials_ready,
        "credenciales_env": {
            "username": environment.username_env,
            "password": environment.password_env,
        },
        "campos_negocio_listos": all(not _is_blank(value) for value in campos_negocio.values()),
        "csd": serialize_csd(csd) if csd else None,
        "listo_para_sandbox": listo and mode == "SANDBOX",
        "listo_para_produccion": listo and mode == "PRODUCCION",
        "listo_para_emitir": listo,
        "pendientes": pendientes,
        "recomendacion": (
            "Listo para construir y timbrar CFDI con el proveedor configurado."
            if listo
            else "Completa los pendientes antes de intentar timbrar."
        ),
    }


def serialize_csd(csd: CertificadoSelloDigital | None) -> dict | None:
    if csd is None:
        return None
    return {
        "id": csd.id,
        "proveedor": csd.proveedor,
        "modo": csd.modo,
        "rfc": csd.rfc,
        "numero_certificado": csd.numero_certificado,
        "estatus": csd.estatus,
        "activo": csd.activo,
        "ultimo_error": csd.ultimo_error,
        "actualizado_en": csd.actualizado_en.isoformat() if csd.actualizado_en else None,
    }


def serialize_invoice(invoice: FacturaEmitida) -> dict:
    return {
        "id": invoice.id,
        "contexto": invoice.contexto,
        "proveedor": invoice.proveedor,
        "modo": invoice.modo,
        "estatus": invoice.estatus,
        "serie": invoice.serie,
        "folio": invoice.folio,
        "uuid": invoice.uuid,
        "proveedor_factura_id": invoice.proveedor_factura_id,
        "receptor": {
            "rfc": invoice.receptor_rfc,
            "razon_social": invoice.receptor_razon_social,
            "regimen_fiscal": invoice.receptor_regimen_fiscal,
            "codigo_postal": invoice.receptor_codigo_postal,
            "uso_cfdi": invoice.receptor_uso_cfdi,
        },
        "subtotal": float(invoice.subtotal),
        "impuestos": float(invoice.impuestos),
        "total": float(invoice.total),
        "fecha_emision": invoice.fecha_emision.isoformat() if invoice.fecha_emision else None,
        "fecha_timbrado": invoice.fecha_timbrado.isoformat() if invoice.fecha_timbrado else None,
        "pdf_url": invoice.pdf_url,
        "xml_url": invoice.xml_url,
        "error_proveedor": invoice.error_proveedor,
        "partidas": [
            {
                "descripcion": item.descripcion,
                "cantidad": float(item.cantidad),
                "precio_unitario": float(item.precio_unitario),
                "subtotal": float(item.subtotal),
                "impuestos": float(item.impuestos),
                "total": float(item.total),
                "clave_producto_servicio": item.clave_producto_servicio,
                "clave_unidad": item.clave_unidad,
                "objeto_impuesto": item.objeto_impuesto,
            }
            for item in invoice.partidas.all()
        ],
    }


def cxc_invoice_idempotency_key(cuenta: CuentaPorCobrar) -> str:
    return f"CXC:{cuenta.id}"


CXC_INVOICE_CONTEXTS = {"CLIENTE_CXC", "PORTAL_CLIENTE"}


def find_existing_cxc_invoice(
    cuenta: CuentaPorCobrar,
    *,
    contexto: str | None = None,
) -> FacturaEmitida | None:
    queryset = (
        FacturaEmitida.objects.prefetch_related("partidas")
        .filter(cuenta_por_cobrar=cuenta)
        .exclude(estatus="CANCELADA")
    )
    if contexto:
        queryset = queryset.filter(contexto=contexto)
    else:
        queryset = queryset.filter(contexto__in=CXC_INVOICE_CONTEXTS)
    return queryset.order_by("-fecha_timbrado", "-fecha_emision", "-id").first()


def build_issuer_from_capa(capa: CapaNegocio) -> InvoiceParty:
    return InvoiceParty(
        rfc=_clean_text(capa.rfc).upper(),
        razon_social=normalize_fiscal_name(capa.razon_social),
        regimen_fiscal=normalize_fiscal_regime_code(capa.regimen_fiscal),
        codigo_postal=_clean_text(capa.codigo_postal_fiscal),
        uso_cfdi=_cfdi_use_code(capa.facturacion_uso_cfdi_default, "G03"),
    )


def build_receiver_from_capa(capa: CapaNegocio) -> InvoiceParty:
    return InvoiceParty(
        rfc=_clean_text(capa.rfc).upper(),
        razon_social=normalize_fiscal_name(capa.razon_social),
        regimen_fiscal=normalize_fiscal_regime_code(capa.regimen_fiscal),
        codigo_postal=_clean_text(capa.codigo_postal_fiscal),
        uso_cfdi=_cfdi_use_code(capa.facturacion_uso_cfdi_default, "G03"),
    )


def build_receiver_from_cliente(cuenta: CuentaPorCobrar) -> InvoiceParty:
    cliente = cuenta.cliente_relacionado
    capa = cuenta.entidad_relacionada.capa_negocio
    rfc = _clean_text(cliente.rfc).upper()
    receiver_regime = (
        ""
        if getattr(cliente, "regimen_fiscal_pendiente_seleccion", False)
        else normalize_fiscal_regime_code(cliente.regimen_fiscal)
    )
    if is_generic_public_rfc(rfc):
        return InvoiceParty(
            rfc=GENERIC_PUBLIC_RFC,
            razon_social=GENERIC_PUBLIC_NAME,
            regimen_fiscal=GENERIC_PUBLIC_REGIME,
            codigo_postal=_clean_text(capa.facturacion_lugar_expedicion or capa.codigo_postal_fiscal),
            uso_cfdi=GENERIC_PUBLIC_CFDI_USE,
        )
    return InvoiceParty(
        rfc=rfc,
        razon_social=normalize_fiscal_name(cliente.razon_social or cliente.nombre_comercial),
        regimen_fiscal=receiver_regime,
        codigo_postal=_clean_text(cliente.codigo_postal),
        uso_cfdi=_receiver_cfdi_use_code(capa.facturacion_uso_cfdi_default, receiver_regime),
    )


def validate_party(party: InvoiceParty, *, role: str) -> list[str]:
    missing = []
    if not party.rfc:
        missing.append(f"RFC {role}")
    if not party.razon_social:
        missing.append(f"razon social {role}")
    if not party.regimen_fiscal:
        missing.append(f"regimen fiscal {role}")
    elif not is_valid_fiscal_regime_code(party.regimen_fiscal):
        missing.append(f"regimen fiscal {role} debe ser codigo SAT de 3 digitos")
    if not party.codigo_postal:
        missing.append(f"codigo postal {role}")
    return missing


def ensure_capa_ready(capa: CapaNegocio, *, require_csd: bool) -> None:
    status = build_facturama_status(capa)
    pendientes = list(status.get("pendientes") or [])
    if not require_csd:
        pendientes = [item for item in pendientes if "CSD" not in item]
    if pendientes:
        raise HttpError(400, "No se puede facturar: " + " ".join(pendientes[:4]))


def build_global_information_for_cxc(cuenta: CuentaPorCobrar) -> InvoiceGlobalInformation:
    reference_date = (
        cuenta.fecha_periodo_inicio
        or cuenta.fecha_periodo_fin
        or cuenta.fecha_vencimiento
        or timezone.localdate()
    )
    return InvoiceGlobalInformation(
        periodicity="04",
        months=f"{reference_date.month:02d}",
        year=str(reference_date.year),
    )


def build_cxc_invoice_draft(cuenta: CuentaPorCobrar, *, contexto: str = "CLIENTE_CXC") -> InvoiceDraft:
    if not cuenta.entidad_relacionada:
        raise HttpError(400, "La CxC no tiene entidad emisora.")
    capa = cuenta.entidad_relacionada.capa_negocio
    ensure_capa_ready(capa, require_csd=True)
    if cuenta.saldo_pendiente > 0 and cuenta.estatus_adeudo not in {"CONCILIADO", "POR_CONCILIAR"}:
        raise HttpError(400, "Solo se recomienda facturar CxC pagadas, conciliadas o por conciliar.")
    if getattr(cuenta.cliente_relacionado, "regimen_fiscal_pendiente_seleccion", False):
        raise HttpError(
            400,
            "Falta confirmar el regimen fiscal detectado en la CSF antes de timbrar.",
        )

    issuer = build_issuer_from_capa(capa)
    receiver = build_receiver_from_cliente(cuenta)
    missing = validate_party(issuer, role="emisor") + validate_party(receiver, role="receptor")
    if missing:
        raise HttpError(400, "Faltan datos fiscales: " + ", ".join(missing))

    line = InvoiceLine(
        descripcion=(
            f"{cuenta.concepto} "
            f"{cuenta.fecha_periodo_inicio or cuenta.fecha_vencimiento} "
            f"al {cuenta.fecha_periodo_fin or cuenta.fecha_vencimiento}"
        ),
        cantidad=Decimal("1"),
        precio_unitario=_money(cuenta.monto_total),
        clave_producto_servicio=_product_service_code(capa.facturacion_producto_servicio, "80131500"),
        clave_unidad=_unit_code(capa.facturacion_unidad, "E48"),
    )
    return InvoiceDraft(
        issuer=issuer,
        receiver=receiver,
        lines=[line],
        contexto=contexto,
        idempotency_key=cxc_invoice_idempotency_key(cuenta),
        proveedor=capa.facturacion_pac_proveedor,
        modo=capa.facturacion_modo,
        serie=capa.facturacion_serie_ingresos or "A",
        folio=f"CXC-{cuenta.id}",
        payment_form=_payment_form_code(capa.facturacion_forma_pago_default, "03"),
        payment_method=_payment_method_code(capa.facturacion_metodo_pago_default, "PUE"),
        expedition_place=capa.facturacion_lugar_expedicion or capa.codigo_postal_fiscal,
        use_multiissuer=True,
        global_information=(
            build_global_information_for_cxc(cuenta)
            if is_generic_public_rfc(receiver.rfc)
            else None
        ),
        metadata={"cuenta_por_cobrar_id": cuenta.id},
    )


def resolve_platform_billing_capa(request_capa: CapaNegocio | None = None) -> CapaNegocio:
    return get_or_create_platform_billing_capa()


def build_saas_invoice_draft(
    subscription: SuscripcionCapa,
    *,
    issuer_capa: CapaNegocio,
    periodo: str | None = None,
) -> InvoiceDraft:
    ensure_capa_ready(issuer_capa, require_csd=False)
    receiver = build_receiver_from_capa(subscription.capa_negocio)
    issuer = build_issuer_from_capa(issuer_capa)
    missing = validate_party(issuer, role="emisor") + validate_party(receiver, role="receptor")
    if missing:
        raise HttpError(400, "Faltan datos fiscales: " + ", ".join(missing))

    price = subscription.plan.precio_anual if subscription.periodicidad == "ANUAL" else subscription.plan.precio_mensual
    lines = [
        InvoiceLine(
            descripcion=f"Suscripcion BettERP {subscription.plan.nombre} {subscription.periodicidad.lower()}",
            cantidad=Decimal("1"),
            precio_unitario=_money(price),
            clave_producto_servicio=_product_service_code(
                issuer_capa.facturacion_producto_servicio,
                "81112100",
            ),
            clave_unidad=_unit_code(issuer_capa.facturacion_unidad, "E48"),
        )
    ]
    statement = build_usage_statement(subscription.capa_negocio, periodo)
    extras = _money(statement.get("total_extras", 0))
    if extras > 0:
        lines.append(
            InvoiceLine(
                descripcion=f"Extras de consumo BettERP {statement['periodo']}",
                cantidad=Decimal("1"),
                precio_unitario=extras,
                clave_producto_servicio=_product_service_code(
                    issuer_capa.facturacion_producto_servicio,
                    "81112100",
                ),
                clave_unidad=_unit_code(issuer_capa.facturacion_unidad, "E48"),
            )
        )
    return InvoiceDraft(
        issuer=issuer,
        receiver=receiver,
        lines=lines,
        contexto="BACKOFFICE_SAAS",
        idempotency_key=f"SAAS:{subscription.id}:{statement['periodo']}:{subscription.periodicidad}",
        proveedor=issuer_capa.facturacion_pac_proveedor,
        modo=issuer_capa.facturacion_modo,
        serie=issuer_capa.facturacion_serie_ingresos or "B",
        folio=f"SaaS-{subscription.id}-{statement['periodo']}",
        payment_form=_payment_form_code(issuer_capa.facturacion_forma_pago_default, "03"),
        payment_method=_payment_method_code(issuer_capa.facturacion_metodo_pago_default, "PUE"),
        expedition_place=issuer_capa.facturacion_lugar_expedicion or issuer_capa.codigo_postal_fiscal,
        use_multiissuer=False,
        metadata={"suscripcion_id": subscription.id, "periodo": statement["periodo"]},
    )


def serialize_draft(draft: InvoiceDraft) -> dict:
    return {
        "contexto": draft.contexto,
        "proveedor": draft.proveedor,
        "modo": draft.modo,
        "serie": draft.serie,
        "folio": draft.folio,
        "idempotency_key": draft.idempotency_key,
        "emisor": draft.issuer.__dict__,
        "receptor": draft.receiver.__dict__,
        "subtotal": float(draft.subtotal),
        "impuestos": float(draft.impuestos),
        "total": float(draft.total),
        "global_information": (
            {
                "periodicity": draft.global_information.periodicity,
                "months": draft.global_information.months,
                "year": draft.global_information.year,
            }
            if draft.global_information
            else None
        ),
        "partidas": [
            {
                "descripcion": line.descripcion,
                "cantidad": float(line.cantidad),
                "precio_unitario": float(line.precio_unitario),
                "subtotal": float(line.subtotal),
                "impuestos": float(line.impuestos),
                "total": float(line.total),
                "clave_producto_servicio": line.clave_producto_servicio,
                "clave_unidad": line.clave_unidad,
                "objeto_impuesto": line.objeto_impuesto,
            }
            for line in draft.lines
        ],
        "metadata": draft.metadata,
    }


class FacturamaProvider:
    provider_key = "FACTURAMA"

    def __init__(self, mode: str):
        self.environment = get_facturama_environment(mode)
        self.mode = mode

    def _request(self, method: str, path: str, **kwargs) -> dict:
        if not self.environment.credentials_ready:
            raise BillingProviderError("Las credenciales de Facturama no estan configuradas.")
        url = f"{self.environment.base_url}{path}"
        try:
            response = requests.request(
                method,
                url,
                auth=(self.environment.username, self.environment.password),
                timeout=settings.FACTURAMA_TIMEOUT_SECONDS,
                **kwargs,
            )
        except requests.RequestException as exc:
            raise BillingProviderError(f"No se pudo contactar Facturama: {exc}") from exc

        try:
            body = response.json()
        except ValueError:
            body = {"raw": response.text}
        if response.status_code >= 400:
            raise BillingProviderError(_format_facturama_error(body, response.status_code))
        return body

    def upload_csd(self, *, rfc: str, cer_bytes: bytes, key_bytes: bytes, password: str) -> dict:
        payload = {
            "Rfc": rfc,
            "Certificate": base64.b64encode(cer_bytes).decode("ascii"),
            "PrivateKey": base64.b64encode(key_bytes).decode("ascii"),
            "PrivateKeyPassword": password,
        }
        try:
            return self._request("POST", "/api-lite/csds", json=payload)
        except BillingProviderError as exc:
            detail = str(exc).lower()
            if "exist" not in detail and "registr" not in detail:
                raise
            return self._request("PUT", f"/api-lite/csds/{rfc}", json=payload)

    def build_payload(self, draft: InvoiceDraft) -> dict:
        payload = {
            "CfdiType": draft.cfdi_type,
            "NameId": "1",
            "Folio": draft.folio,
            "Serie": draft.serie,
            "Currency": draft.currency,
            "ExpeditionPlace": draft.expedition_place,
            "PaymentForm": draft.payment_form,
            "PaymentMethod": draft.payment_method,
            "Exportation": "01",
            "Receiver": {
                "Rfc": draft.receiver.rfc,
                "Name": draft.receiver.razon_social,
                "CfdiUse": draft.receiver.uso_cfdi,
                "FiscalRegime": draft.receiver.regimen_fiscal,
                "TaxZipCode": draft.receiver.codigo_postal,
            },
            "Items": [
                {
                    "ProductCode": line.clave_producto_servicio,
                    "Description": _invoice_description(line.descripcion),
                    "UnitCode": line.clave_unidad,
                    "Unit": line.unidad,
                    "Quantity": float(line.cantidad),
                    "UnitPrice": float(line.precio_unitario),
                    "Subtotal": float(line.subtotal),
                    "TaxObject": line.objeto_impuesto,
                    "Total": float(line.total),
                }
                for line in draft.lines
            ],
        }
        if draft.use_multiissuer:
            payload["Issuer"] = {
                "Rfc": draft.issuer.rfc,
                "Name": draft.issuer.razon_social,
                "FiscalRegime": draft.issuer.regimen_fiscal,
            }
        if draft.global_information:
            payload["GlobalInformation"] = {
                "Periodicity": draft.global_information.periodicity,
                "Months": draft.global_information.months,
                "Year": draft.global_information.year,
            }
        return payload

    def emit_invoice(self, draft: InvoiceDraft) -> BillingProviderResult:
        path = "/api-lite/3/cfdis" if draft.use_multiissuer else "/3/cfdis"
        payload = self.build_payload(draft)
        body = self._request("POST", path, json=payload)
        tax_stamp = (
            body.get("Complement", {}).get("TaxStamp", {})
            if isinstance(body.get("Complement"), dict)
            else {}
        )
        return BillingProviderResult(
            proveedor_factura_id=str(body.get("Id") or body.get("id") or ""),
            uuid=str(tax_stamp.get("Uuid") or body.get("Uuid") or body.get("FolioFiscal") or ""),
            serie=str(body.get("Serie") or draft.serie or ""),
            folio=str(body.get("Folio") or draft.folio or ""),
            pdf_url=str(body.get("Pdf") or body.get("PdfUrl") or ""),
            xml_url=str(body.get("Xml") or body.get("XmlUrl") or ""),
            raw_response=body,
        )

    def download_invoice_file(
        self,
        *,
        invoice_id: str,
        file_format: str,
        use_multiissuer: bool,
    ) -> tuple[bytes, str]:
        normalized_format = file_format.lower().strip()
        if normalized_format not in {"pdf", "xml"}:
            raise InvoiceFileFormatError("Formato de factura no soportado.")

        invoice_type = "issuedLite" if use_multiissuer else "issued"
        body = self._request(
            "GET",
            f"/Cfdi/{normalized_format}/{invoice_type}/{invoice_id}",
        )
        encoded = (
            body.get("Content")
            or body.get("content")
            or body.get("Base64")
            or body.get("base64")
            or body.get("File")
            or body.get("file")
        )
        if not encoded:
            raise BillingProviderError("Facturama no devolvio el archivo solicitado.")
        if isinstance(encoded, str) and "," in encoded and "base64" in encoded[:80].lower():
            encoded = encoded.split(",", 1)[1]
        try:
            content = base64.b64decode(str(encoded), validate=False)
        except Exception as exc:
            raise BillingProviderError("No se pudo decodificar el archivo de Facturama.") from exc

        content_type = "application/pdf" if normalized_format == "pdf" else "application/xml"
        return content, content_type


def get_provider(proveedor: str, modo: str) -> FacturamaProvider:
    if proveedor != "FACTURAMA":
        raise HttpError(400, f"El proveedor {proveedor} aun no tiene adaptador activo.")
    return FacturamaProvider(modo)


def invoice_uses_multiissuer(invoice: FacturaEmitida) -> bool:
    return invoice.contexto in CXC_INVOICE_CONTEXTS


def download_invoice_file(invoice: FacturaEmitida, file_format: str) -> tuple[bytes, str, str]:
    normalized_format = file_format.lower().strip()
    if normalized_format not in {"pdf", "xml"}:
        raise HttpError(400, "Formato de factura no soportado.")
    if not invoice.proveedor_factura_id:
        raise HttpError(400, "La factura no tiene identificador del proveedor para descargar.")

    try:
        content, content_type = get_provider(invoice.proveedor, invoice.modo).download_invoice_file(
            invoice_id=invoice.proveedor_factura_id,
            file_format=normalized_format,
            use_multiissuer=invoice_uses_multiissuer(invoice),
        )
    except InvoiceFileFormatError as exc:
        raise HttpError(400, str(exc)) from exc
    except BillingProviderError as exc:
        raise HttpError(502, str(exc)) from exc

    folio = f"{invoice.serie or ''}{invoice.folio or invoice.id}".strip()
    safe_folio = re.sub(r"[^A-Za-z0-9_-]+", "-", folio).strip("-") or f"factura-{invoice.id}"
    return content, content_type, f"{safe_folio}.{normalized_format}"


def save_uploaded_csd(
    *,
    capa: CapaNegocio,
    proveedor: str,
    modo: str,
    cer_file,
    key_file,
    password: str,
) -> CertificadoSelloDigital:
    cer_file.seek(0)
    key_file.seek(0)
    cer_bytes = cer_file.read()
    key_bytes = key_file.read()
    provider_response = {}
    status = "PENDIENTE"
    error = ""
    if proveedor == "FACTURAMA":
        try:
            provider_response = get_provider(proveedor, modo).upload_csd(
                rfc=_clean_text(capa.rfc).upper(),
                cer_bytes=cer_bytes,
                key_bytes=key_bytes,
                password=password,
            )
            status = "VALIDADO"
        except Exception as exc:
            status = "ERROR"
            error = str(exc)

    cer_file.seek(0)
    key_file.seek(0)
    base_path = f"facturacion/csd/{capa.id}/{modo.lower()}"
    cer_name = None
    key_name = None
    try:
        cer_name = default_storage.save(
            os.path.join(base_path, os.path.basename(getattr(cer_file, "name", "certificado.cer"))),
            cer_file,
        )
        key_name = default_storage.save(
            os.path.join(base_path, os.path.basename(getattr(key_file, "name", "llave.key"))),
            key_file,
        )
    except Exception:
        logger.exception("No se pudo almacenar el archivo CSD de la capa %s.", capa.id)
    activate_new_certificate = status == "VALIDADO"
    if activate_new_certificate:
        CertificadoSelloDigital.objects.filter(
            capa_negocio=capa,
            proveedor=proveedor,
            modo=modo,
            activo=True,
        ).update(activo=False, estatus="INACTIVO")
    return CertificadoSelloDigital.objects.create(
        capa_negocio=capa,
        proveedor=proveedor,
        modo=modo,
        rfc=_clean_text(capa.rfc).upper(),
        certificado_url=cer_name,
        llave_url=key_name,
        llave_password_encrypted=encrypt_secret(password),
        estatus=status,
        ultimo_error=error or None,
        metadata={"facturama": provider_response} if provider_response else {},
        activo=activate_new_certificate,
    )


@transaction.atomic
def persist_invoice_from_draft(
    *,
    draft: InvoiceDraft,
    capa: CapaNegocio,
    cuenta: CuentaPorCobrar | None = None,
    subscription: SuscripcionCapa | None = None,
) -> FacturaEmitida:
    existing_invoice = (
        find_existing_cxc_invoice(cuenta)
        if cuenta and draft.contexto in {"CLIENTE_CXC", "PORTAL_CLIENTE"}
        else None
    )
    if existing_invoice:
        if existing_invoice.estatus in {"BORRADOR", "ERROR"}:
            existing_invoice.capa_emisora = capa
            existing_invoice.cliente_receptor = cuenta.cliente_relacionado
            existing_invoice.proveedor = draft.proveedor
            existing_invoice.modo = draft.modo
            existing_invoice.contexto = draft.contexto
            existing_invoice.serie = draft.serie
            existing_invoice.folio = draft.folio
            existing_invoice.tipo_comprobante = draft.cfdi_type
            existing_invoice.moneda = draft.currency
            existing_invoice.emisor_rfc = draft.issuer.rfc
            existing_invoice.emisor_razon_social = draft.issuer.razon_social
            existing_invoice.emisor_regimen_fiscal = draft.issuer.regimen_fiscal
            existing_invoice.receptor_rfc = draft.receiver.rfc
            existing_invoice.receptor_razon_social = draft.receiver.razon_social
            existing_invoice.receptor_regimen_fiscal = draft.receiver.regimen_fiscal
            existing_invoice.receptor_codigo_postal = draft.receiver.codigo_postal
            existing_invoice.receptor_uso_cfdi = draft.receiver.uso_cfdi
            existing_invoice.subtotal = draft.subtotal
            existing_invoice.impuestos = draft.impuestos
            existing_invoice.total = draft.total
            existing_invoice.payload_proveedor = get_provider(draft.proveedor, draft.modo).build_payload(draft)
            existing_invoice.metadata = draft.metadata
            existing_invoice.error_proveedor = ""
            existing_invoice.save()
            existing_invoice.partidas.all().delete()
            for line in draft.lines:
                FacturaPartida.objects.create(
                    factura=existing_invoice,
                    descripcion=line.descripcion,
                    clave_producto_servicio=line.clave_producto_servicio,
                    clave_unidad=line.clave_unidad,
                    cantidad=line.cantidad,
                    precio_unitario=line.precio_unitario,
                    subtotal=line.subtotal,
                    impuestos=line.impuestos,
                    total=line.total,
                    objeto_impuesto=line.objeto_impuesto,
                )
        return existing_invoice

    invoice, created = FacturaEmitida.objects.get_or_create(
        idempotency_key=draft.idempotency_key,
        defaults={
            "capa_emisora": capa,
            "cliente_receptor": cuenta.cliente_relacionado if cuenta else None,
            "cuenta_por_cobrar": cuenta,
            "suscripcion_saas": subscription,
            "contexto": draft.contexto,
            "proveedor": draft.proveedor,
            "modo": draft.modo,
            "estatus": "BORRADOR",
            "serie": draft.serie,
            "folio": draft.folio,
            "tipo_comprobante": draft.cfdi_type,
            "moneda": draft.currency,
            "emisor_rfc": draft.issuer.rfc,
            "emisor_razon_social": draft.issuer.razon_social,
            "emisor_regimen_fiscal": draft.issuer.regimen_fiscal,
            "receptor_rfc": draft.receiver.rfc,
            "receptor_razon_social": draft.receiver.razon_social,
            "receptor_regimen_fiscal": draft.receiver.regimen_fiscal,
            "receptor_codigo_postal": draft.receiver.codigo_postal,
            "receptor_uso_cfdi": draft.receiver.uso_cfdi,
            "subtotal": draft.subtotal,
            "impuestos": draft.impuestos,
            "total": draft.total,
            "payload_proveedor": get_provider(draft.proveedor, draft.modo).build_payload(draft),
            "metadata": draft.metadata,
        },
    )
    if created:
        for line in draft.lines:
            FacturaPartida.objects.create(
                factura=invoice,
                descripcion=line.descripcion,
                clave_producto_servicio=line.clave_producto_servicio,
                clave_unidad=line.clave_unidad,
                cantidad=line.cantidad,
                precio_unitario=line.precio_unitario,
                subtotal=line.subtotal,
                impuestos=line.impuestos,
                total=line.total,
                objeto_impuesto=line.objeto_impuesto,
            )
    return invoice


def emit_invoice(
    *,
    draft: InvoiceDraft,
    capa: CapaNegocio,
    cuenta: CuentaPorCobrar | None = None,
    subscription: SuscripcionCapa | None = None,
) -> FacturaEmitida:
    invoice = persist_invoice_from_draft(
        draft=draft,
        capa=capa,
        cuenta=cuenta,
        subscription=subscription,
    )
    if invoice.estatus == "TIMBRADA":
        return invoice
    try:
        result = get_provider(draft.proveedor, draft.modo).emit_invoice(draft)
    except BillingProviderError as exc:
        invoice.estatus = "ERROR"
        invoice.error_proveedor = str(exc)
        invoice.save(update_fields=["estatus", "error_proveedor", "actualizado_en"])
        raise HttpError(502, str(exc)) from exc
    except Exception as exc:
        logger.exception("Error inesperado al emitir la factura %s.", invoice.id)
        invoice.estatus = "ERROR"
        invoice.error_proveedor = f"Error interno al timbrar: {exc}"
        invoice.save(update_fields=["estatus", "error_proveedor", "actualizado_en"])
        raise HttpError(500, "Error interno al timbrar la factura. Revisa el log del backend.") from exc

    invoice.estatus = "TIMBRADA"
    invoice.proveedor_factura_id = result.proveedor_factura_id
    invoice.uuid = result.uuid
    invoice.serie = result.serie or invoice.serie
    invoice.folio = result.folio or invoice.folio
    invoice.pdf_url = result.pdf_url or invoice.pdf_url
    invoice.xml_url = result.xml_url or invoice.xml_url
    invoice.respuesta_proveedor = result.raw_response
    invoice.fecha_timbrado = timezone.now()
    invoice.error_proveedor = ""
    invoice.save()

    if draft.contexto in {"CLIENTE_CXC", "PORTAL_CLIENTE"}:
        try:
            registrar_consumo_saas(
                capa=capa,
                categoria="FACTURA_TIMBRE",
                cantidad=1,
                descripcion=f"Timbre CFDI {invoice.uuid or invoice.id}",
                referencia_unica=f"FACTURA:{invoice.id}",
                origen_modelo="facturacion.FacturaEmitida",
                origen_id=invoice.id,
                metadata={"proveedor": invoice.proveedor, "modo": invoice.modo},
            )
        except Exception:
            logger.exception(
                "No se pudo registrar el consumo del timbre para la factura %s.",
                invoice.id,
            )
    return invoice
