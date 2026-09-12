from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q


class Categoria(models.Model):
    capa_negocio = models.ForeignKey(
        "empresas.CapaNegocio",
        on_delete=models.CASCADE,
        related_name="categorias",
    )
    nombre = models.CharField(max_length=150)
    parent = models.ForeignKey(
        "self",
        on_delete=models.CASCADE,
        related_name="children",
        blank=True,
        null=True,
    )
    activo = models.BooleanField(default=True)
    metadata = models.JSONField(default=dict, blank=True)
    fecha_creacion = models.DateTimeField(auto_now_add=True)
    fecha_actualizacion = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["nombre", "id"]
        indexes = [
            models.Index(fields=["capa_negocio", "activo"], name="idx_vf_cat_capa_activo"),
            models.Index(fields=["parent", "nombre"], name="idx_vf_cat_parent_nombre"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["capa_negocio", "nombre"],
                condition=Q(parent__isnull=True),
                name="unique_vf_root_category_per_capa",
            ),
            models.UniqueConstraint(
                fields=["capa_negocio", "parent", "nombre"],
                condition=Q(parent__isnull=False),
                name="unique_vf_child_category_per_parent",
            ),
        ]

    def clean(self):
        super().clean()
        if self.parent and self.parent.capa_negocio_id != self.capa_negocio_id:
            raise ValidationError(
                {"parent": "La categoria padre debe pertenecer a la misma capa."}
            )

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)

    def __str__(self):
        if self.parent_id:
            return f"{self.parent} > {self.nombre}"
        return self.nombre


class Producto(models.Model):
    SOURCE_CHOICES = [
        ("manual", "Manual"),
        ("amazon", "Amazon"),
        ("mercado_libre", "Mercado Libre"),
        ("ingram", "Ingram API"),
        ("shopify", "Shopify"),
        ("woocommerce", "WooCommerce"),
    ]

    capa_negocio = models.ForeignKey(
        "empresas.CapaNegocio",
        on_delete=models.CASCADE,
        related_name="productos",
    )
    categoria = models.ForeignKey(
        Categoria,
        on_delete=models.SET_NULL,
        related_name="productos",
        blank=True,
        null=True,
    )
    internal_sku = models.CharField(max_length=100)
    brand_sku = models.CharField(max_length=100, blank=True, null=True)
    nombre = models.CharField(max_length=255)
    descripcion = models.TextField(blank=True, null=True)
    marca = models.CharField(max_length=120, blank=True, null=True)
    precio_base = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    peso = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    largo = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    ancho = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    alto = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    master_attributes = models.JSONField(default=dict, blank=True)
    source = models.CharField(max_length=30, choices=SOURCE_CHOICES, default="manual")
    activo = models.BooleanField(default=True)
    fecha_creacion = models.DateTimeField(auto_now_add=True)
    fecha_actualizacion = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["nombre", "id"]
        indexes = [
            models.Index(fields=["capa_negocio", "activo"], name="idx_vf_prod_capa_activo"),
            models.Index(fields=["capa_negocio", "marca"], name="idx_vf_prod_capa_marca"),
            models.Index(fields=["capa_negocio", "categoria"], name="idx_vf_prod_capa_cat"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["capa_negocio", "internal_sku"],
                name="unique_vf_sku_per_capa",
            ),
        ]

    def clean(self):
        super().clean()
        if self.categoria and self.categoria.capa_negocio_id != self.capa_negocio_id:
            raise ValidationError(
                {"categoria": "La categoria debe pertenecer a la misma capa."}
            )

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.internal_sku} - {self.nombre}"


