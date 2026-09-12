# Guia operativa Backoffice MKT

Esta guia explica como usar Backoffice MKT para vender Renta Facil semana a
semana. Es para ventas, soporte y operacion interna de BetterP.

Backoffice MKT no es Marketing cliente. Backoffice MKT vende BetterP/Renta
Facil con canales, campanas, prospectos y aprendizaje internos. Marketing
cliente vive en `/marketing` y depende del plan SaaS de cada cliente.

## Objetivo comercial

Convertir publicaciones en conversaciones calificadas, demos, propuestas y
ventas de Renta Facil.

La semana se considera saludable cuando:

- hay 7 piezas revisadas o una razon clara para tener menos;
- cada pieza tiene CTA y UTM;
- los creativos principales son visibles;
- los leads entrantes tienen solucion, UTM y calificacion;
- el equipo dio seguimiento a leads nuevos antes de 24 horas;
- el Learning Loop puede decir que repetir, reescribir, pausar o probar.

## Roles

| Rol | Responsabilidad |
| --- | --- |
| Operacion MKT | Generar cola, revisar piezas, aceptar/rechazar, publicar, capturar metricas y ejecutar Learning Loop. |
| Ventas | Contactar leads, agendar demo, mover etapas, registrar objeciones, preparar propuesta o marcar perdido. |
| Soporte | Revisar permisos, Meta, cron, R2, errores, limites y salud si una accion falla. |
| Producto/Dev | Tomar bugs confirmados, ajustar motor, cerrar gaps y revisar pendientes fuera del release. |

## Rutina semanal

### Lunes - Leer resultados

1. Abrir `/backoffice/marketing`.
2. Revisar `Aprendizaje IA`.
3. Abrir `Resultados de esta semana`.
4. Confirmar:
   - publicaciones publicadas y pendientes;
   - mejor pieza;
   - pieza debil;
   - mejor canal;
   - leads, demos, propuestas, ganadas y perdidas;
   - objecion dominante;
   - recomendacion.
5. Si faltan metricas, capturarlas antes de tomar decision.

Salida:

```text
Mejor pieza:
Pieza a reescribir:
Objecion dominante:
Decision de contenido:
Decision de pauta:
```

### Martes - Ajustar mensajes

1. Abrir comparador por UTM.
2. Identificar piezas que generan avance comercial, no solo clicks.
3. Marcar que piezas deben:
   - reforzarse;
   - reescribirse;
   - responder objecion;
   - pausarse;
   - probar nuevo publico.
4. Revisar que el mensaje hable claramente a administradores de condominios,
   inmuebles o espacios en renta cuando aplique.
5. Ajustar prompt/copy con base en datos reales.

Salida:

- Nueva direccion editorial para la semana.
- Objeciones que deben convertirse en pieza.

### Miercoles - Generar y revisar cola

1. Usar `Generar 7 dias` o `Generar con aprendizaje`.
2. Confirmar que la cola complete huecos sin duplicar temas activos.
3. Abrir cada campana y revisar:
   - publico meta;
   - dolor;
   - beneficio;
   - CTA;
   - UTM;
   - prompt visual;
   - preview por canal.
4. Aceptar, rechazar o pedir modificacion.

Salida:

- Cola semanal lista para publicar o lista de piezas que requieren ajuste.

### Jueves - Preparar publicacion y pauta

1. Confirmar que Meta este conectado si se va a publicar desde BetterP.
2. Confirmar que cada pieza aceptada tenga creativo principal.
3. Revisar `Pauta controlada`.
4. No invertir si falta:
   - UTM;
   - landing;
   - formulario;
   - lead calificado;
   - pieza aprobada;
   - regla de apagado.
5. Si hay senal suficiente, preparar retargeting o prueba fria controlada.

Salida:

- Publicacion lista.
- Pauta: esperar, retargeting, prueba controlada, escalar o pausar.

### Viernes - Cerrar aprendizaje comercial

1. Revisar prospectos nuevos.
2. Contactar leads `NUEVO` antes de 24 horas.
3. Mover etapas:
   - `NUEVO` -> `CONTACTADO`;
   - `CONTACTADO` -> `DEMO`;
   - `DEMO` -> `PROPUESTA`;
   - propuesta ganada -> preparar alta de cliente;
   - perdida -> registrar objecion.
4. Ejecutar Learning Loop si ya hay datos nuevos.
5. Registrar cierre semanal.

