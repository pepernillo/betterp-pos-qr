from __future__ import annotations

import argparse
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = ROOT / "backend"
DEFAULT_CRON = ROOT / "ops" / "vultr" / "betterp.saas.cron"
DEFAULT_OUTPUT = ROOT / "tmp" / "vultr-saas-automation-manifest.md"

sys.path.insert(0, str(BACKEND_ROOT))

from billing.saas_automation_manifest import SAAS_AUTOMATION_DEFINITIONS  # noqa: E402


RETIRED_TOKENS = (
    "render",
    "vende_facil",
    "vende-facil",
    "keepalive",
    "payment_reminders",
)


def executable_cron_lines(cron_text: str) -> list[str]:
    return [
        line.strip()
        for line in cron_text.splitlines()
        if line.strip() and line.lstrip()[0] in "0123456789*"
    ]


def validate_cron_manifest(cron_text: str) -> list[str]:
    normalized = cron_text.lower()
    retired = [token for token in RETIRED_TOKENS if token in normalized]
    if retired:
        raise ValueError(f"Expectativas retiradas presentes: {', '.join(retired)}")

    lines = executable_cron_lines(cron_text)
    if len(lines) != len(SAAS_AUTOMATION_DEFINITIONS):
        raise ValueError(
            "Numero de jobs distinto al contrato: "
            f"esperados={len(SAAS_AUTOMATION_DEFINITIONS)} actuales={len(lines)}"
        )

    for definition in SAAS_AUTOMATION_DEFINITIONS:
        matching = [
            line
            for line in lines
            if definition["command"] in line
            and definition["lock_file"] in line
            and line.startswith(f"{definition['cron_schedule']} root ")
        ]
        if len(matching) != 1:
            raise ValueError(
                f"Job {definition['key']} no coincide exactamente con horario, lock y comando."
            )
    return lines


def build_markdown() -> str:
    lines = [
        "# Manifiesto de automatizaciones SaaS BetterP en Vultr",
        "",
        "Fuente única para el scheduler y `Backoffice > Salud > Crons`.",
        "",
        "- Runtime: `betterp-scheduler` en Vultr/Docker.",
        "- Zona horaria: UTC.",
        "- Concurrencia: un `flock` exclusivo por proceso.",
        "- Reporte post go-live: evidencia local, sin correo automático.",
        "",
        "| Orden | Health key | Schedule UTC | Comando activo | Preview | Efecto | Lock |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ]
    for index, item in enumerate(SAAS_AUTOMATION_DEFINITIONS, start=1):
        lines.append(
            "| "
            + " | ".join(
                [
                    str(index),
                    f"`{item['key']}`",
                    f"`{item['cron_schedule']}`",
                    f"`{item['command']}`",
                    f"`{item['preview_command']}`",
                    str(item["effect"]),
                    f"`{item['lock_file']}`",
                ]
            )
            + " |"
        )
    lines.extend(
        [
            "",
            "## Activación controlada",
            "",
            "1. Ejecutar todos los comandos de preview contra la imagen candidata.",
            "2. Verificar que no hubo llamadas de proveedor ni cambios de suscripción.",
            "3. Instalar el cron sellado y recrear únicamente `betterp-scheduler`.",
            "4. Confirmar hash montado, proceso `cron`, locks y evidencia en Salud.",
            "",
        ]
    )
    return "\n".join(lines)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Valida y documenta el scheduler SaaS de BetterP en Vultr."
    )
    parser.add_argument("--cron-file", default=str(DEFAULT_CRON))
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT))
    return parser


def main() -> int:
    args = build_parser().parse_args()
    cron_path = Path(args.cron_file)
    cron_text = cron_path.read_text(encoding="utf-8")
    jobs = validate_cron_manifest(cron_text)

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(build_markdown(), encoding="utf-8")
    print(
        "vultr_saas_cron_manifest=ok|"
        f"jobs={len(jobs)}|output={output}|writes=local_manifest_only"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
