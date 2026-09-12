import os
from datetime import time
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.utils.dateparse import parse_date
from django.utils import timezone

from billing.cron_monitor import monitor_cron_run, update_cron_run
from comunicaciones.models import ConfiguracionComunicacion
from comunicaciones.outbound import (
    build_automation_preview,
    build_whatsapp_automation_readiness,
    execute_due_automations,
)

DEFAULT_SEND_WINDOW_START = "10:00"
DEFAULT_SEND_WINDOW_END = "18:00"
DEFAULT_SEND_WINDOW_TIMEZONE = "America/Mexico_City"
DEFAULT_BLOCKED_WEEKDAYS = "6"
DEFAULT_MAX_SENDS = 1
DEFAULT_MAX_SENDS_PER_CAPA = 1
DEFAULT_SAFE_MAX_SENDS = 10
DEFAULT_SAFE_MAX_SENDS_PER_CAPA = 10

WEEKDAY_ALIASES = {
    "0": 0,
    "lunes": 0,
    "monday": 0,
    "mon": 0,
    "1": 1,
    "martes": 1,
    "tuesday": 1,
    "tue": 1,
    "2": 2,
    "miercoles": 2,
    "wednesday": 2,
    "wed": 2,
    "3": 3,
    "jueves": 3,
    "thursday": 3,
    "thu": 3,
    "4": 4,
    "viernes": 4,
    "friday": 4,
    "fri": 4,
    "5": 5,
    "sabado": 5,
    "saturday": 5,
    "sat": 5,
    "6": 6,
    "domingo": 6,
    "sunday": 6,
    "sun": 6,
}

WEEKDAY_LABELS = {
    0: "lunes",
    1: "martes",
    2: "miercoles",
    3: "jueves",
    4: "viernes",
    5: "sabado",
    6: "domingo",
}


def _config_value(name, default):
    value = getattr(settings, name, None)
    if value is None:
        value = os.environ.get(name, default)
    return value


def _parse_bool(value):
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    return str(value).strip().lower() in {"1", "true", "t", "yes", "y", "si", "on"}


def _parse_non_negative_int(value, *, option_name):
    try:
        parsed_value = int(value)
    except (TypeError, ValueError):
        raise SystemExit(f"{option_name} debe ser un entero no negativo.")
    if parsed_value < 0:
        raise SystemExit(f"{option_name} no puede ser negativo.")
    return parsed_value


def _resolve_run_limit(option_value, *, setting_name, default_value, option_name):
    if option_value is not None:
        return _parse_non_negative_int(option_value, option_name=option_name)
    return _parse_non_negative_int(
        _config_value(setting_name, default_value),
        option_name=setting_name,
    )


def _resolve_run_limit_policy(max_sends, max_sends_per_capa, *, dry_run, allow_high_limits):
    safe_max_sends = _parse_non_negative_int(
        _config_value("PAYMENT_REMINDER_SAFE_MAX_SENDS", DEFAULT_SAFE_MAX_SENDS),
        option_name="PAYMENT_REMINDER_SAFE_MAX_SENDS",
    )
    safe_max_sends_per_capa = _parse_non_negative_int(
        _config_value(
            "PAYMENT_REMINDER_SAFE_MAX_SENDS_PER_CAPA",
            DEFAULT_SAFE_MAX_SENDS_PER_CAPA,
        ),
        option_name="PAYMENT_REMINDER_SAFE_MAX_SENDS_PER_CAPA",
    )
    enforced = not dry_run and not allow_high_limits
    if enforced and max_sends > safe_max_sends:
        raise SystemExit(
            f"--max-envios ({max_sends}) excede el limite seguro "
            f"PAYMENT_REMINDER_SAFE_MAX_SENDS={safe_max_sends}. "
            "Sube el limite gradualmente o usa --allow-high-limits solo con aprobacion operativa."
        )
    if enforced and max_sends_per_capa > safe_max_sends_per_capa:
        raise SystemExit(
            f"--max-envios-por-capa ({max_sends_per_capa}) excede el limite seguro "
            f"PAYMENT_REMINDER_SAFE_MAX_SENDS_PER_CAPA={safe_max_sends_per_capa}. "
            "Sube el limite gradualmente o usa --allow-high-limits solo con aprobacion operativa."
        )
    return {
        "enforced": enforced,
        "allow_high_limits": allow_high_limits,
        "dry_run_bypasses_safe_caps": bool(dry_run),
        "safe_max_envios": safe_max_sends,
        "safe_max_envios_por_capa": safe_max_sends_per_capa,
        "default_max_envios": _parse_non_negative_int(
            _config_value("PAYMENT_REMINDER_DEFAULT_MAX_SENDS", DEFAULT_MAX_SENDS),
            option_name="PAYMENT_REMINDER_DEFAULT_MAX_SENDS",
        ),
        "default_max_envios_por_capa": _parse_non_negative_int(
            _config_value(
                "PAYMENT_REMINDER_DEFAULT_MAX_SENDS_PER_CAPA",
                DEFAULT_MAX_SENDS_PER_CAPA,
            ),
            option_name="PAYMENT_REMINDER_DEFAULT_MAX_SENDS_PER_CAPA",
        ),
    }


