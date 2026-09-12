# Acta de aceptación BetterP Commerce — BC-7

- Fecha de evaluación: 2026-08-05 (America/Mexico_City)
- Evidencia productiva consultada: 2026-08-06 05:15 UTC
- Rama de autoridad: `main`
- Estado: aprobado para operación controlada con excepción temporal de seguridad aceptada

## 1. Decisión ejecutiva

BetterP Commerce cumple funcionalmente la ruta BC-1 a BC-6 y está listo para operación comercial
controlada. No se identificó un bloqueo funcional en planes, capacidades, alta, cobro, acceso,
backoffice, salud o automatizaciones.

El propietario decidió continuar temporalmente sin rotar la contraseña de `root` del servidor cuyo
valor fue expuesto durante una operación anterior. La excepción se acepta de forma explícita para
cerrar BC-7, sin considerarla resuelta: la autenticación SSH por contraseña está deshabilitada,
`root` solo acepta llave pública y la llave operativa permanente fue validada. La rotación conserva
prioridad P0 y es necesaria para invalidar por completo la credencial conocida.

Este corte no ejecutó cobros, mensajes, publicaciones, cambios en marketplaces ni escrituras en
proveedores externos.

## 2. Autoridad de código y despliegue

| Componente | Autoridad verificada | Evidencia productiva |
|---|---|---|
| BetterP frontend y backend | `431367e7d374452efa4f81a2c6437d355773f884` | Release `20260806T045841Z-betterp-431367e7d374` |
| BetterP Commerce frontend | `dc19aea` | Retorno vigente a `https://betterp.net/backoffice` |
| BetterP Commerce backend y workers | `aa86211c32ba09224e3dfe4ed21a517d1b7671bb` | API y tres workers activos en Vultr |
| Contrato de capacidades | `betterp.commerce.entitlements.v1`, versión `1` | BetterP firma; Commerce valida matriz, versión y hash |

Vultr es la autoridad operativa visible. La API pública de BetterP respondió `200` y publicó
`platform=vultr`, `runtime=docker`, `render=false`, el commit y el identificador de release exactos.
La API de BetterP Commerce respondió `200` en su endpoint de salud.

## 3. Matriz final de planes y capacidades

Leyenda: `Sí` incluido; `—` no incluido.

| Capacidad | Micro | Starter | Growth | Scale |
|---|:---:|:---:|:---:|:---:|
| Producto maestro | Sí | Sí | Sí | Sí |
| Inventario | Sí | Sí | Sí | Sí |
| Catálogos comerciales | Sí | Sí | Sí | Sí |
| Reglas de precio por canal | — | — | Sí | Sí |
| POS, QR y caja | Sí | Sí | Sí | Sí |
| Tienda online | Sí | Sí | Sí | Sí |
| Clientes | — | Sí | Sí | Sí |
| Ventas y pedidos | Sí | Sí | Sí | Sí |
| Pagos | Sí | Sí | Sí | Sí |
| Envíos | — | Sí | Sí | Sí |
| Facturación | — | Sí | Sí | Sí |
| Reportes de ventas | Sí | Sí | Sí | Sí |
| Marketplaces | — | — | Sí | Sí |
| Venta B2B | — | — | Sí | Sí |
| Normalización asistida | — | — | Sí | Sí |
| Sincronización masiva | — | — | Sí | Sí |
| Dominio personalizado | — | — | — | Sí |
| API y webhooks | — | — | — | Sí |
| Soporte prioritario | — | — | — | Sí |

| Plan | Mensual MXN | Anual MXN | Usuarios | Tiendas | Productos | Stripe LIVE | Stripe TEST |
|---|---:|---:|---:|---:|---:|:---:|:---:|
| Micro | $200 | $2,000 | 1 | 1 | 20 | 2/2 precios | 2/2 precios |
| Starter | $1,499 | $14,990 | 3 | 1 | 250 | 2/2 precios | 2/2 precios |
| Growth | $3,999 | $39,990 | 10 | 3 | 2,500 | 2/2 precios | 2/2 precios |
| Scale | $7,999 | $79,990 | 30 | 10 | 25,000 | 2/2 precios | 2/2 precios |

Los cuatro planes están activos; Starter es el plan predeterminado. La configuración productiva
regresó a `LIVE`, con clave y secreto de webhook presentes sin exponer sus valores. Existen dos
suscripciones Commerce activas en la copia productiva consultada.

## 4. Inventario de vistas

### Activas

| Superficie | Vistas o recorridos aceptados |
|---|---|
| Sitio y alta BetterP | Registro, oferta BetterP Commerce, selección de plan y acceso |
| Backoffice | Clientes, Ventas, Soluciones, Planes, Stripe y Salud |
| BetterP Commerce | Dashboard, onboarding, tienda, productos, catálogos, POS/Mi Tiendita, conexiones e-commerce, ventas/pedidos, logística, clientes, pagos y configuración |
| Comprador | Tienda pública, checkout, portal de comprador, recibo y facturación |

### Históricas

| Superficie | Tratamiento aceptado |
|---|---|
| Vende Fácil | Solución `PAUSADA`, visible como `Vende Facil (legacy)` y solo como historial |
| Suscripciones y eventos heredados | Conservados para auditoría; no permiten altas, cambios de plan, sincronizaciones ni adopciones nuevas |
| Alias `vende_facil.*` y `tienda_facil.*` | Compatibilidad interna; la autoridad comercial visible es `commerce.*` |

