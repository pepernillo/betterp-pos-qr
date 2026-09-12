import hashlib
import hmac
import json
import io
import os
import tempfile
from datetime import date, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse
from unittest.mock import patch
from zoneinfo import ZoneInfo

from django.contrib.auth.models import User
from django.core import mail
from django.core import signing
from django.core.management import call_command
from django.core.management.base import CommandError
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone
from ninja.errors import HttpError

from accounts.models import MembresiaCapaNegocio
from accounts.models import EventoAuditoria
from accounts.security import (
    AuthContext,
    PLAN_OVERRIDE_METADATA_KEY,
    plan_has_feature,
    require_plan_feature,
    require_plan_module,
)
from accounts.test_utils import create_api_auth_context
from comunicaciones.models import (
    ConfiguracionComunicacion,
    HistorialEnvio,
    PlantillaMensaje,
    ReglaAutomatizacionMensaje,
    WebhookEntrante,
)
from crm.models import Cliente
from empresas.models import BackupCapaExport, CapaNegocio, EntidadNegocio
from catalogo.models import (
    Bodega,
    CalidadIncidencia,
    InventarioItem,
    Orden,
    Producto,
)

from .api import STRIPE_LIVE_PLAN_CHANGE_CONFIRMATION, build_plan_change_preview
from .background_jobs import enqueue_background_job, run_due_jobs, run_job_by_id
from .emails import send_checkout_registration_email, send_purchase_confirmation_email
from .models import (
    BackgroundJob,
    BackendRequestMetric,
    CambioPlanSaaS,
    CronRunLog,
    CostoOperativoSaaS,
    EventoBilling,
    FrontendWebVitalMetric,
    GoLiveApproval,
    PlanSaaS,
    Solucion,
    ProspectoComercial,
    SuscripcionCapa,
)
from .services import (
    build_customer_health_map,
    build_usage_statement,
    ensure_default_plans,
    get_default_plan,
    serialize_subscription,
)


class BackgroundJobQueueTests(TestCase):
    def test_run_due_jobs_marks_noop_success(self):
        job = enqueue_background_job(
            kind="noop",
            payload={"source": "test"},
            max_attempts=1,
        )

        summary = run_due_jobs(limit=1, worker_id="test-worker")

        self.assertEqual(summary["claimed"], 1)
        self.assertEqual(summary["success"], 1)
        job.refresh_from_db()
        self.assertEqual(job.status, "SUCCESS")
        self.assertEqual(job.attempts, 1)
        self.assertEqual(job.locked_by, "test-worker")
        self.assertEqual(job.result["payload"], {"source": "test"})
        self.assertIsNotNone(job.finished_at)

    def test_run_due_jobs_records_unknown_kind_error(self):
        job = enqueue_background_job(kind="unknown.kind", max_attempts=1)

        summary = run_due_jobs(limit=1, worker_id="test-worker")

        self.assertEqual(summary["claimed"], 1)
        self.assertEqual(summary["error"], 1)
        job.refresh_from_db()
        self.assertEqual(job.status, "ERROR")
        self.assertIn("Tipo de job no soportado", job.error)
        self.assertIsNotNone(job.finished_at)

    def test_failed_job_can_retry_when_attempts_remain(self):
        job = enqueue_background_job(kind="unknown.kind", max_attempts=2)

        summary = run_due_jobs(limit=1, worker_id="test-worker")

        self.assertEqual(summary["pending_retry"], 1)
        job.refresh_from_db()
        self.assertEqual(job.status, "PENDING")
        self.assertEqual(job.attempts, 1)
        self.assertIsNone(job.finished_at)

    def test_run_background_jobs_command_records_heartbeat(self):
        enqueue_background_job(kind="noop", payload={"source": "command"})

        call_command(
            "run_background_jobs",
            "--once",
            "--limit",
            "1",
            "--worker-id",
            "test-worker",
        )

        run = CronRunLog.objects.get(key="background_worker_default")
        self.assertEqual(run.status, "SUCCESS")
        self.assertIn("last_heartbeat", run.metadata)
        self.assertEqual(run.metadata["worker_id"], "test-worker")
        self.assertEqual(run.metadata["last_summary"]["success"], 1)

    def test_background_jobs_health_warns_without_worker_heartbeat(self):
        BackgroundJob.objects.create(
            kind="noop",
            status="PENDING",
            available_at=timezone.now() - timedelta(minutes=5),
        )
        CronRunLog.objects.create(
            key="background_worker_default",
            name="Background worker default",
            status="RUNNING",
            metadata={
                "worker_id": "old-worker",
                "last_heartbeat": (timezone.now() - timedelta(minutes=30)).isoformat(),
            },
        )

        from .api import build_background_jobs_summary

        summary = build_background_jobs_summary(
            now=timezone.now(),
            since_24h=timezone.now() - timedelta(hours=24),
        )

        self.assertEqual(summary["pendientes_vencidos"], 1)
        self.assertEqual(summary["worker"]["status"], "WARN")

    @patch("billing.management.commands.api_keepalive.urlopen")
    def test_api_keepalive_command_records_cron_success(self, urlopen_mock):
        class FakeResponse:
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return False

            def read(self, limit=-1):
                return b'{"status":"ok"}'

        urlopen_mock.side_effect = [FakeResponse(), FakeResponse()]
        output = io.StringIO()

        call_command(
            "api_keepalive",
            "--health-url",
            "https://api.test/health/",
            "--warmup-url",
            "https://api.test/api/warmup/",
            "--app-url",
            "",
            stdout=output,
        )

        run = CronRunLog.objects.get(key="api_keepalive")
        self.assertEqual(run.status, "SUCCESS")
        self.assertEqual(run.metadata["ok"], 2)
        self.assertEqual(run.metadata["failures"], 0)
        self.assertIn("api_health", output.getvalue())


class BillingSubscriptionSerializerTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="billing-owner@test.local",
            email="billing-owner@test.local",
            password="secret123",
        )
        self.capa = CapaNegocio.objects.create(
            nombre="Billing Test",
            tipo_capa="OPERADORA",
            usuario_fundador=self.user,
        )
        self.membership = MembresiaCapaNegocio.objects.create(
            user=self.user,
            capa_negocio=self.capa,
            rol="OWNER_ADMIN",
            activo=True,
        )
        self.plan = PlanSaaS.objects.create(
            clave="billing-growth",
            nombre="Growth",
            precio_mensual=2499,
            precio_anual=24990,
            activo=True,
            modulos_habilitados=["dashboard", "clientes"],
            funciones_habilitadas=["batch_import"],
        )

    def test_active_subscription_exposes_next_payment_window(self):
        today = timezone.localdate()
        subscription = SuscripcionCapa.objects.create(
            capa_negocio=self.capa,
            plan=self.plan,
            estatus="ACTIVA",
            periodicidad="MENSUAL",
            fecha_inicio=today - timedelta(days=10),
            fecha_fin_periodo_actual=today + timedelta(days=20),
            auto_renueva=True,
        )

        body = serialize_subscription(subscription)

        self.assertEqual(body["periodo_dias_totales"], 30)
        self.assertEqual(body["periodo_dias_restantes"], 20)
        self.assertEqual(body["siguiente_pago_dias_restantes"], 20)
        self.assertEqual(body["fecha_siguiente_pago"], today + timedelta(days=20))
        self.assertFalse(body["periodo_actual_vencido"])

    def test_trial_keeps_trial_days_separate_from_next_payment(self):
        today = timezone.localdate()
        subscription = SuscripcionCapa.objects.create(
            capa_negocio=self.capa,
            plan=self.plan,
            estatus="TRIAL",
            periodicidad="MENSUAL",
            fecha_inicio=today,
            fecha_fin_periodo_actual=today + timedelta(days=7),
            auto_renueva=True,
        )

        body = serialize_subscription(subscription)

        self.assertTrue(body["trial_activo"])
        self.assertEqual(body["trial_dias_restantes"], 7)
        self.assertEqual(body["periodo_dias_restantes"], 7)
        self.assertIsNone(body["fecha_siguiente_pago"])
        self.assertIsNone(body["siguiente_pago_dias_restantes"])

    def test_subscription_capability_overrides_adjust_effective_plan(self):
        subscription = SuscripcionCapa.objects.create(
            capa_negocio=self.capa,
            plan=self.plan,
            estatus="ACTIVA",
            metadata={
                PLAN_OVERRIDE_METADATA_KEY: {
                    "modulos_agregados": ["reportes"],
                    "modulos_bloqueados": ["clientes"],
                    "funciones_agregadas": ["whatsapp_automation"],
                    "funciones_bloqueadas": ["batch_import"],
                    "nota": "Ajuste comercial temporal.",
                }
            },
        )

        body = serialize_subscription(subscription)

        self.assertEqual(
            body["effective_plan"]["modulos_habilitados"],
            ["dashboard", "reportes"],
        )
        self.assertEqual(
            body["effective_plan"]["funciones_habilitadas"],
            ["whatsapp_automation"],
        )
        self.assertEqual(
            body["plan_capability_overrides"]["nota"],
            "Ajuste comercial temporal.",
        )
        entitlements = body["effective_entitlements"]
        modules_by_key = {item["clave"]: item for item in entitlements["modules"]}
        features_by_key = {item["clave"]: item for item in entitlements["features"]}
        self.assertEqual(entitlements["modules_count"], 2)
        self.assertEqual(entitlements["features_count"], 1)
        self.assertTrue(entitlements["has_overrides"])
        self.assertEqual(modules_by_key["dashboard"]["source"], "PLAN")
        self.assertTrue(modules_by_key["dashboard"]["enabled"])
        self.assertEqual(modules_by_key["reportes"]["source"], "EXTRA")
        self.assertTrue(modules_by_key["reportes"]["enabled"])
        self.assertEqual(modules_by_key["clientes"]["source"], "BLOCKED")
        self.assertFalse(modules_by_key["clientes"]["enabled"])
        self.assertEqual(features_by_key["whatsapp_automation"]["source"], "EXTRA")
        self.assertEqual(features_by_key["batch_import"]["source"], "BLOCKED")

    def test_plan_enforcement_respects_subscription_capability_overrides(self):
        SuscripcionCapa.objects.create(
            capa_negocio=self.capa,
            plan=self.plan,
            estatus="ACTIVA",
            metadata={
                PLAN_OVERRIDE_METADATA_KEY: {
                    "modulos_agregados": ["reportes"],
                    "modulos_bloqueados": ["clientes"],
                    "funciones_agregadas": ["whatsapp_automation"],
                    "funciones_bloqueadas": ["batch_import"],
                }
            },
        )
        request = SimpleNamespace(
            auth=AuthContext(
                user=self.user,
                session=SimpleNamespace(),
                memberships=[self.membership],
                current_membership=self.membership,
            )
        )

        require_plan_module(request, "reportes")
        require_plan_feature(request, "whatsapp_automation")
        self.assertTrue(plan_has_feature(request, "whatsapp_automation"))
        self.assertFalse(plan_has_feature(request, "batch_import"))
        with self.assertRaises(HttpError):
            require_plan_module(request, "clientes")

    @override_settings(
        EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
        DEFAULT_FROM_EMAIL="no-reply@betterp.test",
        FRONTEND_BASE_URL="https://app.test",
        BETTERP_MARKETING_BASE_URL="https://betterp.test",
    )
    def test_registration_and_purchase_emails_are_separate_branded_flows(self):
        registration_subscription = SuscripcionCapa.objects.create(
            capa_negocio=self.capa,
            plan=self.plan,
            estatus="PENDIENTE",
            periodicidad="MENSUAL",
        )

        sent_registration = send_checkout_registration_email(
            registration_subscription.id,
            user_id=self.user.id,
        )

        self.assertTrue(sent_registration)
        registration_subscription.refresh_from_db()
        self.assertIn(
            "checkout_registration_email_sent_at",
            registration_subscription.metadata,
        )
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(
            mail.outbox[0].subject,
            "Tu cuenta BetterP esta lista para completar el pago",
        )
        self.assertIn("CUENTA BETTERP", mail.outbox[0].alternatives[0][0])
        self.assertIn("El acceso operativo queda pausado", mail.outbox[0].body)

        registration_subscription.estatus = "ACTIVA"
        registration_subscription.fecha_fin_periodo_actual = (
            timezone.localdate() + timedelta(days=30)
        )
        registration_subscription.metadata = {}
        registration_subscription.save(
            update_fields=[
                "estatus",
                "fecha_fin_periodo_actual",
                "metadata",
                "fecha_actualizacion",
            ]
        )

        sent_purchase = send_purchase_confirmation_email(registration_subscription.id)

        self.assertTrue(sent_purchase)
        registration_subscription.refresh_from_db()
        self.assertIn(
            "purchase_confirmation_email_sent_at",
            registration_subscription.metadata,
        )
        purchase_email = next(
            item
            for item in mail.outbox
            if item.subject == "Pago recibido: BetterP Growth esta activo"
        )
        self.assertIn("PAGO RECIBIDO", purchase_email.alternatives[0][0])
        self.assertIn("No sustituye un CFDI", purchase_email.body)




