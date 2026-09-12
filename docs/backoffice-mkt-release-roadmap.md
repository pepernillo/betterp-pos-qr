# Ruta de cierre Backoffice MKT y venta Renta Facil

Ultima actualizacion: 2026-06-29

Este documento es el tablero operativo para convertir Backoffice MKT en el
motor comercial interno de BetterP. La meta inmediata no es abrir mas alcance:
es vender Renta Facil, aprender rapido con datos reales y cerrar una ruta tan
trazable como la que se uso para Cobranza.

## Decision actual

- BetterP es la plataforma madre: login, pagos, salud, monitoreo, auditoria,
  crons, marketing, permisos, planes y operacion compartida.
- Renta Facil es la primera solucion terminada y vendible dentro de BetterP.
- Backoffice MKT debe operar como maquina comercial interna para promover
  BetterP y vender Renta Facil.
- Cobranza no se reabre salvo bug critico, ajuste legal urgente o hallazgo de
  produccion.
- Maya Coliving queda como laboratorio privado; no se libera como cliente
  comercial.
- Google Ads queda fuera de la primera incursion. Se retomara despues como
  prueba quirurgica de busqueda, no como motor principal.
- La narrativa comercial del motor MKT se enfoca en reducir dinero perdido por
  espacios vacios, separar autoservicio de clientes, cobranza automatizada,
  rentabilidad por unidad de negocio y decisiones con datos operativos en
  tiempo real.
- La oferta de lanzamiento parte de 7 dias gratis, 10% de descuento, 12 meses
  por pago de 10 y devolucion sujeta a condiciones si el sistema no convence.
  Estas ofertas se tratan como hipotesis iterables, no como reglas fijas.

## Principio rector

El objetivo de esta incursion es vender, vender y vender sin perder control
operativo. Cada mejora debe ayudar a una de estas acciones:

- atraer trafico calificado;
- convertir visitantes en prospectos;
- agendar demos o conversaciones;
- dar seguimiento comercial;
- medir que mensaje, canal y oferta funcionan;
- preparar automatizacion diaria sin duplicar paneles ni reabrir modulos
  cerrados.

## Reglas de trabajo

- Trabajar una fase activa a la vez.
- No duplicar pantallas existentes de Salud, Solicitudes, Cobranza o Clientes.
- Mejorar Backoffice MKT sobre la pantalla viva, no sobre renders obsoletos.
- Toda fase debe cerrar con evidencia: archivo, pantalla, test, checklist,
  captura operativa o dato medible.
- Cada avance debe actualizar este documento antes de pasar al siguiente punto.
- Si aparece una idea nueva, se agrega a "Pendientes propuestos" y no rompe la
  fase activa.

## Ritmo de iteracion

En cada bloque de trabajo se debe responder:

```text
Se hizo:
- ...

Se reviso con:
- ...

Funciono:
- ...

Falta ajustar:
- ...

Puntos terminados:
- ...

Decision:
- Continuar / ajustar / pausar / pasar a la siguiente fase.

Siguiente punto:
- ...
```

## Estado global

- [x] Fase 0 - Alcance, base y tablero de control.
- [x] Fase 1 - Oferta comercial y ruta de conversion.
- [x] Fase 2 - Motor diario de contenido organico.
- [x] Fase 3 - Captura de leads y pipeline comercial.
- [ ] Fase 4 - Consolidacion UX de Backoffice MKT.
- [x] Fase 5 - Automatizacion de publicaciones desde BetterP.
- [ ] Fase 6 - Metricas, aprendizaje y ciclo de mejora.
- [ ] Fase 7 - Planes, permisos, limites y volumen.
- [x] Fase 8 - Cierre de release Backoffice MKT.
- [ ] Incursion posterior - Google Ads Search controlado.

## Fase 0 - Alcance, base y tablero de control

Objetivo: dejar claro que esta ruta es comercial/MKT y que no reabre Cobranza
ni Maya.

Checklist:

- [x] Confirmar que el objetivo principal es vender Renta Facil.
- [x] Confirmar que Google Ads se pospone para una incursion posterior.
- [x] Registrar estado actual de la pantalla viva de Backoffice MKT.
- [x] Identificar renders/paneles duplicados que no deben recibir nuevas
      mejoras.
- [x] Definir que datos deben vivir en MKT y que datos deben seguir en Salud o
      Solicitudes.

Criterio de salida:

- Existe inventario claro de la superficie viva de Backoffice MKT.
- El alcance comercial queda separado de Cobranza, Salud, Solicitudes y Maya.
- La siguiente fase puede empezar sin dudas de producto.

Estado registrado el 2026-06-21:

- Ruta viva: `frontend/app/backoffice/marketing/page.tsx` renderiza
  `BusinessAdminManager section="marketing"`.
- Render activo: `renderMarketingControlCenter()` en
  `frontend/components/business/BusinessAdminManager.tsx`.
- Switch activo: `renderCurrentSection()` usa `renderMarketingControlCenter()`
  cuando `section === "marketing"`.
- Carga inicial de datos: la seccion marketing consulta
  `/billing/admin/marketing/`, `/billing/admin/solicitudes/` y
  `/billing/admin/resumen/`.
- Backend vivo: `backend/billing/api.py` expone endpoints internos para
  resumen MKT, redes sociales, campanas, activos, disparo y sync de inbox.
- Modelos base: `ProspectoComercial`, `RedSocialConfig`, `CampanaMarketing`,
  `CampanaMarketingActivo` y `CampanaMarketingDestino` en
  `backend/billing/models.py`.

Inventario de la pantalla viva:

- Hero: posiciona el modulo como "Marketing interno para vender BetterP como
  SaaS" y aclara que no usa inventario ni espacios de clientes.
- Acciones superiores: sincronizar correo y actualizar marketing.
- KPIs: redes configuradas, campanas activas, borradores, en cola, lectura de
  campanas y salidas publicadas.
- Redes y canales: conector oficial Meta, captura manual de canal, estados de
  conexion, publicacion y tokens.
- Campanas y ofertas: crear campana, seleccionar redes, subir creativos y
  disparar en todas.
- Destinos por campana: estado y detalle por red.
- Embudo comercial: entradas desde Landing, Correo y WhatsApp.

Renders/paneles que no deben recibir mejoras nuevas:

- `renderMarketing()` existe como vista anterior de marketing y no entra en el
  switch activo.
- `renderMarketingInbox()` existe como vista alternativa/inbox y no entra en el
  switch activo.
- `renderSolicitudesWorkbench()` es la vista viva de Solicitudes; MKT no debe
  recrear su operacion, solo resumir origen y direccionar cuando haga falta.

Frontera de responsabilidades:

- Backoffice MKT debe contener: contenido, redes, campanas, creativos, cola de
  publicacion, lectura de resultados y vista compacta del embudo comercial.
- Solicitudes debe contener: clasificacion fina, atencion, notas y seguimiento
  operativo de prospectos, correos, WhatsApp y pagos/comprobantes.
- Salud debe contener: crons, webhooks, errores tecnicos, backups, Stripe,
  requests y senales operativas del sistema.
- Cobranza queda fuera de alcance salvo bug critico.
- Maya queda fuera de alcance comercial.

Riesgos detectados para fases posteriores:

- El estado global de una campana puede quedar como `PUBLICADA` aunque algunos
  destinos fallen o requieran configuracion; se debe hacer visible el resultado
  parcial antes de vender automatizacion.
- Existe `programada_en`, pero todavia no hay cierre operativo documentado para
  publicacion programada real desde un cron.
- Los tokens manuales son utiles para uso interno, pero deben quedar como modo
  avanzado o protegido para evitar operacion riesgosa.
- El frontend cliente `/marketing` y el Backoffice MKT son productos distintos;
  no deben mezclarse en UX ni en planes.

Configuracion Meta separada:

- Backoffice MKT usa la app interna de BetterP Marketing con estas variables:
  `BACKOFFICE_META_APP_ID`, `BACKOFFICE_META_APP_SECRET` y
  `BACKOFFICE_META_REDIRECT_URI`.
- `BACKOFFICE_META_APP_ID` debe ser el id de la app BetterP Marketing:
  `978837048092130`.
- `BACKOFFICE_META_REDIRECT_URI` para produccion debe apuntar al API publico:
  `https://api.betterp.net/api/billing/admin/meta/callback/`.
- Marketing cliente/tenant debe conservar sus variables propias:
  `MARKETING_META_CLIENT_ID`, `MARKETING_META_CLIENT_SECRET` y
  `MARKETING_META_REDIRECT_URI`.
- `META_APP_ID`, `META_APP_SECRET`, `META_CLIENT_ID` y `META_CLIENT_SECRET`
  quedan como variables legadas/compatibilidad. No deben gobernar Backoffice si
  existen `BACKOFFICE_META_*`.
- Si todavia no existen `BACKOFFICE_META_*`, Backoffice MKT debe preferir
  `META_CLIENT_ID` sobre `META_APP_ID` para evitar usar por accidente una app
  legada con permisos de otro flujo.
- El callback de Meta debe ser publico porque Meta regresa sin bearer token; la
  seguridad del flujo depende del `state` firmado y cacheado que BetterP genero
  al iniciar la conexion.

## Fase 1 - Oferta comercial y ruta de conversion

Objetivo: definir el mensaje que se va a repetir en contenido, landing, CTA y
seguimiento comercial.

Checklist:

- [x] Definir oferta principal de Renta Facil.
- [x] Definir publico objetivo inicial.
- [x] Definir dolores principales por segmento.
- [x] Definir CTA unico para la primera incursion.
- [x] Confirmar landing destino.
- [x] Confirmar canal de contacto: WhatsApp, formulario, demo o combinacion.
- [x] Agregar UTMs base para medir origen de trafico.

Criterio de salida:

- Cada publicacion y campana apunta al mismo resultado medible.
- La landing explica Renta Facil sin depender de una llamada para entender el
  valor.
- El lead queda capturado con origen, solucion de interes y estado comercial.

Oferta base propuesta:

```text
Renta Facil ayuda a duenos y administradores de espacios a controlar reservas,
cobros, disponibilidad, clientes y operacion diaria desde BetterP.
```

Publico inicial propuesto:

- Duenos y administradores de espacios e inmuebles en renta.
- Administradores de departamentos, casas y cabañas.
- Operadores de coliving, condominios y comunidades con varias unidades.
- Negocios que hoy controlan ocupacion, cobros, disponibilidad, gastos y
  seguimiento por WhatsApp, hojas de calculo, libretas o multiples herramientas.

Estado registrado el 2026-06-21:

- Landing destino actual: `/soluciones/renta-facil`.
- CTA principal actual: `Solicitar demo`.
- CTA secundario actual: `Hablar por WhatsApp`.
- CTA comercial adicional: `Ver planes` y `Contratar plan`.
- Formulario actual: `ContactLeadForm` con `solutionKey="renta_facil"` y
  `solutionName="Renta Facil"`.
- Endpoint de captura: `/billing/prospectos/contacto/`.
- Datos capturados: nombre, empresa/administracion, correo, telefono,
  mensaje, origen `LANDING` y solucion `renta_facil`.
- Metadata capturada en backend: user agent, referer, requested solution key y
  resolved solution key.
- Estado comercial inicial: el prospecto nace como `NUEVO` en
  `ProspectoComercial`.

Oferta comercial de la primera incursion:

```text
Renta Facil ayuda a negocios que rentan espacios a dejar de operar con
WhatsApp, hojas de calculo y seguimiento manual. Centraliza disponibilidad,
clientes, cobros, gastos, bancos, portal cliente y reportes en BetterP para
que el administrador tenga control diario y pueda crecer sin perder contexto.
```

Promesa operativa, sin exagerar:

- Menos captura duplicada.
- Menos mensajes perdidos.
- Mas claridad de ocupacion y cobranza.
- Seguimiento comercial y operativo en un solo lugar.
- Planes por volumen, no por funciones recortadas.

Publico inicial priorizado:

1. Duenos y administradores de espacios e inmuebles en renta.
2. Administradores de departamentos, casas y cabañas.
3. Administradores de coliving, condominios, habitaciones o espacios
   recurrentes.
4. Operadores con varias unidades, propiedades o lineas de renta.
5. Duenos de negocios que ya tienen pagos, clientes y disponibilidad, pero lo
   manejan por WhatsApp, Excel, libretas o multiples herramientas.

Dolores por segmento:

- Espacios e inmuebles en renta: disponibilidad, ocupacion, solicitudes,
  publicaciones, pagos y seguimiento disperso.
- Departamentos, casas y cabañas: unidades vacias, reservaciones, rentas,
  gastos, comprobantes y comunicacion con huespedes o inquilinos.
- Coliving/condominios/habitaciones: ocupacion, mensualidades, cobranza,
  gastos, bancos y portal cliente.
- Operacion multi-unidad: reportes tardios, cartera vencida, gastos por unidad
  y decisiones con informacion incompleta.
- Administradores generales: saber que esta libre, quien debe, que pago llego
  y que falta revisar.

CTA unico de la primera incursion:

```text
Solicitar demo de Renta Facil
```

Regla de conversion:

- Todo contenido debe apuntar a la landing o a WhatsApp.
- Toda landing debe empujar a demo.
- Todo lead debe entrar como Renta Facil.
- Toda conversacion debe terminar con siguiente accion: contactar, agendar
  demo, enviar propuesta, ganar o perder.

UTMs base implementadas:

- `utm_source`: facebook, instagram, linkedin, whatsapp, organic, direct.
- `utm_medium`: social, bio, post, reel, story, referral, message.
- `utm_campaign`: renta_facil_lanzamiento.
- `utm_content`: gancho o formato usado, por ejemplo `dolor_cobranza`,
  `ocupacion`, `antes_despues`, `demo`.
- `utm_term`: reservado para busqueda o segmentacion posterior.

Implementacion cerrada:

- `ContactLeadForm` lee parametros UTM presentes en la URL y los envia al
  endpoint publico de captura.
- `ProspectLeadIn` acepta `utm_source`, `utm_medium`, `utm_campaign`,
  `utm_content` y `utm_term`.
- `capture_contact_lead` guarda esos valores dentro de
  `ProspectoComercial.metadata["utm"]`.
- El flujo quedo cubierto por el test enfocado de prospecto comercial.

## Fase 2 - Motor diario de contenido organico

Objetivo: crear una cola diaria de publicaciones para generar presencia,
trafico y aprendizaje sin esperar a pauta pagada.

Checklist:

- [x] Crear calendario de 30 temas.
- [x] Crear prompt maestro de publicacion diaria.
- [x] Crear variantes por canal: Facebook, Instagram, LinkedIn y video corto.
- [x] Definir formato minimo: texto, imagen/carrusel y CTA.
- [x] Definir herramienta temporal de programacion: Meta Business Suite,
      Metricool o Buffer.
- [ ] Programar primera tanda de publicaciones.
- [x] Registrar UTMs por canal.
- [x] Habilitar generacion interna de cola editorial con copy, CTA, UTM y
      creativo base.

Criterio de salida:

- Hay al menos 7 publicaciones listas o programadas.
- Cada publicacion tiene CTA, link y metrica esperada.
- Existe rutina diaria para revisar resultados y ajustar mensajes.

Documento operativo:

- `docs/renta-facil-content-engine.md`

Estado registrado el 2026-06-21:

- Se creo calendario de 30 dias para Renta Facil.
- Se dejo primera tanda de 7 publicaciones lista para Facebook, Instagram,
  LinkedIn y video corto.
- Cada pieza incluye `utm_content` y link medible a
  `/soluciones/renta-facil#contacto`.
- La herramienta temporal inicial queda como Meta Business Suite para Facebook
  e Instagram, LinkedIn manual y video corto solo cuando exista creativo listo.
- Metricool o Buffer quedan como opcion posterior si la programacion multicanal
  se vuelve cuello de botella.
- El acceso oficial a Meta quedo resuelto para Backoffice MKT. La programacion
  real en redes queda pendiente de una prueba controlada de publicacion.
- Se implemento un motor editorial interno para generar la primera semana de
  publicaciones de Renta Facil desde Backoffice MKT.

Prompt maestro:

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
- La primera linea debe nombrar si el mensaje es para administradores de
  condominios, inmuebles o espacios en renta.
- Para la siguiente iteracion, priorizar cobranza automatizada, autoservicio y
  control en tiempo real antes de mensajes amplios de vacancia.
- Si aparece "hasta 80%", usarlo solo como menos seguimiento manual repetitivo,
  no como promesa garantizada de ingresos, ahorros o mejora total.
- No empieces pidiendo demo si el prospecto todavia no conoce el producto.
  Primero crea necesidad con dinero perdido, horas administrativas o falta de
  control; despues invita a conocer Renta Facil.
- Cada publicacion debe llevar CTA a demo, WhatsApp o landing, pero el CTA no
  debe reemplazar la historia.
- Adapta el mensaje por red social.
- Meta/Facebook: copy corto, gancho fuerte, beneficio claro.
- Instagram: texto breve; la infografia o carrusel debe cargar la explicacion.
- LinkedIn: mas contexto, pero en parrafos cortos y con CTA suave.
- Manten tono profesional, practico y cercano.
- Usa espanol natural con acentos y ñ.
- Define matriz editorial: pilar, segmento, etapa del embudo, formato,
  objecion probable, oferta aplicable e hipotesis medible.
- Define plan de oferta: sin_oferta, apoyo o conversion.
- Define brief visual: formato, titulo visual, tres puntos y direccion
  creativa para que la imagen explique rapido.
- Genera checklist editorial para aprobar, modificar o regenerar cada pieza.

