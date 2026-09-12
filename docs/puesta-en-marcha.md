# Puesta en marcha

Pasos para dejar operando una cuenta de BetterP POS QR, de cero a la primera venta.

## 1. Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # ajusta SECRET_KEY y DATABASE_URL
python manage.py migrate       # siembra la solucion y los planes POS QR
python manage.py createsuperuser
python manage.py runserver
```

La migracion `billing.0002_seed_pos_qr` deja creados la solucion `pos_qr` y los
cuatro planes (`pos_inicial`, `pos_negocio`, `pos_restaurante`,
`pos_multisucursal`).

## 2. Frontend

```bash
cd frontend
npm install
cp .env.example .env.local     # NEXT_PUBLIC_API_BASE_URL apuntando al backend
npm run dev
```

## 3. Primera cuenta

1. Entra a `/registro` y crea la cuenta con el plan que corresponda.
2. Desde `/pos-qr/inventario`, crea una **bodega** (por ejemplo `BAR / Barra`).
3. Desde `/pos-qr/cajas`, crea el **punto de venta** apuntando a esa bodega.
   - Marca *Restaurante* si vas a usar mesas y comandas.
   - Marca *Publicar menu por QR* si el comensal va a ver la carta en su telefono.
4. Desde `/pos-qr/productos`, da de alta el catalogo. Las categorias se crean en
   `/pos-qr/catalogos` y ordenan tanto la caja como el menu publico.
5. Si el plan incluye restaurante, crea las mesas en `/pos-qr/mesas` e imprime el
   QR de cada una.

## 4. Operar

1. En `/pos-qr/caja` abre el turno con el fondo inicial.
2. Abre una cuenta, agrega productos y cobra: en efectivo, con tarjeta o
   generando un **cobro por QR** que el cliente escanea.
3. Al cerrar, `/pos-qr/corte` calcula el efectivo esperado y la diferencia contra
   lo que declares.

## 5. Antes de abrir al publico

- Configura Stripe (modo, price IDs y webhook) si vas a cobrar la suscripcion.
- Configura Facturama si el cliente necesita CFDI.
- Confirma que `ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS` y `CSRF_TRUSTED_ORIGINS`
  incluyan el dominio real; por omision solo traen `localhost`.
- Genera un respaldo de la capa desde el backoffice y valida el restore.
