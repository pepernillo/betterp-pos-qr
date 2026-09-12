from django.db import models
from django.db.models import Q
from django.utils import timezone

from crm.models import Cliente
from empresas.models import CapaNegocio
from finanzas.models import CuentaPorCobrar, PagoCuentaPorCobrar


class CertificadoSelloDigital(models.Model):
    PROVEEDOR_CHOICES = [
        ("FACTURAMA", "Facturama"),
        ("FACTURAPI", "Facturapi"),
        ("FISCALAPI", "FiscalAPI"),
        ("FINKOK", "Finkok"),
        ("SW", "SW Sapien"),
        ("OTRO", "Otro"),
    ]
    MODO_CHOICES = [
        ("SANDBOX", "Sandbox"),
        ("PRODUCCION", "Produccion"),
    ]
    ESTATUS_CHOICES = [
        ("PENDIENTE", "Pendiente"),
        ("VALIDADO", "Validado"),
        ("ERROR", "Error"),
        ("INACTIVO", "Inactivo"),
    ]

    capa_negocio = models.ForeignKey(
        CapaNegocio,
        on_delete=models.CASCADE,
        related_name="certificados_facturacion",
    )
    proveedor = models.CharField(max_length=30, choices=PROVEEDOR_CHOICES, default="FACTURAMA")
    modo = models.CharField(max_length=20, choices=MODO_CHOICES, default="SANDBOX")
    rfc = models.CharField(max_length=13)
    certificado_url = models.URLField(max_length=700, blank=True, null=True)
    llave_url = models.URLField(max_length=700, blank=True, null=True)
    llave_password_encrypted = models.TextField(blank=True, null=True)
    numero_certificado = models.CharField(max_length=80, blank=True, null=True)
    valido_desde = models.DateTimeField(blank=True, null=True)
    valido_hasta = models.DateTimeField(blank=True, null=True)
    estatus = models.CharField(max_length=20, choices=ESTATUS_CHOICES, default="PENDIENTE")
    ultimo_error = models.TextField(blank=True, null=True)
    metadata = models.JSONField(blank=True, null=True)
    activo = models.BooleanField(default=True)
    creado_en = models.DateTimeField(auto_now_add=True)
    actualizado_en = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-activo", "-actualizado_en", "-id"]
        indexes = [
            models.Index(fields=["capa_negocio", "proveedor", "modo"], name="idx_csd_capa_prov_modo"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["capa_negocio", "proveedor", "modo"],
                condition=Q(activo=True),
                name="uniq_csd_activo_capa_prov",
            )
        ]

    def __str__(self):
        return f"{self.capa_negocio.nombre} - {self.proveedor} {self.modo} - {self.rfc}"


