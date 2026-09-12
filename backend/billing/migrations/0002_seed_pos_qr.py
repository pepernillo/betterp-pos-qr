"""Siembra la solucion POS QR y sus planes en una base nueva."""

from django.db import migrations


def seed(apps, schema_editor):
    from billing.services import ensure_default_plans, ensure_default_solutions

    ensure_default_solutions()
    ensure_default_plans()


def unseed(apps, schema_editor):
    Solucion = apps.get_model("billing", "Solucion")
    PlanSaaS = apps.get_model("billing", "PlanSaaS")
    PlanSaaS.objects.filter(solution__clave="pos_qr").delete()
    Solucion.objects.filter(clave="pos_qr").delete()


class Migration(migrations.Migration):
    dependencies = [("billing", "0001_initial")]
    operations = [migrations.RunPython(seed, unseed)]
