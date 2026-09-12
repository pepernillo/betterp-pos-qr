from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


API_BASE = os.getenv("BETTERP_API_BASE", "https://api.betterp.net/api").rstrip("/")
EMAIL = (
    os.getenv("BETTERP_BACKOFFICE_EMAIL", "").strip()
    or os.getenv("BETTERP_SMOKE_EMAIL", "").strip()
)
PASSWORD = (
    os.getenv("BETTERP_BACKOFFICE_PASSWORD", "").strip()
    or os.getenv("BETTERP_SMOKE_PASSWORD", "").strip()
)
TIMEOUT = int(os.getenv("BETTERP_SMOKE_TIMEOUT", "25"))
USER_AGENT = os.getenv(
    "BETTERP_CRON_HEALTH_USER_AGENT",
    "Mozilla/5.0 (compatible; BetterP-Cron-Health/1.0; +https://betterp.net)",
)
ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "tmp" / "cron-health-report.md"


def _request(
    method: str,
    url: str,
    *,
    token: str = "",
    json_body: dict[str, Any] | None = None,
) -> tuple[int, dict[str, Any] | list[Any] | str]:
    headers = {"Accept": "application/json", "User-Agent": USER_AGENT}
    data = None
    if json_body is not None:
        data = json.dumps(json_body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = Request(url, data=data, headers=headers, method=method)
    try:
        with urlopen(request, timeout=TIMEOUT) as response:
            raw = response.read().decode("utf-8", errors="replace")
            content_type = response.headers.get("content-type", "")
            status = response.status
    except HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        content_type = exc.headers.get("content-type", "")
        status = exc.code
    if "application/json" in content_type:
        try:
            return status, json.loads(raw or "{}")
        except json.JSONDecodeError:
            return status, raw[:500]
    return status, raw[:500]


def _detail(body: Any) -> str:
    if isinstance(body, dict):
        return str(body.get("detail") or body.get("mensaje") or body)[:300]
    return str(body)[:300]


def login() -> str:
    if not EMAIL or not PASSWORD:
        raise RuntimeError(
            "Define BETTERP_BACKOFFICE_EMAIL/BETTERP_BACKOFFICE_PASSWORD "
            "o BETTERP_SMOKE_EMAIL/BETTERP_SMOKE_PASSWORD."
        )
    status, body = _request(
        "POST",
        f"{API_BASE}/accounts/auth/login/",
        json_body={"email": EMAIL, "password": PASSWORD},
    )
    if status != 200 or not isinstance(body, dict):
        raise RuntimeError(f"Login fallido HTTP {status}: {_detail(body)}")
    token = ((body.get("tokens") or {}).get("access_token") or "").strip()
    if not token:
        raise RuntimeError("Login no devolvio access_token.")
    return token


def fetch_health() -> dict[str, Any]:
    token = login()
    status, body = _request("GET", f"{API_BASE}/billing/admin/salud/", token=token)
    if status != 200 or not isinstance(body, dict):
        raise RuntimeError(
            f"No se pudo leer Backoffice Salud HTTP {status}: {_detail(body)}"
        )
    return body


def load_health(path: Path) -> dict[str, Any]:
    try:
        body = json.loads(path.read_text(encoding="utf-8-sig"))
    except FileNotFoundError as exc:
        raise RuntimeError(f"No existe el JSON de entrada: {path}") from exc
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"JSON invalido en {path}: {exc}") from exc
    if not isinstance(body, dict):
        raise RuntimeError("El JSON de salud debe ser un objeto.")
    return body


def _sanitize(value: Any, *, limit: int = 220) -> str:
    text = str(value or "").replace("\n", " ").replace("|", "\\|").strip()
    if len(text) > limit:
        return text[: limit - 3] + "..."
    return text


def _last_run_detail(item: dict[str, Any]) -> str:
    last_run = item.get("last_run")
    if not isinstance(last_run, dict):
        return "sin evidencia"
    finished = last_run.get("finished_at") or last_run.get("started_at") or ""
    summary = last_run.get("summary") or last_run.get("error") or ""
    return _sanitize(f"{finished} {summary}", limit=180)


