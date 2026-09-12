# Smoke test de produccion MVP

Este smoke test sirve para detectar rapido errores 500 despues de deploy y confirmar que las rutas criticas del MVP responden JSON/HTML valido.

## Variables

```powershell
$env:BETTERP_API_BASE="https://api.betterp.net/api"
$env:BETTERP_APP_BASE="https://betterp.net"
$env:BETTERP_HEALTH_URL="https://api.betterp.net/"
$env:BETTERP_WARMUP_URL="https://api.betterp.net/api/warmup/"
$env:BETTERP_SMOKE_USER_AGENT="Mozilla/5.0 (compatible; BetterP-MVP-Smoke/1.0; +https://betterp.net)"
$env:BETTERP_SMOKE_EMAIL="cuenta-smoke@betterp.net"
$env:BETTERP_SMOKE_PASSWORD="password-de-la-cuenta-smoke"
# Opcional si quieres forzar una capa concreta
$env:BETTERP_SMOKE_CAPA_ID="1"
# Opcional para forzar un portal ya generado.
# Si no lo defines, el script toma el primer cliente activo y genera el preview automaticamente.
$env:BETTERP_SMOKE_PORTAL_TOKEN="token-del-portal"
# Opcional: ejecuta una escritura reversible en la capa smoke.
$env:BETTERP_SMOKE_WRITE="1"
$env:BETTERP_SMOKE_WRITE_CONFIRM="SMOKE_WRITE_OK"
$env:BETTERP_SMOKE_WRITE_ALLOWED_CAPA_ID="1"
# Opcional: ejecuta QA E2E reversible de cliente/portal.
$env:BETTERP_SMOKE_E2E="1"
# Opcional: reporte puntual y bitacora historica.
$env:BETTERP_SMOKE_REPORT_JSON="tmp\smoke-report.json"
$env:BETTERP_SMOKE_HISTORY_JSONL="tmp\smoke-history.jsonl"
# Opcional: publica evidencia en backoffice Salud si el backend tiene SMOKE_REPORT_TOKEN.
$env:BETTERP_SMOKE_REPORT_TOKEN="token-compartido-con-backend"
$env:BETTERP_SMOKE_REPORT_REQUIRED="1"
$env:BETTERP_SMOKE_SOURCE="production_smoke"
# Opcional: contrato minimo de backend esperado en health.
$env:BETTERP_SMOKE_REQUIRED_BACKEND_FEATURES="crm_portal_link,capa_backup_streaming_export"
# Opcional: commit que debe estar sirviendo el backend.
$env:BETTERP_DEPLOY_COMMIT="$(git rev-parse HEAD)"
$env:BETTERP_SMOKE_REQUIRE_DEPLOY_COMMIT="1"
```

Si no defines correo y password, el script valida solo health y paginas publicas.
Si una red corporativa o regla perimetral responde `403` a las paginas publicas, ejecuta el smoke desde una red permitida o ajusta temporalmente el user-agent/IP del runner.
Por defecto, el smoke exige que health exponga las features
`crm_portal_link,capa_backup_streaming_export`. Si produccion todavia sirve una
version anterior, health falla aunque el flujo funcional pueda seguir pasando
con rutas de compatibilidad.

## Ejecutar

```powershell
.\.venv\Scripts\python.exe scripts\smoke_mvp.py
```

Para guardar evidencia de la corrida:

```powershell
$env:BETTERP_SMOKE_REPORT_JSON="tmp\smoke-report.json"
$env:BETTERP_SMOKE_HISTORY_JSONL="tmp\smoke-history.jsonl"
.\.venv\Scripts\python.exe scripts\smoke_mvp.py
```

El reporte JSON incluye todos los checks, fallas y los cinco checks mas lentos.
El JSONL agrega una linea por corrida para comparar tiempos entre deploys.
Si `BETTERP_SMOKE_REPORT_TOKEN` esta definido, el script publica el resumen en
`/api/billing/operational/smoke-report/` y backoffice Salud lo muestra como
evidencia smoke/deploy. El backend debe tener el mismo valor en `SMOKE_REPORT_TOKEN`.
Con `BETTERP_SMOKE_REPORT_REQUIRED=1`, el smoke falla si no puede publicar esa
evidencia.

