from django.db import models
from django.db.models import Q
from django.contrib.auth.models import User
from django.utils import timezone
from decimal import Decimal
import secrets

from empresas.models import CapaNegocio


def generate_seller_token() -> str:
    return secrets.token_urlsafe(32)


class Solucion(models.Model):
    ESTATUS_CHOICES = [
        ("ACTIVA", "Activa"),
        ("BETA", "Beta"),
        ("INCUBACION", "Incubacion"),
        ("PAUSADA", "Pausada"),
    ]
    TIPO_CHOICES = [
        ("INTERNA", "Interna"),
        ("EXTERNA", "Externa"),
        ("HIBRIDA", "Hibrida"),
    ]

    clave = models.CharField(max_length=60, unique=True)
    nombre = models.CharField(max_length=150)
    descripcion = models.TextField(blank=True, null=True)
    estatus = models.CharField(max_length=20, choices=ESTATUS_CHOICES, default="INCUBACION")
    tipo = models.CharField(max_length=20, choices=TIPO_CHOICES, default="INTERNA")
    repo_origen = models.CharField(max_length=180, blank=True, null=True)
    branch_origen = models.CharField(max_length=180, blank=True, null=True)
    url_app = models.URLField(max_length=500, blank=True, null=True)
    url_api = models.URLField(max_length=500, blank=True, null=True)
    metadata = models.JSONField(default=dict, blank=True)
    fecha_creacion = models.DateTimeField(auto_now_add=True)
    fecha_actualizacion = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["nombre", "id"]
        indexes = [
            models.Index(fields=["estatus", "tipo"], name="idx_solucion_estatus_tipo"),
        ]

    def __str__(self):
        return self.nombre


class PlanSaaS(models.Model):
    solution = models.ForeignKey(
        Solucion,
        on_delete=models.PROTECT,
        related_name="planes",
        blank=True,
        null=True,
    )
    clave = models.CharField(max_length=50, unique=True)
    nombre = models.CharField(max_length=150)
    descripcion = models.TextField(blank=True, null=True)
    activo = models.BooleanField(default=True)
    es_default = models.BooleanField(default=False)
    precio_mensual = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    precio_anual = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    stripe_test_price_id_mensual = models.CharField(max_length=120, blank=True, null=True)
    stripe_test_price_id_anual = models.CharField(max_length=120, blank=True, null=True)
    stripe_price_id_mensual = models.CharField(max_length=120, blank=True, null=True)
    stripe_price_id_anual = models.CharField(max_length=120, blank=True, null=True)
    max_usuarios = models.PositiveIntegerField(default=3)
    max_entidades = models.PositiveIntegerField(default=3)
    max_productos = models.PositiveIntegerField(default=30)
    dias_prueba = models.PositiveIntegerField(default=10)
    openai_tokens_incluidos = models.PositiveBigIntegerField(default=0)
    whatsapp_mensajes_incluidos = models.PositiveIntegerField(default=0)
    comprobantes_whatsapp_incluidos = models.PositiveIntegerField(default=0)
    timbres_facturacion_incluidos = models.PositiveIntegerField(default=0)
    emails_incluidos = models.PositiveIntegerField(default=0)
    precio_openai_1k_tokens_extra = models.DecimalField(
        max_digits=10,
        decimal_places=4,
        default=0,
    )
    precio_whatsapp_mensaje_extra = models.DecimalField(
        max_digits=10,
        decimal_places=4,
        default=0,
    )
    precio_comprobante_whatsapp_extra = models.DecimalField(
        max_digits=10,
        decimal_places=4,
        default=0,
    )
    precio_timbre_facturacion_extra = models.DecimalField(
        max_digits=10,
        decimal_places=4,
        default=0,
    )
    precio_email_extra = models.DecimalField(
        max_digits=10,
        decimal_places=4,
        default=0,
    )
    permite_google_login = models.BooleanField(default=True)
    permite_webhooks = models.BooleanField(default=True)
    modulos_habilitados = models.JSONField(default=list, blank=True)
    funciones_habilitadas = models.JSONField(default=list, blank=True)
    fecha_creacion = models.DateTimeField(auto_now_add=True)
    fecha_actualizacion = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["precio_mensual", "id"]

    def __str__(self):
        return self.nombre


