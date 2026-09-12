from decimal import Decimal

from django.db import models
from django.db.models import Q
from django.utils import timezone

from crm.models import Cliente
from empresas.models import CapaNegocio, EntidadNegocio, PERIODICIDAD_CHOICES


class SaldoCliente(models.Model):
    entidad_relacionada = models.ForeignKey(
        EntidadNegocio,
        on_delete=models.CASCADE,
        related_name="saldos_clientes",
    )
    cliente_relacionado = models.OneToOneField(
        Cliente,
        on_delete=models.CASCADE,
        related_name="saldo_cliente",
    )
    saldo_a_favor = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    fecha_actualizacion = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["cliente_relacionado__razon_social", "cliente_relacionado__id"]

    def __str__(self):
        return (
            f"Saldo a favor {self.cliente_relacionado.razon_social or self.cliente_relacionado.nombre_comercial}: "
            f"${self.saldo_a_favor}"
        )


class CuentaBancaria(models.Model):
    capa_negocio = models.ForeignKey(
        CapaNegocio,
        on_delete=models.CASCADE,
        related_name="cuentas_bancarias",
        blank=True,
        null=True,
    )
    entidad_relacionada = models.ForeignKey(
        EntidadNegocio,
        on_delete=models.CASCADE,
        related_name="cuentas_bancarias",
        blank=True,
        null=True,
    )
    nombre = models.CharField(max_length=160)
    alias = models.CharField(max_length=160, blank=True, null=True)
    banco = models.CharField(max_length=120, blank=True, null=True)
    numero_cuenta = models.CharField(max_length=40, blank=True, null=True)
    clabe = models.CharField(max_length=18, blank=True, null=True)
    ultima_4 = models.CharField(max_length=4, blank=True, null=True)
    moneda = models.CharField(max_length=10, default="MXN")
    activa = models.BooleanField(default=True)
    metadata = models.JSONField(blank=True, null=True)
    fecha_registro = models.DateTimeField(auto_now_add=True)
    fecha_actualizacion = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["nombre", "id"]

    def __str__(self):
        banco = f" | {self.banco}" if self.banco else ""
        suffix = self.ultima_4 or (self.numero_cuenta[-4:] if self.numero_cuenta else "")
        tail = f" ****{suffix}" if suffix else ""
        return f"{self.nombre}{banco}{tail}"


