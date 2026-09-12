from __future__ import annotations


SAAS_AUTOMATION_DEFINITIONS = [
    {
        "key": "trial_expiration",
        "name": "Expiracion de trials SaaS",
        "expected_hours": 30,
        "category": "saas",
        "schedule": "Diario 09:20 UTC",
        "cron_schedule": "20 9 * * *",
        "command": "python manage.py expirar_trials_saas",
        "preview_command": "python manage.py expirar_trials_saas --dry-run",
        "lock_file": "/run/lock/betterp-trial-expiration.lock",
        "effect": "Actualiza localmente trials vencidos a pendiente de pago.",
        "action": "Revisar trials vencidos y la evidencia del scheduler de Vultr.",
    },
    {
        "key": "scheduled_plan_changes",
        "name": "Cambios de plan al renovar",
        "expected_hours": 30,
        "category": "saas",
        "schedule": "Diario 09:40 UTC",
        "cron_schedule": "40 9 * * *",
        "command": (
            "python manage.py apply_pending_plan_changes "
            '--generated-by "vultr-scheduler"'
        ),
        "preview_command": (
            "python manage.py apply_pending_plan_changes --dry-run "
            '--generated-by "vultr-scheduler-preview"'
        ),
        "lock_file": "/run/lock/betterp-scheduled-plan-changes.lock",
        "effect": "Aplica en Stripe y BetterP cambios de plan vencidos.",
        "action": "Revisar cambios pendientes, Price IDs y respuesta de Stripe.",
    },
    {
        "key": "backoffice_marketing_publish_queue",
        "name": "Publicacion programada de marketing",
        "expected_hours": 1,
        "category": "marketing",
        "schedule": "Cada 5 minutos",
        "cron_schedule": "*/5 * * * *",
        "command": "python manage.py publish_marketing_campaigns --limit 20 --fail-on-error",
        "preview_command": "python manage.py publish_marketing_campaigns --limit 20 --dry-run",
        "lock_file": "/run/lock/betterp-marketing-publish.lock",
        "effect": "Publica campanas aprobadas cuya fecha programada ya vencio.",
        "action": "Revisar destinos, credenciales y errores del proveedor en Marketing.",
    },
    {
        "key": "backoffice_tiktok_publication_sync",
        "name": "Estado de publicaciones TikTok",
        "expected_hours": 1,
        "category": "marketing",
        "schedule": "Cada 5 minutos, desplazado dos minutos",
        "cron_schedule": "2-57/5 * * * *",
        "command": "python manage.py sync_tiktok_publications --limit 25 --fail-on-error",
        "preview_command": "python manage.py sync_tiktok_publications --limit 25 --dry-run",
        "lock_file": "/run/lock/betterp-tiktok-publication-sync.lock",
        "effect": "Confirma el procesamiento asincrono de videos enviados a TikTok.",
        "action": "Revisar permisos, token y motivo de rechazo reportado por TikTok.",
    },
    {
        "key": "backoffice_marketing_metrics_sync",
        "name": "Metricas sociales automaticas",
        "expected_hours": 2,
        "category": "marketing",
        "schedule": "Cada hora, minuto 12",
        "cron_schedule": "12 * * * *",
        "command": "python manage.py sync_marketing_metrics --limit 200",
        "preview_command": "python manage.py sync_marketing_metrics --limit 20 --dry-run",
        "lock_file": "/run/lock/betterp-marketing-metrics-sync.lock",
        "effect": "Actualiza vistas e interacciones de Meta, YouTube y TikTok y conserva snapshots.",
        "action": "Revisar tokens, permisos de lectura y destinos sin identificador externo.",
    },
    {
        "key": "post_go_live_tasks_report",
        "name": "Reporte tareas post go-live",
        "expected_hours": 30,
        "category": "saas",
        "schedule": "Diario 14:30 UTC",
        "cron_schedule": "30 14 * * *",
        "command": "python manage.py report_post_go_live_tasks --no-email",
        "preview_command": "python manage.py report_post_go_live_tasks --dry-run",
        "lock_file": "/run/lock/betterp-post-go-live-report.lock",
        "effect": "Actualiza evidencia local; no envia correos.",
        "action": "Revisar tareas post go-live abiertas o vencidas en Salud.",
    },
]


SAAS_AUTOMATION_KEYS = tuple(item["key"] for item in SAAS_AUTOMATION_DEFINITIONS)