class ConfiguracionPagoPlataforma(models.Model):
    STRIPE_MODE_CHOICES = [
        ("TEST", "Prueba"),
        ("LIVE", "Produccion"),
    ]

    nombre = models.CharField(max_length=40, unique=True, default="default")
    capa_facturacion = models.ForeignKey(
        CapaNegocio,
        on_delete=models.SET_NULL,
        related_name="configuraciones_pago_plataforma",
        blank=True,
        null=True,
    )
    stripe_modo = models.CharField(
        max_length=10,
        choices=STRIPE_MODE_CHOICES,
        default="TEST",
    )
    fecha_creacion = models.DateTimeField(auto_now_add=True)
    fecha_actualizacion = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Configuracion de pago de plataforma"
        verbose_name_plural = "Configuraciones de pago de plataforma"

    def __str__(self):
        return f"Pagos BetterP - {self.stripe_modo}"


class SuscripcionCapa(models.Model):
    ESTATUS_CHOICES = [
        ("TRIAL", "Trial"),
        ("PENDIENTE_PAGO", "Pendiente de pago"),
        ("ACTIVA", "Activa"),
        ("PAST_DUE", "Past due"),
        ("CANCELADA", "Cancelada"),
        ("PAUSADA", "Pausada"),
    ]
    PERIODICIDAD_CHOICES = [
        ("MENSUAL", "Mensual"),
        ("ANUAL", "Anual"),
    ]

    capa_negocio = models.OneToOneField(
        CapaNegocio,
        on_delete=models.CASCADE,
        related_name="suscripcion",
    )
    plan = models.ForeignKey(
        PlanSaaS,
        on_delete=models.PROTECT,
        related_name="suscripciones",
    )
    estatus = models.CharField(max_length=20, choices=ESTATUS_CHOICES, default="TRIAL")
    periodicidad = models.CharField(
        max_length=20,
        choices=PERIODICIDAD_CHOICES,
        default="MENSUAL",
    )
    stripe_customer_id = models.CharField(max_length=120, blank=True, null=True)
    stripe_subscription_id = models.CharField(max_length=120, blank=True, null=True)
    stripe_checkout_session_id = models.CharField(max_length=120, blank=True, null=True)
    fecha_inicio = models.DateField(blank=True, null=True)
    fecha_fin_periodo_actual = models.DateField(blank=True, null=True)
    auto_renueva = models.BooleanField(default=True)
    metadata = models.JSONField(blank=True, null=True)
    fecha_creacion = models.DateTimeField(auto_now_add=True)
    fecha_actualizacion = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["capa_negocio__nombre", "id"]

    def __str__(self):
        return f"{self.capa_negocio.nombre} - {self.plan.nombre}"


class CambioPlanSaaS(models.Model):
    TIPO_CHOICES = [
        ("UPGRADE", "Upgrade"),
        ("DOWNGRADE", "Downgrade"),
        ("CAMBIO_CICLO", "Cambio de ciclo"),
        ("MISMO_PLAN", "Mismo plan"),
    ]
    MODO_CHOICES = [
        ("INMEDIATO", "Inmediato"),
        ("AL_RENOVAR", "Al renovar"),
    ]
    PREFERENCIA_CREDITO_CHOICES = [
        ("SALDO", "Saldo a favor"),
        ("TIEMPO", "Tiempo de uso"),
        ("REEMBOLSO", "Reembolso"),
        ("NINGUNA", "Ninguna"),
    ]
    ESTATUS_CHOICES = [
        ("PREVIEW", "Preview"),
        ("EN_PROCESO", "En proceso"),
        ("APLICADO", "Aplicado"),
        ("PENDIENTE_RENOVACION", "Pendiente de renovacion"),
        ("REEMBOLSO_SOLICITADO", "Reembolso solicitado"),
        ("ERROR", "Error"),
    ]

    suscripcion = models.ForeignKey(
        SuscripcionCapa,
        on_delete=models.CASCADE,
        related_name="cambios_plan",
    )
    plan_anterior = models.ForeignKey(
        PlanSaaS,
        on_delete=models.PROTECT,
        related_name="cambios_desde",
    )
    plan_nuevo = models.ForeignKey(
        PlanSaaS,
        on_delete=models.PROTECT,
        related_name="cambios_hacia",
    )
    periodicidad_anterior = models.CharField(max_length=20, default="MENSUAL")
    periodicidad_nueva = models.CharField(max_length=20, default="MENSUAL")
    tipo = models.CharField(max_length=20, choices=TIPO_CHOICES, default="MISMO_PLAN")
    modo = models.CharField(max_length=20, choices=MODO_CHOICES, default="INMEDIATO")
    preferencia_credito = models.CharField(
        max_length=20,
        choices=PREFERENCIA_CREDITO_CHOICES,
        default="SALDO",
    )
    estatus = models.CharField(max_length=30, choices=ESTATUS_CHOICES, default="PREVIEW")
    dias_totales_periodo = models.PositiveIntegerField(default=0)
    dias_restantes_periodo = models.PositiveIntegerField(default=0)
    credito_plan_actual = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    cargo_plan_nuevo = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    total_estimado = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    saldo_a_favor_estimado = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    stripe_modo = models.CharField(max_length=10, default="TEST")
    stripe_subscription_id = models.CharField(max_length=120, blank=True, null=True)
    stripe_invoice_id = models.CharField(max_length=120, blank=True, null=True)
    stripe_refund_id = models.CharField(max_length=120, blank=True, null=True)
    detalle_error = models.TextField(blank=True, null=True)
    metadata = models.JSONField(blank=True, null=True)
    creado_por = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        related_name="cambios_plan_saas_creados",
        blank=True,
        null=True,
    )
    fecha_creacion = models.DateTimeField(auto_now_add=True)
    fecha_actualizacion = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-fecha_creacion", "-id"]
        indexes = [
            models.Index(fields=["suscripcion", "estatus"], name="idx_cambio_plan_sub_est"),
            models.Index(fields=["stripe_subscription_id"], name="idx_cambio_plan_stripe_sub"),
        ]

    def __str__(self):
        return f"{self.suscripcion.capa_negocio.nombre} - {self.plan_anterior.nombre} -> {self.plan_nuevo.nombre}"


