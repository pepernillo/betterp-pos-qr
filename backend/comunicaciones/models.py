import re

from django.contrib.auth.models import User
from django.db import models
from django.db.models import Q
from django.utils import timezone

from crm.models import Cliente
from empresas.models import CapaNegocio, EntidadNegocio


class ConfiguracionComunicacion(models.Model):
    MODO_FILTRO_GREEN_API_CHOICES = [
        ("SOLO_PERMITIDOS", "Solo chats permitidos"),
        ("TODOS", "Todos los chats"),
    ]

    capa_negocio = models.ForeignKey(
        CapaNegocio,
        on_delete=models.CASCADE,
        related_name="configuraciones_comunicacion",
        blank=True,
        null=True,
    )
    clave = models.CharField(max_length=40, default="PRINCIPAL")
    green_api_api_url = models.URLField(max_length=500, blank=True, null=True)
    green_api_instance_id = models.CharField(max_length=120, blank=True, null=True)
    green_api_token = models.CharField(max_length=255, blank=True, null=True)
    green_api_webhook_url = models.URLField(max_length=500, blank=True, null=True)
    green_api_webhook_token = models.CharField(max_length=255, blank=True, null=True)
    green_api_modo_filtro = models.CharField(
        max_length=24,
        choices=MODO_FILTRO_GREEN_API_CHOICES,
        default="SOLO_PERMITIDOS",
    )
    green_api_sync_settings = models.BooleanField(default=False)
    procesar_webhooks_async = models.BooleanField(default=True)
    make_webhook_url = models.URLField(max_length=500, blank=True, null=True)
    openai_model = models.CharField(max_length=120, blank=True, null=True)
    prompt_extraccion = models.TextField(blank=True, null=True)
    auto_detectar_comprobantes = models.BooleanField(default=True)
    auto_crear_eventos = models.BooleanField(default=True)
    auto_aplicar_eventos_confiables = models.BooleanField(default=False)
    auto_conciliar_eventos = models.BooleanField(default=False)
    umbral_confianza_autoaplicacion = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        default=85,
    )
    ventana_match_dias = models.PositiveSmallIntegerField(default=7)
    tolerancia_monto = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=0,
    )
    email_activo = models.BooleanField(default=False)
    email_remitente_nombre = models.CharField(max_length=180, blank=True, null=True)
    email_remitente = models.EmailField(blank=True, null=True)
    email_responder_a = models.EmailField(blank=True, null=True)
    respetar_bajas_whatsapp = models.BooleanField(
        default=True,
        help_text=(
            "Si esta activo, las respuestas BAJA, STOP o NO ENVIAR marcan al "
            "cliente como no contactar para cobranza."
        ),
    )
    portal_token_horas = models.PositiveSmallIntegerField(default=168)
    activo = models.BooleanField(default=True)
    fecha_actualizacion = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["capa_negocio", "clave"],
                condition=Q(capa_negocio__isnull=False),
                name="unique_config_comunicacion_por_capa_clave",
            ),
        ]
        ordering = ["clave"]

    def __str__(self):
        capa = f" - {self.capa_negocio.nombre}" if self.capa_negocio_id else ""
        return f"Configuracion {self.clave}{capa}"


class CanalPermitido(models.Model):
    CANAL_CHOICES = [
        ("GRUPO_WHATSAPP", "Grupo de WhatsApp"),
        ("CHAT_WHATSAPP", "Chat individual de WhatsApp"),
        ("EMAIL", "Correo electronico"),
        ("MANUAL", "Carga manual"),
    ]
    TIPO_MOVIMIENTO_DEFAULT_CHOICES = [
        ("AUTO", "Auto"),
        ("INGRESO", "Ingreso"),
        ("EGRESO", "Egreso"),
    ]

    configuracion_relacionada = models.ForeignKey(
        ConfiguracionComunicacion,
        on_delete=models.CASCADE,
        related_name="canales_permitidos",
    )
    canal = models.CharField(max_length=30, choices=CANAL_CHOICES)
    nombre = models.CharField(max_length=160)
    identificador_externo = models.CharField(max_length=180)
    entidad_relacionada = models.ForeignKey(
        EntidadNegocio,
        on_delete=models.SET_NULL,
        related_name="canales_comunicacion",
        blank=True,
        null=True,
    )
    cliente_relacionado = models.ForeignKey(
        Cliente,
        on_delete=models.SET_NULL,
        related_name="canales_comunicacion",
        blank=True,
        null=True,
    )
    tipo_movimiento_default = models.CharField(
        max_length=20,
        choices=TIPO_MOVIMIENTO_DEFAULT_CHOICES,
        default="AUTO",
    )
    capturar_evidencias = models.BooleanField(default=True)
    descripcion = models.CharField(max_length=255, blank=True, null=True)
    activo = models.BooleanField(default=True)
    fecha_creacion = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["configuracion_relacionada", "identificador_externo"],
                name="unique_canal_permitido_por_configuracion",
            )
        ]
        ordering = ["nombre", "id"]

    def __str__(self):
        return f"{self.nombre} ({self.identificador_externo})"


