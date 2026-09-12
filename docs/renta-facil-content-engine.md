# Motor de contenido diario Renta Fácil

Ultima actualizacion: 2026-07-06

Este documento convierte la Fase 2 de Backoffice MKT en un sistema operativo
de contenido diario para vender Renta Fácil. La prioridad es generar tráfico
calificado, leads y demos sin esperar pauta pagada.

## Objetivo

Publicar todos los días contenido de BetterP/Renta Fácil con un CTA medible:

```text
Solicitar demo de Renta Fácil
```

Link base:

```text
https://betterp.net/soluciones/renta-facil#contacto
```

Link medible:

```text
https://betterp.net/soluciones/renta-facil?utm_source={source}&utm_medium={medium}&utm_campaign=renta_facil_lanzamiento&utm_content={content}#contacto
```

## Pivote Semana 3: conversación antes que vitrina

Las primeras dos semanas validaron temas y vistas, pero no convirtieron en
ventas. La tercera semana mantiene los pilares con mejor señal para poder
comparar, pero cambia la intención: cada pieza debe provocar una respuesta
simple del prospecto, no sólo explicar que Renta Fácil es mejor.

Regla central:

```text
Publicar para abrir conversación medible: comentario, DM, WhatsApp, diagnóstico
o click calificado.
```

Cadencia de los 7 días:

| Día | Tema base | Pivote | Acción esperada | Señal principal |
| --- | --- | --- | --- | --- |
| Lunes | Cobranza automatizada | Pregunta directa sobre cobranza manual | Comenta COBRANZA | Comentarios, DMs y clics de cobranza |
| Martes | Autoservicio para clientes | Dolor de facturas, saldos y comprobantes en Excel/WhatsApp | Responde CLIENTES | Respuestas y guardados |
| Miércoles | Métricas en tiempo real | Diagnóstico de control ejecutivo | Comenta DATOS | Guardados, compartidos y clics |
| Jueves | Menos espacios vacíos | Objeción de operar con redes, hojas y mensajes | Escribe RENTA + espacios libres | DMs con contexto operativo |
| Viernes | Publicación multicanal | Incentivo de checklist para evitar doble captura | Comenta PUBLICAR | Comentarios y DMs |
| Sábado | Rentabilidad por unidad | Mini caso de unidad que consume más de lo que deja | Responde GANANCIA | Guardados y clics de multiunidad |
| Domingo | Demo enfocada en dinero | Cierre consultivo de 15 minutos | Pide DIAGNOSTICO | Formularios y demos agendadas |

El CTA visual o del botón puede seguir llevando al formulario, pero el caption
debe pedir una respuesta de baja fricción. La medición de la semana no se debe
leer sólo como vistas: una publicación con menos alcance pero más mensajes puede
ser mejor señal comercial.

## Reglas

- No prometer resultados garantizados.
- No inventar funciones fuera de Renta Fácil.
- No abrir Google Ads en esta fase.
- No mezclar Backoffice MKT con Marketing cliente.
- Cada publicación debe tener un dolor, una idea central y una acción.
- Cada publicación debe incluir una mecánica de respuesta: palabra clave,
  pregunta, dato operativo, DM o diagnóstico.
- Evitar el patrón "mi producto es el mejor"; la pieza debe sentirse como una
  conversación entre vendedor, cliente y producto.
- Cada publicación debe vender una sola idea. No intentar explicar todo Renta
  Fácil en el mismo post.
- No empezar pidiendo demo cuando el prospecto todavía no conoce el producto.
  Primero se crea necesidad: dinero perdido, horas administrativas o falta de
  control.
- Meta/Facebook debe usar copy corto y visual. Instagram debe depender más de
  la imagen o carrusel que del texto. LinkedIn puede explicar más, pero con
  párrafos breves.
- Cada pieza debe llevar UTM.
- Si una campaña base ya existe pero conserva copy obsoleto del motor anterior,
  el generador debe refrescarla en sitio mientras no haya sido publicada, para
  evitar duplicados y sacar a producción el criterio editorial vigente.
- La cola generada desde aprendizaje no debe repetir un mismo tema activo en la
  semana. Si ya existe una campaña no publicada con ese `topic_slug`, la nueva
  tanda debe omitirlo aunque cambie la acción de aprendizaje.
- El botón `Generar 7 días` debe completar la cola activa hasta 7 temas únicos:
  si ya hay 5 piezas aprobadas/programadas y se borraron 2, el motor sólo crea
  las 2 faltantes. Para este conteo, cola activa significa campañas
  `PROGRAMADA` o `EN_COLA`; borradores viejos no deben bloquear huecos.
- Las campanas `PUBLICADA` quedan como historico y no bloquean una nueva tanda.
  Volver a presionar `Generar 7 dias con aprendizaje` no archiva ni borra la
  semana anterior; crea o completa la siguiente cola activa.
- Cuando `OPENAI_API_KEY` esta configurado y `OPENAI_MARKETING_CONTENT_ENABLED`
  esta activo, cada pieza creada o refrescada debe generar copy, variantes por
  canal y prompt visual mediante una solicitud individual al modelo configurado
  en `OPENAI_MARKETING_CONTENT_MODEL` (default: `gpt-5.5`). No se debe generar
  la semana completa con un solo prompt.
- Si OpenAI falla o no hay llave, la pieza debe conservar el motor local como
  fallback y registrar el motivo en `metadata.ai_generation`.
- Cada día debe revisarse si hubo clics, leads, mensajes o conversaciones.
- Cada campana debe incluir un prompt detallado para generar imagen, con
  narrativa visual, identidad BetterP, uso del logo adjunto y restricciones de
  composicion.
- El prompt de imagen debe escribirse en ingles para mejorar respuesta de
  generadores visuales, aunque el headline opcional pueda estar en espanol.
- En creativos, la prioridad es que la imagen cuente la historia comercial en
  menos de 3 segundos; el caption acompana, no rescata una imagen confusa.
- La imagen puede ser infografia compacta, storytelling visual o hibrida segun
  la intencion de la pieza; el sweet point se prueba por clicks, guardados,
  leads y objeciones.

## Directiva visual

Cada propuesta de campana debe salir con un brief visual accionable:

- Narrativa de la imagen: que problema se ve, que cambia y que control gana el
  administrador.
