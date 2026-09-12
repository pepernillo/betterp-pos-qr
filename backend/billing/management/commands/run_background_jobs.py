import socket
import time

from django.core.management.base import BaseCommand
from django.utils import timezone

from billing.background_jobs import run_due_jobs
from billing.models import CronRunLog


class Command(BaseCommand):
    help = "Ejecuta jobs pendientes de la cola persistente de BetterP."

    def add_arguments(self, parser):
        parser.add_argument("--queue", default="default")
        parser.add_argument("--limit", type=int, default=25)
        parser.add_argument("--once", action="store_true")
        parser.add_argument("--sleep", type=float, default=2.0)
        parser.add_argument("--worker-id", default="")

    def handle(self, *args, **options):
        queue = options["queue"]
        limit = max(1, options["limit"])
        sleep_seconds = max(0.2, options["sleep"])
        worker_id = options["worker_id"] or f"{socket.gethostname()}:{queue}"
        run = CronRunLog.objects.create(
            key=f"background_worker_{queue}",
            name=f"Background worker {queue}",
            metadata={
                "queue": queue,
                "worker_id": worker_id,
                "last_heartbeat": timezone.now().isoformat(),
            },
        )

        try:
            while True:
                summary = run_due_jobs(queue=queue, limit=limit, worker_id=worker_id)
                heartbeat = timezone.now()
                run.summary = (
                    "queue={queue} claimed={claimed} success={success} "
                    "error={error} pending_retry={pending_retry}"
                ).format(queue=queue, **summary)
                run.metadata = {
                    **(run.metadata or {}),
                    "last_heartbeat": heartbeat.isoformat(),
                    "last_summary": summary,
                }
                run.save(update_fields=["summary", "metadata"])
                self.stdout.write(run.summary)
                if options["once"]:
                    run.status = "SUCCESS"
                    run.finished_at = timezone.now()
                    run.duration_ms = max(
                        int((run.finished_at - run.started_at).total_seconds() * 1000),
                        0,
                    )
                    run.save(update_fields=["status", "finished_at", "duration_ms"])
                    break
                if summary["claimed"] == 0:
                    time.sleep(sleep_seconds)
        except KeyboardInterrupt:
            run.status = "ERROR"
            run.finished_at = timezone.now()
            run.error = "Worker detenido manualmente."
            run.duration_ms = max(
                int((run.finished_at - run.started_at).total_seconds() * 1000),
                0,
            )
            run.save(
                update_fields=["status", "finished_at", "duration_ms", "error"]
            )
            raise
        except Exception as exc:
            run.status = "ERROR"
            run.finished_at = timezone.now()
            run.error = str(exc)[:2000]
            run.duration_ms = max(
                int((run.finished_at - run.started_at).total_seconds() * 1000),
                0,
            )
            run.save(
                update_fields=["status", "finished_at", "duration_ms", "error"]
            )
            raise
