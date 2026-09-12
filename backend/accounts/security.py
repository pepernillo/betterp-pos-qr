from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
from typing import Iterable, Sequence

from django.conf import settings
from django.contrib.auth.models import User
from django.core import signing
from django.db import models
from django.shortcuts import get_object_or_404
from django.utils import timezone
from ninja.errors import HttpError
from ninja.security import HttpBearer

from empresas.models import CapaNegocio

from .models import MembresiaCapaNegocio, SesionAcceso, UsuarioPerfil

ROLE_OWNER_ADMIN = "OWNER_ADMIN"
ROLE_OPERADOR = "OPERADOR"
ROLE_CONSULTA = "CONSULTA"
WRITE_ROLES = {ROLE_OWNER_ADMIN, ROLE_OPERADOR}
ADMIN_ROLES = {ROLE_OWNER_ADMIN}
PLAN_OVERRIDE_METADATA_KEY = "plan_capability_overrides"

ROLE_PERMISSION_MATRIX = {
    ROLE_OWNER_ADMIN: {
        "label": "Owner admin",
        "summary": "Administra usuarios, configuracion y operaciones sensibles.",
        "capabilities": {
            "leer": True,
            "operar": True,
            "administrar": True,
            "auditoria": True,
            "backups": True,
        },
    },
    ROLE_OPERADOR: {
        "label": "Operador",
        "summary": "Opera clientes, espacios, finanzas y cobranza sin administrar accesos.",
        "capabilities": {
            "leer": True,
            "operar": True,
            "administrar": False,
            "auditoria": False,
            "backups": False,
        },
    },
    ROLE_CONSULTA: {
        "label": "Consulta",
        "summary": "Revisa informacion sin crear, editar ni ejecutar acciones sensibles.",
        "capabilities": {
            "leer": True,
            "operar": False,
            "administrar": False,
            "auditoria": False,
            "backups": False,
        },
    },
}

ACCESS_TOKEN_SALT = "betterp.auth.access"
REFRESH_TOKEN_SALT = "betterp.auth.refresh"

MEMBERSHIP_SESSION_FIELDS = (
    "id",
    "user_id",
    "capa_negocio_id",
    "rol",
    "activo",
    "ultimo_acceso",
    "invitacion_aceptada_en",
    "capa_negocio__id",
    "capa_negocio__nombre",
    "capa_negocio__tipo_capa",
    "capa_negocio__activo",
    "capa_negocio__seguridad_doble_factor_activa",
    "capa_negocio__usuario_fundador_id",
)


@dataclass(slots=True)
class AuthContext:
    user: User
    session: SesionAcceso
    memberships: list[MembresiaCapaNegocio]
    current_membership: MembresiaCapaNegocio | None

    @property
    def role(self) -> str | None:
        return self.current_membership.rol if self.current_membership else None

    @property
    def capa_negocio(self) -> CapaNegocio | None:
        return self.current_membership.capa_negocio if self.current_membership else None


def get_request_ip(request) -> str | None:
    forwarded = request.headers.get("X-Forwarded-For", "")
    if forwarded:
        return forwarded.split(",")[0].strip() or None
    remote = request.META.get("REMOTE_ADDR")
    if not remote:
        return None
    return str(remote).strip() or None


def get_request_user_agent(request) -> str | None:
    user_agent = request.headers.get("User-Agent") or request.META.get("HTTP_USER_AGENT")
    if not user_agent:
        return None
    return str(user_agent).strip() or None


def create_access_session(user: User, *, provider: str, request=None) -> SesionAcceso:
    refresh_expires_at = timezone.now() + timedelta(
        seconds=settings.REFRESH_TOKEN_MAX_AGE_SECONDS
    )
    return SesionAcceso.objects.create(
        user=user,
        proveedor=provider,
        refresh_expires_at=refresh_expires_at,
        ip_address=get_request_ip(request) if request is not None else None,
        user_agent=get_request_user_agent(request) if request is not None else None,
    )


