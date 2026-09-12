import uuid
from datetime import timedelta

from django.contrib.auth.models import User
from django.db import models
from django.utils import timezone

from empresas.models import CapaNegocio


def default_invitation_expiry():
    return timezone.now() + timedelta(days=7)


def default_password_reset_expiry():
    return timezone.now() + timedelta(hours=2)


def default_two_factor_expiry():
    return timezone.now() + timedelta(minutes=10)


class UsuarioPerfil(models.Model):
    user = models.OneToOneField(
        User,
        on_delete=models.CASCADE,
        related_name="perfil_acceso",
    )
    nombre_mostrado = models.CharField(max_length=180, blank=True, null=True)
    google_sub = models.CharField(max_length=255, blank=True, null=True, unique=True)
    avatar_url = models.URLField(max_length=500, blank=True, null=True)
    email_verificado = models.BooleanField(default=False)
    es_admin_plataforma = models.BooleanField(default=False)
    fecha_creacion = models.DateTimeField(auto_now_add=True)
    fecha_actualizacion = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["user__email", "user__username"]

    def __str__(self):
        return self.nombre_mostrado or self.user.get_full_name() or self.user.email


class MembresiaCapaNegocio(models.Model):
    ROL_CHOICES = [
        ("OWNER_ADMIN", "Owner admin"),
        ("OPERADOR", "Operador"),
        ("CONSULTA", "Consulta"),
    ]

    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="membresias_capa",
    )
    capa_negocio = models.ForeignKey(
        CapaNegocio,
        on_delete=models.CASCADE,
        related_name="membresias_acceso",
    )
    rol = models.CharField(max_length=20, choices=ROL_CHOICES, default="OWNER_ADMIN")
    activo = models.BooleanField(default=True)
    ultimo_acceso = models.DateTimeField(blank=True, null=True)
    invitacion_aceptada_en = models.DateTimeField(blank=True, null=True)
    fecha_creacion = models.DateTimeField(auto_now_add=True)
    fecha_actualizacion = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["user", "capa_negocio"],
                name="unique_membership_user_capa",
            )
        ]
        indexes = [
            models.Index(
                fields=["user", "activo", "capa_negocio"],
                name="idx_member_user_active",
            ),
            models.Index(
                fields=["capa_negocio", "activo"],
                name="idx_member_capa_active",
            ),
        ]
        ordering = ["capa_negocio__nombre", "user__email", "id"]

    def __str__(self):
        return f"{self.user.email} -> {self.capa_negocio.nombre} ({self.rol})"


class InvitacionAcceso(models.Model):
    ESTATUS_CHOICES = [
        ("PENDIENTE", "Pendiente"),
        ("ACEPTADA", "Aceptada"),
        ("REVOCADA", "Revocada"),
        ("EXPIRADA", "Expirada"),
    ]

    capa_negocio = models.ForeignKey(
        CapaNegocio,
        on_delete=models.CASCADE,
        related_name="invitaciones_acceso",
    )
    membership_relacionada = models.ForeignKey(
        MembresiaCapaNegocio,
        on_delete=models.SET_NULL,
        related_name="invitaciones_origen",
        blank=True,
        null=True,
    )
    email = models.EmailField()
    nombre_sugerido = models.CharField(max_length=180, blank=True, null=True)
    rol = models.CharField(
        max_length=20,
        choices=MembresiaCapaNegocio.ROL_CHOICES,
        default="CONSULTA",
    )
    token = models.UUIDField(default=uuid.uuid4, editable=False, unique=True)
    estatus = models.CharField(max_length=20, choices=ESTATUS_CHOICES, default="PENDIENTE")
    expira_en = models.DateTimeField(default=default_invitation_expiry)
    invitado_por = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        related_name="invitaciones_emitidas",
        blank=True,
        null=True,
    )
    fecha_creacion = models.DateTimeField(auto_now_add=True)
    fecha_actualizacion = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(
                fields=["email", "estatus", "expira_en"],
                name="idx_inv_email_status",
            ),
            models.Index(
                fields=["capa_negocio", "email", "estatus"],
                name="idx_inv_capa_email",
            ),
        ]
        ordering = ["-fecha_creacion", "-id"]

    def __str__(self):
        return f"Invitacion {self.email} -> {self.capa_negocio.nombre}"

    @property
    def esta_vigente(self) -> bool:
        return self.estatus == "PENDIENTE" and self.expira_en >= timezone.now()


class InvitacionAdminPlataforma(models.Model):
    ESTATUS_CHOICES = [
        ("PENDIENTE", "Pendiente"),
        ("ACEPTADA", "Aceptada"),
        ("REVOCADA", "Revocada"),
        ("EXPIRADA", "Expirada"),
    ]

    email = models.EmailField()
    nombre_sugerido = models.CharField(max_length=180, blank=True, null=True)
    token = models.UUIDField(default=uuid.uuid4, editable=False, unique=True)
    estatus = models.CharField(max_length=20, choices=ESTATUS_CHOICES, default="PENDIENTE")
    expira_en = models.DateTimeField(default=default_invitation_expiry)
    invitado_por = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        related_name="invitaciones_admin_plataforma_emitidas",
        blank=True,
        null=True,
    )
    user_relacionado = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        related_name="invitaciones_admin_plataforma_aceptadas",
        blank=True,
        null=True,
    )
    fecha_creacion = models.DateTimeField(auto_now_add=True)
    fecha_actualizacion = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-fecha_creacion", "-id"]

    def __str__(self):
        return f"Invitacion admin plataforma {self.email}"

    @property
    def esta_vigente(self) -> bool:
        return self.estatus == "PENDIENTE" and self.expira_en >= timezone.now()


