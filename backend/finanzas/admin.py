from django.contrib import admin

from .models import (
    CargaConciliacion,
    CuentaPorCobrar,
    CuentaPorPagar,
    PagoCuentaPorCobrar,
    PagoCuentaPorPagar,
    ProgramacionCuentaPorPagar,
    SaldoCliente,
    Transaccion,
)


@admin.register(SaldoCliente)
class SaldoClienteAdmin(admin.ModelAdmin):
    list_display = ("cliente_relacionado", "entidad_relacionada", "saldo_a_favor")
    search_fields = ("cliente_relacionado__razon_social", "cliente_relacionado__nombre_comercial")


@admin.register(CuentaPorCobrar)
class CuentaPorCobrarAdmin(admin.ModelAdmin):
    list_display = (
        "cliente_relacionado",
        "entidad_relacionada",
        "concepto",
        "monto_total",
        "monto_pagado",
        "fecha_vencimiento",
        "estatus_adeudo",
    )
    list_filter = ("estatus_adeudo", "origen", "periodicidad")
    search_fields = ("concepto", "cliente_relacionado__razon_social", "referencia_unica")


@admin.register(PagoCuentaPorCobrar)
class PagoCuentaPorCobrarAdmin(admin.ModelAdmin):
    list_display = ("cuenta_por_cobrar", "monto", "fecha_pago", "metodo", "referencia")
    list_filter = ("metodo",)


@admin.register(ProgramacionCuentaPorPagar)
class ProgramacionCuentaPorPagarAdmin(admin.ModelAdmin):
    list_display = (
        "nombre",
        "entidad_relacionada",
        "categoria",
        "prioridad",
        "proveedor_nombre",
        "periodicidad",
        "monto_base",
        "activo",
    )
    list_filter = ("categoria", "prioridad", "periodicidad", "naturaleza", "activo")
    search_fields = ("nombre", "proveedor_nombre", "entidad_relacionada__nombre_comercial")


@admin.register(CuentaPorPagar)
class CuentaPorPagarAdmin(admin.ModelAdmin):
    list_display = (
        "proveedor_nombre",
        "entidad_relacionada",
        "concepto",
        "prioridad",
        "monto_proyectado",
        "monto_real",
        "monto_pagado",
        "fecha_vencimiento",
        "estatus",
    )
    list_filter = ("estatus", "categoria", "prioridad", "periodicidad", "naturaleza")
    search_fields = ("concepto", "proveedor_nombre", "referencia_unica")


@admin.register(PagoCuentaPorPagar)
class PagoCuentaPorPagarAdmin(admin.ModelAdmin):
    list_display = ("cuenta_por_pagar", "monto", "fecha_pago", "metodo", "referencia")
    list_filter = ("metodo",)


@admin.register(Transaccion)
class TransaccionAdmin(admin.ModelAdmin):
    list_display = ("tipo_movimiento", "monto", "origen", "estatus_conciliacion", "fecha_pago")
    list_filter = ("estatus_conciliacion", "origen", "tipo_movimiento")


admin.site.register(CargaConciliacion)