class VendedorBetterP(models.Model):
    nombre = models.CharField(max_length=160)
    email = models.EmailField(unique=True)
    telefono = models.CharField(max_length=40, blank=True, null=True)
    activo = models.BooleanField(default=True)
    token_acceso = models.CharField(
        max_length=96,
        unique=True,
        default=generate_seller_token,
    )
    porcentaje_comision_default = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        default=0,
    )
    notas_internas = models.TextField(blank=True, null=True)
    creado_por = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        related_name="vendedores_betterp_creados",
        blank=True,
        null=True,
    )
    fecha_creacion = models.DateTimeField(auto_now_add=True)
    fecha_actualizacion = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["nombre", "id"]

    def __str__(self):
        return self.nombre


class AsignacionComercialSaaS(models.Model):
    ORIGEN_CHOICES = [
        ("VENDEDOR", "Vendedor BetterP"),
        ("PLATAFORMA", "Plataforma"),
        ("ORGANICO", "Organico"),
        ("REFERIDO_TERCERO", "Referido tercero"),
        ("PARTNER", "Partner"),
        ("OTRO", "Otro"),
    ]

    suscripcion = models.OneToOneField(
        SuscripcionCapa,
        on_delete=models.CASCADE,
        related_name="asignacion_comercial",
    )
    vendedor = models.ForeignKey(
        VendedorBetterP,
        on_delete=models.SET_NULL,
        related_name="asignaciones_saas",
        blank=True,
        null=True,
    )
    origen = models.CharField(max_length=30, choices=ORIGEN_CHOICES, default="ORGANICO")
    porcentaje_comision = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    comision_activa = models.BooleanField(default=False)
    fecha_inicio = models.DateField(blank=True, null=True)
    fecha_fin = models.DateField(blank=True, null=True)
    notas_internas = models.TextField(blank=True, null=True)
    creado_por = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        related_name="asignaciones_comerciales_saas_creadas",
        blank=True,
        null=True,
    )
    fecha_creacion = models.DateTimeField(auto_now_add=True)
    fecha_actualizacion = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["suscripcion__capa_negocio__nombre", "id"]
        indexes = [
            models.Index(fields=["origen", "comision_activa"], name="idx_asig_saas_origen_com"),
        ]

    def __str__(self):
        return f"{self.suscripcion.capa_negocio.nombre} - {self.origen}"


