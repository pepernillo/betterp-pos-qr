# Ruta de cierre del modulo de cobranza

Ultima actualizacion: 2026-06-20

Resumen de cierre y siguiente incursion:
[`cierre-cobranza-y-proxima-incursion.md`](cierre-cobranza-y-proxima-incursion.md).

Este documento sirve como tablero operativo para llevar el modulo de cobranza
de BetterP a una version lista para clientes reales. Maya Coliving queda como
laboratorio privado de BetterP porque contiene datos reales no aprobados por el
cliente para liberacion comercial; el primer go-live debe hacerse con otro
cliente que autorice sus datos y su operacion.

## Principio rector

Cobranza debe ayudar a recordar pagos sin convertirse en una herramienta de
acoso. Toda liberacion debe cumplir:

- mensajes con plantillas controladas;
- sin texto libre de clientes finales;
- consentimiento o base autorizada para contactar;
- bloqueo de contacto repetido en menos de 24 horas por cliente;
- trazabilidad completa de envios, omitidos y errores;
- modo prueba antes de liberar salidas reales.

## Estado actual

- [x] Empresa Meta verificada.
- [x] Numero BetterP conectado a WhatsApp Cloud API.
- [x] Webhook configurado.
- [x] Envio tecnico por Cloud API probado.
- [x] Variables productivas en Render configuradas.
- [x] Allowlist de seguridad para pruebas con numero personal.
- [x] Acuerdo legal de uso de comunicaciones por WhatsApp.
- [x] Envio manual asistido con plantillas.
- [x] Automatizaciones por reglas.
- [x] Historial de envios.
- [x] Historial de omitidos con motivo operativo visible.
- [x] Bloqueo de mensajes repetidos dentro de 24 horas por cliente.
- [x] Baja por WhatsApp con `BAJA`, `STOP` y `NO ENVIAR`, configurable por capa.
- [x] Portal cliente para saldo, comprobantes, datos fiscales y factura,
      probado completo con OTP, consentimiento y descarga/generacion fiscal.
- [x] Plantillas Meta aprobadas completas: 6 de 6.
- [ ] Video final para revision de Meta.
- [x] Modo prueba visible y administrable desde UI.
- [x] Opt-in/no contactar por cliente.
- [x] Comprobantes con flujo robusto de revision/aplicacion.
- [x] Onboarding operativo dentro del modulo.

## Estado de plantillas

La fase de prueba real y video puede avanzar con las seis plantillas operativas.
El portal cliente ya fue probado completo, por lo que sale de la ruta pendiente.

Plantillas listas:

- `betterp_pago_preventivo`: recordatorio antes del vencimiento.
- `betterp_pago_vence_hoy`: aviso el dia de vencimiento.
- `betterp_pago_gracia`: recordatorio dentro de periodo de gracia.
- `betterp_pago_atraso_avanzado`: aviso posterior a periodo de gracia.
- `betterp_pago_recibido`: acuse de comprobante/pago recibido.
- `betterp_pago_parcial_recibido`: acuse de pago parcial.

## Fase 1 - Go-live controlado de WhatsApp

Objetivo: dejar los envios reales bajo candados operativos antes de abrirlos a
clientes fuera del laboratorio.

Checklist:

- [x] Sincronizar plantillas Meta en BetterP.
- [x] Confirmar en BetterP que las 6 plantillas WhatsApp aparecen como
      `APROBADA`.
- [x] Validar candados de etapa por fecha:
      preventivo antes de vencimiento, vence hoy en fecha exacta, gracia solo
      dentro de gracia y recargo solo despues de gracia.
- [x] Mantener bloqueo de contacto repetido en menos de 24 horas por cliente.
- [x] Confirmar cron de Render para `procesar_recordatorios`.
- [x] Ejecutar dry-run con `--require-whatsapp-ready`.
- [x] Ejecutar primer envio real limitado a 1 destinatario en laboratorio seguro.
- [x] Mostrar en historial el motivo de omitidos y bloqueos.
- [x] Revisar historial, omitidos y WhatsApp recibido.

Criterio de aceptacion:

- Los envios respetan plantillas aprobadas, opt-in/no contactar cuando exista,
  allowlist si existe, ventanas por fecha y 24 horas por cliente.
