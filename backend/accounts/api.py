import secrets
import time as perf_timer
from datetime import datetime, time, timedelta
from typing import Optional
from uuid import UUID

import requests
from django.conf import settings
from django.contrib.auth import authenticate, get_backends, password_validation
from django.contrib.auth.backends import ModelBackend
from django.contrib.auth.models import User
from django.contrib.auth.hashers import check_password, make_password
from django.db import transaction
from django.db.models import Case, CharField, Count, F, Q, Value, When, Window
from django.db.models.functions import RowNumber
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime
from ninja import Router, Schema
from ninja.errors import HttpError

from comunicaciones.email_provider import get_email_provider, send_email_transport
from billing.plan_limits import assert_plan_capacity
from empresas.models import CapaNegocio

from .audit import audit
from .models import (
    DesafioDobleFactor,
    EventoAuditoria,
    InvitacionAdminPlataforma,
    InvitacionAcceso,
    MembresiaCapaNegocio,
    RecuperacionAcceso,
    SesionAcceso,
    UsuarioPerfil,
)
from .rate_limit import (
    assert_auth_rate_limit,
    clear_auth_rate_limit,
    consume_auth_rate_limit,
    record_auth_rate_limit_failure,
)
from .security import (
    ROLE_OWNER_ADMIN,
    create_access_session,
    decode_signed_token,
    get_auth_context,
    get_current_capa,
    get_platform_admin_users_queryset,
    get_platform_founder_user_id,
    get_role_permission_matrix,
    is_platform_founder_user,
    is_platform_admin_user,
    issue_token_pair,
    membership_session_queryset,
    require_admin_access,
    require_audit_access,
    require_platform_admin_access,
    resolve_current_membership,
    resolve_memberships_for_user,
    revoke_access_session,
)

router = Router(tags=["accounts"])

GOOGLE_TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo"


def mark_request_timing(request, key: str, started: float) -> None:
    timings = getattr(request, "performance_timings_ms", None)
    if not isinstance(timings, dict):
        timings = {}
        request.performance_timings_ms = timings
    timings[key] = max(int((perf_timer.monotonic() - started) * 1000), 0)


class BootstrapIn(Schema):
    email: str
    password: str
    nombre: str
    nombre_capa: str = "Mi operadora"
    tipo_capa: str = "OPERADORA"


class LoginIn(Schema):
    email: str
    password: str


class TrialRegisterIn(Schema):
    nombre: str
    email: str
    password: str
    password_confirm: str
    nombre_capa: str
    tipo_capa: str = "OPERADORA"
    telefono: str = ""


class CheckoutRegisterIn(Schema):
    nombre: str
    email: str
    password: str
    password_confirm: str
    nombre_capa: str
    tipo_capa: str = "OPERADORA"
    telefono: str = ""
    plan_id: int | None = None
    periodicidad: str = "MENSUAL"


class GoogleLoginIn(Schema):
    id_token: str


class GoogleTrialRegisterIn(Schema):
    id_token: str
    nombre_capa: str
    tipo_capa: str = "OPERADORA"
    telefono: str = ""


class GoogleCheckoutRegisterIn(Schema):
    id_token: str
    nombre_capa: str
    tipo_capa: str = "OPERADORA"
    telefono: str = ""
    plan_id: int | None = None
    periodicidad: str = "MENSUAL"


class RefreshTokenIn(Schema):
    refresh_token: str


class InvitationAcceptIn(Schema):
    nombre: str = ""
    password: str = ""
    password_confirm: str = ""


class InviteMemberIn(Schema):
    email: str
    nombre_sugerido: str = ""
    rol: str = "CONSULTA"
    replace_existing: bool = False


class MembershipRoleIn(Schema):
    rol: str


class AuditEventOut(Schema):
    id: int
    accion: str
    recurso_tipo: str
    recurso_id: Optional[str] = None
    actor_email: Optional[str] = None
    capa_negocio_id: Optional[int] = None
    capa_negocio_nombre: Optional[str] = None
    metadata: dict = {}
    fecha_creacion: str


AUDIT_OPERATIONAL_CATEGORIES = (
    {
        "key": "accesos",
        "label": "Accesos",
        "actions": {
            "ACEPTAR_INVITACION",
            "CAMBIAR_CONTRASENA",
            "ELIMINAR_INVITACION",
            "INVITAR_USUARIO",
            "REEMPLAZAR_INVITACION",
            "RESTABLECER_CONTRASENA",
            "REVOCAR_INVITACION",
        },
    },
    {
        "key": "permisos",
        "label": "Permisos",
        "actions": {
            "ACCESO_DENEGADO",
            "ACTUALIZAR_ROL_USUARIO",
            "DESACTIVAR_USUARIO",
            "ELIMINAR_USUARIO_CAPA",
        },
    },
    {
        "key": "backups",
        "label": "Backups",
        "actions": {
            "BACKOFFICE_BACKUP_CAPA_GENERADO",
            "BACKOFFICE_BACKUP_RESTORE_VALIDADO",
        },
    },
    {
        "key": "billing",
        "label": "Billing",
        "actions": {
            "PLAN_FUNCION_DENEGADA",
            "PLAN_MODULO_DENEGADO",
            "SUSCRIPCION_CAMBIO_PLAN_PROGRAMADO",
            "SUSCRIPCION_CAMBIO_PLAN_SOLICITADO",
            "SUSCRIPCION_FUNCIONES_ACTUALIZADAS",
        },
    },
    {
        "key": "conciliacion",
        "label": "Conciliacion",
        "actions": {
            "CXC_PAGO_VALIDADO",
            "CXP_PAGO_VALIDADO",
            "EVENTO_FINANCIERO_APLICADO",
            "EVENTO_FINANCIERO_CONCILIADO",
            "EVENTO_FINANCIERO_ESTATUS_ACTUALIZADO",
            "TRANSACCION_APLICADA_CXC",
            "TRANSACCION_APLICADA_CXP",
            "TRANSACCION_ESTATUS_ACTUALIZADO",
            "TRANSACCION_VINCULADA_EVENTO",
        },
    },
)


def serialize_audit_event(event: EventoAuditoria) -> dict:
    return {
        "id": event.id,
        "accion": event.accion,
        "recurso_tipo": event.recurso_tipo,
        "recurso_id": event.recurso_id,
        "actor_email": event.actor.email if event.actor_id else None,
        "capa_negocio_id": event.capa_negocio_id,
        "capa_negocio_nombre": event.capa_negocio.nombre if event.capa_negocio_id else None,
        "metadata": event.metadata or {},
        "fecha_creacion": event.fecha_creacion.isoformat(),
    }


def parse_audit_boundary(value: str, *, end_of_day: bool):
    parsed_datetime = parse_datetime(value)
    if parsed_datetime:
        if timezone.is_naive(parsed_datetime):
            return timezone.make_aware(parsed_datetime)
        return parsed_datetime

    parsed_date = parse_date(value)
    if not parsed_date:
        return None
    boundary = datetime.combine(
        parsed_date,
        time.max if end_of_day else time.min,
    )
    return timezone.make_aware(boundary)


def build_audit_category_case() -> Case:
    return Case(
        *[
            When(accion__in=category["actions"], then=Value(category["key"]))
            for category in AUDIT_OPERATIONAL_CATEGORIES
        ],
        output_field=CharField(),
    )


def build_audit_operational_summary(
    *,
    capa: CapaNegocio,
    since,
    until,
    safe_limit: int,
) -> tuple[list[dict], int]:
    category_case = build_audit_category_case()
    critical_actions = {
        action
        for category in AUDIT_OPERATIONAL_CATEGORIES
        for action in category["actions"]
    }
    base_events = EventoAuditoria.objects.filter(
        capa_negocio=capa,
        fecha_creacion__gte=since,
        fecha_creacion__lte=until,
        accion__in=critical_actions,
    )
    counts_by_category = dict(
        base_events.order_by()
        .annotate(audit_category=category_case)
        .values("audit_category")
        .annotate(total=Count("id"))
        .values_list("audit_category", "total")
    )
    latest_by_category: dict[str, list[dict]] = {
        category["key"]: [] for category in AUDIT_OPERATIONAL_CATEGORIES
    }
    latest_events = (
        base_events.select_related("actor", "capa_negocio")
        .annotate(audit_category=category_case)
        .annotate(
            audit_category_rank=Window(
                expression=RowNumber(),
                partition_by=[category_case],
                order_by=[F("fecha_creacion").desc(), F("id").desc()],
            )
        )
        .filter(audit_category_rank__lte=safe_limit)
        .only(
            "id",
            "accion",
            "recurso_tipo",
            "recurso_id",
            "actor_id",
            "actor__email",
            "capa_negocio_id",
            "capa_negocio__nombre",
            "metadata",
            "fecha_creacion",
        )
        .order_by("audit_category", "-fecha_creacion", "-id")
    )
    for event in latest_events:
        latest_by_category[getattr(event, "audit_category")].append(
            serialize_audit_event(event)
        )

    categories: list[dict] = []
    total_critical_events = 0
    for category in AUDIT_OPERATIONAL_CATEGORIES:
        category_key = category["key"]
        count = int(counts_by_category.get(category_key, 0) or 0)
        total_critical_events += count
        categories.append(
            {
                "key": category_key,
                "label": category["label"],
                "acciones": sorted(category["actions"]),
                "count": count,
                "latest": latest_by_category[category_key],
            }
        )
    return categories, total_critical_events


def normalize_audit_signal_value(value, *, fallback: str = "SIN_DATO") -> str:
    clean_value = str(value or "").strip()
    if not clean_value:
        return fallback
    return clean_value[:160]


def build_audit_signal_buckets(queryset, field: str, *, limit: int = 5) -> list[dict]:
    buckets: list[dict] = []
    rows = (
        queryset.order_by()
        .values(field)
        .annotate(count=Count("id"))
        .order_by("-count", field)[:limit]
    )
    for row in rows:
        value = normalize_audit_signal_value(row.get(field))
        buckets.append(
            {
                "value": value,
                "label": humanize_audit_signal_value(value),
                "count": int(row.get("count") or 0),
            }
        )
    return buckets


def humanize_audit_signal_value(value: str) -> str:
    clean_value = normalize_audit_signal_value(value)
    labels = {
        "admin": "Administracion",
        "auditoria": "Auditoria",
        "backups": "Backups",
        "platform_admin": "Backoffice interno",
        "write": "Edicion",
    }
    if clean_value in labels:
        return labels[clean_value]
    return clean_value.replace("_", " ").title()


def build_audit_security_signals(
    *,
    capa: CapaNegocio,
    since,
    until,
    safe_limit: int,
) -> dict:
    access_change_actions = {
        "ACEPTAR_INVITACION",
        "CAMBIAR_CONTRASENA",
        "ELIMINAR_INVITACION",
        "INVITAR_USUARIO",
        "REEMPLAZAR_INVITACION",
        "RESTABLECER_CONTRASENA",
        "REVOCAR_INVITACION",
        "ACTUALIZAR_ROL_USUARIO",
        "DESACTIVAR_USUARIO",
        "ELIMINAR_USUARIO_CAPA",
    }
    plan_denial_actions = {"PLAN_MODULO_DENEGADO", "PLAN_FUNCION_DENEGADA"}
    security_actions = access_change_actions | plan_denial_actions | {"ACCESO_DENEGADO"}
    base_events = EventoAuditoria.objects.filter(
        capa_negocio=capa,
        fecha_creacion__gte=since,
        fecha_creacion__lte=until,
        accion__in=security_actions,
    )
    counts_by_action = dict(
        base_events.order_by()
        .values("accion")
        .annotate(total=Count("id"))
        .values_list("accion", "total")
    )
    permission_denials = EventoAuditoria.objects.filter(
        capa_negocio=capa,
        fecha_creacion__gte=since,
        fecha_creacion__lte=until,
        accion="ACCESO_DENEGADO",
    )
    plan_denials = EventoAuditoria.objects.filter(
        capa_negocio=capa,
        fecha_creacion__gte=since,
        fecha_creacion__lte=until,
        accion__in=plan_denial_actions,
    )
    permission_denial_count = int(counts_by_action.get("ACCESO_DENEGADO", 0) or 0)
    plan_denial_count = sum(
        int(counts_by_action.get(action, 0) or 0) for action in plan_denial_actions
    )
    access_change_count = sum(
        int(counts_by_action.get(action, 0) or 0) for action in access_change_actions
    )
    denied_permissions = build_audit_signal_buckets(
        permission_denials,
        "recurso_id",
        limit=5,
    )
    denied_routes = build_audit_signal_buckets(
        permission_denials,
        "metadata__ruta",
        limit=5,
    )
    blocked_plan_capabilities = build_audit_signal_buckets(
        plan_denials,
        "metadata__capability_key",
        limit=5,
    )
    latest_denials = [
        serialize_audit_event(event)
        for event in permission_denials.select_related("actor", "capa_negocio")
        .only(
            "id",
            "accion",
            "recurso_tipo",
            "recurso_id",
            "actor_id",
            "actor__email",
            "capa_negocio_id",
            "capa_negocio__nombre",
            "metadata",
            "fecha_creacion",
        )
        .order_by("-fecha_creacion", "-id")[:safe_limit]
    ]

    top_permission = denied_permissions[0]["value"] if denied_permissions else ""
    if permission_denial_count >= 5 or top_permission == "platform_admin":
        risk_level = "ALTO"
        recommended_focus = (
            "Revisar usuarios con denegaciones repetidas, rutas bloqueadas y roles "
            "asignados antes de ampliar permisos."
        )
    elif permission_denial_count or plan_denial_count or access_change_count >= 3:
        risk_level = "MEDIO"
        recommended_focus = (
            "Confirmar que los roles actuales explican las denegaciones y que los "
            "cambios de acceso fueron intencionales."
        )
    else:
        risk_level = "BAJO"
        recommended_focus = (
            "Sin friccion relevante de permisos en la ventana revisada."
        )

    if plan_denial_count and not permission_denial_count:
        recommended_focus = (
            "Revisar plan, overrides y funciones bloqueadas antes de escalar permisos "
            "de usuario."
        )

    return {
        "riesgo": risk_level,
        "foco_recomendado": recommended_focus,
        "permisos_denegados": permission_denial_count,
        "plan_denegado": plan_denial_count,
        "cambios_acceso": access_change_count,
        "permisos_mas_denegados": denied_permissions,
        "rutas_mas_denegadas": denied_routes,
        "funciones_plan_bloqueadas": blocked_plan_capabilities,
        "primera_denegacion_id": latest_denials[0]["id"] if latest_denials else None,
        "ultimas_denegaciones": latest_denials,
    }