- Storytelling principal de la segunda iteracion: administradores de
  condominios, inmuebles y espacios en renta que hoy cobran por llamadas,
  correos o mensajes necesitan automatizar recordatorios, pagos y control.
  Vacancia sigue siendo un angulo de apoyo, no el unico punto de entrada.
- Storytelling operativo: antes habia publicaciones en redes, pagos en Excel,
  comprobantes y facturas manuales; con BetterP, publicaciones, pagos y
  facturas viven en un solo sistema. Esta idea debe verse como transformacion
  visual, no como explicacion larga.
- Storytelling de autoservicio: una de las actividades que mas consume tiempo
  al administrar espacios es la atencion al cliente. Cuando facturas,
  comprobantes o saldos dependen de mensajes o correos, el cliente espera y el
  equipo vuelve a resolver lo mismo. Renta Facil debe presentar el portal como
  datos fiscales, facturas, comprobantes y estado de cuenta a un click.
- Storytelling de cobranza automatizada: si administras condominios o espacios
  en renta y cobras por llamadas, correos o mensajes, Renta Facil automatiza
  recordatorios para cuentas vencidas, rentas pendientes y pagos realizados
  pero no registrados. Usar infografia clara con "hasta 80% menos seguimiento
  manual" como hipotesis operativa no garantizada; no saturar con chats ni
  logos de terceros.
- Storytelling de unidad rentable: edificio, cabana, casa, habitacion o unidad
  deben poder leerse por separado con balance, tiempo y recursos consumidos.
  La historia debe partir de herramientas que no ayudan a controlar y cerrar en
  donde la operacion realmente tiene ganancias.
- Preset visual para vacancia cuando el formato sea anuncio simple: anuncio
  editorial claro, fondo blanco, encabezado grande arriba y triptico inferior.
  Izquierda: espacio vacio con senal roja de costo o calendario. Centro: BetterP
  publicando/promoviendo el espacio. Derecha: interesados, consulta, llamada,
  handshake o check verde.
- Identidad BetterP: SaaS B2B limpio, confiable, moderno, con acentos cyan/azul
  y lectura ejecutiva.
- Estilo visual: no defaultar todo a blanco plano. El blanco editorial funciona
  para algunas piezas de vacancia, pero las piezas operativas pueden usar fondos
  navy/cyan, luz, volumen, contraste y humor visual si mantienen lectura premium.
- Logo: adjuntar el logo BetterP como referencia en cada generacion e incluirlo
  visible pero discreto, sin redibujarlo ni alterar proporciones.
- Composicion: una escena clara y literal. Problema -> accion BetterP ->
  resultado visible. El triptico claro es un preset, no una regla universal:
  otras piezas pueden usar infografias limpias, checklist, data snaps o
  antes/despues si el formato editorial lo justifica. Para horas administrativas,
  preferir una infografia antes/despues: lado manual con redes, Excel, pagos,
  facturas y tiempo perdido; lado BetterP con sistema integrado y check de
  control. Evitar paneles gigantes, muchos iconos, flechas decorativas, graficas
  y dashboards saturados.
- Texto en imagen: una frase principal y una linea de apoyo. No usar parrafos,
  formulas, mini casos, bullets ni explicaciones como
  `1 unidad libre + cobro tarde = ingreso detenido`. Si el generador no escribe
  bien el texto, debe dejar espacio limpio para sobreponerlo despues.
- Modos visuales iniciales:
  - Anuncio simple: una sola idea, una escena y un resultado facil de entender.
  - Storytelling visual: escena casi sin texto.
  - Hibrido: contraste antes/despues o flujo visual con dos etiquetas maximo.
  - Infografia cool: problema manual -> sistema BetterP -> control visible, con
    diseno mas memorable que una lamina corporativa plana.
- Restricciones: sin promesas garantizadas, sin stock generico, sin logos de
  terceros sin permiso y sin interfaces falsas ilegibles.
- Salida sugerida: PNG 1080x1080 para Facebook e Instagram.

## Directiva comercial 2026-06-21

El contenido debe vender primero impacto económico y después funcionalidades.
Los pilares de campaña se separan asi para evitar publicaciones redundantes:

1. **Menos espacios vacíos.** El cliente quiere perder menos dinero. El ángulo
   principal es que la disponibilidad llegue rápido a canales comerciales como
   Mercado Libre, Metros Cúbicos, Facebook e Instagram, con seguimiento claro
   para que los espacios pasen menos tiempo sin renta por gestión lenta.
2. **Autoservicio para clientes.** La atencion al cliente consume mucho tiempo
   al administrar espacios. Si cada factura, comprobante o saldo depende de un
   mensaje o correo, el cliente espera y el equipo tiene que resolverlo. Renta
   Facil debe dar al cliente un portal para actualizar datos fiscales, descargar
   facturas, subir comprobantes y consultar estado de cuenta, todo a un click.
3. **Cobranza automatizada.** La cobranza manual funciona hasta que la
   operacion crece y se acumulan vencimientos o pagos vencidos. Renta Facil
   debe conectar recordatorios por WhatsApp, registro de pagos y control de
   cobranza con menor cartera vencida y mejor flujo de efectivo.
4. **Unidades de negocio rentables.** Cuando las herramientas de trabajo no
   ayudan a controlar, es dificil saber si el negocio crece o solo consume mas
   tiempo y recursos. Renta Facil debe mostrar balance por unidad para validar
   en que parte de la operacion realmente hay ganancias.
5. **Datos para decidir.** Ingresos, cartera vencida, gastos por unidad de
   negocio, ocupación y movimientos deben vivir en una sola lectura para tomar
   decisiones estratégicas sin esperar reportes manuales.

Traducción comercial:

- mayores ingresos por menor vacancia;
- más tiempo para operar, vender y mejorar;
- menos nómina dedicada a tareas repetitivas;
- más control del negocio;
- datos en tiempo real para decidir.

Toda pieza generada debe usar español natural con acentos y ñ. El copy, los
títulos y las infografías deben leerse como material comercial compartible, no
como texto plano de sistema.

Ofertas base de lanzamiento:

- 7 días gratis.
- 10% de descuento.
- 12 meses por pago de 10.
- Devolución si el sistema no convence, sujeta a condiciones acordadas en demo.

Estas ofertas son hipótesis comerciales, no reglas inamovibles. Cada ciclo de
aprendizaje puede reforzarlas, reordenarlas, pausar alguna o cambiar el ángulo
según clicks, leads, demos, objeciones y cierres reales.

## Regla de copy por canal