Pilares comerciales:
1. Menos espacios vacios: menos dinero perdido por vacancia y disponibilidad
   mejor expuesta en Mercado Libre, Metros Cubicos, Facebook e Instagram.
2. Autoservicio para clientes: atencion al cliente, mensajes/correos repetidos,
   datos fiscales, facturas, comprobantes, estado de cuenta y todo a un click.
3. Cobranza automatizada: recordatorios para cuentas vencidas, rentas
   pendientes y pagos realizados pero no registrados; control de cartera
   vencida y flujo de efectivo sin perseguir cliente por cliente.
4. Unidades de negocio rentables: herramientas de control, tiempo y recursos
   consumidos, balance y ganancias por edificio, cabana, casa, habitacion o
   unidad.
5. Datos para decidir: ingresos, cartera vencida, gastos por unidad de negocio
   y ocupacion en una sola lectura.

Ofertas base:
- 7 dias gratis.
- 10% de descuento.
- 12 meses por pago de 10.
- Devolucion si no convence, sujeta a condiciones.

Las ofertas son hipotesis iterables. No las pongas todas en cada post. Usalas
segun el rol del dia y mejora con clicks, leads, demos, objeciones y cierres.

Plan de oferta:
- sin_oferta: crear necesidad o educar.
- apoyo: mencionar promocion sin desplazar el mensaje.
- conversion: usar promocion para reducir riesgo y llevar a demo o prueba.

Rotacion semanal:
- Lunes: dolor economico.
- Martes: oferta de entrada.
- Miercoles: sabia que.
- Jueves: producto aplicado.
- Viernes: comparativo antes/despues.
- Sabado: checklist operativo.
- Domingo: CTA suave.

Etapas del embudo:
- Awareness: hacer visible el costo economico.
- Educacion: entregar una idea util y compartible.
- Consideracion: conectar dolor con ventaja concreta de Renta Facil.
- Conversion: reducir friccion para iniciar conversacion comercial o demo.

Directriz de posicionamiento:
- Renta Facil debe hablar primero a espacios e inmuebles en renta.
- El foco comercial inicial incluye espacios, departamentos, casas, cabañas,
  coliving, condominios y operacion multi-unidad.
- Salones, canchas, consultorios, coworkings y bodegas quedan como ejemplos o
  extensiones posteriores, no como centro del mensaje inicial.

Segmentos iniciales:
- Espacios e inmuebles en renta.
- Departamentos, casas y cabañas.
- Coliving y condominios.
- Operacion multi-unidad.

Producto a promover:
Renta Facil de BetterP.

Tema del dia:
[ESCRIBIR TEMA]

Oferta o CTA:
[ESCRIBIR CTA]

Link destino:
[PEGAR URL]

Genera:
1. Idea central de la publicacion.
2. Post para Facebook.
3. Post para Instagram.
4. Post para LinkedIn.
5. Guion corto para Reel/TikTok de 20 a 30 segundos.
6. Texto para imagen o carrusel.
7. Prompt para crear imagen o video.
8. Matriz editorial: pilar, segmento, etapa, formato, objecion, oferta e
   hipotesis.
9. Plan de oferta.
10. Brief visual.
11. Checklist editorial.
12. 5 hashtags.
13. CTA final.
14. Variante A/B del gancho inicial.
15. Metrica principal que deberia medirse.
```

## Fase 3 - Captura de leads y pipeline comercial

Objetivo: que todo trafico de MKT termine en un seguimiento comercial medible.

Checklist:

- [x] Confirmar formulario principal de captura desde landing.
- [x] Capturar solucion de interes: Renta Facil.
- [x] Capturar origen: organico, red, campana, referido, directo.
- [x] Capturar etapa: nuevo, contactado, demo, propuesta, ganado, perdido.
- [x] Mostrar prospectos en Backoffice MKT sin duplicar Solicitudes.
- [x] Definir rutina diaria de seguimiento.

Criterio de salida:

- Ningun lead queda sin origen o siguiente accion.
- MKT puede ver resultados sin invadir el modulo de Solicitudes.
- El equipo sabe cuantos leads, demos y ventas produjo cada canal.

Estado registrado el 2026-06-21:

- `/billing/prospectos/contacto/` guarda prospectos con solucion, origen y
  UTM estructurado.
- `/billing/admin/marketing/` expone `prospectos` y `prospect_pipeline` para
  que MKT vea total, abiertos, nuevos, demos, ganados, perdidos, etapas,
  origenes, UTMs y rutina diaria.
- Backoffice MKT muestra un panel de pipeline comercial de solo lectura con
  ultimos prospectos, etapa, solucion, origen, UTM y siguiente accion.
- La operacion de edicion, conversion y seguimiento detallado sigue viviendo
  en `Backoffice > Solicitudes`, para no duplicar pantallas ni flujos.

## Fase 4 - Consolidacion UX de Backoffice MKT

Objetivo: mejorar UX sobre la superficie correcta y eliminar ruido antes de
automatizar.

Checklist:

- [x] Confirmar pantalla viva de Backoffice MKT.
- [x] Eliminar renders antiguos o no usados.
- [x] Evitar duplicar paneles de Salud, Solicitudes o Cobranza.
- [x] Separar secciones: contenido, redes, campanas, leads, metricas.
- [x] Revisar manejo de tokens/manual OAuth para que no sea riesgoso ni
      confuso.
- [x] Agregar estados claros: borrador, listo, programado, publicado, parcial,
      error, requiere configuracion.
- [x] Agregar tabla operativa con seleccion masiva, modal de detalle,
      aceptar/rechazar/modificar, borrado y regeneracion con comentarios.
- [x] Agregar visibilidad de origen por campana: manual, cola base o
      aprendizaje.
- [x] Agregar filtros rapidos por origen, accion de aprendizaje y estado.

Criterio de salida:

- Una sola pantalla MKT concentra la operacion comercial.
- Las acciones principales son obvias: crear, programar, publicar, revisar y
  dar seguimiento.
- Los errores y estados parciales no quedan ocultos.

Pendiente para cerrar Fase 4:

- Hacer revision visual final en produccion despues del deploy.

Estado registrado el 2026-06-21:

- Se eliminaron las vistas legacy `renderMarketing()`, `renderSolicitudes()`,
  `renderMarketingInbox()` y `renderSolicitudesInbox()`.
- La navegacion viva queda concentrada en `renderMarketingControlCenter()` para
  MKT y `renderSolicitudesWorkbench()` para Solicitudes.
- El objetivo de no duplicar paneles queda reforzado: MKT conserva vista
  ejecutiva de contenido, redes, campanas, leads y aprendizaje; Solicitudes
  conserva la operacion detallada de prospectos, correo, WhatsApp y pagos.
- Falta la revision visual final sobre produccion cuando el deploy quede
  disponible.

## Fase 5 - Automatizacion de publicaciones desde BetterP

Objetivo: pasar de programacion externa temporal a flujo propio dentro de
BetterP cuando tenga sentido operativo.

Estado registrado el 2026-06-21:

- Conector oficial Meta Backoffice validado en produccion.
- La app usada para Backoffice MKT es BetterP Marketing con client id
  `978837048092130`.
- El callback autorizado en Meta es
  `https://api.betterp.net/api/billing/admin/meta/callback/`.
- Se importaron 1 pagina de Facebook y 1 cuenta de Instagram Business como
  canales oficiales.
- Canales visibles en Backoffice MKT: Facebook `Betterp` e Instagram
  `BettERP` / `@betterp.01`.
- Ambos canales aparecen activos, publicables y con acceso correcto.
- Se agrego motor editorial `renta_facil_daily_sales` para crear 7 campanas
  programadas con dolor operativo, CTA a demo, UTM y creativo PNG para Meta.
- Se agrego endpoint interno
  `/billing/admin/marketing/content-engine/generate-week/` para llenar la cola
  desde la pantalla viva de Backoffice MKT.
- Se agrego comando cron `publish_marketing_campaigns` para publicar campanas
  `PROGRAMADA` vencidas usando la misma logica del boton manual.
- El boton de generacion ya puede usar la matriz de aprendizaje para crear la
  siguiente tanda, no solo la cola base.
- Cada variante nacida del aprendizaje queda con `utm_content` propio,
  `learning_action`, `learning_experiment` y llave diaria para evitar duplicar
  la misma tanda.
- Cada campana generada incluye prompt IA de imagen con narrativa visual,
  identidad BetterP, instruccion para usar logo adjunto y restricciones de
  composicion.
- El prompt visual queda en ingles, prioriza storytelling de vacancia y
  publicacion automatizada de espacios disponibles, y evita texto explicativo
  dentro de la imagen.
- Se agrega estrategia visual por formato: infografia compacta, storytelling o
  hibrido, para probar el sweet point segun la intencion de cada publicacion.
- Queda pendiente observar la primera tanda real y confirmar resultados por
  canal antes de escalar volumen.

Checklist:

- [x] Definir si la primera automatizacion sera manual asistida o programada.
- [x] Definir canales iniciales: Facebook, Instagram, LinkedIn u otros.
- [x] Crear cola de publicaciones.
- [x] Agregar aprobacion antes de publicar si aplica.
- [x] Agregar revision editorial con aceptar, rechazar, modificar, borrar y
      regenerar con comentarios desde Backoffice.
- [x] Agregar prompt detallado para imagen, identidad de marca y uso de logo
      adjunto en cada propuesta de campana.
- [x] Agregar cron o job si habra publicacion programada real.
- [x] Registrar enviados, omitidos y errores operativos de publicacion.
- [ ] Registrar resultados reales de rendimiento por canal cuando Meta entregue
      datos suficientes.
- [x] Reflejar el job en documentacion operativa si se agrega cron.

Criterio de salida:

- BetterP puede publicar o preparar publicaciones sin depender de una libreta
  externa.
- Hay trazabilidad completa por publicacion y canal.
- La automatizacion no publica contenido sin control.

## Fase 6 - Metricas, aprendizaje y ciclo de mejora

Objetivo: medir para vender mejor, no solo para mostrar numeros.

Estado registrado el 2026-06-21:

- Se agrego reporte de aprendizaje MKT dentro de la pantalla viva de
  Backoffice MKT.
- El reporte calcula score comercial por campana usando views, clicks,
  engagement y leads atribuidos por UTM.
- Se agrego recomendacion de cadencia para encontrar el sweet point entre 1,
  2 o mas publicaciones diarias.
- Se agrego endpoint
  `/billing/admin/marketing/learning/analyze/` para ejecutar analisis IA
  cuando `OPENAI_API_KEY` este configurado.
- Si no hay `OPENAI_API_KEY`, BetterP entrega lectura heuristica y no bloquea
  la operacion.
- La primera regla de cadencia queda definida: empezar con 1 publicacion diaria
  hasta tener muestra minima; escalar a 2 solo si hay senales comerciales.
- El reporte ahora construye `next_experiments`: una siguiente tanda de 7
  piezas con pilar, segmento, embudo, formato, oferta, CTA, hipotesis y senal
  esperada.
- El prompt de siguiente generacion usa esa matriz sugerida para que la IA no
  invente piezas desconectadas del aprendizaje.
- La pantalla de Backoffice muestra la proxima tanda sugerida y permite
  generar nueva cola desde aprendizaje.
- La tabla y el modal muestran origen, accion, UTM, racional, hipotesis y
  senal esperada por campana.
- El reporte registra objeciones frecuentes desde notas/mensajes de prospectos
  y las usa para recomendaciones, prompts y la siguiente tanda sugerida.
- Cuando la cola se genera desde aprendizaje, cada pieza puede heredar una
  objecion a responder para ajustar copy y brief visual.
- Se agrego `paid_readiness` para decidir si conviene esperar, corregir
  conversion, probar retargeting o escalar pauta con presupuesto controlado.
- La pantalla muestra presupuesto sugerido, audiencias utiles, exclusiones,
  reglas de pausa y piezas candidatas para invertir sin promover todo.

Checklist:

- [x] Medir publicaciones por canal.
- [x] Preparar medicion de clics y leads por UTM y por variante.
- [x] Medir leads por origen.
- [x] Medir demos agendadas cuando el prospecto avance a etapa `DEMO`.
- [x] Medir ventas cerradas cuando el prospecto avance a etapa `GANADO`.
- [x] Registrar objeciones frecuentes.
- [x] Crear reporte semanal compacto de aprendizaje.
- [x] Crear siguiente tanda sugerida con acciones `reforzar`, `explorar` y
      `reescribir`.
- [x] Generar cola desde la matriz aprendida.
- [x] Crear semaforo de pauta pagada con presupuesto, exclusiones y reglas de
      pausa.

Criterio de salida:

- Se puede responder que mensaje trajo mejores leads.
- Se puede responder que canal produjo conversaciones reales.
- Se puede decidir que repetir, pausar o convertir en pauta pagada.

Pendiente para cerrar Fase 6:

- Tener muestra real de publicaciones publicadas, clics, leads, demos y
  objeciones.
- Alimentar objeciones comerciales reales desde seguimiento o demo.
- Revisar semanalmente si la cadencia sigue en 1 diario o si amerita probar 2
  diarios.

Metricas base:

- Publicaciones creadas.
- Publicaciones publicadas.
- Clics por canal.
- Leads capturados.
- Demos agendadas.
- Demos realizadas.
- Ventas cerradas.
- Costo por lead, cuando haya pauta.
- Costo por venta, cuando haya pauta.

### Roadmap operativo para aprovechar la semana publicada

Objetivo: convertir la primera semana de publicaciones en decisiones
comerciales concretas: que repetir, que reescribir, que pausar y donde invertir
sin desperdiciar presupuesto.

Regla de trabajo:

- No se invierte pauta fria solo por likes o alcance.
- Una pieza solo puede recibir presupuesto si tiene UTM, landing, captura de
  lead y criterio de calidad.
- Si una pieza atrae leads fuera de perfil, se corrige el publico, el hook o la
  audiencia antes de subir presupuesto.
- Cada semana debe cerrar con una decision: repetir, reescribir, responder
  objecion, retargeting, prueba pagada o pausa.

#### Paso 6.1 - Vista "Resultados de esta semana"

Objetivo: tener una lectura semanal de las 7 publicaciones enviadas.

Checklist:

- [x] Crear bloque semanal con rango de fechas, publicaciones publicadas y
      publicaciones pendientes.
- [x] Mostrar mejor pieza por lead calificado, no solo por alcance.
- [x] Mostrar peor pieza o pieza sin senal util.
- [x] Mostrar mejor canal por calidad de lead: Facebook, Instagram o LinkedIn.
- [x] Mostrar resumen de leads: totales, calificados, demos, propuestas,
      ganados y perdidos.
- [x] Mostrar objecion dominante de la semana.
- [x] Mostrar recomendacion principal: repetir, reescribir, responder objecion,
      retargeting o pausar.

Criterio de salida:

- En menos de 2 minutos se puede saber que paso con la semana publicada y cual
  es la siguiente decision comercial.

#### Paso 6.2 - Captura/importacion de metricas reales

Objetivo: alimentar el learning loop con datos de las publicaciones ya enviadas.

Checklist:

- [x] Captura manual de views, clicks, leads y gasto por destino/canal.
- [x] Agregar captura rapida desde la tabla semanal sin abrir cada campana.
- [x] Importar metricas desde Meta cuando la integracion lo permita.
- [x] Registrar fecha de corte de metricas para no mezclar semanas.
- [x] Separar metricas organicas de metricas pagadas.

Criterio de salida:

- Cada publicacion de la semana puede compararse con datos suficientes para
  decidir si se refuerza o se pausa.

#### Paso 6.3 - Comparador de publicaciones

Objetivo: distinguir curiosidad de intencion comercial.

Checklist:

- [x] Tabla comparativa por UTM: alcance, clicks, leads, demos, propuestas,
      ganadas, perdidas y objeciones.
- [x] Indicador de calidad: publico correcto, volumen de espacios, metodo de
      cobranza, dolor principal y urgencia.
- [x] Senal de fuga: muchos clicks sin lead, muchos leads sin demo o muchas
      demos perdidas por la misma objecion.
- [x] Recomendacion por pieza: reforzar, reescribir, cambiar publico, responder
      objecion, usar retargeting o pausar.

Criterio de salida:

- El modulo puede decir que publicacion genera avance comercial y cual solo
  genera ruido.

#### Paso 6.4 - Decision de contenido para la siguiente semana

Objetivo: que la nueva tanda no sea inventada desde cero, sino una respuesta a
los datos de la semana anterior.

Checklist:

- [x] Generar cola desde aprendizaje.
- [x] Crear piezas anti-objecion cuando haya perdidas con motivo registrado.
- [x] Priorizar la pieza ganadora como variante controlada.
- [x] Convertir la peor pieza en una version reescrita con otro gancho.
- [x] Crear una pieza especifica para la objecion dominante.
- [x] Mantener al menos una pieza nueva de exploracion para no quedarse en un
      solo angulo.

Criterio de salida:

- La siguiente semana explica por que existe cada pieza: reforzar, explorar,
  reescribir o responder objecion.

#### Paso 6.5 - Pauta pagada controlada

Objetivo: invertir poco, aprender rapido y evitar audiencias que no compran.

Checklist:

- [x] Semaforo de pauta pagada con presupuesto, exclusiones y reglas de pausa.
- [x] Crear checklist previo a pauta: UTM, landing, lead form, calificacion,
      pieza aprobada y objetivo comercial.
- [x] Exportar brief de audiencia: publico util, exclusiones, presupuesto
      sugerido y regla de apagado.