class FacturaEmitida(models.Model):
    PROVEEDOR_CHOICES = CertificadoSelloDigital.PROVEEDOR_CHOICES
    MODO_CHOICES = CertificadoSelloDigital.MODO_CHOICES
    CONTEXTO_CHOICES = [
        ("BACKOFFICE_SAAS", "Backoffice SaaS"),
        ("CLIENTE_CXC", "Cliente CxC"),
        ("PORTAL_CLIENTE", "Portal cliente"),
        ("MANUAL", "Manual"),
    ]
    ESTATUS_CHOICES = [
        ("BORRADOR", "Borrador"),
        ("ENVIADA", "Enviada"),
        ("TIMBRADA", "Timbrada"),
        ("ERROR", "Error"),
        ("CANCELADA", "Cancelada"),
    ]

    capa_emisora = models.ForeignKey(
        CapaNegocio,
        on_delete=models.PROTECT,
        related_name="facturas_emitidas",
    )
    cliente_receptor = models.ForeignKey(
        Cliente,
        on_delete=models.SET_NULL,
        related_name="facturas_recibidas",
        blank=True,
        null=True,
    )
    cuenta_por_cobrar = models.ForeignKey(
        CuentaPorCobrar,
        on_delete=models.SET_NULL,
        related_name="facturas_emitidas",
        blank=True,
        null=True,
    )
    pago_cxc = models.ForeignKey(
        PagoCuentaPorCobrar,
        on_delete=models.SET_NULL,
        related_name="facturas_emitidas",
        blank=True,
        null=True,
    )
    suscripcion_saas = models.ForeignKey(
        "billing.SuscripcionCapa",
        on_delete=models.SET_NULL,
        related_name="facturas_emitidas",
        blank=True,
        null=True,
    )
    contexto = models.CharField(max_length=30, choices=CONTEXTO_CHOICES)
    proveedor = models.CharField(max_length=30, choices=PROVEEDOR_CHOICES, default="FACTURAMA")
    modo = models.CharField(max_length=20, choices=MODO_CHOICES, default="SANDBOX")
    estatus = models.CharField(max_length=20, choices=ESTATUS_CHOICES, default="BORRADOR")
    serie = models.CharField(max_length=20, blank=True, null=True)
    folio = models.CharField(max_length=60, blank=True, null=True)
    uuid = models.CharField(max_length=80, blank=True, null=True)
    proveedor_factura_id = models.CharField(max_length=160, blank=True, null=True)
    idempotency_key = models.CharField(max_length=180, unique=True)
    tipo_comprobante = models.CharField(max_length=5, default="I")
    moneda = models.CharField(max_length=10, default="MXN")
    emisor_rfc = models.CharField(max_length=13)
    emisor_razon_social = models.CharField(max_length=220)
    emisor_regimen_fiscal = models.CharField(max_length=20)
    receptor_rfc = models.CharField(max_length=13)
    receptor_razon_social = models.CharField(max_length=220)
    receptor_regimen_fiscal = models.CharField(max_length=20, blank=True, null=True)
    receptor_codigo_postal = models.CharField(max_length=10, blank=True, null=True)
    receptor_uso_cfdi = models.CharField(max_length=10, default="G03")
    subtotal = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    impuestos = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    total = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    fecha_emision = models.DateTimeField(default=timezone.now)
    fecha_timbrado = models.DateTimeField(blank=True, null=True)
    payload_proveedor = models.JSONField(blank=True, null=True)
    respuesta_proveedor = models.JSONField(blank=True, null=True)
    error_proveedor = models.TextField(blank=True, null=True)
    xml_url = models.URLField(max_length=700, blank=True, null=True)
    pdf_url = models.URLField(max_length=700, blank=True, null=True)
    metadata = models.JSONField(blank=True, null=True)
    creado_en = models.DateTimeField(auto_now_add=True)
    actualizado_en = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-fecha_emision", "-id"]
        indexes = [
            models.Index(fields=["capa_emisora", "contexto", "estatus"], name="idx_fact_capa_ctx_estatus"),
            models.Index(fields=["uuid"], name="idx_fact_uuid"),
        ]

    def __str__(self):
        return f"{self.serie or ''}{self.folio or self.id} - {self.receptor_razon_social}"


class FacturaPartida(models.Model):
    factura = models.ForeignKey(
        FacturaEmitida,
        on_delete=models.CASCADE,
        related_name="partidas",
    )
    descripcion = models.CharField(max_length=255)
    clave_producto_servicio = models.CharField(max_length=20)
    clave_unidad = models.CharField(max_length=20)
    cantidad = models.DecimalField(max_digits=12, decimal_places=4, default=1)
    precio_unitario = models.DecimalField(max_digits=14, decimal_places=4)
    subtotal = models.DecimalField(max_digits=14, decimal_places=2)
    impuestos = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    total = models.DecimalField(max_digits=14, decimal_places=2)
    objeto_impuesto = models.CharField(max_length=5, default="01")
    metadata = models.JSONField(blank=True, null=True)
    creado_en = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["id"]

    def __str__(self):
        return f"{self.descripcion} - {self.total}"
