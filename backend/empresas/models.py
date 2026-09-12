from django.db import models
from django.db.models import Q
from django.contrib.auth.models import User

PERIODICIDAD_CHOICES = [
    ("UNICO", "Cobro Unico"),
    ("SEMANAL", "Semanal"),
    ("QUINCENAL", "Quincenal"),
    ("MENSUAL", "Mensual"),
    ("BIMESTRAL", "Bimestral"),
    ("ANUAL", "Anual"),
]


class CapaNegocio(models.Model):
    TIPO_CAPA_CHOICES = [
        ("ADMINISTRADORA", "Administradora"),
        ("EMPRESA", "Empresa"),
        ("HOTEL", "Hotel"),
        ("GRUPO", "Grupo"),
        ("OPERADORA", "Operadora"),
    ]

    APLICACION_PAGOS_CHOICES = [
        ("ADEUDO_MAS_ANTIGUO", "Adeudo mas antiguo"),
        ("SALDO_A_FAVOR", "Conservar saldo a favor"),
    ]

    FECHA_VENCIMIENTO_MODO_CHOICES = [
        ("PENDIENTE", "Pendiente"),
        ("GLOBAL", "Misma fecha para todos"),
        ("INDIVIDUAL", "Fecha individual por cliente"),
    ]

    FACTURACION_MODO_CHOICES = [
        ("MANUAL", "Manual"),
        ("SANDBOX", "PAC Sandbox"),
        ("PRODUCCION", "PAC Produccion"),
    ]

    PAC_PROVEEDOR_CHOICES = [
        ("SIN_PROVEEDOR", "Sin proveedor"),
        ("FACTURAMA", "Facturama"),
        ("FACTURAPI", "Facturapi"),
        ("FISCALAPI", "FiscalAPI"),
        ("FINKOK", "Finkok"),
        ("SW", "SW Sapien"),
        ("OTRO", "Otro"),
    ]

    nombre = models.CharField(max_length=180, unique=True)
    tipo_capa = models.CharField(
        max_length=20,
        choices=TIPO_CAPA_CHOICES,
        default="OPERADORA",
    )
    nombre_administrador = models.CharField(max_length=150, blank=True, null=True)
    es_persona_moral = models.BooleanField(default=True)
    razon_social = models.CharField(max_length=180, blank=True, null=True)
    rfc = models.CharField(max_length=13, blank=True, null=True)
    regimen_fiscal = models.CharField(max_length=100, blank=True, null=True)
    correo_contacto = models.EmailField(blank=True, null=True)
    telefono_contacto = models.CharField(max_length=20, blank=True, null=True)
    logo_url = models.URLField(max_length=500, blank=True, null=True)
    pais_fiscal = models.CharField(max_length=80, default="Mexico")
    codigo_postal_fiscal = models.CharField(max_length=10, blank=True, null=True)
    estado_fiscal = models.CharField(max_length=100, blank=True, null=True)
    municipio_fiscal = models.CharField(max_length=120, blank=True, null=True)
    colonia_fiscal = models.CharField(max_length=120, blank=True, null=True)
    calle_fiscal = models.CharField(max_length=180, blank=True, null=True)
    numero_exterior_fiscal = models.CharField(max_length=40, blank=True, null=True)
    numero_interior_fiscal = models.CharField(max_length=40, blank=True, null=True)
    facturacion_activa = models.BooleanField(default=False)
    facturacion_modo = models.CharField(
        max_length=20,
        choices=FACTURACION_MODO_CHOICES,
        default="MANUAL",
    )
    facturacion_pac_proveedor = models.CharField(
        max_length=30,
        choices=PAC_PROVEEDOR_CHOICES,
        default="SIN_PROVEEDOR",
    )
    facturacion_serie_ingresos = models.CharField(max_length=10, default="A")
    facturacion_lugar_expedicion = models.CharField(max_length=10, blank=True, null=True)
    facturacion_producto_servicio = models.CharField(max_length=20, blank=True, null=True)
    facturacion_unidad = models.CharField(max_length=20, default="E48")
    facturacion_uso_cfdi_default = models.CharField(max_length=10, default="G03")
    facturacion_metodo_pago_default = models.CharField(max_length=10, default="PUE")
    facturacion_forma_pago_default = models.CharField(max_length=10, default="03")
    portal_clientes_activo = models.BooleanField(default=False)
    portal_clientes_url_base = models.URLField(max_length=500, blank=True, null=True)
    seguridad_doble_factor_activa = models.BooleanField(default=False)
    usuario_fundador = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        related_name="capas_fundadas",
        blank=True,
        null=True,
    )
    clabe_transferencias = models.CharField(max_length=18, blank=True, null=True)
    banco_transferencias = models.CharField(max_length=80, blank=True, null=True)
    beneficiario_transferencias = models.CharField(max_length=180, blank=True, null=True)
    referencia_transferencia_prefijo = models.CharField(max_length=20, default="BETT")
    plazo_meses_default = models.PositiveSmallIntegerField(default=12)
    periodicidad_cobro_default = models.CharField(
        max_length=20,
        choices=PERIODICIDAD_CHOICES,
        default="MENSUAL",
    )
    fecha_vencimiento_modo = models.CharField(
        max_length=20,
        choices=FECHA_VENCIMIENTO_MODO_CHOICES,
        default="PENDIENTE",
    )
    dia_vencimiento_default = models.PositiveSmallIntegerField(blank=True, null=True)
    dias_gracia_default = models.PositiveSmallIntegerField(default=0)
    auto_renueva_default = models.BooleanField(default=False)
    aplicacion_pagos = models.CharField(
        max_length=25,
        choices=APLICACION_PAGOS_CHOICES,
        default="ADEUDO_MAS_ANTIGUO",
    )
    activo = models.BooleanField(default=True)
    fecha_creacion = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["nombre"]

    def __str__(self):
        return self.nombre