La base productiva reporta solo dos soluciones activas: Renta Fácil y BetterP Commerce. Vende Fácil
permanece pausada como evidencia histórica.

## 5. Alta, cobro y Stripe

BC-5 demostró en Stripe TEST el recorrido controlado completo:

1. checkout aislado;
2. webhook firmado;
3. procesamiento idempotente del evento repetido;
4. suscripción única y capacidades exactas;
5. acceso a BetterP Commerce;
6. factura y portal;
7. cancelación auditable;
8. regreso de la configuración a Stripe LIVE.

La evidencia sanitizada más reciente registra `checkout.session.created`,
`checkout.session.completed`, `checkout.session.confirmed` y
`customer.subscription.updated` como `PROCESADO`, sin detalle de error. No se conservan en esta
acta identificadores de cliente, suscripción, precio, factura o secretos.

## 6. Infraestructura, salud y automatizaciones

Servicios observados activos en Vultr:

- BetterP API saludable, scheduler y background worker;
- BetterP Commerce API saludable, marketplace worker, webhook worker y outbox worker;
- Caddy, PostgreSQL y Redis; PostgreSQL y Redis saludables.

Manifiesto SaaS activo y con exclusión mutua mediante `flock`:

| Automatización | Programación UTC | Última evidencia | Resultado |
|---|---|---|---|
| Expiración de trials | 09:20 diario | 2026-08-06 02:22:30 | `SUCCESS`, 136 ms |
| Cambios de plan al renovar | 09:40 diario | 2026-08-06 02:22:34 | `SUCCESS`, 137 ms |
| Reporte post go-live sin correo | 14:30 diario | 2026-08-06 02:22:38 | `SUCCESS`, 134 ms |

No forman parte del scheduler de cierre Render, keepalive, marketing, cobranza, inbox, Renta Fácil
ni Vende Fácil.

## 7. Pruebas y smokes

| Evidencia | Resultado |
|---|---|
| Contrato de cuatro planes y capacidades | Verde |
| Aislamiento entre soluciones y cuentas | Verde |
| Retiro operativo de Vende Fácil | Verde |
| Checkout, webhook e idempotencia Stripe TEST | Verde |
| Plan, acceso, factura, portal y cancelación | Verde |
| Salud y clasificación HTTP | Verde |
| Smokes escritorio: Planes, Clientes, Ventas, Salud y Commerce | Verde |
| Smokes móvil 390 px: Registro, Planes y Commerce | Verde, sin desbordamiento horizontal |
| Smoke público actual: BetterP Salud, Commerce API y dashboard | `200` |
| Telemetría desde release BC-6 | 7 Web Vitals `good`; 0 `poor` en rutas objetivo; 0 errores frontend; 0 respuestas 5xx observadas |

## 8. Evaluación de criterios BC-7

| Criterio | Resultado |
|---|---|
| BetterP Commerce es la única solución comercial de comercio e inventario | Cumple |
| Cuatro planes activos con precios, capacidades y accesos coherentes | Cumple |
| Clientes, ventas, suscripciones y salud usan la misma clasificación activa/histórica | Cumple |
| Stripe LIVE listo y recorrido demostrado de forma controlada | Cumple |
| Vultr es autoridad operativa y tiene evidencia vigente | Cumple |
| No existe bloqueo funcional crítico | Cumple |
| No existe bloqueo crítico de seguridad sin excepción | Excepción temporal aceptada: rotación de contraseña `root` diferida como P0; SSH por contraseña deshabilitado |
| Pendientes no críticos están explícitamente diferidos | Cumple |

## 9. Registro diferido priorizado

Estos puntos no bloquean la aceptación funcional y no se abrirán dentro de BC-7:

| Prioridad | Pendiente | Condición de entrada |
|---|---|---|
| P0 | Rotar la contraseña de `root` expuesta y validar nuevamente el acceso por llave | Primera ventana operativa segura disponible |
| P1 | Aceptación guiada con el primer cliente real y seguimiento día 1/día 7 | Primer cliente comercial |
| P1 | Implementación funcional completa de Amazon y Walmart | Ruta independiente por proveedor |
| P1 | Eliminación definitiva de imágenes, infraestructura e históricos de Vende Fácil | Ventana de retención aprobada |
| P2 | Automatizaciones avanzadas de marketing, CRM e inbox | Ruta posterior de plataforma |
| P2 | Limpieza global de terminología heredada en documentación interna | Mantenimiento documental |
| P2 | Calidad producto por producto y estados individuales de publicaciones | Operación del usuario, no madurez SaaS |

## 10. Firma de aceptación

Resultado: **APROBADO PARA OPERACIÓN COMERCIAL CONTROLADA CON EXCEPCIÓN TEMPORAL DE SEGURIDAD**.

Aceptación del propietario: el 2026-08-05 indicó continuar con el cierre de BC-7 manteniendo por el
momento la contraseña actual. La excepción no habilita autenticación SSH por contraseña y no cambia
la configuración, compuertas ni autoridad operativa de los servicios.

BC-7 y la ruta BC-0 a BC-7 quedan formalmente cerrados. La rotación futura se registrará como cierre
del pendiente P0 y no requiere reabrir la aceptación funcional de BetterP Commerce. Tampoco se
requiere un nuevo despliegue de aplicaciones ni una escritura en Stripe o marketplaces para publicar
esta acta.