class CostoOperativoSaaS(models.Model):
    CATEGORIA_CHOICES = [
        ("SOPORTE", "Soporte"),
        ("IMPLEMENTACION", "Implementacion"),
        ("INFRAESTRUCTURA", "Infraestructura"),
        ("TERCEROS", "Terceros"),
        ("OPERACION", "Operacion"),
        ("OTROS", "Otros"),
    ]

    suscripcion = models.ForeignKey(
        SuscripcionCapa,
        on_delete=models.CASCADE,
        related_name="costos_operativos",
    )
    categoria = models.CharField(max_length=30, choices=CATEGORIA_CHOICES)
    concepto = models.CharField(max_length=180)
    monto_mensual = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    activo = models.BooleanField(default=True)
    fecha_inicio = models.DateField(blank=True, null=True)
    fecha_fin = models.DateField(blank=True, null=True)
    notas_internas = models.TextField(blank=True, null=True)
    creado_por = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        related_name="costos_operativos_saas_creados",
        blank=True,
        null=True,
    )
    fecha_creacion = models.DateTimeField(auto_now_add=True)
    fecha_actualizacion = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["suscripcion__capa_negocio__nombre", "categoria", "id"]
        indexes = [
            models.Index(fields=["suscripcion", "activo"], name="idx_costo_saas_sub_activo"),
        ]

    def __str__(self):
        return f"{self.suscripcion.capa_negocio.nombre} - {self.concepto}"


class ConsumoSaaS(models.Model):
    capa_negocio = models.OneToOneField(
        CapaNegocio,
        on_delete=models.CASCADE,
        related_name="consumo_saas",
    )
    openai_tokens_consumidos = models.PositiveBigIntegerField(default=0)
    emails_enviados_ajuste = models.PositiveIntegerField(default=0)
    whatsapp_mensajes_enviados_ajuste = models.PositiveIntegerField(default=0)
    metadata = models.JSONField(blank=True, null=True)
    fecha_creacion = models.DateTimeField(auto_now_add=True)
    fecha_actualizacion = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["capa_negocio__nombre", "id"]

    def __str__(self):
        return f"Consumo SaaS - {self.capa_negocio.nombre}"


class MovimientoConsumoSaaS(models.Model):
    CATEGORIA_CHOICES = [
        ("OPENAI_TOKENS", "Tokens OpenAI"),
        ("WHATSAPP_OUTBOUND", "Mensaje WhatsApp saliente"),
        ("WHATSAPP_COMPROBANTE", "Comprobante recibido por WhatsApp"),
        ("FACTURA_TIMBRE", "Timbre de facturacion"),
        ("EMAIL_OUTBOUND", "Email saliente"),
        ("BANK_PDF_PARSE", "Lectura de estado de cuenta PDF"),
        ("OTRO", "Otro consumo"),
    ]

    capa_negocio = models.ForeignKey(
        CapaNegocio,
        on_delete=models.CASCADE,
        related_name="movimientos_consumo_saas",
    )
    suscripcion_relacionada = models.ForeignKey(
        SuscripcionCapa,
        on_delete=models.SET_NULL,
        related_name="movimientos_consumo",
        blank=True,
        null=True,
    )
    periodo = models.CharField(max_length=7)
    categoria = models.CharField(max_length=40, choices=CATEGORIA_CHOICES)
    descripcion = models.CharField(max_length=220)
    cantidad = models.PositiveBigIntegerField(default=1)
    unidad = models.CharField(max_length=30, default="unidad")
    costo_unitario = models.DecimalField(max_digits=12, decimal_places=6, default=0)
    costo_estimado = models.DecimalField(max_digits=12, decimal_places=4, default=0)
    referencia_unica = models.CharField(max_length=160, blank=True, null=True)
    origen_modelo = models.CharField(max_length=120, blank=True, null=True)
    origen_id = models.PositiveBigIntegerField(blank=True, null=True)
    metadata = models.JSONField(blank=True, null=True)
    fecha_consumo = models.DateTimeField(default=timezone.now)
    fecha_creacion = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-fecha_consumo", "-id"]
        indexes = [
            models.Index(
                fields=["capa_negocio", "periodo", "categoria"],
                name="idx_movcons_capa_periodo_cat",
            ),
            models.Index(
                fields=["referencia_unica"],
                name="idx_movcons_referencia",
            ),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["capa_negocio", "categoria", "referencia_unica"],
                condition=Q(referencia_unica__isnull=False),
                name="unique_movcons_capa_categoria_ref",
            ),
        ]

    def __str__(self):
        return f"{self.capa_negocio.nombre} - {self.categoria} - {self.periodo}"