def _parse_time(value, *, option_name):
    raw_value = str(value or "").strip()
    try:
        parts = raw_value.split(":")
        if len(parts) == 1:
            hour = int(parts[0])
            minute = 0
        elif len(parts) == 2:
            hour = int(parts[0])
            minute = int(parts[1])
        else:
            raise ValueError
        return time(hour=hour, minute=minute)
    except (TypeError, ValueError):
        raise SystemExit(f"{option_name} debe tener formato HH:MM.")


def _format_time(value):
    return value.strftime("%H:%M")


def _parse_blocked_weekdays(value):
    raw_value = str(value or "").strip()
    if not raw_value or raw_value.lower() in {"none", "ninguno", "ninguna", "-"}:
        return set()
    blocked = set()
    for raw_item in raw_value.split(","):
        item = raw_item.strip().lower()
        if not item:
            continue
        if item not in WEEKDAY_ALIASES:
            raise SystemExit(
                "PAYMENT_REMINDER_BLOCKED_WEEKDAYS solo acepta dias 0-6 "
                "o nombres separados por coma."
            )
        blocked.add(WEEKDAY_ALIASES[item])
    return blocked


def _is_time_inside_window(current, start, end):
    if start <= end:
        return start <= current <= end
    return current >= start or current <= end


def _resolve_send_window_policy(options):
    enforce_default = _parse_bool(
        _config_value("PAYMENT_REMINDER_ENFORCE_SEND_WINDOW", True)
    )
    enforce = enforce_default and not bool(options.get("ignore_send_window"))
    timezone_name = (
        options.get("send_window_timezone")
        or _config_value("PAYMENT_REMINDER_SEND_TIMEZONE", DEFAULT_SEND_WINDOW_TIMEZONE)
    )
    try:
        timezone_info = ZoneInfo(str(timezone_name))
    except ZoneInfoNotFoundError:
        raise SystemExit(f"Zona horaria invalida para recordatorios: {timezone_name}.")

    window_start = _parse_time(
        options.get("send_window_start")
        or _config_value("PAYMENT_REMINDER_SEND_WINDOW_START", DEFAULT_SEND_WINDOW_START),
        option_name="PAYMENT_REMINDER_SEND_WINDOW_START",
    )
    window_end = _parse_time(
        options.get("send_window_end")
        or _config_value("PAYMENT_REMINDER_SEND_WINDOW_END", DEFAULT_SEND_WINDOW_END),
        option_name="PAYMENT_REMINDER_SEND_WINDOW_END",
    )
    blocked_weekdays = _parse_blocked_weekdays(
        options.get("blocked_weekdays")
        if options.get("blocked_weekdays") is not None
        else _config_value("PAYMENT_REMINDER_BLOCKED_WEEKDAYS", DEFAULT_BLOCKED_WEEKDAYS)
    )
    return {
        "enforce": enforce,
        "timezone_name": str(timezone_name),
        "timezone": timezone_info,
        "start": window_start,
        "end": window_end,
        "blocked_weekdays": blocked_weekdays,
    }