class BillingStripeCheckoutE2ETests(TestCase):
    def setUp(self):
        self.user, self.capa, self.auth_headers = create_api_auth_context(
            email="stripe-checkout@test.local",
            capa_name="Stripe Checkout",
        )
        self.solution, _ = Solucion.objects.update_or_create(
            clave="tienda_facil",
            defaults={
                "nombre": "BetterP Commerce",
                "estatus": "ACTIVA",
                "tipo": "HIBRIDA",
            },
        )
        self.plan, _ = PlanSaaS.objects.update_or_create(
            clave="tienda_growth",
            defaults={
                "nombre": "BetterP Commerce Growth E2E",
                "solution": self.solution,
                "precio_mensual": 3000,
                "precio_anual": 30000,
                "activo": True,
                "max_usuarios": 10,
                "max_entidades": 3,
                "max_productos": 2500,
                "stripe_test_price_id_mensual": "price_test_growth_month",
                "stripe_test_price_id_anual": "price_test_growth_year",
            },
        )
        self.subscription = SuscripcionCapa.objects.create(
            capa_negocio=self.capa,
            plan=self.plan,
            estatus="PENDIENTE_PAGO",
            periodicidad="MENSUAL",
            auto_renueva=False,
        )


    def _post_signed_stripe_event(self, event: dict, webhook_secret: str):
        payload = json.dumps(event, separators=(",", ":")).encode("utf-8")
        timestamp = "1785974400"
        signature = hmac.new(
            webhook_secret.encode("utf-8"),
            f"{timestamp}.{payload.decode('utf-8')}".encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        return self.client.post(
            "/api/billing/webhooks/stripe/",
            data=payload,
            content_type="application/json",
            HTTP_STRIPE_SIGNATURE=f"t={timestamp},v1={signature}",
        )



class BillingStripeWebhookIdempotencyTests(TestCase):
    def setUp(self):
        self.user, self.capa, self.auth_headers = create_api_auth_context(
            email="stripe-webhook@test.local",
            capa_name="Stripe Webhook",
        )
        self.plan = PlanSaaS.objects.create(
            clave="stripe-webhook-growth",
            nombre="Stripe Webhook Growth",
            precio_mensual=3000,
            precio_anual=30000,
            activo=True,
        )
        self.subscription = SuscripcionCapa.objects.create(
            capa_negocio=self.capa,
            plan=self.plan,
            estatus="PAST_DUE",
            periodicidad="MENSUAL",
            stripe_customer_id="cus_webhook",
            stripe_subscription_id="sub_webhook",
        )

    def _invoice_paid_payload(self, event_id: str = "evt_invoice_paid_once") -> dict:
        return {
            "id": event_id,
            "type": "invoice.payment_succeeded",
            "data": {
                "object": {
                    "id": "in_webhook_paid",
                    "subscription": "sub_webhook",
                    "customer": "cus_webhook",
                    "amount_paid": 3000,
                }
            },
        }

    def test_stripe_webhook_duplicate_event_is_idempotent(self):
        payload = self._invoice_paid_payload()

        first_response = self.client.post(
            "/api/billing/webhooks/stripe/",
            data=json.dumps(payload),
            content_type="application/json",
        )
        second_response = self.client.post(
            "/api/billing/webhooks/stripe/",
            data=json.dumps(payload),
            content_type="application/json",
        )

        self.assertEqual(first_response.status_code, 200)
        self.assertEqual(second_response.status_code, 200)
        self.assertTrue(second_response.json()["duplicate"])
        self.subscription.refresh_from_db()
        self.assertEqual(self.subscription.estatus, "ACTIVA")
        self.assertEqual(
            EventoBilling.objects.filter(
                proveedor="STRIPE",
                referencia_externa="evt_invoice_paid_once",
                tipo_evento="invoice.payment_succeeded",
            ).count(),
            1,
        )

    def test_stripe_webhook_retries_when_previous_event_failed(self):
        EventoBilling.objects.create(
            capa_negocio=self.capa,
            suscripcion_relacionada=self.subscription,
            proveedor="STRIPE",
            tipo_evento="invoice.payment_succeeded",
            referencia_externa="evt_retry_after_error",
            estatus="ERROR",
            detalle_error="Timeout interno",
        )

        response = self.client.post(
            "/api/billing/webhooks/stripe/",
            data=json.dumps(self._invoice_paid_payload("evt_retry_after_error")),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertNotIn("duplicate", response.json())
        self.assertEqual(
            EventoBilling.objects.filter(
                proveedor="STRIPE",
                referencia_externa="evt_retry_after_error",
            ).count(),
            2,
        )
        self.assertTrue(
            EventoBilling.objects.filter(
                proveedor="STRIPE",
                referencia_externa="evt_retry_after_error",
                estatus="PROCESADO",
            ).exists()
        )


@override_settings(OPENAI_API_KEY="")
class BillingBackofficeSummaryTests(TestCase):
    def setUp(self):
        self.user, self.capa, self.auth_headers = create_api_auth_context(
            email="platform-admin@test.local",
            capa_name="Platform Admin",
            is_superuser=True,
        )
        self.plan = PlanSaaS.objects.create(
            clave="backoffice-growth",
            nombre="Backoffice Growth",
            precio_mensual=2000,
            precio_anual=20000,
            activo=True,
            modulos_habilitados=["dashboard", "clientes"],
        )




























































    def test_admin_can_exclude_and_restore_prospect_from_learning(self):
        prospect = ProspectoComercial.objects.create(
            nombre="Lead de prueba manual",
            email="lead@example.com",
            etapa="NUEVO",
        )

        exclude_response = self.client.patch(
            f"/api/billing/admin/prospectos/{prospect.id}/",
            data=json.dumps(
                {
                    "etapa": "NUEVO",
                    "excluded_from_learning": True,
                }
            ),
            content_type="application/json",
            **self.auth_headers,
        )

        self.assertEqual(exclude_response.status_code, 200)
        self.assertTrue(exclude_response.json()["excluded_from_learning"])
        prospect.refresh_from_db()
        self.assertTrue(prospect.metadata["excluded_from_learning"])

        restore_response = self.client.patch(
            f"/api/billing/admin/prospectos/{prospect.id}/",
            data=json.dumps(
                {
                    "etapa": "NUEVO",
                    "excluded_from_learning": False,
                }
            ),
            content_type="application/json",
            **self.auth_headers,
        )

        self.assertEqual(restore_response.status_code, 200)
        self.assertFalse(restore_response.json()["excluded_from_learning"])



























    def test_solution_launch_does_not_route_cancelled_catalogo_subscription(self):
        ensure_default_plans()
        plan = PlanSaaS.objects.select_related("solution").get(clave="pos_negocio")
        SuscripcionCapa.objects.create(
            capa_negocio=self.capa,
            plan=plan,
            estatus="CANCELADA",
            periodicidad="MENSUAL",
            metadata={
                "catalogo_sync": {
                    "status": "OK",
                    "account_external_id": f"betterp-capa-{self.capa.id}",
                }
            },
        )

        response = self.client.get("/api/billing/solution-launch/catalogo/", **self.auth_headers)

        self.assertEqual(response.status_code, 404)






    def test_admin_subscription_capability_overrides_require_note(self):
        subscription = SuscripcionCapa.objects.create(
            capa_negocio=self.capa,
            plan=self.plan,
            estatus="ACTIVA",
            periodicidad="MENSUAL",
        )

        response = self.client.patch(
            f"/api/billing/admin/suscripciones/{subscription.id}/capabilities/",
            data=json.dumps(
                {
                    "modulos_agregados": ["reportes"],
                    "modulos_bloqueados": [],
                    "funciones_agregadas": [],
                    "funciones_bloqueadas": [],
                    "nota": "",
                }
            ),
            content_type="application/json",
            **self.auth_headers,
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("nota interna", response.json()["detail"])

        response = self.client.patch(
            f"/api/billing/admin/suscripciones/{subscription.id}/capabilities/",
            data=json.dumps(
                {
                    "modulos_agregados": ["reportes"],
                    "modulos_bloqueados": [],
                    "funciones_agregadas": [],
                    "funciones_bloqueadas": [],
                    "nota": "Piloto comercial temporal.",
                }
            ),
            content_type="application/json",
            **self.auth_headers,
        )

        self.assertEqual(response.status_code, 200)
        subscription.refresh_from_db()
        self.assertEqual(
            subscription.metadata[PLAN_OVERRIDE_METADATA_KEY]["nota"],
            "Piloto comercial temporal.",
        )
        self.assertEqual(
            subscription.metadata[PLAN_OVERRIDE_METADATA_KEY]["actualizado_por"],
            "platform-admin@test.local",
        )
        commercial_audit = response.json()["subscription"]["commercial_audit"]
        self.assertEqual(commercial_audit["status"], "WARN")
        self.assertEqual(commercial_audit["active_overrides"], 1)
        self.assertGreaterEqual(commercial_audit["override_changes"], 1)
        self.assertEqual(commercial_audit["last_override_by"], "platform-admin@test.local")
        self.assertTrue(
            EventoBilling.objects.filter(
                suscripcion_relacionada=subscription,
                proveedor="BACKOFFICE",
                tipo_evento="subscription.capabilities.updated",
            ).exists()
        )


    def test_usage_statement_counts_only_successful_outbound_messages(self):
        self.plan.whatsapp_mensajes_incluidos = 10
        self.plan.emails_incluidos = 10
        self.plan.save(update_fields=["whatsapp_mensajes_incluidos", "emails_incluidos"])
        SuscripcionCapa.objects.create(
            capa_negocio=self.capa,
            plan=self.plan,
            estatus="ACTIVA",
            periodicidad="MENSUAL",
        )
        entidad = EntidadNegocio.objects.create(
            capa_negocio=self.capa,
            nombre_comercial="Entidad consumo",
        )
        cliente = Cliente.objects.create(
            entidad_relacionada=entidad,
            razon_social="Cliente Consumo",
            telefono="5512345678",
            correo_principal="cliente-consumo@test.local",
        )
        config = ConfiguracionComunicacion.objects.create(
            capa_negocio=self.capa,
            clave="PRINCIPAL",
        )
        plantilla = PlantillaMensaje.objects.create(
            capa_negocio=self.capa,
            nombre="Consumo WhatsApp",
            canal="WHATSAPP",
            cuerpo="Hola",
            activo=True,
        )
        for status in ["ENVIADO", "ERROR", "OMITIDO"]:
            HistorialEnvio.objects.create(
                configuracion_relacionada=config,
                cliente_relacionado=cliente,
                entidad_relacionada=entidad,
                plantilla_usada=plantilla,
                canal="WHATSAPP",
                tipo_envio="AUTOMATICO",
                proveedor="META_CLOUD_API",
                destinatario="525512345678",
                cuerpo_renderizado="Hola",
                estatus=status,
            )
        HistorialEnvio.objects.create(
            configuracion_relacionada=config,
            cliente_relacionado=cliente,
            entidad_relacionada=entidad,
            plantilla_usada=plantilla,
            canal="EMAIL",
            tipo_envio="AUTOMATICO",
            proveedor="RESEND",
            destinatario="cliente-consumo@test.local",
            cuerpo_renderizado="Hola",
            estatus="LEIDO",
        )

        statement = build_usage_statement(self.capa)
        by_category = {item["categoria"]: item for item in statement["resumen"]}

        self.assertEqual(by_category["WHATSAPP_OUTBOUND"]["consumido"], 1)
        self.assertEqual(by_category["EMAIL_OUTBOUND"]["consumido"], 1)

    def test_admin_customers_exposes_account_status_summary(self):
        self.plan.whatsapp_mensajes_incluidos = 1
        self.plan.precio_whatsapp_mensaje_extra = Decimal("2.00")
        self.plan.save(
            update_fields=[
                "whatsapp_mensajes_incluidos",
                "precio_whatsapp_mensaje_extra",
            ]
        )
        subscription = SuscripcionCapa.objects.create(
            capa_negocio=self.capa,
            plan=self.plan,
            estatus="ACTIVA",
            periodicidad="MENSUAL",
        )
        entidad = EntidadNegocio.objects.create(
            capa_negocio=self.capa,
            nombre_comercial="Entidad estado cuenta",
        )
        cliente = Cliente.objects.create(
            entidad_relacionada=entidad,
            razon_social="Cliente Estado Cuenta",
            telefono="5512345678",
            correo_principal="estado-cuenta@test.local",
        )
        config = ConfiguracionComunicacion.objects.create(
            capa_negocio=self.capa,
            clave="ESTADO_CUENTA",
        )
        plantilla = PlantillaMensaje.objects.create(
            capa_negocio=self.capa,
            nombre="Consumo Estado Cuenta",
            canal="WHATSAPP",
            cuerpo="Hola",
            activo=True,
        )
        for index in range(2):
            HistorialEnvio.objects.create(
                configuracion_relacionada=config,
                cliente_relacionado=cliente,
                entidad_relacionada=entidad,
                plantilla_usada=plantilla,
                canal="WHATSAPP",
                tipo_envio="AUTOMATICO",
                proveedor="META_CLOUD_API",
                destinatario=f"52551234567{index}",
                cuerpo_renderizado="Hola",
                estatus="ENVIADO",
            )

        response = self.client.get("/api/billing/admin/clientes/", **self.auth_headers)

        self.assertEqual(response.status_code, 200)
        body = response.json()
        item = next(row for row in body["items"] if row["id"] == subscription.id)
        account_status = item["account_status"]
        self.assertEqual(body["estado_cuenta_clientes"]["clientes_con_extras"], 1)
        self.assertEqual(body["estado_cuenta_clientes"]["extras_estimados_periodo"], 2.0)
        self.assertEqual(account_status["estado"], "ATENCION")
        self.assertEqual(account_status["mrr_estimado"], 2000.0)
        self.assertEqual(account_status["cargo_base_periodo"], 2000.0)
        self.assertEqual(account_status["extras_estimados_periodo"], 2.0)
        self.assertEqual(account_status["total_estimado_periodo"], 2002.0)
        self.assertEqual(account_status["alertas_consumo"], 1)
        self.assertEqual(account_status["rubros_excedidos"], ["WHATSAPP_OUTBOUND"])
        self.assertIn("upgrade", account_status["accion_recomendada"].lower())





    def test_admin_customers_exposes_customer_health_signals(self):
        subscription = SuscripcionCapa.objects.create(
            capa_negocio=self.capa,
            plan=self.plan,
            estatus="PAST_DUE",
            periodicidad="MENSUAL",
        )
        BackupCapaExport.objects.create(
            capa_negocio=self.capa,
            archivo_nombre="backup-error.xlsx",
            estatus="ERROR",
            detalle_error="R2 timeout",
        )
        EventoBilling.objects.create(
            capa_negocio=self.capa,
            suscripcion_relacionada=subscription,
            proveedor="STRIPE",
            tipo_evento="invoice.payment_failed",
            estatus="ERROR",
            detalle_error="Pago fallido",
        )
        EventoAuditoria.objects.create(
            actor=self.user,
            capa_negocio=self.capa,
            accion="ACCESO_DENEGADO",
            recurso_tipo="Permiso",
            recurso_id="auditoria",
        )
        EventoAuditoria.objects.create(
            actor=self.user,
            capa_negocio=self.capa,
            accion="PLAN_MODULO_DENEGADO",
            recurso_tipo="PlanSaaS",
            recurso_id=str(self.plan.id),
        )

        response = self.client.get("/api/billing/admin/clientes/", **self.auth_headers)

        self.assertEqual(response.status_code, 200)
        body = response.json()
        item = next(row for row in body["items"] if row["id"] == subscription.id)
        self.assertEqual(body["salud_clientes"]["error"], 1)
        self.assertEqual(body["salud_clientes"]["friccion_acceso_7d"], 1)
        self.assertEqual(item["health"]["status"], "ERROR")
        self.assertLess(item["health"]["score"], 100)
        issue_codes = {issue["code"] for issue in item["health"]["issues"]}
        self.assertIn("subscription_past_due", issue_codes)
        self.assertIn("backup_error", issue_codes)
        self.assertIn("permission_denials", issue_codes)
        self.assertIn("plan_capability_denials", issue_codes)
        domains = {domain["key"]: domain for domain in item["health"]["domains"]}
        self.assertEqual(domains["billing"]["status"], "ERROR")
        self.assertEqual(domains["backups"]["status"], "ERROR")
        self.assertEqual(domains["permisos"]["status"], "WARN")
        self.assertIn("billing", item["health"]["risk_domains"])
        self.assertEqual(item["health"]["primary_owner"], "Billing")
        issue_by_code = {issue["code"]: issue for issue in item["health"]["issues"]}
        self.assertEqual(issue_by_code["backup_error"]["domain"], "backups")
        self.assertEqual(issue_by_code["permission_denials"]["owner"], "Soporte")
        self.assertEqual(item["health"]["activity_events_14d"], 2)
        self.assertEqual(item["health"]["billing_errors_30d"], 1)
        self.assertEqual(item["health"]["access_denials_7d"], 1)
        self.assertEqual(item["health"]["plan_denials_7d"], 1)
        self.assertEqual(item["health"]["last_backup"]["estatus"], "ERROR")

    def test_admin_customers_exposes_go_live_status(self):
        subscription = SuscripcionCapa.objects.create(
            capa_negocio=self.capa,
            plan=self.plan,
            estatus="ACTIVA",
            periodicidad="MENSUAL",
        )
        GoLiveApproval.objects.create(
            capa_negocio=self.capa,
            estatus="APROBADO_CON_PENDIENTES",
            responsable_betterp="Operaciones BetterP",
            responsable_cliente="Cliente Responsable",
            smoke_previo="workflow-123",
            backup_referencia="backup-r2-123",
            backup_restore_validado=True,
            post_go_live_dia_1_validado=True,
            post_go_live_notas="Primer dia sin incidentes criticos.",
            post_go_live_tarea_estado="EN_PROCESO",
            post_go_live_responsable="Soporte BetterP",
            post_go_live_fecha_objetivo=timezone.localdate() + timedelta(days=6),
            post_go_live_prioridad="ALTA",
            pendientes="Activar automatizacion WhatsApp despues de la sesion.",
            aprobado_por=self.user,
            fecha_aprobacion=timezone.now(),
        )

        response = self.client.get("/api/billing/admin/clientes/", **self.auth_headers)

        self.assertEqual(response.status_code, 200)
        item = next(row for row in response.json()["items"] if row["id"] == subscription.id)
        self.assertEqual(item["go_live"]["estatus"], "APROBADO_CON_PENDIENTES")
        self.assertTrue(item["go_live"]["ready_for_handoff"])
        self.assertEqual(item["go_live"]["responsable_cliente"], "Cliente Responsable")
        self.assertTrue(item["go_live"]["post_go_live_dia_1_validado"])
        self.assertFalse(item["go_live"]["post_go_live_dia_7_validado"])
        self.assertEqual(item["go_live"]["post_go_live_notas"], "Primer dia sin incidentes criticos.")
        self.assertEqual(item["go_live"]["post_go_live_tarea_estado"], "EN_PROCESO")
        self.assertEqual(item["go_live"]["post_go_live_responsable"], "Soporte BetterP")

    def test_admin_can_update_customer_go_live_approval(self):
        subscription = SuscripcionCapa.objects.create(
            capa_negocio=self.capa,
            plan=self.plan,
            estatus="ACTIVA",
            periodicidad="MENSUAL",
        )
        payload = {
            "estatus": "APROBADO",
            "fecha_go_live": timezone.localdate().isoformat(),
            "responsable_betterp": "Ops BetterP",
            "responsable_cliente": "Admin Cliente",
            "smoke_previo": "Production Smoke #123",
            "smoke_posterior": "Production Smoke #124",
            "backup_referencia": "backup-r2-abc",
            "backup_restore_validado": True,
            "automatizaciones_activas": True,
            "post_go_live_dia_1_validado": True,
            "post_go_live_dia_7_validado": True,
            "post_go_live_notas": "Cliente estable en primera semana.",
            "post_go_live_tarea_estado": "CERRADA",
            "post_go_live_responsable": "Ops BetterP",
            "post_go_live_fecha_objetivo": timezone.localdate().isoformat(),
            "post_go_live_prioridad": "ALTA",
            "pendientes": "",
            "decision": "Aprobado para primer dia.",
        }

        response = self.client.put(
            f"/api/billing/admin/clientes/{self.capa.id}/go-live/",
            data=json.dumps(payload),
            content_type="application/json",
            **self.auth_headers,
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        approval = GoLiveApproval.objects.get(capa_negocio=self.capa)
        self.assertEqual(approval.estatus, "APROBADO")
        self.assertEqual(approval.aprobado_por_id, self.user.id)
        self.assertTrue(approval.post_go_live_dia_1_validado)
        self.assertTrue(approval.post_go_live_dia_7_validado)
        self.assertIsNotNone(approval.fecha_post_go_live_dia_1)
        self.assertIsNotNone(approval.fecha_post_go_live_dia_7)
        self.assertEqual(approval.post_go_live_tarea_estado, "CERRADA")
        self.assertEqual(approval.post_go_live_responsable, "Ops BetterP")
        self.assertEqual(body["go_live"]["estatus"], "APROBADO")
        self.assertTrue(body["go_live"]["post_go_live_ready"])
        self.assertEqual(body["subscription"]["id"], subscription.id)
        self.assertTrue(body["subscription"]["go_live"]["ready_for_handoff"])
        self.assertTrue(
            EventoAuditoria.objects.filter(
                capa_negocio=self.capa,
                accion="BACKOFFICE_GO_LIVE_ACTUALIZADO",
            ).exists()
        )



    def test_admin_go_live_allows_catalogo_warning_with_pending_status(self):
        ensure_default_plans()
        plan = PlanSaaS.objects.select_related("solution").get(clave="pos_negocio")
        SuscripcionCapa.objects.create(
            capa_negocio=self.capa,
            plan=plan,
            estatus="ACTIVA",
            periodicidad="MENSUAL",
            metadata={
                "catalogo_sync": {
                    "status": "OK",
                    "account_external_id": f"betterp-capa-{self.capa.id}",
                    "synced_at": timezone.now().isoformat(),
                },
                "catalogo_legacy_adoption": {
                    "status": "APPLIED",
                    "dry_run": False,
                    "ran_at": timezone.now().isoformat(),
                },
            },
        )
        Producto.objects.create(
            capa_negocio=self.capa,
            internal_sku="GO-LIVE-PENDING",
            nombre="Producto pendiente inventario",
            precio_base=Decimal("350.00"),
        )
        payload = {
            "estatus": "APROBADO_CON_PENDIENTES",
            "fecha_go_live": timezone.localdate().isoformat(),
            "pendientes": "Completar stock inicial antes de ampliar catalogo.",
            "decision": "Piloto controlado con pendiente de inventario.",
        }

        response = self.client.put(
            f"/api/billing/admin/clientes/{self.capa.id}/go-live/",
            data=json.dumps(payload),
            content_type="application/json",
            **self.auth_headers,
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        approval = GoLiveApproval.objects.get(capa_negocio=self.capa)
        self.assertEqual(approval.estatus, "APROBADO_CON_PENDIENTES")
        self.assertEqual(body["catalogo_readiness"]["status"], "WARN")
        self.assertEqual(
            approval.metadata["catalogo_go_live_readiness"]["status"],
            "WARN",
        )

    def test_admin_go_live_approval_requires_evidence(self):
        SuscripcionCapa.objects.create(
            capa_negocio=self.capa,
            plan=self.plan,
            estatus="ACTIVA",
            periodicidad="MENSUAL",
        )

        response = self.client.put(
            f"/api/billing/admin/clientes/{self.capa.id}/go-live/",
            data=json.dumps(
                {
                    "estatus": "APROBADO",
                    "responsable_betterp": "Ops BetterP",
                    "responsable_cliente": "Admin Cliente",
                    "backup_restore_validado": False,
                }
            ),
            content_type="application/json",
            **self.auth_headers,
        )

        self.assertEqual(response.status_code, 400)
        self.assertFalse(GoLiveApproval.objects.filter(capa_negocio=self.capa).exists())

    def test_admin_health_flags_active_customers_without_go_live_closure(self):
        SuscripcionCapa.objects.create(
            capa_negocio=self.capa,
            plan=self.plan,
            estatus="ACTIVA",
            periodicidad="MENSUAL",
        )

        response = self.client.get("/api/billing/admin/salud/", **self.auth_headers)

        self.assertEqual(response.status_code, 200)
        body = response.json()
        go_live = body["go_live_customers"]
        self.assertEqual(go_live["status"], "WARN")
        self.assertEqual(go_live["total"], 1)
        self.assertEqual(go_live["activos"], 1)
        self.assertEqual(go_live["active_without_closure"], 1)
        self.assertEqual(go_live["pending"], 1)
        self.assertEqual(go_live["items"][0]["capa_id"], self.capa.id)
        self.assertTrue(
            any(alert["titulo"] == "Clientes activos sin go-live" for alert in body["alerts"])
        )

    def test_admin_health_flags_post_go_live_followup_pending(self):
        SuscripcionCapa.objects.create(
            capa_negocio=self.capa,
            plan=self.plan,
            estatus="ACTIVA",
            periodicidad="MENSUAL",
        )
        GoLiveApproval.objects.create(
            capa_negocio=self.capa,
            estatus="APROBADO",
            responsable_betterp="Ops BetterP",
            responsable_cliente="Admin Cliente",
            smoke_previo="Production Smoke #123",
            backup_referencia="backup-r2-abc",
            backup_restore_validado=True,
            post_go_live_tarea_estado="ABIERTA",
            post_go_live_responsable="Soporte BetterP",
            post_go_live_fecha_objetivo=timezone.localdate() - timedelta(days=1),
            post_go_live_prioridad="CRITICA",
            aprobado_por=self.user,
            fecha_aprobacion=timezone.now(),
        )

        response = self.client.get("/api/billing/admin/salud/", **self.auth_headers)

        self.assertEqual(response.status_code, 200)
        body = response.json()
        go_live = body["go_live_customers"]
        self.assertEqual(go_live["status"], "WARN")
        self.assertEqual(go_live["post_go_live_pending"], 1)
        self.assertEqual(go_live["post_go_live_open"], 1)
        self.assertEqual(go_live["post_go_live_overdue"], 1)
        self.assertFalse(go_live["items"][0]["post_go_live_ready"])
        self.assertTrue(go_live["items"][0]["post_go_live_overdue"])
        self.assertEqual(go_live["items"][0]["post_go_live_responsable"], "Soporte BetterP")
        self.assertTrue(
            any(alert["titulo"] == "Seguimiento post go-live vencido" for alert in body["alerts"])
        )

    def test_admin_health_separates_real_incidents_from_expected_http_signals(self):
        for status_code, path in (
            (503, "/api/orders/provider-timeout/"),
            (403, "/api/billing/admin/salud/"),
            (401, "/api/accounts/me/"),
            (404, "/.env"),
            (404, "/api/productos/999/"),
            (422, "/api/productos/"),
        ):
            BackendRequestMetric.objects.create(
                method="GET",
                path=path,
                status_code=status_code,
                duration_ms=25,
                metadata={},
            )

        response = self.client.get("/api/billing/admin/salud/", **self.auth_headers)

        self.assertEqual(response.status_code, 200)
        body = response.json()
        requests_summary = body["backend_requests"]
        self.assertEqual(requests_summary["errors_24h"], 1)
        self.assertEqual(requests_summary["server_errors_24h"], 1)
        self.assertEqual(requests_summary["access_denied_24h"], 2)
        self.assertEqual(requests_summary["not_found_24h"], 2)
        self.assertEqual(requests_summary["exploratory_404_24h"], 1)
        self.assertEqual(requests_summary["application_404_24h"], 1)
        self.assertEqual(requests_summary["client_errors_24h"], 1)
        recent_by_path = {
            item["path"]: item["classification"]
            for item in requests_summary["recent"]
        }
        self.assertEqual(
            recent_by_path["/api/orders/provider-timeout/"],
            "server_error",
        )
        self.assertEqual(recent_by_path["/.env"], "exploratory_not_found")
        self.assertEqual(recent_by_path["/api/productos/999/"], "not_found")
        incident_alerts = [
            alert
            for alert in body["alerts"]
            if alert["titulo"] == "Incidentes backend 5xx"
        ]
        self.assertEqual(len(incident_alerts), 1)
        self.assertIn("1 respuesta(s) 5xx", incident_alerts[0]["detalle"])

    def test_admin_health_does_not_raise_platform_alert_for_denials_or_scans(self):
        for status_code, path in (
            (403, "/api/billing/admin/salud/"),
            (401, "/api/accounts/me/"),
            (404, "/wp-admin/setup.php"),
            (404, "/api/productos/999/"),
        ):
            BackendRequestMetric.objects.create(
                method="GET",
                path=path,
                status_code=status_code,
                duration_ms=25,
                metadata={},
            )

        response = self.client.get("/api/billing/admin/salud/", **self.auth_headers)

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["backend_requests"]["errors_24h"], 0)
        self.assertFalse(
            any(
                alert["titulo"] == "Incidentes backend 5xx"
                for alert in body["alerts"]
            )
        )


    @override_settings(
        BETTERP_OPERATIONS_NOTIFY_EMAIL="ops@betterp.test",
        RESEND_API_KEY="",
        EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
        DEFAULT_FROM_EMAIL="no-reply@betterp.test",
    )
    def test_post_go_live_task_report_command_emails_and_exposes_health(self):
        SuscripcionCapa.objects.create(
            capa_negocio=self.capa,
            plan=self.plan,
            estatus="ACTIVA",
            periodicidad="MENSUAL",
        )
        GoLiveApproval.objects.create(
            capa_negocio=self.capa,
            estatus="APROBADO",
            responsable_betterp="Ops BetterP",
            responsable_cliente="Admin Cliente",
            smoke_previo="Production Smoke #123",
            backup_referencia="backup-r2-abc",
            backup_restore_validado=True,
            post_go_live_tarea_estado="ABIERTA",
            post_go_live_responsable="Soporte BetterP",
            post_go_live_fecha_objetivo=timezone.localdate() - timedelta(days=2),
            post_go_live_prioridad="CRITICA",
            aprobado_por=self.user,
            fecha_aprobacion=timezone.now(),
        )

        call_command("report_post_go_live_tasks")

        run = CronRunLog.objects.get(key="post_go_live_tasks_report")
        self.assertEqual(run.status, "SUCCESS")
        self.assertEqual(run.metadata["open"], 1)
        self.assertEqual(run.metadata["overdue"], 1)
        self.assertTrue(run.metadata["email_sent"])
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn("Tareas post go-live", mail.outbox[0].subject)
        self.assertIn("Soporte BetterP", mail.outbox[0].body)

        response = self.client.get("/api/billing/admin/salud/", **self.auth_headers)

        self.assertEqual(response.status_code, 200)
        report = response.json()["post_go_live_report"]
        self.assertEqual(report["status"], "OK")
        self.assertEqual(report["open"], 1)
        self.assertEqual(report["overdue"], 1)
        self.assertTrue(report["report_receiver_configured"])
        self.assertEqual(report["latest_run"]["status"], "SUCCESS")

    def test_customer_health_uses_latest_backup_per_customer(self):
        subscription = SuscripcionCapa.objects.create(
            capa_negocio=self.capa,
            plan=self.plan,
            estatus="ACTIVA",
            periodicidad="MENSUAL",
        )
        older_backup = BackupCapaExport.objects.create(
            capa_negocio=self.capa,
            archivo_nombre="backup-old.xlsx",
            estatus="ERROR",
            detalle_error="Error anterior",
        )
        latest_backup = BackupCapaExport.objects.create(
            capa_negocio=self.capa,
            archivo_nombre="backup-latest.xlsx",
            estatus="COMPLETADO",
        )
        BackupCapaExport.objects.filter(id=older_backup.id).update(
            fecha_creacion=timezone.now() - timedelta(days=5)
        )
        BackupCapaExport.objects.filter(id=latest_backup.id).update(
            fecha_creacion=timezone.now()
        )
        subscription = SuscripcionCapa.objects.select_related("capa_negocio", "plan").get(
            id=subscription.id
        )

        with self.assertNumQueries(3):
            health = build_customer_health_map(
                [subscription],
                subscription_usage_map={
                    self.capa.id: {
                        "usuarios_activos": 0,
                        "entidades_activas": 0,
                        "espacios_activos": 0,
                    }
                },
            )

        self.assertEqual(health[self.capa.id]["last_backup"]["id"], latest_backup.id)
        self.assertNotIn(
            "backup_error",
            {issue["code"] for issue in health[self.capa.id]["issues"]},
        )









    @override_settings(SMOKE_REPORT_TOKEN="smoke-secret")
    def test_admin_health_exposes_operational_signals(self):
        BackupCapaExport.objects.create(
            capa_negocio=self.capa,
            archivo_nombre="backup-error.xlsx",
            estatus="ERROR",
            detalle_error="R2 timeout",
        )
        WebhookEntrante.objects.create(
            proveedor="META_CLOUD_API",
            payload_completo={"entry": []},
            estatus_procesamiento="ERROR",
            error_procesamiento="Firma invalida",
        )
        EventoBilling.objects.create(
            capa_negocio=self.capa,
            proveedor="STRIPE",
            tipo_evento="invoice.payment_failed",
            estatus="ERROR",
            detalle_error="Pago fallido",
        )
        FrontendWebVitalMetric.objects.create(
            metric_id="lcp-health",
            name="LCP",
            value=2500,
            rating="needs-improvement",
            path="/dashboard",
        )
        BackendRequestMetric.objects.create(
            method="POST",
            path="/api/accounts/auth/login/",
            status_code=200,
            duration_ms=3200,
            request_id="req-login-slow",
            metadata={
                "timings_ms": {
                    "login.password_auth": 1800,
                    "login.payload_build": 220,
                    "login.session_create": 120,
                    "login.total": 3200,
                }
            },
        )
        entidad = EntidadNegocio.objects.create(
            capa_negocio=self.capa,
            nombre_comercial="Maya Coliving",
            tipo_fecha_corte="INDIVIDUAL",
        )
        cliente = Cliente.objects.create(
            entidad_relacionada=entidad,
            razon_social="Daniel Muller",
            nombre_comercial="Daniel",
            correo_principal="daniel@test.local",
        )
        config = ConfiguracionComunicacion.objects.create(capa_negocio=self.capa)
        template = PlantillaMensaje.objects.create(
            capa_negocio=self.capa,
            nombre="Recordatorio pago",
            canal="WHATSAPP",
            tipo_plantilla="RECORDATORIO_PAGO",
            cuerpo="Pago pendiente",
        )
        rule = ReglaAutomatizacionMensaje.objects.create(
            configuracion_relacionada=config,
            plantilla_relacionada=template,
            nombre="Vencido",
            segmento="VENCIDA_CON_RECARGO",
        )
        HistorialEnvio.objects.create(
            configuracion_relacionada=config,
            cliente_relacionado=cliente,
            entidad_relacionada=entidad,
            plantilla_usada=template,
            automatizacion_relacionada=rule,
            canal="WHATSAPP",
            tipo_envio="AUTOMATICO",
            proveedor="META_CLOUD_API",
            destinatario="5512345678",
            estatus="ERROR",
            metadata={"error": "Meta rechazo plantilla"},
        )
        CronRunLog.objects.create(
            key="scheduled_capa_backups",
            name="Backups automaticos por plan",
            status="SUCCESS",
            started_at=timezone.now() - timedelta(minutes=5),
            finished_at=timezone.now() - timedelta(minutes=4),
            duration_ms=1200,
            summary="Programados: 1 | Creados: 1 | Duplicados: 0",
        )
        CronRunLog.objects.create(
            key="production_smoke",
            name="Smoke produccion",
            status="SUCCESS",
            started_at=timezone.now() - timedelta(minutes=20),
            finished_at=timezone.now() - timedelta(minutes=19),
            duration_ms=9000,
            summary="OK 29/29 | fallas=0 | duracion=9000ms",
            metadata={
                "total": 29,
                "failures": 0,
                "deploy_commit": "abcdef1234567890",
                "workflow": "Production Smoke",
                "slowest_checks": [],
                "failed_checks": [],
            },
        )

        with patch.dict(
            os.environ,
            {
                "RENDER": "true",
                "RENDER_GIT_COMMIT": "abcdef1234567890",
                "RENDER_SERVICE_ID": "srv-health",
            },
        ):
            response = self.client.get("/api/billing/admin/salud/", **self.auth_headers)

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["status"], "ERROR")
        self.assertEqual(body["backups"]["errores"], 1)
        self.assertEqual(body["webhooks"]["errores"], 1)
        self.assertEqual(body["billing"]["errores_24h"], 1)
        self.assertEqual(body["web_vitals"]["total"], 1)
        self.assertEqual(body["web_vitals"]["metrics"][0]["name"], "LCP")
        self.assertEqual(body["backend_requests"]["total_24h"], 1)
        self.assertEqual(body["backend_requests"]["slow_24h"], 1)
        self.assertEqual(
            body["backend_requests"]["routes"][0]["path"],
            "/api/accounts/auth/login/",
        )
        self.assertEqual(
            body["backend_requests"]["recent"][0]["timings_ms"]["login.password_auth"],
            1800,
        )
        self.assertEqual(body["backend_requests"]["login_timings"]["sample_size"], 1)
        self.assertEqual(body["backend_deployment"]["git_commit_short"], "abcdef1")
        self.assertEqual(body["backend_deployment"]["deploy_id"], "srv-health")
        self.assertTrue(body["backend_deployment"]["features"]["crm_portal_link"])
        self.assertEqual(body["backend_deployment"]["status"], "OK")
        self.assertEqual(body["smoke_deploy"]["status"], "OK")
        self.assertTrue(body["smoke_deploy"]["report_receiver_configured"])
        self.assertEqual(body["smoke_deploy"]["items"][0]["last_run"]["failures"], 0)
        self.assertEqual(body["go_live_readiness"]["status"], "ERROR")
        self.assertGreater(body["go_live_readiness"]["blockers"], 0)
        readiness_by_key = {
            item["key"]: item
            for item in body["go_live_readiness"]["items"]
        }
        self.assertEqual(readiness_by_key["backend_contract"]["status"], "OK")
        self.assertEqual(readiness_by_key["smoke_evidence"]["status"], "OK")
        self.assertEqual(readiness_by_key["webhook_billing"]["status"], "ERROR")
        login_timing_items = {
            item["key"]: item
            for item in body["backend_requests"]["login_timings"]["items"]
        }
        self.assertEqual(login_timing_items["login.total"]["max_ms"], 3200)
        self.assertEqual(login_timing_items["login.payload_build"]["avg_ms"], 220)
        self.assertEqual(body["crons"]["total"], 6)
        self.assertEqual(body["crons"]["missing"], 6)
        self.assertEqual(body["crons"]["stale"], 0)
        self.assertTrue(body["crons"]["items"])
        crons_by_key = {item["key"]: item for item in body["crons"]["items"]}
        self.assertIn(
            "scheduled_plan_changes",
            crons_by_key,
        )
        self.assertIn(
            "post_go_live_tasks_report",
            crons_by_key,
        )
        self.assertIn("backoffice_marketing_publish_queue", crons_by_key)
        self.assertIn("backoffice_tiktok_publication_sync", crons_by_key)
        self.assertIn("backoffice_marketing_metrics_sync", crons_by_key)
        self.assertEqual(crons_by_key["scheduled_plan_changes"]["state"], "MISSING")
        self.assertIn("apply_pending_plan_changes", crons_by_key["scheduled_plan_changes"]["command"])
        self.assertEqual(crons_by_key["trial_expiration"]["schedule"], "Diario 09:20 UTC")
        self.assertEqual(
            crons_by_key["post_go_live_tasks_report"]["command"],
            "python manage.py report_post_go_live_tasks --no-email",
        )
        self.assertEqual(
            crons_by_key["backoffice_tiktok_publication_sync"]["schedule"],
            "Cada 5 minutos, desplazado dos minutos",
        )
        self.assertNotIn("api_keepalive", crons_by_key)
        self.assertNotIn("backoffice_marketing_weekly_close", crons_by_key)
        self.assertNotIn("scheduled_capa_backups", crons_by_key)
        self.assertTrue(
            all(
                item["command"].startswith("python manage.py")
                for item in body["crons"]["items"]
            )
        )
        self.assertFalse(
            any("\\Scripts\\" in item["command"] for item in body["crons"]["items"])
        )
        self.assertEqual(body["post_go_live_report"]["status"], "WARN")
        self.assertEqual(body["cobranza_automatizada"]["errores_24h"], 1)
        self.assertEqual(body["cobranza_automatizada"]["recent"][0]["cliente"], "Daniel Muller")
        self.assertTrue(body["alerts"])

    @override_settings(SMOKE_REPORT_TOKEN="smoke-secret")
    def test_smoke_report_endpoint_records_cron_run(self):
        payload = {
            "ok": False,
            "generated_at": "2026-05-28T12:00:00+00:00",
            "total": 3,
            "failures": 1,
            "api_base": "https://api.example.test/api",
            "app_base": "https://app.example.test",
            "deploy_commit": "abcdef1234567890",
            "source": "production_smoke",
            "workflow": "Production Smoke",
            "total_duration_ms": 1200,
            "failed_checks": [
                {
                    "name": "api health",
                    "ok": False,
                    "status": 200,
                    "duration_ms": 120,
                    "detail": "faltan features",
                }
            ],
            "slowest_checks": [
                {
                    "name": "portal cliente",
                    "ok": True,
                    "status": 200,
                    "duration_ms": 800,
                    "detail": "OK",
                }
            ],
        }

        response = self.client.post(
            "/api/billing/operational/smoke-report/",
            data=json.dumps(payload),
            content_type="application/json",
            HTTP_X_BETTERP_SMOKE_TOKEN="smoke-secret",
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body["accepted"])
        run = CronRunLog.objects.get(key="production_smoke")
        self.assertEqual(run.status, "ERROR")
        self.assertEqual(run.duration_ms, 1200)
        self.assertEqual(run.metadata["failed_checks"][0]["name"], "api health")
        self.assertEqual(body["run"]["failures"], 1)

    @override_settings(
        AWS_ACCESS_KEY_ID="key",
        AWS_SECRET_ACCESS_KEY="secret",
        AWS_S3_ENDPOINT_URL="https://example.r2.cloudflarestorage.com",
        R2_BACKUP_BUCKET_NAME="betterp-storage",
        R2_BACKUP_PREFIX="backups",
    )
    @patch("empresas.backup_storage.boto3.client")
    def test_backoffice_generates_and_lists_customer_backups(self, client_mock):
        SuscripcionCapa.objects.create(
            capa_negocio=self.capa,
            plan=self.plan,
            estatus="ACTIVA",
            periodicidad="MENSUAL",
        )
        s3_client = client_mock.return_value

        response = self.client.post(
            f"/api/billing/admin/clientes/{self.capa.id}/backups/generar/",
            data=json.dumps({"motivo": "Solicitud soporte cliente"}),
            content_type="application/json",
            **self.auth_headers,
        )

        self.assertEqual(response.status_code, 200)
        s3_client.put_object.assert_called_once()
        backup = BackupCapaExport.objects.get(capa_negocio=self.capa)
        self.assertEqual(backup.storage_backend, "R2")
        self.assertEqual(backup.metadata["motivo"], "Solicitud soporte cliente")
        self.assertEqual(backup.generado_por, self.user.email)
        self.assertTrue(
            EventoAuditoria.objects.filter(
                capa_negocio=self.capa,
                accion="BACKOFFICE_BACKUP_CAPA_GENERADO",
            ).exists()
        )

        list_response = self.client.get(
            f"/api/billing/admin/clientes/{self.capa.id}/backups/",
            **self.auth_headers,
        )

        self.assertEqual(list_response.status_code, 200)
        body = list_response.json()
        self.assertEqual(body["capa"]["id"], self.capa.id)
        self.assertEqual(body["items"][0]["id"], backup.id)
        self.assertEqual(body["items"][0]["storage_backend"], "R2")

    @override_settings(
        AWS_ACCESS_KEY_ID="key",
        AWS_SECRET_ACCESS_KEY="secret",
        AWS_S3_ENDPOINT_URL="https://example.r2.cloudflarestorage.com",
        R2_BACKUP_BUCKET_NAME="betterp-storage",
        R2_BACKUP_PREFIX="backups",
    )
    @patch("empresas.backup_storage.boto3.client")
    def test_backoffice_validates_restore_candidate_with_two_steps(self, client_mock):
        s3_client = client_mock.return_value
        SuscripcionCapa.objects.create(
            capa_negocio=self.capa,
            plan=self.plan,
            estatus="ACTIVA",
            periodicidad="MENSUAL",
        )
        create_response = self.client.post(
            f"/api/billing/admin/clientes/{self.capa.id}/backups/generar/",
            data=json.dumps({"motivo": "Previo a soporte"}),
            content_type="application/json",
            **self.auth_headers,
        )
        self.assertEqual(create_response.status_code, 200)
        backup = BackupCapaExport.objects.get(capa_negocio=self.capa)
        uploaded_content = s3_client.put_object.call_args.kwargs["Body"]
        s3_client.get_object.return_value = {"Body": io.BytesIO(uploaded_content)}

        blocked_response = self.client.post(
            f"/api/billing/admin/clientes/{self.capa.id}/backups/{backup.id}/validar-restore/",
            data=json.dumps({"confirmacion": True, "confirmacion_texto": "RESTORE"}),
            content_type="application/json",
            **self.auth_headers,
        )
        self.assertEqual(blocked_response.status_code, 400)

        response = self.client.post(
            f"/api/billing/admin/clientes/{self.capa.id}/backups/{backup.id}/validar-restore/",
            data=json.dumps({
                "confirmacion": True,
                "confirmacion_texto": "VALIDAR RESTORE",
                "motivo": "Ticket soporte 123",
            }),
            content_type="application/json",
            **self.auth_headers,
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertIn("inspeccion", body)
        self.assertTrue(body["inspeccion"]["hojas"])
        backup.refresh_from_db()
        self.assertEqual(backup.metadata["restore_motivo"], "Ticket soporte 123")
        self.assertTrue(
            EventoAuditoria.objects.filter(
                capa_negocio=self.capa,
                accion="BACKOFFICE_BACKUP_RESTORE_VALIDADO",
            ).exists()
        )

