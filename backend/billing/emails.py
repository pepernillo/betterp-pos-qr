from __future__ import annotations

from decimal import Decimal
from html import escape

from django.conf import settings
from django.contrib.auth.models import User
from django.db import transaction
from django.utils import timezone

from comunicaciones.email_provider import get_email_provider, send_email_transport

from .models import SuscripcionCapa
from .services import mark_subscription_event, platform_app_base_url


def queue_checkout_registration_email(
    subscription_id: int,
    *,
    user_id: int | None = None,
    provider: str = "EMAIL",
) -> None:
    transaction.on_commit(
        lambda: send_checkout_registration_email(
            subscription_id,
            user_id=user_id,
            provider=provider,
        )
    )


def queue_purchase_confirmation_email(
    subscription_id: int,
    *,
    stripe_payload: dict | None = None,
    source: str = "stripe",
) -> None:
    transaction.on_commit(
        lambda: send_purchase_confirmation_email(
            subscription_id,
            stripe_payload=stripe_payload,
            source=source,
        )
    )


def send_checkout_registration_email(
    subscription_id: int,
    *,
    user_id: int | None = None,
    provider: str = "EMAIL",
) -> bool:
    subscription = _load_subscription(subscription_id)
    if not subscription:
        return False
    if _email_already_sent(subscription, "checkout_registration_email_sent_at"):
        return False

    user = _resolve_user(subscription, user_id=user_id)
    destination = _resolve_destination(subscription, user)
    if not destination:
        _mark_email_skipped(
            subscription,
            key="checkout_registration_email_skipped_at",
            reason="Sin correo de destino para la cuenta SaaS.",
            tipo_evento="email.checkout_registration.skipped",
        )
        return False
    if not _email_transport_ready():
        _mark_email_skipped(
            subscription,
            key="checkout_registration_email_skipped_at",
            reason="Servicio de correo no configurado.",
            tipo_evento="email.checkout_registration.skipped",
        )
        return False

    plan = subscription.plan
    subject = "Tu cuenta BetterP esta lista para completar el pago"
    access_url = _app_url("/login")
    checkout_url = _app_url("/registro")
    context = {
        "preheader": "Tu cuenta BetterP ya quedo creada. Completa el pago para activar tu plan.",
        "eyebrow": "CUENTA BETTERP",
        "title": "Tu cuenta ya esta lista.",
        "intro": (
            "Creamos tu acceso a BetterP. La plataforma quedara activa cuando se confirme "
            "el pago del plan seleccionado."
        ),
        "cta_label": "Entrar a BetterP",
        "cta_url": access_url,
        "secondary_label": "Ver planes",
        "secondary_url": checkout_url,
        "highlight": "El acceso operativo queda pausado hasta que Stripe confirme el pago.",
        "rows": [
            ("Cuenta", _display_account_name(subscription)),
            ("Correo", destination),
            ("Plan", plan.nombre if plan else "Pendiente"),
            ("Cobro", _period_label(subscription.periodicidad)),
            ("Registro", _format_datetime(timezone.now())),
        ],
        "note": (
            "Si no iniciaste este registro, responde este correo para que el equipo BetterP "
            "pueda revisar la cuenta."
        ),
    }
    text = _plain_text_from_context(context)
    html = build_betterp_email_html(context)
    return _send_and_mark(
        subscription,
        destination=destination,
        subject=subject,
        text=text,
        html=html,
        sent_key="checkout_registration_email_sent_at",
        error_key="checkout_registration_email_error",
        tipo_evento="email.checkout_registration.sent",
        error_event="email.checkout_registration.error",
        payload={"provider": provider, "destination": destination},
    )


