import logging
import os
import threading
import time

from django.conf import settings
from django.http import JsonResponse
from django.urls import get_resolver


HEALTH_PATHS = {"/", "/health/"}
logger = logging.getLogger(__name__)
PUBLIC_API_FEATURES = {
    "crm_portal_link": True,
    "capa_backup_streaming_export": True,
    "request_metrics": True,
}
DEPLOYMENT_ENV_KEYS = {
    "git_commit": (
        "BETTERP_GIT_COMMIT",
        "RENDER_GIT_COMMIT",
        "SOURCE_VERSION",
        "GIT_COMMIT",
        "COMMIT_SHA",
        "CF_PAGES_COMMIT_SHA",
    ),
    "deploy_id": (
        "BETTERP_DEPLOY_ID",
        "RENDER_INSTANCE_ID",
        "RENDER_SERVICE_ID",
        "CF_PAGES_DEPLOYMENT_ID",
    ),
    "platform": ("BETTERP_PLATFORM",),
    "runtime": ("BETTERP_RUNTIME",),
    "log_backend": ("BETTERP_LOG_BACKEND",),
    "log_location": ("BETTERP_LOG_LOCATION",),
}
_warmup_lock = threading.Lock()
_warmup_state = {
    "started": False,
    "ready": False,
    "error": "",
    "duration_ms": None,
}


def is_health_path(path: str) -> bool:
    return path in HEALTH_PATHS


def first_env_value(keys: tuple[str, ...]) -> str:
    for key in keys:
        value = (os.environ.get(key) or "").strip()
        if value:
            return value
    return ""


def safe_deployment_value(value: str, *, max_length: int = 160) -> str:
    return " ".join(str(value or "").split())[:max_length]


def build_deployment_payload() -> dict:
    git_commit = first_env_value(DEPLOYMENT_ENV_KEYS["git_commit"])
    deploy_id = first_env_value(DEPLOYMENT_ENV_KEYS["deploy_id"])
    is_render = bool(os.environ.get("RENDER"))
    is_production = getattr(settings, "APP_ENV", "development") == "production"
    platform = first_env_value(DEPLOYMENT_ENV_KEYS["platform"])
    runtime = first_env_value(DEPLOYMENT_ENV_KEYS["runtime"])
    log_backend = first_env_value(DEPLOYMENT_ENV_KEYS["log_backend"])
    log_location = first_env_value(DEPLOYMENT_ENV_KEYS["log_location"])
    if is_render:
        platform = platform or "render"
        runtime = runtime or "render"
        log_backend = log_backend or "render"
        log_location = log_location or "Render service logs"
    elif not is_production:
        platform = platform or "local"
        runtime = runtime or "django"
        log_backend = log_backend or "python-logging"
        log_location = log_location or "stdout/stderr"
    return {
        "git_commit": git_commit or None,
        "git_commit_short": git_commit[:7] if git_commit else None,
        "deploy_id": deploy_id or None,
        "platform": safe_deployment_value(platform or "unknown", max_length=40),
        "runtime": safe_deployment_value(runtime or "unknown", max_length=60),
        "log_backend": safe_deployment_value(log_backend or "unknown", max_length=60),
        "log_location": safe_deployment_value(log_location or "unknown"),
        "render": is_render,
    }


def build_health_payload() -> dict:
    return {
        "service": "BettERP API",
        "status": "ok",
        "environment": getattr(settings, "APP_ENV", "development"),
        "demo_mode": getattr(settings, "DEMO_MODE", False),
        "deployment": build_deployment_payload(),
        "features": PUBLIC_API_FEATURES,
    }


def get_api_warmup_state() -> dict:
    with _warmup_lock:
        return dict(_warmup_state)


def _warm_api_urlconf() -> None:
    started = time.monotonic()
    try:
        resolver = get_resolver(settings.ROOT_URLCONF)
        list(resolver.url_patterns)
    except Exception as exc:
        logger.exception("No se pudo precalentar la URLConf de BetterP.")
        with _warmup_lock:
            _warmup_state["error"] = str(exc)[:500]
            _warmup_state["started"] = False
            _warmup_state["duration_ms"] = int((time.monotonic() - started) * 1000)
    else:
        with _warmup_lock:
            _warmup_state["ready"] = True
            _warmup_state["error"] = ""
            _warmup_state["duration_ms"] = int((time.monotonic() - started) * 1000)


def schedule_api_warmup() -> str:
    if not getattr(settings, "HEALTH_API_WARMUP_ENABLED", True):
        return "disabled"
    with _warmup_lock:
        if _warmup_state["ready"]:
            return "ready"
        if _warmup_state["started"]:
            return "running"
        _warmup_state["started"] = True
    thread = threading.Thread(
        target=_warm_api_urlconf,
        name="betterp-api-warmup",
        daemon=True,
    )
    thread.start()
    return "scheduled"


def health_response(request=None):
    warmup_status = schedule_api_warmup()
    payload = build_health_payload()
    response = JsonResponse(payload)
    response["Cache-Control"] = "no-store"
    response["X-BettERP-API-Warmup"] = warmup_status
    git_commit_short = payload["deployment"].get("git_commit_short")
    if git_commit_short:
        response["X-BettERP-API-Commit"] = git_commit_short
    return response


def warmup_response(request=None):
    warmup_status = schedule_api_warmup()
    payload = {
        **build_health_payload(),
        "warmup": get_api_warmup_state(),
    }
    response = JsonResponse(payload)
    response["Cache-Control"] = "no-store"
    response["X-BettERP-API-Warmup"] = warmup_status
    git_commit_short = payload["deployment"].get("git_commit_short")
    if git_commit_short:
        response["X-BettERP-API-Commit"] = git_commit_short
    return response


def reset_api_warmup_state_for_tests() -> None:
    with _warmup_lock:
        _warmup_state.update(
            {
                "started": False,
                "ready": False,
                "error": "",
                "duration_ms": None,
            }
        )
