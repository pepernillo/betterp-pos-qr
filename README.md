# BetterP POS QR

Punto de venta para mostrador y restaurantes: catalogo de productos, inventario,
caja con turnos y corte, mesas y comandas, menu por codigo QR y cobro por QR.

Es una copia reducida de [bettERP](https://github.com/pepernillo/bettERP) al
segmento POS QR. **No comparte historial con el original**: el repo de origen
tiene `backend/.env` commiteado con credenciales reales, asi que esta copia
arranca desde un commit inicial limpio.

## Que quedo dentro

- **Caja** — cobro en mostrador con efectivo, tarjeta, transferencia o QR;
  calculo de cambio, cuenta dividida, descuentos y propinas segun el plan.
- **Cobro por QR** — se genera un codigo por cuenta con referencia y vigencia; el
  cliente lo escanea, ve el monto en `/pagar/{referencia}` y la caja confirma.
- **Restaurante** — mesas con estado, cuenta por mesa, comandas de cocina y menu
  publico por QR en `/menu/{token}` desde el que el comensal levanta su pedido.
- **Productos y catalogos** — alta de productos, categorias, precios e imagenes.
- **Inventario** — bodegas, existencias, ajustes y movimientos; cada venta
  cobrada descuenta de la bodega de su caja.
- **Corte y reportes** — corte por turno con diferencia de efectivo, y venta por
  periodo, forma de pago y producto.
- Soporte: facturacion CFDI, finanzas, clientes, comunicaciones y el backoffice
  de planes y suscripciones.

## Que se quito

Todos los demas canales de venta y los productos ajenos al segmento:

- Mercado Libre y el resto de canales del catalogo (Amazon, Liverpool, Walmart,
  Shopify, WooCommerce, tienda propia), junto con publicaciones y conectores.
- Las marcas *Vende Facil*, *Tienda Facil* / *BetterP Commerce* y *Renta Facil*,
  y el puente hacia el servicio externo de catalogo.
- Renta de espacios, condominios y su motor de generacion de rentas.
- Marketing y redes sociales: Meta, Instagram, LinkedIn, TikTok, YouTube,
  campanas, calendario editorial y bandeja social.
- Cobranza automatizada y el portal de cliente.

La unica solucion es `pos_qr` y el unico canal de orden es `POS_QR`.

## URL del segmento

| Ruta | Que es |
| --- | --- |
| `/pos-qr` | Pagina publica del segmento, con capacidades y planes. |
| `/pos-qr/entrar` | Acceso: manda al login si hace falta y abre la caja de la capa del usuario. |
| `/pos-qr/caja` | La caja. |
| `/pos-qr/mesas`, `/pos-qr/comandas` | Restaurante. |
| `/pos-qr/productos`, `/pos-qr/catalogos`, `/pos-qr/inventario` | Catalogo. |
| `/pos-qr/cajas`, `/pos-qr/corte`, `/pos-qr/reportes` | Operacion. |
| `/menu/{token}` | Menu publico que abre el comensal al escanear su mesa. |
| `/pagar/{referencia}` | Pantalla de cobro que ve quien escanea el QR. |

## Planes

| Clave | Plan | Mensual | Cajas | Productos |
| --- | --- | --- | --- | --- |
| `pos_inicial` | POS Inicial | $299 | 1 | 50 |
| `pos_negocio` | POS Negocio | $899 | 2 | 500 |
| `pos_restaurante` | POS Restaurante | $1,799 | 4 | 2,000 |
| `pos_multisucursal` | POS Multisucursal | $3,499 | 25 | 20,000 |

## Arrancar

```bash
# backend
cd backend && python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env && python manage.py migrate && python manage.py runserver

# frontend
cd frontend && npm install
cp .env.example .env.local && npm run dev
```

Detalle en [docs/puesta-en-marcha.md](docs/puesta-en-marcha.md) y
[docs/arquitectura.md](docs/arquitectura.md).

## Pruebas

```bash
cd backend && python manage.py test     # 342 pruebas
cd frontend && npx tsc --noEmit && npm run build
```

Las pruebas heredadas que evaluaban rentas, marketing y marketplaces se
eliminaron junto con ese codigo; las de catalogo se conservaron y las del punto
de venta (`pos/tests.py`) se escribieron para este fork.

## Licencia

[GNU AGPL-3.0](LICENSE).

Copyright (C) 2026 pepernillo

Es copyleft de red: quien ofrezca este software como servicio a traves de una
red tiene que poner el codigo fuente de su version a disposicion de sus usuarios
(seccion 13 de la licencia). Por eso las paginas publicas enlazan al repositorio.