class PasswordRecoveryRequestIn(Schema):
    email: str


class PasswordRecoveryConfirmIn(Schema):
    password: str
    password_confirm: str


class PasswordChangeIn(Schema):
    current_password: str
    password: str
    password_confirm: str


class TwoFactorVerifyIn(Schema):
    challenge_token: UUID
    codigo: str


class TwoFactorResendIn(Schema):
    challenge_token: UUID


class PlatformAdminInviteIn(Schema):
    email: str
    nombre_sugerido: str = ""
    replace_existing: bool = False


class PlatformAdminInvitationAcceptIn(Schema):
    nombre: str = ""
    password: str = ""
    password_confirm: str = ""


for schema in (
    BootstrapIn,
    LoginIn,
    TrialRegisterIn,
    CheckoutRegisterIn,
    GoogleLoginIn,
    GoogleTrialRegisterIn,
    GoogleCheckoutRegisterIn,
    RefreshTokenIn,
    InvitationAcceptIn,
    InviteMemberIn,
    MembershipRoleIn,
    PasswordRecoveryRequestIn,
    PasswordRecoveryConfirmIn,
    PasswordChangeIn,
    TwoFactorVerifyIn,
    TwoFactorResendIn,
    PlatformAdminInviteIn,
    PlatformAdminInvitationAcceptIn,
):
    schema.model_rebuild()


def normalize_email(email: str) -> str:
    return (email or "").strip().lower()


def find_user_for_login_identifier(
    access_identifier: str,
    *,
    request=None,
    timing_prefix: str = "login.user_lookup",
) -> User | None:
    queryset = User.objects.select_related("perfil_acceso")
    started = perf_timer.monotonic()
    user = queryset.filter(username=access_identifier).first()
    if request is not None:
        mark_request_timing(request, f"{timing_prefix}.username_exact", started)
    if user is not None:
        return user

    started = perf_timer.monotonic()
    user = queryset.filter(email__iexact=access_identifier).first()
    if request is not None:
        mark_request_timing(request, f"{timing_prefix}.email_fallback", started)
    return user


def mask_email(email: str) -> str:
    clean_email = normalize_email(email)
    if "@" not in clean_email:
        return clean_email

    local_part, domain = clean_email.split("@", 1)
    if len(local_part) <= 2:
        masked_local = f"{local_part[0]}*" if local_part else "*"
    else:
        masked_local = f"{local_part[:2]}{'*' * max(len(local_part) - 2, 2)}"
    return f"{masked_local}@{domain}"


def validate_password_input(
    *,
    password: str,
    password_confirm: str = "",
    user: User | None = None,
) -> None:
    clean_password = (password or "").strip()
    clean_confirm = (password_confirm or "").strip()

    if not clean_password:
        raise HttpError(400, "Debes definir una contrasena para continuar.")
    if clean_password != clean_confirm:
        raise HttpError(400, "La confirmacion de contrasena no coincide.")

    try:
        password_validation.validate_password(clean_password, user=user)
    except Exception as exc:
        messages = getattr(exc, "messages", None)
        if messages:
            raise HttpError(400, " ".join(str(message) for message in messages))
        raise


def ensure_profile(user: User) -> UsuarioPerfil:
    try:
        return user.perfil_acceso
    except UsuarioPerfil.DoesNotExist:
        pass
    profile, _ = UsuarioPerfil.objects.get_or_create(user=user)
    return profile


def expire_pending_invitations(
    *,
    capa: CapaNegocio | None = None,
    email: str | None = None,
) -> None:
    queryset = InvitacionAcceso.objects.filter(
        estatus="PENDIENTE",
        expira_en__lt=timezone.now(),
    )
    if capa is not None:
        queryset = queryset.filter(capa_negocio=capa)
    if email:
        queryset = queryset.filter(email=normalize_email(email))

    for invitation in queryset:
        invitation.estatus = "EXPIRADA"
        invitation.save(update_fields=["estatus", "fecha_actualizacion"])


def expire_pending_platform_admin_invitations(*, email: str | None = None) -> None:
    queryset = InvitacionAdminPlataforma.objects.filter(
        estatus="PENDIENTE",
        expira_en__lt=timezone.now(),
    )
    if email:
        queryset = queryset.filter(email__iexact=email)

    for invitation in queryset:
        invitation.estatus = "EXPIRADA"
        invitation.save(update_fields=["estatus", "fecha_actualizacion"])


def apply_profile_defaults(
    user: User,
    *,
    nombre: str = "",
    google_sub: str | None = None,
    avatar_url: str | None = None,
    email_verificado: bool | None = None,
    es_admin_plataforma: bool | None = None,
) -> UsuarioPerfil:
    profile = ensure_profile(user)
    updates: list[str] = []

    clean_name = (nombre or "").strip()
    if clean_name and profile.nombre_mostrado != clean_name:
        profile.nombre_mostrado = clean_name
        updates.append("nombre_mostrado")
        if not user.first_name:
            user.first_name = clean_name
            user.save(update_fields=["first_name"])

    if google_sub and profile.google_sub != google_sub:
        profile.google_sub = google_sub
        updates.append("google_sub")

    if avatar_url and profile.avatar_url != avatar_url:
        profile.avatar_url = avatar_url
        updates.append("avatar_url")

    if email_verificado is not None and profile.email_verificado != email_verificado:
        profile.email_verificado = email_verificado
        updates.append("email_verificado")
    if (
        es_admin_plataforma is not None
        and profile.es_admin_plataforma != es_admin_plataforma
    ):
        profile.es_admin_plataforma = es_admin_plataforma
        updates.append("es_admin_plataforma")

    if updates:
        updates.append("fecha_actualizacion")
        profile.save(update_fields=updates)
    return profile


def create_user_from_email(email: str, *, password: str = "", nombre: str = "") -> User:
    clean_email = normalize_email(email)
    if not clean_email:
        raise HttpError(400, "El correo es obligatorio.")

    user = User(
        username=clean_email,
        email=clean_email,
        first_name=(nombre or "").strip()[:150],
        is_active=True,
    )
    if password.strip():
        user.set_password(password)
    else:
        user.set_unusable_password()
    user.save()
    apply_profile_defaults(user, nombre=nombre)
    return user


def build_unique_capa_name(base_name: str, email: str) -> str:
    clean_base = (base_name or "").strip() or "Mi operadora"
    if not CapaNegocio.objects.filter(nombre__iexact=clean_base).exists():
        return clean_base

    email_prefix = normalize_email(email).split("@", 1)[0] or "cuenta"
    candidate = f"{clean_base} - {email_prefix}"[:180]
    if not CapaNegocio.objects.filter(nombre__iexact=candidate).exists():
        return candidate

    for index in range(2, 100):
        suffix = f" {index}"
        candidate = f"{clean_base[: 180 - len(suffix)]}{suffix}"
        if not CapaNegocio.objects.filter(nombre__iexact=candidate).exists():
            return candidate

    raise HttpError(
        400,
        "No pudimos preparar el nombre del negocio. Intenta con un nombre mas especifico.",
    )


def normalize_periodicidad(value: str) -> str:
    return "ANUAL" if (value or "").strip().upper() == "ANUAL" else "MENSUAL"


def resolve_checkout_plan(plan_id: int | None):
    from billing.models import PlanSaaS
    from billing.services import get_default_plan

    if plan_id:
        plan = PlanSaaS.objects.filter(id=plan_id, activo=True).first()
        if not plan:
            raise HttpError(400, "El plan seleccionado no esta disponible.")
        return plan
    return get_default_plan()


def create_pending_checkout_subscription(
    capa: CapaNegocio,
    *,
    plan_id: int | None,
    periodicidad: str,
):
    from billing.services import create_pending_checkout_subscription_for_capa

    plan = resolve_checkout_plan(plan_id)
    return create_pending_checkout_subscription_for_capa(
        capa,
        plan=plan,
        periodicidad=normalize_periodicidad(periodicidad),
    )


def require_public_trial_registration_enabled() -> None:
    if not getattr(settings, "PUBLIC_TRIAL_REGISTRATION_ENABLED", False):
        raise HttpError(
            403,
            "Las pruebas gratuitas se habilitan despues de una demo con el equipo BetterP.",
        )


def has_two_factor_enabled(
    memberships: list[MembresiaCapaNegocio] | tuple[MembresiaCapaNegocio, ...],
) -> bool:
    return any(
        membership.capa_negocio.seguridad_doble_factor_activa for membership in memberships
    )


def serialize_membership(membership: MembresiaCapaNegocio) -> dict:
    capa = membership.capa_negocio
    entidades_count = getattr(membership, "entidades_count", None)
    if entidades_count is None:
        entidades_count = capa.entidades.count()
    return {
        "id": membership.id,
        "rol": membership.rol,
        "activo": membership.activo,
        "ultimo_acceso": membership.ultimo_acceso,
        "invitacion_aceptada_en": membership.invitacion_aceptada_en,
        "capa_negocio": {
            "id": capa.id,
            "nombre": capa.nombre,
            "tipo_capa": capa.tipo_capa,
            "activo": capa.activo,
            "entidades_count": entidades_count,
        },
    }


def serialize_user(user: User) -> dict:
    profile = ensure_profile(user)
    display_name = (
        profile.nombre_mostrado
        or user.get_full_name()
        or user.email
        or user.username
    )
    initials = "".join(
        token[0]
        for token in display_name.replace("-", " ").split()
        if token
    )[:2].upper() or "US"
    return {
        "id": user.id,
        "email": user.email,
        "nombre": display_name,
        "avatar_url": profile.avatar_url,
        "email_verificado": profile.email_verificado,
        "es_admin_plataforma": profile.es_admin_plataforma,
        "initials": initials,
        "is_platform_admin": is_platform_admin_user(user),
    }


def revoke_active_sessions_for_user(user_id: int) -> int:
    return SesionAcceso.objects.filter(
        user_id=user_id,
        revoked_at__isnull=True,
    ).update(revoked_at=timezone.now())


def build_session_payload(
    request,
    session,
    *,
    include_tokens: bool = True,
    memberships: list[MembresiaCapaNegocio] | None = None,
) -> dict:
    if memberships is None:
        memberships = list(
            membership_session_queryset(include_entity_counts=True)
            .filter(
                user=session.user,
                activo=True,
                capa_negocio__activo=True,
            )
            .order_by("capa_negocio__nombre", "id")
        )
    current_membership = resolve_current_membership(request, memberships)
    serialized_memberships = [serialize_membership(membership) for membership in memberships]
    serialized_memberships_by_id = {
        item["id"]: item for item in serialized_memberships
    }
    payload = {
        "user": serialize_user(session.user),
        "memberships": serialized_memberships,
        "current_membership": (
            serialized_memberships_by_id.get(current_membership.id)
            if current_membership
            else None
        ),
        "session": {
            "session_key": str(session.session_key),
            "provider": session.proveedor,
            "refresh_expires_at": session.refresh_expires_at,
        },
    }
    if include_tokens:
        payload["tokens"] = issue_token_pair(session)
    return payload


def create_membership_for_user(
    user: User,
    capa: CapaNegocio,
    *,
    rol: str,
) -> MembresiaCapaNegocio:
    membership = MembresiaCapaNegocio.objects.filter(
        user=user,
        capa_negocio=capa,
    ).first()
    if membership is None:
        assert_plan_capacity(capa, "usuarios")
        membership = MembresiaCapaNegocio.objects.create(
            user=user,
            capa_negocio=capa,
            rol=rol,
            activo=True,
            invitacion_aceptada_en=timezone.now(),
        )
    else:
        if not membership.activo:
            assert_plan_capacity(capa, "usuarios")
        membership.rol = rol
        membership.activo = True
        if membership.invitacion_aceptada_en is None:
            membership.invitacion_aceptada_en = timezone.now()
        membership.save(
            update_fields=[
                "rol",
                "activo",
                "invitacion_aceptada_en",
                "fecha_actualizacion",
            ]
        )
    return membership


def mark_invitation_as_accepted(
    invitation: InvitacionAcceso,
    membership: MembresiaCapaNegocio,
) -> InvitacionAcceso:
    invitation.membership_relacionada = membership
    invitation.estatus = "ACEPTADA"
    invitation.save(
        update_fields=[
            "membership_relacionada",
            "estatus",
            "fecha_actualizacion",
        ]
    )
    if membership.invitacion_aceptada_en is None:
        membership.invitacion_aceptada_en = timezone.now()
        membership.save(update_fields=["invitacion_aceptada_en", "fecha_actualizacion"])
    return invitation