class EntidadNegocio(models.Model):
    TIPO_CORTE_CHOICES = [
        ("GENERAL", "General (Ej. Condominios)"),
        ("INDIVIDUAL", "Individual (Ej. Aniversario)"),
    ]

    capa_negocio = models.ForeignKey(
        CapaNegocio,
        on_delete=models.SET_NULL,
        related_name="entidades",
        blank=True,
        null=True,
    )
    nombre_comercial = models.CharField(max_length=150)
    ciudad = models.CharField(max_length=100, blank=True, null=True)
    razon_social = models.CharField(max_length=150, blank=True, null=True)
    rfc = models.CharField(max_length=13, blank=True, null=True)
    regimen_fiscal = models.CharField(max_length=100, blank=True, null=True)
    tipo_fecha_corte = models.CharField(
        max_length=20,
        choices=TIPO_CORTE_CHOICES,
        default="INDIVIDUAL",
    )
    dia_corte_general = models.IntegerField(
        blank=True,
        null=True,
        help_text="Solo si el corte es GENERAL (1-31)",
    )
    logo_url = models.URLField(max_length=500, blank=True, null=True)
    activo = models.BooleanField(default=True)
    fecha_creacion = models.DateTimeField(auto_now_add=True)
    fecha_pausa = models.DateField(
        blank=True,
        null=True,
        help_text="Fecha en que se detuvo la operacion/cobranza",
    )

    class Meta:
        indexes = [
            models.Index(
                fields=["capa_negocio", "activo"],
                name="idx_entidad_capa_activo",
            ),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["capa_negocio", "nombre_comercial"],
                condition=Q(capa_negocio__isnull=False),
                name="unique_entidad_nombre_por_capa",
            ),
            models.UniqueConstraint(
                fields=["nombre_comercial"],
                condition=Q(capa_negocio__isnull=True),
                name="unique_entidad_nombre_sin_capa",
            ),
        ]
        ordering = ["nombre_comercial"]

    def __str__(self):
        return self.nombre_comercial