class EventoBilling(models.Model):
    PROVEEDOR_CHOICES = [
        ("STRIPE", "Stripe"),
        ("MANUAL", "Manual"),
        ("SISTEMA", "Sistema"),
    ]
    ESTATUS_CHOICES = [
        ("RECIBIDO", "Recibido"),
        ("PROCESADO", "Procesado"),
        ("ERROR", "Error"),
    ]

    capa_negocio = models.ForeignKey(
        CapaNegocio,
        on_delete=models.SET_NULL,
        related_name="eventos_billing",
        blank=True,
        null=True,
    )
    suscripcion_relacionada = models.ForeignKey(
        SuscripcionCapa,
        on_delete=models.SET_NULL,
        related_name="eventos",
        blank=True,
        null=True,
    )
    proveedor = models.CharField(max_length=20, choices=PROVEEDOR_CHOICES, default="SISTEMA")
    tipo_evento = models.CharField(max_length=120)
    referencia_externa = models.CharField(max_length=180, blank=True, null=True)
    payload = models.JSONField(blank=True, null=True)
    estatus = models.CharField(max_length=20, choices=ESTATUS_CHOICES, default="RECIBIDO")
    procesado_en = models.DateTimeField(blank=True, null=True)
    detalle_error = models.TextField(blank=True, null=True)
    fecha_creacion = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-fecha_creacion", "-id"]

    def __str__(self):
        return f"{self.proveedor} - {self.tipo_evento}"


class ProspectoComercial(models.Model):
    ETAPA_CHOICES = [
        ("NUEVO", "Nuevo"),
        ("CONTACTADO", "Contactado"),
        ("DEMO", "Demo"),
        ("PROPUESTA", "Propuesta"),
        ("GANADO", "Ganado"),
        ("PERDIDO", "Perdido"),
    ]
    ORIGEN_CHOICES = [
        ("LANDING", "Landing"),
        ("MANUAL", "Manual"),
        ("REFERIDO", "Referido"),
    ]

    nombre = models.CharField(max_length=180)
    empresa = models.CharField(max_length=180, blank=True, null=True)
    email = models.EmailField()
    telefono = models.CharField(max_length=40, blank=True, null=True)
    mensaje = models.TextField(blank=True, null=True)
    origen = models.CharField(max_length=20, choices=ORIGEN_CHOICES, default="LANDING")
    solution = models.ForeignKey(
        Solucion,
        on_delete=models.SET_NULL,
        related_name="prospectos",
        blank=True,
        null=True,
    )
    etapa = models.CharField(max_length=20, choices=ETAPA_CHOICES, default="NUEVO")
    notas_internas = models.TextField(blank=True, null=True)
    atendido_por = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        related_name="prospectos_atendidos",
        blank=True,
        null=True,
    )
    atendido_en = models.DateTimeField(blank=True, null=True)
    metadata = models.JSONField(blank=True, null=True)
    fecha_creacion = models.DateTimeField(auto_now_add=True)
    fecha_actualizacion = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-fecha_creacion", "-id"]

    def __str__(self):
        empresa = f" - {self.empresa}" if self.empresa else ""
        return f"{self.nombre}{empresa}"

    def excluded_from_marketing_learning(self) -> bool:
        metadata = self.metadata if isinstance(self.metadata, dict) else {}
        if metadata.get("excluded_from_learning") is True or metadata.get("is_test") is True:
            return True
        email = str(self.email or "").strip().lower()
        return email.endswith("@betterp.net")


















class FrontendWebVitalMetric(models.Model):
    METRIC_CHOICES = [
        ("LCP", "Largest Contentful Paint"),
        ("INP", "Interaction to Next Paint"),
        ("CLS", "Cumulative Layout Shift"),
        ("FCP", "First Contentful Paint"),
        ("TTFB", "Time to First Byte"),
    ]
    RATING_CHOICES = [
        ("good", "Good"),
        ("needs-improvement", "Needs improvement"),
        ("poor", "Poor"),
        ("unknown", "Unknown"),
    ]

    metric_id = models.CharField(max_length=120, blank=True, null=True)
    name = models.CharField(max_length=10, choices=METRIC_CHOICES)
    value = models.FloatField(default=0)
    delta = models.FloatField(default=0)
    rating = models.CharField(max_length=30, choices=RATING_CHOICES, default="unknown")
    path = models.CharField(max_length=240)
    navigation_type = models.CharField(max_length=80, blank=True, null=True)
    user_agent = models.CharField(max_length=300, blank=True, null=True)
    metadata = models.JSONField(blank=True, null=True)
    fecha_creacion = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-fecha_creacion", "-id"]
        indexes = [
            models.Index(fields=["name", "fecha_creacion"], name="idx_webvital_name_fecha"),
            models.Index(fields=["path", "fecha_creacion"], name="idx_webvital_path_fecha"),
            models.Index(fields=["rating", "fecha_creacion"], name="idx_webvital_rating_fecha"),
        ]

    def __str__(self):
        return f"{self.name} {self.value} - {self.path}"


