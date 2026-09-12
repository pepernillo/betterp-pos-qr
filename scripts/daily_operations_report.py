from __future__ import annotations

import argparse
import os
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_BASE_DIR = ROOT / "tmp"


@dataclass
class ReportStep:
    name: str
    output: Path
    returncode: int
    stdout: str
    stderr: str
    skipped: bool = False

    @property
    def ok(self) -> bool:
        return self.skipped or self.returncode == 0


def _truthy(value: str | None) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes", "si"}


def _has_backoffice_credentials(env: dict[str, str]) -> bool:
    email = env.get("BETTERP_BACKOFFICE_EMAIL") or env.get("BETTERP_SMOKE_EMAIL")
    password = env.get("BETTERP_BACKOFFICE_PASSWORD") or env.get("BETTERP_SMOKE_PASSWORD")
    return bool((email or "").strip() and (password or "").strip())


def _run(command: list[str], *, env: dict[str, str], timeout: int) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        cwd=ROOT,
        env=env,
        text=True,
        capture_output=True,
        timeout=timeout,
    )


def _sanitize(value: str, *, limit: int = 260) -> str:
    text = value.replace("\n", " ").replace("|", "\\|").strip()
    if len(text) > limit:
        return text[: limit - 3] + "..."
    return text


def _write_log(step: ReportStep, report_dir: Path) -> None:
    log_path = report_dir / f"{step.output.stem}.log"
    log_path.write_text(
        "\n".join(
            [
                f"# {step.name}",
                "",
                f"returncode={step.returncode}",
                "",
                "## stdout",
                step.stdout or "",
                "",
                "## stderr",
                step.stderr or "",
                "",
            ]
        ),
        encoding="utf-8",
    )


def _run_step(
    *,
    name: str,
    command: list[str],
    output: Path,
    env: dict[str, str],
    timeout: int,
    report_dir: Path,
) -> ReportStep:
    result = _run(command, env=env, timeout=timeout)
    step = ReportStep(
        name=name,
        output=output,
        returncode=result.returncode,
        stdout=result.stdout,
        stderr=result.stderr,
    )
    _write_log(step, report_dir)
    print(result.stdout, end="")
    if result.stderr:
        print(result.stderr, end="", file=sys.stderr)
    return step


def _skipped_step(name: str, output: Path, reason: str, report_dir: Path) -> ReportStep:
    step = ReportStep(
        name=name,
        output=output,
        returncode=0,
        stdout=f"Omitido: {reason}\n",
        stderr="",
        skipped=True,
    )
    _write_log(step, report_dir)
    return step


