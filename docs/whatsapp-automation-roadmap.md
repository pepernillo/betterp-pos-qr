# Ruta para automatizar mensajes WhatsApp de cobranza

Este documento deja el camino operativo para pasar de la configuracion actual
de WhatsApp Cloud API a un flujo seguro de mensajes manuales, pruebas,
programaciones y automatizaciones de cobranza.

## Estado actual

- Empresa Meta verificada.
- WABA real conectado: `Betterp`.
- Numero productivo conectado: `+52 1 777 130 5454`.
- Webhook configurado y suscrito al campo `messages`.
- App Meta con caso de uso WhatsApp agregado.
- Render ya tiene variables de seguridad para trabajar en modo prueba:

```text
DISABLE_OUTBOUND_INTEGRATIONS=false
OUTBOUND_WHATSAPP_ALLOWED_NUMBERS=525551087058
LOCK_TENANT_MESSAGE_TEMPLATES=true
REQUIRE_WHATSAPP_SHARED_NUMBER_AGREEMENT=true
```

Con esa configuracion, BetterP puede llamar a Meta, pero solo permite entrega
real de WhatsApp al numero `525551087058`. Cualquier otro destino se registra
como `OMITIDO` con proveedor `SAFETY_ALLOWLIST` y no se manda a Meta.

## Fase 1 - Seguridad base antes de pruebas

Objetivo: evitar mensajes accidentales a clientes reales mientras Maya Coliving
tiene datos no depurados.

1. Mantener `OUTBOUND_WHATSAPP_ALLOWED_NUMBERS=525551087058`.
2. Mantener `LOCK_TENANT_MESSAGE_TEMPLATES=true`.
3. Confirmar que las automatizaciones de Maya Coliving siguen apagadas.
4. No crear el cron global `betterp-payment-reminders` hasta cerrar plantillas
   y pruebas.
5. Para una pausa total, cambiar temporalmente:

```text
DISABLE_OUTBOUND_INTEGRATIONS=true
```

Eso simula proveedores y no envia WhatsApp real ni siquiera al numero personal.

## Fase 1.5 - Acuerdo de uso del numero BetterP

Objetivo: no habilitar cobranza por WhatsApp con el numero compartido de
BetterP sin una aceptacion legal auditada por capa de negocio.

Antes de activar automatizaciones o envios manuales por WhatsApp:

1. Entrar a `Cobranza`.
2. Leer el modal `Acuerdo de uso de comunicaciones y cobranza por WhatsApp`.
3. Confirmar los 4 puntos:
   - autorizacion/base legal para contactar clientes;
   - datos de cobranza correctos y actualizados;
   - respeto a politicas de Meta/WhatsApp y BetterP;
   - aceptacion de pausa o suspension por riesgo.
4. Aceptar el acuerdo.

El backend guarda `AcuerdoUsoComunicacion` con usuario, capa, version, hash del
texto, fecha, IP, user agent y auditoria
`WHATSAPP_SHARED_NUMBER_TERMS_ACCEPTED`.

Mientras no exista aceptacion vigente:

- `POST /api/comunicaciones/envios/masivo/` bloquea WhatsApp.
- Crear o actualizar una regla WhatsApp activa queda bloqueado.
- `POST /api/comunicaciones/automatizaciones/ejecutar/` queda bloqueado si hay
  reglas WhatsApp activas.
- El cron `procesar_recordatorios --require-whatsapp-ready` reporta el faltante
  como problema de readiness.

## Fase 2 - Area de prueba Maya Coliving

Objetivo: probar fechas, dias, horas y limites usando solamente el numero
personal permitido.

### Tablero interno

En BetterP entrar a `Cobranza > Preparacion`. Esta vista concentra:

