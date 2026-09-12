from django.contrib import admin
from .models import Cliente, ServicioContratado

@admin.register(Cliente)
class ClienteAdmin(admin.ModelAdmin):
    # Actualizamos los campos a mostrar con los nuevos nombres de tu modelo
    list_display = ('razon_social', 'rfc', 'entidad_relacionada', 'telefono', 'activo')
    list_filter = ('entidad_relacionada', 'activo')
    search_fields = ('razon_social', 'nombre_comercial', 'rfc', 'correo_principal')

@admin.register(ServicioContratado)
class ServicioContratadoAdmin(admin.ModelAdmin):
    list_display = ('cliente_relacionado', 'regla_relacionada', 'fecha_inicio')