class ProductoImagen(models.Model):
    STATUS_CHOICES = [
        ("PENDING", "Pending"),
        ("READY", "Ready"),
        ("FAILED", "Failed"),
    ]

    producto = models.ForeignKey(
        Producto,
        on_delete=models.CASCADE,
        related_name="imagenes",
    )
    imagen = models.ImageField(upload_to="catalogo/productos/%Y/%m/", blank=True, null=True)
    is_main = models.BooleanField(default=False)
    alt_text = models.CharField(max_length=255, blank=True)
    public_url = models.URLField(max_length=500, blank=True, default="")
    asset_status = models.CharField(max_length=10, choices=STATUS_CHOICES, default="PENDING")
    content_type = models.CharField(max_length=80, blank=True, default="")
    bytes_size = models.PositiveIntegerField(default=0)
    width = models.PositiveIntegerField(default=0)
    height = models.PositiveIntegerField(default=0)
    sha256 = models.CharField(max_length=64, blank=True, default="")
    last_verified_at = models.DateTimeField(blank=True, null=True)
    last_error = models.CharField(max_length=255, blank=True, default="")
    fecha_creacion = models.DateTimeField(auto_now_add=True)
    fecha_actualizacion = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-is_main", "id"]
        indexes = [
            models.Index(fields=["producto", "asset_status"], name="idx_vf_img_prod_status"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["producto"],
                condition=Q(is_main=True),
                name="unique_vf_main_image_per_product",
            ),
        ]

    @property
    def capa_negocio_id(self):
        return self.producto.capa_negocio_id

    def __str__(self):
        return f"Imagen de {self.producto.nombre}"


class Bodega(models.Model):
    TYPE_CHOICES = [
        ("INTERNA", "Interna"),
        ("EXTERNA", "Externa"),
        ("FULFILLMENT", "Fulfillment"),
        ("VIRTUAL", "Virtual"),
    ]

    capa_negocio = models.ForeignKey(
        "empresas.CapaNegocio",
        on_delete=models.CASCADE,
        related_name="bodegas",
    )
    codigo = models.CharField(max_length=60)
    nombre = models.CharField(max_length=150)
    tipo = models.CharField(max_length=20, choices=TYPE_CHOICES, default="INTERNA")
    direccion = models.TextField(blank=True, default="")
    activo = models.BooleanField(default=True)
    metadata = models.JSONField(default=dict, blank=True)
    fecha_creacion = models.DateTimeField(auto_now_add=True)
    fecha_actualizacion = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["nombre", "id"]
        indexes = [
            models.Index(fields=["capa_negocio", "activo"], name="idx_vf_bod_capa_activo"),
            models.Index(fields=["capa_negocio", "codigo"], name="idx_vf_bod_capa_codigo"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["capa_negocio", "codigo"],
                name="unique_vf_warehouse_code_per_capa",
            ),
        ]

    def clean(self):
        super().clean()
        self.codigo = (self.codigo or "").strip().upper()
        self.nombre = (self.nombre or "").strip()
        if not self.codigo:
            raise ValidationError({"codigo": "El codigo de bodega es obligatorio."})
        if not self.nombre:
            raise ValidationError({"nombre": "El nombre de bodega es obligatorio."})

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.codigo} - {self.nombre}"


class InventarioItem(models.Model):
    capa_negocio = models.ForeignKey(
        "empresas.CapaNegocio",
        on_delete=models.CASCADE,
        related_name="inventario_items",
    )
    producto = models.ForeignKey(
        Producto,
        on_delete=models.CASCADE,
        related_name="inventario_items",
    )
    bodega = models.ForeignKey(
        Bodega,
        on_delete=models.CASCADE,
        related_name="inventario_items",
    )
    stock = models.DecimalField(max_digits=14, decimal_places=3, default=0)
    reservado = models.DecimalField(max_digits=14, decimal_places=3, default=0)
    costo_promedio = models.DecimalField(max_digits=12, decimal_places=4, default=0)
    ultimo_costo = models.DecimalField(max_digits=12, decimal_places=4, default=0)
    metadata = models.JSONField(default=dict, blank=True)
    fecha_creacion = models.DateTimeField(auto_now_add=True)
    fecha_actualizacion = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["producto__nombre", "bodega__nombre", "id"]
        indexes = [
            models.Index(fields=["capa_negocio", "producto"], name="idx_vf_inv_capa_prod"),
            models.Index(fields=["capa_negocio", "bodega"], name="idx_vf_inv_capa_bod"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["capa_negocio", "producto", "bodega"],
                name="unique_vf_inventory_item_per_capa",
            ),
        ]

    @property
    def disponible(self):
        return (self.stock or Decimal("0")) - (self.reservado or Decimal("0"))

    def clean(self):
        super().clean()
        if self.producto_id and self.producto.capa_negocio_id != self.capa_negocio_id:
            raise ValidationError(
                {"producto": "El producto debe pertenecer a la misma capa."}
            )
        if self.bodega_id and self.bodega.capa_negocio_id != self.capa_negocio_id:
            raise ValidationError({"bodega": "La bodega debe pertenecer a la misma capa."})
        if self.stock is not None and self.stock < 0:
            raise ValidationError({"stock": "El stock no puede ser negativo."})
        if self.reservado is not None and self.reservado < 0:
            raise ValidationError({"reservado": "El reservado no puede ser negativo."})
        if self.disponible < 0:
            raise ValidationError({"reservado": "El reservado no puede superar el stock."})

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.producto.internal_sku} @ {self.bodega.codigo}"