El texto largo funciona como razonamiento interno, no como caption principal.
La publicación debe salir con esta estructura:

```text
Gancho: dolor o dinero en una frase.
Puente: nombrar la fricción operativa sin repetir el dolor ni explicar obviedades.
Solución: decir qué hace Renta Fácil de forma concreta.
Oferta: sólo si ayuda a avanzar la conversación.
CTA: acción simple.
```

Regla de tono:

- No explicarle al cliente lo que ya sabe de su negocio. Si el gancho dice que
  un espacio vacío cuesta dinero, el siguiente párrafo no debe repetir síntomas
  como "unidades vacías" o "disponibilidad dispersa".
- El puente debe pasar del problema a la acción: por ejemplo, si la operación se
  retrasa al publicar espacios en redes y canales de venta, BetterP entra para
  quitar trabajo manual.
- La solución debe ser directa: Renta Fácil publica y promueve espacios
  disponibles para agilizar la renta, ordena cobros o concentra datos según el
  pilar de la pieza.
- La oferta de prueba debe sonar comercial y simple: "Prueba Renta Fácil 7 días
  gratis. Si contratas y no te convence, aplicamos devolución."
- El CTA de conversión recomendado es: "Agenda una revisión de Renta Fácil y ve
  el potencial de automatizar tu negocio."
- Usar lenguaje común, frases completas y comerciales. Evitar tecnicismos como
  "trazabilidad" salvo que el contexto lo pida.

Guía por canal:

| Canal | Largo recomendado | Uso |
| --- | --- | --- |
| Facebook | 2 a 4 párrafos breves | Dolor, beneficio y CTA con link |
| Instagram | 1 gancho + 2 líneas de apoyo | La infografía carga la explicación |
| LinkedIn | 3 a 5 párrafos cortos | Contexto ejecutivo y CTA suave |

No todas las publicaciones deben llevar todas las promociones. Las promociones
rotan por intención editorial y se ajustan con datos.

## Rotación semanal inicial

| Día | Rol | Objetivo | Oferta |
| --- | --- | --- | --- |
| Lunes | Dolor económico | Nombrar al público meta y el costo de cobranza o gestión manual | Sin oferta |
| Martes | Oferta de entrada | Bajar fricción para conversar | 7 días gratis + 10% |
| Miércoles | Sabías que | Educar con una idea compartible | Sin oferta |
| Jueves | Producto aplicado | Conectar dolor con ventaja concreta | Sin oferta |
| Viernes | Comparativo | Mostrar antes/después de operar disperso | 12 meses por pago de 10 |
| Sábado | Checklist operativo | Diagnóstico simple para guardar | Sin oferta |
| Domingo | CTA suave | Invitar a conocer el producto | 7 días gratis + devolución condicionada |

Esta rotación es punto de partida, no dogma. Si el learning loop detecta que un
rol produce clicks pero no leads, se reescribe el gancho. Si produce leads pero
mal calificados, se ajusta oferta, filtro o CTA. Si produce demos reales, se
repite con variantes.

## Matriz editorial v2

Directriz de posicionamiento:

Renta Fácil debe comunicar primero a **espacios e inmuebles en renta**. El foco
comercial inicial no son nichos aislados como salones o canchas, sino negocios
que administran espacios, departamentos, casas, cabañas, coliving, condominios
y varias unidades en renta. Los nichos por hora, evento o industria quedan como
extensiones posteriores, no como centro del mensaje inicial.

Regla: si una pieza menciona un caso específico, debe sentirse como ejemplo de
la categoría general, no como si Renta Fácil sólo sirviera para ese nicho.

Cada campaña debe nacer con intención comercial explícita:

| Campo | Pregunta que responde |
| --- | --- |
| Pilar | ¿Qué vendemos: menos vacancia, menos horas o más control? |
| Segmento | ¿Para qué tipo de negocio se escribió? |
| Etapa del embudo | ¿Estamos creando necesidad, educando, considerando o convirtiendo? |
| Formato | ¿La pieza debe ser infografía, checklist, mini caso o antes/después? |
| Objeción | ¿Qué duda probablemente tendrá el prospecto? |
| Oferta | ¿La promoción ayuda o distrae? |
| Hipótesis | ¿Qué esperamos medir: guardados, clics, leads, demos u objeciones? |
| Brief visual | ¿Qué debe explicar la imagen sin depender del caption? |

Segmentos iniciales:

- Espacios e inmuebles en renta.
- Departamentos, casas y cabañas.
- Coliving y condominios.
- Operación multi-unidad.

Segmentos posteriores:

- Salones de eventos.
- Canchas y espacios por horario.
- Consultorios y espacios profesionales.
- Coworkings y espacios flexibles.
- Bodegas y renta mensual.

Etapas:

- `Awareness`: hacer visible el costo económico.
- `Educación`: entregar una idea útil y compartible.
- `Consideración`: conectar dolor con ventaja concreta de Renta Fácil.
- `Conversión`: reducir fricción para iniciar conversación comercial.

## Oferta con intención

Las promociones no son un bloque obligatorio. Cada campaña debe declarar un
`offer_plan`:

- `sin_oferta`: la pieza vende dolor, contexto o aprendizaje. No se menciona
  promoción.
- `apoyo`: la oferta aparece como refuerzo, pero no desplaza el mensaje.
- `conversion`: la oferta reduce riesgo para llevar a demo, prueba o revisión.

Regla:

- 7 días gratis: bajar fricción cuando el prospecto ya entiende el problema.
- 10% de descuento: empujar decisión en segunda exposición o remarketing.
- 12 meses por pago de 10: conversación anual o cierre con mejor incentivo.
- Devolución condicionada: reducir miedo cuando el prospecto duda del cambio.

## Brief visual

Cada campaña debe traer un brief visual para que Facebook e Instagram no
dependan del texto largo. El brief incluye:

- formato;
- título visual;
- tres puntos máximos;
- dirección creativa;
- prompt visual reutilizable.

Formatos activos:

- Infografía de 3 puntos.
- Antes/después.
- Checklist operativo.
- Mini caso numérico.
- Sabías que.

## Revisión editorial en Backoffice

La cola generada debe pasar por revisión antes de escalar volumen:

1. Revisar la campaña desde la tabla de Backoffice MKT.
2. Abrir el modal para leer copy, UTM, creativo, destinos y ofertas.
3. Aceptar si la pieza está lista.
4. Rechazar si no debe salir.
5. Marcar para modificar cuando necesita ajustes puntuales.
6. Escribir comentarios editoriales y regenerar si se quiere una nueva versión.
7. Borrar una o varias campañas cuando la cola anterior ya no represente la
   estrategia vigente.