class CanalWhatsappOficial(models.Model):
    PROVEEDOR_CHOICES = [
        ("META_CLOUD_API", "WhatsApp Cloud API (Meta)"),
    ]
    ESTADO_CHOICES = [
        ("BORRADOR", "Borrador"),
        ("PENDIENTE", "Pendiente de enlace"),
        ("CONECTADO", "Conectado"),
        ("ERROR", "Error"),
        ("DESCONECTADO", "Desconectado"),
    ]

    capa_negocio = models.ForeignKey(
        CapaNegocio,
        on_delete=models.CASCADE,
        related_name="canales_whatsapp_oficiales",
    )
    proveedor = models.CharField(
        max_length=30,
        choices=PROVEEDOR_CHOICES,
        default="META_CLOUD_API",
    )
    nombre = models.CharField(max_length=140)
    nombre_interno = models.CharField(max_length=160, blank=True, null=True)
    display_phone_number = models.CharField(max_length=80, blank=True, null=True)
    numero_wa_id = models.CharField(max_length=40, blank=True, null=True)
    phone_number_id = models.CharField(max_length=120, blank=True, null=True)
    business_account_id = models.CharField(max_length=120, blank=True, null=True)
    waba_id = models.CharField(max_length=120, blank=True, null=True)
    access_token = models.TextField(blank=True, null=True)
    webhook_fields = models.JSONField(blank=True, null=True)
    metadata = models.JSONField(blank=True, null=True)
    entidad_relacionada = models.ForeignKey(
        EntidadNegocio,
        on_delete=models.SET_NULL,
        related_name="canales_whatsapp_oficiales",
        blank=True,
        null=True,
    )
    cliente_relacionado = models.ForeignKey(
        Cliente,
        on_delete=models.SET_NULL,
        related_name="canales_whatsapp_oficiales",
        blank=True,
        null=True,
    )
    estado = models.CharField(
        max_length=20,
        choices=ESTADO_CHOICES,
        default="BORRADOR",
    )
    puede_enviar = models.BooleanField(default=True)
    puede_recibir = models.BooleanField(default=True)
    es_principal = models.BooleanField(default=False)
    activo = models.BooleanField(default=True)
    fecha_ultimo_check = models.DateTimeField(blank=True, null=True)
    fecha_conexion = models.DateTimeField(blank=True, null=True)
    fecha_actualizacion = models.DateTimeField(auto_now=True)
    fecha_creacion = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["phone_number_id"],
                condition=Q(phone_number_id__isnull=False),
                name="unique_canal_whatsapp_phone_number_id",
            ),
        ]
        ordering = ["-es_principal", "nombre", "id"]

    def __str__(self):
        label = self.display_phone_number or self.numero_wa_id or "Sin numero"
        return f"{self.nombre} | {label}"


class AcuerdoUsoComunicacion(models.Model):
    capa_negocio = models.ForeignKey(
        CapaNegocio,
        on_delete=models.CASCADE,
        related_name="acuerdos_uso_comunicacion",
    )
    aceptado_por = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        related_name="acuerdos_uso_comunicacion",
        blank=True,
        null=True,
    )
    tipo_acuerdo = models.CharField(max_length=80)
    version = models.CharField(max_length=40)
    titulo = models.CharField(max_length=180)
    texto_hash = models.CharField(max_length=64)
    ip_address = models.CharField(max_length=64, blank=True, null=True)
    user_agent = models.TextField(blank=True, null=True)
    metadata = models.JSONField(blank=True, null=True)
    fecha_aceptacion = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["capa_negocio", "tipo_acuerdo", "version", "texto_hash"],
                name="uq_acucom_capa_tipo_ver_hash",
            )
        ]
        indexes = [
            models.Index(
                fields=["capa_negocio", "tipo_acuerdo", "-fecha_aceptacion"],
                name="idx_acucom_capa_tipo_fecha",
            ),
        ]
        ordering = ["-fecha_aceptacion", "-id"]

    def __str__(self):
        return f"{self.capa_negocio} | {self.tipo_acuerdo} | {self.version}"