def revoke_access_session(session: SesionAcceso) -> SesionAcceso:
    if session.revoked_at is None:
        session.revoked_at = timezone.now()
        session.save(update_fields=["revoked_at"])
    return session


def issue_signed_token(session: SesionAcceso, *, kind: str) -> str:
    salt = ACCESS_TOKEN_SALT if kind == "access" else REFRESH_TOKEN_SALT
    payload = {
        "kind": kind,
        "session_key": str(session.session_key),
        "user_id": session.user_id,
    }
    return signing.dumps(payload, salt=salt, compress=True)


def issue_token_pair(session: SesionAcceso) -> dict[str, str]:
    return {
        "access_token": issue_signed_token(session, kind="access"),
        "refresh_token": issue_signed_token(session, kind="refresh"),
        "token_type": "Bearer",
    }


def decode_signed_token(token: str, *, kind: str) -> dict | None:
    salt = ACCESS_TOKEN_SALT if kind == "access" else REFRESH_TOKEN_SALT
    max_age = (
        settings.ACCESS_TOKEN_MAX_AGE_SECONDS
        if kind == "access"
        else settings.REFRESH_TOKEN_MAX_AGE_SECONDS
    )
    try:
        payload = signing.loads(token, salt=salt, max_age=max_age)
    except signing.BadSignature:
        return None

    if payload.get("kind") != kind:
        return None
    return payload


def membership_session_queryset(*, include_entity_counts: bool = False):
    queryset = MembresiaCapaNegocio.objects.select_related("capa_negocio").only(
        *MEMBERSHIP_SESSION_FIELDS
    )
    if include_entity_counts:
        queryset = queryset.annotate(
            entidades_count=models.Count("capa_negocio__entidades", distinct=True)
        )
    return queryset


def resolve_memberships_for_user(
    user: User,
    *,
    include_entity_counts: bool = False,
) -> list[MembresiaCapaNegocio]:
    return list(
        membership_session_queryset(include_entity_counts=include_entity_counts)
        .filter(
            user=user,
            activo=True,
            capa_negocio__activo=True,
        )
        .order_by("capa_negocio__nombre", "id")
    )


def resolve_current_membership(
    request,
    memberships: Sequence[MembresiaCapaNegocio],
) -> MembresiaCapaNegocio | None:
    if not memberships:
        return None

    requested_capa_id = request.headers.get("X-BettERP-Capa-ID")
    if requested_capa_id and requested_capa_id.isdigit():
        capa_id = int(requested_capa_id)
        for membership in memberships:
            if membership.capa_negocio_id == capa_id:
                return membership
        return None

    return memberships[0]


def touch_session_usage(session: SesionAcceso) -> None:
    cutoff = timezone.now() - timedelta(minutes=5)
    if session.ultimo_uso < cutoff:
        session.ultimo_uso = timezone.now()
        session.save(update_fields=["ultimo_uso"])


def touch_membership_usage(membership: MembresiaCapaNegocio | None) -> None:
    if membership is None:
        return
    cutoff = timezone.now() - timedelta(minutes=5)
    if membership.ultimo_acceso is None or membership.ultimo_acceso < cutoff:
        membership.ultimo_acceso = timezone.now()
        membership.save(update_fields=["ultimo_acceso"])


class AccessBearerAuth(HttpBearer):
    def authenticate(self, request, token):
        payload = decode_signed_token(token, kind="access")
        if not payload:
            return None

        session = (
            SesionAcceso.objects.select_related("user")
            .filter(
                session_key=payload.get("session_key"),
                user_id=payload.get("user_id"),
                revoked_at__isnull=True,
            )
            .first()
        )
        if not session or not session.activa or not session.user.is_active:
            return None

        memberships = resolve_memberships_for_user(session.user)
        current_membership = resolve_current_membership(request, memberships)
        touch_session_usage(session)
        touch_membership_usage(current_membership)
        return AuthContext(
            user=session.user,
            session=session,
            memberships=memberships,
            current_membership=current_membership,
        )