def send_purchase_confirmation_email(
    subscription_id: int,
    *,
    stripe_payload: dict | None = None,
    source: str = "stripe",
) -> bool:
    subscription = _load_subscription(subscription_id)
    if not subscription or subscription.estatus != "ACTIVA":
        return False
    if _email_already_sent(subscription, "purchase_confirmation_email_sent_at"):
        return False

    user = _resolve_user(subscription)
    destination = _resolve_destination(subscription, user)
    if not destination:
        _mark_email_skipped(
            subscription,
            key="purchase_confirmation_email_skipped_at",
            reason="Sin correo de destino para la compra SaaS.",
            tipo_evento="email.purchase_confirmation.skipped",
        )
        return False
    if not _email_transport_ready():
        _mark_email_skipped(
            subscription,
            key="purchase_confirmation_email_skipped_at",
            reason="Servicio de correo no configurado.",
            tipo_evento="email.purchase_confirmation.skipped",
        )
        return False

    amount = _resolve_paid_amount(subscription, stripe_payload)
    subject = f"Pago recibido: BetterP {subscription.plan.nombre} esta activo"
    dashboard_url = _app_url("/dashboard")
    billing_url = _app_url("/cuenta")
    context = {
        "preheader": "Confirmamos tu pago y activamos tu suscripcion BetterP.",
        "eyebrow": "PAGO RECIBIDO",
        "title": "Tu plan BetterP esta activo.",
        "intro": (
            "Stripe confirmo el pago de tu suscripcion. Ya puedes entrar al panel "
            "y operar con los permisos del plan contratado."
        ),
        "cta_label": "Ir al dashboard",
        "cta_url": dashboard_url,
        "secondary_label": "Ver suscripcion",
        "secondary_url": billing_url,
        "highlight": (
            "Este correo confirma la compra del servicio y funciona como acuse "
            "operativo. No sustituye un CFDI. Para factura fiscal, solicita el "
            "CFDI con tus datos fiscales desde soporte."
        ),
        "rows": [
            ("Cuenta", _display_account_name(subscription)),
            ("Correo", destination),
            ("Plan", subscription.plan.nombre),
            ("Cobro", _period_label(subscription.periodicidad)),
            ("Importe", amount),
            ("Siguiente pago", _format_date(subscription.fecha_fin_periodo_actual)),
            ("Estatus", "Activa"),
        ],
        "note": (
            "La suscripcion se rige por los terminos del servicio y el aviso de privacidad "
            "vigentes. La politica comercial del primer mes aplica al pago SaaS "
            "del periodo inicial y excluye integraciones, implementaciones, consumos "
            "extraordinarios o trabajos personalizados. Si detectas un cargo no "
            "reconocido, responde este correo."
        ),
    }
    text = _plain_text_from_context(context)
    html = build_betterp_email_html(context)
    sent = _send_and_mark(
        subscription,
        destination=destination,
        subject=subject,
        text=text,
        html=html,
        sent_key="purchase_confirmation_email_sent_at",
        error_key="purchase_confirmation_email_error",
        tipo_evento="email.purchase_confirmation.sent",
        error_event="email.purchase_confirmation.error",
        payload={
            "source": source,
            "destination": destination,
            "stripe_event": _stripe_payload_summary(stripe_payload),
        },
    )
    if sent:
        _send_internal_purchase_notice(subscription, destination, amount, stripe_payload)
    return sent