class PortalOtpChallenge(models.Model):
    ESTADO_CHOICES = [
        ("PENDIENTE", "Pendiente"),
        ("VERIFICADO", "Verificado"),
        ("EXPIRADO", "Expirado"),
        ("BLOQUEADO", "Bloqueado"),
        ("ERROR", "Error"),
    ]

    cliente = models.ForeignKey(
        Cliente,
        on_delete=models.CASCADE,
        related_name="portal_otp_challenges",
    )
    token_hash = models.CharField(max_length=64, db_index=True)
    codigo_hash = models.CharField(max_length=64)
    session_token_hash = models.CharField(
        max_length=64,
        blank=True,
        null=True,
        db_index=True,
    )
    destinatario = models.CharField(max_length=64)
    estado = models.CharField(
        max_length=20,
        choices=ESTADO_CHOICES,
        default="PENDIENTE",
    )
    intentos = models.PositiveSmallIntegerField(default=0)
    fecha_expiracion = models.DateTimeField()
    fecha_verificacion = models.DateTimeField(blank=True, null=True)
    metadata = models.JSONField(blank=True, null=True)
    fecha_creacion = models.DateTimeField(auto_now_add=True)
    fecha_actualizacion = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(
                fields=["cliente", "token_hash", "estado", "-fecha_creacion"],
                name="idx_portal_otp_cliente_token",
            ),
            models.Index(
                fields=["session_token_hash", "estado", "fecha_expiracion"],
                name="idx_portal_otp_session",
            ),
        ]
        ordering = ["-fecha_creacion", "-id"]

    def __str__(self):
        return f"OTP portal {self.cliente_id} | {self.estado}"


class CasoProcesamiento(models.Model):
    ESTATUS_CHOICES = [
        ("NUEVO", "Nuevo"),
        ("EN_REVISION", "En revision"),
        ("EXTRAIDO", "Extraido"),
        ("VINCULADO", "Vinculado"),
        ("CONCILIADO", "Conciliado"),
        ("DESCARTADO", "Descartado"),
    ]
    CANAL_CHOICES = [
        ("WHATSAPP", "WhatsApp"),
        ("EMAIL", "Correo electronico"),
        ("MANUAL", "Manual"),
    ]

    entidad_relacionada = models.ForeignKey(
        EntidadNegocio,
        on_delete=models.SET_NULL,
        related_name="casos_procesamiento",
        blank=True,
        null=True,
    )
    cliente_relacionado = models.ForeignKey(
        Cliente,
        on_delete=models.SET_NULL,
        related_name="casos_procesamiento",
        blank=True,
        null=True,
    )
    clave_externa = models.CharField(max_length=180, blank=True, null=True)
    grupo_externo_id = models.CharField(max_length=180, blank=True, null=True)
    canal = models.CharField(max_length=20, choices=CANAL_CHOICES, default="WHATSAPP")
    remitente = models.CharField(max_length=80)
    remitente_nombre = models.CharField(max_length=180, blank=True, null=True)
    texto_consolidado = models.TextField(blank=True, null=True)
    caption_consolidado = models.TextField(blank=True, null=True)
    metadata = models.JSONField(blank=True, null=True)
    estatus = models.CharField(max_length=20, choices=ESTATUS_CHOICES, default="NUEVO")
    fecha_ultimo_mensaje = models.DateTimeField(default=timezone.now)
    fecha_registro = models.DateTimeField(auto_now_add=True)
    fecha_actualizacion = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["clave_externa"],
                condition=Q(clave_externa__isnull=False),
                name="unique_caso_procesamiento_clave_externa",
            )
        ]
        ordering = ["-fecha_ultimo_mensaje", "-id"]

    def __str__(self):
        return f"Caso {self.id} | {self.remitente}"


