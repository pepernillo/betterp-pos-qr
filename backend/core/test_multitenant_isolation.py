from datetime import date
from decimal import Decimal

from django.test import TestCase

from accounts.test_utils import create_api_auth_context
from crm.models import Cliente
from empresas.models import CapaNegocio, EntidadNegocio
from finanzas.models import CuentaBancaria, CuentaPorCobrar


class MultiTenantIsolationTests(TestCase):
    def setUp(self):
        self.user, self.capa, self.auth_headers = create_api_auth_context(
            email="tenant-a@test.local",
            capa_name="Capa A",
        )
        self.client.defaults.update(self.auth_headers)
        self.entidad = EntidadNegocio.objects.create(
            capa_negocio=self.capa,
            nombre_comercial="Entidad A",
            tipo_fecha_corte="INDIVIDUAL",
        )
        self.cliente = Cliente.objects.create(
            entidad_relacionada=self.entidad,
            razon_social="Cliente A",
            nombre_comercial="Cliente A",
            telefono="5511111111",
        )
        self.cxc = CuentaPorCobrar.objects.create(
            entidad_relacionada=self.entidad,
            cliente_relacionado=self.cliente,
            concepto="Renta A",
            fecha_vencimiento=date.today(),
            monto_total=Decimal("1000.00"),
        )
        self.bank_account = CuentaBancaria.objects.create(
            capa_negocio=self.capa,
            entidad_relacionada=self.entidad,
            nombre="Banco A",
            banco="BBVA",
            activa=True,
        )

        self.other_capa = CapaNegocio.objects.create(nombre="Capa B", tipo_capa="OPERADORA")
        self.other_entidad = EntidadNegocio.objects.create(
            capa_negocio=self.other_capa,
            nombre_comercial="Entidad B",
            tipo_fecha_corte="INDIVIDUAL",
        )
        self.other_cliente = Cliente.objects.create(
            entidad_relacionada=self.other_entidad,
            razon_social="Cliente B",
            nombre_comercial="Cliente B",
            telefono="5522222222",
        )
        self.other_cxc = CuentaPorCobrar.objects.create(
            entidad_relacionada=self.other_entidad,
            cliente_relacionado=self.other_cliente,
            concepto="Renta B",
            fecha_vencimiento=date.today(),
            monto_total=Decimal("2000.00"),
        )
        self.other_bank_account = CuentaBancaria.objects.create(
            capa_negocio=self.other_capa,
            entidad_relacionada=self.other_entidad,
            nombre="Banco B",
            banco="Santander",
            activa=True,
        )

    def test_cliente_list_only_returns_active_capa_clients(self):
        response = self.client.get("/api/crm/lista/?estatus=todos")

        self.assertEqual(response.status_code, 200)
        ids = {item["id"] for item in response.json()["items"]}
        self.assertIn(self.cliente.id, ids)
        self.assertNotIn(self.other_cliente.id, ids)

    def test_cxc_list_only_returns_active_capa_accounts(self):
        response = self.client.get("/api/finanzas/cxc/?page=1&page_size=20")

        self.assertEqual(response.status_code, 200)
        ids = {item["id"] for item in response.json()["items"]}
        self.assertIn(self.cxc.id, ids)
        self.assertNotIn(self.other_cxc.id, ids)

    def test_cxc_customer_detail_rejects_customer_from_another_capa(self):
        response = self.client.get(f"/api/finanzas/cxc/clientes/{self.other_cliente.id}/detalle/")

        self.assertEqual(response.status_code, 404)

    def test_bank_accounts_only_return_active_capa_accounts(self):
        response = self.client.get("/api/finanzas/conciliacion/cuentas-bancarias/")

        self.assertEqual(response.status_code, 200)
        ids = {item["id"] for item in response.json()}
        self.assertIn(self.bank_account.id, ids)
        self.assertNotIn(self.other_bank_account.id, ids)