def build_betterp_email_html(context: dict) -> str:
    preheader = escape(str(context.get("preheader") or "BetterP"))
    rows = context.get("rows") or []
    row_html = "".join(
        "<tr>"
        f"<td style='padding:13px 0;border-bottom:1px solid #1f2937;color:#8b96a8;"
        f"font-size:12px;letter-spacing:.12em;text-transform:uppercase'>{escape(str(label))}</td>"
        f"<td style='padding:13px 0;border-bottom:1px solid #1f2937;color:#f8fafc;"
        f"font-size:15px;font-weight:700;text-align:right'>{escape(str(value or '-'))}</td>"
        "</tr>"
        for label, value in rows
    )
    cta_label = escape(str(context.get("cta_label") or "Abrir BetterP"))
    cta_url = escape(str(context.get("cta_url") or _app_url("/login")))
    secondary_label = escape(str(context.get("secondary_label") or "Soporte"))
    secondary_url = escape(str(context.get("secondary_url") or _marketing_url("/#contacto")))
    logo_url = escape(_logo_url())
    legal_name = escape(str(getattr(settings, "BETTERP_LEGAL_NAME", "BetterP") or "BetterP"))
    terms_url = escape(_marketing_url("/terms"))
    privacy_url = escape(_marketing_url("/privacy"))
    support_email = escape(_support_email())
    year = timezone.now().year

    return f"""<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>{escape(str(context.get("title") or "BetterP"))}</title>
  </head>
  <body style="margin:0;background:#020617;padding:0;font-family:Segoe UI,Arial,sans-serif;color:#f8fafc">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">{preheader}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#020617;padding:28px 14px">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;background:#070a12;border:1px solid #1f2937;border-radius:28px;overflow:hidden">
            <tr>
              <td style="padding:28px 28px 18px;background:linear-gradient(135deg,#07111f 0%,#052f35 52%,#070a12 100%)">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                  <tr>
                    <td>
                      <img src="{logo_url}" width="148" alt="BetterP" style="display:block;max-width:148px;height:auto;border:0;outline:none;text-decoration:none">
                    </td>
                    <td align="right" style="font-size:11px;letter-spacing:.20em;color:#67e8f9;text-transform:uppercase;font-weight:700">BetterP</td>
                  </tr>
                </table>
                <div style="margin-top:34px;color:#67e8f9;font-size:12px;letter-spacing:.24em;text-transform:uppercase;font-weight:800">{escape(str(context.get("eyebrow") or "BETTERP"))}</div>
                <h1 style="margin:12px 0 0;color:#ffffff;font-size:34px;line-height:1.12;font-weight:800;letter-spacing:0">{escape(str(context.get("title") or ""))}</h1>
                <p style="margin:18px 0 0;color:#cbd5e1;font-size:16px;line-height:1.65">{escape(str(context.get("intro") or ""))}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 28px 8px">
                <div style="background:#0d1320;border:1px solid #243244;border-radius:22px;padding:20px">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                    {row_html}
                  </table>
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 28px 0">
                <div style="background:#042f2e;border:1px solid #0f766e;border-radius:18px;padding:16px 18px;color:#ccfbf1;font-size:14px;line-height:1.6">
                  {escape(str(context.get("highlight") or ""))}
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 28px 8px">
                <table role="presentation" cellspacing="0" cellpadding="0">
                  <tr>
                    <td style="border-radius:16px;background:#22d3ee">
                      <a href="{cta_url}" style="display:inline-block;padding:15px 22px;color:#031018;text-decoration:none;font-size:15px;font-weight:800;border-radius:16px">{cta_label}</a>
                    </td>
                    <td style="width:12px"></td>
                    <td style="border-radius:16px;border:1px solid #334155">
                      <a href="{secondary_url}" style="display:inline-block;padding:14px 20px;color:#e2e8f0;text-decoration:none;font-size:15px;font-weight:700;border-radius:16px">{secondary_label}</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:12px 28px 24px;color:#94a3b8;font-size:13px;line-height:1.65">
                {escape(str(context.get("note") or ""))}
              </td>
            </tr>
            <tr>
              <td style="padding:20px 28px 28px;background:#05070d;border-top:1px solid #1f2937;color:#7b8496;font-size:12px;line-height:1.6">
                <div style="font-weight:700;color:#cbd5e1;margin-bottom:8px">{legal_name}</div>
                <div>Este mensaje es transaccional y forma parte de la operacion de tu cuenta BetterP.</div>
                <div style="margin-top:8px">
                  <a href="{terms_url}" style="color:#67e8f9;text-decoration:none">Terminos del servicio</a>
                  <span style="color:#334155"> | </span>
                  <a href="{privacy_url}" style="color:#67e8f9;text-decoration:none">Aviso de privacidad</a>
                  <span style="color:#334155"> | </span>
                  <a href="mailto:{support_email}" style="color:#67e8f9;text-decoration:none">{support_email}</a>
                </div>
                <div style="margin-top:8px">&copy; {year} BetterP. Todos los derechos reservados.</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>"""


def _send_and_mark(
    subscription: SuscripcionCapa,
    *,
    destination: str,
    subject: str,
    text: str,
    html: str,
    sent_key: str,
    error_key: str,
    tipo_evento: str,
    error_event: str,
    payload: dict,
) -> bool:
    try:
        result = send_email_transport(
            destination=destination,
            subject=subject,
            message=text,
            html_message=html,
            sender_name=(getattr(settings, "RESEND_FROM_NAME", "") or "").strip() or "BetterP",
        )
    except Exception as exc:
        _update_subscription_metadata(
            subscription,
            {
                error_key: str(exc)[:500],
                f"{error_key}_at": timezone.now().isoformat(),
            },
        )
        mark_subscription_event(
            capa=subscription.capa_negocio,
            subscription=subscription,
            proveedor="SISTEMA",
            tipo_evento=error_event,
            payload={**payload, "error": str(exc)[:500]},
            estatus="ERROR",
            detalle_error=str(exc)[:1000],
        )
        return False

    _update_subscription_metadata(
        subscription,
        {
            sent_key: timezone.now().isoformat(),
            f"{sent_key}_provider": result.get("provider"),
            f"{sent_key}_id": result.get("id"),
            error_key: None,
        },
    )
    mark_subscription_event(
        capa=subscription.capa_negocio,
        subscription=subscription,
        proveedor="SISTEMA",
        tipo_evento=tipo_evento,
        payload={**payload, "email_provider": result.get("provider"), "email_id": result.get("id")},
    )
    return True


