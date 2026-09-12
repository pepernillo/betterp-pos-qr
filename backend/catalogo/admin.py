from django.contrib import admin

from .models import (
    Bodega,
    CalidadIncidencia,
    Categoria,
    InventarioItem,
    InventarioMovimiento,
    Orden,
    OrdenItem,
    Producto,
    ProductoImagen,
)


@admin.register(Categoria)
class CategoriaAdmin(admin.ModelAdmin):
    list_display = ("nombre", "capa_negocio", "parent", "activo", "fecha_actualizacion")
    list_filter = ("activo", "capa_negocio")
    search_fields = ("nombre", "capa_negocio__nombre")
    readonly_fields = ("fecha_creacion", "fecha_actualizacion")


class ProductoImagenInline(admin.TabularInline):
    model = ProductoImagen
    extra = 0
    readonly_fields = ("fecha_creacion", "fecha_actualizacion")


@admin.register(Producto)
class ProductoAdmin(admin.ModelAdmin):
    list_display = (
        "internal_sku",
        "nombre",
        "marca",
        "capa_negocio",
        "categoria",
        "precio_base",
        "activo",
    )
    list_filter = ("activo", "source", "capa_negocio", "categoria")
    search_fields = ("internal_sku", "brand_sku", "nombre", "marca", "capa_negocio__nombre")
    readonly_fields = ("fecha_creacion", "fecha_actualizacion")
    inlines = [ProductoImagenInline]


@admin.register(ProductoImagen)
class ProductoImagenAdmin(admin.ModelAdmin):
    list_display = ("producto", "is_main", "asset_status", "public_url", "fecha_actualizacion")
    list_filter = ("is_main", "asset_status")
    search_fields = ("producto__nombre", "producto__internal_sku", "public_url", "sha256")
    readonly_fields = ("fecha_creacion", "fecha_actualizacion")


@admin.register(Bodega)
class BodegaAdmin(admin.ModelAdmin):
    list_display = ("codigo", "nombre", "capa_negocio", "tipo", "activo", "fecha_actualizacion")
    list_filter = ("activo", "tipo", "capa_negocio")
    search_fields = ("codigo", "nombre", "capa_negocio__nombre")
    readonly_fields = ("fecha_creacion", "fecha_actualizacion")


@admin.register(InventarioItem)
class InventarioItemAdmin(admin.ModelAdmin):
    list_display = (
        "producto",
        "bodega",
        "capa_negocio",
        "stock",
        "reservado",
        "costo_promedio",
        "fecha_actualizacion",
    )
    list_filter = ("capa_negocio", "bodega")
    search_fields = (
        "producto__internal_sku",
        "producto__nombre",
        "bodega__codigo",
        "bodega__nombre",
        "capa_negocio__nombre",
    )
    readonly_fields = ("fecha_creacion", "fecha_actualizacion")


@admin.register(InventarioMovimiento)
class InventarioMovimientoAdmin(admin.ModelAdmin):
    list_display = (
        "tipo",
        "producto",
        "bodega",
        "capa_negocio",
        "cantidad",
        "stock_anterior",
        "stock_nuevo",
        "fecha_creacion",
    )
    list_filter = ("tipo", "capa_negocio", "bodega")
    search_fields = (
        "producto__internal_sku",
        "producto__nombre",
        "bodega__codigo",
        "referencia_tipo",
        "referencia_id",
    )
    readonly_fields = ("fecha_creacion",)


class OrdenItemInline(admin.TabularInline):
    model = OrdenItem
    extra = 0
    readonly_fields = ("fecha_creacion",)


@admin.register(Orden)
class OrdenAdmin(admin.ModelAdmin):
    list_display = (
        "canal",
        "external_order_id",
        "capa_negocio",
        "estatus",
        "payment_status",
        "total",
        "fecha_creacion",
    )
    list_filter = ("canal", "estatus", "payment_status", "capa_negocio")
    search_fields = (
        "external_order_id",
        "cliente_nombre",
        "cliente_email",
        "items__producto__internal_sku",
        "items__producto__nombre",
        "capa_negocio__nombre",
    )
    readonly_fields = (
        "fecha_creacion",
        "fecha_actualizacion",
        "fecha_reserva",
        "fecha_confirmacion",
        "fecha_cancelacion",
    )
    inlines = [OrdenItemInline]


@admin.register(OrdenItem)
class OrdenItemAdmin(admin.ModelAdmin):
    list_display = ("orden", "producto", "bodega", "cantidad", "precio_unitario", "subtotal")
    list_filter = ("capa_negocio", "bodega")
    search_fields = (
        "orden__external_order_id",
        "producto__internal_sku",
        "producto__nombre",
        "external_item_id",
        "titulo",
    )
    readonly_fields = ("fecha_creacion",)


@admin.register(CalidadIncidencia)
class CalidadIncidenciaAdmin(admin.ModelAdmin):
    list_display = (
        "titulo",
        "producto",
        "canal",
        "issue_type",
        "prioridad",
        "estatus",
        "fecha_actualizacion",
    )
    list_filter = ("estatus", "prioridad", "issue_type", "canal", "capa_negocio")
    search_fields = (
        "titulo",
        "descripcion",
        "raw_error",
        "external_code",
        "producto__internal_sku",
        "producto__nombre",
        "capa_negocio__nombre",
    )
    readonly_fields = ("fecha_creacion", "fecha_actualizacion", "fecha_resolucion")