def sync_pending_invitations_for_user(user: User) -> list[MembresiaCapaNegocio]:
    email = normalize_email(user.email)
    if not email:
        return []
    invitations = list(
        InvitacionAcceso.objects.select_related("capa_negocio")
        .only(
            "id",
            "email",
            "rol",
            "estatus",
            "expira_en",
            "capa_negocio_id",
            "capa_negocio__id",
            "capa_negocio__nombre",
            "capa_negocio__activo",
            "capa_negocio__usuario_fundador_id",
        )
        .filter(email=email, estatus="PENDIENTE")
        .order_by("fecha_creacion")
    )
    created_memberships: list[MembresiaCapaNegocio] = []
    for invitation in invitations:
        if invitation.expira_en < timezone.now():
            invitation.estatus = "EXPIRADA"
            invitation.save(update_fields=["estatus", "fecha_actualizacion"])
            continue
        try:
            membership = create_membership_for_user(
                user,
                invitation.capa_negocio,
                rol=invitation.rol,
            )
        except HttpError:
            continue
        mark_invitation_as_accepted(invitation, membership)
        created_memberships.append(membership)
    return created_memberships


def sync_founder_memberships_for_user(user: User) -> list[MembresiaCapaNegocio]:
    founder_capas = list(
        CapaNegocio.objects.filter(activo=True)
        .only(
            "id",
            "nombre",
            "activo",
            "correo_contacto",
            "usuario_fundador_id",
        )
        .filter(
            Q(usuario_fundador_id=user.id)
            | Q(usuario_fundador__isnull=True, correo_contacto__iexact=user.email)
        )
        .order_by("nombre", "id")
    )

    recovered_memberships: list[MembresiaCapaNegocio] = []
    for capa in founder_capas:
        if capa.usuario_fundador_id is None:
            capa.usuario_fundador = user
            capa.save(update_fields=["usuario_fundador"])

        membership, created = MembresiaCapaNegocio.objects.get_or_create(
            user=user,
            capa_negocio=capa,
            defaults={
                "rol": ROLE_OWNER_ADMIN,
                "activo": True,
                "invitacion_aceptada_en": timezone.now(),
            },
        )
        if created:
            recovered_memberships.append(membership)
            continue

        updates: list[str] = []
        if membership.rol != ROLE_OWNER_ADMIN:
            membership.rol = ROLE_OWNER_ADMIN
            updates.append("rol")
        if not membership.activo:
            membership.activo = True
            updates.append("activo")
        if membership.invitacion_aceptada_en is None:
            membership.invitacion_aceptada_en = timezone.now()
            updates.append("invitacion_aceptada_en")
        if updates:
            updates.append("fecha_actualizacion")
            membership.save(update_fields=updates)
        recovered_memberships.append(membership)

    return recovered_memberships


def serialize_invitation(invitation: InvitacionAcceso) -> dict:
    accept_url = f"{settings.FRONTEND_BASE_URL.rstrip('/')}/invitacion/{invitation.token}"
    return {
        "id": invitation.id,
        "email": invitation.email,
        "nombre_sugerido": invitation.nombre_sugerido,
        "rol": invitation.rol,
        "estatus": invitation.estatus,
        "expira_en": invitation.expira_en,
        "esta_vigente": invitation.esta_vigente,
        "usuario_existente": User.objects.filter(email__iexact=invitation.email).exists(),
        "token": str(invitation.token),
        "accept_url": accept_url,
        "capa_negocio": {
            "id": invitation.capa_negocio_id,
            "nombre": invitation.capa_negocio.nombre,
            "tipo_capa": invitation.capa_negocio.tipo_capa,
        },
    }


def serialize_platform_admin_user(user: User) -> dict:
    active_memberships_count = MembresiaCapaNegocio.objects.filter(
        user=user,
        activo=True,
        capa_negocio__activo=True,
    ).count()
    return {
        **serialize_user(user),
        "is_founder": is_platform_founder_user(user),
        "can_be_revoked": not is_platform_founder_user(user),
        "active_memberships_count": active_memberships_count,
        "last_login": user.last_login,
    }


def serialize_platform_admin_invitation(invitation: InvitacionAdminPlataforma) -> dict:
    accept_url = (
        f"{settings.FRONTEND_BASE_URL.rstrip('/')}/backoffice/invitacion/{invitation.token}"
    )
    return {
        "id": invitation.id,
        "email": invitation.email,
        "nombre_sugerido": invitation.nombre_sugerido,
        "estatus": invitation.estatus,
        "expira_en": invitation.expira_en,
        "esta_vigente": invitation.esta_vigente,
        "usuario_existente": User.objects.filter(email__iexact=invitation.email).exists(),
        "token": str(invitation.token),
        "accept_url": accept_url,
        "invitado_por": (
            serialize_platform_admin_user(invitation.invitado_por)
            if invitation.invitado_por
            else None
        ),
    }


def serialize_password_recovery(recovery: RecuperacionAcceso) -> dict:
    reset_url = (
        f"{settings.FRONTEND_BASE_URL.rstrip('/')}/restablecer-acceso/{recovery.token}"
    )
    return {
        "id": recovery.id,
        "email": recovery.email,
        "token": str(recovery.token),
        "estatus": recovery.estatus,
        "expira_en": recovery.expira_en,
        "esta_vigente": recovery.esta_vigente,
        "reset_url": reset_url,
    }


def serialize_two_factor_challenge(
    challenge: DesafioDobleFactor,
    *,
    detail: str = "",
) -> dict:
    return {
        "requires_two_factor": True,
        "challenge_token": str(challenge.token),
        "masked_email": mask_email(challenge.email),
        "expira_en": challenge.expira_en,
        "detail": detail
        or "Verifica el codigo que enviamos a tu correo para completar el acceso.",
    }


def send_invitation_email(invitation: InvitacionAcceso, accept_url: str) -> tuple[bool, str | None]:
    provider = get_email_provider()
    from_email = (
        (getattr(settings, "RESEND_FROM_EMAIL", "") or "").strip()
        or (getattr(settings, "DEFAULT_FROM_EMAIL", "") or "").strip()
    )
    if not from_email:
        return False, "El servicio de correo no esta configurado todavia."

    email_backend = (getattr(settings, "EMAIL_BACKEND", "") or "").strip()
    using_default_smtp = email_backend in {
        "",
        "django.core.mail.backends.smtp.EmailBackend",
    }
    if provider == "RESEND":
        if not (getattr(settings, "RESEND_API_KEY", "") or "").strip():
            return False, "El servicio de correo no esta configurado todavia."
    elif using_default_smtp and not (getattr(settings, "EMAIL_HOST", "") or "").strip():
        return False, "El servicio de correo no esta configurado todavia."

    suggested_name = (invitation.nombre_sugerido or "").strip()
    greeting_target = suggested_name or invitation.email
    subject = f"Invitacion a {invitation.capa_negocio.nombre} en BettERP"
    message = (
        f"Hola {greeting_target},\n\n"
        f"Te invitaron a acceder a la capa de negocio {invitation.capa_negocio.nombre} "
        f"con rol {invitation.get_rol_display()}.\n\n"
        f"Tu correo de acceso sera: {invitation.email}\n\n"
        f"Activa tu acceso en el siguiente enlace:\n{accept_url}\n\n"
        f"Este enlace vence el {timezone.localtime(invitation.expira_en).strftime('%d/%m/%Y %H:%M')}.\n\n"
        "Si no esperabas esta invitacion, puedes ignorar este correo."
    )

    try:
        send_email_transport(
            destination=invitation.email,
            subject=subject,
            message=message,
            sender_email=from_email,
            sender_name=(getattr(settings, "RESEND_FROM_NAME", "") or "").strip() or "BettERP",
            reply_to=(getattr(settings, "RESEND_REPLY_TO", "") or "").strip() or None,
        )
    except Exception as exc:
        return False, str(exc)

    return True, None


def send_platform_admin_invitation_email(
    invitation: InvitacionAdminPlataforma,
    accept_url: str,
) -> tuple[bool, str | None]:
    provider = get_email_provider()
    from_email = (
        (getattr(settings, "RESEND_FROM_EMAIL", "") or "").strip()
        or (getattr(settings, "DEFAULT_FROM_EMAIL", "") or "").strip()
    )
    if not from_email:
        return False, "El servicio de correo no esta configurado todavia."

    email_backend = (getattr(settings, "EMAIL_BACKEND", "") or "").strip()
    using_default_smtp = email_backend in {
        "",
        "django.core.mail.backends.smtp.EmailBackend",
    }
    if provider == "RESEND":
        if not (getattr(settings, "RESEND_API_KEY", "") or "").strip():
            return False, "El servicio de correo no esta configurado todavia."
    elif using_default_smtp and not (getattr(settings, "EMAIL_HOST", "") or "").strip():
        return False, "El servicio de correo no esta configurado todavia."

    greeting_target = (invitation.nombre_sugerido or "").strip() or invitation.email
    subject = "Invitacion al backoffice de BettERP"
    message = (
        f"Hola {greeting_target},\n\n"
        "Te invitaron a colaborar en el backoffice interno de BettERP.\n\n"
        f"Tu correo de acceso sera: {invitation.email}\n\n"
        f"Activa tu acceso desde este enlace:\n{accept_url}\n\n"
        f"Este enlace vence el {timezone.localtime(invitation.expira_en).strftime('%d/%m/%Y %H:%M')}.\n\n"
        "Si no esperabas esta invitacion, puedes ignorar este mensaje."
    )

    try:
        send_email_transport(
            destination=invitation.email,
            subject=subject,
            message=message,
            sender_email=from_email,
            sender_name=(getattr(settings, "RESEND_FROM_NAME", "") or "").strip() or "BettERP",
            reply_to=(getattr(settings, "RESEND_REPLY_TO", "") or "").strip() or None,
        )
    except Exception as exc:
        return False, str(exc)

    return True, None


def send_password_recovery_email(
    recovery: RecuperacionAcceso,
) -> tuple[bool, str | None]:
    from billing.emails import build_betterp_email_html

    from_email = (
        (getattr(settings, "RESEND_FROM_EMAIL", "") or "").strip()
        or (getattr(settings, "DEFAULT_FROM_EMAIL", "") or "").strip()
    )
    if not from_email:
        return False, "El servicio de correo no esta configurado todavia."

    reset_url = (
        f"{settings.FRONTEND_BASE_URL.rstrip('/')}/restablecer-acceso/{recovery.token}"
    )
    expires_at = timezone.localtime(recovery.expira_en).strftime("%d/%m/%Y %H:%M")
    subject = "Restablece tu acceso a BetterP"
    message = (
        f"Hola {recovery.user.get_full_name() or recovery.email},\n\n"
        "Recibimos una solicitud para restablecer tu contrasena de acceso a BetterP.\n\n"
        f"Correo de acceso: {recovery.email}\n"
        f"Enlace para restablecer: {reset_url}\n\n"
        f"Este enlace vence el {expires_at}.\n\n"
        "Si no reconoces esta solicitud, puedes ignorar este mensaje. Tu acceso "
        "actual no cambia hasta que definas una nueva contrasena."
    )
    html = build_betterp_email_html(
        {
            "preheader": "Usa este enlace seguro para restablecer tu acceso BetterP.",
            "eyebrow": "SEGURIDAD DE CUENTA",
            "title": "Restablece tu acceso.",
            "intro": (
                "Recibimos una solicitud para definir una nueva contrasena de acceso. "
                "El cambio solo se aplicara si usas el enlace seguro."
            ),
            "cta_label": "Definir nueva contrasena",
            "cta_url": reset_url,
            "secondary_label": "Ir a login",
            "secondary_url": f"{settings.FRONTEND_BASE_URL.rstrip('/')}/login",
            "highlight": (
                "Si no solicitaste este cambio, ignora este correo. Tu contrasena "
                "actual seguira vigente y puedes reportarlo a soporte."
            ),
            "rows": [
                ("Correo de acceso", recovery.email),
                ("Vigencia", expires_at),
                ("Accion", "Restablecer contrasena"),
            ],
            "note": (
                "Por seguridad, el enlace expira y solo puede usarse una vez. "
                "Al confirmar la nueva contrasena cerraremos otras sesiones abiertas."
            ),
        }
    )

    try:
        send_email_transport(
            destination=recovery.email,
            subject=subject,
            message=message,
            html_message=html,
            sender_email=from_email,
            sender_name=(getattr(settings, "RESEND_FROM_NAME", "") or "").strip() or "BetterP",
            reply_to=(getattr(settings, "RESEND_REPLY_TO", "") or "").strip() or None,
        )
    except Exception as exc:
        return False, str(exc)

    return True, None


