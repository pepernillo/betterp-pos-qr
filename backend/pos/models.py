"""Punto de venta QR: cajas, mesas, turnos, tickets, cobro por QR y pagos.

El catalogo de productos e inventario vive en la app `catalogo`; aqui solo se
modela la operacion de venta en mostrador y en restaurante.
"""

import secrets
from decimal import Decimal, ROUND_HALF_UP

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models


MONEY = Decimal("0.01")
QUANTITY = Decimal("0.001")


def quantize_money(value) -> Decimal:
    return Decimal(value or 0).quantize(MONEY, rounding=ROUND_HALF_UP)


def quantize_quantity(value) -> Decimal:
    return Decimal(value or 0).quantize(QUANTITY, rounding=ROUND_HALF_UP)


def new_token(size: int = 24) -> str:
    return secrets.token_urlsafe(size)[:size]


class PuntoVenta(models.Model):
    """Una caja. En restaurante agrupa ademas las mesas de la sucursal."""

    SERVICE_CHOICES = [
        ("MOSTRADOR", "Mostrador"),
        ("RESTAURANTE", "Restaurante"),
    ]

    capa_negocio = models.ForeignKey(
        "empresas.CapaNegocio",
        on_delete=models.CASCADE,
        related_name="puntos_venta",
    )
    entidad = models.ForeignKey(
        "empresas.EntidadNegocio",
        on_delete=models.SET_NULL,
        related_name="puntos_venta",
        blank=True,
        null=True,
    )
    bodega = models.ForeignKey(
        "catalogo.Bodega",
        on_delete=models.PROTECT,
        related_name="puntos_venta",
        help_text="Bodega contra la que descuenta inventario esta caja.",
    )
    codigo = models.CharField(max_length=40)
    nombre = models.CharField(max_length=150)
    tipo_servicio = models.CharField(
        max_length=20,
        choices=SERVICE_CHOICES,
        default="MOSTRADOR",
    )
    acepta_cobro_qr = models.BooleanField(default=True)
    menu_qr_activo = models.BooleanField(
        default=False,
        help_text="Publica el menu por codigo QR para los comensales.",
    )
    menu_token = models.CharField(max_length=32, unique=True, blank=True)
    moneda = models.CharField(max_length=10, default="MXN")
    porcentaje_propina_sugerido = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        default=Decimal("10.00"),
    )
    activo = models.BooleanField(default=True)
    metadata = models.JSONField(default=dict, blank=True)
    fecha_creacion = models.DateTimeField(auto_now_add=True)
    fecha_actualizacion = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["nombre", "id"]
        verbose_name = "Punto de venta"
        verbose_name_plural = "Puntos de venta"
        indexes = [
            models.Index(fields=["capa_negocio", "activo"], name="idx_pos_pv_capa_activo"),
            models.Index(fields=["capa_negocio", "codigo"], name="idx_pos_pv_capa_codigo"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["capa_negocio", "codigo"],
                name="unique_pos_punto_venta_por_capa",
            ),
        ]

    def clean(self):
        super().clean()
        self.codigo = (self.codigo or "").strip().upper()
        self.nombre = (self.nombre or "").strip()
        self.moneda = (self.moneda or "MXN").strip().upper()[:10]
        if not self.codigo:
            raise ValidationError({"codigo": "El codigo del punto de venta es obligatorio."})
        if not self.nombre:
            raise ValidationError({"nombre": "El nombre del punto de venta es obligatorio."})
        if self.bodega_id and self.bodega.capa_negocio_id != self.capa_negocio_id:
            raise ValidationError({"bodega": "La bodega debe pertenecer a la misma capa."})
        if self.entidad_id and self.entidad.capa_negocio_id != self.capa_negocio_id:
            raise ValidationError({"entidad": "La entidad debe pertenecer a la misma capa."})
        if not 0 <= self.porcentaje_propina_sugerido <= 100:
            raise ValidationError(
                {"porcentaje_propina_sugerido": "La propina sugerida va de 0 a 100."}
            )
        if not self.menu_token:
            self.menu_token = new_token()

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)

    @property
    def es_restaurante(self) -> bool:
        return self.tipo_servicio == "RESTAURANTE"

    def __str__(self):
        return f"{self.codigo} - {self.nombre}"


