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
    "BETTERP_CUSTOMER_HEALTH_USER_AGENT",
    "Mozilla/5.0 (compatible; BetterP-Customer-Health/1.0; +https://betterp.net)",
)
ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "tmp" / "customer-health-report.md"

STATUS_RANK = {"ERROR": 0, "WARN": 1, "OK": 2}


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


def fetch_customers() -> dict[str, Any]:
    token = login()
    status, body = _request("GET", f"{API_BASE}/billing/admin/clientes/", token=token)
    if status != 200 or not isinstance(body, dict):
        raise RuntimeError(
            f"No se pudo leer Backoffice Clientes HTTP {status}: {_detail(body)}"
        )
    return body


def load_customers(path: Path) -> dict[str, Any]:
    try:
        body = json.loads(path.read_text(encoding="utf-8-sig"))
    except FileNotFoundError as exc:
        raise RuntimeError(f"No existe el JSON de entrada: {path}") from exc
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"JSON invalido en {path}: {exc}") from exc
    if not isinstance(body, dict):
        raise RuntimeError("El JSON de clientes debe ser un objeto.")
    return body


def _sanitize(value: Any, *, limit: int = 180) -> str:
    text = str(value or "").replace("\n", " ").replace("|", "\\|").strip()
    if len(text) > limit:
        return text[: limit - 3] + "..."
    return text


def _customer_name(item: dict[str, Any]) -> str:
    capa = item.get("capa_negocio") if isinstance(item.get("capa_negocio"), dict) else {}
    return _sanitize(capa.get("nombre") or item.get("cliente") or item.get("id"))


def _customer_contact(item: dict[str, Any]) -> str:
    capa = item.get("capa_negocio") if isinstance(item.get("capa_negocio"), dict) else {}
    parts = [capa.get("correo_contacto"), capa.get("telefono_contacto")]
    return _sanitize(" / ".join(str(part) for part in parts if part), limit=140) or "-"


def _primary_issue(health: dict[str, Any]) -> dict[str, Any]:
    issues = health.get("issues") if isinstance(health.get("issues"), list) else []
    if issues and isinstance(issues[0], dict):
        return issues[0]
    return {}


def _risk_domains(health: dict[str, Any]) -> str:
    domains = health.get("domains") if isinstance(health.get("domains"), list) else []
    labels = [
        str(domain.get("label") or domain.get("key"))
        for domain in domains
        if isinstance(domain, dict) and domain.get("status") != "OK"
    ]
    if not labels:
        labels = [str(item) for item in health.get("risk_domains") or []]
    return _sanitize(", ".join(labels), limit=160) or "-"


def _sort_key(item: dict[str, Any]) -> tuple[int, int, str]:
    health = item.get("health") if isinstance(item.get("health"), dict) else {}
    status = str(health.get("status") or "OK")
    score = int(health.get("score") or 0)
    return (STATUS_RANK.get(status, 9), score, _customer_name(item).lower())


