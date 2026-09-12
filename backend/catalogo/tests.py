import json
from urllib.parse import parse_qs, urlparse
from unittest.mock import Mock, patch

from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.test import TestCase, override_settings

from accounts.models import EventoAuditoria
from accounts.test_utils import create_api_auth_context
from billing.models import PlanSaaS, SuscripcionCapa
from empresas.models import CapaNegocio

from .models import (
    Bodega,
    CalidadIncidencia,
    Categoria,
    InventarioItem,
    InventarioMovimiento,
    Orden,
    OrdenItem,
    Producto,
    ProductoImagen,
)
from .services import (
    catalogo_bodegas_for_capa,
    catalogo_categorias_for_capa,
    catalogo_inventario_items_for_capa,
    catalogo_ordenes_for_capa,
    catalogo_productos_for_capa,
)


class CatalogoTenantIsolationTests(TestCase):
    def setUp(self):
        self.capa_a = CapaNegocio.objects.create(nombre="Capa Catalogo A", tipo_capa="OPERADORA")
        self.capa_b = CapaNegocio.objects.create(nombre="Capa Catalogo B", tipo_capa="OPERADORA")
        self.category_a = Categoria.objects.create(
            capa_negocio=self.capa_a,
            nombre="Electronica",
        )
        self.category_b = Categoria.objects.create(
            capa_negocio=self.capa_b,
            nombre="Electronica",
        )
        self.product_a = Producto.objects.create(
            capa_negocio=self.capa_a,
            categoria=self.category_a,
            internal_sku="SKU-A-BASE",
            nombre="Producto base A",
            precio_base=100,
        )
        self.product_b = Producto.objects.create(
            capa_negocio=self.capa_b,
            categoria=self.category_b,
            internal_sku="SKU-B-BASE",
            nombre="Producto base B",
            precio_base=200,
        )
        self.warehouse_a = Bodega.objects.create(
            capa_negocio=self.capa_a,
            codigo="CENTRAL",
            nombre="Bodega central A",
        )
        self.warehouse_b = Bodega.objects.create(
            capa_negocio=self.capa_b,
            codigo="CENTRAL",
            nombre="Bodega central B",
        )

    def test_product_queryset_is_scoped_by_capa(self):
        product_a = Producto.objects.create(
            capa_negocio=self.capa_a,
            categoria=self.category_a,
            internal_sku="SKU-001",
            nombre="Producto A",
            marca="Marca A",
            precio_base=100,
        )
        product_b = Producto.objects.create(
            capa_negocio=self.capa_b,
            categoria=self.category_b,
            internal_sku="SKU-002",
            nombre="Producto B",
            marca="Marca B",
            precio_base=200,
        )

        ids_a = set(catalogo_productos_for_capa(self.capa_a).values_list("id", flat=True))

        self.assertIn(product_a.id, ids_a)
        self.assertNotIn(product_b.id, ids_a)

    def test_same_sku_is_allowed_across_different_capas(self):
        Producto.objects.create(
            capa_negocio=self.capa_a,
            categoria=self.category_a,
            internal_sku="SKU-SHARED",
            nombre="Producto A",
            precio_base=100,
        )

        product_b = Producto.objects.create(
            capa_negocio=self.capa_b,
            categoria=self.category_b,
            internal_sku="SKU-SHARED",
            nombre="Producto B",
            precio_base=200,
        )

        self.assertEqual(product_b.internal_sku, "SKU-SHARED")

    def test_same_sku_is_rejected_inside_same_capa(self):
        Producto.objects.create(
            capa_negocio=self.capa_a,
            categoria=self.category_a,
            internal_sku="SKU-DUP",
            nombre="Producto Original",
            precio_base=100,
        )

        with self.assertRaises(ValidationError):
            Producto.objects.create(
                capa_negocio=self.capa_a,
                categoria=self.category_a,
                internal_sku="SKU-DUP",
                nombre="Producto Duplicado",
                precio_base=150,
            )

    def test_categories_are_scoped_by_capa(self):
        ids_a = set(catalogo_categorias_for_capa(self.capa_a).values_list("id", flat=True))

        self.assertIn(self.category_a.id, ids_a)
        self.assertNotIn(self.category_b.id, ids_a)

    def test_same_root_category_name_is_rejected_inside_same_capa(self):
        with self.assertRaises(ValidationError):
            Categoria.objects.create(
                capa_negocio=self.capa_a,
                nombre="Electronica",
            )

    def test_product_rejects_category_from_another_capa(self):
        with self.assertRaises(ValidationError):
            Producto.objects.create(
                capa_negocio=self.capa_a,
                categoria=self.category_b,
                internal_sku="SKU-CROSS",
                nombre="Producto cruzado",
                precio_base=100,
            )

    def test_category_rejects_parent_from_another_capa(self):
        with self.assertRaises(ValidationError):
            Categoria.objects.create(
                capa_negocio=self.capa_a,
                parent=self.category_b,
                nombre="Subcategoria cruzada",
            )

    def test_only_one_main_image_per_product(self):
        product = Producto.objects.create(
            capa_negocio=self.capa_a,
            categoria=self.category_a,
            internal_sku="SKU-IMG",
            nombre="Producto con imagen",
            precio_base=100,
        )
        ProductoImagen.objects.create(producto=product, is_main=True)

        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                ProductoImagen.objects.create(producto=product, is_main=True)

    def test_same_warehouse_code_is_allowed_across_different_capas(self):
        self.assertEqual(self.warehouse_a.codigo, "CENTRAL")
        self.assertEqual(self.warehouse_b.codigo, "CENTRAL")

    def test_same_warehouse_code_is_rejected_inside_same_capa(self):
        with self.assertRaises(ValidationError):
            Bodega.objects.create(
                capa_negocio=self.capa_a,
                codigo="central",
                nombre="Bodega duplicada",
            )

    def test_inventory_queryset_is_scoped_by_capa(self):
        item_a = InventarioItem.objects.create(
            capa_negocio=self.capa_a,
            producto=self.product_a,
            bodega=self.warehouse_a,
            stock=10,
            reservado=2,
        )
        item_b = InventarioItem.objects.create(
            capa_negocio=self.capa_b,
            producto=self.product_b,
            bodega=self.warehouse_b,
            stock=5,
        )

        ids_a = set(catalogo_inventario_items_for_capa(self.capa_a).values_list("id", flat=True))

        self.assertIn(item_a.id, ids_a)
        self.assertNotIn(item_b.id, ids_a)
        self.assertEqual(item_a.disponible, 8)

    def test_inventory_item_rejects_product_from_another_capa(self):
        with self.assertRaises(ValidationError):
            InventarioItem.objects.create(
                capa_negocio=self.capa_a,
                producto=self.product_b,
                bodega=self.warehouse_a,
                stock=1,
            )

    def test_inventory_item_rejects_warehouse_from_another_capa(self):
        with self.assertRaises(ValidationError):
            InventarioItem.objects.create(
                capa_negocio=self.capa_a,
                producto=self.product_a,
                bodega=self.warehouse_b,
                stock=1,
            )

    def test_inventory_item_rejects_reserved_over_stock(self):
        with self.assertRaises(ValidationError):
            InventarioItem.objects.create(
                capa_negocio=self.capa_a,
                producto=self.product_a,
                bodega=self.warehouse_a,
                stock=1,
                reservado=2,
            )

    def test_inventory_movement_rejects_cross_capa_references(self):
        item_a = InventarioItem.objects.create(
            capa_negocio=self.capa_a,
            producto=self.product_a,
            bodega=self.warehouse_a,
            stock=10,
        )

        with self.assertRaises(ValidationError):
            InventarioMovimiento.objects.create(
                capa_negocio=self.capa_a,
                item=item_a,
                producto=self.product_b,
                bodega=self.warehouse_a,
                tipo="AJUSTE",
                cantidad=1,
                stock_anterior=10,
                stock_nuevo=11,
            )

    def test_order_queryset_is_scoped_by_capa(self):
        order_a = Orden.objects.create(
            capa_negocio=self.capa_a,
            canal="POS_QR",
            total=100,
        )
        order_b = Orden.objects.create(
            capa_negocio=self.capa_b,
            canal="POS_QR",
            total=200,
        )

        ids_a = set(catalogo_ordenes_for_capa(self.capa_a).values_list("id", flat=True))

        self.assertIn(order_a.id, ids_a)
        self.assertNotIn(order_b.id, ids_a)

    def test_order_item_rejects_product_from_another_capa(self):
        order = Orden.objects.create(
            capa_negocio=self.capa_a,
            canal="POS_QR",
            total=100,
        )

        with self.assertRaises(ValidationError):
            OrdenItem.objects.create(
                orden=order,
                capa_negocio=self.capa_a,
                producto=self.product_b,
                cantidad=1,
                precio_unitario=100,
            )