def send_two_factor_email(
    challenge: DesafioDobleFactor,
) -> tuple[bool, str | None]:
    from_email = (
        (getattr(settings, "RESEND_FROM_EMAIL", "") or "").strip()
        or (getattr(settings, "DEFAULT_FROM_EMAIL", "") or "").strip()
    )
    if not from_email:
        return False, "El servicio de correo no esta configurado todavia."

    code_hint = challenge.email
    subject = "Codigo de verificacion BettERP"
    message = (
        f"Hola {challenge.user.get_full_name() or challenge.email},\n\n"
        "Para completar tu acceso necesitamos un segundo paso de verificacion.\n\n"
        f"Correo de acceso: {code_hint}\n"
        f"Codigo de verificacion: {challenge._plain_code}\n\n"
        f"Este codigo vence el {timezone.localtime(challenge.expira_en).strftime('%d/%m/%Y %H:%M')}.\n\n"
        "Si no intentaste iniciar sesion, ignora este mensaje."
    )

    try:
        send_email_transport(
            destination=challenge.email,
            subject=subject,
            message=message,
            sender_email=from_email,
            sender_name=(getattr(settings, "RESEND_FROM_NAME", "") or "").strip() or "BettERP",
            reply_to=(getattr(settings, "RESEND_REPLY_TO", "") or "").strip() or None,
        )
    except Exception as exc:
        return False, str(exc)

    return True, None


def get_invitation_or_404(token: UUID) -> InvitacionAcceso:
    invitation = get_object_or_404(
        InvitacionAcceso.objects.select_related("capa_negocio"),
        token=token,
    )
    if invitation.estatus == "PENDIENTE" and invitation.expira_en < timezone.now():
        invitation.estatus = "EXPIRADA"
        invitation.save(update_fields=["estatus", "fecha_actualizacion"])
    return invitation


def get_platform_admin_invitation_or_404(token: UUID) -> InvitacionAdminPlataforma:
    invitation = get_object_or_404(
        InvitacionAdminPlataforma.objects.select_related("invitado_por", "user_relacionado"),
        token=token,
    )
    if invitation.estatus == "PENDIENTE" and invitation.expira_en < timezone.now():
        invitation.estatus = "EXPIRADA"
        invitation.save(update_fields=["estatus", "fecha_actualizacion"])
    return invitation


def ensure_valid_invitation(invitation: InvitacionAcceso) -> InvitacionAcceso:
    if invitation.estatus != "PENDIENTE":
        raise HttpError(400, "La invitacion ya no esta disponible.")
    if invitation.expira_en < timezone.now():
        invitation.estatus = "EXPIRADA"
        invitation.save(update_fields=["estatus", "fecha_actualizacion"])
        raise HttpError(400, "La invitacion ya expiro.")
    return invitation


def ensure_valid_platform_admin_invitation(
    invitation: InvitacionAdminPlataforma,
) -> InvitacionAdminPlataforma:
    if invitation.estatus != "PENDIENTE":
        raise HttpError(400, "La invitacion de plataforma ya no esta disponible.")
    if invitation.expira_en < timezone.now():
        invitation.estatus = "EXPIRADA"
        invitation.save(update_fields=["estatus", "fecha_actualizacion"])
        raise HttpError(400, "La invitacion de plataforma ya expiro.")
    return invitation


def get_password_recovery_or_404(token: UUID) -> RecuperacionAcceso:
    recovery = get_object_or_404(
        RecuperacionAcceso.objects.select_related("user"),
        token=token,
    )
    if recovery.estatus == "PENDIENTE" and recovery.expira_en < timezone.now():
        recovery.estatus = "EXPIRADA"
        recovery.save(update_fields=["estatus", "fecha_actualizacion"])
    return recovery


def ensure_valid_password_recovery(recovery: RecuperacionAcceso) -> RecuperacionAcceso:
    if recovery.estatus != "PENDIENTE":
        raise HttpError(400, "Este enlace de recuperacion ya no esta disponible.")
    if recovery.expira_en < timezone.now():
        recovery.estatus = "EXPIRADA"
        recovery.save(update_fields=["estatus", "fecha_actualizacion"])
        raise HttpError(400, "El enlace de recuperacion ya expiro.")
    return recovery


def build_two_factor_code() -> str:
    return f"{secrets.randbelow(1000000):06d}"


def create_two_factor_challenge(
    user: User,
    *,
    provider: str,
) -> DesafioDobleFactor:
    DesafioDobleFactor.objects.filter(user=user, estatus="PENDIENTE").update(
        estatus="CANCELADO"
    )
    plain_code = build_two_factor_code()
    challenge = DesafioDobleFactor.objects.create(
        user=user,
        email=user.email,
        proveedor=provider,
        codigo_hash=make_password(plain_code),
    )
    challenge._plain_code = plain_code
    return challenge


def get_two_factor_challenge_or_404(token: UUID) -> DesafioDobleFactor:
    challenge = get_object_or_404(
        DesafioDobleFactor.objects.select_related("user"),
        token=token,
    )
    if challenge.estatus == "PENDIENTE" and challenge.expira_en < timezone.now():
        challenge.estatus = "EXPIRADO"
        challenge.save(update_fields=["estatus", "fecha_actualizacion"])
    return challenge


def ensure_valid_two_factor_challenge(
    challenge: DesafioDobleFactor,
) -> DesafioDobleFactor:
    if challenge.estatus != "PENDIENTE":
        raise HttpError(400, "El codigo de verificacion ya no esta disponible.")
    if challenge.expira_en < timezone.now():
        challenge.estatus = "EXPIRADO"
        challenge.save(update_fields=["estatus", "fecha_actualizacion"])
        raise HttpError(400, "El codigo de verificacion ya expiro.")
    if challenge.intentos >= 5:
        challenge.estatus = "CANCELADO"
        challenge.save(update_fields=["estatus", "fecha_actualizacion"])
        raise HttpError(400, "Superaste el numero de intentos permitidos.")
    return challenge


def complete_login_or_start_two_factor(
    request,
    *,
    user: User,
    provider: str,
    memberships: list[MembresiaCapaNegocio] | None = None,
):
    if memberships is None:
        memberships = resolve_memberships_for_user(
            user,
            include_entity_counts=True,
        )
    if not memberships:
        sync_founder_memberships_for_user(user)
        memberships = resolve_memberships_for_user(user, include_entity_counts=True)
    if not memberships:
        raise HttpError(
            403,
            "Tu cuenta existe, pero todavia no tiene acceso activo a ninguna capa de negocio.",
        )

    if has_two_factor_enabled(memberships):
        challenge = create_two_factor_challenge(user, provider=provider)
        email_sent, email_error = send_two_factor_email(challenge)
        if not email_sent:
            challenge.estatus = "CANCELADO"
            challenge.save(update_fields=["estatus", "fecha_actualizacion"])
            raise HttpError(
                503,
                f"No pudimos enviar el codigo de verificacion: {email_error}",
            )
        return 202, serialize_two_factor_challenge(
            challenge,
            detail=(
                "Validamos tus credenciales. Ingresa el codigo que enviamos al correo "
                f"{mask_email(user.email)} para completar el acceso."
            ),
        )

    started = perf_timer.monotonic()
    session = create_access_session(user, provider=provider, request=request)
    mark_request_timing(request, "login.session_create", started)
    started = perf_timer.monotonic()
    payload = build_session_payload(request, session, memberships=memberships)
    mark_request_timing(request, "login.payload_build", started)
    return payload


def complete_platform_login_or_start_two_factor(
    request,
    *,
    user: User,
    provider: str,
):
    memberships = resolve_memberships_for_user(user, include_entity_counts=True)
    if memberships and has_two_factor_enabled(memberships):
        challenge = create_two_factor_challenge(user, provider=provider)
        email_sent, email_error = send_two_factor_email(challenge)
        if not email_sent:
            challenge.estatus = "CANCELADO"
            challenge.save(update_fields=["estatus", "fecha_actualizacion"])
            raise HttpError(
                503,
                f"No pudimos enviar el codigo de verificacion: {email_error}",
            )
        return 202, serialize_two_factor_challenge(
            challenge,
            detail=(
                "Validamos tus credenciales del backoffice. Ingresa el codigo que "
                f"enviamos al correo {mask_email(user.email)} para completar el acceso."
            ),
        )

    session = create_access_session(user, provider=provider, request=request)
    return build_session_payload(request, session, memberships=memberships)


def authenticate_loaded_password_user(request, user: User, password: str) -> User | None:
    backends = get_backends()
    if len(backends) == 1 and isinstance(backends[0], ModelBackend):
        backend = backends[0]
        if user.check_password(password) and backend.user_can_authenticate(user):
            return user
        return None
    return authenticate(request=request, username=user.username, password=password)


def ensure_remaining_owner(capa: CapaNegocio, *, exclude_membership_id: int | None = None) -> None:
    queryset = MembresiaCapaNegocio.objects.filter(
        capa_negocio=capa,
        activo=True,
        rol=ROLE_OWNER_ADMIN,
    )
    if exclude_membership_id is not None:
        queryset = queryset.exclude(id=exclude_membership_id)
    if not queryset.exists():
        raise HttpError(
            400,
            "La capa de negocio debe conservar al menos un usuario owner admin.",
        )


def ensure_membership_is_not_founder(membership: MembresiaCapaNegocio) -> None:
    if membership.capa_negocio.usuario_fundador_id == membership.user_id:
        raise HttpError(
            400,
            "El owner admin que aperturo la cuenta no puede eliminarse ni modificar su acceso base.",
        )


def fetch_google_identity(id_token: str) -> dict:
    token = (id_token or "").strip()
    if not token:
        raise HttpError(400, "Debes enviar el token de Google.")

    try:
        response = requests.get(
            GOOGLE_TOKENINFO_URL,
            params={"id_token": token},
            timeout=15,
        )
    except requests.RequestException as exc:
        raise HttpError(502, f"No se pudo validar el token de Google: {exc}") from exc

    if response.status_code != 200:
        raise HttpError(401, "No se pudo validar la identidad de Google.")

    payload = response.json()
    if settings.GOOGLE_CLIENT_ID and payload.get("aud") != settings.GOOGLE_CLIENT_ID:
        raise HttpError(401, "El token de Google no pertenece a esta aplicacion.")
    if payload.get("email_verified") not in {"true", True, "True"}:
        raise HttpError(401, "Tu cuenta de Google debe tener correo verificado.")
    return payload


@router.get("/auth/bootstrap-status/", auth=None)
def bootstrap_status(request):
    return {
        "requires_bootstrap": not User.objects.exists(),
        "google_enabled": bool(settings.GOOGLE_CLIENT_ID),
        "google_client_id": settings.GOOGLE_CLIENT_ID,
        "frontend_base_url": settings.FRONTEND_BASE_URL,
        "public_trial_enabled": bool(
            getattr(settings, "PUBLIC_TRIAL_REGISTRATION_ENABLED", False)
        ),
    }


@router.post("/auth/bootstrap/", auth=None)
@transaction.atomic
def bootstrap_system(request, payload: BootstrapIn):
    if User.objects.exists():
        raise HttpError(400, "El sistema ya fue inicializado.")

    user = create_user_from_email(
        payload.email,
        password=payload.password,
        nombre=payload.nombre,
    )
    profile = ensure_profile(user)
    profile.email_verificado = True
    profile.save(update_fields=["email_verificado", "fecha_actualizacion"])

    capa = CapaNegocio.objects.create(
        nombre=payload.nombre_capa.strip() or "Mi operadora",
        tipo_capa=payload.tipo_capa,
        nombre_administrador=(payload.nombre or "").strip() or None,
        correo_contacto=user.email,
        usuario_fundador=user,
        activo=True,
    )
    membership = create_membership_for_user(user, capa, rol=ROLE_OWNER_ADMIN)
    audit(
        actor=user,
        capa=capa,
        accion="BOOTSTRAP_SISTEMA",
        recurso_tipo="CapaNegocio",
        recurso_id=capa.id,
        metadata={"membership_id": membership.id},
    )

    session = create_access_session(user, provider="BOOTSTRAP", request=request)
    return build_session_payload(request, session)


@router.post("/auth/trial-register/", auth=None)
@transaction.atomic
def register_trial_account(request, payload: TrialRegisterIn):
    require_public_trial_registration_enabled()
    email = normalize_email(payload.email)
    nombre = (payload.nombre or "").strip()
    nombre_capa = (payload.nombre_capa or "").strip()
    tipo_capa = (payload.tipo_capa or "OPERADORA").strip().upper()
    telefono = (payload.telefono or "").strip()

    if not nombre:
        raise HttpError(400, "Debes indicar tu nombre para crear la cuenta.")
    if not email:
        raise HttpError(400, "Debes indicar un correo valido para crear la cuenta.")
    consume_auth_rate_limit(
        request,
        scope="trial_register",
        identifier=email,
        limit=settings.AUTH_RATE_LIMIT_REGISTRATION_ATTEMPTS,
        window_seconds=settings.AUTH_RATE_LIMIT_REGISTRATION_WINDOW_SECONDS,
        message="Detectamos demasiados registros recientes. Espera unos minutos antes de volver a intentar.",
    )
    if not nombre_capa:
        raise HttpError(400, "Debes indicar el nombre de tu negocio.")
    if tipo_capa not in {choice for choice, _ in CapaNegocio.TIPO_CAPA_CHOICES}:
        tipo_capa = "OPERADORA"
    if User.objects.filter(Q(email__iexact=email) | Q(username__iexact=email)).exists():
        raise HttpError(
            409,
            "Este correo ya tiene una cuenta en BettERP. Inicia sesion o recupera tu contrasena para continuar.",
        )

    validate_password_input(
        password=payload.password,
        password_confirm=payload.password_confirm,
    )
    user = create_user_from_email(email, password=payload.password, nombre=nombre)
    capa = CapaNegocio.objects.create(
        nombre=build_unique_capa_name(nombre_capa, email),
        tipo_capa=tipo_capa,
        nombre_administrador=nombre,
        correo_contacto=email,
        telefono_contacto=telefono or None,
        usuario_fundador=user,
        activo=True,
    )
    membership = create_membership_for_user(user, capa, rol=ROLE_OWNER_ADMIN)

    from billing.services import get_or_create_subscription_for_capa

    subscription = get_or_create_subscription_for_capa(capa)
    audit(
        actor=user,
        capa=capa,
        accion="REGISTRO_PRUEBA_SAAS",
        recurso_tipo="SuscripcionCapa",
        recurso_id=subscription.id,
        metadata={
            "membership_id": membership.id,
            "subscription_status": subscription.estatus,
            "trial_ends_on": (
                subscription.fecha_fin_periodo_actual.isoformat()
                if subscription.fecha_fin_periodo_actual
                else None
            ),
        },
    )

    session = create_access_session(user, provider="PASSWORD", request=request)
    return build_session_payload(request, session)


