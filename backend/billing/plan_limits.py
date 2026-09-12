from __future__ import annotations

import unicodedata
from typing import TYPE_CHECKING, Literal

from django.conf import settings
from django.utils import timezone
from ninja.errors import HttpError

if TYPE_CHECKING:
    from empresas.models import CapaNegocio

PlanResource = Literal["usuarios", "entidades", "espacios"]


RESOURCE_LABELS: dict[PlanResource, str] = {
    "usuarios": "usuarios",
    "entidades": "entidades",
    "espacios": "espacios",
}


def normalize_limit_key(value: str | None) -> str:
    text = (value or "").strip().lower()
    normalized = unicodedata.normalize("NFKD", text)
    normalized = "".join(char for char in normalized if not unicodedata.combining(char))
    return " ".join(normalized.split())


def is_plan_limit_exempt(capa: CapaNegocio | None) -> bool:
    if not capa:
        return False
    exempt_names = {
        normalize_limit_key(name)
        for name in getattr(settings, "PLAN_LIMIT_EXEMPT_CAPAS", [])
        if normalize_limit_key(name)
    }
    return normalize_limit_key(capa.nombre) in exempt_names


def get_current_usage(capa: CapaNegocio, resource: PlanResource) -> int:
    if resource == "usuarios":
        from accounts.models import MembresiaCapaNegocio

        return MembresiaCapaNegocio.objects.filter(
            capa_negocio=capa,
            activo=True,
        ).count()

    if resource == "entidades":
        return capa.entidades.filter(activo=True).count()

    from espacios.models import Espacio

    return Espacio.objects.filter(
        entidad__capa_negocio=capa,
        activo=True,
    ).count()


def get_current_limit(capa: CapaNegocio, resource: PlanResource) -> int | None:
    from billing.models import SuscripcionCapa

    subscription = (
        SuscripcionCapa.objects.select_related("plan")
        .filter(capa_negocio=capa)
        .first()
    )
    if not subscription or not subscription.plan_id:
        return None

    plan = subscription.plan
    if resource == "usuarios":
        return int(plan.max_usuarios or 0)
    if resource == "entidades":
        return int(plan.max_entidades or 0)
    return int(plan.max_productos or 0)


def assert_plan_capacity(
    capa: CapaNegocio | None,
    resource: PlanResource,
    *,
    additional: int = 1,
    include_pending_invitations: bool = False,
) -> None:
    if not capa or additional <= 0 or is_plan_limit_exempt(capa):
        return

    limit = get_current_limit(capa, resource)
    if limit is None or limit <= 0:
        return

    current = get_current_usage(capa, resource)
    if resource == "usuarios" and include_pending_invitations:
        from accounts.models import InvitacionAcceso

        current += InvitacionAcceso.objects.filter(
            capa_negocio=capa,
            estatus="PENDIENTE",
            expira_en__gte=timezone.now(),
        ).count()

    projected = current + additional
    if projected <= limit:
        return

    label = RESOURCE_LABELS[resource]
    raise HttpError(
        403,
        (
            f"Tu plan permite hasta {limit} {label}. "
            "Para continuar, libera capacidad o actualiza tu plan."
        ),
    )