- acuerdo de uso aceptado o pendiente;
- conteo de plantillas WhatsApp aprobadas contra pendientes;
- reglas activas bloqueadas por plantilla no aprobada;
- estado del cron de recordatorios;
- actividad y errores recientes;
- zona segura: allowlist de WhatsApp, bloqueo de plantillas para clientes y
  requisito de acuerdo legal.

Mientras las plantillas sigan `En revision`, el estado esperado es amarillo:
la plataforma queda preparada, pero las reglas WhatsApp estrictas no se deben
liberar hasta que Meta las marque como aprobadas.

### Datos recomendados para la prueba

Crear o seleccionar un cliente de prueba dentro de la capa de Maya Coliving:

- Nombre: `Prueba BetterP WhatsApp`.
- Telefono: `525551087058`.
- Correo: uno controlado por BetterP.
- CxC de prueba con fechas conocidas:
  - una por vencer;
  - una que vence hoy;
  - una vencida dentro de gracia;
  - una vencida con recargo.

No uses clientes reales para el primer circuito. Aunque la allowlist bloquea
salidas, las pruebas seran mas limpias si solo hay datos de prueba.

### Obtener el ID de capa

Desde el servidor o local con acceso a la base:

```powershell
python backend/manage.py shell -c "from empresas.models import CapaNegocio; print(list(CapaNegocio.objects.values('id','nombre')))"
```

Guardar el ID de Maya Coliving para probar con `--capa-id`.

### Probar fechas sin enviar

Usar `--dry-run` para simular dias especificos:

```powershell
python backend/manage.py procesar_recordatorios --capa-id <MAYA_CAPA_ID> --fecha 2026-07-07 --dry-run --require-whatsapp-ready
python backend/manage.py procesar_recordatorios --capa-id <MAYA_CAPA_ID> --fecha 2026-07-10 --dry-run --require-whatsapp-ready
python backend/manage.py procesar_recordatorios --capa-id <MAYA_CAPA_ID> --fecha 2026-07-13 --dry-run --require-whatsapp-ready
python backend/manage.py procesar_recordatorios --capa-id <MAYA_CAPA_ID> --fecha 2026-07-20 --dry-run --require-whatsapp-ready
```

Interpretacion:

- `Enviados: 0` en dry-run esta bien.
- `Omitidos` representa candidatos calculados, no mensajes enviados.
- Si `require-whatsapp-ready` falla, falta canal o plantilla Meta aprobada.

### Probar una entrega real controlada

Cuando el dry-run se vea correcto:

```powershell
python backend/manage.py procesar_recordatorios --capa-id <MAYA_CAPA_ID> --fecha 2026-07-10 --max-envios 1 --max-envios-por-capa 1 --require-whatsapp-ready --fail-on-errors
```

Como la allowlist solo permite `525551087058`, cualquier otro numero sera
omitido aunque el comando encuentre mas candidatos.

### Horarios de prueba

Render Cron usa UTC. Para Mexico City:

| Hora Mexico | Hora UTC | Schedule Render |
| --- | --- | --- |
| 09:00 | 15:00 | `0 15 * * *` |
| 10:00 | 16:00 | `0 16 * * *` |
| 17:00 | 23:00 | `0 23 * * *` |

Para sandbox, crear un cron separado y temporal:

```text
Nombre: betterp-payment-reminders-maya-sandbox
Schedule UTC: 0 16 * * *
Comando:
python backend/manage.py procesar_recordatorios --capa-id <MAYA_CAPA_ID> --max-envios 1 --max-envios-por-capa 1 --require-whatsapp-ready --fail-on-errors
```

Despues de cada cambio, usar `Trigger Run` en Render y revisar:

- `CronRunLog`.
- Historial de envios.
- WhatsApp personal.
- Errores `SAFETY_ALLOWLIST`, que son esperados si habia otros numeros.

## Fase 3 - Plantillas Meta

Objetivo: que los mensajes fuera de ventana de servicio salgan como plantillas
aprobadas por Meta, no como texto libre.

### Reglas importantes