class InventarioMovimiento(models.Model):
    TYPE_CHOICES = [
        ("COMPRA", "Compra"),
        ("VENTA", "Venta"),
        ("AJUSTE", "Ajuste"),
        ("DEVOLUCION", "Devolucion"),
        ("CANCELACION", "Cancelacion"),
        ("PERDIDA", "Perdida"),
        ("RESERVA", "Reserva"),
        ("LIBERACION", "Liberacion"),
        ("SYNC_IMPORT", "Sync import"),
    ]

    capa_negocio = models.ForeignKey(
        "empresas.CapaNegocio",
        on_delete=models.CASCADE,
        related_name="inventario_movimientos",
    )
    item = models.ForeignKey(
        InventarioItem,
        on_delete=models.CASCADE,
        related_name="movimientos",
    )
    producto = models.ForeignKey(
        Producto,
        on_delete=models.CASCADE,
        related_name="inventario_movimientos",
    )
    bodega = models.ForeignKey(
        Bodega,
        on_delete=models.CASCADE,
        related_name="inventario_movimientos",
    )
    tipo = models.CharField(max_length=20, choices=TYPE_CHOICES)
    cantidad = models.DecimalField(max_digits=14, decimal_places=3)
    stock_anterior = models.DecimalField(max_digits=14, decimal_places=3, default=0)
    stock_nuevo = models.DecimalField(max_digits=14, decimal_places=3, default=0)
    referencia_tipo = models.CharField(max_length=80, blank=True, default="")
    referencia_id = models.CharField(max_length=120, blank=True, default="")
    nota = models.TextField(blank=True, default="")
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="inventario_movimientos",
        blank=True,
        null=True,
    )
    evento_auditoria = models.ForeignKey(
        "accounts.EventoAuditoria",
        on_delete=models.SET_NULL,
        related_name="inventario_movimientos",
        blank=True,
        null=True,
    )
    metadata = models.JSONField(default=dict, blank=True)
    fecha_creacion = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-fecha_creacion", "-id"]
        indexes = [
            models.Index(fields=["capa_negocio", "fecha_creacion"], name="idx_vf_mov_capa_fecha"),
            models.Index(fields=["capa_negocio", "tipo"], name="idx_vf_mov_capa_tipo"),
            models.Index(fields=["producto", "bodega"], name="idx_vf_mov_prod_bod"),
            models.Index(fields=["referencia_tipo", "referencia_id"], name="idx_vf_mov_ref"),
        ]

    def clean(self):
        super().clean()
        expected = {
            "item": self.item.capa_negocio_id if self.item_id else None,
            "producto": self.producto.capa_negocio_id if self.producto_id else None,
            "bodega": self.bodega.capa_negocio_id if self.bodega_id else None,
        }
        invalid_fields = [
            field
            for field, capa_id in expected.items()
            if capa_id is not None and capa_id != self.capa_negocio_id
        ]
        if invalid_fields:
            raise ValidationError(
                {field: "Debe pertenecer a la misma capa." for field in invalid_fields}
            )
        if self.item_id:
            if self.producto_id and self.item.producto_id != self.producto_id:
                raise ValidationError({"producto": "El producto no coincide con el item."})
            if self.bodega_id and self.item.bodega_id != self.bodega_id:
                raise ValidationError({"bodega": "La bodega no coincide con el item."})
        if self.cantidad == 0:
            raise ValidationError({"cantidad": "La cantidad del movimiento no puede ser cero."})
        if self.stock_nuevo < 0:
            raise ValidationError({"stock_nuevo": "El stock resultante no puede ser negativo."})

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.tipo} {self.cantidad} {self.producto.internal_sku}"


