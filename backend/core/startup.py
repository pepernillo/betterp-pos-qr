import logging
import os

import django
from django.apps import apps
from django.core.management import call_command

logger = logging.getLogger(__name__)


TRUE_VALUES = {"1", "true", "yes", "on"}


def startup_migrations_enabled() -> bool:
    configured = os.environ.get("AUTO_MIGRATE_ON_STARTUP")
    if configured is not None:
        return configured.strip().lower() in TRUE_VALUES

    return False


def run_startup_migrations_once() -> None:
    if not startup_migrations_enabled():
        return
    if os.environ.get("BETTERP_STARTUP_MIGRATIONS_RAN") in TRUE_VALUES:
        return

    os.environ["BETTERP_STARTUP_MIGRATIONS_RAN"] = "1"
    try:
        if not apps.ready:
            django.setup(set_prefix=False)
        call_command("migrate", interactive=False, verbosity=1)
    except Exception:
        logger.exception("No se pudieron aplicar las migraciones al iniciar BetterP.")
        raise
