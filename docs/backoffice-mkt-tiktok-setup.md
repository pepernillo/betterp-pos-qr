# TikTok para Backoffice MKT

## Objetivo

Conectar una cuenta controlada de TikTok y publicar videos de campañas mediante
Content Posting API. El primer cierre se prueba con privacidad `SELF_ONLY`; la
publicacion publica depende de la auditoria de TikTok.

## Configuracion de la app

1. Crear una app en TikTok for Developers.
2. Agregar Login Kit y Content Posting API.
3. Registrar exactamente este redirect:
   `https://api.betterp.net/api/billing/admin/tiktok/callback/`.
4. Solicitar `user.info.basic`, `video.list`, `video.upload` y `video.publish`.
5. Guardar el Client Key y Client Secret solamente como secretos del servidor.

Variables de produccion:

```dotenv
BACKOFFICE_TIKTOK_CLIENT_KEY=
BACKOFFICE_TIKTOK_CLIENT_SECRET=
BACKOFFICE_TIKTOK_REDIRECT_URI=https://api.betterp.net/api/billing/admin/tiktok/callback/
BACKOFFICE_TIKTOK_SCOPES=user.info.basic video.list video.upload video.publish
BACKOFFICE_TIKTOK_DEFAULT_PRIVACY=SELF_ONLY
BACKOFFICE_TIKTOK_UPLOAD_TIMEOUT=900
```

## Prueba privada obligatoria

1. En `Backoffice > Marketing > Conexiones`, elegir `Conectar con TikTok`.
2. Autorizar la cuenta correcta.
3. Crear una campaña con un video MP4 y destino TikTok.
4. Elegir `Solo yo`.
5. Programarla al menos diez minutos hacia el futuro.
6. Verificar que el publicador la procese y que el sincronizador confirme el
   estado final.
7. Confirmar el video en la app de TikTok y documentar la evidencia.

## Automatizacion

- `publish_marketing_campaigns` procesa campañas vencidas cada cinco minutos.
- `sync_tiktok_publications` consulta dos minutos despues las cargas que TikTok
  mantiene en procesamiento.
- Ambos comandos usan `flock`, generan `CronRunLog` y tienen modo `--dry-run`.

## Salida publica

No cambiar el valor global a publico como atajo. Primero completar la auditoria
de Content Posting API y confirmar que `creator_info` devuelve
`PUBLIC_TO_EVERYONE` para la cuenta conectada.
