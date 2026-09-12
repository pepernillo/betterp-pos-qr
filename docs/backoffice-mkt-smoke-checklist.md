# Smoke funcional Backoffice MKT

Este runbook valida que Backoffice MKT pueda operar una semana comercial de
Renta Facil sin asistencia de desarrollo. Se ejecuta despues de deploy o antes
de una semana real de publicaciones.

## Criterio de avance

No iniciar el smoke si existe cualquiera de estos bloqueantes:

- Backend o frontend con deploy fallido.
- Usuario sin acceso `platform_admin`.
- `/backoffice/marketing` no abre o redirige a login aunque la sesion este
  activa.
- Error persistente al cargar `/api/billing/admin/marketing/`.
- Meta desconectado cuando se pretende publicar o importar insights.
- R2/storage con error si se va a subir creativo.
- No hay responsable interno para revisar resultados diarios.

## Evidencia minima

Guardar en una nota interna, issue o reporte:

- Fecha y ambiente: local, staging o produccion.
- Usuario que ejecuta el smoke.
- Commit o version desplegada.
- Captura del dashboard de Marketing cargado.
- ID o titulo de una campana revisada.
- Resultado de una decision editorial.
- Resultado de una captura o importacion de metricas.
- Resultado del Learning Loop.
- Lead movido de etapa o motivo por el que no habia leads.
- Errores encontrados y decision: `GO`, `GO CON RIESGO` o `NO GO`.

## 1. Preparacion

- Abrir `https://betterp.net/backoffice/marketing`.
- Confirmar que el usuario es administrador de plataforma.
- Confirmar que la pantalla carga sin error global.
- Confirmar que aparecen las zonas principales:
  - resumen superior;
  - campanas;
  - resultados de esta semana;
  - learning loop;
  - prospectos;
  - conexiones.

Salida esperada:

- La pantalla queda operable y no muestra errores de permisos.

## 2. Conexiones Meta

- Abrir la vista de conexiones.
- Confirmar que Facebook e Instagram de BetterP aparecen como activos si se va
  a publicar.
- Confirmar `has_access_token` visualmente con estado conectado.
- Si Meta esta desconectado, no bloquear el resto del smoke editorial; registrar
  la incidencia y omitir publicacion/importacion Meta.

Salida esperada:

- `GO`: canales conectados y publicables.
- `GO CON RIESGO`: canales desconectados, pero solo se revisara editorialmente.
- `NO GO`: se requiere publicar hoy y no hay conexion Meta.

## 3. Cola semanal

- Ejecutar `Generar 7 dias`.
- Si ya existe cola activa, confirmar que el resultado completa huecos sin
  duplicar temas activos.
- Revisar que haya hasta 7 piezas programadas/en cola con temas distintos.
- Confirmar que las piezas tengan UTM y CTA hacia Renta Facil.

Salida esperada:

- Cola activa lista o explicacion clara de piezas omitidas por ya existir.

## 4. Revision de una campana

- Abrir una campana de la cola.
- Revisar:
  - titulo;
  - copy;
  - CTA;
  - URL con UTM;
  - variante por canal;
  - prompt visual;
  - brief editorial;
  - preview por canal.
- Confirmar que el publico meta se entiende en la primera linea o en el gancho.
- Confirmar que el mensaje habla a administradores de condominios, inmuebles o
  espacios en renta cuando aplique.

Salida esperada:

- La pieza puede aceptarse, modificarse o rechazarse con una razon concreta.

## 5. Creativo principal

- Subir o seleccionar un creativo.
- Confirmar que aparece en galeria.
- Si hay varias variantes, mover la final al primer lugar.
- Confirmar que la preview usa el creativo principal.
- Borrar variantes descartadas solo si no se necesitan como evidencia.

Salida esperada:

- La pieza tiene creativo principal claro antes de publicarse.

## 6. Decision editorial

