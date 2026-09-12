# Cierre de Cobranza y proxima incursion Backoffice MKT

Actualizado: 2026-06-21

Este documento deja constancia del cierre operativo del modulo de cobranza y
del ajuste visual de betterp.net. Tambien define el contexto minimo para abrir
una nueva ventana de trabajo enfocada solo en Backoffice / Marketing.

## Estado general

- Cobranza queda cerrada para operacion controlada.
- betterp.net queda actualizado como antesala clara de las soluciones BetterP.
- La siguiente incursion debe enfocarse solo en Backoffice MKT.
- No reabrir Cobranza salvo bug critico, ajuste legal urgente o hallazgo de
  produccion.

## Cobranza terminado

Se completo el flujo principal del modulo de cobranza:

- WhatsApp Cloud API conectado con numero oficial de BetterP.
- Empresa Meta verificada y plantillas de cobranza aprobadas.
- Sincronizacion de plantillas desde Meta hacia BetterP.
- Envio manual asistido con plantillas controladas.
- Envio automatico por reglas de cobranza con candados por etapa.
- Bloqueo de mensajes de cobranza repetidos en menos de 24 horas por cliente.
- OTP por WhatsApp para proteger el portal de autoservicio.
- Consentimiento obligatorio en portal cliente antes de mostrar datos.
- Link de autoservicio protegido con OTP y sesion de portal.
- Carga de comprobantes desde portal cliente sin pedir monto ni cuenta manual.
- Lectura visual de comprobantes con Google Vision OCR.
- Aplicacion de pagos a la cartera mas antigua del cliente y saldo a favor
  cuando aplique.
- Facturacion desde portal con validaciones fiscales basicas y seleccion de
  regimen cuando la CSF trae mas de un regimen.
- Alta, baja y control de destinatarios seguros para laboratorio real.
- Area de preparacion visible solo para owner.
- Zona de prueba segura real para demos, con contactos temporales y reset.
- Registro de ultimos envios, omitidos, errores y revision manual del primer
  dia.
- Cron de recordatorios configurado en Render, con limites y modo controlado.
- Switch operativo para permitir o no baja por palabras como STOP, BAJA o NO
  ENVIAR.
- Webhook de WhatsApp alineado para recibir mensajes entrantes, estados,
  respuestas y solicitudes de link de portal.
- Mini flujo de chat: cuando el cliente escribe, BetterP puede responder con
  acceso al portal de autoservicio.

## Candados clave de cobranza

La logica de envios debe mantenerse asi:

- Mensajes de cobranza: maximo uno por cliente cada 24 horas.
- OTP y acceso al portal: no usan el candado de 24 horas de cobranza.
- Preventivo: solo antes del vencimiento.
- Vence hoy: solo el dia exacto.
- Periodo de gracia: solo dentro de la ventana de gracia.
- Atraso / recargo: solo despues del periodo de gracia.
- Demos seguros: pueden ejecutar pruebas con numeros autorizados.
- Clientes finales: no editan plantillas de WhatsApp.

## Betterp.net terminado

Se ajusto el landing principal de betterp.net para quedar como antesala de
soluciones:

- Hero blanco inspirado en el arte institucional de BetterP.
- Logo original para fondos claros.
- Se retiro el bloque de hub que no aportaba suficiente valor.
- Se retiro la palomita decorativa.
- El bloque de soluciones queda como "Conoce nuestras soluciones" para permitir
  mas productos en el futuro, no solo Renta Facil y Vende Facil.
- Footer con logo sin fondo parchado.
- El contenido se mantiene ligero: no intenta explicar todo el sistema, solo
  abre camino hacia las soluciones.

## Proxima incursion

La siguiente ventana debe trabajar solo Backoffice MKT.

Objetivo recomendado:

- Revisar y terminar el modulo de marketing dentro de Backoffice.
- Alinear UX, permisos, planes y limites de uso.
- Revisar como se conectan campanas, automatizaciones, plantillas, redes y
  metricas.
- Mantener el enfoque en operacion real, no en depuracion interna.

Archivos/rutas probables para empezar:

- `frontend/app/backoffice/`
- `frontend/app/marketing/page.tsx`
- `frontend/components/marketing/`
- `backend/marketing_social/`
- `backend/billing/`
- `frontend/components/business/BusinessAdminManager.tsx`
- `docs/production-operations.md`
- `docs/cobranza-release-roadmap.md`

## No tocar de entrada

Para evitar perder foco en la siguiente incursion:

- No redisenar Cobranza.
- No reabrir WhatsApp Cloud API salvo bug puntual.
- No cambiar plantillas aprobadas en Meta salvo necesidad real.
- No liberar Maya Coliving como cliente comercial porque contiene datos reales
  no autorizados para go-live.
- No duplicar paneles de salud operativa; primero revisar lo existente en
  Backoffice.

## Prompt para nueva ventana de chat

Puedes iniciar la siguiente ventana pegando esto:

```text
Estoy retomando el repo betterp / bettERP.

Ya dejamos cerrado el modulo de Cobranza y actualizado el landing de betterp.net.
Antes de tocar codigo, revisa:

- docs/cierre-cobranza-y-proxima-incursion.md
- docs/cobranza-release-roadmap.md
- docs/production-operations.md

Quiero trabajar exclusivamente el Backoffice en su modulo de Marketing / MKT.
No quiero reabrir Cobranza salvo bug critico. Maya Coliving queda como
laboratorio privado y no debe liberarse como cliente comercial.

Objetivo de esta incursion:
1. Revisar el estado actual del Backoffice MKT.
2. Detectar lo que falta para dejarlo operativo y vendible.
3. Mejorar UX sin duplicar pantallas ni paneles existentes.
4. Alinear planes, limites, permisos y uso por volumen.
5. Dejar una ruta de cierre igual de clara que hicimos con Cobranza.

Empieza leyendo el codigo y documentacion existente, luego propon una ruta de
trabajo y avanza punto por punto.
```

## Referencias de cierre

- Roadmap de cobranza: `docs/cobranza-release-roadmap.md`
- Roadmap Backoffice MKT: `docs/backoffice-mkt-release-roadmap.md`
- Operacion de produccion: `docs/production-operations.md`
- Landing principal: `frontend/app/page.tsx`
- Landing Renta Facil: `frontend/app/soluciones/renta-facil/page.tsx`