- Para cobranza usar categoria `UTILITY`.
- Usar idioma `es_MX`.
- El nombre debe ir en minusculas, sin espacios, por ejemplo
  `betterp_pago_preventivo`.
- En Meta los placeholders son numericos: `{{1}}`, `{{2}}`, etc.
- En BetterP las plantillas usan variables con nombre:
  `{{cliente_nombre}}`, `{{saldo_vivo_formato}}`, etc.
- El orden de variables en BetterP debe coincidir con el orden numerico en
  Meta, porque el backend construye los parametros en ese orden.

### Proceso manual en Meta

1. Entrar a WhatsApp Manager.
2. Ir a `Plantillas de mensajes`.
3. Click en `Crear plantilla`.
4. Elegir categoria `Utility`.
5. Elegir idioma `Spanish (Mexico)` o `es_MX`.
6. Poner el nombre exacto de la plantilla.
7. Pegar el cuerpo con `{{1}}`, `{{2}}`, etc.
8. Agregar ejemplos de cada variable.
9. Enviar a revision.
10. Esperar estado `Aprobada`.
11. En BetterP ir a `Cobranza > Preparacion` o `Cobranza > Plantillas` y hacer
    click en `Sincronizar Meta`.

La sincronizacion consulta el endpoint de Meta
`/{WABA_ID}/message_templates`, cruza por nombre e idioma, y actualiza:

- `whatsapp_template_status`: `APROBADA`, `EN_REVISION`, `RECHAZADA` o
  `PAUSADA`;
- `whatsapp_template_category`;
- nota interna de ultima sincronizacion o motivo de rechazo.

Si alguna plantilla queda sin coincidencia, revisar que el nombre y el idioma
en BetterP sean exactamente los mismos que en WhatsApp Manager.

### Plantillas iniciales recomendadas

#### `betterp_pago_preventivo`

Uso: 3 dias antes del vencimiento.

Body Meta:

```text
Hola {{1}}.

Te recordamos que tu cuenta de {{2}} por {{3}} vence el {{4}}.

Periodo de pago: {{5}}
Importe pendiente: {{6}}
Referencia de pago: {{7}}

Consulta tu estado de cuenta y carga tu comprobante aqui:
{{8}}

Si ya realizaste tu pago y aun no lo has notificado, por favor carga el comprobante desde la liga del portal. Si ya lo enviaste, puedes hacer caso omiso a este mensaje.
```

Orden BetterP:

1. `cliente_nombre`
2. `entidad_nombre`
3. `concepto`
4. `fecha_vencimiento_larga`
5. `periodo_pago`
6. `saldo_vivo_formato`
7. `referencia_pago`
8. `portal_url`

#### `betterp_pago_vence_hoy`

Uso: dia exacto de vencimiento.

Body Meta:

```text
Hola {{1}}.

Hoy vence tu cuenta de {{2}}.

Periodo de pago: {{3}}
Total a pagar: {{4}}
Referencia de pago: {{5}}

Revisa el detalle y sube tu comprobante en tu portal de autoservicio:
{{6}}

Si ya realizaste tu pago y aun no lo has notificado, por favor carga el comprobante desde la liga del portal. Si ya lo enviaste, puedes hacer caso omiso a este mensaje.
```

Orden BetterP:

1. `cliente_nombre`
2. `entidad_nombre`
3. `periodo_pago`
4. `total_exigible_formato`
5. `referencia_pago`
6. `portal_url`

#### `betterp_pago_gracia`

Uso: seguimiento despues del vencimiento, dentro de gracia.

Body Meta:

```text
Hola {{1}}.

Tu cuenta de {{2}} aparece pendiente despues del vencimiento.

Periodo de pago: {{3}}
Saldo pendiente: {{4}}
Fecha limite de gracia: {{5}}
Referencia de pago: {{6}}

Carga tu comprobante aqui:
{{7}}

Si ya realizaste tu pago y aun no lo has notificado, por favor carga el comprobante desde la liga del portal. Si ya lo enviaste, puedes hacer caso omiso a este mensaje.
```

