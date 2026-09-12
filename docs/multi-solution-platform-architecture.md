# BetterP: arquitectura multi-solucion

## Objetivo

Convertir BetterP en la plataforma central de operacion SaaS para varias soluciones de negocio, reutilizando la infraestructura comun ya construida: autenticacion, capas de negocio, membresias, Stripe, facturacion, auditoria, salud operativa, backups, crons, reportes y backoffice interno.

En este modelo, BetterP deja de ser solamente la aplicacion de administracion de condominios, coliving y rentas. BetterP pasa a ser la marca y plataforma global. La solucion actual se presenta comercialmente como `Renta Facil`, y `Vende Facil` se incorpora como una segunda solucion enfocada en PIM, inventario, conectores, ventas y envios.

## Modelo de hosts productivos

La regla operativa queda asi:

- `https://betterp.net`: landing principal del negocio BetterP, landings de soluciones, Renta Facil, login, registro y backoffice global.
- `https://betterp.net/soluciones/{solucion}`: landing comercial de cada solucion dentro de BetterP.
- `https://betterp.net/soluciones/{solucion}/entrar`: punto de entrada autenticado que resuelve la capa activa y decide si abre una solucion interna o externa.
- `https://tiendafacil.betterp.net`: aplicacion externa/hibrida de Tienda Facil.
- `https://vendefacil.betterp.net`: aplicacion externa/hibrida de Vende Facil.
- `https://app.betterp.net`: host legacy en cuarentena. No debe usarse para links nuevos, emails, smoke tests ni `FRONTEND_BASE_URL`; si aparece en una URL heredada, se normaliza a `https://betterp.net`.

Este modelo evita mezclar marca, solucion y backoffice. Renta Facil sigue viviendo dentro de BetterP por ser la primera solucion; cuando se separe a un host propio debe hacerse como cambio explicito de arquitectura, no como fallback accidental.

## Situacion actual

### BetterP / Renta Facil

- Tiene base multi-cliente con `CapaNegocio`, membresias, roles y selector de capa activa.
- Tiene billing SaaS con `PlanSaaS`, `SuscripcionCapa`, cambios de plan, Stripe test/live, prorrateo y senales de salud.
- Tiene facturacion fiscal operativa ligada a la capa de negocio.
- Tiene backoffice interno, auditoria, salud, backups, smoke productivo, crons y reportes operativos.
- Los modulos actuales de clientes, espacios, CxC, CxP, conciliacion, cobranza y portal cliente forman la primera solucion vertical: `Renta Facil`.

### Vende Facil

Repositorio origen: `pepernillo/pim-system-v3`  
Rama origen: `codex/render-production-readiness`

Estado observado:

- Backend Django con apps de dominio: productos, inventario, conectores, catalogos, ventas y envios.
- Frontend Next.js con stack compatible con BetterP.
- Tiene health checks y configuracion de storage tipo S3/R2.
- Tiene modelo propio de facturacion en ventas, pero todavia no esta conectado a la infraestructura fiscal/billing madura de BetterP.
- Esta aproximadamente en etapa MVP intermedia y es buen candidato para integrarse como solucion, no como plataforma separada.

## Principio rector

No duplicar plataforma.

Vende Facil debe aportar dominio de negocio: catalogo, productos, inventario, conectores, ordenes, ventas y envios. BetterP debe seguir siendo el sistema de identidad, permisos, suscripcion, cobro, facturacion fiscal, monitoreo, auditoria, backups y operacion.

## Arquitectura objetivo

