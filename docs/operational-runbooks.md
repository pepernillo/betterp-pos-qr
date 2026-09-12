# Runbooks operativos BetterP

Este documento concentra procedimientos de soporte y operacion para produccion.
Usarlo cuando `Backoffice > Salud`, smoke productivo, un cliente o un proveedor
externo reporten una falla.

## Principios de respuesta

- Primero estabilizar produccion; despues investigar causa raiz.
- No ejecutar acciones destructivas ni restores sin backup previo y responsable.
- No activar smoke write ni pruebas E2E sobre capas con datos reales.
- Registrar hora, responsable, cliente/capa afectada, evidencia y resultado.
- Si hay duda entre bug de producto y desfase de deploy, verificar primero
  `health.deployment.git_commit_short`.

## Severidad

| Severidad | Criterio | Respuesta esperada |
| --- | --- | --- |
| SEV1 | API caida, login caido, perdida o corrupcion de datos, cobro live incorrecto masivo | Detener cambios, asignar responsable unico, comunicar estado cada 30 minutos |
| SEV2 | Funcion critica fallando para uno o varios clientes, crons criticos fallidos, Stripe/WhatsApp no operativo | Atender el mismo dia, comunicar impacto y workaround |
| SEV3 | Degradacion parcial, alerta preventiva, tarea post go-live vencida, cliente en WARN | Planificar correccion y seguimiento |
| SEV4 | Consulta operativa, documentacion, mejora menor | Atender en backlog normal |

## Diagnostico inicial

1. Confirmar version backend:

```powershell
$env:BETTERP_DEPLOY_COMMIT="$(git rev-parse HEAD)"
$env:BETTERP_SMOKE_REQUIRE_DEPLOY_COMMIT="1"
.venv\Scripts\python.exe scripts\wait_backend_contract.py --timeout 600 --interval 15 --request-timeout 20
```

2. Ejecutar smoke publico:

```powershell
.venv\Scripts\python.exe scripts\smoke_mvp.py
```

3. Ejecutar smoke autenticado si login/API son parte del incidente:

```powershell
$env:BETTERP_SMOKE_EMAIL='smoke@betterp.net'
$env:BETTERP_SMOKE_PASSWORD='smoke$0123'
.venv\Scripts\python.exe scripts\smoke_mvp.py
Remove-Item Env:\BETTERP_SMOKE_EMAIL
Remove-Item Env:\BETTERP_SMOKE_PASSWORD
```

4. Revisar `Backoffice > Salud` en este orden:
   deploy, smoke, health backend, crons, billing/webhooks, backups, jobs,
   Web Vitals, alertas por cliente.
5. Revisar los logs Docker del servicio en Vultr y, cuando aplique, los del
   proveedor afectado: Cloudflare, Stripe, Resend, Meta WhatsApp o R2.

Paquete diario completo:

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

## API o login caido

Indicadores:

- `https://api.betterp.net/health/` no responde `200`.
- `https://api.betterp.net/api/warmup/` falla o tarda excesivamente.
- Smoke falla en `api health`, `api warmup`, login o perfil.

Acciones:

1. Confirmar en `/health/` si Vultr esta sirviendo el commit y deploy esperados.
2. Revisar `docker compose logs betterp-api`: import errors, variables faltantes,
   migraciones pendientes, timeout o memoria.
3. Confirmar que `AUTO_MIGRATE_ON_STARTUP` no esta activo por accidente.
4. Si el problema empezo con el ultimo commit, preparar revert con commit nuevo.
5. Si hay migracion involucrada, no revertir codigo hasta revisar compatibilidad
   de esquema.
6. Repetir wait contract y smoke antes de cerrar.

Cierre:

- Health, warmup y smoke autenticado OK.
- Backoffice Salud sin alerta critica de backend/deploy.
- Incidente documentado con commit afectado y accion tomada.

## Frontend caido o version incorrecta

Indicadores:

- `https://betterp.net/login` no carga HTML.
- Cloudflare Pages publico un build anterior.
- Error visual masivo despues de deploy frontend.