class FrontendClientError(models.Model):
    SOURCE_CHOICES = [
        ("window_error", "Window error"),
        ("unhandled_rejection", "Unhandled rejection"),
        ("react_error", "React error"),
        ("unknown", "Unknown"),
    ]

    source = models.CharField(max_length=40, choices=SOURCE_CHOICES, default="unknown")
    error_name = models.CharField(max_length=120, blank=True, null=True)
    message = models.CharField(max_length=500)
    path = models.CharField(max_length=240)
    stack_hash = models.CharField(max_length=64, blank=True, null=True)
    user_agent = models.CharField(max_length=300, blank=True, null=True)
    metadata = models.JSONField(blank=True, null=True)
    fecha_creacion = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-fecha_creacion", "-id"]
        indexes = [
            models.Index(fields=["source", "fecha_creacion"], name="idx_front_error_source_fecha"),
            models.Index(fields=["path", "fecha_creacion"], name="idx_front_error_path_fecha"),
            models.Index(fields=["stack_hash", "fecha_creacion"], name="idx_front_error_hash_fecha"),
        ]

    def __str__(self):
        return f"{self.source} - {self.message[:80]}"


class BackendRequestMetric(models.Model):
    method = models.CharField(max_length=10)
    path = models.CharField(max_length=240)
    status_code = models.PositiveSmallIntegerField(default=0)
    duration_ms = models.PositiveIntegerField(default=0)
    request_id = models.CharField(max_length=64, blank=True, null=True)
    user_id = models.PositiveIntegerField(blank=True, null=True)
    remote_addr = models.CharField(max_length=64, blank=True, null=True)
    metadata = models.JSONField(default=dict, blank=True)
    fecha_creacion = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-fecha_creacion", "-id"]
        indexes = [
            models.Index(fields=["path", "fecha_creacion"], name="idx_backend_req_path_fecha"),
            models.Index(fields=["duration_ms", "fecha_creacion"], name="idx_backend_req_duration"),
            models.Index(fields=["status_code", "fecha_creacion"], name="idx_backend_req_status_fecha"),
        ]

    def __str__(self):
        return f"{self.method} {self.path} {self.duration_ms}ms"