@router.post("/auth/trial-register/google/", auth=None)
@transaction.atomic
def register_trial_account_google(request, payload: GoogleTrialRegisterIn):
    require_public_trial_registration_enabled()
    assert_auth_rate_limit(
        request,
        scope="trial_register_google",
        limit=settings.AUTH_RATE_LIMIT_REGISTRATION_ATTEMPTS,
        window_seconds=settings.AUTH_RATE_LIMIT_REGISTRATION_WINDOW_SECONDS,
    )
    try:
        google_payload = fetch_google_identity(payload.id_token)
    except HttpError:
        record_auth_rate_limit_failure(
            request,
            scope="trial_register_google",
            limit=settings.AUTH_RATE_LIMIT_REGISTRATION_ATTEMPTS,
            window_seconds=settings.AUTH_RATE_LIMIT_REGISTRATION_WINDOW_SECONDS,
        )
        raise
    email = normalize_email(str(google_payload.get("email") or ""))
    nombre = str(google_payload.get("name") or "").strip()
    picture = str(google_payload.get("picture") or "").strip() or None
    google_sub = str(google_payload.get("sub") or "").strip()
    nombre_capa = (payload.nombre_capa or "").strip()
    tipo_capa = (payload.tipo_capa or "OPERADORA").strip().upper()
    telefono = (payload.telefono or "").strip()

    if not email:
        raise HttpError(401, "Google no regreso un correo utilizable para crear la cuenta.")
    consume_auth_rate_limit(
        request,
        scope="trial_register_google",
        identifier=email,
        limit=settings.AUTH_RATE_LIMIT_REGISTRATION_ATTEMPTS,
        window_seconds=settings.AUTH_RATE_LIMIT_REGISTRATION_WINDOW_SECONDS,
        message="Detectamos demasiados registros recientes. Espera unos minutos antes de volver a intentar.",
    )
    if not nombre_capa:
        raise HttpError(400, "Debes indicar el nombre de tu negocio.")
    if tipo_capa not in {choice for choice, _ in CapaNegocio.TIPO_CAPA_CHOICES}:
        tipo_capa = "OPERADORA"
    if User.objects.filter(Q(email__iexact=email) | Q(username__iexact=email)).exists():
        raise HttpError(
            409,
            "Este correo ya tiene una cuenta en BettERP. Inicia sesion para contratar o cambiar tu plan.",
        )
    if google_sub and UsuarioPerfil.objects.filter(google_sub=google_sub).exists():
        raise HttpError(
            409,
            "Esta cuenta de Google ya esta vinculada a otro acceso de BettERP.",
        )

    user = create_user_from_email(email, nombre=nombre)
    apply_profile_defaults(
        user,
        nombre=nombre,
        google_sub=google_sub,
        avatar_url=picture,
        email_verificado=True,
    )
    capa = CapaNegocio.objects.create(
        nombre=build_unique_capa_name(nombre_capa, email),
        tipo_capa=tipo_capa,
        nombre_administrador=nombre or None,
        correo_contacto=email,
        telefono_contacto=telefono or None,
        usuario_fundador=user,
        activo=True,
    )
    membership = create_membership_for_user(user, capa, rol=ROLE_OWNER_ADMIN)

    from billing.services import get_or_create_subscription_for_capa

    subscription = get_or_create_subscription_for_capa(capa)
    audit(
        actor=user,
        capa=capa,
        accion="REGISTRO_PRUEBA_GOOGLE_SAAS",
        recurso_tipo="SuscripcionCapa",
        recurso_id=subscription.id,
        metadata={
            "membership_id": membership.id,
            "subscription_status": subscription.estatus,
            "trial_ends_on": (
                subscription.fecha_fin_periodo_actual.isoformat()
                if subscription.fecha_fin_periodo_actual
                else None
            ),
        },
    )

    session = create_access_session(user, provider="GOOGLE", request=request)
    return build_session_payload(request, session)


@router.post("/auth/checkout-register/", auth=None)
@transaction.atomic
def register_checkout_account(request, payload: CheckoutRegisterIn):
    email = normalize_email(payload.email)
    nombre = (payload.nombre or "").strip()
    nombre_capa = (payload.nombre_capa or "").strip()
    tipo_capa = (payload.tipo_capa or "OPERADORA").strip().upper()
    telefono = (payload.telefono or "").strip()

    if not nombre:
        raise HttpError(400, "Debes indicar tu nombre para crear la cuenta.")
    if not email:
        raise HttpError(400, "Debes indicar un correo valido para crear la cuenta.")
    consume_auth_rate_limit(
        request,
        scope="checkout_register",
        identifier=email,
        limit=settings.AUTH_RATE_LIMIT_REGISTRATION_ATTEMPTS,
        window_seconds=settings.AUTH_RATE_LIMIT_REGISTRATION_WINDOW_SECONDS,
        message="Detectamos demasiados registros recientes. Espera unos minutos antes de volver a intentar.",
    )
    if not nombre_capa:
        raise HttpError(400, "Debes indicar el nombre de tu negocio.")
    if tipo_capa not in {choice for choice, _ in CapaNegocio.TIPO_CAPA_CHOICES}:
        tipo_capa = "OPERADORA"
    if User.objects.filter(Q(email__iexact=email) | Q(username__iexact=email)).exists():
        raise HttpError(
            409,
            "Este correo ya tiene una cuenta en BettERP. Inicia sesion para contratar o cambiar tu plan.",
        )

    validate_password_input(
        password=payload.password,
        password_confirm=payload.password_confirm,
    )
    user = create_user_from_email(email, password=payload.password, nombre=nombre)
    capa = CapaNegocio.objects.create(
        nombre=build_unique_capa_name(nombre_capa, email),
        tipo_capa=tipo_capa,
        nombre_administrador=nombre,
        correo_contacto=email,
        telefono_contacto=telefono or None,
        usuario_fundador=user,
        activo=True,
    )
    membership = create_membership_for_user(user, capa, rol=ROLE_OWNER_ADMIN)
    subscription = create_pending_checkout_subscription(
        capa,
        plan_id=payload.plan_id,
        periodicidad=payload.periodicidad,
    )
    audit(
        actor=user,
        capa=capa,
        accion="REGISTRO_CHECKOUT_SAAS",
        recurso_tipo="SuscripcionCapa",
        recurso_id=subscription.id,
        metadata={
            "membership_id": membership.id,
            "subscription_status": subscription.estatus,
            "plan_id": subscription.plan_id,
            "periodicidad": subscription.periodicidad,
        },
    )
    from billing.emails import queue_checkout_registration_email

    queue_checkout_registration_email(
        subscription.id,
        user_id=user.id,
        provider="PASSWORD",
    )

    session = create_access_session(user, provider="PASSWORD", request=request)
    return build_session_payload(request, session)


@router.post("/auth/checkout-register/google/", auth=None)
@transaction.atomic
def register_checkout_account_google(request, payload: GoogleCheckoutRegisterIn):
    assert_auth_rate_limit(
        request,
        scope="checkout_register_google",
        limit=settings.AUTH_RATE_LIMIT_REGISTRATION_ATTEMPTS,
        window_seconds=settings.AUTH_RATE_LIMIT_REGISTRATION_WINDOW_SECONDS,
    )
    try:
        google_payload = fetch_google_identity(payload.id_token)
    except HttpError:
        record_auth_rate_limit_failure(
            request,
            scope="checkout_register_google",
            limit=settings.AUTH_RATE_LIMIT_REGISTRATION_ATTEMPTS,
            window_seconds=settings.AUTH_RATE_LIMIT_REGISTRATION_WINDOW_SECONDS,
        )
        raise
    email = normalize_email(str(google_payload.get("email") or ""))
    nombre = str(google_payload.get("name") or "").strip()
    picture = str(google_payload.get("picture") or "").strip() or None
    google_sub = str(google_payload.get("sub") or "").strip()
    nombre_capa = (payload.nombre_capa or "").strip()
    tipo_capa = (payload.tipo_capa or "OPERADORA").strip().upper()
    telefono = (payload.telefono or "").strip()

    if not email:
        raise HttpError(401, "Google no regreso un correo utilizable para crear la cuenta.")
    consume_auth_rate_limit(
        request,
        scope="checkout_register_google",
        identifier=email,
        limit=settings.AUTH_RATE_LIMIT_REGISTRATION_ATTEMPTS,
        window_seconds=settings.AUTH_RATE_LIMIT_REGISTRATION_WINDOW_SECONDS,
        message="Detectamos demasiados registros recientes. Espera unos minutos antes de volver a intentar.",
    )
    if not nombre_capa:
        raise HttpError(400, "Debes indicar el nombre de tu negocio.")
    if tipo_capa not in {choice for choice, _ in CapaNegocio.TIPO_CAPA_CHOICES}:
        tipo_capa = "OPERADORA"
    if User.objects.filter(Q(email__iexact=email) | Q(username__iexact=email)).exists():
        raise HttpError(
            409,
            "Este correo ya tiene una cuenta en BettERP. Inicia sesion para contratar o cambiar tu plan.",
        )
    if google_sub and UsuarioPerfil.objects.filter(google_sub=google_sub).exists():
        raise HttpError(
            409,
            "Esta cuenta de Google ya esta vinculada a otro acceso de BettERP.",
        )

    user = create_user_from_email(email, nombre=nombre)
    apply_profile_defaults(
        user,
        nombre=nombre,
        google_sub=google_sub,
        avatar_url=picture,
        email_verificado=True,
    )
    capa = CapaNegocio.objects.create(
        nombre=build_unique_capa_name(nombre_capa, email),
        tipo_capa=tipo_capa,
        nombre_administrador=nombre or None,
        correo_contacto=email,
        telefono_contacto=telefono or None,
        usuario_fundador=user,
        activo=True,
    )
    membership = create_membership_for_user(user, capa, rol=ROLE_OWNER_ADMIN)
    subscription = create_pending_checkout_subscription(
        capa,
        plan_id=payload.plan_id,
        periodicidad=payload.periodicidad,
    )
    audit(
        actor=user,
        capa=capa,
        accion="REGISTRO_CHECKOUT_GOOGLE_SAAS",
        recurso_tipo="SuscripcionCapa",
        recurso_id=subscription.id,
        metadata={
            "membership_id": membership.id,
            "subscription_status": subscription.estatus,
            "plan_id": subscription.plan_id,
            "periodicidad": subscription.periodicidad,
        },
    )
    from billing.emails import queue_checkout_registration_email

    queue_checkout_registration_email(
        subscription.id,
        user_id=user.id,
        provider="GOOGLE",
    )

    session = create_access_session(user, provider="GOOGLE", request=request)
    return build_session_payload(request, session)


@router.post("/auth/login/", auth=None, response={200: dict, 202: dict})
def login(request, payload: LoginIn):
    total_started = perf_timer.monotonic()
    access_identifier = normalize_email(payload.email)
    if not access_identifier or not payload.password:
        raise HttpError(400, "Debes proporcionar correo y contrasena.")
    started = perf_timer.monotonic()
    assert_auth_rate_limit(
        request,
        scope="login",
        identifier=access_identifier,
        limit=settings.AUTH_RATE_LIMIT_LOGIN_ATTEMPTS,
        window_seconds=settings.AUTH_RATE_LIMIT_LOGIN_WINDOW_SECONDS,
    )
    mark_request_timing(request, "login.rate_limit", started)

    started = perf_timer.monotonic()
    user = find_user_for_login_identifier(access_identifier, request=request)
    mark_request_timing(request, "login.user_lookup", started)
    if not user:
        mark_request_timing(request, "login.total", total_started)
        record_auth_rate_limit_failure(
            request,
            scope="login",
            identifier=access_identifier,
            limit=settings.AUTH_RATE_LIMIT_LOGIN_ATTEMPTS,
            window_seconds=settings.AUTH_RATE_LIMIT_LOGIN_WINDOW_SECONDS,
        )
        raise HttpError(401, "No encontramos un usuario con ese correo de acceso.")

    started = perf_timer.monotonic()
    authenticated = authenticate_loaded_password_user(request, user, payload.password)
    mark_request_timing(request, "login.password_auth", started)
    if not authenticated or not authenticated.is_active:
        mark_request_timing(request, "login.total", total_started)
        record_auth_rate_limit_failure(
            request,
            scope="login",
            identifier=access_identifier,
            limit=settings.AUTH_RATE_LIMIT_LOGIN_ATTEMPTS,
            window_seconds=settings.AUTH_RATE_LIMIT_LOGIN_WINDOW_SECONDS,
        )
        raise HttpError(401, "Las credenciales no son validas.")
    started = perf_timer.monotonic()
    clear_auth_rate_limit(request, scope="login", identifier=access_identifier)
    mark_request_timing(request, "login.clear_rate_limit", started)

    started = perf_timer.monotonic()
    sync_pending_invitations_for_user(authenticated)
    mark_request_timing(request, "login.invitation_sync", started)
    started = perf_timer.monotonic()
    memberships = resolve_memberships_for_user(
        authenticated,
        include_entity_counts=True,
    )
    mark_request_timing(request, "login.membership_lookup", started)
    started = perf_timer.monotonic()
    response = complete_login_or_start_two_factor(
        request,
        user=authenticated,
        provider="PASSWORD",
        memberships=memberships,
    )
    mark_request_timing(request, "login.session_payload", started)
    mark_request_timing(request, "login.total", total_started)
    return response