Para una corrida diagnostica que solo confirme el flujo historico sin validar
version de backend, desactivar explicitamente el contrato de features:

```powershell
$env:BETTERP_SMOKE_REQUIRED_BACKEND_FEATURES="none"
.\.venv\Scripts\python.exe scripts\smoke_mvp.py
Remove-Item Env:\BETTERP_SMOKE_REQUIRED_BACKEND_FEATURES
```

Para validar que Render ya sirve el commit esperado, definir
`BETTERP_DEPLOY_COMMIT`. Si ademas se define
`BETTERP_SMOKE_REQUIRE_DEPLOY_COMMIT=1`, el smoke falla cuando health no expone
commit. Sin modo estricto, solo reporta `commit no expuesto`.

Antes del smoke completo tambien puedes esperar explicitamente a que Render
publique el contrato backend:

```powershell
$env:BETTERP_DEPLOY_COMMIT="$(git rev-parse HEAD)"
$env:BETTERP_SMOKE_REQUIRE_DEPLOY_COMMIT="1"
.\.venv\Scripts\python.exe scripts\wait_backend_contract.py --timeout 600 --interval 15
```

Este comando revisa `health` hasta que aparezcan las features esperadas y, si se
activa el modo estricto, el commit servido. Es la forma recomendada de distinguir
entre "deploy todavia en curso" y "produccion quedo en una version anterior".

Para deploys normales, dejar `BETTERP_SMOKE_WRITE` apagado. Activarlo solo en una
validacion controlada de MVP o despues de cambios que afecten permisos/escrituras.
El script exige tambien `BETTERP_SMOKE_WRITE_CONFIRM=SMOKE_WRITE_OK` para evitar
escrituras accidentales en produccion.
Contra `https://api.betterp.net`, el script exige ademas
`BETTERP_SMOKE_WRITE_ALLOWED_CAPA_ID`: debe coincidir con la capa seleccionada
por `BETTERP_SMOKE_CAPA_ID` o por la membresia actual de la cuenta smoke. Esto
evita que una cuenta con varias capas ejecute escrituras reversibles sobre una
capa real por error.
El QA E2E (`BETTERP_SMOKE_E2E=1`) tambien requiere esa confirmacion y crea un
cliente temporal que consulta, actualiza, valida en portal preview, busca y elimina.

## Cobertura

- API health.
- Contrato de despliegue en health: features backend esperadas y commit servido
  cuando se configura.
- API warmup para separar cold start de lentitud real de login.
- Paginas publicas principales: login, onboarding, CxC, cobranza y pago exitoso.
- Login con cuenta smoke.
- Perfil autenticado.
- Matriz de permisos de la capa activa.
- Suscripcion actual.
- Entidades.
- Onboarding.
- CxC.
- CxP.
- Pagos CxC/CxP.
- Comprobantes/evidencias.
- Configuracion de cobranza.
- Preview de automatizaciones de cobranza.
- Cuentas bancarias de conciliacion.
- Sugerencias y eventos de conciliacion.
- Historial de cambios de plan.
- Auditoria de acciones criticas.
- Portal cliente. Si existe una sesion autenticada y hay clientes activos, el script genera un preview y valida el endpoint publico automaticamente.
- Backup operativo de la capa activa en Excel.
- Escritura controlada opcional: crea, actualiza y elimina una regla marco
  inactiva, una cuenta bancaria temporal de conciliacion y una programacion
  CxP inactiva en la capa smoke; ademas valida auditoria de la programacion.
- QA E2E opcional: crea, consulta, actualiza, busca y elimina un cliente
  temporal, validando tambien portal preview.

## Criterio de pase

Todo check debe responder `OK`. Cualquier `FAIL` con status `500` se atiende antes de dar por bueno el deploy. Si aparece status `401` o `403`, revisar credenciales, capa seleccionada y permisos del plan antes de tratarlo como bug.

## Cuenta smoke recomendada

