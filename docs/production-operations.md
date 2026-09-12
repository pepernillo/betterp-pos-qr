# Operacion de produccion BetterP

Este documento resume el flujo minimo para deploys, migraciones y verificacion posterior.

Para activar el primer cliente real, usar tambien
[`first-customer-go-live-checklist.md`](first-customer-go-live-checklist.md).
Para incidentes, soporte y operacion repetible, usar
[`operational-runbooks.md`](operational-runbooks.md).
Para revision legal/comercial antes de venta abierta, usar
[`legal-review-checklist.md`](legal-review-checklist.md).

## Principios

- Trabajar sobre `main`.
- No ejecutar migraciones automáticamente al arrancar los contenedores.
- Mantener `AUTO_MIGRATE_ON_STARTUP` apagado salvo una operacion controlada.
- Ejecutar migraciones con un usuario de base de datos que tenga permisos sobre `django_migrations`.
- Correr smoke despues de cada deploy.
- Si falla health, OpenAPI o login, detener cambios funcionales y atender produccion primero.

## Deploy backend

1. Confirmar que la rama local esta en `main` y limpia.
2. Ejecutar validaciones backend relevantes:

```powershell
python -m py_compile backend\core\wsgi.py backend\core\startup.py
.venv\Scripts\python.exe backend\manage.py test --keepdb
```

3. Ejecutar `git diff --check`.
4. Commit y push a `main`.
5. Preparar el release sellado y ejecutarlo con `ops/vultr/deploy_release.sh`.
   La API debe arrancar con:

```text
gunicorn core.wsgi:application
```

6. Confirmar que health ya publica el contrato del commit desplegado:

```powershell
$env:BETTERP_DEPLOY_COMMIT="$(git rev-parse HEAD)"
$env:BETTERP_SMOKE_REQUIRE_DEPLOY_COMMIT="1"
.venv\Scripts\python.exe scripts\wait_backend_contract.py --timeout 600 --interval 15
```

7. Confirmar que el servicio web no intenta migrar durante el arranque. En
   produccion `AUTO_MIGRATE_ON_STARTUP` debe permanecer apagado salvo operacion
   puntual y documentada.

### Verificación del release mediante GitHub Actions

El despliegue se ejecuta de forma explícita en Vultr con el contrato versionado
en `ops/vultr/`. GitHub Actions no despliega ni llama a Render.

El workflow `Backend Release Verification`:

- se ejecuta manualmente después de completar el release de Vultr;
- recibe el SHA completo ya desplegado;
- espera que `health` publique ese mismo commit;
- ejecuta `scripts\smoke_mvp.py` y conserva el reporte como artifact.

Para que backoffice Salud conserve evidencia historica de smoke/deploy:

1. Configurar en los secretos protegidos de Vultr `SMOKE_REPORT_TOKEN`.
2. Configurar en GitHub Actions `BETTERP_SMOKE_REPORT_TOKEN` con el mismo valor.
3. Confirmar que el smoke publique en `/api/billing/operational/smoke-report/`.

Salud muestra `production_smoke` como evidencia requerida cada 30 horas y
`backend_release_verification` como evidencia opcional de release reciente.
En ejecuciones manuales de `Production Smoke` y `Backend Release Verification`, activar
`require_report_publish` para que el workflow falle si no logro publicar la
evidencia en backoffice.

### Recuperacion cuando produccion sirve una version anterior

Si `scripts\smoke_mvp.py` falla solo en `api health` con un mensaje de features
faltantes o `scripts\wait_backend_contract.py` nunca encuentra el commit
esperado, tratarlo como problema de despliegue antes de tocar producto.

Checklist:

1. Confirmar que GitHub tiene el commit esperado en `main`.
2. Confirmar en el estado sellado de `/opt/betterp/state/releases` que el release
   terminó para ese commit.
3. Confirmar que API, scheduler y background worker usan la misma imagen.
4. Confirmar que `BETTERP_GIT_COMMIT` y `BETTERP_DEPLOY_ID` están presentes en
   los contenedores sin imprimir sus demás variables.
5. Ejecutar `ops/vultr/release_preflight.sh`.
6. Ejecutar manualmente `Backend Release Verification` con el SHA desplegado.
7. Repetir:

```powershell
$env:BETTERP_DEPLOY_COMMIT="$(git rev-parse HEAD)"
$env:BETTERP_SMOKE_REQUIRE_DEPLOY_COMMIT="1"
.venv\Scripts\python.exe scripts\wait_backend_contract.py --timeout 900 --interval 15
.venv\Scripts\python.exe scripts\smoke_mvp.py
```

No activar nuevos crons ni clientes reales mientras `health` no publique el
contrato esperado del backend.

## Deploy frontend

1. Confirmar que la rama local esta en `main` y limpia.
2. Ejecutar build local:

```powershell
cd frontend
npm run build
```

3. Ejecutar `git diff --check` desde la raiz del repo.
4. Commit y push a `main`.
5. Verificar que Cloudflare Pages publique el commit en produccion.
6. Abrir `https://betterp.net/login` y confirmar que carga HTML sin error.

Si Cloudflare falla con error interno despues de compilar y subir assets, revisar
si el reintento publica el mismo commit. No mezclar nuevos cambios hasta saber si
fallo build, worker publish o red global.

## Migraciones

Las migraciones deben correrse como una operacion explicita y controlada.

1. Revisar migraciones pendientes:

```powershell
.venv\Scripts\python.exe backend\manage.py showmigrations
```

2. Respaldar o confirmar punto de recuperacion de Neon.
3. Ejecutar `migrate` usando credenciales con permisos suficientes:

```powershell
.venv\Scripts\python.exe backend\manage.py migrate
```

4. Confirmar health y smoke antes de continuar con cambios de producto.

## Backups por capa

El MVP cuenta con un export operativo por capa en Excel. Incluye entidades, clientes,
espacios, asignaciones, CxC, pagos CxC, CxP, pagos CxP, comprobantes, cuentas
bancarias, cargas de conciliacion, transacciones y eventos financieros.

Desde la app/API, un usuario administrador puede descargar la capa activa:

```http
GET /api/empresas/capas/backup/exportar/
```

## Auditoria y permisos

La bitacora operativa agrupa eventos criticos y senales de seguridad para la
capa activa.

```http
GET /api/accounts/auditoria/resumen/
GET /api/accounts/auditoria/
```

El resumen incluye `senales_seguridad` con denegaciones de permisos, bloqueos
por plan, cambios de acceso, rutas con friccion, permisos mas denegados, nivel
de riesgo y foco recomendado. Usar esta vista para revisar roles antes de
ampliar permisos o diagnosticar errores de plan.

Criterio operativo:

- `BAJO`: no hay friccion relevante en la ventana revisada.
- `MEDIO`: hay denegaciones, bloqueos de plan o varios cambios de acceso.
- `ALTO`: hay denegaciones repetidas o intento contra backoffice interno.

`Backoffice > Salud` agrega estas senales a nivel plataforma en la tarjeta
`Auditoria`: denegaciones de permisos en 24h/7d, bloqueos por plan, cambios de
acceso, intentos contra backoffice interno, permisos/rutas/roles con mas
friccion y ultimas denegaciones. Si la tarjeta marca `ALTO`, revisar roles y
rutas antes de ampliar permisos o activar nuevos usuarios.

La lista principal de alertas de `Backoffice > Salud` debe mantenerse corta y
accionable. Solo debe mostrar bloqueos criticos o avisos que el operador pueda
resolver: suscripciones vencidas, capacidad de clientes, integraciones
incompletas, errores de proveedor o fallas que impidan cobrar, facturar,
respaldar o enviar comunicaciones. Las senales tecnicas de diagnostico quedan en
las tarjetas y detalles del tablero para no bombardear al cliente con ruido.

## Estado de cuenta SaaS

El backoffice de Clientes SaaS muestra salud operativa y estado de cuenta por
cliente: MRR/ARR estimado, cargo base del periodo, extras estimados, total del
periodo, renovacion, friccion de acceso y accion recomendada.

```http
GET /api/billing/admin/clientes/
GET /api/billing/admin/consumo/{capa_id}/estado-cuenta/
```

La lista usa `account_status` por cliente y `estado_cuenta_clientes` como
resumen global. Si un cliente aparece en `ATENCION` o `CRITICO`, revisar primero
la accion recomendada, luego consumo, backups, plan y permisos antes de ampliar
capacidad o liberar funciones.

## Conciliacion asistida

Las sugerencias de conciliacion bancaria incluyen score, banda de confianza,
diferencia de monto y accion recomendada.

```http
GET /api/finanzas/conciliacion/sugerencias/
```

La respuesta incluye `summary` con conteos por CxC/CxP, bandas de confianza,
estado de readiness (`LISTA`, `REVISAR`, `NO_APLICAR_DIRECTO`), monto por cola,
riesgo operativo, foco recomendado y `decision_queue` con la accion siguiente
por cola. Cada sugerencia incluye `decision` con posicion de cola, accion
operativa, detalle, checklist y bloqueadores. La pantalla de conciliacion usa
ese resumen para ordenar el trabajo: primero aplicar sugerencias listas, despues
revisar las mixtas y dejar las de baja confianza para resolucion manual.

Criterio operativo:

- `ALTA`: se puede aplicar si la referencia y el cliente/proveedor corresponden.
- `MEDIA`: revisar referencia, fecha y saldo antes de aplicar.
- `BAJA`: usar solo como pista y buscar manualmente.
- `decision.action=APLICAR`: aplicar desde la tarjeta con nota sugerida.
- `decision.action=REVISAR_Y_APLICAR`: abrir detalle, confirmar soporte y
  aplicar con nota.
- `decision.action=RESOLVER_MANUAL`: no aplicar directo; buscar manualmente o
  marcar el movimiento como no identificado.

## Cambios de plan Stripe

La app permite previsualizar upgrades, downgrades y cambios de ciclo antes de
confirmarlos contra Stripe.

```http
POST /api/billing/suscripcion/cambio-plan/preview/
POST /api/billing/suscripcion/cambio-plan/
GET /api/billing/suscripcion/cambios-plan/
```

Criterio operativo:

- El preview devuelve prorrateo estimado, saldo a favor, modo recomendado y
  advertencias de configuracion.
- Un cambio inmediato requiere suscripcion activa/past due, Price ID del modo
  Stripe activo, secret key configurada y `stripe_subscription_id`.
- En modo Stripe `LIVE`, un cambio inmediato exige confirmacion explicita
  `STRIPE_LIVE_OK` desde Backoffice. Sin esa confirmacion debe programarse al
  renovar o validarse primero en `TEST`.
- Los downgrades o saldos a favor pueden programarse al renovar o quedar como
  solicitud de reembolso para revision interna.