@router.post("/auth/platform/login/", auth=None, response={200: dict, 202: dict})
def login_platform(request, payload: LoginIn):
    access_identifier = normalize_email(payload.email)
    if not access_identifier or not payload.password:
        raise HttpError(400, "Debes proporcionar correo y contrasena.")
    assert_auth_rate_limit(
        request,
        scope="platform_login",
        identifier=access_identifier,
        limit=settings.AUTH_RATE_LIMIT_LOGIN_ATTEMPTS,
        window_seconds=settings.AUTH_RATE_LIMIT_LOGIN_WINDOW_SECONDS,
    )

    user = find_user_for_login_identifier(access_identifier, request=request)
    if not user:
        record_auth_rate_limit_failure(
            request,
            scope="platform_login",
            identifier=access_identifier,
            limit=settings.AUTH_RATE_LIMIT_LOGIN_ATTEMPTS,
            window_seconds=settings.AUTH_RATE_LIMIT_LOGIN_WINDOW_SECONDS,
        )
        raise HttpError(401, "No encontramos un usuario con ese correo de acceso.")

    authenticated = authenticate_loaded_password_user(request, user, payload.password)
    if not authenticated or not authenticated.is_active:
        record_auth_rate_limit_failure(
            request,
            scope="platform_login",
            identifier=access_identifier,
            limit=settings.AUTH_RATE_LIMIT_LOGIN_ATTEMPTS,
            window_seconds=settings.AUTH_RATE_LIMIT_LOGIN_WINDOW_SECONDS,
        )
        raise HttpError(401, "Las credenciales no son validas.")
    if not is_platform_admin_user(authenticated):
        record_auth_rate_limit_failure(
            request,
            scope="platform_login",
            identifier=access_identifier,
            limit=settings.AUTH_RATE_LIMIT_LOGIN_ATTEMPTS,
            window_seconds=settings.AUTH_RATE_LIMIT_LOGIN_WINDOW_SECONDS,
        )
        raise HttpError(
            403,
            "Esta cuenta no tiene acceso al backoffice de plataforma.",
        )
    clear_auth_rate_limit(request, scope="platform_login", identifier=access_identifier)

    return complete_platform_login_or_start_two_factor(
        request,
        user=authenticated,
        provider="PASSWORD",
    )


@router.post("/auth/google/", auth=None, response={200: dict, 202: dict})
@transaction.atomic
def login_with_google(request, payload: GoogleLoginIn):
    assert_auth_rate_limit(
        request,
        scope="google_login",
        limit=settings.AUTH_RATE_LIMIT_GOOGLE_ATTEMPTS,
        window_seconds=settings.AUTH_RATE_LIMIT_GOOGLE_WINDOW_SECONDS,
    )
    try:
        google_payload = fetch_google_identity(payload.id_token)
    except HttpError:
        record_auth_rate_limit_failure(
            request,
            scope="google_login",
            limit=settings.AUTH_RATE_LIMIT_GOOGLE_ATTEMPTS,
            window_seconds=settings.AUTH_RATE_LIMIT_GOOGLE_WINDOW_SECONDS,
        )
        raise
    email = normalize_email(str(google_payload.get("email") or ""))
    full_name = str(google_payload.get("name") or "").strip()
    picture = str(google_payload.get("picture") or "").strip() or None
    google_sub = str(google_payload.get("sub") or "").strip()

    if not email:
        record_auth_rate_limit_failure(
            request,
            scope="google_login",
            limit=settings.AUTH_RATE_LIMIT_GOOGLE_ATTEMPTS,
            window_seconds=settings.AUTH_RATE_LIMIT_GOOGLE_WINDOW_SECONDS,
        )
        raise HttpError(401, "Google no regreso un correo utilizable para el acceso.")
    assert_auth_rate_limit(
        request,
        scope="google_login",
        identifier=email,
        limit=settings.AUTH_RATE_LIMIT_GOOGLE_ATTEMPTS,
        window_seconds=settings.AUTH_RATE_LIMIT_GOOGLE_WINDOW_SECONDS,
    )

    user = find_user_for_login_identifier(
        email,
        request=request,
        timing_prefix="google_login.user_lookup",
    )
    pending_invitations = InvitacionAcceso.objects.filter(
        email=email,
        estatus="PENDIENTE",
    ).exists()

    if user is None and User.objects.exists() and not pending_invitations:
        record_auth_rate_limit_failure(
            request,
            scope="google_login",
            identifier=email,
            limit=settings.AUTH_RATE_LIMIT_GOOGLE_ATTEMPTS,
            window_seconds=settings.AUTH_RATE_LIMIT_GOOGLE_WINDOW_SECONDS,
        )
        raise HttpError(
            403,
            "Tu cuenta de Google aun no tiene acceso autorizado. Primero te deben invitar.",
        )

    if user is None:
        user = create_user_from_email(email, nombre=full_name)

    apply_profile_defaults(
        user,
        nombre=full_name,
        google_sub=google_sub,
        avatar_url=picture,
        email_verificado=True,
    )
    sync_pending_invitations_for_user(user)
    memberships = resolve_memberships_for_user(user, include_entity_counts=True)
    if not memberships:
        record_auth_rate_limit_failure(
            request,
            scope="google_login",
            identifier=email,
            limit=settings.AUTH_RATE_LIMIT_GOOGLE_ATTEMPTS,
            window_seconds=settings.AUTH_RATE_LIMIT_GOOGLE_WINDOW_SECONDS,
        )
        raise HttpError(
            403,
            "La cuenta inicio sesion correctamente, pero no tiene acceso activo a ninguna capa.",
        )
    clear_auth_rate_limit(request, scope="google_login", identifier=email)
    clear_auth_rate_limit(request, scope="google_login")

    return complete_login_or_start_two_factor(
        request,
        user=user,
        provider="GOOGLE",
        memberships=memberships,
    )


@router.post("/auth/refresh/", auth=None)
def refresh_access(request, payload: RefreshTokenIn):
    token_payload = decode_signed_token(payload.refresh_token, kind="refresh")
    if not token_payload:
        raise HttpError(401, "El token de refresco no es valido.")

    from .models import SesionAcceso

    session = (
        SesionAcceso.objects.select_related("user")
        .filter(
            session_key=token_payload.get("session_key"),
            user_id=token_payload.get("user_id"),
            revoked_at__isnull=True,
        )
        .first()
    )
    if not session or not session.activa or not session.user.is_active:
        raise HttpError(401, "La sesion ya no esta disponible.")

    return build_session_payload(request, session)


@router.post("/auth/password-recovery/", auth=None)
@transaction.atomic
def request_password_recovery(request, payload: PasswordRecoveryRequestIn):
    email = normalize_email(payload.email)
    if not email:
        raise HttpError(400, "Debes proporcionar el correo de acceso.")
    consume_auth_rate_limit(
        request,
        scope="password_recovery",
        identifier=email,
        limit=settings.AUTH_RATE_LIMIT_PASSWORD_RECOVERY_ATTEMPTS,
        window_seconds=settings.AUTH_RATE_LIMIT_PASSWORD_RECOVERY_WINDOW_SECONDS,
        message="Demasiadas solicitudes de recuperacion. Espera unos minutos antes de volver a intentar.",
    )

    user = User.objects.filter(email__iexact=email).first()
    if user is None:
        return {
            "success": True,
            "mensaje": (
                "Si el correo existe en BettERP, enviaremos un enlace para "
                "restablecer la contrasena."
            ),
        }

    RecuperacionAcceso.objects.filter(
        user=user,
        estatus="PENDIENTE",
    ).update(estatus="CANCELADA")
    recovery = RecuperacionAcceso.objects.create(user=user, email=user.email)
    email_sent, email_error = send_password_recovery_email(recovery)
    if not email_sent:
        recovery.estatus = "CANCELADA"
        recovery.save(update_fields=["estatus", "fecha_actualizacion"])
        raise HttpError(
            503,
            f"No pudimos enviar el correo de recuperacion: {email_error}",
        )

    return {
        "success": True,
        "mensaje": (
            "Si el correo existe en BettERP, enviaremos un enlace para "
            "restablecer la contrasena."
        ),
    }


@router.get("/auth/password-recovery/{token}/", auth=None)
def get_password_recovery_detail(request, token: UUID):
    recovery = get_password_recovery_or_404(token)
    return serialize_password_recovery(recovery)


@router.post("/auth/password-recovery/{token}/confirm/", auth=None)
@transaction.atomic
def confirm_password_recovery(
    request,
    token: UUID,
    payload: PasswordRecoveryConfirmIn,
):
    from .models import SesionAcceso

    recovery = ensure_valid_password_recovery(get_password_recovery_or_404(token))
    validate_password_input(
        password=payload.password,
        password_confirm=payload.password_confirm,
        user=recovery.user,
    )

    recovery.user.set_password(payload.password)
    recovery.user.save(update_fields=["password"])
    recovery.estatus = "USADA"
    recovery.save(update_fields=["estatus", "fecha_actualizacion"])
    RecuperacionAcceso.objects.filter(
        user=recovery.user,
        estatus="PENDIENTE",
    ).exclude(id=recovery.id).update(estatus="CANCELADA")
    SesionAcceso.objects.filter(
        user=recovery.user,
        revoked_at__isnull=True,
    ).update(revoked_at=timezone.now())
    apply_profile_defaults(recovery.user, email_verificado=True)

    audit(
        actor=recovery.user,
        capa=None,
        accion="RESTABLECER_CONTRASENA",
        recurso_tipo="RecuperacionAcceso",
        recurso_id=recovery.id,
        metadata={"email": recovery.email},
    )
    return {
        "success": True,
        "mensaje": "Contrasena actualizada correctamente. Ya puedes iniciar sesion.",
    }


@router.post("/auth/password-change/")
@transaction.atomic
def change_password(request, payload: PasswordChangeIn):
    context = get_auth_context(request)
    user = context.user

    if not user.has_usable_password():
        raise HttpError(
            400,
            "Tu cuenta no tiene una contrasena local activa. Usa la recuperacion por correo para definir una.",
        )

    current_password = (payload.current_password or "").strip()
    if not current_password:
        raise HttpError(400, "Debes capturar tu contrasena actual.")
    if not user.check_password(current_password):
        raise HttpError(400, "La contrasena actual no es correcta.")

    validate_password_input(
        password=payload.password,
        password_confirm=payload.password_confirm,
        user=user,
    )

    user.set_password(payload.password)
    user.save(update_fields=["password"])
    RecuperacionAcceso.objects.filter(
        user=user,
        estatus="PENDIENTE",
    ).update(estatus="CANCELADA")

    from .models import SesionAcceso

    SesionAcceso.objects.filter(
        user=user,
        revoked_at__isnull=True,
    ).exclude(id=context.session.id).update(revoked_at=timezone.now())

    audit(
        actor=user,
        capa=context.current_membership.capa_negocio if context.current_membership else None,
        accion="CAMBIAR_CONTRASENA",
        recurso_tipo="Usuario",
        recurso_id=user.id,
        metadata={"email": user.email},
    )
    return {
        "success": True,
        "mensaje": (
            "Contrasena actualizada correctamente. Mantuvimos esta sesion abierta y cerramos las demas sesiones activas."
        ),
    }


@router.post("/auth/two-factor/verify/", auth=None)
@transaction.atomic
def verify_two_factor(request, payload: TwoFactorVerifyIn):
    challenge_identifier = str(payload.challenge_token)
    assert_auth_rate_limit(
        request,
        scope="two_factor_verify",
        identifier=challenge_identifier,
        limit=settings.AUTH_RATE_LIMIT_TWO_FACTOR_ATTEMPTS,
        window_seconds=settings.AUTH_RATE_LIMIT_TWO_FACTOR_WINDOW_SECONDS,
    )
    challenge = ensure_valid_two_factor_challenge(
        get_two_factor_challenge_or_404(payload.challenge_token)
    )
    codigo = (payload.codigo or "").strip()
    if not codigo:
        raise HttpError(400, "Debes capturar el codigo de verificacion.")

    if not check_password(codigo, challenge.codigo_hash):
        record_auth_rate_limit_failure(
            request,
            scope="two_factor_verify",
            identifier=challenge_identifier,
            limit=settings.AUTH_RATE_LIMIT_TWO_FACTOR_ATTEMPTS,
            window_seconds=settings.AUTH_RATE_LIMIT_TWO_FACTOR_WINDOW_SECONDS,
        )
        challenge.intentos += 1
        update_fields = ["intentos", "fecha_actualizacion"]
        if challenge.intentos >= 5:
            challenge.estatus = "CANCELADO"
            update_fields.append("estatus")
        challenge.save(update_fields=update_fields)
        raise HttpError(400, "El codigo de verificacion no es valido.")

    challenge.estatus = "VALIDADO"
    challenge.save(update_fields=["estatus", "fecha_actualizacion"])
    clear_auth_rate_limit(
        request,
        scope="two_factor_verify",
        identifier=challenge_identifier,
    )
    session = create_access_session(
        challenge.user,
        provider="GOOGLE" if challenge.proveedor == "GOOGLE" else "PASSWORD",
        request=request,
    )
    return build_session_payload(request, session)