class Mesa(models.Model):
    """Mesa de restaurante, con su propio codigo QR para el menu."""

    STATUS_CHOICES = [
        ("LIBRE", "Libre"),
        ("OCUPADA", "Ocupada"),
        ("CUENTA", "Cuenta solicitada"),
    ]

    punto_venta = models.ForeignKey(
        PuntoVenta,
        on_delete=models.CASCADE,
        related_name="mesas",
    )
    nombre = models.CharField(max_length=60)
    zona = models.CharField(max_length=60, blank=True, default="")
    capacidad = models.PositiveSmallIntegerField(default=4)
    estado = models.CharField(max_length=20, choices=STATUS_CHOICES, default="LIBRE")
    qr_token = models.CharField(max_length=32, unique=True, blank=True)
    activo = models.BooleanField(default=True)
    fecha_creacion = models.DateTimeField(auto_now_add=True)
    fecha_actualizacion = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["zona", "nombre", "id"]
        indexes = [
            models.Index(fields=["punto_venta", "estado"], name="idx_pos_mesa_pv_estado"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["punto_venta", "nombre"],
                name="unique_pos_mesa_por_punto_venta",
            ),
        ]

    def clean(self):
        super().clean()
        self.nombre = (self.nombre or "").strip()
        self.zona = (self.zona or "").strip()
        self.estado = (self.estado or "LIBRE").strip().upper()
        if not self.nombre:
            raise ValidationError({"nombre": "El nombre de la mesa es obligatorio."})
        if not self.capacidad:
            raise ValidationError({"capacidad": "La capacidad debe ser mayor a cero."})
        if not self.qr_token:
            self.qr_token = new_token()

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.punto_venta.codigo} / {self.nombre}"


class Turno(models.Model):
    """Turno de caja: de la apertura con fondo al corte."""

    STATUS_CHOICES = [
        ("ABIERTO", "Abierto"),
        ("CERRADO", "Cerrado"),
    ]

    punto_venta = models.ForeignKey(
        PuntoVenta,
        on_delete=models.CASCADE,
        related_name="turnos",
    )
    abierto_por = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="turnos_pos_abiertos",
        blank=True,
        null=True,
    )
    cerrado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="turnos_pos_cerrados",
        blank=True,
        null=True,
    )
    estado = models.CharField(max_length=20, choices=STATUS_CHOICES, default="ABIERTO")
    fondo_inicial = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    efectivo_declarado = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        blank=True,
        null=True,
        help_text="Efectivo contado al cierre; se compara contra lo esperado.",
    )
    fecha_apertura = models.DateTimeField(auto_now_add=True)
    fecha_cierre = models.DateTimeField(blank=True, null=True)
    notas = models.TextField(blank=True, default="")
    corte = models.JSONField(
        default=dict,
        blank=True,
        help_text="Corte congelado al cerrar: totales por forma de pago y diferencia.",
    )

    class Meta:
        ordering = ["-fecha_apertura", "-id"]
        indexes = [
            models.Index(fields=["punto_venta", "estado"], name="idx_pos_turno_pv_estado"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["punto_venta"],
                condition=models.Q(estado="ABIERTO"),
                name="unique_pos_turno_abierto_por_caja",
            ),
        ]

    def clean(self):
        super().clean()
        self.estado = (self.estado or "ABIERTO").strip().upper()
        if (self.fondo_inicial or Decimal("0")) < 0:
            raise ValidationError({"fondo_inicial": "El fondo inicial no puede ser negativo."})
        if self.estado == "CERRADO" and self.fecha_cierre is None:
            raise ValidationError({"fecha_cierre": "Un turno cerrado requiere fecha de cierre."})

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"Turno {self.pk} - {self.punto_venta.codigo} ({self.estado})"