Checklist de revisión:

- ¿El gancho habla de dinero, tiempo o control?
- ¿Se entiende que aplica a espacios e inmuebles en renta?
- ¿La publicación vende una sola idea?
- ¿La oferta aparece sólo si ayuda a avanzar?
- ¿La imagen explica rápido sin depender del caption?
- ¿La hipótesis se puede medir?

Regla operativa:

- `ACEPTADA`: puede volver a `PROGRAMADA` si tenía fecha.
- `RECHAZADA` o `MODIFICAR`: queda en `BORRADOR` para que el cron no la publique.
- `REGENERADA`: queda en `BORRADOR` hasta nueva aceptación.

## Herramienta temporal

Inicio recomendado:

- Facebook e Instagram: Meta Business Suite.
- LinkedIn: publicacion manual desde la cuenta/pagina de BetterP.
- TikTok/Reels: publicar solo si hay video corto listo.

Metricool o Buffer quedan como opcion posterior si la programacion multicanal
se vuelve cuello de botella. En esta fase evitamos pagar herramientas antes de
validar mensaje, canal y respuesta.

## Motor interno BetterP

Backoffice MKT ya puede generar la primera cola editorial desde la pantalla viva
sin usar una herramienta externa como origen del copy.

Endpoint:

```text
POST /api/billing/admin/marketing/content-engine/generate-week/
```

Payload base:

```json
{
  "days": 7,
  "local_time": "10:15"
}
```

Resultado esperado:

- 7 campañas programadas para Renta Fácil.
- 1 creativo PNG tipo infografía por campaña para poder publicar también en Instagram.
- Copy principal, variantes por canal y brief visual refinados por IA por pieza
  cuando OpenAI este disponible; si no, fallback local sin detener la cola.
- CTA a demo con UTM `renta_facil_lanzamiento`.
- Destinos creados sobre los canales activos y publicables del Backoffice.
- Metadata editorial con segmento, métrica objetivo, gates de calidad y
  variantes para Facebook, Instagram y LinkedIn.
- Metadata `ai_generation` por campana con `mode`, `model`,
  `request_scope=single_post`, fecha, notas o error de fallback.
- Matriz editorial con pilar, segmento, etapa del embudo, formato, objeción,
  hipótesis, estrategia de oferta y checklist de revisión.
- Brief visual con formato, dirección, puntos y prompt.

Cron de publicacion:

```text
python backend/manage.py publish_marketing_campaigns --limit 10 --fail-on-error
```

Llave de salud:

```text
backoffice_marketing_publish_queue
```

Rutina:

1. Generar la cola de 7 días desde Backoffice MKT.
2. Revisar copy, CTA, fecha, UTM y creativo antes de que venza la salida.
3. Ajustar cualquier pieza que no suene madura, específica o vendible.
4. Dejar el cron publicar campañas `PROGRAMADA` vencidas.
5. Publicar LinkedIn manualmente usando la variante guardada en metadata.
6. Revisar clicks, mensajes y leads al día siguiente.

## Learning Loop y sweet point

La cadencia no se decide por intuición. BetterP calcula un reporte de
aprendizaje con:

- views, clicks y engagement por campaña;
- leads atribuidos por `utm_content`;
- avance comercial del lead: nuevo, contactado, demo, propuesta, ganado o
  perdido;
- score comercial por tema;
- recomendación de cadencia;
- prompt exportable para la siguiente semana con matriz, audiencia, oferta,
  CTA, UTM e hipotesis medible;
- análisis IA opcional si `OPENAI_API_KEY` está configurado.

Endpoint:

```text
POST /api/billing/admin/marketing/learning/analyze/
```

Payload base:

```json
{
  "window_days": 30
}
```

Regla inicial:

- Primeros 14 días: 1 publicación diaria.
- Si hay al menos 7 publicaciones con datos, 3 o mas leads y score promedio
  sano, probar 2 publicaciones solo martes y jueves.
- No subir a 3 publicaciones diarias hasta comprobar que el score por post no
  baja y que los leads o demos aumentan.
- Si hay views sin leads, no subir frecuencia: reescribir hooks, CTA y
  continuidad con landing.
- Antes de regenerar la semana, copiar o descargar el prompt de aprendizaje
  desde Backoffice MKT y revisar que mantenga publico meta, objecion principal,
  oferta y criterio de pauta.

## Convencion UTM

Fuentes:

- `facebook`
- `instagram`
- `linkedin`
- `whatsapp`

Medium:

- `social`
- `bio`
- `post`
- `reel`
- `story`
- `message`

Campana:

- `renta_facil_lanzamiento`

Contenido:

- usar una clave corta del tema, por ejemplo `dolor_cobranza`,
  `agenda_whatsapp`, `ocupacion`, `antes_despues`.

Ejemplo:

```text
https://betterp.net/soluciones/renta-facil?utm_source=facebook&utm_medium=post&utm_campaign=renta_facil_lanzamiento&utm_content=dolor_cobranza#contacto
```

## Pilares de contenido

- Dolor operativo: mostrar el problema que el prospecto ya vive.
- Orden y control: explicar que se gana al centralizar.
- Flujo comercial: demo, seguimiento, objeciones y decision.
- Producto: funciones reales de Renta Facil.
- Comparativo: antes y despues de operar con BetterP.
- Educacion: buenas practicas para administrar espacios.

## Calendario de 30 dias