- No se permite abrir un segundo cambio mientras exista uno en proceso,
  pendiente de renovacion o con reembolso solicitado.
- El historial devuelve `revision` con estado operativo, accion recomendada,
  referencia Stripe principal y si bloquea nuevos cambios.
- Cuando Stripe confirma `refund.succeeded`, la revision de reembolso se cierra
  como aplicada y deja de bloquear nuevos cambios de plan.
- Los cambios `PENDIENTE_RENOVACION` se aplican con un cron diario al llegar la
  fecha de cierre del periodo. El proceso usa prorrateo `none`, actualiza Stripe,
  sincroniza la suscripcion local y registra auditoria/evento operativo.

Comando activo en el scheduler de Vultr:

```powershell
python manage.py apply_pending_plan_changes --generated-by "vultr-scheduler"
```

Prueba sin modificar Stripe ni base:

```powershell
python manage.py apply_pending_plan_changes --dry-run --generated-by "vultr-scheduler-preview"
```

La salud operativa monitorea esta corrida como `scheduled_plan_changes`.

## Stripe test mode E2E

Antes de probar pagos live, validar en modo `TEST`:

1. Backoffice > Planes debe tener Price IDs test para mensual/anual.
2. Backoffice > Pagos debe estar en `TEST`.
3. Ejecutar checkout test con tarjeta Stripe de prueba.
4. Confirmar que `checkout.session.created` y `checkout.session.confirmed`
   quedan en eventos de billing.
5. Confirmar que la suscripcion queda `ACTIVA`, con customer y subscription de
   Stripe test.
6. Probar upgrade/downgrade test y revisar `CambioPlanSaaS`.

Prueba automatizada local sin llamar a Stripe real:

```powershell
.venv\Scripts\python.exe backend\manage.py test billing.tests.BillingStripeCheckoutE2ETests --keepdb
```

## Performance operativa

El dashboard global de CxC materializa cargos del alcance permitido en una sola
pasada antes de listar. Evitar reintroducir loops por entidad en `GET
/api/finanzas/cxc/`, porque esa ruta se valida en smoke y suele ser una de las
primeras en mostrar degradacion de tiempo de respuesta.

Las reglas de recargo del dashboard CxC se resuelven en lote por entidades y
capa. Evitar volver a resolver reglas por fila o por entidad dentro del ciclo de
serializacion.

En conciliacion, los resumenes de auto-match de transacciones deben agregarse en
una sola consulta. El listado de eventos solo debe prefetchar datos ligeros de
partidas; los pagos vinculados se cargan en el detalle del evento, no en el
dashboard.

Para una corrida operativa manual o programada, usar el comando Django:

```powershell
.venv\Scripts\python.exe backend\manage.py export_capa_backup --capa-id 123 --output-dir C:\betterp-backups
```

Para generar todas las capas activas:

```powershell
.venv\Scripts\python.exe backend\manage.py export_capa_backup --all-active --output-dir C:\betterp-backups
```

Para subir el backup a R2 privado y registrar historial:

```powershell
.venv\Scripts\python.exe backend\manage.py export_capa_backup --all-active --upload-r2 --generated-by "operacion"
```

Variables disponibles:

- `R2_BACKUP_BUCKET_NAME`: bucket destino para backups. Si no existe, usa `AWS_STORAGE_BUCKET_NAME`.
- `R2_BACKUP_PREFIX`: prefijo privado, default `backups`.
- `BACKUP_RETENTION_DAYS`: dias de retencion para backups R2, default `180`.

Puedes usar el bucket actual de R2 con prefijo `backups/`. Un bucket separado es
mejor para aislamiento y politicas de retencion, pero no es obligatorio para
empezar.

Backups automaticos por plan:

- `starter` y planes basicos: dia 1 de cada mes.
- `growth` y planes medios: dias 1 y 16 de cada mes.
- `scale`: una vez por semana, evitando duplicados si el cron corre diario.

Este respaldo por capa no forma parte del manifiesto mínimo de BetterP Commerce
ni queda programado automáticamente en BC-4. Si se activa posteriormente, debe
incorporarse mediante un corte operativo explícito y no como expectativa oculta.

Ejecución manual disponible:

```powershell
python manage.py run_scheduled_capa_backups --generated-by "manual-operator"
```

El comando decide que capas deben respaldarse segun fecha, plan y ultimo backup
automatico. Tambien elimina del historial y de R2 los backups vencidos por
retencion. Para probar sin crear ni borrar:

```powershell
.venv\Scripts\python.exe backend\manage.py run_scheduled_capa_backups --dry-run
```

## Cobranza automatica

Las plantillas y reglas de cobranza viven en `Cobranza`. Los envios automaticos
por WhatsApp usan plantillas Meta aprobadas; si una plantilla WhatsApp no esta
en estado `APROBADA`, el comando registra error/omision y no debe enviar texto
libre fuera de la ventana de servicio.

Comando operativo:

```powershell
.venv\Scripts\python.exe backend\manage.py procesar_recordatorios
```

Opciones seguras:

```powershell
.venv\Scripts\python.exe backend\manage.py procesar_recordatorios --dry-run
.venv\Scripts\python.exe backend\manage.py procesar_recordatorios --fecha 2026-05-21 --dry-run
.venv\Scripts\python.exe backend\manage.py procesar_recordatorios --capa-id 123 --dry-run
.venv\Scripts\python.exe backend\manage.py procesar_recordatorios --max-envios 25
.venv\Scripts\python.exe backend\manage.py procesar_recordatorios --max-envios 500 --max-envios-por-capa 100
.venv\Scripts\python.exe backend\manage.py procesar_recordatorios --capa-id 123 --dry-run --require-whatsapp-ready
```

Por defecto, los envios reales quedan protegidos por ventana operativa:

```text
PAYMENT_REMINDER_SEND_TIMEZONE=America/Mexico_City
PAYMENT_REMINDER_SEND_WINDOW_START=10:00
PAYMENT_REMINDER_SEND_WINDOW_END=18:00
PAYMENT_REMINDER_BLOCKED_WEEKDAYS=6
PAYMENT_REMINDER_ENFORCE_SEND_WINDOW=true
```

`PAYMENT_REMINDER_BLOCKED_WEEKDAYS` acepta `0` a `6`
(`0=lunes`, `6=domingo`) o nombres separados por coma. Si el cron corre fuera
de esa ventana, registra la corrida en `CronRunLog` como omitida por ventana
operativa y no envia mensajes. El `--dry-run` siempre se permite porque no
contacta clientes. Para una excepcion humana y documentada existe
`--ignore-send-window`, pero no debe usarse en la corrida programada.

Para una zona de prueba con entrega real solo a numeros controlados, configura
una allowlist en el backend:

```text
OUTBOUND_WHATSAPP_ALLOWED_NUMBERS=525551087058
```

Cuando la allowlist tiene valores, cualquier WhatsApp a otro destino se registra
como `OMITIDO` con proveedor `SAFETY_ALLOWLIST` y no se llama a Meta. Si se
necesita pausa total, usar `DISABLE_OUTBOUND_INTEGRATIONS=true` en vez de la
allowlist; eso simula WhatsApp/email y no envia a ningun proveedor real.

Para que las plantillas queden gobernadas por BetterP y los clientes solo puedan
usar mensajes aprobados:

```text
LOCK_TENANT_MESSAGE_TEMPLATES=true
```

Con esta bandera activa, un admin de cliente no puede crear, editar ni borrar
plantillas; tampoco puede enviar campanas manuales de texto libre. Debe elegir
una plantilla existente y no modificar asunto, cuerpo ni adjuntos. Los cambios
de texto deben pasar por soporte/operacion BetterP. Si la plantilla tiene
`whatsapp_template_name` y estado `APROBADA`, tanto los envios manuales como
los automaticos usan esa plantilla Meta al llamar WhatsApp Cloud API.

La cobranza automática no forma parte del manifiesto mínimo de BetterP Commerce
y permanece sin programación productiva en BC-4. Su eventual activación exige
un corte propio, plantillas Meta aprobadas y canal WhatsApp oficial activo.

Ejecución manual disponible:

```powershell
python backend/manage.py procesar_recordatorios --max-envios 500 --max-envios-por-capa 100 --require-whatsapp-ready --fail-on-errors
```

`--max-envios` es el limite global de la corrida. `--max-envios-por-capa` evita
que una sola capa consuma toda la tanda programada.
`--require-whatsapp-ready` hace un preflight antes de enviar: si hay reglas
WhatsApp activas con plantilla Meta sin nombre, sin estado `APROBADA`, o sin
proveedor saliente disponible, el cron falla y deja evidencia en `CronRunLog`
sin crear historial de envios.

Cada corrida guarda en `CronRunLog` un resumen por capa: enviados, omitidos,
errores, reglas, candidatos y si alcanzo limite. El monitor de Cobranza muestra
la ultima corrida relevante para la capa actual, actividad por regla de los
ultimos 7 dias, errores recientes, cuotas de WhatsApp/email y reglas bloqueadas
por plantillas Meta no aprobadas.

Checklist antes de activar envios reales:

1. Revisar `Cobranza > Plantillas` y confirmar nombres Meta.
2. Confirmar que cada plantilla WhatsApp requerida esta `APROBADA`.
3. Ejecutar `--dry-run` por capa y revisar candidatos.
4. Ejecutar `--dry-run --require-whatsapp-ready` por capa y confirmar que no
   hay problemas de readiness.
5. Confirmar que los mensajes incluyen `{{portal_url}}` y referencia de pago.
6. Ejecutar una prueba real con la capa smoke antes de activar todas las capas.
7. Mantener `--max-envios` y `--max-envios-por-capa` en la corrida programada
   para evitar envios masivos accidentales si una regla queda mal configurada.

## Background worker

Los procesos que no deben bloquear una respuesta HTTP usan una cola persistente
en base de datos. La primera carga migrada a este flujo es el procesamiento de
webhooks entrantes de WhatsApp/Green API. Las importaciones batch de clientes,
fichas de renta, CxC, CxP y estados de cuenta bancarios tambien pueden enviarse
al worker con `async_job=true`; sus frontends ya usan este flujo y consultan
`/api/billing/jobs/{job_id}/` hasta obtener el resultado.

Comando para ejecutar una tanda controlada:

```powershell
.venv\Scripts\python.exe backend\manage.py run_background_jobs --once --limit 25
```

Para un worker continuo en Render:

```powershell
python backend/manage.py run_background_jobs --queue default --limit 25
```

La salud interna expone conteos de jobs pendientes, en ejecucion, exitosos,
fallidos, jobs que llevan mas de 30 minutos bloqueados y el heartbeat del worker.
Si hay jobs listos y el worker no reporta heartbeat reciente, backoffice salud
levanta alerta de worker inactivo.

