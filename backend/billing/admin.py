from django.contrib import admin

from .models import (
    AsignacionComercialSaaS,
    BackendRequestMetric,
    CambioPlanSaaS,
    ConsumoSaaS,
    ConfiguracionPagoPlataforma,
    CostoOperativoSaaS,
    EventoBilling,
    GoLiveApproval,
    MovimientoConsumoSaaS,
    PlanSaaS,
    ProspectoComercial,
    Solucion,
    SuscripcionCapa,
    VendedorBetterP,
)


@admin.register(Solucion)
class SolucionAdmin(admin.ModelAdmin):
    list_display = (
        "nombre",
        "clave",
        "estatus",
        "tipo",
        "repo_origen",
        "fecha_actualizacion",
    )
    list_filter = ("estatus", "tipo")
    search_fields = ("nombre", "clave", "repo_origen", "branch_origen")
    readonly_fields = ("fecha_creacion", "fecha_actualizacion")


@admin.register(PlanSaaS)
class PlanSaaSAdmin(admin.ModelAdmin):
    list_display = (
        "nombre",
        "clave",
        "solution",
        "precio_mensual",
        "precio_anual",
        "dias_prueba",
        "openai_tokens_incluidos",
        "comprobantes_whatsapp_incluidos",
        "timbres_facturacion_incluidos",
        "activo",
        "es_default",
    )
    list_filter = ("activo", "es_default", "solution")
    search_fields = ("nombre", "clave")
    readonly_fields = ("fecha_creacion", "fecha_actualizacion")


@admin.register(ConfiguracionPagoPlataforma)
class ConfiguracionPagoPlataformaAdmin(admin.ModelAdmin):
    list_display = ("nombre", "stripe_modo", "capa_facturacion", "fecha_actualizacion")
    list_filter = ("stripe_modo",)
    search_fields = ("nombre", "capa_facturacion__nombre")
    readonly_fields = ("fecha_creacion", "fecha_actualizacion")


@admin.register(SuscripcionCapa)
class SuscripcionCapaAdmin(admin.ModelAdmin):
    list_display = (
        "capa_negocio",
        "plan",
        "estatus",
        "periodicidad",
        "fecha_fin_periodo_actual",
    )
    list_filter = ("estatus", "periodicidad", "plan")
    search_fields = ("capa_negocio__nombre", "stripe_customer_id", "stripe_subscription_id")


@admin.register(GoLiveApproval)
class GoLiveApprovalAdmin(admin.ModelAdmin):
    list_display = (
        "capa_negocio",
        "estatus",
        "fecha_go_live",
        "responsable_betterp",
        "responsable_cliente",
        "backup_restore_validado",
        "post_go_live_dia_1_validado",
        "post_go_live_dia_7_validado",
        "post_go_live_tarea_estado",
        "post_go_live_responsable",
        "post_go_live_fecha_objetivo",
        "fecha_aprobacion",
    )
    list_filter = (
        "estatus",
        "backup_restore_validado",
        "automatizaciones_activas",
        "post_go_live_dia_1_validado",
        "post_go_live_dia_7_validado",
        "post_go_live_tarea_estado",
        "post_go_live_prioridad",
    )
    search_fields = (
        "capa_negocio__nombre",
        "responsable_betterp",
        "responsable_cliente",
        "smoke_previo",
        "backup_referencia",
    )
    readonly_fields = ("fecha_creacion", "fecha_actualizacion")


@admin.register(CambioPlanSaaS)
class CambioPlanSaaSAdmin(admin.ModelAdmin):
    list_display = (
        "suscripcion",
        "plan_anterior",
        "plan_nuevo",
        "tipo",
        "modo",
        "preferencia_credito",
        "estatus",
        "total_estimado",
        "saldo_a_favor_estimado",
        "fecha_creacion",
    )
    list_filter = ("tipo", "modo", "preferencia_credito", "estatus", "stripe_modo")
    search_fields = (
        "suscripcion__capa_negocio__nombre",
        "stripe_subscription_id",
        "stripe_invoice_id",
        "stripe_refund_id",
    )
    readonly_fields = ("fecha_creacion", "fecha_actualizacion")


@admin.register(VendedorBetterP)
class VendedorBetterPAdmin(admin.ModelAdmin):
    list_display = (
        "nombre",
        "email",
        "telefono",
        "porcentaje_comision_default",
        "activo",
        "fecha_actualizacion",
    )
    list_filter = ("activo",)
    search_fields = ("nombre", "email", "telefono")
    readonly_fields = ("token_acceso", "fecha_creacion", "fecha_actualizacion")


@admin.register(AsignacionComercialSaaS)
class AsignacionComercialSaaSAdmin(admin.ModelAdmin):
    list_display = (
        "suscripcion",
        "vendedor",
        "origen",
        "porcentaje_comision",
        "comision_activa",
        "fecha_inicio",
        "fecha_fin",
    )
    list_filter = ("origen", "comision_activa", "vendedor")
    search_fields = ("suscripcion__capa_negocio__nombre", "vendedor__nombre", "vendedor__email")


@admin.register(CostoOperativoSaaS)
class CostoOperativoSaaSAdmin(admin.ModelAdmin):
    list_display = (
        "suscripcion",
        "categoria",
        "concepto",
        "monto_mensual",
        "activo",
        "fecha_inicio",
        "fecha_fin",
    )
    list_filter = ("categoria", "activo")
    search_fields = ("suscripcion__capa_negocio__nombre", "concepto")


@admin.register(ConsumoSaaS)
class ConsumoSaaSAdmin(admin.ModelAdmin):
    list_display = (
        "capa_negocio",
        "openai_tokens_consumidos",
        "emails_enviados_ajuste",
        "whatsapp_mensajes_enviados_ajuste",
        "fecha_actualizacion",
    )
    search_fields = ("capa_negocio__nombre",)


@admin.register(MovimientoConsumoSaaS)
class MovimientoConsumoSaaSAdmin(admin.ModelAdmin):
    list_display = (
        "capa_negocio",
        "periodo",
        "categoria",
        "cantidad",
        "costo_estimado",
        "fecha_consumo",
    )
    list_filter = ("periodo", "categoria", "fecha_consumo")
    search_fields = (
        "capa_negocio__nombre",
        "descripcion",
        "referencia_unica",
        "origen_modelo",
    )


@admin.register(EventoBilling)
class EventoBillingAdmin(admin.ModelAdmin):
    list_display = (
        "tipo_evento",
        "proveedor",
        "capa_negocio",
        "estatus",
        "fecha_creacion",
    )
    list_filter = ("proveedor", "estatus")
    search_fields = ("tipo_evento", "referencia_externa", "capa_negocio__nombre")


@admin.register(BackendRequestMetric)
class BackendRequestMetricAdmin(admin.ModelAdmin):
    list_display = ("method", "path", "status_code", "duration_ms", "user_id", "fecha_creacion")
    list_filter = ("method", "status_code", "fecha_creacion")
    search_fields = ("path", "request_id", "remote_addr")
    readonly_fields = (
        "method",
        "path",
        "status_code",
        "duration_ms",
        "request_id",
        "user_id",
        "remote_addr",
        "metadata",
        "fecha_creacion",
    )


@admin.register(ProspectoComercial)
class ProspectoComercialAdmin(admin.ModelAdmin):
    list_display = (
        "nombre",
        "empresa",
        "email",
        "telefono",
        "etapa",
        "origen",
        "solution",
        "fecha_creacion",
    )
    list_filter = ("etapa", "origen", "solution", "fecha_creacion")
    search_fields = ("nombre", "empresa", "email", "telefono")
