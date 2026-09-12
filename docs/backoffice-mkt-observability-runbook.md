# Observabilidad Backoffice MKT

Este runbook ayuda a diagnosticar fallas de Backoffice MKT durante una semana
comercial de Renta Facil. Usarlo cuando falle publicar, conectar Meta, importar
metricas, subir creativos, generar contenido, sincronizar inbox o capturar leads.

## Principios

- Primero confirmar impacto comercial: publicacion detenida, lead perdido,
  metrica incompleta o solo warning operativo.
- No borrar campanas, destinos, creativos ni prospectos como primer paso.
- No pegar tokens, payloads completos de Meta ni datos personales en tickets o
  chats. Guardar solo IDs, estados, hora, ruta y mensaje resumido.
- Si la accion comercial de hoy depende de Meta y Meta esta caido, usar
  workaround manual y registrar la causa.

## Fuentes de evidencia

| Fuente | Donde mirar | Para que sirve |
| --- | --- | --- |
| Backoffice MKT | `/backoffice/marketing` | Estado de campanas, destinos, creativos, metricas, learning y prospectos. |
| Backoffice Salud | `/backoffice/salud` | Crons, requests lentos/fallidos, errores frontend, deploy y estado operativo. |
| `CronRunLog` | Modelo `billing.CronRunLog` | Evidencia de `publish_marketing_campaigns` y `sync_contact_inbox`. |
| `CampanaMarketingDestino` | `estatus`, `detalle`, `payload`, `external_id` | Resultado por red: publicada, en cola, requiere config o error. |
| `CampanaMarketing.metadata.last_launch` | Metadata de campana | Resumen de ultimo disparo: publicados, en cola, bloqueados y errores. |
| `RedSocialConfig` | Canal Backoffice Meta | Token, `page_id`, `permite_publicar`, metadata de conexion y fecha. |
| `ProspectoComercial.metadata` | Prospectos comerciales | UTM, solucion solicitada/resuelta y calificacion del lead. |
| `EventoAuditoria` | Auditoria | Bloqueos por permiso, modulo, funcion, canal o limite. |
| `BackendRequestMetric` | Salud/requests | Rutas 4xx/5xx o lentas sin guardar payload sensible. |
| `FrontendClientError` | Salud/frontend | Errores JS o React capturados desde el navegador. |
| Logs Docker en Vultr | Backend scheduler/API | Trazas de excepciones, variables faltantes, timeouts o errores de proveedor. |

## Rutina diaria de 5 minutos

1. Abrir `/backoffice/salud` y revisar `Crons`, `Requests backend` y errores
   frontend de las ultimas 24 horas.
2. Confirmar que el cron `backoffice_marketing_publish_queue` no este en
   `ERROR`, `MISSING`, `STALE` o `RUNNING` fuera de ventana.
3. Abrir `/backoffice/marketing` y revisar:
   - campanas programadas o en cola;
   - destinos con `ERROR` o `REQUIERE_CONFIG`;
   - leads nuevos sin contacto;
   - metricas de la semana con fecha de corte.
4. Si hubo publicacion reciente, confirmar que cada destino tenga `PUBLICADA`,
   `LISTA`, `ERROR` o `REQUIERE_CONFIG` con detalle claro.
5. Si hubo leads nuevos, confirmar `solution_key`, UTM y calificacion.
6. Registrar una nota breve:

```text
Fecha:
Responsable:
Cron MKT:
Publicaciones con error:
Leads nuevos:
Metricas pendientes:
Accion tomada:
Riesgo para venta:
```

## Publicacion programada o cron fallido

Indicadores:

- `/backoffice/salud` marca el cron de Marketing en `ERROR`, `MISSING`,
  `STALE` o `RUNNING` demasiado tiempo.
- La campana sigue `PROGRAMADA` aunque `programada_en` ya vencio.
- `CampanaMarketing.metadata.last_launch.errors` o `blocked` es mayor a cero.

Donde revisar:

- `CronRunLog.key = backoffice_marketing_publish_queue`.
- `CronRunLog.summary`, por ejemplo:
  `marketing_publish reviewed=... published=... queued=... blocked=... errors=...`.