class Ticket(models.Model):
    """Cuenta de venta. En restaurante es la cuenta de una mesa."""

    STATUS_CHOICES = [
        ("ABIERTO", "Abierto"),
        ("COBRADO", "Cobrado"),
        ("CANCELADO", "Cancelado"),
    ]
    SERVICE_CHOICES = [
        ("COMER_AQUI", "Comer aqui"),
        ("PARA_LLEVAR", "Para llevar"),
        ("DOMICILIO", "A domicilio"),
    ]
    ORIGIN_CHOICES = [
        ("CAJA", "Caja"),
        ("MENU_QR", "Menu QR"),
    ]

    capa_negocio = models.ForeignKey(
        "empresas.CapaNegocio",
        on_delete=models.CASCADE,
        related_name="tickets_pos",
    )
    punto_venta = models.ForeignKey(
        PuntoVenta,
        on_delete=models.PROTECT,
        related_name="tickets",
    )
    turno = models.ForeignKey(
        Turno,
        on_delete=models.SET_NULL,
        related_name="tickets",
        blank=True,
        null=True,
    )
    mesa = models.ForeignKey(
        Mesa,
        on_delete=models.SET_NULL,
        related_name="tickets",
        blank=True,
        null=True,
    )
    orden = models.OneToOneField(
        "catalogo.Orden",
        on_delete=models.SET_NULL,
        related_name="ticket_pos",
        blank=True,
        null=True,
        help_text="Orden de catalogo creada al cobrar, para mover inventario.",
    )
    cliente = models.ForeignKey(
        "crm.Cliente",
        on_delete=models.SET_NULL,
        related_name="tickets_pos",
        blank=True,
        null=True,
    )
    folio = models.CharField(max_length=40)
    estado = models.CharField(max_length=20, choices=STATUS_CHOICES, default="ABIERTO")
    tipo_servicio = models.CharField(
        max_length=20,
        choices=SERVICE_CHOICES,
        default="COMER_AQUI",
    )
    origen = models.CharField(max_length=20, choices=ORIGIN_CHOICES, default="CAJA")
    comensales = models.PositiveSmallIntegerField(default=1)
    subtotal = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    descuento = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    propina = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    total = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    pagado = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    abierto_por = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="tickets_pos_abiertos",
        blank=True,
        null=True,
    )
    notas = models.TextField(blank=True, default="")
    fecha_creacion = models.DateTimeField(auto_now_add=True)
    fecha_actualizacion = models.DateTimeField(auto_now=True)
    fecha_cobro = models.DateTimeField(blank=True, null=True)

    class Meta:
        ordering = ["-fecha_creacion", "-id"]
        indexes = [
            models.Index(fields=["capa_negocio", "estado"], name="idx_pos_tkt_capa_estado"),
            models.Index(fields=["punto_venta", "estado"], name="idx_pos_tkt_pv_estado"),
            models.Index(fields=["turno"], name="idx_pos_tkt_turno"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["punto_venta", "folio"],
                name="unique_pos_folio_por_punto_venta",
            ),
        ]

    def clean(self):
        super().clean()
        self.folio = (self.folio or "").strip().upper()
        self.estado = (self.estado or "ABIERTO").strip().upper()
        if not self.folio:
            raise ValidationError({"folio": "El folio es obligatorio."})
        if self.punto_venta_id and self.punto_venta.capa_negocio_id != self.capa_negocio_id:
            raise ValidationError(
                {"punto_venta": "El punto de venta debe pertenecer a la misma capa."}
            )
        if self.mesa_id and self.mesa.punto_venta_id != self.punto_venta_id:
            raise ValidationError({"mesa": "La mesa pertenece a otro punto de venta."})
        if self.turno_id and self.turno.punto_venta_id != self.punto_venta_id:
            raise ValidationError({"turno": "El turno pertenece a otro punto de venta."})
        for field in ("subtotal", "descuento", "propina", "total", "pagado"):
            if (getattr(self, field) or Decimal("0")) < 0:
                raise ValidationError({field: "El importe no puede ser negativo."})
        if (self.descuento or Decimal("0")) > (self.subtotal or Decimal("0")):
            raise ValidationError({"descuento": "El descuento no puede exceder el subtotal."})

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)

    def recalcular_totales(self, *, guardar: bool = True) -> "Ticket":
        subtotal = sum(
            (item.importe or Decimal("0"))
            for item in self.items.all()
            if item.estado != "CANCELADO"
        ) or Decimal("0")
        self.subtotal = quantize_money(subtotal)
        if (self.descuento or Decimal("0")) > self.subtotal:
            self.descuento = self.subtotal
        self.total = quantize_money(
            self.subtotal - (self.descuento or 0) + (self.propina or 0)
        )
        if guardar:
            self.save()
        return self

    @property
    def saldo(self) -> Decimal:
        return quantize_money((self.total or 0) - (self.pagado or 0))

    def __str__(self):
        return f"{self.folio} ({self.estado})"


