# Ruta controlada de cierre de BetterP Commerce y Backoffice

Fecha de corte: 2026-08-05  
Rama de autoridad: `main`  
Estado del documento: ruta completada con una excepción temporal de seguridad aceptada
Próximo corte único: ninguno; cualquier trabajo posterior debe iniciar desde el registro diferido

## 1. Objetivo

Cerrar la integración de BetterP Commerce con el backoffice de BetterP como una sola solución
comercial, operativa y auditable. Al terminar, los planes, permisos, clientes, cobro, salud,
automatizaciones y evidencia de salida a producción deben describir el mismo producto sin depender
de Vende Fácil como solución activa.

Esta ruta no busca ampliar el producto, modificar el motor de normalización ni abrir nuevos canales.
Busca cerrar correctamente lo que ya existe.

## 2. Estado base verificado

- BetterP Commerce es la oferta comercial vigente.
- Vende Fácil está retirado del runtime y se conserva solamente como identidad histórica.
- Existen cuatro planes activos de BetterP Commerce: Micro, Starter, Growth y Scale.
- Stripe LIVE tiene productos y precios configurados para los planes vigentes; el webhook firmado
  está disponible.
- Hay una cuenta activa de BetterP Commerce en plan Growth.
- El backoffice todavía conserva permisos, métricas, textos y expectativas operativas heredadas de
  Vende Fácil.
- La salud productiva no identifica todavía de forma confiable el commit y despliegue en Vultr.
- El manifiesto de cron contiene expectativas heredadas o sin evidencia vigente.
- La salida formal a producción de BetterP Commerce continúa pendiente de evidencia integral.

## 3. Reglas obligatorias de ejecución

1. Solo puede existir un corte activo a la vez.
2. No se inicia el siguiente corte hasta que el actual cumpla todos sus criterios de salida.
3. Cada corte tendrá un alcance, un commit y una evidencia de cierre propios. No se mezclarán cambios
   de cortes distintos.
4. Los hallazgos no críticos se anotan en el registro diferido y no interrumpen el corte activo.
5. Las pruebas locales y las consultas productivas de solo lectura pueden ejecutarse dentro del corte.
6. Commit, push y despliegue se solicitarán en una sola autorización agrupada por corte.
7. Cualquier cargo real, cambio de DNS, escritura en Stripe, modificación de datos productivos o
   activación de procesos externos requiere autorización exacta adicional si no estaba incluida en
   la autorización agrupada.
8. Ningún corte autoriza operaciones, publicaciones ni cambios de compuertas en Mercado Libre,
   Amazon o Walmart.
9. No se borrarán cuentas, suscripciones, facturas, eventos ni datos históricos de Vende Fácil.
10. No se avanzará por porcentajes visuales: cada cierre depende de evidencia verificable.

### Excepción crítica

Se detendrá el corte y se solicitará confirmación únicamente si aparece alguno de estos casos:

- riesgo de pérdida o corrupción de datos;
- exposición de secretos o datos personales;
- cobro no autorizado o discrepancia material de facturación;
- falla de autenticación, aislamiento entre cuentas o autorización de permisos;
- escritura no prevista en un proveedor externo;
- caída productiva o degradación severa causada por el cambio;
- cola, scheduler o worker procesando operaciones que debían permanecer apagadas.

Una mejora, deuda técnica, texto antiguo, métrica imperfecta o caso de producto individual no es una
excepción crítica y debe ir al registro diferido.

## 4. Alcance fijo

### Incluido

- contrato único de capacidades de BetterP Commerce;
- correspondencia entre capacidades, planes y accesos del backoffice;
- retiro de Vende Fácil de vistas y conteos operativos activos;
- clasificación correcta de salud, errores y accesos denegados;
- identificación del commit, despliegue y runtime de Vultr;
- manifiesto e instalación de automatizaciones necesarias para el SaaS;
- recorrido controlado de alta, checkout, webhook, suscripción y acceso;
- cierre mínimo de UX y Web Vitals en las rutas afectadas;
- evidencia final de salida a producción.

