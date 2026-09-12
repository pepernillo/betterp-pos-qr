import base64
import hashlib
import hmac
import io
import json
import re
import shutil
import tempfile
import time
from datetime import date, datetime, timedelta, timezone as datetime_timezone
from decimal import Decimal
from unittest.mock import patch

import requests
from django.contrib.auth.models import User
from django.core.management import call_command
from django.core.management.base import CommandError
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connection
from django.db.models import Count, Prefetch
from django.test import TestCase, override_settings
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from ninja.errors import HttpError

from accounts.models import EventoAuditoria, MembresiaCapaNegocio
from accounts.security import (
    PLAN_OVERRIDE_METADATA_KEY,
    create_access_session,
    issue_token_pair,
)
from billing.models import CronRunLog, PlanSaaS, SuscripcionCapa
from comunicaciones.api import (
    apply_receipt_analysis_to_evidence,
    build_rule_receipt_analysis,
    build_cxc_candidate_prefetch_queryset,
    process_webhook_safe,
    serialize_caso,
    serialize_caso_detail,
)
from comunicaciones.email_provider import send_email_transport
from comunicaciones.outbound import (
    COLLECTION_CONSENT_REQUIRED_REASON,
    COLLECTION_MESSAGE_COOLDOWN_REASON,
    COLLECTION_NO_CONTACT_REASON,
    build_portal_payload,
    build_portal_token,
    build_preview_items,
    dispatch_preview_items,
    execute_due_automations,
    normalize_whatsapp_destination,
    resolve_recipient_channels,
    send_whatsapp_message,
)
from comunicaciones.models import (
    AcuerdoUsoComunicacion,
    CanalPermitido,
    CanalWhatsappOficial,
    CasoProcesamiento,
    ConfiguracionComunicacion,
    ContactoPruebaWhatsapp,
    EvidenciaPago,
    HistorialEnvio,
    MensajeEntrante,
    PlantillaMensaje,
    PortalOtpChallenge,
    ReglaAutomatizacionMensaje,
    WebhookEntrante,
)
from comunicaciones.outbound_api import hash_portal_session_token, hash_portal_token
from comunicaciones.legal import (
    WHATSAPP_SHARED_NUMBER_AGREEMENT_TITLE,
    WHATSAPP_SHARED_NUMBER_AGREEMENT_TYPE,
    WHATSAPP_SHARED_NUMBER_AGREEMENT_VERSION,
    whatsapp_shared_number_agreement_hash,
)
from crm.models import Cliente
from empresas.models import CapaNegocio, EntidadNegocio, ReglaMarcoNegocio
from facturacion.models import FacturaEmitida
from finanzas.models import CuentaPorCobrar, EventoFinanciero, PagoCuentaPorCobrar, SaldoCliente


TEST_MEDIA_ROOT = tempfile.mkdtemp()
TEST_STORAGES = {
    "default": {
        "BACKEND": "django.core.files.storage.FileSystemStorage",
    },
    "staticfiles": {
        "BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage",
    },
}