class ReglaMarcoNegocio(models.Model):
    TIPO_CALCULO_CHOICES = [
        ("CARGO_FIJO", "Cargo Fijo ($)"),
        ("DESCUENTO_FIJO", "Descuento Fijo (-$)"),
        ("PORCENTAJE_RECARGO", "Porcentaje de Recargo (+)"),
        ("PORCENTAJE_DESCUENTO", "Porcentaje de Descuento (-)"),
    ]

    capa_negocio = models.ForeignKey(
        CapaNegocio,
        on_delete=models.CASCADE,
        related_name="reglas_marco",
    )
    nombre = models.CharField(
        max_length=150,
        help_text="Ej. Interes moratorio, deposito, poliza juridica",
    )
    tipo_calculo = models.CharField(max_length=30, choices=TIPO_CALCULO_CHOICES)
    valor = models.DecimalField(max_digits=10, decimal_places=2)
    periodicidad = models.CharField(max_length=20, choices=PERIODICIDAD_CHOICES)
    aplica_a_todos = models.BooleanField(default=False)
    dias_condicion = models.IntegerField(null=True, blank=True)
    activo = models.BooleanField(default=True)
    fecha_creacion = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["capa_negocio", "nombre"],
                name="unique_regla_marco_por_capa_y_nombre",
            )
        ]
        ordering = ["nombre"]

    def __str__(self):
        return f"{self.nombre} - {self.capa_negocio.nombre}"


class BackupCapaExport(models.Model):
    ESTATUS_CHOICES = [
        ("GENERADO", "Generado"),
        ("ERROR", "Error"),
    ]

    capa_negocio = models.ForeignKey(
        CapaNegocio,
        on_delete=models.CASCADE,
        related_name="backups_exportados",
    )
    archivo_nombre = models.CharField(max_length=240)
    storage_backend = models.CharField(max_length=30, default="LOCAL")
    bucket = models.CharField(max_length=180, blank=True, null=True)
    object_key = models.CharField(max_length=500, blank=True, null=True)
    size_bytes = models.PositiveIntegerField(default=0)
    checksum_sha256 = models.CharField(max_length=64, blank=True, null=True)
    estatus = models.CharField(max_length=20, choices=ESTATUS_CHOICES, default="GENERADO")
    detalle_error = models.TextField(blank=True, null=True)
    generado_por = models.CharField(max_length=120, blank=True, null=True)
    metadata = models.JSONField(blank=True, null=True)
    fecha_creacion = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-fecha_creacion", "-id"]
        indexes = [
            models.Index(fields=["capa_negocio", "fecha_creacion"], name="idx_backup_capa_fecha"),
            models.Index(fields=["storage_backend", "estatus"], name="idx_backup_storage_est"),
        ]

    def __str__(self):
        return f"{self.capa_negocio.nombre} - {self.archivo_nombre}"


class ReglaNegocio(models.Model):
    TIPO_CALCULO_CHOICES = [
        ("CARGO_FIJO", "Cargo Fijo ($)"),
        ("DESCUENTO_FIJO", "Descuento Fijo (-$)"),
        ("PORCENTAJE_RECARGO", "Porcentaje de Recargo (+)"),
        ("PORCENTAJE_DESCUENTO", "Porcentaje de Descuento (-)"),
    ]

    entidad = models.ForeignKey(
        EntidadNegocio,
        on_delete=models.CASCADE,
        related_name="reglas_dinamicas",
    )
    regla_marco = models.ForeignKey(
        ReglaMarcoNegocio,
        on_delete=models.SET_NULL,
        related_name="reglas_personalizadas",
        blank=True,
        null=True,
    )

    nombre = models.CharField(
        max_length=150,
        help_text="Ej. Cuota Mantenimiento, Mejora Fachada, Penalizacion",
    )
    tipo_calculo = models.CharField(max_length=30, choices=TIPO_CALCULO_CHOICES)
    valor = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        help_text="Monto fijo o porcentaje (ej. 5.0 para 5%)",
    )
    periodicidad = models.CharField(max_length=20, choices=PERIODICIDAD_CHOICES)
    aplica_a_todos = models.BooleanField(
        default=False,
        help_text="Si es True, se genera el cobro automaticamente a todos los clientes.",
    )
    dias_condicion = models.IntegerField(
        null=True,
        blank=True,
        help_text="Usar 3 para atraso o -5 para pronto pago.",
    )
    activo = models.BooleanField(default=True)
    fecha_creacion = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["entidad", "regla_marco"],
                condition=Q(regla_marco__isnull=False),
                name="unique_override_por_entidad_y_regla_marco",
            )
        ]
        ordering = ["-fecha_creacion", "-id"]

    def __str__(self):
        return (
            f"{self.nombre} ({self.get_periodicidad_display()}) - "
            f"{self.entidad.nombre_comercial}"
        )
