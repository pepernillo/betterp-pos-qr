from __future__ import annotations

from django.contrib.auth.models import User
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import Q

from accounts.models import MembresiaCapaNegocio, UsuarioPerfil
from billing.models import SuscripcionCapa
from empresas.models import CapaNegocio


class Command(BaseCommand):
    help = "Elimina una cuenta SaaS de prueba por correo. Por defecto solo muestra vista previa."

    def add_arguments(self, parser):
        parser.add_argument("--email", required=True, help="Correo exacto de la cuenta a borrar.")
        parser.add_argument(
            "--confirm",
            action="store_true",
            help="Ejecuta el borrado. Si no se indica, solo muestra vista previa.",
        )
        parser.add_argument(
            "--force",
            action="store_true",
            help="Permite borrar aunque la cuenta tenga objetos operativos relacionados.",
        )

    def handle(self, *args, **options):
        email = (options["email"] or "").strip().lower()
        if not email or "@" not in email:
            raise CommandError("Debes indicar un correo valido con --email.")

        users = list(
            User.objects.filter(Q(email__iexact=email) | Q(username__iexact=email)).order_by("id")
        )
        memberships = list(
            MembresiaCapaNegocio.objects.select_related("capa_negocio", "user")
            .filter(user__in=users)
            .order_by("id")
        )
        capas_by_id = {
            membership.capa_negocio_id: membership.capa_negocio
            for membership in memberships
            if membership.capa_negocio_id
        }
        for capa in CapaNegocio.objects.filter(
            Q(correo_contacto__iexact=email) | Q(usuario_fundador__in=users)
        ).order_by("id"):
            capas_by_id[capa.id] = capa

        capas = list(capas_by_id.values())
        subscriptions = list(
            SuscripcionCapa.objects.select_related("capa_negocio", "plan")
            .filter(capa_negocio__in=capas)
            .order_by("id")
        )

        if not users and not capas:
            self.stdout.write(self.style.WARNING(f"No encontre cuenta SaaS para {email}."))
            return

        self.stdout.write(f"Cuenta: {email}")
        self.stdout.write(f"Usuarios: {len(users)}")
        for user in users:
            self.stdout.write(f"  - user_id={user.id} username={user.username} email={user.email}")
        self.stdout.write(f"Capas: {len(capas)}")
        for capa in capas:
            related_counts = self._related_counts(capa)
            self.stdout.write(
                f"  - capa_id={capa.id} nombre={capa.nombre} correo={capa.correo_contacto}"
            )
            if related_counts:
                summary = ", ".join(f"{name}={count}" for name, count in related_counts.items())
                self.stdout.write(f"    relacionados: {summary}")
        self.stdout.write(f"Suscripciones: {len(subscriptions)}")
        for subscription in subscriptions:
            self.stdout.write(
                "  - "
                f"suscripcion_id={subscription.id} "
                f"estatus={subscription.estatus} "
                f"plan={subscription.plan.nombre}"
            )

        risky_counts = self._risky_related_counts(capas)
        if risky_counts and not options["force"]:
            summary = ", ".join(f"{name}={count}" for name, count in risky_counts.items())
            raise CommandError(
                "La cuenta tiene objetos operativos relacionados. "
                f"Revision requerida antes de borrar: {summary}. "
                "Si confirmas que es una cuenta de prueba, vuelve a correr con --force."
            )

        if not options["confirm"]:
            self.stdout.write(
                self.style.WARNING(
                    "Vista previa solamente. Agrega --confirm para borrar la cuenta."
                )
            )
            return

        with transaction.atomic():
            for capa in capas:
                capa.delete()
            for user in users:
                UsuarioPerfil.objects.filter(user=user).delete()
                user.delete()

        self.stdout.write(self.style.SUCCESS(f"Cuenta SaaS eliminada: {email}"))

    def _related_counts(self, capa: CapaNegocio) -> dict[str, int]:
        counts: dict[str, int] = {}
        for relation in capa._meta.related_objects:
            accessor_name = relation.get_accessor_name()
            if not accessor_name:
                continue
            manager = getattr(capa, accessor_name, None)
            if manager is None:
                continue
            try:
                counts[accessor_name] = manager.count()
            except Exception:
                continue
        return {name: count for name, count in counts.items() if count}

    def _risky_related_counts(self, capas: list[CapaNegocio]) -> dict[str, int]:
        safe_relations = {
            "membresias_acceso",
            "suscripcion",
            "consumos_saas",
            "movimientos_consumo",
            "eventos_billing",
            "eventos_auditoria",
            "casos_procesamiento",
            "evidencias_pago",
            "historial_envios",
            "invitaciones_acceso",
            "desafios_doble_factor",
        }
        totals: dict[str, int] = {}
        for capa in capas:
            for name, count in self._related_counts(capa).items():
                if name not in safe_relations:
                    totals[name] = totals.get(name, 0) + count
        return totals