def _send_internal_purchase_notice(
    subscription: SuscripcionCapa,
    customer_email: str,
    amount: str,
    stripe_payload: dict | None,
) -> None:
    destination = (
        (getattr(settings, "BETTERP_SALES_NOTIFY_EMAIL", "") or "").strip()
        or (getattr(settings, "SALES_CONTACT_EMAIL", "") or "").strip()
    )
    if not destination or destination.lower() == customer_email.lower() or not _email_transport_ready():
        return

    context = {
        "preheader": "Nueva suscripcion BetterP confirmada por Stripe.",
        "eyebrow": "VENTA BETTERP",
        "title": "Nueva compra confirmada.",
        "intro": "Stripe confirmo una compra de BetterP y la cuenta quedo activa.",
        "cta_label": "Abrir backoffice",
        "cta_url": _app_url("/backoffice/planes"),
        "secondary_label": "Dashboard",
        "secondary_url": _app_url("/backoffice"),
        "highlight": "Revisa si el cliente requiere CFDI, onboarding o seguimiento comercial.",
        "rows": [
            ("Cuenta", _display_account_name(subscription)),
            ("Correo cliente", customer_email),
            ("Plan", subscription.plan.nombre),
            ("Cobro", _period_label(subscription.periodicidad)),
            ("Importe", amount),
            ("Stripe customer", subscription.stripe_customer_id or "-"),
            ("Stripe subscription", subscription.stripe_subscription_id or "-"),
            ("Evento", str((stripe_payload or {}).get("id") or "-")),
        ],
        "note": "Notificacion interna BetterP. No reenviar al cliente.",
    }
    try:
        send_email_transport(
            destination=destination,
            subject=f"Nueva compra BetterP - {subscription.capa_negocio.nombre}",
            message=_plain_text_from_context(context),
            html_message=build_betterp_email_html(context),
            sender_name=(getattr(settings, "RESEND_FROM_NAME", "") or "").strip() or "BetterP",
        )
    except Exception as exc:
        mark_subscription_event(
            capa=subscription.capa_negocio,
            subscription=subscription,
            proveedor="SISTEMA",
            tipo_evento="email.internal_purchase_notice.error",
            payload={"destination": destination, "error": str(exc)[:500]},
            estatus="ERROR",
            detalle_error=str(exc)[:1000],
        )


def _load_subscription(subscription_id: int) -> SuscripcionCapa | None:
    return (
        SuscripcionCapa.objects.select_related("capa_negocio", "plan", "capa_negocio__usuario_fundador")
        .filter(id=subscription_id)
        .first()
    )


def _resolve_user(subscription: SuscripcionCapa, *, user_id: int | None = None) -> User | None:
    if user_id:
        user = User.objects.filter(id=user_id).first()
        if user:
            return user
    return subscription.capa_negocio.usuario_fundador


def _resolve_destination(subscription: SuscripcionCapa, user: User | None) -> str:
    if user and user.email:
        return user.email.strip().lower()
    return (subscription.capa_negocio.correo_contacto or "").strip().lower()


def _display_account_name(subscription: SuscripcionCapa) -> str:
    capa = subscription.capa_negocio
    return capa.nombre or capa.correo_contacto or "Cuenta BetterP"


def _plain_text_from_context(context: dict) -> str:
    lines = [
        str(context.get("title") or "BetterP"),
        "",
        str(context.get("intro") or ""),
        "",
    ]
    for label, value in context.get("rows") or []:
        lines.append(f"{label}: {value or '-'}")
    lines.extend(
        [
            "",
            str(context.get("highlight") or ""),
            "",
            f"{context.get('cta_label') or 'Abrir'}: {context.get('cta_url') or _app_url('/login')}",
            f"{context.get('secondary_label') or 'Soporte'}: {context.get('secondary_url') or _marketing_url('/#contacto')}",
            "",
            str(context.get("note") or ""),
            "",
            f"Terminos: {_marketing_url('/terms')}",
            f"Privacidad: {_marketing_url('/privacy')}",
        ]
    )
    return "\n".join(line for line in lines if line is not None)


