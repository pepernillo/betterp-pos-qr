from contextlib import contextmanager

from django.utils import timezone

from .models import CronRunLog


def _duration_ms(started_at, finished_at) -> int:
    return max(int((finished_at - started_at).total_seconds() * 1000), 0)


@contextmanager
def monitor_cron_run(key: str, name: str, *, metadata: dict | None = None):
    run = CronRunLog.objects.create(
        key=key,
        name=name,
        metadata=metadata or {},
    )
    try:
        yield run
    except Exception as exc:
        finished_at = timezone.now()
        run.status = "ERROR"
        run.finished_at = finished_at
        run.duration_ms = _duration_ms(run.started_at, finished_at)
        run.error = str(exc)[:2000]
        run.save(update_fields=["status", "finished_at", "duration_ms", "error"])
        raise
    else:
        finished_at = timezone.now()
        run.status = "SUCCESS"
        run.finished_at = finished_at
        run.duration_ms = _duration_ms(run.started_at, finished_at)
        run.save(update_fields=["status", "finished_at", "duration_ms"])


def update_cron_run(run: CronRunLog, *, summary: str = "", metadata: dict | None = None) -> None:
    updates = []
    if summary:
        run.summary = summary[:500]
        updates.append("summary")
    if metadata:
        run.metadata = {**(run.metadata or {}), **metadata}
        updates.append("metadata")
    if updates:
        run.save(update_fields=updates)