def get_auth_context(request, *, require: bool = True) -> AuthContext | None:
    context = getattr(request, "auth", None)
    if context is None and require:
        raise HttpError(401, "Debes iniciar sesion para acceder a este recurso.")
    return context


def get_request_user(request, *, require: bool = True) -> User | None:
    context = get_auth_context(request, require=require)
    return context.user if context else None


def get_current_membership(request, *, require: bool = True) -> MembresiaCapaNegocio | None:
    context = get_auth_context(request, require=require)
    membership = context.current_membership if context else None
    if membership is None and require:
        requested_capa_id = request.headers.get("X-BettERP-Capa-ID", "")
        if requested_capa_id and requested_capa_id.isdigit():
            raise HttpError(
                403,
                "Tu usuario no tiene acceso activo a la capa de negocio solicitada.",
            )
        raise HttpError(
            403,
            "Tu usuario no tiene acceso activo a ninguna capa de negocio.",
        )
    return membership


def get_current_capa(request, *, require: bool = True) -> CapaNegocio | None:
    membership = get_current_membership(request, require=require)
    return membership.capa_negocio if membership else None


def get_current_subscription(request):
    capa = get_current_capa(request)
    from billing.models import SuscripcionCapa

    return (
        SuscripcionCapa.objects.select_related("plan")
        .filter(capa_negocio=capa)
        .first()
    )


def normalize_capability_keys(values: Iterable[str] | None) -> list[str]:
    clean_values: list[str] = []
    for raw_value in values or []:
        value = str(raw_value or "").strip()
        if value and value not in clean_values:
            clean_values.append(value)
    return clean_values


def get_subscription_capability_overrides(subscription) -> dict:
    metadata = subscription.metadata or {}
    raw_overrides = metadata.get(PLAN_OVERRIDE_METADATA_KEY) or {}
    if not isinstance(raw_overrides, dict):
        raw_overrides = {}
    return {
        "modulos_agregados": normalize_capability_keys(
            raw_overrides.get("modulos_agregados")
        ),
        "modulos_bloqueados": normalize_capability_keys(
            raw_overrides.get("modulos_bloqueados")
        ),
        "funciones_agregadas": normalize_capability_keys(
            raw_overrides.get("funciones_agregadas")
        ),
        "funciones_bloqueadas": normalize_capability_keys(
            raw_overrides.get("funciones_bloqueadas")
        ),
        "nota": str(raw_overrides.get("nota") or "").strip(),
        "actualizado_en": raw_overrides.get("actualizado_en"),
        "actualizado_por": str(raw_overrides.get("actualizado_por") or "").strip(),
    }


def apply_capability_overrides(
    base_keys: Iterable[str] | None,
    added_keys: Iterable[str] | None,
    blocked_keys: Iterable[str] | None,
) -> list[str]:
    resolved = normalize_capability_keys(base_keys)
    for key in normalize_capability_keys(added_keys):
        if key not in resolved:
            resolved.append(key)
    blocked = set(normalize_capability_keys(blocked_keys))
    return [key for key in resolved if key not in blocked]


def get_effective_plan_modules(subscription) -> list[str]:
    if not subscription or not subscription.plan:
        return []
    overrides = get_subscription_capability_overrides(subscription)
    return apply_capability_overrides(
        subscription.plan.modulos_habilitados or [],
        overrides["modulos_agregados"],
        overrides["modulos_bloqueados"],
    )


def get_effective_plan_features(subscription) -> list[str]:
    if not subscription or not subscription.plan:
        return []
    overrides = get_subscription_capability_overrides(subscription)
    return apply_capability_overrides(
        subscription.plan.funciones_habilitadas or [],
        overrides["funciones_agregadas"],
        overrides["funciones_bloqueadas"],
    )


