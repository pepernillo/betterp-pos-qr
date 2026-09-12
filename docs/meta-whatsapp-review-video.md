# Guion para video de revision Meta WhatsApp

Ultima actualizacion: 2026-06-19

Este documento prepara el video final para la revision de permisos de Meta en
BetterP Comunicaciones. El objetivo es mostrar, sin exponer datos sensibles, que
BetterP usa WhatsApp Cloud API para mensajes transaccionales de cobranza con
plantillas aprobadas, consentimiento, seguridad, trazabilidad y limites antiuso
abusivo.

Referencias oficiales:

- App Review para WhatsApp: https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/app-review/
- Envio de mensajes con Cloud API: https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-messages
- Plantillas de WhatsApp: https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/

## Permisos a justificar

### `whatsapp_business_messaging`

BetterP lo usa para enviar mensajes de WhatsApp con plantillas aprobadas por
Meta. Los mensajes son transaccionales y operativos: recordatorios de pago,
acuse de comprobantes, pagos parciales y acceso seguro al portal de
autoservicio.

No se usa para texto libre, spam, promociones no solicitadas ni mensajes sin
relacion con una cuenta por cobrar.

### `whatsapp_business_management`

BetterP lo usa para administrar y sincronizar activos necesarios de WhatsApp
Business Platform: cuenta WABA, numero oficial, estados de plantillas, idioma,
categoria y disponibilidad operativa. Esto permite bloquear reglas si una
plantilla no esta aprobada o si el canal oficial no esta listo.

## Antes de grabar

- Usar solo la capa `Maya Coliving` y el entorno productivo real de prueba.
- Usar un cliente demo con tu numero personal autorizado en allowlist.
- Preparar o refrescar el cliente/CxC demo con:

```bash
python manage.py preparar_demo_cobranza_meta --entidad-nombre "Arquitectura 44" --telefono 525551087058
```

- No abrir variables de entorno, tokens, secretos, Render, consola de Meta ni
pantallas con access tokens.
- Cerrar DevTools, extensiones visibles y notificaciones ajenas.
- Confirmar en `Cobranza > Preparacion` que:
  - las plantillas aparecen `6/6`;
  - la zona segura muestra el numero permitido;
  - no hay reglas bloqueadas por plantilla;
  - el laboratorio esta limitado a `01.agodinez@gmail.com`.
- Tener WhatsApp abierto en el movil o en WhatsApp Web para mostrar el mensaje
recibido.

## Toma recomendada

Duracion sugerida: 2 a 4 minutos.

| Tiempo | Pantalla | Que mostrar | Narrativa sugerida |
| --- | --- | --- | --- |
| 0:00-0:20 | Login BetterP | Entrar con usuario autorizado | "Entramos a BetterP como usuario autorizado para operar cobranza de Maya Coliving." |
| 0:20-0:45 | Cobranza > Preparacion | 6/6 plantillas, zona segura, allowlist | "El sistema solo permite plantillas aprobadas por Meta y, en modo laboratorio, solo envia al numero seguro autorizado." |
| 0:45-1:15 | Cobranza > Mensajes | Seleccionar cliente demo y plantilla aprobada | "El operador no escribe texto libre. Selecciona una plantilla controlada y revisa la vista previa." |
| 1:15-1:35 | Vista previa | Mostrar monto, periodo, referencia y portal | "El mensaje incluye datos transaccionales de una cuenta por cobrar y el link de autoservicio seguro." |
| 1:35-1:55 | Enviar prueba segura | Enviar al numero autorizado | "El envio se realiza por WhatsApp Cloud API usando el numero oficial de BetterP." |
| 1:55-2:20 | WhatsApp movil/web | Mostrar mensaje recibido | "Aqui se confirma la recepcion en WhatsApp desde el numero oficial." |
| 2:20-2:45 | Historial de envios | Mostrar estado enviado y auditoria | "BetterP guarda trazabilidad del envio: cliente, canal, plantilla, estado y fecha." |
| 2:45-3:10 | Reintento o historial de omitidos | Mostrar bloqueo de 24 horas o allowlist | "Para evitar abuso, el sistema bloquea mensajes repetidos al mismo cliente en menos de 24 horas y omite destinos no autorizados en laboratorio." |
| 3:10-3:40 | Automatizacion | Mostrar switches y reglas | "Las automatizaciones usan reglas por etapa y plantillas aprobadas; no permiten mensajes fuera de fecha, fuera de ventana o sin consentimiento." |
| 3:40-4:00 | Portal cliente | Mostrar OTP/consentimiento si cabe | "El portal protege los datos del cliente con OTP y consentimiento antes de mostrar informacion de cuenta." |

## Texto corto para narrar

> BetterP usa WhatsApp Cloud API para comunicacion transaccional de cobranza.
> Los mensajes se envian con plantillas aprobadas por Meta y no pueden ser
> editados libremente por los clientes de BetterP. El sistema valida
> consentimiento, no contactar, ventanas de cobranza, bloqueo de 24 horas,
> allowlist de laboratorio y trazabilidad antes de enviar. En este video se
> muestra un envio real a un numero autorizado de prueba y su registro en el
> historial operativo.

## Respuesta sugerida para el formulario de Meta

### Descripcion de la empresa

BetterP es una plataforma SaaS para administracion operativa de negocios,
cuentas por cobrar, pagos, facturacion y comunicaciones transaccionales con
clientes.

### Uso de `whatsapp_business_messaging`

La aplicacion envia mensajes de WhatsApp mediante plantillas aprobadas por Meta
para recordatorios de pago, acuses de comprobantes, pagos parciales y acceso al
portal de autoservicio. Los mensajes estan relacionados con cuentas por cobrar
existentes y se envian solo a contactos autorizados por la empresa cliente, con
controles de consentimiento, no contactar, ventana operativa y bloqueo de
mensajes repetidos.

### Uso de `whatsapp_business_management`

La aplicacion consulta y sincroniza activos de WhatsApp Business Platform como
cuentas WABA, numeros oficiales y estados de plantillas. Esta informacion se usa
para bloquear envios cuando una plantilla no esta aprobada o cuando el canal no
esta listo.

### Tratamiento de datos

BetterP procesa datos necesarios para cobranza transaccional: nombre del
cliente, telefono, saldo, referencia, periodo de pago, comprobantes y estado de
cuenta. No vende datos ni los usa para publicidad. Los accesos al portal se
protegen con OTP y consentimiento.

## Que no debe verse en el video

- Tokens de Meta, Render, Facturama, Google Vision, R2, Stripe o claves API.
- Pantallas de variables de entorno.
- Numeros telefonicos o datos fiscales de clientes reales.
- Consola del navegador con errores o respuestas de API.
- Plantillas o clientes reales fuera del laboratorio.

## Validacion despues de grabar

- El video muestra un envio real exitoso.
- Se ve el mensaje recibido en WhatsApp.
- Se ve historial o auditoria dentro de BetterP.
- Se ve que no hay texto libre.
- Se ve que hay controles: plantillas aprobadas, allowlist, consentimiento,
  no contactar, cooldown de 24 horas o reglas de automatizacion.
- El archivo no expone secretos.

## Pendientes despues del video

1. Subir el video en la solicitud de revision de Meta.
2. Pegar la respuesta de uso permitido del permiso.
3. Confirmar que la app queda publicada.
4. Mantener el cron de cobranza con limites bajos hasta terminar el piloto Maya
   Coliving.