class PlantillaMensaje(models.Model):
    CANAL_CHOICES = [
        ("WHATSAPP", "WhatsApp"),
        ("EMAIL", "Correo electronico"),
        ("AMBOS", "WhatsApp y correo"),
    ]
    TIPO_PLANTILLA_CHOICES = [
        ("LIBRE", "Libre"),
        ("RECORDATORIO_PAGO", "Recordatorio de pago"),
        ("AVISO_INTERES", "Aviso de interes"),
        ("MENSAJE_PERSONALIZADO", "Mensaje personalizado"),
        ("PORTAL_AUTOSERVICIO", "Portal de autoservicio"),
    ]
    WHATSAPP_TEMPLATE_CATEGORY_CHOICES = [
        ("UTILITY", "Utility"),
        ("MARKETING", "Marketing"),
        ("AUTHENTICATION", "Authentication"),
    ]
    WHATSAPP_TEMPLATE_STATUS_CHOICES = [
        ("NO_CONFIGURADA", "No configurada"),
        ("BORRADOR", "Borrador"),
        ("EN_REVISION", "En revision"),
        ("APROBADA", "Aprobada"),
        ("RECHAZADA", "Rechazada"),
        ("PAUSADA", "Pausada"),
    ]

    capa_negocio = models.ForeignKey(
        CapaNegocio,
        on_delete=models.CASCADE,
        related_name="plantillas_mensaje",
        blank=True,
        null=True,
    )
    nombre = models.CharField(
        max_length=100,
        help_text="Ej. Aviso de corte o recordatorio.",
    )
    descripcion = models.CharField(max_length=255, blank=True, null=True)
    canal = models.CharField(max_length=20, choices=CANAL_CHOICES)
    tipo_plantilla = models.CharField(
        max_length=30,
        choices=TIPO_PLANTILLA_CHOICES,
        default="MENSAJE_PERSONALIZADO",
    )
    asunto = models.CharField(max_length=180, blank=True, null=True)
    cuerpo = models.TextField(help_text="Usa {{variables}} para personalizar.")
    incluye_link_portal = models.BooleanField(default=True)
    url_media = models.URLField(max_length=500, blank=True, null=True)
    whatsapp_template_name = models.CharField(max_length=120, blank=True, null=True)
    whatsapp_template_language = models.CharField(
        max_length=16,
        blank=True,
        null=True,
        default="es_MX",
    )
    whatsapp_template_category = models.CharField(
        max_length=32,
        choices=WHATSAPP_TEMPLATE_CATEGORY_CHOICES,
        blank=True,
        null=True,
    )
    whatsapp_template_status = models.CharField(
        max_length=24,
        choices=WHATSAPP_TEMPLATE_STATUS_CHOICES,
        default="NO_CONFIGURADA",
    )
    whatsapp_template_notes = models.CharField(max_length=255, blank=True, null=True)
    activo = models.BooleanField(default=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["capa_negocio", "nombre"],
                condition=Q(capa_negocio__isnull=False),
                name="unique_plantilla_mensaje_por_capa_nombre",
            ),
        ]
        ordering = ["nombre"]

    def __str__(self):
        return f"{self.nombre} ({self.canal})"


class ReglaAutomatizacionMensaje(models.Model):
    CANAL_CHOICES = [
        ("WHATSAPP", "WhatsApp"),
        ("EMAIL", "Correo electronico"),
        ("AMBOS", "WhatsApp y correo"),
    ]
    EVENTO_BASE_CHOICES = [
        ("FECHA_VENCIMIENTO", "Fecha de vencimiento"),
        ("FECHA_LIMITE_GRACIA", "Fecha limite de gracia"),
    ]
    SEGMENTO_CHOICES = [
        ("TODOS_ACTIVOS", "Todos los clientes activos"),
        ("CXC_ABIERTA", "Cartera abierta"),
        ("POR_VENCER", "Por vencer"),
        ("EN_GRACIA", "En gracia"),
        ("VENCIDA_CON_RECARGO", "Vencida con recargo"),
    ]

    configuracion_relacionada = models.ForeignKey(
        ConfiguracionComunicacion,
        on_delete=models.CASCADE,
        related_name="reglas_automatizacion",
    )
    plantilla_relacionada = models.ForeignKey(
        PlantillaMensaje,
        on_delete=models.CASCADE,
        related_name="reglas_automatizacion",
    )
    entidad_relacionada = models.ForeignKey(
        EntidadNegocio,
        on_delete=models.SET_NULL,
        related_name="reglas_comunicacion",
        blank=True,
        null=True,
    )
    nombre = models.CharField(max_length=140)
    descripcion = models.CharField(max_length=255, blank=True, null=True)
    canal = models.CharField(max_length=20, choices=CANAL_CHOICES, default="WHATSAPP")
    evento_base = models.CharField(
        max_length=25,
        choices=EVENTO_BASE_CHOICES,
        default="FECHA_VENCIMIENTO",
    )
    desplazamiento_dias = models.SmallIntegerField(default=0)
    segmento = models.CharField(
        max_length=30,
        choices=SEGMENTO_CHOICES,
        default="CXC_ABIERTA",
    )
    activo = models.BooleanField(default=True)
    fecha_creacion = models.DateTimeField(auto_now_add=True)
    fecha_actualizacion = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["nombre", "id"]

    def __str__(self):
        return f"{self.nombre} ({self.canal})"