def _build_index(*, generated_at: datetime, report_dir: Path, steps: list[ReportStep]) -> str:
    overall_ok = all(step.ok for step in steps)
    lines = [
        "# Paquete diario de operacion BetterP",
        "",
        f"- Generado: `{generated_at.isoformat()}`",
        f"- Estado general: `{'OK' if overall_ok else 'FAIL'}`",
        f"- Carpeta: `{report_dir}`",
        "",
        "## Reportes",
        "",
        "| Reporte | Estado | Archivo | Detalle |",
        "| --- | --- | --- | --- |",
    ]
    for step in steps:
        status = "SKIP" if step.skipped else ("OK" if step.returncode == 0 else "FAIL")
        relative = step.output.name
        detail = _sanitize(step.stdout or step.stderr or "")
        lines.append(f"| {step.name} | `{status}` | [{relative}]({relative}) | {detail} |")

    lines.extend(
        [
            "",
            "## Uso operativo",
            "",
            "- Revisar primero cualquier reporte en `FAIL`.",
            "- Si readiness falla en contrato backend, revisar deploy/version antes de producto.",
            "- Si crons marca `MISSING`, crear job o ejecutar `Trigger Run` en Render.",
            "- Si clientes marca `ERROR`, asignar responsable y mitigacion el mismo dia.",
            "- Conservar esta carpeta como evidencia de la revision diaria.",
            "",
        ]
    )
    return "\n".join(lines)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Genera paquete diario de operacion con readiness, crons y clientes en riesgo.",
    )
    parser.add_argument(
        "--output-dir",
        default="",
        help="Carpeta destino. Default: tmp/operations-YYYYMMDD-HHMMSS.",
    )
    parser.add_argument("--skip-readiness", action="store_true")
    parser.add_argument("--skip-crons", action="store_true")
    parser.add_argument("--skip-customers", action="store_true")
    parser.add_argument("--require-backoffice", action="store_true")
    parser.add_argument("--continue-on-error", action="store_true")
    parser.add_argument("--require-commit", action="store_true")
    parser.add_argument("--cron-input-json", default="", help="JSON offline para cron_health_report.py.")
    parser.add_argument("--customer-input-json", default="", help="JSON offline para customer_health_report.py.")
    parser.add_argument("--wait-timeout", type=int, default=600)
    parser.add_argument("--request-timeout", type=int, default=20)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    generated_at = datetime.now(timezone.utc)
    stamp = generated_at.strftime("%Y%m%d-%H%M%S")
    report_dir = Path(args.output_dir) if args.output_dir else DEFAULT_BASE_DIR / f"operations-{stamp}"
    report_dir.mkdir(parents=True, exist_ok=True)
    env = os.environ.copy()

    steps: list[ReportStep] = []
    readiness_output = report_dir / "production-readiness-report.md"
    smoke_json = report_dir / "production-readiness-smoke.json"
    if args.skip_readiness:
        steps.append(_skipped_step("Readiness productivo", readiness_output, "deshabilitado por flag", report_dir))
    else:
        command = [
            sys.executable,
            "scripts/production_readiness_report.py",
            "--output",
            str(readiness_output),
            "--smoke-json",
            str(smoke_json),
            "--wait-timeout",
            str(args.wait_timeout),
            "--request-timeout",
            str(args.request_timeout),
        ]
        if args.require_commit or _truthy(env.get("BETTERP_SMOKE_REQUIRE_DEPLOY_COMMIT")):
            command.append("--require-commit")
        steps.append(
            _run_step(
                name="Readiness productivo",
                command=command,
                output=readiness_output,
                env=env,
                timeout=args.wait_timeout + 360,
                report_dir=report_dir,
            )
        )

    has_backoffice = _has_backoffice_credentials(env)
    cron_output = report_dir / "cron-health-report.md"
    if args.skip_crons:
        steps.append(_skipped_step("Salud de crons", cron_output, "deshabilitado por flag", report_dir))
    elif not has_backoffice and not args.cron_input_json:
        reason = "faltan credenciales backoffice y no se paso --cron-input-json"
        steps.append(_skipped_step("Salud de crons", cron_output, reason, report_dir))
        if args.require_backoffice:
            steps[-1].returncode = 1
    else:
        command = [sys.executable, "scripts/cron_health_report.py", "--output", str(cron_output)]
        if args.cron_input_json:
            command.extend(["--input-json", args.cron_input_json])
        steps.append(
            _run_step(
                name="Salud de crons",
                command=command,
                output=cron_output,
                env=env,
                timeout=90,
                report_dir=report_dir,
            )
        )

    customer_output = report_dir / "customer-health-report.md"
    if args.skip_customers:
        steps.append(_skipped_step("Clientes SaaS en riesgo", customer_output, "deshabilitado por flag", report_dir))
    elif not has_backoffice and not args.customer_input_json:
        reason = "faltan credenciales backoffice y no se paso --customer-input-json"
        steps.append(_skipped_step("Clientes SaaS en riesgo", customer_output, reason, report_dir))
        if args.require_backoffice:
            steps[-1].returncode = 1
    else:
        command = [sys.executable, "scripts/customer_health_report.py", "--output", str(customer_output)]
        if args.customer_input_json:
            command.extend(["--input-json", args.customer_input_json])
        steps.append(
            _run_step(
                name="Clientes SaaS en riesgo",
                command=command,
                output=customer_output,
                env=env,
                timeout=90,
                report_dir=report_dir,
            )
        )

    index = report_dir / "index.md"
    index.write_text(
        _build_index(generated_at=generated_at, report_dir=report_dir, steps=steps),
        encoding="utf-8",
    )
    print(f"Paquete diario de operacion: {index}")

    failed = [step for step in steps if not step.ok]
    if failed and not args.continue_on_error:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