### Fuera de alcance

- afinar productos individuales o residuos del normalizador;
- publicar o modificar productos en marketplaces;
- desarrollar la integración funcional de Amazon o Walmart;
- rediseñar por completo BetterP o BetterP Commerce;
- resolver incidencias propias de Renta Fácil;
- eliminar definitivamente datos históricos o respaldos de Vende Fácil;
- ampliar automatizaciones de marketing, inbox o CRM;
- decidir o construir un checkout completamente autoservicio distinto al modelo comercial vigente.

## 5. Ruta cerrada y orden obligatorio

| Corte | Resultado único | Estado |
|---|---|---|
| BC-0 | Línea base y reglas de control documentadas | Completado |
| BC-1 | Capacidades y planes coherentes | Completado y desplegado |
| BC-2 | Backoffice activo sin residuos operativos de Vende Fácil | Completado y desplegado |
| BC-3 | Salud y telemetría representan la realidad de Vultr | Completado y desplegado (`c339439`) |
| BC-4 | Automatizaciones SaaS alineadas y observables | Completado y desplegado (`8c5c109`) |
| BC-5 | Alta y cobro validados de extremo a extremo | Completado y desplegado (`aa86717`, `6d4d5eb`, `59c3f12`) |
| BC-6 | Pulido mínimo de UX y rendimiento | Completado y desplegado (`431367e`, Commerce `dc19aea`) |
| BC-7 | Aceptación final y acta de cierre | Completado con excepción temporal de seguridad aceptada |

## 6. Definición de cada corte

### BC-1 — Contrato de capacidades y planes

Objetivo: que BetterP Commerce tenga un único contrato funcional desde el plan comercial hasta el
acceso efectivo del usuario.

Trabajo permitido:

- definir capacidades canónicas para productos, inventario, catálogos, reglas por canal, POS/QR,
  caja, tienda en línea, conexiones e-commerce, ventas, envíos, facturación y reportes;
- mapear las claves heredadas `vende_facil.*` y `tienda_facil.*` sin renombramientos destructivos;
- validar la matriz Micro, Starter, Growth y Scale contra la oferta publicada;
- corregir el cálculo de permisos y la presentación en clientes, planes y suscripciones;
- clasificar los rechazos históricos de plan, sin convertirlos en excepciones manuales.

Restricciones:

- no crear overrides individuales para ocultar defectos del contrato;
- no cambiar precios ni productos en Stripe;
- no modificar datos del motor de normalización o marketplaces.

Criterios de salida:

- la matriz de planes tiene pruebas automatizadas;
- cada capacidad visible tiene una fuente de autorización única y trazable;
- los accesos válidos de la cuenta Growth dejan de generar rechazos inesperados;
- los bloqueos que sí corresponden al plan continúan bloqueados;
- no existe fuga de capacidades entre soluciones o cuentas.

### BC-2 — Limpieza del backoffice operativo

Objetivo: que las vistas activas describan BetterP Commerce y conserven Vende Fácil únicamente como
historial.

Trabajo permitido:

- separar registros activos e históricos en clientes, ventas, suscripciones y salud;
- retirar textos, acciones y enlaces operativos obsoletos de Vende Fácil;
- corregir conteos para que clientes y soluciones activas coincidan entre vistas;
- actualizar la siguiente acción comercial de BetterP Commerce.

Restricciones:

- no borrar ni reescribir evidencia histórica;
- no consolidar automáticamente suscripciones con referencias ambiguas de Stripe.

Criterios de salida:

- las vistas activas muestran únicamente Renta Fácil y BetterP Commerce;
- los conteos de clientes activos son consistentes;
- Vende Fácil es consultable solo como historial y no permite nuevas operaciones;
- no queda ningún llamado operativo a “definir el MVP de Tienda Fácil”.