Configurar en Render como servicio Worker separado del web service:

```text
Name: betterp-background-worker
Start command: python backend/manage.py run_background_jobs --queue default --limit 25
```

Si el servicio de Render tiene `Root Directory` configurado como `backend`, usar
`python manage.py ...` en vez de `python backend/manage.py ...`.

Si el worker esta apagado, las cargas quedan aceptadas como `PENDING`, pero no
se procesan hasta que el comando vuelva a correr.

## Limites de plan

Los limites de usuarios, entidades y espacios se aplican en los flujos de alta
operativa. Backoffice salud tambien evalua todas las suscripciones activas,
trial y past due:

- `WARN`: uso igual o mayor a 80% del limite contratado.
- `ERROR`: uso por encima del limite contratado.

Cuando aparezcan alertas de capacidad, revisar `Backoffice > Clientes`, liberar
registros inactivos si aplica o mover al cliente a un plan superior.

## Readiness de go-live

`Backoffice > Salud` expone una tarjeta `Go-live` calculada desde las senales
operativas existentes. No sustituye el runbook humano de
[`first-customer-go-live-checklist.md`](first-customer-go-live-checklist.md),
pero ayuda a detectar bloqueantes antes de entregar acceso a un cliente real.

La tarjeta evalua:

- Contrato de backend y commit servido en `health`.
- Smoke productivo y receptor de evidencia.
- Stripe, webhooks y billing.
- Backup reciente y errores de respaldo.
- Suscripciones, capacidad por plan, crons y jobs background.
- Errores frontend y Web Vitals.

Estados:

- `ERROR`: existe un bloqueante tecnico u operativo antes de go-live.
- `WARN`: no hay bloqueantes, pero queda un pendiente preventivo.
- `OK`: las senales automaticas estan listas; cerrar aprobacion humana con el
  checklist del primer cliente.

El cierre por cliente vive en `Backoffice > Clientes SaaS > Cierre go-live`.
Ese registro guarda responsable BetterP, responsable cliente, fecha, smoke
previo/posterior, referencia de backup, restore validado, automatizaciones y
pendientes. Para aprobar sin pendientes, el sistema exige responsable interno,
responsable cliente, smoke previo, backup y restore validado.

`Backoffice > Salud` tambien resume esos cierres por cliente: aprobados,
aprobados con pendientes, pendientes, bloqueados y clientes activos sin cierre.
Si existe un cliente activo sin go-live aprobado, Salud levanta una alerta
preventiva; si existe un go-live bloqueado, levanta alerta critica.
En `Backoffice > Clientes SaaS`, usa los filtros rapidos de go-live para operar
pendientes, bloqueados, aprobados o clientes activos sin cierre.
Desde el mismo filtro se puede exportar un CSV operativo con responsables,
evidencia, salud, montos estimados y seguimiento de cada cierre.
Despues de aprobar un cliente, marca el seguimiento de dia 1 y primeros 7 dias
en el mismo modal; Salud lo mantiene como pendiente hasta completar ambos hitos.
Ese seguimiento tambien tiene tarea operativa con responsable, prioridad, estado
y fecha objetivo; si vence, Salud muestra una alerta preventiva.
La vista de `Clientes SaaS` muestra una lista compacta de tareas post go-live
abiertas o vencidas y filtros dedicados para operarlas sin revisar toda la tabla.

Para recibir un resumen operativo diario de tareas post go-live abiertas o
vencidas, configurar `BETTERP_OPERATIONS_NOTIFY_EMAIL`. Si no existe, el sistema
usa `BETTERP_SALES_NOTIFY_EMAIL` y despues `SALES_CONTACT_EMAIL`.

Comando activo en el scheduler de Vultr, sin envío de correo:

```powershell
python manage.py report_post_go_live_tasks --no-email
```

Prueba sin enviar correo:

```powershell
python manage.py report_post_go_live_tasks --dry-run
```

La salud operativa monitorea esta corrida como `post_go_live_tasks_report` y
muestra receptor, ultima ejecucion, tareas abiertas y tareas vencidas.

## Salud de cliente SaaS

`GET /api/billing/admin/clientes/` incluye `health` por suscripcion y un resumen
`salud_clientes`.

La salud por cliente combina:

- Estado comercial de la suscripcion.
- Trial o renovacion proxima.
- Capacidad contra usuarios, entidades y espacios contratados.
- Ultimo backup por capa.
- Errores de billing de los ultimos 30 dias.
- Bloqueos de acceso por rol y bloqueos por plan de los ultimos 7 dias.

Estados:

- `OK`: cuenta sana sin accion inmediata.
- `WARN`: requiere seguimiento preventivo.
- `ERROR`: riesgo operativo, comercial o tecnico que debe atender soporte.

Para generar un reporte Markdown de clientes en riesgo:

```powershell
$env:BETTERP_BACKOFFICE_EMAIL='admin@betterp.net'
$env:BETTERP_BACKOFFICE_PASSWORD='...'
.venv\Scripts\python.exe scripts\customer_health_report.py
Remove-Item Env:\BETTERP_BACKOFFICE_EMAIL
Remove-Item Env:\BETTERP_BACKOFFICE_PASSWORD
```

El reporte queda en `tmp\customer-health-report.md` y prioriza clientes en
`ERROR`/`WARN`, responsable, accion siguiente, dominio de riesgo e issue
principal.