def _email_transport_ready() -> bool:
    from_email = (
        (getattr(settings, "RESEND_FROM_EMAIL", "") or "").strip()
        or (getattr(settings, "DEFAULT_FROM_EMAIL", "") or "").strip()
    )
    if not from_email:
        return False
    if get_email_provider() == "RESEND":
        return bool((getattr(settings, "RESEND_API_KEY", "") or "").strip())
    backend = (getattr(settings, "EMAIL_BACKEND", "") or "").strip()
    if backend and backend != "django.core.mail.backends.smtp.EmailBackend":
        return True
    return bool((getattr(settings, "EMAIL_HOST", "") or "").strip())


def _email_already_sent(subscription: SuscripcionCapa, key: str) -> bool:
    return bool((subscription.metadata or {}).get(key))


def _mark_email_skipped(
    subscription: SuscripcionCapa,
    *,
    key: str,
    reason: str,
    tipo_evento: str,
) -> None:
    _update_subscription_metadata(
        subscription,
        {
            key: timezone.now().isoformat(),
            f"{key}_reason": reason,
        },
    )
    mark_subscription_event(
        capa=subscription.capa_negocio,
        subscription=subscription,
        proveedor="SISTEMA",
        tipo_evento=tipo_evento,
        payload={"reason": reason},
    )


def _update_subscription_metadata(subscription: SuscripcionCapa, patch: dict) -> None:
    metadata = {**(subscription.metadata or {})}
    for key, value in patch.items():
        if value is None:
            metadata.pop(key, None)
        else:
            metadata[key] = value
    subscription.metadata = metadata
    subscription.save(update_fields=["metadata", "fecha_actualizacion"])


def _resolve_paid_amount(subscription: SuscripcionCapa, stripe_payload: dict | None) -> str:
    payload = stripe_payload or {}
    cents = (
        payload.get("amount_paid")
        or payload.get("amount_total")
        or payload.get("total")
        or payload.get("amount_due")
    )
    if cents is not None:
        try:
            return _format_money(Decimal(str(cents)) / Decimal("100"))
        except Exception:
            pass
    plan = subscription.plan
    amount = plan.precio_anual if subscription.periodicidad == "ANUAL" else plan.precio_mensual
    return _format_money(amount)


def _stripe_payload_summary(payload: dict | None) -> dict:
    if not payload:
        return {}
    return {
        "id": payload.get("id"),
        "object": payload.get("object"),
        "status": payload.get("status"),
        "payment_status": payload.get("payment_status"),
        "subscription": payload.get("subscription"),
        "customer": payload.get("customer"),
    }


def _format_money(value: Decimal | int | float | str) -> str:
    try:
        amount = Decimal(str(value or 0))
    except Exception:
        amount = Decimal("0")
    return f"${amount:,.2f} MXN"


def _format_date(value) -> str:
    if not value:
        return "Pendiente"
    return value.strftime("%d/%m/%Y")


def _format_datetime(value) -> str:
    if not value:
        return "Pendiente"
    return timezone.localtime(value).strftime("%d/%m/%Y %H:%M")


def _period_label(periodicidad: str) -> str:
    return "Anual" if periodicidad == "ANUAL" else "Mensual"


def _app_url(path: str) -> str:
    return f"{platform_app_base_url()}/{path.lstrip('/')}"


def _marketing_url(path: str) -> str:
    base = (
        (getattr(settings, "BETTERP_MARKETING_BASE_URL", "") or "").strip()
        or "https://betterp.net"
    ).rstrip("/")
    return f"{base}/{path.lstrip('/')}"


def _logo_url() -> str:
    configured = (getattr(settings, "BETTERP_EMAIL_LOGO_URL", "") or "").strip()
    if configured:
        return configured
    return _marketing_url("/betterp-logo-dark.png")


def _support_email() -> str:
    return (
        (getattr(settings, "RESEND_REPLY_TO", "") or "").strip()
        or (getattr(settings, "SALES_CONTACT_EMAIL", "") or "").strip()
        or "contacto@betterp.net"
    )
