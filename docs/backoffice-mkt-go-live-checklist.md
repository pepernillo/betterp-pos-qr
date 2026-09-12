# Checklist go-live comercial Backoffice MKT

Este checklist decide si Backoffice MKT puede operar una semana comercial real
para vender Renta Facil. No sustituye el smoke funcional ni el runbook de
observabilidad; los resume en una decision ejecutiva.

## Decision posible

| Decision | Uso | Condicion |
| --- | --- | --- |
| `GO` | Iniciar semana comercial completa. | Landing, cola, publicacion, metricas, seguimiento y responsable estan listos. |
| `GO CON RIESGO` | Iniciar con workaround controlado. | Hay fallas no bloqueantes, responsable asignado y accion manual clara. |
| `NO GO` | No iniciar semana comercial. | No se puede capturar leads, publicar/operar, medir, dar seguimiento o diagnosticar fallas. |

## Datos de salida

Completar antes de decidir:

```text
Fecha:
Ambiente:
Version/commit:
Responsable MKT:
Responsable ventas:
Responsable soporte:
Semana comercial:
Decision: GO / GO CON RIESGO / NO GO
Revision siguiente:
```

## Bloqueantes

No salir si existe cualquiera de estos puntos:

- `/backoffice/marketing` no carga para usuario `platform_admin`.
- `/soluciones/renta-facil` no carga o el formulario no captura leads.
- CTA principal no apunta a Renta Facil o no conserva UTM.
- No hay responsable interno para revisar resultados diarios.
- No hay ruta de seguimiento para leads nuevos.
- No hay forma de publicar ni manual ni automatizada.
- No hay forma de capturar metricas manuales.
- Cron de publicacion requerido esta fallando y no hay workaround.
- Meta es necesario para publicar hoy y no esta conectado.
- R2/creativos falla y no hay imagen principal util.
- Hay errores 500 persistentes en rutas internas MKT.
- No se sabe donde revisar errores si algo falla.

## Checklist ejecutivo

| Area | Criterio | Estado | Evidencia |
| --- | --- | --- | --- |
| Landing | `/soluciones/renta-facil` carga y explica publico, dolor y CTA. | Pendiente | URL/captura |
| Formulario | Captura lead con `solution_key=renta_facil`, UTM y calificacion. | Pendiente | ID lead o captura |
| CTA/UTM | Links generados tienen `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`. | Pendiente | Link de una campana |
| Backoffice | `/backoffice/marketing` carga sin error global. | Pendiente | Captura dashboard |
| Permisos | Usuario operador tiene `platform_admin`. | Pendiente | Usuario/responsable |
| Meta | Facebook/Instagram BetterP conectados si se publicara desde sistema. | Pendiente | Canal activo |
| Cron | `backoffice_marketing_publish_queue` existe o hay publicacion manual definida. | Pendiente | Salud/Render |
| Cola | Hay hasta 7 piezas revisadas, sin duplicados obvios y con publico claro. | Pendiente | IDs/titulos |
| Editorial | Piezas aceptadas tienen copy, CTA, UTM, preview y razon comercial. | Pendiente | Campana revisada |
| Creativos | Cada pieza de salida tiene creativo principal visible. | Pendiente | Preview/galeria |
| Primera salida | Primera pieza esta publicada o lista/programada con responsable. | Pendiente | Destino/fecha |
| Metricas | Captura manual preparada; Meta insights probado si aplica. | Pendiente | Destino metricas |
| Learning | Learning Loop ejecuta y muestra siguiente decision. | Pendiente | Captura/resumen |
| Leads | Mensajes de seguimiento listos y pipeline puede mover etapas. | Pendiente | Lead de prueba/real |
| Ventas | Guion de demo, objeciones y CTA definidos. | Pendiente | Guia operativa |
| Soporte | Runbook de observabilidad disponible y responsable asignado. | Pendiente | Guia/runbook |
| Pauta | Pauta pausada o con regla clara de presupuesto y apagado. | Pendiente | Paid readiness |

Valores recomendados para `Estado`:

- `OK`: listo y verificado.
- `RIESGO`: falla no bloqueante con responsable y workaround.
- `BLOQUEA`: impide go-live.
- `NO APLICA`: no se usara en esta semana.

## Minimos para `GO`

Todos estos deben estar en `OK`:

- Landing.
- Formulario.
- CTA/UTM.
- Backoffice.
- Permisos.
- Cola.
- Editorial.
- Creativos.
- Metricas.
- Leads.
- Ventas.
- Soporte.

Ademas, al menos una de estas rutas debe estar en `OK`:

- Meta + cron/publicacion desde BetterP.
- Publicacion manual documentada con responsable y calendario.

## Permitido para `GO CON RIESGO`

Se permite salir con riesgo si:

- Meta no esta conectado, pero se publicara manualmente.
- Meta insights no importa, pero se capturaran metricas manuales.
- Cron no esta activo, pero hay responsable de publicar manual.
- Learning Loop tiene poca muestra, pero cola y seguimiento operan.
- Pauta queda pausada por falta de datos.
- Faltan algunas piezas de la cola, pero hay plan diario para completarlas.

Cada riesgo debe tener:

```text
Riesgo:
Impacto:
Responsable:
Workaround:
Fecha limite:
Bloquea pauta: Si/No
Bloquea publicacion: Si/No
```

## No permitido para `GO CON RIESGO`

Estos casos son `NO GO`:

- Landing o formulario fallan.
- No hay UTM/CTA medible.
- No hay responsable de seguimiento.
- No hay forma de mover leads o registrar objeciones.
- No hay forma de publicar ni manual ni automatizada.
- No hay forma de medir resultados.
- Backoffice MKT no abre.
- Hay error tecnico sin ruta de diagnostico.

## Cierre de aprobacion

Formato de salida:

```text
Decision:
Motivo:
Piezas listas:
Primera publicacion:
Canales:
Pauta:
Responsable revision diaria:
Responsable seguimiento leads:
Pendientes no bloqueantes:
Bloqueantes:
Siguiente revision:
```

## Rutina de la primera semana

Dia 1:

- Confirmar primera publicacion.
- Revisar que el CTA abre landing.
- Revisar que formulario captura.
- Registrar evidencia.

Dia 2:

- Revisar clicks/leads.
- Contactar leads nuevos.
- Corregir pieza si el publico no entiende para quien es.

Dia 3:

- Capturar metricas.
- Revisar mejor/peor pieza preliminar.
- No meter pauta si no hay lead calificado.

Dia 4:

- Revisar objeciones.
- Preparar pieza anti-objecion si hay senal.
- Definir si retargeting pequeno aplica.

Dia 5:

- Cerrar semana: leads, demos, propuestas, perdidas, objecion dominante.
- Ejecutar Learning Loop.
- Decidir siguiente tanda.

## Evidencia minima

Guardar junto con la decision:

- Captura del dashboard MKT.
- Link de landing.
- Link UTM de una campana.
- ID/titulo de pieza aceptada.
- Captura de creativo principal.
- Estado de Meta o plan manual de publicacion.
- Estado de cron o plan manual de publicacion.
- Registro de una metrica capturada o plan de captura.
- Lead real/prueba capturado o evidencia de formulario.
- Responsable y siguiente revision.

## Documentos relacionados

- `docs/backoffice-mkt-smoke-checklist.md`: smoke funcional.
- `docs/backoffice-mkt-observability-runbook.md`: diagnostico de fallas.
- `docs/backoffice-mkt-operating-guide.md`: rutina ventas/soporte.
- `docs/renta-facil-content-engine.md`: reglas editoriales.