Salida:

```text
Leads nuevos:
Demos:
Propuestas:
Ganadas:
Perdidas:
Objecion dominante:
Siguiente accion:
```

## Interpretar resultados

| Senal | Lectura | Accion |
| --- | --- | --- |
| Muchos views y pocos clicks | El creativo/copy no genera intencion suficiente. | Reescribir gancho o hacerlo mas especifico por publico. |
| Muchos clicks y pocos leads | Landing, CTA o promesa no conectan. | Revisar CTA, UTM, formulario y congruencia con la pieza. |
| Muchos leads no calificados | Publico o hook demasiado amplio. | Ajustar audiencia, exclusiones y primera linea del mensaje. |
| Leads calificados sin demo | Seguimiento lento o CTA poco claro. | Contactar antes de 24 horas y usar mensaje personalizado. |
| Demos sin propuesta | Dolor no suficientemente urgente o precio/confianza bloquean. | Registrar objecion y crear pieza de respuesta. |
| Propuestas perdidas por misma objecion | El mercado pide prueba, caso, comparativo o garantia. | Responder objecion antes de meter pauta fria. |
| Una UTM genera demos/propuestas | Hay senal comercial. | Reforzar con variante controlada o retargeting. |
| Gasto sin lead calificado | Presupuesto se esta desperdiciando. | Pausar, corregir audiencia o hook. |

## Decision de pauta

No se invierte presupuesto solo por likes, views o intuicion. La pauta debe
tener tracking, criterio de calidad y regla de apagado.

| Decision | Cuando usarla | Presupuesto |
| --- | --- | --- |
| Esperar | No hay lead calificado, no hay UTM o la objecion dominante no fue respondida. | 0 |
| Retargeting | Hay visitantes/clicks o engagement, pero muestra chica para frio. | Bajo y con audiencia tibia. |
| Prueba fria controlada | Hay pieza clara, publico definido, landing, UTM y regla de pausa. | Bajo, por pocos dias. |
| Escalar cauteloso | Hay leads calificados, demos o propuestas con costo razonable. | Subir gradual, no duplicar de golpe. |
| Pausar | CPL calificado alto, gasto sin leads o publico fuera de perfil. | 0 hasta corregir. |

Regla practica:

- Si no puedes explicar a quien quieres excluir, no lances pauta.
- Si no puedes medir lead calificado, no escales.
- Si la pieza atrae curiosos, no la premies con presupuesto.

## Seguimiento de leads

### Prioridad

1. Leads `ALTA` o con urgencia `esta semana`.
2. Administradores de condominios, inmuebles, coliving o espacios en renta.
3. Operaciones con 11+ espacios o cobranza manual.
4. Leads que mencionan cuentas vencidas, rentas pendientes, pagos no
   registrados, autoservicio o control en tiempo real.

### Primer contacto

Usar el mensaje copiable del prospecto desde Backoffice MKT y personalizar solo
si agrega contexto.

Estructura:

```text
Hola {nombre}, vi que administran {tipo_operacion}.
Renta Facil puede ayudarles a ordenar {dolor_principal}: cobranza, pagos,
autoservicio y control operativo en un solo flujo.
Te propongo una demo corta para revisar si aplica a su operacion y donde se
puede automatizar primero.
```

### Criterios para demo

Agendar demo cuando el lead:

- administra condominios, inmuebles o espacios en renta;
- cobra por llamadas, correos, mensajes, hojas de calculo o banco;
- tiene rentas pendientes, cuentas vencidas o pagos sin registrar;
- quiere autoservicio para clientes;
- necesita control por unidad, espacio o negocio;
- puede decidir o influir en el proceso.

No empujar demo si:

- no administra espacios;
- solo esta investigando sin problema operativo;
- pide algo fuera de Renta Facil;
- no acepta compartir datos minimos de operacion.

## Guion de demo

Duracion sugerida: 20 a 30 minutos.

1. Contexto:
   - Que administras?
   - Cuantos espacios/unidades?
   - Como cobras hoy?
   - Donde se pierde mas tiempo?
2. Dolor:
   - Cuentas vencidas?
   - Rentas pendientes?
   - Pagos no registrados?
   - Facturas o comprobantes por mensaje?
   - Falta de reportes en tiempo real?
3. Recorrido:
   - clientes y espacios;
   - cobranza automatizada;
   - autoservicio;
   - pagos/comprobantes;
   - control por unidad;
   - reportes.