class CuentaPorCobrar(models.Model):
    ESTATUS_ADEUDO_CHOICES = [
        ("PENDIENTE", "Pendiente"),
        ("PARCIAL", "Pago parcial"),
        ("VENCIDO", "Vencido"),
        ("POR_CONCILIAR", "Por conciliar"),
        ("CONCILIADO", "Conciliado"),
        ("CANCELADO", "Cancelado"),
        ("INCOBRABLE", "Incobrable"),
    ]

    ORIGEN_CHOICES = [
        ("RENTA", "Renta"),
        ("DEPOSITO", "Deposito"),
        ("REGLA", "Regla de negocio"),
        ("AJUSTE", "Ajuste manual"),
        ("SALDO_A_FAVOR", "Aplicacion saldo a favor"),
    ]

    entidad_relacionada = models.ForeignKey(
        EntidadNegocio,
        on_delete=models.CASCADE,
        related_name="cuentas_por_cobrar",
        blank=True,
        null=True,
    )
    cliente_relacionado = models.ForeignKey(
        Cliente,
        on_delete=models.CASCADE,
        related_name="cuentas_por_cobrar",
    )
    concepto = models.CharField(max_length=255)
    origen = models.CharField(
        max_length=25,
        choices=ORIGEN_CHOICES,
        default="RENTA",
    )
    periodicidad = models.CharField(
        max_length=20,
        choices=PERIODICIDAD_CHOICES,
        default="MENSUAL",
    )
    referencia_unica = models.CharField(max_length=180, blank=True, null=True)
    fecha_periodo_inicio = models.DateField(blank=True, null=True)
    fecha_periodo_fin = models.DateField(blank=True, null=True)
    fecha_programada = models.DateField(blank=True, null=True)
    fecha_emision = models.DateField(default=timezone.localdate)
    fecha_vencimiento = models.DateField()
    monto_total = models.DecimalField(max_digits=12, decimal_places=2)
    monto_pagado = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    saldo_a_favor_aplicado = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=0,
    )
    estatus_adeudo = models.CharField(
        max_length=20,
        choices=ESTATUS_ADEUDO_CHOICES,
        default="PENDIENTE",
    )
    observaciones = models.TextField(blank=True, null=True)

    class Meta:
        indexes = [
            models.Index(
                fields=["entidad_relacionada", "estatus_adeudo", "fecha_vencimiento"],
                name="idx_cxc_ent_estatus_fecha",
            ),
            models.Index(
                fields=["cliente_relacionado", "estatus_adeudo"],
                name="idx_cxc_cliente_estatus",
            ),
            models.Index(
                fields=[
                    "entidad_relacionada",
                    "fecha_periodo_inicio",
                    "fecha_vencimiento",
                ],
                name="idx_cxc_ent_periodo",
            ),
            models.Index(
                fields=[
                    "cliente_relacionado",
                    "fecha_periodo_inicio",
                    "fecha_vencimiento",
                ],
                name="idx_cxc_cli_periodo",
            ),
            models.Index(
                fields=["referencia_unica"],
                name="idx_cxc_referencia",
            ),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["entidad_relacionada", "referencia_unica"],
                condition=Q(referencia_unica__isnull=False)
                & Q(entidad_relacionada__isnull=False),
                name="unique_cxc_referencia_por_entidad",
            )
        ]
        ordering = ["fecha_vencimiento", "id"]

    def __str__(self):
        cliente_nombre = (
            self.cliente_relacionado.razon_social
            or self.cliente_relacionado.nombre_comercial
            or f"Cliente {self.cliente_relacionado_id}"
        )
        return f"{cliente_nombre} - {self.concepto} (${self.monto_total})"

    @property
    def saldo_pendiente(self) -> Decimal:
        saldo = (self.monto_total or Decimal("0")) - (self.monto_pagado or Decimal("0"))
        return max(saldo, Decimal("0"))

    def recalcular_estatus(
        self,
        *,
        persist: bool = False,
        pagos_pendientes_validacion: bool | None = None,
    ) -> str:
        if self.estatus_adeudo in {"CANCELADO", "INCOBRABLE"}:
            return self.estatus_adeudo

        saldo = self.saldo_pendiente
        today = timezone.localdate()
        if saldo <= 0 and pagos_pendientes_validacion is None:
            pagos_pendientes_validacion = bool(
                self.pk
                and self.pagos_aplicados.filter(
                    estatus_validacion="APLICADO"
                ).exists()
            )

        if saldo <= 0:
            nuevo_estatus = "POR_CONCILIAR" if pagos_pendientes_validacion else "CONCILIADO"
        elif self.monto_pagado > 0:
            nuevo_estatus = "VENCIDO" if self.fecha_vencimiento < today else "PARCIAL"
        else:
            nuevo_estatus = "VENCIDO" if self.fecha_vencimiento < today else "PENDIENTE"

        if persist and nuevo_estatus != self.estatus_adeudo:
            self.estatus_adeudo = nuevo_estatus
            self.save(update_fields=["estatus_adeudo"])

        return nuevo_estatus


