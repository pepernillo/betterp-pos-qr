# Vende Facil: inventario tecnico e integracion BetterP

## Objetivo

Mapear el repo `pepernillo/pim-system-v3` en la rama `codex/render-production-readiness` para integrarlo como la segunda solucion de BetterP: `Vende Facil`.

La meta no es copiar el repo completo dentro de BetterP sin criterio. La meta es separar dominio de negocio de plataforma y reutilizar BetterP para autenticacion, tenants, permisos, Stripe, facturacion, auditoria, salud, backups, crons y backoffice.

## Estado observado

Vende Facil es una aplicacion Django + Next.js enfocada en PIM, inventario, conectores, ventas, facturacion de ordenes y envios.

Backend:

- Django 6.0.1.
- Django Ninja.
- Apps: `products`, `inventory`, `connectors`, `catalogs`, `sales`, `shipping`.
- Base de datos configurable por `DATABASE_URL`; fallback SQLite local.
- Storage compatible S3/R2 con variables `AWS_*`.
- Health checks propios: `/health/`, `/health/db/`, `/health/storage/`.
- Celery configurado por Redis, aunque la integracion real de workers debe revisarse por comando/tarea.

Frontend:

- Next.js 16.1.4.
- React 19.2.3.
- Tailwind 4.
- `lucide-react`, `framer-motion`, `dnd-kit`, `react-dropzone`, `sonner`.

## Hallazgos criticos

1. Vende Facil no esta tenantizado.
   Los modelos y APIs usan consultas globales como `Product.objects.all()` y `Order.objects...`, sin `CapaNegocio`, sin membresias y sin selector de capa activa.

2. Vende Facil no tiene login/billing SaaS integrado.
   No se observo un flujo propio maduro de autenticacion, Stripe, suscripciones o permisos. Esto favorece la integracion con BetterP.

3. Vende Facil ya contiene un modelo `Invoice`.
   Ese modelo no debe evolucionar como motor fiscal independiente. Debe convertirse en una solicitud/referencia de facturacion conectada al modulo `facturacion` de BetterP.

4. Las credenciales de conectores viven en modelos de dominio.
   `PlatformConnection` guarda `api_key`, `api_secret`, `access_token`, `refresh_token`, `extra_credentials` y `webhook_secret`. Antes de operar clientes reales, esas credenciales deben protegerse bajo patrones de plataforma BetterP.

5. Hay logica valiosa de dominio.
   Productos, inventario, movimientos, catalogos, reglas de precio, ordenes, envios y Mercado Libre tienen suficiente avance para migrarse por bloques.

## Variables y dependencias relevantes

### Variables actuales de Vende Facil