class RecuperacionAcceso(models.Model):
    ESTATUS_CHOICES = [
        ("PENDIENTE", "Pendiente"),
        ("USADA", "Usada"),
        ("CANCELADA", "Cancelada"),
        ("EXPIRADA", "Expirada"),
    ]

    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="solicitudes_recuperacion",
    )
    email = models.EmailField()
    token = models.UUIDField(default=uuid.uuid4, editable=False, unique=True)
    estatus = models.CharField(max_length=20, choices=ESTATUS_CHOICES, default="PENDIENTE")
    expira_en = models.DateTimeField(default=default_password_reset_expiry)
    fecha_creacion = models.DateTimeField(auto_now_add=True)
    fecha_actualizacion = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-fecha_creacion", "-id"]

    def __str__(self):
        return f"Recuperacion {self.email}"

    @property
    def esta_vigente(self) -> bool:
        return self.estatus == "PENDIENTE" and self.expira_en >= timezone.now()


class DesafioDobleFactor(models.Model):
    PROVEEDOR_CHOICES = [
        ("PASSWORD", "Password"),
        ("GOOGLE", "Google"),
        ("INVITACION", "Invitacion"),
    ]

    ESTATUS_CHOICES = [
        ("PENDIENTE", "Pendiente"),
        ("VALIDADO", "Validado"),
        ("CANCELADO", "Cancelado"),
        ("EXPIRADO", "Expirado"),
    ]

    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="desafios_doble_factor",
    )
    email = models.EmailField()
    token = models.UUIDField(default=uuid.uuid4, editable=False, unique=True)
    codigo_hash = models.CharField(max_length=255)
    proveedor = models.CharField(max_length=20, choices=PROVEEDOR_CHOICES, default="PASSWORD")
    intentos = models.PositiveSmallIntegerField(default=0)
    estatus = models.CharField(max_length=20, choices=ESTATUS_CHOICES, default="PENDIENTE")
    expira_en = models.DateTimeField(default=default_two_factor_expiry)
    fecha_creacion = models.DateTimeField(auto_now_add=True)
    fecha_actualizacion = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-fecha_creacion", "-id"]

    def __str__(self):
        return f"2FA {self.email} ({self.proveedor})"

    @property
    def esta_vigente(self) -> bool:
        return self.estatus == "PENDIENTE" and self.expira_en >= timezone.now()


class SesionAcceso(models.Model):
    PROVEEDOR_CHOICES = [
        ("PASSWORD", "Password"),
        ("GOOGLE", "Google"),
        ("BOOTSTRAP", "Bootstrap"),
    ]

    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="sesiones_acceso",
    )
    session_key = models.UUIDField(default=uuid.uuid4, editable=False, unique=True)
    proveedor = models.CharField(max_length=20, choices=PROVEEDOR_CHOICES, default="PASSWORD")
    refresh_expires_at = models.DateTimeField()
    ip_address = models.CharField(max_length=64, blank=True, null=True)
    user_agent = models.TextField(blank=True, null=True)
    ultimo_uso = models.DateTimeField(auto_now=True)
    revoked_at = models.DateTimeField(blank=True, null=True)
    fecha_creacion = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-fecha_creacion", "-id"]

    def __str__(self):
        return f"Sesion {self.session_key} - {self.user.email}"

    @property
    def activa(self) -> bool:
        return self.revoked_at is None and self.refresh_expires_at >= timezone.now()


class EventoAuditoria(models.Model):
    actor = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        related_name="eventos_auditoria",
        blank=True,
        null=True,
    )
    capa_negocio = models.ForeignKey(
        CapaNegocio,
        on_delete=models.SET_NULL,
        related_name="eventos_auditoria",
        blank=True,
        null=True,
    )
    accion = models.CharField(max_length=120)
    recurso_tipo = models.CharField(max_length=120)
    recurso_id = models.CharField(max_length=120, blank=True, null=True)
    metadata = models.JSONField(blank=True, null=True)
    fecha_creacion = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(
                fields=["capa_negocio", "-fecha_creacion", "-id"],
                name="idx_audit_capa_fecha",
            ),
            models.Index(
                fields=["capa_negocio", "accion", "-fecha_creacion"],
                name="idx_audit_capa_acc_fecha",
            ),
            models.Index(
                fields=["capa_negocio", "recurso_tipo", "recurso_id"],
                name="idx_audit_capa_recurso",
            ),
        ]
        ordering = ["-fecha_creacion", "-id"]

    def __str__(self):
        return f"{self.accion} - {self.recurso_tipo}"