- El cron corre sin errores.
- Los omitidos explican el motivo.

## Fase 2 - Video de validacion Meta

Objetivo: demostrar a Meta el uso real de `whatsapp_business_messaging` y, si
aplica, `whatsapp_business_management`.

Guion operativo: `docs/meta-whatsapp-review-video.md`.

Checklist:

- [x] Documentar guion, tomas y respuestas sugeridas para Meta.
- [x] Agregar comando seguro para preparar cliente y CxC demo de video.
- [x] Agregar preparacion del dataset demo desde la UI de laboratorio.
- [ ] Crear cliente demo con tu numero personal.
- [ ] Crear CxC demo con saldo, periodo, fecha y referencia.
- [ ] Entrar a BetterP con usuario de prueba.
- [ ] Abrir `Cobranza`.
- [ ] Seleccionar cliente demo.
- [ ] Seleccionar plantilla aprobada.
- [ ] Previsualizar mensaje.
- [ ] Enviar a tu numero.
- [ ] Mostrar WhatsApp recibido.
- [ ] Mostrar historial de envio en BetterP.
- [ ] Intentar reenviar y mostrar bloqueo de 24 horas.
- [ ] Mostrar que automatizaciones usan switches y plantillas definidas.

Criterio de aceptacion:

- El video muestra login, modulo de cobranza, envio real, recepcion y auditoria.
- No muestra tokens, datos sensibles ni clientes reales.
- Se ve que BetterP evita uso abusivo.

Comando de preparacion:

```bash
python manage.py preparar_demo_cobranza_meta --entidad-nombre "Arquitectura 44" --telefono 525551087058
```

Validacion previa sin escribir:

```bash
python manage.py preparar_demo_cobranza_meta --entidad-nombre "Arquitectura 44" --telefono 525551087058 --dry-run
```

Validacion de recordatorios sobre el set demo:

```bash
python manage.py procesar_recordatorios --capa-id 1 --fecha 2026-06-19 --dry-run --require-whatsapp-ready
```

## Fase 3 - Modo prueba seguro en BetterP

Objetivo: que las pruebas no dependan de terminal ni de memoria operativa.

Checklist:

- [x] Crear indicador visible de `Modo prueba WhatsApp`.
- [x] Mostrar numero permitido actual cuando exista allowlist.
- [x] Limitar laboratorio a `01.agodinez@gmail.com` en `Maya Coliving`.
- [x] Bloquear UI si se intenta enviar a numeros fuera de allowlist.
- [x] Permitir prueba real solo a numero autorizado.
- [x] Preparar cliente y CxC demo Meta desde `Preparacion`.
- [x] Permitir dry-run por fecha desde UI.
- [x] Mostrar resultado: reglas, candidatos y muestras por fecha.
- [x] Agregar historial de ultimas pruebas.

Criterio de aceptacion:

- Un usuario interno puede probar sin riesgo de enviar a clientes reales.
- La UI explica claramente si el sistema esta en sandbox/allowlist.
- Todo intento omitido queda registrado con razon.

## Fase 4 - Plantillas y reglas

Objetivo: asegurar que cada regla use solo plantillas controladas por BetterP y
que ninguna automatizacion quede activa con plantilla incompleta, rechazada o
mal sincronizada.

Plantillas base:

- `betterp_pago_preventivo`.
- `betterp_pago_vence_hoy`.
- `betterp_pago_gracia`.
- `betterp_pago_atraso_avanzado`.
- `betterp_pago_recibido`.
- `betterp_pago_parcial_recibido`.
- `betterp_portal_otp`.

Checklist:

- [x] Crear plantillas base administradas por BetterP.
- [x] Sincronizar estados desde Meta.
- [x] Bloquear activacion de reglas con plantilla WhatsApp no aprobada.
- [x] Bloquear edicion de textos libres por clientes cuando la gobernanza esta activa.
- [x] Mapear cada plantilla a su etapa de cobranza.
- [x] Probar ventanas por etapa en preview manual.
- [x] Mostrar en UI la razon cuando una regla no tiene candidatos por fecha.
- [x] Mostrar ultima sincronizacion Meta y estado por plantilla en una vista compacta.

