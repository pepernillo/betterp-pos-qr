import json
import logging
import socket
import threading
import traceback
import uuid
from datetime import timedelta
from typing import Any

from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.core.serializers.json import DjangoJSONEncoder
from django.db import close_old_connections, transaction
from django.utils import timezone

from .models import BackgroundJob

logger = logging.getLogger(__name__)


def enqueue_background_job(
    *,
    kind: str,
    payload: dict[str, Any] | None = None,
    queue: str = "default",
    created_by=None,
    run_after=None,
    max_attempts: int = 1,
) -> BackgroundJob:
    return BackgroundJob.objects.create(
        kind=kind,
        queue=queue,
        payload=payload or {},
        created_by=created_by if getattr(created_by, "is_authenticated", False) else None,
        available_at=run_after or timezone.now(),
        max_attempts=max(1, max_attempts),
    )


def store_background_upload(upload, *, prefix: str) -> dict[str, str]:
    extension = ""
    if getattr(upload, "name", ""):
        extension = "." + upload.name.rsplit(".", 1)[-1].lower() if "." in upload.name else ""
    storage_path = f"background-jobs/{prefix.strip('/')}/{uuid.uuid4().hex}{extension}"
    upload.file.seek(0)
    saved_path = default_storage.save(storage_path, ContentFile(upload.file.read()))
    return {
        "path": saved_path,
        "original_name": getattr(upload, "name", "") or saved_path.rsplit("/", 1)[-1],
    }


def claim_next_job(*, queue: str = "default", worker_id: str | None = None) -> BackgroundJob | None:
    now = timezone.now()
    worker = worker_id or socket.gethostname()
    with transaction.atomic():
        job = (
            BackgroundJob.objects.select_for_update()
            .filter(status="PENDING", queue=queue, available_at__lte=now)
            .order_by("available_at", "id")
            .first()
        )
        if not job:
            return None
        job.status = "RUNNING"
        job.locked_at = now
        job.locked_by = worker
        job.started_at = now
        job.finished_at = None
        job.error = None
        job.attempts += 1
        job.save(
            update_fields=[
                "status",
                "locked_at",
                "locked_by",
                "started_at",
                "finished_at",
                "error",
                "attempts",
                "fecha_actualizacion",
            ]
        )
        return job


def claim_job_by_id(job_id: int, *, worker_id: str | None = None) -> BackgroundJob | None:
    now = timezone.now()
    worker = worker_id or socket.gethostname()
    with transaction.atomic():
        job = (
            BackgroundJob.objects.select_for_update()
            .filter(id=job_id, status="PENDING")
            .first()
        )
        if not job:
            return None
        job.status = "RUNNING"
        job.locked_at = now
        job.locked_by = worker
        job.started_at = now
        job.finished_at = None
        job.error = None
        job.attempts += 1
        job.save(
            update_fields=[
                "status",
                "locked_at",
                "locked_by",
                "started_at",
                "finished_at",
                "error",
                "attempts",
                "fecha_actualizacion",
            ]
        )
        return job


