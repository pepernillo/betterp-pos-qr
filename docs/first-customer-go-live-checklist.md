# Checklist de primer cliente real

Este runbook se usa antes de activar el primer cliente real en produccion. La
meta es evitar improvisacion: confirmar configuracion, datos, permisos,
respaldo, smoke y monitoreo antes de entregar acceso.

## Criterio de avance

No pasar a produccion real si existe cualquiera de estos bloqueantes:

- Tarjeta `Go-live` en `Backoffice > Salud` en estado `ERROR`.
- Health API o login smoke fallando.
- Migraciones pendientes sin ejecutar o sin confirmar.
- Backups R2 sin generar o sin historial visible.
- Stripe live sin Price IDs correctos para el plan contratado.
- Plantillas WhatsApp reales sin aprobacion si el cliente usara cobranza.
- Usuario cliente creado con rol incorrecto.
- Capa del cliente mezclada con datos demo/smoke.
- Restore no validado para al menos un backup reciente.
- Falta de responsable interno para soporte del primer dia.

## 1. Preparacion interna

- Confirmar que `main` esta deployado en:
  - `https://betterp.net`
  - `https://api.betterp.net`
- Revisar Render: backend en estado healthy y sin restart loop.
- Revisar Cloudflare Pages: ultimo commit publicado correctamente.
- Revisar Neon: base online, sin alertas de conexion o almacenamiento.
- Revisar R2: bucket de backups disponible.
- Revisar Resend: dominio y sender verificados.
- Revisar Stripe:
  - Modo live configurado solo si se cobrara al cliente real.
  - Plan contratado con Price IDs live mensual/anual correctos.
  - Webhook live apunta a `https://api.betterp.net/api/billing/webhook/stripe/`.
- Revisar Meta WhatsApp:
  - Numero oficial conectado.
  - Plantillas necesarias aprobadas.
  - Automatizaciones apagadas hasta confirmar datos.

## 2. Validacion tecnica previa

Ejecutar desde la raiz del repo:

```powershell
git status --short
python -m compileall -q backend
cd frontend
npm run build
cd ..
git diff --check
```

Ejecutar smoke productivo con evidencia:

```powershell
$env:BETTERP_SMOKE_EMAIL='smoke@betterp.net'
$env:BETTERP_SMOKE_PASSWORD='smoke$0123'
$env:BETTERP_SMOKE_REPORT_JSON='tmp\smoke-report.json'
$env:BETTERP_SMOKE_HISTORY_JSONL='tmp\smoke-history.jsonl'
.\.venv\Scripts\python.exe scripts\smoke_mvp.py
```

Si el cambio toca permisos, escrituras o flujos de cliente, validar tambien la
capa smoke con escritura reversible:

```powershell
$env:BETTERP_SMOKE_CAPA_ID='ID_DE_CAPA_SMOKE'
$env:BETTERP_SMOKE_WRITE='1'
$env:BETTERP_SMOKE_WRITE_CONFIRM='SMOKE_WRITE_OK'
$env:BETTERP_SMOKE_WRITE_ALLOWED_CAPA_ID='ID_DE_CAPA_SMOKE'
$env:BETTERP_SMOKE_E2E='1'
.\.venv\Scripts\python.exe scripts\smoke_mvp.py
Remove-Item Env:\BETTERP_SMOKE_CAPA_ID
Remove-Item Env:\BETTERP_SMOKE_WRITE
Remove-Item Env:\BETTERP_SMOKE_WRITE_CONFIRM
Remove-Item Env:\BETTERP_SMOKE_WRITE_ALLOWED_CAPA_ID
Remove-Item Env:\BETTERP_SMOKE_E2E
```

Guardar el resultado de `tmp\smoke-report.json` como evidencia interna del
go-live. No ejecutar escritura reversible contra capas de clientes reales; el
flujo crea, actualiza y elimina datos temporales de reglas, conciliacion, CxP y
cliente smoke.

## 3. Crear capa del cliente

- Crear la capa del cliente en produccion desde el flujo normal de registro,
  checkout o backoffice interno.
- Confirmar que la capa queda separada de cualquier capa demo/smoke.
- Confirmar plan, periodicidad, estatus y limites:
  - Usuarios.
  - Entidades.
  - Espacios.
  - Batch import.
  - Backups.
  - Integraciones.
- Crear usuarios iniciales:
  - Fundador o responsable: `OWNER_ADMIN`.
  - Operacion diaria: `OPERADOR`.
  - Lectores externos: `CONSULTA`.
- Confirmar desde `GET /api/accounts/permisos/` o UI de configuracion que cada
  usuario ve las capacidades esperadas.
- Revisar auditoria si algun acceso falla: `ACCESO_DENEGADO` indica rol
  insuficiente; `PLAN_MODULO_DENEGADO` o `PLAN_FUNCION_DENEGADA` indican que el
  plan no incluye esa capacidad.