```text
BetterP Platform
├── Identidad y acceso
│   ├── Usuarios
│   ├── Membresias
│   ├── Roles
│   └── CapaNegocio
├── Operacion SaaS
│   ├── Planes
│   ├── Suscripciones
│   ├── Stripe
│   ├── Facturacion
│   ├── Auditoria
│   ├── Salud
│   ├── Backups
│   └── Crons
└── Soluciones
    ├── Renta Facil
    │   ├── Clientes
    │   ├── Espacios
    │   ├── CxC / CxP
    │   ├── Conciliacion
    │   ├── Cobranza
    │   └── Portal cliente
    └── Vende Facil
        ├── Productos / PIM
        ├── Inventario
        ├── Conectores
        ├── Ordenes
        ├── Envios
        └── Facturacion via BetterP
```

## Modelo recomendado

### Solucion

Agregar un catalogo interno de soluciones:

- `renta_facil`: solucion activa principal, construida sobre los modulos actuales.
- `vende_facil`: solucion en incubacion/beta, inicialmente conectada desde el repo origen y luego migrada por modulos.

Campos sugeridos:

- `clave`
- `nombre`
- `descripcion`
- `estatus`: `ACTIVA`, `BETA`, `INCUBACION`, `PAUSADA`
- `tipo`: `INTERNA`, `EXTERNA`, `HIBRIDA`
- `repo_origen`
- `branch_origen`
- `url_app`
- `url_api`
- `metadata`
- `fecha_creacion`
- `fecha_actualizacion`

### Planes por solucion

El siguiente paso tecnico debe asociar los planes SaaS a una solucion sin romper compatibilidad:

- Agregar `solution` nullable a `PlanSaaS`.
- Migrar los planes existentes a `renta_facil`.
- Permitir crear planes futuros para `vende_facil`.
- Mantener `SuscripcionCapa` inicialmente como esta para no romper produccion.

Despues, cuando haya clientes con mas de una solucion contratada, evolucionar a un modelo `SuscripcionSolucion` o equivalente.

### Entitlements

Las capacidades deben quedar namespaced por solucion:

- `renta_facil.clientes`
- `renta_facil.espacios`
- `renta_facil.cobranza`
- `vende_facil.productos`
- `vende_facil.inventario`
- `vende_facil.conectores`
- `vende_facil.ordenes`
- `vende_facil.envios`
- `platform.facturacion`
- `platform.auditoria`
- `platform.backups`

Esto evita que un permiso o modulo de Renta Facil se mezcle accidentalmente con Vende Facil.

## Integracion de Vende Facil

### Fase 1: inventario y contrato de plataforma

Antes de mover codigo:

1. Listar modelos, endpoints, variables y crons de `pim-system-v3`.
2. Separar dominio de plataforma.
3. Marcar que piezas se conservan, cuales se eliminan y cuales se reemplazan por BetterP.
4. Definir contrato minimo entre Vende Facil y BetterP:
   - capa activa
   - usuario autenticado
   - permisos
   - plan activo
   - facturacion fiscal
   - auditoria
   - salud

### Fase 2: registro en BetterP

Crear en BetterP el catalogo de soluciones y registrar:

- `Renta Facil`
- `Vende Facil`

Exponerlo en backoffice para que soporte pueda ver:

- soluciones disponibles
- estatus
- planes vinculados
- clientes usando cada solucion
- riesgos operativos por solucion

### Fase 3: rebranding controlado

Cambiar la presentacion comercial sin renombrar todo el codigo de golpe:

- Marca global: BetterP.
- Solucion actual: Renta Facil.
- Segunda solucion: Vende Facil.

El codigo puede seguir usando nombres internos existentes mientras se introduce una capa de presentacion y configuracion comercial.

### Fase 4: Vende Facil como modulo o servicio

Hay dos caminos posibles:

#### Camino recomendado: integracion modular progresiva

Migrar apps de dominio de Vende Facil hacia el backend BetterP de forma gradual:

- productos
- inventario
- conectores
- ventas
- envios

Cada modulo debe adaptarse a `CapaNegocio`, auditoria, permisos y facturacion de BetterP.

Ventaja: una sola plataforma operativa, una sola facturacion, un solo backoffice.

#### Camino temporal: servicio separado conectado