| Dia | Pilar | Tema | Publico principal | Formato | UTM content | Metrica |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Dolor operativo | Cobros perdidos entre WhatsApp, notas y hojas de calculo | Espacios e inmuebles en renta | Carrusel | `dolor_cobranza` | Clics a demo |
| 2 | Orden y control | Saber que unidades estan libres, ocupadas o pendientes | Departamentos, casas y cabañas | Imagen unica | `ocupacion` | Clics |
| 3 | Producto | Clientes, contratos y datos en un expediente central | Administradores de propiedades | Post texto + captura | `expediente_cliente` | Leads |
| 4 | Comparativo | Antes: Excel y mensajes. Despues: operacion conectada | Duenos de espacios e inmuebles | Carrusel | `antes_despues_excel` | Guardados |
| 5 | Dolor operativo | Anticipos, rentas, saldos y comprobantes sin contexto | Renta habitacional y temporal | Reel corto | `anticipos_saldos` | Mensajes |
| 6 | Educacion | Como revisar tu operacion diaria en 10 minutos | Administradores multi-unidad | Checklist | `revision_diaria` | Clics |
| 7 | CTA directo | Agenda demo de Renta Facil si administras espacios o inmuebles | Todos | Post directo | `demo_directa` | Leads |
| 8 | Dolor operativo | El costo invisible de capturar dos veces el mismo dato | Administradores de propiedades | Carrusel | `captura_duplicada` | Guardados |
| 9 | Producto | Cobranza y portal cliente conectados | Coliving y condominios | Imagen + texto | `portal_cobranza` | Clics |
| 10 | Orden y control | Pagos, gastos y bancos en una misma lectura | Operadores multi-unidad | Post LinkedIn | `finanzas_conectadas` | Leads |
| 11 | Educacion | Senales de que tu operacion ya necesita sistema | Duenos de espacios e inmuebles | Carrusel | `senales_sistema` | Clics |
| 12 | Producto | Reportes para decidir sin armar hojas desde cero | Administradores de propiedades | Imagen unica | `reportes` | Clics |
| 13 | Dolor operativo | Cuando nadie sabe si una unidad ya esta apartada | Espacios e inmuebles en renta | Reel corto | `apartados` | Mensajes |
| 14 | CTA directo | Pide una demo aplicada a tu operacion de renta | Todos | Post directo | `demo_tipo_espacio` | Leads |
| 15 | Comparativo | Libreta vs sistema: que se pierde en cada cambio | Operaciones pequeñas de renta | Carrusel | `libreta_vs_sistema` | Guardados |
| 16 | Producto | Planes por volumen, no por funciones recortadas | Duenos de varias unidades | Imagen + texto | `planes_volumen` | Clics |
| 17 | Educacion | Que datos debes tener claros antes de crecer | Administradores multi-unidad | Checklist | `datos_para_crecer` | Guardados |
| 18 | Dolor operativo | Mensajes perdidos de clientes, inquilinos o huespedes | Operadores de renta | Reel corto | `mensajes_perdidos` | Mensajes |
| 19 | Orden y control | Un dato actualizado debe alimentar toda la operacion | Administradores de propiedades | Post texto | `dato_unico` | Clics |
| 20 | Producto | OCR de comprobantes y revision de pagos | Cobranza de rentas y cuotas | Imagen + texto | `ocr_comprobantes` | Leads |
| 21 | CTA directo | Demo guiada para ordenar ocupacion y cobranza | Todos | Post directo | `demo_ocupacion_cobranza` | Leads |
| 22 | Dolor operativo | Hacer cierre del dia sin cazar informacion | Administradores multi-unidad | Carrusel | `cierre_dia` | Guardados |
| 23 | Producto | WhatsApp conectado a seguimiento operativo | Operadores de renta | Reel corto | `whatsapp_contexto` | Mensajes |
| 24 | Educacion | Preguntas para diagnosticar tu administracion | Duenos de espacios e inmuebles | Checklist | `diagnostico_admin` | Leads |
| 25 | Comparativo | Operar por memoria vs operar con trazabilidad | Administradores de propiedades | Carrusel | `trazabilidad` | Guardados |
| 26 | Producto | Publicacion de espacios y disponibilidad conectada | Espacios e inmuebles con canales | Imagen + texto | `publicacion_espacios` | Clics |
| 27 | Dolor operativo | Cuando una renta cambia y todo el equipo se entera tarde | Equipos operativos de renta | Reel corto | `cambios_tarde` | Mensajes |
| 28 | CTA directo | Renta Facil para espacios, inmuebles y unidades en renta | Todos | Post directo | `demo_hora_dia_mes` | Leads |
| 29 | Educacion | Como elegir un sistema de administracion de espacios e inmuebles | Duenos de propiedades | Carrusel | `elegir_sistema` | Guardados |
| 30 | Cierre de ciclo | Que aprendimos de operar rentas con datos conectados | Todos | Post recap | `recap_mes` | Leads |

## Primera tanda lista para publicar

### Dia 1 - Cobros perdidos entre WhatsApp, notas y hojas de calculo

UTM:

```text
https://betterp.net/soluciones/renta-facil?utm_source=facebook&utm_medium=post&utm_campaign=renta_facil_lanzamiento&utm_content=dolor_cobranza#contacto
```

Facebook:

```text
Si administras espacios, el problema no siempre es cobrar.
El problema es saber quien ya pago, quien debe, que comprobante llego y donde quedo la conversacion.

Renta Facil centraliza clientes, saldos, comprobantes, cobranza y operacion para que tu equipo trabaje con la misma informacion.

Solicita una demo de Renta Facil:
https://betterp.net/soluciones/renta-facil?utm_source=facebook&utm_medium=post&utm_campaign=renta_facil_lanzamiento&utm_content=dolor_cobranza#contacto
```

Instagram:

```text
Cobrar no deberia depender de buscar mensajes, revisar capturas y abrir hojas distintas.

Con Renta Facil puedes ordenar clientes, saldos, comprobantes y cobranza desde BetterP.

Agenda demo en el link.
```

LinkedIn:

```text
En negocios que rentan espacios, la cobranza se vuelve fragil cuando la informacion vive en WhatsApp, hojas de calculo y notas sueltas.

Renta Facil de BetterP centraliza clientes, saldos, comprobantes y seguimiento para que la operacion tenga trazabilidad.

Estamos abriendo demos para administradores de espacios.
https://betterp.net/soluciones/renta-facil?utm_source=linkedin&utm_medium=post&utm_campaign=renta_facil_lanzamiento&utm_content=dolor_cobranza#contacto
```

Video corto:

```text
Escena 1: "Tienes pagos en WhatsApp, saldos en Excel y pendientes en la cabeza?"
Escena 2: "Ese desorden cuesta tiempo y seguimiento."
Escena 3: "Renta Facil centraliza cobranza, clientes y operacion."
Escena 4: "Agenda una demo y revisamos tu caso."
```

Texto para imagen:

```text
Cobranza sin contexto = operacion lenta.
Ordena clientes, saldos y comprobantes con Renta Facil.
```

Prompt visual:

```text
Imagen comercial limpia para SaaS B2B mexicano, administrador revisando pagos,
calendario y comprobantes en una pantalla moderna, ambiente de oficina realista,
colores azul cian, verde y gris, estilo profesional, sin texto dentro de la imagen.
```