- `CronRunLog.metadata.items` para ver campanas procesadas.
- `CampanaMarketingDestino.detalle` y `payload.error`.
- Logs del scheduler en Vultr con `docker compose logs betterp-scheduler`.

Accion:

1. Si el cron esta `MISSING`, revisar su definición en el scheduler de Vultr y ejecutar el comando controlado:

```bash
python backend/manage.py publish_marketing_campaigns --limit 10 --fail-on-error
```

2. Si esta `ERROR`, abrir el ultimo `CronRunLog.error` y los logs Docker del scheduler.
3. Si hay destinos `REQUIERE_CONFIG`, revisar canal activo, `permite_publicar`,
   `page_id` y `access_token`.
4. Si hay destinos `ERROR`, leer `detalle` antes de reintentar.
5. Si la publicacion es urgente, publicar manualmente en la red y dejar la
   campana con nota operativa.

Cierre:

- Cron en `SUCCESS` o causa documentada.
- Campana con resultado por destino.
- Si hubo workaround manual, registrar fecha, canal y link publicado.

## Meta OAuth Backoffice

Indicadores:

- El boton de conectar Meta regresa error.
- El callback vuelve a `/backoffice/marketing?meta=error`.
- No aparecen paginas de Facebook o cuentas de Instagram.

Donde revisar:

- Mensaje `detail` en el redirect de callback.
- Variables `BACKOFFICE_META_APP_ID`, `BACKOFFICE_META_APP_SECRET` y
  `BACKOFFICE_META_REDIRECT_URI`.
- Redirect publico configurado en Meta:
  `https://api.betterp.net/api/billing/admin/meta/callback/`.
- `RedSocialConfig.metadata.last_connected_at` y `connected_by_user_id`.
- Logs de `betterp-api` en Vultr alrededor de `/api/billing/admin/meta/callback/`.

Accion:

1. Confirmar que el usuario sea `platform_admin`.
2. Confirmar que la app de Meta tenga el redirect exacto.
3. Reintentar conexion desde Backoffice MKT.
4. Si Meta no devuelve paginas, revisar permisos del usuario en Meta Business.
5. Si la app esta en modo desarrollo, usar usuario con rol permitido.
6. Para importar comentarios, solicitar acceso avanzado a
   `pages_read_user_content` y `instagram_manage_comments`, y despues
   reconectar Meta para emitir un token nuevo. La bandeja conserva
   `REQUIRES_PERMISSION` hasta validar una lectura real del proveedor.

Cierre:

- Facebook/Instagram aparecen como activos.
- El canal tiene `page_id`, `access_token`, `activo=true` y
  `permite_publicar=true`.

## LinkedIn OAuth Backoffice

Indicadores:

- El boton de conectar LinkedIn regresa error.
- El callback vuelve a `/backoffice/marketing?linkedin=error`.
- No aparece un canal `LINKEDIN` con provider `LINKEDIN`.

Donde revisar:

- Mensaje `detail` en el redirect de callback.
- Variables `BACKOFFICE_LINKEDIN_CLIENT_ID`,
  `BACKOFFICE_LINKEDIN_CLIENT_SECRET`, `BACKOFFICE_LINKEDIN_REDIRECT_URI` y
  `BACKOFFICE_LINKEDIN_SCOPES`.
- Redirect publico configurado en LinkedIn:
  `https://api.betterp.net/api/billing/admin/linkedin/callback/`.
- BetterP opera en modo **solo organizacion**. El scope recomendado es
  `openid profile rw_organization_admin w_organization_social r_organization_social r_organization_social_feed w_organization_social_feed`.
- `BACKOFFICE_LINKEDIN_ORGANIZATION_URNS` queda como fallback controlado; el
  flujo normal descubre automaticamente las organizaciones aprobadas mediante
  `organizationAcls`.
- Nunca habilitar `w_member_social` en la app de BetterP: el sistema desactiva
  y elimina las credenciales de canales personales previamente importados.

Accion:

1. Confirmar que el usuario sea `platform_admin`.
2. Confirmar que la app tenga OIDC y el producto Community Management aprobado.
3. Reintentar conexion desde Backoffice MKT.
4. Si es pagina empresa, confirmar que Community Management/alcances de
   organizacion esten aprobados y que el usuario sea admin de la pagina.

Cierre:

- LinkedIn aparece como `LINKEDIN_ORGANIZATION`, con access ok y
  `permite_publicar=true`; ningun `LINKEDIN_MEMBER` queda publicable.
- Una publicacion de prueba queda `PUBLICADA` y con `external_id`.
- `sync_marketing_metrics` registra snapshots con fuente
  `linkedin_organization_api`.

## Bandeja social unificada

Cobertura automatica:

- Facebook e Instagram: comentarios de publicaciones mediante Graph API una
  vez aprobados `pages_read_user_content` e `instagram_manage_comments`.
- YouTube: comentarios y respuestas mediante YouTube Data API.
- LinkedIn: comentarios de publicaciones de la pagina BetterP mediante
  Community Management.
- TikTok: Content Posting y Display API no ofrecen comentarios ni mensajes
  privados; el dashboard lo marca expresamente como no disponible.

La pestaña `Bandeja social` consume
`GET /api/billing/admin/marketing/`, permite sincronizar con
`POST /api/billing/admin/marketing/social-inbox/sync/` y conserva los estados
`PENDING`, `READ`, `ANSWERED` y `ARCHIVED`. El cron
`sync_marketing_metrics` actualiza metricas y comentarios en la misma corrida.

Los mensajes privados no se declaran listos por inferencia: Facebook Messenger
e Instagram Messaging requieren productos, webhooks y revision adicional de
Meta; LinkedIn y YouTube no exponen una bandeja privada equivalente en estos
contratos, y TikTok no la incluye en Content Posting.

## YouTube OAuth y carga autonoma

Indicadores:

- El boton `Conectar con YouTube` regresa error.
- El callback vuelve a `/backoffice/marketing?youtube=error`.
- La campana queda en `ERROR` aunque el canal aparece conectado.
- El video se carga como privado cuando se esperaba una publicacion publica.

Donde revisar:

- Variables `BACKOFFICE_YOUTUBE_CLIENT_ID`,
  `BACKOFFICE_YOUTUBE_CLIENT_SECRET`, `BACKOFFICE_YOUTUBE_REDIRECT_URI` y
  `BACKOFFICE_YOUTUBE_DEFAULT_PRIVACY`.
- Redirect exacto en Google Cloud:
  `https://api.betterp.net/api/billing/admin/youtube/callback/`.
- Que el proyecto tenga habilitada `YouTube Data API v3`.
- Scopes `youtube.upload`, `youtube.readonly` y `youtube.force-ssl` en la
  pantalla de consentimiento. El ultimo es necesario para leer y responder
  comentarios; despues de agregarlo se debe reconectar YouTube.
- `RedSocialConfig.metadata.youtube_channel_id`, `token_expires_at` y
  `default_privacy_status`.
- `CampanaMarketingDestino.detalle`, `external_id` y `payload.video_url`.

Accion:

1. Confirmar que el usuario sea `platform_admin` y conectar el canal correcto.
2. Confirmar que la campana tenga un video MP4, MOV, M4V o WebM.
3. Si falta `refresh_token`, revocar el acceso anterior en Google y reconectar;
   el flujo solicita acceso offline y consentimiento explicito.
4. Si Google devuelve un error de proyecto no verificado, conservar
   `BACKOFFICE_YOUTUBE_DEFAULT_PRIVACY=private` hasta completar la auditoria de
   OAuth/YouTube. No intentar volver publico el video por fuera del contrato de
   la API.
5. Reintentar la campana solo despues de corregir canal, alcance o archivo.

Cierre:

- El destino queda `PUBLICADA`, con `external_id` y `payload.video_url`.
- El video aparece en YouTube Studio con la privacidad esperada.
- El cron puede renovar el token sin intervencion manual.

## TikTok OAuth, Direct Post y procesamiento

Indicadores:

- El boton `Conectar con TikTok` regresa error.
- El callback vuelve a `/backoffice/marketing?tiktok=error`.
- El destino queda `LISTA` demasiado tiempo o cambia a `ERROR`.
- La app solo permite `SELF_ONLY`.