4. Cierre:
   - Que parte resolveria primero?
   - Quien mas debe verlo?
   - Quieres probarlo 7 dias?
   - Preparamos propuesta?

## Objeciones y respuesta

| Objecion | Respuesta comercial | Accion en MKT |
| --- | --- | --- |
| Precio | Comparar contra tiempo perdido, cartera vencida y seguimiento manual. | Crear pieza de costo de operacion manual. |
| No tengo tiempo de migrar | Proponer arranque con proceso minimo: espacios, clientes y cobranza principal. | Crear pieza de implementacion gradual. |
| Mi equipo no usara otro sistema | Mostrar autoservicio y menos mensajes repetidos. | Crear pieza de adopcion simple. |
| Ya uso Excel/WhatsApp | Reconocer que funciona al inicio, pero se rompe con volumen y seguimiento. | Crear comparativo antes/despues. |
| No quiero meter pauta | Separar producto de pauta: primero orden operativo y organico medible. | No forzar Ads. |
| Quiero verlo funcionando | Ofrecer demo con caso cercano y prueba corta. | Reforzar CTA de demo. |

## Mensaje comercial base

```text
Renta Facil ayuda a administradores de condominios, inmuebles y espacios en
renta a ordenar cobranza, clientes, pagos, autoservicio y control operativo en
BetterP.

Si hoy cobras por llamadas, correos, mensajes o revisando banco/Excel, el
sistema puede automatizar recordatorios para cuentas vencidas, rentas
pendientes y pagos realizados pero no registrados.

La meta no es publicar mas por publicar. La meta es tener control del negocio,
informacion en tiempo real y menos seguimiento manual repetitivo.
```

CTA principal:

```text
Agenda una demo de Renta Facil.
```

Ofertas de lanzamiento que se pueden mencionar cuando ayuden:

- 7 dias gratis.
- 10% de descuento.
- 12 meses por pago de 10.
- Devolucion sujeta a condiciones si el sistema no convence.

## Guia rapida de soporte

| Sintoma | Causa probable | Accion |
| --- | --- | --- |
| Backoffice MKT no abre | Usuario sin `platform_admin` o sesion vencida. | Revisar permisos de plataforma y login. |
| Marketing cliente no abre | Plan sin modulo `marketing`. | Revisar plan/capabilities; no mezclar con Backoffice. |
| Boton Meta falla | Variables o redirect de Meta incorrectos. | Ver runbook de observabilidad, seccion Meta OAuth. |
| Campana no publica | Canal sin token, no publicable, creativo no publico o error Meta. | Revisar destino, canal y `payload.error`. |
| Cron no publico | Cron faltante/stale/error. | Revisar Salud y `CronRunLog`. |
| Instagram falla | Falta imagen publica o Instagram Business/token. | Revisar creativo principal y conexion Meta. |
| Metricas Meta no importan | Falta `external_id`, token o permiso. | Capturar manualmente y reconectar si aplica. |
| Lead sin UTM | CTA publicado sin parametros o link editado. | Corregir campana y no usar pieza para pauta. |
| Learning Loop no aprende | Faltan metricas, leads, etapas u objeciones. | Capturar datos y mover prospectos antes de regenerar. |
| Pauta aparece pausada | Falta lead calificado o objecion dominante sin responder. | Resolver calidad/objecion antes de invertir. |

Escalar a dev cuando:

- hay error 500 repetible;
- una ruta critica falla despues de deploy;
- el estado de datos queda inconsistente;
- el cron falla con excepcion no operativa;
- Meta/R2 devuelve error no recuperable con configuracion correcta.

## Evidencia minima semanal

Guardar en issue, nota interna o reporte:

```text
Semana:
Responsable:
Cola generada:
Piezas aprobadas:
Piezas publicadas:
Mejor pieza:
Pieza debil:
Leads:
Demos:
Propuestas:
Ganadas:
Perdidas:
Objecion dominante:
Decision de contenido:
Decision de pauta:
Pendientes soporte:
Siguiente semana:
```

## Documentos relacionados

- `docs/backoffice-mkt-smoke-checklist.md`: recorrido funcional completo.
- `docs/backoffice-mkt-observability-runbook.md`: diagnostico de fallas.
- `docs/renta-facil-content-engine.md`: reglas editoriales y visuales.
- `docs/backoffice-mkt-release-roadmap.md`: roadmap y bitacora de cierre.
