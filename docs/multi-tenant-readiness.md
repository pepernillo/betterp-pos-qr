# BettERP: Ruta para vender a multiples clientes

## Objetivo

Preparar BettERP para operar varias suscripciones sobre la misma aplicacion, separando datos por `CapaNegocio` y dejando una base tecnica que permita crecer sin mezclar informacion entre clientes.

## Estado actual

- La base multi-cliente ya existe: `CapaNegocio`, membresias por usuario, roles y selector de capa activa.
- El frontend envia `X-BettERP-Capa-ID` en las llamadas al backend.
- Los modulos principales ya filtran gran parte de su informacion por entidades permitidas de la capa activa.
- Billing ya tiene modelos de plan y suscripcion por capa, aunque todavia requiere cerrar limites y automatizacion comercial.

## Cambios aplicados en esta etapa

- `EntidadNegocio.nombre_comercial` dejo de ser unico global.
- El nombre de entidad ahora es unico dentro de cada capa de negocio.
- Las CxC y CxP ahora permiten referencias repetidas entre distintas entidades, evitando colisiones entre clientes.
- La plantilla batch de clientes queda filtrada por entidades permitidas del usuario.
- La importacion batch de clientes ya no puede resolver clientes o entidades fuera de la capa activa.
- Se agregaron indices para consultas frecuentes por capa, entidad, estatus, fechas, cliente, telefono, identificador y movimientos bancarios.
- La configuracion de comunicaciones y las plantillas de mensajes ahora viven por capa de negocio.
- Las automatizaciones y canales permitidos usan la configuracion de comunicaciones de la capa activa.
- Los webhooks entrantes de Green API ya resuelven la configuracion por token, instancia o canal permitido antes de procesar mensajes.
- Los webhooks entrantes de WhatsApp Cloud ya resuelven la configuracion por la capa del numero oficial receptor.
- Los webhooks entrantes ya se encolan en un worker persistente en vez de crear threads desde el request HTTP.
- La carga batch de clientes ya puede procesarse en background conservando el alcance de entidades de la capa activa.
- La carga batch de fichas de renta ya puede procesarse en background conservando el alcance de entidades de la capa activa.
- La carga batch de CxC ya puede procesarse en background conservando periodo, vencimiento default y entidades de la capa activa.
- La carga batch de CxP ya puede procesarse en background conservando formato, periodo, vencimiento default y entidades de la capa activa.
- La carga de estados de cuenta bancarios ya puede procesarse en background conservando cuenta, saldos, periodo y capa activa.
- Billing ya cuenta con una bitacora de consumos por capa y periodo para cuantificar extras: tokens OpenAI, comprobantes por WhatsApp, mensajes WhatsApp, emails, timbres de facturacion y futuras lecturas de PDF.
- Los planes SaaS ya pueden definir incluidos y precio de excedente para consumos operativos, permitiendo armar un estado de cuenta mensual de extras.

## Pendientes antes de vender autoservicio

1. Resolver correo entrante multi-capa, identificando la capa por dominio, alias, token o bandeja conectada.
2. Cerrar un flujo formal de alta de cliente: crear capa, owner, plan, limites, entidades iniciales e invitaciones.
3. Activar enforcement de limites por plan: entidades, espacios, usuarios, bancos, mensajes, conciliaciones, canales y consumos incluidos.
4. Agregar pruebas automatizadas de aislamiento por modulo critico.
5. Conectar el consumo detallado con Stripe u otro motor de facturacion para cobrar excedentes automaticamente.
6. Migrar las siguientes cargas pesadas al worker: lecturas PDF adicionales y reportes.
7. Agregar monitoreo, logs de errores y backups verificados.

## Consumos extra recomendados

- Tokens OpenAI usados en lectura de comprobantes, OCR, clasificacion y asistentes.
- Comprobantes recibidos por WhatsApp y convertidos en evidencia operativa.
- Mensajes de WhatsApp salientes para cobranza, recordatorios y confirmaciones.
- Emails salientes con avisos, estados de cuenta y links de portal.
- Timbres CFDI emitidos desde el portal o por administracion.
- Lecturas de PDF bancario o cargas pesadas que consuman procesamiento.
- Publicaciones o sincronizaciones hacia marketplaces cuando se activen canales externos.

## Escalabilidad recomendada

- PostgreSQL administrado en produccion.
- Backend Django con Gunicorn y multiples workers.
- Redis + Celery para procesos pesados.
- Paginacion obligatoria en tablas de clientes, movimientos, CxC, CxP y comunicaciones.
- Indices por capa/entidad/estatus/fecha en tablas operativas.
- Rate limit en login, webhooks, cargas e importaciones.
- Backups diarios y restauracion probada.
- Monitoreo de errores y tiempos de respuesta.

## Regla comercial sugerida

Vender primero como implementacion guiada, no como autoservicio abierto. Cada nuevo cliente debe pasar por diagnostico, configuracion inicial y validacion de datos antes de activar uso operativo.
