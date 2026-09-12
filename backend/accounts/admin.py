from django.contrib import admin

from .models import (
    EventoAuditoria,
    InvitacionAdminPlataforma,
    InvitacionAcceso,
    MembresiaCapaNegocio,
    SesionAcceso,
    UsuarioPerfil,
)


@admin.register(UsuarioPerfil)
class UsuarioPerfilAdmin(admin.ModelAdmin):
    list_display = (
        "user",
        "nombre_mostrado",
        "email_verificado",
        "es_admin_plataforma",
        "google_sub",
    )
    search_fields = ("user__email", "user__username", "nombre_mostrado", "google_sub")


@admin.register(MembresiaCapaNegocio)
class MembresiaCapaNegocioAdmin(admin.ModelAdmin):
    list_display = ("user", "capa_negocio", "rol", "activo", "ultimo_acceso")
    list_filter = ("rol", "activo", "capa_negocio")
    search_fields = ("user__email", "capa_negocio__nombre")


@admin.register(InvitacionAcceso)
class InvitacionAccesoAdmin(admin.ModelAdmin):
    list_display = ("email", "capa_negocio", "rol", "estatus", "expira_en")
    list_filter = ("rol", "estatus", "capa_negocio")
    search_fields = ("email", "capa_negocio__nombre")


@admin.register(InvitacionAdminPlataforma)
class InvitacionAdminPlataformaAdmin(admin.ModelAdmin):
    list_display = ("email", "estatus", "expira_en", "invitado_por", "user_relacionado")
    list_filter = ("estatus",)
    search_fields = ("email", "nombre_sugerido", "invitado_por__email", "user_relacionado__email")


@admin.register(SesionAcceso)
class SesionAccesoAdmin(admin.ModelAdmin):
    list_display = ("user", "proveedor", "refresh_expires_at", "revoked_at", "ultimo_uso")
    list_filter = ("proveedor",)
    search_fields = ("user__email", "session_key")


@admin.register(EventoAuditoria)
class EventoAuditoriaAdmin(admin.ModelAdmin):
    list_display = (
        "accion",
        "recurso_tipo",
        "recurso_id",
        "actor",
        "capa_negocio",
        "fecha_creacion",
    )
    list_filter = ("accion", "recurso_tipo", "capa_negocio")
    search_fields = ("accion", "recurso_tipo", "recurso_id", "actor__email")