Mantener Vende Facil como app/API separada por un periodo corto, pero usando BetterP como fuente de verdad para:

- login
- suscripciones
- facturacion
- clientes SaaS
- salud
- soporte

Ventaja: menor riesgo inicial. Desventaja: mas complejidad operativa si se mantiene mucho tiempo.

## Facturacion

La facturacion de Vende Facil no debe duplicar PAC, CSD, timbrado, configuracion fiscal ni reportes.

Modelo recomendado:

- Vende Facil genera eventos de venta u orden.
- BetterP Facturacion emite, registra y monitorea el CFDI.
- El modulo de Vende Facil conserva referencias operativas: orden, marketplace, canal, cliente, envio.
- El modulo fiscal queda centralizado en BetterP.

## Stripe y planes

BetterP debe seguir siendo la unica fuente para:

- checkout
- customer de Stripe
- subscription de Stripe
- cambios de plan
- prorrateo
- reembolsos
- limites
- estado comercial

Vende Facil debe consumir el resultado:

- plan activo
- capacidades habilitadas
- limites de uso
- estatus de suscripcion

## Backoffice master

El backoffice debe evolucionar a una vista master:

- Salud global de plataforma.
- Salud por solucion.
- Clientes por solucion.
- Ingresos por solucion.
- Riesgo por cliente y solucion.
- Jobs/crons por solucion.
- Auditoria por solucion.
- Accion siguiente asignable.

## Orden de ejecucion recomendado

1. Documentar arquitectura multi-solucion.
2. Crear modelo/catalogo `Solucion`.
3. Registrar `Renta Facil` y `Vende Facil`.
4. Asociar `PlanSaaS` a solucion, migrando planes existentes a `Renta Facil`.
5. Exponer endpoint backoffice de soluciones.
6. Agregar vista compacta de soluciones en backoffice.
7. Rebrand visual controlado: BetterP como plataforma, Renta Facil como solucion.
8. Crear inventario tecnico completo de Vende Facil.
9. Definir mapeo de modelos Vende Facil -> BetterP.
10. Integrar primero autenticacion, capa activa, auditoria y permisos.
11. Reemplazar facturacion propia de Vende Facil por servicio de facturacion BetterP.
12. Crear planes Stripe de Vende Facil desde BetterP.
13. Agregar salud, crons y reportes operativos de Vende Facil.
14. Migrar modulos de dominio por bloque: productos, inventario, conectores, ventas, envios.

## Primer bloque ejecutable

El primer bloque de codigo debe ser pequeno y reversible:

1. Agregar modelo `Solucion`.
2. Agregar migracion de datos con `renta_facil` y `vende_facil`.
3. Agregar campo nullable `solution` en `PlanSaaS`.
4. Asociar los planes existentes a `renta_facil`.
5. Agregar pruebas de que los planes actuales siguen funcionando.
6. Exponer en backoffice una lectura simple de soluciones.

Este bloque no debe cambiar flujos de compra, login, facturacion ni operacion actual.

## Riesgos principales

- Renombrar codigo masivamente antes de tener un catalogo de soluciones.
- Duplicar billing o facturacion fiscal en Vende Facil.
- Permitir que Vende Facil tenga identidad, tenants o permisos paralelos.
- Mezclar permisos sin namespace por solucion.
- Migrar todo el repo de Vende Facil de una sola vez.
- Cambiar modelos de suscripcion en produccion antes de tener compatibilidad hacia atras.

## Criterio de avance

La integracion se considera bien encaminada cuando:

- Backoffice muestra `Renta Facil` y `Vende Facil` como soluciones.
- Los planes existentes siguen operando sin cambios para clientes actuales.
- Vende Facil puede leerse como solucion en incubacion desde BetterP.
- La facturacion futura de Vende Facil apunta a BetterP, no a un modulo fiscal duplicado.
- Hay un mapeo claro de modelos y endpoints antes de migrar dominio.