class Orden(models.Model):
    CHANNEL_CHOICES = [
        ("POS_QR", "Punto de venta QR"),
    ]
    STATUS_CHOICES = [
        ("NUEVA", "Nueva"),
        ("RESERVADA", "Reservada"),
        ("CONFIRMADA", "Confirmada"),
        ("CANCELADA", "Cancelada"),
        ("ERROR", "Error"),
    ]
    PAYMENT_STATUS_CHOICES = [
        ("PENDIENTE", "Pendiente"),
        ("PAGADA", "Pagada"),
        ("REEMBOLSADA", "Reembolsada"),
        ("CANCELADA", "Cancelada"),
    ]

    capa_negocio = models.ForeignKey(
        "empresas.CapaNegocio",
        on_delete=models.CASCADE,
        related_name="ordenes",
    )
    canal = models.CharField(max_length=40, choices=CHANNEL_CHOICES, default="POS_QR")
    external_order_id = models.CharField(max_length=120, blank=True, default="")
    estatus = models.CharField(max_length=20, choices=STATUS_CHOICES, default="NUEVA")
    payment_status = models.CharField(
        max_length=20,
        choices=PAYMENT_STATUS_CHOICES,
        default="PENDIENTE",
    )
    cliente_nombre = models.CharField(max_length=180, blank=True, default="")
    cliente_email = models.EmailField(blank=True, default="")
    cliente_telefono = models.CharField(max_length=40, blank=True, default="")
    moneda = models.CharField(max_length=10, default="MXN")
    subtotal = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    envio = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    descuento = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    total = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    metadata = models.JSONField(default=dict, blank=True)
    ultimo_error = models.TextField(blank=True, default="")
    creado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="ordenes_creadas",
        blank=True,
        null=True,
    )
    fecha_reserva = models.DateTimeField(blank=True, null=True)
    fecha_confirmacion = models.DateTimeField(blank=True, null=True)
    fecha_cancelacion = models.DateTimeField(blank=True, null=True)
    fecha_creacion = models.DateTimeField(auto_now_add=True)
    fecha_actualizacion = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-fecha_creacion", "-id"]
        indexes = [
            models.Index(fields=["capa_negocio", "estatus"], name="idx_vf_ord_capa_estado"),
            models.Index(fields=["capa_negocio", "canal"], name="idx_vf_ord_capa_canal"),
            models.Index(fields=["external_order_id"], name="idx_vf_ord_external"),
            models.Index(fields=["fecha_creacion"], name="idx_vf_ord_fecha"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["capa_negocio", "canal", "external_order_id"],
                condition=~Q(external_order_id=""),
                name="unique_vf_order_external_per_capa",
            ),
        ]

    def clean(self):
        super().clean()
        self.canal = (self.canal or "MANUAL").strip().upper()
        self.external_order_id = (self.external_order_id or "").strip()[:120]
        self.estatus = (self.estatus or "NUEVA").strip().upper()
        self.payment_status = (self.payment_status or "PENDIENTE").strip().upper()
        self.moneda = (self.moneda or "MXN").strip().upper()[:10]
        self.cliente_nombre = (self.cliente_nombre or "").strip()[:180]
        self.cliente_email = (self.cliente_email or "").strip()
        self.cliente_telefono = (self.cliente_telefono or "").strip()[:40]
        for field in ("subtotal", "envio", "descuento", "total"):
            value = getattr(self, field) or Decimal("0")
            if value < 0:
                raise ValidationError({field: "El importe no puede ser negativo."})

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)

    def __str__(self):
        label = self.external_order_id or self.id or "nueva"
        return f"{self.canal} orden {label}: {self.estatus}"


