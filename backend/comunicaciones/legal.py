from __future__ import annotations

import hashlib

from django.conf import settings
from django.utils import timezone
from ninja.errors import HttpError

from accounts.audit import audit
from accounts.security import (
    get_auth_context,
    get_current_capa,
    get_request_ip,
    get_request_user_agent,
)
from empresas.models import CapaNegocio

from .models import AcuerdoUsoComunicacion

WHATSAPP_SHARED_NUMBER_AGREEMENT_TYPE = "WHATSAPP_SHARED_NUMBER_TERMS"
WHATSAPP_SHARED_NUMBER_AGREEMENT_VERSION = "2026-06-17"
WHATSAPP_SHARED_NUMBER_AGREEMENT_TITLE = (
    "Acuerdo de uso de comunicaciones y cobranza por WhatsApp"
)
WHATSAPP_SHARED_NUMBER_AGREEMENT_BODY = """
Al activar o utilizar el servicio de cobranza y comunicaciones por WhatsApp con
el numero de BetterP, la empresa cliente acepta que:

1. Es responsable de contar con una relacion comercial valida, autorizacion,
consentimiento o base legal suficiente para contactar a sus clientes por
WhatsApp, correo u otros canales configurados.
2. Es responsable de la exactitud de telefonos, saldos, fechas, referencias,
periodos de pago, cargos, recargos, intereses y cualquier dato enviado a sus
clientes.
3. BetterP provee una herramienta tecnologica de mensajeria, autoservicio y
seguimiento operativo. BetterP no actua como acreedor, despacho de cobranza,
asesor legal, asesor fiscal ni representante del cliente.
4. La empresa cliente no usara BetterP para spam, acoso, amenazas, cobranza
abusiva, informacion enganosa, contenido prohibido, mensajes no solicitados o
acciones que incumplan la ley, las politicas de Meta/WhatsApp o las politicas
de BetterP.
5. La empresa cliente debe atender solicitudes de baja, aclaracion, correccion
u oposicion de sus clientes, y debe conservar evidencia del consentimiento o de
la relacion que justifica el contacto.
6. Las plantillas aprobadas por BetterP o por Meta no garantizan que cada envio
sea legal o apropiado; la responsabilidad sobre destinatarios, datos y contexto
corresponde a la empresa cliente.
7. BetterP puede limitar, pausar, auditar, rechazar o suspender envios cuando
detecte riesgo operativo, quejas, datos incorrectos, incumplimiento de
politicas o afectacion a la reputacion del numero compartido.
8. La empresa cliente mantendra indemne a BetterP frente a reclamaciones,
sanciones, costos, bloqueos, quejas o danos derivados del mal uso del servicio,
datos incorrectos, falta de autorizacion o incumplimiento atribuible a la
empresa cliente.
""".strip()

WHATSAPP_SHARED_NUMBER_REQUIREMENTS = [
    "Confirmo que tengo autorizacion o base legal para contactar a mis clientes.",
    "Confirmo que los datos de cobranza cargados son correctos y estan actualizados.",
    "Acepto respetar las politicas de Meta/WhatsApp y las reglas de uso de BetterP.",
    "Entiendo que BetterP puede pausar envios si detecta riesgo o mal uso.",
]

PORTAL_COLLECTION_CONSENT_VERSION = "2026-06-18"
PORTAL_COLLECTION_CONSENT_TITLE = (
    "Consentimiento para comunicaciones de cobranza y autoservicio"
)
PORTAL_COLLECTION_CONSENT_BODY = """
Acepto recibir comunicaciones transaccionales y de cobranza relacionadas con mi
estado de cuenta, adeudos, fechas de pago, comprobantes, facturas, aclaraciones
y seguimiento administrativo por WhatsApp, correo electronico, telefono u otros
medios de contacto que tenga registrados con la empresa.

Entiendo que estos mensajes tienen como finalidad gestionar pagos, comprobantes,
facturacion y aclaraciones de mi relacion comercial o contractual. Tambien
confirmo que puedo solicitar la actualizacion de mis datos de contacto o pedir
orientacion sobre el uso de este portal con la administracion correspondiente.

Este consentimiento no modifica importes, fechas, obligaciones de pago,
contratos, convenios ni politicas internas de la empresa; solo autoriza el uso
de medios digitales para la gestion operativa de cobranza y autoservicio.
""".strip()

PORTAL_COLLECTION_CONSENT_REQUIREMENTS = [
    "Acepto recibir comunicaciones transaccionales y de cobranza por los medios registrados.",
    "Confirmo que revisare o solicitare actualizar mis datos de contacto si no son correctos.",
]


def channel_uses_whatsapp(channel: str | None) -> bool:
    return "WHATSAPP" in (channel or "").strip().upper()


def whatsapp_shared_number_agreement_required() -> bool:
    return bool(getattr(settings, "REQUIRE_WHATSAPP_SHARED_NUMBER_AGREEMENT", True))


def whatsapp_shared_number_agreement_hash() -> str:
    return hashlib.sha256(
        WHATSAPP_SHARED_NUMBER_AGREEMENT_BODY.encode("utf-8")
    ).hexdigest()


