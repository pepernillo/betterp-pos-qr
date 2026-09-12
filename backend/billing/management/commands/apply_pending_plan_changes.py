from datetime import date

from django.core.management.base import BaseCommand, CommandError

from billing.api import run_pending_plan_changes_at_renewal
from billing.cron_monitor import monitor_cron_run, update_cron_run


class Command(BaseCommand):
    help = "Aplica cambios de plan SaaS programados al cierre del periodo."

    def add_arguments(self, parser):
        parser.add_argument(
            "--date",
            default="",
            help="Fecha operativa YYYY-MM-DD. Default: fecha local actual.",
        )
        parser.add_argument(
            "--generated-by",
            default="scheduled-plan-change",
            help="Etiqueta operativa del proceso que aplica el cambio.",
        )
        parser.add_argument(
            "--limit",
            type=int,
            default=0,
            help="Maximo de cambios a revisar. Default: sin limite.",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Muestra que haria sin modificar Stripe ni la base.",
        )

    def handle(self, *args, **options):
        raw_date = (options.get("date") or "").strip()
        run_date = None
        if raw_date:
            try:
                run_date = date.fromisoformat(raw_date)
            except ValueError as exc:
                raise CommandError("La fecha debe usar formato YYYY-MM-DD.") from exc

        dry_run = bool(options.get("dry_run"))
        generated_by = (
            (options.get("generated_by") or "").strip() or "scheduled-plan-change"
        )
        limit = int(options.get("limit") or 0) or None

        with monitor_cron_run(
            "scheduled_plan_changes",
            "Cambios de plan al renovar",
            metadata={"date": raw_date or None, "dry_run": dry_run, "limit": limit},
        ) as cron_run:
            summary = run_pending_plan_changes_at_renewal(
                run_date=run_date,
                generated_by=generated_by,
                dry_run=dry_run,
                limit=limit,
            )
            for item in summary["items"]:
                self.stdout.write(
                    f"{item['change_id']} | {item['capa_nombre']} | "
                    f"{item['status']} | {item['reason']}"
                )

            output = (
                f"Revisados: {summary['reviewed']} | Vencidos: {summary['due']} | "
                f"Aplicados: {summary['applied']} | En proceso: {summary['in_process']} | "
                f"Errores: {summary['errors']}"
            )
            if dry_run:
                output += " | dry-run"
            update_cron_run(cron_run, summary=output, metadata=summary)
            self.stdout.write(self.style.SUCCESS(output))
