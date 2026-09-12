import json
from unittest.mock import patch

from django.http import JsonResponse
from django.test import RequestFactory, TestCase, override_settings

from billing.models import BackendRequestMetric
from .health import (
    build_health_payload,
    health_response,
    reset_api_warmup_state_for_tests,
    warmup_response,
)
from .middleware import RequestMonitoringMiddleware
from .request_observability import classify_http_request
from .urls import api_unhandled_exception


class ApiErrorShapeTests(TestCase):
    def test_unhandled_api_errors_return_json_without_traceback(self):
        request = RequestFactory().get("/api/empresas/lista/")

        response = api_unhandled_exception(request, RuntimeError("database exploded"))

        self.assertEqual(response.status_code, 500)
        self.assertEqual(response["content-type"], "application/json; charset=utf-8")
        self.assertIn(b"No se pudo procesar la solicitud", response.content)
        self.assertNotIn(b"database exploded", response.content)


class RequestMonitoringMiddlewareTests(TestCase):
    def setUp(self):
        reset_api_warmup_state_for_tests()

    def tearDown(self):
        reset_api_warmup_state_for_tests()

    @override_settings(HEALTH_API_WARMUP_ENABLED=False)
    def test_health_response_can_be_used_as_url_view(self):
        request = RequestFactory().get("/")

        response = health_response(request)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Cache-Control"], "no-store")
        self.assertEqual(response["X-BettERP-API-Warmup"], "disabled")
        self.assertIn(b'"service": "BettERP API"', response.content)
        body = json.loads(response.content.decode("utf-8"))
        self.assertTrue(body["features"]["crm_portal_link"])
        self.assertIn("deployment", body)

    @override_settings(HEALTH_API_WARMUP_ENABLED=False)
    def test_health_exposes_deployment_metadata_when_available(self):
        request = RequestFactory().get("/health/")

        with patch.dict(
            "os.environ",
            {
                "RENDER": "true",
                "RENDER_GIT_COMMIT": "abcdef1234567890",
                "RENDER_SERVICE_ID": "srv-test",
            },
            clear=False,
        ):
            payload = build_health_payload()
            response = health_response(request)

        body = json.loads(response.content.decode("utf-8"))
        self.assertEqual(payload["deployment"]["git_commit_short"], "abcdef1")
        self.assertEqual(body["deployment"]["git_commit_short"], "abcdef1")
        self.assertEqual(body["deployment"]["deploy_id"], "srv-test")
        self.assertEqual(body["deployment"]["platform"], "render")
        self.assertEqual(body["deployment"]["runtime"], "render")
        self.assertEqual(body["deployment"]["log_backend"], "render")
        self.assertEqual(response["X-BettERP-API-Commit"], "abcdef1")

    @override_settings(HEALTH_API_WARMUP_ENABLED=False, APP_ENV="production")
    def test_health_exposes_vultr_release_and_safe_log_metadata(self):
        with patch.dict(
            "os.environ",
            {
                "BETTERP_GIT_COMMIT": "1234567890abcdef",
                "BETTERP_DEPLOY_ID": "20260806T010000Z-betterp-1234567890ab",
                "BETTERP_PLATFORM": "vultr",
                "BETTERP_RUNTIME": "docker",
                "BETTERP_LOG_BACKEND": "docker-json-file",
                "BETTERP_LOG_LOCATION": "docker compose logs betterp-api",
            },
            clear=False,
        ):
            body = build_health_payload()

        deployment = body["deployment"]
        self.assertEqual(deployment["git_commit_short"], "1234567")
        self.assertEqual(deployment["platform"], "vultr")
        self.assertEqual(deployment["runtime"], "docker")
        self.assertEqual(deployment["log_backend"], "docker-json-file")
        self.assertEqual(
            deployment["log_location"],
            "docker compose logs betterp-api",
        )
        self.assertFalse(deployment["render"])

    @override_settings(HEALTH_API_WARMUP_ENABLED=False)
    def test_health_path_returns_before_url_resolution(self):
        called = False

        def get_response(request):
            nonlocal called
            called = True
            raise AssertionError("health should not reach URL resolution")

        middleware = RequestMonitoringMiddleware(get_response)
        request = RequestFactory().get(
            "/health/",
            HTTP_X_REQUEST_ID="health-req-123",
        )

        response = middleware(request)

        self.assertFalse(called)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["X-Request-ID"], "health-req-123")
        self.assertEqual(response["Cache-Control"], "no-store")
        self.assertIn(b'"status": "ok"', response.content)

    @override_settings(HEALTH_API_WARMUP_ENABLED=False)
    def test_warmup_response_exposes_warmup_state(self):
        request = RequestFactory().get("/api/warmup/")

        response = warmup_response(request)
        body = json.loads(response.content.decode("utf-8"))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["X-BettERP-API-Warmup"], "disabled")
        self.assertEqual(body["status"], "ok")
        self.assertIn("warmup", body)

    @override_settings(HEALTH_API_WARMUP_ENABLED=True)
    @patch("core.health.threading.Thread")
    def test_health_schedules_api_warmup_once(self, thread_mock):
        request = RequestFactory().get("/health/")

        first_response = health_response(request)
        second_response = health_response(request)

        self.assertEqual(first_response["X-BettERP-API-Warmup"], "scheduled")
        self.assertEqual(second_response["X-BettERP-API-Warmup"], "running")
        thread_mock.assert_called_once()
        thread_mock.return_value.start.assert_called_once()

    def test_adds_request_id_header_and_logs_structured_payload(self):
        def get_response(request):
            return JsonResponse({"ok": True})

        middleware = RequestMonitoringMiddleware(get_response)
        request = RequestFactory().get(
            "/api/health-test/",
            HTTP_X_REQUEST_ID="req-test-123",
            REMOTE_ADDR="127.0.0.1",
        )

        with self.assertLogs("betterp.requests", level="INFO") as logs:
            response = middleware(request)

        self.assertEqual(response["X-Request-ID"], "req-test-123")
        self.assertIn('"event":"http_request"', logs.output[0])
        self.assertIn('"request_id":"req-test-123"', logs.output[0])
        self.assertIn('"path":"/api/health-test/"', logs.output[0])
        self.assertIn('"classification":"success"', logs.output[0])

    def test_classifies_expected_denials_and_exploratory_404_without_warning(self):
        for status_code, path, classification in (
            (401, "/api/billing/admin/salud/", "access_denied"),
            (403, "/api/marketing/", "access_denied"),
            (404, "/.env", "exploratory_not_found"),
            (404, "/api/productos/999/", "not_found"),
        ):
            middleware = RequestMonitoringMiddleware(
                lambda request, status_code=status_code: JsonResponse(
                    {"detail": "blocked"},
                    status=status_code,
                )
            )
            request = RequestFactory().get(path)
            with self.assertLogs("betterp.requests", level="INFO") as logs:
                middleware(request)
            self.assertIn(
                f'"classification":"{classification}"',
                logs.output[0],
            )
            self.assertTrue(logs.output[0].startswith("INFO:"))

    def test_classifies_server_error_as_incident(self):
        middleware = RequestMonitoringMiddleware(
            lambda request: JsonResponse({"detail": "failed"}, status=503)
        )
        request = RequestFactory().get("/api/failing/")

        with self.assertLogs("betterp.requests", level="ERROR") as logs:
            middleware(request)

        self.assertIn('"classification":"server_error"', logs.output[0])
        metric = BackendRequestMetric.objects.get(path="/api/failing/")
        self.assertEqual(metric.metadata["classification"], "server_error")

    def test_classification_helper_keeps_non_exploratory_404_separate(self):
        self.assertEqual(
            classify_http_request(status_code=404, path="/wp-admin/setup.php"),
            "exploratory_not_found",
        )
        self.assertEqual(
            classify_http_request(status_code=404, path="/api/clientes/404/"),
            "not_found",
        )

    @override_settings(REQUEST_METRICS_ENABLED=True, REQUEST_METRICS_SLOW_MS=0)
    def test_persists_slow_request_metric_without_sensitive_payload(self):
        def get_response(request):
            request.performance_timings_ms = {"login.total": 12, "login.password_auth": 8}
            return JsonResponse({"ok": True})

        middleware = RequestMonitoringMiddleware(get_response)
        request = RequestFactory().post(
            "/api/accounts/auth/login/",
            {"password": "secret123"},
            HTTP_X_REQUEST_ID="slow-req-123",
            REMOTE_ADDR="127.0.0.1",
        )

        response = middleware(request)

        self.assertEqual(response.status_code, 200)
        metric = BackendRequestMetric.objects.get(request_id="slow-req-123")
        self.assertEqual(metric.path, "/api/accounts/auth/login/")
        self.assertEqual(metric.metadata["timings_ms"]["login.password_auth"], 8)
        self.assertNotIn("password", metric.metadata)