- [x] Separar prueba fria de retargeting.
- [x] Pausar automaticamente la recomendacion si no hay leads calificados o si
      la objecion dominante no fue respondida.

Criterio de salida:

- El modulo puede recomendar presupuesto pequeno para una pieza concreta, con
  audiencia y regla de pausa, sin promover toda la semana completa.

#### Paso 6.6 - Rutina semanal de decision

Objetivo: institucionalizar el ciclo para que cada semana mejore la anterior.

Ritmo:

- Lunes: revisar resultados de la semana anterior.
- Martes: ajustar prompts, hooks y creativos con base en datos.
- Miercoles: aprobar o regenerar la nueva tanda.
- Jueves: preparar retargeting o prueba pagada pequena si hay senal.
- Viernes: registrar demos, propuestas, ganados, perdidos y objeciones.

Salida semanal obligatoria:

```text
Mejor pieza:
- ...

Mejor canal:
- ...

Lead mas calificado:
- ...

Objecion dominante:
- ...

Decision de pauta:
- Esperar / retargeting / prueba controlada / escalar / pausar.

Siguiente tanda:
- Reforzar:
- Reescribir:
- Responder objecion:
- Explorar:
```

## Fase 7 - Planes, permisos, limites y volumen

Objetivo: alinear MKT con el modelo SaaS para que sea vendible y controlable.

Decision de producto:

- Backoffice MKT es una herramienta interna de BetterP para vender Renta Facil.
  Vive en `/backoffice/marketing`, usa datos comerciales de BetterP y solo debe
  abrirse a usuarios internos con permisos de administracion.
- Marketing cliente es una capacidad SaaS futura para que cada cliente gestione
  sus propias publicaciones, leads y aprendizaje desde `/marketing`. Solo debe
  ver datos de su `CapaNegocio` y respetar su plan.
- El formulario publico de lead no depende del plan del visitante. Puede crear
  prospectos, pero no debe revelar datos internos ni acciones de backoffice.
- Los leads entrantes no deben bloquearse por limite de plan; bloquear un lead
  real es perder venta. Los limites deben aplicarse sobre automatizacion,
  publicacion, IA, activos, sincronizaciones, exportaciones avanzadas o volumen
  operativo.

Funcionalidad que debe controlar esta fase:

- Acceso al modulo `marketing`.
- Uso de `ai_copy` para generar copy, prompts, learning y variantes.
- Uso de `social_publishing` para publicar o programar en canales conectados.
- Uso de `marketing_automation` para rutinas, aprendizaje, decisiones de pauta
  y generacion semanal asistida.
- Uso de integraciones Meta: conexion, publicacion, importacion de insights y
  brief de audiencia.
- Carga y administracion de creativos.
- Exportacion de prompts, brief de audiencia y rutina semanal.
- Pipeline comercial derivado de marketing: leads, demos, propuestas, ganados y
  perdidos.

Capacidades recomendadas:

| Capacidad | Clave sugerida | Tipo | Estado recomendado |
| --- | --- | --- | --- |
| Ver modulo Marketing | `marketing` | Modulo | Usar clave existente |
| Copy y prompts IA | `ai_copy` | Funcion | Usar clave existente |
| Publicacion social | `social_publishing` | Funcion | Usar clave existente |
| Automatizacion MKT | `marketing_automation` | Funcion | Usar clave ya observada en auditoria |
| Learning Loop avanzado | `marketing_learning_loop` | Funcion | Crear si se necesita separar lectura basica de decision avanzada |
| Meta insights | `marketing_meta_insights` | Funcion | Crear si se cobra aparte de publicar |
| Brief de pauta | `marketing_paid_brief` | Funcion | Crear si se quiere reservar a planes altos |

Matriz comercial sugerida:

| Plan | Para quien | Incluye MKT | Limites sugeridos | Objetivo de venta |
| --- | --- | --- | --- | --- |
| Starter | Operaciones pequenas que aun ordenan renta/cobranza | Sin modulo Marketing cliente, o solo captura basica de leads si aplica | Sin IA, sin publicacion social, sin learning loop | Vender Renta Facil como control operativo, no como suite de marketing |
| Growth | Administradores que quieren publicar y medir | Marketing, calendario, captura de metricas, creativos, leads y `social_publishing` | 4 tandas IA/mes, 30 publicaciones programadas/mes, 2 canales conectados, 2 activos por campana | Convertir marketing en operacion semanal sin gastar de mas |
| Scale | Operadores con varias unidades, pauta o equipo comercial | Todo Growth + learning loop, Meta insights, brief de pauta, rutina semanal y automatizacion | 12 tandas IA/mes, 150 publicaciones/mes, 5 canales, 5 activos por campana, mayor bolsa de tokens | Vender control, volumen y aprendizaje continuo |
| Enterprise | Multi-sede, franquicia o cuenta administrada | Limites y flujos a medida | Contrato personalizado, bolsa IA pactada, soporte prioritario | Cerrar operaciones grandes sin forzar el producto base |

Limites funcionales recomendados:

- Publicaciones programadas por mes: controla volumen operativo y uso de canales.
- Tandas generadas con IA por mes: se apoya en `openai_tokens_incluidos`, pero
  debe expresarse en lenguaje de producto.
- Activos por campana: evita galerias gigantes y costo de almacenamiento sin
  valor comercial.
- Canales conectados: separa publicar en 1-2 canales de operar una red completa.
- Sincronizaciones Meta por dia: protege API, tiempos de respuesta y rate limits.
- Exportaciones avanzadas por mes: util para separar lectura basica de procesos
  comerciales mas maduros.
- Usuarios y espacios siguen usando los limites existentes de `PlanSaaS`.

Lo que no se debe limitar de forma agresiva:

- Leads entrantes.
- Registro de objeciones.
- Marcado de ganado/perdido.
- Lectura de resultados historicos propios.
- Datos necesarios para soporte, auditoria o cumplimiento.

Ventajas de negocio:

- Permite vender Renta Facil por etapas: primero control operativo, despues
  publicacion, despues aprendizaje y pauta.
- Evita regalar funciones costosas de IA, Meta o automatizacion en planes bajos.
- Crea razones claras para upgrade: mas volumen, mas canales, mas aprendizaje,
  mejor seguimiento y menos trabajo manual.
- Reduce desperdicio de presupuesto porque la pauta avanzada solo aparece cuando
  hay tracking, leads calificados, objecion respondida y plan permitido.
- Hace que ventas y soporte expliquen el producto con la misma matriz, sin
  depender de memoria o excepciones.

Ventajas tecnicas:

- Reutiliza `PlanSaaS`, `SuscripcionCapa`, `modulos_habilitados`,
  `funciones_habilitadas`, overrides y auditoria existentes.
- Evita crear un segundo sistema de permisos para Marketing.
- Permite que frontend y backend compartan el mismo contrato de capacidades.
- Separa datos internos de BetterP de datos de clientes finales.
- Facilita pruebas automatizadas: cada endpoint puede probar permitido,
  bloqueado por modulo, bloqueado por funcion y bloqueado por limite.

Paso 7.1 - Inventario de superficies MKT

Objetivo: listar cada accion del modulo y decidir si es interna, cliente o
publica.

Checklist:

- [x] Clasificar pantallas: `/backoffice/marketing`, `/marketing`, landing y
      formularios publicos.
- [x] Clasificar endpoints: lectura, generacion IA, publicacion, Meta sync,
      metricas, activos, pipeline y exports.
- [x] Marcar cada accion como `INTERNAL_ONLY`, `PLAN_MODULE`, `PLAN_FEATURE`,
      `USAGE_LIMIT` o `PUBLIC_SAFE`.
- [x] Documentar que datos usa cada accion: BetterP comercial, cliente tenant o
      visitante publico.

Matriz de pantallas:

| Superficie | Archivo | Audiencia | Clasificacion | Datos | Regla |
| --- | --- | --- | --- | --- | --- |
| `/backoffice/marketing` | `frontend/app/backoffice/marketing/page.tsx` + `BusinessAdminManager` | Equipo BetterP | `INTERNAL_ONLY` | Operacion comercial BetterP: campanas, prospectos, learning y pauta | Requiere permiso interno de plataforma; no se controla por plan cliente |
| `/admin/marketing` | `frontend/app/admin/marketing/page.tsx` + `BusinessAdminManager` | Alias interno | `INTERNAL_ONLY` | Mismos datos de Backoffice MKT | Mismo guard que backoffice; debe mantenerse como alias interno |
| `/marketing` | `frontend/app/marketing/page.tsx` + `MarketingWorkspace` | Cliente SaaS autenticado | `PLAN_MODULE` | Datos de la `CapaNegocio`: entidades, espacios, canales, comunicados y publicaciones | Requiere modulo `marketing` y features por accion/canal |
| `/soluciones/renta-facil` | `frontend/app/soluciones/renta-facil/page.tsx` + `ContactLeadForm` | Visitante publico | `PUBLIC_SAFE` | Datos enviados por prospecto + UTM + calificacion | No requiere plan; debe crear lead sin exponer datos internos |
| `/soluciones/vende-facil` | `frontend/app/soluciones/vende-facil/page.tsx` + `ContactLeadForm` | Visitante publico | `PUBLIC_SAFE` | Datos enviados por prospecto + solution key | No requiere plan; enruta prospecto a solucion correcta |
| `/soluciones/tienda-facil` | `frontend/app/soluciones/tienda-facil/page.tsx` + `ContactLeadForm` | Visitante publico | `PUBLIC_SAFE` | Datos enviados por prospecto + solution key | No requiere plan; solo captura intencion comercial |

Matriz de endpoints internos:

| Endpoint | Accion | Clasificacion | Guard actual | Capability futura | Datos |
| --- | --- | --- | --- | --- | --- |
| `GET /api/billing/admin/marketing/` | Leer dashboard, campanas, prospectos, pipeline y learning | `INTERNAL_ONLY` | `require_platform_admin_access` | Ninguna de plan cliente | BetterP comercial |
| `POST/PATCH /api/billing/admin/redes-sociales/` | Crear/editar canales sociales internos | `INTERNAL_ONLY` | `require_platform_admin_access` | Ninguna de plan cliente | Canales BetterP |
| `POST /api/billing/admin/campanas/` | Crear campana interna | `INTERNAL_ONLY` | `require_platform_admin_access` | Ninguna de plan cliente | Campanas BetterP |
| `DELETE /api/billing/admin/campanas/...` | Borrar campanas internas | `INTERNAL_ONLY` | `require_platform_admin_access` | Ninguna de plan cliente | Campanas BetterP |
| `PATCH /api/billing/admin/campanas/{id}/decision/` | Aceptar, rechazar o pedir modificacion editorial | `INTERNAL_ONLY` | `require_platform_admin_access` | Ninguna de plan cliente | Revision editorial BetterP |
| `POST /api/billing/admin/campanas/{id}/regenerar/` | Regenerar con feedback | `INTERNAL_ONLY` + costo IA | `require_platform_admin_access` | `ai_copy` solo si algun dia se abre a cliente | Campanas BetterP |
| `POST /api/billing/admin/marketing/content-engine/generate-week/` | Generar 7 dias con o sin aprendizaje | `INTERNAL_ONLY` + costo IA | `require_platform_admin_access` | `marketing_automation` si se abre a cliente | Motor comercial BetterP |
| `POST /api/billing/admin/marketing/content-engine/start-today/` | Iniciar cola y publicar primera pieza | `INTERNAL_ONLY` | `require_platform_admin_access` | `marketing_automation` si se abre a cliente | Cola BetterP |
| `POST /api/billing/admin/marketing/learning/analyze/` | Analisis IA del aprendizaje | `INTERNAL_ONLY` + costo IA | `require_platform_admin_access` | `marketing_learning_loop` si se abre a cliente | Learning BetterP |
| `POST/PATCH /api/billing/admin/campanas/{id}/activos/...` | Subir, borrar y reordenar creativos | `INTERNAL_ONLY` + posible `USAGE_LIMIT` | `require_platform_admin_access` | Limite de activos si se abre a cliente | Activos BetterP |
| `POST /api/billing/admin/campanas/{id}/disparar/` | Lanzar/publicar campana interna | `INTERNAL_ONLY` | `require_platform_admin_access` | `social_publishing` si se abre a cliente | Publicacion BetterP |
| `PATCH /api/billing/admin/campanas/{id}/destinos/{id}/metricas/` | Captura manual de metricas | `INTERNAL_ONLY` | `require_platform_admin_access` | Ninguna de plan cliente | Metricas BetterP |
| `POST /api/billing/admin/campanas/{id}/destinos/{id}/metricas/meta-sync/` | Importar insights Meta | `INTERNAL_ONLY` + integracion | `require_platform_admin_access` | `marketing_meta_insights` si se abre a cliente | Meta BetterP |
| `PATCH /api/billing/admin/prospectos/{id}/` | Mover lead a contactado/demo/propuesta/perdido | `INTERNAL_ONLY` | `require_platform_admin_access` | Ninguna de plan cliente | Pipeline BetterP |
| `POST /api/billing/admin/sync-inbox/` | Sincronizar inbox de contacto | `INTERNAL_ONLY` | `require_platform_admin_access` | Ninguna de plan cliente | Solicitudes BetterP |

Matriz de endpoints Marketing cliente:

| Endpoint | Accion | Clasificacion | Guard actual | Capability/limite |
| --- | --- | --- | --- | --- |
| `GET /api/marketing/entidades/{id}/dashboard/` | Leer dashboard cliente | `PLAN_MODULE` | `require_plan_module("marketing")` | Modulo `marketing` |
| `PUT /api/marketing/entidades/{id}/canales/{canal}/` | Configurar canal | `PLAN_FEATURE` | `require_write_access` + `social_publishing` + feature por canal | `social_publishing`, `marketing_facebook`, `marketing_instagram`, `marketing_tiktok`, `marketing_youtube` |
| `POST /api/marketing/entidades/{id}/canales/{canal}/oauth/iniciar/` | Iniciar OAuth cliente | `PLAN_FEATURE` | `require_write_access` + `social_publishing` + feature por canal | Canales permitidos por plan |
| `POST /api/marketing/entidades/{id}/canales/{canal}/desconectar/` | Desconectar canal | `PLAN_FEATURE` | `require_write_access` + `social_publishing` + feature por canal | Canales permitidos por plan |
| `POST /api/marketing/oauth/callback/` | Registrar OAuth desde frontend | `PLAN_FEATURE` | `require_write_access` + `social_publishing` | Requiere revisar state/tenant en 7.3 |
| `GET/POST /api/marketing/oauth/*/deauthorize/` | Webhooks Meta de baja/data deletion | `PUBLIC_SAFE` controlado por firma | `auth=None` + signed request | No depende de plan; debe desactivar credenciales |
| `POST /api/marketing/entidades/{id}/campanas/` | Crear campana cliente | `PLAN_MODULE` + posible `USAGE_LIMIT` | `require_write_access` + `marketing` + features de canales | Limite mensual de campanas/publicaciones |
| `PUT /api/marketing/campanas/{id}/` | Actualizar campana cliente | `PLAN_MODULE` + posible `USAGE_LIMIT` | `require_write_access` + `marketing` | Limite si cambia canales o volumen |
| `POST /api/marketing/entidades/{id}/media/` | Subir media | `PLAN_MODULE` + `USAGE_LIMIT` | `require_write_access` + `marketing` | Limite de activos/almacenamiento |
| `POST /api/marketing/entidades/{id}/comunicados/` | Crear comunicado | `PLAN_MODULE` + `USAGE_LIMIT` | `require_write_access` + `marketing` + features de canales | Publicaciones programadas/mes |
| `PUT/DELETE /api/marketing/comunicados/{id}/` | Actualizar/eliminar comunicado | `PLAN_MODULE` | `require_write_access` + `marketing` | Tenant scope por entidades permitidas |
| `POST /api/marketing/comunicados/{id}/publicar/{canal}/` | Publicar directo | `PLAN_FEATURE` + `USAGE_LIMIT` | `require_write_access` + `social_publishing` + feature por canal | Publicaciones/mes y canal incluido |
| `POST /api/marketing/publicaciones/{id}/eliminar/` | Eliminar publicacion remota | `PLAN_FEATURE` | `require_write_access` + `social_publishing` + feature por canal | Canal incluido |

Matriz de captura publica:

| Endpoint | Accion | Clasificacion | Guard actual | Regla |
| --- | --- | --- | --- | --- |
| `POST /api/billing/prospectos/contacto/` | Capturar prospecto desde landing | `PUBLIC_SAFE` | `auth=None` + validaciones de email/datos | Nunca bloquear por plan; guardar UTM, solucion y calificacion |

Entradas para 7.2:

- Formalizar `marketing_automation` dentro de `PLAN_FEATURE_DEFINITIONS`; hoy ya
  aparece en auditoria, pero no debe quedar como capability fantasma.
- Decidir si `marketing_learning_loop`, `marketing_meta_insights` y
  `marketing_paid_brief` se crean desde ahora o si `marketing_automation` cubre
  todo el primer release.
- Confirmar si las features por canal `marketing_facebook`,
  `marketing_instagram`, `marketing_tiktok` y `marketing_youtube` deben
  mostrarse en admin de planes junto a `social_publishing`.
- Definir limites de 7.5 antes de exponer IA o publicacion automatizada a
  clientes.
- Mantener Backoffice MKT fuera de planes cliente: se controla por permiso
  interno, no por `PlanSaaS`.

Salida:

- Matriz de permisos por ruta, endpoint y accion.

Paso 7.2 - Contrato unico de capacidades

