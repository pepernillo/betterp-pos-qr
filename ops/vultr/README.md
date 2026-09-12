# Contrato de release de BetterP en Vultr

Estos archivos versionan la parte del stack que identifica de forma inequívoca el
release servido por BetterP. No contienen secretos.

## Contrato

Cada release debe inyectar en API, scheduler y background worker:

- `BETTERP_GIT_COMMIT`: SHA completo de 40 caracteres.
- `BETTERP_DEPLOY_ID`: identificador único del release.
- `BETTERP_PLATFORM=vultr`.
- `BETTERP_RUNTIME=docker`.
- `BETTERP_LOG_BACKEND=docker-json-file`.
- `BETTERP_LOG_LOCATION=docker compose logs betterp-api`.

`deploy_release.sh` despliega siempre los tres procesos BetterP y
`release_preflight.sh` falla si una imagen o identidad no coincide. La instalación
en `/opt/betterp` se realiza como una operación explícita de infraestructura y no
como efecto secundario de un push a GitHub.

El scheduler monta exclusivamente `betterp.saas.cron` mediante
`compose.saas-scheduler.yaml`. El manifiesto contiene seis procesos: expiración
de trials, cambios de plan pendientes, publicación programada de marketing,
confirmación de publicaciones TikTok, sincronización horaria de métricas Meta y
reporte post go-live sin correo. Cada entrada usa `flock` y el preflight rechaza
expectativas activas de Render, keepalive, Vende Fácil o recordatorios.

El workflow `Backend Release Verification` no despliega ni llama a Render. Recibe
el SHA ya desplegado, espera que `/health/` lo exponga y ejecuta el smoke.