def build_markdown(payload: dict[str, Any], *, generated_at: datetime, limit: int) -> str:
    summary = payload.get("salud_clientes") if isinstance(payload.get("salud_clientes"), dict) else {}
    items = payload.get("items") if isinstance(payload.get("items"), list) else []
    risky = [
        item
        for item in items
        if isinstance(item, dict)
        and isinstance(item.get("health"), dict)
        and item["health"].get("status") in {"WARN", "ERROR"}
    ]
    risky.sort(key=_sort_key)
    selected = risky[:limit]

    lines = [
        "# Reporte Clientes SaaS en Riesgo BetterP",
        "",
        f"- Generado: `{generated_at.isoformat()}`",
        f"- Total clientes: `{summary.get('total', len(items))}`",
        f"- OK: `{summary.get('ok', 0)}`",
        f"- WARN: `{summary.get('warn', 0)}`",
        f"- ERROR: `{summary.get('error', 0)}`",
        f"- Friccion acceso 7d: `{summary.get('friccion_acceso_7d', 0)}`",
        f"- Clientes listados: `{len(selected)}`",
        "",
        "## Prioridad operativa",
        "",
    ]

    if not selected:
        lines.append("_No hay clientes en WARN/ERROR en el JSON revisado._")
    else:
        lines.extend(
            [
                "| Estado | Cliente | Responsable | Accion siguiente | Dominio riesgo | Issue principal | Contacto |",
                "| --- | --- | --- | --- | --- | --- | --- |",
            ]
        )
        for item in selected:
            health = item.get("health") if isinstance(item.get("health"), dict) else {}
            issue = _primary_issue(health)
            lines.append(
                "| "
                + " | ".join(
                    [
                        f"`{_sanitize(health.get('status'))}`",
                        _customer_name(item),
                        _sanitize(health.get("primary_owner") or issue.get("owner") or "-"),
                        _sanitize(health.get("primary_action") or issue.get("action") or "-"),
                        _risk_domains(health),
                        _sanitize(
                            f"{issue.get('title', '')}: {issue.get('detail', '')}".strip(": "),
                            limit=220,
                        )
                        or "-",
                        _customer_contact(item),
                    ]
                )
                + " |"
            )

    lines.extend(["", "## Detalle por cliente", ""])
    for item in selected:
        health = item.get("health") if isinstance(item.get("health"), dict) else {}
        account = item.get("account_status") if isinstance(item.get("account_status"), dict) else {}
        plan = item.get("plan") if isinstance(item.get("plan"), dict) else {}
        lines.extend(
            [
                f"### {_customer_name(item)}",
                "",
                f"- Estado salud: `{health.get('status', 'UNKNOWN')}` score `{health.get('score', '-')}`",
                f"- Plan: `{plan.get('nombre') or plan.get('clave') or '-'}`",
                f"- Estado cuenta: `{account.get('estado', '-')}` MRR `{account.get('mrr_estimado', 0)}`",
                f"- Responsable: `{health.get('primary_owner') or '-'}`",
                f"- Accion: {health.get('primary_action') or '-'}",
                f"- Dominios: {_risk_domains(health)}",
                f"- Backup: {_sanitize(((health.get('last_backup') or {}) if isinstance(health.get('last_backup'), dict) else {}).get('estatus') or 'sin backup')}",
                f"- Billing errores 30d: `{health.get('billing_errors_30d', 0)}`",
                f"- Bloqueos plan 7d: `{health.get('plan_denials_7d', 0)}`",
                f"- Bloqueos rol 7d: `{health.get('access_denials_7d', 0)}`",
                f"- Actividad 14d: `{health.get('activity_events_14d', 0)}`",
                "",
            ]
        )
        issues = health.get("issues") if isinstance(health.get("issues"), list) else []
        if issues:
            lines.append("Issues:")
            for issue in issues[:5]:
                if not isinstance(issue, dict):
                    continue
                lines.append(
                    f"- `{_sanitize(issue.get('status'))}` {_sanitize(issue.get('title'))}: "
                    f"{_sanitize(issue.get('action') or issue.get('detail'), limit=240)}"
                )
            lines.append("")

    lines.extend(
        [
            "## Cierre operativo",
            "",
            "- `ERROR`: asignar responsable y accion de mitigacion el mismo dia.",
            "- `WARN`: dejar seguimiento preventivo con fecha objetivo.",
            "- Si el riesgo es billing, revisar Stripe/eventos antes de prometer acceso.",
            "- Si el riesgo es capacidad, evaluar upgrade antes de limpiar datos.",
            "- Si el riesgo es permisos, revisar auditoria antes de ampliar roles.",
            "",
        ]
    )
    return "\n".join(lines)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Genera reporte Markdown de Backoffice Clientes SaaS en riesgo.",
    )
    parser.add_argument(
        "--input-json",
        default="",
        help="JSON previamente exportado de /api/billing/admin/clientes/. Si se omite, consulta produccion.",
    )
    parser.add_argument(
        "--output",
        default=str(DEFAULT_OUTPUT),
        help="Ruta del reporte Markdown. Default: tmp/customer-health-report.md.",
    )
    parser.add_argument("--limit", type=int, default=25, help="Maximo de clientes en WARN/ERROR a listar.")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    try:
        payload = load_customers(Path(args.input_json)) if args.input_json else fetch_customers()
    except (RuntimeError, URLError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        build_markdown(payload, generated_at=datetime.now(timezone.utc), limit=max(args.limit, 1)),
        encoding="utf-8",
    )
    print(f"Reporte Clientes SaaS: {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