def require_plan_module(request, module_key: str):
    subscription = get_current_subscription(request)
    if not subscription or not subscription.plan:
        return subscription
    modules = get_effective_plan_modules(subscription)
    if module_key not in modules:
        audit_plan_capability_denied(
            request,
            subscription=subscription,
            kind="modulo",
            key=module_key,
            effective_values=modules,
        )
        raise HttpError(403, "Tu plan actual no incluye este modulo.")
    return subscription


def require_plan_feature(request, feature_key: str, *, message: str | None = None):
    subscription = get_current_subscription(request)
    if not subscription or not subscription.plan:
        return subscription
    features = get_effective_plan_features(subscription)
    if feature_key not in features:
        audit_plan_capability_denied(
            request,
            subscription=subscription,
            kind="funcion",
            key=feature_key,
            effective_values=features,
        )
        raise HttpError(403, message or "Tu plan actual no incluye esta funcion.")
    return subscription


def plan_has_feature(request, feature_key: str) -> bool:
    subscription = get_current_subscription(request)
    if not subscription or not subscription.plan:
        return True
    features = get_effective_plan_features(subscription)
    return feature_key in features


def plan_has_module(request, module_key: str) -> bool:
    subscription = get_current_subscription(request)
    if not subscription or not subscription.plan:
        return True
    modules = get_effective_plan_modules(subscription)
    return module_key in modules


def require_write_access(request) -> AuthContext:
    context = get_auth_context(request)
    if context.role not in WRITE_ROLES:
        audit_permission_denied(request, context=context, required="write")
        raise HttpError(403, "No tienes permisos de edicion en esta capa de negocio.")
    return context


def require_admin_access(request) -> AuthContext:
    context = get_auth_context(request)
    if context.role not in ADMIN_ROLES:
        audit_permission_denied(request, context=context, required="admin")
        raise HttpError(403, "No tienes permisos administrativos en esta capa de negocio.")
    return context


def get_role_capabilities(role: str | None) -> dict[str, bool]:
    config = ROLE_PERMISSION_MATRIX.get(role or "")
    if not config:
        return {}
    return dict(config["capabilities"])


def role_has_capability(role: str | None, capability: str) -> bool:
    return bool(get_role_capabilities(role).get(capability))


def require_capability_access(
    request,
    capability: str,
    *,
    message: str,
) -> AuthContext:
    context = get_auth_context(request)
    if not role_has_capability(context.role, capability):
        audit_permission_denied(request, context=context, required=capability)
        raise HttpError(403, message)
    return context


def require_audit_access(request) -> AuthContext:
    return require_capability_access(
        request,
        "auditoria",
        message="No tienes permisos para consultar la auditoria de esta capa.",
    )


def require_backup_access(request) -> AuthContext:
    return require_capability_access(
        request,
        "backups",
        message="No tienes permisos para exportar o validar respaldos de esta capa.",
    )


def get_role_permission_matrix() -> list[dict]:
    return [
        {
            "rol": role,
            "label": config["label"],
            "summary": config["summary"],
            "capabilities": config["capabilities"],
        }
        for role, config in ROLE_PERMISSION_MATRIX.items()
    ]


def audit_permission_denied(
    request,
    *,
    context: AuthContext,
    required: str,
) -> None:
    try:
        from .audit import audit

        audit(
            actor=context.user,
            capa=context.capa_negocio,
            accion="ACCESO_DENEGADO",
            recurso_tipo="Permiso",
            recurso_id=required,
            metadata={
                "rol_actual": context.role,
                "permiso_requerido": required,
                "capabilities_actuales": get_role_capabilities(context.role),
                "capa_negocio_id": (
                    context.capa_negocio.id if context.capa_negocio else None
                ),
                "capa_negocio_nombre": (
                    context.capa_negocio.nombre if context.capa_negocio else None
                ),
                "session_id": context.session.id,
                "scope": "platform" if required == "platform_admin" else "tenant",
                "metodo": request.method,
                "ruta": request.path,
                "ip": get_request_ip(request),
                "user_agent": get_request_user_agent(request),
            },
        )
    except Exception:
        return


