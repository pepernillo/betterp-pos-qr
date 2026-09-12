import json
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from billing.cron_monitor import monitor_cron_run, update_cron_run


USER_AGENT = "BetterP-API-Keepalive/1.0"


def _clean_url(value: str | None) -> str:
    return (value or "").strip()


def _backend_base_url() -> str:
    return _clean_url(getattr(settings, "BACKEND_PUBLIC_BASE_URL", "")).rstrip("/")


def _default_health_url() -> str:
    base = _backend_base_url()
    return f"{base}/health/" if base else ""


def _default_warmup_url() -> str:
    base = _backend_base_url()
    return f"{base}/api/warmup/" if base else ""


def _default_app_url() -> str:
    base = _clean_url(getattr(settings, "FRONTEND_BASE_URL", "")).rstrip("/")
    if not base or "localhost" in base or "127.0.0.1" in base:
        return ""
    return f"{base}/login"


def _ping_url(name: str, url: str, *, timeout: int) -> dict:
    started = time.monotonic()
    status = None
    detail = ""
    ok = False
    try:
        request = Request(
            url,
            headers={
                "Accept": "application/json,text/html;q=0.9,*/*;q=0.8",
                "User-Agent": USER_AGENT,
                "X-BettERP-Keepalive": "1",
            },
            method="GET",
        )
        with urlopen(request, timeout=timeout) as response:
            status = response.status
            raw = response.read(500).decode("utf-8", errors="replace")
            ok = 200 <= status < 400
            detail = raw[:180]
    except HTTPError as exc:
        status = exc.code
        detail = exc.read(500).decode("utf-8", errors="replace")[:180]
    except URLError as exc:
        detail = str(exc.reason)[:180]
    except Exception as exc:
        detail = str(exc)[:180]

    return {
        "name": name,
        "url": url,
        "ok": ok,
        "status": status,
        "duration_ms": int((time.monotonic() - started) * 1000),
        "detail": detail,
    }


class Command(BaseCommand):
    help = "Hace ping a health/warmup publico para evitar cold start y registrar el cron."

    def add_arguments(self, parser):
        parser.add_argument("--health-url", default=None, help="URL health publica. Default: BACKEND_PUBLIC_BASE_URL/health/.")
        parser.add_argument("--warmup-url", default=None, help="URL warmup publica. Default: BACKEND_PUBLIC_BASE_URL/api/warmup/.")
        parser.add_argument("--app-url", default=None, help="URL frontend opcional. Default: FRONTEND_BASE_URL/login si no es localhost.")
        parser.add_argument("--timeout", type=int, default=20, help="Timeout por URL en segundos.")
        parser.add_argument("--fail-on-error", action="store_true", help="Marca el comando como fallido si alguna URL no responde 2xx/3xx.")

    def handle(self, *args, **options):
        health_url = _clean_url(options.get("health_url"))
        warmup_url = _clean_url(options.get("warmup_url"))
        app_url = _clean_url(options.get("app_url"))
        if options.get("health_url") is None:
            health_url = _default_health_url()
        if options.get("warmup_url") is None:
            warmup_url = _default_warmup_url()
        if options.get("app_url") is None:
            app_url = _default_app_url()

        targets = [
            ("api_health", health_url),
            ("api_warmup", warmup_url),
            ("frontend_login", app_url),
        ]
        targets = [(name, url) for name, url in targets if url]
        if not targets:
            raise CommandError("Configura BACKEND_PUBLIC_BASE_URL o pasa --health-url/--warmup-url.")

        timeout = max(int(options.get("timeout") or 20), 1)
        with monitor_cron_run(
            "api_keepalive",
            "Keepalive API publica",
            metadata={"target_count": len(targets), "timeout": timeout},
        ) as cron_run:
            results = [
                _ping_url(name, url, timeout=timeout)
                for name, url in targets
            ]
            failures = [item for item in results if not item["ok"]]
            max_duration = max((item["duration_ms"] for item in results), default=0)
            summary = (
                f"OK {len(results) - len(failures)}/{len(results)} | "
                f"fallas={len(failures)} | max={max_duration}ms"
            )
            update_cron_run(
                cron_run,
                summary=summary,
                metadata={
                    "ok": len(results) - len(failures),
                    "failures": len(failures),
                    "max_duration_ms": max_duration,
                    "results": results,
                },
            )
            for item in results:
                status = item["status"] if item["status"] is not None else "-"
                marker = "OK" if item["ok"] else "FAIL"
                self.stdout.write(
                    f"[{marker}] {item['name']} status={status} "
                    f"time={item['duration_ms']}ms"
                )
            self.stdout.write(json.dumps({"summary": summary}, ensure_ascii=False))
            if failures and options.get("fail_on_error"):
                raise CommandError(summary)
