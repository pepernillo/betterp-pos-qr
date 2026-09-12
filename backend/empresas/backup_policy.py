from dataclasses import dataclass
from datetime import date

from django.conf import settings
from django.db.models import QuerySet
from django.utils import timezone

from billing.models import SuscripcionCapa

from .backup_export import build_capa_backup_workbook
from .backup_storage import (
    build_backup_object,
    delete_backup_from_r2,
    upload_backup_to_r2,
)
from .models import BackupCapaExport


DEFAULT_BACKUP_RETENTION_DAYS = 180


@dataclass(frozen=True)
class ScheduledBackupPolicy:
    key: str
    label: str


STARTER_POLICY = ScheduledBackupPolicy("starter-monthly-day-1", "Starter mensual dia 1")
GROWTH_POLICY = ScheduledBackupPolicy("growth-twice-monthly-1-16", "Growth dias 1 y 16")
SCALE_POLICY = ScheduledBackupPolicy("scale-weekly", "Scale semanal")


def backup_retention_days() -> int:
    value = getattr(settings, "BACKUP_RETENTION_DAYS", DEFAULT_BACKUP_RETENTION_DAYS)
    try:
        return max(int(value), 1)
    except (TypeError, ValueError):
        return DEFAULT_BACKUP_RETENTION_DAYS


def resolve_backup_policy(plan_clave: str) -> ScheduledBackupPolicy:
    clave = (plan_clave or "").lower()
    if clave == "scale":
        return SCALE_POLICY
    if clave == "growth":
        return GROWTH_POLICY
    return STARTER_POLICY


def backup_due_for_subscription(subscription: SuscripcionCapa, run_date: date) -> bool:
    policy = resolve_backup_policy(subscription.plan.clave)
    if policy.key == STARTER_POLICY.key:
        return run_date.day == 1
    if policy.key == GROWTH_POLICY.key:
        return run_date.day in {1, 16}
    if policy.key == SCALE_POLICY.key:
        latest_auto = (
            BackupCapaExport.objects.filter(
                capa_negocio=subscription.capa_negocio,
                metadata__origen="automatico",
                metadata__politica=policy.key,
                estatus="GENERADO",
            )
            .order_by("-fecha_creacion", "-id")
            .first()
        )
        if not latest_auto:
            return True
        return (run_date - timezone.localtime(latest_auto.fecha_creacion).date()).days >= 7
    return False


def scheduled_backup_exists(subscription: SuscripcionCapa, run_date: date) -> bool:
    return BackupCapaExport.objects.filter(
        capa_negocio=subscription.capa_negocio,
        metadata__origen="automatico",
        metadata__scheduled_for=run_date.isoformat(),
        estatus="GENERADO",
    ).exists()


def active_backup_subscriptions() -> QuerySet[SuscripcionCapa]:
    return (
        SuscripcionCapa.objects.select_related("capa_negocio", "plan")
        .filter(capa_negocio__activo=True, estatus__in=["ACTIVA", "TRIAL"])
        .order_by("capa_negocio_id")
    )


def run_scheduled_backups(
    *,
    run_date: date | None = None,
    generated_by: str = "scheduled-backup",
    dry_run: bool = False,
) -> list[dict]:
    target_date = run_date or timezone.localdate()
    results = []
    for subscription in active_backup_subscriptions():
        policy = resolve_backup_policy(subscription.plan.clave)
        due = backup_due_for_subscription(subscription, target_date)
        duplicate = scheduled_backup_exists(subscription, target_date)
        result = {
            "capa_id": subscription.capa_negocio_id,
            "capa_nombre": subscription.capa_negocio.nombre,
            "plan": subscription.plan.clave,
            "politica": policy.key,
            "due": due,
            "duplicate": duplicate,
            "created": False,
        }
        if due and not duplicate and not dry_run:
            content = build_capa_backup_workbook(subscription.capa_negocio)
            backup = build_backup_object(subscription.capa_negocio, content)
            record = upload_backup_to_r2(
                capa=subscription.capa_negocio,
                backup=backup,
                generado_por=generated_by,
                metadata={
                    "origen": "automatico",
                    "politica": policy.key,
                    "scheduled_for": target_date.isoformat(),
                },
            )
            result.update({"created": True, "backup_id": record.id})
        results.append(result)
    return results


def prune_expired_backups(
    *,
    retention_days: int | None = None,
    dry_run: bool = False,
) -> dict:
    days = retention_days or backup_retention_days()
    cutoff = timezone.now() - timezone.timedelta(days=days)
    expired = list(BackupCapaExport.objects.filter(fecha_creacion__lt=cutoff))
    deleted_objects = 0
    deleted_records = 0

    for backup in expired:
        if (
            backup.storage_backend == "R2"
            and backup.bucket
            and backup.object_key
            and not dry_run
        ):
            delete_backup_from_r2(bucket=backup.bucket, object_key=backup.object_key)
            deleted_objects += 1
        if not dry_run:
            backup.delete()
            deleted_records += 1

    return {
        "retention_days": days,
        "expired": len(expired),
        "deleted_objects": deleted_objects,
        "deleted_records": deleted_records,
        "dry_run": dry_run,
    }