def _evaluate_send_window(policy, *, dry_run):
    local_now = timezone.now().astimezone(policy["timezone"])
    current = local_now.time().replace(second=0, microsecond=0)
    result = {
        "enforced": policy["enforce"],
        "timezone": policy["timezone_name"],
        "local_time": local_now.isoformat(),
        "window_start": _format_time(policy["start"]),
        "window_end": _format_time(policy["end"]),
        "blocked_weekdays": sorted(policy["blocked_weekdays"]),
        "blocked_weekday_labels": [
            WEEKDAY_LABELS[index] for index in sorted(policy["blocked_weekdays"])
        ],
        "dry_run_bypasses_window": bool(dry_run),
        "can_send": True,
        "reason": "ok",
        "detail": "Dentro de la ventana operativa.",
    }
    if dry_run:
        result["reason"] = "dry_run"
        result["detail"] = "Dry-run permitido fuera de ventana porque no envia mensajes."
        return result
    if not policy["enforce"]:
        result["reason"] = "disabled"
        result["detail"] = "La validacion de ventana operativa esta desactivada."
        return result
    weekday = local_now.weekday()
    if weekday in policy["blocked_weekdays"]:
        result["can_send"] = False
        result["reason"] = "blocked_weekday"
        result["detail"] = f"Dia bloqueado para envio: {WEEKDAY_LABELS[weekday]}."
        return result
    if not _is_time_inside_window(current, policy["start"], policy["end"]):
        result["can_send"] = False
        result["reason"] = "outside_window"
        result["detail"] = (
            f"Hora local {_format_time(current)} fuera de ventana "
            f"{_format_time(policy['start'])}-{_format_time(policy['end'])}."
        )
        return result
    return result