Objetivo: que producto, backend y frontend hablen las mismas claves.

Checklist:

- [x] Confirmar si `marketing_automation` debe agregarse formalmente a
      `PLAN_FEATURE_DEFINITIONS`.
- [x] Decidir si `marketing_learning_loop`, `marketing_meta_insights` y
      `marketing_paid_brief` se agregan ahora o se dejan como pendientes.
- [x] Actualizar etiquetas frontend en `plan-access.ts`.
- [x] Confirmar que planes por solucion mantengan namespace correcto:
      `renta_facil`, `vende_facil`, `tienda_facil` y plataforma.

Decision:

- Se formaliza `marketing_automation` porque ya aparecia en auditoria y debe ser
  una capability real, no una llave fantasma.
- Se agregan tambien `marketing_learning_loop`, `marketing_meta_insights` y
  `marketing_paid_brief` para poder separar lectura basica, aprendizaje,
  importacion de Meta y pauta controlada cuando se implemente 7.3/7.5.
- Las features por canal `marketing_facebook`, `marketing_instagram`,
  `marketing_tiktok` y `marketing_youtube` ya existian en backend; se agregaron
  etiquetas frontend para mensajes de bloqueo/upgrade consistentes.
- Las claves `marketing` y `marketing_*` quedan asociadas a `renta_facil` cuando
  el plan no tenga una solucion explicita, manteniendo compatibilidad con planes
  antiguos y tests de marketing cliente.

Catalogo MKT formal:

| Clave | Tipo | Uso |
| --- | --- | --- |
| `marketing` | Modulo | Acceso al workspace Marketing cliente |
| `social_publishing` | Funcion | Habilita conexiones y publicacion social |
| `ai_copy` | Funcion | Habilita copy/prompts asistidos por IA |
| `marketing_automation` | Funcion | Generacion semanal, rutina y automatizacion MKT |
| `marketing_learning_loop` | Funcion | Learning Loop avanzado, UTMs, objeciones y siguiente tanda |
| `marketing_meta_insights` | Funcion | Importacion de metricas desde Meta |
| `marketing_paid_brief` | Funcion | Brief de audiencia, presupuesto y reglas de pauta |
| `marketing_facebook` | Funcion por canal | Permite Facebook Pages |
| `marketing_instagram` | Funcion por canal | Permite Instagram Business |
| `marketing_tiktok` | Funcion por canal | Permite TikTok |
| `marketing_youtube` | Funcion por canal | Permite YouTube Shorts |

Salida:

- Catalogo de capacidades MKT estable y visible en admin de planes.

Paso 7.3 - Guardas backend

Objetivo: que ninguna accion sensible dependa solo de que el boton se oculte en
frontend.

Checklist:

- [x] Crear helper para validar acceso MKT cliente por `CapaNegocio`,
      suscripcion y capability.
- [x] Mantener Backoffice MKT protegido por permisos internos, no por plan del
      cliente.
- [x] Bloquear generacion IA si falta `ai_copy` o bolsa disponible.
- [x] Bloquear publicacion si falta `social_publishing`.
- [x] Bloquear learning/pauta si falta `marketing_automation` o la funcion
      avanzada correspondiente.
- [x] Registrar auditoria `PLAN_FUNCION_DENEGADA` o `PLAN_MODULO_DENEGADO` con
      ruta, capability y capa.

Implementado:

- `require_plan_feature` acepta mensaje personalizado sin perder auditoria, para
  que Marketing pueda mostrar "canal de marketing" o "publicacion social" sin
  volver a usar chequeos manuales sin evento.
- `marketing_social` usa `require_plan_feature` para bloquear canales por plan:
  `marketing_facebook`, `marketing_instagram`, `marketing_tiktok` y
  `marketing_youtube`.
- El callback OAuth autenticado vuelve a validar el canal antes de guardar
  credenciales. Si el plan cambio durante el flujo, no se crea conexion.
- El callback OAuth publico tambien valida la suscripcion de la entidad antes de
  guardar una conexion, aun cuando no pueda auditar con sesion activa.
- Backoffice MKT sigue intencionalmente bajo `require_platform_admin_access`: no
  se ata a planes cliente porque opera datos comerciales internos de BetterP.
- No existe todavia endpoint IA/learning/pauta para Marketing cliente. Las
  capabilities `ai_copy`, `marketing_automation`, `marketing_learning_loop`,
  `marketing_meta_insights` y `marketing_paid_brief` quedan listas para usarse
  cuando esas acciones se abran fuera de Backoffice.

Salida:

- Backend como fuente de verdad de acceso.

Paso 7.4 - Guardas frontend y mensajes de upgrade

Objetivo: que el usuario entienda que puede hacer, que le falta y por que.

Checklist:

- [x] Bloquear ruta `/marketing` si el plan no tiene modulo `marketing`.
- [x] Ocultar o dejar read-only acciones avanzadas segun features.
- [ ] Mostrar estado de limite antes de generar/publicar, no despues del error.
- [x] Usar mensajes comerciales claros: "Incluido en Scale" o "Requiere
      publicacion social", no mensajes tecnicos.
- [x] Mantener `/backoffice/marketing` fuera de la matriz de clientes.

Estado implementado:

- `/marketing` consulta la suscripcion vigente y traduce `social_publishing`
  mas `marketing_facebook`, `marketing_instagram`, `marketing_tiktok` y
  `marketing_youtube` a bloqueos visibles por accion.
- Si el plan no incluye publicacion social, el cliente puede preparar
  comunicados e inventario, pero ve deshabilitadas las acciones de conectar,
  publicar, copiar diagnostico OAuth o borrar publicaciones remotas.
- Si el plan incluye publicacion social pero no un canal concreto, se muestra
  aviso de canales limitados y el boton indica que capability requiere.
- El frontend evita llamar endpoints sensibles cuando ya sabe que el plan no
  tiene acceso; backend sigue siendo la fuente de verdad y audita el bloqueo.
- Los limites de volumen quedan pendientes para 7.5 porque requieren contadores
  mensuales y politica de consumo.

Salida:

- UI consistente con backend y util para venta consultiva.

Paso 7.5 - Limites de volumen y consumo

Objetivo: cobrar volumen real sin frenar la captura comercial.

Checklist:

- [x] Definir contadores mensuales: tandas IA, publicaciones programadas, Meta
      sync, activos subidos, exportaciones avanzadas.
- [x] Mapear contadores a `PlanSaaS` o metadata si todavia no amerita columnas.
- [x] Definir comportamiento al llegar al limite: bloquear, degradar a manual o
      pedir upgrade.
- [x] No bloquear leads entrantes ni registro de pipeline.
- [x] Mostrar uso actual: usado, incluido, restante y fecha de reinicio.

Estado implementado:

- Marketing cliente calcula uso mensual por `CapaNegocio` y lo expone en el
  dashboard de `/marketing`.
- Contadores definidos: `marketing_ai_batches`,
  `marketing_publications_scheduled`, `marketing_social_publishes`,
  `marketing_meta_syncs`, `marketing_media_assets` y
  `marketing_advanced_exports`.
- Como `PlanSaaS` todavia no tiene metadata propia, los limites salen de una
  tabla conservadora por tier (`starter`, `growth`, `scale`) y pueden ajustarse
  por suscripcion con `metadata.marketing_usage_limits`.
- El backend bloquea antes de consumir volumen en acciones vivas: subir
  multimedia, crear publicaciones por canal y publicar hacia redes.
- Cada bloqueo por limite registra auditoria `PLAN_LIMITE_DENEGADO`.
- El frontend muestra `Uso del mes`, usado/incluido/restante/reinicio y
  deshabilita acciones cuando ya no hay cupo.
- No se aplico ningun limite a leads entrantes ni a pipeline comercial.

Salida:

- Volumen medible y vendible sin sorpresas.

Paso 7.6 - Overrides, soporte y cuentas administradas

Objetivo: permitir excepciones controladas sin romper la matriz de planes.

Checklist:

- [x] Usar overrides existentes de suscripcion para agregar o bloquear funciones.
- [x] Exigir nota interna cuando se haga override.
- [x] Mostrar en admin que una cuenta tiene capacidades fuera de plan.
- [x] Auditar quien cambio el acceso, cuando y por que.
- [x] Definir cuentas administradas por BetterP, donde el equipo interno opera
      MKT por el cliente bajo contrato.

Estado implementado:

- Los overrides comerciales siguen usando `metadata.plan_capability_overrides`
  por suscripcion y obligan nota interna cuando liberan o bloquean capacidades.
- El admin de clientes muestra resumen de overrides activos, overrides sin nota
  y ajustes vencidos por revisar.
- Se agrego `metadata.betterp_managed_marketing` para marcar cuentas donde
  BetterP opera marketing por contrato, con alcance, responsable, nota,
  fecha y actor.
- El modal de funciones personalizadas permite activar MKT administrado sin
  cambiar el plan base, pero exige alcance, responsable y nota interna.
- La auditoria comercial ya incluye eventos `MANAGED_MARKETING` y registra
  `SUSCRIPCION_MKT_ADMINISTRADO_ACTUALIZADO` junto con un evento billing
  `subscription.managed_marketing.updated`.
- El dashboard de clientes muestra una seccion de cuentas MKT administradas y
  cada fila de cliente puede mostrar el badge de alcance operativo.

Salida:

- Flexibilidad comercial sin deuda invisible.

Paso 7.7 - Pruebas, smoke y cierre

Objetivo: probar que planes, permisos y limites no se contradicen.

Checklist:

- [x] Tests backend: permitido, bloqueado por modulo, bloqueado por funcion,
      bloqueado por limite y override permitido.
- [x] Tests frontend o smoke: ruta bloqueada, botones bloqueados y mensajes de
      upgrade.
- [x] Prueba de matriz con plan Starter, Growth y Scale.
- [x] Prueba de Backoffice MKT interno para confirmar que no quedo sujeto al plan
      de un cliente.
- [x] Actualizar documentacion de ventas y soporte con la matriz final.

Estado implementado:

- Se agrego prueba directa para plan activo sin modulo `marketing`: el dashboard
  y la creacion de comunicados quedan bloqueados con `PLAN_MODULO_DENEGADO`.
- La suite `MarketingSocialPlanGateTests` cubre: permitido por canal incluido,
  bloqueo por modulo, bloqueo por funcion/canal, callback OAuth revalidado,
  limite mensual, consumo de multimedia, bloqueo de publicacion remota y override
  de suscripcion.
- Los tests de Billing cubren el contrato de overrides, nota obligatoria y MKT
  administrado por BetterP con metadata, auditoria y evento billing.
- El smoke frontend se valida con `npm run lint` y `npm run build`; la ruta
  `/marketing` usa `plan-access.ts` para bloquear el modulo y
  `MarketingWorkspace` deshabilita conectar/publicar/borrar por capability,
  canal o limite.
- Backoffice MKT queda fuera de planes cliente: sigue bajo permisos internos
  `require_platform_admin_access` y no depende de `PlanSaaS` del cliente.

Matriz de evidencia:

| Caso | Evidencia | Resultado esperado |
| --- | --- | --- |
| Permitido por plan | `test_plan_channel_features_filter_and_block_marketing_channels` | Facebook incluido se configura correctamente. |
| Bloqueado por modulo | `test_plan_without_marketing_module_blocks_dashboard_and_writes` | `/marketing` y escritura responden 403 y auditan `PLAN_MODULO_DENEGADO`. |
| Bloqueado por funcion/canal | `test_plan_channel_features_block_campaign_channels` y OAuth callback | Instagram fuera de plan no se guarda ni se publica. |
| Bloqueado por limite | `test_marketing_publication_limit_blocks_new_communication` y publish limit | No consume cupo ni llama proveedor cuando el limite esta agotado. |
| Override permitido | `test_subscription_overrides_unlock_and_block_marketing_channels` | Un override temporal libera o bloquea Instagram sin cambiar el plan base. |
| Cuenta administrada | `test_admin_subscription_managed_marketing_requires_contract_details` | MKT administrado exige alcance/responsable/nota y queda auditado. |
| Frontend smoke | `npm run lint` + `npm run build` | Tipos, JSX y rutas compilan sin errores. |

Matriz final para ventas y soporte:

| Escenario | Que ve el cliente | Mensaje comercial/soporte |
| --- | --- | --- |
| Sin modulo `marketing` | La ruta `/marketing` se bloquea. | Requiere un plan con Marketing para preparar publicaciones y controlar canales. |
| Marketing sin `social_publishing` | Puede preparar contenido, pero no conectar ni publicar en redes. | Upgrade por publicacion social, no por soporte tecnico. |
| Social con canales limitados | Solo aparecen/funcionan canales incluidos, por ejemplo Facebook. | Vender canales adicionales segun operacion real del cliente. |
| Limite mensual agotado | Botones quedan bloqueados antes de consumir volumen. | Upgrade por volumen: mas publicaciones, multimedia o publicaciones remotas. |
| Override comercial | Admin ve capacidades fuera de plan con nota. | Excepcion temporal documentada; revisar vigencia antes de renovar. |
| MKT administrado por BetterP | Admin ve alcance, responsable y nota interna. | Servicio operado por BetterP bajo contrato, separado del plan base del cliente. |

Salida:

- La Fase 7 queda lista para pasar a cierre de release sin fugas de acceso.

Criterio de salida:

- El modulo no abre funciones por accidente.
- Los limites son entendibles para producto, ventas y soporte.
- La operacion comercial de BetterP no se mezcla con datos de clientes.
- Cada accion sensible tiene validacion backend, estado frontend y evento de
  auditoria si se bloquea.
- Las ventajas de upgrade se explican por volumen, canales, IA y aprendizaje,
  no por castigar al usuario con bloqueos arbitrarios.

## Fase 8 - Cierre de release Backoffice MKT

Objetivo: dejar la incursion cerrada con evidencia, como Cobranza.

En esta fase no se busca agregar mas alcance comercial. Se busca confirmar que
lo ya construido funciona en condiciones reales, que ventas puede usarlo sin
explicaciones tecnicas y que soporte sabe que revisar si algo falla.

Checklist:

- [x] Tests backend de endpoints MKT internos.
- [x] Smoke de Backoffice MKT documentado.
- [x] Revision visual de UX.
- [x] Revision de permisos.
- [x] Revision de logs/errores.
- [x] Actualizacion de docs operativas.
- [x] Checklist de go-live comercial.
- [x] Registro de pendientes que quedan fuera del cierre.

Criterio de salida:

- Backoffice MKT queda operativo para vender Renta Facil.
- La ruta de contenido y captura de leads funciona.
- Hay trazabilidad de publicaciones, leads y avances.
- Lo que no se cerro queda documentado como siguiente incursion, no como deuda
  invisible.

Orden recomendado:

1. 8.1 Tests backend de endpoints internos.
2. 8.2 Smoke funcional de Backoffice MKT.
3. 8.3 Revision visual y UX.
4. 8.4 Revision de permisos y fronteras de datos.
5. 8.5 Revision de logs, errores y observabilidad.
6. 8.6 Documentacion operativa para ventas/soporte.
7. 8.7 Checklist de go-live comercial.
8. 8.8 Registro de pendientes fuera del release.

### Paso 8.1 - Tests backend de endpoints MKT internos

Objetivo: asegurar que las rutas internas de Backoffice MKT no fallen en los
flujos que se van a usar para operar Renta Facil.

Alcance:

- Dashboard interno de Marketing.
- Generacion de 7 dias.
- Generacion con aprendizaje.
- Revision editorial: aceptar, rechazar y pedir modificacion.
- Regeneracion con feedback.
- Captura/importacion de metricas.
- Movimiento de prospectos por etapa.
- Acciones de cierre: preparar cliente o marcar perdido.

Mejoras a realizar:

- Agrupar pruebas en una clase de smoke backend para Backoffice MKT interno.
- Validar que cada endpoint exige `platform_admin`.
- Validar que Backoffice MKT no dependa del plan SaaS del cliente.
- Probar respuestas minimas: dashboard carga, learning loop responde, campanas
  se listan y acciones principales devuelven estructura estable.
- Cubrir errores controlados: campana inexistente, destino inexistente,
  prospecto inexistente, feedback vacio cuando aplica y estado invalido.

Criterio de salida:

- Existe una suite corta que se pueda correr antes de deploy.
- Si un endpoint interno rompe contrato, falla test antes de llegar a produccion.

Estado implementado:

- `test_backoffice_marketing_dashboard_contract_ignores_client_plan` valida que
  `/api/billing/admin/marketing/` carga aunque la capa actual tenga un plan sin
  modulo Marketing, porque Backoffice MKT es interno de BetterP.
- `test_backoffice_marketing_internal_endpoints_require_platform_admin` recorre
  rutas criticas internas y confirma que usuarios tenant reciben 403 antes de
  lookup o validacion de payload.
- `test_backoffice_marketing_internal_actions_smoke_contracts` cubre crear
  campana, registrar decision editorial, capturar metricas, mover prospecto y
  ejecutar learning heuristic.
- `test_backoffice_marketing_internal_endpoints_return_controlled_errors` cubre
  errores esperados: campana sin canales, decision invalida, destino inexistente,
  etapa invalida y borrado masivo sin seleccion.

### Paso 8.2 - Smoke funcional de Backoffice MKT

Objetivo: recorrer el flujo real de trabajo de marketing de principio a fin.

Recorrido smoke:

