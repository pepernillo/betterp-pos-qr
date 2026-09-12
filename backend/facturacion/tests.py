from datetime import date
from decimal import Decimal

from django.test import TestCase

from accounts.security import PLAN_OVERRIDE_METADATA_KEY
from accounts.test_utils import create_api_auth_context
from billing.models import PlanSaaS, SuscripcionCapa
from crm.models import Cliente
from empresas.models import EntidadNegocio
from facturacion.services import _format_facturama_error, build_receiver_from_cliente
from finanzas.models import CuentaPorCobrar


class FacturacionPlanAccessTests(TestCase):
    def setUp(self):
        self.user, self.capa, self.auth_headers = create_api_auth_context(
            email="facturacion-owner@test.local",
            capa_name="Capa Facturacion",
        )

    def activate_plan(self, modules: list[str]):
        plan = PlanSaaS.objects.create(
            clave=f"facturacion-plan-{PlanSaaS.objects.count() + 1}",
            nombre="Plan Facturacion",
            max_usuarios=5,
            max_entidades=5,
            max_productos=50,
            modulos_habilitados=modules,
            funciones_habilitadas=[],
        )
        return SuscripcionCapa.objects.create(
            capa_negocio=self.capa,
            plan=plan,
            estatus="ACTIVA",
        )

    def test_operational_facturacion_requires_plan_module(self):
        self.activate_plan(["dashboard", "entidades", "clientes", "cxc"])

        response = self.client.get(
            "/api/facturacion/proveedor/status/",
            **self.auth_headers,
        )

        self.assertEqual(response.status_code, 403)
        self.assertIn("modulo", response.json()["detail"])

    def test_operational_facturacion_allows_plan_module(self):
        self.activate_plan(["dashboard", "entidades", "clientes", "cxc", "facturacion_cfdi"])

        response = self.client.get(
            "/api/facturacion/proveedor/status/",
            **self.auth_headers,
        )

        self.assertEqual(response.status_code, 200)
        self.assertIn("proveedor", response.json())

    def test_facturacion_respeta_overrides_de_modulos(self):
        subscription = self.activate_plan(["dashboard", "entidades", "clientes", "cxc"])
        subscription.metadata = {
            PLAN_OVERRIDE_METADATA_KEY: {
                "modulos_agregados": ["facturacion_cfdi"],
            }
        }
        subscription.save(update_fields=["metadata", "fecha_actualizacion"])

        allowed_response = self.client.get(
            "/api/facturacion/proveedor/status/",
            **self.auth_headers,
        )
        self.assertEqual(allowed_response.status_code, 200)

        subscription.metadata = {
            PLAN_OVERRIDE_METADATA_KEY: {
                "modulos_agregados": ["facturacion_cfdi"],
                "modulos_bloqueados": ["facturacion_cfdi"],
            }
        }
        subscription.save(update_fields=["metadata", "fecha_actualizacion"])

        blocked_response = self.client.get(
            "/api/facturacion/proveedor/status/",
            **self.auth_headers,
        )
        self.assertEqual(blocked_response.status_code, 403)
        self.assertIn("modulo", blocked_response.json()["detail"])


class FacturamaErrorFormattingTests(TestCase):
    def test_formats_model_state_errors_for_user_display(self):
        body = {
            "Message": "La solicitud no es valida.",
            "ModelState": {
                "cfdi.Receiver.Rfc": ["El RFC receptor no coincide con el regimen."],
                "cfdi.Items[0].ProductCode": ["La clave SAT no es valida."],
            },
        }

        message = _format_facturama_error(body, 400)

        self.assertIn("Facturama rechazo la solicitud (400)", message)
        self.assertIn("La solicitud no es valida.", message)
        self.assertIn("cfdi.Receiver.Rfc", message)
        self.assertIn("El RFC receptor no coincide", message)


class FacturacionCfdiUseTests(TestCase):
    def setUp(self):
        self.user, self.capa, self.auth_headers = create_api_auth_context(
            email="cfdi-use-owner@test.local",
            capa_name="Capa Uso CFDI",
        )
        self.capa.facturacion_uso_cfdi_default = "G03"
        self.capa.save(update_fields=["facturacion_uso_cfdi_default"])
        self.entidad = EntidadNegocio.objects.create(
            capa_negocio=self.capa,
            nombre_comercial="Maya Coliving",
        )

    def create_account_for_regime(self, regimen: str) -> CuentaPorCobrar:
        cliente = Cliente.objects.create(
            entidad_relacionada=self.entidad,
            nombre_comercial="Cliente Fiscal",
            razon_social="CLIENTE FISCAL",
            rfc="CFS900101AB1",
            regimen_fiscal=regimen,
            codigo_postal="06600",
        )
        return CuentaPorCobrar.objects.create(
            entidad_relacionada=self.entidad,
            cliente_relacionado=cliente,
            concepto="Renta mayo",
            fecha_emision=date(2026, 5, 1),
            fecha_vencimiento=date(2026, 5, 5),
            monto_total=Decimal("9000"),
            periodicidad="MENSUAL",
        )

    def test_receiver_cfdi_use_falls_back_to_s01_for_regime_605(self):
        cuenta = self.create_account_for_regime(
            "Sueldos y Salarios e Ingresos Asimilados a Salarios"
        )

        receiver = build_receiver_from_cliente(cuenta)

        self.assertEqual(receiver.regimen_fiscal, "605")
        self.assertEqual(receiver.uso_cfdi, "S01")

    def test_receiver_cfdi_use_keeps_g03_for_compatible_regime(self):
        cuenta = self.create_account_for_regime("Regimen Simplificado de Confianza")

        receiver = build_receiver_from_cliente(cuenta)

        self.assertEqual(receiver.regimen_fiscal, "626")
        self.assertEqual(receiver.uso_cfdi, "G03")