def audit_plan_capability_denied(
    request,
    *,
    subscription,
    kind: str,
    key: str,
    effective_values: list[str],
) -> None:
    try:
        from .audit import audit

        context = get_auth_context(request)
        plan = getattr(subscription, "plan", None)
        overrides = get_subscription_capability_overrides(subscription)
        action = "PLAN_MODULO_DENEGADO" if kind == "modulo" else "PLAN_FUNCION_DENEGADA"
        audit(
            actor=context.user,
            capa=context.capa_negocio,
            accion=action,
            recurso_tipo="PlanSaaS",
            recurso_id=plan.id if plan else None,
            metadata={
                "tipo_bloqueo": kind,
                "capability_key": key,
                "plan_id": plan.id if plan else None,
                "plan_clave": plan.clave if plan else None,
                "plan_nombre": plan.nombre if plan else None,
                "valores_efectivos": effective_values,
                "overrides": overrides,
                "rol_actual": context.role,
                "session_id": context.session.id,
                "metodo": request.method,
                "ruta": request.path,
                "ip": get_request_ip(request),
                "user_agent": get_request_user_agent(request),
            },
        )
    except Exception:
        return


def get_platform_founder_user_id() -> int | None:
    return User.objects.order_by("id").values_list("id", flat=True).first()


def is_platform_founder_user(user: User | None) -> bool:
    if user is None:
        return False
    return get_platform_founder_user_id() == user.id


def get_platform_admin_users_queryset():
    founder_user_id = get_platform_founder_user_id()
    filters = models.Q(is_superuser=True) | models.Q(perfil_acceso__es_admin_plataforma=True)
    if founder_user_id is not None:
        filters |= models.Q(id=founder_user_id)
    return User.objects.filter(filters, is_active=True).distinct().order_by("id")


def is_platform_admin_user(user: User | None) -> bool:
    if user is None:
        return False
    if user.is_superuser:
        return True
    if is_platform_founder_user(user):
        return True

    try:
        profile = user.perfil_acceso
    except UsuarioPerfil.DoesNotExist:
        return False
    return bool(profile.es_admin_plataforma)


def require_platform_admin_access(request) -> AuthContext:
    context = get_auth_context(request)
    if not is_platform_admin_user(context.user):
        audit_permission_denied(request, context=context, required="platform_admin")
        raise HttpError(
            403,
            "Solo la cuenta administradora de BettERP puede acceder a este modulo.",
        )
    return context


def get_accessible_capas_queryset(request):
    context = get_auth_context(request)
    capa_ids = [membership.capa_negocio_id for membership in context.memberships]
    return CapaNegocio.objects.filter(id__in=capa_ids).distinct()


def scope_queryset_to_current_capa(request, queryset, relation_lookup: str):
    capa = get_current_capa(request)
    return queryset.filter(**{relation_lookup: capa.id}).distinct()


def get_object_in_current_capa_or_404(
    request,
    queryset,
    relation_lookup: str,
    **lookup,
):
    scoped_queryset = scope_queryset_to_current_capa(request, queryset, relation_lookup)
    return get_object_or_404(scoped_queryset, **lookup)


def ensure_membership_for_capa(request, capa: CapaNegocio) -> MembresiaCapaNegocio:
    context = get_auth_context(request)
    for membership in context.memberships:
        if membership.capa_negocio_id == capa.id:
            return membership
    raise HttpError(403, "No tienes acceso a la capa de negocio solicitada.")


def ensure_entity_in_current_capa(request, entidad):
    capa = get_current_capa(request)
    if entidad.capa_negocio_id != capa.id:
        raise HttpError(403, "La entidad no pertenece a tu capa de negocio activa.")
    return entidad


def get_allowed_entity_ids(request) -> list[int]:
    capa = get_current_capa(request)
    return list(capa.entidades.values_list("id", flat=True))


def filter_iterable_memberships_by_role(
    memberships: Iterable[MembresiaCapaNegocio],
    roles: set[str],
) -> list[MembresiaCapaNegocio]:
    return [membership for membership in memberships if membership.rol in roles]