class PagoCuentaPorCobrar(models.Model):
    METODO_CHOICES = [
        ("TRANSFERENCIA", "Transferencia"),
        ("EFECTIVO", "Efectivo"),
        ("TARJETA", "Tarjeta"),
        ("DEPOSITO", "Deposito"),
        ("AJUSTE", "Ajuste"),
    ]
    CANAL_ORIGEN_CHOICES = [
        ("MANUAL", "Manual"),
        ("WHATSAPP", "WhatsApp"),
        ("ESTADO_CUENTA", "Estado de cuenta"),
        ("SALDO_A_FAVOR", "Saldo a favor"),
        ("AJUSTE_SISTEMA", "Ajuste del sistema"),
    ]
    ESTATUS_VALIDACION_CHOICES = [
        ("APLICADO", "Aplicado"),
        ("VALIDADO", "Validado"),
        ("RECHAZADO", "Rechazado"),
    ]

    cuenta_por_cobrar = models.ForeignKey(
        CuentaPorCobrar,
        on_delete=models.CASCADE,
        related_name="pagos_aplicados",
    )
    evento_financiero_relacionado = models.ForeignKey(
        "finanzas.EventoFinanciero",
        on_delete=models.SET_NULL,
        related_name="pagos_cxc",
        blank=True,
        null=True,
    )
    transaccion_relacionada = models.ForeignKey(
        "finanzas.Transaccion",
        on_delete=models.SET_NULL,
        related_name="pagos_cxc",
        blank=True,
        null=True,
    )
    evidencia_pago_relacionada = models.ForeignKey(
        "comunicaciones.EvidenciaPago",
        on_delete=models.SET_NULL,
        related_name="pagos_cxc",
        blank=True,
        null=True,
    )
    monto = models.DecimalField(max_digits=12, decimal_places=2)
    fecha_pago = models.DateField(default=timezone.localdate)
    metodo = models.CharField(
        max_length=20,
        choices=METODO_CHOICES,
        default="TRANSFERENCIA",
    )
    canal_origen = models.CharField(
        max_length=20,
        choices=CANAL_ORIGEN_CHOICES,
        default="MANUAL",
    )
    estatus_validacion = models.CharField(
        max_length=20,
        choices=ESTATUS_VALIDACION_CHOICES,
        default="APLICADO",
    )
    fecha_validacion = models.DateTimeField(blank=True, null=True)
    referencia = models.CharField(max_length=120, blank=True, null=True)
    notas = models.TextField(blank=True, null=True)
    notas_validacion = models.TextField(blank=True, null=True)
    fecha_creacion = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(
                fields=[
                    "estatus_validacion",
                    "transaccion_relacionada",
                    "monto",
                    "fecha_pago",
                ],
                name="idx_pago_cxc_match",
            ),
            models.Index(
                fields=[
                    "cuenta_por_cobrar",
                    "estatus_validacion",
                    "fecha_pago",
                ],
                name="idx_pg_cxc_cta_est_fecha",
            ),
        ]
        ordering = ["-fecha_pago", "-id"]

    def __str__(self):
        return f"Pago CxC {self.cuenta_por_cobrar_id} - ${self.monto}"


class ProgramacionCuentaPorPagar(models.Model):
    CATEGORIA_CHOICES = [
        ("RENTA", "Renta"),
        ("AGUA", "Agua"),
        ("LUZ", "Luz"),
        ("GAS", "Gas"),
        ("INTERNET", "Internet"),
        ("BASURA", "Recoleccion de basura"),
        ("LIMPIEZA", "Limpieza"),
        ("MANTENIMIENTO", "Mantenimiento"),
        ("REPARACIONES", "Reparaciones"),
        ("SEGURIDAD", "Seguridad"),
        ("NOMINA", "Nomina"),
        ("IMPUESTOS", "Impuestos"),
        ("CREDITO", "Credito"),
        ("PUBLICIDAD", "Publicidad"),
        ("CONTABILIDAD", "Contabilidad"),
        ("OTROS", "Otros"),
    ]

    NATURALEZA_CHOICES = [
        ("OPERATIVO", "Operativo"),
        ("ADMINISTRATIVO", "Administrativo"),
    ]

    PRIORIDAD_CHOICES = [
        ("BAJA", "Baja"),
        ("MEDIA", "Media"),
        ("ALTA", "Alta"),
        ("CRITICA", "Critica"),
    ]

    entidad_relacionada = models.ForeignKey(
        EntidadNegocio,
        on_delete=models.CASCADE,
        related_name="programaciones_cxp",
    )
    nombre = models.CharField(max_length=150)
    categoria = models.CharField(
        max_length=20,
        choices=CATEGORIA_CHOICES,
        default="OTROS",
    )
    naturaleza = models.CharField(
        max_length=20,
        choices=NATURALEZA_CHOICES,
        default="OPERATIVO",
    )
    proveedor_nombre = models.CharField(max_length=200)
    banco_pago = models.CharField(max_length=120, blank=True, null=True)
    cuenta_pago = models.CharField(max_length=40, blank=True, null=True)
    clabe_pago = models.CharField(max_length=18, blank=True, null=True)
    prioridad = models.CharField(
        max_length=10,
        choices=PRIORIDAD_CHOICES,
        default="MEDIA",
    )
    periodicidad = models.CharField(
        max_length=20,
        choices=PERIODICIDAD_CHOICES,
        default="MENSUAL",
    )
    fecha_inicio = models.DateField(default=timezone.localdate)
    fecha_fin = models.DateField(blank=True, null=True)
    dia_vencimiento = models.PositiveSmallIntegerField(blank=True, null=True)
    monto_base = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    dias_gracia = models.PositiveSmallIntegerField(default=0)
    genera_recargo = models.BooleanField(default=False)
    prorrateable = models.BooleanField(default=False)
    activo = models.BooleanField(default=True)
    observaciones = models.TextField(blank=True, null=True)
    fecha_creacion = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["entidad_relacionada", "nombre"],
                name="unique_programacion_cxp_por_entidad_y_nombre",
            )
        ]
        ordering = ["nombre"]

    def __str__(self):
        return f"{self.nombre} - {self.entidad_relacionada.nombre_comercial}"