def portal_collection_consent_hash() -> str:
    return hashlib.sha256(
        PORTAL_COLLECTION_CONSENT_BODY.encode("utf-8")
    ).hexdigest()


def get_whatsapp_shared_number_agreement_payload() -> dict:
    return {
        "tipo_acuerdo": WHATSAPP_SHARED_NUMBER_AGREEMENT_TYPE,
        "version": WHATSAPP_SHARED_NUMBER_AGREEMENT_VERSION,
        "titulo": WHATSAPP_SHARED_NUMBER_AGREEMENT_TITLE,
        "texto": WHATSAPP_SHARED_NUMBER_AGREEMENT_BODY,
        "texto_hash": whatsapp_shared_number_agreement_hash(),
        "requerimientos": WHATSAPP_SHARED_NUMBER_REQUIREMENTS,
    }


def get_portal_collection_consent_payload() -> dict:
    return {
        "version": PORTAL_COLLECTION_CONSENT_VERSION,
        "titulo": PORTAL_COLLECTION_CONSENT_TITLE,
        "texto": PORTAL_COLLECTION_CONSENT_BODY,
        "texto_hash": portal_collection_consent_hash(),
        "requerimientos": PORTAL_COLLECTION_CONSENT_REQUIREMENTS,
    }


def get_active_whatsapp_shared_number_acceptance(
    capa: CapaNegocio | None,
) -> AcuerdoUsoComunicacion | None:
    if capa is None:
        return None
    return (
        AcuerdoUsoComunicacion.objects.select_related("aceptado_por", "capa_negocio")
        .filter(
            capa_negocio=capa,
            tipo_acuerdo=WHATSAPP_SHARED_NUMBER_AGREEMENT_TYPE,
            version=WHATSAPP_SHARED_NUMBER_AGREEMENT_VERSION,
            texto_hash=whatsapp_shared_number_agreement_hash(),
        )
        .order_by("-fecha_aceptacion", "-id")
        .first()
    )


def has_whatsapp_shared_number_agreement(capa: CapaNegocio | None) -> bool:
    if not whatsapp_shared_number_agreement_required():
        return True
    return get_active_whatsapp_shared_number_acceptance(capa) is not None


def serialize_whatsapp_shared_number_acceptance(
    acceptance: AcuerdoUsoComunicacion | None,
) -> dict | None:
    if acceptance is None:
        return None
    user = acceptance.aceptado_por
    return {
        "id": acceptance.id,
        "version": acceptance.version,
        "texto_hash": acceptance.texto_hash,
        "fecha_aceptacion": acceptance.fecha_aceptacion,
        "aceptado_por": (
            user.get_full_name() or user.email or user.username if user else None
        ),
        "aceptado_por_email": user.email if user else None,
    }


def build_whatsapp_shared_number_agreement_state(request) -> dict:
    capa = get_current_capa(request)
    acceptance = get_active_whatsapp_shared_number_acceptance(capa)
    return {
        "required": whatsapp_shared_number_agreement_required(),
        "accepted": acceptance is not None or not whatsapp_shared_number_agreement_required(),
        "agreement": get_whatsapp_shared_number_agreement_payload(),
        "acceptance": serialize_whatsapp_shared_number_acceptance(acceptance),
    }


def require_whatsapp_shared_number_agreement_for_capa(
    capa: CapaNegocio | None,
) -> None:
    if has_whatsapp_shared_number_agreement(capa):
        return
    raise HttpError(
        403,
        "Debes aceptar el acuerdo de uso de comunicaciones y cobranza por "
        "WhatsApp antes de activar envios con el numero de BetterP.",
    )


def require_whatsapp_shared_number_agreement_for_request(
    request,
    channel: str | None,
) -> None:
    if not channel_uses_whatsapp(channel):
        return
    require_whatsapp_shared_number_agreement_for_capa(get_current_capa(request))


def accept_whatsapp_shared_number_agreement(
    request,
    *,
    metadata: dict | None = None,
) -> AcuerdoUsoComunicacion:
    context = get_auth_context(request)
    capa = get_current_capa(request)
    agreement = get_whatsapp_shared_number_agreement_payload()
    ip = get_request_ip(request)
    user_agent = get_request_user_agent(request)
    acceptance, created = AcuerdoUsoComunicacion.objects.get_or_create(
        capa_negocio=capa,
        tipo_acuerdo=agreement["tipo_acuerdo"],
        version=agreement["version"],
        texto_hash=agreement["texto_hash"],
        defaults={
            "aceptado_por": context.user,
            "titulo": agreement["titulo"],
            "ip_address": ip,
            "user_agent": user_agent,
            "metadata": metadata or {},
        },
    )
    if created:
        audit(
            actor=context.user,
            capa=capa,
            accion="WHATSAPP_SHARED_NUMBER_TERMS_ACCEPTED",
            recurso_tipo="AcuerdoUsoComunicacion",
            recurso_id=acceptance.id,
            metadata={
                "tipo_acuerdo": agreement["tipo_acuerdo"],
                "version": agreement["version"],
                "texto_hash": agreement["texto_hash"],
                "ip": ip,
                "user_agent": user_agent,
                "accepted_at": timezone.now().isoformat(),
                **(metadata or {}),
            },
        )
    return acceptance