Donde revisar:

- Variables `BACKOFFICE_TIKTOK_CLIENT_KEY`,
  `BACKOFFICE_TIKTOK_CLIENT_SECRET`, `BACKOFFICE_TIKTOK_REDIRECT_URI` y
  `BACKOFFICE_TIKTOK_DEFAULT_PRIVACY`.
- Redirect exacto en TikTok for Developers:
  `https://api.betterp.net/api/billing/admin/tiktok/callback/`.
- Que la app tenga Content Posting API, alcance `video.publish` y auditoria
  aprobada antes de intentar publicaciones publicas.
- `RedSocialConfig.metadata.tiktok_open_id`, `token_expires_at` y `scope`.
- `CampanaMarketingDestino.payload.publish_id`, `processing_status` y
  `status_response`.
- Evidencia de los crons `backoffice_marketing_publish_queue` y
  `backoffice_tiktok_publication_sync`.

Accion:

1. Conectar primero una cuenta controlada de TikTok.
2. Mantener `SELF_ONLY` y publicar un video de prueba privado.
3. Confirmar que el destino pasa de `LISTA` a `PUBLICADA` mediante el cron de
   estado.
4. Solicitar auditoria a TikTok con el flujo completo y sus pantallas de
   consentimiento.
5. Habilitar `PUBLIC_TO_EVERYONE` solamente cuando `creator_info` lo ofrezca.

Cierre:

- El token se renueva sin intervencion manual.
- El video privado aparece en la cuenta correcta.
- La campaña solo queda `PUBLICADA` cuando todos sus destinos terminaron.

## Publicacion Meta fallida

Indicadores:

- Destino queda en `ERROR`.
- Destino queda en `REQUIERE_CONFIG`.
- Instagram falla aunque Facebook publica.

Donde revisar:

- `CampanaMarketingDestino.detalle`.
- `CampanaMarketingDestino.payload.error`.
- `external_id` si hubo publicacion parcial.
- URL del creativo principal.
- Logs Docker de API o scheduler alrededor de la ruta de disparo.

Accion:

1. Para `REQUIERE_CONFIG`, reconectar canal o activar publicacion.
2. Para Facebook, confirmar `page_id` y token de pagina.
3. Para Instagram, confirmar `instagram_business_id`, token y creativo publico.
4. Si Instagram dice que requiere imagen publica, revisar R2/URL del activo.
5. Reintentar solo despues de corregir canal o creativo.

Cierre:

- Destino queda `PUBLICADA` o se documenta publicacion manual.
- La pieza no queda en estado ambiguo.

## Importacion de Meta insights

Indicadores:

- Boton `Meta` en metricas falla.
- No hay `external_id`.
- Las metricas importadas llegan en cero o parciales.

Donde revisar:

- `CampanaMarketingDestino.external_id`.
- `CampanaMarketingDestino.payload.meta_insights_import`.
- `manual_metrics.source`; debe ser `meta_insights` cuando importo.
- `manual_metrics.notes`, `period_start`, `period_end` y `traffic_type`.
- Errores parciales en `meta_insights_import.response_payload.partial_errors`.

Accion:

1. Si falta `external_id`, la pieza no fue publicada por Meta desde BetterP; usar
   captura manual.
2. Si falta token, reconectar canal.
3. Si Meta devuelve metricas parciales, conservar lo importado y capturar leads
   o gasto manualmente.
4. Si el periodo no corresponde a la semana, ajustar fecha de corte manual.

Cierre:

- `manual_metrics` actualizado con fuente, fecha, tipo de trafico y nota.
- Learning Loop recalculado despues de guardar/importar.

## Creativos y R2

Indicadores:

- Carga de creativo falla.
- Preview no muestra imagen.
- Instagram rechaza por imagen no publica.

Donde revisar:

- Error visible del endpoint de activos.
- `CampanaMarketingActivo.archivo.url`.
- URL resuelta en la respuesta del endpoint.
- Requests fallidos en `/backoffice/salud`.
- Configuracion de storage/R2 en el backend.

Accion:

1. Probar abrir la URL del creativo desde una ventana publica.
2. Si la URL no abre, revisar credenciales/bucket/R2 y firma de URL.
3. Re-subir el creativo final y moverlo al primer lugar.
4. Reintentar publicacion solo despues de confirmar preview.

Cierre:

- Galeria muestra el creativo.
- Preview por canal usa el activo correcto.
- Instagram puede leer una imagen publica.

## Generacion de contenido y Learning Loop

Indicadores:

- `Generar 7 dias`, `Generar con aprendizaje` o `Analizar IA` falla.
- El contenido sale vacio, repetido o fuera de criterio comercial.

Donde revisar:

- Mensaje del endpoint.
- Requests backend fallidos en Salud.
- Logs de `betterp-api` alrededor de `/billing/admin/marketing/content-engine/*` o
  `/billing/admin/marketing/learning/analyze/`.
- Metadata de campanas generadas: `engine_key`, `topic_slug`, `learning_action`,
  `editorial_matrix`, `creative_brief`.

Accion:

1. Si falla proveedor/timeout, reintentar una vez.
2. Si la cola activa ya tiene 7 piezas, revisar mensaje de omitidos antes de
   borrar.
3. Si el problema es calidad de copy, usar feedback editorial o regeneracion.
4. Si el learning parece pobre, capturar metricas y objeciones antes de volver a
   generar.

Cierre:

- Cola semanal con piezas revisables.
- Si se descarto una pieza, queda razon editorial.

## Leads publicos sin solucion o sin UTM

Indicadores:

- Lead entra, pero `solution_key` aparece vacio.
- El comparador no puede atribuir lead a UTM.
- Pauta genera leads fuera de perfil.

Donde revisar:

- `ProspectoComercial.metadata.requested_solution_key`.
- `ProspectoComercial.metadata.resolved_solution_key`.
- `ProspectoComercial.metadata.utm`.
- `ProspectoComercial.metadata.lead_qualification`.
- URL final del CTA publicado.

Accion:

1. Confirmar que la landing use `solutionKey="renta_facil"`.
2. Confirmar que el CTA publicado conserva `utm_source`, `utm_medium`,
   `utm_campaign` y `utm_content`.
3. Si falta UTM, corregir la campana y no usar esa pieza para pauta.
4. Si los leads son fuera de perfil, ajustar audiencia/copy antes de subir gasto.

Cierre:

- Lead con solucion resuelta, UTM y calificacion.
- Learning Loop puede atribuirlo a pieza/canal.

## Inbox comercial

Indicadores:

- `Sincronizar correo` falla.
- Correos o WhatsApp no aparecen en solicitudes.
- Salud marca cron de inbox en error.

Donde revisar:

- Endpoint `/billing/admin/sync-inbox/`.
- Cron `sync_contact_inbox`.
- Logs Docker del servicio BetterP afectado.
- Configuracion IMAP de `contacto@betterp.net`.

Accion:

1. Confirmar credenciales IMAP y host.
2. Ejecutar sync manual desde Backoffice.
3. Si falla proveedor, registrar seguimiento manual del lead.

Cierre:

- Inbox sincroniza o queda workaround manual documentado.

## Escalamiento

| Caso | Decision |
| --- | --- |
| Landing no captura leads | `NO GO` hasta corregir. |
| Meta no publica, pero se puede publicar manual | `GO CON RIESGO` con workaround. |
| Cron fallido y no hay responsable diario | `NO GO`. |
| Metricas Meta fallan, pero hay captura manual | `GO CON RIESGO`. |
| Learning Loop falla, pero cola y leads operan | `GO CON RIESGO`. |
| Leads sin UTM en pauta pagada | Pausar pauta hasta corregir tracking. |
| Publico fuera de perfil | No escalar presupuesto; ajustar audiencia/hook. |

## Evidencia minima de incidente

```text
Fecha/hora:
Ambiente:
Responsable:
Campana/destino/prospecto:
Ruta o cron:
Mensaje visible:
Estado tecnico:
Impacto comercial:
Accion tomada:
Pendiente:
Decision: GO / GO CON RIESGO / NO GO
```