class ContactoPruebaWhatsapp(models.Model):
    capa_negocio = models.ForeignKey(
        CapaNegocio,
        on_delete=models.CASCADE,
        related_name="contactos_prueba_whatsapp",
    )
    nombre = models.CharField(max_length=160)
    telefono = models.CharField(max_length=40)
    telefono_normalizado = models.CharField(max_length=32)
    notas = models.CharField(max_length=255, blank=True, null=True)
    consentimiento_confirmado = models.BooleanField(default=False)
    activo = models.BooleanField(default=True)
    creado_por = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        related_name="contactos_prueba_whatsapp_creados",
        blank=True,
        null=True,
    )
    fecha_creacion = models.DateTimeField(auto_now_add=True)
    fecha_actualizacion = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["capa_negocio", "telefono_normalizado"],
                name="unique_contacto_prueba_whatsapp_capa_telefono",
            )
        ]
        ordering = ["nombre", "telefono_normalizado"]

    def save(self, *args, **kwargs):
        digits = re.sub(r"\D", "", self.telefono_normalizado or self.telefono or "")
        if digits.startswith("521") and len(digits) > 12:
            digits = f"52{digits[3:]}"
        self.telefono_normalizado = digits
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.nombre} | {self.telefono_normalizado}"


class HistorialEnvio(models.Model):
    ESTATUS_ENVIO_CHOICES = [
        ("ENVIADO", "Enviado"),
        ("ENTREGADO", "Entregado"),
        ("LEIDO", "Leido"),
        ("OMITIDO", "Omitido"),
        ("ERROR", "Error"),
        ("ERROR_SPAM", "Error o rechazado"),
    ]
    CANAL_CHOICES = [
        ("WHATSAPP", "WhatsApp"),
        ("EMAIL", "Correo electronico"),
    ]
    TIPO_ENVIO_CHOICES = [
        ("MANUAL", "Manual"),
        ("AUTOMATICO", "Automatico"),
    ]
    PROVEEDOR_CHOICES = [
        ("GREEN_API", "Green API"),
        ("META_CLOUD_API", "WhatsApp Cloud API (Meta)"),
        ("RESEND", "Resend"),
        ("SMTP", "SMTP"),
        ("MANUAL", "Manual"),
    ]

    configuracion_relacionada = models.ForeignKey(
        ConfiguracionComunicacion,
        on_delete=models.SET_NULL,
        related_name="historial_envios",
        blank=True,
        null=True,
    )
    cliente_relacionado = models.ForeignKey(
        Cliente,
        on_delete=models.CASCADE,
        related_name="mensajes_recibidos",
    )
    entidad_relacionada = models.ForeignKey(
        EntidadNegocio,
        on_delete=models.SET_NULL,
        related_name="historial_envios",
        blank=True,
        null=True,
    )
    plantilla_usada = models.ForeignKey(
        PlantillaMensaje,
        on_delete=models.SET_NULL,
        null=True,
    )
    automatizacion_relacionada = models.ForeignKey(
        ReglaAutomatizacionMensaje,
        on_delete=models.SET_NULL,
        related_name="historial_envios",
        blank=True,
        null=True,
    )
    canal = models.CharField(max_length=20, choices=CANAL_CHOICES, default="WHATSAPP")
    tipo_envio = models.CharField(
        max_length=20,
        choices=TIPO_ENVIO_CHOICES,
        default="MANUAL",
    )
    proveedor = models.CharField(
        max_length=20,
        choices=PROVEEDOR_CHOICES,
        default="MANUAL",
    )
    destinatario = models.CharField(max_length=255, blank=True, null=True)
    asunto = models.CharField(max_length=180, blank=True, null=True)
    cuerpo_renderizado = models.TextField(blank=True, null=True)
    url_media = models.URLField(max_length=500, blank=True, null=True)
    referencia_envio = models.CharField(max_length=180, blank=True, null=True)
    llave_idempotencia = models.CharField(max_length=180, blank=True, null=True)
    metadata = models.JSONField(blank=True, null=True)
    fecha_envio = models.DateTimeField(auto_now_add=True)
    estatus = models.CharField(
        max_length=20,
        choices=ESTATUS_ENVIO_CHOICES,
        default="ENVIADO",
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["llave_idempotencia"],
                condition=Q(llave_idempotencia__isnull=False),
                name="unique_historial_envio_llave_idempotencia",
            )
        ]
        ordering = ["-fecha_envio", "-id"]

    def __str__(self):
        return f"A: {self.cliente_relacionado} - {self.estatus}"