class GoLiveApproval(models.Model):
    STATUS_CHOICES = [
        ("PENDIENTE", "Pendiente"),
        ("APROBADO", "Aprobado"),
        ("APROBADO_CON_PENDIENTES", "Aprobado con pendientes"),
        ("BLOQUEADO", "Bloqueado"),
    ]
    POST_GO_LIVE_TASK_STATUS_CHOICES = [
        ("SIN_TAREA", "Sin tarea"),
        ("ABIERTA", "Abierta"),
        ("EN_PROCESO", "En proceso"),
        ("CERRADA", "Cerrada"),
    ]
    POST_GO_LIVE_PRIORITY_CHOICES = [
        ("BAJA", "Baja"),
        ("MEDIA", "Media"),
        ("ALTA", "Alta"),
        ("CRITICA", "Critica"),
    ]

    capa_negocio = models.OneToOneField(
        CapaNegocio,
        on_delete=models.CASCADE,
        related_name="go_live_approval",
    )
    estatus = models.CharField(max_length=30, choices=STATUS_CHOICES, default="PENDIENTE")
    fecha_go_live = models.DateField(blank=True, null=True)
    responsable_betterp = models.CharField(max_length=150, blank=True, null=True)
    responsable_cliente = models.CharField(max_length=150, blank=True, null=True)
    smoke_previo = models.CharField(max_length=240, blank=True, null=True)
    smoke_posterior = models.CharField(max_length=240, blank=True, null=True)
    backup_referencia = models.CharField(max_length=240, blank=True, null=True)
    backup_restore_validado = models.BooleanField(default=False)
    automatizaciones_activas = models.BooleanField(default=False)
    post_go_live_dia_1_validado = models.BooleanField(default=False)
    post_go_live_dia_7_validado = models.BooleanField(default=False)
    fecha_post_go_live_dia_1 = models.DateTimeField(blank=True, null=True)
    fecha_post_go_live_dia_7 = models.DateTimeField(blank=True, null=True)
    post_go_live_notas = models.TextField(blank=True, null=True)
    post_go_live_tarea_estado = models.CharField(
        max_length=20,
        choices=POST_GO_LIVE_TASK_STATUS_CHOICES,
        default="SIN_TAREA",
    )
    post_go_live_responsable = models.CharField(max_length=150, blank=True, null=True)
    post_go_live_fecha_objetivo = models.DateField(blank=True, null=True)
    post_go_live_prioridad = models.CharField(
        max_length=20,
        choices=POST_GO_LIVE_PRIORITY_CHOICES,
        default="MEDIA",
    )
    pendientes = models.TextField(blank=True, null=True)
    decision = models.TextField(blank=True, null=True)
    aprobado_por = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        related_name="go_live_approvals",
        blank=True,
        null=True,
    )
    fecha_aprobacion = models.DateTimeField(blank=True, null=True)
    metadata = models.JSONField(default=dict, blank=True)
    fecha_creacion = models.DateTimeField(auto_now_add=True)
    fecha_actualizacion = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-fecha_actualizacion", "-id"]
        indexes = [
            models.Index(fields=["estatus", "fecha_actualizacion"], name="idx_golive_status_fecha"),
            models.Index(fields=["fecha_go_live"], name="idx_golive_fecha"),
        ]

    def __str__(self):
        return f"{self.capa_negocio.nombre} - {self.estatus}"


class BackgroundJob(models.Model):
    STATUS_CHOICES = [
        ("PENDING", "Pendiente"),
        ("RUNNING", "En ejecucion"),
        ("SUCCESS", "Exitoso"),
        ("ERROR", "Error"),
        ("CANCELLED", "Cancelado"),
    ]

    kind = models.CharField(max_length=80)
    queue = models.CharField(max_length=60, default="default")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="PENDING")
    payload = models.JSONField(default=dict, blank=True)
    result = models.JSONField(default=dict, blank=True)
    error = models.TextField(blank=True, null=True)
    attempts = models.PositiveIntegerField(default=0)
    max_attempts = models.PositiveIntegerField(default=1)
    available_at = models.DateTimeField(default=timezone.now)
    locked_at = models.DateTimeField(blank=True, null=True)
    locked_by = models.CharField(max_length=120, blank=True, null=True)
    started_at = models.DateTimeField(blank=True, null=True)
    finished_at = models.DateTimeField(blank=True, null=True)
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        related_name="background_jobs_created",
        blank=True,
        null=True,
    )
    fecha_creacion = models.DateTimeField(auto_now_add=True)
    fecha_actualizacion = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["available_at", "id"]
        indexes = [
            models.Index(fields=["status", "available_at"], name="idx_bgjob_status_available"),
            models.Index(fields=["queue", "status", "available_at"], name="idx_bgjob_queue_status_avail"),
            models.Index(fields=["kind", "fecha_creacion"], name="idx_bgjob_kind_created"),
        ]

    def __str__(self):
        return f"{self.kind} - {self.status} - {self.id}"


class CronRunLog(models.Model):
    STATUS_CHOICES = [
        ("RUNNING", "En ejecucion"),
        ("SUCCESS", "Exitoso"),
        ("ERROR", "Error"),
    ]

    key = models.CharField(max_length=80)
    name = models.CharField(max_length=160)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="RUNNING")
    started_at = models.DateTimeField(default=timezone.now)
    finished_at = models.DateTimeField(blank=True, null=True)
    duration_ms = models.PositiveIntegerField(default=0)
    summary = models.CharField(max_length=500, blank=True, null=True)
    error = models.TextField(blank=True, null=True)
    metadata = models.JSONField(blank=True, null=True)

    class Meta:
        ordering = ["-started_at", "-id"]
        indexes = [
            models.Index(fields=["key", "started_at"], name="idx_cronrun_key_started"),
            models.Index(fields=["status", "started_at"], name="idx_cronrun_status_started"),
        ]

    def __str__(self):
        return f"{self.name} - {self.status} - {self.started_at:%Y-%m-%d %H:%M}"