Criterio de aceptacion:

- Un cliente no puede editar textos WhatsApp de cobranza.
- Una regla insegura queda bloqueada antes de enviar.
- La UI explica si una regla esta detenida por plantilla, fecha o permiso.

## Fase 5 - Comprobantes robustos

Objetivo: cerrar el ciclo: mensaje -> portal -> comprobante -> revision ->
aplicacion a CxC.

Checklist:

- [x] Bandeja de comprobantes con filtros por estado.
- [x] Aplicar comprobante a CxC desde la bandeja.
- [x] Soportar pago total y parcial.
- [x] Registrar evento financiero.
- [x] Marcar CxC como pagada/parcial/por conciliar.
- [x] Detectar posible duplicado por cliente, monto, fecha, referencia y archivo.
- [x] Guardar evidencia original.
- [x] Agregar lectura IA/OCR con confianza.
- [x] Exigir revision humana si confianza es baja.
- [x] Mostrar comprobantes en portal cliente.

Recomendacion tecnica:

- Usar IA + reglas. OCR puro no dara 98% estable con comprobantes bancarios
  variados.
- OCR extrae texto; IA estructura monto, fecha, referencia, banco, emisor y
  confianza.
- Reglas validan contra CxC, saldos, duplicados y tolerancias.

Criterio de aceptacion:

- Un comprobante subido desde portal se puede aplicar correctamente a una CxC.
- Los pagos parciales actualizan saldo sin cerrar indebidamente.
- Los duplicados no se aplican automaticamente.

## Fase 6 - Cumplimiento y proteccion

Objetivo: dejar trazabilidad y control legal/operativo para reducir riesgo de
mal uso.

Checklist:

- [x] Consentimiento obligatorio en portal cliente antes de usar autoservicio.
- [x] Acuerdo de uso para empresas que usan el numero BetterP.
- [x] OTP por WhatsApp antes de exponer datos del portal.
- [x] Agregar opt-in/no contactar editable por cliente.
- [x] Bloquear envio WhatsApp si no hay autorizacion.
- [x] Bloquear envio si `no contactar` esta activo.
- [x] Registrar auditoria cuando se cambie autorizacion.
- [x] Definir palabras de baja: `BAJA`, `STOP`, `NO ENVIAR`.
- [x] Permitir configurar si una baja por respuesta bloquea automaticamente o solo queda auditada.

Criterio de aceptacion:

- Ningun WhatsApp de cobranza sale sin autorizacion.
- Una baja bloquea futuros envios.
- El historial muestra por que se omitio el envio.

## Fase 7 - Automatizacion productiva

Objetivo: activar recordatorios reales con limites, horarios y reglas claras.

Checklist:

- [x] Definir ventanas de envio, por ejemplo 10:00 a 18:00.
- [x] Evitar domingos si el cliente lo requiere.
- [x] Definir maximos por corrida.
- [x] Definir maximos por capa.
- [x] Confirmar cron de Render.
- [x] Ejecutar dry-run con `--require-whatsapp-ready`.
- [x] Ejecutar primer envio real limitado a 1.
- [x] Revisar historial y WhatsApp recibido.
- [ ] Subir limite gradualmente.

Criterio de aceptacion:

- El cron corre sin errores.
- Los envios respetan plantillas aprobadas, opt-in, no contactar, allowlist si
  existe y ventana de 24 horas.
- Los omitidos explican el motivo.

## Fase 8 - Onboarding operativo dentro del modulo

Objetivo: reemplazar la guia estatica por un mini onboarding que prepare al
cliente antes de activar cobranza.

Pasos sugeridos:

1. Validar cartera CxC.
2. Validar clientes y telefonos.
3. Confirmar consentimiento/no contactar.
4. Aceptar acuerdo de uso.
5. Confirmar plantillas aprobadas.
6. Hacer prueba a numero autorizado.
7. Activar reglas de automatizacion.
8. Revisar comprobantes y aplicacion de pagos.

Checklist:

- [x] Crear vista de progreso por pasos.
- [x] Marcar pasos automaticamente cuando el sistema tenga evidencia.
- [x] Bloquear activacion real si hay bloqueantes.
- [x] Incluir enlaces directos a cada pantalla.
- [x] Guardar fecha local de cierre del onboarding.
- [x] Persistir responsable de cierre en backend para auditoria formal.