class OrdenItem(models.Model):
    orden = models.ForeignKey(
        Orden,
        on_delete=models.CASCADE,
        related_name="items",
    )
    capa_negocio = models.ForeignKey(
        "empresas.CapaNegocio",
        on_delete=models.CASCADE,
        related_name="orden_items",
    )
    producto = models.ForeignKey(
        Producto,
        on_delete=models.PROTECT,
        related_name="orden_items",
    )
    bodega = models.ForeignKey(
        Bodega,
        on_delete=models.SET_NULL,
        related_name="orden_items",
        blank=True,
        null=True,
    )
    inventario_item = models.ForeignKey(
        InventarioItem,
        on_delete=models.SET_NULL,
        related_name="orden_items",
        blank=True,
        null=True,
    )
    external_item_id = models.CharField(max_length=120, blank=True, default="")
    titulo = models.CharField(max_length=255, blank=True, default="")
    cantidad = models.DecimalField(max_digits=14, decimal_places=3)
    precio_unitario = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    subtotal = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    metadata = models.JSONField(default=dict, blank=True)
    fecha_creacion = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["id"]
        indexes = [
            models.Index(fields=["capa_negocio", "producto"], name="idx_vf_ordit_capa_prod"),
            models.Index(fields=["orden", "producto"], name="idx_vf_ordit_order_prod"),
            models.Index(fields=["external_item_id"], name="idx_vf_ordit_external"),
        ]

    def clean(self):
        super().clean()
        self.external_item_id = (self.external_item_id or "").strip()[:120]
        self.titulo = (self.titulo or "").strip()[:255]
        if self.orden_id and self.orden.capa_negocio_id != self.capa_negocio_id:
            raise ValidationError({"orden": "La orden debe pertenecer a la misma capa."})
        if self.producto_id and self.producto.capa_negocio_id != self.capa_negocio_id:
            raise ValidationError(
                {"producto": "El producto debe pertenecer a la misma capa."}
            )
        if self.bodega_id and self.bodega.capa_negocio_id != self.capa_negocio_id:
            raise ValidationError({"bodega": "La bodega debe pertenecer a la misma capa."})
        if (
            self.inventario_item_id
            and self.inventario_item.capa_negocio_id != self.capa_negocio_id
        ):
            raise ValidationError(
                {"inventario_item": "El item de inventario debe pertenecer a la misma capa."}
            )
        if self.inventario_item_id:
            if self.inventario_item.producto_id != self.producto_id:
                raise ValidationError(
                    {"inventario_item": "El inventario no coincide con el producto."}
                )
            if self.bodega_id and self.inventario_item.bodega_id != self.bodega_id:
                raise ValidationError(
                    {"inventario_item": "El inventario no coincide con la bodega."}
                )
        if self.cantidad is None or self.cantidad <= 0:
            raise ValidationError({"cantidad": "La cantidad debe ser mayor a cero."})
        if self.precio_unitario is not None and self.precio_unitario < 0:
            raise ValidationError(
                {"precio_unitario": "El precio unitario no puede ser negativo."}
            )
        if self.subtotal is not None and self.subtotal < 0:
            raise ValidationError({"subtotal": "El subtotal no puede ser negativo."})
        if not self.titulo and self.producto_id:
            self.titulo = self.producto.nombre
        if not self.subtotal:
            self.subtotal = (self.cantidad or Decimal("0")) * (
                self.precio_unitario or Decimal("0")
            )

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.cantidad} x {self.producto.internal_sku}"