class WebhookEntrante(models.Model):
    PROVEEDOR_CHOICES = [
        ("GREEN_API", "Green API"),
        ("META_CLOUD_API", "WhatsApp Cloud API (Meta)"),
        ("MAKE", "Make"),
        ("MANUAL", "Manual"),
    ]
    ESTATUS_PROCESAMIENTO_CHOICES = [
        ("PENDIENTE", "Pendiente"),
        ("PROCESANDO", "Procesando"),
        ("PROCESADO", "Procesado"),
        ("IGNORADO", "Ignorado"),
        ("ERROR", "Error"),
    ]

    proveedor = models.CharField(
        max_length=30,
        choices=PROVEEDOR_CHOICES,
        default="GREEN_API",
    )
    tipo_webhook = models.CharField(max_length=80, blank=True, null=True)
    origen_externo_id = models.CharField(max_length=180, blank=True, null=True)
    chat_id = models.CharField(max_length=180, blank=True, null=True)
    remitente = models.CharField(max_length=80, blank=True, null=True)
    payload_completo = models.JSONField(
        help_text="Carga cruda recibida desde Meta, Make u otra fuente.",
    )
    fecha_recepcion = models.DateTimeField(auto_now_add=True)
    estatus_procesamiento = models.CharField(
        max_length=20,
        choices=ESTATUS_PROCESAMIENTO_CHOICES,
        default="PENDIENTE",
    )
    intentos_procesamiento = models.PositiveIntegerField(default=0)
    fecha_procesamiento = models.DateTimeField(blank=True, null=True)
    error_procesamiento = models.TextField(blank=True, null=True)
    procesado = models.BooleanField(
        default=False,
        help_text="True cuando ya se normalizo en mensaje o evidencia.",
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["proveedor", "origen_externo_id"],
                condition=Q(origen_externo_id__isnull=False),
                name="unique_webhook_entrante_por_proveedor_origen",
            )
        ]
        ordering = ["-fecha_recepcion", "-id"]

    def __str__(self):
        return f"Webhook {self.id} recibido el {self.fecha_recepcion:%Y-%m-%d %H:%M}"