class TicketItem(models.Model):
    """Linea de la cuenta. El estado de preparacion alimenta la comanda."""

    PREP_CHOICES = [
        ("PENDIENTE", "Pendiente"),
        ("EN_PREPARACION", "En preparacion"),
        ("SERVIDO", "Servido"),
        ("CANCELADO", "Cancelado"),
    ]

    ticket = models.ForeignKey(
        Ticket,
        on_delete=models.CASCADE,
        related_name="items",
    )
    producto = models.ForeignKey(
        "catalogo.Producto",
        on_delete=models.PROTECT,
        related_name="ticket_items",
    )
    descripcion = models.CharField(max_length=200, blank=True, default="")
    cantidad = models.DecimalField(max_digits=12, decimal_places=3, default=1)
    precio_unitario = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    descuento = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    importe = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    estado = models.CharField(max_length=20, choices=PREP_CHOICES, default="PENDIENTE")
    notas = models.CharField(
        max_length=240,
        blank=True,
        default="",
        help_text="Indicaciones para cocina: sin cebolla, termino medio, etc.",
    )
    fecha_creacion = models.DateTimeField(auto_now_add=True)
    fecha_actualizacion = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["id"]
        indexes = [
            models.Index(fields=["ticket", "estado"], name="idx_pos_tktitem_estado"),
        ]

    def clean(self):
        super().clean()
        self.descripcion = (self.descripcion or "").strip()
        self.notas = (self.notas or "").strip()
        self.estado = (self.estado or "PENDIENTE").strip().upper()
        if self.producto_id and not self.descripcion:
            self.descripcion = self.producto.nombre
        self.cantidad = quantize_quantity(self.cantidad)
        if self.cantidad <= 0:
            raise ValidationError({"cantidad": "La cantidad debe ser mayor a cero."})
        if (self.precio_unitario or Decimal("0")) < 0:
            raise ValidationError({"precio_unitario": "El precio no puede ser negativo."})
        bruto = quantize_money(self.cantidad * (self.precio_unitario or 0))
        if (self.descuento or Decimal("0")) < 0:
            raise ValidationError({"descuento": "El descuento no puede ser negativo."})
        if (self.descuento or Decimal("0")) > bruto:
            raise ValidationError({"descuento": "El descuento no puede exceder el importe."})
        self.importe = quantize_money(bruto - (self.descuento or 0))

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.descripcion} x{self.cantidad}"