- Abrir `/backoffice/marketing`.
- Confirmar que carga dashboard, tabs, campanas, learning loop y conexiones.
- Generar o refrescar una cola de 7 publicaciones.
- Abrir una campana y revisar copy, UTM, prompt visual, canal y preview.
- Subir o seleccionar creativo principal.
- Aceptar una publicacion y rechazar/modificar otra.
- Capturar metricas de una pieza publicada.
- Ejecutar Learning Loop y verificar recomendacion semanal.
- Revisar prospectos, copiar mensaje, abrir WhatsApp/email y mover etapa.

Mejoras a realizar:

- Agregar una lista visible o documentada de smoke para que cualquiera del
  equipo pueda repetirlo.
- Detectar acciones que todavia obliguen a abrir demasiados modales o hacer
  scroll excesivo.
- Confirmar que los botones criticos muestran loading, error y exito.
- Confirmar que una falla de Meta no bloquea la revision editorial ni pipeline.

Criterio de salida:

- Un usuario interno puede operar la semana de publicaciones sin asistencia de
  desarrollo.
- Los errores no quedan silenciosos ni ambiguos.

Estado implementado:

- Se creo `docs/backoffice-mkt-smoke-checklist.md` como runbook repetible de
  smoke funcional para Backoffice MKT.
- El recorrido cubre preparacion, conexiones Meta, cola semanal, revision de
  campana, creativo principal, decision editorial, publicacion controlada,
  metricas, Learning Loop, prospectos y decision final.
- La guia define evidencia minima: ambiente, usuario, version, campana revisada,
  decision editorial, metricas, Learning Loop, lead revisado y riesgos.
- El cierre del smoke usa decision `GO`, `GO CON RIESGO` o `NO GO` para evitar
  liberar una semana comercial con fallas ambiguas.
- El runbook incluye fallas comunes y accion sugerida para permisos, Meta, R2,
  Learning Loop, pauta pausada y leads sin UTM.

Pendiente operativo:

- Ejecutar el runbook en produccion/staging despues del deploy y adjuntar
  evidencia real del smoke.

### Paso 8.3 - Revision visual de UX

Objetivo: que Backoffice MKT se sienta como herramienta operativa, no como una
pantalla pesada de configuracion.

Pantallas a revisar:

- Resumen superior de Marketing.
- Tabla de campanas.
- Modal de campana.
- Preview por canal.
- Galeria de creativos.
- Resultados de esta semana.
- Learning Loop.
- Brief de pauta.
- Pipeline comercial compacto.
- Conexiones Meta.

Mejoras a realizar:

- Reducir ruido visual en zonas con demasiadas tarjetas o texto repetido.
- Asegurar que la accion primaria de cada bloque sea obvia.
- Revisar mobile/tablet solo para que no se rompa, aunque la operacion principal
  sea desktop.
- Confirmar que textos largos no se enciman ni rompen botones.
- Revisar que tablas tengan acciones visibles sin scroll horizontal innecesario.
- Mantener iconos con tooltip donde ya se opera por accion rapida.

Criterio de salida:

- La pantalla permite escanear rapidamente: que publicar, que falta, que
  aprendimos y que lead necesita seguimiento.

Estado implementado:

- La seccion `Aprendizaje IA` conserva visible el resumen ejecutivo: score,
  cadencia y lectura IA.
- Los bloques densos quedaron encapsulados en acordeones nativos para evitar
  saturacion visual: rutina semanal, resultados de la semana, acciones
  anti-objecion, comparador por UTM, conversiones atribuibles, pauta controlada,
  decision de contenido y proxima tanda sugerida.
- Cada acordeon muestra en el encabezado una senal operativa compacta: estado,
  decision, conteo de piezas, leads, ganadas o readiness de pauta.
- El detalle operativo sigue disponible al abrir cada acordeon, incluyendo
  captura rapida de metricas, briefs, prompts, copy/download y tablas.
- No se cambiaron contratos backend ni estructura de datos; el ajuste fue de
  presentacion sobre la pantalla viva.

Validacion:

- `npm run lint` en frontend: OK, sin errores; quedan warnings existentes.
- `npm run build` en frontend: OK.

Pendiente operativo:

- Revisar la pantalla autenticada en staging/produccion durante el smoke visual
  para confirmar que los acordeones reducen scroll real con datos vivos.

### Paso 8.4 - Revision de permisos y fronteras de datos

Objetivo: confirmar que la operacion interna de BetterP no se mezcla con datos
o permisos de clientes.

Validaciones:

- Backoffice MKT solo abre con `platform_admin`.
- Marketing cliente sigue sujeto a plan, modulo, funciones y limites.
- Landing publica de Renta Facil sigue capturando leads sin requerir login.
- Prospectos capturados se clasifican como Renta Facil y no como datos de un
  cliente tenant.
- Las conexiones Meta de Backoffice usan credenciales internas, no canales de
  clientes.
- El cron de publicacion interno no publica comunicados de Marketing cliente.

Mejoras a realizar:

- Documentar la frontera `INTERNAL_ONLY`, `PLAN_MODULE`, `PLAN_FEATURE`,
  `USAGE_LIMIT` y `PUBLIC_SAFE` como contrato de soporte.
- Revisar que errores de permiso queden auditados con ruta, actor y accion.
- Confirmar que no haya botones internos visibles en vistas de cliente.

Criterio de salida:

- Se puede explicar con claridad que Backoffice MKT vende BetterP/Renta Facil,
  mientras Marketing cliente es una funcionalidad SaaS separada.

Contrato de frontera:

| Superficie | Clasificacion | Regla viva | Evidencia |
| --- | --- | --- | --- |
| `/backoffice/marketing` y `/admin/marketing` | `INTERNAL_ONLY` | Renderizan `BusinessAdminManager section="marketing"` y consumen `/billing/admin/*`. | `frontend/app/backoffice/marketing/page.tsx`, `frontend/components/business/BusinessAdminManager.tsx` |
| Endpoints Backoffice MKT | `INTERNAL_ONLY` | Usan `require_platform_admin_access`; no dependen del plan SaaS del cliente. | `backend/billing/api.py` |
| Callback Meta Backoffice | `INTERNAL_ONLY` con callback publico | `auth=None` solo para recibir a Meta; valida `state` firmado/cacheado y redirige al backoffice. | `backend/billing/api.py`, `backend/billing/meta_social.py` |
| Credenciales Meta Backoffice | `INTERNAL_ONLY` | Prefiere `BACKOFFICE_META_APP_ID`, `BACKOFFICE_META_APP_SECRET` y `BACKOFFICE_META_REDIRECT_URI`. | `backend/billing/meta_social.py` |
| `/marketing` cliente | `PLAN_MODULE` | Usa `MarketingWorkspace` y endpoints `/api/marketing/*`; no consume `/billing/admin/*`. | `frontend/app/marketing/page.tsx`, `frontend/components/marketing/MarketingWorkspace.tsx` |
| Endpoints Marketing cliente | `PLAN_MODULE`, `PLAN_FEATURE`, `USAGE_LIMIT` | Requieren modulo `marketing`, feature `social_publishing`, features por canal y limites mensuales. | `backend/marketing_social/api.py`, `frontend/lib/plan-access.ts` |
| Landing publica Renta Facil | `PUBLIC_SAFE` | `ContactLeadForm` llama `/billing/prospectos/contacto/` con `auth=None`; guarda UTM, solucion y calificacion. | `frontend/components/marketing/ContactLeadForm.tsx`, `backend/billing/api.py` |
| Prospectos comerciales | `PUBLIC_SAFE` -> `INTERNAL_ONLY` | El lead nace como `ProspectoComercial`, con `solution_key`/UTM en metadata; no pertenece a una `CapaNegocio` tenant. | `backend/billing/models.py`, `backend/billing/api.py` |
| Cron de publicacion interna | `INTERNAL_ONLY` | `publish_marketing_campaigns` llama `billing.marketing_automation.publish_due_marketing_campaigns` y opera `CampanaMarketing`. | `backend/billing/management/commands/publish_marketing_campaigns.py`, `backend/billing/marketing_automation.py` |
| Comunicados de cliente | `PLAN_MODULE`/tenant | Operan `marketing_social.ComunicadoMarketing`, `PublicacionMarketing` y `CanalMarketingEntidad`, separados de Backoffice. | `backend/marketing_social/api.py` |

Estado implementado:

- Backoffice MKT queda protegido por `platform_admin` en lectura, creacion de
  campanas, revision editorial, generacion semanal, Learning Loop, metricas,
  prospectos, Meta connect URL y activos.
- Marketing cliente queda sujeto a modulo, funcion, canal y limites:
  `marketing`, `social_publishing`, `marketing_facebook`,
  `marketing_instagram`, `marketing_tiktok`, `marketing_youtube` y limites de
  uso mensual.
- La captura publica de leads no requiere login ni plan, pero solo escribe un
  prospecto comercial con metadata de solucion, UTM y calificacion.
- Las credenciales de Backoffice Meta y Marketing cliente tienen namespaces
  separados: `BACKOFFICE_META_*` para Backoffice y `MARKETING_META_*`/fallbacks
  para cliente.
- Los bloqueos por plan se auditan como `PLAN_MODULO_DENEGADO` o
  `PLAN_FUNCION_DENEGADA` con ruta, metodo, plan, capability, actor, capa,
  session, IP y user agent.
- Los bloqueos por limite de Marketing cliente auditan uso, incluido, restante,
  incremento, periodo, entidad, plan, ruta y metodo.
- La busqueda en `MarketingWorkspace` no encontro llamadas a `/billing/admin/*`
  ni botones internos de Backoffice visibles en la vista cliente.

Validacion:

- Primer intento de tests se detuvo por prompt interactivo de Django al existir
  `test_neondb`; se repitio con `--keepdb`.
- `python backend/manage.py test --keepdb ...` con 7 pruebas de frontera: OK.
- Pruebas incluidas:
  `test_backoffice_marketing_dashboard_contract_ignores_client_plan`,
  `test_backoffice_marketing_internal_endpoints_require_platform_admin`,
  `test_contact_lead_persists_and_exposes_solution`,
  `test_contact_lead_persists_renta_qualification_for_paid_filtering`,
  `test_plan_without_marketing_module_blocks_dashboard_and_writes`,
  `test_plan_channel_features_filter_and_block_marketing_channels` y
  `test_subscription_overrides_unlock_and_block_marketing_channels`.

Decision:

- No se agrego codigo nuevo en 8.4; la frontera ya estaba implementada por las
  fases 7.x y 8.1. El cierre de este paso es documentar el contrato operativo y
  dejar evidencia de pruebas.

### Paso 8.5 - Revision de logs, errores y observabilidad

Objetivo: saber que paso cuando una publicacion, conexion o captura falla.

Senales a revisar:

- Errores de Meta OAuth.
- Errores de publicacion Meta.
- Fallas de R2 o carga de creativos.
- Fallas del cron `publish_marketing_campaigns`.
- Errores de generacion de contenido.
- Errores de importacion de insights.
- Leads capturados sin solucion o sin UTM.

Mejoras a realizar:

- Confirmar que cada error visible tenga mensaje util para operacion.
- Registrar en metadata el detalle suficiente para diagnosticar sin exponer
  secretos.
- Documentar dónde revisar logs Docker de Vultr, eventos de auditoría y eventos
  billing/marketing.
- Definir una rutina diaria de 5 minutos: revisar cron, publicaciones fallidas,
  leads nuevos y errores Meta.

Criterio de salida:

- Si algo falla durante una semana comercial, se puede encontrar causa y siguiente
  accion sin leer codigo.

Estado implementado:

- Se creo `docs/backoffice-mkt-observability-runbook.md` como guia especifica
  para diagnosticar Backoffice MKT durante una semana comercial.
- El runbook cubre: cron de publicacion, Meta OAuth, publicacion Meta, Meta
  insights, creativos/R2, generacion de contenido, Learning Loop, leads sin
  solucion/UTM e inbox comercial.
- Se documento donde mirar primero: Backoffice MKT, Backoffice Salud,
  `CronRunLog`, `CampanaMarketingDestino`, `CampanaMarketing.metadata`,
  `RedSocialConfig`, `ProspectoComercial.metadata`, `EventoAuditoria`,
  `BackendRequestMetric`, `FrontendClientError` y logs Docker de Vultr.
- Se agrego rutina diaria de 5 minutos y plantilla minima de incidente para
  operar sin depender de desarrollo.
- Se definieron decisiones operativas `GO`, `GO CON RIESGO` y `NO GO` para
  fallas de captura, Meta, cron, metricas, Learning Loop, UTMs y publico fuera
  de perfil.

Validacion:

- Se reviso que `publish_marketing_campaigns` registra `CronRunLog` con summary,
  metadata y error cuando falla.
- Se reviso que la publicacion interna guarda resultado por destino en
  `CampanaMarketingDestino.estatus`, `detalle`, `payload`, `external_id` y
  `CampanaMarketing.metadata.last_launch`.
- Se reviso que Meta insights guarda `manual_metrics.source = meta_insights`,
  periodo, actor, nota, metric names y payload de respuesta.
- Se reviso que leads publicos guardan `requested_solution_key`,
  `resolved_solution_key`, `utm` y `lead_qualification` en metadata.
- Se reviso que el sistema ya tiene `BackendRequestMetric`,
  `FrontendClientError`, `EventoAuditoria` y panel de Salud para crons/requests.

Decision:

- No se agrego instrumentacion nueva en codigo durante 8.5. La observabilidad
  minima ya existe; el cierre fue convertirla en procedimiento operativo
  repetible y accionable.

### Paso 8.6 - Documentacion operativa para ventas y soporte

Objetivo: que el modulo no dependa del conocimiento que quedo en este chat.

Documentos o secciones a dejar:

- Como operar la semana: generar, revisar, aceptar, publicar, medir, aprender.
- Como interpretar resultados: leads, demos, propuestas, ganadas, perdidas,
  objeciones y costo.
- Como decidir pauta: cuando esperar, cuando retargeting, cuando prueba fria y
  cuando apagar.
- Como dar seguimiento a un lead: mensaje, WhatsApp/email, etapa, demo,
  propuesta, perdido/ganado.
- Como soporte revisa permisos, limites y errores.

Mejoras a realizar:

- Crear una guia corta de operacion semanal.
- Crear una guia corta de soporte: sintomas, causa probable y accion.
- Crear una guia de ventas: publico meta, dolores, demo script, objeciones y
  CTA.

Criterio de salida:

- Una persona de ventas puede usar el modulo para vender Renta Facil.
- Una persona de soporte puede diagnosticar lo comun sin escalar todo a dev.

Estado implementado:

- Se creo `docs/backoffice-mkt-operating-guide.md` como guia operativa para
  ventas, soporte y operacion interna de BetterP.
- La guia cubre rutina semanal: leer resultados, ajustar mensajes, generar y
  revisar cola, preparar publicacion/pauta y cerrar aprendizaje comercial.
- Incluye lectura de resultados por senal: views, clicks, leads, demos,
  propuestas, ganadas, perdidas, objeciones, costo y calidad del publico.
- Define decisiones de pauta: esperar, retargeting, prueba fria controlada,
  escalar cauteloso y pausar.
- Incluye seguimiento de leads, prioridad comercial, primer contacto, criterios
  para demo, guion de demo, objeciones frecuentes y CTA.
- Incluye guia rapida de soporte con sintomas, causa probable y accion, ligada
  al runbook de observabilidad cuando hay fallas tecnicas.

Validacion:

- La guia se cruzo contra `docs/backoffice-mkt-smoke-checklist.md`,
  `docs/backoffice-mkt-observability-runbook.md` y
  `docs/renta-facil-content-engine.md` para no duplicar responsabilidades.
- No se agrego codigo nuevo; el avance de 8.6 es documentacion operativa.

### Paso 8.7 - Checklist de go-live comercial

Objetivo: decidir si Backoffice MKT ya puede operar una semana real sin
intervencion constante.

Checklist:

- Landing `/soluciones/renta-facil` activa y con formulario funcionando.
- UTMs visibles en links generados.
- Meta conectado para Facebook/Instagram de BetterP.
- Cron de publicacion configurado.
- Cola semanal con 7 piezas revisadas.
- Creativos principales cargados y visibles.
- Primera pieza publicada o lista para publicar.
- Captura de metricas preparada.
- Mensajes de seguimiento listos para leads.
- Responsable interno definido para revisar resultados diarios.

Mejoras a realizar:

- Agregar una decision final de salida: `GO`, `GO CON RIESGO` o `NO GO`.
- Registrar responsable y fecha de revision semanal.
- Registrar pendientes que no bloquean salida.

Criterio de salida:

- La semana comercial puede correr con rutina diaria y cierre semanal.

Estado implementado:

- Se creo `docs/backoffice-mkt-go-live-checklist.md` como gate comercial final
  para decidir `GO`, `GO CON RIESGO` o `NO GO`.
- El checklist separa bloqueantes, minimos para `GO`, riesgos permitidos,
  riesgos no permitidos y evidencia minima.
- Cubre landing, formulario, CTA/UTM, Backoffice, permisos, Meta, cron, cola,
  editorial, creativos, primera salida, metricas, Learning Loop, leads, ventas,
  soporte y pauta.
- Incluye responsables de MKT, ventas y soporte, fecha de revision semanal,
  formato de aprobacion y rutina de la primera semana.
- El documento queda como cierre ejecutivo; el detalle funcional vive en el
  smoke, la operacion semanal en la guia operativa y los incidentes en el
  runbook de observabilidad.

Validacion:

- Se reviso contra `docs/backoffice-mkt-smoke-checklist.md`,
  `docs/backoffice-mkt-operating-guide.md` y
  `docs/backoffice-mkt-observability-runbook.md`.