class MensajeEntrante(models.Model):
    CANAL_CHOICES = [
        ("WHATSAPP", "WhatsApp"),
        ("EMAIL", "Correo electronico"),
        ("MANUAL", "Registro manual"),
    ]

    webhook_relacionado = models.ForeignKey(
        WebhookEntrante,
        on_delete=models.SET_NULL,
        related_name="mensajes_normalizados",
        blank=True,
        null=True,
    )
    caso_relacionado = models.ForeignKey(
        CasoProcesamiento,
        on_delete=models.SET_NULL,
        related_name="mensajes",
        blank=True,
        null=True,
    )
    entidad_relacionada = models.ForeignKey(
        EntidadNegocio,
        on_delete=models.SET_NULL,
        related_name="mensajes_entrantes",
        blank=True,
        null=True,
    )
    cliente_relacionado = models.ForeignKey(
        Cliente,
        on_delete=models.SET_NULL,
        related_name="mensajes_entrantes",
        blank=True,
        null=True,
    )
    chat_id = models.CharField(max_length=180, blank=True, null=True)
    origen_externo_id = models.CharField(max_length=180, blank=True, null=True)
    canal = models.CharField(max_length=20, choices=CANAL_CHOICES, default="WHATSAPP")
    tipo_mensaje = models.CharField(max_length=60, blank=True, null=True)
    remitente = models.CharField(max_length=80)
    remitente_nombre = models.CharField(max_length=180, blank=True, null=True)
    fecha_mensaje = models.DateTimeField()
    texto = models.TextField(blank=True, null=True)
    url_adjunto = models.URLField(max_length=500, blank=True, null=True)
    metadata = models.JSONField(blank=True, null=True)
    procesado = models.BooleanField(default=False)
    fecha_registro = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["origen_externo_id"],
                condition=Q(origen_externo_id__isnull=False),
                name="unique_mensaje_entrante_origen_externo",
            )
        ]
        ordering = ["-fecha_mensaje", "-id"]

    def __str__(self):
        return f"{self.canal} | {self.remitente} | {self.fecha_mensaje:%Y-%m-%d %H:%M}"


class EvidenciaPago(models.Model):
    ESTATUS_CHOICES = [
        ("NUEVA", "Nueva"),
        ("APLICADA", "Aplicada"),
        ("VALIDADA", "Validada"),
        ("DESCARTADA", "Descartada"),
    ]
    TIPO_MOVIMIENTO_CHOICES = [
        ("INGRESO", "Ingreso"),
        ("EGRESO", "Egreso"),
    ]
    ORIGEN_DETECCION_CHOICES = [
        ("MANUAL", "Manual"),
        ("GREEN_API", "Green API"),
        ("META_CLOUD_API", "WhatsApp Cloud API (Meta)"),
        ("MAKE", "Make"),
        ("SISTEMA", "Sistema"),
    ]

    entidad_relacionada = models.ForeignKey(
        EntidadNegocio,
        on_delete=models.SET_NULL,
        related_name="evidencias_pago",
        blank=True,
        null=True,
    )
    caso_relacionado = models.ForeignKey(
        CasoProcesamiento,
        on_delete=models.SET_NULL,
        related_name="evidencias",
        blank=True,
        null=True,
    )
    cliente_relacionado = models.ForeignKey(
        Cliente,
        on_delete=models.SET_NULL,
        related_name="evidencias_pago",
        blank=True,
        null=True,
    )
    mensaje_relacionado = models.ForeignKey(
        MensajeEntrante,
        on_delete=models.SET_NULL,
        related_name="evidencias_pago",
        blank=True,
        null=True,
    )
    canal = models.CharField(
        max_length=20,
        choices=MensajeEntrante.CANAL_CHOICES,
        default="WHATSAPP",
    )
    tipo_movimiento = models.CharField(
        max_length=20,
        choices=TIPO_MOVIMIENTO_CHOICES,
        default="INGRESO",
    )
    origen_deteccion = models.CharField(
        max_length=20,
        choices=ORIGEN_DETECCION_CHOICES,
        default="MANUAL",
    )
    url_archivo = models.URLField(max_length=500, blank=True, null=True)
    hash_archivo = models.CharField(max_length=120, blank=True, null=True)
    monto_reportado = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        blank=True,
        null=True,
    )
    fecha_pago_reportada = models.DateField(blank=True, null=True)
    referencia_reportada = models.CharField(max_length=120, blank=True, null=True)
    texto_extraido = models.TextField(blank=True, null=True)
    confianza_clasificacion = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        default=0,
    )
    requiere_revision_manual = models.BooleanField(default=True)
    categoria_sugerida = models.CharField(max_length=120, blank=True, null=True)
    metadata = models.JSONField(blank=True, null=True)
    observaciones = models.TextField(blank=True, null=True)
    estatus = models.CharField(
        max_length=20,
        choices=ESTATUS_CHOICES,
        default="NUEVA",
    )
    fecha_registro = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["hash_archivo"],
                condition=Q(hash_archivo__isnull=False),
                name="unique_evidencia_pago_hash_archivo",
            )
        ]
        ordering = ["-fecha_registro", "-id"]

    def __str__(self):
        return (
            f"Evidencia {self.id} | {self.tipo_movimiento} | "
            f"{self.monto_reportado or 0} | {self.estatus}"
        )
