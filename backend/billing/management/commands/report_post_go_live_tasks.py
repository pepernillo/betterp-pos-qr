from django.core.management.base import BaseCommand

from billing.api import (
    POST_GO_LIVE_REPORT_CRON_KEY,
    POST_GO_LIVE_REPORT_CRON_NAME,
    build_post_go_live_task_report,
)
from billing.cron_monitor import monitor_cron_run, update_cron_run


class Command(BaseCommand):
    help = "Genera y envia el reporte operativo de tareas post go-live."

    def add_arguments(self, parser):
        parser.add_argument(
            "--receiver",
            default="",
            help="Correo receptor opcional. Default: BETTERP_OPERATIONS_NOTIFY_EMAIL y fallbacks.",
        )
        parser.add_argument(
            "--no-email",
            action="store_true",
            help="Genera el reporte y registra la corrida sin enviar correo.",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Genera el reporte sin enviar correo; deja evidencia de prueba en CronRunLog.",
        )

    def handle(self, *args, **options):
        receiver = (options.get("receiver") or "").strip() or None
        dry_run = bool(options.get("dry_run"))
        send_email = not bool(options.get("no_email")) and not dry_run

        with monitor_cron_run(
            POST_GO_LIVE_REPORT_CRON_KEY,
            POST_GO_LIVE_REPORT_CRON_NAME,
            metadata={
                "receiver_override": bool(receiver),
                "send_email": send_email,
                "dry_run": dry_run,
            },
        ) as cron_run:
            report = build_post_go_live_task_report(
                receiver=receiver,
                send_email=send_email,
            )
            email_state = (
                "enviado"
                if report.get("email_sent")
                else "omitido"
                if report.get("email_skipped_reason")
                else "dry-run"
                if dry_run
                else "sin-email"
            )
            summary = (
                f"Post go-live: {report['overdue']} vencida(s), "
                f"{report['open']} abierta(s), email={email_state}"
            )
            update_cron_run(cron_run, summary=summary, metadata=report)
            self.stdout.write(self.style.SUCCESS(summary))
            for item in report["items"][:12]:
                target = item.get("post_go_live_fecha_objetivo") or "sin fecha"
                self.stdout.write(
                    f"{item['capa_nombre']} | {item['post_go_live_prioridad']} | "
                    f"{item['post_go_live_tarea_estado']} | objetivo={target}"
                )