class Command(BaseCommand):
    help = "Procesa las automatizaciones de mensajeria saliente pendientes para la fecha actual."

    def add_arguments(self, parser):
        parser.add_argument(
            "--fecha",
            help="Fecha de referencia en formato YYYY-MM-DD. Si se omite, usa la fecha local actual.",
        )
        parser.add_argument(
            "--capa-id",
            type=int,
            help="Procesa solo una capa de negocio especifica.",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Calcula candidatos y reglas sin enviar mensajes ni crear historial.",
        )
        parser.add_argument(
            "--max-envios",
            type=int,
            default=None,
            help=(
                "Maximo de mensajes reales por corrida. Si se omite usa "
                "PAYMENT_REMINDER_DEFAULT_MAX_SENDS o 1. Usa 0 para solo registrar omitidos."
            ),
        )
        parser.add_argument(
            "--max-envios-por-capa",
            type=int,
            default=None,
            help=(
                "Maximo de mensajes reales por capa/configuracion dentro de la corrida. "
                "Si se omite usa PAYMENT_REMINDER_DEFAULT_MAX_SENDS_PER_CAPA o 1."
            ),
        )
        parser.add_argument(
            "--allow-high-limits",
            action="store_true",
            help=(
                "Permite superar PAYMENT_REMINDER_SAFE_MAX_SENDS y "
                "PAYMENT_REMINDER_SAFE_MAX_SENDS_PER_CAPA. Usar solo con aprobacion operativa."
            ),
        )
        parser.add_argument(
            "--fail-on-errors",
            action="store_true",
            help="Marca el cron como fallido si algun envio termina en error.",
        )
        parser.add_argument(
            "--require-whatsapp-ready",
            action="store_true",
            help=(
                "Falla antes de enviar si hay reglas WhatsApp activas sin plantilla "
                "Meta aprobada o sin proveedor saliente configurado."
            ),
        )
        parser.add_argument(
            "--ignore-send-window",
            action="store_true",
            help="Permite envio real aunque la hora local este fuera de la ventana operativa.",
        )
        parser.add_argument(
            "--send-window-start",
            help="Hora local inicial permitida para envio real, formato HH:MM.",
        )
        parser.add_argument(
            "--send-window-end",
            help="Hora local final permitida para envio real, formato HH:MM.",
        )
        parser.add_argument(
            "--send-window-timezone",
            help="Zona horaria IANA usada para validar la ventana operativa.",
        )
        parser.add_argument(
            "--blocked-weekdays",
            help=(
                "Dias bloqueados separados por coma. Usa 0=lunes ... 6=domingo "
                "o nombres como domingo,sabado."
            ),
        )

    def handle(self, *args, **options):
        reference_date = timezone.localdate()
        if options.get("fecha"):
            parsed_date = parse_date(options["fecha"])
            if parsed_date is None:
                raise SystemExit("La fecha debe tener formato YYYY-MM-DD.")
            reference_date = parsed_date

        queryset = (
            ConfiguracionComunicacion.objects.select_related("capa_negocio")
            .filter(activo=True, capa_negocio__isnull=False)
            .order_by("capa_negocio_id", "id")
        )
        if options.get("capa_id"):
            queryset = queryset.filter(capa_negocio_id=options["capa_id"])

        dry_run = bool(options.get("dry_run"))
        max_sends = _resolve_run_limit(
            options.get("max_envios"),
            setting_name="PAYMENT_REMINDER_DEFAULT_MAX_SENDS",
            default_value=DEFAULT_MAX_SENDS,
            option_name="--max-envios",
        )
        max_sends_per_capa = _resolve_run_limit(
            options.get("max_envios_por_capa"),
            setting_name="PAYMENT_REMINDER_DEFAULT_MAX_SENDS_PER_CAPA",
            default_value=DEFAULT_MAX_SENDS_PER_CAPA,
            option_name="--max-envios-por-capa",
        )
        allow_high_limits = bool(options.get("allow_high_limits"))
        limit_policy = _resolve_run_limit_policy(
            max_sends,
            max_sends_per_capa,
            dry_run=dry_run,
            allow_high_limits=allow_high_limits,
        )
        fail_on_errors = bool(options.get("fail_on_errors"))
        require_whatsapp_ready = bool(options.get("require_whatsapp_ready"))
        send_window_policy = _resolve_send_window_policy(options)
        send_window_status = _evaluate_send_window(send_window_policy, dry_run=dry_run)
        with monitor_cron_run(
            "payment_reminders",
            "Recordatorios de cobranza",
            metadata={
                "fecha": reference_date.isoformat(),
                "capa_id": options.get("capa_id"),
                "dry_run": dry_run,
                "max_envios": max_sends,
                "max_envios_por_capa": max_sends_per_capa,
                "allow_high_limits": allow_high_limits,
                "limit_policy": limit_policy,
                "fail_on_errors": fail_on_errors,
                "require_whatsapp_ready": require_whatsapp_ready,
                "send_window": send_window_status,
            },
        ) as cron_run:
            configs = list(queryset)
            if not configs:
                summary = "No existe configuracion de comunicaciones."
                update_cron_run(cron_run, summary=summary, metadata={"configs": 0})
                self.stdout.write(self.style.WARNING(summary))
                return
            if not send_window_status["can_send"]:
                summary = (
                    "Recordatorios omitidos por ventana operativa. "
                    f"{send_window_status['detail']}"
                )
                update_cron_run(
                    cron_run,
                    summary=summary,
                    metadata={
                        "configs": len(configs),
                        "sent": 0,
                        "skipped": 0,
                        "errors": 0,
                        "readiness_errors": 0,
                        "max_envios": max_sends,
                        "max_envios_por_capa": max_sends_per_capa,
                        "allow_high_limits": allow_high_limits,
                        "limit_policy": limit_policy,
                        "fail_on_errors": fail_on_errors,
                        "require_whatsapp_ready": require_whatsapp_ready,
                        "skipped_by_send_window": True,
                        "send_window": send_window_status,
                        "capas": [],
                    },
                )
                self.stdout.write(self.style.WARNING(summary))
                return

            total_sent = 0
            total_skipped = 0
            total_errors = 0
            readiness_errors = 0
            layer_results = []

            for config in configs:
                allowed_entity_ids = list(
                    config.capa_negocio.entidades.filter(activo=True).values_list("id", flat=True)
                )
                if not allowed_entity_ids:
                    layer_results.append(
                        {
                            "capa_id": config.capa_negocio_id,
                            "sent": 0,
                            "skipped": 0,
                            "errors": 0,
                            "rules": 0,
                            "candidates": 0,
                            "limit_reached": False,
                            "no_entities": True,
                        }
                    )
                    continue
                readiness = build_whatsapp_automation_readiness(
                    config=config,
                    allowed_entity_ids=allowed_entity_ids,
                )
                if require_whatsapp_ready and not readiness["ok"]:
                    readiness_errors += len(readiness["issues"])
                    layer_results.append(
                        {
                            "capa_id": config.capa_negocio_id,
                            "sent": 0,
                            "skipped": 0,
                            "errors": 0,
                            "rules": 0,
                            "candidates": 0,
                            "limit_reached": False,
                            "dry_run": dry_run,
                            "readiness": readiness,
                        }
                    )
                    self.stdout.write(
                        self.style.ERROR(
                            f"{config.capa_negocio_id} | {config.capa_negocio.nombre} | "
                            f"WhatsApp no listo: {len(readiness['issues'])} problema(s)"
                        )
                    )
                    for issue in readiness["issues"]:
                        self.stdout.write(f"- {issue['detail']}")
                    continue
                if dry_run:
                    result = self.preview_config(
                        config=config,
                        allowed_entity_ids=allowed_entity_ids,
                        reference_date=reference_date,
                    )
                else:
                    remaining_global = max(max_sends - total_sent, 0)
                    effective_limit = min(remaining_global, max_sends_per_capa)
                    result = execute_due_automations(
                        config=config,
                        allowed_entity_ids=allowed_entity_ids,
                        reference_date=reference_date,
                        max_sends=effective_limit,
                    )
                total_sent += int(result["sent"])
                total_skipped += int(result["skipped"])
                total_errors += len(result["errors"])
                rule_rows = result.get("reglas") or []
                layer_results.append(
                    {
                        "capa_id": config.capa_negocio_id,
                        "sent": int(result["sent"]),
                        "skipped": int(result["skipped"]),
                        "errors": len(result["errors"]),
                        "rules": len(rule_rows),
                        "candidates": sum(
                            int(row.get("candidatos") or 0) for row in rule_rows
                        ),
                        "limit_reached": bool(result.get("limit_reached")),
                        "dry_run": dry_run,
                        "readiness": readiness,
                    }
                )
                self.stdout.write(
                    f"{config.capa_negocio_id} | {config.capa_negocio.nombre} | "
                    f"enviados {result['sent']} | omitidos {result['skipped']} | "
                    f"errores {len(result['errors'])}"
                )
                for error in result["errors"]:
                    self.stdout.write(f"- {error}")

            summary = (
                ("Dry-run completado. " if dry_run else "Recordatorios procesados. ")
                + f"Capas: {len(configs)} | Enviados: {total_sent} | "
                f"Omitidos: {total_skipped} | Errores: {total_errors} | "
                f"Readiness: {readiness_errors} | Max envios: {max_sends} | "
                f"Max por capa: {max_sends_per_capa}"
            )
            update_cron_run(
                cron_run,
                summary=summary,
                metadata={
                    "configs": len(configs),
                    "sent": total_sent,
                    "skipped": total_skipped,
                    "errors": total_errors,
                    "readiness_errors": readiness_errors,
                    "max_envios": max_sends,
                    "max_envios_por_capa": max_sends_per_capa,
                    "allow_high_limits": allow_high_limits,
                    "limit_policy": limit_policy,
                    "fail_on_errors": fail_on_errors,
                    "require_whatsapp_ready": require_whatsapp_ready,
                    "skipped_by_send_window": False,
                    "send_window": send_window_status,
                    "capas": layer_results,
                },
            )
            if require_whatsapp_ready and readiness_errors:
                raise CommandError(
                    f"WhatsApp no esta listo para envio automatico: {readiness_errors} problema(s)."
                )
            if fail_on_errors and total_errors:
                raise CommandError(
                    f"Recordatorios procesados con {total_errors} error(es)."
                )
            self.stdout.write(self.style.SUCCESS(summary))

    def preview_config(self, *, config, allowed_entity_ids, reference_date):
        rules = (
            config.reglas_automatizacion.select_related(
                "plantilla_relacionada",
                "entidad_relacionada",
            )
            .filter(
                activo=True,
                plantilla_relacionada__activo=True,
            )
            .order_by("nombre", "id")
        )
        total_candidates = 0
        rule_rows = []
        for rule in rules:
            preview = build_automation_preview(
                config=config,
                rule=rule,
                allowed_entity_ids=allowed_entity_ids,
                reference_date=reference_date,
            )
            total_candidates += len(preview)
            rule_rows.append(
                {
                    "id": rule.id,
                    "nombre": rule.nombre,
                    "segmento": rule.segmento,
                    "candidatos": len(preview),
                    "enviados": 0,
                    "omitidos": len(preview),
                }
            )
        return {
            "fecha_referencia": reference_date,
            "reglas": rule_rows,
            "sent": 0,
            "skipped": total_candidates,
            "errors": [],
        }
