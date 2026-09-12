from __future__ import annotations

from django.core.management import call_command
from django.core.management.base import BaseCommand


DEFAULT_SMOKE_EMAIL = "smoke@betterp.net"
DEFAULT_SMOKE_PASSWORD = "smoke$0123"


class Command(BaseCommand):
    help = "Crea o actualiza la cuenta smoke estandar y sus datos operativos."

    def add_arguments(self, parser):
        parser.add_argument(
            "--email",
            default=DEFAULT_SMOKE_EMAIL,
            help="Email del usuario smoke.",
        )
        parser.add_argument(
            "--password",
            default=DEFAULT_SMOKE_PASSWORD,
            help="Password del usuario smoke.",
        )
        parser.add_argument(
            "--reset",
            action="store_true",
            help="Reinicia primero los datos demo usados por la cuenta smoke.",
        )

    def handle(self, *args, **options):
        call_command(
            "seed_demo_environment",
            email=options["email"],
            password=options["password"],
            reset=options["reset"],
        )
        self.stdout.write(
            self.style.SUCCESS(
                f"Cuenta smoke lista: {options['email']}. Ejecuta scripts/smoke_mvp.py para validar produccion."
            )
        )