## CxC periodica

La generacion periodica debe crear solo el periodo vigente, respetando corte
individual o general. No debe generar CxC futuras de todo el ano.

Comando local/controlado:

```powershell
.venv\Scripts\python.exe backend\manage.py generar_cxc_periodicas --fecha-corte 2026-05-31
```

Endpoint programado protegido:

```http
POST /api/finanzas/cxc/generacion-programada/
```

Requiere `FINANZAS_CXC_SYNC_TOKEN`. Si se usa un scheduler externo, programarlo
al inicio de mes y validar que no duplique cuentas existentes.

Historial interno por capa:

```http
GET /api/billing/admin/clientes/{capa_id}/backups/
```

Generar backup R2 desde backoffice:

```http
POST /api/billing/admin/clientes/{capa_id}/backups/generar/
```

Validar un backup R2 como candidato a restore desde backoffice:

```http
POST /api/billing/admin/clientes/{capa_id}/backups/{backup_id}/validar-restore/
```

Requiere dos pasos de confirmacion: checkbox operativo y texto exacto
`VALIDAR RESTORE`. Esta validacion inspecciona el archivo y registra auditoria;
no modifica datos.

Estos endpoints son internos de BetterP. No deben exponerse como autoservicio
al cliente operativo.

## Restore por capa

El restore avanzado debe hacerse en dos fases: inspeccion y restauracion
controlada. La primera fase ya esta automatizada y no modifica datos.

Inspeccionar archivo local:

```powershell
.venv\Scripts\python.exe backend\manage.py inspect_capa_backup --file C:\betterp-backups\backup-capa-123-2026-05-21.xlsx
```

Inspeccionar objeto R2:

```powershell
.venv\Scripts\python.exe backend\manage.py inspect_capa_backup --r2-bucket betterp-storage --r2-key backups/capas/123-capa/2026/05/21/backup-capa-123-2026-05-21.xlsx
```

Si el historial tiene checksum, validarlo antes de restaurar:

```powershell
.venv\Scripts\python.exe backend\manage.py inspect_capa_backup --file C:\betterp-backups\backup.xlsx --expected-checksum SHA256
```

Regla operativa: no restaurar directo en produccion sin inspeccion, respaldo nuevo
previo, ventana de cambio y confirmacion de la capa afectada.

Procedimiento minimo:

1. Generar el backup antes de migraciones, cambios de datos o soporte invasivo.
2. Confirmar que se genero un archivo `backup-*.xlsx` o un objeto R2 por capa esperada.
3. Abrir el archivo y revisar la hoja `Resumen`.
4. Guardar el archivo fuera del runtime web, idealmente en almacenamiento privado.
5. Registrar fecha, capa, responsable y motivo del backup en la bitacora operativa.

Este export no reemplaza los snapshots de Neon ni cubre restore avanzado; para MVP
funciona como respaldo operativo verificable por capa.

## Checklist post-deploy

Validar en este orden:

- `https://api.betterp.net/health/`
- `https://api.betterp.net/api/openapi.json`
- `https://betterp.net/login`
- Login smoke interno.
- Perfil/cuenta y billing.
- Onboarding.
- Entidades y clientes.
- CxC.
- CxP.
- Pagos CxC/CxP.
- Comprobantes.
- Conciliacion cuentas.
- Conciliacion sugerencias/eventos.
- Cambios de plan.
- Portal cliente.
- Backup por capa.
- Auditoria.
- Preview de automatizaciones de cobranza.

Smoke recomendado:

```powershell
$env:BETTERP_SMOKE_EMAIL='smoke@betterp.net'
$env:BETTERP_SMOKE_PASSWORD='smoke$0123'
$env:BETTERP_DEPLOY_COMMIT="$(git rev-parse HEAD)"
$env:BETTERP_SMOKE_REPORT_JSON='tmp\smoke-report.json'
$env:BETTERP_SMOKE_HISTORY_JSONL='tmp\smoke-history.jsonl'
.venv\Scripts\python.exe scripts\smoke_mvp.py
```

El reporte puntual conserva detalle por check. El historial JSONL agrega una
linea por corrida con estado, fallas y checks mas lentos para comparar deploys.
El smoke valida por defecto que health exponga las features backend esperadas
`crm_portal_link,capa_backup_streaming_export`. Si falla solo en `api health`
por features ausentes, tratarlo como desfase de despliegue: Render sigue
sirviendo codigo anterior aunque las rutas de compatibilidad puedan mantener el
flujo verde. Para diagnostico puntual sin contrato de version, usar
`BETTERP_SMOKE_REQUIRED_BACKEND_FEATURES="none"`.

El workflow `Production Smoke` ejecuta primero `scripts\wait_backend_contract.py`.
En corridas manuales espera hasta 600 segundos por defecto y puede exigir que
health exponga el commit servido. En corridas programadas espera 60 segundos y
falla si las features esperadas no aparecen.

## Reporte de readiness productivo

Para generar una evidencia Markdown de readiness antes de abrir clientes,
entregar go-live o cerrar una ventana de cambio:

```powershell
$env:BETTERP_SMOKE_EMAIL='smoke@betterp.net'
$env:BETTERP_SMOKE_PASSWORD='smoke$0123'
.venv\Scripts\python.exe scripts\production_readiness_report.py
Remove-Item Env:\BETTERP_SMOKE_EMAIL
Remove-Item Env:\BETTERP_SMOKE_PASSWORD
```