Hashtags:

```text
#RentaFacil #BetterP #AdministracionDeEspacios #Cobranza #SaaS
```

Metrica principal: leads.

### Dia 2 - Ocupacion clara

UTM:

```text
https://betterp.net/soluciones/renta-facil?utm_source=facebook&utm_medium=post&utm_campaign=renta_facil_lanzamiento&utm_content=ocupacion#contacto
```

Facebook:

```text
Si alguien te pregunta "esta libre?", la respuesta no deberia depender de revisar tres chats.

Renta Facil ayuda a administrar ocupacion, espacios, inmuebles, clientes y operacion desde un solo lugar.

Ideal para negocios que administran departamentos, casas, cabañas, coliving, condominios, habitaciones o espacios en renta.

Solicita una demo:
https://betterp.net/soluciones/renta-facil?utm_source=facebook&utm_medium=post&utm_campaign=renta_facil_lanzamiento&utm_content=ocupacion#contacto
```

Instagram:

```text
"Creo que esta libre" no es una forma segura de operar.

Con Renta Facil puedes tener una lectura clara de ocupacion y pendientes.

Agenda demo.
```

LinkedIn:

```text
La disponibilidad es una pieza critica para cualquier negocio que renta espacios.

Cuando la informacion esta dispersa, aparecen errores: fechas duplicadas, espacios mal apartados, saldos pendientes o clientes sin seguimiento.

Renta Facil centraliza ocupacion y operacion para dar mas control al administrador.
https://betterp.net/soluciones/renta-facil?utm_source=linkedin&utm_medium=post&utm_campaign=renta_facil_lanzamiento&utm_content=ocupacion#contacto
```

Video corto:

```text
Escena 1: "Alguien pregunta: esta libre el espacio?"
Escena 2: "Tu equipo revisa WhatsApp, calendario y Excel."
Escena 3: "Con Renta Facil, la operacion vive en un solo sistema."
Escena 4: "Pide una demo."
```

Texto para imagen:

```text
Disponibilidad clara.
Menos doble captura.
Mas control para rentar espacios.
```

Prompt visual:

```text
Dashboard moderno mostrando disponibilidad de espacios, calendario y estados de
ocupacion, estilo SaaS profesional, fondo claro con acentos cian y verde,
administrador de espacios revisando una laptop, sin texto incrustado.
```

Hashtags:

```text
#RentaDeEspacios #RentaFacil #BetterP #Operacion #SaaS
```

Metrica principal: clics.

### Dia 3 - Expediente central

UTM:

```text
https://betterp.net/soluciones/renta-facil?utm_source=linkedin&utm_medium=post&utm_campaign=renta_facil_lanzamiento&utm_content=expediente_cliente#contacto
```

Facebook:

```text
Tus clientes no son solo un nombre en una lista.

Cada cliente puede tener datos, contratos, saldos, pagos, facturacion, mensajes y seguimiento.

Renta Facil ayuda a concentrar esa informacion para que tu administracion no dependa de buscar en varios lugares.

Agenda demo:
https://betterp.net/soluciones/renta-facil?utm_source=facebook&utm_medium=post&utm_campaign=renta_facil_lanzamiento&utm_content=expediente_cliente#contacto
```

Instagram:

```text
Un cliente.
Un expediente.
Una operacion con mas contexto.

Renta Facil conecta clientes, espacios, cobros y seguimiento.
```

LinkedIn:

```text
El expediente del cliente es una base operativa.

Cuando contratos, datos de contacto, saldos y seguimiento viven separados, el equipo pierde tiempo reconstruyendo contexto.

Renta Facil permite operar espacios con informacion centralizada dentro de BetterP.
https://betterp.net/soluciones/renta-facil?utm_source=linkedin&utm_medium=post&utm_campaign=renta_facil_lanzamiento&utm_content=expediente_cliente#contacto
```

Video corto:

```text
Escena 1: "Donde esta el contrato?"
Escena 2: "Quien tiene el comprobante?"
Escena 3: "Ya actualizaste el saldo?"
Escena 4: "Renta Facil conecta el expediente del cliente con la operacion."
```

Texto para imagen:

```text
Cada cliente con contexto.
Datos, pagos y seguimiento en un solo lugar.
```

Prompt visual:

```text
Interfaz SaaS con expediente de cliente, tarjetas de pagos, datos de contacto
y seguimiento, estilo profesional, colores sobrios con acentos cian, ambiente
de administracion de espacios, sin texto en la imagen.
```

Hashtags:

```text
#CRM #RentaFacil #BetterP #Administracion #Clientes
```

Metrica principal: leads.

### Dia 4 - Antes y despues

UTM:

```text
https://betterp.net/soluciones/renta-facil?utm_source=instagram&utm_medium=post&utm_campaign=renta_facil_lanzamiento&utm_content=antes_despues_excel#contacto
```

Facebook:

```text
Antes:
- Fechas en una hoja.
- Saldos en otra.
- Comprobantes en WhatsApp.
- Pendientes en la memoria del equipo.

Despues:
- Ocupacion, clientes, cobranza y reportes conectados en BetterP.

Si rentas espacios y quieres ordenar tu operacion, agenda una demo de Renta Facil.
https://betterp.net/soluciones/renta-facil?utm_source=facebook&utm_medium=post&utm_campaign=renta_facil_lanzamiento&utm_content=antes_despues_excel#contacto
```

Instagram:

```text
Antes: Excel, WhatsApp y memoria.
Despues: ocupacion, cobranza y reportes conectados.

Renta Facil esta hecho para negocios que rentan espacios.
```

LinkedIn:

```text
La operacion manual suele funcionar hasta que el negocio crece.

El problema no es usar hojas de calculo; el problema es depender de ellas para disponibilidad, cobranza, comprobantes y seguimiento.

Renta Facil ayuda a centralizar esa operacion dentro de BetterP.
https://betterp.net/soluciones/renta-facil?utm_source=linkedin&utm_medium=post&utm_campaign=renta_facil_lanzamiento&utm_content=antes_despues_excel#contacto
```

Video corto:

```text
Escena 1: Pantalla dividida: "Antes"
Escena 2: Hojas, chats y notas dispersas.
Escena 3: "Despues"
Escena 4: Una sola vista de operacion en BetterP.
```

Texto para imagen:

```text
Antes: informacion dispersa.
Despues: operacion conectada.
```

