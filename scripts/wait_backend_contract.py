from __future__ import annotations

import argparse
import json
import os
import sys
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


DEFAULT_FEATURES = "crm_portal_link,capa_backup_streaming_export"
DEFAULT_HEALTH_URL = "https://api.betterp.net/"
DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (compatible; BetterP-Deploy-Wait/1.0; +https://betterp.net)"
)


def _truthy(value: str | None) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes", "si"}


def _feature_contract(raw_value: str | None) -> tuple[str, ...]:
    if raw_value is None:
        raw_value = DEFAULT_FEATURES
    if raw_value.strip().lower() in {"", "0", "false", "no", "none", "off", "disabled"}:
        return ()
    return tuple(item.strip() for item in raw_value.split(",") if item.strip())


def _expected_commit() -> str:
    return (
        os.getenv("BETTERP_DEPLOY_COMMIT", "").strip()
        or os.getenv("GITHUB_SHA", "").strip()
        or os.getenv("CF_PAGES_COMMIT_SHA", "").strip()
    )


def _served_commit(body: dict[str, Any], headers) -> str:
    deployment = body.get("deployment") or {}
    commit = ""
    if isinstance(deployment, dict):
        commit = str(
            deployment.get("git_commit")
            or deployment.get("git_commit_short")
            or ""
        ).strip()
    return commit or str(headers.get("X-BettERP-API-Commit") or "").strip()


def _check_contract(
    *,
    body: dict[str, Any],
    headers,
    features: tuple[str, ...],
    expected_commit: str,
    require_commit: bool,
) -> tuple[bool, str]:
    if body.get("status") != "ok":
        return False, f"health status no-ok: {str(body)[:240]}"

    exposed_features = body.get("features") or {}
    missing_features = [
        feature
        for feature in features
        if not isinstance(exposed_features, dict) or not exposed_features.get(feature)
    ]
    if missing_features:
        return False, f"faltan features: {', '.join(missing_features)}"

    expected_short = expected_commit[:7]
    if expected_short:
        served = _served_commit(body, headers)
        served_short = served[:7]
        if served_short and served_short != expected_short:
            return False, f"commit servido {served_short}, esperado {expected_short}"
        if require_commit and not served_short:
            return False, "health no expone commit servido"
        if served_short:
            return True, f"features OK; commit OK {served_short}"
        return True, "features OK; commit no expuesto"

    return True, "features OK"


def _fetch_health(url: str, *, timeout: float, user_agent: str) -> tuple[int, dict[str, Any], Any]:
    request = Request(url, headers={"Accept": "application/json", "User-Agent": user_agent})
    with urlopen(request, timeout=timeout) as response:
        raw = response.read().decode("utf-8", errors="replace")
        return response.status, json.loads(raw or "{}"), response.headers


def wait_for_contract(args: argparse.Namespace) -> int:
    features = _feature_contract(os.getenv("BETTERP_SMOKE_REQUIRED_BACKEND_FEATURES"))
    expected_commit = args.commit or _expected_commit()
    require_commit = args.require_commit or _truthy(os.getenv("BETTERP_SMOKE_REQUIRE_DEPLOY_COMMIT"))
    deadline = time.monotonic() + args.timeout
    attempt = 0
    last_detail = "sin intentos"

    while True:
        attempt += 1
        try:
            status, body, headers = _fetch_health(
                args.health_url,
                timeout=args.request_timeout,
                user_agent=args.user_agent,
            )
            if status != 200 or not isinstance(body, dict):
                ok = False
                detail = f"health HTTP {status}: {str(body)[:240]}"
            else:
                ok, detail = _check_contract(
                    body=body,
                    headers=headers,
                    features=features,
                    expected_commit=expected_commit,
                    require_commit=require_commit,
                )
        except HTTPError as exc:
            ok = False
            detail = f"health HTTP {exc.code}"
        except (URLError, TimeoutError, json.JSONDecodeError, RuntimeError) as exc:
            ok = False
            detail = str(exc)[:240]

        last_detail = detail
        marker = "OK" if ok else "WAIT"
        print(f"[{marker}] intento {attempt}: {detail}")
        if ok:
            return 0

        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        time.sleep(min(args.interval, remaining))

    print(
        f"Backend no publico el contrato esperado antes de {args.timeout:.0f}s: {last_detail}",
        file=sys.stderr,
    )
    return 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Espera a que health publique features/commit del backend desplegado.",
    )
    parser.add_argument(
        "--health-url",
        default=os.getenv("BETTERP_HEALTH_URL", DEFAULT_HEALTH_URL),
        help="URL publica de health. Default: BETTERP_HEALTH_URL o api.betterp.net/.",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=float(os.getenv("BETTERP_DEPLOY_WAIT_SECONDS", "600")),
        help="Segundos maximos de espera.",
    )
    parser.add_argument(
        "--interval",
        type=float,
        default=float(os.getenv("BETTERP_DEPLOY_WAIT_INTERVAL", "15")),
        help="Segundos entre intentos.",
    )
    parser.add_argument(
        "--request-timeout",
        type=float,
        default=float(os.getenv("BETTERP_SMOKE_TIMEOUT", "25")),
        help="Timeout por request HTTP.",
    )
    parser.add_argument(
        "--commit",
        default="",
        help="Commit esperado. Default: BETTERP_DEPLOY_COMMIT, GITHUB_SHA o CF_PAGES_COMMIT_SHA.",
    )
    parser.add_argument(
        "--require-commit",
        action="store_true",
        help="Falla mientras health no exponga el commit servido.",
    )
    parser.add_argument(
        "--user-agent",
        default=os.getenv("BETTERP_SMOKE_USER_AGENT", DEFAULT_USER_AGENT),
    )
    return parser


def main() -> int:
    return wait_for_contract(build_parser().parse_args())


if __name__ == "__main__":
    raise SystemExit(main())
