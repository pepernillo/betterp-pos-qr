import json
from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth.hashers import identify_hasher, make_password
from django.contrib.auth.models import User
from django.core.cache import cache
from django.core import mail
from django.db import connection
from django.test import RequestFactory, TestCase, override_settings
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from billing.models import BackendRequestMetric, PlanSaaS, SuscripcionCapa
from crm.models import Cliente
from empresas.models import CapaNegocio, EntidadNegocio

from .api import build_audit_operational_summary
from .models import (
    DesafioDobleFactor,
    EventoAuditoria,
    InvitacionAcceso,
    InvitacionAdminPlataforma,
    MembresiaCapaNegocio,
    RecuperacionAcceso,
    UsuarioPerfil,
)
from .rate_limit import assert_auth_rate_limit, clear_auth_rate_limit
from .security import create_access_session, issue_token_pair


@override_settings(
    RESEND_API_KEY="",
    RESEND_FROM_EMAIL="",
    RESEND_FROM_NAME="",
    RESEND_REPLY_TO="",
)
class AccountsInvitationTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="owner@test.local",
            email="owner@test.local",
            password="secret123",
        )
        self.capa = CapaNegocio.objects.create(
            nombre="Maya Coliving",
            tipo_capa="OPERADORA",
            usuario_fundador=self.user,
        )
        MembresiaCapaNegocio.objects.create(
            user=self.user,
            capa_negocio=self.capa,
            rol="OWNER_ADMIN",
            activo=True,
        )
        self.session = create_access_session(self.user, provider="PASSWORD")
        tokens = issue_token_pair(self.session)
        self.auth_headers = {
            "HTTP_AUTHORIZATION": f"Bearer {tokens['access_token']}",
            "HTTP_X_BETTERP_CAPA_ID": str(self.capa.id),
        }

    def _headers_for_role(self, role: str, email: str) -> tuple[User, dict[str, str]]:
        user = User.objects.create_user(
            username=email,
            email=email,
            password="secret123",
        )
        MembresiaCapaNegocio.objects.create(
            user=user,
            capa_negocio=self.capa,
            rol=role,
            activo=True,
        )
        session = create_access_session(user, provider="PASSWORD")
        tokens = issue_token_pair(session)
        return user, {
            "HTTP_AUTHORIZATION": f"Bearer {tokens['access_token']}",
            "HTTP_X_BETTERP_CAPA_ID": str(self.capa.id),
        }

    def _create_role_test_entity(self) -> EntidadNegocio:
        return EntidadNegocio.objects.create(
            capa_negocio=self.capa,
            nombre_comercial="Unidad permisos",
            razon_social="Unidad permisos SA de CV",
            rfc="UPE010101AA1",
        )

    def _cliente_payload(self, entidad: EntidadNegocio, suffix: str = "001") -> dict:
        return {
            "entidad_relacionada_id": entidad.id,
            "es_persona_moral": False,
            "nombre_comercial": f"Cliente permisos {suffix}",
            "razon_social": f"Cliente permisos {suffix}",
            "rfc": "XAXX010101000",
            "regimen_fiscal": "616",
            "identificador": f"ROL-{suffix}",
            "correo_principal": f"cliente.{suffix}@test.local",
            "codigo_pais": "+52",
            "telefono": "5599999999",
            "pais": "Mexico",
            "estado": "Yucatan",
            "ciudad": "Merida",
            "colonia": "Centro",
            "calle": "Calle 1",
            "numero_exterior": "10",
            "codigo_postal": "97000",
            "dias_gracia": 0,
            "activo": True,
        }

    @override_settings(
        EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
        EMAIL_HOST="smtp.test.local",
        DEFAULT_FROM_EMAIL="no-reply@test.local",
        FRONTEND_BASE_URL="https://app.test",
    )
    def test_owner_admin_can_create_invitation(self):
        response = self.client.post(
            "/api/accounts/miembros/invitar/",
            data=json.dumps(
                {
                    "email": "abrmarmi@hotmail.com",
                    "nombre_sugerido": "Barry",
                    "rol": "OPERADOR",
                }
            ),
            content_type="application/json",
            **self.auth_headers,
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["mensaje"], "Invitacion creada correctamente.")
        self.assertIn("/invitacion/", body["accept_url"])
        self.assertTrue(body["email_sent"])
        self.assertIsNone(body["email_error"])

        invitacion = InvitacionAcceso.objects.get(email="abrmarmi@hotmail.com")
        self.assertEqual(invitacion.capa_negocio_id, self.capa.id)
        self.assertEqual(invitacion.rol, "OPERADOR")
        self.assertEqual(invitacion.nombre_sugerido, "Barry")
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ["abrmarmi@hotmail.com"])
        self.assertIn("https://app.test/invitacion/", mail.outbox[0].body)

    def test_duplicate_pending_invitation_requires_confirmation(self):
        InvitacionAcceso.objects.create(
            capa_negocio=self.capa,
            email="abrmarmi@hotmail.com",
            nombre_sugerido="Barry",
            rol="OPERADOR",
            invitado_por=self.user,
        )

        response = self.client.post(
            "/api/accounts/miembros/invitar/",
            data=json.dumps(
                {
                    "email": "abrmarmi@hotmail.com",
                    "nombre_sugerido": "Barry",
                    "rol": "OPERADOR",
                }
            ),
            content_type="application/json",
            **self.auth_headers,
        )

        self.assertEqual(response.status_code, 409)
        body = response.json()
        self.assertEqual(body["code"], "INVITATION_ALREADY_PENDING")
        self.assertIn("Ya existe una invitacion pendiente", body["detail"])

    def test_replace_existing_invitation_keeps_only_latest_pending(self):
        previous = InvitacionAcceso.objects.create(
            capa_negocio=self.capa,
            email="abrmarmi@hotmail.com",
            nombre_sugerido="Barry",
            rol="OPERADOR",
            invitado_por=self.user,
        )

        response = self.client.post(
            "/api/accounts/miembros/invitar/",
            data=json.dumps(
                {
                    "email": "abrmarmi@hotmail.com",
                    "nombre_sugerido": "Barry 2",
                    "rol": "CONSULTA",
                    "replace_existing": True,
                }
            ),
            content_type="application/json",
            **self.auth_headers,
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertIn("reemplazada", body["mensaje"])

        previous.refresh_from_db()
        self.assertEqual(previous.estatus, "REVOCADA")

        pending = InvitacionAcceso.objects.filter(
            capa_negocio=self.capa,
            email="abrmarmi@hotmail.com",
            estatus="PENDIENTE",
        )
        self.assertEqual(pending.count(), 1)
        self.assertEqual(pending.first().nombre_sugerido, "Barry 2")

    def test_plan_user_limit_blocks_new_invitation(self):
        limited_capa = CapaNegocio.objects.create(
            nombre="Cuenta Starter Limitada",
            tipo_capa="OPERADORA",
            usuario_fundador=self.user,
        )
        MembresiaCapaNegocio.objects.create(
            user=self.user,
            capa_negocio=limited_capa,
            rol="OWNER_ADMIN",
            activo=True,
        )
        plan = PlanSaaS.objects.create(
            clave="starter-user-limit",
            nombre="Starter User Limit",
            max_usuarios=1,
            max_entidades=3,
            max_productos=40,
        )
        SuscripcionCapa.objects.create(capa_negocio=limited_capa, plan=plan, estatus="ACTIVA")
        headers = {
            **self.auth_headers,
            "HTTP_X_BETTERP_CAPA_ID": str(limited_capa.id),
        }

        response = self.client.post(
            "/api/accounts/miembros/invitar/",
            data=json.dumps(
                {
                    "email": "nuevo.usuario@test.local",
                    "nombre_sugerido": "Nuevo Usuario",
                    "rol": "OPERADOR",
                }
            ),
            content_type="application/json",
            **headers,
        )

        self.assertEqual(response.status_code, 403)
        self.assertIn("Tu plan permite hasta 1 usuarios", response.json()["detail"])
        self.assertFalse(
            InvitacionAcceso.objects.filter(
                capa_negocio=limited_capa,
                email="nuevo.usuario@test.local",
            ).exists()
        )

    def test_plan_module_denial_is_audited(self):
        plan = PlanSaaS.objects.create(
            clave="starter-no-clientes",
            nombre="Starter sin clientes",
            max_usuarios=3,
            max_entidades=3,
            max_productos=40,
            modulos_habilitados=["dashboard"],
            funciones_habilitadas=[],
        )
        SuscripcionCapa.objects.create(
            capa_negocio=self.capa,
            plan=plan,
            estatus="ACTIVA",
        )

        response = self.client.get("/api/crm/lista/", **self.auth_headers)

        self.assertEqual(response.status_code, 403)
        self.assertIn("plan actual no incluye este modulo", response.json()["detail"])
        event = EventoAuditoria.objects.get(
            actor=self.user,
            capa_negocio=self.capa,
            accion="PLAN_MODULO_DENEGADO",
        )
        self.assertEqual(event.recurso_tipo, "PlanSaaS")
        self.assertEqual(event.recurso_id, str(plan.id))
        self.assertEqual(event.metadata["tipo_bloqueo"], "modulo")
        self.assertEqual(event.metadata["capability_key"], "clientes")
        self.assertEqual(event.metadata["plan_clave"], "starter-no-clientes")
        self.assertEqual(event.metadata["valores_efectivos"], ["dashboard"])
        self.assertEqual(event.metadata["rol_actual"], "OWNER_ADMIN")
        self.assertEqual(event.metadata["ruta"], "/api/crm/lista/")

    def test_plan_feature_denial_is_audited(self):
        plan = PlanSaaS.objects.create(
            clave="growth-no-batch",
            nombre="Growth sin batch",
            max_usuarios=3,
            max_entidades=3,
            max_productos=40,
            modulos_habilitados=["clientes"],
            funciones_habilitadas=[],
        )
        SuscripcionCapa.objects.create(
            capa_negocio=self.capa,
            plan=plan,
            estatus="ACTIVA",
        )

        response = self.client.get("/api/crm/batch/plantilla/", **self.auth_headers)

        self.assertEqual(response.status_code, 403)
        self.assertIn("plan actual no incluye esta funcion", response.json()["detail"])
        event = EventoAuditoria.objects.get(
            actor=self.user,
            capa_negocio=self.capa,
            accion="PLAN_FUNCION_DENEGADA",
        )
        self.assertEqual(event.recurso_tipo, "PlanSaaS")
        self.assertEqual(event.recurso_id, str(plan.id))
        self.assertEqual(event.metadata["tipo_bloqueo"], "funcion")
        self.assertEqual(event.metadata["capability_key"], "batch_import")
        self.assertEqual(event.metadata["plan_clave"], "growth-no-batch")
        self.assertEqual(event.metadata["valores_efectivos"], [])
        self.assertEqual(event.metadata["rol_actual"], "OWNER_ADMIN")
        self.assertEqual(event.metadata["ruta"], "/api/crm/batch/plantilla/")

    def test_admin_can_list_audit_events_for_current_layer_only(self):
        other_capa = CapaNegocio.objects.create(nombre="Otra capa", tipo_capa="OPERADORA")
        EventoAuditoria.objects.create(
            actor=self.user,
            capa_negocio=self.capa,
            accion="CLIENTE_CREADO",
            recurso_tipo="Cliente",
            recurso_id="10",
            metadata={"entidad_id": 1},
        )
        EventoAuditoria.objects.create(
            actor=self.user,
            capa_negocio=other_capa,
            accion="CLIENTE_CREADO",
            recurso_tipo="Cliente",
            recurso_id="99",
        )

        response = self.client.get("/api/accounts/auditoria/", **self.auth_headers)

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(len(body), 1)
        self.assertEqual(body[0]["accion"], "CLIENTE_CREADO")
        self.assertEqual(body[0]["recurso_id"], "10")
        self.assertEqual(body[0]["actor_email"], self.user.email)

    def test_admin_can_filter_audit_events_by_actor_resource_and_dates(self):
        other_actor = User.objects.create_user(
            username="otro.actor@test.local",
            email="otro.actor@test.local",
            password="secret123",
        )
        old_event = EventoAuditoria.objects.create(
            actor=self.user,
            capa_negocio=self.capa,
            accion="CLIENTE_CREADO",
            recurso_tipo="Cliente",
            recurso_id="100",
        )
        EventoAuditoria.objects.filter(id=old_event.id).update(
            fecha_creacion=timezone.now() - timedelta(days=10)
        )
        target_event = EventoAuditoria.objects.create(
            actor=self.user,
            capa_negocio=self.capa,
            accion="CLIENTE_ACTUALIZADO",
            recurso_tipo="Cliente",
            recurso_id="200",
            metadata={"campo": "telefono"},
        )
        EventoAuditoria.objects.create(
            actor=other_actor,
            capa_negocio=self.capa,
            accion="CLIENTE_ACTUALIZADO",
            recurso_tipo="Cliente",
            recurso_id="200",
        )
        EventoAuditoria.objects.create(
            actor=self.user,
            capa_negocio=self.capa,
            accion="CLIENTE_ACTUALIZADO",
            recurso_tipo="Cliente",
            recurso_id="300",
        )

        response = self.client.get(
            "/api/accounts/auditoria/",
            {
                "accion": "CLIENTE_ACTUALIZADO",
                "recurso_tipo": "Cliente",
                "recurso_id": "200",
                "actor_email": "owner@",
                "desde": (timezone.now() - timedelta(days=1)).date().isoformat(),
                "hasta": (timezone.now() + timedelta(days=1)).date().isoformat(),
            },
            **self.auth_headers,
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual([event["id"] for event in body], [target_event.id])
        self.assertEqual(body[0]["metadata"]["campo"], "telefono")

    def test_admin_can_read_operational_audit_summary_by_category(self):
        other_capa = CapaNegocio.objects.create(nombre="Otra capa", tipo_capa="OPERADORA")
        old_event = EventoAuditoria.objects.create(
            actor=self.user,
            capa_negocio=self.capa,
            accion="BACKOFFICE_BACKUP_CAPA_GENERADO",
            recurso_tipo="Backup",
            recurso_id="old",
        )
        EventoAuditoria.objects.filter(id=old_event.id).update(
            fecha_creacion=timezone.now() - timedelta(days=20)
        )
        EventoAuditoria.objects.create(
            actor=self.user,
            capa_negocio=other_capa,
            accion="BACKOFFICE_BACKUP_CAPA_GENERADO",
            recurso_tipo="Backup",
            recurso_id="other",
        )
        EventoAuditoria.objects.create(
            actor=self.user,
            capa_negocio=self.capa,
            accion="CAMBIAR_CONTRASENA",
            recurso_tipo="Usuario",
            recurso_id=str(self.user.id),
        )
        EventoAuditoria.objects.create(
            actor=self.user,
            capa_negocio=self.capa,
            accion="ACCESO_DENEGADO",
            recurso_tipo="Permiso",
            recurso_id="admin",
            metadata={
                "permiso_requerido": "admin",
                "ruta": "/api/accounts/miembros/",
                "rol_actual": "OPERADOR",
            },
        )
        EventoAuditoria.objects.create(
            actor=self.user,
            capa_negocio=self.capa,
            accion="ACTUALIZAR_ROL_USUARIO",
            recurso_tipo="MembresiaCapaNegocio",
            recurso_id="12",
        )
        EventoAuditoria.objects.create(
            actor=self.user,
            capa_negocio=self.capa,
            accion="BACKOFFICE_BACKUP_CAPA_GENERADO",
            recurso_tipo="Backup",
            recurso_id="backup-1",
        )
        EventoAuditoria.objects.create(
            actor=self.user,
            capa_negocio=self.capa,
            accion="SUSCRIPCION_CAMBIO_PLAN_SOLICITADO",
            recurso_tipo="SuscripcionCapa",
            recurso_id="sub-1",
        )
        EventoAuditoria.objects.create(
            actor=self.user,
            capa_negocio=self.capa,
            accion="PLAN_MODULO_DENEGADO",
            recurso_tipo="PlanSaaS",
            recurso_id="plan-1",
            metadata={"capability_key": "clientes"},
        )
        EventoAuditoria.objects.create(
            actor=self.user,
            capa_negocio=self.capa,
            accion="EVENTO_FINANCIERO_CONCILIADO",
            recurso_tipo="EventoFinanciero",
            recurso_id="ev-1",
        )
        EventoAuditoria.objects.create(
            actor=self.user,
            capa_negocio=self.capa,
            accion="CLIENTE_CREADO",
            recurso_tipo="Cliente",
            recurso_id="no-critico",
        )

        response = self.client.get(
            "/api/accounts/auditoria/resumen/",
            {"dias": 7, "limit": 1},
            **self.auth_headers,
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["capa_negocio"]["id"], self.capa.id)
        self.assertEqual(body["dias"], 7)
        self.assertEqual(body["limit"], 1)
        categories = {category["key"]: category for category in body["categorias"]}
        self.assertEqual(categories["accesos"]["count"], 1)
        self.assertEqual(categories["permisos"]["count"], 2)
        self.assertEqual(categories["backups"]["count"], 1)
        self.assertEqual(categories["billing"]["count"], 2)
        self.assertEqual(categories["conciliacion"]["count"], 1)
        self.assertEqual(body["total_eventos_criticos"], 7)
        self.assertEqual(len(categories["permisos"]["latest"]), 1)
        self.assertEqual(categories["permisos"]["latest"][0]["actor_email"], self.user.email)
        security_signals = body["senales_seguridad"]
        self.assertEqual(security_signals["permisos_denegados"], 1)
        self.assertEqual(security_signals["plan_denegado"], 1)
        self.assertEqual(security_signals["cambios_acceso"], 2)
        self.assertEqual(security_signals["riesgo"], "MEDIO")
        self.assertEqual(
            security_signals["permisos_mas_denegados"][0],
            {"value": "admin", "label": "Administracion", "count": 1},
        )
        self.assertEqual(
            security_signals["rutas_mas_denegadas"][0]["value"],
            "/api/accounts/miembros/",
        )
        self.assertEqual(
            security_signals["funciones_plan_bloqueadas"][0]["value"],
            "clientes",
        )
        self.assertEqual(
            security_signals["primera_denegacion_id"],
            security_signals["ultimas_denegaciones"][0]["id"],
        )

    def test_operational_audit_summary_flags_high_permission_risk(self):
        for index in range(5):
            EventoAuditoria.objects.create(
                actor=self.user,
                capa_negocio=self.capa,
                accion="ACCESO_DENEGADO",
                recurso_tipo="Permiso",
                recurso_id="auditoria",
                metadata={
                    "permiso_requerido": "auditoria",
                    "ruta": "/api/accounts/auditoria/",
                    "rol_actual": "OPERADOR",
                    "attempt": index,
                },
            )

        response = self.client.get(
            "/api/accounts/auditoria/resumen/",
            {"dias": 7, "limit": 2},
            **self.auth_headers,
        )

        self.assertEqual(response.status_code, 200)
        security_signals = response.json()["senales_seguridad"]
        self.assertEqual(security_signals["riesgo"], "ALTO")
        self.assertEqual(security_signals["permisos_denegados"], 5)
        self.assertIn("denegaciones repetidas", security_signals["foco_recomendado"])
        self.assertEqual(
            security_signals["permisos_mas_denegados"][0],
            {"value": "auditoria", "label": "Auditoria", "count": 5},
        )
        self.assertEqual(len(security_signals["ultimas_denegaciones"]), 2)

    def test_operational_audit_summary_batches_category_queries(self):
        for action in [
            "ACCESO_DENEGADO",
            "ACTUALIZAR_ROL_USUARIO",
            "BACKOFFICE_BACKUP_CAPA_GENERADO",
            "SUSCRIPCION_CAMBIO_PLAN_SOLICITADO",
            "EVENTO_FINANCIERO_CONCILIADO",
        ]:
            EventoAuditoria.objects.create(
                actor=self.user,
                capa_negocio=self.capa,
                accion=action,
                recurso_tipo="Prueba",
                recurso_id=action,
            )
        for index in range(3):
            EventoAuditoria.objects.create(
                actor=self.user,
                capa_negocio=self.capa,
                accion="CAMBIAR_CONTRASENA",
                recurso_tipo="Usuario",
                recurso_id=str(index),
            )

        now = timezone.now()
        with self.assertNumQueries(2):
            categories, total = build_audit_operational_summary(
                capa=self.capa,
                since=now - timedelta(days=1),
                until=now + timedelta(days=1),
                safe_limit=2,
            )

        by_key = {category["key"]: category for category in categories}
        self.assertEqual(total, 8)
        self.assertEqual(by_key["accesos"]["count"], 3)
        self.assertEqual(by_key["permisos"]["count"], 2)
        self.assertEqual(by_key["backups"]["count"], 1)
        self.assertEqual(by_key["billing"]["count"], 1)
        self.assertEqual(by_key["conciliacion"]["count"], 1)
        self.assertEqual(len(by_key["permisos"]["latest"]), 2)
        self.assertEqual(len(by_key["accesos"]["latest"]), 2)

    def test_audit_event_limit_is_capped(self):
        for index in range(205):
            EventoAuditoria.objects.create(
                actor=self.user,
                capa_negocio=self.capa,
                accion="CLIENTE_CREADO",
                recurso_tipo="Cliente",
                recurso_id=str(index),
            )

        response = self.client.get(
            "/api/accounts/auditoria/?limit=500",
            **self.auth_headers,
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()), 200)

    def test_permissions_matrix_exposes_current_role_capabilities(self):
        response = self.client.get("/api/accounts/permisos/", **self.auth_headers)

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["current_role"], "OWNER_ADMIN")
        roles = {item["rol"]: item for item in body["matrix"]}
        self.assertTrue(roles["OWNER_ADMIN"]["capabilities"]["administrar"])
        self.assertTrue(roles["OWNER_ADMIN"]["capabilities"]["auditoria"])
        self.assertTrue(roles["OWNER_ADMIN"]["capabilities"]["backups"])
        self.assertTrue(roles["OPERADOR"]["capabilities"]["operar"])
        self.assertFalse(roles["OPERADOR"]["capabilities"]["auditoria"])
        self.assertFalse(roles["OPERADOR"]["capabilities"]["backups"])
        self.assertFalse(roles["CONSULTA"]["capabilities"]["operar"])

    def test_requested_capa_without_membership_does_not_fallback_to_another_layer(self):
        other_capa = CapaNegocio.objects.create(
            nombre="Capa sin acceso",
            tipo_capa="OPERADORA",
        )
        headers = {
            **self.auth_headers,
            "HTTP_X_BETTERP_CAPA_ID": str(other_capa.id),
        }

        response = self.client.get("/api/accounts/permisos/", **headers)

        self.assertEqual(response.status_code, 403)
        self.assertIn("capa de negocio solicitada", response.json()["detail"])

    def test_denied_admin_access_is_audited(self):
        consulta_user = User.objects.create_user(
            username="consulta@test.local",
            email="consulta@test.local",
            password="secret123",
        )
        MembresiaCapaNegocio.objects.create(
            user=consulta_user,
            capa_negocio=self.capa,
            rol="CONSULTA",
            activo=True,
        )
        session = create_access_session(consulta_user, provider="PASSWORD")
        tokens = issue_token_pair(session)
        headers = {
            "HTTP_AUTHORIZATION": f"Bearer {tokens['access_token']}",
            "HTTP_X_BETTERP_CAPA_ID": str(self.capa.id),
        }

        response = self.client.get("/api/accounts/auditoria/", **headers)

        self.assertEqual(response.status_code, 403)
        event = EventoAuditoria.objects.get(
            actor=consulta_user,
            capa_negocio=self.capa,
            accion="ACCESO_DENEGADO",
        )
        self.assertEqual(event.recurso_tipo, "Permiso")
        self.assertEqual(event.recurso_id, "auditoria")
        self.assertEqual(event.metadata["rol_actual"], "CONSULTA")
        self.assertEqual(event.metadata["permiso_requerido"], "auditoria")
        self.assertFalse(event.metadata["capabilities_actuales"]["auditoria"])
        self.assertEqual(event.metadata["scope"], "tenant")
        self.assertEqual(event.metadata["session_id"], session.id)
        self.assertEqual(event.metadata["ruta"], "/api/accounts/auditoria/")

    def test_consulta_can_read_clients_but_cannot_create_clients(self):
        consulta_user, headers = self._headers_for_role(
            "CONSULTA",
            "consulta.crm@test.local",
        )
        entidad = self._create_role_test_entity()
        Cliente.objects.create(
            entidad_relacionada=entidad,
            razon_social="Cliente lectura",
            nombre_comercial="Cliente lectura",
            rfc="XAXX010101000",
            telefono="5599999999",
            correo_principal="lectura@test.local",
        )

        read_response = self.client.get("/api/crm/lista/", **headers)
        write_response = self.client.post(
            "/api/crm/crear/",
            data=json.dumps(self._cliente_payload(entidad, "consulta")),
            content_type="application/json",
            **headers,
        )

        self.assertEqual(read_response.status_code, 200)
        self.assertEqual(read_response.json()["total"], 1)
        self.assertEqual(write_response.status_code, 403)

        event = EventoAuditoria.objects.get(
            actor=consulta_user,
            capa_negocio=self.capa,
            accion="ACCESO_DENEGADO",
            recurso_id="write",
        )
        self.assertEqual(event.metadata["rol_actual"], "CONSULTA")
        self.assertEqual(event.metadata["permiso_requerido"], "write")
        self.assertEqual(event.metadata["ruta"], "/api/crm/crear/")

    def test_operador_can_create_clients_but_cannot_access_admin_audit(self):
        operador_user, headers = self._headers_for_role(
            "OPERADOR",
            "operador.crm@test.local",
        )
        entidad = self._create_role_test_entity()

        write_response = self.client.post(
            "/api/crm/crear/",
            data=json.dumps(self._cliente_payload(entidad, "operador")),
            content_type="application/json",
            **headers,
        )
        admin_response = self.client.get("/api/accounts/auditoria/", **headers)

        self.assertEqual(write_response.status_code, 200)
        self.assertTrue(
            Cliente.objects.filter(
                entidad_relacionada=entidad,
                identificador="ROL-operador",
            ).exists()
        )
        self.assertEqual(admin_response.status_code, 403)

        event = EventoAuditoria.objects.get(
            actor=operador_user,
            capa_negocio=self.capa,
            accion="ACCESO_DENEGADO",
            recurso_id="auditoria",
        )
        self.assertEqual(event.metadata["rol_actual"], "OPERADOR")
        self.assertEqual(event.metadata["permiso_requerido"], "auditoria")
        self.assertTrue(event.metadata["capabilities_actuales"]["operar"])
        self.assertFalse(event.metadata["capabilities_actuales"]["auditoria"])

    def test_owner_admin_can_read_audit_after_operational_activity(self):
        entidad = self._create_role_test_entity()

        write_response = self.client.post(
            "/api/crm/crear/",
            data=json.dumps(self._cliente_payload(entidad, "owner")),
            content_type="application/json",
            **self.auth_headers,
        )
        audit_response = self.client.get("/api/accounts/auditoria/", **self.auth_headers)

        self.assertEqual(write_response.status_code, 200)
        self.assertEqual(audit_response.status_code, 200)
        acciones = [event["accion"] for event in audit_response.json()]
        self.assertIn("CLIENTE_CREADO", acciones)

    def test_list_memberships_returns_only_pending_invitations(self):
        InvitacionAcceso.objects.create(
            capa_negocio=self.capa,
            email="pendiente@hotmail.com",
            rol="OPERADOR",
            estatus="PENDIENTE",
            invitado_por=self.user,
        )
        InvitacionAcceso.objects.create(
            capa_negocio=self.capa,
            email="revocada@hotmail.com",
            rol="OPERADOR",
            estatus="REVOCADA",
            invitado_por=self.user,
        )

        response = self.client.get("/api/accounts/miembros/", **self.auth_headers)

        self.assertEqual(response.status_code, 200)
        body = response.json()
        invitations = body["invitations"]
        self.assertEqual(len(invitations), 1)
        self.assertEqual(invitations[0]["email"], "pendiente@hotmail.com")

    def test_list_memberships_returns_only_active_memberships(self):
        inactive_user = User.objects.create_user(
            username="inactive@test.local",
            email="inactive@test.local",
            password="secret123",
        )
        MembresiaCapaNegocio.objects.create(
            user=inactive_user,
            capa_negocio=self.capa,
            rol="OPERADOR",
            activo=False,
        )

        response = self.client.get("/api/accounts/miembros/", **self.auth_headers)

        self.assertEqual(response.status_code, 200)
        body = response.json()
        membership_emails = [item["user"]["email"] for item in body["memberships"]]
        self.assertEqual(membership_emails, ["owner@test.local"])

    def test_update_membership_role_audit_includes_before_after_metadata(self):
        invited_user = User.objects.create_user(
            username="rol.audit@test.local",
            email="rol.audit@test.local",
            password="secret123",
            first_name="Rol",
        )
        membership = MembresiaCapaNegocio.objects.create(
            user=invited_user,
            capa_negocio=self.capa,
            rol="OPERADOR",
            activo=True,
        )

        response = self.client.put(
            f"/api/accounts/miembros/{membership.id}/rol/",
            data=json.dumps({"rol": "CONSULTA"}),
            content_type="application/json",
            **self.auth_headers,
        )

        self.assertEqual(response.status_code, 200)
        membership.refresh_from_db()
        self.assertEqual(membership.rol, "CONSULTA")
        event = EventoAuditoria.objects.get(
            accion="ACTUALIZAR_ROL_USUARIO",
            recurso_tipo="MembresiaCapaNegocio",
        )
        self.assertEqual(event.metadata["email"], invited_user.email)
        self.assertEqual(event.metadata["user_id"], invited_user.id)
        self.assertEqual(event.metadata["membership_id"], membership.id)
        self.assertEqual(event.metadata["rol_anterior"], "OPERADOR")
        self.assertEqual(event.metadata["rol_nuevo"], "CONSULTA")
        self.assertEqual(event.metadata["actor_role"], "OWNER_ADMIN")

    def test_deactivate_membership_audit_includes_status_transition_metadata(self):
        invited_user = User.objects.create_user(
            username="desactivar.audit@test.local",
            email="desactivar.audit@test.local",
            password="secret123",
            first_name="Desactivar",
        )
        invited_session = create_access_session(invited_user, provider="PASSWORD")
        membership = MembresiaCapaNegocio.objects.create(
            user=invited_user,
            capa_negocio=self.capa,
            rol="OPERADOR",
            activo=True,
        )

        response = self.client.delete(
            f"/api/accounts/miembros/{membership.id}/",
            **self.auth_headers,
        )

        self.assertEqual(response.status_code, 200)
        membership.refresh_from_db()
        self.assertFalse(membership.activo)
        invited_session.refresh_from_db()
        self.session.refresh_from_db()
        self.assertIsNotNone(invited_session.revoked_at)
        self.assertIsNone(self.session.revoked_at)
        event = EventoAuditoria.objects.get(
            accion="DESACTIVAR_USUARIO",
            recurso_tipo="MembresiaCapaNegocio",
        )
        self.assertEqual(event.metadata["email"], invited_user.email)
        self.assertEqual(event.metadata["rol_anterior"], "OPERADOR")
        self.assertEqual(event.metadata["rol_nuevo"], "OPERADOR")
        self.assertTrue(event.metadata["activo_anterior"])
        self.assertFalse(event.metadata["activo_nuevo"])
        self.assertEqual(event.metadata["estatus_anterior"], "ACTIVO")
        self.assertEqual(event.metadata["estatus_nuevo"], "INACTIVO")
        self.assertEqual(event.metadata["sesiones_revocadas"], 1)

    def test_owner_admin_can_delete_membership_from_current_capa(self):
        invited_user = User.objects.create_user(
            username="algod@test.local",
            email="algod@test.local",
            password="secret123",
            first_name="Algod",
        )
        invited_session = create_access_session(invited_user, provider="PASSWORD")
        membership = MembresiaCapaNegocio.objects.create(
            user=invited_user,
            capa_negocio=self.capa,
            rol="OPERADOR",
            activo=True,
        )

        response = self.client.delete(
            f"/api/accounts/miembros/{membership.id}/eliminar/",
            **self.auth_headers,
        )

        self.assertEqual(response.status_code, 200)
        self.assertFalse(MembresiaCapaNegocio.objects.filter(id=membership.id).exists())
        self.assertTrue(User.objects.filter(id=invited_user.id).exists())
        invited_session.refresh_from_db()
        self.session.refresh_from_db()
        self.assertIsNotNone(invited_session.revoked_at)
        self.assertIsNone(self.session.revoked_at)
        event = EventoAuditoria.objects.get(
            accion="ELIMINAR_USUARIO_CAPA",
            recurso_tipo="MembresiaCapaNegocio",
        )
        self.assertEqual(event.metadata["email"], invited_user.email)
        self.assertEqual(event.metadata["user_id"], invited_user.id)
        self.assertEqual(event.metadata["membership_id"], membership.id)
        self.assertEqual(event.metadata["rol_anterior"], "OPERADOR")
        self.assertTrue(event.metadata["activo_anterior"])
        self.assertEqual(event.metadata["estatus_nuevo"], "ELIMINADO")
        self.assertEqual(event.metadata["sesiones_revocadas"], 1)

    def test_revoke_invitation_audit_includes_status_transition_metadata(self):
        invitation = InvitacionAcceso.objects.create(
            capa_negocio=self.capa,
            email="revocar.audit@test.local",
            nombre_sugerido="Revocar Audit",
            rol="OPERADOR",
            estatus="PENDIENTE",
            invitado_por=self.user,
        )

        response = self.client.delete(
            f"/api/accounts/invitaciones/{invitation.id}/",
            **self.auth_headers,
        )

        self.assertEqual(response.status_code, 200)
        invitation.refresh_from_db()
        self.assertEqual(invitation.estatus, "REVOCADA")
        event = EventoAuditoria.objects.get(
            accion="REVOCAR_INVITACION",
            recurso_tipo="InvitacionAcceso",
        )
        self.assertEqual(event.metadata["email"], invitation.email)
        self.assertEqual(event.metadata["nombre_sugerido"], "Revocar Audit")
        self.assertEqual(event.metadata["rol"], "OPERADOR")
        self.assertEqual(event.metadata["estatus_anterior"], "PENDIENTE")
        self.assertEqual(event.metadata["estatus_nuevo"], "REVOCADA")

    def test_founder_owner_admin_cannot_be_deleted_from_capa(self):
        owner_membership = MembresiaCapaNegocio.objects.get(
            user=self.user,
            capa_negocio=self.capa,
        )

        response = self.client.delete(
            f"/api/accounts/miembros/{owner_membership.id}/eliminar/",
            **self.auth_headers,
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("aperturo la cuenta", response.json()["detail"])
        self.assertTrue(
            MembresiaCapaNegocio.objects.filter(id=owner_membership.id).exists()
        )

    def test_founder_owner_admin_cannot_change_base_role(self):
        owner_membership = MembresiaCapaNegocio.objects.get(
            user=self.user,
            capa_negocio=self.capa,
        )

        response = self.client.put(
            f"/api/accounts/miembros/{owner_membership.id}/rol/",
            data=json.dumps({"rol": "OPERADOR"}),
            content_type="application/json",
            **self.auth_headers,
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("aperturo la cuenta", response.json()["detail"])

    def test_login_recovers_founder_membership_when_missing(self):
        MembresiaCapaNegocio.objects.filter(
            user=self.user,
            capa_negocio=self.capa,
        ).delete()

        response = self.client.post(
            "/api/accounts/auth/login/",
            data=json.dumps({"email": self.user.email, "password": "secret123"}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        membership = MembresiaCapaNegocio.objects.get(
            user=self.user,
            capa_negocio=self.capa,
        )
        self.assertEqual(membership.rol, "OWNER_ADMIN")
        self.assertTrue(membership.activo)

    def test_login_recovers_founder_membership_from_contact_email_when_founder_null(self):
        self.capa.usuario_fundador = None
        self.capa.correo_contacto = self.user.email
        self.capa.save(update_fields=["usuario_fundador", "correo_contacto"])
        MembresiaCapaNegocio.objects.filter(
            user=self.user,
            capa_negocio=self.capa,
        ).delete()

        response = self.client.post(
            "/api/accounts/auth/login/",
            data=json.dumps({"email": self.user.email, "password": "secret123"}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        self.capa.refresh_from_db()
        self.assertEqual(self.capa.usuario_fundador_id, self.user.id)
        membership = MembresiaCapaNegocio.objects.get(
            user=self.user,
            capa_negocio=self.capa,
        )
        self.assertEqual(membership.rol, "OWNER_ADMIN")

    @override_settings(REQUEST_METRICS_ENABLED=False)
    def test_login_reuses_membership_query_for_payload(self):
        UsuarioPerfil.objects.get_or_create(user=self.user)
        EntidadNegocio.objects.create(
            capa_negocio=self.capa,
            nombre_comercial="Operacion centro",
        )
        EntidadNegocio.objects.create(
            capa_negocio=self.capa,
            nombre_comercial="Operacion norte",
        )

        with CaptureQueriesContext(connection) as queries:
            response = self.client.post(
                "/api/accounts/auth/login/",
                data=json.dumps({"email": self.user.email, "password": "secret123"}),
                content_type="application/json",
            )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(
            body["current_membership"]["capa_negocio"]["entidades_count"],
            2,
        )
        self.assertLessEqual(len(queries), 6)
        entity_count_queries = [
            query
            for query in queries
            if (
                "COUNT(" in query["sql"].upper()
                and "EMPRESAS_ENTIDADNEGOCIO" in query["sql"].upper()
            )
        ]
        self.assertLessEqual(len(entity_count_queries), 1)

    @override_settings(REQUEST_METRICS_ENABLED=True, REQUEST_METRICS_SLOW_MS=0)
    def test_login_metric_records_internal_timings(self):
        response = self.client.post(
            "/api/accounts/auth/login/",
            data=json.dumps({"email": self.user.email, "password": "secret123"}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        metric = BackendRequestMetric.objects.get(path="/api/accounts/auth/login/")
        timings = metric.metadata["timings_ms"]
        self.assertIn("login.password_auth", timings)
        self.assertIn("login.user_lookup.username_exact", timings)
        self.assertIn("login.membership_lookup", timings)
        self.assertIn("login.session_create", timings)
        self.assertIn("login.payload_build", timings)
        self.assertIn("login.total", timings)
        self.assertNotIn("secret123", json.dumps(metric.metadata))

    @override_settings(REQUEST_METRICS_ENABLED=True, REQUEST_METRICS_SLOW_MS=0)
    def test_login_falls_back_to_email_for_legacy_username(self):
        self.user.username = "legacy-owner"
        self.user.save(update_fields=["username"])

        response = self.client.post(
            "/api/accounts/auth/login/",
            data=json.dumps({"email": self.user.email, "password": "secret123"}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["user"]["email"], self.user.email)
        metric = BackendRequestMetric.objects.get(path="/api/accounts/auth/login/")
        timings = metric.metadata["timings_ms"]
        self.assertIn("login.user_lookup.username_exact", timings)
        self.assertIn("login.user_lookup.email_fallback", timings)

    def test_rate_limit_uses_bulk_cache_operations(self):
        request = RequestFactory().post(
            "/api/accounts/auth/login/",
            REMOTE_ADDR="203.0.113.88",
        )

        with patch("accounts.rate_limit.cache.get_many", return_value={}) as get_many:
            assert_auth_rate_limit(request, scope="login", identifier=self.user.email)

        get_many.assert_called_once()
        self.assertEqual(len(get_many.call_args.args[0]), 2)

        with patch("accounts.rate_limit.cache.delete_many") as delete_many:
            clear_auth_rate_limit(request, scope="login", identifier=self.user.email)

        delete_many.assert_called_once()
        self.assertEqual(len(delete_many.call_args.args[0]), 2)

    def test_login_upgrades_legacy_pbkdf2_password_to_argon2(self):
        self.user.password = make_password("secret123", hasher="pbkdf2_sha256")
        self.user.save(update_fields=["password"])
        self.assertEqual(identify_hasher(self.user.password).algorithm, "pbkdf2_sha256")

        response = self.client.post(
            "/api/accounts/auth/login/",
            data=json.dumps({"email": self.user.email, "password": "secret123"}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        self.user.refresh_from_db()
        self.assertEqual(identify_hasher(self.user.password).algorithm, "argon2")

    @override_settings(
        AUTH_RATE_LIMIT_LOGIN_ATTEMPTS=2,
        AUTH_RATE_LIMIT_LOGIN_WINDOW_SECONDS=60,
    )
    def test_login_rate_limit_blocks_repeated_invalid_passwords(self):
        cache.clear()
        try:
            for _ in range(2):
                response = self.client.post(
                    "/api/accounts/auth/login/",
                    data=json.dumps({"email": self.user.email, "password": "wrong-password"}),
                    content_type="application/json",
                    REMOTE_ADDR="203.0.113.77",
                )
                self.assertEqual(response.status_code, 401)

            response = self.client.post(
                "/api/accounts/auth/login/",
                data=json.dumps({"email": self.user.email, "password": "wrong-password"}),
                content_type="application/json",
                REMOTE_ADDR="203.0.113.77",
            )

            self.assertEqual(response.status_code, 429)
        finally:
            cache.clear()

    def test_trial_register_is_closed_by_default(self):
        response = self.client.post(
            "/api/accounts/auth/trial-register/",
            data=json.dumps(
                {
                    "nombre": "Trial Cerrado",
                    "email": "trial.cerrado@test.local",
                    "password": "StrongPass123!",
                    "password_confirm": "StrongPass123!",
                    "nombre_capa": "Trial Cerrado",
                    "tipo_capa": "OPERADORA",
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 403)
        self.assertFalse(User.objects.filter(email="trial.cerrado@test.local").exists())

    @override_settings(PUBLIC_TRIAL_REGISTRATION_ENABLED=True)
    def test_trial_register_creates_owner_capa_subscription_and_session(self):
        response = self.client.post(
            "/api/accounts/auth/trial-register/",
            data=json.dumps(
                {
                    "nombre": "Ana Trial",
                    "email": "ana.trial@test.local",
                    "password": "StrongPass123!",
                    "password_confirm": "StrongPass123!",
                    "nombre_capa": "Trial Coliving",
                    "tipo_capa": "OPERADORA",
                    "telefono": "5512345678",
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertIn("tokens", body)
        self.assertEqual(body["user"]["email"], "ana.trial@test.local")

        user = User.objects.get(email="ana.trial@test.local")
        capa = CapaNegocio.objects.get(nombre="Trial Coliving")
        membership = MembresiaCapaNegocio.objects.get(user=user, capa_negocio=capa)
        subscription = SuscripcionCapa.objects.get(capa_negocio=capa)

        self.assertEqual(capa.usuario_fundador_id, user.id)
        self.assertEqual(capa.telefono_contacto, "5512345678")
        self.assertEqual(membership.rol, "OWNER_ADMIN")
        self.assertEqual(subscription.estatus, "TRIAL")
        self.assertEqual(subscription.metadata.get("trial_days"), 10)

    def test_checkout_register_creates_pending_subscription_without_trial_access(self):
        plan = PlanSaaS.objects.create(
            clave="checkout-growth",
            nombre="Checkout Growth",
            precio_mensual=3499,
            precio_anual=34990,
            activo=True,
        )

        response = self.client.post(
            "/api/accounts/auth/checkout-register/",
            data=json.dumps(
                {
                    "nombre": "Ana Checkout",
                    "email": "ana.checkout@test.local",
                    "password": "StrongPass123!",
                    "password_confirm": "StrongPass123!",
                    "nombre_capa": "Checkout Coliving",
                    "tipo_capa": "OPERADORA",
                    "telefono": "5511112222",
                    "plan_id": plan.id,
                    "periodicidad": "ANUAL",
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertIn("tokens", response.json())

        user = User.objects.get(email="ana.checkout@test.local")
        capa = CapaNegocio.objects.get(nombre="Checkout Coliving")
        membership = MembresiaCapaNegocio.objects.get(user=user, capa_negocio=capa)
        subscription = SuscripcionCapa.objects.get(capa_negocio=capa)

        self.assertEqual(membership.rol, "OWNER_ADMIN")
        self.assertEqual(subscription.plan_id, plan.id)
        self.assertEqual(subscription.estatus, "PENDIENTE_PAGO")
        self.assertEqual(subscription.periodicidad, "ANUAL")
        self.assertFalse(subscription.auto_renueva)
        self.assertIsNone(subscription.fecha_fin_periodo_actual)
        self.assertEqual(subscription.metadata.get("source"), "checkout")
        self.assertEqual(subscription.metadata.get("requested_plan_clave"), "checkout-growth")

    @override_settings(
        GOOGLE_CLIENT_ID="google-client.test",
        PUBLIC_TRIAL_REGISTRATION_ENABLED=True,
    )
    def test_google_trial_register_creates_owner_capa_subscription_and_session(self):
        with patch(
            "accounts.api.fetch_google_identity",
            return_value={
                "email": "google.trial@test.local",
                "name": "Google Trial",
                "picture": "https://example.com/avatar.png",
                "sub": "google-sub-trial",
            },
        ):
            response = self.client.post(
                "/api/accounts/auth/trial-register/google/",
                data=json.dumps(
                    {
                        "id_token": "fake-google-token",
                        "nombre_capa": "Google Coliving",
                        "tipo_capa": "OPERADORA",
                        "telefono": "5599998888",
                    }
                ),
                content_type="application/json",
            )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertIn("tokens", body)
        self.assertEqual(body["user"]["email"], "google.trial@test.local")

        user = User.objects.get(email="google.trial@test.local")
        profile = UsuarioPerfil.objects.get(user=user)
        capa = CapaNegocio.objects.get(nombre="Google Coliving")
        membership = MembresiaCapaNegocio.objects.get(user=user, capa_negocio=capa)
        subscription = SuscripcionCapa.objects.get(capa_negocio=capa)

        self.assertFalse(user.has_usable_password())
        self.assertEqual(profile.google_sub, "google-sub-trial")
        self.assertTrue(profile.email_verificado)
        self.assertEqual(capa.telefono_contacto, "5599998888")
        self.assertEqual(membership.rol, "OWNER_ADMIN")
        self.assertEqual(subscription.estatus, "TRIAL")

    @override_settings(GOOGLE_CLIENT_ID="google-client.test")
    def test_google_checkout_register_creates_pending_subscription(self):
        plan = PlanSaaS.objects.create(
            clave="google-checkout-scale",
            nombre="Google Checkout Scale",
            precio_mensual=6999,
            precio_anual=69990,
            activo=True,
        )
        with patch(
            "accounts.api.fetch_google_identity",
            return_value={
                "email": "google.checkout@test.local",
                "name": "Google Checkout",
                "picture": "https://example.com/avatar.png",
                "sub": "google-sub-checkout",
            },
        ):
            response = self.client.post(
                "/api/accounts/auth/checkout-register/google/",
                data=json.dumps(
                    {
                        "id_token": "fake-google-token",
                        "nombre_capa": "Google Checkout Coliving",
                        "tipo_capa": "OPERADORA",
                        "telefono": "5577776666",
                        "plan_id": plan.id,
                        "periodicidad": "MENSUAL",
                    }
                ),
                content_type="application/json",
            )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertIn("tokens", body)
        self.assertEqual(body["user"]["email"], "google.checkout@test.local")

        user = User.objects.get(email="google.checkout@test.local")
        profile = UsuarioPerfil.objects.get(user=user)
        capa = CapaNegocio.objects.get(nombre="Google Checkout Coliving")
        subscription = SuscripcionCapa.objects.get(capa_negocio=capa)

        self.assertFalse(user.has_usable_password())
        self.assertEqual(profile.google_sub, "google-sub-checkout")
        self.assertEqual(subscription.plan_id, plan.id)
        self.assertEqual(subscription.estatus, "PENDIENTE_PAGO")
        self.assertEqual(subscription.metadata.get("source"), "checkout")

    def test_owner_admin_can_delete_invitation(self):
        invitation = InvitacionAcceso.objects.create(
            capa_negocio=self.capa,
            email="borrar@hotmail.com",
            rol="OPERADOR",
            estatus="PENDIENTE",
            invitado_por=self.user,
        )

        response = self.client.delete(
            f"/api/accounts/invitaciones/{invitation.id}/eliminar/",
            **self.auth_headers,
        )

        self.assertEqual(response.status_code, 200)
        self.assertFalse(InvitacionAcceso.objects.filter(id=invitation.id).exists())

    @override_settings(
        EMAIL_BACKEND="django.core.mail.backends.smtp.EmailBackend",
        EMAIL_HOST="",
        DEFAULT_FROM_EMAIL="no-reply@test.local",
    )
    def test_invitation_reports_when_email_service_is_not_configured(self):
        response = self.client.post(
            "/api/accounts/miembros/invitar/",
            data=json.dumps(
                {
                    "email": "sinenvio@hotmail.com",
                    "nombre_sugerido": "Sin SMTP",
                    "rol": "OPERADOR",
                }
            ),
            content_type="application/json",
            **self.auth_headers,
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertFalse(body["email_sent"])
        self.assertEqual(
            body["email_error"],
            "El servicio de correo no esta configurado todavia.",
        )
        self.assertIn("correo no se pudo enviar", body["mensaje"])

    def test_accept_invitation_requires_password_confirmation_for_new_user(self):
        invitation = InvitacionAcceso.objects.create(
            capa_negocio=self.capa,
            email="nuevo@betterp.test",
            nombre_sugerido="Nuevo Usuario",
            rol="OPERADOR",
            estatus="PENDIENTE",
            invitado_por=self.user,
        )

        response = self.client.post(
            f"/api/accounts/auth/invitaciones/{invitation.token}/aceptar/",
            data=json.dumps(
                {
                    "nombre": "Nuevo Usuario",
                    "password": "ClaveSegura123!",
                    "password_confirm": "otra",
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("confirmacion de contrasena", response.json()["detail"])

    def test_accept_invitation_respects_user_limit_after_plan_change(self):
        limited_capa = CapaNegocio.objects.create(
            nombre="Cuenta Operativa Limitada",
            tipo_capa="OPERADORA",
            usuario_fundador=self.user,
        )
        MembresiaCapaNegocio.objects.create(
            user=self.user,
            capa_negocio=limited_capa,
            rol="OWNER_ADMIN",
            activo=True,
        )
        invitation = InvitacionAcceso.objects.create(
            capa_negocio=limited_capa,
            email="nuevo.limitado@betterp.test",
            nombre_sugerido="Nuevo Limitado",
            rol="OPERADOR",
            estatus="PENDIENTE",
            invitado_por=self.user,
        )
        plan = PlanSaaS.objects.create(
            clave="starter-user-limit-after-invite",
            nombre="Starter User Limit After Invite",
            max_usuarios=1,
            max_entidades=3,
            max_productos=40,
        )
        SuscripcionCapa.objects.create(capa_negocio=limited_capa, plan=plan, estatus="ACTIVA")

        response = self.client.post(
            f"/api/accounts/auth/invitaciones/{invitation.token}/aceptar/",
            data=json.dumps(
                {
                    "nombre": "Nuevo Limitado",
                    "password": "ClaveSegura123!",
                    "password_confirm": "ClaveSegura123!",
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 403)
        self.assertIn("Tu plan permite hasta 1 usuarios", response.json()["detail"])
        invitation.refresh_from_db()
        self.assertEqual(invitation.estatus, "PENDIENTE")
        self.assertFalse(
            MembresiaCapaNegocio.objects.filter(
                capa_negocio=limited_capa,
                user__email__iexact="nuevo.limitado@betterp.test",
                activo=True,
            ).exists()
        )

    @override_settings(
        EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
        EMAIL_HOST="smtp.test.local",
        DEFAULT_FROM_EMAIL="no-reply@test.local",
        FRONTEND_BASE_URL="https://app.test",
    )
    def test_password_recovery_sends_email_and_updates_password(self):
        response = self.client.post(
            "/api/accounts/auth/password-recovery/",
            data=json.dumps({"email": self.user.email}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(RecuperacionAcceso.objects.count(), 1)
        recovery = RecuperacionAcceso.objects.get(user=self.user)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].subject, "Restablece tu acceso a BetterP")
        self.assertIn("https://app.test/restablecer-acceso/", mail.outbox[0].body)
        self.assertIn("Tu acceso actual no cambia", mail.outbox[0].body)
        self.assertEqual(len(mail.outbox[0].alternatives), 1)
        self.assertIn("SEGURIDAD DE CUENTA", mail.outbox[0].alternatives[0][0])
        self.assertIn("Definir nueva contrasena", mail.outbox[0].alternatives[0][0])

        confirm_response = self.client.post(
            f"/api/accounts/auth/password-recovery/{recovery.token}/confirm/",
            data=json.dumps(
                {
                    "password": "NuevaClaveSegura123!",
                    "password_confirm": "NuevaClaveSegura123!",
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(confirm_response.status_code, 200)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("NuevaClaveSegura123!"))
        recovery.refresh_from_db()
        self.assertEqual(recovery.estatus, "USADA")

    def test_password_change_keeps_current_session_and_revokes_other_sessions(self):
        other_session = create_access_session(self.user, provider="PASSWORD")
        recovery = RecuperacionAcceso.objects.create(
            user=self.user,
            email=self.user.email,
        )

        response = self.client.post(
            "/api/accounts/auth/password-change/",
            data=json.dumps(
                {
                    "current_password": "secret123",
                    "password": "NuevaClaveSegura123!",
                    "password_confirm": "NuevaClaveSegura123!",
                }
            ),
            content_type="application/json",
            **self.auth_headers,
        )

        self.assertEqual(response.status_code, 200)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("NuevaClaveSegura123!"))
        self.session.refresh_from_db()
        other_session.refresh_from_db()
        recovery.refresh_from_db()
        self.assertIsNone(self.session.revoked_at)
        self.assertIsNotNone(other_session.revoked_at)
        self.assertEqual(recovery.estatus, "CANCELADA")

    def test_password_change_rejects_invalid_current_password(self):
        response = self.client.post(
            "/api/accounts/auth/password-change/",
            data=json.dumps(
                {
                    "current_password": "incorrecta",
                    "password": "NuevaClaveSegura123!",
                    "password_confirm": "NuevaClaveSegura123!",
                }
            ),
            content_type="application/json",
            **self.auth_headers,
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("actual no es correcta", response.json()["detail"])
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("secret123"))

    @override_settings(
        EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
        EMAIL_HOST="smtp.test.local",
        DEFAULT_FROM_EMAIL="no-reply@test.local",
        FRONTEND_BASE_URL="https://app.test",
    )
    def test_login_requires_two_factor_when_capa_enables_it(self):
        self.capa.seguridad_doble_factor_activa = True
        self.capa.save(update_fields=["seguridad_doble_factor_activa"])

        response = self.client.post(
            "/api/accounts/auth/login/",
            data=json.dumps({"email": self.user.email, "password": "secret123"}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 202)
        body = response.json()
        self.assertTrue(body["requires_two_factor"])
        self.assertEqual(DesafioDobleFactor.objects.count(), 1)
        self.assertEqual(len(mail.outbox), 1)

    @override_settings(
        EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
        EMAIL_HOST="smtp.test.local",
        DEFAULT_FROM_EMAIL="no-reply@test.local",
    )
    def test_verify_two_factor_creates_session(self):
        self.capa.seguridad_doble_factor_activa = True
        self.capa.save(update_fields=["seguridad_doble_factor_activa"])

        login_response = self.client.post(
            "/api/accounts/auth/login/",
            data=json.dumps({"email": self.user.email, "password": "secret123"}),
            content_type="application/json",
        )
        self.assertEqual(login_response.status_code, 202)
        body = login_response.json()
        challenge = DesafioDobleFactor.objects.get(token=body["challenge_token"])
        codigo = mail.outbox[-1].body.split("Codigo de verificacion: ", 1)[1].splitlines()[0].strip()

        verify_response = self.client.post(
            "/api/accounts/auth/two-factor/verify/",
            data=json.dumps(
                {
                    "challenge_token": str(challenge.token),
                    "codigo": codigo,
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(verify_response.status_code, 200)
        verify_body = verify_response.json()
        self.assertIn("tokens", verify_body)
        challenge.refresh_from_db()
        self.assertEqual(challenge.estatus, "VALIDADO")

    def test_platform_login_rejects_regular_user(self):
        regular_user = User.objects.create_user(
            username="regular@test.local",
            email="regular@test.local",
            password="secret123",
        )

        response = self.client.post(
            "/api/accounts/auth/platform/login/",
            data=json.dumps({"email": regular_user.email, "password": "secret123"}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 403)
        self.assertIn("plataforma", response.json()["detail"].lower())

    def test_platform_founder_can_login_without_operational_memberships(self):
        MembresiaCapaNegocio.objects.filter(
            user=self.user,
            capa_negocio=self.capa,
        ).delete()

        response = self.client.post(
            "/api/accounts/auth/platform/login/",
            data=json.dumps({"email": self.user.email, "password": "secret123"}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["user"]["email"], self.user.email)
        self.assertTrue(body["user"]["is_platform_admin"])
        self.assertEqual(body["memberships"], [])
        self.assertIsNone(body["current_membership"])

    @override_settings(
        EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
        EMAIL_HOST="smtp.test.local",
        DEFAULT_FROM_EMAIL="no-reply@test.local",
        FRONTEND_BASE_URL="https://app.test",
    )
    def test_platform_admin_can_invite_internal_admin(self):
        response = self.client.post(
            "/api/accounts/platform-admins/invitaciones/",
            data=json.dumps(
                {
                    "email": "interno@betterp.test",
                    "nombre_sugerido": "Equipo Betterp",
                }
            ),
            content_type="application/json",
            **self.auth_headers,
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertIn("/backoffice/invitacion/", body["accept_url"])
        self.assertTrue(body["email_sent"])
        invitation = InvitacionAdminPlataforma.objects.get(email="interno@betterp.test")
        self.assertEqual(invitation.invitado_por_id, self.user.id)
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn("https://app.test/backoffice/invitacion/", mail.outbox[0].body)

    def test_accept_platform_admin_invitation_promotes_existing_user(self):
        invited_user = User.objects.create_user(
            username="platform@test.local",
            email="platform@test.local",
            password="secret123",
        )
        invitation = InvitacionAdminPlataforma.objects.create(
            email=invited_user.email,
            nombre_sugerido="Platform Ops",
            invitado_por=self.user,
        )

        response = self.client.post(
            f"/api/accounts/auth/platform-admins/invitaciones/{invitation.token}/aceptar/",
            data=json.dumps(
                {
                    "nombre": "Platform Ops",
                    "password": "",
                    "password_confirm": "",
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        invited_user.refresh_from_db()
        invitation.refresh_from_db()
        invited_profile = UsuarioPerfil.objects.get(user=invited_user)
        self.assertTrue(invited_profile.es_admin_plataforma)
        self.assertEqual(invitation.estatus, "ACEPTADA")
        self.assertEqual(invitation.user_relacionado_id, invited_user.id)
        self.assertTrue(response.json()["user"]["is_platform_admin"])

    def test_platform_founder_cannot_be_revoked_by_another_platform_admin(self):
        secondary_admin = User.objects.create_user(
            username="secondary@test.local",
            email="secondary@test.local",
            password="secret123",
        )
        UsuarioPerfil.objects.create(
            user=secondary_admin,
            es_admin_plataforma=True,
        )
        secondary_session = create_access_session(secondary_admin, provider="PASSWORD")
        secondary_tokens = issue_token_pair(secondary_session)
        secondary_headers = {
            "HTTP_AUTHORIZATION": f"Bearer {secondary_tokens['access_token']}",
        }

        response = self.client.delete(
            f"/api/accounts/platform-admins/{self.user.id}/",
            **secondary_headers,
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("aperturo la plataforma", response.json()["detail"])
        founder_profile, _ = UsuarioPerfil.objects.get_or_create(user=self.user)
        self.assertFalse(founder_profile.es_admin_plataforma)