Prompt visual:

```text
Comparativo visual antes y despues, lado izquierdo con escritorio desordenado,
notas y hojas de calculo, lado derecho con dashboard SaaS moderno y organizado,
estilo realista profesional, sin texto dentro de la imagen.
```

Hashtags:

```text
#Excel #Operacion #RentaFacil #BetterP #TransformacionDigital
```

Metrica principal: guardados.

### Dia 5 - Anticipos y saldos

UTM:

```text
https://betterp.net/soluciones/renta-facil?utm_source=instagram&utm_medium=reel&utm_campaign=renta_facil_lanzamiento&utm_content=anticipos_saldos#contacto
```

Facebook:

```text
En espacios e inmuebles en renta, el anticipo o primer pago es solo el inicio.

Despues vienen saldos, comprobantes, fechas, cambios, confirmaciones y seguimiento.

Renta Facil ayuda a mantener esa informacion conectada para que el equipo no pierda contexto.

Solicita demo:
https://betterp.net/soluciones/renta-facil?utm_source=facebook&utm_medium=post&utm_campaign=renta_facil_lanzamiento&utm_content=anticipos_saldos#contacto
```

Instagram:

```text
Anticipo recibido.
Saldo pendiente.
Comprobante enviado.
Fecha apartada.

Todo eso necesita contexto.
Renta Facil te ayuda a ordenarlo.
```

LinkedIn:

```text
Los anticipos y saldos parciales son comunes en negocios que rentan espacios.

Sin trazabilidad, el equipo termina revisando chats, comprobantes y notas para saber que sigue.

Renta Facil conecta clientes, pagos y operacion para que el seguimiento sea mas claro.
https://betterp.net/soluciones/renta-facil?utm_source=linkedin&utm_medium=post&utm_campaign=renta_facil_lanzamiento&utm_content=anticipos_saldos#contacto
```

Video corto:

```text
Escena 1: "Ya pago anticipo?"
Escena 2: "Cuanto falta?"
Escena 3: "Donde esta el comprobante?"
Escena 4: "Renta Facil ordena pagos y seguimiento."
```

Texto para imagen:

```text
Anticipos, saldos y comprobantes sin perder contexto.
```

Prompt visual:

```text
Administrador de propiedades revisando calendario, pago parcial y comprobante
digital en laptop, ambiente profesional, estilo SaaS moderno, colores cian y
verde, sin texto en imagen.
```

Hashtags:

```text
#RentaDeEspacios #RentaFacil #Cobranza #BetterP #Administracion
```

Metrica principal: mensajes.

### Dia 6 - Revision diaria

UTM:

```text
https://betterp.net/soluciones/renta-facil?utm_source=linkedin&utm_medium=post&utm_campaign=renta_facil_lanzamiento&utm_content=revision_diaria#contacto
```

Facebook:

```text
Una buena revision diaria deberia responder:

1. Que espacios estan ocupados o libres?
2. Quien debe pagar?
3. Que comprobantes llegaron?
4. Que gastos se registraron?
5. Que pendientes necesitan seguimiento?

Renta Facil ayuda a centralizar esa lectura para administrar con mas claridad.

Agenda demo:
https://betterp.net/soluciones/renta-facil?utm_source=facebook&utm_medium=post&utm_campaign=renta_facil_lanzamiento&utm_content=revision_diaria#contacto
```

Instagram:

```text
Checklist diario para administrar espacios:
Disponibilidad.
Cobranza.
Comprobantes.
Gastos.
Pendientes.

Renta Facil lo conecta en BetterP.
```

LinkedIn:

```text
Una operacion sana necesita una revision diaria simple.

Si para responder que esta libre, quien debe, que pago llego o que falta revisar necesitas abrir varias herramientas, el costo operativo empieza a crecer.

Renta Facil ayuda a concentrar esa lectura para negocios que administran espacios.
https://betterp.net/soluciones/renta-facil?utm_source=linkedin&utm_medium=post&utm_campaign=renta_facil_lanzamiento&utm_content=revision_diaria#contacto
```

Video corto:

```text
Escena 1: "Tu revision diaria deberia tomar minutos, no horas."
Escena 2: Mostrar lista: disponibilidad, pagos, comprobantes, gastos.
Escena 3: "Renta Facil conecta la informacion."
Escena 4: "Agenda demo."
```

Texto para imagen:

```text
Revision diaria:
ocupacion, cobranza, comprobantes, gastos y pendientes.
```

Prompt visual:

```text
Checklist operativo en dashboard SaaS para administracion de espacios,
calendario, pagos y gastos visibles como tarjetas modernas, estilo profesional,
sin texto legible dentro de la imagen.
```

Hashtags:

```text
#GestionOperativa #RentaFacil #BetterP #Administracion #SaaS
```

Metrica principal: clics.

### Dia 7 - Demo directa

UTM:

```text
https://betterp.net/soluciones/renta-facil?utm_source=facebook&utm_medium=post&utm_campaign=renta_facil_lanzamiento&utm_content=demo_directa#contacto
```

Facebook:

```text
Si tu negocio renta espacios por hora, dia, evento o mes, Renta Facil puede ayudarte a ordenar la operacion.

Revisamos contigo:
- ocupacion;
- clientes;
- cobranza;
- comprobantes;
- gastos;
- reportes;
- portal cliente.

Solicita una demo y vemos tu caso:
https://betterp.net/soluciones/renta-facil?utm_source=facebook&utm_medium=post&utm_campaign=renta_facil_lanzamiento&utm_content=demo_directa#contacto
```

Instagram:

```text
Rentas espacios?

Agenda una demo de Renta Facil y revisamos como ordenar ocupacion, cobranza y seguimiento desde BetterP.
```

LinkedIn:

```text
Estamos abriendo demos de Renta Facil para negocios que administran espacios.

El recorrido se enfoca en ocupacion, clientes, cobranza, comprobantes, gastos, reportes y portal cliente.

Si tu operacion hoy depende de WhatsApp, hojas de calculo o seguimiento manual, vale la pena revisar si BetterP encaja.
https://betterp.net/soluciones/renta-facil?utm_source=linkedin&utm_medium=post&utm_campaign=renta_facil_lanzamiento&utm_content=demo_directa#contacto
```

Video corto:

```text
Escena 1: "Rentas espacios?"
Escena 2: "Departamentos, casas, cabañas, coliving, condominios o espacios."
Escena 3: "Renta Facil ordena ocupacion, cobranza y seguimiento."
Escena 4: "Agenda una demo."
```