class CuentaPorPagar(models.Model):
    ESTATUS_CXP_CHOICES = [
        ("PENDIENTE", "Pendiente"),
        ("PARCIAL", "Pago parcial"),
        ("PAGADO", "Pagado"),
        ("POR_CONCILIAR", "Por conciliar"),
        ("VENCIDO", "Vencido"),
        ("CANCELADO", "Cancelado"),
    ]

    TIPO_REGISTRO_CHOICES = [
        ("PROGRAMADO", "Programado"),
        ("MANUAL", "Manual"),
        ("BATCH", "Batch"),
    ]

    entidad_relacionada = models.ForeignKey(
        EntidadNegocio,
        on_delete=models.CASCADE,
        related_name="cuentas_por_pagar",
    )
    programacion_relacionada = models.ForeignKey(
        ProgramacionCuentaPorPagar,
        on_delete=models.SET_NULL,
        related_name="cuentas_generadas",
        blank=True,
        null=True,
    )
    proveedor_nombre = models.CharField(max_length=200)
    banco_pago = models.CharField(max_length=120, blank=True, null=True)
    cuenta_pago = models.CharField(max_length=40, blank=True, null=True)
    clabe_pago = models.CharField(max_length=18, blank=True, null=True)
    prioridad = models.CharField(
        max_length=10,
        choices=ProgramacionCuentaPorPagar.PRIORIDAD_CHOICES,
        default="MEDIA",
    )
    categoria = models.CharField(
        max_length=20,
        choices=ProgramacionCuentaPorPagar.CATEGORIA_CHOICES,
        default="OTROS",
    )
    naturaleza = models.CharField(
        max_length=20,
        choices=ProgramacionCuentaPorPagar.NATURALEZA_CHOICES,
        default="OPERATIVO",
    )
    concepto = models.CharField(max_length=255)
    periodicidad = models.CharField(
        max_length=20,
        choices=PERIODICIDAD_CHOICES,
        default="MENSUAL",
    )
    tipo_registro = models.CharField(
        max_length=20,
        choices=TIPO_REGISTRO_CHOICES,
        default="PROGRAMADO",
    )
    referencia_unica = models.CharField(max_length=180, blank=True, null=True)
    fecha_periodo_inicio = models.DateField(blank=True, null=True)
    fecha_periodo_fin = models.DateField(blank=True, null=True)
    fecha_programada = models.DateField(blank=True, null=True)
    fecha_emision = models.DateField(default=timezone.localdate)
    fecha_vencimiento = models.DateField()
    monto_proyectado = models.DecimalField(max_digits=12, decimal_places=2)
    monto_real = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        blank=True,
        null=True,
    )
    monto_pagado = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    dias_gracia = models.PositiveSmallIntegerField(default=0)
    genera_recargo = models.BooleanField(default=False)
    estatus = models.CharField(
        max_length=20,
        choices=ESTATUS_CXP_CHOICES,
        default="PENDIENTE",
    )
    observaciones = models.TextField(blank=True, null=True)

    class Meta:
        indexes = [
            models.Index(
                fields=["entidad_relacionada", "estatus", "fecha_vencimiento"],
                name="idx_cxp_ent_estatus_fecha",
            ),
            models.Index(
                fields=["entidad_relacionada", "proveedor_nombre"],
                name="idx_cxp_ent_proveedor",
            ),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["entidad_relacionada", "referencia_unica"],
                condition=Q(referencia_unica__isnull=False),
                name="unique_cxp_referencia_por_entidad",
            )
        ]
        ordering = ["fecha_vencimiento", "id"]

    def __str__(self):
        return f"CxP: {self.proveedor_nombre} - {self.concepto}"

    @property
    def monto_total(self) -> Decimal:
        return self.monto_real if self.monto_real is not None else self.monto_proyectado

    @property
    def saldo_pendiente(self) -> Decimal:
        saldo = (self.monto_total or Decimal("0")) - (self.monto_pagado or Decimal("0"))
        return max(saldo, Decimal("0"))

    def recalcular_estatus(
        self,
        *,
        persist: bool = False,
        pagos_pendientes_validacion: bool | None = None,
    ) -> str:
        if self.estatus == "CANCELADO":
            return self.estatus

        saldo = self.saldo_pendiente
        today = timezone.localdate()
        if saldo <= 0 and pagos_pendientes_validacion is None:
            pagos_pendientes_validacion = bool(
                self.pk
                and self.pagos_aplicados.filter(
                    estatus_validacion="APLICADO"
                ).exists()
            )

        if saldo <= 0:
            nuevo_estatus = "POR_CONCILIAR" if pagos_pendientes_validacion else "PAGADO"
        elif self.monto_pagado > 0:
            nuevo_estatus = "VENCIDO" if self.fecha_vencimiento < today else "PARCIAL"
        else:
            nuevo_estatus = "VENCIDO" if self.fecha_vencimiento < today else "PENDIENTE"

        if persist and nuevo_estatus != self.estatus:
            self.estatus = nuevo_estatus
            self.save(update_fields=["estatus"])

        return nuevo_estatus