Mantener una cuenta interna con datos ficticios, rol admin en la capa smoke,
suscripcion activa, al menos una entidad, un cliente, una CxC abierta, una
evidencia de pago y una cuenta bancaria de conciliacion. No usar datos reales de
clientes para smoke tests.

Si la cuenta smoke falta, fue desactivada o perdio datos minimos, reconstruirla
desde backend:

```powershell
.venv\Scripts\python.exe backend\manage.py ensure_smoke_environment
```

Para reiniciar tambien los datos demo/smoke controlados:

```powershell
.venv\Scripts\python.exe backend\manage.py ensure_smoke_environment --reset
```

En GitHub Actions configurar estos secrets para el workflow `Production Smoke`:

- `BETTERP_SMOKE_EMAIL`
- `BETTERP_SMOKE_PASSWORD`
- `BETTERP_SMOKE_CAPA_ID` opcional si la cuenta tiene mas de una capa
- `BETTERP_SMOKE_PORTAL_TOKEN` opcional si se quiere fijar un portal especifico
- `BETTERP_SMOKE_WRITE` y `BETTERP_SMOKE_WRITE_CONFIRM` solo para corridas
  manuales de escritura controlada contra capa smoke
- `BETTERP_SMOKE_WRITE_ALLOWED_CAPA_ID` obligatorio para escritura/E2E contra
  produccion; debe ser el ID de la capa smoke permitida
- `BETTERP_SMOKE_E2E` para activar el flujo end-to-end reversible de cliente
- `BETTERP_SMOKE_REPORT_JSON` para guardar el resultado completo de una corrida
- `BETTERP_SMOKE_HISTORY_JSONL` para agregar una bitacora historica por corrida
- `BETTERP_SMOKE_REPORT_TOKEN` para publicar evidencia smoke en backoffice Salud
- `BETTERP_SMOKE_REPORT_REQUIRED` para fallar si no se publico la evidencia
- `BETTERP_SMOKE_SOURCE` para clasificar la corrida (`production_smoke`,
  `backend_deploy_smoke` o `demo_smoke`)
- `BETTERP_SMOKE_REQUIRED_BACKEND_FEATURES` para exigir features publicadas por
  health; por defecto valida `crm_portal_link,capa_backup_streaming_export`;
  usar `none`, `off`, `false` o `0` para desactivarlo en diagnostico
- `BETTERP_DEPLOY_COMMIT` para comparar el commit esperado contra health
- `BETTERP_SMOKE_REQUIRE_DEPLOY_COMMIT` para fallar si health no expone commit
- `BETTERP_DEPLOY_WAIT_SECONDS` y `BETTERP_DEPLOY_WAIT_INTERVAL` para controlar
  la espera de `scripts\wait_backend_contract.py`

El workflow `Production Smoke` deja `enable_write` y `enable_e2e` apagados por
defecto. Para una corrida manual de escritura/E2E en GitHub Actions, configurar
el secret `BETTERP_SMOKE_WRITE_ALLOWED_CAPA_ID` con el mismo valor que
`BETTERP_SMOKE_CAPA_ID` y activar esos inputs solo contra la capa smoke.

Para el workflow `Backend Release Verification`, configurar también:

- `BETTERP_SMOKE_REPORT_TOKEN`: mismo valor que `SMOKE_REPORT_TOKEN` en Vultr

Después del release explícito de Vultr, el workflow recibe el SHA desplegado,
espera el contrato de health y ejecuta el smoke productivo. No despliega servicios.

Para validar cobranza automatica sin enviar mensajes, revisar tambien:

```powershell
.venv\Scripts\python.exe backend\manage.py procesar_recordatorios --dry-run
```

El dry-run debe reportar candidatos/reglas sin crear historial ni enviar
WhatsApp. Los envios reales requieren plantillas Meta aprobadas.

Para validar checkout Stripe en modo test sin tocar Stripe real, usar la prueba
automatizada mockeada:

```powershell
.venv\Scripts\python.exe backend\manage.py test billing.tests.BillingStripeCheckoutE2ETests --keepdb
```