Orden BetterP:

1. `cliente_nombre`
2. `entidad_nombre`
3. `periodo_pago`
4. `saldo_vivo_formato`
5. `fecha_limite_gracia_larga`
6. `referencia_pago`
7. `portal_url`

#### `betterp_pago_atraso_avanzado`

Uso: atraso avanzado y posible revision administrativa.

Body Meta:

```text
Hola {{1}}.

Tu cuenta de {{2}} sigue pendiente y ya puede generar intereses moratorios o revision administrativa segun las reglas del servicio.

Periodo de pago: {{3}}
Saldo vencido: {{4}}
Cargos moratorios: {{5}}
Calculo del cargo: {{6}}
Total a pagar: {{7}}
Referencia de pago: {{8}}

Consulta tu estado de cuenta aqui:
{{9}}

Si ya realizaste tu pago y aun no lo has notificado, por favor carga el comprobante desde la liga del portal. Si ya lo enviaste, puedes hacer caso omiso a este mensaje.
```

Orden BetterP:

1. `cliente_nombre`
2. `entidad_nombre`
3. `periodo_pago`
4. `saldo_vivo_formato`
5. `recargo_total_formato`
6. `recargo_descripcion`
7. `total_exigible_formato`
8. `referencia_pago`
9. `portal_url`

#### `betterp_pago_recibido`

Uso: acuse de comprobante recibido.

Body Meta:

```text
Hola {{1}}. Hemos recibido tu comprobante de pago para {{2}}. Nuestro equipo lo revisara y, en cuanto quede validado, veras la actualizacion en tu estado de cuenta. Puedes consultar el seguimiento aqui: {{3}}
```

Orden BetterP:

1. `cliente_nombre`
2. `entidad_nombre`
3. `portal_url`

#### `betterp_pago_parcial_recibido`

Uso: pago parcial recibido, queda saldo pendiente.

Body Meta:

```text
Hola {{1}}. Hemos recibido un pago por {{2}} para {{3}}. Tu saldo pendiente es {{4}}. Si el pago corresponde a una cuenta vencida, te recomendamos cubrir el pendiente para evitar recargos o restricciones. Puedes revisar tu estado de cuenta aqui: {{5}}
```

Orden BetterP:

1. `cliente_nombre`
2. `monto_recibido_formato`
3. `entidad_nombre`
4. `saldo_pendiente_formato`
5. `portal_url`

## Fase 4 - Producto: area de pruebas en la app

Objetivo: que el equipo BetterP pueda probar sin tocar terminal ni arriesgar
clientes.

Pantalla recomendada: `Cobranza > WhatsApp > Laboratorio`.

Controles:

- Capa/cliente de prueba.
- Numero destino bloqueado a `525551087058` mientras haya allowlist.
- Selector de plantilla aprobada.
- Fecha de referencia.
- Modo `Dry-run` o `Enviar prueba real`.
- Hora local objetivo.
- Maximo por corrida.
- Maximo por hora.
- Boton `Previsualizar`.
- Boton `Enviar solo a mi numero`.
- Historial de ultimas pruebas.

Validaciones:

- Si `OUTBOUND_WHATSAPP_ALLOWED_NUMBERS` esta activo, mostrar aviso visible.
- Si el destino no esta en allowlist, bloquear desde UI antes de llamar API.
- Si la plantilla no esta `APROBADA`, bloquear envio real.
- Si no hay `portal_url`, bloquear envio real.
- Si hay automatizaciones activas fuera de sandbox, pedir confirmacion de
  plataforma.

## Fase 5 - Programacion real por hora, dia y volumen

El comando actual procesa por fecha y respeta limites por corrida. Para tener
programacion fina por hora se recomienda agregar una cola de envios.