El reporte queda por defecto en `tmp\production-readiness-report.md` y el JSON
base del smoke en `tmp\production-readiness-smoke.json`.

Para exigir un commit backend especifico despues de un deploy:

```powershell
$env:BETTERP_DEPLOY_COMMIT="$(git rev-parse HEAD)"
$env:BETTERP_SMOKE_REQUIRE_DEPLOY_COMMIT="1"
.venv\Scripts\python.exe scripts\production_readiness_report.py --require-commit
```

No usar el reporte como autorizacion para `BETTERP_SMOKE_WRITE`; las escrituras
controladas siguen limitadas a capa smoke con `BETTERP_SMOKE_WRITE_ALLOWED_CAPA_ID`.

`/` y `/health/` responden por middleware antes de resolver la API completa.
Si health tarda mas de unos segundos, tratarlo como senal de cold start,
arranque de proceso o saturacion de runtime antes de buscar consultas lentas en
endpoints autenticados.
Health tambien agenda el precalentamiento de la URLConf/API en segundo plano
(`HEALTH_API_WARMUP_ENABLED`, activo por defecto) para que el primer endpoint
autenticado no cargue todos los routers durante el login.

Endpoint de warmup:

- `https://api.betterp.net/api/warmup/`
- Responde JSON sin autenticacion.
- Sirve para separar arranque frio de lentitud real de login/API.

Health y warmup tambien exponen metadata publica de despliegue:

- `deployment.git_commit_short`: commit servido por el backend si el runtime
  expone `BETTERP_GIT_COMMIT`, `RENDER_GIT_COMMIT`, `SOURCE_VERSION`,
  `GIT_COMMIT`, `COMMIT_SHA` o `CF_PAGES_COMMIT_SHA`.
- `deployment.deploy_id`: id de deploy/instancia cuando lo provee el runtime.
- `features`: banderas de capacidades backend relevantes para verificar que
  produccion ya sirve el codigo esperado.
- Header `X-BettERP-API-Commit`: commit corto cuando esta disponible.

Despues de cada deploy, comparar `git rev-parse --short HEAD` contra health. Si
una ruta nueva devuelve 404 pero `features` no incluye su bandera esperada, el
problema es de despliegue/versionado y no del endpoint.

El keepalive de Render está retirado. Vultr mantiene la API residente y el
monitor externo de Cloudflare verifica disponibilidad sin crear una expectativa
de cron dentro del producto.

## Manifiesto SaaS del scheduler de Vultr

`Backoffice > Salud > Crons` funciona como manifiesto operativo. Cada fila
muestra agenda esperada, comando recomendado, ultima evidencia y estado:

- `MISSING`: no hay `CronRunLog`; falta crear el cron o correrlo manualmente.
- `STALE`: existe evidencia, pero esta fuera de la ventana esperada.
- `FAILED`: la ultima corrida termino en error.
- `RUNNING`: la corrida sigue marcada como activa.
- `OK`: la ultima corrida esta dentro de ventana.

Procesos esperados en producción:

| Proceso | Agenda | Comando |
| --- | --- | --- |
| Expiración de trials SaaS | 09:20 UTC diario | `python manage.py expirar_trials_saas` |
| Cambios de plan al renovar | 09:40 UTC diario | `python manage.py apply_pending_plan_changes --generated-by "vultr-scheduler"` |
| Publicación de marketing | Cada 5 minutos | `python manage.py publish_marketing_campaigns --limit 20 --fail-on-error` |
| Estado de publicaciones TikTok | Cada 5 minutos, desplazado dos minutos | `python manage.py sync_tiktok_publications --limit 25 --fail-on-error` |
| Reporte tareas post go-live | 14:30 UTC diario | `python manage.py report_post_go_live_tasks --no-email` |

Los cinco comandos corren dentro de `betterp-scheduler`, desde `/app`, y usan un
`flock` exclusivo por proceso. El reporte post go-live no envía correo. Las
campañas conservan su zona horaria al guardarse y el scheduler compara instantes
UTC, por lo que una programación a las 09:00 de Ciudad de México se procesa al
vencer esa hora local.

Para generar una hoja de activacion/auditoria desde el manifiesto real del
backend:

```powershell
.venv\Scripts\python.exe scripts\vultr_saas_cron_manifest.py
```

Para auditar la evidencia viva de Backoffice Salud:

```powershell
$env:BETTERP_BACKOFFICE_EMAIL='admin@betterp.net'
$env:BETTERP_BACKOFFICE_PASSWORD='...'
.venv\Scripts\python.exe scripts\cron_health_report.py
Remove-Item Env:\BETTERP_BACKOFFICE_EMAIL
Remove-Item Env:\BETTERP_BACKOFFICE_PASSWORD
```

## Paquete diario de operacion

Para generar en una sola corrida readiness productivo, salud de crons y clientes
SaaS en riesgo:

```powershell
$env:BETTERP_SMOKE_EMAIL='smoke@betterp.net'
$env:BETTERP_SMOKE_PASSWORD='smoke$0123'
$env:BETTERP_BACKOFFICE_EMAIL='admin@betterp.net'
$env:BETTERP_BACKOFFICE_PASSWORD='...'
.venv\Scripts\python.exe scripts\daily_operations_report.py
Remove-Item Env:\BETTERP_SMOKE_EMAIL
Remove-Item Env:\BETTERP_SMOKE_PASSWORD
Remove-Item Env:\BETTERP_BACKOFFICE_EMAIL
Remove-Item Env:\BETTERP_BACKOFFICE_PASSWORD
```

