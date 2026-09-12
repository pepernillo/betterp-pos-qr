from django.contrib import admin
from .models import (
    BackupCapaExport,
    CapaNegocio,
    EntidadNegocio,
    ReglaMarcoNegocio,
    ReglaNegocio,
)


@admin.register(CapaNegocio)
class CapaNegocioAdmin(admin.ModelAdmin):
    list_display = (
        'nombre',
        'tipo_capa',
        'rfc',
        'facturacion_activa',
        'facturacion_pac_proveedor',
        'portal_clientes_activo',
        'activo',
    )
    list_filter = ('tipo_capa', 'facturacion_activa', 'portal_clientes_activo', 'activo')
    search_fields = ('nombre', 'razon_social', 'rfc')


@admin.register(ReglaMarcoNegocio)
class ReglaMarcoNegocioAdmin(admin.ModelAdmin):
    list_display = ('nombre', 'capa_negocio', 'tipo_calculo', 'periodicidad', 'aplica_a_todos', 'activo')
    list_filter = ('capa_negocio', 'tipo_calculo', 'periodicidad', 'activo')


@admin.register(BackupCapaExport)
class BackupCapaExportAdmin(admin.ModelAdmin):
    list_display = (
        'archivo_nombre',
        'capa_negocio',
        'storage_backend',
        'estatus',
        'size_bytes',
        'fecha_creacion',
    )
    list_filter = ('storage_backend', 'estatus', 'fecha_creacion')
    search_fields = ('archivo_nombre', 'capa_negocio__nombre', 'object_key', 'checksum_sha256')
    readonly_fields = ('fecha_creacion',)


@admin.register(EntidadNegocio)
class EntidadNegocioAdmin(admin.ModelAdmin):
    list_display = ('nombre_comercial', 'tipo_fecha_corte', 'activo')


@admin.register(ReglaNegocio)
class ReglaNegocioAdmin(admin.ModelAdmin):
    # Fíjate cómo aquí ahora dice 'entidad' en lugar de 'entidad_relacionada'
    list_display = ('nombre', 'entidad', 'tipo_calculo', 'periodicidad', 'aplica_a_todos', 'activo')
    list_filter = ('entidad', 'tipo_calculo', 'periodicidad', 'activo')
