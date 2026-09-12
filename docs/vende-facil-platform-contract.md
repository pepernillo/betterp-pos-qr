# Contrato BetterP <-> Vende Facil

Este contrato permite que Vende Facil opere como solucion gobernada por BetterP mientras el dominio se migra por bloques.

## Objetivo

BetterP queda como fuente de verdad para:

- tenant/capa activa
- solucion activa
- plan y suscripcion
- modulos y funciones habilitadas
- auditoria operativa
- salud y eventos de integracion

Vende Facil conserva temporalmente su backend de dominio para productos, inventario, Mercado Libre, ordenes y envios mientras esos bloques se migran gradualmente.

## Configuracion

Variables en BetterP para que Vende Facil consulte contexto de plataforma:

```env
VENDE_FACIL_INTERNAL_API_TOKEN=...
```

Header requerido para llamadas internas desde Vende Facil:

```http
X-BetterP-Vende-Facil-Token: ...
```

Variables en BetterP para que el backoffice aprovisione cuentas y planes en la API separada de Vende Facil:

```env
VENDE_FACIL_SERVICE_BASE_URL=https://api-vendefacil.betterp.net
VENDE_FACIL_SERVICE_INTERNAL_KEY=...
VENDE_FACIL_APP_BASE_URL=https://vendefacil.betterp.net
VENDE_FACIL_SERVICE_TIMEOUT_SECONDS=8
```

`VENDE_FACIL_SERVICE_INTERNAL_KEY` debe tener el mismo valor que `BETTERP_INTERNAL_API_KEY` en Render del backend de Vende Facil. BetterP enviara ese valor en:

```http
X-BetterP-Internal-Key: ...
```

Cuando estas variables no estan configuradas, las altas y cambios de plan en BetterP no se bloquean; la suscripcion queda marcada con sync `NOT_CONFIGURED` en `metadata.vende_facil_sync`.

## Entrada desde BetterP

El acceso de usuarios a Vende Facil debe iniciar en BetterP, no en un login propio de Vende Facil.

Ruta frontend:

```http
GET /soluciones/vende-facil/entrar
```

Si el usuario no esta autenticado, BetterP lo manda a:

```http
GET /login?solution=vende_facil&redirectTo=/soluciones/vende-facil/entrar
```

Despues del login, BetterP resuelve la solucion y capa correcta con:

```http
GET /api/billing/solution-launch/vende_facil/
Authorization: Bearer <betterp_access_token>
```

La respuesta incluye `solution.code`, `capa_negocio`, `subscription`, `platform` y un bloque `launch`. Para Vende Facil el modo esperado es:

```json
{
  "launch": {
    "mode": "external_embed",
    "ready": true,
    "url": "https://vendefacil.betterp.net/?embed=betterp&capa_negocio_id=123&betterp_account_id=betterp-capa-123"
  }
}
```

El `solution_key` es parte obligatoria del launcher. Un usuario con varias soluciones no se enruta por email, sino por la combinacion:

```text
usuario + capa_negocio_id + solution.code + suscripcion/plan
```

Para Renta Facil, el launcher equivalente usa `renta_facil` y devuelve modo `internal` con URL `/dashboard`.

## Contexto autenticado

Para frontend o rutas ya autenticadas en BetterP:

```http
GET /api/vende-facil/platform/context/
Authorization: Bearer <betterp_access_token>
```

Devuelve:

- `solution`: datos de `vende_facil`
- `capa_negocio`: tenant activo
- `subscription`: plan y suscripcion activa
- `entitlements`: modulos/funciones `vende_facil.*`
- `contract`: headers y claves esperadas por el canal

## Contexto interno

Para backend separado de Vende Facil:

```http
POST /api/vende-facil/platform/context/
X-BetterP-Vende-Facil-Token: <token>
Content-Type: application/json

{
  "capa_negocio_id": 123
}
```

Uso esperado:

1. Vende Facil recibe o resuelve el `capa_negocio_id`.
2. Consulta BetterP.
3. BetterP responde si la capa tiene acceso a `vende_facil.productos` y que capacidades estan habilitadas.
4. Vende Facil permite o bloquea el flujo de dominio conforme a esa respuesta.

