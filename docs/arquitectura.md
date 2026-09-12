# Arquitectura

Django (API) + Next.js (app y paginas publicas), multi-inquilino por *capa de
negocio*.

## Apps del backend

| App | Responsabilidad |
| --- | --- |
| `accounts` | Usuarios, sesiones, 2FA, membresias de capa y auditoria. |
| `empresas` | Capas de negocio, unidades de negocio y respaldos. |
| `billing` | Solucion, planes, suscripciones, consumo, Stripe y backoffice. |
| `crm` | Clientes, datos fiscales y CSF. |
| `catalogo` | Productos, categorias, imagenes, bodegas, inventario y ordenes. |
| `pos` | Cajas, mesas, turnos, tickets, comandas, cobro QR y pagos. |
| `facturacion` | CFDI: emisor, certificados y timbrado. |
| `finanzas` | Cuentas bancarias, cartera, pagos y conciliacion. |
| `comunicaciones` | Correo y WhatsApp salientes, plantillas y evidencias. |

## Flujo de una venta

1. La caja abre un `Turno` sobre un `PuntoVenta` (unico abierto por caja).
2. Se crea un `Ticket`; cada linea es un `TicketItem` con su estado de
   preparacion, que alimenta la vista de comandas.
3. El cobro se registra como uno o varios `PagoTicket`. Si es por QR, primero se
   genera un `CobroQR` con referencia propia y vigencia.
4. Al saldarse el ticket, `pos` crea una `catalogo.Orden` con canal `POS_QR` y la
   confirma: eso descuenta inventario en la bodega de la caja y libera la mesa.
5. El corte del turno congela totales por forma de pago y la diferencia de
   efectivo.

## Endpoints publicos

Solo dos, ambos sin autenticacion y pensados para el telefono del cliente:

- `GET /api/pos/publico/menu/{token}/` y `POST .../pedido/` — menu por mesa y
  pedido del comensal. El token es el de la mesa o el de la caja.
- `GET /api/pos/publico/cobro/{referencia}/` — estado de un cobro por QR.

En el frontend corresponden a `/menu/[token]` y `/pagar/[referencia]`.

## Segmento y acceso

`/pos-qr` es la pagina publica del segmento. `/pos-qr/entrar` resuelve el acceso:
si no hay sesion manda a `/login` conservando el destino, y si la hay consulta
`/api/billing/solution-launch/pos_qr/` para elegir la capa y abrir la caja.

El acceso por modulo se controla con los modulos del plan (`pos_caja`,
`catalogo`, `inventario`, `restaurante`, `cobro_qr`, `reportes`, ...) tanto en el
backend como en la navegacion del frontend.