Acciones:

1. Ejecutar build local:

```powershell
cd frontend
npm run build
```

2. Revisar ultimo deploy en Cloudflare Pages y commit publicado.
3. Confirmar `NEXT_PUBLIC_API_BASE_URL`; si falta, el frontend apunta a
   `https://api.betterp.net/api`.
4. Si el error es de codigo frontend, revertir con commit nuevo y volver a
   publicar.
5. Si el error es de red/CDN, reintentar deploy sin mezclar cambios nuevos.

Cierre:

- Login carga HTML.
- Smoke publico pasa rutas frontend basicas.
- No hay errores nuevos en Web Vitals/console reportados por Salud.

## Crons faltantes, stale o fallidos

Indicadores:

- `Backoffice > Salud > Crons` marca `MISSING`, `STALE`, `FAILED` o `RUNNING`
  fuera de ventana.

Acciones:

1. Identificar `key`, comando recomendado y ultima evidencia en Salud.
2. Confirmar que el cron existe en el scheduler de Vultr y usa el mismo archivo
   de entorno protegido que la API.
3. Si el cron corre desde raiz del repo, usar `python backend/manage.py ...`.
   Si corre con `Root Directory=backend`, usar `python manage.py ...`.
4. Ejecutar manualmente el comando en un job dirigido de Vultr o local contra entorno controlado
   cuando sea seguro.
5. Revisar `CronRunLog` reciente y logs del job.

Automatizaciones SaaS obligatorias:

```powershell
python backend/manage.py expirar_trials_saas --dry-run
python backend/manage.py apply_pending_plan_changes --dry-run --generated-by "vultr-scheduler-preview"
python backend/manage.py publish_marketing_campaigns --limit 20 --dry-run
python backend/manage.py sync_tiktok_publications --limit 25 --dry-run
python backend/manage.py report_post_go_live_tasks --dry-run
```

Después del preview, la activación productiva usa exclusivamente
`ops/vultr/betterp.saas.cron`. La publicacion programada de marketing y la
confirmacion asincrona de TikTok forman parte del manifiesto activo. Inbox,
cobranza, Renta Fácil y respaldos conservan sus runbooks propios.

Cierre:

- La fila del cron queda `OK` o con causa documentada.
- Si hubo impacto a clientes, crear tarea de seguimiento.

## Billing, Stripe y cambios de plan

Indicadores:

- Webhooks Stripe fallan.
- Cliente no queda activo despues de pago.
- Cambio de plan queda `ERROR`, `PENDIENTE_PAGO` o `REEMBOLSO_SOLICITADO`.
- Salud marca billing/webhooks en `WARN` o `ERROR`.

Acciones:

1. Revisar evento en Stripe y `EventoBilling`.
2. Confirmar modo activo: `TEST` para pruebas, `LIVE` para cobro real.
3. Validar secret key, webhook secret, Price IDs y `stripe_subscription_id`.
4. Para cambio inmediato en Stripe `LIVE`, exigir confirmacion
   `STRIPE_LIVE_OK`; si no hay seguridad operativa, programar al renovar.
5. Para downgrade con reembolso, mantener revision interna hasta confirmar
   `refund.succeeded` o registrar accion manual equivalente.
6. Si el problema es masivo, pausar cambios de plan y checkout live hasta
   confirmar webhooks.

Pruebas locales relevantes:

```powershell
.venv\Scripts\python.exe backend\manage.py test billing.tests.BillingPlanChangeTests --keepdb
.venv\Scripts\python.exe backend\manage.py test billing.tests.BillingStripeCheckoutE2ETests --keepdb
```

Cierre:

- Evento Stripe conciliado con evento interno.
- Suscripcion local en estado esperado.
- Cliente informado si hubo impacto de cobro o acceso.

## Backups y restore por capa

Indicadores:

- Cliente pide recuperacion de datos.
- Cambio de soporte puede modificar datos sensibles.
- Salud marca backup reciente faltante o error de respaldo.