def _dispatch_job(job: BackgroundJob) -> dict[str, Any]:
    if job.kind == "noop":
        return {"ok": True, "payload": job.payload}

    if job.kind == "webhook.process":
        from comunicaciones.api import process_webhook_safe

        webhook_id = int(job.payload["webhook_id"])
        process_webhook_safe(webhook_id)
        return {"webhook_id": webhook_id}

    if job.kind == "crm.clients_batch_import":
        from crm.api import import_clientes_batch_from_storage

        return import_clientes_batch_from_storage(job.payload)

    if job.kind == "espacios.rental_batch_import":
        from espacios.api import import_espacios_renta_from_storage

        return import_espacios_renta_from_storage(job.payload)

    if job.kind == "finanzas.cxc_batch_import":
        from finanzas.api import import_cxc_batch_from_storage

        return import_cxc_batch_from_storage(job.payload)

    if job.kind == "finanzas.cxp_batch_import":
        from finanzas.api import import_cxp_batch_from_storage

        return import_cxp_batch_from_storage(job.payload)

    if job.kind == "finanzas.bank_statement_import":
        from finanzas.api import import_bank_statement_from_storage

        return import_bank_statement_from_storage(job.payload)

    if job.kind == "billing.marketing_weekly_plan_generate":
        from django.contrib.auth import get_user_model

        from .marketing_automation import generate_approved_marketing_weekly_plan
        from .models import MarketingWeeklyPlan

        payload = job.payload or {}
        created_by = job.created_by
        created_by_id = payload.get("created_by_id")
        if created_by is None and created_by_id:
            created_by = get_user_model().objects.filter(id=created_by_id).first()
        if created_by is None:
            raise ValueError("No se encontro el usuario que solicito la generacion semanal.")

        with transaction.atomic():
            plan = MarketingWeeklyPlan.objects.select_for_update().get(
                id=int(payload["plan_id"])
            )
            if plan.status == "GENERATED" and len(plan.generated_campaign_ids or []) == 7:
                return {
                    "mensaje": "El plan semanal ya tenia sus siete borradores generados.",
                    "resultado": (plan.metadata or {}).get("generation_result") or {},
                    "weekly_plan_id": plan.id,
                    "campaign_ids": plan.generated_campaign_ids or [],
                }
            result = generate_approved_marketing_weekly_plan(
                plan=plan,
                created_by=created_by,
                local_time=str(payload.get("local_time") or "10:15"),
                channel_ids=[
                    int(channel_id)
                    for channel_id in (payload.get("canales_ids") or [])
                    if str(channel_id or "").strip()
                ],
            )
        return {
            "mensaje": "Plan generado como siete borradores pendientes de revision editorial.",
            "resultado": result,
            "weekly_plan_id": plan.id,
            "campaign_ids": result.get("campaign_ids") or [],
        }

    raise ValueError(f"Tipo de job no soportado: {job.kind}")


def _json_safe(value: dict[str, Any]) -> dict[str, Any]:
    return json.loads(json.dumps(value or {}, cls=DjangoJSONEncoder))


def run_job(job: BackgroundJob) -> BackgroundJob:
    try:
        result = _dispatch_job(job)
    except Exception as exc:
        now = timezone.now()
        retryable = job.attempts < job.max_attempts
        job.status = "PENDING" if retryable else "ERROR"
        job.error = "".join(traceback.format_exception_only(type(exc), exc)).strip()
        job.result = {"traceback": traceback.format_exc(limit=8)}
        job.finished_at = now if not retryable else None
        job.available_at = now + timedelta(minutes=min(job.attempts * 2, 15))
        job.save(
            update_fields=[
                "status",
                "error",
                "result",
                "finished_at",
                "available_at",
                "fecha_actualizacion",
            ]
        )
        return job

    job.status = "SUCCESS"
    job.result = _json_safe(result or {})
    job.error = None
    job.finished_at = timezone.now()
    job.save(update_fields=["status", "result", "error", "finished_at", "fecha_actualizacion"])
    return job


def run_job_by_id(job_id: int, *, worker_id: str | None = None) -> BackgroundJob | None:
    job = claim_job_by_id(job_id, worker_id=worker_id)
    if job is None:
        return None
    return run_job(job)


def run_job_by_id_async(job_id: int, *, worker_id: str | None = None) -> str:
    thread_name = f"betterp-background-job-{job_id}"

    def runner() -> None:
        close_old_connections()
        try:
            run_job_by_id(job_id, worker_id=worker_id or thread_name)
        except Exception:
            logger.exception(
                "background_job_inline_thread_failed",
                extra={"job_id": job_id, "worker_id": worker_id or thread_name},
            )
        finally:
            close_old_connections()

    thread = threading.Thread(target=runner, name=thread_name, daemon=True)
    thread.start()
    return thread_name


def run_due_jobs(*, queue: str = "default", limit: int = 25, worker_id: str | None = None) -> dict[str, int]:
    summary = {"claimed": 0, "success": 0, "error": 0, "pending_retry": 0}
    for _ in range(max(1, limit)):
        job = claim_next_job(queue=queue, worker_id=worker_id)
        if not job:
            break
        summary["claimed"] += 1
        run_job(job)
        if job.status == "SUCCESS":
            summary["success"] += 1
        elif job.status == "ERROR":
            summary["error"] += 1
        elif job.status == "PENDING":
            summary["pending_retry"] += 1
    return summary
