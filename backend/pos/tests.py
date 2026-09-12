"""Pruebas del punto de venta QR: caja, restaurante, cobro QR y corte."""

from decimal import Decimal

from django.test import TestCase

from accounts.test_utils import create_api_auth_context
from billing.models import PlanSaaS, Solucion, SuscripcionCapa
from billing.services import ensure_default_plans, ensure_default_solutions
from catalogo.models import Bodega, Categoria, InventarioItem, Producto

from .models import CobroQR, Mesa, PuntoVenta, Ticket, Turno

API = "/api/pos"


class PosBaseTestCase(TestCase):
    """Monta una capa con plan POS completo, catalogo minimo y una caja."""

    plan_clave = "pos_restaurante"

    def setUp(self):
        ensure_default_solutions()
        ensure_default_plans()
        self.solucion = Solucion.objects.get(clave="pos_qr")
        self.plan = PlanSaaS.objects.get(clave=self.plan_clave)

        self.user, self.capa, self.headers = create_api_auth_context(
            email="caja@test.local",
            capa_name="Restaurante Test",
        )
        self.suscripcion = SuscripcionCapa.objects.create(
            capa_negocio=self.capa,
            plan=self.plan,
            estatus="ACTIVA",
        )

        self.bodega = Bodega.objects.create(
            capa_negocio=self.capa,
            codigo="BAR",
            nombre="Barra",
        )
        self.categoria = Categoria.objects.create(
            capa_negocio=self.capa,
            nombre="Bebidas",
        )
        self.producto = Producto.objects.create(
            capa_negocio=self.capa,
            categoria=self.categoria,
            internal_sku="CAFE-500",
            nombre="Cafe americano",
            precio_base=Decimal("45.00"),
        )
        InventarioItem.objects.create(
            capa_negocio=self.capa,
            producto=self.producto,
            bodega=self.bodega,
            stock=Decimal("100"),
        )
        self.punto = PuntoVenta.objects.create(
            capa_negocio=self.capa,
            bodega=self.bodega,
            codigo="CAJA1",
            nombre="Caja principal",
            tipo_servicio="RESTAURANTE",
            menu_qr_activo=True,
        )

    def abrir_turno(self, fondo="500.00"):
        resp = self.client.post(
            f"{API}/turnos/abrir/",
            data={"punto_venta_id": self.punto.id, "fondo_inicial": fondo},
            content_type="application/json",
            **self.headers,
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        return resp.json()

    def abrir_ticket(self, **extra):
        payload = {"punto_venta_id": self.punto.id, **extra}
        resp = self.client.post(
            f"{API}/tickets/",
            data=payload,
            content_type="application/json",
            **self.headers,
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        return resp.json()

    def agregar_item(self, ticket_id, cantidad="1"):
        resp = self.client.post(
            f"{API}/tickets/{ticket_id}/items/",
            data={"producto_id": self.producto.id, "cantidad": cantidad},
            content_type="application/json",
            **self.headers,
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        return resp.json()


class TurnoTests(PosBaseTestCase):
    def test_abrir_turno_registra_fondo_inicial(self):
        turno = self.abrir_turno("750.50")
        self.assertEqual(turno["estado"], "ABIERTO")
        self.assertEqual(Decimal(turno["fondo_inicial"]), Decimal("750.50"))

    def test_no_se_abren_dos_turnos_en_la_misma_caja(self):
        self.abrir_turno()
        resp = self.client.post(
            f"{API}/turnos/abrir/",
            data={"punto_venta_id": self.punto.id, "fondo_inicial": "100"},
            content_type="application/json",
            **self.headers,
        )
        self.assertEqual(resp.status_code, 409)

    def test_no_se_cierra_turno_con_cuentas_abiertas(self):
        turno = self.abrir_turno()
        ticket = self.abrir_ticket()
        self.agregar_item(ticket["id"])
        resp = self.client.post(
            f"{API}/turnos/{turno['id']}/cerrar/",
            data={"efectivo_declarado": "500"},
            content_type="application/json",
            **self.headers,
        )
        self.assertEqual(resp.status_code, 409)
        self.assertIn("cuenta", resp.json()["detail"].lower())


class VentaEnMostradorTests(PosBaseTestCase):
    def test_venta_en_efectivo_descuenta_inventario_y_cierra_la_cuenta(self):
        self.abrir_turno()
        ticket = self.abrir_ticket()
        ticket = self.agregar_item(ticket["id"], cantidad="2")
        self.assertEqual(Decimal(ticket["total"]), Decimal("90.00"))

        resp = self.client.post(
            f"{API}/tickets/{ticket['id']}/pagos/",
            data={"forma": "EFECTIVO", "monto": "90.00", "recibido": "100.00"},
            content_type="application/json",
            **self.headers,
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        cobrado = resp.json()
        self.assertEqual(cobrado["estado"], "COBRADO")
        self.assertEqual(Decimal(cobrado["saldo"]), Decimal("0.00"))
        self.assertEqual(Decimal(cobrado["pagos"][0]["cambio"]), Decimal("10.00"))

        inventario = InventarioItem.objects.get(
            producto=self.producto, bodega=self.bodega
        )
        self.assertEqual(inventario.stock, Decimal("98.000"))

        ticket_obj = Ticket.objects.get(id=ticket["id"])
        self.assertIsNotNone(ticket_obj.orden_id)
        self.assertEqual(ticket_obj.orden.canal, "POS_QR")

    def test_el_pago_no_puede_exceder_el_saldo(self):
        self.abrir_turno()
        ticket = self.abrir_ticket()
        self.agregar_item(ticket["id"])
        resp = self.client.post(
            f"{API}/tickets/{ticket['id']}/pagos/",
            data={"forma": "EFECTIVO", "monto": "500.00"},
            content_type="application/json",
            **self.headers,
        )
        self.assertEqual(resp.status_code, 400)

    def test_no_se_vende_sin_turno_abierto(self):
        resp = self.client.post(
            f"{API}/tickets/",
            data={"punto_venta_id": self.punto.id},
            content_type="application/json",
            **self.headers,
        )
        self.assertEqual(resp.status_code, 409)


class CobroQRTests(PosBaseTestCase):
    def test_cobro_qr_confirmado_salda_la_cuenta(self):
        self.abrir_turno()
        ticket = self.abrir_ticket()
        self.agregar_item(ticket["id"])

        resp = self.client.post(
            f"{API}/tickets/{ticket['id']}/cobro-qr/",
            data={},
            content_type="application/json",
            **self.headers,
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        cobro = resp.json()
        self.assertEqual(cobro["estado"], "PENDIENTE")
        self.assertEqual(Decimal(cobro["monto"]), Decimal("45.00"))
        self.assertIn("betterp.pos.cobro", cobro["qr_payload"])

        publico = self.client.get(f"{API}/publico/cobro/{cobro['referencia']}/")
        self.assertEqual(publico.status_code, 200)
        self.assertEqual(publico.json()["negocio"], "Caja principal")

        confirm = self.client.post(
            f"{API}/cobros-qr/{cobro['referencia']}/confirmar/",
            data={"referencia_externa": "SPEI-123"},
            content_type="application/json",
            **self.headers,
        )
        self.assertEqual(confirm.status_code, 200, confirm.content)
        self.assertEqual(confirm.json()["estado"], "PAGADO")

        ticket_obj = Ticket.objects.get(id=ticket["id"])
        self.assertEqual(ticket_obj.estado, "COBRADO")
        self.assertEqual(ticket_obj.pagado, Decimal("45.00"))

    def test_cobro_qr_no_excede_el_saldo(self):
        self.abrir_turno()
        ticket = self.abrir_ticket()
        self.agregar_item(ticket["id"])
        resp = self.client.post(
            f"{API}/tickets/{ticket['id']}/cobro-qr/",
            data={"monto": "999.00"},
            content_type="application/json",
            **self.headers,
        )
        self.assertEqual(resp.status_code, 400)


class RestauranteTests(PosBaseTestCase):
    def setUp(self):
        super().setUp()
        self.mesa = Mesa.objects.create(punto_venta=self.punto, nombre="M1", zona="Terraza")

    def test_abrir_cuenta_ocupa_la_mesa_y_cobrarla_la_libera(self):
        self.abrir_turno()
        ticket = self.abrir_ticket(mesa_id=self.mesa.id, comensales=3)
        self.mesa.refresh_from_db()
        self.assertEqual(self.mesa.estado, "OCUPADA")

        self.agregar_item(ticket["id"])
        self.client.post(
            f"{API}/tickets/{ticket['id']}/pagos/",
            data={"forma": "TARJETA", "monto": "45.00"},
            content_type="application/json",
            **self.headers,
        )
        self.mesa.refresh_from_db()
        self.assertEqual(self.mesa.estado, "LIBRE")

    def test_una_mesa_no_admite_dos_cuentas_abiertas(self):
        self.abrir_turno()
        self.abrir_ticket(mesa_id=self.mesa.id)
        resp = self.client.post(
            f"{API}/tickets/",
            data={"punto_venta_id": self.punto.id, "mesa_id": self.mesa.id},
            content_type="application/json",
            **self.headers,
        )
        self.assertEqual(resp.status_code, 409)

    def test_menu_qr_publico_lista_el_catalogo_sin_autenticacion(self):
        resp = self.client.get(f"{API}/publico/menu/{self.mesa.qr_token}/")
        self.assertEqual(resp.status_code, 200, resp.content)
        body = resp.json()
        self.assertEqual(body["negocio"], "Caja principal")
        self.assertTrue(body["permite_pedido"])
        self.assertEqual(body["categorias"][0]["nombre"], "Bebidas")
        self.assertEqual(body["categorias"][0]["productos"][0]["nombre"], "Cafe americano")

    def test_pedido_desde_la_mesa_entra_a_comanda(self):
        self.abrir_turno()
        resp = self.client.post(
            f"{API}/publico/menu/{self.mesa.qr_token}/pedido/",
            data={
                "items": [{"producto_id": self.producto.id, "cantidad": "2", "notas": "sin azucar"}],
                "comensales": 2,
            },
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(Decimal(resp.json()["total"]), Decimal("90.00"))

        comandas = self.client.get(f"{API}/comandas/", **self.headers)
        self.assertEqual(comandas.status_code, 200)
        items = comandas.json()["items"]
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["notas"], "sin azucar")
        self.assertEqual(items[0]["mesa"], "M1")

        ticket = Ticket.objects.get(mesa=self.mesa, estado="ABIERTO")
        self.assertEqual(ticket.origen, "MENU_QR")

    def test_el_menu_no_se_publica_si_esta_desactivado(self):
        self.punto.menu_qr_activo = False
        self.punto.save()
        resp = self.client.get(f"{API}/publico/menu/{self.mesa.qr_token}/")
        self.assertEqual(resp.status_code, 404)


class CorteDeCajaTests(PosBaseTestCase):
    def test_el_corte_cuadra_efectivo_y_reporta_diferencia(self):
        turno = self.abrir_turno("500.00")

        ticket = self.abrir_ticket()
        self.agregar_item(ticket["id"], cantidad="2")
        self.client.post(
            f"{API}/tickets/{ticket['id']}/pagos/",
            data={"forma": "EFECTIVO", "monto": "90.00"},
            content_type="application/json",
            **self.headers,
        )

        otro = self.abrir_ticket()
        self.agregar_item(otro["id"])
        self.client.post(
            f"{API}/tickets/{otro['id']}/pagos/",
            data={"forma": "TARJETA", "monto": "45.00"},
            content_type="application/json",
            **self.headers,
        )

        resp = self.client.post(
            f"{API}/turnos/{turno['id']}/cerrar/",
            data={"efectivo_declarado": "585.00"},
            content_type="application/json",
            **self.headers,
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        corte = resp.json()["corte"]

        self.assertEqual(corte["tickets_cobrados"], 2)
        self.assertEqual(Decimal(corte["venta_total"]), Decimal("135.00"))
        self.assertEqual(Decimal(corte["por_forma_pago"]["EFECTIVO"]["monto"]), Decimal("90.00"))
        self.assertEqual(Decimal(corte["por_forma_pago"]["TARJETA"]["monto"]), Decimal("45.00"))
        # fondo 500 + 90 en efectivo = 590 esperados; se declararon 585
        self.assertEqual(Decimal(corte["efectivo_esperado"]), Decimal("590.00"))
        self.assertEqual(Decimal(corte["diferencia"]), Decimal("-5.00"))

        self.assertEqual(Turno.objects.get(id=turno["id"]).estado, "CERRADO")

    def test_reporte_de_venta_agrega_por_forma_de_pago_y_producto(self):
        self.abrir_turno()
        ticket = self.abrir_ticket()
        self.agregar_item(ticket["id"], cantidad="3")
        self.client.post(
            f"{API}/tickets/{ticket['id']}/pagos/",
            data={"forma": "EFECTIVO", "monto": "135.00"},
            content_type="application/json",
            **self.headers,
        )
        resp = self.client.get(f"{API}/reportes/venta/", **self.headers)
        self.assertEqual(resp.status_code, 200, resp.content)
        body = resp.json()
        self.assertEqual(body["tickets"], 1)
        self.assertEqual(Decimal(body["venta_total"]), Decimal("135.00"))
        self.assertEqual(Decimal(body["ticket_promedio"]), Decimal("135.00"))
        self.assertEqual(body["por_producto"][0]["producto"], "Cafe americano")


class AislamientoPorCapaTests(PosBaseTestCase):
    def test_una_capa_no_ve_los_tickets_de_otra(self):
        self.abrir_turno()
        ticket = self.abrir_ticket()

        _, capa_b, headers_b = create_api_auth_context(
            email="otra-caja@test.local",
            capa_name="Otro Negocio",
        )
        SuscripcionCapa.objects.create(
            capa_negocio=capa_b, plan=self.plan, estatus="ACTIVA"
        )

        listado = self.client.get(f"{API}/tickets/", **headers_b)
        self.assertEqual(listado.status_code, 200)
        self.assertEqual(listado.json()["total"], 0)

        detalle = self.client.get(f"{API}/tickets/{ticket['id']}/", **headers_b)
        self.assertEqual(detalle.status_code, 404)


class PlanGatingTests(PosBaseTestCase):
    plan_clave = "pos_inicial"

    def test_plan_inicial_no_habilita_mesas_de_restaurante(self):
        resp = self.client.post(
            f"{API}/puntos-venta/{self.punto.id}/mesas/",
            data={"nombre": "M9"},
            content_type="application/json",
            **self.headers,
        )
        self.assertEqual(resp.status_code, 403)

    def test_plan_inicial_no_permite_dividir_la_cuenta(self):
        self.abrir_turno()
        ticket = self.abrir_ticket()
        self.agregar_item(ticket["id"], cantidad="2")
        resp = self.client.post(
            f"{API}/tickets/{ticket['id']}/pagos/",
            data={"forma": "EFECTIVO", "monto": "45.00"},
            content_type="application/json",
            **self.headers,
        )
        self.assertEqual(resp.status_code, 403)