@router.post("/auth/two-factor/resend/", auth=None)
@transaction.atomic
def resend_two_factor(request, payload: TwoFactorResendIn):
    consume_auth_rate_limit(
        request,
        scope="two_factor_resend",
        identifier=str(payload.challenge_token),
        limit=settings.AUTH_RATE_LIMIT_TWO_FACTOR_ATTEMPTS,
        window_seconds=settings.AUTH_RATE_LIMIT_TWO_FACTOR_WINDOW_SECONDS,
        message="Demasiados reenvios de codigo. Espera unos minutos antes de pedir otro.",
    )
    challenge = ensure_valid_two_factor_challenge(
        get_two_factor_challenge_or_404(payload.challenge_token)
    )
    plain_code = build_two_factor_code()
    challenge.codigo_hash = make_password(plain_code)
    challenge.expira_en = timezone.now() + timedelta(minutes=10)
    challenge.intentos = 0
    challenge._plain_code = plain_code
    challenge.save(update_fields=["codigo_hash", "expira_en", "intentos", "fecha_actualizacion"])
    email_sent, email_error = send_two_factor_email(challenge)
    if not email_sent:
        raise HttpError(503, f"No pudimos reenviar el codigo: {email_error}")
    return serialize_two_factor_challenge(
        challenge,
        detail=(
            "Enviamos un nuevo codigo de verificacion al correo "
            f"{mask_email(challenge.email)}."
        ),
    )


@router.get("/auth/me/")
def me(request):
    context = get_auth_context(request)
    return {
        "user": serialize_user(context.user),
        "memberships": [serialize_membership(membership) for membership in context.memberships],
        "current_membership": (
            serialize_membership(context.current_membership)
            if context.current_membership
            else None
        ),
    }


@router.post("/auth/logout/")
def logout(request):
    context = get_auth_context(request)
    revoke_access_session(context.session)
    return {"success": True, "mensaje": "Sesion cerrada correctamente."}


@router.get("/auth/invitaciones/{token}/", auth=None)
def get_invitation_detail(request, token: UUID):
    invitation = get_invitation_or_404(token)
    return serialize_invitation(invitation)


@router.post("/auth/invitaciones/{token}/aceptar/", auth=None, response={200: dict, 202: dict})
@transaction.atomic
def accept_invitation(request, token: UUID, payload: InvitationAcceptIn):
    invitation = ensure_valid_invitation(get_invitation_or_404(token))
    email = normalize_email(invitation.email)
    user = User.objects.filter(email__iexact=email).first()

    if user is None:
        validate_password_input(
            password=payload.password,
            password_confirm=payload.password_confirm,
            user=user,
        )
        user = create_user_from_email(email, password=payload.password, nombre=payload.nombre)
        apply_profile_defaults(user, nombre=payload.nombre, email_verificado=True)
    else:
        if payload.password.strip():
            validate_password_input(
                password=payload.password,
                password_confirm=payload.password_confirm,
                user=user,
            )
            user.set_password(payload.password)
            user.save(update_fields=["password"])
        elif payload.password_confirm.strip():
            raise HttpError(400, "Si vas a cambiar la contrasena, captura ambos campos.")
        apply_profile_defaults(user, nombre=payload.nombre, email_verificado=True)

    membership = create_membership_for_user(user, invitation.capa_negocio, rol=invitation.rol)
    mark_invitation_as_accepted(invitation, membership)
    audit(
        actor=user,
        capa=invitation.capa_negocio,
        accion="ACEPTAR_INVITACION",
        recurso_tipo="InvitacionAcceso",
        recurso_id=invitation.id,
        metadata={"membership_id": membership.id},
    )
    return complete_login_or_start_two_factor(
        request,
        user=user,
        provider="INVITACION",
        memberships=[membership],
    )


@router.get("/auth/platform-admins/invitaciones/{token}/", auth=None)
def get_platform_admin_invitation_detail(request, token: UUID):
    invitation = get_platform_admin_invitation_or_404(token)
    return serialize_platform_admin_invitation(invitation)


@router.post(
    "/auth/platform-admins/invitaciones/{token}/aceptar/",
    auth=None,
    response={200: dict, 202: dict},
)
@transaction.atomic
def accept_platform_admin_invitation(
    request,
    token: UUID,
    payload: PlatformAdminInvitationAcceptIn,
):
    invitation = ensure_valid_platform_admin_invitation(
        get_platform_admin_invitation_or_404(token)
    )
    email = normalize_email(invitation.email)
    user = User.objects.filter(email__iexact=email).first()

    if user is None:
        validate_password_input(
            password=payload.password,
            password_confirm=payload.password_confirm,
            user=None,
        )
        user = create_user_from_email(
            email,
            password=payload.password,
            nombre=(payload.nombre or invitation.nombre_sugerido or "").strip(),
        )
    else:
        if payload.password or payload.password_confirm:
            validate_password_input(
                password=payload.password,
                password_confirm=payload.password_confirm,
                user=user,
            )
            user.set_password(payload.password)
        elif not user.has_usable_password():
            validate_password_input(
                password=payload.password,
                password_confirm=payload.password_confirm,
                user=user,
            )
            user.set_password(payload.password)

        display_name = (payload.nombre or invitation.nombre_sugerido or "").strip()
        if display_name:
            apply_profile_defaults(user, nombre=display_name)

    update_fields: list[str] = []
    if not user.is_active:
        user.is_active = True
        update_fields.append("is_active")
    if (payload.password or payload.password_confirm) or not user.has_usable_password():
        # Si la cuenta se creo arriba ya viene guardada; aqui solo persiste cambios sobre cuentas existentes.
        if user.pk:
            update_fields.append("password")
    if update_fields:
        unique_update_fields = list(dict.fromkeys(update_fields))
        user.save(update_fields=unique_update_fields)

    invitation.user_relacionado = user
    invitation.estatus = "ACEPTADA"
    invitation.save(
        update_fields=["user_relacionado", "estatus", "fecha_actualizacion"]
    )
    InvitacionAdminPlataforma.objects.filter(
        email__iexact=email,
        estatus="PENDIENTE",
    ).exclude(id=invitation.id).update(estatus="REVOCADA")
    apply_profile_defaults(
        user,
        email_verificado=True,
        es_admin_plataforma=True,
    )
    user.refresh_from_db()

    audit(
        actor=user,
        capa=None,
        accion="ACEPTAR_INVITACION_ADMIN_PLATAFORMA",
        recurso_tipo="InvitacionAdminPlataforma",
        recurso_id=invitation.id,
        metadata={"email": invitation.email},
    )
    return complete_platform_login_or_start_two_factor(
        request,
        user=user,
        provider="INVITACION",
    )


@router.get("/platform-admins/")
def list_platform_admins(request):
    context = require_platform_admin_access(request)
    expire_pending_platform_admin_invitations()
    admins = [
        serialize_platform_admin_user(user)
        for user in get_platform_admin_users_queryset()
    ]
    invitations = [
        serialize_platform_admin_invitation(invitation)
        for invitation in InvitacionAdminPlataforma.objects.select_related("invitado_por")
        .filter(estatus="PENDIENTE")
        .order_by("-fecha_creacion", "-id")
    ]
    return {
        "platform_name": "Betterp",
        "founder_user_id": get_platform_founder_user_id(),
        "current_user_id": context.user.id,
        "admins": admins,
        "invitations": invitations,
    }


@router.post("/platform-admins/invitaciones/", response={200: dict, 409: dict})
@transaction.atomic
def invite_platform_admin(request, payload: PlatformAdminInviteIn):
    context = require_platform_admin_access(request)
    email = normalize_email(payload.email)
    if not email:
        raise HttpError(400, "Debes proporcionar el correo de acceso.")
    if email == normalize_email(context.user.email):
        raise HttpError(400, "Tu cuenta principal ya tiene acceso al backoffice.")

    existing_user = User.objects.filter(email__iexact=email).first()
    if existing_user and is_platform_admin_user(existing_user):
        raise HttpError(400, "Ese correo ya cuenta con acceso de plataforma.")

    expire_pending_platform_admin_invitations(email=email)
    pending_queryset = InvitacionAdminPlataforma.objects.filter(
        email__iexact=email,
        estatus="PENDIENTE",
    )
    if pending_queryset.exists() and not payload.replace_existing:
        invitation = pending_queryset.order_by("-fecha_creacion", "-id").first()
        return 409, {
            "code": "PLATFORM_INVITATION_ALREADY_PENDING",
            "detail": "Ya existe una invitacion pendiente para ese correo.",
            "invitation": serialize_platform_admin_invitation(invitation),
        }

    if pending_queryset.exists():
        pending_queryset.update(estatus="REVOCADA")

    invitation = InvitacionAdminPlataforma.objects.create(
        email=email,
        nombre_sugerido=(payload.nombre_sugerido or "").strip() or None,
        invitado_por=context.user,
    )
    serialized_invitation = serialize_platform_admin_invitation(invitation)
    email_sent, email_error = send_platform_admin_invitation_email(
        invitation,
        serialized_invitation["accept_url"],
    )

    audit(
        actor=context.user,
        capa=None,
        accion="INVITAR_ADMIN_PLATAFORMA",
        recurso_tipo="InvitacionAdminPlataforma",
        recurso_id=invitation.id,
        metadata={"email": invitation.email},
    )

    return {
        "mensaje": (
            "Invitacion de plataforma reemplazada y reenviada correctamente."
            if payload.replace_existing
            else "Invitacion de plataforma creada correctamente."
        ),
        "email_sent": email_sent,
        "email_error": email_error,
        "invitation": serialized_invitation,
        "accept_url": serialized_invitation["accept_url"],
    }


@router.delete("/platform-admins/invitaciones/{invitation_id}/")
@transaction.atomic
def revoke_platform_admin_invitation(request, invitation_id: int):
    context = require_platform_admin_access(request)
    invitation = get_object_or_404(
        InvitacionAdminPlataforma.objects.select_related("invitado_por"),
        id=invitation_id,
    )
    if invitation.estatus != "PENDIENTE":
        raise HttpError(400, "Solo puedes revocar invitaciones pendientes.")
    invitation.estatus = "REVOCADA"
    invitation.save(update_fields=["estatus", "fecha_actualizacion"])
    audit(
        actor=context.user,
        capa=None,
        accion="REVOCAR_INVITACION_ADMIN_PLATAFORMA",
        recurso_tipo="InvitacionAdminPlataforma",
        recurso_id=invitation.id,
        metadata={"email": invitation.email},
    )
    return {"success": True, "mensaje": "Invitacion de plataforma revocada correctamente."}


@router.delete("/platform-admins/{user_id}/")
@transaction.atomic
def revoke_platform_admin_access(request, user_id: int):
    context = require_platform_admin_access(request)
    target_user = get_object_or_404(User, id=user_id)

    if context.user.id == target_user.id:
        raise HttpError(400, "No puedes revocar tu propio acceso desde esta vista.")
    if is_platform_founder_user(target_user):
        raise HttpError(
            400,
            "La cuenta principal que aperturo la plataforma no puede perder el acceso del backoffice.",
        )
    if not is_platform_admin_user(target_user):
        raise HttpError(404, "Ese usuario ya no tiene acceso de plataforma.")

    target_profile = ensure_profile(target_user)
    if target_profile.es_admin_plataforma:
        target_profile.es_admin_plataforma = False
        target_profile.save(update_fields=["es_admin_plataforma", "fecha_actualizacion"])

    SesionAcceso.objects.filter(
        user=target_user,
        revoked_at__isnull=True,
    ).update(revoked_at=timezone.now())

    audit(
        actor=context.user,
        capa=None,
        accion="REVOCAR_ADMIN_PLATAFORMA",
        recurso_tipo="User",
        recurso_id=target_user.id,
        metadata={"email": target_user.email},
    )
    return {
        "success": True,
        "mensaje": "Acceso de plataforma removido correctamente.",
    }


@router.get("/miembros/")
def list_memberships(request):
    capa = get_current_capa(request)
    context = get_auth_context(request)
    expire_pending_invitations(capa=capa)
    memberships = list(
        MembresiaCapaNegocio.objects.select_related("user", "capa_negocio")
        .filter(capa_negocio=capa, activo=True)
        .order_by("rol", "user__email", "id")
    )
    invitations = list(
        InvitacionAcceso.objects.select_related("capa_negocio")
        .filter(
            capa_negocio=capa,
            estatus="PENDIENTE",
            expira_en__gte=timezone.now(),
        )
        .order_by("-fecha_creacion", "-id")
    )
    return {
        "capa_negocio": {"id": capa.id, "nombre": capa.nombre},
        "memberships": [
            {
                **serialize_membership(membership),
                "es_fundador": membership.capa_negocio.usuario_fundador_id == membership.user_id,
                "user": serialize_user(membership.user),
            }
            for membership in memberships
        ],
        "invitations": [serialize_invitation(invitation) for invitation in invitations],
        "permissions": {
            "current_role": context.role,
            "matrix": get_role_permission_matrix(),
        },
    }