Criterio de aceptacion:

- Un cliente nuevo sabe que falta antes de activar cobranza real.
- BetterP no permite saltar bloqueantes criticos.

## Fase 9 - UX final del modulo

Objetivo: dejar la experiencia clara para cliente final y backoffice BetterP.

Decisiones de producto:

- `Mensajes`: envio manual asistido con plantillas definidas.
- `Plantillas`: ocultar o dejar solo lectura para clientes finales.
- `Automatizacion`: switches por etapa, no edicion tecnica de plantilla.
- `Comprobantes`: bandeja operativa conectada a CxC.
- `Cartera CxC`: priorizacion y seguimiento.
- `Guia operativa`: mini onboarding.

Checklist:

- [x] Ocultar edicion de plantillas a clientes.
- [x] Mantener administracion tecnica para BetterP/backoffice.
- [x] En mensajes, mostrar solo plantillas permitidas.
- [x] En automatizacion, bloquear reglas con plantilla no aprobada.
- [x] Mostrar ultimo contacto y proxima hora permitida por cliente.
- [x] Mostrar alertas de calidad/errores Meta.
- [x] Mostrar acciones operativas sugeridas para cron, omitidos, errores,
      ventanas, limites y plantillas.

Criterio de aceptacion:

- El usuario puede operar cobranza sin entender Meta.
- No puede mandar textos libres por WhatsApp.
- No puede activar reglas inseguras.

## Fase 10 - Laboratorio Maya Coliving

Objetivo: validar con datos controlados antes de clientes reales masivos, sin
liberar Maya Coliving como cliente productivo.

Checklist:

- [ ] Crear cliente demo con tu numero.
- [ ] Crear 3-5 CxC demo con fechas distintas.
- [x] Mostrar checklist vivo del piloto dentro del onboarding.
- [ ] Probar preventivo.
- [ ] Probar vence hoy.
- [ ] Probar gracia.
- [ ] Probar atraso.
- [x] Probar portal.
- [ ] Subir comprobante.
- [ ] Aplicar comprobante.
- [x] Solicitar factura desde portal si aplica.
- [ ] Revisar historial completo.
- [ ] Confirmar que no salieron mensajes a clientes reales.
- [x] Mantener Maya Coliving solo como laboratorio owner, no como go-live comercial.

Criterio de aceptacion:

- Flujo completo terminado de punta a punta.
- No hay errores criticos.
- No hubo envio accidental.

## Fase 11 - Liberacion comercial controlada

Objetivo: activar con clientes reales de forma gradual.

Checklist:

- [x] Mostrar tablero tecnico de primer lote real antes de abrir clientes.
- [x] Limitar la preparacion del primer lote a maximo 10 clientes desde Cartera.
- [ ] Seleccionar maximo 5-10 clientes piloto con datos revisados.
- [x] Confirmar telefono y consentimiento en vista previa antes de enviar.
- [x] Confirmar saldo y vencimiento en vista previa antes de enviar.
- [x] Mantener limite bajo por corrida.
- [x] Revisar cada envio manualmente el primer dia.
- [ ] Revisar respuestas entrantes.
- [ ] Revisar quejas, bajas o errores.
- [ ] Subir volumen solo si calidad y operacion estan sanas.

Criterio de aceptacion:

- Primer lote real sin errores criticos ni quejas.
- Comprobantes y pagos se procesan correctamente.
- El equipo sabe pausar reglas si algo sale mal.

## Definicion de terminado

El modulo de cobranza se considera listo al 100 para una primera version
comercial cuando:

- [x] Hay plantillas Meta aprobadas y al menos una enviada desde BetterP.
- [ ] El video de revision Meta esta grabado y enviado.
- [x] Existe modo prueba visible.
- [x] Existe opt-in/no contactar por cliente.
- [x] Comprobantes se aplican a CxC con revision segura.
- [x] Automatizaciones respetan horarios, limites, plantillas y 24 horas.
- [x] Onboarding operativo guia al cliente.
- [x] Backoffice puede ver errores, omitidos y actividad reciente.
- [x] Maya Coliving queda cerrado como laboratorio privado de owner, no como cliente productivo liberado.
- [ ] Se completo primer lote real sin incidentes.