### BC-3 — Verdad operativa, salud y telemetría

Objetivo: que `/backoffice/salud` mida incidentes reales y describa el despliegue actual en Vultr.

Trabajo permitido:

- separar errores 5xx, denegaciones 401/403 y tráfico exploratorio 404;
- evitar que accesos correctamente bloqueados aparezcan como fallas de la plataforma;
- publicar de forma segura `BETTERP_GIT_COMMIT` y `BETTERP_DEPLOY_ID` desde el proceso de release;
- sustituir referencias operativas a Render por el runtime real de Vultr/Docker;
- alinear la ubicación declarada de logs con la infraestructura actual.

Criterios de salida:

- salud identifica commit y despliegue vigentes;
- no muestra Render como runtime o destino de logs;
- los errores críticos representan fallas genuinas y no escaneos o permisos esperados;
- el smoke público y autenticado no introduce regresiones.

### BC-4 — Automatizaciones SaaS

Objetivo: que el manifiesto, cron y evidencia productiva representen solamente los procesos necesarios
en Vultr.

Trabajo permitido:

- retirar del manifiesto activo expectativas de Render, keepalive y Vende Fácil;
- confirmar como mínimo expiración de trials, cambios de plan pendientes y reporte post go-live;
- instalar procesos idempotentes en Vultr con bloqueo contra concurrencia;
- exponer última ejecución, resultado y antigüedad de evidencia en salud.

Restricciones:

- primero se realiza preview/dry-run;
- activar procesos capaces de cobrar, enviar mensajes o modificar suscripciones productivas requiere
  autorización exacta dentro del corte;
- las automatizaciones propias de Renta Fácil o marketing no bloquearán el cierre de Commerce.

Criterios de salida:

- no existen expectativas activas para servicios retirados;
- cada proceso obligatorio de Commerce tiene programación y evidencia vigentes;
- una ejecución fallida es visible y no se duplica por concurrencia;
- no se activan procesos fuera del manifiesto aprobado.

### BC-5 — Alta y cobro de extremo a extremo

Objetivo: demostrar que una cuenta puede convertirse en cliente de BetterP Commerce y obtener el
acceso correcto a partir de Stripe.

Flujo obligatorio:

1. solicitud/demo o alta controlada;
2. selección de plan en backoffice;
3. creación de checkout de Stripe;
4. recepción idempotente del webhook firmado;
5. creación o actualización de suscripción;
6. activación exacta de capacidades;
7. acceso del cliente a BetterP Commerce;
8. consulta de factura y portal de cliente;
9. cancelación o cambio controlado sin perder auditoría.

Restricciones:

- primero se prueba en modo de prueba o con un caso aislado;
- ningún cargo real se ejecuta sin autorización exacta;
- no se utiliza la cuenta productiva existente como objeto de pruebas destructivas.

Criterios de salida:

- el recorrido completo queda registrado con IDs sanitizados y timestamps;
- webhooks repetidos no duplican suscripciones ni accesos;
- plan, precio, estado, permisos y factura coinciden;
- se completa la evidencia de go-live de BetterP Commerce.

### BC-6 — Pulido mínimo de UX y rendimiento

Objetivo: corregir únicamente la fricción o rendimiento que impida operar o vender BetterP Commerce.

Trabajo permitido:

- atender las muestras Web Vitals deficientes en las rutas de Commerce y backoffice afectadas;
- corregir textos, estados vacíos, carga, errores y accesibilidad directamente relacionados;
- ejecutar smokes de escritorio y móvil.

Restricciones:

- no realizar un rediseño general;
- toda mejora no vinculada con el recorrido cerrado pasa al registro diferido.

Criterios de salida:

- no hay bloqueos de navegación, compra, activación o administración;
- las rutas objetivo no generan nuevas muestras deficientes en el smoke controlado;
- los estados de carga, éxito y error son comprensibles y accesibles.

### BC-7 — Aceptación final

