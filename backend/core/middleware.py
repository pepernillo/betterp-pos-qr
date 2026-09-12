from __future__ import annotations

import json
import logging
import time
import uuid

from django.conf import settings

from .health import health_response, is_health_path
from .request_observability import classify_http_request


request_logger = logging.getLogger("betterp.requests")


class RequestMonitoringMiddleware:
    """Emit compact structured request logs for production monitoring."""

    def __init__(self, get_response):
        self.get_response = get_response
        self.enabled = getattr(settings, "REQUEST_LOGGING_ENABLED", True)
        self.slow_ms = int(getattr(settings, "REQUEST_LOGGING_SLOW_MS", 1500))
        self.metrics_enabled = getattr(settings, "REQUEST_METRICS_ENABLED", True)
        self.metrics_slow_ms = int(getattr(settings, "REQUEST_METRICS_SLOW_MS", self.slow_ms))

    def __call__(self, request):
        request_id = request.headers.get("X-Request-ID") or uuid.uuid4().hex
        request.request_id = request_id
        started = time.monotonic()
        response = None
        error = None
        try:
            if is_health_path(request.path):
                response = health_response()
                return response
            response = self.get_response(request)
            return response
        except Exception as exc:
            error = exc
            raise
        finally:
            duration_ms = int((time.monotonic() - started) * 1000)
            if response is not None:
                response["X-Request-ID"] = request_id
            if not self._skip_path(request.path):
                if self.enabled:
                    self._log_request(request, response, request_id, duration_ms, error)
                else:
                    status_code = getattr(response, "status_code", 500 if error else None)
                    if self._should_capture_metric(status_code, duration_ms):
                        self._capture_request_metric(
                            request=request,
                            request_id=request_id,
                            status_code=status_code,
                            duration_ms=duration_ms,
                            error=error,
                        )

    def _skip_path(self, path: str) -> bool:
        return is_health_path(path) or path.startswith("/static/")

    def _log_request(self, request, response, request_id: str, duration_ms: int, error):
        status_code = getattr(response, "status_code", 500 if error else None)
        classification = classify_http_request(
            status_code=status_code,
            path=request.path,
        )
        payload = {
            "event": "http_request",
            "request_id": request_id,
            "method": request.method,
            "path": request.path,
            "status": status_code,
            "duration_ms": duration_ms,
            "slow": duration_ms >= self.slow_ms,
            "classification": classification,
            "user_id": getattr(getattr(request, "user", None), "id", None),
            "remote_addr": self._remote_addr(request),
        }
        if error:
            payload["error"] = error.__class__.__name__

        if self._should_capture_metric(status_code, duration_ms):
            self._capture_request_metric(
                request=request,
                request_id=request_id,
                status_code=status_code,
                duration_ms=duration_ms,
                error=error,
            )

        message = json.dumps(payload, default=str, separators=(",", ":"))
        if error or classification == "server_error":
            request_logger.error(message)
        elif duration_ms >= self.slow_ms or classification == "client_error":
            request_logger.warning(message)
        else:
            request_logger.info(message)

    def _should_capture_metric(self, status_code: int | None, duration_ms: int) -> bool:
        if not self.metrics_enabled:
            return False
        return duration_ms >= self.metrics_slow_ms or (
            status_code is not None and status_code >= 400
        )

    def _capture_request_metric(
        self,
        *,
        request,
        request_id: str,
        status_code: int | None,
        duration_ms: int,
        error,
    ) -> None:
        try:
            from billing.models import BackendRequestMetric

            metadata = {
                "slow": duration_ms >= self.metrics_slow_ms,
                "threshold_ms": self.metrics_slow_ms,
                "classification": classify_http_request(
                    status_code=status_code,
                    path=request.path,
                ),
            }
            timings = getattr(request, "performance_timings_ms", None)
            if isinstance(timings, dict) and timings:
                metadata["timings_ms"] = {
                    str(key): int(value)
                    for key, value in timings.items()
                    if isinstance(value, (int, float))
                }
            if error:
                metadata["error"] = error.__class__.__name__
            if request.META.get("QUERY_STRING"):
                metadata["query_string_present"] = True

            BackendRequestMetric.objects.create(
                method=str(request.method or "")[:10],
                path=str(request.path or "")[:240],
                status_code=status_code or 0,
                duration_ms=max(duration_ms, 0),
                request_id=request_id[:64],
                user_id=self._user_id(request),
                remote_addr=self._remote_addr(request)[:64],
                metadata=metadata,
            )
        except Exception:
            request_logger.debug("request_metric_capture_failed", exc_info=True)

    def _remote_addr(self, request) -> str:
        forwarded_for = request.META.get("HTTP_X_FORWARDED_FOR", "")
        if forwarded_for:
            return forwarded_for.split(",", 1)[0].strip()
        return request.META.get("REMOTE_ADDR", "")

    def _user_id(self, request) -> int | None:
        auth_user = getattr(getattr(request, "auth", None), "user", None)
        if getattr(auth_user, "id", None):
            return auth_user.id
        user = getattr(request, "user", None)
        if getattr(user, "id", None):
            return user.id
        return None