class CalidadIncidencia(models.Model):
    ISSUE_TYPE_CHOICES = [
        ("ATRIBUTO_FALTANTE", "Atributo faltante"),
        ("CATEGORIA", "Categoria"),
        ("IMAGEN", "Imagen"),
        ("COPY", "Copy"),
        ("PRECIO", "Precio"),
        ("PUBLICACION_RECHAZADA", "Publicacion rechazada"),
        ("OTRO", "Otro"),
    ]
    PRIORITY_CHOICES = [
        ("INFO", "Info"),
        ("WARN", "Warn"),
        ("BLOCKER", "Blocker"),
    ]
    STATUS_CHOICES = [
        ("ABIERTA", "Abierta"),
        ("EN_REVISION", "En revision"),
        ("RESUELTA", "Resuelta"),
        ("IGNORADA", "Ignorada"),
    ]

    capa_negocio = models.ForeignKey(
        "empresas.CapaNegocio",
        on_delete=models.CASCADE,
        related_name="calidad_incidencias",
    )
    producto = models.ForeignKey(
        Producto,
        on_delete=models.CASCADE,
        related_name="calidad_incidencias",
        blank=True,
        null=True,
    )
    canal = models.CharField(max_length=60, blank=True, default="")
    external_resource_id = models.CharField(max_length=120, blank=True, default="")
    external_code = models.CharField(max_length=120, blank=True, default="")
    issue_type = models.CharField(
        max_length=40,
        choices=ISSUE_TYPE_CHOICES,
        default="PUBLICACION_RECHAZADA",
    )
    prioridad = models.CharField(max_length=20, choices=PRIORITY_CHOICES, default="WARN")
    estatus = models.CharField(max_length=20, choices=STATUS_CHOICES, default="ABIERTA")
    titulo = models.CharField(max_length=180)
    descripcion = models.TextField(blank=True, default="")
    raw_error = models.TextField(blank=True, default="")
    missing_fields = models.JSONField(default=list, blank=True)
    suggestions = models.JSONField(default=dict, blank=True)
    ai_assisted = models.BooleanField(default=True)
    requiere_revision_humana = models.BooleanField(default=True)
    asignado_a = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="calidad_asignadas",
        blank=True,
        null=True,
    )
    creado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="calidad_creadas",
        blank=True,
        null=True,
    )
    resuelto_por = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="calidad_resueltas",
        blank=True,
        null=True,
    )
    metadata = models.JSONField(default=dict, blank=True)
    fecha_creacion = models.DateTimeField(auto_now_add=True)
    fecha_actualizacion = models.DateTimeField(auto_now=True)
    fecha_resolucion = models.DateTimeField(blank=True, null=True)

    class Meta:
        ordering = ["-fecha_creacion", "-id"]
        indexes = [
            models.Index(fields=["capa_negocio", "estatus"], name="idx_vf_cal_capa_estado"),
            models.Index(fields=["capa_negocio", "canal"], name="idx_vf_cal_capa_canal"),
            models.Index(fields=["producto", "estatus"], name="idx_vf_cal_prod_estado"),
            models.Index(fields=["external_code"], name="idx_vf_cal_external_code"),
        ]

    def clean(self):
        super().clean()
        self.canal = (self.canal or "").strip().lower()
        self.external_resource_id = (self.external_resource_id or "").strip()[:120]
        self.external_code = (self.external_code or "").strip()[:120]
        self.titulo = (self.titulo or "").strip()
        if self.producto and self.producto.capa_negocio_id != self.capa_negocio_id:
            raise ValidationError(
                {"producto": "El producto debe pertenecer a la misma capa."}
            )
        if not self.titulo:
            raise ValidationError({"titulo": "El titulo de la incidencia es obligatorio."})
        if self.estatus in {"RESUELTA", "IGNORADA"} and not self.fecha_resolucion:
            from django.utils import timezone

            self.fecha_resolucion = timezone.now()
        if self.estatus in {"ABIERTA", "EN_REVISION"}:
            self.fecha_resolucion = None

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)

    def __str__(self):
        product = self.producto.internal_sku if self.producto_id else "sin producto"
        return f"{self.estatus} {self.canal or 'canal'} {product}: {self.titulo}"