## Catalogo interno para Tienda Facil

Tienda Facil puede solicitar un snapshot de catalogo de Vende Facil a traves de BetterP:

```http
GET /api/vende-facil/platform/catalog/?capa_negocio_id=123&page=1&page_size=100&activo=true
X-BetterP-Vende-Facil-Token: <token>
```

Requiere:

```text
vende_facil.productos
```

La respuesta usa el contrato:

```json
{
  "contract": "betterp.vende_facil.catalog_snapshot.v1",
  "source": {
    "solution": "vende_facil",
    "module": "vende_facil.productos"
  },
  "productos": []
}
```

El payload incluye datos vendibles publicos del producto, imagen principal, categoria,
precio base, moneda e inventario disponible agregado. Tienda Facil debe guardar la liga
con `source_solution=vende_facil` y `source_external_id=<producto.id>`, sin convertir
Vende Facil en un sistema de checkout.

## Eventos operativos

Para que Vende Facil reporte bloqueos, errores, webhooks, jobs o sync:

```http
POST /api/vende-facil/platform/events/
X-BetterP-Vende-Facil-Token: <token>
Content-Type: application/json

{
  "event_type": "mercadolibre_publish_blocked",
  "status": "WARN",
  "source": "api-vendefacil",
  "capa_negocio_id": 123,
  "resource_type": "mercadolibre.publication",
  "resource_id": "SKU-001",
  "message": "Producto bloqueado por atributos faltantes.",
  "metadata": {
    "missing": ["BACKPACK_TYPE"]
  }
}
```

BetterP guarda el evento en `EventoAuditoria` con accion `vende_facil.<event_type>`.

## Aprovisionamiento desde BetterP

Cuando soporte crea o actualiza una suscripcion de Vende Facil desde backoffice, BetterP sincroniza automaticamente:

1. Cuenta en Vende Facil:

```http
POST /api/v1/betterp/accounts
```

2. Entitlement de la solucion:

```http
PUT /api/v1/betterp/accounts/{external_id}/entitlements/vendefacil
```

El `external_id` canonico queda con este formato:

```text
betterp-capa-{capa_id}
```

El payload de entitlement incluye plan, estatus, limites comerciales, modulos, features y referencias Stripe disponibles. El resultado se guarda en `SuscripcionCapa.metadata.vende_facil_sync` y en `EventoBilling` como `subscription.vende_facil.sync_ok`, `sync_error` o `sync_not_configured`.

## Lectura backoffice

Para administradores de plataforma:

```http
GET /api/vende-facil/platform/events/?capa_id=123&limit=30
Authorization: Bearer <betterp_access_token>
```

## Catalogo e inventario tenantizados

BetterP ya expone datos base migrados de Vende Facil con aislamiento por `CapaNegocio`.

Catalogo para la capa autenticada:

```http
GET /api/vende-facil/catalogo/
Authorization: Bearer <betterp_access_token>
```

Requiere modulo:

```text
vende_facil.productos
```

Inventario para la capa autenticada:

```http
GET /api/vende-facil/inventario/
Authorization: Bearer <betterp_access_token>
```

Requiere modulo:

```text
vende_facil.inventario
```

Backoffice plataforma por cliente:

```http
GET /api/vende-facil/admin/clientes/{capa_id}/catalogo/
GET /api/vende-facil/admin/clientes/{capa_id}/inventario/
Authorization: Bearer <betterp_access_token>
```

Los endpoints de inventario devuelven:

- bodegas tenantizadas
- stock, reservado y disponible por producto/bodega
- costos promedio y ultimo costo
- ultimos movimientos de inventario
- resumen agregado por capa

## Reglas

- Vende Facil no debe crear billing, login o facturacion fiscal paralelos.
- Vende Facil debe consultar BetterP antes de permitir capacidades SaaS.
- Los eventos operativos importantes deben reportarse a BetterP.
- Los permisos y features deben usar namespace `vende_facil.*`.
- El token interno no debe exponerse en frontend ni repositorio.