class PagoCuentaPorPagar(models.Model):
    METODO_CHOICES = PagoCuentaPorCobrar.METODO_CHOICES
    CANAL_ORIGEN_CHOICES = PagoCuentaPorCobrar.CANAL_ORIGEN_CHOICES
    ESTATUS_VALIDACION_CHOICES = PagoCuentaPorCobrar.ESTATUS_VALIDACION_CHOICES

    cuenta_por_pagar = models.ForeignKey(
        CuentaPorPagar,
        on_delete=models.CASCADE,
        related_name="pagos_aplicados",
    )
    evento_financiero_relacionado = models.ForeignKey(
        "finanzas.EventoFinanciero",
        on_delete=models.SET_NULL,
        related_name="pagos_cxp",
        blank=True,
        null=True,
    )
    transaccion_relacionada = models.ForeignKey(
        "finanzas.Transaccion",
        on_delete=models.SET_NULL,
        related_name="pagos_cxp",
        blank=True,
        null=True,
    )
    evidencia_pago_relacionada = models.ForeignKey(
        "comunicaciones.EvidenciaPago",
        on_delete=models.SET_NULL,
        related_name="pagos_cxp",
        blank=True,
        null=True,
    )
    monto = models.DecimalField(max_digits=12, decimal_places=2)
    fecha_pago = models.DateField(default=timezone.localdate)
    metodo = models.CharField(
        max_length=20,
        choices=METODO_CHOICES,
        default="TRANSFERENCIA",
    )
    canal_origen = models.CharField(
        max_length=20,
        choices=CANAL_ORIGEN_CHOICES,
        default="MANUAL",
    )
    estatus_validacion = models.CharField(
        max_length=20,
        choices=ESTATUS_VALIDACION_CHOICES,
        default="APLICADO",
    )
    fecha_validacion = models.DateTimeField(blank=True, null=True)
    referencia = models.CharField(max_length=120, blank=True, null=True)
    notas = models.TextField(blank=True, null=True)
    notas_validacion = models.TextField(blank=True, null=True)
    fecha_creacion = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(
                fields=[
                    "estatus_validacion",
                    "transaccion_relacionada",
                    "monto",
                    "fecha_pago",
                ],
                name="idx_pago_cxp_match",
            ),
        ]
        ordering = ["-fecha_pago", "-id"]

    def __str__(self):
        return f"Pago CxP {self.cuenta_por_pagar_id} - ${self.monto}"