def build_markdown(health: dict[str, Any], *, generated_at: datetime) -> str:
    crons = health.get("crons") if isinstance(health.get("crons"), dict) else {}
    items = crons.get("items") if isinstance(crons.get("items"), list) else []
    status = "OK"
    if crons.get("error"):
        status = "ERROR"
    elif crons.get("warn") or crons.get("missing") or crons.get("stale"):
        status = "WARN"

    lines = [
        "# Reporte Salud Crons BetterP",
        "",
        f"- Generado: `{generated_at.isoformat()}`",
        f"- Estado crons: `{status}`",
        f"- Salud general: `{health.get('status', 'UNKNOWN')}`",
        f"- Total: `{crons.get('total', 0)}`",
        f"- OK: `{crons.get('ok', 0)}`",
        f"- Atencion: `{crons.get('warn', 0)}`",
        f"- Error: `{crons.get('error', 0)}`",
        f"- Sin evidencia: `{crons.get('missing', 0)}`",
        f"- Atrasados: `{crons.get('stale', 0)}`",
        f"- Activos: `{crons.get('running', 0)}`",
        "",
        "## Detalle",
        "",
        "| Estado | Key | Nombre | Agenda | Ventana | Ultima evidencia | Accion | Comando |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ]

    for item in items:
        if not isinstance(item, dict):
            continue
        lines.append(
            "| "
            + " | ".join(
                [
                    f"`{_sanitize(item.get('state') or item.get('status'))}`",
                    f"`{_sanitize(item.get('key'))}`",
                    _sanitize(item.get("name")),
                    _sanitize(item.get("schedule")),
                    f"{item.get('expected_hours', '')}h",
                    _last_run_detail(item),
                    _sanitize(item.get("action")),
                    f"`{_sanitize(item.get('command'), limit=260)}`",
                ]
            )
            + " |"
        )

    alerts = health.get("alerts") if isinstance(health.get("alerts"), list) else []
    lines.extend(["", "## Alertas relacionadas", ""])
    cron_alerts = [
        alert
        for alert in alerts
        if isinstance(alert, dict)
        and "cron" in f"{alert.get('titulo', '')} {alert.get('detalle', '')}".lower()
    ]
    if cron_alerts:
        lines.extend(
            f"- `{_sanitize(alert.get('tipo'))}` {_sanitize(alert.get('titulo'))}: "
            f"{_sanitize(alert.get('detalle'))}"
            for alert in cron_alerts
        )
    else:
        lines.append("_Sin alertas especificas de crons._")

    lines.extend(
        [
            "",
            "## Cierre operativo",
            "",
            "- `MISSING`: crear cron en Render o ejecutar `Trigger Run`.",
            "- `STALE`: revisar agenda, zona UTC y logs del ultimo job.",
            "- `FAILED`: revisar error, variables de entorno y reejecutar de forma controlada.",
            "- `RUNNING_STALE`: confirmar si el proceso quedo colgado antes de disparar otro.",
            "- `OK`: conservar evidencia y no tocar el job.",
            "",
        ]
    )
    return "\n".join(lines)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Genera reporte Markdown de Backoffice Salud > Crons.",
    )
    parser.add_argument(
        "--input-json",
        default="",
        help="JSON previamente exportado de /api/billing/admin/salud/. Si se omite, consulta produccion.",
    )
    parser.add_argument(
        "--output",
        default=str(DEFAULT_OUTPUT),
        help="Ruta del reporte Markdown. Default: tmp/cron-health-report.md.",
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()
    try:
        health = load_health(Path(args.input_json)) if args.input_json else fetch_health()
    except (RuntimeError, URLError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        build_markdown(health, generated_at=datetime.now(timezone.utc)),
        encoding="utf-8",
    )
    print(f"Reporte Salud Crons: {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