El paquete queda en `tmp\operations-YYYYMMDD-HHMMSS\index.md` con links a cada
reporte y logs de ejecucion.

## Password hashing

BetterP usa Argon2 como hasher preferido para nuevas contrasenas y mantiene
PBKDF2 en `PASSWORD_HASHERS` para verificar hashes existentes. Django actualiza
el hash automaticamente en un login exitoso cuando el algoritmo anterior sigue
en la lista, por lo que las cuentas migran gradualmente sin reset masivo.

Variables operativas:

```powershell
PASSWORD_ARGON2_TIME_COST=2
PASSWORD_ARGON2_MEMORY_COST=19456
PASSWORD_ARGON2_PARALLELISM=1
```

Si Salud Operativa muestra `login.password_auth` alto aun con API caliente,
medir primero antes de subir costos. Aumentar `time_cost` o `memory_cost`
mejora resistencia offline pero tambien sube latencia de login y consumo de
memoria por request concurrente.

Para validacion MVP con escritura reversible en una capa smoke:

```powershell
$env:BETTERP_SMOKE_CAPA_ID='ID_DE_CAPA_SMOKE'
$env:BETTERP_SMOKE_WRITE='1'
$env:BETTERP_SMOKE_WRITE_CONFIRM='SMOKE_WRITE_OK'
$env:BETTERP_SMOKE_WRITE_ALLOWED_CAPA_ID='ID_DE_CAPA_SMOKE'
.venv\Scripts\python.exe scripts\smoke_mvp.py
Remove-Item Env:\BETTERP_SMOKE_CAPA_ID
Remove-Item Env:\BETTERP_SMOKE_WRITE
Remove-Item Env:\BETTERP_SMOKE_WRITE_CONFIRM
Remove-Item Env:\BETTERP_SMOKE_WRITE_ALLOWED_CAPA_ID
```

No activar `BETTERP_SMOKE_WRITE` contra capas con datos reales de clientes. El
write controlado crea, actualiza y elimina una regla marco inactiva, una cuenta
bancaria temporal de conciliacion y una programacion CxP inactiva; tambien
valida auditoria de la programacion CxP.
Contra produccion el script exige que `BETTERP_SMOKE_WRITE_ALLOWED_CAPA_ID`
coincida con la capa seleccionada, para evitar escrituras accidentales cuando la
cuenta smoke tenga acceso a mas de una capa.

Para QA end-to-end reversible, agregar:

```powershell
$env:BETTERP_SMOKE_E2E='1'
```

Ese flujo crea un cliente temporal, valida detalle y portal preview, lo actualiza,
lo busca y lo elimina. Usarlo solo contra capa smoke y con
`BETTERP_SMOKE_WRITE_ALLOWED_CAPA_ID` definido.

## Rollback operativo

1. Identificar el ultimo commit estable.
2. Revertir con un commit nuevo, no con reset destructivo sobre `main`.
3. Push a `main`.
4. Confirmar deploy Render/Cloudflare.
5. Ejecutar health, OpenAPI y smoke.
6. Documentar causa, hora, commit afectado y resultado.

Si hubo migraciones de base de datos:

1. No revertir codigo sin revisar si la migracion agrego/renombro/elimina columnas.
2. Confirmar si existe migracion inversa segura.
3. Si el problema es solo frontend, revertir solo frontend y no tocar DB.
4. Si el problema es datos, generar backup de la capa afectada antes de cualquier correccion manual.

## Auditoria minima

La API registra eventos criticos en `accounts.EventoAuditoria`.

Permisos por rol:

```http
GET /api/accounts/permisos/
```

La matriz vigente expone capacidades por `OWNER_ADMIN`, `OPERADOR` y `CONSULTA`.
Los intentos bloqueados por permisos quedan registrados como `ACCESO_DENEGADO`
con rol actual, permiso requerido, metodo y ruta para soporte.
Los bloqueos por plan quedan separados como `PLAN_MODULO_DENEGADO` o
`PLAN_FUNCION_DENEGADA`, con plan, capability, ruta y overrides efectivos.

Consulta por capa activa:

```http
GET /api/accounts/auditoria/
```

Filtros disponibles:

- `limit`: 1 a 200, default 80.
- `recurso_tipo`: por ejemplo `Cliente`, `EntidadNegocio`, `CuentaPorPagar`.
- `accion`: por ejemplo `CLIENTE_CREADO`, `CXP_PAGO_REGISTRADO`.

Eventos cubiertos inicialmente:

- Crear, editar, eliminar, desactivar o reactivar clientes.
- Crear, editar o eliminar entidades/capas.
- Crear o generar espacios, asignar y finalizar asignaciones.
- Cambiar estatus de CxC.
- Crear CxP manual, crear/editar/eliminar programaciones CxP.
- Registrar y validar pagos CxC/CxP.
- Aplicar, conciliar o cambiar estatus de eventos financieros.
- Aplicar transacciones bancarias a CxC/CxP y vincular transacciones a eventos.
- Cambiar funciones/modulos personalizados de una suscripcion.
- Solicitar o programar cambios de plan.
- Intentos denegados por permisos insuficientes.
- Intentos denegados por modulo o funcion no incluida en el plan.