class EventoFinanciero(models.Model):
    ESTATUS_CHOICES = [
        ("NUEVO", "Nuevo"),
        ("PROPUESTO", "Propuesto"),
        ("PENDIENTE_APLICACION", "Pendiente de aplicacion"),
        ("APLICADO", "Aplicado"),
        ("CONCILIADO", "Conciliado"),
        ("AMBIGUO", "Ambiguo"),
        ("DUPLICADO", "Duplicado"),
        ("NO_IDENTIFICADO", "No identificado"),
        ("DESCARTADO", "Descartado"),
    ]
    ORIGEN_EVENTO_CHOICES = [
        ("WHATSAPP", "WhatsApp"),
        ("MANUAL", "Manual"),
        ("ESTADO_CUENTA", "Estado de cuenta"),
        ("WEBHOOK", "Webhook"),
        ("AJUSTE_SISTEMA", "Ajuste del sistema"),
    ]
    TIPO_MOVIMIENTO_CHOICES = [
        ("INGRESO", "Ingreso"),
        ("EGRESO", "Egreso"),
    ]

    entidad_relacionada = models.ForeignKey(
        EntidadNegocio,
        on_delete=models.SET_NULL,
        related_name="eventos_financieros",
        blank=True,
        null=True,
    )
    cliente_relacionado = models.ForeignKey(
        Cliente,
        on_delete=models.SET_NULL,
        related_name="eventos_financieros",
        blank=True,
        null=True,
    )
    caso_relacionado = models.ForeignKey(
        "comunicaciones.CasoProcesamiento",
        on_delete=models.SET_NULL,
        related_name="eventos_financieros",
        blank=True,
        null=True,
    )
    evidencia_pago_relacionada = models.ForeignKey(
        "comunicaciones.EvidenciaPago",
        on_delete=models.SET_NULL,
        related_name="eventos_financieros",
        blank=True,
        null=True,
    )
    transaccion_relacionada = models.ForeignKey(
        "finanzas.Transaccion",
        on_delete=models.SET_NULL,
        related_name="eventos_financieros",
        blank=True,
        null=True,
    )
    duplicado_de = models.ForeignKey(
        "self",
        on_delete=models.SET_NULL,
        related_name="duplicados",
        blank=True,
        null=True,
    )
    origen_evento = models.CharField(
        max_length=20,
        choices=ORIGEN_EVENTO_CHOICES,
        default="MANUAL",
    )
    tipo_movimiento = models.CharField(
        max_length=20,
        choices=TIPO_MOVIMIENTO_CHOICES,
        default="INGRESO",
    )
    unidad_detectada = models.CharField(max_length=120, blank=True, null=True)
    beneficiario_principal = models.CharField(max_length=180, blank=True, null=True)
    referencia_principal = models.CharField(max_length=160, blank=True, null=True)
    fecha_evento = models.DateField(default=timezone.localdate)
    monto_total_reportado = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    confianza_global = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    requiere_revision_manual = models.BooleanField(default=False)
    texto_consolidado = models.TextField(blank=True, null=True)
    raw_data = models.JSONField(blank=True, null=True)
    propuesta_ia = models.JSONField(blank=True, null=True)
    observaciones = models.TextField(blank=True, null=True)
    estatus = models.CharField(max_length=24, choices=ESTATUS_CHOICES, default="NUEVO")
    fecha_registro = models.DateTimeField(auto_now_add=True)
    fecha_actualizacion = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(
                fields=[
                    "tipo_movimiento",
                    "monto_total_reportado",
                    "fecha_evento",
                    "estatus",
                ],
                name="idx_evento_fin_match",
            ),
        ]
        ordering = ["-fecha_evento", "-id"]

    def __str__(self):
        return f"Evento {self.id} | {self.tipo_movimiento} | ${self.monto_total_reportado}"