class CatalogoApiTests(TestCase):
    def setUp(self):
        (
            self.platform_user,
            self.platform_capa,
            self.platform_headers,
        ) = create_api_auth_context(
            email="platform-catalogo@test.local",
            capa_name="Platform Catalogo",
            is_superuser=True,
        )
        self.user_a, self.capa_a, self.headers_a = create_api_auth_context(
            email="catalogo-a@test.local",
            capa_name="Capa Catalogo A",
        )
        self.user_b, self.capa_b, self.headers_b = create_api_auth_context(
            email="catalogo-b@test.local",
            capa_name="Capa Catalogo B",
        )
        plan_enabled = PlanSaaS.objects.create(
            clave="catalogo-enabled",
            nombre="Catalogo Enabled",
            precio_mensual=999,
            modulos_habilitados=[
                "catalogo",
                "inventario",
                                "pos_caja",
            ],
            funciones_habilitadas=["catalogo_ai_enrichment"],
        )
        plan_blocked = PlanSaaS.objects.create(
            clave="catalogo-blocked",
            nombre="Catalogo Blocked",
            precio_mensual=499,
            modulos_habilitados=["dashboard"],
        )
        self.plan_enabled = plan_enabled
        self.plan_blocked = plan_blocked
        self.subscription_a = SuscripcionCapa.objects.create(
            capa_negocio=self.capa_a,
            plan=plan_enabled,
            estatus="ACTIVA",
        )
        self.subscription_b = SuscripcionCapa.objects.create(
            capa_negocio=self.capa_b,
            plan=plan_blocked,
            estatus="ACTIVA",
        )
        self.category_a = Categoria.objects.create(
            capa_negocio=self.capa_a,
            nombre="Electronica",
        )
        self.category_b = Categoria.objects.create(
            capa_negocio=self.capa_b,
            nombre="Electronica",
        )
        self.product_a = Producto.objects.create(
            capa_negocio=self.capa_a,
            categoria=self.category_a,
            internal_sku="SKU-A-001",
            brand_sku="BR-A",
            nombre="Laptop ejecutiva",
            marca="Marca A",
            precio_base=15000,
        )
        self.product_b = Producto.objects.create(
            capa_negocio=self.capa_b,
            categoria=self.category_b,
            internal_sku="SKU-B-001",
            brand_sku="BR-B",
            nombre="Monitor ventas",
            marca="Marca B",
            precio_base=5000,
        )
        ProductoImagen.objects.create(
            producto=self.product_a,
            is_main=True,
            public_url="https://cdn.test/laptop.png",
            asset_status="READY",
        )
        self.warehouse_a = Bodega.objects.create(
            capa_negocio=self.capa_a,
            codigo="CENTRAL",
            nombre="Bodega central A",
        )
        self.warehouse_b = Bodega.objects.create(
            capa_negocio=self.capa_b,
            codigo="CENTRAL",
            nombre="Bodega central B",
        )
        self.inventory_a = InventarioItem.objects.create(
            capa_negocio=self.capa_a,
            producto=self.product_a,
            bodega=self.warehouse_a,
            stock=12,
            reservado=3,
            costo_promedio=10000,
            ultimo_costo=11000,
        )
        self.inventory_b = InventarioItem.objects.create(
            capa_negocio=self.capa_b,
            producto=self.product_b,
            bodega=self.warehouse_b,
            stock=4,
        )
        InventarioMovimiento.objects.create(
            capa_negocio=self.capa_a,
            item=self.inventory_a,
            producto=self.product_a,
            bodega=self.warehouse_a,
            tipo="AJUSTE",
            cantidad=12,
            stock_anterior=0,
            stock_nuevo=12,
            referencia_tipo="seed",
            referencia_id="stock-a",
            actor=self.user_a,
        )
        InventarioMovimiento.objects.create(
            capa_negocio=self.capa_b,
            item=self.inventory_b,
            producto=self.product_b,
            bodega=self.warehouse_b,
            tipo="AJUSTE",
            cantidad=4,
            stock_anterior=0,
            stock_nuevo=4,
            referencia_tipo="seed",
            referencia_id="stock-b",
            actor=self.user_b,
        )

    def order_payload(self, **overrides):
        payload = {
            "canal": "POS_QR",
            "external_order_id": "ORDER-A-001",
            "cliente_nombre": "Cliente Prueba",
            "cliente_email": "cliente@test.local",
            "payment_status": "PENDIENTE",
            "reservar": True,
            "items": [
                {
                    "producto_id": self.product_a.id,
                    "bodega_id": self.warehouse_a.id,
                    "cantidad": "2.000",
                    "precio_unitario": "15000.00",
                }
            ],
        }
        payload.update(overrides)
        return payload

    def test_catalog_uses_current_capa_and_plan_module(self):
        response = self.client.get("/api/catalogo/catalogo/", **self.headers_a)

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["capa_negocio"]["id"], self.capa_a.id)
        product_ids = {item["id"] for item in body["productos"]}
        self.assertIn(self.product_a.id, product_ids)
        self.assertNotIn(self.product_b.id, product_ids)
        self.assertEqual(body["capability"]["modulo_requerido"], "catalogo")
        self.assertEqual(
            body["productos"][0]["imagen_principal"]["asset_status"],
            "READY",
        )



    def test_catalog_filters_by_search_and_category(self):
        response = self.client.get(
            "/api/catalogo/catalogo/",
            {"search": "Laptop", "categoria_id": self.category_a.id},
            **self.headers_a,
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["pagination"]["total"], 1)
        self.assertEqual(body["productos"][0]["internal_sku"], "SKU-A-001")

    def test_catalog_rejects_category_from_other_capa(self):
        response = self.client.get(
            "/api/catalogo/catalogo/",
            {"categoria_id": self.category_b.id},
            **self.headers_a,
        )

        self.assertEqual(response.status_code, 404)

    def test_catalog_requires_catalogo_plan_module(self):
        response = self.client.get("/api/catalogo/catalogo/", **self.headers_b)

        self.assertEqual(response.status_code, 403)
        self.assertIn("modulo", response.json()["detail"])

    def test_create_and_update_category_for_current_capa(self):
        create_response = self.client.post(
            "/api/catalogo/catalogo/categorias/",
            data=json.dumps(
                {
                    "nombre": "Mochilas",
                    "parent_id": self.category_a.id,
                    "activo": True,
                    "metadata": {"familia": "accesorios"},
                }
            ),
            content_type="application/json",
            **self.headers_a,
        )

        self.assertEqual(create_response.status_code, 200)
        created = create_response.json()["categoria"]
        self.assertEqual(created["nombre"], "Mochilas")
        self.assertEqual(created["parent_id"], self.category_a.id)

        update_response = self.client.patch(
            f"/api/catalogo/catalogo/categorias/{created['id']}/",
            data=json.dumps(
                {
                    "nombre": "Backpacks",
                    "parent_id": self.category_a.id,
                    "activo": False,
                    "metadata": {"familia": "travel"},
                }
            ),
            content_type="application/json",
            **self.headers_a,
        )

        self.assertEqual(update_response.status_code, 200)
        updated = update_response.json()["categoria"]
        self.assertEqual(updated["nombre"], "Backpacks")
        self.assertFalse(updated["activo"])
        self.assertEqual(
            Categoria.objects.get(id=created["id"]).capa_negocio_id,
            self.capa_a.id,
        )

    def test_catalog_write_requires_catalogo_plan_module(self):
        response = self.client.post(
            "/api/catalogo/catalogo/categorias/",
            data=json.dumps({"nombre": "Sin acceso"}),
            content_type="application/json",
            **self.headers_b,
        )

        self.assertEqual(response.status_code, 403)
        self.assertIn("modulo", response.json()["detail"])

    def test_create_and_update_product_for_current_capa(self):
        create_response = self.client.post(
            "/api/catalogo/catalogo/productos/",
            data=json.dumps(
                {
                    "internal_sku": "BAG-001",
                    "brand_sku": "HP-CAMPUS-BLUE",
                    "nombre": "Mochila Campus Blue",
                    "descripcion": "Mochila escolar resistente.",
                    "marca": "HP",
                    "categoria_id": self.category_a.id,
                    "precio_base": "450.00",
                    "peso": "0.75",
                    "largo": "42.00",
                    "ancho": "30.00",
                    "alto": "12.00",
                    "master_attributes": {"color": "azul"},
                    "source": "manual",
                    "activo": True,
                }
            ),
            content_type="application/json",
            **self.headers_a,
        )

        self.assertEqual(create_response.status_code, 200)
        product = create_response.json()["producto"]
        self.assertEqual(product["internal_sku"], "BAG-001")
        self.assertEqual(product["categoria"]["id"], self.category_a.id)
        self.assertEqual(product["precio_base"], "450.00")

        update_response = self.client.patch(
            f"/api/catalogo/catalogo/productos/{product['id']}/",
            data=json.dumps(
                {
                    "internal_sku": "BAG-001",
                    "brand_sku": "HP-CAMPUS-BLUE",
                    "nombre": "Mochila Campus Blue 15",
                    "descripcion": "Mochila escolar resistente con laptop sleeve.",
                    "marca": "HP",
                    "categoria_id": self.category_a.id,
                    "precio_base": "499.00",
                    "peso": "0.80",
                    "largo": "42.00",
                    "ancho": "30.00",
                    "alto": "12.00",
                    "master_attributes": {"color": "azul", "capacidad": "15 pulgadas"},
                    "source": "manual",
                    "activo": True,
                }
            ),
            content_type="application/json",
            **self.headers_a,
        )

        self.assertEqual(update_response.status_code, 200)
        updated = update_response.json()["producto"]
        self.assertEqual(updated["nombre"], "Mochila Campus Blue 15")
        self.assertEqual(updated["precio_base"], "499.00")

    def test_product_create_enforces_plan_product_limit(self):
        self.plan_enabled.max_productos = 1
        self.plan_enabled.save(update_fields=["max_productos"])

        response = self.client.post(
            "/api/catalogo/catalogo/productos/",
            data=json.dumps(
                {
                    "internal_sku": "LIMIT-001",
                    "nombre": "Producto fuera de limite",
                    "precio_base": "100.00",
                }
            ),
            content_type="application/json",
            **self.headers_a,
        )

        self.assertEqual(response.status_code, 403)
        self.assertIn("permite hasta", response.json()["detail"])
        self.assertIn("Actualiza el plan", response.json()["detail"])
        self.assertTrue(
            EventoAuditoria.objects.filter(
                accion="catalogo.plan_limit_blocked",
                recurso_id="productos",
                capa_negocio=self.capa_a,
            ).exists()
        )

    def test_product_create_rejects_category_from_other_capa(self):
        response = self.client.post(
            "/api/catalogo/catalogo/productos/",
            data=json.dumps(
                {
                    "internal_sku": "CROSS-001",
                    "nombre": "Producto cruzado",
                    "categoria_id": self.category_b.id,
                    "precio_base": "100.00",
                }
            ),
            content_type="application/json",
            **self.headers_a,
        )

        self.assertEqual(response.status_code, 404)


















    def test_inventory_uses_current_capa_and_plan_module(self):
        response = self.client.get("/api/catalogo/inventario/", **self.headers_a)

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["capa_negocio"]["id"], self.capa_a.id)
        self.assertEqual(body["capability"]["modulo_requerido"], "inventario")
        self.assertEqual(body["resumen"]["stock_total"], "12.000")
        self.assertEqual(body["resumen"]["reservado_total"], "3.000")
        self.assertEqual(body["resumen"]["disponible_total"], "9.000")
        item_ids = {item["id"] for item in body["items"]}
        self.assertIn(self.inventory_a.id, item_ids)
        self.assertNotIn(self.inventory_b.id, item_ids)
        self.assertEqual(body["items"][0]["producto"]["internal_sku"], "SKU-A-001")
        self.assertEqual(body["items"][0]["disponible"], "9.000")
        self.assertEqual(body["movimientos_recientes"][0]["referencia_id"], "stock-a")

    def test_inventory_filters_by_warehouse_and_product(self):
        response = self.client.get(
            "/api/catalogo/inventario/",
            {"bodega_id": self.warehouse_a.id, "producto_id": self.product_a.id},
            **self.headers_a,
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["pagination"]["total"], 1)
        self.assertEqual(body["items"][0]["bodega"]["codigo"], "CENTRAL")

    def test_inventory_rejects_warehouse_from_other_capa(self):
        response = self.client.get(
            "/api/catalogo/inventario/",
            {"bodega_id": self.warehouse_b.id},
            **self.headers_a,
        )

        self.assertEqual(response.status_code, 404)

    def test_inventory_requires_catalogo_plan_module(self):
        response = self.client.get("/api/catalogo/inventario/", **self.headers_b)

        self.assertEqual(response.status_code, 403)
        self.assertIn("modulo", response.json()["detail"])

    def test_create_warehouse_and_adjust_inventory_for_current_capa(self):
        warehouse_response = self.client.post(
            "/api/catalogo/inventario/bodegas/",
            data=json.dumps(
                {
                    "codigo": "showroom",
                    "nombre": "Showroom",
                    "tipo": "INTERNA",
                    "direccion": "Piso de venta",
                    "activo": True,
                    "metadata": {"zona": "sur"},
                }
            ),
            content_type="application/json",
            **self.headers_a,
        )

        self.assertEqual(warehouse_response.status_code, 200)
        warehouse = warehouse_response.json()["bodega"]
        self.assertEqual(warehouse["codigo"], "SHOWROOM")

        adjustment_response = self.client.post(
            "/api/catalogo/inventario/ajustes/",
            data=json.dumps(
                {
                    "producto_id": self.product_a.id,
                    "bodega_id": warehouse["id"],
                    "cantidad": "17.000",
                    "tipo": "AJUSTE",
                    "referencia_tipo": "manual",
                    "referencia_id": "stock-showroom",
                    "nota": "Carga inicial controlada.",
                    "costo_promedio": "9500.0000",
                    "ultimo_costo": "9800.0000",
                    "metadata": {"origen": "mvp-test"},
                }
            ),
            content_type="application/json",
            **self.headers_a,
        )

        self.assertEqual(adjustment_response.status_code, 200)
        body = adjustment_response.json()
        self.assertEqual(body["item"]["stock"], "17.000")
        self.assertEqual(body["item"]["disponible"], "17.000")
        self.assertEqual(body["movimiento"]["stock_anterior"], "0.000")
        self.assertEqual(body["movimiento"]["stock_nuevo"], "17.000")
        self.assertEqual(body["movimiento"]["actor"]["email"], self.user_a.email)

    def test_warehouse_create_enforces_plan_warehouse_limit(self):
        self.plan_enabled.max_entidades = 1
        self.plan_enabled.save(update_fields=["max_entidades"])

        response = self.client.post(
            "/api/catalogo/inventario/bodegas/",
            data=json.dumps(
                {
                    "codigo": "extra",
                    "nombre": "Bodega adicional",
                    "tipo": "INTERNA",
                }
            ),
            content_type="application/json",
            **self.headers_a,
        )

        self.assertEqual(response.status_code, 403)
        self.assertIn("permite hasta", response.json()["detail"])
        self.assertIn("Actualiza el plan", response.json()["detail"])
        self.assertTrue(
            EventoAuditoria.objects.filter(
                accion="catalogo.plan_limit_blocked",
                recurso_id="bodegas",
                capa_negocio=self.capa_a,
            ).exists()
        )

    def test_inventory_adjustment_rejects_negative_stock(self):
        response = self.client.post(
            "/api/catalogo/inventario/ajustes/",
            data=json.dumps(
                {
                    "producto_id": self.product_a.id,
                    "bodega_id": self.warehouse_a.id,
                    "cantidad": "-20.000",
                    "tipo": "AJUSTE",
                }
            ),
            content_type="application/json",
            **self.headers_a,
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("stock", response.json()["detail"].lower())

    def test_inventory_write_requires_catalogo_plan_module(self):
        response = self.client.post(
            "/api/catalogo/inventario/bodegas/",
            data=json.dumps({"codigo": "sin-acceso", "nombre": "Sin acceso"}),
            content_type="application/json",
            **self.headers_b,
        )

        self.assertEqual(response.status_code, 403)
        self.assertIn("modulo", response.json()["detail"])

    def test_order_create_reserves_inventory_and_lists_current_capa(self):
        create_response = self.client.post(
            "/api/catalogo/ordenes/",
            data=json.dumps(self.order_payload()),
            content_type="application/json",
            **self.headers_a,
        )

        self.assertEqual(create_response.status_code, 200)
        body = create_response.json()
        self.assertTrue(body["created"])
        self.assertEqual(body["orden"]["estatus"], "RESERVADA")
        self.assertEqual(body["orden"]["total"], "30000.00")
        self.assertEqual(body["orden"]["items"][0]["producto"]["internal_sku"], "SKU-A-001")
        self.inventory_a.refresh_from_db()
        self.assertEqual(str(self.inventory_a.reservado), "5.000")
        movement = InventarioMovimiento.objects.get(
            referencia_id=str(body["orden"]["id"]),
            tipo="RESERVA",
        )
        self.assertEqual(str(movement.stock_nuevo), "12.000")

        list_response = self.client.get("/api/catalogo/ordenes/", **self.headers_a)

        self.assertEqual(list_response.status_code, 200)
        list_body = list_response.json()
        self.assertEqual(list_body["capability"]["modulo_requerido"], "pos_caja")
        self.assertEqual(list_body["resumen"]["reservadas"], 1)
        self.assertEqual(list_body["items"][0]["external_order_id"], "ORDER-A-001")

    def test_order_confirm_decrements_stock_and_reservation(self):
        create_response = self.client.post(
            "/api/catalogo/ordenes/",
            data=json.dumps(self.order_payload(external_order_id="ORDER-CONFIRM")),
            content_type="application/json",
            **self.headers_a,
        )
        order_id = create_response.json()["orden"]["id"]

        confirm_response = self.client.post(
            f"/api/catalogo/ordenes/{order_id}/confirmar/",
            data=json.dumps({"payment_status": "PAGADA", "nota": "Pago validado."}),
            content_type="application/json",
            **self.headers_a,
        )

        self.assertEqual(confirm_response.status_code, 200)
        body = confirm_response.json()
        self.assertEqual(body["orden"]["estatus"], "CONFIRMADA")
        self.assertEqual(body["orden"]["payment_status"], "PAGADA")
        self.inventory_a.refresh_from_db()
        self.assertEqual(str(self.inventory_a.stock), "10.000")
        self.assertEqual(str(self.inventory_a.reservado), "3.000")
        movement = InventarioMovimiento.objects.get(
            referencia_id=str(order_id),
            tipo="VENTA",
        )
        self.assertEqual(str(movement.cantidad), "-2.000")
        self.assertEqual(str(movement.stock_nuevo), "10.000")

    def test_order_cancel_releases_reserved_inventory(self):
        create_response = self.client.post(
            "/api/catalogo/ordenes/",
            data=json.dumps(self.order_payload(external_order_id="ORDER-CANCEL")),
            content_type="application/json",
            **self.headers_a,
        )
        order_id = create_response.json()["orden"]["id"]

        cancel_response = self.client.post(
            f"/api/catalogo/ordenes/{order_id}/cancelar/",
            data=json.dumps({"nota": "Cliente cancelo antes de pagar."}),
            content_type="application/json",
            **self.headers_a,
        )

        self.assertEqual(cancel_response.status_code, 200)
        self.assertEqual(cancel_response.json()["orden"]["estatus"], "CANCELADA")
        self.inventory_a.refresh_from_db()
        self.assertEqual(str(self.inventory_a.stock), "12.000")
        self.assertEqual(str(self.inventory_a.reservado), "3.000")
        movement = InventarioMovimiento.objects.get(
            referencia_id=str(order_id),
            tipo="LIBERACION",
        )
        self.assertEqual(str(movement.cantidad), "-2.000")

    def test_order_cancel_confirmed_with_restock_restores_stock(self):
        create_response = self.client.post(
            "/api/catalogo/ordenes/",
            data=json.dumps(self.order_payload(external_order_id="ORDER-RESTOCK")),
            content_type="application/json",
            **self.headers_a,
        )
        order_id = create_response.json()["orden"]["id"]
        self.client.post(
            f"/api/catalogo/ordenes/{order_id}/confirmar/",
            data=json.dumps({"payment_status": "PAGADA"}),
            content_type="application/json",
            **self.headers_a,
        )

        cancel_response = self.client.post(
            f"/api/catalogo/ordenes/{order_id}/cancelar/",
            data=json.dumps({"restock": True, "payment_status": "REEMBOLSADA"}),
            content_type="application/json",
            **self.headers_a,
        )

        self.assertEqual(cancel_response.status_code, 200)
        self.assertEqual(cancel_response.json()["orden"]["payment_status"], "REEMBOLSADA")
        self.inventory_a.refresh_from_db()
        self.assertEqual(str(self.inventory_a.stock), "12.000")
        self.assertEqual(str(self.inventory_a.reservado), "3.000")
        movement = InventarioMovimiento.objects.get(
            referencia_id=str(order_id),
            tipo="CANCELACION",
        )
        self.assertEqual(str(movement.cantidad), "2.000")

    def test_order_create_rejects_insufficient_stock_without_partial_write(self):
        response = self.client.post(
            "/api/catalogo/ordenes/",
            data=json.dumps(
                self.order_payload(
                    external_order_id="ORDER-NO-STOCK",
                    items=[
                        {
                            "producto_id": self.product_a.id,
                            "bodega_id": self.warehouse_a.id,
                            "cantidad": "20.000",
                            "precio_unitario": "15000.00",
                        }
                    ],
                )
            ),
            content_type="application/json",
            **self.headers_a,
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("stock insuficiente", response.json()["detail"].lower())
        self.inventory_a.refresh_from_db()
        self.assertEqual(str(self.inventory_a.reservado), "3.000")
        self.assertFalse(
            Orden.objects.filter(
                capa_negocio=self.capa_a,
                external_order_id="ORDER-NO-STOCK",
            ).exists()
        )

    def test_order_requires_catalogo_orders_module(self):
        response = self.client.post(
            "/api/catalogo/ordenes/",
            data=json.dumps(self.order_payload()),
            content_type="application/json",
            **self.headers_b,
        )

        self.assertEqual(response.status_code, 403)
        self.assertIn("modulo", response.json()["detail"])


    def test_platform_admin_can_read_customer_catalog(self):
        response = self.client.get(
            f"/api/catalogo/admin/clientes/{self.capa_b.id}/catalogo/",
            **self.platform_headers,
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["capa_negocio"]["id"], self.capa_b.id)
        self.assertEqual(body["productos"][0]["internal_sku"], "SKU-B-001")

    def test_platform_admin_can_read_customer_inventory(self):
        response = self.client.get(
            f"/api/catalogo/admin/clientes/{self.capa_b.id}/inventario/",
            **self.platform_headers,
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["capa_negocio"]["id"], self.capa_b.id)
        self.assertEqual(body["items"][0]["producto"]["internal_sku"], "SKU-B-001")
        self.assertEqual(body["resumen"]["stock_total"], "4.000")

    def test_platform_admin_can_read_customer_orders(self):
        self.client.post(
            "/api/catalogo/ordenes/",
            data=json.dumps(self.order_payload(external_order_id="ORDER-ADMIN")),
            content_type="application/json",
            **self.headers_a,
        )

        response = self.client.get(
            f"/api/catalogo/admin/clientes/{self.capa_a.id}/ordenes/",
            **self.platform_headers,
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["capa_negocio"]["id"], self.capa_a.id)
        self.assertEqual(body["resumen"]["reservadas"], 1)
        self.assertEqual(body["items"][0]["external_order_id"], "ORDER-ADMIN")

    def test_platform_admin_can_confirm_customer_order(self):
        create_response = self.client.post(
            "/api/catalogo/ordenes/",
            data=json.dumps(self.order_payload(external_order_id="ORDER-ADMIN-CONFIRM")),
            content_type="application/json",
            **self.headers_a,
        )
        order_id = create_response.json()["orden"]["id"]

        response = self.client.post(
            f"/api/catalogo/admin/clientes/{self.capa_a.id}/ordenes/{order_id}/confirmar/",
            data=json.dumps(
                {
                    "payment_status": "PAGADA",
                    "nota": "Confirmada desde plataforma.",
                    "metadata": {"source": "test"},
                }
            ),
            content_type="application/json",
            **self.platform_headers,
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body["updated"])
        self.assertEqual(body["orden"]["estatus"], "CONFIRMADA")
        self.assertEqual(body["orden"]["payment_status"], "PAGADA")
        self.inventory_a.refresh_from_db()
        self.assertEqual(str(self.inventory_a.stock), "10.000")
        self.assertEqual(str(self.inventory_a.reservado), "3.000")
        self.assertTrue(
            EventoAuditoria.objects.filter(
                capa_negocio=self.capa_a,
                accion="catalogo.order_admin_confirmed",
                recurso_id=str(order_id),
            ).exists()
        )

    def test_platform_admin_can_cancel_reserved_customer_order(self):
        create_response = self.client.post(
            "/api/catalogo/ordenes/",
            data=json.dumps(self.order_payload(external_order_id="ORDER-ADMIN-CANCEL")),
            content_type="application/json",
            **self.headers_a,
        )
        order_id = create_response.json()["orden"]["id"]

        response = self.client.post(
            f"/api/catalogo/admin/clientes/{self.capa_a.id}/ordenes/{order_id}/cancelar/",
            data=json.dumps(
                {
                    "payment_status": "CANCELADA",
                    "nota": "Cancelada desde plataforma.",
                }
            ),
            content_type="application/json",
            **self.platform_headers,
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["orden"]["estatus"], "CANCELADA")
        self.assertEqual(body["orden"]["payment_status"], "CANCELADA")
        self.inventory_a.refresh_from_db()
        self.assertEqual(str(self.inventory_a.stock), "12.000")
        self.assertEqual(str(self.inventory_a.reservado), "3.000")

    def test_non_platform_user_cannot_transition_admin_order(self):
        create_response = self.client.post(
            "/api/catalogo/ordenes/",
            data=json.dumps(self.order_payload(external_order_id="ORDER-ADMIN-FORBIDDEN")),
            content_type="application/json",
            **self.headers_a,
        )
        order_id = create_response.json()["orden"]["id"]

        response = self.client.post(
            f"/api/catalogo/admin/clientes/{self.capa_a.id}/ordenes/{order_id}/confirmar/",
            data=json.dumps({"payment_status": "PAGADA"}),
            content_type="application/json",
            **self.headers_a,
        )

        self.assertEqual(response.status_code, 403)

    def test_non_platform_user_cannot_read_admin_catalog(self):
        response = self.client.get(
            f"/api/catalogo/admin/clientes/{self.capa_b.id}/catalogo/",
            **self.headers_a,
        )

        self.assertEqual(response.status_code, 403)

    def test_non_platform_user_cannot_read_admin_inventory(self):
        response = self.client.get(
            f"/api/catalogo/admin/clientes/{self.capa_b.id}/inventario/",
            **self.headers_a,
        )

        self.assertEqual(response.status_code, 403)

    def test_platform_context_exposes_current_capa_entitlements(self):
        response = self.client.get("/api/catalogo/platform/context/", **self.headers_a)

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["solution"]["code"], "pos_qr")
        self.assertEqual(body["solution"]["clave"], "pos_qr")
        self.assertEqual(body["capa_negocio"]["id"], self.capa_a.id)
        self.assertTrue(body["entitlements"]["has_access"])
        self.assertIn("catalogo", body["entitlements"]["modules"])
        self.assertEqual(body["entitlements"]["quality_feature"], "catalogo_ai_enrichment")
        self.assertIn("catalogo_ai_enrichment", body["entitlements"]["features"])
        self.assertEqual(
            body["entitlements"]["contract_version"],
            "betterp.posqr.entitlements.v1",
        )
        self.assertEqual(
            body["subscription"]["effective_entitlements"]["solution_key"],
            "pos_qr",
        )
        self.assertEqual(
            body["entitlements"]["matrix"]["modules_count"],
            len(body["subscription"]["modulos_habilitados"]),
        )
        policy = body["entitlements"]["policy"]
        self.assertEqual(policy["contract_version"], "betterp.posqr.entitlements.v1")
        self.assertTrue(policy["modules"]["productos"])
        self.assertTrue(policy["modules"]["inventario"])
        self.assertTrue(policy["features"]["quality_ai"])
        self.assertEqual(policy["limits"]["productos"]["used"], 1)
        self.assertEqual(policy["limits"]["bodegas"]["used"], 1)
        self.assertEqual(policy["limits"]["cajas"]["limit"], 1)
        self.assertFalse(policy["plan_guidance"]["modules"][0]["upgrade_recommended"])
        self.assertEqual(policy["plan_guidance"]["limits"][0]["key"], "productos")
        self.assertEqual(body["contract"]["solution"], "pos_qr")




    def test_platform_admin_can_read_catalogo_events(self):
        EventoAuditoria.objects.create(
            actor=None,
            capa_negocio=self.capa_a,
            accion="catalogo.stock_sync",
            recurso_tipo="catalogo.integration",
            recurso_id="stock-1",
            metadata={"status": "OK"},
        )

        response = self.client.get(
            "/api/catalogo/platform/events/",
            **self.platform_headers,
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["items"][0]["accion"], "catalogo.stock_sync")
