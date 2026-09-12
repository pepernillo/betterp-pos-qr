# Pendientes post-release Backoffice MKT

Este registro separa mejoras valiosas que no bloquean el cierre de Fase 8 ni la
primera semana comercial de Renta Facil. Cada pendiente debe retomarse solo
cuando cumpla su condicion de entrada.

## Regla de uso

- Si impide capturar leads, publicar/operar, medir o dar seguimiento, no es
  post-release: va al checklist de go-live.
- Si mejora medicion, velocidad, automatizacion, diseno o escala, pero la semana
  puede operar con workaround, queda aqui.
- Si depende de datos reales que aun no existen, no se implementa por intuicion.
- Si requiere presupuesto, nueva integracion o cambio de alcance, se trata como
  incursion separada.

## Pendientes priorizados

| Prioridad | Pendiente | Por que queda fuera | Condicion de entrada | Tipo |
| --- | --- | --- | --- | --- |
| P1 | Ejecutar checklist go-live en produccion/staging y adjuntar evidencia real. | Es ejecucion operativa, no falta de producto. | Deploy listo y responsable asignado. | Operacion |
| P1 | Playwright autenticado para Backoffice MKT completo. | Requiere credenciales/estado autenticado estable; no impide operar manualmente. | Smoke manual repetido y rutas estables. | QA |
| P1 | Conversion tracking mas profundo para pauta: pixel/eventos server-side o evento de lead calificado. | Antes de escalar pauta se necesita medir conversion real, pero organico/manual puede operar. | Primeros leads organicos con UTM y criterio de calidad. | Medicion |
| P1 | Google Ads Search controlado. | Cambia canal y presupuesto; Google Ads se pospuso desde la decision inicial. | Landing validada, UTMs, seguimiento y primeros mensajes organicos probados. | Growth |
| P1 | Dashboard ejecutivo CAC, pipeline y revenue por UTM. | Requiere muestra de leads, propuestas, ganadas y gasto real. | 2-4 semanas de datos con cierres o propuestas. | Analytics |
| P2 | Automatizacion mas profunda de Meta insights. | Ya existe importacion por destino; lo pendiente es enriquecer granularidad. | Meta limite datos actuales o la captura manual consuma demasiado tiempo. | Integracion |
| P2 | Biblioteca de creativos por segmento/dolor. | El motor ya genera prompts y galeria; la biblioteca requiere aprender que formatos convierten. | 2 ciclos de piezas con clicks/leads/objeciones. | Contenido |
| P2 | Kit comercial empaquetado para ventas: deck, one-pager, pricing y demo script visual. | La guia operativa cubre el proceso; falta material presentable. | Primeras demos reales y objeciones repetidas. | Ventas |
| P2 | Evaluar CRM externo o integracion HubSpot/Apollo/Clay. | El pipeline interno basta para la primera incursion. | Volumen de leads supere seguimiento manual o haya prospeccion outbound. | Ventas/CRM |
| P2 | Enriquecimiento de leads y scoring avanzado. | Ya existe calificacion base; enriquecer antes de tener volumen puede sobredisenar. | Leads suficientes para detectar patrones de calidad. | Data |
| P3 | Redisenar dashboard ejecutivo de MKT. | La UX se alivio con acordeones; rediseno completo no es necesario para vender. | Uso real muestre cuellos de botella recurrentes. | UX |
| P3 | Libreria de variantes visuales generadas y comparador creativo. | Primero hay que validar que mensajes venden. | Hay suficiente muestra por formato visual. | Contenido |
| P3 | Automatizacion avanzada de agenda de publicaciones multicanal. | Cron interno ya cubre cola Backoffice; mas automatizacion requiere reglas nuevas. | Publicacion diaria manual/cron se vuelva cuello de botella. | Automatizacion |

## Google Ads Search controlado

Google Ads no entra en la primera semana comercial. Se retoma como incursion
posterior solo si se cumple:

- landing Renta Facil validada;
- formulario capturando leads;
- UTMs funcionando;
- seguimiento comercial activo;
- conversion tracking definido;
- primeros mensajes organicos con senal de publico;
- lista de negativas inicial;
- presupuesto diario limitado;
- regla de pausa por lead calificado.

Regla:

- Solo Search al inicio.
- No Performance Max.
- No audiencias amplias sin conversion.
- No escalar si el costo por lead calificado no es entendible.

## CRM externo

No implementar CRM completo ahora. Antes de decidir:

- medir cuantos leads entran por semana;
- medir tiempo real de seguimiento;
- medir cuantos leads se pierden por falta de proceso;
- comparar costo/beneficio de HubSpot, Apollo, Clay o pipeline interno;
- decidir si el objetivo es inbound, outbound o ambos.

Decision provisional:

- Backoffice MKT + Solicitudes bastan para la primera incursion.
- CRM externo se evalua cuando haya volumen o prospeccion outbound real.

## Dashboard CAC/revenue por UTM

No construir antes de tener datos. Retomar cuando existan:

- gasto pagado real por canal/campana;
- leads calificados;
- demos;
- propuestas;
- ganadas;
- perdidas con objecion;
- revenue o MRR asociado a cliente creado.

Primera version sugerida:

- UTM.
- Canal.
- Gasto.
- Leads totales.
- Leads calificados.
- Demos.
- Propuestas.
- Ganadas.
- Revenue estimado.
- CAC o costo por venta.

## Biblioteca de creativos

No crear una biblioteca gigante antes de saber que convierte. Primeras familias
a guardar cuando haya senal:

- cobranza automatizada;
- autoservicio del cliente;
- control en tiempo real;
- rentabilidad por unidad;
- menos seguimiento manual;
- objecion precio;
- objecion migracion;
- objecion adopcion del equipo.

Cada creativo guardado debe tener:

- segmento;
- dolor;
- formato;
- prompt;
- pieza origen;
- UTM;
- metrica que justifico guardarlo;
- decision: repetir, variante, pausar.

## QA visual autenticado

Pendiente recomendado:

- Crear Playwright autenticado para `/backoffice/marketing`.
- Validar desktop y mobile razonable.
- Confirmar que acordeones no oculten acciones criticas.
- Confirmar que modal de campana, galeria, preview y tabla no rompan layout.
- Ejecutar despues de cada cambio visual grande.

No bloquea esta salida porque:

- ya existe smoke funcional documentado;
- `npm run lint` y `npm run build` pasan;
- la pantalla puede revisarse manualmente antes de go-live.

## No retomar todavia

Estos puntos se mantienen fuera hasta tener datos reales:

- Performance Max.
- CRM completo propio.
- Dashboard financiero complejo.
- Rehacer todo el diseno de Backoffice MKT.
- Abrir nuevas soluciones desde el mismo motor.
- Pauta fria amplia sin conversion tracking.

## Decision de cierre

Fase 8 puede cerrarse con estos pendientes fuera del release porque:

- no impiden generar, revisar, publicar, medir y aprender;
- no impiden capturar leads ni dar seguimiento;
- tienen documento, condicion de entrada y prioridad;
- el go-live comercial tiene checklist propio;
- los incidentes tienen runbook de observabilidad.