class EventoFinancieroPartida(models.Model):
    DESTINO_CHOICES = [
        ("CXC", "Cuenta por cobrar"),
        ("CXP", "Cuenta por pagar"),
        ("SALDO_A_FAVOR", "Saldo a favor"),
        ("NO_IDENTIFICADO", "No identificado"),
    ]
    ESTATUS_CHOICES = [
        ("PROPUESTA", "Propuesta"),
        ("APLICADA", "Aplicada"),
        ("CONCILIADA", "Conciliada"),
        ("REQUIERE_REVISION", "Requiere revision"),
        ("OMITIDA", "Omitida"),
    ]

    evento_relacionado = models.ForeignKey(
        EventoFinanciero,
        on_delete=models.CASCADE,
        related_name="partidas",
    )
    entidad_relacionada = models.ForeignKey(
        EntidadNegocio,
        on_delete=models.SET_NULL,
        related_name="partidas_financieras",
        blank=True,
        null=True,
    )
    cliente_relacionado = models.ForeignKey(
        Cliente,
        on_delete=models.SET_NULL,
        related_name="partidas_financieras",
        blank=True,
        null=True,
    )
    cuenta_por_cobrar_relacionada = models.ForeignKey(
        CuentaPorCobrar,
        on_delete=models.SET_NULL,
        related_name="partidas_financieras",
        blank=True,
        null=True,
    )
    cuenta_por_pagar_relacionada = models.ForeignKey(
        CuentaPorPagar,
        on_delete=models.SET_NULL,
        related_name="partidas_financieras",
        blank=True,
        null=True,
    )
    orden = models.PositiveSmallIntegerField(default=1)
    tipo_destino = models.CharField(max_length=20, choices=DESTINO_CHOICES, default="CXC")
    concepto = models.CharField(max_length=180)
    beneficiario = models.CharField(max_length=180, blank=True, null=True)
    unidad_referencia = models.CharField(max_length=120, blank=True, null=True)
    periodo_referencia = models.CharField(max_length=120, blank=True, null=True)
    monto_partida = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    confianza = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    requiere_revision_manual = models.BooleanField(default=False)
    estatus = models.CharField(max_length=24, choices=ESTATUS_CHOICES, default="PROPUESTA")
    metadata = models.JSONField(blank=True, null=True)
    observaciones = models.TextField(blank=True, null=True)
    fecha_registro = models.DateTimeField(auto_now_add=True)
    fecha_actualizacion = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["orden", "id"]

    def __str__(self):
        return f"Partida {self.id} | {self.concepto} | ${self.monto_partida}"


class Transaccion(models.Model):
    ORIGEN_CHOICES = [
        ("WHATSAPP", "WhatsApp (Voucher)"),
        ("MANUAL", "Captura Manual"),
        ("ESTADO_CUENTA", "Estado de Cuenta (Excel)"),
    ]
    TIPO_MOVIMIENTO_CHOICES = [
        ("INGRESO", "Ingreso (+)"),
        ("EGRESO", "Egreso (-)"),
    ]
    ESTATUS_CONCILIACION_CHOICES = [
        ("EN_ESPERA", "En espera"),
        ("PARCIAL", "Parcialmente aplicada"),
        ("NO_IDENTIFICADO", "No identificado"),
        ("VINCULADO", "Vinculado"),
        ("VALIDADO", "Validado"),
        ("DUPLICADO", "Duplicado"),
        ("RECHAZADO", "Rechazado"),
    ]

    origen = models.CharField(max_length=20, choices=ORIGEN_CHOICES)
    cuenta_bancaria_relacionada = models.ForeignKey(
        CuentaBancaria,
        on_delete=models.SET_NULL,
        related_name="transacciones",
        blank=True,
        null=True,
    )
    tipo_movimiento = models.CharField(max_length=20, choices=TIPO_MOVIMIENTO_CHOICES)
    monto = models.DecimalField(max_digits=12, decimal_places=2)
    fecha_pago = models.DateField()
    concepto_bancario = models.CharField(
        max_length=255,
        blank=True,
        null=True,
        help_text="Texto crudo del banco",
    )
    numero_referencia = models.CharField(
        max_length=100,
        blank=True,
        null=True,
        help_text="Llave para conciliacion",
    )
    folio_bancario = models.CharField(max_length=100, blank=True, null=True)
    saldo_resultante = models.DecimalField(
        max_digits=14,
        decimal_places=2,
        blank=True,
        null=True,
    )
    hash_movimiento = models.CharField(max_length=128, blank=True, null=True)
    estatus_conciliacion = models.CharField(
        max_length=20,
        choices=ESTATUS_CONCILIACION_CHOICES,
        default="EN_ESPERA",
    )
    carga_relacionada = models.ForeignKey(
        "finanzas.CargaConciliacion",
        on_delete=models.SET_NULL,
        related_name="transacciones",
        blank=True,
        null=True,
    )
    cuenta_por_cobrar_relacionada = models.ForeignKey(
        CuentaPorCobrar,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="transacciones_relacionadas",
    )
    cuenta_por_pagar_relacionada = models.ForeignKey(
        CuentaPorPagar,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="transacciones_relacionadas",
    )
    evento_relacionado = models.ForeignKey(
        EventoFinanciero,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="transacciones_bancarias",
    )
    duplicado_de = models.ForeignKey(
        "self",
        on_delete=models.SET_NULL,
        related_name="duplicados",
        blank=True,
        null=True,
    )
    url_comprobante = models.URLField(max_length=500, blank=True, null=True)
    metadata = models.JSONField(blank=True, null=True)
    fecha_registro = models.DateTimeField(default=timezone.now)
    fecha_validacion = models.DateTimeField(blank=True, null=True)
    notas_conciliacion = models.TextField(blank=True, null=True)

    class Meta:
        indexes = [
            models.Index(
                fields=[
                    "cuenta_bancaria_relacionada",
                    "fecha_pago",
                    "estatus_conciliacion",
                ],
                name="idx_tx_cuenta_fecha_est",
            ),
            models.Index(
                fields=["tipo_movimiento", "estatus_conciliacion"],
                name="idx_tx_tipo_estatus",
            ),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["hash_movimiento"],
                condition=Q(hash_movimiento__isnull=False),
                name="unique_transaccion_hash_movimiento",
            )
        ]
        ordering = ["-fecha_pago", "-id"]

    def __str__(self):
        return f"{self.tipo_movimiento} | ${self.monto} | Ref: {self.numero_referencia}"