@router.get("/permisos/")
def get_permissions_matrix(request):
    context = get_auth_context(request)
    capa = get_current_capa(request)
    return {
        "capa_negocio": {"id": capa.id, "nombre": capa.nombre},
        "current_role": context.role,
        "matrix": get_role_permission_matrix(),
    }


@router.get("/auditoria/resumen/")
def resumen_eventos_auditoria(
    request,
    dias: int = 7,
    limit: int = 5,
):
    require_audit_access(request)
    capa = get_current_capa(request)
    safe_days = max(1, min(dias, 90))
    safe_limit = max(1, min(limit, 10))
    until = timezone.now()
    since = until - timedelta(days=safe_days)
    categories, total_critical_events = build_audit_operational_summary(
        capa=capa,
        since=since,
        until=until,
        safe_limit=safe_limit,
    )
    security_signals = build_audit_security_signals(
        capa=capa,
        since=since,
        until=until,
        safe_limit=safe_limit,
    )

    return {
        "capa_negocio": {"id": capa.id, "nombre": capa.nombre},
        "desde": since.isoformat(),
        "hasta": until.isoformat(),
        "dias": safe_days,
        "limit": safe_limit,
        "total_eventos_criticos": total_critical_events,
        "categorias": categories,
        "senales_seguridad": security_signals,
    }


@router.get("/auditoria/", response=list[AuditEventOut])
def listar_eventos_auditoria(
    request,
    limit: int = 80,
    recurso_tipo: str = "",
    accion: str = "",
    recurso_id: str = "",
    actor_email: str = "",
    desde: str = "",
    hasta: str = "",
):
    require_audit_access(request)
    capa = get_current_capa(request)
    current_limit = max(1, min(limit, 200))
    events = (
        EventoAuditoria.objects.select_related("actor", "capa_negocio")
        .only(
            "id",
            "accion",
            "recurso_tipo",
            "recurso_id",
            "actor_id",
            "actor__email",
            "capa_negocio_id",
            "capa_negocio__nombre",
            "metadata",
            "fecha_creacion",
        )
        .filter(capa_negocio=capa)
    )
    if recurso_tipo.strip():
        events = events.filter(recurso_tipo=recurso_tipo.strip())
    if accion.strip():
        events = events.filter(accion=accion.strip())
    if recurso_id.strip():
        events = events.filter(recurso_id=recurso_id.strip()[:120])
    if actor_email.strip():
        events = events.filter(actor__email__icontains=actor_email.strip()[:150])
    if desde.strip():
        parsed_since = parse_audit_boundary(desde.strip(), end_of_day=False)
        if parsed_since:
            events = events.filter(fecha_creacion__gte=parsed_since)
    if hasta.strip():
        parsed_until = parse_audit_boundary(hasta.strip(), end_of_day=True)
        if parsed_until:
            events = events.filter(fecha_creacion__lte=parsed_until)

    return [
        serialize_audit_event(event)
        for event in events[:current_limit]
    ]


@router.post("/miembros/invitar/", response={200: dict, 409: dict})
@transaction.atomic
def invite_member(request, payload: InviteMemberIn):
    context = require_admin_access(request)
    capa = context.current_membership.capa_negocio
    email = normalize_email(payload.email)
    if not email:
        raise HttpError(400, "El correo del invitado es obligatorio.")

    expire_pending_invitations(capa=capa, email=email)

    if payload.rol not in {choice[0] for choice in MembresiaCapaNegocio.ROL_CHOICES}:
        raise HttpError(400, "El rol solicitado no es valido.")

    existing_membership = MembresiaCapaNegocio.objects.filter(
        capa_negocio=capa,
        user__email__iexact=email,
        activo=True,
    ).first()
    if existing_membership:
        raise HttpError(400, "Ese usuario ya tiene acceso activo a esta capa de negocio.")

    existing_pending_invitations = list(
        InvitacionAcceso.objects.filter(
            capa_negocio=capa,
            email=email,
            estatus="PENDIENTE",
            expira_en__gte=timezone.now(),
        ).order_by("-fecha_creacion", "-id")
    )
    if existing_pending_invitations and not payload.replace_existing:
        return 409, {
            "code": "INVITATION_ALREADY_PENDING",
            "detail": "Ya existe una invitacion pendiente para este correo. Si deseas reenviarla, confirma para reemplazar la anterior.",
            "invitation": serialize_invitation(existing_pending_invitations[0]),
        }

    if payload.replace_existing:
        for previous_invitation in existing_pending_invitations:
            previous_invitation.estatus = "REVOCADA"
            previous_invitation.save(update_fields=["estatus", "fecha_actualizacion"])
            audit(
                actor=context.user,
                capa=capa,
                accion="REEMPLAZAR_INVITACION",
                recurso_tipo="InvitacionAcceso",
                recurso_id=previous_invitation.id,
                metadata={"email": previous_invitation.email},
            )

    assert_plan_capacity(capa, "usuarios", include_pending_invitations=True)

    invitation = InvitacionAcceso.objects.create(
        capa_negocio=capa,
        email=email,
        nombre_sugerido=(payload.nombre_sugerido or "").strip() or None,
        rol=payload.rol,
        invitado_por=context.user,
        expira_en=timezone.now() + timedelta(days=7),
    )
    audit(
        actor=context.user,
        capa=capa,
        accion="INVITAR_USUARIO",
        recurso_tipo="InvitacionAcceso",
        recurso_id=invitation.id,
        metadata={"email": invitation.email, "rol": invitation.rol},
    )
    accept_url = f"{settings.FRONTEND_BASE_URL.rstrip('/')}/invitacion/{invitation.token}"
    email_sent, email_error = send_invitation_email(invitation, accept_url)

    return {
        "id": invitation.id,
        "mensaje": (
            "Invitacion reenviada correctamente. La anterior fue reemplazada."
            if payload.replace_existing and existing_pending_invitations
            else "Invitacion creada correctamente."
        )
        + (
            ""
            if email_sent
            else " El acceso quedo creado, pero el correo no se pudo enviar. Revisa la configuracion de correo transaccional o comparte el enlace manualmente."
        ),
        "invitation": serialize_invitation(invitation),
        "accept_url": accept_url,
        "email_sent": email_sent,
        "email_error": email_error,
    }


@router.put("/miembros/{membership_id}/rol/")
@transaction.atomic
def update_membership_role(request, membership_id: int, payload: MembershipRoleIn):
    context = require_admin_access(request)
    membership = get_object_or_404(
        MembresiaCapaNegocio.objects.select_related("capa_negocio", "user"),
        id=membership_id,
        capa_negocio=context.current_membership.capa_negocio,
    )
    if payload.rol not in {choice[0] for choice in MembresiaCapaNegocio.ROL_CHOICES}:
        raise HttpError(400, "El rol solicitado no es valido.")
    ensure_membership_is_not_founder(membership)

    if membership.rol == ROLE_OWNER_ADMIN and payload.rol != ROLE_OWNER_ADMIN:
        ensure_remaining_owner(membership.capa_negocio, exclude_membership_id=membership.id)

    previous_role = membership.rol
    membership.rol = payload.rol
    membership.save(update_fields=["rol", "fecha_actualizacion"])
    audit(
        actor=context.user,
        capa=membership.capa_negocio,
        accion="ACTUALIZAR_ROL_USUARIO",
        recurso_tipo="MembresiaCapaNegocio",
        recurso_id=membership.id,
        metadata={
            "email": membership.user.email,
            "nombre": membership.user.get_full_name() or membership.user.email,
            "user_id": membership.user_id,
            "membership_id": membership.id,
            "rol_anterior": previous_role,
            "rol_nuevo": payload.rol,
            "nuevo_rol": payload.rol,
            "actor_role": context.role,
        },
    )
    return {
        "success": True,
        "mensaje": "Rol actualizado correctamente.",
        "membership": {
            **serialize_membership(membership),
            "user": serialize_user(membership.user),
        },
    }


@router.delete("/miembros/{membership_id}/")
@transaction.atomic
def deactivate_membership(request, membership_id: int):
    context = require_admin_access(request)
    membership = get_object_or_404(
        MembresiaCapaNegocio.objects.select_related("capa_negocio", "user"),
        id=membership_id,
        capa_negocio=context.current_membership.capa_negocio,
    )
    ensure_membership_is_not_founder(membership)
    if membership.rol == ROLE_OWNER_ADMIN:
        ensure_remaining_owner(membership.capa_negocio, exclude_membership_id=membership.id)

    previous_role = membership.rol
    previous_active = membership.activo
    membership.activo = False
    membership.save(update_fields=["activo", "fecha_actualizacion"])
    sessions_revoked = revoke_active_sessions_for_user(membership.user_id)
    audit(
        actor=context.user,
        capa=membership.capa_negocio,
        accion="DESACTIVAR_USUARIO",
        recurso_tipo="MembresiaCapaNegocio",
        recurso_id=membership.id,
        metadata={
            "email": membership.user.email,
            "nombre": membership.user.get_full_name() or membership.user.email,
            "user_id": membership.user_id,
            "membership_id": membership.id,
            "rol_anterior": previous_role,
            "rol_nuevo": previous_role,
            "activo_anterior": previous_active,
            "activo_nuevo": False,
            "estatus_anterior": "ACTIVO" if previous_active else "INACTIVO",
            "estatus_nuevo": "INACTIVO",
            "actor_role": context.role,
            "sesiones_revocadas": sessions_revoked,
        },
    )
    return {"success": True, "mensaje": "Acceso desactivado correctamente."}


@router.delete("/miembros/{membership_id}/eliminar/")
@transaction.atomic
def delete_membership(request, membership_id: int):
    context = require_admin_access(request)
    membership = get_object_or_404(
        MembresiaCapaNegocio.objects.select_related("capa_negocio", "user"),
        id=membership_id,
        capa_negocio=context.current_membership.capa_negocio,
    )
    ensure_membership_is_not_founder(membership)
    if membership.rol == ROLE_OWNER_ADMIN:
        ensure_remaining_owner(membership.capa_negocio, exclude_membership_id=membership.id)

    membership_email = membership.user.email
    membership_name = membership.user.get_full_name() or membership.user.email
    membership_user_id = membership.user_id
    membership_capa = membership.capa_negocio
    membership_role = membership.rol
    membership_active = membership.activo
    sessions_revoked = revoke_active_sessions_for_user(membership_user_id)
    membership.delete()
    audit(
        actor=context.user,
        capa=membership_capa,
        accion="ELIMINAR_USUARIO_CAPA",
        recurso_tipo="MembresiaCapaNegocio",
        recurso_id=membership_id,
        metadata={
            "email": membership_email,
            "nombre": membership_name,
            "user_id": membership_user_id,
            "membership_id": membership_id,
            "rol": membership_role,
            "rol_anterior": membership_role,
            "activo_anterior": membership_active,
            "estatus_anterior": "ACTIVO" if membership_active else "INACTIVO",
            "estatus_nuevo": "ELIMINADO",
            "actor_role": context.role,
            "sesiones_revocadas": sessions_revoked,
        },
    )
    return {
        "success": True,
        "mensaje": "Usuario eliminado de esta capa correctamente.",
    }


@router.delete("/invitaciones/{invitation_id}/")
@transaction.atomic
def revoke_invitation(request, invitation_id: int):
    context = require_admin_access(request)
    invitation = get_object_or_404(
        InvitacionAcceso.objects.select_related("capa_negocio"),
        id=invitation_id,
        capa_negocio=context.current_membership.capa_negocio,
    )
    previous_status = invitation.estatus
    invitation.estatus = "REVOCADA"
    invitation.save(update_fields=["estatus", "fecha_actualizacion"])
    audit(
        actor=context.user,
        capa=invitation.capa_negocio,
        accion="REVOCAR_INVITACION",
        recurso_tipo="InvitacionAcceso",
        recurso_id=invitation.id,
        metadata={
            "email": invitation.email,
            "nombre_sugerido": invitation.nombre_sugerido,
            "rol": invitation.rol,
            "estatus_anterior": previous_status,
            "estatus_nuevo": invitation.estatus,
            "invitation_id": invitation.id,
            "actor_role": context.role,
        },
    )
    return {"success": True, "mensaje": "Invitacion revocada correctamente."}


@router.delete("/invitaciones/{invitation_id}/eliminar/")
@transaction.atomic
def delete_invitation(request, invitation_id: int):
    context = require_admin_access(request)
    invitation = get_object_or_404(
        InvitacionAcceso.objects.select_related("capa_negocio"),
        id=invitation_id,
        capa_negocio=context.current_membership.capa_negocio,
    )
    invitation_email = invitation.email
    invitation_name = invitation.nombre_sugerido
    invitation_role = invitation.rol
    invitation_status = invitation.estatus
    invitation_capa = invitation.capa_negocio
    invitation.delete()
    audit(
        actor=context.user,
        capa=invitation_capa,
        accion="ELIMINAR_INVITACION",
        recurso_tipo="InvitacionAcceso",
        recurso_id=invitation_id,
        metadata={
            "email": invitation_email,
            "nombre_sugerido": invitation_name,
            "rol": invitation_role,
            "estatus": invitation_status,
            "estatus_anterior": invitation_status,
            "estatus_nuevo": "ELIMINADA",
            "invitation_id": invitation_id,
            "actor_role": context.role,
        },
    )
    return {"success": True, "mensaje": "Invitacion eliminada correctamente."}
