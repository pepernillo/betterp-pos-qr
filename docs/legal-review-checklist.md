# Revision legal y comercial final

Este documento prepara la revision formal de BetterP en Mexico antes de venta
abierta o contratos con clientes reales de mayor riesgo. No sustituye asesoria
legal, fiscal, contable, financiera, inmobiliaria ni de cobranza; sirve para
entregar al abogado y al equipo comercial un paquete claro de decisiones,
evidencias y bloqueantes.

## Alcance actual publicado

- Terminos del servicio: `/terms`
- Aviso de privacidad: `/privacy`
- Eliminacion de datos: `/data-deletion`
- Registro/checkout: acepta terminos y privacidad antes de contratar.
- Operacion interna: `Backoffice > Salud`, `Clientes SaaS`, auditoria,
  backups, smoke productivo y runbooks operativos.

## Referencias oficiales a validar

- LFPDPPP y reformas publicadas en DOF:
  `https://www.dof.gob.mx/nota_detalle.php?codigo=5752569&fecha=20/03/2025`
- Portal SAT Factura y material CFDI 4.0:
  `https://www.sat.gob.mx/minisitio/Factura/default.htm`
- Requisitos y formato CFDI, Anexo 20:
  `https://wwwmat.sat.gob.mx/cs/Satellite?c=ConsultaInfo&childpagename=SatTyR%2FConsultaInfo%2FSAT_LandingConsultaInformacion&cid=1462228635025&packedargs=d%3DTouch&pagename=TySWrapper`

## Decision de salida

| Estado | Uso permitido | Condicion |
| --- | --- | --- |
| MVP guiado | Clientes reales controlados | Responsable interno asignado, textos publicados, consentimiento registrado, soporte cercano |
| Venta abierta limitada | Clientes pymes sin datos sensibles especiales | Abogado aprueba terminos, privacidad, facturacion, cobranza y DPA base |
| Clientes enterprise o regulados | Solo con contrato especifico | Contrato firmado, anexo de datos, SLA, seguridad y soporte pactados |

## Matriz de revision

| Area | Riesgo a validar | Evidencia actual | Bloquea venta abierta si falta |
| --- | --- | --- | --- |
| Identidad legal | Responsable, razon social, domicilio, RFC, contacto y jurisdiccion correctos | `/terms`, `/privacy`, propuestas comerciales | Si |
| Naturaleza SaaS | No prometer asesoria legal, fiscal, contable, financiera, inmobiliaria o cobranza profesional | `/terms` declara herramienta tecnologica | Si |
| Contratacion | Trial, checkout, renovacion, cancelacion, cambios de plan y autorizacion de cargos recurrentes | `/terms`, Stripe, historial de billing | Si |
| Devoluciones | Politica de satisfaccion, exclusiones, saldos a favor, reembolsos y downgrades | `/terms`, cambios de plan Stripe, revision de reembolso | Si |
| CFDI | Diferenciar recibos operativos de factura fiscal; validar CFDI 4.0, uso CFDI, regimen y complemento de pago si aplica | `/terms`, facturacion plataforma, SAT/PAC | Si |
| Datos personales | Aviso de privacidad, finalidades, ARCO, encargados, transferencias, conservacion y seguridad | `/privacy`, auditoria, permisos, backups | Si |
| Rol responsable/encargado | Cliente como responsable de datos de sus clientes finales; BetterP como encargado/proveedor tecnologico | `/terms`, `/privacy` | Si |
| Datos sensibles | Prohibir o limitar carga de datos sensibles salvo autorizacion suficiente y controles adecuados | `/privacy`, permisos, auditoria | Si para clientes de alto riesgo |
| Integraciones | Stripe, Meta, WhatsApp, correo, R2, Neon, Render, Cloudflare, PAC y portales externos | `/terms`, `/privacy`, runbooks | Si |
| WhatsApp/cobranza | Consentimiento de destinatarios, plantillas aprobadas, no spam, no hostigamiento, reglas de horario, opt-out y deslinde por uso del numero compartido | Acuerdo `WHATSAPP_SHARED_NUMBER_TERMS`, Cobranza preview, `Cobranza > Preparacion`, sincronizacion Meta, `--require-whatsapp-ready`, monitoreo crons | Si |
| Comunicaciones electronicas | Validez operativa de logs, aceptaciones, instrucciones, webhooks y evidencia de uso | Auditoria, eventos billing, logs operativos | No, pero debe quedar cubierto |
| Seguridad | Control de accesos, roles, bitacora, credenciales, backups, respuesta a incidentes | Auditoria, Salud, runbooks, backups R2 | Si |
| Retencion y eliminacion | Periodos de conservacion, bloqueo, eliminacion, backups y obligaciones fiscales/contractuales | `/privacy`, `/data-deletion`, backup policy | Si |
| Soporte y SLA | Horarios, severidades, tiempos de respuesta, exclusiones y canal de contacto | Runbooks, propuesta comercial | Si para venta abierta |
| Limites de responsabilidad | Tope de responsabilidad, exclusion de indirectos y dependencias de terceros | `/terms` | Si |
| Uso aceptable | Fraude, spam, scraping, suplantacion, abuso de infraestructura y contenido ilicito | `/terms`, monitoreo, auditoria | Si |
| Propiedad intelectual | Licencia SaaS, marca, codigo, contenido del cliente, feedback y materiales | `/terms` | No, pero debe quedar cubierto |
| Cambios a terminos | Mecanismo de actualizacion y notificacion | `/terms`, `/privacy` | No |