class CargaConciliacion(models.Model):
    ESTATUS_CARGA_CHOICES = [
        ("PROCESANDO", "Procesando"),
        ("COMPLETADO", "Completado"),
        ("COMPLETADO_CON_ERRORES", "Completado con errores"),
    ]
    ESTATUS_CUADRE_CHOICES = [
        ("SIN_SALDO", "Sin saldo"),
        ("CUADRADO", "Cuadrado"),
        ("CON_DIFERENCIA", "Con diferencia"),
    ]

    archivo_excel_url = models.URLField(max_length=500)
    cuenta_bancaria_relacionada = models.ForeignKey(
        CuentaBancaria,
        on_delete=models.SET_NULL,
        related_name="cargas_conciliacion",
        blank=True,
        null=True,
    )
    nombre_archivo = models.CharField(max_length=255, blank=True, null=True)
    formato_archivo = models.CharField(max_length=16, blank=True, null=True)
    fecha_carga = models.DateTimeField(auto_now_add=True)
    fecha_desde = models.DateField(blank=True, null=True)
    fecha_hasta = models.DateField(blank=True, null=True)
    saldo_inicial = models.DecimalField(max_digits=14, decimal_places=2, blank=True, null=True)
    saldo_final = models.DecimalField(max_digits=14, decimal_places=2, blank=True, null=True)
    saldo_calculado = models.DecimalField(max_digits=14, decimal_places=2, blank=True, null=True)
    total_ingresos = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    total_egresos = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    estatus_procesamiento = models.CharField(
        max_length=30,
        choices=ESTATUS_CARGA_CHOICES,
        default="PROCESANDO",
    )
    estatus_cuadre = models.CharField(
        max_length=20,
        choices=ESTATUS_CUADRE_CHOICES,
        default="SIN_SALDO",
    )
    registros_detectados = models.PositiveIntegerField(default=0)
    registros_conciliados = models.PositiveIntegerField(default=0)
    registros_pendientes = models.PositiveIntegerField(default=0)
    registros_no_identificados = models.PositiveIntegerField(default=0)
    registros_duplicados = models.PositiveIntegerField(default=0)
    errores_detectados = models.PositiveIntegerField(default=0)
    observaciones = models.TextField(blank=True, null=True)
    metadata = models.JSONField(blank=True, null=True)

    class Meta:
        ordering = ["-fecha_carga", "-id"]

    def __str__(self):
        return self.nombre_archivo or f"Carga {self.id}"
