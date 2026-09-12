from django.contrib import admin

from .models import CertificadoSelloDigital, FacturaEmitida, FacturaPartida


@admin.register(CertificadoSelloDigital)
class CertificadoSelloDigitalAdmin(admin.ModelAdmin):
    list_display = (
        "capa_negocio",
        "proveedor",
        "modo",
        "rfc",
        "estatus",
        "activo",
        "actualizado_en",
    )
    list_filter = ("proveedor", "modo", "estatus", "activo")
    search_fields = ("capa_negocio__nombre", "rfc", "numero_certificado")
    readonly_fields = ("creado_en", "actualizado_en")


class FacturaPartidaInline(admin.TabularInline):
    model = FacturaPartida
    extra = 0
    readonly_fields = (
        "descripcion",
        "clave_producto_servicio",
        "clave_unidad",
        "cantidad",
        "precio_unitario",
        "subtotal",
        "impuestos",
        "total",
        "objeto_impuesto",
    )

    def has_add_permission(self, request, obj=None):
        return False


@admin.register(FacturaEmitida)
class FacturaEmitidaAdmin(admin.ModelAdmin):
    list_display = (
        "capa_emisora",
        "contexto",
        "estatus",
        "serie",
        "folio",
        "uuid",
        "receptor_razon_social",
        "total",
        "fecha_emision",
    )
    list_filter = ("contexto", "proveedor", "modo", "estatus")
    search_fields = (
        "uuid",
        "serie",
        "folio",
        "receptor_rfc",
        "receptor_razon_social",
        "capa_emisora__nombre",
    )
    readonly_fields = ("creado_en", "actualizado_en", "fecha_emision", "fecha_timbrado")
    inlines = [FacturaPartidaInline]
