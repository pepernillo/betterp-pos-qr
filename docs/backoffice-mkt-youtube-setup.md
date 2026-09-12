# YouTube autonomo desde Backoffice MKT

Esta integracion permite conectar un canal de YouTube, adjuntar un video a una
campana y dejar que el publicador de Backoffice MKT lo cargue en la fecha
programada. El mismo motor que ya procesa Meta y LinkedIn registra el resultado
por destino y conserva el enlace del video.

## Flujo operativo

1. En Google Cloud se crea o selecciona un proyecto propiedad de BetterP.
2. Se habilita `YouTube Data API v3`.
3. Se configura la pantalla de consentimiento OAuth y se agregan los scopes:
   - `https://www.googleapis.com/auth/youtube.upload`
   - `https://www.googleapis.com/auth/youtube.readonly`
4. Se crea un cliente OAuth de tipo `Aplicacion web` con este redirect exacto:
   `https://api.betterp.net/api/billing/admin/youtube/callback/`.
5. Las credenciales se guardan como variables de entorno en Vultr; nunca en el
   repositorio.
6. En `/backoffice/marketing`, dentro de `Conexiones`, se presiona
   `Conectar con YouTube` y se autoriza el canal correcto.
7. La campana se crea con destino YouTube y un video MP4, MOV, M4V o WebM.
8. Al revisar/enviar o al llegar la fecha programada, BetterP renueva el token,
   carga el video y guarda su ID, URL y privacidad.

## Variables de produccion

```env
BACKOFFICE_YOUTUBE_CLIENT_ID=
BACKOFFICE_YOUTUBE_CLIENT_SECRET=
BACKOFFICE_YOUTUBE_REDIRECT_URI=https://api.betterp.net/api/billing/admin/youtube/callback/
BACKOFFICE_YOUTUBE_SCOPES=https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly
BACKOFFICE_YOUTUBE_DEFAULT_PRIVACY=private
BACKOFFICE_YOUTUBE_CATEGORY_ID=28
BACKOFFICE_YOUTUBE_UPLOAD_TIMEOUT=900
BACKOFFICE_MARKETING_VIDEO_MAX_BYTES=536870912
```

`GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` funcionan como respaldo, pero se
recomiendan credenciales separadas para Backoffice MKT para aislar permisos y
rotaciones.

## Privacidad y verificacion

El valor seguro inicial es `private`. Los proyectos que usan el endpoint de
carga de YouTube y no han completado la verificacion/auditoria de Google pueden
quedar restringidos a cargas privadas. Cambiar a `unlisted` o `public` solo
despues de validar el proyecto en produccion y confirmar que Google permite esa
visibilidad.

## Contrato de campana

- YouTube requiere al menos un video valido asociado a la campana.
- El titulo usa el titulo de la campana, limitado a 100 caracteres.
- La descripcion usa el copy, CTA y enlace con tracking, limitada a 5,000
  caracteres.
- Los tags opcionales viven en `campana.metadata.youtube_tags`.
- La carga se realiza una sola vez por destino; el destino conserva
  `external_id` para evitar ambiguedad y permitir abrir el video.
- Un error en YouTube no duplica las publicaciones exitosas de otros canales.

## Prueba de aceptacion

1. Conectar el canal y confirmar que aparece activo y habilitado para publicar.
2. Crear una campana de prueba con YouTube como unico destino y un video corto.
3. Publicarla inicialmente como `private`.
4. Confirmar en MKT que el destino queda `PUBLICADA` y tiene URL.
5. Abrir YouTube Studio y confirmar titulo, descripcion, archivo y privacidad.
6. Ejecutar una segunda prueba programada para validar el cron y la renovacion
   del token sin volver a iniciar sesion.

## Siguiente proveedor: TikTok

TikTok necesita una app propia, Content Posting API, OAuth y aprobacion para
publicacion directa. La estructura de campanas y videos ya queda preparada,
pero ese proveedor no debe marcarse como autonomo hasta completar su registro,
revision y una prueba real con la cuenta de BetterP.