class CobroQR(models.Model):
    """Solicitud de cobro que el cliente paga escaneando un codigo QR."""

    STATUS_CHOICES = [
        ("PENDIENTE", "Pendiente"),
        ("PAGADO", "Pagado"),
        ("EXPIRADO", "Expirado"),
        ("CANCELADO", "Cancelado"),
    ]
    METHOD_CHOICES = [
        ("SPEI", "Transferencia SPEI"),
        ("TARJETA", "Tarjeta"),
        ("BILLETERA", "Billetera digital"),
    ]

    ticket = models.ForeignKey(
        Ticket,
        on_delete=models.CASCADE,
        related_name="cobros_qr",
    )
    referencia = models.CharField(max_length=40, unique=True, blank=True)
    monto = models.DecimalField(max_digits=12, decimal_places=2)
    estado = models.CharField(max_length=20, choices=STATUS_CHOICES, default="PENDIENTE")
    metodo = models.CharField(max_length=20, choices=METHOD_CHOICES, default="SPEI")
    qr_payload = models.TextField(
        blank=True,
        default="",
        help_text="Contenido que codifica el QR; el cliente lo renderiza en pantalla.",
    )
    expira_en = models.DateTimeField(blank=True, null=True)
    fecha_pago = models.DateTimeField(blank=True, null=True)
    detalle = models.JSONField(default=dict, blank=True)
    fecha_creacion = models.DateTimeField(auto_now_add=True)
    fecha_actualizacion = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-fecha_creacion", "-id"]
        verbose_name = "Cobro QR"
        verbose_name_plural = "Cobros QR"
        indexes = [
            models.Index(fields=["ticket", "estado"], name="idx_pos_qr_tkt_estado"),
            models.Index(fields=["estado", "expira_en"], name="idx_pos_qr_estado_exp"),
        ]

    def clean(self):
        super().clean()
        self.estado = (self.estado or "PENDIENTE").strip().upper()
        if not self.referencia:
            self.referencia = f"QR-{new_token(16).upper()}"
        if (self.monto or Decimal("0")) <= 0:
            raise ValidationError({"monto": "El monto del cobro debe ser mayor a cero."})
        if self.estado == "PAGADO" and self.fecha_pago is None:
            raise ValidationError({"fecha_pago": "Un cobro pagado requiere fecha de pago."})

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.referencia} ({self.estado})"


class PagoTicket(models.Model):
    """Cobro aplicado a una cuenta. Varias lineas permiten dividir la cuenta."""

    METHOD_CHOICES = [
        ("EFECTIVO", "Efectivo"),
        ("TARJETA", "Tarjeta"),
        ("QR", "Cobro QR"),
        ("TRANSFERENCIA", "Transferencia"),
        ("CORTESIA", "Cortesia"),
    ]

    ticket = models.ForeignKey(
        Ticket,
        on_delete=models.CASCADE,
        related_name="pagos",
    )
    cobro_qr = models.ForeignKey(
        CobroQR,
        on_delete=models.SET_NULL,
        related_name="pagos",
        blank=True,
        null=True,
    )
    forma = models.CharField(max_length=20, choices=METHOD_CHOICES, default="EFECTIVO")
    monto = models.DecimalField(max_digits=12, decimal_places=2)
    recibido = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        blank=True,
        null=True,
        help_text="Efectivo entregado por el cliente, para calcular el cambio.",
    )
    referencia = models.CharField(max_length=120, blank=True, default="")
    registrado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="pagos_pos",
        blank=True,
        null=True,
    )
    fecha_creacion = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["id"]
        verbose_name = "Pago de ticket"
        verbose_name_plural = "Pagos de ticket"
        indexes = [
            models.Index(fields=["ticket", "forma"], name="idx_pos_pago_tkt_forma"),
        ]

    def clean(self):
        super().clean()
        self.forma = (self.forma or "EFECTIVO").strip().upper()
        self.referencia = (self.referencia or "").strip()
        if (self.monto or Decimal("0")) <= 0:
            raise ValidationError({"monto": "El monto del pago debe ser mayor a cero."})
        if self.forma == "QR" and not self.cobro_qr_id:
            raise ValidationError({"cobro_qr": "Un pago por QR debe referir al cobro QR."})
        if self.cobro_qr_id and self.cobro_qr.ticket_id != self.ticket_id:
            raise ValidationError({"cobro_qr": "El cobro QR pertenece a otro ticket."})
        if self.recibido is not None and self.recibido < self.monto:
            raise ValidationError({"recibido": "Lo recibido no puede ser menor al monto."})

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)

    @property
    def cambio(self) -> Decimal:
        if self.recibido is None:
            return Decimal("0.00")
        return quantize_money(self.recibido - self.monto)

    def __str__(self):
        return f"{self.forma} {self.monto}"
