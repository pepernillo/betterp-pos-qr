from __future__ import annotations

from django.contrib.auth.models import User

from empresas.models import CapaNegocio

from .models import MembresiaCapaNegocio
from .security import create_access_session, issue_token_pair


def create_api_auth_context(
    *,
    email: str = "owner@test.local",
    password: str = "secret123",
    capa: CapaNegocio | None = None,
    capa_name: str = "Capa Test",
    role: str = "OWNER_ADMIN",
    is_superuser: bool = False,
) -> tuple[User, CapaNegocio, dict[str, str]]:
    user = User.objects.create_user(
        username=email,
        email=email,
        password=password,
        is_superuser=is_superuser,
        is_staff=is_superuser,
    )
    if capa is None:
        capa = CapaNegocio.objects.create(
            nombre=capa_name,
            tipo_capa="OPERADORA",
            usuario_fundador=user,
        )
    elif not capa.usuario_fundador_id:
        capa.usuario_fundador = user
        capa.save(update_fields=["usuario_fundador"])

    MembresiaCapaNegocio.objects.get_or_create(
        user=user,
        capa_negocio=capa,
        defaults={"rol": role, "activo": True},
    )
    session = create_access_session(user, provider="PASSWORD")
    tokens = issue_token_pair(session)
    headers = {
        "HTTP_AUTHORIZATION": f"Bearer {tokens['access_token']}",
        "HTTP_X_BETTERP_CAPA_ID": str(capa.id),
    }
    return user, capa, headers
