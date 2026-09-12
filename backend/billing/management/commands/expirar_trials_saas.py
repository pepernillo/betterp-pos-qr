from django.core.management.base import BaseCommand
from django.utils import timezone

from billing.cron_monitor import monitor_cron_run, update_cron_run
from billing.models import SuscripcionCapa
from billing.services import expire_trial_if_needed


class Command(BaseCommand):
    help = "Expira pruebas gratuitas SaaS vencidas y deja la suscripcion pendiente de pago."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Muestra los trials que expirarian sin modificar suscripciones.",
        )

    def handle(self, *args, **options):
        dry_run = bool(options.get("dry_run"))
        with monitor_cron_run(
            "trial_expiration",
            "Expiracion de trials SaaS",
            metadata={"dry_run": dry_run},
        ) as cron_run:
            subscriptions = list(
                SuscripcionCapa.objects.select_related("capa_negocio", "plan").filter(
                    estatus="TRIAL"
                )
            )
            expired = 0
            for subscription in subscriptions:
                previous_status = subscription.estatus
                trial_end = subscription.fecha_fin_periodo_actual
                would_expire = bool(trial_end and trial_end < timezone.localdate())
                if dry_run:
                    expired += int(would_expire)
                    continue
                expire_trial_if_needed(subscription)
                if previous_status == "TRIAL" and subscription.estatus == "PENDIENTE_PAGO":
                    expired += 1

            summary = (
                f"Revision de trials completada | revisadas={len(subscriptions)} | expiradas={expired}"
            )
            if dry_run:
                summary += " | dry-run"
            update_cron_run(
                cron_run,
                summary=summary,
                metadata={
                    "reviewed": len(subscriptions),
                    "expired": expired,
                    "dry_run": dry_run,
                },
            )
            self.stdout.write(self.style.SUCCESS(summary))
