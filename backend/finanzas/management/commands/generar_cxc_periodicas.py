from calendar import monthrange
from datetime import date

from django.core.management.base import BaseCommand, CommandError
from django.db.models import Q
from django.utils import timezone

from billing.cron_monitor import monitor_cron_run, update_cron_run
from empresas.models import EntidadNegocio
from finanzas.services import decimal_to_float, generate_receivables_for_entity


class Command(BaseCommand):
    help = (
        "Genera cuentas por cobrar faltantes para asignaciones activas. "
        "Es seguro correrlo diariamente porque no duplica periodos existentes."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--fecha-corte",
            type=str,
            help="Fecha maxima a generar en formato YYYY-MM-DD. Default: ultimo dia del mes actual.",
        )
        parser.add_argument(
            "--entidad-id",
            dest="entidad_ids",
            action="append",
            type=int,
            help="Opcional. Ejecuta solo para una o varias entidades.",
        )

    def handle(self, *args, **options):
        today = timezone.localdate()
        current_month_end = date(
            today.year,
            today.month,
            monthrange(today.year, today.month)[1],
        )
        through_date = current_month_end
        if options.get("fecha_corte"):
            try:
                requested_date = date.fromisoformat(options["fecha_corte"])
                through_date = min(requested_date, current_month_end)
            except ValueError as exc:
                raise CommandError(
                    "La fecha de corte debe tener formato YYYY-MM-DD."
                ) from exc

        entidad_ids = options.get("entidad_ids") or []
        queryset = EntidadNegocio.objects.filter(activo=True)
        if entidad_ids:
            queryset = queryset.filter(id__in=entidad_ids)
        else:
            queryset = queryset.filter(
                Q(fecha_pausa__isnull=True) | Q(fecha_pausa__gt=through_date)
            )

        with monitor_cron_run(
            "periodic_receivables",
            "Generacion CxC periodicas",
            metadata={"fecha_corte": through_date.isoformat(), "entidad_ids": entidad_ids},
        ) as cron_run:
            entidades = list(queryset.order_by("id"))
            if not entidades:
                summary = "No hay entidades activas para procesar."
                update_cron_run(cron_run, summary=summary, metadata={"entities": 0})
                self.stdout.write(summary)
                return

            total_creados = 0
            total_existentes = 0
            total_saldo_aplicado = 0.0

            for entidad in entidades:
                resultado = generate_receivables_for_entity(
                    entidad,
                    through_date=through_date,
                )
                creados = int(resultado["creados"])
                existentes = int(resultado["existentes"])
                saldo_aplicado = decimal_to_float(resultado["saldo_aplicado"])
                total_creados += creados
                total_existentes += existentes
                total_saldo_aplicado += saldo_aplicado

                self.stdout.write(
                    f"[Entidad {entidad.id}] {entidad.nombre_comercial}: "
                    f"creados={creados}, existentes={existentes}, saldo_aplicado={saldo_aplicado:.2f}"
                )

            summary = (
                "Generacion de CxC completada | "
                f"entidades={len(entidades)} | "
                f"creados={total_creados} | "
                f"existentes={total_existentes} | "
                f"saldo_aplicado={total_saldo_aplicado:.2f}"
            )
            update_cron_run(
                cron_run,
                summary=summary,
                metadata={
                    "entities": len(entidades),
                    "created": total_creados,
                    "existing": total_existentes,
                    "credit_applied": total_saldo_aplicado,
                },
            )
            self.stdout.write(self.style.SUCCESS(summary))
