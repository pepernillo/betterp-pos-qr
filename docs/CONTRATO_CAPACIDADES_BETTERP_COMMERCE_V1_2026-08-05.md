# Contrato de capacidades BetterP Commerce v1

Fecha de corte: 2026-08-05  
Contrato: `betterp.commerce.entitlements.v1`  
Versión: `1`  
Estado: implementado y probado localmente; pendiente de commit, despliegue y smoke productivo de solo lectura

## 1. Autoridad

BetterP es la autoridad del plan comercial y firma el contrato dentro del token de acceso al
workspace. BetterP Commerce valida la firma, la versión, la matriz completa y el hash; después
adopta el plan local sin overrides por cuenta.

Una modificación de precios, límites o capacidades exige una versión nueva del contrato. No se
permite ajustar una cuenta individual para ocultar una divergencia entre sistemas.

## 2. Capacidades canónicas

| Capacidad | Micro | Starter | Growth | Scale |
|---|:---:|:---:|:---:|:---:|
| `commerce.product_master` | Sí | Sí | Sí | Sí |
| `commerce.inventory` | Sí | Sí | Sí | Sí |
| `commerce.catalogs` | Sí | Sí | Sí | Sí |
| `commerce.channel_pricing_rules` | No | No | Sí | Sí |
| `commerce.pos_qr_cashier` | Sí | Sí | Sí | Sí |
| `commerce.online_store` | Sí | Sí | Sí | Sí |
| `commerce.customers` | No | Sí | Sí | Sí |
| `commerce.orders` | Sí | Sí | Sí | Sí |
| `commerce.payments` | Sí | Sí | Sí | Sí |
| `commerce.shipping` | No | Sí | Sí | Sí |
| `commerce.billing` | No | Sí | Sí | Sí |
| `commerce.sales_reporting` | Sí | Sí | Sí | Sí |
| `commerce.marketplaces` | No | No | Sí | Sí |
| `commerce.b2b` | No | No | Sí | Sí |
| `commerce.marketing` | No | No | Sí | Sí |
| `commerce.ai_enrichment` | No | No | Sí | Sí |
| `commerce.bulk_sync` | No | No | Sí | Sí |
| `commerce.custom_domain` | No | No | No | Sí |
| `commerce.api` | No | No | No | Sí |
| `commerce.priority_support` | No | No | No | Sí |

## 3. Límites comerciales

| Plan | Usuarios | Storefronts | Productos de catálogo |
|---|---:|---:|---:|
| Micro (`tienda_micro`) | 1 | 1 | 20 |
| Starter (`tienda_launch`) | 3 | 1 | 250 |
| Growth (`tienda_growth`) | 10 | 3 | 2,500 |
| Scale (`tienda_scale`) | 30 | 10 | 25,000 |

Los límites técnicos de trabajo asíncrono permanecen separados de estos límites comerciales. No
se infieren presupuestos técnicos nuevos a partir del número de productos.

## 4. Compatibilidad heredada

Las claves `vende_facil.*` y `tienda_facil.*` se conservan como alias y evidencia histórica. No se
presenta Vende Fácil como solución activa ni se crean planes nuevos con esas claves. Durante el
despliegue coordinado, los tokens anteriores sin contrato v1 continúan operando; cualquier token
nuevo con contrato v1 queda sujeto a la matriz canónica.

## 5. Aplicación efectiva

La API de BetterP Commerce asigna el plan de forma idempotente y aplica la capacidad requerida por
familia de rutas. Entre otras, se controlan productos, inventario, catálogos, reglas de precio,
POS, storefronts, clientes, pedidos B2B, pagos, envíos, facturación, reportes y marketplaces.

Los endpoints públicos deliberados, callbacks y webhooks de proveedor conservan su contrato de
seguridad propio. Los tokens internos entre servicios no dependen del plan de un usuario final.

## 6. Evidencia local

- BetterP: 3 pruebas focalizadas verdes para catálogo de planes, puente firmado y alias heredado.
- BetterP Commerce: 39 pruebas verdes para aislamiento, cuotas, adopción idempotente, detección de
  drift y compuertas de capacidades.
- Validación de sintaxis y `git diff --check` sin errores.

El despliegue debe coordinar BetterP y BetterP Commerce en el mismo corte. El smoke posterior será
de solo lectura y comprobará, como mínimo, acceso Growth a marketplaces, bloqueo Starter a esa
familia y exposición correcta del plan en `/saas/usage`.