Objetivo: cerrar formalmente la ruta y decidir, con evidencia, si BetterP Commerce está listo.

Entregables:

- matriz final de capacidades y planes;
- inventario de vistas activas e históricas;
- evidencia de despliegue, salud y automatizaciones;
- evidencia sanitizada del recorrido de alta y cobro;
- resultados de pruebas y smokes;
- riesgos residuales y registro diferido priorizado;
- acta de aceptación con fecha, commit y despliegue.

Criterios de cierre total:

- BetterP Commerce es la única solución comercial para comercio e inventario;
- los cuatro planes activos tienen precios, capacidades y accesos coherentes;
- clientes, ventas, suscripciones y salud usan conteos consistentes;
- Stripe LIVE está listo y el recorrido fue demostrado de forma controlada;
- Vultr es la autoridad operativa visible y sus procesos tienen evidencia vigente;
- no existe un bloqueo crítico abierto;
- los pendientes no críticos están explícitamente diferidos y no ocultos.

## 7. Protocolo de ejecución por corte

Cada corte seguirá exactamente esta secuencia:

1. verificar `main`, estado limpio y línea base productiva de solo lectura;
2. declarar archivos y contratos que se modificarán;
3. implementar y probar localmente;
4. mostrar resultados, riesgos y diferencia productiva esperada;
5. solicitar una sola autorización agrupada para commit, push, despliegue y escrituras previstas;
6. desplegar sin habilitar efectos externos no incluidos;
7. ejecutar smoke de solo lectura;
8. ejecutar, solo si fue autorizado, la escritura productiva acotada;
9. registrar evidencia y marcar el corte como completado;
10. anunciar el siguiente corte, sin comenzarlo automáticamente.

Si un paso falla, se corrige dentro del mismo corte. No se cambia de frente para compensarlo.

## 8. Registro diferido inicial

Estos temas se revisarán únicamente después de BC-7:

- implementación funcional completa de Amazon y Walmart;
- checkout totalmente autoservicio frente al modelo actual de activación guiada;
- eliminación definitiva de infraestructura, imágenes o históricos de Vende Fácil;
- automatizaciones avanzadas de marketing, CRM e inbox;
- problemas propios de Renta Fácil que no afecten autenticación, cobro o aislamiento común;
- limpieza global de terminología histórica en documentación interna;
- calidad o corrección producto por producto del normalizador;
- estados individuales de publicaciones en Mercado Libre.

## 9. Control de cambios de esta ruta

La ruta solo puede cambiar si:

- aparece una excepción crítica definida en este documento; o
- el usuario aprueba explícitamente una modificación de alcance.

Toda propuesta nueva se añadirá primero al registro diferido. No se insertarán cortes intermedios ni
se ampliará el corte activo por conveniencia técnica.

## 10. Siguiente acción autorizable

BC-6 quedó completado y desplegado. Los smokes de escritorio y móvil validaron registro, Planes,
Clientes, Ventas, Salud, dashboard de BetterP Commerce y retorno al backoffice; la telemetría
posterior registró únicamente muestras Web Vitals `good` en las rutas observadas, sin errores de
frontend ni respuestas 5xx.

BC-7 quedó aceptado para operación comercial controlada con una excepción temporal de seguridad:
la rotación de la contraseña de `root` se difiere como P0 por decisión del propietario. SSH rechaza
autenticación por contraseña y conserva el acceso por llave, por lo que la credencial no habilita
acceso remoto SSH. La excepción, sus mitigaciones y su condición de cierre están registradas en
`ACTA_ACEPTACION_BETTERP_COMMERCE_BC7_2026-08-05.md`.

La ruta BC-0 a BC-7 queda formalmente terminada. Cualquier trabajo posterior debe seleccionarse del
registro diferido y abrirse como una ruta independiente; no se continúa automáticamente con otro
frente. Publicar el acta requiere únicamente commit y push documental. No requiere despliegue ni
escrituras en Stripe, marketplaces o bases productivas.