Acciones:

1. Generar backup nuevo de la capa afectada antes de tocar datos.
2. Validar backup desde Backoffice o por comando:

```powershell
.venv\Scripts\python.exe backend\manage.py inspect_capa_backup --file C:\betterp-backups\backup.xlsx
```

3. Si viene de R2, validar bucket, key y checksum esperado cuando exista.
4. No restaurar en produccion sin ventana de cambio, responsable y confirmacion
   explicita de capa afectada.
5. Si el problema es de base completa, revisar snapshots Neon antes de intentar
   restauraciones parciales.

Cierre:

- Backup previo identificado.
- Validacion de restore registrada.
- Accion aplicada o descartada con evidencia.

## Cliente SaaS en riesgo

Indicadores:

- `Backoffice > Clientes SaaS` muestra health `WARN` o `ERROR`.
- Tarea post go-live vencida.
- Capacidad mayor a 80% o excedida.
- Bloqueos recurrentes por permisos o plan.

Acciones:

1. Abrir detalle del cliente en Backoffice.
2. Clasificar el riesgo: tecnico, comercial, capacidad, billing, backups,
   permisos o actividad.
3. Asignar responsable y siguiente accion.
4. Si el riesgo bloquea operacion real, crear seguimiento con fecha objetivo.
5. Si es capacidad o plan, revisar upgrade antes de limpiar datos.
6. Si es permisos, revisar auditoria antes de ampliar accesos.

Cierre:

- Estado del cliente vuelve a `OK` o queda tarea abierta con responsable.
- El cliente o responsable interno conoce la accion siguiente.

Reporte operativo:

```powershell
$env:BETTERP_BACKOFFICE_EMAIL='admin@betterp.net'
$env:BETTERP_BACKOFFICE_PASSWORD='...'
.venv\Scripts\python.exe scripts\customer_health_report.py
Remove-Item Env:\BETTERP_BACKOFFICE_EMAIL
Remove-Item Env:\BETTERP_BACKOFFICE_PASSWORD
```

Usar `tmp\customer-health-report.md` como lista de trabajo diaria para soporte.

## Seguridad, permisos y auditoria

Indicadores:

- Aumento de `ACCESO_DENEGADO`.
- Bloqueos por plan inesperados.
- Usuario reporta acceso faltante o excesivo.

Acciones:

1. Revisar:

```http
GET /api/accounts/auditoria/resumen/
GET /api/accounts/permisos/
```

2. Confirmar rol actual, permiso requerido, ruta y capa.
3. No cambiar rol global sin validar impacto en otras rutas.
4. Si el bloqueo es por plan, revisar capability y overrides efectivos.
5. Registrar cambios de acceso en auditoria.

Cierre:

- Permiso o plan corregido.
- No quedan accesos excesivos como workaround permanente.

## Comunicacion durante incidente

Mensaje interno minimo:

```text
Incidente: [SEV#] [area]
Inicio: [hora Mexico]
Impacto: [clientes/rutas/proceso]
Estado actual: [investigando/mitigado/resuelto]
Responsable: [nombre]
Siguiente actualizacion: [hora]
```

Mensaje a cliente:

```text
Detectamos una incidencia en [area]. El impacto observado es [impacto].
Estamos trabajando en la correccion y la siguiente actualizacion sera a las
[hora Mexico]. No se requiere accion de tu parte por ahora.
```

Cierre interno:

```text
Incidente cerrado: [SEV#] [area]
Causa: [resumen]
Correccion: [commit/proveedor/operacion]
Validacion: [health/smoke/prueba/manual]
Seguimiento: [tarea o ninguno]
```

## Evidencia minima por incidente

- Fecha/hora de inicio y cierre.
- Severidad.
- Cliente/capa afectada.
- Commit backend/frontend servido.
- Checks fallidos y checks recuperados.
- Logs relevantes o IDs de proveedor.
- Backup/restore si aplica.
- Responsable y accion preventiva.