## 4. Configuracion operativa base

Completar onboarding de la capa:

- Paso 1: datos generales y contacto.
- Paso 2.1: cobro, gracia y aplicacion de pagos.
- Paso 2.2: reglas heredables necesarias.
- Paso 3: migracion de clientes y espacios si aplica.
- Paso 4: CxP manual o batch si aplica.
- Paso 5: datos fiscales y facturacion.
- Paso 6: conciliacion.
- Paso 7: cobranza y portal cliente.

Confirmar minimo operativo:

- Al menos una entidad/unidad de negocio activa.
- Tipos de espacio correctos.
- Clientes cargados con RFC, correo, telefono y regimen cuando aplique.
- Contratos digitales subidos si el cliente los usara.
- Espacios y asignaciones activas revisadas.
- CxC inicial revisada contra saldos del cliente.
- CxP inicial revisada si se usara control de gastos.
- Cuenta bancaria de conciliacion creada.
- Portal cliente probado con un cliente real autorizado.

## 5. Cobranza, WhatsApp y correo

- Confirmar remitente Resend para correos transaccionales.
- Confirmar texto de recordatorios y tono del cliente.
- Ejecutar cobranza en modo preview antes de activar envios.
- Ejecutar dry-run de recordatorios:

```powershell
.\.venv\Scripts\python.exe backend\manage.py procesar_recordatorios --dry-run
```

- Confirmar que no hay candidatos incorrectos.
- Activar automatizaciones solo cuando:
  - Plantillas WhatsApp estan aprobadas.
  - Telefono del cliente esta confirmado.
  - Saldos y fechas de vencimiento estan revisados.

## 6. Backups y restore

Antes de entregar acceso:

- Generar backup de la capa desde backoffice o comando.
- Confirmar que aparece en historial con estatus exitoso.
- Validar restore del backup desde backoffice con doble confirmacion.
- Guardar:
  - Fecha.
  - Capa.
  - Responsable.
  - Motivo: `go-live primer cliente`.
  - Checksum del backup.

Comando alternativo:

```powershell
.\.venv\Scripts\python.exe backend\manage.py export_capa_backup --capa-id ID_CAPA --upload-r2 --generated-by "go-live-primer-cliente"
```

## 7. Revision en backoffice

En backoffice interno revisar:

- Salud operativa sin alertas criticas.
- Webhooks Stripe sin fallas recientes.
- Backups recientes exitosos.
- Web Vitals con muestras y sin rutas sensibles.
- Errores frontend sin picos nuevos.
- Auditoria con eventos esperados de alta/configuracion.
- Suscripcion del cliente correcta.
- Limites de plan suficientes para la carga inicial.

## 8. Aceptacion con el cliente

Hacer una sesion guiada de aceptacion:

- Login del administrador del cliente.
- Revision de dashboard.
- Entidades y espacios.
- Clientes.
- CxC y estado de saldos.
- Portal cliente de muestra.
- Carga de evidencia de pago de prueba si aplica.
- Conciliacion con archivo o movimiento de ejemplo si aplica.
- Export de backup desde cuenta/admin si aplica.

Registrar aprobacion con:

- Nombre del responsable del cliente.
- Fecha y hora.
- Alcance aceptado.
- Pendientes no bloqueantes.
- Fecha de siguiente revision.
- Cierre `Go-live` guardado en `Backoffice > Clientes SaaS`.

## 9. Primer dia de operacion

Durante las primeras 24 horas:

- Revisar health/backoffice al inicio y cierre del dia.
- Revisar eventos de auditoria.
- Revisar errores frontend.
- Revisar webhooks de billing si hubo pago.
- Revisar recordatorios antes de permitir envios automaticos masivos.
- Confirmar que el cliente pudo entrar y operar.
- Documentar cualquier ajuste de configuracion realizado.

## 10. Cierre de go-live

Se considera cerrado cuando:

- Smoke productivo posterior al go-live esta OK.
- Backup post-configuracion generado y validado.
- Cliente confirma acceso y datos base.
- No hay errores criticos en salud operativa.
- Automatizaciones sensibles quedan activadas o documentadas como pendientes.
- Soporte interno sabe quien atiende incidentes del cliente.
- El registro de go-live de la capa esta en `Aprobado` o `Aprobado con pendientes`.

Plantilla de cierre:

```md
Go-live cliente:
- Capa:
- Plan:
- Fecha:
- Responsable BetterP:
- Responsable cliente:
- Smoke previo:
- Smoke posterior:
- Backup R2:
- Restore validado:
- Automatizaciones activas:
- Pendientes:
- Decision: Aprobado / Aprobado con pendientes / No aprobado
```
