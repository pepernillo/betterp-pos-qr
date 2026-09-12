from django.db import models
from empresas.models import EntidadNegocio, ReglaNegocio

class Cliente(models.Model):
    entidad_relacionada = models.ForeignKey(EntidadNegocio, on_delete=models.CASCADE, related_name='clientes')
    
    # --- Datos Fiscales ---
    es_persona_moral = models.BooleanField(default=False)
    nombre_comercial = models.CharField(max_length=200, blank=True, null=True)
    razon_social = models.CharField(max_length=250, help_text="Nombre o Razón Social tal cual en la CSF")
    rfc = models.CharField(max_length=13)
    regimen_fiscal = models.CharField(max_length=150, blank=True, null=True)
    regimenes_fiscales_detectados = models.JSONField(blank=True, null=True)
    regimen_fiscal_pendiente_seleccion = models.BooleanField(default=False)
    identificador = models.CharField(max_length=100, blank=True, null=True, help_text="ID Interno opcional")
    condiciones_pago = models.CharField(max_length=100, blank=True, null=True)
    archivo_csf_url = models.URLField(max_length=500, blank=True, null=True, help_text="URL pública o firmada del PDF en Cloudflare R2")
    contrato_digital_url = models.URLField(max_length=500, blank=True, null=True, help_text="URL del contrato digital del cliente en R2")
    contrato_digital_nombre = models.CharField(max_length=255, blank=True, null=True, help_text="Nombre original del archivo de contrato")

    # --- Datos de Contacto ---
    correo_principal = models.EmailField(blank=True, null=True)
    codigo_pais = models.CharField(max_length=10, default="+52")
    telefono = models.CharField(max_length=20, help_text="Crucial para validación de pagos en Make/WhatsApp")
    
    # --- Dirección ---
    pais = models.CharField(max_length=50, default="México")
    estado = models.CharField(max_length=100, blank=True, null=True)
    ciudad = models.CharField(max_length=100, blank=True, null=True)
    colonia = models.CharField(max_length=150, blank=True, null=True)
    calle = models.CharField(max_length=150, blank=True, null=True)
    numero_exterior = models.CharField(max_length=50, blank=True, null=True)
    numero_interior = models.CharField(max_length=50, blank=True, null=True)
    codigo_postal = models.CharField(max_length=5, blank=True, null=True)

    # --- Configuración (Interno) ---
    agente_cobranza = models.CharField(max_length=150, blank=True, null=True)
    dia_corte_individual = models.IntegerField(blank=True, null=True, help_text="Obligatorio si la entidad usa corte INDIVIDUAL (1-31)")
    dias_gracia = models.IntegerField(default=0, help_text="Días de tolerancia antes de recargos")
    
    consentimiento_cobranza_aceptado = models.BooleanField(default=False)
    consentimiento_cobranza_fecha = models.DateTimeField(blank=True, null=True)
    consentimiento_cobranza_version = models.CharField(max_length=30, blank=True, null=True)
    consentimiento_cobranza_texto_hash = models.CharField(max_length=64, blank=True, null=True)
    consentimiento_cobranza_metadata = models.JSONField(blank=True, null=True)
    no_contactar_cobranza = models.BooleanField(default=False)
    no_contactar_cobranza_motivo = models.CharField(max_length=240, blank=True, null=True)
    no_contactar_cobranza_fecha = models.DateTimeField(blank=True, null=True)

    activo = models.BooleanField(default=True)
    fecha_registro = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(
                fields=["entidad_relacionada", "activo"],
                name="idx_cliente_ent_activo",
            ),
            models.Index(
                fields=["entidad_relacionada", "identificador"],
                name="idx_cliente_ent_ident",
            ),
            models.Index(
                fields=["entidad_relacionada", "telefono"],
                name="idx_cliente_ent_tel",
            ),
        ]

    def __str__(self):
        return f"{self.razon_social or self.nombre_comercial} ({self.entidad_relacionada.nombre_comercial})"

class ServicioContratado(models.Model):
    cliente_relacionado = models.ForeignKey(Cliente, on_delete=models.CASCADE, related_name='servicios_contratados')
    regla_relacionada = models.ForeignKey(ReglaNegocio, on_delete=models.CASCADE)
    fecha_inicio = models.DateField()
    fecha_fin = models.DateField(blank=True, null=True, help_text="Dejar en blanco si es indefinido")

    def __str__(self):
        return f"{self.regla_relacionada.nombre} -> {self.cliente_relacionado.razon_social or self.cliente_relacionado.nombre_comercial}"