- `SECRET_KEY`
- `DEBUG`
- `ALLOWED_HOSTS`
- `DATABASE_URL`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_STORAGE_BUCKET_NAME`
- `AWS_S3_ENDPOINT_URL`
- `AWS_S3_REGION_NAME`
- `AWS_S3_SIGNATURE_VERSION`
- `AWS_S3_ADDRESSING_STYLE`
- `AWS_QUERYSTRING_AUTH`
- `ASSETS_PUBLIC_BASE_URL`
- `CORS_ALLOW_ALL_ORIGINS`
- `CORS_ALLOWED_ORIGINS`
- `CORS_ALLOWED_ORIGIN_REGEXES`
- `CSRF_TRUSTED_ORIGINS`
- `GOOGLE_API_KEY`
- `GEMINI_MODEL`
- `CELERY_BROKER_URL`
- `CELERY_RESULT_BACKEND`
- `ML_SITE_ID`
- `ML_SEND_LEGACY_CONDITION`
- `ML_SEND_TITLE`
- `ML_CHANNELS`
- `ML_ITEM_CONDITION`

### Decision BetterP

No agregar estas variables a produccion BetterP de forma masiva. Primero se debe decidir cuales siguen siendo necesarias despues de migrar a plataforma:

- Storage debe reutilizar Cloudflare R2 de BetterP o un bucket/prefix separado por solucion.
- Redis/Celery debe alinearse con el worker/background jobs de BetterP.
- AI/Gemini debe revisarse contra el sistema de consumo/medicion de BetterP.
- Credenciales de Mercado Libre deben vivir por `CapaNegocio` y con controles de seguridad/auditoria.

## Inventario por modulo

### Products / PIM

Modelos:

- `Category`
- `Product`
- `ProductImage`

Valor de dominio:

- SKU interno y SKU de marca.
- Golden record de producto.
- Marca, categoria, precio base.
- Peso y dimensiones.
- Atributos maestros en JSON para marketplaces.
- Imagenes con metadata de calidad: URL publica, status, content type, tamano, dimensiones, sha256 y ultimo error.
- Enriquecimiento con IA e imagenes candidatas.
- Busqueda GTIN.

Problemas para integrar:

- `Product.internal_sku` es unico global; debe ser unico por `CapaNegocio`.
- `Category` no tiene tenant.
- `ProductImage` no tiene trazabilidad BetterP ni ownership por capa.
- Hay duplicacion de campo `description` en el modelo.
- Hay comentarios y logica MVP que conviene limpiar durante migracion.

Destino recomendado:

- Crear app/modulo `vende_facil` o apps internas `vende_products`, `vende_inventory`, etc.
- Agregar `capa_negocio` a categorias, productos e imagenes.
- Cambiar unicidad a `(capa_negocio, internal_sku)`.
- Mantener `master_attributes` JSON.
- Reusar storage R2/backup de BetterP.
- Registrar uso de IA en consumos SaaS si se mantiene enrichment.

### Inventory

Modelos:

- `Warehouse`
- `InventoryItem`
- `InventoryMovement`

Valor de dominio:

- Bodegas internas/externas.
- Stock, reservado, costo promedio y ultimo costo.
- Movimientos de compra, venta, ajuste, devolucion, cancelacion, perdida y sync import.
- Historial auditable por producto/bodega/referencia.

Problemas para integrar:

- Bodega `code` es unica global; debe ser unica por capa.
- `InventoryItem` no tiene tenant directo; depende de producto/bodega.
- Movimientos no registran usuario BetterP ni evento de auditoria.
- El endpoint puede sincronizar stock con Mercado Libre despues de un movimiento manual, sin pasar por gating de plan.

Destino recomendado:

- Agregar `capa_negocio` en `Warehouse` y constraints por capa.
- Mantener `InventoryMovement` como bitacora de dominio, conectada a `EventoAuditoria` para cambios criticos.
- Aplicar permisos BetterP por modulo: `vende_facil.inventario`.
- Agregar limites por plan: productos, bodegas, movimientos, conectores y syncs.

### Catalogs

Modelos:

- `Catalog`
- `CatalogItem`
- `CategoryMapping`
- `PricingRule`

Valor de dominio:

- Catalogos por marketplace/canal.
- Reglas anti-overselling.
- Porcentaje de stock a publicar.
- Override de precio por item.
- Mapeo de categorias internas a externas.
- Reglas de pricing por categoria, marca o rango.

Problemas para integrar:

- `Catalog.api_config` puede contener credenciales; esto no debe quedar como JSON libre sin proteccion.
- No hay tenant.
- Pricing rules no tienen auditoria de cambios.

Destino recomendado:

- Tenant por `CapaNegocio`.
- Separar configuracion publica del catalogo de secretos del conector.
- Auditar cambios de pricing rule.
- Permiso por modulo: `vende_facil.catalogos`.

### Connectors

Modelos:

- `PlatformConnection`
- `SyncLog`
- `WebhookEvent`

Plataformas declaradas:

- Mercado Libre.
- Amazon SP-API.
- Shopify.
- WooCommerce.
- Ingram Micro.
- CT Internacional.
- Punto de venta fisico.
- Catalogo de solo consulta.

Valor de dominio:

- Conexion por plataforma.
- Tokens y expiracion.
- Flags para sync inventario, precios y ordenes.
- Politica de importacion: crear productos o solo vincular SKUs.
- Salud de conector: active/error/expired/pending.
- Logs de sync.
- Webhooks con dedupe, intentos, estado y errores.

Problemas para integrar:

- Credenciales sensibles en columnas directas.
- No hay relacion con `CapaNegocio`.
- Webhooks no estan conectados al monitor central de BetterP.
- No hay gating por plan.
- No hay separacion clara entre conector activo, scope permitido y accion ejecutada.

Destino recomendado:

- Agregar `capa_negocio`.
- Encriptar o encapsular credenciales sensibles.
- Integrar estado de conectores a Backoffice Salud.
- Mapear `WebhookEvent` a senales operativas BetterP.
- Empezar solo con Mercado Libre como conector productivo controlado.

### Sales

Modelos:

- `Order`
- `OrderItem`
- `Return`
- `Invoice`

Valor de dominio:

- Ordenes por plataforma/conexion.
- Items con snapshot de SKU, nombre, precio y cantidad.
- Descuentos, envio, total, moneda y estatus.
- Auditoria de inventario aplicada a ordenes.
- Devoluciones y reintegro/revision de stock.
- Vista de analitica: ventas, revenue, unidades, canales, top productos, estatus y tendencia.

Problemas para integrar:

- `Order` no tiene `CapaNegocio`.
- La unicidad es por `(connection, platform_order_id)`, pero debe quedar protegida por tenant.
- `Invoice` duplica parcialmente la responsabilidad fiscal.
- No existe relacion con `Cliente` de BetterP ni con emisor fiscal por capa.

Destino recomendado:

- Migrar `Order`, `OrderItem` y `Return` como dominio propio de Vende Facil.
- Convertir `Invoice` en `InvoiceRequest` o `SalesInvoiceRequest`.
- La emision real del CFDI debe ocurrir en `facturacion` de BetterP.
- Guardar en Vende Facil solo referencias fiscales: factura BetterP, UUID, PDF/XML, status fiscal y errores.

### Shipping

Modelo:

- `Shipment`

Valor de dominio:

- Envio por orden.
- Tracking, carrier, URL de rastreo, label URL.
- Estatus de fulfillment.
- Metodo y estimado de entrega.

Problemas para integrar:

- No tiene tenant directo.
- No esta conectado a salud/alertas operativas.

Destino recomendado:

- Asociacion por orden tenantizada.
- Senales de salud: pendientes, con problema, etiquetas faltantes, entregas vencidas.

## Mapeo plataforma BetterP

| Necesidad Vende Facil | BetterP debe resolverlo con |
| --- | --- |
| Login y sesiones | `accounts`, `MembresiaCapaNegocio`, capa activa |
| Tenant | `CapaNegocio` |
| Planes | `PlanSaaS.solution = vende_facil` |
| Suscripcion | `SuscripcionCapa` inicialmente; evolucion futura a suscripcion por solucion |
| Permisos | `modulos_habilitados`, `funciones_habilitadas`, overrides por cliente |
| Facturacion SaaS | Billing/Stripe BetterP |
| Facturacion fiscal de ventas | App `facturacion` BetterP |
| Auditoria | `EventoAuditoria` |
| Salud | Backoffice Salud + senales por solucion |
| Backups | Backups por capa con inclusion de datos Vende Facil |
| Jobs/Crons | `BackgroundJob`, `CronRunLog`, manifests de Render |
| Storage | Cloudflare R2/Storage BetterP con prefijo por solucion |
| Soporte | Backoffice Clientes SaaS y Soluciones |

## Namespaces propuestos

Modulos:

- `vende_facil.productos`
- `vende_facil.inventario`
- `vende_facil.catalogos`
- `vende_facil.conectores`
- `vende_facil.ordenes`
- `vende_facil.envios`
- `platform.facturacion`

Funciones:

- `vende_facil.ai_enrichment`
- `vende_facil.gtin_lookup`
- `vende_facil.marketplace_publish`
- `vende_facil.stock_sync`
- `vende_facil.order_pull`
- `vende_facil.webhook_processing`
- `vende_facil.invoice_request`

## Riesgos de migracion

1. Fuga de datos entre clientes si se importa sin `CapaNegocio`.
2. Duplicacion fiscal si se mantiene `sales.Invoice` como motor de CFDI.
3. Credenciales de marketplace expuestas si se migran como JSON sin proteccion.
4. Costos no medidos si la IA de enriquecimiento queda fuera de consumo SaaS.
5. Jobs de sync sin health centralizado.
6. Conflictos de SKU si se mantiene unicidad global.
7. Sobrecarga operativa si se despliega como segundo backend permanente.

## Orden de integracion recomendado

### Bloque 1: contrato de plataforma

1. Crear documento de contrato entre BetterP y Vende Facil.
2. Definir headers/contexto: usuario, capa activa y solucion activa.
3. Definir nombres finales de permisos y modulos.
4. Definir limite inicial de plan para productos, bodegas, conectores y ordenes.

### Bloque 2: modelos base tenantizados

1. Crear app `vende_facil` en BetterP o apps prefijadas por dominio.
2. Migrar modelos base:
   - categoria
   - producto
   - imagen
   - bodega
   - item inventario
   - movimiento inventario
3. Agregar `capa_negocio`.
4. Agregar constraints por capa.
5. Agregar admin y tests de aislamiento multi-tenant.

### Bloque 3: backoffice solucion

1. Agregar seccion de Vende Facil en Backoffice Soluciones.
2. Mostrar estado: incubacion, modelos migrados, endpoints activos, riesgos.
3. Agregar health por solucion.

### Bloque 4: conectores

1. Migrar `PlatformConnection` con tenant.
2. Migrar Mercado Libre primero.
3. Guardar secretos de forma protegida.
4. Integrar logs y webhooks con salud BetterP.

### Bloque 5: ventas e inventario

1. Migrar ordenes e items.
2. Conectar ordenes a movimientos de inventario.
3. Conectar envios.
4. Agregar analitica por capa.

### Bloque 6: facturacion fiscal

1. Reemplazar `sales.Invoice` por solicitud fiscal de venta.
2. Invocar servicios de `facturacion` BetterP.
3. Guardar referencias fiscales en Vende Facil.
4. Probar sandbox antes de usar produccion.

## Primer bloque de codigo recomendado

El siguiente cambio de codigo debe ser conservador:

1. Crear app Django `vende_facil` en BetterP.
2. Crear solo modelos tenantizados base:
   - `VendeCategoria`
   - `VendeProducto`
   - `VendeProductoImagen`
3. Agregar `capa_negocio` obligatorio.
4. Agregar constraints:
   - SKU unico por capa.
   - nombre de categoria unico por capa y padre.
5. Agregar tests de aislamiento:
   - una capa no ve productos de otra.
   - SKUs repetidos se permiten entre capas.
   - SKUs repetidos dentro de una misma capa se bloquean.
6. No migrar todavia Mercado Libre, ventas ni facturacion.

Este bloque deja la base segura para empezar a mover dominio sin comprometer facturacion, billing ni datos de clientes.

## Decision arquitectonica

La ruta recomendada es integracion modular progresiva dentro de BetterP, no servicio separado permanente.

Se puede mantener `pim-system-v3` como referencia funcional durante la migracion, pero la operacion productiva final debe vivir bajo BetterP Platform para evitar duplicar:

- login
- tenants
- billing
- facturacion
- auditoria
- salud
- backups
- soporte