Texto para imagen:

```text
Rentas espacios?
Agenda una demo de Renta Facil.
```

Prompt visual:

```text
Collage realista de distintos espacios en renta, salon, cancha, aula,
consultorio y terraza, con una laptop mostrando dashboard SaaS moderno,
estilo profesional y luminoso, sin texto dentro de la imagen.
```

Hashtags:

```text
#RentaFacil #BetterP #RentaDeEspacios #SaaS #Demo
```

Metrica principal: leads.

## Prompt maestro operativo

```text
Actua como estratega de growth marketing B2B SaaS para BetterP.

Contexto:
BetterP es una plataforma que envuelve soluciones de negocio con login, pagos,
salud, monitoreo, auditoria, crons, marketing y operacion.
La primera solucion vendible es Renta Facil: un sistema para administrar renta
de espacios, reservas, disponibilidad, cobros, clientes y operacion diaria.

Objetivo:
Crear contenido diario para generar trafico calificado, leads y demos para
Renta Facil.

Audiencia:
Duenos, administradores y operadores de espacios e inmuebles en renta:
departamentos, casas, cabañas, coliving, condominios, habitaciones, unidades,
propiedades y negocios con varias lineas de renta. Salones, canchas,
consultorios, coworkings o bodegas pueden usarse como ejemplos secundarios,
pero no como foco principal del mensaje inicial.

Reglas:
- No inventes funcionalidades que no esten confirmadas.
- No prometas resultados garantizados.
- Habla claro, directo y comercial.
- Prioriza venta, dolor operativo y accion.
- Cada publicacion debe vender una sola idea.
- La primera linea debe dejar claro si el mensaje es para administradores de
  condominios, inmuebles o espacios en renta.
- En la segunda iteracion semanal, prioriza cobranza automatizada,
  autoservicio del cliente y control del negocio en tiempo real antes de
  volver a mensajes amplios de vacancia.
- Si usas "hasta 80%", debe referirse a menos seguimiento manual repetitivo;
  no lo uses como promesa garantizada de ingresos, ahorros o resultados.
- No empieces pidiendo demo si el prospecto todavia no conoce el producto.
  Primero crea necesidad con dinero perdido, horas administrativas o falta de
  control.
- Cada publicacion debe llevar CTA a demo, WhatsApp o landing, pero el CTA no
  debe reemplazar la historia.
- Usa el link con UTM.
- Adapta el mensaje por red social.
- Facebook: gancho fuerte, 2 a 4 parrafos breves, beneficio y CTA.
- Instagram: texto breve; la imagen, carrusel o infografia carga la explicacion.
- LinkedIn: mas contexto, pero en parrafos cortos y con CTA suave.
- Manten tono profesional, practico y cercano.
- Usa espanol natural con acentos y ñ.
- Define etapa del embudo: Awareness, Educacion, Consideracion o Conversion.
- Define segmento principal: espacios e inmuebles en renta, departamentos,
  casas, cabañas, coliving, condominios u operación multi-unidad.
- Usa salones, canchas, consultorios, coworkings o bodegas sólo como ejemplos
  secundarios cuando ayuden a explicar el caso.
- Define formato visual: infografia de 3 puntos, antes/despues, checklist,
  mini caso numerico o sabia que.
- Define una hipotesis medible.

Pilares comerciales:
1. Menos espacios vacios: disponibilidad, canales comerciales y seguimiento.
2. Autoservicio para clientes: atencion al cliente, mensajes/correos repetidos,
   datos fiscales, facturas, comprobantes, estado de cuenta y todo a un click.
3. Cobranza automatizada: recordatorios para cuentas vencidas, rentas
   pendientes y pagos realizados pero no registrados; control de cartera
   vencida y flujo de efectivo sin perseguir cliente por cliente.
4. Unidades de negocio rentables: herramientas de control, tiempo y recursos
   consumidos, balance y ganancias por edificio, cabana, casa, habitacion o
   unidad.
5. Datos para decidir: ingresos, cartera vencida, gastos y ocupacion.

Ofertas base:
- 7 dias gratis.
- 10% de descuento.
- 12 meses por pago de 10.
- Devolucion si no convence, sujeta a condiciones.

No uses todas las ofertas en cada publicacion. La oferta debe responder a la
etapa del embudo y a la objecion probable.

Producto a promover:
Renta Facil de BetterP.

Tema del dia:
[ESCRIBIR TEMA]

UTM content:
[ESCRIBIR UTM_CONTENT]

Oferta o CTA:
Solicitar demo de Renta Facil.

Link destino:
https://betterp.net/soluciones/renta-facil?utm_source={source}&utm_medium={medium}&utm_campaign=renta_facil_lanzamiento&utm_content={utm_content}#contacto

Genera:
1. Idea central de la publicacion.
2. Matriz editorial: pilar, segmento, etapa, formato, objecion, oferta e
   hipotesis.
3. Plan de oferta: sin_oferta, apoyo o conversion.
4. Brief visual: formato, titulo, tres puntos y direccion creativa.
5. Post para Facebook.
6. Post para Instagram.
7. Post para LinkedIn.
8. Guion corto para Reel/TikTok de 20 a 30 segundos.
9. Texto para imagen o carrusel.
10. Prompt para crear imagen o video.
11. 5 hashtags.
12. CTA final.
13. Variante A/B del gancho inicial.
14. Metrica principal que deberia medirse.
15. Checklist editorial para aprobar o regenerar.
```

## Revision diaria

Cada dia, despues de publicar:

- Revisar si el link tuvo clics.
- Revisar si entraron leads con UTM.
- Revisar si hubo mensajes por WhatsApp.
- Registrar que gancho se uso.
- Registrar objeciones o preguntas.
- Decidir si el tema merece repetirse con otro formato.

Formato de cierre diario:

```text
Dia:
Tema:
Canales publicados:
UTM content:
Clics:
Leads:
Mensajes:
Comentarios relevantes:
Aprendizaje:
Decision: repetir / ajustar / pausar / convertir en pauta posterior.
```

## Criterio para pasar a la siguiente etapa

Se puede pasar a programacion/automatizacion cuando:

- 7 publicaciones esten listas o publicadas.
- Cada publicacion tenga UTM.
- Al menos una rutina de revision diaria este definida.
- El equipo pueda identificar que piezas generaron clics, leads o mensajes.
