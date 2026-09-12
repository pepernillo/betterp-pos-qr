import base64
import hashlib
import hmac
import json
import time
from email.utils import formataddr

import requests
from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.http import HttpRequest
from django.utils.html import escape


def build_email_html(message: str, media_url: str | None = None) -> str:
    paragraphs = [
        f"<p style='margin:0 0 12px 0;color:#18181b;font-size:15px;line-height:1.7'>{escape(line)}</p>"
        for line in (message or "").splitlines()
        if line.strip()
    ]
    media_block = ""
    if media_url:
        media_block = (
            "<div style='margin:18px 0'>"
            f"<img src='{escape(media_url)}' alt='Adjunto' style='max-width:100%;border-radius:18px;border:1px solid #e4e4e7' />"
            "</div>"
        )

    return (
        "<div style='font-family:Segoe UI,Arial,sans-serif;background:#f4f4f5;padding:24px'>"
        "<div style='max-width:680px;margin:0 auto;background:#ffffff;border-radius:24px;"
        "padding:28px;border:1px solid #e4e4e7'>"
        f"{''.join(paragraphs) or '<p style=\"color:#52525b\">Mensaje BettERP</p>'}"
        f"{media_block}"
        "</div></div>"
    )


def get_email_provider() -> str:
    return "RESEND" if (getattr(settings, "RESEND_API_KEY", "") or "").strip() else "SMTP"


def resolve_backend_public_base_url(request: HttpRequest | None = None) -> str | None:
    configured = (getattr(settings, "BACKEND_PUBLIC_BASE_URL", "") or "").strip()
    if configured:
        return configured.rstrip("/")
    if request is None:
        return None
    return request.build_absolute_uri("/").rstrip("/")


def build_resend_webhook_url(request: HttpRequest | None = None) -> str | None:
    base_url = resolve_backend_public_base_url(request)
    if not base_url:
        return None
    return f"{base_url}/api/comunicaciones/webhooks/resend/"


def get_resend_verified_domain() -> str | None:
    configured = (getattr(settings, "RESEND_VERIFIED_DOMAIN", "") or "").strip()
    if configured:
        return configured.lower()

    from_email = (getattr(settings, "RESEND_FROM_EMAIL", "") or "").strip().lower()
    if "@" in from_email:
        return from_email.split("@", 1)[1]
    return None


def get_email_delivery_overview(request: HttpRequest | None = None) -> dict:
    return {
        "email_provider": get_email_provider(),
        "backend_public_base_url": resolve_backend_public_base_url(request),
        "resend_webhook_url": build_resend_webhook_url(request),
        "resend_configured": bool((getattr(settings, "RESEND_API_KEY", "") or "").strip()),
        "resend_api_key_present": bool((getattr(settings, "RESEND_API_KEY", "") or "").strip()),
        "resend_webhook_secret_present": bool(
            (getattr(settings, "RESEND_WEBHOOK_SECRET", "") or "").strip()
        ),
        "resend_domain": get_resend_verified_domain(),
        "resend_from_email_default": (getattr(settings, "RESEND_FROM_EMAIL", "") or "").strip() or None,
        "resend_from_name_default": (getattr(settings, "RESEND_FROM_NAME", "") or "").strip() or None,
        "resend_reply_to_default": (getattr(settings, "RESEND_REPLY_TO", "") or "").strip() or None,
    }


def _build_from_email(sender_email: str, sender_name: str | None = None) -> str:
    return formataddr((sender_name, sender_email)) if sender_name else sender_email