- No se agrego codigo nuevo; el avance de 8.7 es documentacion de decision
  comercial.

### Paso 8.8 - Pendientes fuera del release

Objetivo: evitar que cosas valiosas se queden como deuda invisible o bloqueen el
cierre sin razon.

Se documenta fuera del release cuando:

- Es una mejora util, pero no impide vender Renta Facil esta semana.
- Depende de datos que aun no existen.
- Requiere nueva integracion o presupuesto.
- Cambia el alcance del producto.

Posibles pendientes:

- Playwright visual autenticado para Backoffice completo.
- Automatizacion mas profunda de Meta insights si el conector limita datos.
- CRM externo o integracion con HubSpot/Apollo/Clay.
- Google Ads Search controlado.
- Libreria de creativos por segmento.
- Dashboard ejecutivo de CAC, pipeline y revenue por UTM.

Criterio de salida:

- El release cierra con una lista clara de pendientes priorizados, no con una
  sensacion vaga de que falta algo.

Estado implementado:

- Se creo `docs/backoffice-mkt-post-release-pendings.md` como registro
  priorizado de pendientes fuera de la primera salida comercial.
- El registro separa pendientes operativos, QA, medicion, growth, analytics,
  integraciones, CRM, contenido y UX.
- Cada pendiente incluye prioridad, razon para quedar fuera, condicion de
  entrada y tipo de trabajo.
- Se mantiene Google Ads como incursion posterior con reglas de entrada:
  landing validada, conversion tracking, CTA, UTMs, seguimiento y primeros
  mensajes organicos probados.
- Se confirma que CRM externo, dashboard CAC/revenue, biblioteca creativa,
  Playwright autenticado y automatizacion profunda de Meta no bloquean la semana
  comercial si existe workaround manual o aun faltan datos reales.

Validacion:

- Se reviso contra el checklist de go-live, guia operativa, runbook de
  observabilidad y reglas editoriales.
- No se agrego codigo nuevo; el avance de 8.8 es cierre documental y
  priorizacion de alcance.

Decision:

- Fase 8 queda cerrada como release operativo/documental.
- Ejecutar la semana comercial real sigue dependiendo de correr
  `docs/backoffice-mkt-go-live-checklist.md` y decidir `GO`, `GO CON RIESGO` o
  `NO GO` con evidencia real.
- Los pendientes post-release no deben bloquear ventas de Renta Facil salvo que
  el checklist de go-live los convierta en bloqueante operativo.

No entra en Fase 8:

- Lanzar Google Ads.
- Abrir nuevas soluciones.
- Rehacer el diseno completo de Backoffice.
- Crear un CRM completo si el pipeline actual basta para esta incursion.
- Meter automatizaciones pagadas sin conversion tracking y leads calificados.

## Incursion posterior - Google Ads Search controlado

Google Ads no forma parte de la primera ruta. Se retomara solo cuando existan:

- landing validada;
- conversion tracking;
- CTA claro;
- UTMs;
- pipeline de seguimiento;
- primeros mensajes organicos probados.

Regla de entrada:

- Solo Search al inicio.
- Presupuesto diario limitado.
- Palabras de alta intencion.
- Lista de negativas.
- Pausa rapida si no genera leads calificados.
- No usar Performance Max hasta tener conversiones suficientes.

## Pendientes propuestos

Los pendientes de Backoffice MKT quedaron consolidados en
`docs/backoffice-mkt-post-release-pendings.md`.

Regla:

- No reabrir Fase 8 por una mejora que ya este en el registro post-release.
- Si un pendiente se vuelve bloqueante operativo, moverlo al checklist de
  go-live con responsable, impacto y fecha limite.

## Bitacora de avances

