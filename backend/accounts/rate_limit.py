import hashlib

from django.conf import settings
from django.core.cache import cache
from ninja.errors import HttpError


DEFAULT_LIMIT_MESSAGE = (
    "Detectamos demasiados intentos. Espera unos minutos antes de volver a probar."
)


def assert_auth_rate_limit(
    request,
    *,
    scope: str,
    identifier: str = "",
    limit: int | None = None,
    window_seconds: int | None = None,
    message: str = DEFAULT_LIMIT_MESSAGE,
) -> None:
    resolved_limit = int(limit or getattr(settings, "AUTH_RATE_LIMIT_LOGIN_ATTEMPTS", 8))
    keys = _rate_limit_keys(request, scope=scope, identifier=identifier)
    values = cache.get_many(keys)
    for key in keys:
        current = int(values.get(key, 0) or 0)
        if current >= resolved_limit:
            raise HttpError(429, message)


def record_auth_rate_limit_failure(
    request,
    *,
    scope: str,
    identifier: str = "",
    limit: int | None = None,
    window_seconds: int | None = None,
) -> None:
    resolved_limit = int(limit or getattr(settings, "AUTH_RATE_LIMIT_LOGIN_ATTEMPTS", 8))
    resolved_window = int(
        window_seconds or getattr(settings, "AUTH_RATE_LIMIT_LOGIN_WINDOW_SECONDS", 300)
    )
    keys = _rate_limit_keys(request, scope=scope, identifier=identifier)
    values = cache.get_many(keys)
    for key in keys:
        try:
            current = int(values.get(key, 0) or 0)
            if current <= 0:
                cache.set(key, 1, resolved_window)
            elif current < resolved_limit:
                cache.incr(key)
        except Exception:
            cache.set(key, 1, resolved_window)


def clear_auth_rate_limit(request, *, scope: str, identifier: str = "") -> None:
    keys = _rate_limit_keys(request, scope=scope, identifier=identifier)
    if keys:
        cache.delete_many(keys)


def consume_auth_rate_limit(
    request,
    *,
    scope: str,
    identifier: str = "",
    limit: int | None = None,
    window_seconds: int | None = None,
    message: str = DEFAULT_LIMIT_MESSAGE,
) -> None:
    assert_auth_rate_limit(
        request,
        scope=scope,
        identifier=identifier,
        limit=limit,
        window_seconds=window_seconds,
        message=message,
    )
    record_auth_rate_limit_failure(
        request,
        scope=scope,
        identifier=identifier,
        limit=limit,
        window_seconds=window_seconds,
    )


def _rate_limit_keys(request, *, scope: str, identifier: str = "") -> list[str]:
    ip = _client_ip(request)
    buckets = [("ip", ip)]
    normalized_identifier = (identifier or "").strip().lower()
    if normalized_identifier:
        buckets.append(("id", normalized_identifier))
    return [_cache_key(scope, bucket, value) for bucket, value in buckets if value]


def _cache_key(scope: str, bucket: str, value: str) -> str:
    digest = hashlib.sha256(value.encode("utf-8")).hexdigest()[:32]
    safe_scope = "".join(char for char in scope if char.isalnum() or char in {"_", "-"})
    return f"auth-rate:{safe_scope}:{bucket}:{digest}"


def _client_ip(request) -> str:
    meta = getattr(request, "META", {}) or {}
    cf_ip = (meta.get("HTTP_CF_CONNECTING_IP") or "").strip()
    if cf_ip:
        return cf_ip
    forwarded_for = (meta.get("HTTP_X_FORWARDED_FOR") or "").strip()
    if forwarded_for:
        return forwarded_for.split(",", 1)[0].strip()
    real_ip = (meta.get("HTTP_X_REAL_IP") or "").strip()
    if real_ip:
        return real_ip
    return (meta.get("REMOTE_ADDR") or "unknown").strip() or "unknown"