def send_email_transport(
    *,
    destination: str,
    subject: str,
    message: str,
    html_message: str | None = None,
    media_url: str | None = None,
    sender_email: str | None = None,
    sender_name: str | None = None,
    reply_to: str | None = None,
) -> dict:
    provider = get_email_provider()
    resolved_sender_email = (
        (sender_email or "").strip()
        or (getattr(settings, "RESEND_FROM_EMAIL", "") or "").strip()
        or (getattr(settings, "DEFAULT_FROM_EMAIL", "") or "").strip()
    )
    if not resolved_sender_email:
        raise ValueError("No existe remitente de correo configurado.")

    resolved_sender_name = (
        (sender_name or "").strip()
        or (getattr(settings, "RESEND_FROM_NAME", "") or "").strip()
        or None
    )
    resolved_reply_to = (
        (reply_to or "").strip()
        or (getattr(settings, "RESEND_REPLY_TO", "") or "").strip()
        or None
    )
    html_body = html_message or build_email_html(message, media_url=media_url)

    if provider == "RESEND":
        payload = {
            "from": _build_from_email(resolved_sender_email, resolved_sender_name),
            "to": [destination],
            "subject": subject or "Mensaje BettERP",
            "text": message,
            "html": html_body,
        }
        if resolved_reply_to:
            payload["reply_to"] = [resolved_reply_to]

        response = requests.post(
            f"{settings.RESEND_API_BASE_URL.rstrip('/')}/emails",
            headers={
                "Authorization": f"Bearer {settings.RESEND_API_KEY}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=20,
        )
        try:
            response_body = response.json().copy() if response.content else {}
        except ValueError:
            response_body = {}
        if response.status_code >= 400:
            detail = response_body.get("message") or response.text[:220]
            raise ValueError(f"Resend rechazo el envio ({response.status_code}): {detail}")
        return {
            "provider": "RESEND",
            "status": "sent",
            "id": response_body.get("id"),
            "raw": response_body,
        }

    email = EmailMultiAlternatives(
        subject=subject or "Mensaje BettERP",
        body=message,
        from_email=_build_from_email(resolved_sender_email, resolved_sender_name),
        to=[destination],
        reply_to=[resolved_reply_to] if resolved_reply_to else None,
    )
    email.attach_alternative(html_body, "text/html")
    email.send(fail_silently=False)
    return {"provider": "SMTP", "status": "sent", "id": None, "raw": {"status": "sent"}}


def verify_resend_webhook_signature(raw_body: str, headers: dict[str, str]) -> dict:
    secret = (getattr(settings, "RESEND_WEBHOOK_SECRET", "") or "").strip()
    if not secret:
        raise ValueError("RESEND_WEBHOOK_SECRET no esta configurado.")

    webhook_id = headers.get("svix-id") or headers.get("webhook-id")
    webhook_timestamp = headers.get("svix-timestamp") or headers.get("webhook-timestamp")
    webhook_signature = headers.get("svix-signature") or headers.get("webhook-signature")
    if not webhook_id or not webhook_timestamp or not webhook_signature:
        raise ValueError("Faltan encabezados de firma del webhook de Resend.")

    try:
        timestamp_value = int(webhook_timestamp)
    except (TypeError, ValueError) as exc:
        raise ValueError("El timestamp del webhook es invalido.") from exc

    tolerance_seconds = int(getattr(settings, "RESEND_WEBHOOK_TOLERANCE_SECONDS", 300) or 300)
    if abs(int(time.time()) - timestamp_value) > tolerance_seconds:
        raise ValueError("El webhook de Resend esta fuera de la ventana de tolerancia.")

    if secret.startswith("whsec_"):
        secret = secret.split("_", 1)[1]

    try:
        padded_secret = f"{secret}{'=' * (-len(secret) % 4)}"
        secret_bytes = base64.urlsafe_b64decode(padded_secret)
    except Exception as exc:
        raise ValueError("No se pudo decodificar RESEND_WEBHOOK_SECRET.") from exc

    signed_content = f"{webhook_id}.{webhook_timestamp}.{raw_body}".encode("utf-8")
    expected_signature = base64.b64encode(
        hmac.new(secret_bytes, signed_content, hashlib.sha256).digest()
    ).decode("utf-8")

    signatures = []
    for token in webhook_signature.split():
        version, _, value = token.partition(",")
        if version == "v1" and value:
            signatures.append(value.strip())

    if not signatures:
        raise ValueError("No se encontro una firma v1 valida en el webhook de Resend.")

    if not any(hmac.compare_digest(signature, expected_signature) for signature in signatures):
        raise ValueError("La firma del webhook de Resend no es valida.")

    try:
        return json.loads(raw_body)
    except json.JSONDecodeError as exc:
        raise ValueError("El payload del webhook de Resend no es JSON valido.") from exc
