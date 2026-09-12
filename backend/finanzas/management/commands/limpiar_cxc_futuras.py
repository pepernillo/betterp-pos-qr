from calendar import monthrange
from datetime import date

from django.core.management.base import BaseCommand, CommandError
from django.db.models import Count, Sum
from django.utils import timezone

from finanzas.models import CuentaPorCobrar
from finanzas.services import decimal_to_float


class Command(BaseCommand):
    help = (
        "Detecta o elimina rentas futuras generadas por adelantado. "
        "Por defecto solo simula; usa --apply para borrar registros seguros."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--fecha-corte",
            type=str,
            help="Ultimo periodo permitido en formato YYYY-MM-DD. Default: ultimo dia del mes actual.",
        )
        parser.add_argument(
            "--entidad-id",
            action="append",
            dest="entidad_ids",
            type=int,
            help="Opcional. Limita la limpieza a una o varias entidades.",
        )
        parser.add_argument(
            "--apply",
            action="store_true",
            help="Borra las CxC futuras sin pagos ni facturas asociadas.",
        )

    def handle(self, *args, **options):
        today = timezone.localdate()
        cutoff = date(today.year, today.month, monthrange(today.year, today.month)[1])
        if options.get("fecha_corte"):
            try:
                cutoff = date.fromisoformat(options["fecha_corte"])
            except ValueError as exc:
                raise CommandError("La fecha de corte debe tener formato YYYY-MM-DD.") from exc

        queryset = (
            CuentaPorCobrar.objects.filter(
                origen="RENTA",
                fecha_periodo_inicio__gt=cutoff,
                monto_pagado=0,
                pagos_aplicados__isnull=True,
                facturas_emitidas__isnull=True,
            )
            .exclude(estatus_adeudo__in=["CONCILIADO", "POR_CONCILIAR", "CANCELADO", "INCOBRABLE"])
            .distinct()
        )
        entidad_ids = options.get("entidad_ids") or []
        if entidad_ids:
            queryset = queryset.filter(entidad_relacionada_id__in=entidad_ids)

        summary = queryset.aggregate(count=Count("id"), amount=Sum("monto_total"))
        count = int(summary["count"] or 0)
        amount = decimal_to_float(summary["amount"] or 0)

        if not options["apply"]:
            self.stdout.write(
                "Simulacion de limpieza de CxC futuras | "
                f"fecha_corte={cutoff.isoformat()} | "
                f"registros={count} | monto={amount:.2f}"
            )
            self.stdout.write("Vuelve a ejecutar con --apply para borrar estos registros seguros.")
            return

        deleted, _ = queryset.delete()
        self.stdout.write(
            self.style.SUCCESS(
                "Limpieza de CxC futuras completada | "
                f"fecha_corte={cutoff.isoformat()} | registros_eliminados={deleted}"
            )
        )
