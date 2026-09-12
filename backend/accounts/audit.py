from __future__ import annotations

from django.contrib.auth.models import User

from empresas.models import CapaNegocio

from .models import EventoAuditoria


def audit(
    *,
    actor: User | None,
    capa: CapaNegocio | None,
    accion: str,
    recurso_tipo: str,
    recurso_id: str | int | None = None,
    metadata: dict | None = None,
) -> None:
    EventoAuditoria.objects.create(
        actor=actor,
        capa_negocio=capa,
        accion=accion,
        recurso_tipo=recurso_tipo,
        recurso_id=str(recurso_id) if recurso_id is not None else None,
        metadata=metadata or {},
    )