@override_settings(
    RESEND_API_KEY="",
    RESEND_FROM_EMAIL="",
    RESEND_FROM_NAME="",
    RESEND_REPLY_TO="",
    RESEND_WEBHOOK_SECRET="",
    PAYMENT_REMINDER_ENFORCE_SEND_WINDOW=False,
    MEDIA_ROOT=TEST_MEDIA_ROOT,
    STORAGES=TEST_STORAGES,
)
class ComunicacionesApiTests(TestCase):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(TEST_MEDIA_ROOT, ignore_errors=True)

    def setUp(self):
        self.capa = CapaNegocio.objects.create(
            nombre="Maya Coliving",
            tipo_capa="OPERADORA",
        )
        self.entidad = EntidadNegocio.objects.create(
            capa_negocio=self.capa,
            nombre_comercial="Maya Coliving",
            ciudad="Merida",
            tipo_fecha_corte="INDIVIDUAL",
        )
        self.cliente = Cliente.objects.create(
            entidad_relacionada=self.entidad,
            razon_social="Daniel Muller",
            nombre_comercial="Daniel Muller",
            rfc="MUVD780315U21",
            telefono="5512345678",
            correo_principal="daniel@test.com",
            dia_corte_individual=5,
        )
        self.user = User.objects.create_user(
            username="admin@maya.test",
            email="admin@maya.test",
            password="secret123",
        )
        MembresiaCapaNegocio.objects.create(
            user=self.user,
            capa_negocio=self.capa,
            rol="OWNER_ADMIN",
            activo=True,
        )
        session = create_access_session(self.user, provider="PASSWORD")
        tokens = issue_token_pair(session)
        self.auth_headers = {
            "HTTP_AUTHORIZATION": f"Bearer {tokens['access_token']}",
            "HTTP_X_BETTERP_CAPA_ID": str(self.capa.id),
        }
        AcuerdoUsoComunicacion.objects.create(
            capa_negocio=self.capa,
            aceptado_por=self.user,
            tipo_acuerdo=WHATSAPP_SHARED_NUMBER_AGREEMENT_TYPE,
            version=WHATSAPP_SHARED_NUMBER_AGREEMENT_VERSION,
            titulo=WHATSAPP_SHARED_NUMBER_AGREEMENT_TITLE,
            texto_hash=whatsapp_shared_number_agreement_hash(),
            metadata={"origen": "test_setup"},
        )

    def activar_plan(self, *, modulos=None, funciones=None):
        plan = PlanSaaS.objects.create(
            clave=f"plan-comunicaciones-{PlanSaaS.objects.count() + 1}",
            nombre="Plan Comunicaciones",
            modulos_habilitados=modulos or [],
            funciones_habilitadas=funciones or [],
        )
        return SuscripcionCapa.objects.create(
            capa_negocio=self.capa,
            plan=plan,
            estatus="ACTIVA",
        )

    def portal_session_headers(self, token: str, cliente: Cliente | None = None):
        cliente = cliente or self.cliente
        session_token = f"test-session-{hashlib.sha256(token.encode()).hexdigest()[:16]}"
        PortalOtpChallenge.objects.create(
            cliente=cliente,
            token_hash=hash_portal_token(token),
            codigo_hash="test-code-hash",
            session_token_hash=hash_portal_session_token(session_token),
            destinatario=cliente.telefono or "5512345678",
            estado="VERIFICADO",
            fecha_expiracion=timezone.now() + timedelta(hours=24),
            fecha_verificacion=timezone.now(),
            metadata={"origen": "test"},
        )
        return {"HTTP_X_PORTAL_SESSION": session_token}

    def activar_sesion_portal(self, token: str, cliente: Cliente | None = None):
        headers = self.portal_session_headers(token, cliente=cliente)
        self.client.defaults.update(headers)
        return headers

    def aceptar_consentimiento_portal(self, token: str):
        headers = self.activar_sesion_portal(token)
        return self.client.post(
            f"/api/comunicaciones/portal/{token}/consentimiento-cobranza/",
            data=json.dumps(
                {
                    "acepta_comunicaciones_cobranza": True,
                    "acepta_actualizacion_contacto": True,
                }
            ),
            content_type="application/json",
            **headers,
        )


    def test_plan_cobranza_sin_whatsapp_bloquea_canales_whatsapp(self):
        self.activar_plan(modulos=["cobranza"], funciones=[])
        CanalWhatsappOficial.objects.create(
            capa_negocio=self.capa,
            nombre="WhatsApp principal",
            display_phone_number="+52 55 1234 5678",
            phone_number_id="phone-no-plan",
            business_account_id="waba-no-plan",
            access_token="token-no-plan",
            estado="CONECTADO",
            es_principal=True,
        )

        config_response = self.client.get(
            "/api/comunicaciones/configuracion/",
            **self.auth_headers,
        )
        self.assertEqual(config_response.status_code, 200)
        config_body = config_response.json()
        self.assertNotIn("whatsapp_cloud", config_body)
        self.assertEqual(config_body["canales_whatsapp"], [])

        response = self.client.post(
            "/api/comunicaciones/configuracion/canales/",
            data=json.dumps(
                {
                    "canal": "GRUPO_WHATSAPP",
                    "nombre": "Grupo cobranza Maya",
                    "identificador_externo": "120363000111222@g.us",
                    "descripcion": "Pagos y comprobantes",
                    "activo": True,
                }
            ),
            content_type="application/json",
            **self.auth_headers,
        )

        self.assertEqual(response.status_code, 403)
        self.assertIn("funcion", response.json()["detail"])

        official_channels_response = self.client.get(
            "/api/comunicaciones/configuracion/whatsapp-cloud/canales/",
            **self.auth_headers,
        )
        self.assertEqual(official_channels_response.status_code, 403)
        self.assertIn("funcion", official_channels_response.json()["detail"])

    def test_overrides_de_plan_controlan_cobranza_y_whatsapp(self):
        subscription = self.activar_plan(
            modulos=["cobranza"],
            funciones=[],
        )
        subscription.metadata = {
            PLAN_OVERRIDE_METADATA_KEY: {
                "funciones_agregadas": ["whatsapp_automation"],
            }
        }
        subscription.save(update_fields=["metadata", "fecha_actualizacion"])

        whatsapp_response = self.client.get(
            "/api/comunicaciones/configuracion/whatsapp-cloud/canales/",
            **self.auth_headers,
        )
        self.assertEqual(whatsapp_response.status_code, 200)

        subscription.metadata = {
            PLAN_OVERRIDE_METADATA_KEY: {
                "modulos_bloqueados": ["cobranza"],
                "funciones_agregadas": ["whatsapp_automation"],
            }
        }
        subscription.save(update_fields=["metadata", "fecha_actualizacion"])

        blocked_template_response = self.client.get(
            "/api/comunicaciones/plantillas/",
            **self.auth_headers,
        )
        self.assertEqual(blocked_template_response.status_code, 403)
        self.assertIn("modulo", blocked_template_response.json()["detail"])

        subscription.metadata = {
            PLAN_OVERRIDE_METADATA_KEY: {
                "funciones_bloqueadas": ["whatsapp_automation"],
            }
        }
        subscription.save(update_fields=["metadata", "fecha_actualizacion"])

        blocked_whatsapp_response = self.client.get(
            "/api/comunicaciones/configuracion/whatsapp-cloud/canales/",
            **self.auth_headers,
        )
        self.assertEqual(blocked_whatsapp_response.status_code, 403)
        self.assertIn("funcion", blocked_whatsapp_response.json()["detail"])

    def test_plantillas_y_reglas_default_de_cobranza_se_crean_inactivas(self):
        templates_response = self.client.get(
            "/api/comunicaciones/plantillas/",
            **self.auth_headers,
        )
        self.assertEqual(templates_response.status_code, 200)
        template_names = {item["nombre"] for item in templates_response.json()}
        self.assertTrue(
            {
                "Antes de vencimiento WhatsApp",
                "Dia de vencimiento WhatsApp",
                "Tres dias despues WhatsApp",
                "Diez dias despues bloqueo WhatsApp",
                "Confirmacion comprobante WhatsApp",
                "Pago parcial recibido WhatsApp",
            }.issubset(template_names)
        )
        templates = {item["nombre"]: item for item in templates_response.json()}
        for template_name in [
            "Antes de vencimiento WhatsApp",
            "Dia de vencimiento WhatsApp",
            "Tres dias despues WhatsApp",
            "Diez dias despues bloqueo WhatsApp",
        ]:
            self.assertIn("{{referencia_pago}}", templates[template_name]["cuerpo"])
            self.assertIn("{{portal_url}}", templates[template_name]["cuerpo"])
            self.assertIn("hacer caso omiso", templates[template_name]["cuerpo"])
            self.assertIn("carga el comprobante", templates[template_name]["cuerpo"])
        payment_ack = templates["Confirmacion comprobante WhatsApp"]
        self.assertEqual(payment_ack["whatsapp_template_name"], "betterp_pago_recibido")
        self.assertEqual(payment_ack["whatsapp_template_category"], "UTILITY")
        self.assertIn("{{portal_url}}", payment_ack["cuerpo"])
        partial_ack = templates["Pago parcial recibido WhatsApp"]
        self.assertEqual(
            partial_ack["whatsapp_template_name"],
            "betterp_pago_parcial_recibido",
        )
        self.assertIn("{{monto_recibido_formato}}", partial_ack["cuerpo"])
        self.assertIn("{{saldo_pendiente_formato}}", partial_ack["cuerpo"])
        due_today = templates["Dia de vencimiento WhatsApp"]
        self.assertIn("{{total_exigible_formato}}", due_today["cuerpo"])
        self.assertNotIn("{{periodo_pago}}", due_today["cuerpo"])

        rules_response = self.client.get(
            "/api/comunicaciones/automatizaciones/",
            **self.auth_headers,
        )

        self.assertEqual(rules_response.status_code, 200)
        rules = {item["nombre"]: item for item in rules_response.json()}
        expected_rules = {
            "Antes de vencimiento": {
                "plantilla_nombre": "Antes de vencimiento WhatsApp",
                "desplazamiento_dias": -3,
                "segmento": "POR_VENCER",
            },
            "Dia de vencimiento": {
                "plantilla_nombre": "Dia de vencimiento WhatsApp",
                "desplazamiento_dias": 0,
                "segmento": "POR_VENCER",
            },
            "Tres dias despues": {
                "plantilla_nombre": "Tres dias despues WhatsApp",
                "desplazamiento_dias": 3,
                "segmento": "EN_GRACIA",
            },
            "Diez dias despues bloqueo": {
                "plantilla_nombre": "Diez dias despues bloqueo WhatsApp",
                "desplazamiento_dias": 10,
                "segmento": "VENCIDA_CON_RECARGO",
            },
        }
        for rule_name, expected in expected_rules.items():
            self.assertIn(rule_name, rules)
            self.assertEqual(rules[rule_name]["plantilla_nombre"], expected["plantilla_nombre"])
            self.assertEqual(rules[rule_name]["canal"], "WHATSAPP")
            self.assertEqual(rules[rule_name]["evento_base"], "FECHA_VENCIMIENTO")
            self.assertEqual(
                rules[rule_name]["desplazamiento_dias"],
                expected["desplazamiento_dias"],
            )
            self.assertEqual(rules[rule_name]["segmento"], expected["segmento"])
            self.assertFalse(rules[rule_name]["activo"])

    def test_plantillas_default_no_resetean_estado_sincronizado_meta(self):
        templates_response = self.client.get(
            "/api/comunicaciones/plantillas/",
            **self.auth_headers,
        )
        self.assertEqual(templates_response.status_code, 200)
        template = PlantillaMensaje.objects.get(
            capa_negocio=self.capa,
            whatsapp_template_name="betterp_pago_preventivo",
        )
        template.whatsapp_template_status = "APROBADA"
        template.whatsapp_template_notes = "Sincronizada con Meta."
        template.save(update_fields=["whatsapp_template_status", "whatsapp_template_notes"])

        reload_response = self.client.get(
            "/api/comunicaciones/plantillas/",
            **self.auth_headers,
        )

        self.assertEqual(reload_response.status_code, 200)
        template.refresh_from_db()
        self.assertEqual(template.whatsapp_template_status, "APROBADA")
        self.assertEqual(template.whatsapp_template_notes, "Sincronizada con Meta.")

    def test_configuracion_canales_y_casos_se_integran_con_mensajes_y_evidencias(self):
        config_response = self.client.put(
            "/api/comunicaciones/configuracion/",
            data=json.dumps(
                {
                    "clave": "PRINCIPAL",
                    "green_api_instance_id": "green-instance",
                    "green_api_token": "secret-token",
                    "make_webhook_url": "https://hook.make.com/prueba",
                    "openai_model": "gpt-5.4-mini",
                    "prompt_extraccion": "Extrae pagos y partidas.",
                    "auto_detectar_comprobantes": True,
                    "auto_crear_eventos": True,
                    "auto_aplicar_eventos_confiables": False,
                    "auto_conciliar_eventos": False,
                    "umbral_confianza_autoaplicacion": "88",
                    "ventana_match_dias": 5,
                    "tolerancia_monto": "25",
                    "activo": True,
                }
            ),
            content_type="application/json",
            **self.auth_headers,
        )
        self.assertEqual(config_response.status_code, 200)

        config = ConfiguracionComunicacion.objects.get()
        self.assertEqual(config.capa_negocio_id, self.capa.id)
        self.assertEqual(config.green_api_instance_id, "green-instance")
        self.assertEqual(config.openai_model, "gpt-5.4-mini")

        channel_response = self.client.post(
            "/api/comunicaciones/configuracion/canales/",
            data=json.dumps(
                {
                    "canal": "GRUPO_WHATSAPP",
                    "nombre": "Grupo cobranza Maya",
                    "identificador_externo": "120363000111222@g.us",
                    "descripcion": "Pagos y comprobantes",
                    "activo": True,
                }
            ),
            content_type="application/json",
            **self.auth_headers,
        )
        self.assertEqual(channel_response.status_code, 200)
        self.assertEqual(CanalPermitido.objects.count(), 1)

        message_response = self.client.post(
            "/api/comunicaciones/mensajes/",
            data=json.dumps(
                {
                    "caso_clave_externa": "CASE-001",
                    "grupo_externo_id": "120363000111222@g.us",
                    "entidad_id": self.entidad.id,
                    "cliente_id": self.cliente.id,
                    "canal": "WHATSAPP",
                    "remitente": "5215512345678",
                    "remitente_nombre": "Daniel",
                    "texto": "Adjunto comprobante de renta de abril",
                }
            ),
            content_type="application/json",
            **self.auth_headers,
        )
        self.assertEqual(message_response.status_code, 200)

        caso = CasoProcesamiento.objects.get(clave_externa="CASE-001")
        self.assertEqual(caso.entidad_relacionada_id, self.entidad.id)
        self.assertEqual(caso.cliente_relacionado_id, self.cliente.id)
        self.assertEqual(caso.estatus, "NUEVO")
        self.assertIn("comprobante de renta", caso.texto_consolidado or "")

        mensaje = MensajeEntrante.objects.get(caso_relacionado=caso)
        self.assertEqual(mensaje.remitente, "5215512345678")

        evidence_response = self.client.post(
            "/api/comunicaciones/evidencias/",
            data=json.dumps(
                {
                    "caso_id": caso.id,
                    "entidad_id": self.entidad.id,
                    "cliente_id": self.cliente.id,
                    "mensaje_id": mensaje.id,
                    "canal": "WHATSAPP",
                    "tipo_movimiento": "INGRESO",
                    "url_archivo": "https://files.test/comprobante.png",
                    "hash_archivo": "hash-prueba-001",
                    "monto_reportado": "9000",
                    "fecha_pago_reportada": "2026-04-10",
                    "referencia_reportada": "SPEI-001",
                    "texto_extraido": "Transferencia recibida por 9000",
                    "observaciones": "Pago de renta abril",
                }
            ),
            content_type="application/json",
            **self.auth_headers,
        )
        self.assertEqual(evidence_response.status_code, 200)
        evidence_body = evidence_response.json()

        evidencia = EvidenciaPago.objects.get(hash_archivo="hash-prueba-001")
        self.assertEqual(evidence_body["evidencia"]["id"], evidencia.id)
        self.assertEqual(evidence_body["evidencia"]["url_archivo"], evidencia.url_archivo)
        self.assertEqual(evidence_body["evidencia"]["cliente_id"], self.cliente.id)
        self.assertEqual(evidencia.caso_relacionado_id, caso.id)
        self.assertEqual(evidencia.monto_reportado, Decimal("9000"))

        caso.refresh_from_db()
        self.assertEqual(caso.estatus, "EN_REVISION")
        self.assertIn("Transferencia recibida", caso.texto_consolidado or "")

        detail_response = self.client.get(
            f"/api/comunicaciones/casos/{caso.id}/",
            **self.auth_headers,
        )
        self.assertEqual(detail_response.status_code, 200)
        body = detail_response.json()
        self.assertEqual(body["mensajes_count"], 1)
        self.assertEqual(body["evidencias_count"], 1)
        self.assertEqual(len(body["mensajes"]), 1)
        self.assertEqual(len(body["evidencias"]), 1)

    def test_serializar_casos_reusa_conteos_anotados(self):
        caso = CasoProcesamiento.objects.create(
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            clave_externa="CASE-COUNT-001",
            canal="WHATSAPP",
            remitente="5215512345678",
            estatus="EN_REVISION",
        )
        MensajeEntrante.objects.create(
            caso_relacionado=caso,
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            canal="WHATSAPP",
            remitente="5215512345678",
            texto="Comprobante recibido",
            fecha_mensaje=timezone.now(),
        )
        EvidenciaPago.objects.create(
            caso_relacionado=caso,
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            canal="WHATSAPP",
            tipo_movimiento="INGRESO",
            monto_reportado=Decimal("9000"),
            estatus="NUEVA",
        )
        EventoFinanciero.objects.create(
            caso_relacionado=caso,
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            origen_evento="WHATSAPP",
            tipo_movimiento="INGRESO",
            fecha_evento=date(2026, 4, 10),
            monto_total_reportado=Decimal("9000"),
            estatus="PROPUESTO",
        )
        annotated_case = (
            CasoProcesamiento.objects.select_related(
                "entidad_relacionada",
                "cliente_relacionado",
            )
            .annotate(
                mensajes_count=Count("mensajes", distinct=True),
                evidencias_count=Count("evidencias", distinct=True),
                eventos_count=Count("eventos_financieros", distinct=True),
            )
            .get(id=caso.id)
        )

        with CaptureQueriesContext(connection) as query_context:
            payload = serialize_caso(annotated_case)

        self.assertEqual(len(query_context.captured_queries), 0)
        self.assertEqual(payload["mensajes_count"], 1)
        self.assertEqual(payload["evidencias_count"], 1)
        self.assertEqual(payload["eventos_count"], 1)

    def test_serializar_detalle_caso_reusa_prefetches(self):
        caso = CasoProcesamiento.objects.create(
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            clave_externa="CASE-DETAIL-001",
            canal="WHATSAPP",
            remitente="5215512345678",
            estatus="EN_REVISION",
        )
        MensajeEntrante.objects.create(
            caso_relacionado=caso,
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            canal="WHATSAPP",
            remitente="5215512345678",
            texto="Comprobante recibido",
            fecha_mensaje=timezone.now(),
        )
        EvidenciaPago.objects.create(
            caso_relacionado=caso,
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            canal="WHATSAPP",
            tipo_movimiento="INGRESO",
            monto_reportado=Decimal("9000"),
            estatus="NUEVA",
        )
        EventoFinanciero.objects.create(
            caso_relacionado=caso,
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            origen_evento="WHATSAPP",
            tipo_movimiento="INGRESO",
            fecha_evento=date(2026, 4, 10),
            monto_total_reportado=Decimal("9000"),
            estatus="PROPUESTO",
        )
        prefetched_case = (
            CasoProcesamiento.objects.select_related(
                "entidad_relacionada",
                "cliente_relacionado",
            )
            .annotate(
                mensajes_count=Count("mensajes", distinct=True),
                evidencias_count=Count("evidencias", distinct=True),
                eventos_count=Count("eventos_financieros", distinct=True),
            )
            .prefetch_related(
                Prefetch(
                    "mensajes",
                    queryset=MensajeEntrante.objects.order_by("-fecha_mensaje", "-id"),
                    to_attr="_prefetched_detail_messages",
                ),
                Prefetch(
                    "evidencias",
                    queryset=EvidenciaPago.objects.select_related(
                        "entidad_relacionada",
                        "cliente_relacionado",
                        "cliente_relacionado__entidad_relacionada",
                        "mensaje_relacionado",
                    )
                    .prefetch_related(
                        "pagos_cxc",
                        "pagos_cxp",
                        "eventos_financieros",
                        Prefetch(
                            "cliente_relacionado__cuentas_por_cobrar",
                            queryset=build_cxc_candidate_prefetch_queryset(),
                            to_attr="_prefetched_open_cxc_accounts",
                        ),
                    )
                    .order_by("-fecha_registro", "-id"),
                    to_attr="_prefetched_detail_evidences",
                ),
                Prefetch(
                    "eventos_financieros",
                    queryset=EventoFinanciero.objects.order_by("-fecha_evento", "-id"),
                    to_attr="_prefetched_detail_events",
                ),
            )
            .get(id=caso.id)
        )

        with CaptureQueriesContext(connection) as query_context:
            payload = serialize_caso_detail(prefetched_case)

        self.assertEqual(len(query_context.captured_queries), 0)
        self.assertEqual(payload["mensajes_count"], 1)
        self.assertEqual(payload["evidencias_count"], 1)
        self.assertEqual(payload["eventos_count"], 1)
        self.assertEqual(len(payload["mensajes"]), 1)
        self.assertEqual(len(payload["evidencias"]), 1)
        self.assertEqual(len(payload["eventos"]), 1)

    def test_registrar_evidencia_reusa_caso_precargado_del_mensaje(self):
        caso = CasoProcesamiento.objects.create(
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            clave_externa="CASE-MSG-001",
            canal="WHATSAPP",
            remitente="5215512345678",
            estatus="NUEVO",
        )
        webhook = WebhookEntrante.objects.create(
            proveedor="GREEN_API",
            tipo_webhook="incomingMessageReceived",
            origen_externo_id="msg-case-001",
            chat_id="120363000111222@g.us",
            remitente="5215512345678",
            payload_completo={"idMessage": "msg-case-001"},
            procesado=False,
        )
        mensaje = MensajeEntrante.objects.create(
            webhook_relacionado=webhook,
            caso_relacionado=caso,
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            canal="WHATSAPP",
            remitente="5215512345678",
            remitente_nombre="Daniel",
            texto="Comprobante SPEI recibido",
            fecha_mensaje=timezone.now(),
            procesado=False,
        )

        with patch("comunicaciones.api.resolve_case") as resolve_mock:
            response = self.client.post(
                "/api/comunicaciones/evidencias/",
                data=json.dumps(
                    {
                        "mensaje_id": mensaje.id,
                        "canal": "WHATSAPP",
                        "tipo_movimiento": "INGRESO",
                        "hash_archivo": "hash-msg-case-001",
                        "monto_reportado": "9000",
                        "fecha_pago_reportada": "2026-04-10",
                        "referencia_reportada": "SPEI-MSG-001",
                        "texto_extraido": "Transferencia recibida por 9000",
                    }
                ),
                content_type="application/json",
                **self.auth_headers,
            )

        self.assertEqual(response.status_code, 200)
        resolve_mock.assert_not_called()
        evidencia = EvidenciaPago.objects.get(hash_archivo="hash-msg-case-001")
        self.assertEqual(evidencia.caso_relacionado_id, caso.id)
        self.assertEqual(evidencia.entidad_relacionada_id, self.entidad.id)
        self.assertEqual(evidencia.cliente_relacionado_id, self.cliente.id)
        mensaje.refresh_from_db()
        webhook.refresh_from_db()
        caso.refresh_from_db()
        self.assertTrue(mensaje.procesado)
        self.assertTrue(webhook.procesado)
        self.assertEqual(caso.estatus, "EN_REVISION")

    def test_registrar_evidencia_reusa_relaciones_precargadas_del_caso(self):
        caso = CasoProcesamiento.objects.create(
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            clave_externa="CASE-FAST-001",
            canal="WHATSAPP",
            remitente="5215512345678",
            estatus="NUEVO",
        )

        with (
            patch("comunicaciones.api.get_scoped_entity_or_none") as entity_mock,
            patch("comunicaciones.api.get_scoped_client_or_none") as client_mock,
        ):
            response = self.client.post(
                "/api/comunicaciones/evidencias/",
                data=json.dumps(
                    {
                        "caso_id": caso.id,
                        "entidad_id": self.entidad.id,
                        "cliente_id": self.cliente.id,
                        "canal": "WHATSAPP",
                        "tipo_movimiento": "INGRESO",
                        "hash_archivo": "hash-fast-case-001",
                        "monto_reportado": "9000",
                        "fecha_pago_reportada": "2026-04-10",
                        "referencia_reportada": "SPEI-FAST-001",
                        "texto_extraido": "Transferencia recibida por 9000",
                    }
                ),
                content_type="application/json",
                **self.auth_headers,
            )

        self.assertEqual(response.status_code, 200)
        entity_mock.assert_not_called()
        client_mock.assert_not_called()
        evidencia = EvidenciaPago.objects.get(hash_archivo="hash-fast-case-001")
        self.assertEqual(evidencia.caso_relacionado_id, caso.id)
        self.assertEqual(evidencia.entidad_relacionada_id, self.entidad.id)
        self.assertEqual(evidencia.cliente_relacionado_id, self.cliente.id)

    def test_clasificacion_evidencia_permite_validar_o_descartar_sin_evento(self):
        evidencia = EvidenciaPago.objects.create(
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            canal="MANUAL",
            tipo_movimiento="INGRESO",
            origen_deteccion="SISTEMA",
            monto_reportado=Decimal("1250.00"),
            referencia_reportada="PORTAL-001",
            requiere_revision_manual=True,
            categoria_sugerida="Comprobante portal cliente",
            estatus="NUEVA",
        )

        validate_response = self.client.post(
            f"/api/comunicaciones/evidencias/{evidencia.id}/clasificacion/",
            data=json.dumps(
                {
                    "tipo_movimiento": "INGRESO",
                    "entidad_id": self.entidad.id,
                    "cliente_id": self.cliente.id,
                    "categoria_sugerida": "Comprobante portal cliente",
                    "confianza_clasificacion": "90",
                    "requiere_revision_manual": False,
                    "observaciones": "Validado por administracion.",
                    "estatus": "VALIDADA",
                    "crear_evento": False,
                    "aplicar_evento": False,
                }
            ),
            content_type="application/json",
            **self.auth_headers,
        )

        self.assertEqual(validate_response.status_code, 200)
        evidencia.refresh_from_db()
        self.assertEqual(evidencia.estatus, "VALIDADA")
        self.assertFalse(evidencia.requiere_revision_manual)
        self.assertIn("Validado por administracion", evidencia.observaciones or "")

        discard_response = self.client.post(
            f"/api/comunicaciones/evidencias/{evidencia.id}/clasificacion/",
            data=json.dumps(
                {
                    "tipo_movimiento": "INGRESO",
                    "entidad_id": self.entidad.id,
                    "cliente_id": self.cliente.id,
                    "categoria_sugerida": "Comprobante portal cliente",
                    "confianza_clasificacion": "90",
                    "requiere_revision_manual": False,
                    "observaciones": "Duplicado.",
                    "estatus": "DESCARTADA",
                    "crear_evento": False,
                    "aplicar_evento": False,
                }
            ),
            content_type="application/json",
            **self.auth_headers,
        )

        self.assertEqual(discard_response.status_code, 200)
        evidencia.refresh_from_db()
        self.assertEqual(evidencia.estatus, "DESCARTADA")
        self.assertIn("Duplicado", evidencia.observaciones or "")

    def test_listar_evidencias_filtra_por_vista_origen_y_busqueda(self):
        portal_evidence = EvidenciaPago.objects.create(
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            canal="MANUAL",
            tipo_movimiento="INGRESO",
            origen_deteccion="SISTEMA",
            monto_reportado=Decimal("800.00"),
            referencia_reportada="PORTAL-REF-001",
            requiere_revision_manual=True,
            categoria_sugerida="Comprobante portal cliente",
            metadata={"origen": "PORTAL_CLIENTE", "archivo_nombre": "pago-portal.pdf"},
            estatus="NUEVA",
        )
        EvidenciaPago.objects.create(
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            canal="WHATSAPP",
            tipo_movimiento="INGRESO",
            origen_deteccion="META_CLOUD_API",
            monto_reportado=Decimal("900.00"),
            referencia_reportada="WA-REF-001",
            requiere_revision_manual=False,
            estatus="APLICADA",
        )
        EvidenciaPago.objects.create(
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            canal="MANUAL",
            tipo_movimiento="INGRESO",
            origen_deteccion="MANUAL",
            monto_reportado=Decimal("500.00"),
            referencia_reportada="MANUAL-REF-001",
            requiere_revision_manual=False,
            estatus="DESCARTADA",
        )

        pending_response = self.client.get(
            "/api/comunicaciones/evidencias/?vista=PENDIENTES&origen=PORTAL&busqueda=PORTAL-REF",
            **self.auth_headers,
        )

        self.assertEqual(pending_response.status_code, 200)
        pending_body = pending_response.json()
        self.assertEqual([item["id"] for item in pending_body], [portal_evidence.id])

        applied_response = self.client.get(
            "/api/comunicaciones/evidencias/?estatus=APLICADA&origen=WHATSAPP",
            **self.auth_headers,
        )

        self.assertEqual(applied_response.status_code, 200)
        self.assertEqual(len(applied_response.json()), 1)

    def test_listar_evidencias_filtra_por_fecha_de_registro(self):
        old_evidence = EvidenciaPago.objects.create(
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            canal="MANUAL",
            tipo_movimiento="INGRESO",
            origen_deteccion="MANUAL",
            monto_reportado=Decimal("500.00"),
            referencia_reportada="OLD-001",
            requiere_revision_manual=True,
            estatus="NUEVA",
        )
        recent_evidence = EvidenciaPago.objects.create(
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            canal="MANUAL",
            tipo_movimiento="INGRESO",
            origen_deteccion="MANUAL",
            monto_reportado=Decimal("900.00"),
            referencia_reportada="RECENT-001",
            requiere_revision_manual=True,
            estatus="NUEVA",
        )
        EvidenciaPago.objects.filter(id=old_evidence.id).update(
            fecha_registro=timezone.now() - timedelta(days=10)
        )
        since = (timezone.localdate() - timedelta(days=2)).isoformat()

        response = self.client.get(
            f"/api/comunicaciones/evidencias/?vista=PENDIENTES&fecha_desde={since}",
            **self.auth_headers,
        )

        self.assertEqual(response.status_code, 200)
        ids = [item["id"] for item in response.json()]
        self.assertIn(recent_evidence.id, ids)
        self.assertNotIn(old_evidence.id, ids)

    def test_listar_evidencias_incluye_cxc_candidata_y_posible_duplicado(self):
        cuenta = CuentaPorCobrar.objects.create(
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            concepto="Renta julio",
            fecha_vencimiento=date(2026, 7, 5),
            monto_total=Decimal("3500.00"),
            monto_pagado=Decimal("0"),
            estatus_adeudo="PENDIENTE",
        )
        EvidenciaPago.objects.create(
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            canal="MANUAL",
            tipo_movimiento="INGRESO",
            origen_deteccion="MANUAL",
            monto_reportado=Decimal("3500.00"),
            fecha_pago_reportada=date(2026, 7, 1),
            referencia_reportada="SPEI-777",
            requiere_revision_manual=False,
            estatus="APLICADA",
        )
        evidencia = EvidenciaPago.objects.create(
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            canal="MANUAL",
            tipo_movimiento="INGRESO",
            origen_deteccion="MANUAL",
            monto_reportado=Decimal("3500.00"),
            fecha_pago_reportada=date(2026, 7, 1),
            referencia_reportada="SPEI-777",
            requiere_revision_manual=True,
            estatus="NUEVA",
        )

        response = self.client.get(
            "/api/comunicaciones/evidencias/?vista=PENDIENTES",
            **self.auth_headers,
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        row = next(item for item in body if item["id"] == evidencia.id)
        self.assertTrue(row["duplicado_posible"]["posible"])
        self.assertEqual(row["cxc_candidatas"][0]["id"], cuenta.id)
        self.assertIn("monto exacto", row["cxc_candidatas"][0]["motivos"])



    def test_aplicar_evidencia_a_cxc_registra_pago_parcial_y_evento(self):
        cuenta = CuentaPorCobrar.objects.create(
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            concepto="Renta julio",
            fecha_vencimiento=timezone.localdate() + timedelta(days=30),
            monto_total=Decimal("9000.00"),
            monto_pagado=Decimal("0"),
            estatus_adeudo="PENDIENTE",
        )
        evidencia = EvidenciaPago.objects.create(
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            canal="MANUAL",
            tipo_movimiento="INGRESO",
            origen_deteccion="MANUAL",
            monto_reportado=Decimal("3500.00"),
            fecha_pago_reportada=date(2026, 7, 1),
            referencia_reportada="SPEI-PARCIAL",
            requiere_revision_manual=True,
            categoria_sugerida="Comprobante portal cliente",
            estatus="NUEVA",
        )

        response = self.client.post(
            f"/api/comunicaciones/evidencias/{evidencia.id}/aplicar-cxc/",
            data=json.dumps(
                {
                    "cuenta_id": cuenta.id,
                    "monto": "3500.00",
                    "fecha_pago": "2026-07-01",
                    "referencia": "SPEI-PARCIAL",
                    "notas": "Validado visualmente.",
                }
            ),
            content_type="application/json",
            **self.auth_headers,
        )

        self.assertEqual(response.status_code, 200)
        cuenta.refresh_from_db()
        evidencia.refresh_from_db()
        self.assertEqual(cuenta.monto_pagado, Decimal("3500.00"))
        self.assertEqual(cuenta.saldo_pendiente, Decimal("5500.00"))
        self.assertEqual(cuenta.estatus_adeudo, "PARCIAL")
        self.assertEqual(evidencia.estatus, "APLICADA")
        pago = PagoCuentaPorCobrar.objects.get(cuenta_por_cobrar=cuenta)
        self.assertEqual(pago.monto, Decimal("3500.00"))
        self.assertEqual(pago.estatus_validacion, "APLICADO")
        self.assertEqual(pago.evidencia_pago_relacionada, evidencia)
        body = response.json()
        self.assertIsNotNone(body["evento_id"])
        evento = EventoFinanciero.objects.get(id=body["evento_id"])
        self.assertEqual(evento.estatus, "APLICADO")
        self.assertEqual(evento.evidencia_pago_relacionada, evidencia)
        pago.refresh_from_db()
        self.assertEqual(pago.evento_financiero_relacionado, evento)

    def test_aplicar_evidencia_a_cxc_con_excedente_reparte_y_guarda_saldo_a_favor(self):
        cuenta_prioritaria = CuentaPorCobrar.objects.create(
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            concepto="Renta junio",
            fecha_vencimiento=date(2026, 6, 16),
            monto_total=Decimal("8500.00"),
            monto_pagado=Decimal("0"),
            estatus_adeudo="PENDIENTE",
        )
        cuenta_siguiente = CuentaPorCobrar.objects.create(
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            concepto="Renta julio",
            fecha_vencimiento=date(2026, 7, 16),
            monto_total=Decimal("1500.00"),
            monto_pagado=Decimal("0"),
            estatus_adeudo="PENDIENTE",
        )
        evidencia = EvidenciaPago.objects.create(
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            canal="MANUAL",
            tipo_movimiento="INGRESO",
            origen_deteccion="MANUAL",
            monto_reportado=Decimal("11000.00"),
            fecha_pago_reportada=date(2026, 6, 17),
            referencia_reportada="0024426976",
            requiere_revision_manual=True,
            categoria_sugerida="Comprobante portal cliente",
            estatus="NUEVA",
        )

        response = self.client.post(
            f"/api/comunicaciones/evidencias/{evidencia.id}/aplicar-cxc/",
            data=json.dumps(
                {
                    "cuenta_id": cuenta_prioritaria.id,
                    "monto": "11000.00",
                    "fecha_pago": "2026-06-17",
                    "referencia": "0024426976",
                    "notas": "Validado visualmente con excedente.",
                }
            ),
            content_type="application/json",
            **self.auth_headers,
        )

        self.assertEqual(response.status_code, 200)
        cuenta_prioritaria.refresh_from_db()
        cuenta_siguiente.refresh_from_db()
        evidencia.refresh_from_db()
        self.assertEqual(cuenta_prioritaria.monto_pagado, Decimal("8500.00"))
        self.assertEqual(cuenta_siguiente.monto_pagado, Decimal("1500.00"))
        self.assertEqual(evidencia.estatus, "APLICADA")
        self.assertEqual(
            PagoCuentaPorCobrar.objects.filter(evidencia_pago_relacionada=evidencia).count(),
            2,
        )

        saldo = SaldoCliente.objects.get(cliente_relacionado=self.cliente)
        self.assertEqual(saldo.saldo_a_favor, Decimal("1000.00"))

        body = response.json()
        self.assertEqual(body["resultado"]["saldo_a_favor"], 1000.0)
        self.assertEqual(len(body["resultado"]["aplicaciones"]), 2)
        self.assertIn("saldo a favor", body["mensaje"].lower())

        evento = EventoFinanciero.objects.get(id=body["evento_id"])
        self.assertEqual(evento.monto_total_reportado, Decimal("11000.00"))
        self.assertEqual(evento.partidas.filter(tipo_destino="CXC").count(), 2)
        self.assertEqual(evento.partidas.filter(tipo_destino="SALDO_A_FAVOR").count(), 1)
        self.assertEqual(
            evento.partidas.get(tipo_destino="SALDO_A_FAVOR").monto_partida,
            Decimal("1000.00"),
        )

    @override_settings(OPENAI_API_KEY="", GOOGLE_VISION_API_KEY="")
    def test_analisis_ia_evidencia_usa_reglas_si_no_hay_llave(self):
        self.activar_plan(modulos=["cobranza"], funciones=["ai_copy"])
        ConfiguracionComunicacion.objects.create(
            capa_negocio=self.capa,
            clave="PRINCIPAL",
            umbral_confianza_autoaplicacion=Decimal("85"),
        )
        evidencia = EvidenciaPago.objects.create(
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            canal="MANUAL",
            tipo_movimiento="INGRESO",
            origen_deteccion="MANUAL",
            texto_extraido="Pago de renta por $3,500.00 referencia SPEI-ABC1234",
            requiere_revision_manual=True,
            estatus="NUEVA",
        )

        response = self.client.post(
            f"/api/comunicaciones/evidencias/{evidencia.id}/analisis-ia/",
            **self.auth_headers,
        )

        self.assertEqual(response.status_code, 200)
        evidencia.refresh_from_db()
        self.assertEqual(evidencia.monto_reportado, Decimal("3500.00"))
        self.assertEqual(evidencia.referencia_reportada, "SPEI-ABC1234")
        self.assertTrue(evidencia.requiere_revision_manual)
        self.assertEqual(evidencia.metadata["lectura_ia"]["fuente"], "reglas")

    @override_settings(OPENAI_API_KEY="", GOOGLE_VISION_API_KEY="")
    def test_analisis_ia_por_reglas_no_toma_monto_desde_url_de_imagen(self):
        self.activar_plan(modulos=["cobranza"], funciones=["ai_copy"])
        ConfiguracionComunicacion.objects.create(
            capa_negocio=self.capa,
            clave="PRINCIPAL",
            umbral_confianza_autoaplicacion=Decimal("85"),
        )
        evidencia = EvidenciaPago.objects.create(
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            canal="MANUAL",
            tipo_movimiento="INGRESO",
            origen_deteccion="MANUAL",
            url_archivo=(
                "https://r2.test/comunicaciones/comprobantes/1/2026/06/"
                "b7a4d388fa46416a9b21c900a075139f_photo_2026-06-17_17-13-10.jpg"
            ),
            texto_extraido=(
                "Archivo cargado: photo_2026-06-17_17-13-10.jpg\n"
                "https://r2.test/comunicaciones/comprobantes/1/2026/06/"
                "b7a4d388fa46416a9b21c900a075139f_photo_2026-06-17_17-13-10.jpg"
            ),
            monto_reportado=Decimal("900.00"),
            requiere_revision_manual=True,
            estatus="NUEVA",
            metadata={
                "lectura_ia": {
                    "fuente": "reglas",
                    "requiere_revision_manual": True,
                }
            },
        )

        response = self.client.post(
            f"/api/comunicaciones/evidencias/{evidencia.id}/analisis-ia/",
            **self.auth_headers,
        )

        self.assertEqual(response.status_code, 200, response.content)
        evidencia.refresh_from_db()
        self.assertIsNone(evidencia.monto_reportado)
        self.assertTrue(evidencia.requiere_revision_manual)
        self.assertEqual(evidencia.metadata["lectura_ia"]["monto"], "")
        self.assertIn("requiere IA visual", evidencia.observaciones)

    @override_settings(OPENAI_API_KEY="", GOOGLE_VISION_API_KEY="")
    def test_analisis_ia_por_reglas_no_reanaliza_observaciones_repetidas(self):
        self.activar_plan(modulos=["cobranza"], funciones=["ai_copy"])
        ConfiguracionComunicacion.objects.create(
            capa_negocio=self.capa,
            clave="PRINCIPAL",
            umbral_confianza_autoaplicacion=Decimal("85"),
        )
        repeated = (
            "El mensaje trae un archivo, pero no hubo suficientes pistas para clasificarlo con certeza.; "
            "Se detecto un monto utilizable dentro del texto.; "
            "El mensaje trae un archivo, pero no hubo suficientes pistas para clasificarlo con certeza.; "
            "OpenAI no esta configurado; se usaron reglas sin lectura visual."
        )
        evidencia = EvidenciaPago.objects.create(
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            canal="MANUAL",
            tipo_movimiento="INGRESO",
            origen_deteccion="MANUAL",
            url_archivo=(
                "https://r2.test/comunicaciones/comprobantes/1/2026/06/"
                "b7a4d388fa46416a9b21c900a075139f_photo_2026-06-17_17-13-10.jpg"
            ),
            texto_extraido="Archivo cargado: photo_2026-06-17_17-13-10.jpg",
            observaciones=repeated,
            requiere_revision_manual=True,
            estatus="NUEVA",
        )

        response = self.client.post(
            f"/api/comunicaciones/evidencias/{evidencia.id}/analisis-ia/",
            **self.auth_headers,
        )

        self.assertEqual(response.status_code, 200, response.content)
        evidencia.refresh_from_db()
        self.assertIsNone(evidencia.monto_reportado)
        self.assertEqual(
            evidencia.observaciones.count(
                "El mensaje trae un archivo, pero no hubo suficientes pistas"
            ),
            1,
        )
        self.assertEqual(
            evidencia.observaciones.count("Se detecto un monto utilizable"),
            1,
        )
        self.assertIn("requiere IA visual", evidencia.observaciones)

    @override_settings(OPENAI_API_KEY="", GOOGLE_VISION_API_KEY="")
    def test_analisis_ia_por_reglas_extrae_texto_ocr_bbva(self):
        self.activar_plan(modulos=["cobranza"], funciones=["ai_copy"])
        ConfiguracionComunicacion.objects.create(
            capa_negocio=self.capa,
            clave="PRINCIPAL",
            umbral_confianza_autoaplicacion=Decimal("85"),
        )
        evidencia = EvidenciaPago.objects.create(
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            canal="MANUAL",
            tipo_movimiento="INGRESO",
            origen_deteccion="MANUAL",
            texto_extraido=(
                "BBVA\n"
                "COMPROBANTE DE LA OPERACION\n"
                "Tipo de operacion\nTransferencia a terceros\n"
                "Folio de la operacion\n0024426976\n"
                "Fecha\n17 junio 2026\n"
                "Hora\n13:19 h\n"
                "Concepto\npago\n"
                "Importe transferido\n$ 11,000.00\n"
                "Cuenta de origen\n*9558\n"
                "Nombre del beneficiario\nMaya Coliving Sa De C\n"
            ),
            requiere_revision_manual=True,
            estatus="NUEVA",
        )

        response = self.client.post(
            f"/api/comunicaciones/evidencias/{evidencia.id}/analisis-ia/",
            **self.auth_headers,
        )

        self.assertEqual(response.status_code, 200, response.content)
        evidencia.refresh_from_db()
        self.assertEqual(evidencia.monto_reportado, Decimal("11000.00"))
        self.assertEqual(evidencia.fecha_pago_reportada, date(2026, 6, 17))
        self.assertEqual(evidencia.referencia_reportada, "0024426976")
        self.assertEqual(evidencia.metadata["lectura_ia"]["banco"], "BBVA")
        self.assertEqual(
            evidencia.metadata["lectura_ia"]["receptor"],
            "Maya Coliving Sa De C",
        )

    @override_settings(OPENAI_API_KEY="", GOOGLE_VISION_API_KEY="vision-key")
    def test_analisis_ia_evidencia_extrae_con_google_vision(self):
        self.activar_plan(modulos=["cobranza"], funciones=["ai_copy"])
        ConfiguracionComunicacion.objects.create(
            capa_negocio=self.capa,
            clave="PRINCIPAL",
            umbral_confianza_autoaplicacion=Decimal("85"),
        )
        evidencia = EvidenciaPago.objects.create(
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            canal="MANUAL",
            tipo_movimiento="INGRESO",
            origen_deteccion="MANUAL",
            url_archivo="https://r2.test/comprobante-bbva.jpg",
            requiere_revision_manual=True,
            estatus="NUEVA",
        )
        vision_text = (
            "BBVA\n"
            "COMPROBANTE DE LA OPERACION\n"
            "Tipo de operacion\nTransferencia a terceros\n"
            "Folio de la operacion\n0024426976\n"
            "Fecha\n17 junio 2026\n"
            "Hora\n13:19 h\n"
            "Concepto\npago\n"
            "Importe transferido\n$ 11,000.00\n"
            "Cuenta de origen\n*9558\n"
            "Nombre del beneficiario\nMaya Coliving Sa De C\n"
            "Nombre del banco\nCuenta BBVA\n"
            "Cuenta de destino\n*2374\n"
        )
        mocked_image_response = type(
            "Response",
            (),
            {
                "status_code": 200,
                "content": b"fake-image-content",
                "headers": {"Content-Type": "image/jpeg"},
            },
        )()
        mocked_vision_response = type(
            "Response",
            (),
            {
                "status_code": 200,
                "json": lambda self: {
                    "responses": [
                        {
                            "fullTextAnnotation": {
                                "text": vision_text,
                            }
                        }
                    ]
                },
            },
        )()

        with (
            patch("comunicaciones.api.requests.get", return_value=mocked_image_response),
            patch("comunicaciones.api.requests.post", return_value=mocked_vision_response) as post,
        ):
            response = self.client.post(
                f"/api/comunicaciones/evidencias/{evidencia.id}/analisis-ia/",
                **self.auth_headers,
            )

        self.assertEqual(response.status_code, 200, response.content)
        post.assert_called_once()
        self.assertEqual(
            post.call_args.args[0],
            "https://vision.googleapis.com/v1/images:annotate",
        )
        self.assertEqual(post.call_args.kwargs["params"]["key"], "vision-key")
        posted_payload = post.call_args.kwargs["json"]
        self.assertEqual(
            posted_payload["requests"][0]["features"][0]["type"],
            "DOCUMENT_TEXT_DETECTION",
        )
        self.assertTrue(posted_payload["requests"][0]["image"]["content"])
        evidencia.refresh_from_db()
        self.assertEqual(evidencia.monto_reportado, Decimal("11000.00"))
        self.assertEqual(evidencia.fecha_pago_reportada, date(2026, 6, 17))
        self.assertEqual(evidencia.referencia_reportada, "0024426976")
        self.assertEqual(evidencia.confianza_clasificacion, Decimal("93.00"))
        self.assertFalse(evidencia.requiere_revision_manual)
        self.assertEqual(evidencia.estatus, "NUEVA")
        self.assertEqual(evidencia.metadata["lectura_ia"]["fuente"], "google_vision")
        self.assertEqual(
            evidencia.metadata["lectura_ia"]["modelo"],
            "DOCUMENT_TEXT_DETECTION",
        )
        self.assertEqual(evidencia.metadata["lectura_ia"]["banco"], "BBVA")
        self.assertEqual(
            evidencia.metadata["lectura_ia"]["receptor"],
            "Maya Coliving Sa De C",
        )
        self.assertEqual(
            evidencia.metadata["lectura_ia"]["archivo_visual"]["modo"],
            "base64",
        )

    @override_settings(OPENAI_API_KEY="", GOOGLE_VISION_API_KEY="vision-key")
    def test_analisis_ia_evidencia_guarda_error_google_vision(self):
        self.activar_plan(modulos=["cobranza"], funciones=["ai_copy"])
        ConfiguracionComunicacion.objects.create(
            capa_negocio=self.capa,
            clave="PRINCIPAL",
            umbral_confianza_autoaplicacion=Decimal("85"),
        )
        evidencia = EvidenciaPago.objects.create(
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            canal="MANUAL",
            tipo_movimiento="INGRESO",
            origen_deteccion="MANUAL",
            url_archivo="https://r2.test/comprobante-bbva.jpg",
            requiere_revision_manual=True,
            estatus="NUEVA",
        )
        mocked_image_response = type(
            "Response",
            (),
            {
                "status_code": 200,
                "content": b"fake-image-content",
                "headers": {"Content-Type": "image/jpeg"},
            },
        )()
        mocked_vision_response = type(
            "Response",
            (),
            {
                "status_code": 403,
                "text": "forbidden",
                "json": lambda self: {
                    "error": {
                        "status": "PERMISSION_DENIED",
                        "message": "API key not valid for Cloud Vision API.",
                    }
                },
            },
        )()

        with (
            patch("comunicaciones.api.requests.get", return_value=mocked_image_response),
            patch("comunicaciones.api.requests.post", return_value=mocked_vision_response),
        ):
            response = self.client.post(
                f"/api/comunicaciones/evidencias/{evidencia.id}/analisis-ia/",
                **self.auth_headers,
            )

        self.assertEqual(response.status_code, 200, response.content)
        evidencia.refresh_from_db()
        self.assertEqual(evidencia.metadata["lectura_ia"]["fuente"], "reglas")
        self.assertIn("Google Vision rechazo la solicitud (403)", evidencia.observaciones)
        self.assertIn("PERMISSION_DENIED", evidencia.observaciones)

    @override_settings(OPENAI_API_KEY="sk-test", GOOGLE_VISION_API_KEY="")
    def test_analisis_ia_evidencia_actualiza_campos_con_openai(self):
        self.activar_plan(modulos=["cobranza"], funciones=["ai_copy"])
        ConfiguracionComunicacion.objects.create(
            capa_negocio=self.capa,
            clave="PRINCIPAL",
            openai_model="gpt-test",
            umbral_confianza_autoaplicacion=Decimal("85"),
        )
        evidencia = EvidenciaPago.objects.create(
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            canal="MANUAL",
            tipo_movimiento="INGRESO",
            origen_deteccion="MANUAL",
            url_archivo="https://r2.test/comprobante.jpg",
            requiere_revision_manual=True,
            estatus="NUEVA",
        )
        payload = {
            "tipo_movimiento": "INGRESO",
            "monto": "4200.50",
            "fecha_pago": "2026-07-02",
            "referencia": "SPEI-XYZ789",
            "banco": "BBVA",
            "emisor": "Daniel Muller",
            "receptor": "Maya Coliving",
            "concepto": "RENTA",
            "texto_extraido": "Comprobante BBVA por 4200.50",
            "confianza": 94,
            "requiere_revision_manual": False,
            "observaciones": "Monto y referencia visibles.",
        }
        mocked_response = type(
            "Response",
            (),
            {
                "status_code": 200,
                "json": lambda self: {
                    "output_text": json.dumps(payload),
                    "usage": {"input_tokens": 100, "output_tokens": 50},
                },
            },
        )()
        mocked_image_response = type(
            "Response",
            (),
            {
                "status_code": 200,
                "content": b"fake-image-content",
                "headers": {"Content-Type": "image/jpeg"},
            },
        )()

        with (
            patch("comunicaciones.api.requests.get", return_value=mocked_image_response),
            patch("comunicaciones.api.requests.post", return_value=mocked_response) as post,
        ):
            response = self.client.post(
                f"/api/comunicaciones/evidencias/{evidencia.id}/analisis-ia/",
                **self.auth_headers,
            )

        self.assertEqual(response.status_code, 200)
        post.assert_called_once()
        posted_payload = post.call_args.kwargs["json"]
        user_content = posted_payload["input"][1]["content"]
        image_content = next(item for item in user_content if item["type"] == "input_image")
        self.assertTrue(image_content["image_url"].startswith("data:image/jpeg;base64,"))
        evidencia.refresh_from_db()
        self.assertEqual(evidencia.monto_reportado, Decimal("4200.50"))
        self.assertEqual(evidencia.fecha_pago_reportada, date(2026, 7, 2))
        self.assertEqual(evidencia.referencia_reportada, "SPEI-XYZ789")
        self.assertEqual(evidencia.confianza_clasificacion, Decimal("94"))
        self.assertFalse(evidencia.requiere_revision_manual)
        self.assertEqual(evidencia.estatus, "NUEVA")
        self.assertEqual(evidencia.metadata["lectura_ia"]["fuente"], "openai")
        self.assertEqual(evidencia.metadata["lectura_ia"]["tokens"], 150)
        self.assertEqual(evidencia.metadata["lectura_ia"]["archivo_visual"]["modo"], "base64")

    def test_subir_archivo_evidencia_guarda_url_y_hash(self):
        self.activar_plan(modulos=["cobranza"])
        content = b"fake-payment-screenshot"
        upload = SimpleUploadedFile(
            "comprobante prueba.png",
            content,
            content_type="image/png",
        )

        response = self.client.post(
            "/api/comunicaciones/evidencias/archivo/",
            {"file": upload},
            **self.auth_headers,
        )

        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertTrue(body["success"])
        self.assertEqual(body["hash_archivo"], hashlib.sha256(content).hexdigest())
        self.assertIn("comunicaciones/comprobantes/", body["url"])
        self.assertEqual(body["nombre"], "comprobante_prueba.png")
        self.assertFalse(body["duplicado"])

    def test_clasificacion_evidencia_permite_corregir_monto_fecha_referencia(self):
        self.activar_plan(modulos=["cobranza"])
        evidencia = EvidenciaPago.objects.create(
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            canal="MANUAL",
            tipo_movimiento="INGRESO",
            origen_deteccion="MANUAL",
            monto_reportado=Decimal("900.00"),
            requiere_revision_manual=True,
            estatus="NUEVA",
        )

        response = self.client.post(
            f"/api/comunicaciones/evidencias/{evidencia.id}/clasificacion/",
            data=json.dumps(
                {
                    "tipo_movimiento": "INGRESO",
                    "entidad_id": self.entidad.id,
                    "cliente_id": self.cliente.id,
                    "categoria_sugerida": "COBRANZA",
                    "monto_reportado": "11000.00",
                    "fecha_pago_reportada": "2026-06-17",
                    "referencia_reportada": "0024426976",
                    "confianza_clasificacion": "100",
                    "requiere_revision_manual": True,
                    "observaciones": "Datos corregidos manualmente.",
                    "estatus": "NUEVA",
                    "crear_evento": False,
                    "aplicar_evento": False,
                }
            ),
            content_type="application/json",
            **self.auth_headers,
        )

        self.assertEqual(response.status_code, 200, response.content)
        evidencia.refresh_from_db()
        self.assertEqual(evidencia.monto_reportado, Decimal("11000.00"))
        self.assertEqual(evidencia.fecha_pago_reportada, date(2026, 6, 17))
        self.assertEqual(evidencia.referencia_reportada, "0024426976")

    def test_webhooks_entrantes_se_acotan_a_la_capa_activa(self):
        self.activar_plan(modulos=["cobranza"], funciones=["whatsapp_automation"])
        config = ConfiguracionComunicacion.objects.create(
            capa_negocio=self.capa,
            clave="PRINCIPAL",
        )
        CanalPermitido.objects.create(
            configuracion_relacionada=config,
            canal="GRUPO_WHATSAPP",
            nombre="Grupo Maya",
            identificador_externo="grupo-maya@g.us",
            activo=True,
        )
        own_webhook = WebhookEntrante.objects.create(
            proveedor="GREEN_API",
            tipo_webhook="incomingMessageReceived",
            chat_id="grupo-maya@g.us",
            remitente="5215512345678",
            payload_completo={"idMessage": "own-message"},
            estatus_procesamiento="PENDIENTE",
        )

        other_capa = CapaNegocio.objects.create(
            nombre="Otra Operacion Webhooks",
            tipo_capa="OPERADORA",
        )
        other_config = ConfiguracionComunicacion.objects.create(
            capa_negocio=other_capa,
            clave="PRINCIPAL",
        )
        CanalPermitido.objects.create(
            configuracion_relacionada=other_config,
            canal="GRUPO_WHATSAPP",
            nombre="Grupo Otra",
            identificador_externo="grupo-otra@g.us",
            activo=True,
        )
        other_webhook = WebhookEntrante.objects.create(
            proveedor="GREEN_API",
            tipo_webhook="incomingMessageReceived",
            chat_id="grupo-otra@g.us",
            remitente="5215599999999",
            payload_completo={"idMessage": "other-message"},
            estatus_procesamiento="PENDIENTE",
        )

        response = self.client.get(
            "/api/comunicaciones/webhooks/entrantes/",
            **self.auth_headers,
        )

        self.assertEqual(response.status_code, 200)
        ids = {item["id"] for item in response.json()["items"]}
        self.assertIn(own_webhook.id, ids)
        self.assertNotIn(other_webhook.id, ids)

        reprocess_response = self.client.post(
            f"/api/comunicaciones/webhooks/entrantes/{other_webhook.id}/reprocesar/",
            **self.auth_headers,
        )

        self.assertEqual(reprocess_response.status_code, 404)

    def test_plantillas_separadas_por_capa_activa(self):
        other_user = User.objects.create_user(
            username="admin@otra.test",
            email="admin@otra.test",
            password="secret123",
        )
        other_capa = CapaNegocio.objects.create(
            nombre="Otra Operacion",
            tipo_capa="OPERADORA",
        )
        MembresiaCapaNegocio.objects.create(
            user=other_user,
            capa_negocio=other_capa,
            rol="OWNER_ADMIN",
            activo=True,
        )
        other_session = create_access_session(other_user, provider="PASSWORD")
        other_tokens = issue_token_pair(other_session)
        other_headers = {
            "HTTP_AUTHORIZATION": f"Bearer {other_tokens['access_token']}",
            "HTTP_X_BETTERP_CAPA_ID": str(other_capa.id),
        }

        response = self.client.post(
            "/api/comunicaciones/plantillas/",
            data=json.dumps(
                {
                    "nombre": "Aviso privado Maya",
                    "descripcion": "",
                    "canal": "WHATSAPP",
                    "tipo_plantilla": "MENSAJE_PERSONALIZADO",
                    "asunto": "",
                    "cuerpo": "Mensaje solo Maya",
                    "incluye_link_portal": True,
                    "url_media": "",
                    "activo": True,
                }
            ),
            content_type="application/json",
            **self.auth_headers,
        )
        self.assertEqual(response.status_code, 200)

        other_response = self.client.get(
            "/api/comunicaciones/plantillas/",
            **other_headers,
        )
        self.assertEqual(other_response.status_code, 200)
        other_names = {item["nombre"] for item in other_response.json()}
        self.assertNotIn("Aviso privado Maya", other_names)

        template = PlantillaMensaje.objects.get(nombre="Aviso privado Maya")
        self.assertEqual(template.capa_negocio_id, self.capa.id)

    def create_non_platform_owner_headers(self):
        tenant_user = User.objects.create_user(
            username="owner-cliente@maya.test",
            email="owner-cliente@maya.test",
            password="secret123",
        )
        MembresiaCapaNegocio.objects.create(
            user=tenant_user,
            capa_negocio=self.capa,
            rol="OWNER_ADMIN",
            activo=True,
        )
        session = create_access_session(tenant_user, provider="PASSWORD")
        tokens = issue_token_pair(session)
        return {
            "HTTP_AUTHORIZATION": f"Bearer {tokens['access_token']}",
            "HTTP_X_BETTERP_CAPA_ID": str(self.capa.id),
        }

    @override_settings(LOCK_TENANT_MESSAGE_TEMPLATES=True)
    def test_tenant_admin_no_puede_crear_plantillas_si_gobernanza_activa(self):
        response = self.client.post(
            "/api/comunicaciones/plantillas/",
            data=json.dumps(
                {
                    "nombre": "Texto libre cliente",
                    "descripcion": "",
                    "canal": "WHATSAPP",
                    "tipo_plantilla": "MENSAJE_PERSONALIZADO",
                    "asunto": "",
                    "cuerpo": "Mensaje editable por cliente",
                    "incluye_link_portal": True,
                    "url_media": "",
                    "activo": True,
                }
            ),
            content_type="application/json",
            **self.create_non_platform_owner_headers(),
        )

        self.assertEqual(response.status_code, 403)
        self.assertIn("administradas por BetterP", response.json()["detail"])
        self.assertFalse(
            PlantillaMensaje.objects.filter(nombre="Texto libre cliente").exists()
        )

    @override_settings(
        FRONTEND_BASE_URL="https://app.test",
        LOCK_TENANT_MESSAGE_TEMPLATES=True,
    )
    def test_envio_manual_bloquea_texto_libre_si_gobernanza_activa(self):
        plantilla = PlantillaMensaje.objects.create(
            capa_negocio=self.capa,
            nombre="Aviso aprobado",
            canal="WHATSAPP",
            tipo_plantilla="RECORDATORIO_PAGO",
            cuerpo="Hola {{cliente_nombre}}, saldo {{saldo_vivo_formato}}. {{portal_url}}",
            incluye_link_portal=True,
            whatsapp_template_name="betterp_pago_preventivo",
            whatsapp_template_language="es_MX",
            whatsapp_template_status="APROBADA",
            activo=True,
        )
        CuentaPorCobrar.objects.create(
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            concepto="Renta mayo",
            fecha_vencimiento=date(2026, 5, 10),
            monto_total=Decimal("1200.00"),
            monto_pagado=Decimal("0"),
            estatus_adeudo="PENDIENTE",
        )
        headers = self.create_non_platform_owner_headers()

        no_template_response = self.client.post(
            "/api/comunicaciones/envios/preview/",
            data=json.dumps(
                {
                    "plantilla_id": None,
                    "entidad_id": None,
                    "cliente_ids": [self.cliente.id],
                    "segmento": "CXC_ABIERTA",
                    "canal": "WHATSAPP",
                    "asunto": "",
                    "mensaje": "",
                    "incluye_link_portal": True,
                    "url_media": "",
                    "fecha_referencia": "2026-05-12",
                }
            ),
            content_type="application/json",
            **headers,
        )
        self.assertEqual(no_template_response.status_code, 400)
        self.assertIn("plantilla aprobada", no_template_response.json()["detail"])

        edited_response = self.client.post(
            "/api/comunicaciones/envios/preview/",
            data=json.dumps(
                {
                    "plantilla_id": plantilla.id,
                    "entidad_id": None,
                    "cliente_ids": [self.cliente.id],
                    "segmento": "CXC_ABIERTA",
                    "canal": "WHATSAPP",
                    "asunto": "",
                    "mensaje": "Texto editado por cliente",
                    "incluye_link_portal": True,
                    "url_media": "",
                    "fecha_referencia": "2026-05-12",
                }
            ),
            content_type="application/json",
            **headers,
        )
        self.assertEqual(edited_response.status_code, 400)
        self.assertIn("No puedes modificar", edited_response.json()["detail"])

        allowed_response = self.client.post(
            "/api/comunicaciones/envios/preview/",
            data=json.dumps(
                {
                    "plantilla_id": plantilla.id,
                    "entidad_id": None,
                    "cliente_ids": [self.cliente.id],
                    "segmento": "CXC_ABIERTA",
                    "canal": "WHATSAPP",
                    "asunto": "",
                    "mensaje": "",
                    "incluye_link_portal": True,
                    "url_media": "",
                    "fecha_referencia": "2026-05-09",
                }
            ),
            content_type="application/json",
            **headers,
        )
        self.assertEqual(allowed_response.status_code, 200)
        self.assertEqual(allowed_response.json()["total"], 1)

    def test_preview_preventivo_respeta_ventana_previa_al_vencimiento(self):
        plantilla = PlantillaMensaje.objects.create(
            capa_negocio=self.capa,
            nombre="Pago preventivo",
            canal="WHATSAPP",
            tipo_plantilla="RECORDATORIO_PAGO",
            cuerpo="Hola {{cliente_nombre}}, vence {{fecha_vencimiento_larga}}.",
            incluye_link_portal=True,
            whatsapp_template_name="betterp_pago_preventivo",
            whatsapp_template_language="es_MX",
            whatsapp_template_status="APROBADA",
            activo=True,
        )
        CuentaPorCobrar.objects.create(
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            concepto="Renta julio",
            fecha_vencimiento=date(2026, 7, 10),
            monto_total=Decimal("8500.00"),
            monto_pagado=Decimal("0"),
            estatus_adeudo="PENDIENTE",
        )

        before_due = self.client.post(
            "/api/comunicaciones/envios/preview/",
            data=json.dumps(
                {
                    "plantilla_id": plantilla.id,
                    "entidad_id": None,
                    "cliente_ids": [self.cliente.id],
                    "segmento": "CXC_ABIERTA",
                    "canal": "WHATSAPP",
                    "asunto": "",
                    "mensaje": "",
                    "incluye_link_portal": True,
                    "url_media": "",
                    "fecha_referencia": "2026-07-09",
                }
            ),
            content_type="application/json",
            **self.auth_headers,
        )
        after_due = self.client.post(
            "/api/comunicaciones/envios/preview/",
            data=json.dumps(
                {
                    "plantilla_id": plantilla.id,
                    "entidad_id": None,
                    "cliente_ids": [self.cliente.id],
                    "segmento": "CXC_ABIERTA",
                    "canal": "WHATSAPP",
                    "asunto": "",
                    "mensaje": "",
                    "incluye_link_portal": True,
                    "url_media": "",
                    "fecha_referencia": "2026-07-11",
                }
            ),
            content_type="application/json",
            **self.auth_headers,
        )

        self.assertEqual(before_due.status_code, 200)
        self.assertEqual(before_due.json()["total"], 1)
        self.assertEqual(after_due.status_code, 200)
        self.assertEqual(after_due.json()["total"], 0)

    def test_preview_gracia_solo_sale_dentro_de_periodo_de_gracia(self):
        self.capa.dias_gracia_default = 3
        self.capa.save(update_fields=["dias_gracia_default"])
        plantilla = PlantillaMensaje.objects.create(
            capa_negocio=self.capa,
            nombre="Pago en gracia",
            canal="WHATSAPP",
            tipo_plantilla="RECORDATORIO_PAGO",
            cuerpo="Hola {{cliente_nombre}}, limite {{fecha_limite_gracia_larga}}.",
            incluye_link_portal=True,
            whatsapp_template_name="betterp_pago_gracia",
            whatsapp_template_language="es_MX",
            whatsapp_template_status="APROBADA",
            activo=True,
        )
        CuentaPorCobrar.objects.create(
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            concepto="Renta julio",
            fecha_vencimiento=date(2026, 7, 10),
            monto_total=Decimal("8500.00"),
            monto_pagado=Decimal("0"),
            estatus_adeudo="PENDIENTE",
        )

        premature = self.client.post(
            "/api/comunicaciones/envios/preview/",
            data=json.dumps(
                {
                    "plantilla_id": plantilla.id,
                    "entidad_id": None,
                    "cliente_ids": [self.cliente.id],
                    "segmento": "CXC_ABIERTA",
                    "canal": "WHATSAPP",
                    "asunto": "",
                    "mensaje": "",
                    "incluye_link_portal": True,
                    "url_media": "",
                    "fecha_referencia": "2026-07-09",
                }
            ),
            content_type="application/json",
            **self.auth_headers,
        )
        in_grace = self.client.post(
            "/api/comunicaciones/envios/preview/",
            data=json.dumps(
                {
                    "plantilla_id": plantilla.id,
                    "entidad_id": None,
                    "cliente_ids": [self.cliente.id],
                    "segmento": "CXC_ABIERTA",
                    "canal": "WHATSAPP",
                    "asunto": "",
                    "mensaje": "",
                    "incluye_link_portal": True,
                    "url_media": "",
                    "fecha_referencia": "2026-07-12",
                }
            ),
            content_type="application/json",
            **self.auth_headers,
        )
        after_grace = self.client.post(
            "/api/comunicaciones/envios/preview/",
            data=json.dumps(
                {
                    "plantilla_id": plantilla.id,
                    "entidad_id": None,
                    "cliente_ids": [self.cliente.id],
                    "segmento": "CXC_ABIERTA",
                    "canal": "WHATSAPP",
                    "asunto": "",
                    "mensaje": "",
                    "incluye_link_portal": True,
                    "url_media": "",
                    "fecha_referencia": "2026-07-14",
                }
            ),
            content_type="application/json",
            **self.auth_headers,
        )

        self.assertEqual(premature.status_code, 200)
        self.assertEqual(premature.json()["total"], 0)
        self.assertEqual(in_grace.status_code, 200)
        self.assertEqual(in_grace.json()["total"], 1)
        self.assertEqual(after_grace.status_code, 200)
        self.assertEqual(after_grace.json()["total"], 0)

    def test_preview_vence_hoy_solo_sale_en_fecha_exacta(self):
        plantilla = PlantillaMensaje.objects.create(
            capa_negocio=self.capa,
            nombre="Pago vence hoy",
            canal="WHATSAPP",
            tipo_plantilla="RECORDATORIO_PAGO",
            cuerpo="Hola {{cliente_nombre}}, vence {{fecha_vencimiento_larga}}.",
            incluye_link_portal=True,
            whatsapp_template_name="betterp_pago_vence_hoy",
            whatsapp_template_language="es_MX",
            whatsapp_template_status="APROBADA",
            activo=True,
        )
        CuentaPorCobrar.objects.create(
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            concepto="Renta julio",
            fecha_vencimiento=date(2026, 7, 10),
            monto_total=Decimal("8500.00"),
            monto_pagado=Decimal("0"),
            estatus_adeudo="PENDIENTE",
        )

        def preview_for(fecha: str):
            return self.client.post(
                "/api/comunicaciones/envios/preview/",
                data=json.dumps(
                    {
                        "plantilla_id": plantilla.id,
                        "entidad_id": None,
                        "cliente_ids": [self.cliente.id],
                        "segmento": "CXC_ABIERTA",
                        "canal": "WHATSAPP",
                        "asunto": "",
                        "mensaje": "",
                        "incluye_link_portal": True,
                        "url_media": "",
                        "fecha_referencia": fecha,
                    }
                ),
                content_type="application/json",
                **self.auth_headers,
            )

        before_due = preview_for("2026-07-09")
        due_day = preview_for("2026-07-10")
        after_due = preview_for("2026-07-11")

        self.assertEqual(before_due.status_code, 200)
        self.assertEqual(before_due.json()["total"], 0)
        self.assertEqual(due_day.status_code, 200)
        self.assertEqual(due_day.json()["total"], 1)
        self.assertEqual(after_due.status_code, 200)
        self.assertEqual(after_due.json()["total"], 0)

    def test_preview_recargo_solo_sale_despues_de_gracia(self):
        self.capa.dias_gracia_default = 3
        self.capa.save(update_fields=["dias_gracia_default"])
        plantilla = PlantillaMensaje.objects.create(
            capa_negocio=self.capa,
            nombre="Pago con recargo",
            canal="WHATSAPP",
            tipo_plantilla="RECORDATORIO_PAGO",
            cuerpo="Hola {{cliente_nombre}}, total {{total_exigible_formato}}.",
            incluye_link_portal=True,
            whatsapp_template_name="betterp_pago_atraso_avanzado",
            whatsapp_template_language="es_MX",
            whatsapp_template_status="APROBADA",
            activo=True,
        )
        CuentaPorCobrar.objects.create(
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            concepto="Renta julio",
            fecha_vencimiento=date(2026, 7, 10),
            monto_total=Decimal("8500.00"),
            monto_pagado=Decimal("0"),
            estatus_adeudo="PENDIENTE",
        )

        def preview_for(fecha: str):
            return self.client.post(
                "/api/comunicaciones/envios/preview/",
                data=json.dumps(
                    {
                        "plantilla_id": plantilla.id,
                        "entidad_id": None,
                        "cliente_ids": [self.cliente.id],
                        "segmento": "CXC_ABIERTA",
                        "canal": "WHATSAPP",
                        "asunto": "",
                        "mensaje": "",
                        "incluye_link_portal": True,
                        "url_media": "",
                        "fecha_referencia": fecha,
                    }
                ),
                content_type="application/json",
                **self.auth_headers,
            )

        due_day = preview_for("2026-07-10")
        grace_limit = preview_for("2026-07-13")
        after_grace = preview_for("2026-07-14")

        self.assertEqual(due_day.status_code, 200)
        self.assertEqual(due_day.json()["total"], 0)
        self.assertEqual(grace_limit.status_code, 200)
        self.assertEqual(grace_limit.json()["total"], 0)
        self.assertEqual(after_grace.status_code, 200)
        self.assertEqual(after_grace.json()["total"], 1)

    @override_settings(DISABLE_OUTBOUND_INTEGRATIONS=True)
    def test_acuerdo_whatsapp_bloquea_envios_y_automatizaciones_hasta_aceptar(self):
        AcuerdoUsoComunicacion.objects.filter(capa_negocio=self.capa).delete()
        config = ConfiguracionComunicacion.objects.create(
            capa_negocio=self.capa,
            clave="PRINCIPAL",
        )
        plantilla = PlantillaMensaje.objects.create(
            capa_negocio=self.capa,
            nombre="Aviso legal",
            canal="WHATSAPP",
            tipo_plantilla="RECORDATORIO_PAGO",
            cuerpo="Hola {{cliente_nombre}}, saldo {{saldo_vivo_formato}}",
            incluye_link_portal=False,
            whatsapp_template_name="betterp_pago_preventivo",
            whatsapp_template_language="es_MX",
            whatsapp_template_status="APROBADA",
            activo=True,
        )
        CuentaPorCobrar.objects.create(
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            concepto="Renta julio",
            fecha_vencimiento=date(2026, 7, 10),
            monto_total=Decimal("1200.00"),
            monto_pagado=Decimal("0"),
            estatus_adeudo="PENDIENTE",
        )

        agreement_response = self.client.get(
            "/api/comunicaciones/acuerdos/whatsapp-numero-compartido/",
            **self.auth_headers,
        )
        self.assertEqual(agreement_response.status_code, 200)
        self.assertFalse(agreement_response.json()["accepted"])
        self.assertIn("responsabilidad", agreement_response.json()["agreement"]["texto"])

        blocked_send = self.client.post(
            "/api/comunicaciones/envios/masivo/",
            data=json.dumps(
                {
                    "plantilla_id": plantilla.id,
                    "entidad_id": None,
                    "cliente_ids": [self.cliente.id],
                    "segmento": "CXC_ABIERTA",
                    "canal": "WHATSAPP",
                    "asunto": "",
                    "mensaje": "",
                    "incluye_link_portal": False,
                    "url_media": "",
                    "fecha_referencia": "2026-07-10",
                }
            ),
            content_type="application/json",
            **self.auth_headers,
        )
        self.assertEqual(blocked_send.status_code, 403)
        self.assertIn("acuerdo de uso", blocked_send.json()["detail"])
        self.assertFalse(HistorialEnvio.objects.exists())

        blocked_rule = self.client.post(
            "/api/comunicaciones/automatizaciones/",
            data=json.dumps(
                {
                    "nombre": "Preventivo bloqueado",
                    "descripcion": "",
                    "plantilla_id": plantilla.id,
                    "entidad_id": None,
                    "canal": "WHATSAPP",
                    "evento_base": "FECHA_VENCIMIENTO",
                    "desplazamiento_dias": 0,
                    "segmento": "POR_VENCER",
                    "activo": True,
                }
            ),
            content_type="application/json",
            **self.auth_headers,
        )
        self.assertEqual(blocked_rule.status_code, 403)
        self.assertFalse(
            ReglaAutomatizacionMensaje.objects.filter(
                nombre="Preventivo bloqueado"
            ).exists()
        )

        incomplete_acceptance = self.client.post(
            "/api/comunicaciones/acuerdos/whatsapp-numero-compartido/aceptar/",
            data=json.dumps(
                {
                    "acepta_contacto_autorizado": True,
                    "acepta_datos_correctos": True,
                    "acepta_politicas_whatsapp": False,
                    "acepta_suspension_por_riesgo": True,
                }
            ),
            content_type="application/json",
            **self.auth_headers,
        )
        self.assertEqual(incomplete_acceptance.status_code, 400)
        self.assertFalse(AcuerdoUsoComunicacion.objects.filter(capa_negocio=self.capa).exists())

        accepted_response = self.client.post(
            "/api/comunicaciones/acuerdos/whatsapp-numero-compartido/aceptar/",
            data=json.dumps(
                {
                    "acepta_contacto_autorizado": True,
                    "acepta_datos_correctos": True,
                    "acepta_politicas_whatsapp": True,
                    "acepta_suspension_por_riesgo": True,
                }
            ),
            content_type="application/json",
            **self.auth_headers,
        )
        self.assertEqual(accepted_response.status_code, 200)
        self.assertTrue(accepted_response.json()["accepted"])
        acceptance = AcuerdoUsoComunicacion.objects.get(capa_negocio=self.capa)
        self.assertEqual(acceptance.aceptado_por_id, self.user.id)
        self.assertEqual(acceptance.texto_hash, whatsapp_shared_number_agreement_hash())
        self.assertTrue(
            EventoAuditoria.objects.filter(
                accion="WHATSAPP_SHARED_NUMBER_TERMS_ACCEPTED",
                capa_negocio=self.capa,
                recurso_id=str(acceptance.id),
            ).exists()
        )

        allowed_rule = self.client.post(
            "/api/comunicaciones/automatizaciones/",
            data=json.dumps(
                {
                    "nombre": "Preventivo permitido",
                    "descripcion": "",
                    "plantilla_id": plantilla.id,
                    "entidad_id": None,
                    "canal": "WHATSAPP",
                    "evento_base": "FECHA_VENCIMIENTO",
                    "desplazamiento_dias": 0,
                    "segmento": "POR_VENCER",
                    "activo": True,
                }
            ),
            content_type="application/json",
            **self.auth_headers,
        )
        self.assertEqual(allowed_rule.status_code, 200)
        self.assertTrue(
            ReglaAutomatizacionMensaje.objects.filter(
                configuracion_relacionada=config,
                nombre="Preventivo permitido",
                activo=True,
            ).exists()
        )

    @override_settings(
        OUTBOUND_WHATSAPP_ALLOWED_NUMBERS=["525512345678"],
        COBRANZA_TEST_LAB_ENABLED=True,
        COBRANZA_TEST_LAB_ALLOWED_EMAILS=["01.agodinez@gmail.com"],
        COBRANZA_TEST_LAB_ALLOWED_CAPAS=["Maya Coliving"],
    )
    def test_monitoreo_reporta_laboratorio_solo_para_usuario_y_capa_autorizados(self):
        self.activar_plan(
            modulos=["cobranza"],
            funciones=["whatsapp_automation"],
        )

        response = self.client.get(
            "/api/comunicaciones/automatizaciones-monitoreo/",
            **self.auth_headers,
        )

        self.assertEqual(response.status_code, 200)
        lab = response.json()["modo_seguro"]["laboratorio_cobranza"]
        self.assertFalse(lab["habilitado"])
        self.assertFalse(lab["usuario_autorizado"])
        self.assertTrue(lab["capa_autorizada"])

        self.user.username = "01.agodinez@gmail.com"
        self.user.email = "01.agodinez@gmail.com"
        self.user.save(update_fields=["username", "email"])

        authorized_response = self.client.get(
            "/api/comunicaciones/automatizaciones-monitoreo/",
            **self.auth_headers,
        )

        self.assertEqual(authorized_response.status_code, 200)
        authorized_lab = authorized_response.json()["modo_seguro"][
            "laboratorio_cobranza"
        ]
        self.assertTrue(authorized_lab["habilitado"])
        self.assertTrue(authorized_lab["usuario_autorizado"])
        self.assertTrue(authorized_lab["capa_autorizada"])
        self.assertEqual(authorized_lab["capa_actual"], "Maya Coliving")

    @override_settings(
        DISABLE_OUTBOUND_INTEGRATIONS=True,
        OUTBOUND_WHATSAPP_ALLOWED_NUMBERS=["525512345678"],
        COBRANZA_TEST_LAB_ENABLED=True,
        COBRANZA_TEST_LAB_ALLOWED_EMAILS=["01.agodinez@gmail.com"],
        COBRANZA_TEST_LAB_ALLOWED_CAPAS=["Maya Coliving"],
    )
    def test_envio_manual_whatsapp_en_allowlist_bloquea_fuera_del_laboratorio(self):
        self.activar_plan(
            modulos=["cobranza"],
            funciones=["whatsapp_automation"],
        )
        plantilla = PlantillaMensaje.objects.create(
            capa_negocio=self.capa,
            nombre="Aviso sandbox",
            canal="WHATSAPP",
            tipo_plantilla="RECORDATORIO_PAGO",
            cuerpo="Hola {{cliente_nombre}}, saldo {{saldo_vivo_formato}}",
            incluye_link_portal=False,
            whatsapp_template_name="betterp_pago_preventivo",
            whatsapp_template_language="es_MX",
            whatsapp_template_status="APROBADA",
            activo=True,
        )

        response = self.client.post(
            "/api/comunicaciones/envios/masivo/",
            data=json.dumps(
                {
                    "plantilla_id": plantilla.id,
                    "entidad_id": None,
                    "cliente_ids": [self.cliente.id],
                    "segmento": "CXC_ABIERTA",
                    "canal": "WHATSAPP",
                    "asunto": "",
                    "mensaje": "",
                    "incluye_link_portal": False,
                    "url_media": "",
                    "fecha_referencia": "2026-07-10",
                }
            ),
            content_type="application/json",
            **self.auth_headers,
        )

        self.assertEqual(response.status_code, 403)
        self.assertIn("laboratorio de cobranza", response.json()["detail"])
        self.assertFalse(HistorialEnvio.objects.exists())

    @override_settings(
        DISABLE_OUTBOUND_INTEGRATIONS=False,
        OUTBOUND_WHATSAPP_ALLOWED_NUMBERS=["525551087058"],
        COBRANZA_TEST_LAB_ENABLED=True,
        COBRANZA_TEST_LAB_ALLOWED_EMAILS=["01.agodinez@gmail.com"],
        COBRANZA_TEST_LAB_ALLOWED_CAPAS=["Maya Coliving"],
    )
    def test_laboratorio_whatsapp_envia_prueba_segura_con_plantilla_aprobada(self):
        self.activar_plan(
            modulos=["cobranza"],
            funciones=["whatsapp_automation"],
        )
        self.user.username = "01.agodinez@gmail.com"
        self.user.email = "01.agodinez@gmail.com"
        self.user.save(update_fields=["username", "email"])
        plantilla = PlantillaMensaje.objects.create(
            capa_negocio=self.capa,
            nombre="Preventivo laboratorio",
            canal="WHATSAPP",
            tipo_plantilla="RECORDATORIO_PAGO",
            cuerpo="Hola {{cliente_nombre}}, referencia {{referencia_pago}}",
            incluye_link_portal=True,
            whatsapp_template_name="betterp_pago_preventivo",
            whatsapp_template_language="es_MX",
            whatsapp_template_status="APROBADA",
            activo=True,
        )

        with patch(
            "comunicaciones.outbound_api.send_whatsapp_message",
            return_value={
                "provider": "META_CLOUD_API",
                "messages": [{"id": "wamid.lab-ok"}],
                "contacts": [{"input": "525551087058", "wa_id": "525551087058"}],
            },
        ) as send_mock:
            response = self.client.post(
                "/api/comunicaciones/laboratorio/whatsapp-prueba/",
                data=json.dumps(
                    {
                        "plantilla_id": plantilla.id,
                        "numero_destino": "525551087058",
                    }
                ),
                content_type="application/json",
                **self.auth_headers,
            )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body["success"])
        self.assertEqual(body["destino"], "525551087058")
        send_kwargs = send_mock.call_args.kwargs
        self.assertEqual(send_kwargs["template_name"], "betterp_pago_preventivo")
        self.assertEqual(send_kwargs["template_language"], "es_MX")
        self.assertEqual(send_kwargs["template_parameters"][1], "BETT-DEMO-001")
        self.assertFalse(send_kwargs["enforce_allowed_numbers"])
        history = HistorialEnvio.objects.get()
        self.assertEqual(history.estatus, "ENVIADO")
        self.assertEqual(history.referencia_envio, "wamid.lab-ok")
        self.assertTrue(history.metadata["laboratorio_cobranza"])

    @override_settings(
        DISABLE_OUTBOUND_INTEGRATIONS=False,
        OUTBOUND_WHATSAPP_ALLOWED_NUMBERS=["525551087058"],
        COBRANZA_TEST_LAB_ENABLED=True,
        COBRANZA_TEST_LAB_ALLOWED_EMAILS=["01.agodinez@gmail.com"],
        COBRANZA_TEST_LAB_ALLOWED_CAPAS=["Maya Coliving"],
    )
    def test_laboratorio_whatsapp_permite_contacto_demo_autorizado(self):
        self.activar_plan(
            modulos=["cobranza"],
            funciones=["whatsapp_automation"],
        )
        self.user.username = "01.agodinez@gmail.com"
        self.user.email = "01.agodinez@gmail.com"
        self.user.save(update_fields=["username", "email"])
        plantilla = PlantillaMensaje.objects.create(
            capa_negocio=self.capa,
            nombre="Vence hoy demo externo",
            canal="WHATSAPP",
            tipo_plantilla="RECORDATORIO_PAGO",
            cuerpo=(
                "Hola {{cliente_nombre}}, referencia {{referencia_pago}}. "
                "Portal {{portal_url}}"
            ),
            incluye_link_portal=True,
            whatsapp_template_name="betterp_pago_vence_hoy",
            whatsapp_template_language="es_MX",
            whatsapp_template_status="APROBADA",
            activo=True,
        )

        contact_response = self.client.post(
            "/api/comunicaciones/laboratorio/contactos-whatsapp/",
            data=json.dumps(
                {
                    "nombre": "Invitado Demo",
                    "telefono": "+52 55 9999 8888",
                    "consentimiento_confirmado": True,
                }
            ),
            content_type="application/json",
            **self.auth_headers,
        )

        self.assertEqual(contact_response.status_code, 200)
        self.assertEqual(
            contact_response.json()["telefono_normalizado"],
            "525599998888",
        )
        self.assertTrue(
            ContactoPruebaWhatsapp.objects.filter(
                capa_negocio=self.capa,
                telefono_normalizado="525599998888",
                activo=True,
            ).exists()
        )

        monitoring_response = self.client.get(
            "/api/comunicaciones/automatizaciones-monitoreo/",
            **self.auth_headers,
        )
        self.assertEqual(monitoring_response.status_code, 200)
        safe_numbers = monitoring_response.json()["modo_seguro"][
            "numeros_whatsapp_permitidos"
        ]
        self.assertIn("525599998888", safe_numbers)

        with patch(
            "comunicaciones.outbound_api.send_whatsapp_message",
            return_value={
                "provider": "META_CLOUD_API",
                "messages": [{"id": "wamid.demo-contact"}],
                "contacts": [{"input": "525599998888", "wa_id": "525599998888"}],
            },
        ) as send_mock:
            response = self.client.post(
                "/api/comunicaciones/laboratorio/whatsapp-prueba/",
                data=json.dumps(
                    {
                        "plantilla_id": plantilla.id,
                        "numero_destino": "525599998888",
                    }
                ),
                content_type="application/json",
                **self.auth_headers,
            )

        self.assertEqual(response.status_code, 200)
        response_payload = response.json()
        self.assertEqual(response_payload["destino"], "525599998888")
        self.assertIn("Invitado Demo", response_payload["preview"])
        self.assertIn("/portal-cliente/", response_payload["preview"])
        self.assertNotIn("/portal-cliente/demo", response_payload["preview"])
        self.assertEqual(send_mock.call_args.kwargs["chat_id"], "525599998888")
        self.assertFalse(send_mock.call_args.kwargs["enforce_allowed_numbers"])
        self.assertEqual(
            send_mock.call_args.kwargs["template_parameters"][0],
            "Invitado Demo",
        )
        self.assertIn(
            "/portal-cliente/",
            send_mock.call_args.kwargs["template_parameters"][2],
        )
        lab_client = Cliente.objects.get(identificador__startswith="LAB-WA-")
        self.assertEqual(lab_client.nombre_comercial, "Invitado Demo")
        self.assertEqual(lab_client.codigo_pais, "+52")
        self.assertEqual(lab_client.telefono, "5599998888")
        history = HistorialEnvio.objects.get()
        self.assertEqual(history.cliente_relacionado_id, lab_client.id)
        self.assertEqual(history.destinatario, "525599998888")
        self.assertEqual(history.referencia_envio, "wamid.demo-contact")

        token = build_portal_token(cliente=lab_client, horas=48)
        with patch(
            "comunicaciones.outbound_api.send_whatsapp_message",
            return_value={
                "provider": "META_CLOUD_API",
                "messages": [{"id": "wamid.portal-otp"}],
                "contacts": [{"input": "525599998888", "wa_id": "525599998888"}],
            },
        ) as otp_send_mock:
            otp_response = self.client.post(
                f"/api/comunicaciones/portal/{token}/otp/request/"
            )

        self.assertEqual(otp_response.status_code, 200, otp_response.content)
        otp_kwargs = otp_send_mock.call_args.kwargs
        self.assertEqual(
            re.sub(r"\D", "", otp_kwargs["chat_id"]).replace("521", "52", 1),
            "525599998888",
        )
        self.assertFalse(otp_kwargs["enforce_allowed_numbers"])

    @override_settings(
        OUTBOUND_WHATSAPP_ALLOWED_NUMBERS=["525551087058"],
        COBRANZA_TEST_LAB_ENABLED=True,
        COBRANZA_TEST_LAB_ALLOWED_EMAILS=["01.agodinez@gmail.com"],
        COBRANZA_TEST_LAB_ALLOWED_CAPAS=["Maya Coliving"],
    )
    def test_laboratorio_whatsapp_rechaza_numero_fuera_de_allowlist(self):
        self.activar_plan(
            modulos=["cobranza"],
            funciones=["whatsapp_automation"],
        )
        self.user.username = "01.agodinez@gmail.com"
        self.user.email = "01.agodinez@gmail.com"
        self.user.save(update_fields=["username", "email"])
        plantilla = PlantillaMensaje.objects.create(
            capa_negocio=self.capa,
            nombre="Vence hoy laboratorio",
            canal="WHATSAPP",
            tipo_plantilla="RECORDATORIO_PAGO",
            cuerpo="Hola {{cliente_nombre}}",
            whatsapp_template_name="betterp_pago_vence_hoy",
            whatsapp_template_language="es_MX",
            whatsapp_template_status="APROBADA",
            activo=True,
        )

        with patch("comunicaciones.outbound_api.send_whatsapp_message") as send_mock:
            response = self.client.post(
                "/api/comunicaciones/laboratorio/whatsapp-prueba/",
                data=json.dumps(
                    {
                        "plantilla_id": plantilla.id,
                        "numero_destino": "5217771305454",
                    }
                ),
                content_type="application/json",
                **self.auth_headers,
            )

        self.assertEqual(response.status_code, 400)
        self.assertIn("no esta permitido", response.json()["detail"])
        send_mock.assert_not_called()
        self.assertFalse(HistorialEnvio.objects.exists())




    @override_settings(FRONTEND_BASE_URL="https://app.test")
    def test_preview_envio_manual_por_cliente_directo(self):
        plantilla = PlantillaMensaje.objects.create(
            capa_negocio=self.capa,
            nombre="Aviso manual",
            canal="WHATSAPP",
            tipo_plantilla="MENSAJE_PERSONALIZADO",
            cuerpo=(
                "Hola {{cliente_nombre}}, periodo {{periodo_pago}}, "
                "saldo {{saldo_vivo_formato}}. "
                "{{portal_url}}"
            ),
            incluye_link_portal=True,
            activo=True,
        )
        cuenta = CuentaPorCobrar.objects.create(
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            concepto="Renta mayo",
            fecha_periodo_inicio=date(2026, 5, 1),
            fecha_periodo_fin=date(2026, 5, 31),
            fecha_vencimiento=date(2026, 5, 10),
            monto_total=Decimal("1200.00"),
            monto_pagado=Decimal("0"),
            estatus_adeudo="PENDIENTE",
        )

        response = self.client.post(
            "/api/comunicaciones/envios/preview/",
            data=json.dumps(
                {
                    "plantilla_id": plantilla.id,
                    "entidad_id": None,
                    "cliente_ids": [self.cliente.id],
                    "segmento": "CXC_ABIERTA",
                    "canal": "WHATSAPP",
                    "asunto": "",
                    "mensaje": (
                        "Hola {{cliente_nombre}}, vence el "
                        "{{fecha_vencimiento_larga}}, periodo {{periodo_pago}}, "
                        "debes {{saldo_vivo_formato}}. {{portal_url}}"
                    ),
                    "incluye_link_portal": True,
                    "url_media": "",
                    "fecha_referencia": "2026-05-12",
                }
            ),
            content_type="application/json",
            **self.auth_headers,
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["total"], 1)
        self.assertEqual(body["items"][0]["cliente_id"], self.cliente.id)
        self.assertEqual(body["items"][0]["referencia_pago"], f"BETT-{self.cliente.id:05d}")
        self.assertEqual(body["items"][0]["fecha_vencimiento"], "10/05/2026")
        self.assertIn("Daniel Muller", body["items"][0]["mensaje"])
        self.assertIn("10 de Mayo del 2026", body["items"][0]["mensaje"])
        self.assertIn("Mayo 2026", body["items"][0]["mensaje"])
        self.assertIn("https://app.test/portal-cliente/", body["items"][0]["mensaje"])

    def test_preview_envio_no_consulta_facturas_por_cuenta(self):
        plantilla = PlantillaMensaje.objects.create(
            capa_negocio=self.capa,
            nombre="Aviso sin factura",
            canal="WHATSAPP",
            tipo_plantilla="MENSAJE_PERSONALIZADO",
            cuerpo="Hola {{cliente_nombre}}, saldo {{saldo_vivo_formato}}.",
            incluye_link_portal=False,
            activo=True,
        )
        CuentaPorCobrar.objects.create(
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            concepto="Renta mayo",
            fecha_vencimiento=date(2026, 5, 10),
            monto_total=Decimal("1200.00"),
            monto_pagado=Decimal("0"),
            estatus_adeudo="PENDIENTE",
        )

        with patch("finanzas.services.cxc_invoice_summary") as invoice_summary:
            response = self.client.post(
                "/api/comunicaciones/envios/preview/",
                data=json.dumps(
                    {
                        "plantilla_id": plantilla.id,
                        "entidad_id": None,
                        "cliente_ids": [self.cliente.id],
                        "segmento": "CXC_ABIERTA",
                        "canal": "WHATSAPP",
                        "asunto": "",
                        "mensaje": "",
                        "incluye_link_portal": False,
                        "url_media": "",
                        "fecha_referencia": "2026-05-12",
                    }
                ),
                content_type="application/json",
                **self.auth_headers,
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["total"], 1)
        invoice_summary.assert_not_called()

    @override_settings(FRONTEND_BASE_URL="https://app.test")
    def test_preview_aviso_atraso_incluye_recargo_y_total_exigible(self):
        self.capa.dias_gracia_default = 3
        self.capa.save(update_fields=["dias_gracia_default"])
        ReglaMarcoNegocio.objects.create(
            capa_negocio=self.capa,
            nombre="Interes moratorio",
            tipo_calculo="PORCENTAJE_RECARGO",
            valor=Decimal("10"),
            periodicidad="MENSUAL",
            aplica_a_todos=True,
            dias_condicion=3,
        )
        plantilla = PlantillaMensaje.objects.create(
            capa_negocio=self.capa,
            nombre="Atraso con recargo",
            canal="WHATSAPP",
            tipo_plantilla="AVISO_INTERES",
            cuerpo=(
                "Periodo {{periodo_pago}}. Saldo {{saldo_vivo_formato}}. "
                "Cargos {{recargo_total_formato}}. "
                "Calculo {{recargo_descripcion}}. "
                "Total {{total_exigible_formato}}."
            ),
            incluye_link_portal=True,
            activo=True,
        )
        CuentaPorCobrar.objects.create(
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            concepto="Renta mayo",
            fecha_periodo_inicio=date(2026, 5, 1),
            fecha_periodo_fin=date(2026, 5, 31),
            fecha_vencimiento=date(2026, 5, 1),
            monto_total=Decimal("1000.00"),
            monto_pagado=Decimal("0"),
            estatus_adeudo="VENCIDO",
        )

        response = self.client.post(
            "/api/comunicaciones/envios/preview/",
            data=json.dumps(
                {
                    "plantilla_id": plantilla.id,
                    "entidad_id": None,
                    "cliente_ids": [self.cliente.id],
                    "segmento": "VENCIDA_CON_RECARGO",
                    "canal": "WHATSAPP",
                    "asunto": "",
                    "mensaje": "",
                    "incluye_link_portal": True,
                    "url_media": "",
                    "fecha_referencia": "2026-05-10",
                }
            ),
            content_type="application/json",
            **self.auth_headers,
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["total"], 1)
        message = body["items"][0]["mensaje"]
        self.assertIn("Mayo 2026", message)
        self.assertIn("$1.000,00", message)
        self.assertIn("$100,00", message)
        self.assertIn("10% sobre saldo vencido", message)
        self.assertIn("$1.100,00", message)

    def test_envio_manual_sin_destinatarios_no_reporta_exito(self):
        plantilla = PlantillaMensaje.objects.create(
            capa_negocio=self.capa,
            nombre="Aviso sin cuentas",
            canal="WHATSAPP",
            tipo_plantilla="MENSAJE_PERSONALIZADO",
            cuerpo="Hola {{cliente_nombre}}",
            activo=True,
        )

        response = self.client.post(
            "/api/comunicaciones/envios/masivo/",
            data=json.dumps(
                {
                    "plantilla_id": plantilla.id,
                    "entidad_id": None,
                    "cliente_ids": [self.cliente.id],
                    "segmento": "CXC_ABIERTA",
                    "canal": "WHATSAPP",
                    "asunto": "",
                    "mensaje": "Hola {{cliente_nombre}}",
                    "incluye_link_portal": False,
                    "url_media": "",
                    "fecha_referencia": "2026-05-12",
                }
            ),
            content_type="application/json",
            **self.auth_headers,
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("No hay destinatarios", response.json()["detail"])
        self.assertFalse(HistorialEnvio.objects.exists())

    @override_settings(DISABLE_OUTBOUND_INTEGRATIONS=True)
    def test_envio_manual_guarda_contexto_operativo_en_historial(self):
        plantilla = PlantillaMensaje.objects.create(
            capa_negocio=self.capa,
            nombre="Aviso con referencia",
            canal="WHATSAPP",
            tipo_plantilla="MENSAJE_PERSONALIZADO",
            cuerpo="Hola {{cliente_nombre}}, referencia {{referencia_pago}}",
            incluye_link_portal=True,
            activo=True,
        )
        CuentaPorCobrar.objects.create(
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            concepto="Renta junio",
            fecha_vencimiento=date(2026, 6, 10),
            monto_total=Decimal("1800.00"),
            monto_pagado=Decimal("0"),
            estatus_adeudo="PENDIENTE",
        )

        response = self.client.post(
            "/api/comunicaciones/envios/masivo/",
            data=json.dumps(
                {
                    "plantilla_id": plantilla.id,
                    "entidad_id": None,
                    "cliente_ids": [self.cliente.id],
                    "segmento": "CXC_ABIERTA",
                    "canal": "WHATSAPP",
                    "asunto": "",
                    "mensaje": "",
                    "incluye_link_portal": True,
                    "url_media": "",
                    "fecha_referencia": "2026-06-01",
                }
            ),
            content_type="application/json",
            **self.auth_headers,
        )

        self.assertEqual(response.status_code, 200)
        history = HistorialEnvio.objects.get()
        self.assertIn(f"BETT-{self.cliente.id:05d}", history.cuerpo_renderizado)
        self.assertEqual(history.metadata["referencia_pago"], f"BETT-{self.cliente.id:05d}")
        self.assertEqual(history.metadata["total_exigible"], 1800.0)

        history_response = self.client.get(
            "/api/comunicaciones/historial-envios/",
            **self.auth_headers,
        )
        self.assertEqual(history_response.status_code, 200)
        body = history_response.json()[0]
        self.assertIn("cuerpo_renderizado", body)
        self.assertEqual(body["metadata"]["referencia_pago"], f"BETT-{self.cliente.id:05d}")

    def test_historial_envios_filtra_por_canal_y_estatus(self):
        config = ConfiguracionComunicacion.objects.create(
            capa_negocio=self.capa,
            clave="PRINCIPAL",
        )
        HistorialEnvio.objects.create(
            configuracion_relacionada=config,
            cliente_relacionado=self.cliente,
            entidad_relacionada=self.entidad,
            canal="WHATSAPP",
            tipo_envio="MANUAL",
            proveedor="META_CLOUD_API",
            destinatario="5215512345678",
            estatus="ERROR",
        )
        HistorialEnvio.objects.create(
            configuracion_relacionada=config,
            cliente_relacionado=self.cliente,
            entidad_relacionada=self.entidad,
            canal="EMAIL",
            tipo_envio="MANUAL",
            proveedor="RESEND",
            destinatario="daniel@test.com",
            estatus="ENTREGADO",
        )

        response = self.client.get(
            "/api/comunicaciones/historial-envios/",
            {"canal": "EMAIL", "estatus": "ENTREGADO"},
            **self.auth_headers,
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(len(body), 1)
        self.assertEqual(body[0]["canal"], "EMAIL")
        self.assertEqual(body[0]["estatus"], "ENTREGADO")

    def test_historial_envios_busca_por_cliente_destino_y_referencia(self):
        config = ConfiguracionComunicacion.objects.create(
            capa_negocio=self.capa,
            clave="PRINCIPAL",
        )
        HistorialEnvio.objects.create(
            configuracion_relacionada=config,
            cliente_relacionado=self.cliente,
            entidad_relacionada=self.entidad,
            canal="WHATSAPP",
            tipo_envio="MANUAL",
            proveedor="META_CLOUD_API",
            destinatario="5215512345678",
            cuerpo_renderizado="Hola Daniel, referencia BETT-BUSCAR-001",
            referencia_envio="wamid.buscar.001",
            estatus="ENVIADO",
        )
        HistorialEnvio.objects.create(
            configuracion_relacionada=config,
            cliente_relacionado=self.cliente,
            entidad_relacionada=self.entidad,
            canal="EMAIL",
            tipo_envio="MANUAL",
            proveedor="RESEND",
            destinatario="otro@test.com",
            cuerpo_renderizado="Mensaje distinto",
            referencia_envio="email_otro",
            estatus="ENVIADO",
        )

        response = self.client.get(
            "/api/comunicaciones/historial-envios/",
            {"busqueda": "BETT-BUSCAR-001"},
            **self.auth_headers,
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(len(body), 1)
        self.assertEqual(body[0]["referencia_envio"], "wamid.buscar.001")

    def test_historial_envios_filtra_por_rango_de_fechas(self):
        config = ConfiguracionComunicacion.objects.create(
            capa_negocio=self.capa,
            clave="PRINCIPAL",
        )
        antiguo = HistorialEnvio.objects.create(
            configuracion_relacionada=config,
            cliente_relacionado=self.cliente,
            entidad_relacionada=self.entidad,
            canal="EMAIL",
            tipo_envio="MANUAL",
            proveedor="RESEND",
            destinatario="antiguo@test.com",
            estatus="ENVIADO",
        )
        reciente = HistorialEnvio.objects.create(
            configuracion_relacionada=config,
            cliente_relacionado=self.cliente,
            entidad_relacionada=self.entidad,
            canal="EMAIL",
            tipo_envio="MANUAL",
            proveedor="RESEND",
            destinatario="reciente@test.com",
            estatus="ENVIADO",
        )
        HistorialEnvio.objects.filter(id=antiguo.id).update(
            fecha_envio=datetime(2026, 5, 1, 12, tzinfo=timezone.get_current_timezone())
        )
        HistorialEnvio.objects.filter(id=reciente.id).update(
            fecha_envio=datetime(2026, 5, 20, 12, tzinfo=timezone.get_current_timezone())
        )

        response = self.client.get(
            "/api/comunicaciones/historial-envios/",
            {"fecha_desde": "2026-05-15", "fecha_hasta": "2026-05-31"},
            **self.auth_headers,
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(len(body), 1)
        self.assertEqual(body[0]["destinatario"], "reciente@test.com")

    def test_historial_envios_permite_marcar_revision_operativa(self):
        config = ConfiguracionComunicacion.objects.create(
            capa_negocio=self.capa,
            clave="PRINCIPAL",
        )
        history = HistorialEnvio.objects.create(
            configuracion_relacionada=config,
            cliente_relacionado=self.cliente,
            entidad_relacionada=self.entidad,
            canal="WHATSAPP",
            tipo_envio="AUTOMATICO",
            proveedor="META_CLOUD_API",
            destinatario="5215512345678",
            estatus="ENVIADO",
            metadata={"referencia_pago": "BETT-REV-001"},
        )

        response = self.client.post(
            f"/api/comunicaciones/historial-envios/{history.id}/revisar/",
            data=json.dumps({"nota": "Revisado en piloto"}),
            content_type="application/json",
            **self.auth_headers,
        )

        self.assertEqual(response.status_code, 200)
        history.refresh_from_db()
        review = history.metadata["revision_operativa"]
        self.assertEqual(review["note"], "Revisado en piloto")
        self.assertEqual(review["reviewed_by_email"], self.user.email)
        body = response.json()
        self.assertTrue(body["success"])
        self.assertEqual(
            body["historial"]["metadata"]["revision_operativa"]["note"],
            "Revisado en piloto",
        )
        self.assertEqual(
            body["historial"]["revision_operativa"]["reviewed_by_email"],
            self.user.email,
        )

    @override_settings(DISABLE_OUTBOUND_INTEGRATIONS=True)
    def test_dispatch_precarga_clientes_y_llaves_idempotencia(self):
        config = ConfiguracionComunicacion.objects.create(
            capa_negocio=self.capa,
            clave="PRINCIPAL",
        )
        plantilla = PlantillaMensaje.objects.create(
            capa_negocio=self.capa,
            nombre="Preventivo bulk",
            canal="WHATSAPP",
            tipo_plantilla="RECORDATORIO_PAGO",
            cuerpo="Hola {{cliente_nombre}}, referencia {{referencia_pago}}",
            incluye_link_portal=True,
            whatsapp_template_name="betterp_pago_preventivo",
            whatsapp_template_language="es_MX",
            whatsapp_template_status="APROBADA",
            activo=True,
        )
        segundo_cliente = Cliente.objects.create(
            entidad_relacionada=self.entidad,
            razon_social="Ana Lopez",
            nombre_comercial="Ana Lopez",
            telefono="5511112222",
            correo_principal="ana@test.com",
        )
        preview_items = [
            {
                "cliente_id": self.cliente.id,
                "canales": ["WHATSAPP"],
                "destinos": ["5215512345678@c.us"],
                "asunto": "",
                "mensaje": "Hola Daniel",
                "url_media": None,
                "segmento": "POR_VENCER",
                "portal_url": "https://app.test/portal-cliente/demo",
                "referencia_pago": f"BETT-{self.cliente.id:05d}",
                "cxc_ids": [101],
                "primary_cxc_id": 101,
                "total_exigible": 1200.0,
                "fecha_vencimiento": "10/05/2026",
                "fecha_limite_gracia": "15/05/2026",
                "whatsapp_template_name": "betterp_pago_preventivo",
                "whatsapp_template_language": "es_MX",
                "whatsapp_template_status": "APROBADA",
                "whatsapp_template_parameters": ["Daniel"],
            },
            {
                "cliente_id": segundo_cliente.id,
                "canales": ["WHATSAPP"],
                "destinos": ["521551112222@c.us"],
                "asunto": "",
                "mensaje": "Hola Ana",
                "url_media": None,
                "segmento": "POR_VENCER",
                "portal_url": "https://app.test/portal-cliente/demo",
                "referencia_pago": f"BETT-{segundo_cliente.id:05d}",
                "cxc_ids": [102],
                "primary_cxc_id": 102,
                "total_exigible": 1900.0,
                "fecha_vencimiento": "10/05/2026",
                "fecha_limite_gracia": "15/05/2026",
                "whatsapp_template_name": "betterp_pago_preventivo",
                "whatsapp_template_language": "es_MX",
                "whatsapp_template_status": "APROBADA",
                "whatsapp_template_parameters": ["Ana"],
            },
        ]

        with self.assertNumQueries(7):
            result = dispatch_preview_items(
                config=config,
                template=plantilla,
                automation=None,
                preview_items=preview_items,
                send_type="AUTOMATICO",
                dedupe_prefix="auto:test:2026-05-10",
            )

        self.assertEqual(result["sent"], 2)
        self.assertEqual(result["skipped"], 0)
        self.assertEqual(HistorialEnvio.objects.filter(estatus="ENVIADO").count(), 2)

    @override_settings(
        DISABLE_OUTBOUND_INTEGRATIONS=False,
        OUTBOUND_SEND_RETRY_BASE_SECONDS=0,
    )
    def test_dispatch_reintenta_error_transitorio_de_whatsapp(self):
        config = ConfiguracionComunicacion.objects.create(
            capa_negocio=self.capa,
            clave="PRINCIPAL",
        )
        plantilla = PlantillaMensaje.objects.create(
            capa_negocio=self.capa,
            nombre="Preventivo retry",
            canal="WHATSAPP",
            tipo_plantilla="RECORDATORIO_PAGO",
            cuerpo="Hola {{cliente_nombre}}, referencia {{referencia_pago}}",
            incluye_link_portal=True,
            whatsapp_template_name="betterp_pago_preventivo",
            whatsapp_template_language="es_MX",
            whatsapp_template_status="APROBADA",
            activo=True,
        )
        preview_items = [
            {
                "cliente_id": self.cliente.id,
                "canales": ["WHATSAPP"],
                "destinos": ["5215512345678@c.us"],
                "asunto": "",
                "mensaje": "Hola Daniel",
                "url_media": None,
                "segmento": "POR_VENCER",
                "portal_url": "https://app.test/portal-cliente/demo",
                "referencia_pago": f"BETT-{self.cliente.id:05d}",
                "cxc_ids": [101],
                "primary_cxc_id": 101,
                "total_exigible": 1200.0,
                "fecha_vencimiento": "10/05/2026",
                "fecha_limite_gracia": "15/05/2026",
                "whatsapp_template_name": "betterp_pago_preventivo",
                "whatsapp_template_language": "es_MX",
                "whatsapp_template_status": "APROBADA",
                "whatsapp_template_parameters": ["Daniel"],
            }
        ]

        with patch(
            "comunicaciones.outbound.send_whatsapp_message",
            side_effect=[
                requests.Timeout("timeout proveedor"),
                {
                    "provider": "META_CLOUD_API",
                    "messages": [{"id": "wamid.retry-ok"}],
                    "contacts": [],
                },
            ],
        ) as send_mock:
            result = dispatch_preview_items(
                config=config,
                template=plantilla,
                automation=None,
                preview_items=preview_items,
                send_type="AUTOMATICO",
                dedupe_prefix="auto:retry:2026-05-10",
            )

        self.assertEqual(send_mock.call_count, 2)
        self.assertEqual(result["sent"], 1)
        self.assertEqual(result["errors"], [])
        history = HistorialEnvio.objects.get()
        self.assertEqual(history.estatus, "ENVIADO")
        self.assertEqual(history.referencia_envio, "wamid.retry-ok")
        self.assertEqual(history.metadata["attempts"], 2)
        self.assertEqual(history.metadata["reintentos"], 1)

    @override_settings(
        DISABLE_OUTBOUND_INTEGRATIONS=False,
        OUTBOUND_WHATSAPP_ALLOWED_NUMBERS=["525551087058"],
    )
    def test_dispatch_omite_whatsapp_fuera_de_allowlist(self):
        config = ConfiguracionComunicacion.objects.create(
            capa_negocio=self.capa,
            clave="PRINCIPAL",
        )
        segundo_cliente = Cliente.objects.create(
            entidad_relacionada=self.entidad,
            razon_social="Cliente Real",
            nombre_comercial="Cliente Real",
            rfc="REA010101AA1",
            telefono="5511122222",
            correo_principal="real@test.com",
        )
        preview_items = [
            {
                "cliente_id": self.cliente.id,
                "canales": ["WHATSAPP"],
                "destinos": ["525551087058"],
                "asunto": "",
                "mensaje": "Prueba permitida",
                "url_media": None,
                "segmento": "TODOS_ACTIVOS",
                "portal_url": "https://app.test/portal-cliente/demo",
                "referencia_pago": f"BETT-{self.cliente.id:05d}",
                "cxc_ids": [],
                "primary_cxc_id": None,
                "total_exigible": 0,
            },
            {
                "cliente_id": segundo_cliente.id,
                "canales": ["WHATSAPP"],
                "destinos": ["5215511122222@c.us"],
                "asunto": "",
                "mensaje": "No debe salir",
                "url_media": None,
                "segmento": "TODOS_ACTIVOS",
                "portal_url": "https://app.test/portal-cliente/demo",
                "referencia_pago": f"BETT-{segundo_cliente.id:05d}",
                "cxc_ids": [],
                "primary_cxc_id": None,
                "total_exigible": 0,
            },
        ]

        with patch(
            "comunicaciones.outbound.send_whatsapp_message",
            return_value={
                "provider": "META_CLOUD_API",
                "messages": [{"id": "wamid.allowed"}],
                "contacts": [],
            },
        ) as send_mock:
            result = dispatch_preview_items(
                config=config,
                template=None,
                automation=None,
                preview_items=preview_items,
                send_type="MANUAL",
            )

        self.assertEqual(result["sent"], 1)
        self.assertEqual(result["skipped"], 1)
        self.assertEqual(result["errors"], [])
        self.assertEqual(send_mock.call_count, 1)
        blocked_history = HistorialEnvio.objects.get(proveedor="SAFETY_ALLOWLIST")
        self.assertEqual(blocked_history.estatus, "OMITIDO")
        self.assertIn("fuera de allowlist", blocked_history.metadata["reason"])
        sent_history = HistorialEnvio.objects.get(estatus="ENVIADO")
        self.assertEqual(sent_history.referencia_envio, "wamid.allowed")

    @override_settings(DISABLE_OUTBOUND_INTEGRATIONS=False)
    def test_dispatch_omite_cliente_marcado_no_contactar_cobranza(self):
        self.cliente.no_contactar_cobranza = True
        self.cliente.no_contactar_cobranza_motivo = "Revoco autorizacion de contacto"
        self.cliente.no_contactar_cobranza_fecha = timezone.now()
        self.cliente.save(
            update_fields=[
                "no_contactar_cobranza",
                "no_contactar_cobranza_motivo",
                "no_contactar_cobranza_fecha",
            ]
        )
        config = ConfiguracionComunicacion.objects.create(
            capa_negocio=self.capa,
            clave="PRINCIPAL",
        )
        preview_items = [
            {
                "cliente_id": self.cliente.id,
                "canales": ["WHATSAPP"],
                "destinos": ["5215512345678@c.us"],
                "asunto": "",
                "mensaje": "No debe salir",
                "url_media": None,
                "segmento": "CXC_ABIERTA",
                "portal_url": "https://app.test/portal-cliente/demo",
                "referencia_pago": f"BETT-{self.cliente.id:05d}",
                "cxc_ids": [101],
                "primary_cxc_id": 101,
                "total_exigible": 1200.0,
            }
        ]

        with patch("comunicaciones.outbound.send_whatsapp_message") as send_mock:
            result = dispatch_preview_items(
                config=config,
                template=None,
                automation=None,
                preview_items=preview_items,
                send_type="MANUAL",
            )

        self.assertEqual(result["sent"], 0)
        self.assertEqual(result["skipped"], 1)
        self.assertEqual(result["errors"], [])
        send_mock.assert_not_called()
        history = HistorialEnvio.objects.get()
        self.assertEqual(history.estatus, "OMITIDO")
        self.assertEqual(history.proveedor, "CONTACT_POLICY")
        self.assertEqual(history.metadata["reason"], COLLECTION_NO_CONTACT_REASON)
        self.assertEqual(history.metadata["motivo"], "Revoco autorizacion de contacto")

    @override_settings(
        DISABLE_OUTBOUND_INTEGRATIONS=False,
        COLLECTION_REQUIRE_CONSENT_FOR_WHATSAPP=True,
    )
    def test_dispatch_omite_whatsapp_sin_consentimiento_de_cobranza(self):
        config = ConfiguracionComunicacion.objects.create(
            capa_negocio=self.capa,
            clave="PRINCIPAL",
        )
        plantilla = PlantillaMensaje.objects.create(
            capa_negocio=self.capa,
            nombre="Preventivo con consentimiento requerido",
            canal="WHATSAPP",
            tipo_plantilla="RECORDATORIO_PAGO",
            cuerpo="Hola {{cliente_nombre}}, revisa {{portal_url}}",
            incluye_link_portal=True,
            whatsapp_template_name="betterp_pago_preventivo",
            whatsapp_template_language="es_MX",
            whatsapp_template_status="APROBADA",
            activo=True,
        )
        preview_items = [
            {
                "cliente_id": self.cliente.id,
                "canales": ["WHATSAPP"],
                "destinos": ["5215512345678@c.us"],
                "asunto": "",
                "mensaje": "No debe salir sin consentimiento",
                "url_media": None,
                "segmento": "POR_VENCER",
                "portal_url": "https://app.test/portal-cliente/demo",
                "referencia_pago": f"BETT-{self.cliente.id:05d}",
                "cxc_ids": [101],
                "primary_cxc_id": 101,
                "total_exigible": 1200.0,
                "whatsapp_template_name": "betterp_pago_preventivo",
                "whatsapp_template_language": "es_MX",
                "whatsapp_template_status": "APROBADA",
                "whatsapp_template_parameters": ["Daniel", "https://app.test/portal"],
            }
        ]

        with patch("comunicaciones.outbound.send_whatsapp_message") as send_mock:
            result = dispatch_preview_items(
                config=config,
                template=plantilla,
                automation=None,
                preview_items=preview_items,
                send_type="MANUAL",
            )

        self.assertEqual(result["sent"], 0)
        self.assertEqual(result["skipped"], 1)
        self.assertEqual(result["errors"], [])
        send_mock.assert_not_called()
        history = HistorialEnvio.objects.get()
        self.assertEqual(history.estatus, "OMITIDO")
        self.assertEqual(history.proveedor, "CONTACT_POLICY")
        self.assertEqual(history.metadata["reason"], COLLECTION_CONSENT_REQUIRED_REASON)
        self.assertFalse(history.metadata["consentimiento_aceptado"])

    @override_settings(
        DISABLE_OUTBOUND_INTEGRATIONS=False,
        COLLECTION_REQUIRE_CONSENT_FOR_WHATSAPP=True,
    )
    def test_dispatch_permite_bienvenida_portal_sin_consentimiento(self):
        config = ConfiguracionComunicacion.objects.create(
            capa_negocio=self.capa,
            clave="PRINCIPAL",
        )
        plantilla = PlantillaMensaje.objects.create(
            capa_negocio=self.capa,
            nombre="Bienvenida portal cliente WhatsApp",
            canal="WHATSAPP",
            tipo_plantilla="PORTAL_AUTOSERVICIO",
            cuerpo=(
                "Hola {{cliente_nombre}}. Entra a {{portal_url}} para validar "
                "tu codigo y aceptar consentimiento."
            ),
            incluye_link_portal=True,
            whatsapp_template_name="betterp_portal_bienvenida",
            whatsapp_template_language="es_MX",
            whatsapp_template_status="APROBADA",
            activo=True,
        )
        plantilla_cobranza = PlantillaMensaje.objects.create(
            capa_negocio=self.capa,
            nombre="Preventivo previo",
            canal="WHATSAPP",
            tipo_plantilla="RECORDATORIO_PAGO",
            cuerpo="Hola {{cliente_nombre}}, referencia {{referencia_pago}}",
            incluye_link_portal=True,
            whatsapp_template_name="betterp_pago_preventivo",
            whatsapp_template_language="es_MX",
            whatsapp_template_status="APROBADA",
            activo=True,
        )
        previous = HistorialEnvio.objects.create(
            configuracion_relacionada=config,
            cliente_relacionado=self.cliente,
            entidad_relacionada=self.entidad,
            plantilla_usada=plantilla_cobranza,
            canal="WHATSAPP",
            tipo_envio="MANUAL",
            proveedor="META_CLOUD_API",
            destinatario="5215512345678@c.us",
            cuerpo_renderizado="Aviso de cobranza previo",
            estatus="ENVIADO",
        )
        HistorialEnvio.objects.filter(id=previous.id).update(
            fecha_envio=timezone.now() - timedelta(hours=1)
        )
        preview_items = [
            {
                "cliente_id": self.cliente.id,
                "canales": ["WHATSAPP"],
                "destinos": ["5215512345678@c.us"],
                "asunto": "",
                "mensaje": "Bienvenida al portal",
                "url_media": None,
                "segmento": "PORTAL_AUTOSERVICIO",
                "portal_url": "https://app.test/portal-cliente/demo",
                "referencia_pago": f"BETT-{self.cliente.id:05d}",
                "cxc_ids": [],
                "primary_cxc_id": None,
                "total_exigible": 0,
                "whatsapp_template_name": "betterp_portal_bienvenida",
                "whatsapp_template_language": "es_MX",
                "whatsapp_template_status": "APROBADA",
                "whatsapp_template_parameters": [
                    "Daniel",
                    "https://app.test/portal-cliente/demo",
                ],
            }
        ]

        with patch(
            "comunicaciones.outbound.send_whatsapp_message",
            return_value={
                "provider": "META_CLOUD_API",
                "messages": [{"id": "wamid.portal-welcome"}],
                "contacts": [],
            },
        ) as send_mock:
            result = dispatch_preview_items(
                config=config,
                template=plantilla,
                automation=None,
                preview_items=preview_items,
                send_type="MANUAL",
            )

        self.assertEqual(result["sent"], 1)
        self.assertEqual(result["skipped"], 0)
        self.assertEqual(result["errors"], [])
        self.assertEqual(send_mock.call_count, 1)
        history = HistorialEnvio.objects.get(referencia_envio="wamid.portal-welcome")
        self.assertEqual(history.estatus, "ENVIADO")
        self.assertEqual(history.referencia_envio, "wamid.portal-welcome")
        self.assertFalse(
            HistorialEnvio.objects.filter(
                estatus="OMITIDO",
                metadata__reason=COLLECTION_MESSAGE_COOLDOWN_REASON,
            ).exists()
        )

    @override_settings(
        DISABLE_OUTBOUND_INTEGRATIONS=False,
        OUTBOUND_WHATSAPP_ALLOWED_NUMBERS=["525551087058"],
    )
    def test_dispatch_manual_usa_plantilla_meta_aprobada(self):
        config = ConfiguracionComunicacion.objects.create(
            capa_negocio=self.capa,
            clave="PRINCIPAL",
        )
        plantilla = PlantillaMensaje.objects.create(
            capa_negocio=self.capa,
            nombre="Preventivo Meta manual",
            canal="WHATSAPP",
            tipo_plantilla="RECORDATORIO_PAGO",
            cuerpo="Hola {{cliente_nombre}}, referencia {{referencia_pago}}",
            incluye_link_portal=True,
            whatsapp_template_name="betterp_pago_preventivo",
            whatsapp_template_language="es_MX",
            whatsapp_template_status="APROBADA",
            activo=True,
        )
        preview_items = [
            {
                "cliente_id": self.cliente.id,
                "canales": ["WHATSAPP"],
                "destinos": ["525551087058"],
                "asunto": "",
                "mensaje": "Hola Daniel, referencia BETT-00001",
                "url_media": None,
                "segmento": "CXC_ABIERTA",
                "portal_url": "https://app.test/portal-cliente/demo",
                "referencia_pago": "BETT-00001",
                "whatsapp_template_name": "betterp_pago_preventivo",
                "whatsapp_template_language": "es_MX",
                "whatsapp_template_status": "APROBADA",
                "whatsapp_template_parameters": ["Daniel", "BETT-00001"],
                "cxc_ids": [],
                "primary_cxc_id": None,
                "total_exigible": 0,
            }
        ]

        with patch(
            "comunicaciones.outbound.send_whatsapp_message",
            return_value={
                "provider": "META_CLOUD_API",
                "messages": [{"id": "wamid.manual-template"}],
                "contacts": [],
            },
        ) as send_mock:
            result = dispatch_preview_items(
                config=config,
                template=plantilla,
                automation=None,
                preview_items=preview_items,
                send_type="MANUAL",
            )

        self.assertEqual(result["sent"], 1)
        self.assertEqual(result["errors"], [])
        send_kwargs = send_mock.call_args.kwargs
        self.assertEqual(send_kwargs["template_name"], "betterp_pago_preventivo")
        self.assertEqual(send_kwargs["template_language"], "es_MX")
        self.assertEqual(send_kwargs["template_parameters"], ["Daniel", "BETT-00001"])

    @override_settings(DISABLE_OUTBOUND_INTEGRATIONS=False)
    def test_dispatch_omite_cliente_contactado_dentro_de_ventana_24h(self):
        config = ConfiguracionComunicacion.objects.create(
            capa_negocio=self.capa,
            clave="PRINCIPAL",
        )
        plantilla = PlantillaMensaje.objects.create(
            capa_negocio=self.capa,
            nombre="Preventivo cooldown",
            canal="WHATSAPP",
            tipo_plantilla="RECORDATORIO_PAGO",
            cuerpo="Hola {{cliente_nombre}}, referencia {{referencia_pago}}",
            incluye_link_portal=True,
            whatsapp_template_name="betterp_pago_preventivo",
            whatsapp_template_language="es_MX",
            whatsapp_template_status="APROBADA",
            activo=True,
        )
        recent = HistorialEnvio.objects.create(
            configuracion_relacionada=config,
            cliente_relacionado=self.cliente,
            entidad_relacionada=self.entidad,
            plantilla_usada=plantilla,
            canal="EMAIL",
            tipo_envio="MANUAL",
            proveedor="RESEND",
            destinatario="daniel@test.com",
            cuerpo_renderizado="Aviso enviado por correo",
            estatus="ENVIADO",
        )
        HistorialEnvio.objects.filter(id=recent.id).update(
            fecha_envio=timezone.now() - timedelta(hours=23)
        )
        recent.refresh_from_db()
        preview_items = [
            {
                "cliente_id": self.cliente.id,
                "canales": ["WHATSAPP"],
                "destinos": ["5215512345678@c.us"],
                "asunto": "",
                "mensaje": "Hola Daniel",
                "url_media": None,
                "segmento": "CXC_ABIERTA",
                "portal_url": "https://app.test/portal-cliente/demo",
                "referencia_pago": "BETT-00001",
                "whatsapp_template_name": "betterp_pago_preventivo",
                "whatsapp_template_language": "es_MX",
                "whatsapp_template_status": "APROBADA",
                "whatsapp_template_parameters": ["Daniel", "BETT-00001"],
                "cxc_ids": [101],
                "primary_cxc_id": 101,
                "total_exigible": 1200.0,
            }
        ]

        with patch("comunicaciones.outbound.send_whatsapp_message") as send_mock:
            result = dispatch_preview_items(
                config=config,
                template=plantilla,
                automation=None,
                preview_items=preview_items,
                send_type="MANUAL",
            )

        self.assertEqual(result["sent"], 0)
        self.assertEqual(result["skipped"], 1)
        self.assertEqual(result["errors"], [])
        send_mock.assert_not_called()
        omitted = HistorialEnvio.objects.get(estatus="OMITIDO")
        self.assertEqual(omitted.metadata["reason"], COLLECTION_MESSAGE_COOLDOWN_REASON)
        self.assertEqual(omitted.metadata["last_history_id"], recent.id)
        self.assertEqual(omitted.metadata["last_channel"], "EMAIL")
        self.assertEqual(omitted.metadata["cooldown_hours"], 24)
        self.assertIn("available_after", omitted.metadata)

    @override_settings(DISABLE_OUTBOUND_INTEGRATIONS=False)
    def test_dispatch_no_bloquea_cobranza_por_otp_portal_reciente(self):
        config = ConfiguracionComunicacion.objects.create(
            capa_negocio=self.capa,
            clave="PRINCIPAL",
        )
        plantilla = PlantillaMensaje.objects.create(
            capa_negocio=self.capa,
            nombre="Preventivo despues de OTP",
            canal="WHATSAPP",
            tipo_plantilla="RECORDATORIO_PAGO",
            cuerpo="Hola {{cliente_nombre}}, referencia {{referencia_pago}}",
            incluye_link_portal=True,
            whatsapp_template_name="betterp_pago_preventivo",
            whatsapp_template_language="es_MX",
            whatsapp_template_status="APROBADA",
            activo=True,
        )
        otp_history = HistorialEnvio.objects.create(
            configuracion_relacionada=config,
            cliente_relacionado=self.cliente,
            entidad_relacionada=self.entidad,
            plantilla_usada=None,
            canal="WHATSAPP",
            tipo_envio="MANUAL",
            proveedor="META_CLOUD_API",
            destinatario="5215512345678@c.us",
            cuerpo_renderizado="Codigo de acceso al portal enviado por WhatsApp.",
            estatus="ENVIADO",
            metadata={
                "portal_otp": True,
                "template_name": "betterp_portal_otp",
            },
        )
        HistorialEnvio.objects.filter(id=otp_history.id).update(
            fecha_envio=timezone.now() - timedelta(minutes=5)
        )
        preview_items = [
            {
                "cliente_id": self.cliente.id,
                "canales": ["WHATSAPP"],
                "destinos": ["5215512345678@c.us"],
                "asunto": "",
                "mensaje": "Hola Daniel",
                "url_media": None,
                "segmento": "CXC_ABIERTA",
                "portal_url": "https://app.test/portal-cliente/demo",
                "referencia_pago": "BETT-00001",
                "whatsapp_template_name": "betterp_pago_preventivo",
                "whatsapp_template_language": "es_MX",
                "whatsapp_template_status": "APROBADA",
                "whatsapp_template_parameters": ["Daniel", "BETT-00001"],
                "cxc_ids": [101],
                "primary_cxc_id": 101,
                "total_exigible": 1200.0,
            }
        ]

        with patch(
            "comunicaciones.outbound.send_whatsapp_message",
            return_value={
                "provider": "META_CLOUD_API",
                "messages": [{"id": "wamid.after-otp"}],
                "contacts": [],
            },
        ) as send_mock:
            result = dispatch_preview_items(
                config=config,
                template=plantilla,
                automation=None,
                preview_items=preview_items,
                send_type="MANUAL",
            )

        self.assertEqual(result["sent"], 1)
        self.assertEqual(result["skipped"], 0)
        self.assertEqual(result["errors"], [])
        send_mock.assert_called_once()
        self.assertFalse(
            HistorialEnvio.objects.filter(
                estatus="OMITIDO",
                metadata__reason=COLLECTION_MESSAGE_COOLDOWN_REASON,
            ).exists()
        )

    @override_settings(DISABLE_OUTBOUND_INTEGRATIONS=False)
    def test_dispatch_permite_cliente_despues_de_24h_sin_acoso(self):
        config = ConfiguracionComunicacion.objects.create(
            capa_negocio=self.capa,
            clave="PRINCIPAL",
        )
        plantilla = PlantillaMensaje.objects.create(
            capa_negocio=self.capa,
            nombre="Preventivo cooldown vencido",
            canal="WHATSAPP",
            tipo_plantilla="RECORDATORIO_PAGO",
            cuerpo="Hola {{cliente_nombre}}, referencia {{referencia_pago}}",
            incluye_link_portal=True,
            whatsapp_template_name="betterp_pago_preventivo",
            whatsapp_template_language="es_MX",
            whatsapp_template_status="APROBADA",
            activo=True,
        )
        previous = HistorialEnvio.objects.create(
            configuracion_relacionada=config,
            cliente_relacionado=self.cliente,
            entidad_relacionada=self.entidad,
            plantilla_usada=plantilla,
            canal="WHATSAPP",
            tipo_envio="AUTOMATICO",
            proveedor="META_CLOUD_API",
            destinatario="5215512345678@c.us",
            cuerpo_renderizado="Aviso anterior",
            estatus="ENVIADO",
        )
        HistorialEnvio.objects.filter(id=previous.id).update(
            fecha_envio=timezone.now() - timedelta(hours=25)
        )
        preview_items = [
            {
                "cliente_id": self.cliente.id,
                "canales": ["WHATSAPP"],
                "destinos": ["5215512345678@c.us"],
                "asunto": "",
                "mensaje": "Hola Daniel",
                "url_media": None,
                "segmento": "CXC_ABIERTA",
                "portal_url": "https://app.test/portal-cliente/demo",
                "referencia_pago": "BETT-00001",
                "whatsapp_template_name": "betterp_pago_preventivo",
                "whatsapp_template_language": "es_MX",
                "whatsapp_template_status": "APROBADA",
                "whatsapp_template_parameters": ["Daniel", "BETT-00001"],
                "cxc_ids": [101],
                "primary_cxc_id": 101,
                "total_exigible": 1200.0,
            }
        ]

        with patch(
            "comunicaciones.outbound.send_whatsapp_message",
            return_value={
                "provider": "META_CLOUD_API",
                "messages": [{"id": "wamid.after-cooldown"}],
                "contacts": [],
            },
        ) as send_mock:
            result = dispatch_preview_items(
                config=config,
                template=plantilla,
                automation=None,
                preview_items=preview_items,
                send_type="MANUAL",
            )

        self.assertEqual(result["sent"], 1)
        self.assertEqual(result["skipped"], 0)
        self.assertEqual(result["errors"], [])
        self.assertEqual(send_mock.call_count, 1)
        self.assertFalse(HistorialEnvio.objects.filter(estatus="OMITIDO").exists())
        sent_history = HistorialEnvio.objects.get(referencia_envio="wamid.after-cooldown")
        self.assertEqual(sent_history.estatus, "ENVIADO")

    @override_settings(DISABLE_OUTBOUND_INTEGRATIONS=True)
    def test_dispatch_omite_envio_automatico_si_cuota_whatsapp_esta_agotada(self):
        plan = PlanSaaS.objects.create(
            clave="quota-whatsapp",
            nombre="Quota WhatsApp",
            modulos_habilitados=["cobranza"],
            funciones_habilitadas=["whatsapp_automation"],
            whatsapp_mensajes_incluidos=1,
            emails_incluidos=5,
        )
        SuscripcionCapa.objects.create(
            capa_negocio=self.capa,
            plan=plan,
            estatus="ACTIVA",
        )
        config = ConfiguracionComunicacion.objects.create(
            capa_negocio=self.capa,
            clave="PRINCIPAL",
        )
        plantilla = PlantillaMensaje.objects.create(
            capa_negocio=self.capa,
            nombre="Preventivo cuota",
            canal="WHATSAPP",
            tipo_plantilla="RECORDATORIO_PAGO",
            cuerpo="Hola {{cliente_nombre}}, referencia {{referencia_pago}}",
            incluye_link_portal=True,
            whatsapp_template_name="betterp_pago_preventivo",
            whatsapp_template_language="es_MX",
            whatsapp_template_status="APROBADA",
            activo=True,
        )
        cliente_consumo = Cliente.objects.create(
            entidad_relacionada=self.entidad,
            razon_social="Cliente consumo cuota",
            nombre_comercial="Cliente consumo cuota",
            rfc="CCQ010101AA1",
            telefono="5599999999",
            correo_principal="cuota@test.com",
        )
        HistorialEnvio.objects.create(
            configuracion_relacionada=config,
            cliente_relacionado=cliente_consumo,
            entidad_relacionada=self.entidad,
            plantilla_usada=plantilla,
            canal="WHATSAPP",
            tipo_envio="AUTOMATICO",
            proveedor="META_CLOUD_API",
            destinatario="525512345678",
            cuerpo_renderizado="ya enviado",
            estatus="ENVIADO",
        )
        preview_items = [
            {
                "cliente_id": self.cliente.id,
                "canales": ["WHATSAPP"],
                "destinos": ["5215512345678@c.us"],
                "asunto": "",
                "mensaje": "Hola Daniel",
                "url_media": None,
                "segmento": "POR_VENCER",
                "portal_url": "https://app.test/portal-cliente/demo",
                "referencia_pago": f"BETT-{self.cliente.id:05d}",
                "cxc_ids": [101],
                "primary_cxc_id": 101,
                "total_exigible": 1200.0,
                "fecha_vencimiento": "10/05/2026",
                "fecha_limite_gracia": "15/05/2026",
                "whatsapp_template_name": "betterp_pago_preventivo",
                "whatsapp_template_language": "es_MX",
                "whatsapp_template_status": "APROBADA",
                "whatsapp_template_parameters": ["Daniel"],
            }
        ]

        result = dispatch_preview_items(
            config=config,
            template=plantilla,
            automation=None,
            preview_items=preview_items,
            send_type="AUTOMATICO",
            dedupe_prefix="auto:quota:2026-05-10",
        )

        self.assertEqual(result["sent"], 0)
        self.assertEqual(result["skipped"], 1)
        self.assertEqual(result["errors"], [])
        omitted = HistorialEnvio.objects.get(estatus="OMITIDO")
        self.assertEqual(omitted.metadata["reason"], "Limite mensual de consumo alcanzado")
        self.assertEqual(omitted.metadata["consumo_saas"]["canal"], "WHATSAPP")
        self.assertEqual(omitted.metadata["consumo_saas"]["usado"], 1)
        self.assertEqual(omitted.metadata["consumo_saas"]["incluido"], 1)

    def test_preview_automatizaciones_muestra_candidatos_sin_enviar(self):
        config = ConfiguracionComunicacion.objects.create(
            capa_negocio=self.capa,
            clave="PRINCIPAL",
        )
        plantilla = PlantillaMensaje.objects.create(
            capa_negocio=self.capa,
            nombre="Preventivo automatico",
            canal="WHATSAPP",
            tipo_plantilla="RECORDATORIO_PAGO",
            cuerpo="Hola {{cliente_nombre}}, referencia {{referencia_pago}}",
            incluye_link_portal=True,
            activo=True,
        )
        ReglaAutomatizacionMensaje.objects.create(
            configuracion_relacionada=config,
            plantilla_relacionada=plantilla,
            nombre="Preventivo 3 dias",
            canal="WHATSAPP",
            evento_base="FECHA_VENCIMIENTO",
            desplazamiento_dias=-3,
            segmento="POR_VENCER",
            activo=True,
        )
        cuenta = CuentaPorCobrar.objects.create(
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            concepto="Renta julio",
            fecha_vencimiento=date(2026, 7, 10),
            monto_total=Decimal("2100.00"),
            monto_pagado=Decimal("0"),
            estatus_adeudo="PENDIENTE",
        )

        response = self.client.get(
            "/api/comunicaciones/automatizaciones-preview/",
            {"fecha_referencia": "2026-07-07"},
            **self.auth_headers,
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["reglas_activas"], 1)
        self.assertEqual(body["candidatos"], 1)
        self.assertEqual(body["reglas"][0]["candidatos"], 1)
        self.assertEqual(body["reglas"][0]["muestras"][0]["cliente_id"], self.cliente.id)
        self.assertFalse(HistorialEnvio.objects.exists())

    def test_preview_automatizaciones_explica_regla_sin_candidatos_por_fecha(self):
        config = ConfiguracionComunicacion.objects.create(
            capa_negocio=self.capa,
            clave="PRINCIPAL",
        )
        plantilla = PlantillaMensaje.objects.create(
            capa_negocio=self.capa,
            nombre="Preventivo automatico",
            canal="WHATSAPP",
            tipo_plantilla="RECORDATORIO_PAGO",
            cuerpo="Hola {{cliente_nombre}}, referencia {{referencia_pago}}",
            incluye_link_portal=True,
            activo=True,
        )
        ReglaAutomatizacionMensaje.objects.create(
            configuracion_relacionada=config,
            plantilla_relacionada=plantilla,
            nombre="Preventivo 3 dias",
            canal="WHATSAPP",
            evento_base="FECHA_VENCIMIENTO",
            desplazamiento_dias=-3,
            segmento="POR_VENCER",
            activo=True,
        )
        CuentaPorCobrar.objects.create(
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            concepto="Renta julio",
            fecha_vencimiento=date(2026, 7, 10),
            monto_total=Decimal("2100.00"),
            monto_pagado=Decimal("0"),
            estatus_adeudo="PENDIENTE",
        )

        response = self.client.get(
            "/api/comunicaciones/automatizaciones-preview/",
            {"fecha_referencia": "2026-07-08"},
            **self.auth_headers,
        )

        self.assertEqual(response.status_code, 200)
        rule = response.json()["reglas"][0]
        self.assertEqual(rule["candidatos"], 0)
        self.assertEqual(rule["fecha_objetivo"], "2026-07-11")
        self.assertEqual(rule["cuentas_fecha_objetivo"], 0)
        self.assertIn("No hay CxC abiertas", rule["motivo_sin_candidatos"])
        self.assertIn("desfase", rule["detalle_sin_candidatos"])
        self.assertFalse(HistorialEnvio.objects.exists())

    def test_preview_automatizaciones_reporta_error_de_regla_sin_500(self):
        self.activar_plan(
            modulos=["cobranza"],
            funciones=["whatsapp_automation"],
        )
        config = ConfiguracionComunicacion.objects.create(
            capa_negocio=self.capa,
            clave="PRINCIPAL",
        )
        plantilla = PlantillaMensaje.objects.create(
            capa_negocio=self.capa,
            nombre="Preventivo automatico",
            canal="WHATSAPP",
            tipo_plantilla="RECORDATORIO_PAGO",
            cuerpo="Hola {{cliente_nombre}}, referencia {{referencia_pago}}",
            incluye_link_portal=True,
            activo=True,
        )
        regla = ReglaAutomatizacionMensaje.objects.create(
            configuracion_relacionada=config,
            plantilla_relacionada=plantilla,
            nombre="Preventivo con error",
            canal="WHATSAPP",
            evento_base="FECHA_VENCIMIENTO",
            desplazamiento_dias=0,
            segmento="POR_VENCER",
            activo=True,
        )

        with patch(
            "comunicaciones.outbound_api.build_automation_preview",
            side_effect=ValueError("Regla mal configurada"),
        ):
            response = self.client.get(
                "/api/comunicaciones/automatizaciones-preview/",
                {"fecha_referencia": "2026-07-10"},
                **self.auth_headers,
            )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["reglas_activas"], 1)
        self.assertEqual(body["candidatos"], 0)
        self.assertEqual(body["reglas"][0]["id"], regla.id)
        self.assertEqual(body["reglas"][0]["candidatos"], 0)
        self.assertIn("Regla mal configurada", body["reglas"][0]["error"])
        self.assertEqual(body["errores"][0]["id"], regla.id)


    @override_settings(DISABLE_OUTBOUND_INTEGRATIONS=True)
    def test_automatizacion_whatsapp_exige_plantilla_meta_aprobada(self):
        config = ConfiguracionComunicacion.objects.create(
            capa_negocio=self.capa,
            clave="PRINCIPAL",
        )
        plantilla = PlantillaMensaje.objects.create(
            capa_negocio=self.capa,
            nombre="Vence hoy Meta",
            canal="WHATSAPP",
            tipo_plantilla="RECORDATORIO_PAGO",
            cuerpo="Hola {{cliente_nombre}}, referencia {{referencia_pago}}",
            incluye_link_portal=True,
            whatsapp_template_name="betterp_pago_vence_hoy",
            whatsapp_template_language="es_MX",
            whatsapp_template_status="NO_CONFIGURADA",
            activo=True,
        )
        regla = ReglaAutomatizacionMensaje.objects.create(
            configuracion_relacionada=config,
            plantilla_relacionada=plantilla,
            nombre="Dia de vencimiento",
            canal="WHATSAPP",
            evento_base="FECHA_VENCIMIENTO",
            desplazamiento_dias=0,
            segmento="POR_VENCER",
            activo=True,
        )
        cuenta = CuentaPorCobrar.objects.create(
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            concepto="Renta julio",
            fecha_vencimiento=date(2026, 7, 10),
            monto_total=Decimal("2100.00"),
            monto_pagado=Decimal("0"),
            estatus_adeudo="PENDIENTE",
        )

        result = execute_due_automations(
            config=config,
            allowed_entity_ids=[self.entidad.id],
            reference_date=date(2026, 7, 10),
        )

        self.assertEqual(result["sent"], 0)
        self.assertEqual(len(result["errors"]), 1)
        self.assertIn("plantilla Meta aprobada", result["errors"][0])
        self.assertEqual(HistorialEnvio.objects.filter(estatus="ERROR").count(), 1)

        plantilla.whatsapp_template_status = "APROBADA"
        plantilla.save(update_fields=["whatsapp_template_status"])
        HistorialEnvio.objects.all().delete()

        approved_result = execute_due_automations(
            config=config,
            allowed_entity_ids=[self.entidad.id],
            reference_date=date(2026, 7, 10),
        )

        self.assertEqual(approved_result["sent"], 1)
        self.assertEqual(approved_result["errors"], [])
        history = HistorialEnvio.objects.get()
        self.assertEqual(history.automatizacion_relacionada_id, regla.id)
        self.assertEqual(history.proveedor, "DEMO_MODE")
        self.assertEqual(history.metadata["cxc_ids"], [cuenta.id])
        self.assertEqual(history.metadata["primary_cxc_id"], cuenta.id)

    @override_settings(DISABLE_OUTBOUND_INTEGRATIONS=True)
    def test_automatizacion_respeta_limite_maximo_por_corrida(self):
        config = ConfiguracionComunicacion.objects.create(
            capa_negocio=self.capa,
            clave="PRINCIPAL",
        )
        plantilla = PlantillaMensaje.objects.create(
            capa_negocio=self.capa,
            nombre="Dia de vencimiento con limite",
            canal="WHATSAPP",
            tipo_plantilla="RECORDATORIO_PAGO",
            cuerpo="Hola {{cliente_nombre}}, referencia {{referencia_pago}}",
            incluye_link_portal=True,
            whatsapp_template_name="betterp_pago_vence_hoy",
            whatsapp_template_language="es_MX",
            whatsapp_template_status="APROBADA",
            activo=True,
        )
        ReglaAutomatizacionMensaje.objects.create(
            configuracion_relacionada=config,
            plantilla_relacionada=plantilla,
            nombre="Dia de vencimiento limitado",
            canal="WHATSAPP",
            evento_base="FECHA_VENCIMIENTO",
            desplazamiento_dias=0,
            segmento="POR_VENCER",
            activo=True,
        )
        segundo_cliente = Cliente.objects.create(
            entidad_relacionada=self.entidad,
            razon_social="Ana Lopez",
            nombre_comercial="Ana Lopez",
            telefono="5511112222",
            correo_principal="ana@test.com",
        )
        CuentaPorCobrar.objects.create(
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            concepto="Renta julio",
            fecha_vencimiento=date(2026, 7, 10),
            monto_total=Decimal("2100.00"),
            monto_pagado=Decimal("0"),
            estatus_adeudo="PENDIENTE",
        )
        CuentaPorCobrar.objects.create(
            entidad_relacionada=self.entidad,
            cliente_relacionado=segundo_cliente,
            concepto="Renta julio",
            fecha_vencimiento=date(2026, 7, 10),
            monto_total=Decimal("1900.00"),
            monto_pagado=Decimal("0"),
            estatus_adeudo="PENDIENTE",
        )

        result = execute_due_automations(
            config=config,
            allowed_entity_ids=[self.entidad.id],
            reference_date=date(2026, 7, 10),
            max_sends=1,
        )

        self.assertEqual(result["sent"], 1)
        self.assertEqual(result["skipped"], 1)
        self.assertTrue(result["limit_reached"])
        self.assertEqual(HistorialEnvio.objects.filter(estatus="ENVIADO").count(), 1)
        omitted = HistorialEnvio.objects.get(estatus="OMITIDO")
        self.assertEqual(
            omitted.metadata["reason"],
            "Limite maximo de envios por corrida alcanzado",
        )
        self.assertEqual(omitted.metadata["max_sends"], 1)

    def test_monitoreo_automatizaciones_resume_cron_y_actividad_de_capa(self):
        subscription = self.activar_plan(
            modulos=["cobranza"],
            funciones=["whatsapp_automation"],
        )
        subscription.plan.whatsapp_mensajes_incluidos = 10
        subscription.plan.emails_incluidos = 20
        subscription.plan.save(
            update_fields=["whatsapp_mensajes_incluidos", "emails_incluidos"]
        )
        config = ConfiguracionComunicacion.objects.create(
            capa_negocio=self.capa,
            clave="PRINCIPAL",
        )
        plantilla = PlantillaMensaje.objects.create(
            capa_negocio=self.capa,
            nombre="Preventivo monitoreo",
            canal="WHATSAPP",
            tipo_plantilla="RECORDATORIO_PAGO",
            cuerpo="Hola {{cliente_nombre}}, referencia {{referencia_pago}}",
            incluye_link_portal=True,
            whatsapp_template_name="betterp_pago_preventivo",
            whatsapp_template_language="es_MX",
            whatsapp_template_status="APROBADA",
            activo=True,
        )
        regla = ReglaAutomatizacionMensaje.objects.create(
            configuracion_relacionada=config,
            plantilla_relacionada=plantilla,
            nombre="Preventivo monitoreo",
            canal="WHATSAPP",
            evento_base="FECHA_VENCIMIENTO",
            desplazamiento_dias=0,
            segmento="POR_VENCER",
            activo=True,
        )
        HistorialEnvio.objects.create(
            configuracion_relacionada=config,
            cliente_relacionado=self.cliente,
            entidad_relacionada=self.entidad,
            plantilla_usada=plantilla,
            automatizacion_relacionada=regla,
            canal="WHATSAPP",
            tipo_envio="AUTOMATICO",
            proveedor="META_CLOUD_API",
            destinatario="525512345678",
            cuerpo_renderizado="ok",
            estatus="ENVIADO",
        )
        HistorialEnvio.objects.create(
            configuracion_relacionada=config,
            cliente_relacionado=self.cliente,
            entidad_relacionada=self.entidad,
            plantilla_usada=plantilla,
            automatizacion_relacionada=regla,
            canal="WHATSAPP",
            tipo_envio="AUTOMATICO",
            proveedor="META_CLOUD_API",
            destinatario="525512345678",
            cuerpo_renderizado="error",
            metadata={"error": "Meta rechazo el envio"},
            estatus="ERROR",
        )
        otra_capa = CapaNegocio.objects.create(nombre="Otra capa", tipo_capa="OPERADORA")
        otra_entidad = EntidadNegocio.objects.create(
            capa_negocio=otra_capa,
            nombre_comercial="Otra entidad",
            tipo_fecha_corte="INDIVIDUAL",
        )
        otro_cliente = Cliente.objects.create(
            entidad_relacionada=otra_entidad,
            razon_social="Cliente externo",
            telefono="5599999999",
        )
        HistorialEnvio.objects.create(
            cliente_relacionado=otro_cliente,
            entidad_relacionada=otra_entidad,
            canal="WHATSAPP",
            tipo_envio="AUTOMATICO",
            proveedor="META_CLOUD_API",
            destinatario="525599999999",
            cuerpo_renderizado="otro error",
            estatus="ERROR",
        )
        now = timezone.now()
        CronRunLog.objects.create(
            key="payment_reminders",
            name="Recordatorios de cobranza",
            status="SUCCESS",
            started_at=now - timedelta(minutes=8),
            finished_at=now - timedelta(minutes=7),
            duration_ms=1200,
            summary="Global: no debe exponerse a tenant.",
            metadata={"sent": 20, "skipped": 3, "fecha": "2026-07-10"},
        )

        response = self.client.get(
            "/api/comunicaciones/automatizaciones-monitoreo/",
            **self.auth_headers,
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["status"], "ERROR")
        self.assertEqual(body["cron"]["status"], "OK")
        self.assertTrue(body["cron"]["last_run"]["global_run"])
        self.assertTrue(body["cron"]["last_run"]["includes_current_layer"])
        self.assertEqual(body["cron"]["last_run"]["coverage"], "GLOBAL_LEGACY")
        self.assertIsNone(body["cron"]["last_run"]["summary"])
        self.assertEqual(body["actividad"]["total_24h"], 2)
        self.assertEqual(body["actividad"]["errores_24h"], 1)
        self.assertEqual(body["actividad"]["whatsapp_7d"], 2)
        self.assertEqual(body["reglas"]["activas"], 1)
        self.assertEqual(body["reglas"]["whatsapp_activas"], 1)
        self.assertEqual(body["reglas"]["actividad_7d"][0]["id"], regla.id)
        self.assertEqual(body["reglas"]["actividad_7d"][0]["total_7d"], 2)
        self.assertEqual(body["reglas"]["actividad_7d"][0]["errores_7d"], 1)
        self.assertEqual(body["plantillas"]["whatsapp_aprobadas"], 1)
        self.assertEqual(body["consumo"]["WHATSAPP"]["usado"], 1)
        self.assertEqual(body["consumo"]["WHATSAPP"]["incluido"], 10)
        self.assertEqual(body["consumo"]["EMAIL"]["incluido"], 20)
        self.assertEqual(len(body["errores_recientes"]), 1)
        self.assertEqual(body["errores_recientes"][0]["cliente_nombre"], "Daniel Muller")
        action_titles = {item["titulo"] for item in body["acciones_operativas"]}
        self.assertIn("Atender errores de proveedor", action_titles)
        self.assertIn("sent", body["cron"]["last_run"]["metadata"])

    def test_onboarding_cobranza_persiste_cierre_y_responsable(self):
        self.activar_plan(
            modulos=["cobranza"],
            funciones=["whatsapp_automation"],
        )

        response = self.client.post(
            "/api/comunicaciones/onboarding-cobranza/cerrar/",
            data=json.dumps(
                {
                    "progreso": 100,
                    "pasos_completos": 6,
                    "pasos_totales": 6,
                    "bloqueantes": [],
                    "pasos": [
                        {"titulo": "Validar cartera CxC", "ok": True},
                        {"titulo": "Confirmar plantillas Meta", "ok": True},
                    ],
                }
            ),
            content_type="application/json",
            **self.auth_headers,
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body["onboarding"]["closed"])
        self.assertEqual(body["onboarding"]["closed_by_email"], "admin@maya.test")
        self.assertEqual(body["onboarding"]["progress"], 100)
        agreement = AcuerdoUsoComunicacion.objects.get(
            capa_negocio=self.capa,
            tipo_acuerdo="COBRANZA_ONBOARDING_REVIEW",
        )
        self.assertEqual(agreement.aceptado_por, self.user)
        state = agreement.metadata
        self.assertEqual(state["completed_steps"], 6)
        self.assertEqual(state["steps"][0]["titulo"], "Validar cartera CxC")

        monitoring = self.client.get(
            "/api/comunicaciones/automatizaciones-monitoreo/",
            **self.auth_headers,
        )

        self.assertEqual(monitoring.status_code, 200)
        monitoring_body = monitoring.json()
        self.assertTrue(monitoring_body["onboarding"]["closed"])
        self.assertEqual(
            monitoring_body["onboarding"]["closed_by_email"],
            "admin@maya.test",
        )
        self.assertEqual(monitoring_body["onboarding"]["completed_steps"], 6)

    def test_onboarding_cobranza_reabre_revision(self):
        self.activar_plan(modulos=["cobranza"])
        agreement = AcuerdoUsoComunicacion.objects.create(
            capa_negocio=self.capa,
            aceptado_por=self.user,
            tipo_acuerdo="COBRANZA_ONBOARDING_REVIEW",
            version="2026-06-19",
            titulo="Cierre operativo del onboarding de cobranza",
            texto_hash=hashlib.sha256(
                b"COBRANZA_ONBOARDING_REVIEW:2026-06-19"
            ).hexdigest(),
            metadata={
                "closed_at": timezone.now().isoformat(),
                "closed_by_email": "admin@maya.test",
                "progress": 100,
                "completed_steps": 6,
                "total_steps": 6,
            },
        )

        response = self.client.post(
            "/api/comunicaciones/onboarding-cobranza/reabrir/",
            **self.auth_headers,
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertFalse(body["onboarding"]["closed"])
        self.assertIsNotNone(body["onboarding"]["reopened_at"])
        agreement.refresh_from_db()
        state = agreement.metadata
        self.assertIsNone(state["closed_at"])
        self.assertEqual(state["reopened_by_email"], "admin@maya.test")

    def test_monitoreo_automatizaciones_usa_corrida_relevante_de_capa(self):
        self.activar_plan(
            modulos=["cobranza"],
            funciones=["whatsapp_automation"],
        )
        ConfiguracionComunicacion.objects.create(
            capa_negocio=self.capa,
            clave="PRINCIPAL",
        )
        otra_capa = CapaNegocio.objects.create(nombre="Otra capa", tipo_capa="OPERADORA")
        now = timezone.now()
        relevant = CronRunLog.objects.create(
            key="payment_reminders",
            name="Recordatorios de cobranza",
            status="SUCCESS",
            started_at=now - timedelta(minutes=20),
            finished_at=now - timedelta(minutes=19),
            duration_ms=900,
            metadata={
                "fecha": "2026-07-10",
                "capas": [
                    {
                        "capa_id": self.capa.id,
                        "sent": 3,
                        "skipped": 1,
                        "errors": 0,
                        "rules": 2,
                        "candidates": 4,
                        "limit_reached": False,
                    }
                ],
            },
        )
        CronRunLog.objects.create(
            key="payment_reminders",
            name="Recordatorios de cobranza",
            status="SUCCESS",
            started_at=now - timedelta(minutes=5),
            finished_at=now - timedelta(minutes=4),
            duration_ms=700,
            summary="Otra capa procesada.",
            metadata={
                "fecha": "2026-07-10",
                "capa_id": otra_capa.id,
                "sent": 9,
                "skipped": 0,
                "errors": 0,
            },
        )

        response = self.client.get(
            "/api/comunicaciones/automatizaciones-monitoreo/",
            **self.auth_headers,
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["cron"]["status"], "OK")
        self.assertEqual(body["cron"]["last_run"]["id"], relevant.id)
        self.assertEqual(body["cron"]["last_run"]["coverage"], "GLOBAL_DETALLADO")
        self.assertTrue(body["cron"]["last_run"]["global_run"])
        self.assertTrue(body["cron"]["last_run"]["includes_current_layer"])
        self.assertEqual(body["cron"]["last_run"]["layer_summary"]["sent"], 3)
        self.assertIn("Enviados: 3", body["cron"]["last_run"]["summary"])

    @patch("comunicaciones.outbound_api.requests.get")
    def test_sincronizar_plantillas_meta_actualiza_estados(self, mock_get):
        self.activar_plan(
            modulos=["cobranza"],
            funciones=["whatsapp_automation"],
        )
        CanalWhatsappOficial.objects.create(
            capa_negocio=self.capa,
            nombre="WhatsApp BetterP",
            display_phone_number="+52 1 777 130 5454",
            phone_number_id="1202915306230305",
            business_account_id="1388411406494147",
            waba_id="1388411406494147",
            access_token="meta-token",
            estado="CONECTADO",
            es_principal=True,
        )
        preventivo = PlantillaMensaje.objects.create(
            capa_negocio=self.capa,
            nombre="Meta preventivo",
            canal="WHATSAPP",
            tipo_plantilla="RECORDATORIO_PAGO",
            cuerpo="Hola {{cliente_nombre}}",
            whatsapp_template_name="betterp_pago_preventivo",
            whatsapp_template_language="es_MX",
            whatsapp_template_status="EN_REVISION",
            activo=True,
        )
        gracia = PlantillaMensaje.objects.create(
            capa_negocio=self.capa,
            nombre="Meta gracia",
            canal="WHATSAPP",
            tipo_plantilla="AVISO_INTERES",
            cuerpo="Hola {{cliente_nombre}}",
            whatsapp_template_name="betterp_pago_gracia",
            whatsapp_template_language="es_MX",
            whatsapp_template_status="NO_CONFIGURADA",
            activo=True,
        )

        class FakeMetaResponse:
            ok = True
            status_code = 200
            text = "{}"

            def json(self):
                return {
                    "data": [
                        {
                            "name": "betterp_pago_preventivo",
                            "language": "es_MX",
                            "status": "ACTIVE: QUALITY_PENDING",
                            "category": "UTILITY",
                        },
                        {
                            "name": "betterp_pago_gracia",
                            "language": "es_MX",
                            "status": "PENDING",
                            "category": "UTILITY",
                        },
                    ]
                }

        mock_get.return_value = FakeMetaResponse()

        response = self.client.post(
            "/api/comunicaciones/plantillas/sincronizar-meta/",
            **self.auth_headers,
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body["success"])
        self.assertEqual(body["meta_total"], 2)
        self.assertGreaterEqual(body["actualizadas"], 2)
        preventivo.refresh_from_db()
        gracia.refresh_from_db()
        self.assertEqual(preventivo.whatsapp_template_status, "APROBADA")
        self.assertEqual(preventivo.whatsapp_template_category, "UTILITY")
        self.assertEqual(gracia.whatsapp_template_status, "EN_REVISION")
        self.assertIn("Sincronizada con Meta", preventivo.whatsapp_template_notes)
        mock_get.assert_called_once()

    @override_settings(
        WHATSAPP_META_APP_ID="1485048503111527",
        WHATSAPP_CLOUD_API_BASE_URL="https://graph.facebook.com",
        WHATSAPP_CLOUD_API_VERSION="v25.0",
    )
    @patch("comunicaciones.api.requests.get")
    def test_verificar_suscripcion_waba_meta_guarda_estado(self, mock_get):
        self.activar_plan(
            modulos=["cobranza"],
            funciones=["whatsapp_automation"],
        )
        canal = CanalWhatsappOficial.objects.create(
            capa_negocio=self.capa,
            nombre="WhatsApp BetterP",
            display_phone_number="+52 1 777 130 5454",
            phone_number_id="1202915306230305",
            business_account_id="1388411406494147",
            waba_id="1388411406494147",
            access_token="meta-token",
            estado="CONECTADO",
            es_principal=True,
        )

        class FakeMetaResponse:
            ok = True
            status_code = 200
            text = "{}"

            def json(self):
                return {
                    "data": [
                        {
                            "id": "1485048503111527",
                            "name": "BetterP Comunicaciones",
                            "link": "https://developers.facebook.com/apps/1485048503111527/",
                        }
                    ]
                }

        mock_get.return_value = FakeMetaResponse()

        response = self.client.get(
            "/api/comunicaciones/configuracion/whatsapp-cloud/waba-subscription/",
            **self.auth_headers,
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body["suscrita"])
        self.assertEqual(body["waba_id"], "1388411406494147")
        self.assertEqual(body["app_id_esperada"], "1485048503111527")
        mock_get.assert_called_once()
        called_url = mock_get.call_args.args[0]
        self.assertIn("/v25.0/1388411406494147/subscribed_apps", called_url)
        canal.refresh_from_db()
        self.assertTrue(canal.metadata["waba_subscription"]["suscrita"])

    @override_settings(
        WHATSAPP_META_APP_ID="1485048503111527",
        WHATSAPP_CLOUD_API_BASE_URL="https://graph.facebook.com",
        WHATSAPP_CLOUD_API_VERSION="v25.0",
    )
    @patch("comunicaciones.api.requests.get")
    @patch("comunicaciones.api.requests.post")
    def test_alinear_suscripcion_waba_meta_suscribe_y_reconsulta(
        self,
        mock_post,
        mock_get,
    ):
        self.activar_plan(
            modulos=["cobranza"],
            funciones=["whatsapp_automation"],
        )
        canal = CanalWhatsappOficial.objects.create(
            capa_negocio=self.capa,
            nombre="WhatsApp BetterP",
            display_phone_number="+52 1 777 130 5454",
            phone_number_id="1202915306230305",
            business_account_id="1388411406494147",
            waba_id="1388411406494147",
            access_token="meta-token",
            estado="CONECTADO",
            es_principal=True,
        )

        class FakePostResponse:
            ok = True
            status_code = 200
            text = "{}"

            def json(self):
                return {"success": True}

        class FakeGetResponse:
            ok = True
            status_code = 200
            text = "{}"

            def json(self):
                return {
                    "data": [
                        {
                            "id": "1485048503111527",
                            "name": "BetterP Comunicaciones",
                        }
                    ]
                }

        mock_post.return_value = FakePostResponse()
        mock_get.return_value = FakeGetResponse()

        response = self.client.post(
            "/api/comunicaciones/configuracion/whatsapp-cloud/waba-subscription/",
            **self.auth_headers,
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body["suscrita"])
        self.assertEqual(body["accion"], {"success": True})
        mock_post.assert_called_once()
        mock_get.assert_called_once()
        canal.refresh_from_db()
        self.assertTrue(canal.metadata["waba_subscription"]["suscrita"])

    def test_preparacion_whatsapp_cuenta_solo_plantillas_meta_configuradas(self):
        self.activar_plan(
            modulos=["cobranza"],
            funciones=["whatsapp_automation"],
        )
        templates_response = self.client.get(
            "/api/comunicaciones/plantillas/",
            **self.auth_headers,
        )
        self.assertEqual(templates_response.status_code, 200)
        PlantillaMensaje.objects.create(
            capa_negocio=self.capa,
            nombre="Plantilla WhatsApp interna sin Meta",
            canal="WHATSAPP",
            tipo_plantilla="RECORDATORIO_PAGO",
            cuerpo="Hola {{cliente_nombre}}",
            whatsapp_template_name="",
            activo=True,
        )

        response = self.client.get(
            "/api/comunicaciones/configuracion/",
            **self.auth_headers,
        )

        self.assertEqual(response.status_code, 200)
        whatsapp = response.json()["whatsapp_cloud"]
        self.assertEqual(whatsapp["produccion_preparacion"]["plantillas_whatsapp"], 6)
        checklist_by_id = {item["id"]: item for item in whatsapp["produccion_checklist"]}
        self.assertEqual(
            checklist_by_id["plantillas_aprobadas"]["detalle"],
            "0 aprobada(s) de 6 configurada(s).",
        )

    def test_monitoreo_cuenta_solo_plantillas_meta_configuradas(self):
        self.activar_plan(
            modulos=["cobranza"],
            funciones=["whatsapp_automation"],
        )
        CanalWhatsappOficial.objects.create(
            capa_negocio=self.capa,
            nombre="WhatsApp BetterP",
            display_phone_number="+52 1 777 130 5454",
            phone_number_id="1202915306230305",
            business_account_id="1388411406494147",
            waba_id="1388411406494147",
            access_token="meta-token",
            estado="CONECTADO",
            es_principal=True,
            fecha_ultimo_check=timezone.now(),
            metadata={
                "templates_last_sync": "2026-06-18T16:25:00+00:00",
                "templates_seen": 7,
            },
        )
        templates_response = self.client.get(
            "/api/comunicaciones/plantillas/",
            **self.auth_headers,
        )
        self.assertEqual(templates_response.status_code, 200)
        PlantillaMensaje.objects.filter(
            capa_negocio=self.capa,
            canal__in=["WHATSAPP", "AMBOS"],
            whatsapp_template_name__isnull=False,
        ).exclude(whatsapp_template_name="").update(whatsapp_template_status="APROBADA")
        PlantillaMensaje.objects.create(
            capa_negocio=self.capa,
            nombre="Plantilla WhatsApp interna sin Meta",
            canal="WHATSAPP",
            tipo_plantilla="RECORDATORIO_PAGO",
            cuerpo="Hola {{cliente_nombre}}",
            whatsapp_template_name="",
            activo=True,
        )

        response = self.client.get(
            "/api/comunicaciones/automatizaciones-monitoreo/",
            **self.auth_headers,
        )

        self.assertEqual(response.status_code, 200)
        template_summary = response.json()["plantillas"]
        self.assertEqual(template_summary["whatsapp_total"], 6)
        self.assertEqual(template_summary["whatsapp_aprobadas"], 6)
        self.assertEqual(template_summary["whatsapp_pendientes"], 0)
        self.assertEqual(template_summary["ultima_sincronizacion_meta"], "2026-06-18T16:25:00+00:00")
        self.assertEqual(template_summary["meta_total_visto"], 7)
        self.assertEqual(template_summary["canal_meta"]["nombre"], "WhatsApp BetterP")
        self.assertEqual(len(template_summary["whatsapp_detalle"]), 6)
        self.assertEqual(
            template_summary["whatsapp_por_estado"],
            [{"estado": "APROBADA", "total": 6}],
        )

    @override_settings(DISABLE_OUTBOUND_INTEGRATIONS=True)
    def test_api_no_activa_regla_whatsapp_con_plantilla_meta_pendiente(self):
        self.activar_plan(
            modulos=["cobranza"],
            funciones=["whatsapp_automation"],
        )
        PlantillaMensaje.objects.create(
            capa_negocio=self.capa,
            nombre="Preventivo pendiente Meta",
            canal="WHATSAPP",
            tipo_plantilla="RECORDATORIO_PAGO",
            cuerpo="Hola {{cliente_nombre}}",
            whatsapp_template_name="betterp_pago_preventivo",
            whatsapp_template_language="es_MX",
            whatsapp_template_status="EN_REVISION",
            activo=True,
        )

        response = self.client.post(
            "/api/comunicaciones/automatizaciones/",
            data=json.dumps(
                {
                    "nombre": "Preventivo pendiente",
                    "descripcion": "",
                    "plantilla_id": PlantillaMensaje.objects.get(
                        nombre="Preventivo pendiente Meta"
                    ).id,
                    "entidad_id": None,
                    "canal": "WHATSAPP",
                    "evento_base": "FECHA_VENCIMIENTO",
                    "desplazamiento_dias": -3,
                    "segmento": "POR_VENCER",
                    "activo": True,
                }
            ),
            content_type="application/json",
            **self.auth_headers,
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("no esta aprobada", response.json()["detail"])
        self.assertFalse(
            ReglaAutomatizacionMensaje.objects.filter(nombre="Preventivo pendiente").exists()
        )

    def _crear_recordatorio_comando_basico(self, *, fecha_vencimiento=date(2026, 7, 10)):
        config = ConfiguracionComunicacion.objects.create(
            capa_negocio=self.capa,
            clave="PRINCIPAL",
        )
        plantilla = PlantillaMensaje.objects.create(
            capa_negocio=self.capa,
            nombre="Dia de vencimiento comando ventana",
            canal="WHATSAPP",
            tipo_plantilla="RECORDATORIO_PAGO",
            cuerpo="Hola {{cliente_nombre}}, referencia {{referencia_pago}}",
            incluye_link_portal=True,
            whatsapp_template_name="betterp_pago_vence_hoy",
            whatsapp_template_language="es_MX",
            whatsapp_template_status="APROBADA",
            activo=True,
        )
        ReglaAutomatizacionMensaje.objects.create(
            configuracion_relacionada=config,
            plantilla_relacionada=plantilla,
            nombre="Dia de vencimiento comando ventana",
            canal="WHATSAPP",
            evento_base="FECHA_VENCIMIENTO",
            desplazamiento_dias=0,
            segmento="POR_VENCER",
            activo=True,
        )
        CuentaPorCobrar.objects.create(
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            concepto="Renta julio",
            fecha_vencimiento=fecha_vencimiento,
            monto_total=Decimal("2100.00"),
            monto_pagado=Decimal("0"),
            estatus_adeudo="PENDIENTE",
        )
        return config

    @override_settings(
        DISABLE_OUTBOUND_INTEGRATIONS=True,
        PAYMENT_REMINDER_ENFORCE_SEND_WINDOW=True,
        PAYMENT_REMINDER_SEND_WINDOW_START="10:00",
        PAYMENT_REMINDER_SEND_WINDOW_END="18:00",
        PAYMENT_REMINDER_SEND_TIMEZONE="America/Mexico_City",
        PAYMENT_REMINDER_BLOCKED_WEEKDAYS="",
    )
    def test_comando_recordatorios_omite_fuera_de_ventana_operativa(self):
        self._crear_recordatorio_comando_basico()
        with patch(
            "comunicaciones.management.commands.procesar_recordatorios.timezone.now",
            return_value=datetime(2026, 7, 10, 14, 0, tzinfo=datetime_timezone.utc),
        ):
            call_command("procesar_recordatorios", fecha="2026-07-10")

        self.assertFalse(HistorialEnvio.objects.exists())
        cron = CronRunLog.objects.get(key="payment_reminders")
        self.assertEqual(cron.status, "SUCCESS")
        self.assertEqual(cron.metadata["sent"], 0)
        self.assertTrue(cron.metadata["skipped_by_send_window"])
        self.assertEqual(cron.metadata["send_window"]["reason"], "outside_window")
        self.assertIn("ventana operativa", cron.summary)

    @override_settings(
        DISABLE_OUTBOUND_INTEGRATIONS=True,
        PAYMENT_REMINDER_ENFORCE_SEND_WINDOW=True,
        PAYMENT_REMINDER_SEND_WINDOW_START="10:00",
        PAYMENT_REMINDER_SEND_WINDOW_END="18:00",
        PAYMENT_REMINDER_SEND_TIMEZONE="America/Mexico_City",
        PAYMENT_REMINDER_BLOCKED_WEEKDAYS="domingo",
    )
    def test_comando_recordatorios_omite_dia_bloqueado(self):
        self._crear_recordatorio_comando_basico(fecha_vencimiento=date(2026, 7, 12))
        with patch(
            "comunicaciones.management.commands.procesar_recordatorios.timezone.now",
            return_value=datetime(2026, 7, 12, 17, 0, tzinfo=datetime_timezone.utc),
        ):
            call_command("procesar_recordatorios", fecha="2026-07-12")

        self.assertFalse(HistorialEnvio.objects.exists())
        cron = CronRunLog.objects.get(key="payment_reminders")
        self.assertEqual(cron.status, "SUCCESS")
        self.assertTrue(cron.metadata["skipped_by_send_window"])
        self.assertEqual(cron.metadata["send_window"]["reason"], "blocked_weekday")
        self.assertEqual(cron.metadata["send_window"]["blocked_weekday_labels"], ["domingo"])

    @override_settings(
        DISABLE_OUTBOUND_INTEGRATIONS=True,
        PAYMENT_REMINDER_ENFORCE_SEND_WINDOW=True,
        PAYMENT_REMINDER_SEND_WINDOW_START="10:00",
        PAYMENT_REMINDER_SEND_WINDOW_END="18:00",
        PAYMENT_REMINDER_SEND_TIMEZONE="America/Mexico_City",
        PAYMENT_REMINDER_BLOCKED_WEEKDAYS="",
    )
    def test_comando_recordatorios_ignore_send_window_permite_corrida_manual(self):
        self._crear_recordatorio_comando_basico()
        with patch(
            "comunicaciones.management.commands.procesar_recordatorios.timezone.now",
            return_value=datetime(2026, 7, 10, 14, 0, tzinfo=datetime_timezone.utc),
        ):
            call_command(
                "procesar_recordatorios",
                fecha="2026-07-10",
                ignore_send_window=True,
            )

        self.assertEqual(HistorialEnvio.objects.filter(estatus="ENVIADO").count(), 1)
        cron = CronRunLog.objects.get(key="payment_reminders")
        self.assertFalse(cron.metadata["skipped_by_send_window"])
        self.assertEqual(cron.metadata["send_window"]["reason"], "disabled")

    @override_settings(DISABLE_OUTBOUND_INTEGRATIONS=True)
    def test_comando_recordatorios_respeta_limite_global_y_por_capa(self):
        config = ConfiguracionComunicacion.objects.create(
            capa_negocio=self.capa,
            clave="PRINCIPAL",
        )
        plantilla = PlantillaMensaje.objects.create(
            capa_negocio=self.capa,
            nombre="Dia de vencimiento comando",
            canal="WHATSAPP",
            tipo_plantilla="RECORDATORIO_PAGO",
            cuerpo="Hola {{cliente_nombre}}, referencia {{referencia_pago}}",
            incluye_link_portal=True,
            whatsapp_template_name="betterp_pago_vence_hoy",
            whatsapp_template_language="es_MX",
            whatsapp_template_status="APROBADA",
            activo=True,
        )
        ReglaAutomatizacionMensaje.objects.create(
            configuracion_relacionada=config,
            plantilla_relacionada=plantilla,
            nombre="Dia de vencimiento comando",
            canal="WHATSAPP",
            evento_base="FECHA_VENCIMIENTO",
            desplazamiento_dias=0,
            segmento="POR_VENCER",
            activo=True,
        )
        segundo_cliente = Cliente.objects.create(
            entidad_relacionada=self.entidad,
            razon_social="Ana Lopez",
            nombre_comercial="Ana Lopez",
            telefono="5511112222",
            correo_principal="ana@test.com",
        )
        for cliente in (self.cliente, segundo_cliente):
            CuentaPorCobrar.objects.create(
                entidad_relacionada=self.entidad,
                cliente_relacionado=cliente,
                concepto="Renta julio",
                fecha_vencimiento=date(2026, 7, 10),
                monto_total=Decimal("2100.00"),
                monto_pagado=Decimal("0"),
                estatus_adeudo="PENDIENTE",
            )

        otra_capa = CapaNegocio.objects.create(nombre="Otra Capa", tipo_capa="OPERADORA")
        AcuerdoUsoComunicacion.objects.create(
            capa_negocio=otra_capa,
            aceptado_por=self.user,
            tipo_acuerdo=WHATSAPP_SHARED_NUMBER_AGREEMENT_TYPE,
            version=WHATSAPP_SHARED_NUMBER_AGREEMENT_VERSION,
            titulo=WHATSAPP_SHARED_NUMBER_AGREEMENT_TITLE,
            texto_hash=whatsapp_shared_number_agreement_hash(),
            metadata={"origen": "test_setup_otra_capa"},
        )
        otra_entidad = EntidadNegocio.objects.create(
            capa_negocio=otra_capa,
            nombre_comercial="Otra entidad",
            tipo_fecha_corte="INDIVIDUAL",
        )
        otra_config = ConfiguracionComunicacion.objects.create(
            capa_negocio=otra_capa,
            clave="PRINCIPAL",
        )
        otra_plantilla = PlantillaMensaje.objects.create(
            capa_negocio=otra_capa,
            nombre="Dia de vencimiento comando otra",
            canal="WHATSAPP",
            tipo_plantilla="RECORDATORIO_PAGO",
            cuerpo="Hola {{cliente_nombre}}, referencia {{referencia_pago}}",
            incluye_link_portal=True,
            whatsapp_template_name="betterp_pago_vence_hoy",
            whatsapp_template_language="es_MX",
            whatsapp_template_status="APROBADA",
            activo=True,
        )
        ReglaAutomatizacionMensaje.objects.create(
            configuracion_relacionada=otra_config,
            plantilla_relacionada=otra_plantilla,
            nombre="Dia de vencimiento comando otra",
            canal="WHATSAPP",
            evento_base="FECHA_VENCIMIENTO",
            desplazamiento_dias=0,
            segmento="POR_VENCER",
            activo=True,
        )
        for index in range(2):
            cliente = Cliente.objects.create(
                entidad_relacionada=otra_entidad,
                razon_social=f"Cliente otra {index}",
                nombre_comercial=f"Cliente otra {index}",
                telefono=f"552222222{index}",
                correo_principal=f"otra{index}@test.com",
            )
            CuentaPorCobrar.objects.create(
                entidad_relacionada=otra_entidad,
                cliente_relacionado=cliente,
                concepto="Renta julio",
                fecha_vencimiento=date(2026, 7, 10),
                monto_total=Decimal("1800.00"),
                monto_pagado=Decimal("0"),
                estatus_adeudo="PENDIENTE",
            )

        call_command(
            "procesar_recordatorios",
            fecha="2026-07-10",
            max_envios=3,
            max_envios_por_capa=1,
        )

        self.assertEqual(HistorialEnvio.objects.filter(estatus="ENVIADO").count(), 2)
        self.assertEqual(HistorialEnvio.objects.filter(estatus="OMITIDO").count(), 2)
        capas_enviadas = set(
            HistorialEnvio.objects.filter(estatus="ENVIADO").values_list(
                "entidad_relacionada__capa_negocio_id",
                flat=True,
            )
        )
        self.assertEqual(capas_enviadas, {self.capa.id, otra_capa.id})
        cron = CronRunLog.objects.get(key="payment_reminders")
        self.assertEqual(cron.metadata["max_envios"], 3)
        self.assertEqual(cron.metadata["max_envios_por_capa"], 1)
        self.assertEqual(cron.metadata["sent"], 2)
        self.assertEqual(cron.metadata["skipped"], 2)
        self.assertEqual(len(cron.metadata["capas"]), 2)
        self.assertEqual(cron.metadata["capas"][0]["capa_id"], self.capa.id)
        self.assertEqual(cron.metadata["capas"][0]["sent"], 1)
        self.assertEqual(cron.metadata["capas"][0]["skipped"], 1)
        self.assertEqual(cron.metadata["capas"][0]["rules"], 1)
        self.assertEqual(cron.metadata["capas"][0]["candidates"], 2)

    @override_settings(DISABLE_OUTBOUND_INTEGRATIONS=True)
    def test_comando_recordatorios_usa_limite_bajo_por_default(self):
        self._crear_recordatorio_comando_basico()
        segundo_cliente = Cliente.objects.create(
            entidad_relacionada=self.entidad,
            razon_social="Ana Lopez",
            nombre_comercial="Ana Lopez",
            telefono="5511112222",
            correo_principal="ana@test.com",
        )
        CuentaPorCobrar.objects.create(
            entidad_relacionada=self.entidad,
            cliente_relacionado=segundo_cliente,
            concepto="Renta julio",
            fecha_vencimiento=date(2026, 7, 10),
            monto_total=Decimal("2100.00"),
            monto_pagado=Decimal("0"),
            estatus_adeudo="PENDIENTE",
        )

        call_command("procesar_recordatorios", fecha="2026-07-10")

        self.assertEqual(HistorialEnvio.objects.filter(estatus="ENVIADO").count(), 1)
        self.assertEqual(HistorialEnvio.objects.filter(estatus="OMITIDO").count(), 1)
        cron = CronRunLog.objects.get(key="payment_reminders")
        self.assertEqual(cron.metadata["max_envios"], 1)
        self.assertEqual(cron.metadata["max_envios_por_capa"], 1)
        self.assertTrue(cron.metadata["limit_policy"]["enforced"])
        self.assertEqual(cron.metadata["limit_policy"]["safe_max_envios"], 10)
        self.assertEqual(cron.metadata["limit_policy"]["default_max_envios"], 1)

    @override_settings(DISABLE_OUTBOUND_INTEGRATIONS=True)
    def test_comando_recordatorios_bloquea_limite_alto_sin_aprobacion(self):
        with self.assertRaises(SystemExit) as context:
            call_command(
                "procesar_recordatorios",
                fecha="2026-07-10",
                max_envios=11,
                max_envios_por_capa=1,
            )

        self.assertIn("excede el limite seguro", str(context.exception))
        self.assertFalse(CronRunLog.objects.filter(key="payment_reminders").exists())

    @override_settings(DISABLE_OUTBOUND_INTEGRATIONS=True)
    def test_comando_recordatorios_fail_on_errors_marca_cron_error(self):
        config = ConfiguracionComunicacion.objects.create(
            capa_negocio=self.capa,
            clave="PRINCIPAL",
        )
        plantilla = PlantillaMensaje.objects.create(
            capa_negocio=self.capa,
            nombre="Dia de vencimiento comando error",
            canal="WHATSAPP",
            tipo_plantilla="RECORDATORIO_PAGO",
            cuerpo="Hola {{cliente_nombre}}, referencia {{referencia_pago}}",
            incluye_link_portal=True,
            whatsapp_template_name="betterp_pago_vence_hoy",
            whatsapp_template_language="es_MX",
            whatsapp_template_status="NO_CONFIGURADA",
            activo=True,
        )
        ReglaAutomatizacionMensaje.objects.create(
            configuracion_relacionada=config,
            plantilla_relacionada=plantilla,
            nombre="Dia de vencimiento comando error",
            canal="WHATSAPP",
            evento_base="FECHA_VENCIMIENTO",
            desplazamiento_dias=0,
            segmento="POR_VENCER",
            activo=True,
        )
        CuentaPorCobrar.objects.create(
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            concepto="Renta julio",
            fecha_vencimiento=date(2026, 7, 10),
            monto_total=Decimal("2100.00"),
            monto_pagado=Decimal("0"),
            estatus_adeudo="PENDIENTE",
        )

        with self.assertRaises(CommandError):
            call_command(
                "procesar_recordatorios",
                fecha="2026-07-10",
                fail_on_errors=True,
            )

        cron = CronRunLog.objects.get(key="payment_reminders")
        self.assertEqual(cron.status, "ERROR")
        self.assertEqual(cron.metadata["errors"], 1)
        self.assertTrue(cron.metadata["fail_on_errors"])
        self.assertIn("1 error", cron.error)

    def test_comando_recordatorios_require_whatsapp_ready_falla_antes_de_enviar(self):
        config = ConfiguracionComunicacion.objects.create(
            capa_negocio=self.capa,
            clave="PRINCIPAL",
        )
        plantilla = PlantillaMensaje.objects.create(
            capa_negocio=self.capa,
            nombre="Preventivo sin aprobar",
            canal="WHATSAPP",
            tipo_plantilla="RECORDATORIO_PAGO",
            cuerpo="Hola {{cliente_nombre}}, referencia {{referencia_pago}}",
            incluye_link_portal=True,
            whatsapp_template_name="betterp_pago_preventivo",
            whatsapp_template_language="es_MX",
            whatsapp_template_status="NO_CONFIGURADA",
            activo=True,
        )
        ReglaAutomatizacionMensaje.objects.create(
            configuracion_relacionada=config,
            plantilla_relacionada=plantilla,
            nombre="Preventivo estricto",
            canal="WHATSAPP",
            evento_base="FECHA_VENCIMIENTO",
            desplazamiento_dias=0,
            segmento="POR_VENCER",
            activo=True,
        )
        CuentaPorCobrar.objects.create(
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            concepto="Renta julio",
            fecha_vencimiento=date(2026, 7, 10),
            monto_total=Decimal("2100.00"),
            monto_pagado=Decimal("0"),
            estatus_adeudo="PENDIENTE",
        )

        with self.assertRaises(CommandError):
            call_command(
                "procesar_recordatorios",
                fecha="2026-07-10",
                require_whatsapp_ready=True,
            )

        self.assertFalse(HistorialEnvio.objects.exists())
        cron = CronRunLog.objects.get(key="payment_reminders")
        self.assertEqual(cron.status, "ERROR")
        self.assertEqual(cron.metadata["readiness_errors"], 2)
        self.assertTrue(cron.metadata["require_whatsapp_ready"])
        layer = cron.metadata["capas"][0]
        self.assertFalse(layer["readiness"]["ok"])
        issue_types = {issue["type"] for issue in layer["readiness"]["issues"]}
        self.assertEqual(issue_types, {"TEMPLATE_NOT_APPROVED", "PROVIDER_NOT_CONFIGURED"})

    def test_green_api_webhook_crea_mensaje_evidencia_y_evento(self):
        config = ConfiguracionComunicacion.objects.create(
            capa_negocio=self.capa,
            clave="PRINCIPAL",
            green_api_api_url="https://api.green-api.com",
            green_api_instance_id="7103000000",
            green_api_token="green-secret",
            green_api_webhook_url="https://betterp.onrender.com/api/comunicaciones/green-api/webhook/",
            green_api_webhook_token="green-hook-token",
            procesar_webhooks_async=False,
            auto_detectar_comprobantes=True,
            auto_crear_eventos=True,
            auto_aplicar_eventos_confiables=False,
            umbral_confianza_autoaplicacion=Decimal("85"),
        )
        CanalPermitido.objects.create(
            configuracion_relacionada=config,
            canal="GRUPO_WHATSAPP",
            nombre="Cobranza Maya",
            identificador_externo="120363000111222@g.us",
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            tipo_movimiento_default="INGRESO",
            capturar_evidencias=True,
            activo=True,
        )

        response = self.client.post(
            "/api/comunicaciones/green-api/webhook/",
            data=json.dumps(
                {
                    "typeWebhook": "incomingMessageReceived",
                    "timestamp": 1770000000,
                    "idMessage": "MSG-001",
                    "senderData": {
                        "chatId": "120363000111222@g.us",
                        "sender": "5215512345678@c.us",
                        "chatName": "Cobranza Maya",
                        "senderName": "Daniel",
                        "senderContactName": "Daniel Muller",
                    },
                    "messageData": {
                        "typeMessage": "imageMessage",
                        "fileMessageData": {
                            "downloadUrl": "https://files.green-api.test/comprobante.jpg",
                            "caption": "Pago renta abril 9000 SPEI-001",
                            "mimeType": "image/jpeg",
                        },
                    },
                }
            ),
            content_type="application/json",
            HTTP_AUTHORIZATION="Bearer green-hook-token",
        )
        self.assertEqual(response.status_code, 200)
        webhook = WebhookEntrante.objects.get(id=response.json()["webhook_id"])

        process_webhook_safe(webhook.id)

        webhook.refresh_from_db()
        self.assertEqual(webhook.estatus_procesamiento, "PROCESADO")

        mensaje = MensajeEntrante.objects.get(origen_externo_id="MSG-001")
        self.assertEqual(mensaje.chat_id, "120363000111222@g.us")
        self.assertEqual(mensaje.tipo_mensaje, "imageMessage")

        evidencia = EvidenciaPago.objects.get(mensaje_relacionado=mensaje)
        self.assertEqual(evidencia.origen_deteccion, "GREEN_API")
        self.assertEqual(evidencia.tipo_movimiento, "INGRESO")
        self.assertFalse(evidencia.requiere_revision_manual)
        self.assertEqual(evidencia.entidad_relacionada_id, self.entidad.id)
        self.assertEqual(evidencia.cliente_relacionado_id, self.cliente.id)
        self.assertGreaterEqual(evidencia.confianza_clasificacion, Decimal("85"))

        caso = CasoProcesamiento.objects.get(id=mensaje.caso_relacionado_id)
        self.assertEqual(caso.entidad_relacionada_id, self.entidad.id)
        self.assertIn("Pago renta abril", caso.texto_consolidado or "")

        evento = EventoFinanciero.objects.get(evidencia_pago_relacionada=evidencia)
        self.assertEqual(evento.tipo_movimiento, "INGRESO")
        self.assertEqual(evento.estatus, "PROPUESTO")

    def test_green_api_webhook_usa_configuracion_de_la_capa_del_token(self):
        other_capa = CapaNegocio.objects.create(
            nombre="Otra operadora",
            tipo_capa="OPERADORA",
        )
        other_entidad = EntidadNegocio.objects.create(
            capa_negocio=other_capa,
            nombre_comercial="Otra Propiedad",
            ciudad="Merida",
            tipo_fecha_corte="INDIVIDUAL",
        )
        other_cliente = Cliente.objects.create(
            entidad_relacionada=other_entidad,
            razon_social="Cliente Externo",
            nombre_comercial="Cliente Externo",
            telefono="5599999999",
        )
        other_config = ConfiguracionComunicacion.objects.create(
            capa_negocio=other_capa,
            clave="PRINCIPAL",
            green_api_webhook_token="other-hook-token",
            procesar_webhooks_async=False,
            auto_detectar_comprobantes=True,
        )
        CanalPermitido.objects.create(
            configuracion_relacionada=other_config,
            canal="GRUPO_WHATSAPP",
            nombre="Cobranza otra capa",
            identificador_externo="120363000111222@g.us",
            entidad_relacionada=other_entidad,
            cliente_relacionado=other_cliente,
            tipo_movimiento_default="EGRESO",
            capturar_evidencias=True,
            activo=True,
        )

        config = ConfiguracionComunicacion.objects.create(
            capa_negocio=self.capa,
            clave="PRINCIPAL",
            green_api_webhook_token="green-hook-token",
            procesar_webhooks_async=False,
            auto_detectar_comprobantes=True,
        )
        CanalPermitido.objects.create(
            configuracion_relacionada=config,
            canal="GRUPO_WHATSAPP",
            nombre="Cobranza Maya",
            identificador_externo="120363000111222@g.us",
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            tipo_movimiento_default="INGRESO",
            capturar_evidencias=True,
            activo=True,
        )

        payload = {
            "typeWebhook": "incomingMessageReceived",
            "timestamp": 1770000000,
            "idMessage": "MSG-TENANT-001",
            "senderData": {
                "chatId": "120363000111222@g.us",
                "sender": "5215512345678@c.us",
                "senderName": "Daniel",
            },
            "messageData": {
                "typeMessage": "textMessage",
                "textMessageData": {
                    "textMessage": "Pago renta abril 9000 SPEI-tenant",
                },
            },
        }
        response = self.client.post(
            "/api/comunicaciones/green-api/webhook/",
            data=json.dumps(payload),
            content_type="application/json",
            HTTP_AUTHORIZATION="Bearer green-hook-token",
        )
        self.assertEqual(response.status_code, 200)

        process_webhook_safe(response.json()["webhook_id"])

        mensaje = MensajeEntrante.objects.get(origen_externo_id="MSG-TENANT-001")
        evidencia = EvidenciaPago.objects.get(mensaje_relacionado=mensaje)
        self.assertEqual(evidencia.entidad_relacionada_id, self.entidad.id)
        self.assertEqual(evidencia.cliente_relacionado_id, self.cliente.id)
        self.assertEqual(evidencia.tipo_movimiento, "INGRESO")

    @override_settings(BACKEND_PUBLIC_BASE_URL="https://api.betterp.net")
    def test_meta_cloud_webhook_crea_mensaje_evidencia_y_actualiza_estatus(self):
        ConfiguracionComunicacion.objects.create(
            capa_negocio=self.capa,
            clave="PRINCIPAL",
            procesar_webhooks_async=False,
            auto_detectar_comprobantes=True,
            auto_crear_eventos=True,
            auto_aplicar_eventos_confiables=False,
            umbral_confianza_autoaplicacion=Decimal("85"),
        )
        canal = CanalWhatsappOficial.objects.create(
            capa_negocio=self.capa,
            nombre="Cobranza oficial",
            display_phone_number="+52 999 000 0000",
            numero_wa_id="529990000000",
            phone_number_id="123456789",
            business_account_id="987654321",
            waba_id="987654321",
            access_token="meta-token",
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            estado="CONECTADO",
            puede_enviar=True,
            puede_recibir=True,
            es_principal=True,
            activo=True,
        )
        historial = HistorialEnvio.objects.create(
            configuracion_relacionada=ConfiguracionComunicacion.objects.first(),
            cliente_relacionado=self.cliente,
            entidad_relacionada=self.entidad,
            canal="WHATSAPP",
            tipo_envio="MANUAL",
            proveedor="META_CLOUD_API",
            destinatario="5215512345678",
            asunto="Prueba",
            referencia_envio="wamid.outbound.1",
            estatus="ENVIADO",
        )
        webhook = WebhookEntrante.objects.create(
            proveedor="META_CLOUD_API",
            origen_externo_id="wamid.inbound.1",
            tipo_webhook="messages",
            chat_id="123456789",
            remitente="5215512345678",
            payload_completo={
                "object": "whatsapp_business_account",
                "entry": [
                    {
                        "id": "987654321",
                        "changes": [
                            {
                                "field": "messages",
                                "value": {
                                    "metadata": {
                                        "display_phone_number": "+52 999 000 0000",
                                        "phone_number_id": "123456789",
                                    },
                                    "contacts": [
                                        {
                                            "profile": {"name": "Daniel Muller"},
                                            "wa_id": "5215512345678",
                                        }
                                    ],
                                    "messages": [
                                        {
                                            "from": "5215512345678",
                                            "id": "wamid.inbound.1",
                                            "timestamp": "1770000000",
                                            "type": "image",
                                            "image": {
                                                "id": "media-001",
                                                "caption": "Pago renta abril 9000 SPEI-002",
                                            },
                                        }
                                    ],
                                    "statuses": [
                                        {
                                            "id": "wamid.outbound.1",
                                            "status": "delivered",
                                            "conversation": {"id": "conversation-1"},
                                        }
                                    ],
                                },
                            }
                        ],
                    }
                ],
            },
        )

        process_webhook_safe(webhook.id)

        webhook.refresh_from_db()
        self.assertEqual(webhook.estatus_procesamiento, "PROCESADO")

        historial.refresh_from_db()
        self.assertEqual(historial.estatus, "ENTREGADO")
        self.assertEqual(historial.metadata["meta_status"], "delivered")

        mensaje = MensajeEntrante.objects.get(origen_externo_id="wamid.inbound.1")
        self.assertEqual(mensaje.chat_id, "123456789")
        self.assertEqual(mensaje.tipo_mensaje, "image")
        self.assertIn(
            f"/api/comunicaciones/whatsapp-cloud/media/{canal.id}/media-001/",
            mensaje.url_adjunto or "",
        )

        evidencia = EvidenciaPago.objects.get(mensaje_relacionado=mensaje)
        self.assertEqual(evidencia.origen_deteccion, "META_CLOUD_API")
        self.assertEqual(evidencia.entidad_relacionada_id, self.entidad.id)
        self.assertEqual(evidencia.cliente_relacionado_id, self.cliente.id)

        evento = EventoFinanciero.objects.get(evidencia_pago_relacionada=evidencia)
        self.assertEqual(evento.tipo_movimiento, "INGRESO")
        self.assertEqual(evento.estatus, "PROPUESTO")

    def test_meta_cloud_webhook_marca_no_contactar_por_baja(self):
        ConfiguracionComunicacion.objects.create(
            capa_negocio=self.capa,
            clave="PRINCIPAL",
            procesar_webhooks_async=False,
            auto_detectar_comprobantes=True,
        )
        CanalWhatsappOficial.objects.create(
            capa_negocio=self.capa,
            nombre="Cobranza oficial",
            display_phone_number="+52 999 000 0000",
            numero_wa_id="529990000000",
            phone_number_id="123456789",
            business_account_id="987654321",
            waba_id="987654321",
            access_token="meta-token",
            estado="CONECTADO",
            puede_enviar=True,
            puede_recibir=True,
            es_principal=True,
            activo=True,
        )
        webhook = WebhookEntrante.objects.create(
            proveedor="META_CLOUD_API",
            origen_externo_id="wamid.stop.1",
            tipo_webhook="messages",
            chat_id="123456789",
            remitente="5215512345678",
            payload_completo={
                "object": "whatsapp_business_account",
                "entry": [
                    {
                        "id": "987654321",
                        "changes": [
                            {
                                "field": "messages",
                                "value": {
                                    "metadata": {
                                        "display_phone_number": "+52 999 000 0000",
                                        "phone_number_id": "123456789",
                                    },
                                    "contacts": [
                                        {
                                            "profile": {"name": "Daniel Muller"},
                                            "wa_id": "5215512345678",
                                        }
                                    ],
                                    "messages": [
                                        {
                                            "from": "5215512345678",
                                            "id": "wamid.stop.1",
                                            "timestamp": "1770000000",
                                            "type": "text",
                                            "text": {"body": "BAJA"},
                                        }
                                    ],
                                },
                            }
                        ],
                    }
                ],
            },
        )

        process_webhook_safe(webhook.id)

        self.cliente.refresh_from_db()
        self.assertTrue(self.cliente.no_contactar_cobranza)
        self.assertIn("BAJA", self.cliente.no_contactar_cobranza_motivo or "")
        self.assertIsNotNone(self.cliente.no_contactar_cobranza_fecha)
        mensaje = MensajeEntrante.objects.get(origen_externo_id="wamid.stop.1")
        self.assertEqual(mensaje.cliente_relacionado_id, self.cliente.id)
        self.assertEqual(mensaje.metadata["collection_opt_out"]["keyword"], "BAJA")
        self.assertTrue(mensaje.metadata["collection_opt_out"]["applied"])
        self.assertEqual(
            mensaje.metadata["collection_opt_out"]["policy_mode"],
            "AUTO_BLOCK",
        )
        caso = mensaje.caso_relacionado
        self.assertEqual(caso.metadata["collection_opt_out"]["cliente_id"], self.cliente.id)
        self.assertFalse(EvidenciaPago.objects.filter(mensaje_relacionado=mensaje).exists())

    @override_settings(FRONTEND_BASE_URL="https://app.test")
    def test_meta_cloud_webhook_responde_link_portal_si_cliente_lo_solicita(self):
        config = ConfiguracionComunicacion.objects.create(
            capa_negocio=self.capa,
            clave="PRINCIPAL",
            procesar_webhooks_async=False,
            auto_detectar_comprobantes=True,
        )
        CanalWhatsappOficial.objects.create(
            capa_negocio=self.capa,
            nombre="Cobranza oficial",
            display_phone_number="+52 999 000 0000",
            numero_wa_id="529990000000",
            phone_number_id="123456789",
            business_account_id="987654321",
            waba_id="987654321",
            access_token="meta-token",
            estado="CONECTADO",
            puede_enviar=True,
            puede_recibir=True,
            es_principal=True,
            activo=True,
        )
        webhook = WebhookEntrante.objects.create(
            proveedor="META_CLOUD_API",
            origen_externo_id="wamid.portal-request.1",
            tipo_webhook="messages",
            chat_id="123456789",
            remitente="5215512345678",
            payload_completo={
                "object": "whatsapp_business_account",
                "entry": [
                    {
                        "id": "987654321",
                        "changes": [
                            {
                                "field": "messages",
                                "value": {
                                    "metadata": {
                                        "display_phone_number": "+52 999 000 0000",
                                        "phone_number_id": "123456789",
                                    },
                                    "contacts": [
                                        {
                                            "profile": {"name": "Daniel Muller"},
                                            "wa_id": "5215512345678",
                                        }
                                    ],
                                    "messages": [
                                        {
                                            "from": "5215512345678",
                                            "id": "wamid.portal-request.1",
                                            "timestamp": "1770000000",
                                            "type": "text",
                                            "text": {
                                                "body": "Hola, me mandas el link del portal?"
                                            },
                                        }
                                    ],
                                },
                            }
                        ],
                    }
                ],
            },
        )

        with patch("comunicaciones.api.send_whatsapp_message") as send_mock:
            send_mock.return_value = {
                "provider": "META_CLOUD_API",
                "messages": [{"id": "wamid.portal-link"}],
            }
            process_webhook_safe(webhook.id)

        send_kwargs = send_mock.call_args.kwargs
        self.assertEqual(send_kwargs["config"].id, config.id)
        self.assertEqual(send_kwargs["cliente"].id, self.cliente.id)
        self.assertEqual(send_kwargs["chat_id"], "525512345678")
        self.assertFalse(send_kwargs["enforce_allowed_numbers"])
        self.assertEqual(send_kwargs["interactive_button_text"], "Abrir portal")
        self.assertIn("https://app.test/portal-cliente/", send_kwargs["interactive_url"])
        self.assertIn("portal de autoservicio", send_kwargs["message"])
        self.assertIn("codigo por WhatsApp", send_kwargs["message"])

        mensaje = MensajeEntrante.objects.get(
            origen_externo_id="wamid.portal-request.1"
        )
        assistant_metadata = mensaje.metadata["portal_access_assistant"]
        self.assertEqual(assistant_metadata["status"], "ENVIADO")
        self.assertIn("/portal-cliente/", assistant_metadata["portal_url"])
        self.assertFalse(EvidenciaPago.objects.filter(mensaje_relacionado=mensaje).exists())

        history = HistorialEnvio.objects.get(referencia_envio="wamid.portal-link")
        self.assertEqual(history.estatus, "ENVIADO")
        self.assertEqual(history.tipo_envio, "MANUAL")
        self.assertTrue(history.metadata["portal_assistant"])
        self.assertIn("/portal-cliente/", history.metadata["portal_url"])

    @override_settings(FRONTEND_BASE_URL="https://app.test")
    def test_meta_cloud_webhook_saludo_responde_link_directo_portal(self):
        config = ConfiguracionComunicacion.objects.create(
            capa_negocio=self.capa,
            clave="PRINCIPAL",
            procesar_webhooks_async=False,
            auto_detectar_comprobantes=True,
        )
        CanalWhatsappOficial.objects.create(
            capa_negocio=self.capa,
            nombre="Cobranza oficial",
            display_phone_number="+52 999 000 0000",
            numero_wa_id="529990000000",
            phone_number_id="123456789",
            business_account_id="987654321",
            waba_id="987654321",
            access_token="meta-token",
            estado="CONECTADO",
            puede_enviar=True,
            puede_recibir=True,
            es_principal=True,
            activo=True,
        )
        webhook = WebhookEntrante.objects.create(
            proveedor="META_CLOUD_API",
            origen_externo_id="wamid.portal-menu.1",
            tipo_webhook="messages",
            chat_id="123456789",
            remitente="5215512345678",
            payload_completo={
                "object": "whatsapp_business_account",
                "entry": [
                    {
                        "id": "987654321",
                        "changes": [
                            {
                                "field": "messages",
                                "value": {
                                    "metadata": {
                                        "display_phone_number": "+52 999 000 0000",
                                        "phone_number_id": "123456789",
                                    },
                                    "contacts": [
                                        {
                                            "profile": {"name": "Daniel Muller"},
                                            "wa_id": "5215512345678",
                                        }
                                    ],
                                    "messages": [
                                        {
                                            "from": "5215512345678",
                                            "id": "wamid.portal-menu.1",
                                            "timestamp": "1770000000",
                                            "type": "text",
                                            "text": {"body": "hola"},
                                        }
                                    ],
                                },
                            }
                        ],
                    }
                ],
            },
        )

        with patch("comunicaciones.api.send_whatsapp_message") as send_mock:
            send_mock.return_value = {
                "provider": "META_CLOUD_API",
                "messages": [{"id": "wamid.portal-menu-response"}],
            }
            process_webhook_safe(webhook.id)

        send_kwargs = send_mock.call_args.kwargs
        self.assertEqual(send_kwargs["config"].id, config.id)
        self.assertEqual(send_kwargs["cliente"].id, self.cliente.id)
        self.assertEqual(send_kwargs["chat_id"], "525512345678")
        self.assertFalse(send_kwargs["enforce_allowed_numbers"])
        self.assertEqual(send_kwargs["interactive_button_text"], "Abrir portal")
        self.assertIn("https://app.test/portal-cliente/", send_kwargs["interactive_url"])
        self.assertIn("toca el boton", send_kwargs["message"])
        self.assertIn("codigo por WhatsApp", send_kwargs["message"])

        mensaje = MensajeEntrante.objects.get(origen_externo_id="wamid.portal-menu.1")
        assistant_metadata = mensaje.metadata["portal_access_assistant"]
        self.assertEqual(assistant_metadata["status"], "ENVIADO")
        self.assertEqual(assistant_metadata["intent"], "MENU")
        self.assertIn("/portal-cliente/", assistant_metadata["portal_url"])
        self.assertFalse(EvidenciaPago.objects.filter(mensaje_relacionado=mensaje).exists())

        history = HistorialEnvio.objects.get(referencia_envio="wamid.portal-menu-response")
        self.assertEqual(history.asunto, "Link de autoservicio solicitado por WhatsApp")
        self.assertEqual(history.metadata["portal_assistant_intent"], "MENU")
        self.assertIn("/portal-cliente/", history.metadata["portal_url"])

    @override_settings(
        FRONTEND_BASE_URL="https://app.test",
        WHATSAPP_META_APP_SECRET="",
        WHATSAPP_WEBHOOK_PROCESS_INLINE=True,
    )
    def test_whatsapp_cloud_webhook_procesa_inline_y_responde_menu(self):
        config = ConfiguracionComunicacion.objects.create(
            capa_negocio=self.capa,
            clave="PRINCIPAL",
            procesar_webhooks_async=True,
            auto_detectar_comprobantes=True,
        )
        CanalWhatsappOficial.objects.create(
            capa_negocio=self.capa,
            nombre="Cobranza oficial",
            display_phone_number="+52 999 000 0000",
            numero_wa_id="529990000000",
            phone_number_id="123456789",
            business_account_id="987654321",
            waba_id="987654321",
            access_token="meta-token",
            estado="CONECTADO",
            puede_enviar=True,
            puede_recibir=True,
            es_principal=True,
            activo=True,
        )
        payload = {
            "object": "whatsapp_business_account",
            "entry": [
                {
                    "id": "987654321",
                    "changes": [
                        {
                            "field": "messages",
                            "value": {
                                "metadata": {
                                    "display_phone_number": "+52 999 000 0000",
                                    "phone_number_id": "123456789",
                                },
                                "contacts": [
                                    {
                                        "profile": {"name": "Daniel Muller"},
                                        "wa_id": "5215512345678",
                                    }
                                ],
                                "messages": [
                                    {
                                        "from": "5215512345678",
                                        "id": "wamid.inline-menu.1",
                                        "timestamp": "1770000000",
                                        "type": "text",
                                        "text": {"body": "hola"},
                                    }
                                ],
                            },
                        }
                    ],
                }
            ],
        }

        with patch("comunicaciones.api.send_whatsapp_message") as send_mock:
            send_mock.return_value = {
                "provider": "META_CLOUD_API",
                "messages": [{"id": "wamid.inline-menu-response"}],
            }
            response = self.client.post(
                "/api/comunicaciones/whatsapp-cloud/webhook/",
                data=json.dumps(payload),
                content_type="application/json",
            )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["accepted"])
        self.assertEqual(len(response.json()["webhook_ids"]), 1)

        webhook = WebhookEntrante.objects.get(origen_externo_id="wamid.inline-menu.1")
        self.assertEqual(webhook.estatus_procesamiento, "PROCESADO")
        self.assertTrue(webhook.procesado)

        self.assertTrue(send_mock.called)
        send_kwargs = send_mock.call_args.kwargs
        self.assertEqual(send_kwargs["config"].id, config.id)
        self.assertEqual(send_kwargs["cliente"].id, self.cliente.id)
        self.assertEqual(send_kwargs["chat_id"], "525512345678")
        self.assertFalse(send_kwargs["enforce_allowed_numbers"])
        self.assertEqual(send_kwargs["interactive_button_text"], "Abrir portal")
        self.assertIn("https://app.test/portal-cliente/", send_kwargs["interactive_url"])
        self.assertIn("codigo por WhatsApp", send_kwargs["message"])

        mensaje = MensajeEntrante.objects.get(origen_externo_id="wamid.inline-menu.1")
        self.assertEqual(mensaje.cliente_relacionado_id, self.cliente.id)
        assistant_metadata = mensaje.metadata["portal_access_assistant"]
        self.assertEqual(assistant_metadata["status"], "ENVIADO")
        self.assertEqual(assistant_metadata["intent"], "MENU")
        self.assertIn("/portal-cliente/", assistant_metadata["portal_url"])

        history = HistorialEnvio.objects.get(
            referencia_envio="wamid.inline-menu-response"
        )
        self.assertEqual(history.estatus, "ENVIADO")
        self.assertEqual(history.metadata["portal_assistant_intent"], "MENU")
        self.assertIn("/portal-cliente/", history.metadata["portal_url"])

    @override_settings(
        OUTBOUND_WHATSAPP_ALLOWED_NUMBERS=["525512345678"],
        WHATSAPP_CLOUD_API_BASE_URL="https://graph.facebook.com",
        WHATSAPP_CLOUD_API_VERSION="v25.0",
    )
    @patch("comunicaciones.outbound.requests.post")
    def test_send_whatsapp_message_envia_boton_cta_url_meta(self, mocked_post):
        config = ConfiguracionComunicacion.objects.create(
            capa_negocio=self.capa,
            clave="PRINCIPAL",
        )
        CanalWhatsappOficial.objects.create(
            capa_negocio=self.capa,
            nombre="Cobranza oficial",
            display_phone_number="+52 999 000 0000",
            numero_wa_id="529990000000",
            phone_number_id="123456789",
            business_account_id="987654321",
            waba_id="987654321",
            access_token="meta-token",
            estado="CONECTADO",
            puede_enviar=True,
            puede_recibir=True,
            es_principal=True,
            activo=True,
        )
        mocked_post.return_value.status_code = 200
        mocked_post.return_value.json.return_value = {
            "messages": [{"id": "wamid.cta-url"}],
            "contacts": [{"wa_id": "525512345678"}],
        }

        send_whatsapp_message(
            config=config,
            cliente=self.cliente,
            chat_id="525512345678",
            message="Si quieres entrar al portal, toca el boton.",
            interactive_button_text="Abrir portal",
            interactive_url="https://app.test/portal-cliente/demo-token",
        )

        mocked_post.assert_called_once()
        _, kwargs = mocked_post.call_args
        payload = kwargs["json"]
        self.assertEqual(payload["type"], "interactive")
        self.assertEqual(payload["interactive"]["type"], "cta_url")
        self.assertEqual(
            payload["interactive"]["action"]["parameters"]["display_text"],
            "Abrir portal",
        )
        self.assertEqual(
            payload["interactive"]["action"]["parameters"]["url"],
            "https://app.test/portal-cliente/demo-token",
        )
        self.assertEqual(
            payload["interactive"]["body"]["text"],
            "Si quieres entrar al portal, toca el boton.",
        )

    @override_settings(
        OUTBOUND_WHATSAPP_ALLOWED_NUMBERS=["525512345678"],
        WHATSAPP_CLOUD_API_BASE_URL="https://graph.facebook.com",
        WHATSAPP_CLOUD_API_VERSION="v25.0",
    )
    @patch("comunicaciones.outbound.requests.post")
    def test_send_whatsapp_message_envia_boton_respuesta_meta(self, mocked_post):
        config = ConfiguracionComunicacion.objects.create(
            capa_negocio=self.capa,
            clave="PRINCIPAL",
        )
        CanalWhatsappOficial.objects.create(
            capa_negocio=self.capa,
            nombre="Cobranza oficial",
            display_phone_number="+52 999 000 0000",
            numero_wa_id="529990000000",
            phone_number_id="123456789",
            business_account_id="987654321",
            waba_id="987654321",
            access_token="meta-token",
            estado="CONECTADO",
            puede_enviar=True,
            puede_recibir=True,
            es_principal=True,
            activo=True,
        )
        mocked_post.return_value.status_code = 200
        mocked_post.return_value.json.return_value = {
            "messages": [{"id": "wamid.reply-button"}],
            "contacts": [{"wa_id": "525512345678"}],
        }

        send_whatsapp_message(
            config=config,
            cliente=self.cliente,
            chat_id="525512345678",
            message="Elige una opcion.",
            interactive_reply_buttons=[
                {"id": "betterp_portal_access", "title": "Abrir portal"}
            ],
        )

        mocked_post.assert_called_once()
        _, kwargs = mocked_post.call_args
        payload = kwargs["json"]
        self.assertEqual(payload["type"], "interactive")
        self.assertEqual(payload["interactive"]["type"], "button")
        button = payload["interactive"]["action"]["buttons"][0]
        self.assertEqual(button["type"], "reply")
        self.assertEqual(button["reply"]["id"], "betterp_portal_access")
        self.assertEqual(button["reply"]["title"], "Abrir portal")

    def test_meta_cloud_webhook_audita_baja_si_switch_apagado(self):
        ConfiguracionComunicacion.objects.create(
            capa_negocio=self.capa,
            clave="PRINCIPAL",
            procesar_webhooks_async=False,
            auto_detectar_comprobantes=True,
            respetar_bajas_whatsapp=False,
        )
        CanalWhatsappOficial.objects.create(
            capa_negocio=self.capa,
            nombre="Cobranza oficial",
            display_phone_number="+52 999 000 0000",
            numero_wa_id="529990000000",
            phone_number_id="123456789",
            business_account_id="987654321",
            waba_id="987654321",
            access_token="meta-token",
            estado="CONECTADO",
            puede_enviar=True,
            puede_recibir=True,
            es_principal=True,
            activo=True,
        )
        webhook = WebhookEntrante.objects.create(
            proveedor="META_CLOUD_API",
            origen_externo_id="wamid.audit-only.1",
            tipo_webhook="messages",
            chat_id="123456789",
            remitente="5215512345678",
            payload_completo={
                "object": "whatsapp_business_account",
                "entry": [
                    {
                        "id": "987654321",
                        "changes": [
                            {
                                "field": "messages",
                                "value": {
                                    "metadata": {
                                        "display_phone_number": "+52 999 000 0000",
                                        "phone_number_id": "123456789",
                                    },
                                    "messages": [
                                        {
                                            "from": "5215512345678",
                                            "id": "wamid.audit-only.1",
                                            "timestamp": "1770000000",
                                            "type": "text",
                                            "text": {"body": "No enviar mas mensajes"},
                                        }
                                    ],
                                },
                            }
                        ],
                    }
                ],
            },
        )

        process_webhook_safe(webhook.id)

        self.cliente.refresh_from_db()
        self.assertFalse(self.cliente.no_contactar_cobranza)
        mensaje = MensajeEntrante.objects.get(origen_externo_id="wamid.audit-only.1")
        self.assertEqual(mensaje.cliente_relacionado_id, self.cliente.id)
        self.assertEqual(
            mensaje.metadata["collection_opt_out"]["keyword"],
            "NO ENVIAR MAS MENSAJES",
        )
        self.assertFalse(mensaje.metadata["collection_opt_out"]["applied"])
        self.assertEqual(
            mensaje.metadata["collection_opt_out"]["policy_mode"],
            "AUDIT_ONLY",
        )
        self.assertFalse(EvidenciaPago.objects.filter(mensaje_relacionado=mensaje).exists())

    def test_meta_cloud_webhook_no_marca_no_contactar_con_texto_normal(self):
        ConfiguracionComunicacion.objects.create(
            capa_negocio=self.capa,
            clave="PRINCIPAL",
            procesar_webhooks_async=False,
            auto_detectar_comprobantes=True,
        )
        CanalWhatsappOficial.objects.create(
            capa_negocio=self.capa,
            nombre="Cobranza oficial",
            display_phone_number="+52 999 000 0000",
            numero_wa_id="529990000000",
            phone_number_id="123456789",
            business_account_id="987654321",
            waba_id="987654321",
            access_token="meta-token",
            estado="CONECTADO",
            puede_enviar=True,
            puede_recibir=True,
            es_principal=True,
            activo=True,
        )
        webhook = WebhookEntrante.objects.create(
            proveedor="META_CLOUD_API",
            origen_externo_id="wamid.normal.1",
            tipo_webhook="messages",
            chat_id="123456789",
            remitente="5215512345678",
            payload_completo={
                "entry": [
                    {
                        "changes": [
                            {
                                "field": "messages",
                                "value": {
                                    "metadata": {
                                        "display_phone_number": "+52 999 000 0000",
                                        "phone_number_id": "123456789",
                                    },
                                    "messages": [
                                        {
                                            "from": "5215512345678",
                                            "id": "wamid.normal.1",
                                            "timestamp": "1770000000",
                                            "type": "text",
                                            "text": {
                                                "body": "Ya subi mi comprobante, gracias."
                                            },
                                        }
                                    ],
                                },
                            }
                        ]
                    }
                ]
            },
        )

        process_webhook_safe(webhook.id)

        self.cliente.refresh_from_db()
        self.assertFalse(self.cliente.no_contactar_cobranza)
        mensaje = MensajeEntrante.objects.get(origen_externo_id="wamid.normal.1")
        self.assertNotIn("collection_opt_out", mensaje.metadata)

    def test_green_api_webhook_marca_no_contactar_por_stop(self):
        config = ConfiguracionComunicacion.objects.create(
            capa_negocio=self.capa,
            clave="PRINCIPAL",
            green_api_webhook_token="green-hook-token",
            procesar_webhooks_async=False,
            auto_detectar_comprobantes=True,
        )
        CanalPermitido.objects.create(
            configuracion_relacionada=config,
            canal="GRUPO_WHATSAPP",
            nombre="Cobranza Maya",
            identificador_externo="120363000111222@g.us",
            entidad_relacionada=self.entidad,
            tipo_movimiento_default="INGRESO",
            capturar_evidencias=True,
            activo=True,
        )
        response = self.client.post(
            "/api/comunicaciones/green-api/webhook/",
            data=json.dumps(
                {
                    "typeWebhook": "incomingMessageReceived",
                    "timestamp": 1770000000,
                    "idMessage": "MSG-STOP-001",
                    "senderData": {
                        "chatId": "120363000111222@g.us",
                        "sender": "5215512345678@c.us",
                        "senderName": "Daniel",
                        "senderContactName": "Daniel Muller",
                    },
                    "messageData": {
                        "typeMessage": "textMessage",
                        "textMessageData": {"textMessage": "stop"},
                    },
                }
            ),
            content_type="application/json",
            HTTP_AUTHORIZATION="Bearer green-hook-token",
        )

        self.assertEqual(response.status_code, 200)
        process_webhook_safe(response.json()["webhook_id"])

        self.cliente.refresh_from_db()
        self.assertTrue(self.cliente.no_contactar_cobranza)
        self.assertIn("STOP", self.cliente.no_contactar_cobranza_motivo or "")
        mensaje = MensajeEntrante.objects.get(origen_externo_id="MSG-STOP-001")
        self.assertEqual(mensaje.cliente_relacionado_id, self.cliente.id)
        self.assertEqual(mensaje.metadata["collection_opt_out"]["provider"], "GREEN_API")
        self.assertTrue(mensaje.metadata["collection_opt_out"]["applied"])
        self.assertFalse(EvidenciaPago.objects.filter(mensaje_relacionado=mensaje).exists())

    @patch("comunicaciones.api.requests.post")
    def test_sync_green_api_envia_set_settings(self, mocked_post):
        ConfiguracionComunicacion.objects.create(
            capa_negocio=self.capa,
            clave="PRINCIPAL",
            green_api_api_url="https://api.green-api.com",
            green_api_instance_id="7103000000",
            green_api_token="green-secret",
            green_api_webhook_url="https://betterp.onrender.com/api/comunicaciones/green-api/webhook/",
            green_api_webhook_token="Bearer webhook-token",
        )

        mocked_post.return_value.status_code = 200
        mocked_post.return_value.json.return_value = {"saveSettings": True}

        response = self.client.post(
            "/api/comunicaciones/configuracion/green-api/sync/",
            **self.auth_headers,
        )

        self.assertEqual(response.status_code, 200)
        mocked_post.assert_called_once()
        _, kwargs = mocked_post.call_args
        self.assertEqual(
            kwargs["json"]["webhookUrl"],
            "https://betterp.onrender.com/api/comunicaciones/green-api/webhook/",
        )
        self.assertEqual(kwargs["json"]["incomingWebhook"], "yes")

    def test_resolve_recipient_channels_respects_email_toggle(self):
        config = ConfiguracionComunicacion.objects.create(
            clave="PRINCIPAL",
            email_activo=False,
        )

        recipients = resolve_recipient_channels("AMBOS", self.cliente, config=config)
        self.assertEqual(recipients, [("WHATSAPP", "5215512345678@c.us")])

        config.email_activo = True
        config.save(update_fields=["email_activo"])

        recipients = resolve_recipient_channels("AMBOS", self.cliente, config=config)
        self.assertEqual(
            recipients,
            [
                ("WHATSAPP", "5215512345678@c.us"),
                ("EMAIL", "daniel@test.com"),
            ],
        )

    def test_normalize_whatsapp_destination_uses_cloud_api_mexico_format(self):
        self.assertEqual(
            normalize_whatsapp_destination("5215512345678@c.us"),
            "525512345678",
        )
        self.assertEqual(
            normalize_whatsapp_destination("525512345678"),
            "525512345678",
        )

    @override_settings(COLLECTION_REQUIRE_CONSENT_FOR_WHATSAPP=True)
    def test_preview_items_incluyen_validacion_de_contacto(self):
        config = ConfiguracionComunicacion.objects.create(
            capa_negocio=self.capa,
            clave="PRINCIPAL",
        )
        plantilla = PlantillaMensaje.objects.create(
            capa_negocio=self.capa,
            nombre="Preventivo con validacion",
            canal="WHATSAPP",
            tipo_plantilla="RECORDATORIO_PAGO",
            cuerpo="Hola {{cliente_nombre}}, revisa {{portal_url}}",
            incluye_link_portal=True,
            whatsapp_template_name="betterp_pago_preventivo",
            whatsapp_template_language="es_MX",
            whatsapp_template_status="APROBADA",
            activo=True,
        )
        CuentaPorCobrar.objects.create(
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            concepto="Renta Hab 01",
            referencia_unica="MCO-VALIDACION-001",
            fecha_periodo_inicio=date(2026, 6, 1),
            fecha_periodo_fin=date(2026, 6, 30),
            fecha_vencimiento=date(2026, 6, 25),
            monto_total=Decimal("8500.00"),
            monto_pagado=Decimal("0.00"),
        )

        preview_items = build_preview_items(
            config=config,
            template=plantilla,
            allowed_entity_ids=[self.entidad.id],
            entity_id=self.entidad.id,
            client_ids=[self.cliente.id],
            segment="POR_VENCER",
            channel="WHATSAPP",
            subject_override="",
            body_override="",
            include_portal=True,
            media_url="",
            reference_date=date(2026, 6, 20),
        )

        self.assertEqual(len(preview_items), 1)
        validation = preview_items[0]["validacion_contacto"]
        self.assertTrue(validation["telefono"]["presente"])
        self.assertEqual(validation["telefono"]["normalizado"], "525512345678")
        self.assertTrue(validation["consentimiento_cobranza"]["requerido"])
        self.assertFalse(validation["consentimiento_cobranza"]["aceptado"])
        self.assertIn("CONSENTIMIENTO_PENDIENTE", validation["bloqueantes"])
        self.assertFalse(validation["listo_para_envio"])
        billing_validation = preview_items[0]["validacion_cobranza"]
        self.assertTrue(billing_validation["requerida"])
        self.assertEqual(billing_validation["cuentas"]["abiertas"], 1)
        self.assertEqual(billing_validation["saldo"]["total_exigible"], 8500.0)
        self.assertTrue(billing_validation["saldo"]["positivo"])
        self.assertTrue(billing_validation["vencimiento"]["presente"])
        self.assertEqual(billing_validation["vencimiento"]["fecha"], "25/06/2026")
        self.assertEqual(billing_validation["bloqueantes"], [])
        self.assertTrue(billing_validation["listo_para_envio"])

    @patch("comunicaciones.outbound.build_cxc_customer_detail")
    def test_build_portal_payload_uses_signed_token(self, mocked_detail):
        ConfiguracionComunicacion.objects.create(
            clave="PRINCIPAL",
            portal_token_horas=48,
        )
        mocked_detail.return_value = {
            "cliente": {
                "id": self.cliente.id,
                "nombre": self.cliente.razon_social,
                "rfc": self.cliente.rfc,
                "entidad_nombre": self.entidad.nombre_comercial,
            },
            "resumen": {
                "saldo_vivo": 9000,
                "recargos_activos": 0,
                "total_pagado": 0,
                "total_facturado": 9000,
                "score_pago": 100,
                "score_label": "Excelente",
                "cuentas_totales": 1,
                "cuentas_vencidas_abiertas": 0,
                "cuentas_en_gracia": 0,
            },
            "comportamiento": {},
            "tendencia_periodos": [],
            "pagos_recientes": [],
            "cuentas": [],
        }

        token = build_portal_token(cliente=self.cliente, horas=48)
        self.assertFalse(token.startswith("."))
        payload = build_portal_payload(token=token)

        self.assertEqual(payload["cliente"]["id"], self.cliente.id)
        self.assertEqual(payload["cliente"]["correo"], "daniel@test.com")
        self.assertEqual(payload["portal"]["token_horas"], 48)
        self.assertIn("transferencia", payload)
        self.assertIn("facturas_recientes", payload)
        self.assertIn("comprobantes_recientes", payload)
        self.assertTrue(payload["consentimiento_cobranza"]["requerido"])
        self.assertFalse(payload["consentimiento_cobranza"]["aceptado"])

    def test_portal_detail_is_locked_without_otp_session(self):
        ConfiguracionComunicacion.objects.create(
            clave="PRINCIPAL",
            portal_token_horas=48,
        )
        token = build_portal_token(cliente=self.cliente, horas=48)

        response = self.client.get(f"/api/comunicaciones/portal/{token}/")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertIsNone(body["cliente"]["id"])
        self.assertEqual(body["cuentas"], [])
        self.assertTrue(body["portal_auth"]["required"])
        self.assertFalse(body["portal_auth"]["verified"])
        self.assertTrue(body["portal_auth"]["can_request_code"])

    @patch("comunicaciones.outbound_api.secrets.randbelow", return_value=123456)
    @patch("comunicaciones.outbound_api.send_whatsapp_message")
    def test_portal_otp_request_and_verify_unlocks_payload(
        self,
        mocked_send,
        mocked_randbelow,
    ):
        ConfiguracionComunicacion.objects.create(
            capa_negocio=self.capa,
            clave="PRINCIPAL",
            portal_token_horas=48,
        )
        mocked_send.return_value = {
            "provider": "META_CLOUD_API",
            "messages": [{"id": "wamid.test"}],
            "contacts": [{"input": "525512345678", "wa_id": "525512345678"}],
        }
        token = build_portal_token(cliente=self.cliente, horas=48)

        request_response = self.client.post(
            f"/api/comunicaciones/portal/{token}/otp/request/"
        )

        self.assertEqual(request_response.status_code, 200, request_response.content)
        request_body = request_response.json()
        self.assertEqual(request_body["message_id"], "wamid.test")
        self.assertEqual(request_body["provider"], "META_CLOUD_API")
        self.assertEqual(request_body["template_name"], "betterp_portal_otp")
        challenge = PortalOtpChallenge.objects.get(cliente=self.cliente)
        self.assertEqual(challenge.estado, "PENDIENTE")
        mocked_send.assert_called_once()
        send_kwargs = mocked_send.call_args.kwargs
        self.assertEqual(send_kwargs["template_name"], "betterp_portal_otp")
        self.assertEqual(send_kwargs["template_parameters"], ["123456"])
        self.assertEqual(send_kwargs["template_button_parameters"], ["123456"])
        mocked_randbelow.assert_called_once_with(1_000_000)

        verify_response = self.client.post(
            f"/api/comunicaciones/portal/{token}/otp/verify/",
            data=json.dumps({"codigo": "123456"}),
            content_type="application/json",
        )

        self.assertEqual(verify_response.status_code, 200, verify_response.content)
        verify_body = verify_response.json()
        self.assertTrue(verify_body["portal"]["portal_auth"]["verified"])
        self.assertTrue(verify_body["portal_session_token"])
        challenge.refresh_from_db()
        self.assertEqual(challenge.estado, "VERIFICADO")
        self.assertTrue(challenge.session_token_hash)

        detail_response = self.client.get(
            f"/api/comunicaciones/portal/{token}/",
            HTTP_X_PORTAL_SESSION=verify_body["portal_session_token"],
        )

        self.assertEqual(detail_response.status_code, 200, detail_response.content)
        detail_body = detail_response.json()
        self.assertEqual(detail_body["cliente"]["id"], self.cliente.id)
        self.assertTrue(detail_body["portal_auth"]["verified"])

    def test_portal_consent_requires_otp_session(self):
        ConfiguracionComunicacion.objects.create(
            clave="PRINCIPAL",
            portal_token_horas=48,
        )
        token = build_portal_token(cliente=self.cliente, horas=48)

        response = self.client.post(
            f"/api/comunicaciones/portal/{token}/consentimiento-cobranza/",
            data=json.dumps(
                {
                    "acepta_comunicaciones_cobranza": True,
                    "acepta_actualizacion_contacto": True,
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 403)
        self.assertIn("codigo", response.json()["detail"])

    def test_portal_accepts_collection_consent(self):
        ConfiguracionComunicacion.objects.create(
            clave="PRINCIPAL",
            portal_token_horas=48,
        )
        token = build_portal_token(cliente=self.cliente, horas=48)

        response = self.aceptar_consentimiento_portal(token)

        self.assertEqual(response.status_code, 200, response.content)
        self.cliente.refresh_from_db()
        self.assertTrue(self.cliente.consentimiento_cobranza_aceptado)
        self.assertIsNotNone(self.cliente.consentimiento_cobranza_fecha)
        self.assertTrue(self.cliente.consentimiento_cobranza_version)
        self.assertEqual(response.json()["portal"]["consentimiento_cobranza"]["aceptado"], True)

    def test_portal_upload_requires_collection_consent(self):
        ConfiguracionComunicacion.objects.create(
            clave="PRINCIPAL",
            portal_token_horas=48,
        )
        cuenta = CuentaPorCobrar.objects.create(
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            concepto="Renta mayo",
            fecha_vencimiento=date(2026, 5, 5),
            monto_total=Decimal("9000"),
            periodicidad="MENSUAL",
        )
        token = build_portal_token(cliente=self.cliente, horas=48)
        headers = self.activar_sesion_portal(token)
        upload = SimpleUploadedFile(
            "comprobante.pdf",
            b"%PDF-1.4 comprobante",
            content_type="application/pdf",
        )

        response = self.client.post(
            f"/api/comunicaciones/portal/{token}/comprobantes/",
            {
                "cuenta_id": cuenta.id,
                "monto": "9000.00",
                "referencia": "SPEI-123",
                "archivo": upload,
            },
            **headers,
        )

        self.assertEqual(response.status_code, 403)
        self.assertIn("consentimiento", response.json()["detail"])

    def test_portal_upload_csf_updates_customer_fiscal_data(self):
        ConfiguracionComunicacion.objects.create(
            clave="PRINCIPAL",
            portal_token_horas=48,
        )
        self.cliente.rfc = ""
        self.cliente.regimen_fiscal = ""
        self.cliente.codigo_postal = ""
        self.cliente.save(update_fields=["rfc", "regimen_fiscal", "codigo_postal"])
        token = build_portal_token(cliente=self.cliente, horas=48)
        self.aceptar_consentimiento_portal(token)
        upload = SimpleUploadedFile(
            "csf.pdf",
            b"%PDF-1.4 csf",
            content_type="application/pdf",
        )

        with patch(
            "comunicaciones.outbound_api.extract_csf_data_from_upload",
            return_value={
                "razon_social": "DANIEL CATALAN VIGARAY",
                "rfc": "CAVD900101AB1",
                "regimen_fiscal": "Regimen de Arrendamiento",
                "codigo_postal": "97000",
                "es_persona_moral": False,
            },
        ), patch(
            "comunicaciones.outbound_api.upload_csf_to_r2",
            return_value="https://r2.test/csf/cliente.pdf",
        ):
            response = self.client.post(
                f"/api/comunicaciones/portal/{token}/csf/",
                {"archivo": upload},
            )

        self.assertEqual(response.status_code, 200)
        self.cliente.refresh_from_db()
        self.assertEqual(self.cliente.rfc, "CAVD900101AB1")
        self.assertEqual(self.cliente.regimen_fiscal, "Regimen de Arrendamiento")
        self.assertEqual(self.cliente.codigo_postal, "97000")
        self.assertEqual(self.cliente.archivo_csf_url, "https://r2.test/csf/cliente.pdf")
        body = response.json()
        self.assertEqual(body["portal"]["datos_fiscales"]["rfc"], "CAVD900101AB1")
        self.assertIn("actualizados", body["mensaje"])

    def test_portal_upload_csf_with_multiple_regimes_requires_selection(self):
        ConfiguracionComunicacion.objects.create(
            clave="PRINCIPAL",
            portal_token_horas=48,
        )
        self.cliente.regimen_fiscal = "Regimen Simplificado de Confianza"
        self.cliente.save(update_fields=["regimen_fiscal"])
        token = build_portal_token(cliente=self.cliente, horas=48)
        self.aceptar_consentimiento_portal(token)
        upload = SimpleUploadedFile(
            "csf.pdf",
            b"%PDF-1.4 csf",
            content_type="application/pdf",
        )
        detected_regimes = [
            {
                "codigo": "612",
                "descripcion": "Personas Fisicas con Actividades Empresariales y Profesionales",
                "label": "612 - Personas Fisicas con Actividades Empresariales y Profesionales",
            },
            {
                "codigo": "625",
                "descripcion": "Plataformas Tecnologicas",
                "label": "625 - Plataformas Tecnologicas",
            },
        ]

        with patch(
            "comunicaciones.outbound_api.extract_csf_data_from_upload",
            return_value={
                "razon_social": "ALFREDO GODINEZ VARGAS",
                "rfc": "GOVA9009195Y0",
                "regimen_fiscal": "",
                "regimenes_fiscales_detectados": detected_regimes,
                "regimen_fiscal_pendiente_seleccion": True,
                "codigo_postal": "01729",
                "es_persona_moral": False,
            },
        ), patch(
            "comunicaciones.outbound_api.upload_csf_to_r2",
            return_value="https://r2.test/csf/multiple.pdf",
        ):
            response = self.client.post(
                f"/api/comunicaciones/portal/{token}/csf/",
                {"archivo": upload},
            )

        self.assertEqual(response.status_code, 200)
        self.cliente.refresh_from_db()
        self.assertEqual(self.cliente.regimen_fiscal, "")
        self.assertTrue(self.cliente.regimen_fiscal_pendiente_seleccion)
        self.assertEqual(self.cliente.regimenes_fiscales_detectados, detected_regimes)
        body = response.json()
        self.assertTrue(
            body["portal"]["datos_fiscales"]["regimen_fiscal_pendiente_seleccion"]
        )
        self.assertEqual(
            body["portal"]["datos_fiscales"]["regimenes_fiscales_detectados"],
            detected_regimes,
        )

    def test_portal_selects_detected_csf_regime(self):
        ConfiguracionComunicacion.objects.create(
            clave="PRINCIPAL",
            portal_token_horas=48,
        )
        self.cliente.regimen_fiscal = ""
        self.cliente.regimen_fiscal_pendiente_seleccion = True
        self.cliente.regimenes_fiscales_detectados = [
            {
                "codigo": "612",
                "descripcion": "Personas Fisicas con Actividades Empresariales y Profesionales",
                "label": "612 - Personas Fisicas con Actividades Empresariales y Profesionales",
            },
            {
                "codigo": "625",
                "descripcion": "Plataformas Tecnologicas",
                "label": "625 - Plataformas Tecnologicas",
            },
        ]
        self.cliente.save(
            update_fields=[
                "regimen_fiscal",
                "regimen_fiscal_pendiente_seleccion",
                "regimenes_fiscales_detectados",
            ]
        )
        token = build_portal_token(cliente=self.cliente, horas=48)
        self.aceptar_consentimiento_portal(token)

        response = self.client.post(
            f"/api/comunicaciones/portal/{token}/csf/regimen/",
            {"regimen_fiscal": "625"},
        )

        self.assertEqual(response.status_code, 200)
        self.cliente.refresh_from_db()
        self.assertEqual(self.cliente.regimen_fiscal, "625 - Plataformas Tecnologicas")
        self.assertFalse(self.cliente.regimen_fiscal_pendiente_seleccion)
        self.assertFalse(
            response.json()["portal"]["datos_fiscales"]["regimen_fiscal_pendiente_seleccion"]
        )

    def test_portal_delete_csf_removes_file_without_clearing_fiscal_data(self):
        ConfiguracionComunicacion.objects.create(
            clave="PRINCIPAL",
            portal_token_horas=48,
        )
        self.cliente.archivo_csf_url = "https://r2.test/csf/cliente.pdf"
        self.cliente.regimen_fiscal = "Regimen de Arrendamiento"
        self.cliente.codigo_postal = "97000"
        self.cliente.save(
            update_fields=["archivo_csf_url", "regimen_fiscal", "codigo_postal"]
        )
        token = build_portal_token(cliente=self.cliente, horas=48)
        self.aceptar_consentimiento_portal(token)

        response = self.client.delete(f"/api/comunicaciones/portal/{token}/csf/")

        self.assertEqual(response.status_code, 200)
        self.cliente.refresh_from_db()
        self.assertEqual(self.cliente.archivo_csf_url, "")
        self.assertEqual(self.cliente.rfc, "MUVD780315U21")
        self.assertEqual(self.cliente.regimen_fiscal, "Regimen de Arrendamiento")
        body = response.json()
        self.assertFalse(body["portal"]["datos_fiscales"]["archivo_csf_url"])
        self.assertIn("retirada", body["mensaje"])

    def test_portal_emit_invoice_for_customer_account(self):
        ConfiguracionComunicacion.objects.create(
            clave="PRINCIPAL",
            portal_token_horas=48,
        )
        self.capa.facturacion_activa = True
        self.capa.save(update_fields=["facturacion_activa"])
        self.cliente.regimen_fiscal = "Regimen Simplificado de Confianza"
        self.cliente.codigo_postal = "01729"
        self.cliente.archivo_csf_url = "https://r2.test/csf/cliente.pdf"
        self.cliente.save(
            update_fields=["regimen_fiscal", "codigo_postal", "archivo_csf_url"]
        )
        cuenta = CuentaPorCobrar.objects.create(
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            concepto="Renta mayo",
            fecha_emision=date(2026, 5, 1),
            fecha_vencimiento=date(2026, 5, 5),
            monto_total=Decimal("9000"),
            monto_pagado=Decimal("9000"),
            estatus_adeudo="CONCILIADO",
            periodicidad="MENSUAL",
        )
        invoice = FacturaEmitida.objects.create(
            capa_emisora=self.capa,
            cliente_receptor=self.cliente,
            cuenta_por_cobrar=cuenta,
            contexto="PORTAL_CLIENTE",
            proveedor="FACTURAMA",
            modo="SANDBOX",
            estatus="TIMBRADA",
            serie="A",
            folio=f"CXC-{cuenta.id}",
            uuid="uuid-portal",
            proveedor_factura_id="facturama-portal",
            idempotency_key=f"CXC:{cuenta.id}",
            emisor_rfc="AAA010101AAA",
            emisor_razon_social="MAYA COLIVING",
            emisor_regimen_fiscal="601",
            receptor_rfc=self.cliente.rfc,
            receptor_razon_social=self.cliente.razon_social,
            receptor_regimen_fiscal="626",
            receptor_codigo_postal="01729",
            subtotal=Decimal("9000"),
            impuestos=Decimal("1440"),
            total=Decimal("10440"),
        )
        token = build_portal_token(cliente=self.cliente, horas=48)
        self.aceptar_consentimiento_portal(token)

        with patch(
            "comunicaciones.outbound_api.find_existing_cxc_invoice",
            return_value=None,
        ), patch(
            "comunicaciones.outbound_api.build_cxc_invoice_draft",
            return_value=object(),
        ), patch(
            "comunicaciones.outbound_api.emit_invoice",
            return_value=invoice,
        ):
            response = self.client.post(
                f"/api/comunicaciones/portal/{token}/cuentas/{cuenta.id}/factura/"
            )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["factura"]["uuid"], "uuid-portal")
        self.assertEqual(body["portal"]["cuentas"][0]["factura"]["uuid"], "uuid-portal")
        self.assertIn("Factura emitida", body["mensaje"])

    def test_portal_emit_invoice_returns_provider_error_and_refreshes_portal(self):
        ConfiguracionComunicacion.objects.create(
            clave="PRINCIPAL",
            portal_token_horas=48,
        )
        cuenta = CuentaPorCobrar.objects.create(
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            concepto="Renta junio",
            fecha_emision=date(2026, 6, 1),
            fecha_vencimiento=date(2026, 6, 5),
            monto_total=Decimal("8500"),
            monto_pagado=Decimal("8500"),
            estatus_adeudo="CONCILIADO",
            periodicidad="MENSUAL",
        )
        factura = FacturaEmitida.objects.create(
            capa_emisora=self.capa,
            cliente_receptor=self.cliente,
            cuenta_por_cobrar=cuenta,
            contexto="PORTAL_CLIENTE",
            proveedor="FACTURAMA",
            modo="SANDBOX",
            estatus="ERROR",
            serie="A",
            folio=f"CXC-{cuenta.id}",
            uuid="",
            proveedor_factura_id="",
            idempotency_key=f"CXC:{cuenta.id}",
            emisor_rfc="AAA010101AAA",
            emisor_razon_social="MAYA COLIVING",
            emisor_regimen_fiscal="601",
            receptor_rfc=self.cliente.rfc,
            receptor_razon_social=self.cliente.razon_social,
            receptor_regimen_fiscal="626",
            receptor_codigo_postal="01729",
            error_proveedor="Facturama rechazo la solicitud (400): RFC receptor invalido.",
            subtotal=Decimal("8500"),
            impuestos=Decimal("0"),
            total=Decimal("8500"),
        )
        token = build_portal_token(cliente=self.cliente, horas=48)
        self.aceptar_consentimiento_portal(token)

        with patch(
            "comunicaciones.outbound_api.build_cxc_invoice_draft",
            return_value=object(),
        ), patch(
            "comunicaciones.outbound_api.emit_invoice",
            side_effect=HttpError(502, factura.error_proveedor),
        ):
            response = self.client.post(
                f"/api/comunicaciones/portal/{token}/cuentas/{cuenta.id}/factura/"
            )

        self.assertEqual(response.status_code, 502)
        body = response.json()
        self.assertIn("RFC receptor", body["detail"])
        self.assertEqual(body["factura"]["id"], factura.id)
        self.assertEqual(body["factura"]["estatus"], "ERROR")
        portal_account = next(
            item for item in body["portal"]["cuentas"] if item["id"] == cuenta.id
        )
        self.assertEqual(portal_account["factura"]["estatus"], "ERROR")

    def test_portal_upload_comprobante_registers_evidence_and_payment(self):
        ConfiguracionComunicacion.objects.create(
            clave="PRINCIPAL",
            portal_token_horas=48,
        )
        cuenta = CuentaPorCobrar.objects.create(
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            concepto="Renta mayo",
            fecha_emision=date(2026, 5, 1),
            fecha_vencimiento=date(2026, 5, 5),
            monto_total=Decimal("9000"),
            periodicidad="MENSUAL",
        )
        token = build_portal_token(cliente=self.cliente, horas=48)
        self.aceptar_consentimiento_portal(token)
        upload = SimpleUploadedFile(
            "comprobante.pdf",
            b"%PDF-1.4 comprobante",
            content_type="application/pdf",
        )

        response = self.client.post(
            f"/api/comunicaciones/portal/{token}/comprobantes/",
            {
                "cuenta_id": cuenta.id,
                "monto": "9000.00",
                "referencia": "SPEI-123",
                "archivo": upload,
            },
        )

        self.assertEqual(response.status_code, 200)
        cuenta.refresh_from_db()
        self.assertEqual(cuenta.monto_pagado, Decimal("9000.00"))
        evidencia = EvidenciaPago.objects.get(cliente_relacionado=self.cliente)
        self.assertEqual(evidencia.estatus, "APLICADA")
        self.assertEqual(evidencia.referencia_reportada, "SPEI-123")
        pago = PagoCuentaPorCobrar.objects.get(cuenta_por_cobrar=cuenta)
        self.assertEqual(pago.estatus_validacion, "APLICADO")
        self.assertEqual(pago.evidencia_pago_relacionada, evidencia)
        body = response.json()
        self.assertEqual(body["resultado"], "APLICADO")
        self.assertIsNotNone(body["evento_id"])
        evento = EventoFinanciero.objects.get(id=body["evento_id"])
        self.assertEqual(evento.estatus, "APLICADO")
        self.assertEqual(evento.evidencia_pago_relacionada, evidencia)
        self.assertEqual(evento.raw_data["origen"], "PORTAL_CLIENTE")
        pago.refresh_from_db()
        self.assertEqual(pago.evento_financiero_relacionado, evento)
        self.assertEqual(evento.partidas.count(), 1)
        self.assertEqual(evento.partidas.first().estatus, "APLICADA")
        self.assertIn("pago aplicado", body["mensaje"].lower())
        self.assertEqual(body["portal"]["resumen"]["saldo_vivo"], 0.0)
        self.assertEqual(len(body["portal"]["comprobantes_recientes"]), 1)
        self.assertEqual(
            body["portal"]["comprobantes_recientes"][0]["mensaje"],
            "Pago aplicado al estado de cuenta.",
        )

    @patch("comunicaciones.outbound_api.call_google_vision_receipt_analysis")
    def test_portal_upload_comprobante_reads_file_and_applies_without_manual_amount(
        self,
        mocked_google_vision,
    ):
        ConfiguracionComunicacion.objects.create(
            capa_negocio=self.capa,
            clave="PRINCIPAL",
            portal_token_horas=48,
            umbral_confianza_autoaplicacion=Decimal("90"),
        )
        cuenta = CuentaPorCobrar.objects.create(
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            concepto="Renta junio",
            fecha_emision=date(2026, 6, 1),
            fecha_vencimiento=date(2026, 6, 5),
            monto_total=Decimal("9000"),
            periodicidad="MENSUAL",
        )
        mocked_google_vision.return_value = (
            {
                "fuente": "google_vision",
                "modelo": "DOCUMENT_TEXT_DETECTION",
                "tokens": 0,
                "tipo_movimiento": "INGRESO",
                "monto": "9000.00",
                "fecha_pago": "2026-06-04",
                "referencia": "SPEI-PORTAL-IA",
                "banco": "BBVA",
                "emisor": "Cuenta origen",
                "receptor": "Maya Coliving",
                "concepto": "Transferencia bancaria",
                "texto_extraido": "Importe transferido $9,000.00 Folio SPEI-PORTAL-IA",
                "confianza": "95",
                "requiere_revision_manual": False,
                "observaciones": "Google Vision OCR leyo el comprobante.",
                "archivo_visual": {},
                "raw": {},
            },
            "",
        )
        token = build_portal_token(cliente=self.cliente, horas=48)
        self.aceptar_consentimiento_portal(token)
        upload = SimpleUploadedFile(
            "comprobante-ia.jpg",
            b"imagen comprobante ia 9000",
            content_type="image/jpeg",
        )

        response = self.client.post(
            f"/api/comunicaciones/portal/{token}/comprobantes/",
            {"archivo": upload},
        )

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(
            mocked_google_vision.call_args.kwargs["file_content"],
            b"imagen comprobante ia 9000",
        )
        self.assertEqual(mocked_google_vision.call_args.kwargs["filename"], "comprobante-ia.jpg")
        self.assertEqual(mocked_google_vision.call_args.kwargs["content_type"], "image/jpeg")
        cuenta.refresh_from_db()
        self.assertEqual(cuenta.monto_pagado, Decimal("9000.00"))
        evidencia = EvidenciaPago.objects.get(cliente_relacionado=self.cliente)
        self.assertEqual(evidencia.estatus, "APLICADA")
        self.assertEqual(evidencia.monto_reportado, Decimal("9000.00"))
        self.assertEqual(evidencia.referencia_reportada, "SPEI-PORTAL-IA")
        self.assertEqual(evidencia.metadata["modo_captura"], "archivo_ia")
        body = response.json()
        self.assertEqual(body["resultado"], "APLICADO")
        self.assertIn("pago aplicado", body["mensaje"].lower())

    @patch("comunicaciones.outbound_api.send_whatsapp_message")
    @patch("comunicaciones.outbound_api.call_google_vision_receipt_analysis")
    def test_portal_upload_comprobante_auto_applied_sends_whatsapp_acknowledgement(
        self,
        mocked_google_vision,
        mocked_send,
    ):
        ConfiguracionComunicacion.objects.create(
            capa_negocio=self.capa,
            clave="PRINCIPAL",
            portal_token_horas=48,
            umbral_confianza_autoaplicacion=Decimal("90"),
        )
        template = PlantillaMensaje.objects.create(
            capa_negocio=self.capa,
            nombre="Confirmacion comprobante WhatsApp",
            canal="WHATSAPP",
            tipo_plantilla="RECORDATORIO_PAGO",
            cuerpo=(
                "Hola {{cliente_nombre}}. Hemos recibido tu comprobante de pago "
                "para {{entidad_nombre}} por {{monto_recibido_formato}}. "
                "Consulta {{portal_url}}"
            ),
            whatsapp_template_name="betterp_pago_recibido",
            whatsapp_template_language="es_MX",
            whatsapp_template_status="APROBADA",
            activo=True,
        )
        mocked_google_vision.return_value = (
            {
                "fuente": "google_vision",
                "modelo": "DOCUMENT_TEXT_DETECTION",
                "tokens": 0,
                "tipo_movimiento": "INGRESO",
                "monto": "9000.00",
                "fecha_pago": "2026-06-04",
                "referencia": "SPEI-PORTAL-ACK",
                "banco": "BBVA",
                "emisor": "Cuenta origen",
                "receptor": "Maya Coliving",
                "concepto": "Transferencia bancaria",
                "texto_extraido": "Importe transferido $9,000.00 Folio SPEI-PORTAL-ACK",
                "confianza": "95",
                "requiere_revision_manual": False,
                "observaciones": "Google Vision OCR leyo el comprobante.",
                "archivo_visual": {},
                "raw": {},
            },
            "",
        )
        mocked_send.return_value = {
            "provider": "META_CLOUD_API",
            "messages": [{"id": "wamid.ocr.ack"}],
        }
        cuenta = CuentaPorCobrar.objects.create(
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            concepto="Renta junio",
            fecha_emision=date(2026, 6, 1),
            fecha_vencimiento=date(2026, 6, 5),
            monto_total=Decimal("9000"),
            periodicidad="MENSUAL",
        )
        token = build_portal_token(cliente=self.cliente, horas=48)
        self.aceptar_consentimiento_portal(token)
        upload = SimpleUploadedFile(
            "comprobante-ocr-ack.jpg",
            b"imagen comprobante ia ack 9000",
            content_type="image/jpeg",
        )

        response = self.client.post(
            f"/api/comunicaciones/portal/{token}/comprobantes/",
            {"archivo": upload},
        )

        self.assertEqual(response.status_code, 200, response.content)
        cuenta.refresh_from_db()
        self.assertEqual(cuenta.monto_pagado, Decimal("9000.00"))
        mocked_send.assert_called_once()
        send_kwargs = mocked_send.call_args.kwargs
        self.assertEqual(send_kwargs["template_name"], "betterp_pago_recibido")
        self.assertIn("$9.000,00", send_kwargs["template_parameters"])
        body = response.json()
        self.assertEqual(body["resultado"], "APLICADO")
        self.assertTrue(body["acuse_whatsapp_pago"]["enviado"])
        self.assertEqual(
            body["acuse_whatsapp_pago"]["template_name"],
            "betterp_pago_recibido",
        )
        history = HistorialEnvio.objects.get(plantilla_usada=template)
        self.assertEqual(history.estatus, "ENVIADO")
        self.assertEqual(history.referencia_envio, "wamid.ocr.ack")
        evidencia = EvidenciaPago.objects.get(cliente_relacionado=self.cliente)
        self.assertEqual(
            evidencia.metadata["acuse_whatsapp_pago"]["template_name"],
            "betterp_pago_recibido",
        )

    @patch("comunicaciones.outbound_api.send_whatsapp_message")
    @patch("comunicaciones.outbound_api.call_google_vision_receipt_analysis")
    def test_portal_upload_comprobante_readable_without_open_cxc_registers_saldo_a_favor(
        self,
        mocked_google_vision,
        mocked_send,
    ):
        ConfiguracionComunicacion.objects.create(
            capa_negocio=self.capa,
            clave="PRINCIPAL",
            portal_token_horas=48,
            umbral_confianza_autoaplicacion=Decimal("90"),
        )
        template = PlantillaMensaje.objects.create(
            capa_negocio=self.capa,
            nombre="Confirmacion comprobante WhatsApp",
            canal="WHATSAPP",
            tipo_plantilla="RECORDATORIO_PAGO",
            cuerpo=(
                "Hola {{cliente_nombre}}. Hemos recibido tu comprobante de pago "
                "por {{monto_recibido_formato}}. Referencia {{referencia_pago}}. "
                "Consulta {{portal_url}}"
            ),
            whatsapp_template_name="betterp_pago_recibido",
            whatsapp_template_language="es_MX",
            whatsapp_template_status="APROBADA",
            activo=True,
        )
        mocked_google_vision.return_value = (
            {
                "fuente": "google_vision",
                "modelo": "DOCUMENT_TEXT_DETECTION",
                "tokens": 0,
                "tipo_movimiento": "INGRESO",
                "monto": "7500.00",
                "fecha_pago": "2026-06-03",
                "referencia": "NU-30626",
                "banco": "Nu Mexico",
                "emisor": "Cliente prueba",
                "receptor": "Maya Coliving",
                "concepto": "Transferencia bancaria",
                "texto_extraido": (
                    "Comprobante de transferencia Monto $7,500.00 "
                    "Numero de referencia 30626"
                ),
                "confianza": "95",
                "requiere_revision_manual": False,
                "observaciones": "Google Vision OCR leyo el comprobante.",
                "archivo_visual": {},
                "raw": {},
            },
            "",
        )
        mocked_send.return_value = {
            "provider": "META_CLOUD_API",
            "messages": [{"id": "wamid.saldo.favor"}],
        }
        lab_contact = ContactoPruebaWhatsapp.objects.create(
            capa_negocio=self.capa,
            nombre="Daniel Lab",
            telefono="525512345678",
            telefono_normalizado="525512345678",
            consentimiento_confirmado=True,
            activo=True,
        )
        self.cliente.identificador = f"LAB-WA-{lab_contact.id}"
        self.cliente.save(update_fields=["identificador"])
        token = build_portal_token(cliente=self.cliente, horas=48)
        self.aceptar_consentimiento_portal(token)
        upload = SimpleUploadedFile(
            "comprobante-saldo-favor.jpg",
            b"imagen comprobante ia saldo favor 7500",
            content_type="image/jpeg",
        )

        response = self.client.post(
            f"/api/comunicaciones/portal/{token}/comprobantes/",
            {"archivo": upload},
        )

        self.assertEqual(response.status_code, 200, response.content)
        evidencia = EvidenciaPago.objects.get(cliente_relacionado=self.cliente)
        self.assertEqual(evidencia.estatus, "VALIDADA")
        self.assertFalse(evidencia.requiere_revision_manual)
        self.assertEqual(evidencia.monto_reportado, Decimal("7500.00"))
        self.assertEqual(evidencia.referencia_reportada, "NU-30626")
        self.assertEqual(PagoCuentaPorCobrar.objects.count(), 0)
        saldo = SaldoCliente.objects.get(
            cliente_relacionado=self.cliente,
            entidad_relacionada=self.entidad,
        )
        self.assertEqual(saldo.saldo_a_favor, Decimal("7500.00"))
        body = response.json()
        self.assertEqual(body["resultado"], "APLICADO")
        self.assertEqual(body["saldo_a_favor"], 7500.0)
        self.assertIn("saldo a favor", body["mensaje"].lower())
        evento = EventoFinanciero.objects.get(id=body["evento_id"])
        self.assertEqual(evento.estatus, "APLICADO")
        self.assertEqual(evento.evidencia_pago_relacionada, evidencia)
        self.assertIsNone(evento.raw_data["cuenta_id"])
        self.assertEqual(evento.partidas.count(), 1)
        partida = evento.partidas.first()
        self.assertEqual(partida.tipo_destino, "SALDO_A_FAVOR")
        self.assertEqual(partida.monto_partida, Decimal("7500.00"))
        mocked_send.assert_called_once()
        send_kwargs = mocked_send.call_args.kwargs
        self.assertEqual(send_kwargs["template_name"], "betterp_pago_recibido")
        self.assertFalse(send_kwargs["enforce_allowed_numbers"])
        self.assertIn("$7.500,00", send_kwargs["template_parameters"])
        self.assertIn("NU-30626", send_kwargs["template_parameters"])
        self.assertTrue(body["acuse_whatsapp_pago"]["enviado"])
        self.assertEqual(
            body["acuse_whatsapp_pago"]["template_name"],
            "betterp_pago_recibido",
        )
        history = HistorialEnvio.objects.get(plantilla_usada=template)
        self.assertEqual(history.estatus, "ENVIADO")
        self.assertEqual(history.referencia_envio, "wamid.saldo.favor")
        self.assertIsNone(history.metadata["cuenta_id"])
        self.assertTrue(history.metadata["saldo_a_favor"])

    @patch("comunicaciones.outbound_api.call_google_vision_receipt_analysis")
    def test_portal_upload_comprobante_readable_with_multiple_cxc_applies_oldest(
        self,
        mocked_google_vision,
    ):
        ConfiguracionComunicacion.objects.create(
            capa_negocio=self.capa,
            clave="PRINCIPAL",
            portal_token_horas=48,
            umbral_confianza_autoaplicacion=Decimal("90"),
        )
        oldest_account = CuentaPorCobrar.objects.create(
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            concepto="Renta habitacion mayo",
            fecha_emision=date(2026, 5, 1),
            fecha_vencimiento=date(2026, 5, 5),
            monto_total=Decimal("7500"),
            periodicidad="MENSUAL",
        )
        newest_account = CuentaPorCobrar.objects.create(
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            concepto="Renta habitacion junio",
            fecha_emision=date(2026, 6, 1),
            fecha_vencimiento=date(2026, 6, 5),
            monto_total=Decimal("7500"),
            periodicidad="MENSUAL",
        )
        mocked_google_vision.return_value = (
            {
                "fuente": "google_vision",
                "modelo": "DOCUMENT_TEXT_DETECTION",
                "tokens": 0,
                "tipo_movimiento": "INGRESO",
                "monto": "7500.00",
                "fecha_pago": "2026-06-03",
                "referencia": "NU-AMBIGUO",
                "banco": "Nu Mexico",
                "emisor": "Cliente prueba",
                "receptor": "Maya Coliving",
                "concepto": "Transferencia bancaria",
                "texto_extraido": "Monto $7,500.00 Referencia NU-AMBIGUO",
                "confianza": "95",
                "requiere_revision_manual": False,
                "observaciones": "Google Vision OCR leyo el comprobante.",
                "archivo_visual": {},
                "raw": {},
            },
            "",
        )
        token = build_portal_token(cliente=self.cliente, horas=48)
        self.aceptar_consentimiento_portal(token)
        upload = SimpleUploadedFile(
            "comprobante-ambiguo.jpg",
            b"imagen comprobante ia ambiguo 7500",
            content_type="image/jpeg",
        )

        response = self.client.post(
            f"/api/comunicaciones/portal/{token}/comprobantes/",
            {"archivo": upload},
        )

        self.assertEqual(response.status_code, 200, response.content)
        oldest_account.refresh_from_db()
        newest_account.refresh_from_db()
        evidencia = EvidenciaPago.objects.get(cliente_relacionado=self.cliente)
        self.assertEqual(evidencia.estatus, "APLICADA")
        self.assertEqual(oldest_account.monto_pagado, Decimal("7500.00"))
        self.assertEqual(newest_account.monto_pagado, Decimal("0.00"))
        pago = PagoCuentaPorCobrar.objects.get(cuenta_por_cobrar=oldest_account)
        self.assertEqual(pago.evidencia_pago_relacionada, evidencia)
        self.assertFalse(SaldoCliente.objects.filter(cliente_relacionado=self.cliente).exists())
        body = response.json()
        self.assertEqual(body["resultado"], "APLICADO")
        self.assertIsNone(body["aviso"])
        self.assertIn("pago aplicado", body["mensaje"].lower())
        self.assertEqual(Decimal(str(body["saldo_a_favor"])), Decimal("0"))
        evento = EventoFinanciero.objects.get(id=body["evento_id"])
        self.assertEqual(evento.partidas.count(), 1)
        partida = evento.partidas.first()
        self.assertEqual(partida.tipo_destino, "CXC")
        self.assertEqual(partida.cuenta_por_cobrar_relacionada_id, oldest_account.id)
        self.assertEqual(partida.monto_partida, Decimal("7500.00"))

    @patch("comunicaciones.outbound_api.call_google_vision_receipt_analysis")
    def test_portal_upload_comprobante_high_confidence_without_reference_applies_oldest(
        self,
        mocked_google_vision,
    ):
        ConfiguracionComunicacion.objects.create(
            capa_negocio=self.capa,
            clave="PRINCIPAL",
            portal_token_horas=48,
            umbral_confianza_autoaplicacion=Decimal("90"),
        )
        oldest_account = CuentaPorCobrar.objects.create(
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            concepto="Renta habitacion mayo",
            fecha_emision=date(2026, 5, 1),
            fecha_vencimiento=date(2026, 5, 5),
            monto_total=Decimal("7500"),
            periodicidad="MENSUAL",
        )
        newest_account = CuentaPorCobrar.objects.create(
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            concepto="Renta habitacion junio",
            fecha_emision=date(2026, 6, 1),
            fecha_vencimiento=date(2026, 6, 5),
            monto_total=Decimal("7500"),
            periodicidad="MENSUAL",
        )
        mocked_google_vision.return_value = (
            {
                "fuente": "google_vision",
                "modelo": "DOCUMENT_TEXT_DETECTION",
                "tokens": 0,
                "tipo_movimiento": "INGRESO",
                "monto": "7500.00",
                "fecha_pago": "03 JUN 2026",
                "referencia": "",
                "banco": "BBVA",
                "emisor": "Sara Hop Avayou",
                "receptor": "Maya Coliving",
                "concepto": "COBRANZA",
                "texto_extraido": "Monto $7,500.00 Autorizacion 03 JUN 2026",
                "confianza": "93",
                "requiere_revision_manual": True,
                "observaciones": "Google Vision OCR leyo el comprobante.",
                "archivo_visual": {},
                "raw": {},
            },
            "",
        )
        token = build_portal_token(cliente=self.cliente, horas=48)
        self.aceptar_consentimiento_portal(token)
        upload = SimpleUploadedFile(
            "comprobante-sin-referencia.jpg",
            b"imagen comprobante ia sin referencia 7500",
            content_type="image/jpeg",
        )

        response = self.client.post(
            f"/api/comunicaciones/portal/{token}/comprobantes/",
            {"archivo": upload},
        )

        self.assertEqual(response.status_code, 200, response.content)
        oldest_account.refresh_from_db()
        newest_account.refresh_from_db()
        evidencia = EvidenciaPago.objects.get(cliente_relacionado=self.cliente)
        self.assertEqual(evidencia.estatus, "APLICADA")
        self.assertFalse(evidencia.requiere_revision_manual)
        self.assertEqual(evidencia.fecha_pago_reportada, date(2026, 6, 3))
        self.assertIsNone(evidencia.referencia_reportada)
        self.assertEqual(oldest_account.monto_pagado, Decimal("7500.00"))
        self.assertEqual(newest_account.monto_pagado, Decimal("0.00"))
        body = response.json()
        self.assertEqual(body["resultado"], "APLICADO")
        self.assertIsNone(body["aviso"])
        self.assertIn("pago aplicado", body["mensaje"].lower())

    def test_analisis_reglas_google_vision_extrae_comprobante_nu_spei(self):
        config = ConfiguracionComunicacion.objects.create(
            clave="PRINCIPAL",
            umbral_confianza_autoaplicacion=Decimal("90"),
        )
        evidencia = EvidenciaPago.objects.create(
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            canal="WHATSAPP",
            origen_deteccion="MANUAL",
            url_archivo="https://example.com/comprobante-nu.jpg",
        )
        ocr_text = """
        nu
        Comprobante de transferencia
        Autorizacion 03 JUN 2026, 10:44:00 AM (hora de CDMX)
        Monto $7,500.00
        Tipo de transferencia SPEI
        Concepto sara hop palmas hills 1802A
        Numero de referencia 30626
        Cuenta destino
        Nombre maya coliving sa de cv
        Entidad BBVA MEXICO
        CLABE ****3748
        Estatus Aceptada
        Clave de rastreo NU3A41CSEFVB8EVOGOA1U459TFGO
        Cuenta origen
        Nombre sara hop avayou
        Entidad Nu Mexico
        CLABE ****6125
        Referencia interna 6a2059c7-8967-48bb-a6b3-b2a0e4a20eed
        """

        analysis = build_rule_receipt_analysis(
            config=config,
            evidencia=evidencia,
            source_text_override=ocr_text,
            source_label="google_vision",
            source_model="DOCUMENT_TEXT_DETECTION",
        )
        apply_receipt_analysis_to_evidence(
            evidencia=evidencia,
            config=config,
            analysis=analysis,
        )
        evidencia.refresh_from_db()

        self.assertEqual(evidencia.monto_reportado, Decimal("7500.00"))
        self.assertEqual(evidencia.fecha_pago_reportada, date(2026, 6, 3))
        self.assertEqual(evidencia.referencia_reportada, "30626")
        self.assertFalse(evidencia.requiere_revision_manual)
        self.assertEqual(
            evidencia.metadata["lectura_ia"]["modelo"],
            "DOCUMENT_TEXT_DETECTION",
        )
        self.assertEqual(evidencia.metadata["lectura_ia"]["banco"], "BBVA")

    def test_analisis_reglas_google_vision_extrae_comprobante_bbva_marzo(self):
        config = ConfiguracionComunicacion.objects.create(
            clave="PRINCIPAL",
            umbral_confianza_autoaplicacion=Decimal("90"),
        )
        evidencia = EvidenciaPago.objects.create(
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            canal="WHATSAPP",
            origen_deteccion="MANUAL",
            url_archivo="https://example.com/comprobante-bbva-marzo.jpg",
        )
        ocr_text = """
        BBVA
        COMPROBANTE DE LA OPERACION
        Tipo de operacion
        Transferencia a terceros
        Folio de la operacion
        0076235828
        Fecha
        14 marzo 2026
        Hora
        13:09 h
        Concepto
        Mes de marzo renta
        Importe transferido
        $ 8,500.00
        Cuenta de origen
        *5866
        Nombre del beneficiario
        Maya Coliving Sa De C
        Nombre del banco
        Cuenta BBVA
        Cuenta de destino
        *2374
        """

        analysis = build_rule_receipt_analysis(
            config=config,
            evidencia=evidencia,
            source_text_override=ocr_text,
            source_label="google_vision",
            source_model="DOCUMENT_TEXT_DETECTION",
        )
        apply_receipt_analysis_to_evidence(
            evidencia=evidencia,
            config=config,
            analysis=analysis,
        )
        evidencia.refresh_from_db()

        self.assertEqual(evidencia.monto_reportado, Decimal("8500.00"))
        self.assertEqual(evidencia.fecha_pago_reportada, date(2026, 3, 14))
        self.assertEqual(evidencia.referencia_reportada, "0076235828")
        self.assertFalse(evidencia.requiere_revision_manual)
        self.assertEqual(
            evidencia.metadata["lectura_ia"]["modelo"],
            "DOCUMENT_TEXT_DETECTION",
        )
        self.assertEqual(evidencia.metadata["lectura_ia"]["banco"], "BBVA")
        self.assertEqual(
            evidencia.metadata["lectura_ia"]["receptor"],
            "Maya Coliving Sa De C",
        )

    @patch("comunicaciones.outbound_api.call_google_vision_receipt_analysis")
    def test_portal_upload_comprobante_warns_when_receipt_is_not_readable(
        self,
        mocked_google_vision,
    ):
        ConfiguracionComunicacion.objects.create(
            clave="PRINCIPAL",
            portal_token_horas=48,
            umbral_confianza_autoaplicacion=Decimal("90"),
        )
        CuentaPorCobrar.objects.create(
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            concepto="Renta junio",
            fecha_emision=date(2026, 6, 1),
            fecha_vencimiento=date(2026, 6, 5),
            monto_total=Decimal("9000"),
            periodicidad="MENSUAL",
        )
        mocked_google_vision.return_value = (
            {
                "fuente": "google_vision",
                "modelo": "DOCUMENT_TEXT_DETECTION",
                "tokens": 0,
                "tipo_movimiento": "INGRESO",
                "monto": "",
                "fecha_pago": "",
                "referencia": "",
                "banco": "",
                "emisor": "",
                "receptor": "",
                "concepto": "POR_REVISAR",
                "texto_extraido": "",
                "confianza": "40",
                "requiere_revision_manual": True,
                "observaciones": "No se alcanzo a leer el comprobante.",
                "archivo_visual": {},
                "raw": {},
            },
            "",
        )
        token = build_portal_token(cliente=self.cliente, horas=48)
        self.aceptar_consentimiento_portal(token)
        upload = SimpleUploadedFile(
            "comprobante-borroso.jpg",
            b"imagen borrosa sin datos",
            content_type="image/jpeg",
        )

        response = self.client.post(
            f"/api/comunicaciones/portal/{token}/comprobantes/",
            {"archivo": upload},
        )

        self.assertEqual(response.status_code, 200, response.content)
        evidencia = EvidenciaPago.objects.get(cliente_relacionado=self.cliente)
        self.assertEqual(evidencia.estatus, "NUEVA")
        self.assertTrue(evidencia.requiere_revision_manual)
        self.assertIsNone(evidencia.monto_reportado)
        body = response.json()
        self.assertEqual(body["resultado"], "EN_REVISION")
        self.assertIn("no pudimos leer", body["mensaje"].lower())

    @patch("comunicaciones.outbound_api.call_google_vision_receipt_analysis")
    def test_portal_upload_comprobante_readable_pending_review_does_not_warn_unreadable(
        self,
        mocked_google_vision,
    ):
        ConfiguracionComunicacion.objects.create(
            capa_negocio=self.capa,
            clave="PRINCIPAL",
            portal_token_horas=48,
            umbral_confianza_autoaplicacion=Decimal("90"),
        )
        mocked_google_vision.return_value = (
            {
                "fuente": "google_vision",
                "modelo": "DOCUMENT_TEXT_DETECTION",
                "tokens": 0,
                "tipo_movimiento": "INGRESO",
                "monto": "7500.00",
                "fecha_pago": "2026-06-03",
                "referencia": "30626",
                "banco": "BBVA",
                "emisor": "Sara Hop Avayou",
                "receptor": "Maya Coliving",
                "concepto": "COBRANZA",
                "texto_extraido": "Monto $7,500.00 Numero de referencia 30626",
                "confianza": "85",
                "requiere_revision_manual": True,
                "observaciones": "Google Vision OCR leyo el comprobante.",
                "archivo_visual": {},
                "raw": {},
            },
            "",
        )
        token = build_portal_token(cliente=self.cliente, horas=48)
        self.aceptar_consentimiento_portal(token)
        upload = SimpleUploadedFile(
            "comprobante-nu.jpg",
            b"imagen comprobante nu",
            content_type="image/jpeg",
        )

        response = self.client.post(
            f"/api/comunicaciones/portal/{token}/comprobantes/",
            {"archivo": upload},
        )

        self.assertEqual(response.status_code, 200, response.content)
        evidencia = EvidenciaPago.objects.get(cliente_relacionado=self.cliente)
        self.assertEqual(evidencia.estatus, "NUEVA")
        self.assertEqual(evidencia.monto_reportado, Decimal("7500.00"))
        self.assertEqual(evidencia.fecha_pago_reportada, date(2026, 6, 3))
        self.assertEqual(evidencia.referencia_reportada, "30626")
        body = response.json()
        self.assertEqual(body["resultado"], "EN_REVISION")
        self.assertIn("comprobante recibido y leido", body["mensaje"].lower())
        self.assertNotIn("no pudimos leer", body["mensaje"].lower())

    @patch("comunicaciones.outbound_api.send_whatsapp_message")
    def test_portal_upload_comprobante_sends_full_payment_acknowledgement(
        self,
        mocked_send,
    ):
        ConfiguracionComunicacion.objects.create(
            capa_negocio=self.capa,
            clave="PRINCIPAL",
            portal_token_horas=48,
        )
        template = PlantillaMensaje.objects.create(
            capa_negocio=self.capa,
            nombre="Confirmacion comprobante WhatsApp",
            canal="WHATSAPP",
            tipo_plantilla="RECORDATORIO_PAGO",
            cuerpo=(
                "Hola {{cliente_nombre}}. Hemos recibido tu comprobante de pago "
                "para {{entidad_nombre}}. Consulta {{portal_url}}"
            ),
            whatsapp_template_name="betterp_pago_recibido",
            whatsapp_template_language="es_MX",
            whatsapp_template_status="APROBADA",
            activo=True,
        )
        mocked_send.return_value = {
            "provider": "META_CLOUD_API",
            "messages": [{"id": "wamid.full"}],
        }
        cuenta = CuentaPorCobrar.objects.create(
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            concepto="Renta mayo",
            fecha_emision=date(2026, 5, 1),
            fecha_vencimiento=date(2026, 5, 5),
            monto_total=Decimal("9000"),
            periodicidad="MENSUAL",
        )
        token = build_portal_token(cliente=self.cliente, horas=48)
        self.aceptar_consentimiento_portal(token)
        upload = SimpleUploadedFile(
            "comprobante-full.pdf",
            b"%PDF-1.4 comprobante full",
            content_type="application/pdf",
        )

        response = self.client.post(
            f"/api/comunicaciones/portal/{token}/comprobantes/",
            {
                "cuenta_id": cuenta.id,
                "monto": "9000.00",
                "referencia": "SPEI-FULL",
                "archivo": upload,
            },
        )

        self.assertEqual(response.status_code, 200)
        mocked_send.assert_called_once()
        send_kwargs = mocked_send.call_args.kwargs
        self.assertEqual(send_kwargs["template_name"], "betterp_pago_recibido")
        self.assertEqual(
            send_kwargs["template_parameters"][:2],
            ["Daniel Muller", "Maya Coliving"],
        )
        body = response.json()
        self.assertTrue(body["acuse_whatsapp_pago"]["enviado"])
        self.assertEqual(
            body["acuse_whatsapp_pago"]["template_name"],
            "betterp_pago_recibido",
        )
        history = HistorialEnvio.objects.get(plantilla_usada=template)
        self.assertEqual(history.estatus, "ENVIADO")
        self.assertEqual(history.referencia_envio, "wamid.full")
        self.assertEqual(history.tipo_envio, "AUTOMATICO")
        evidencia = EvidenciaPago.objects.get(cliente_relacionado=self.cliente)
        self.assertEqual(
            evidencia.metadata["acuse_whatsapp_pago"]["template_name"],
            "betterp_pago_recibido",
        )

    def test_portal_upload_comprobante_reports_partial_payment_balance(self):
        ConfiguracionComunicacion.objects.create(
            clave="PRINCIPAL",
            portal_token_horas=48,
        )
        cuenta = CuentaPorCobrar.objects.create(
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            concepto="Renta mayo",
            fecha_emision=date(2026, 5, 1),
            fecha_vencimiento=date(2026, 5, 5),
            monto_total=Decimal("9000"),
            periodicidad="MENSUAL",
        )
        token = build_portal_token(cliente=self.cliente, horas=48)
        self.aceptar_consentimiento_portal(token)
        upload = SimpleUploadedFile(
            "comprobante-parcial.pdf",
            b"%PDF-1.4 comprobante parcial",
            content_type="application/pdf",
        )

        response = self.client.post(
            f"/api/comunicaciones/portal/{token}/comprobantes/",
            {
                "cuenta_id": cuenta.id,
                "monto": "3500.00",
                "referencia": "SPEI-PARCIAL",
                "archivo": upload,
            },
        )

        self.assertEqual(response.status_code, 200)
        cuenta.refresh_from_db()
        self.assertEqual(cuenta.monto_pagado, Decimal("3500.00"))
        self.assertEqual(cuenta.saldo_pendiente, Decimal("5500.00"))
        body = response.json()
        self.assertEqual(body["resultado"], "APLICADO")
        self.assertIn("pago parcial", body["mensaje"].lower())
        self.assertIn("5500.00", body["mensaje"])
        self.assertEqual(body["portal"]["resumen"]["saldo_vivo"], 5500.0)

    @patch("comunicaciones.outbound_api.send_whatsapp_message")
    def test_portal_upload_comprobante_sends_partial_payment_acknowledgement(
        self,
        mocked_send,
    ):
        ConfiguracionComunicacion.objects.create(
            capa_negocio=self.capa,
            clave="PRINCIPAL",
            portal_token_horas=48,
        )
        template = PlantillaMensaje.objects.create(
            capa_negocio=self.capa,
            nombre="Pago parcial recibido WhatsApp",
            canal="WHATSAPP",
            tipo_plantilla="RECORDATORIO_PAGO",
            cuerpo=(
                "Hola {{cliente_nombre}}. Pago {{monto_recibido_formato}} "
                "recibido. Saldo {{saldo_pendiente_formato}}. {{portal_url}}"
            ),
            whatsapp_template_name="betterp_pago_parcial_recibido",
            whatsapp_template_language="es_MX",
            whatsapp_template_status="APROBADA",
            activo=True,
        )
        mocked_send.return_value = {
            "provider": "META_CLOUD_API",
            "messages": [{"id": "wamid.partial"}],
        }
        cuenta = CuentaPorCobrar.objects.create(
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            concepto="Renta mayo",
            fecha_emision=date(2026, 5, 1),
            fecha_vencimiento=date(2026, 5, 5),
            monto_total=Decimal("9000"),
            periodicidad="MENSUAL",
        )
        token = build_portal_token(cliente=self.cliente, horas=48)
        self.aceptar_consentimiento_portal(token)
        upload = SimpleUploadedFile(
            "comprobante-parcial-ack.pdf",
            b"%PDF-1.4 comprobante parcial ack",
            content_type="application/pdf",
        )

        response = self.client.post(
            f"/api/comunicaciones/portal/{token}/comprobantes/",
            {
                "cuenta_id": cuenta.id,
                "monto": "3500.00",
                "referencia": "SPEI-PARCIAL-ACK",
                "archivo": upload,
            },
        )

        self.assertEqual(response.status_code, 200)
        mocked_send.assert_called_once()
        send_kwargs = mocked_send.call_args.kwargs
        self.assertEqual(
            send_kwargs["template_name"],
            "betterp_pago_parcial_recibido",
        )
        self.assertIn("$3.500,00", send_kwargs["template_parameters"])
        self.assertIn("$5.500,00", send_kwargs["template_parameters"])
        body = response.json()
        self.assertTrue(body["acuse_whatsapp_pago"]["enviado"])
        self.assertEqual(
            body["acuse_whatsapp_pago"]["template_name"],
            "betterp_pago_parcial_recibido",
        )
        history = HistorialEnvio.objects.get(plantilla_usada=template)
        self.assertEqual(history.estatus, "ENVIADO")
        self.assertEqual(history.referencia_envio, "wamid.partial")

    @patch("comunicaciones.outbound_api.download_invoice_file")
    def test_portal_invoice_download_is_scoped_to_signed_customer(self, mocked_download):
        mocked_download.return_value = (
            b"PDF",
            "application/pdf",
            "factura-A1.pdf",
        )
        ConfiguracionComunicacion.objects.create(
            clave="PRINCIPAL",
            portal_token_horas=48,
        )
        cuenta = CuentaPorCobrar.objects.create(
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            concepto="Renta mayo",
            fecha_emision=date(2026, 5, 1),
            fecha_vencimiento=date(2026, 5, 5),
            monto_total=Decimal("9000"),
            periodicidad="MENSUAL",
        )
        factura = FacturaEmitida.objects.create(
            capa_emisora=self.capa,
            cliente_receptor=self.cliente,
            cuenta_por_cobrar=cuenta,
            contexto="CLIENTE_CXC",
            proveedor="FACTURAMA",
            modo="SANDBOX",
            estatus="TIMBRADA",
            serie="A",
            folio="1",
            uuid="uuid-prueba",
            proveedor_factura_id="provider-1",
            idempotency_key="test-portal-invoice",
            emisor_rfc="AAA010101AAA",
            emisor_razon_social="Maya Coliving",
            emisor_regimen_fiscal="601",
            receptor_rfc=self.cliente.rfc,
            receptor_razon_social=self.cliente.razon_social,
            receptor_regimen_fiscal="626",
            receptor_codigo_postal="97000",
            total=Decimal("9000"),
            fecha_emision=timezone.now(),
        )
        token = build_portal_token(cliente=self.cliente, horas=48)
        self.aceptar_consentimiento_portal(token)

        response = self.client.get(
            f"/api/comunicaciones/portal/{token}/facturas/{factura.id}/pdf/"
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, b"PDF")
        self.assertEqual(response["Content-Type"], "application/pdf")
        mocked_download.assert_called_once()

    def test_portal_invoice_download_requires_timbrada_provider_file(self):
        ConfiguracionComunicacion.objects.create(
            clave="PRINCIPAL",
            portal_token_horas=48,
        )
        cuenta = CuentaPorCobrar.objects.create(
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            concepto="Renta mayo",
            fecha_emision=date(2026, 5, 1),
            fecha_vencimiento=date(2026, 5, 5),
            monto_total=Decimal("9000"),
            monto_pagado=Decimal("9000"),
            estatus_adeudo="CONCILIADO",
            periodicidad="MENSUAL",
        )
        factura = FacturaEmitida.objects.create(
            capa_emisora=self.capa,
            cliente_receptor=self.cliente,
            cuenta_por_cobrar=cuenta,
            contexto="CLIENTE_CXC",
            proveedor="FACTURAMA",
            modo="SANDBOX",
            estatus="ERROR",
            serie="A",
            folio="2",
            uuid="",
            proveedor_factura_id="",
            idempotency_key="test-portal-invoice-error",
            emisor_rfc="AAA010101AAA",
            emisor_razon_social="Maya Coliving",
            emisor_regimen_fiscal="601",
            receptor_rfc=self.cliente.rfc,
            receptor_razon_social=self.cliente.razon_social,
            receptor_regimen_fiscal="626",
            receptor_codigo_postal="97000",
            total=Decimal("9000"),
            fecha_emision=timezone.now(),
        )
        token = build_portal_token(cliente=self.cliente, horas=48)
        self.aceptar_consentimiento_portal(token)

        response = self.client.get(
            f"/api/comunicaciones/portal/{token}/facturas/{factura.id}/pdf/"
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("no tiene archivos", response.json()["detail"])

    @override_settings(
        RESEND_API_KEY="re_test_123",
        RESEND_API_BASE_URL="https://api.resend.com",
        RESEND_FROM_EMAIL="notificaciones@mail.betterp.net",
        RESEND_FROM_NAME="BettERP",
        RESEND_REPLY_TO="soporte@betterp.net",
    )
    @patch("comunicaciones.email_provider.requests.post")
    def test_send_email_transport_uses_resend_when_available(self, mocked_post):
        mocked_post.return_value.status_code = 200
        mocked_post.return_value.content = b'{"id":"email_123"}'
        mocked_post.return_value.json.return_value = {"id": "email_123"}

        result = send_email_transport(
            destination="cliente@test.com",
            subject="Prueba Resend",
            message="Mensaje de prueba",
        )

        self.assertEqual(result["provider"], "RESEND")
        self.assertEqual(result["id"], "email_123")
        mocked_post.assert_called_once()
        _, kwargs = mocked_post.call_args
        self.assertEqual(
            kwargs["headers"]["Authorization"],
            "Bearer re_test_123",
        )
        self.assertEqual(
            kwargs["json"]["from"],
            "BettERP <notificaciones@mail.betterp.net>",
        )
        self.assertEqual(kwargs["json"]["reply_to"], ["soporte@betterp.net"])

    @override_settings(
        RESEND_WEBHOOK_SECRET="whsec_dGVzdC1zZWNyZXQ=",
    )
    def test_resend_webhook_updates_delivery_status(self):
        config = ConfiguracionComunicacion.objects.create(
            clave="PRINCIPAL",
            email_activo=True,
        )
        history = HistorialEnvio.objects.create(
            configuracion_relacionada=config,
            cliente_relacionado=self.cliente,
            entidad_relacionada=self.entidad,
            canal="EMAIL",
            tipo_envio="MANUAL",
            proveedor="RESEND",
            destinatario="daniel@test.com",
            asunto="Recordatorio",
            referencia_envio="email_123",
            estatus="ENVIADO",
        )
        payload = {
            "type": "email.delivered",
            "data": {
                "email_id": "email_123",
                "to": ["daniel@test.com"],
            },
        }
        raw_body = json.dumps(payload, separators=(",", ":"))
        webhook_id = "msg_test_123"
        webhook_timestamp = str(int(time.time()))
        signature = base64.b64encode(
            hmac.new(
                b"test-secret",
                f"{webhook_id}.{webhook_timestamp}.{raw_body}".encode("utf-8"),
                hashlib.sha256,
            ).digest()
        ).decode("utf-8")

        response = self.client.post(
            "/api/comunicaciones/webhooks/resend/",
            data=raw_body,
            content_type="application/json",
            HTTP_SVIX_ID=webhook_id,
            HTTP_SVIX_TIMESTAMP=webhook_timestamp,
            HTTP_SVIX_SIGNATURE=f"v1,{signature}",
        )

        self.assertEqual(response.status_code, 200)
        history.refresh_from_db()
        self.assertEqual(history.estatus, "ENTREGADO")
        self.assertEqual(history.metadata["resend_last_event"], "email.delivered")
        self.assertEqual(history.metadata["resend_svix_id"], webhook_id)