## Seguimiento diario

| Fecha | Responsable | Avance | Bloqueante | Siguiente paso |
| --- | --- | --- | --- | --- |
| 2026-06-17 | BetterP | Numero conectado, seguridad base y cooldown 24h listos | Plantillas Meta en revision | Esperar 24h o aprobacion de 1 plantilla |
| 2026-06-17 | BetterP | Laboratorio WhatsApp limitado a usuario/capa de prueba en backend y UI | Falta validar en Render con sesion real | Probar vista Mensajes y Preparacion con `01.agodinez@gmail.com` en Maya Coliving |
| 2026-06-17 | BetterP | Simulador de automatizaciones por fecha agregado a la UI | Falta probar con reglas reales activas | Ejecutar simulacion en `Automatizacion` antes de cualquier corrida real |
| 2026-06-17 | BetterP | Feedback visual del simulador mejorado con estado, confirmacion y hora | Falta validar UX en Render | Confirmar que el click de simulacion se percibe claramente |
| 2026-06-17 | BetterP | Preview de automatizaciones tolerante a errores por regla | Falta validar en Render con datos reales | Reintentar simulacion y revisar si alguna regla muestra alerta |
| 2026-06-17 | BetterP | Comprobantes ahora sugieren CxC, detectan duplicados y aplican pagos desde la bandeja | Falta validar visualmente en Render con un comprobante real de prueba | Subir/registrar comprobante y aplicar a una CxC parcial |
| 2026-06-17 | BetterP | Lectura IA/OCR de comprobantes agregada con fallback por reglas, confianza y revision humana | Falta validar con `OPENAI_API_KEY` real y un comprobante de imagen | Usar `Leer IA/OCR` en `Comprobantes` antes de aplicar a CxC |
| 2026-06-17 | BetterP | Carga directa de comprobantes agregada con drag & drop, hash anti-duplicados y soporte imagen/PDF | Falta validar en Render con screenshot real y PDF | Arrastrar archivo en `Comprobantes`, registrar y ejecutar `Leer IA/OCR` |
| 2026-06-17 | BetterP | Reglas de comprobantes ya no extraen montos desde URLs/nombres de archivo y se agrego correccion manual | Falta validar con el comprobante BBVA de $11,000 | Reanalizar y corregir datos antes de aplicar a CxC |
| 2026-06-17 | BetterP | Historial local de ultimas simulaciones agregado al panel | Falta validar en Render | Simular varias fechas y usar el historial para repetir una fecha |
| 2026-06-18 | BetterP | Portal cliente probado completo con OTP, consentimiento, comprobantes y facturacion | Sin bloqueante de portal | Continuar con go-live controlado de WhatsApp |
| 2026-06-18 | BetterP | Plantillas Meta sincronizadas y activas 6/6 | Falta cron productivo limitado | Ejecutar dry-run con `--require-whatsapp-ready` y luego envio real de 1 |
| 2026-06-18 | BetterP | Pruebas agregadas para candados por etapa: preventivo, vence hoy, gracia y recargo | Falta validar cron real en Render | Configurar/validar job de `procesar_recordatorios` |
| 2026-06-18 | BetterP | Baja por WhatsApp agregada con politica configurable: bloqueo automatico o solo auditoria | Falta validar visualmente el switch en Render | Probar respuesta `BAJA` con el switch encendido y apagado |
| 2026-06-19 | BetterP | Limites bajos por corrida quedaron como default y con tope seguro en el comando del cron | Falta correr con datos reales unos dias antes de subir volumen | Mantener `--max-envios 1 --max-envios-por-capa 1` en piloto y subir gradualmente solo si no hay incidentes |
| 2026-06-19 | BetterP | Onboarding operativo dinamico y UX final de cobranza agregados: progreso por pasos, bloqueantes, accesos directos y proxima ventana de contacto 24h en Cartera | Falta decidir si el cierre del onboarding requiere responsable persistido en backend | Validar visualmente Onboarding y Cartera en Render, luego volver a Fase 7 de automatizacion productiva |
| 2026-06-19 | BetterP | Ventana operativa del cron agregada: 10:00-18:00 America/Mexico_City, domingos bloqueados por defecto y override manual explicito | Falta subir volumen gradualmente despues del piloto | Ajustar Render a `0 16 * * *` y mantener limites bajos para el primer lote real |
| 2026-06-19 | BetterP | UI bloquea envios WhatsApp manuales si la vista previa contiene destinos fuera de allowlist; la prueba segura tambien valida el destino antes de enviar | Falta validar visualmente en Render con un cliente fuera de lista | Previsualizar un cliente real fuera de allowlist y confirmar que el boton Enviar queda bloqueado |
| 2026-06-19 | BetterP | Guion de video para revision Meta documentado con tomas, narrativa, permisos y datos a ocultar | Falta grabar y subir el video en Meta | Grabar el recorrido con cliente demo, envio real, WhatsApp recibido e historial |
| 2026-06-19 | BetterP | Dataset demo Meta disponible desde UI de laboratorio: crea/actualiza cliente demo, espacio y 4 CxC marcadas como datos controlados | Falta validarlo visualmente en Render | En `Cobranza > Preparacion`, usar `Datos demo Meta`, seleccionar unidad y preparar demo |
| 2026-06-19 | BetterP | Monitoreo operativo de cobranza ahora muestra ultima corrida, cobertura de capa, ventana operativa, limites y acciones sugeridas | Falta validar visualmente despues del deploy | Revisar `Cobranza > Preparacion` y confirmar que las recomendaciones sean claras |
| 2026-06-19 | BetterP | Checklist vivo del piloto Maya agregado al onboarding con evidencia de cartera, envios, comprobantes, factura y allowlist | Falta completar todas las pruebas controladas para llegar a 12/12 | Usar el panel de piloto para cerrar preventivo, gracia, atraso y comprobantes |
| 2026-06-19 | BetterP | Tablero tecnico de primer lote real agregado al onboarding: valida piloto, plantillas, reglas, cron, limites bajos, errores y allowlist | Falta elegir 5-10 clientes reales y revisar datos manualmente | Usar el panel para confirmar que la parte tecnica esta lista antes del primer lote |
| 2026-06-19 | BetterP | Cartera ahora muestra revision de primer lote y bloquea preparar mas de 10 clientes, cuentas sin saldo, sin vencimiento o dentro de cooldown 24h | Falta seleccionar clientes reales revisados | Elegir 5-10 clientes desde Cartera y confirmar telefono/consentimiento en la vista previa |
| 2026-06-19 | BetterP | Revision manual del primer dia agregada a Ultimos envios con marca operativa por registro y nota opcional | Falta validar visualmente en Render con envios del cron | Marcar cada enviado, omitido o error como revisado antes de subir volumen |
| 2026-06-19 | BetterP | Vista previa de Mensajes ahora valida telefono WhatsApp, consentimiento vigente y no contactar antes de liberar envio | Falta validar visualmente con un cliente sin consentimiento | Preparar lote chico, previsualizar y confirmar que el boton se bloquee si falta consentimiento |
| 2026-06-19 | BetterP | Vista previa de Mensajes ahora valida CxC abierta, saldo exigible positivo y vencimiento antes de liberar envio | Falta validar visualmente con una cuenta real pagada o sin vencimiento | Preparar lote chico y confirmar que el panel Saldo y vencimiento muestre OK antes de enviar |
| 2026-06-20 | BetterP | Salud operativa queda concentrada en Backoffice y las alertas principales se depuraron a bloqueos o avisos accionables | Falta validar visualmente despues del deploy | Confirmar que el operador solo vea alertas criticas y que las senales tecnicas queden en tarjetas |
| 2026-06-20 | BetterP | Maya Coliving queda documentado como laboratorio privado, no como cliente liberable | Falta elegir cliente real con datos aprobados | Usar Maya solo para pruebas owner y preparar el primer lote con otro cliente autorizado |

## Referencias internas

- `docs/whatsapp-automation-roadmap.md`
- `docs/meta-whatsapp-review-video.md`
- `docs/first-customer-go-live-checklist.md`
- `backend/comunicaciones/outbound.py`
- `frontend/components/cobranza/CobranzaWorkspace.tsx`
