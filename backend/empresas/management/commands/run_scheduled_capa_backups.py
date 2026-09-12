from datetime import date

from django.core.management.base import BaseCommand, CommandError

from billing.cron_monitor import monitor_cron_run, update_cron_run
from empresas.backup_policy import (
    backup_retention_days,
    prune_expired_backups,
    run_scheduled_backups,
)


class Command(BaseCommand):
    help = "Ejecuta backups automaticos por plan y poda backups vencidos."

    def add_arguments(self, parser):
        parser.add_argument(
            "--date",
            default="",
            help="Fecha operativa YYYY-MM-DD. Default: fecha local actual.",
        )
        parser.add_argument(
            "--generated-by",
            default="scheduled-backup",
            help="Etiqueta operativa del proceso que genera el backup.",
        )
        parser.add_argument(
            "--retention-days",
            type=int,
            default=0,
            help="Dias de retencion. Default: BACKUP_RETENTION_DAYS o 180.",
        )
        parser.add_argument(
            "--skip-prune",
            action="store_true",
            help="No borrar backups vencidos.",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Muestra que haria sin crear ni borrar backups.",
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
        with monitor_cron_run(
            "scheduled_capa_backups",
            "Backups automaticos por plan",
            metadata={"date": raw_date or None, "dry_run": dry_run},
        ) as cron_run:
            results = run_scheduled_backups(
                run_date=run_date,
                generated_by=(options.get("generated_by") or "").strip() or "scheduled-backup",
                dry_run=dry_run,
            )
            created = sum(1 for item in results if item["created"])
            due = sum(1 for item in results if item["due"])
            duplicates = sum(1 for item in results if item["duplicate"])
            for item in results:
                if not item["due"] and not dry_run:
                    continue
                status = (
                    "creado"
                    if item["created"]
                    else "duplicado"
                    if item["duplicate"]
                    else "pendiente"
                    if item["due"]
                    else "no toca"
                )
                self.stdout.write(
                    f"{item['capa_id']} | {item['capa_nombre']} | {item['plan']} | "
                    f"{item['politica']} | {status}"
                )

            prune_result = None
            if not options.get("skip_prune"):
                retention_days = int(options.get("retention_days") or 0) or backup_retention_days()
                prune_result = prune_expired_backups(
                    retention_days=retention_days,
                    dry_run=dry_run,
                )

            summary = f"Programados: {due} | Creados: {created} | Duplicados: {duplicates}"
            if prune_result:
                summary += (
                    f" | Vencidos: {prune_result['expired']} | "
                    f"Registros borrados: {prune_result['deleted_records']}"
                )
            if dry_run:
                summary += " | dry-run"
            update_cron_run(
                cron_run,
                summary=summary,
                metadata={
                    "due": due,
                    "created": created,
                    "duplicates": duplicates,
                    "prune": prune_result,
                },
            )
            self.stdout.write(self.style.SUCCESS(summary))
