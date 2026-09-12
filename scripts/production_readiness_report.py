from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "tmp" / "production-readiness-report.md"
DEFAULT_SMOKE_JSON = ROOT / "tmp" / "production-readiness-smoke.json"


def _truthy(value: str | None) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes", "si"}


def _run(command: list[str], *, env: dict[str, str], timeout: int) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        cwd=ROOT,
        env=env,
        text=True,
        capture_output=True,
        timeout=timeout,
    )


def _load_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def _status(ok: bool) -> str:
    return "OK" if ok else "FAIL"


def _markdown_table(rows: list[list[str]]) -> str:
    if not rows:
        return "_Sin datos._\n"
    header = rows[0]
    separator = ["---" for _ in header]
    body = rows[1:]
    lines = [
        "| " + " | ".join(header) + " |",
        "| " + " | ".join(separator) + " |",
    ]
    lines.extend("| " + " | ".join(row) + " |" for row in body)
    return "\n".join(lines) + "\n"


def _sanitize(value: Any, *, limit: int = 180) -> str:
    text = str(value or "").replace("\n", " ").replace("|", "\\|").strip()
    if len(text) > limit:
        return text[: limit - 3] + "..."
    return text


def _build_report(
    *,
    generated_at: datetime,
    args: argparse.Namespace,
    wait_result: subprocess.CompletedProcess[str] | None,
    smoke_result: subprocess.CompletedProcess[str] | None,
    smoke_report: dict[str, Any],
) -> str:
    wait_ok = wait_result is None or wait_result.returncode == 0
    smoke_ok = smoke_result is None or smoke_result.returncode == 0
    overall_ok = wait_ok and smoke_ok and bool(smoke_report.get("ok", smoke_ok))
    deployment = ""
    health_check = next(
        (
            item
            for item in smoke_report.get("checks", [])
            if isinstance(item, dict) and item.get("name") == "api health"
        ),
        {},
    )
    if isinstance(health_check, dict):
        deployment = _sanitize(health_check.get("detail"), limit=260)

    lines = [
        "# Reporte de readiness productivo BetterP",
        "",
        f"- Generado: `{generated_at.isoformat()}`",
        f"- Estado general: `{_status(overall_ok)}`",
        f"- API: `{smoke_report.get('api_base') or os.getenv('BETTERP_API_BASE', 'https://api.betterp.net/api')}`",
        f"- App: `{smoke_report.get('app_base') or os.getenv('BETTERP_APP_BASE', 'https://betterp.net')}`",
        f"- Commit esperado: `{args.commit or os.getenv('BETTERP_DEPLOY_COMMIT', '') or 'no fijado'}`",
        f"- Commit estricto: `{bool(args.require_commit)}`",
        "",
        "## Resultado",
        "",
        _markdown_table(
            [
                ["Check", "Estado", "Detalle"],
                [
                    "Contrato backend",
                    _status(wait_ok),
                    _sanitize((wait_result.stdout if wait_result else "omitido").strip(), limit=220),
                ],
                [
                    "Smoke MVP",
                    _status(smoke_ok),
                    _sanitize((smoke_result.stdout if smoke_result else "omitido").strip(), limit=220),
                ],
            ]
        ).rstrip(),
        "",
        "## Smoke",
        "",
        f"- Total checks: `{smoke_report.get('total', 0)}`",
        f"- Fallas: `{smoke_report.get('failures', 0)}`",
        f"- Duracion total: `{smoke_report.get('total_duration_ms', 0)} ms`",
        f"- Capa smoke: `{smoke_report.get('selected_capa_id') or 'no autenticada'}`",
        f"- Escritura habilitada: `{bool(smoke_report.get('write_enabled'))}`",
        f"- E2E habilitado: `{bool(smoke_report.get('e2e_enabled'))}`",
        f"- Deploy/health: {deployment or '_Sin detalle de health._'}",
        "",
        "## Fallas",
        "",
    ]

    failed = smoke_report.get("failed_checks") or []
    if failed:
        lines.append(
            _markdown_table(
                [["Check", "HTTP", "Tiempo", "Detalle"]]
                + [
                    [
                        _sanitize(item.get("name")),
                        _sanitize(item.get("status")),
                        f"{item.get('duration_ms', 0)} ms",
                        _sanitize(item.get("detail"), limit=220),
                    ]
                    for item in failed
                    if isinstance(item, dict)
                ]
            ).rstrip()
        )
    else:
        lines.append("_Sin fallas reportadas por smoke._")

    lines.extend(["", "## Checks mas lentos", ""])
    slowest = smoke_report.get("slowest_checks") or []
    if slowest:
        lines.append(
            _markdown_table(
                [["Check", "HTTP", "Tiempo", "Detalle"]]
                + [
                    [
                        _sanitize(item.get("name")),
                        _sanitize(item.get("status")),
                        f"{item.get('duration_ms', 0)} ms",
                        _sanitize(item.get("detail"), limit=220),
                    ]
                    for item in slowest
                    if isinstance(item, dict)
                ]
            ).rstrip()
        )
    else:
        lines.append("_Sin datos de latencia._")

    lines.extend(
        [
            "",
            "## Cierre operativo",
            "",
            "- Si el estado general es `OK`, el ambiente puede usarse como evidencia de readiness del dia.",
            "- Si falla contrato backend, revisar deploy/version antes de tocar producto.",
            "- Si falla smoke autenticado, revisar credenciales, permisos, capa seleccionada y logs backend.",
            "- No usar este reporte para autorizar smoke write sobre capas reales.",
            "",
        ]
    )
    return "\n".join(lines)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Genera un reporte Markdown de readiness productivo con wait contract y smoke.",
    )
    parser.add_argument(
        "--output",
        default=str(DEFAULT_OUTPUT),
        help="Ruta del reporte Markdown. Default: tmp/production-readiness-report.md.",
    )
    parser.add_argument(
        "--smoke-json",
        default=str(DEFAULT_SMOKE_JSON),
        help="Ruta temporal del JSON generado por smoke_mvp.py.",
    )
    parser.add_argument(
        "--commit",
        default=os.getenv("BETTERP_DEPLOY_COMMIT", "").strip(),
        help="Commit backend esperado. Si se omite, valida solo contrato/features.",
    )
    parser.add_argument(
        "--require-commit",
        action="store_true",
        default=_truthy(os.getenv("BETTERP_SMOKE_REQUIRE_DEPLOY_COMMIT")),
        help="Falla si health no expone el commit esperado.",
    )
    parser.add_argument("--skip-wait", action="store_true", help="No ejecuta wait_backend_contract.py.")
    parser.add_argument("--skip-smoke", action="store_true", help="No ejecuta smoke_mvp.py.")
    parser.add_argument("--wait-timeout", type=int, default=600)
    parser.add_argument("--wait-interval", type=int, default=15)
    parser.add_argument("--request-timeout", type=int, default=20)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    generated_at = datetime.now(timezone.utc)
    env = os.environ.copy()
    env["BETTERP_SMOKE_REPORT_JSON"] = str(Path(args.smoke_json))
    if args.commit:
        env["BETTERP_DEPLOY_COMMIT"] = args.commit
    if args.require_commit:
        env["BETTERP_SMOKE_REQUIRE_DEPLOY_COMMIT"] = "1"

    wait_result = None
    if not args.skip_wait:
        wait_command = [
            sys.executable,
            "scripts/wait_backend_contract.py",
            "--timeout",
            str(args.wait_timeout),
            "--interval",
            str(args.wait_interval),
            "--request-timeout",
            str(args.request_timeout),
        ]
        if args.commit:
            wait_command.extend(["--commit", args.commit])
        if args.require_commit:
            wait_command.append("--require-commit")
        wait_result = _run(wait_command, env=env, timeout=args.wait_timeout + 60)
        print(wait_result.stdout, end="")
        if wait_result.stderr:
            print(wait_result.stderr, end="", file=sys.stderr)

    smoke_result = None
    smoke_report: dict[str, Any] = {}
    if not args.skip_smoke:
        smoke_path = Path(args.smoke_json)
        smoke_path.parent.mkdir(parents=True, exist_ok=True)
        if smoke_path.exists():
            smoke_path.unlink()
        smoke_result = _run(
            [sys.executable, "scripts/smoke_mvp.py"],
            env=env,
            timeout=300,
        )
        print(smoke_result.stdout, end="")
        if smoke_result.stderr:
            print(smoke_result.stderr, end="", file=sys.stderr)
        smoke_report = _load_json(smoke_path)

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        _build_report(
            generated_at=generated_at,
            args=args,
            wait_result=wait_result,
            smoke_result=smoke_result,
            smoke_report=smoke_report,
        ),
        encoding="utf-8",
    )
    print(f"Reporte readiness: {output}")

    if wait_result is not None and wait_result.returncode != 0:
        return wait_result.returncode
    if smoke_result is not None and smoke_result.returncode != 0:
        return smoke_result.returncode
    if smoke_report and not smoke_report.get("ok", False):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
