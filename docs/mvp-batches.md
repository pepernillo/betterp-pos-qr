# BetterP MVP batches

Esta lista convierte los pendientes principales en bloques ejecutables. La idea es cerrar primero lo que evita errores 500, fugas de plan o procesos manuales fragiles, y despues pulir experiencia y operacion.

## Batch 1 - APIs, planes y estabilidad

Objetivo: que una cuenta no pueda usar por API algo que su plan no incluye.

- Enforzar limites backend para usuarios, entidades y espacios.
- Enforzar modulos backend: CxP, conciliacion, marketing, cobranza, facturacion y conexiones.
- Enforzar funciones backend: batch import, WhatsApp automatizado, publicacion social, IA y webhooks.
- Mantener dashboard tolerante a fuentes parciales, sin romper la vista completa.
- Validar errores API como JSON utiles, no HTML de error 500.

Estado inicial:
- Usuarios, entidades y espacios ya tienen control base.
- Renta de espacios y marketing ya tienen helpers de modulo/publicacion.
- Finanzas ahora bloquea CxP, conciliacion y cargas batch segun plan.
- Empresas ahora exige `batch_import` para carga masiva y `facturacion_cfdi` para activar CFDI.
- Comunicaciones ahora exige `cobranza`; WhatsApp saliente/configurado exige `whatsapp_automation`; configuracion con IA exige `ai_copy`.

## Batch 2 - Onboarding operativo

Objetivo: que un cliente nuevo configure BetterP sin soporte.

- Paso 2: simplificar visualmente reglas heredables y regla global.
- Paso 4: terminar CxP profesional con presets, proveedores MX, batch, edicion compacta y borrado seguro.
- Paso 6: conexiones de renta de espacios.
- Paso 7: conexiones de marketing.
- Plantilla Excel: datos ficticios, fila descriptiva, selectores y tipo de corte GENERAL/INDIVIDUAL.
- Validar que fechas de corte individuales generen CxC correctas.

## Batch 3 - CxC mensual y cobranza

Objetivo: cartera confiable para cobrar sin duplicar ni adelantar todo el ano.

- Crear CxC del periodo vigente el dia 1 a las 00:01.
- Respetar corte individual o general por cliente/contrato/batch.
- Mostrar estados: por vencer, gracia, vencido, parcial, conciliado.
- Evitar CxC futuras fuera del periodo operativo.
- Activar plantillas de cobranza antes, durante y despues del vencimiento.

Estado inicial:
- Existe comando idempotente `generar_cxc_periodicas`.
- Existe endpoint programado protegido por `FINANZAS_CXC_SYNC_TOKEN`.
- Existe workflow mensual `finanzas-cxc-sync.yml` para llamar produccion el dia 1 a las 00:01 Mexico.
- La consulta y generacion manual de CxC materializan solo el periodo vigente; no rellenan meses historicos ni periodos futuros por accidente.
- Existen plantillas default de cobranza para antes del vencimiento, dia de vencimiento, 3 dias despues y 10 dias despues.
- Existen reglas default inactivas para que el cliente las revise y active sin envios automaticos sorpresa.

## Batch 4 - Portal cliente final

Objetivo: que el operador pueda previsualizar lo que vera su cliente.

- Modal desde clientes operativos.
- Estado de cuenta e historial de pagos.
- Carga de comprobantes.
- Datos fiscales y descarga de facturas.
- Comunicacion y seguimiento.

## Batch 5 - Billing, upgrades y uso justo

Objetivo: cobrar bien y evitar abuso.

- Upgrades con proration y credito proporcional.
- Downgrades con regla clara de saldo, reembolso o tiempo adicional.
- Dias restantes al siguiente pago.
- Consumo por cliente: usuarios, entidades, espacios, emails, WhatsApp, storage, IA y actividad.
- Alertas de uso justo y propuesta de upgrade.

## Batch 6 - Backoffice comercial BetterP

Objetivo: operar BetterP como SaaS, separado de datos del cliente.

- Dashboard con ventas del mes, historicas, costos, utilidad, clientes activos, prospectos y campanas.
- Marketing BetterP sin logica de espacios.
- Seguimiento comercial y demo.
- Reportes de clientes SaaS y salud de cuenta.

## Batch 7 - Legal, seguridad y produccion

Objetivo: estar listo para vender con menos riesgo.

- Recuperacion de cuenta completa por correo.
- Expiracion y rotacion de tokens.
- Terminos, privacidad y politica de reembolso para Mexico.
- Backups por cliente con export y restore puntual.
- Auditoria basica por capa.