- Aceptar una pieza lista.
- Rechazar o pedir modificacion en otra pieza con nota editorial concreta.
- Si se usa regeneracion, incluir feedback accionable:
  - publico;
  - dolor;
  - oferta;
  - objecion;
  - cambio visual.

Salida esperada:

- La pieza aceptada queda lista/programada.
- La pieza rechazada queda en borrador con nota.
- La pieza regenerada conserva metadata editorial y nuevo brief.

## 7. Publicacion controlada

Solo ejecutar si Meta esta conectado y la pieza esta aprobada.

- Publicar una pieza o iniciar cola con `publicar primera ahora`.
- Confirmar que el destino cambia a `PUBLICADA` o queda con error visible.
- Si falla, registrar mensaje, canal, campana y siguiente accion.

Salida esperada:

- `GO`: publicacion confirmada.
- `GO CON RIESGO`: editorial listo, publicacion manual pendiente.
- `NO GO`: publicacion requerida y falla sin ruta de recuperacion.

## 8. Metricas

- Abrir `Resultados de esta semana`.
- Para una pieza publicada, capturar manualmente:
  - impresiones;
  - clicks;
  - engagement;
  - leads;
  - gasto si aplica;
  - tipo de trafico;
  - periodo de medicion;
  - nota de fuente.
- Si el destino viene de Meta y tiene `external_id`, probar `Importar Meta`.

Salida esperada:

- La pieza actualiza metricas y el resumen semanal refleja views, clicks, leads
  y gasto.

## 9. Learning Loop

- Ejecutar analisis de aprendizaje.
- Confirmar que muestra:
  - mejor pieza;
  - pieza debil;
  - mejor canal;
  - leads;
  - objecion dominante;
  - decision recomendada;
  - pauta sugerida o pausa.
- Exportar/copiar prompt de siguiente semana si hay senales suficientes.

Salida esperada:

- La siguiente accion queda clara: repetir, reescribir, responder objecion,
  retargeting, prueba fria o pausa.

## 10. Prospectos y seguimiento

- Revisar prospectos recientes.
- Confirmar UTM, solucion, calificacion y dolor principal.
- Copiar mensaje de seguimiento o abrir WhatsApp/email.
- Mover un lead de `NUEVO` a `CONTACTADO` si se hizo contacto real.
- Si hay demo o propuesta, mover etapa y registrar nota.
- Si se pierde una propuesta, registrar objecion obligatoria.

Salida esperada:

- El pipeline refleja la accion comercial real y alimenta el Learning Loop.

## 11. Decidir salida

Usar una de estas decisiones:

- `GO`: dashboard, cola, editorial, metricas, learning y pipeline funcionan.
- `GO CON RIESGO`: hay una falla no bloqueante, documentada y con responsable.
- `NO GO`: no se puede publicar, medir, seguir leads o cargar el dashboard.

Formato sugerido:

```text
Fecha:
Ambiente:
Usuario:
Version/commit:
Decision: GO | GO CON RIESGO | NO GO
Campana revisada:
Canales:
Metrica capturada/importada:
Learning Loop:
Lead revisado:
Riesgos:
Responsable:
Siguiente revision:
```

## Fallas comunes

| Sintoma | Causa probable | Accion |
| --- | --- | --- |
| 403 en Backoffice MKT | Usuario no es `platform_admin` | Usar cuenta administradora o revisar perfil. |
| Campanas no publican | Meta desconectado, token vencido o canal sin permiso | Revisar conexiones y reconectar Meta. |
| Creativo no se ve | Storage/R2 o URL firmada fallando | Revisar carga, bucket y logs backend. |
| Learning sin decision util | Faltan metricas o leads calificados | Capturar metricas y mover pipeline. |
| Pauta queda pausada | Falta lead calificado u objecion no respondida | Crear pieza anti-objecion antes de invertir. |
| Leads sin UTM | Link incorrecto o publicacion manual sin parametros | Corregir CTA antes de publicar mas. |