Modelo sugerido: `EnvioProgramado`.

Campos:

- `capa_negocio`.
- `cliente`.
- `plantilla`.
- `canal`.
- `destino`.
- `scheduled_for`.
- `timezone`.
- `status`: `PENDIENTE`, `ENVIANDO`, `ENVIADO`, `OMITIDO`, `ERROR`.
- `attempts`.
- `last_error`.
- `dedupe_key`.
- `payload_preview`.

Worker recomendado:

- Corre cada minuto.
- Toma envios `PENDIENTE` con `scheduled_for <= now`.
- Respeta limite por hora por WABA.
- Respeta limite por capa.
- Respeta allowlist si existe.
- Reintenta errores transitorios.
- No reintenta errores de politica, opt-out o plantilla rechazada.

Campos adicionales en `ReglaAutomatizacionMensaje`:

- `hora_envio_local`.
- `dias_semana`.
- `ventana_inicio_local`.
- `ventana_fin_local`.
- `max_envios_por_hora`.
- `pausar_si_calidad_baja`.

## Fase 6 - Escala y limites

Separar tres limites:

1. Rate limit de Graph API/app: protege llamadas API administrativas.
2. Messaging limits: cuantos usuarios unicos puedes iniciar por periodo.
3. Throughput: velocidad de mensajes por numero.

Buenas practicas:

- No consultar plantillas/numeros en cada envio; cachear configuracion.
- No enviar todos los recordatorios en un solo minuto.
- Usar maximos por hora y por capa.
- Mantener opt-in y opt-out.
- Empezar con volumen bajo y subir gradualmente.
- Monitorear calidad del numero en WhatsApp Manager.
- Si varios clientes crecen, migrar a modelo por cliente con su propio WABA o
  numero conectado. Usar el numero BetterP compartido solo para piloto y baja
  escala.

## Criterios para liberar clientes reales

No liberar envio real a clientes hasta cumplir todo:

1. Plantillas Meta principales aprobadas.
2. Plantillas BetterP marcadas como `APROBADA` y con nombre/idioma exactos.
3. `--dry-run --require-whatsapp-ready` sin errores para la capa.
4. Prueba real exitosa al numero personal.
5. Datos de clientes revisados: telefono, saldo, vencimiento y referencia.
6. Portal de autoservicio probado con links reales.
7. Opt-in documentado.
8. Cron configurado con limites bajos al inicio.
9. Dashboard/historial revisado despues de cada corrida.
10. Decidir si se quita allowlist o se agrega un conjunto pequeno de numeros
    piloto.

## Comandos de referencia

Dry-run por fecha:

```powershell
python backend/manage.py procesar_recordatorios --capa-id <CAPA_ID> --fecha 2026-07-10 --dry-run --require-whatsapp-ready
```

Envio real limitado a 1:

```powershell
python backend/manage.py procesar_recordatorios --capa-id <CAPA_ID> --fecha 2026-07-10 --max-envios 1 --max-envios-por-capa 1 --require-whatsapp-ready --fail-on-errors
```

Cron diario inicial:

```powershell
python backend/manage.py procesar_recordatorios --max-envios 25 --max-envios-por-capa 5 --require-whatsapp-ready --fail-on-errors
```

Cron escalado:

```powershell
python backend/manage.py procesar_recordatorios --max-envios 500 --max-envios-por-capa 100 --require-whatsapp-ready --fail-on-errors
```

## Referencias oficiales Meta

- [Template fundamentals](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview)
- [Template components](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/components/)
- [Template Library](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-library/)
- [Utility templates](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/utility-templates/utility-templates/)
- [Graph API rate limits](https://developers.facebook.com/docs/graph-api/overview/rate-limiting/)
- [WhatsApp messaging limits](https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits)
- [WhatsApp throughput](https://developers.facebook.com/documentation/business-messaging/whatsapp/throughput/)
- [WhatsApp pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing)