## Checklist abogado

1. Confirmar identidad legal completa del responsable de BetterP.
2. Revisar si `Better Business MX` es nombre comercial, razon social o requiere
   reemplazo por la entidad juridica exacta.
3. Validar que el alcance SaaS y los disclaimers profesionales sean suficientes.
4. Validar consentimiento de cargos recurrentes, renovaciones y cancelacion.
5. Validar politica de primer mes, devoluciones, saldos a favor y reembolsos.
6. Revisar cumplimiento CFDI 4.0, datos fiscales requeridos y distincion entre
   recibos operativos y comprobantes fiscales.
7. Revisar aviso de privacidad contra LFPDPPP: responsable, finalidades,
   ARCO, transferencias, encargados, conservacion y contacto.
8. Definir si hace falta anexo de tratamiento de datos para clientes B2B.
9. Revisar clausulas para datos de residentes, huespedes, proveedores,
   colaboradores, clientes finales, documentos y comprobantes.
10. Revisar politica de WhatsApp/cobranza: consentimiento, plantillas, opt-out,
    horarios, lenguaje permitido y responsabilidad del cliente.
    Confirmar que el texto versionado de `WHATSAPP_SHARED_NUMBER_TERMS` sea
    aprobado por abogado antes de venta abierta.
11. Revisar integraciones y terminos de terceros: Stripe, Meta, WhatsApp,
    correo, storage, bancos, PAC/facturacion y marketplaces.
12. Revisar limites de responsabilidad e indemnizacion conforme al tipo de
    cliente y canal de contratacion.
13. Revisar mecanismo de soporte, SLA, incidentes, mantenimiento y fuerza mayor.
14. Revisar exportacion, retencion, eliminacion, backups y restore avanzado.
15. Revisar jurisdiccion, ley aplicable y mecanismo de solucion de controversias.

## Checklist comercial

1. Toda propuesta debe indicar plan, precio, ciclo, moneda, impuestos,
   limites incluidos, modulos y soporte incluido.
2. No prometer implementaciones, integraciones, plantillas aprobadas, SLA,
   facturacion live o canales externos sin fecha y alcance escrito.
3. Para clientes que usaran WhatsApp/cobranza, exigir confirmacion de que el
   cliente cuenta con base legal o consentimiento para contactar destinatarios.
4. Para facturacion, pedir datos fiscales antes de emitir CFDI y aclarar que
   recibos internos no sustituyen factura fiscal.
5. Para cambios de plan en Stripe `LIVE`, seguir el candado operativo
   `STRIPE_LIVE_OK` o programar al renovar.
6. Para descuentos o condiciones especiales, dejar vigencia y renovacion por
   escrito.
7. Para clientes enterprise, no cerrar sin contrato, DPA y definicion de SLA.

## Evidencia tecnica disponible

- Auditoria minima de acciones criticas:

```http
GET /api/accounts/auditoria/
GET /api/accounts/auditoria/resumen/
```

- Permisos y roles:

```http
GET /api/accounts/permisos/
```

- Export operativo por capa:

```http
GET /api/empresas/capas/backup/exportar/
```

- Historial de cambios de plan:

```http
GET /api/billing/suscripcion/cambios-plan/
```

- Salud interna:

```http
GET /api/billing/admin/salud/
GET /api/billing/admin/clientes/
```

- Smoke MVP:

```powershell
$env:BETTERP_SMOKE_EMAIL='smoke@betterp.net'
$env:BETTERP_SMOKE_PASSWORD='smoke$0123'
.venv\Scripts\python.exe scripts\smoke_mvp.py
```

## Bloqueantes antes de venta abierta

- Identidad legal o contacto de privacidad incompletos.
- Aviso de privacidad no aprobado para uso B2B con datos de terceros.
- Falta de politica aprobada para WhatsApp/cobranza.
- Falta de criterio fiscal para CFDI, complemento de pago, cancelacion o
  comprobantes operativos.
- Falta de contrato/DPA para clientes con datos sensibles, volumen alto o SLA.
- No tener responsable interno de soporte y escalamiento.
- No poder demostrar consentimiento de terminos/privacidad en registro o checkout.

## Decision para MVP comercial guiado

BetterP puede operar clientes reales controlados si:

1. Los textos publicos siguen publicados.
2. El cliente acepta terminos y privacidad antes de usar o contratar.
3. Hay responsable interno de soporte.
4. El cliente entiende que BetterP es SaaS operativo y no asesoria profesional.
5. Cobranza automatica y WhatsApp se activan solo con plantillas, permisos y
   consentimiento operativo del cliente.
6. Facturacion live y Stripe live se usan con pruebas controladas.
7. Cualquier caso enterprise, regulado o de alto riesgo pasa por contrato
   especifico antes de operar.

## Entregable para abogado

Enviar:

- URL publica de `/terms`, `/privacy` y `/data-deletion`.
- Este checklist.
- Propuesta comercial tipo.
- Ejemplo de flujo de registro/checkout.
- Captura o descripcion de auditoria, permisos, backups y Salud.
- Lista de proveedores externos usados en produccion.
- Casos de uso: cobranza, portal cliente, facturacion, conciliacion, backups y
  cambios de plan.