| Fecha | Fase | Se hizo | Evidencia | Decision | Siguiente |
| --- | --- | --- | --- | --- | --- |
| 2026-06-21 | 0 | Se creo la ruta trazable de Backoffice MKT y se dejo Google Ads como incursion posterior | `docs/backoffice-mkt-release-roadmap.md` | Afinar ruta antes de tocar codigo | Registrar estado actual de la pantalla viva de Backoffice MKT |
| 2026-06-21 | 0 | Se registro la pantalla viva, endpoints, modelos base, renders que no deben recibir mejoras y fronteras entre MKT, Solicitudes y Salud | `frontend/app/backoffice/marketing/page.tsx`, `frontend/components/business/BusinessAdminManager.tsx`, `backend/billing/api.py`, `backend/billing/models.py` | Fase 0 cerrada; pasar a oferta comercial y ruta de conversion | Iniciar Fase 1 con oferta, publico, CTA, landing y captura de leads |
| 2026-06-21 | 1 | Se definio oferta, publico inicial, dolores, CTA unico, landing destino y canal de captura para Renta Facil | `frontend/app/soluciones/renta-facil/page.tsx`, `frontend/components/marketing/ContactLeadForm.tsx`, `backend/billing/api.py` | Fase 1 queda avanzada; falta capturar UTMs estructuradas | Decidir si se implementa captura UTM antes de iniciar contenido diario |
| 2026-06-21 | 1 | Se implemento captura UTM en formulario, schema y metadata del prospecto, con test enfocado | `frontend/components/marketing/ContactLeadForm.tsx`, `backend/billing/api.py`, `backend/billing/tests.py` | Fase 1 cerrada | Iniciar Fase 2: calendario de 30 temas y primera tanda de publicaciones |
| 2026-06-21 | 2 | Se creo motor de contenido organico con calendario de 30 dias, primera tanda de 7 publicaciones, links UTM, prompt maestro y revision diaria | `docs/renta-facil-content-engine.md` | Fase 2 queda lista para programacion real en redes | Programar primera tanda en Meta Business Suite y publicar LinkedIn manualmente |
| 2026-06-21 | 5 | Se corrigio el callback OAuth de Meta Backoffice para aceptar el retorno publico de Meta sin bearer token, validado por state firmado | `backend/billing/api.py`, `backend/billing/tests.py` | El error `Unauthorized` del callback queda corregido; falta redeploy y nueva prueba real | Redeploy backend en Render y volver a conectar Meta desde Backoffice MKT |
| 2026-06-21 | 5 | Se agregaron variables explicitas `BACKOFFICE_META_*` y prioridad sobre variables legadas para que Backoffice use la app BetterP Marketing | `backend/core/settings.py`, `backend/billing/meta_social.py`, `backend/billing/tests.py` | Evita que Backoffice use `client_id=26264464683253318`; falta redeploy y configurar `BACKOFFICE_META_APP_ID=978837048092130` | Confirmar en el auth_url que `client_id=978837048092130` |
| 2026-06-21 | 5 | Se reforzo el fallback para que Backoffice prefiera `META_CLIENT_ID=978837048092130` sobre `META_APP_ID=26264464683253318` cuando no existan `BACKOFFICE_META_*` | `backend/billing/meta_social.py`, `backend/billing/tests.py` | Cubre la configuracion actual vista en Render; falta redeploy hotfix | Volver a generar `connect-url` y validar que el query use `client_id=978837048092130` |
| 2026-06-21 | 5 | Se autorizo la URI OAuth de Backoffice en Meta y se completo la conexion oficial desde BetterP | Capturas de Meta y Backoffice MKT; canales Facebook `Betterp` e Instagram `@betterp.01` activos | Configuracion Meta queda cerrada para Backoffice MKT; falta prueba controlada de publicacion | Crear/publicar una prueba controlada y validar resultado por canal antes de automatizar |
| 2026-06-21 | 5 | Se implemento motor editorial de Renta Facil con generacion de 7 campanas, creativos PNG, UTMs, endpoint interno y cron de publicacion programada | `backend/billing/marketing_automation.py`, `backend/billing/management/commands/publish_marketing_campaigns.py`, `frontend/components/business/BusinessAdminManager.tsx`, `docs/render-cron-jobs.md` | La automatizacion ya puede llenar cola y publicar vencidas; falta generar la cola en produccion y monitorear primera tanda real | Deploy, crear cron `betterp-backoffice-mkt-publish`, generar cola desde Backoffice y revisar resultados diarios |
| 2026-06-21 | 6 | Se agrego Learning Loop MKT con score comercial, atribucion UTM, recomendacion de cadencia y analisis IA opcional | `backend/billing/marketing_automation.py`, `backend/billing/api.py`, `frontend/components/business/BusinessAdminManager.tsx`, `backend/billing/tests.py` | El sweet point se define por datos: 1 diario hasta tener muestra; 2 solo con clicks/leads/score suficientes | Activar medicion real, revisar score semanal y usar IA para reescribir cola |
| 2026-06-21 | 5/6 | Se afino el motor editorial con matriz por campaña: pilar, segmento, embudo, formato, objecion, oferta, hipotesis, variantes por canal y checklist visible en modal | `backend/billing/marketing_automation.py`, `frontend/components/business/BusinessAdminManager.tsx`, `docs/renta-facil-content-engine.md` | El motor ya no genera posts sueltos; cada pieza nace con intencion comercial y criterio de revision | Regenerar la cola vieja o crear nueva tanda para revisar las primeras 7 piezas con matriz editorial |
| 2026-06-21 | 5/6 | Se agrego plan de oferta y brief visual por campaña para decidir si una promocion ayuda o distrae y para que el creativo explique sin depender del caption | `backend/billing/marketing_automation.py`, `frontend/components/business/BusinessAdminManager.tsx`, `docs/renta-facil-content-engine.md` | Cada campaña trae `offer_plan` y `creative_brief`; el modal muestra ambos | Generar nueva tanda y revisar si la imagen comunica dinero, tiempo o control en menos de 3 segundos |
| 2026-06-21 | 5/6 | Se agrego tabla operativa de campanas con seleccion masiva, modal, aceptar/rechazar/modificar, borrado y regeneracion con comentarios; tambien se registraron ofertas base iterables | `backend/billing/api.py`, `backend/billing/marketing_automation.py`, `frontend/components/business/BusinessAdminManager.tsx`, `backend/billing/tests.py`, `docs/renta-facil-content-engine.md` | La cola ya puede depurarse antes de publicar y cada ciclo puede mejorar copy/ofertas segun datos | Usar el modal para limpiar cola vieja, regenerar piezas con feedback y aceptar solo las que deban salir |
| 2026-06-21 | 6 | Se agrego plan de siguiente experimento con 7 piezas sugeridas por aprendizaje: pilar, segmento, embudo, formato, oferta, CTA, hipotesis y senal esperada | `backend/billing/marketing_automation.py`, `frontend/components/business/BusinessAdminManager.tsx`, `backend/billing/tests.py` | El learning loop ya no solo reporta; propone la siguiente tanda accionable | Usar esa matriz como base de generacion, no como texto suelto |
| 2026-06-21 | 5/6 | Se conecto la generacion de cola con el plan de aprendizaje; cada variante queda con UTM propio, `learning_action`, `learning_experiment` y llave diaria anti-duplicados | `backend/billing/api.py`, `backend/billing/marketing_automation.py`, `frontend/components/business/BusinessAdminManager.tsx`, `backend/billing/tests.py` | El boton `Generar 7 dias` puede crear cola desde aprendizaje cuando existe matriz sugerida | Revisar en produccion que las piezas nuevas salgan como variantes medibles |
| 2026-06-21 | 4/6 | Se hizo visible en tabla y modal el origen de cada campana: manual, cola base o aprendizaje; tambien accion, UTM, racional, hipotesis y senal esperada | `frontend/components/business/BusinessAdminManager.tsx` | La revision editorial puede distinguir piezas base contra piezas aprendidas sin abrir metadata cruda | Agregar filtros rapidos para operar por lote |
| 2026-06-21 | 4 | Se agregaron filtros rapidos por origen, accion de aprendizaje y estado; la seleccion masiva respeta el filtro activo | `frontend/components/business/BusinessAdminManager.tsx` | La cola se puede depurar por lote: aprendizaje, rechazadas, programadas o piezas por reescribir | Pasar a pendientes de pipeline comercial, datos reales y cierre |
| 2026-06-21 | 3 | Se agrego pipeline comercial compacto en Backoffice MKT con prospectos, etapas, origenes, UTMs, demos, ganados y rutina diaria; la operacion detallada sigue en Solicitudes | `backend/billing/api.py`, `backend/billing/services.py`, `frontend/components/business/BusinessAdminManager.tsx`, `backend/billing/tests.py` | Fase 3 queda cerrada sin duplicar Solicitudes | Pasar a Fase 4: cerrar renders legacy y revision visual post-deploy |
| 2026-06-21 | 4 | Se eliminaron renders legacy de Marketing y Solicitudes; solo quedan `renderMarketingControlCenter()` y `renderSolicitudesWorkbench()` como pantallas vivas | `frontend/components/business/BusinessAdminManager.tsx`, `docs/backoffice-mkt-release-roadmap.md` | Fase 4 queda limpia a nivel codigo y sin rutas duplicadas | Desplegar y hacer revision visual final en produccion |
| 2026-06-21 | 4 | Se redujo peso visual de MKT separando Campanas y Conexiones en pestanas; la tabla de campanas cambia acciones de texto por iconos con tooltip accesible | `frontend/components/business/BusinessAdminManager.tsx`, `docs/backoffice-mkt-release-roadmap.md` | La pantalla principal prioriza revision editorial y deja conexion Meta/canales como vista secundaria | Verificar visualmente en sesion autenticada post-deploy |
| 2026-06-21 | 4 | Se amplio el ancho operativo de MKT y se fijo la columna de acciones de la tabla de campanas para evitar desplazamiento horizontal en desktop | `frontend/components/business/BusinessAdminManager.tsx`, `docs/backoffice-mkt-release-roadmap.md` | Las acciones de revisar, aceptar, rechazar y borrar quedan visibles al operar la cola | Confirmar visualmente en produccion despues del deploy |
| 2026-06-21 | 6 | Se agrego registro de objeciones frecuentes al Learning Loop MKT desde notas/mensajes de prospectos y se conecto con recomendaciones, prompt y siguiente tanda sugerida | `backend/billing/marketing_automation.py`, `frontend/components/business/BusinessAdminManager.tsx`, `backend/billing/tests.py`, `docs/backoffice-mkt-release-roadmap.md` | El aprendizaje ya puede responder fricciones comerciales como precio, tiempo, confianza, migracion, canales, equipo y encaje operativo | Alimentar objeciones reales desde demos/seguimiento y revisar si cambian hooks, creativos y CTA |
| 2026-06-21 | 5/6 | Se reforzo el brief visual de campanas con prompt IA detallado para imagen, narrativa comercial, identidad BetterP e instruccion de logo adjunto | `backend/billing/marketing_automation.py`, `frontend/components/business/BusinessAdminManager.tsx`, `backend/billing/tests.py`, `docs/renta-facil-content-engine.md` | El creativo deja de ser accesorio y pasa a cargar la historia principal de venta | Generar nueva tanda y revisar si cada prompt visual explica el dolor sin depender del caption |
| 2026-06-21 | 5/6 | Se afino el prompt visual en ingles para evitar mini casos/texto pesado y contar la historia de vacancia, publicacion automatizada y solicitudes entrantes; el boton de prompt agrega icono de copiar | `backend/billing/marketing_automation.py`, `frontend/components/business/BusinessAdminManager.tsx`, `backend/billing/tests.py`, `docs/renta-facil-content-engine.md` | Las imagenes deben ser menos explicativas y mas publicables; el texto se puede sobreponer despues si hace falta | Regenerar la primera imagen con el nuevo prompt y comparar contra la version anterior |
| 2026-06-21 | 5/6 | Se agrego estrategia visual por campana: infografia compacta, storytelling o hibrido segun formato editorial | `backend/billing/marketing_automation.py`, `frontend/components/business/BusinessAdminManager.tsx`, `backend/billing/tests.py`, `docs/renta-facil-content-engine.md` | No se descartan infografias; se evita que se conviertan en texto pesado y se mide que modo vende mejor | Generar variantes por modo visual y comparar clicks, guardados, leads y objeciones |
| 2026-06-21 | 5/6 | Se corrigio el prompt visual despues de validar que la primera imagen salio saturada y poco clara; ahora fuerza anuncio simple de 3 segundos, problema -> accion BetterP -> resultado | `backend/billing/marketing_automation.py`, `frontend/components/business/BusinessAdminManager.tsx`, `backend/billing/tests.py`, `docs/renta-facil-content-engine.md` | El creativo debe explicar una sola idea sin dashboard gigante, exceso de iconos ni conectores decorativos | Copiar el prompt actualizado desde el modal y generar una nueva version visual mas literal |
| 2026-06-21 | 5/6 | Se corrigio el copy generado para evitar redundancia: gancho de dolor, puente operativo, solucion concreta y oferta solo si ayuda | `backend/billing/marketing_automation.py`, `backend/billing/tests.py`, `docs/renta-facil-content-engine.md` | El texto ya no explica al cliente lo que significa tener un espacio vacio; prepara la transicion hacia Renta Facil con lenguaje comun | Regenerar la semana y revisar que cada pieza venda una idea clara sin tecnicismos ni repeticion |
| 2026-06-21 | 5/6 | Se ajusto el copy y prompt visual hacia publicar, promover y agilizar renta; oferta y CTA quedan mas directos | `backend/billing/marketing_automation.py`, `frontend/components/business/BusinessAdminManager.tsx`, `backend/billing/tests.py`, `docs/renta-facil-content-engine.md` | La campana se acerca al mensaje comercial aprobado: prueba 7 dias, devolucion y automatizacion del negocio | Regenerar la pieza y comparar si imagen + texto transmiten renta mas rapida sin saturacion |
| 2026-06-21 | 5/6 | Se afino el prompt visual de vacancia con base en las mejores imagenes generadas: anuncio blanco editorial, triptico y ruta espacio vacio -> BetterP -> interesados | `backend/billing/marketing_automation.py`, `frontend/components/business/BusinessAdminManager.tsx`, `backend/billing/tests.py`, `docs/renta-facil-content-engine.md` | El triptico queda como preset para esta pieza, sin eliminar infografias, checklist o antes/despues para otros formatos | Generar una nueva imagen desde el modal y comparar contra `inicial.png` y las dos versiones refinadas |
| 2026-06-21 | 5/6 | Se cambio la vista previa del modal a simulacion clara de publicacion por canal: Facebook, Instagram y LinkedIn | `frontend/components/business/BusinessAdminManager.tsx` | La decision editorial ahora puede revisar imagen + copy en una tarjeta blanca similar al feed real | Subir el creativo final y validar la combinacion en cada canal antes de aceptar |
| 2026-06-21 | 5/6 | Se corrigio la preview de creativos cargados: R2 firma URLs con s3v4 y el modal prioriza el ultimo activo subido | `backend/core/settings.py`, `frontend/components/business/BusinessAdminManager.tsx` | Evita que el navegador reciba una respuesta bloqueada de R2 y que la preview siga mostrando el creativo anterior | Probar una nueva carga en Render despues del deploy y confirmar que la imagen aparece en Facebook/Instagram preview |
| 2026-06-21 | 5/6 | Se ajustaron prompts visuales para no defaultar a blanco plano: piezas operativas usan infografia antes/despues con redes, Excel, pagos, facturas y BetterP integrado | `backend/billing/marketing_automation.py`, `frontend/components/business/BusinessAdminManager.tsx`, `docs/renta-facil-content-engine.md`, `backend/billing/tests.py` | La imagen debe explicar una idea con mas personalidad visual, como "Menos trabajo manual. Mas control", sin saturar ni llenar de texto | Generar de nuevo la segunda publicacion y comparar contra `prompt.png` y `pulida.png` |
| 2026-06-21 | 5/6 | Se agrego galeria CRUD de creativos en el modal: miniaturas visibles, seleccionar, borrar y mover orden para definir creativo principal | `backend/billing/api.py`, `frontend/components/business/BusinessAdminManager.tsx`, `backend/billing/tests.py` | El primer creativo ordenado alimenta la preview/publicacion y se puede ajustar sin salir del detalle editorial | Subir varias imagenes, mover la version final a primer lugar y borrar variantes descartadas |
| 2026-06-21 | 5/6 | Se sustituyeron piezas redundantes por tres angulos editoriales: autoservicio del cliente, cobranza automatizada por WhatsApp y rentabilidad por unidad de negocio | `backend/billing/marketing_automation.py`, `frontend/components/business/BusinessAdminManager.tsx`, `backend/billing/tests.py`, `docs/renta-facil-content-engine.md` | La cola deja de repetir el mismo dolor y ahora puede mostrar valor operativo distinto por publicacion | Borrar o rechazar las piezas redundantes en produccion, regenerar nueva tanda y revisar copy + prompt visual antes de aceptar |
| 2026-06-21 | 5/6 | Se corrigio el angulo de rentabilidad por unidad para dejar de hablar de mezclar unidades y enfocarse en herramientas de control, tiempo, recursos y ganancias por unidad | `backend/billing/marketing_automation.py`, `frontend/components/business/BusinessAdminManager.tsx`, `backend/billing/tests.py`, `docs/renta-facil-content-engine.md` | El copy queda mas directo y menos ambiguo: control por unidad, balance y donde realmente hay ganancias | Regenerar la pieza de rentabilidad y comparar si el caption ya transmite la idea sin vueltas |
| 2026-06-21 | 5/6 | Se corrigio el angulo de cobranza automatizada para conectar operacion creciente, pagos vencidos, cartera vencida y flujo de efectivo | `backend/billing/marketing_automation.py`, `frontend/components/business/BusinessAdminManager.tsx`, `backend/billing/tests.py`, `docs/renta-facil-content-engine.md` | El copy deja de repetir "recordar pagos" y aterriza el dolor financiero antes de presentar WhatsApp automatizado | Regenerar la pieza de cobranza y validar que el caption mantenga cartera vencida + flujo + automatizacion |
| 2026-06-21 | 5/6 | Se corrigio el angulo de autoservicio para partir de atencion al cliente, mensajes/correos repetidos y portal todo a un click | `backend/billing/marketing_automation.py`, `frontend/components/business/BusinessAdminManager.tsx`, `backend/billing/tests.py`, `docs/renta-facil-content-engine.md` | El copy deja de hablar genericamente de documentos basicos y vende ahorro de tiempo en administracion de espacios | Regenerar la pieza de autoservicio y validar que el caption se sienta mas humano y directo |
| 2026-06-21 | 5/6 | Se agrego refresco automatico de campanas base con copy obsoleto del motor anterior, sin duplicar piezas ni tocar historico publicado | `backend/billing/marketing_automation.py`, `backend/billing/api.py`, `backend/billing/tests.py`, `docs/renta-facil-content-engine.md` | Si una campana vieja aun muestra "recordar pagos a mano", al volver a generar la cola se actualiza en sitio con el criterio nuevo | Deploy y presionar `Generar 7 dias`; confirmar que el resultado reporte `actualizadas` y que cobranza muestre cartera vencida + flujo + automatizacion |
| 2026-06-21 | 5/6 | Se bloqueo duplicacion de temas activos al generar cola desde aprendizaje; una misma campana no se repite por cambiar de `explorar` a `reforzar` | `backend/billing/marketing_automation.py`, `backend/billing/tests.py`, `docs/renta-facil-content-engine.md` | La tanda semanal mantiene variedad editorial y evita duplicados como autoservicio/cobranza en la tabla | Borrar manualmente duplicados ya creados y regenerar; las siguientes tandas deben omitir `tema-activo` |
| 2026-06-21 | 5/6 | Se cambio `Generar 7 dias` para completar la cola activa hasta 7 temas unicos, creando solo los huecos faltantes | `backend/billing/marketing_automation.py`, `backend/billing/api.py`, `backend/billing/tests.py`, `docs/renta-facil-content-engine.md` | Si quedan 5 piezas aprobadas/programadas y se borran 2 duplicadas, el motor crea 2 nuevas sin tocar las 5 existentes | Deploy, borrar duplicados actuales y volver a generar para confirmar `Cola activa: 7/7` |
| 2026-06-21 | 5/6 | Se afino el conteo de cola activa: solo `PROGRAMADA` y `EN_COLA` bloquean huecos; borradores viejos ya no impiden completar 7 publicaciones | `backend/billing/marketing_automation.py`, `backend/billing/tests.py`, `docs/renta-facil-content-engine.md` | El caso de 5 piezas aprobadas y borradores ocultos ahora debe crear las 2 faltantes | Deploy y confirmar que el mensaje pase de 5/7 a 7/7 al generar |
| 2026-06-28 | 6 | Se agrego semaforo de pauta pagada al Learning Loop MKT con decision de esperar, corregir conversion, retargeting pequeno, prueba controlada o escala cautelosa | `backend/billing/marketing_automation.py`, `frontend/components/business/BusinessAdminManager.tsx`, `backend/billing/tests.py` | Backoffice MKT ya puede indicar presupuesto, audiencias utiles, exclusiones y reglas de pausa antes de gastar | Validar en sesion autenticada que el bloque de pauta aparece con datos reales y ajustar umbrales tras la primera semana |
| 2026-06-28 | 6 | Se pivoto la segunda tanda editorial para abrir con cobranza automatizada dirigida a administradores de condominios, inmuebles y espacios en renta | `backend/billing/marketing_automation.py`, `backend/billing/tests.py`, `docs/renta-facil-content-engine.md`, `docs/backoffice-mkt-release-roadmap.md` | El copy y prompt visual ahora explican para quien es Renta Facil, que automatiza cuentas vencidas/rentas pendientes/pagos no registrados y usa "hasta 80%" solo como menos seguimiento manual repetitivo | Regenerar la semana, revisar el primer creativo de cobranza y comparar leads/clics contra la primera ronda |
| 2026-06-28 | 6 | Se hizo exportable el prompt de siguiente semana desde el Learning Loop, con vista previa, copiar y descarga `.txt` | `frontend/components/business/BusinessAdminManager.tsx`, `docs/renta-facil-content-engine.md`, `docs/backoffice-mkt-release-roadmap.md` | La iteracion semanal ya puede salir del backoffice como prompt operativo para regenerar piezas o revisar direccion editorial | Usar el prompt junto con `Generar 7 dias con aprendizaje` y comparar la nueva tanda contra la anterior |
| 2026-06-29 | 6 | Se activo generacion IA por pieza para la cola semanal, con modelo configurable `OPENAI_MARKETING_CONTENT_MODEL` default `gpt-5.5` y fallback local | `backend/core/settings.py`, `backend/billing/marketing_automation.py`, `backend/billing/api.py`, `backend/billing/tests.py`, `frontend/components/business/BusinessAdminManager.tsx`, `docs/renta-facil-content-engine.md` | Cada dia se genera con una solicitud individual; las campanas publicadas quedan como historico y no bloquean la nueva tanda | Generar 7 dias con aprendizaje y revisar en el mensaje cuantas piezas salieron por IA vs fallback |
| 2026-06-28 | 3/6 | Se agrego mensaje de seguimiento copiable por prospecto, personalizado con calificacion, publico, volumen, forma de cobranza, dolor y urgencia | `frontend/components/business/BusinessAdminManager.tsx`, `docs/backoffice-mkt-release-roadmap.md` | El equipo puede convertir leads en conversaciones sin redactar desde cero y mantiene foco en demo de Renta Facil | Probar mensajes reales desde Solicitudes/WhatsApp y registrar objeciones para alimentar el siguiente aprendizaje |
| 2026-06-28 | 3/6 | Se agregaron acciones directas de seguimiento por prospecto: abrir WhatsApp o email con el mensaje comercial precargado | `frontend/components/business/BusinessAdminManager.tsx`, `docs/backoffice-mkt-release-roadmap.md` | Reduce friccion entre lead capturado y primer contacto; marketing puede iniciar conversacion sin copiar/pegar manualmente | Usar los enlaces en leads calificados y mover etapa en Solicitudes despues del contacto |
| 2026-06-28 | 3/6 | Se agrego accion rapida para marcar prospectos `NUEVO` como `CONTACTADO` desde el embudo MKT, anexando nota de contacto sin borrar historial | `frontend/components/business/BusinessAdminManager.tsx`, `docs/backoffice-mkt-release-roadmap.md` | El primer contacto queda registrado en el pipeline sin salir de Marketing y Solicitudes conserva la operacion detallada | Medir si los leads calificados pasan a demo mas rapido despues del primer contacto |
| 2026-06-28 | 3/6 | Se agrego accion rapida para mover prospectos `CONTACTADO` a `DEMO`, con nota enfocada en dolor, tipo de operacion y volumen | `frontend/components/business/BusinessAdminManager.tsx`, `docs/backoffice-mkt-release-roadmap.md` | Backoffice MKT ya puede reflejar demos agendadas sin salir del embudo y alimentar el score comercial | Revisar semanalmente demos por UTM y repetir los mensajes que convierten |
| 2026-06-28 | 3/6 | Se agrego accion rapida para mover prospectos `DEMO` a `PROPUESTA`, anexando nota de oferta enfocada en dolor, operacion y urgencia | `frontend/components/business/BusinessAdminManager.tsx`, `docs/backoffice-mkt-release-roadmap.md` | Marketing puede registrar avance comercial despues de demo y el score aprende que mensajes generan propuesta | Revisar propuestas por UTM antes de decidir inversion pagada |
| 2026-06-28 | 3/6 | Se agrego cierre de propuesta desde Marketing: preparar alta de cliente con el flujo SaaS existente o marcar oportunidad como perdida con nota | `frontend/components/business/BusinessAdminManager.tsx`, `docs/backoffice-mkt-release-roadmap.md` | Evita marcar ventas falsas: `GANADO` se produce al crear la suscripcion, mientras `PERDIDO` alimenta aprendizaje y calidad de pauta | Usar cierre ganado/perdido para calcular mensajes que llegan a venta real antes de escalar presupuesto |
| 2026-06-28 | 3/6 | Se agrego atribucion de conversion por UTM y pieza dentro del Learning Loop: leads, propuestas, ganadas, perdidas, tasa de cierre y costo por venta | `backend/billing/marketing_automation.py`, `backend/billing/tests.py`, `frontend/components/business/BusinessAdminManager.tsx`, `docs/backoffice-mkt-release-roadmap.md` | El modulo ya puede distinguir publicaciones que solo generan curiosidad de las que avanzan a venta real | Invertir solo en UTMs con demo/propuesta/ganada y pausar piezas con perdidas repetidas o leads fuera de perfil |
| 2026-06-28 | 3/6 | Se hizo obligatoria la objecion al marcar una propuesta como `PERDIDO` desde Marketing y se guarda en metadata comercial | `backend/billing/api.py`, `backend/billing/services.py`, `backend/billing/marketing_automation.py`, `backend/billing/tests.py`, `frontend/components/business/BusinessAdminManager.tsx`, `docs/backoffice-mkt-release-roadmap.md` | El aprendizaje ahora sabe por que se perdio una oportunidad: precio, tiempo, confianza, migracion, encaje u otra friccion real | Usar estas objeciones para reescribir hooks, creativos y filtros antes de invertir mas presupuesto |
| 2026-06-28 | 3/6 | Se agrego plan anti-objeciones al Learning Loop: accion editorial, hook, creativo, follow-up y regla de pauta por cada objecion frecuente | `backend/billing/marketing_automation.py`, `backend/billing/tests.py`, `frontend/components/business/BusinessAdminManager.tsx`, `docs/backoffice-mkt-release-roadmap.md` | Las perdidas ya se convierten en instrucciones concretas para la siguiente tanda y el prompt exportable incluye `acciones_objeciones` | Responder primero la objecion dominante antes de escalar presupuesto frio |
| 2026-06-28 | 3/6 | Se conecto el plan anti-objeciones con `Generar 7 dias con aprendizaje`: la objecion dominante crea piezas `responder_objecion` con UTM, hook, formato y brief visual especifico | `backend/billing/marketing_automation.py`, `backend/billing/tests.py`, `docs/backoffice-mkt-release-roadmap.md` | La siguiente tanda ya puede crear comparativos de precio, adopcion, migracion o encaje en vez de repetir publicaciones generales | Generar la semana con oportunidades perdidas reales y revisar que la primera pieza responda la objecion dominante antes de meter pauta |
| 2026-06-28 | 6 | Se documento el roadmap operativo para aprovechar la semana publicada: resultados semanales, captura de metricas, comparador, decision de contenido, pauta controlada y rutina semanal | `docs/backoffice-mkt-release-roadmap.md` | La ruta queda persistida en el repo y no solo en memoria del chat | Implementar primero la vista `Resultados de esta semana` dentro de Backoffice MKT |
| 2026-06-28 | 6.1 | Se implemento la vista `Resultados de esta semana` en el Learning Loop: rango, publicadas/pendientes, mejor pieza, pieza debil, mejor canal, leads, objecion dominante y decision | `backend/billing/marketing_automation.py`, `frontend/components/business/BusinessAdminManager.tsx`, `backend/billing/tests.py`, `docs/backoffice-mkt-release-roadmap.md` | Backoffice MKT ya puede leer la semana publicada en menos de 2 minutos y decidir si repetir, reescribir, responder objecion o capturar metricas | Siguiente paso: captura rapida/importacion de metricas reales desde la tabla semanal |
| 2026-06-28 | 6.2 | Se agrego captura rapida de metricas dentro de `Resultados de esta semana`, con inputs por destino para impresiones, clicks, leads, engagement, gasto y nota sin abrir cada campana | `frontend/components/business/BusinessAdminManager.tsx`, `backend/billing/marketing_automation.py`, `backend/billing/tests.py`, `docs/backoffice-mkt-release-roadmap.md` | Las metricas reales de Meta pueden alimentar el learning loop desde la vista semanal y recalcular mejor pieza/canal tras guardar | Siguiente paso: estructurar fecha de corte e importacion automatica desde Meta cuando el conector entregue insights |
| 2026-06-28 | 6.2 | Se estructuro la captura de metricas con periodo de medicion y tipo de trafico `organic`, `paid` o `mixed`; el resumen semanal ya separa organico vs pagado y omite cortes fuera de semana | `backend/billing/api.py`, `backend/billing/marketing_automation.py`, `frontend/components/business/BusinessAdminManager.tsx`, `backend/billing/tests.py`, `docs/backoffice-mkt-release-roadmap.md` | La semana publicada ya no mezcla cortes viejos ni confunde resultados organicos con pauta | Siguiente paso: explorar importacion automatica de insights desde Meta para llenar estas metricas sin captura manual |
| 2026-06-28 | 6.2 | Se agrego importacion de insights desde Meta por destino publicado: endpoint `meta-sync`, boton `Meta` en captura semanal/modal y guardado como fuente `meta_insights` | `backend/billing/meta_social.py`, `backend/billing/api.py`, `frontend/components/business/BusinessAdminManager.tsx`, `backend/billing/tests.py`, `docs/backoffice-mkt-release-roadmap.md` | Las publicaciones oficiales de Facebook/Instagram ya pueden traer views, clicks y engagement sin captura manual, preservando leads/gasto capturados | Siguiente paso: construir comparador de publicaciones por UTM para decidir que reforzar, reescribir o pausar |
| 2026-06-28 | 6.3 | Se agrego comparador de publicaciones por UTM con alcance, clicks, leads, pipeline comercial, calidad del publico, objeciones y decision por pieza | `backend/billing/marketing_automation.py`, `frontend/components/business/BusinessAdminManager.tsx`, `backend/billing/tests.py`, `docs/backoffice-mkt-release-roadmap.md` | El modulo ya distingue publicaciones que generan avance comercial de piezas que solo generan curiosidad o leads fuera de perfil | Siguiente paso: usar el comparador para priorizar pieza ganadora, reescribir pieza debil y crear variante anti-objecion en la siguiente semana |
| 2026-06-28 | 6.4 | Se agrego `content_decision` al Learning Loop y la siguiente tanda ahora combina variante controlada de ganadora, reescritura de debil, pieza anti-objecion y exploracion | `backend/billing/marketing_automation.py`, `frontend/components/business/BusinessAdminManager.tsx`, `backend/billing/tests.py`, `docs/backoffice-mkt-release-roadmap.md` | La generacion semanal ya explica por que existe cada pieza y evita repetir contenido sin una razon comercial | Siguiente paso: cerrar checklist previo a pauta antes de invertir presupuesto real |
| 2026-06-28 | 6.5 | Se agrego checklist previo de pauta al semaforo pagado: UTM, landing, formulario, calificacion, pieza aprobada, objetivo comercial y reglas de apagado | `backend/billing/marketing_automation.py`, `frontend/components/business/BusinessAdminManager.tsx`, `backend/billing/tests.py`, `docs/backoffice-mkt-release-roadmap.md` | El brief de Meta ya no queda listo si falta lead calificado o trazabilidad antes de invertir | Siguiente paso: exportar brief de audiencia con publico util, exclusiones, presupuesto sugerido y regla de apagado |
| 2026-06-28 | 6.5 | Se agrego brief de audiencia exportable para Meta con publico util, exclusiones, presupuesto sugerido, regla de apagado, regla de escala y ad sets | `backend/billing/marketing_automation.py`, `frontend/components/business/BusinessAdminManager.tsx`, `backend/billing/tests.py`, `docs/backoffice-mkt-release-roadmap.md` | La recomendacion de pauta ya se puede copiar o descargar sin perder los filtros que evitan gastar en publico fuera de perfil | Siguiente paso: separar prueba fria de retargeting para no mezclar aprendizajes |
| 2026-06-28 | 6.5 | Se separaron los carriles de audiencia pagada: retargeting tibio y prueba fria controlada, cada uno con presupuesto, exclusiones, metrica y regla de apagado propias | `backend/billing/marketing_automation.py`, `frontend/components/business/BusinessAdminManager.tsx`, `backend/billing/tests.py`, `docs/backoffice-mkt-release-roadmap.md` | El modulo puede activar solo retargeting cuando la muestra es chica y habilitar frio separado solo con senal suficiente | Siguiente paso: pausar automaticamente la recomendacion si no hay leads calificados o si la objecion dominante no fue respondida |
| 2026-06-28 | 6.5 | Se agrego pausa automatica de pauta cuando falta lead calificado o cuando la objecion dominante no tiene pieza `responder_objecion` | `backend/billing/marketing_automation.py`, `frontend/components/business/BusinessAdminManager.tsx`, `backend/billing/tests.py`, `docs/backoffice-mkt-release-roadmap.md` | La pauta queda con presupuesto cero y conserva la recomendacion original como contexto hasta resolver calidad u objecion | Siguiente paso: iniciar Paso 6.6 con rutina semanal de decision |
| 2026-06-28 | 6.6 | Se agrego rutina semanal de decision al Learning Loop con pasos lunes-viernes y salida obligatoria exportable | `backend/billing/marketing_automation.py`, `frontend/components/business/BusinessAdminManager.tsx`, `backend/billing/tests.py`, `docs/backoffice-mkt-release-roadmap.md` | El modulo convierte resultados, pauta, objeciones y siguiente tanda en una cadencia operativa semanal | Siguiente paso: usar la rutina en produccion durante una semana y pasar a Fase 7 de planes/permisos/limites |
| 2026-06-28 | 7 | Se desarrollo la especificacion funcional de Fase 7 con separacion Backoffice MKT vs Marketing cliente, matriz de planes, capacidades, limites, guardas backend/frontend, overrides y pruebas | `docs/backoffice-mkt-release-roadmap.md` | La fase queda lista para implementarse por pasos sin mezclar datos internos, permisos de cliente ni volumen comercial | Siguiente paso: iniciar 7.1 con inventario de superficies MKT y matriz de permisos por ruta, endpoint y accion |
| 2026-06-28 | 7.1 | Se completo el inventario de superficies MKT: pantallas internas, marketing cliente, landings publicas, endpoints internos, endpoints tenant y captura publica | `docs/backoffice-mkt-release-roadmap.md` | Ya se sabe que acciones son `INTERNAL_ONLY`, `PLAN_MODULE`, `PLAN_FEATURE`, `USAGE_LIMIT` o `PUBLIC_SAFE`, y que datos toca cada una | Siguiente paso: iniciar 7.2 formalizando el contrato unico de capacidades en backend/frontend |
| 2026-06-28 | 7.2 | Se formalizo el contrato de capacidades MKT en backend/frontend: automatizacion, learning loop, Meta insights, brief de pauta y etiquetas de canales | `backend/billing/services.py`, `frontend/lib/plan-access.ts`, `backend/billing/tests.py`, `docs/backoffice-mkt-release-roadmap.md` | El admin de planes ya expone claves reales para vender y bloquear funciones avanzadas sin usar capabilities fantasma | Siguiente paso: iniciar 7.3 con guardas backend para aplicar estas capabilities en acciones sensibles |
| 2026-06-28 | 7.3 | Se reforzaron guardas backend de Marketing cliente: bloqueo auditado por canal, mensaje personalizado de plan, revalidacion OAuth y proteccion interna de Backoffice MKT | `backend/accounts/security.py`, `backend/marketing_social/api.py`, `backend/marketing_social/tests.py`, `docs/backoffice-mkt-release-roadmap.md` | Los canales fuera de plan ya generan `PLAN_FUNCION_DENEGADA` y no pueden guardar conexion aunque el plan cambie durante OAuth | Siguiente paso: iniciar 7.4 con guardas frontend y mensajes de upgrade alineados a estas capabilities |
| 2026-06-28 | 7.4 | Se agregaron guardas frontend en Marketing cliente con avisos de upgrade, botones read-only por `social_publishing` y canales, y bloqueo preventivo antes de conectar, publicar o borrar | `frontend/components/marketing/MarketingWorkspace.tsx`, `docs/backoffice-mkt-release-roadmap.md` | El cliente ve que puede preparar comunicados, que funcion/canal le falta y el frontend deja de llamar endpoints sensibles cuando el plan ya no lo permite | Siguiente paso: iniciar 7.5 con limites de volumen y consumo mensual |
| 2026-06-28 | 7.5 | Se agregaron limites mensuales de Marketing cliente con uso actual, overrides por suscripcion, bloqueo auditado y panel frontend de usado/incluido/restante | `backend/marketing_social/api.py`, `backend/marketing_social/tests.py`, `frontend/components/marketing/MarketingWorkspace.tsx`, `docs/backoffice-mkt-release-roadmap.md` | El volumen ya es vendible: multimedia, publicaciones preparadas y publicaciones remotas se bloquean antes de consumir plan; IA, Meta sync y exports quedan definidos para endpoints futuros | Siguiente paso: iniciar 7.6 con overrides, soporte y cuentas administradas |
| 2026-06-28 | 7.6 | Se formalizo MKT administrado por BetterP sobre la suscripcion, con alcance, responsable, nota, auditoria comercial y visibilidad en admin de clientes | `backend/billing/api.py`, `backend/billing/services.py`, `backend/billing/tests.py`, `frontend/components/business/BusinessAdminManager.tsx`, `docs/backoffice-mkt-release-roadmap.md` | Los overrides quedan con nota y auditoria; las cuentas administradas muestran alcance/responsable sin mover el plan base ni mezclarlo con limites cliente | Siguiente paso: iniciar 7.7 con pruebas, smoke y cierre de release |
| 2026-06-29 | 7.7 | Se cerro la fase de planes/permisos con prueba de modulo marketing faltante, suite de gates, smoke frontend y matriz final para ventas/soporte | `backend/marketing_social/tests.py`, `backend/billing/tests.py`, `frontend/components/marketing/MarketingWorkspace.tsx`, `frontend/lib/plan-access.ts`, `docs/backoffice-mkt-release-roadmap.md` | La fase queda con evidencia para permitido, bloqueado por modulo, bloqueado por funcion, bloqueado por limite, override permitido y cuenta administrada | Siguiente paso: iniciar Fase 8 con cierre de release Backoffice MKT y smoke visual post-deploy |
| 2026-06-29 | 8 | Se desarrollo la Fase 8 punto a punto: tests internos, smoke funcional, UX, permisos, logs, documentacion, go-live comercial y pendientes fuera del release | `docs/backoffice-mkt-release-roadmap.md` | Fase 8 queda como plan ejecutable de cierre; no se marca implementada hasta correr smoke real y evidencias post-deploy | Siguiente paso: iniciar 8.1 con tests backend de endpoints internos de Backoffice MKT |
| 2026-06-29 | 8.1 | Se agrego suite smoke backend para Backoffice MKT interno: dashboard, permisos platform_admin, acciones criticas y errores controlados | `backend/billing/tests.py`, `docs/backoffice-mkt-release-roadmap.md` | Los endpoints internos quedan cubiertos antes de deploy y se confirma que Backoffice MKT no depende del plan SaaS del cliente | Siguiente paso: iniciar 8.2 con smoke funcional de Backoffice MKT |
| 2026-06-29 | 8.2 | Se creo runbook de smoke funcional para Backoffice MKT con recorrido completo, evidencia minima, decision GO/GO CON RIESGO/NO GO y fallas comunes | `docs/backoffice-mkt-smoke-checklist.md`, `docs/backoffice-mkt-release-roadmap.md` | El smoke ya es repetible por operacion/ventas; la evidencia real se adjunta despues del deploy o sesion autenticada | Siguiente paso: iniciar 8.3 con revision visual de UX |
| 2026-06-29 | 8.3 | Se redujo la saturacion visual de `Aprendizaje IA` con acordeones nativos para rutina, resultados, anti-objeciones, comparador, conversiones, pauta, decision de contenido y proxima tanda | `frontend/components/business/BusinessAdminManager.tsx`, `docs/backoffice-mkt-release-roadmap.md` | La lectura principal queda enfocada en score, cadencia y resumen; el detalle operativo sigue disponible bajo demanda y frontend compila OK | Siguiente paso: iniciar 8.4 con revision de permisos y fronteras de datos |
| 2026-06-29 | 8.4 | Se cerro contrato de permisos y fronteras: Backoffice MKT interno, Marketing cliente por plan, landing publica, credenciales Meta separadas, prospectos comerciales y cron interno | `docs/backoffice-mkt-release-roadmap.md`, `backend/billing/api.py`, `backend/marketing_social/api.py`, `backend/billing/meta_social.py`, `backend/billing/management/commands/publish_marketing_campaigns.py` | La frontera queda explicable para soporte/dev: interno vende BetterP/Renta Facil; cliente opera su propio Marketing sujeto a plan y limites | Siguiente paso: iniciar 8.5 con logs, errores y observabilidad |
| 2026-06-29 | 8.5 | Se creo runbook de observabilidad Backoffice MKT para diagnosticar cron, Meta OAuth/publicacion/insights, R2, generacion, leads, inbox y decisiones GO/GO CON RIESGO/NO GO | `docs/backoffice-mkt-observability-runbook.md`, `docs/backoffice-mkt-release-roadmap.md`, `backend/billing/cron_monitor.py`, `backend/billing/marketing_automation.py`, `backend/billing/meta_social.py` | Operacion ya tiene mapa de evidencia para encontrar causa y siguiente accion sin leer codigo durante una semana comercial | Siguiente paso: iniciar 8.6 con documentacion operativa para ventas y soporte |
| 2026-06-29 | 8.6 | Se creo guia operativa para ventas/soporte con rutina semanal, lectura de resultados, decision de pauta, seguimiento de leads, guion de demo, objeciones y soporte rapido | `docs/backoffice-mkt-operating-guide.md`, `docs/backoffice-mkt-release-roadmap.md` | Ventas puede operar Renta Facil desde Backoffice MKT y soporte tiene sintomas/acciones comunes antes de escalar a dev | Siguiente paso: iniciar 8.7 con checklist de go-live comercial |
| 2026-06-29 | 8.7 | Se creo checklist de go-live comercial con bloqueantes, minimos para GO, riesgos permitidos, evidencia minima, responsables y rutina de primera semana | `docs/backoffice-mkt-go-live-checklist.md`, `docs/backoffice-mkt-release-roadmap.md` | El release ya tiene gate ejecutivo para decidir si la semana comercial puede iniciar completa, con riesgo controlado o debe pausarse | Siguiente paso: iniciar 8.8 con registro de pendientes fuera del release |
| 2026-06-29 | 8.8 | Se creo registro post-release con pendientes priorizados y criterios de entrada para QA visual, conversion tracking, Google Ads, CAC/revenue por UTM, Meta insights, CRM y biblioteca creativa | `docs/backoffice-mkt-post-release-pendings.md`, `docs/backoffice-mkt-release-roadmap.md` | Fase 8 queda cerrada como release operativo/documental; el go-live real se decide con checklist y evidencia, no por pendientes futuros | Siguiente paso: ejecutar checklist de go-live comercial o iniciar la incursion posterior que se decida |
| 2026-06-29 | 9.1 | Se agrego conector oficial LinkedIn para Backoffice MKT: OAuth, callback, canal provider `LINKEDIN`, publicacion desde la misma cola y UI de conexion | `backend/billing/linkedin_social.py`, `backend/billing/api.py`, `backend/billing/marketing_automation.py`, `frontend/components/business/BusinessAdminManager.tsx`, `docs/backoffice-mkt-observability-runbook.md` | La cola semanal puede publicar en LinkedIn junto con Facebook e Instagram cuando el token tenga `w_member_social`; paginas empresa quedan soportadas con `BACKOFFICE_LINKEDIN_ORGANIZATION_URNS` y `w_organization_social` cuando el scope este aprobado | Configurar secretos `BACKOFFICE_LINKEDIN_*` en Render y probar una publicacion controlada |
| 2026-06-29 | 9.2 | Se reforzo `Generar 7 dias` para evitar timeouts XHR/CORS aparentes: sin transaccion larga, timeout por solicitud IA, presupuesto total de tanda y captura frontend de errores de red | `backend/billing/api.py`, `backend/billing/marketing_automation.py`, `backend/core/settings.py`, `frontend/components/business/BusinessAdminManager.tsx`, `backend/billing/tests.py` | Si OpenAI tarda demasiado, la cola se completa con fallback local en vez de romper con 500; el usuario ve mensaje controlado si hay error de red | Probar nueva generacion en produccion y revisar `ai_openai_generations` vs `ai_fallback_generations` |
| 2026-06-29 | 9.3 | Se movio `Generar 7 dias con aprendizaje` al worker de `BackgroundJob` para que las 7 solicitudes GPT-5.5 no dependan del timeout HTTP del navegador/API | `backend/billing/api.py`, `backend/billing/background_jobs.py`, `backend/billing/marketing_automation.py`, `frontend/components/business/BusinessAdminManager.tsx`, `backend/billing/tests.py` | El boton responde rapido con `job_id`, la vista espera por polling y la generacion completa puede tardar sin provocar el falso error CORS/500 | Verificar worker activo en produccion y regenerar la tanda despues de borrar las piezas fallback |
| 2026-06-29 | 9.4 | Se agrego despachador interno por `job_id` para Backoffice MKT cuando no existe worker continuo en Render; el job se reclama y procesa en un hilo del backend despues de responder | `backend/billing/api.py`, `backend/billing/background_jobs.py`, `frontend/components/business/BusinessAdminManager.tsx`, `backend/billing/tests.py` | La generacion ya no queda `PENDING` si no hay `betterp-background-worker`; se mantiene la ruta ideal de worker dedicado para cargas futuras | Probar generacion real y despues decidir si se crea worker continuo pagado para todos los jobs diferidos |
| 2026-08-25 | 9.5 | LinkedIn cambio a politica exclusiva de pagina BetterP: descubrimiento de organizaciones administradas, desactivacion de perfiles personales y metricas organicas automaticas | `backend/billing/linkedin_social.py`, `backend/billing/api.py`, `backend/billing/tests.py`, `docs/backoffice-mkt-observability-runbook.md` | El codigo impide que una campana futura publique en el perfil personal; falta aprobar Community Management y reconectar la pagina BetterP en produccion | Completar autorizacion en LinkedIn Developers y ejecutar publicacion controlada de pagina |
| 2026-08-25 | 9.6 | Se agrego Bandeja social unificada para comentarios de Meta, YouTube y LinkedIn, con estados operativos y sincronizacion dentro del cron de metricas | `backend/billing/social_inbox.py`, `backend/billing/models.py`, `backend/billing/api.py`, `frontend/components/business/BusinessAdminManager.tsx` | La cobertura real queda visible por proveedor; TikTok y mensajes privados no se declaran disponibles sin producto/API aprobado | Aplicar migracion, desplegar en Vultr y validar comentarios reales por red |
