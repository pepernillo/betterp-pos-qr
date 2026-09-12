# Entorno demo para presentaciones

## Objetivo

Tener una version funcional para demos con clientes grandes sin tocar produccion, sin enviar mensajes reales y con datos ficticios suficientemente buenos para presentar BettERP como sistema vivo.

## Arquitectura recomendada

- Frontend demo: `https://demo.betterp.net`
- Backend demo: `https://api-demo.betterp.net`
- Base de datos demo: PostgreSQL separada de produccion.
- Storage demo: bucket/carpeta separada de produccion.
- Proveedores externos: sandbox o modo simulado.

Nunca usar la base de produccion para demos. Si necesitas datos realistas, se cargan datos semilla ficticios o anonimizados.

## Servicios sugeridos

### Backend en Render

Crear un servicio nuevo copiando el backend actual:

- Nombre: `betterp-api-demo`
- Branch: `main` o una rama `demo` si quieres aislar releases.
- Root: `backend`
- Build command: `pip install -r requirements.txt && python manage.py collectstatic --noinput`
- Start command: `gunicorn core.wsgi:application`
- Base de datos: nueva PostgreSQL para demo.

Variables clave:

```env
APP_ENV=demo
DEMO_MODE=true
DISABLE_OUTBOUND_INTEGRATIONS=true
FRONTEND_BASE_URL=https://demo.betterp.net
BACKEND_PUBLIC_BASE_URL=https://api-demo.betterp.net
DATABASE_URL=postgres://...
```

Usar como base el archivo `backend/.env.demo.example` y ajustar credenciales por
entorno. No copiar variables de produccion sin revisar una por una.

Con `DISABLE_OUTBOUND_INTEGRATIONS=true`, WhatsApp y email saliente regresan respuestas simuladas. El sistema puede registrar historial y mostrar el flujo sin contactar clientes reales.

### Frontend en Vercel

Crear un proyecto o deployment separado:

```env
NEXT_PUBLIC_APP_ENV=demo
NEXT_PUBLIC_API_BASE_URL=https://api-demo.betterp.net/api
```

Dominio recomendado:

```text
demo.betterp.net
```

Si todavia no tienes dominio `api-demo.betterp.net`, usa la URL temporal de Render:

```env
NEXT_PUBLIC_APP_ENV=demo
NEXT_PUBLIC_API_BASE_URL=https://betterp-api-demo.onrender.com/api
```

En Vercel:

- Framework preset: `Next.js`
- Root directory: `frontend`
- Build command: dejar el default de Vercel o usar `npm run build`
- Output directory: dejar vacio/default
- Branch: `main`

Despues del primer deploy, abre la URL temporal de Vercel e inicia sesion con el usuario demo.

## Proveedores externos

- Stripe: usar llaves de test.
- Facturama: usar sandbox.
- WhatsApp/Green API/Resend: mantener `DISABLE_OUTBOUND_INTEGRATIONS=true` durante demos.
- OpenAI: puedes usar llave real con limites bajos, o mantener funciones simuladas hasta cerrar el flujo.

## Datos demo

El entorno debe tener una operadora ficticia con:

- 2 o 3 entidades.
- Habitaciones/unidades disponibles y ocupadas.
- Clientes ficticios.
- CxC, CxP, pagos, gastos y movimientos bancarios de ejemplo.
- Una cuenta bancaria demo con estado de cuenta ya importado.
- Comunicaciones configuradas en modo simulado.
- Consumos extra de ejemplo para mostrar el estado de cuenta.

Despues de desplegar backend demo y configurar variables, prepara la base con un solo comando:

```bash
python manage.py bootstrap_demo_environment --reset
```

Acceso demo:

```text
Usuario: demo@betterp.net
Password: DemoBetterp2026!
```

El comando crea datos ficticios de entidades, espacios, clientes, CxC, CxP, conciliacion, comunicaciones simuladas y consumo de extras. Usa `--reset` cuando quieras limpiar la demo antes de una presentacion.

Si no tienes Shell en Render, ejecuta el comando desde GitHub Codespaces o tu terminal local apuntando a la base demo de Neon:

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

export APP_ENV=demo
export DEMO_MODE=true
export DISABLE_OUTBOUND_INTEGRATIONS=true
export DATABASE_URL='postgresql://usuario:password@host-demo.neon.tech/neondb?sslmode=require'
export SECRET_KEY='clave-demo'
export FRONTEND_BASE_URL='https://demo.betterp.net'
export BACKEND_PUBLIC_BASE_URL='https://betterp-api-demo.onrender.com'

python manage.py bootstrap_demo_environment --reset
```

El comando se niega a correr si `APP_ENV` no es `demo`, si `DEMO_MODE` no esta activo o si las integraciones salientes no estan deshabilitadas.

## Flujo de preparacion antes de una presentacion

1. Ejecutar migraciones en backend demo.
2. Cargar datos semilla ficticios.
3. Validar login de usuario demo.
4. Recorrer: dashboard, entidades, renta de espacios, clientes, CxC, CxP, conciliacion, comunicaciones, billing.
5. Confirmar que no hay proveedores reales activos.
6. Reiniciar datos demo si la presentacion anterior dejo cambios confusos.

## Smoke automatico demo

El workflow `Demo Smoke` valida diariamente el ambiente demo con el mismo script
que produccion, pero apuntando a las URLs demo. Configurar estos secrets:

- `BETTERP_DEMO_API_BASE`, por ejemplo `https://api-demo.betterp.net/api`
- `BETTERP_DEMO_APP_BASE`, por ejemplo `https://demo.betterp.net`
- `BETTERP_DEMO_HEALTH_URL`, por ejemplo `https://api-demo.betterp.net/`
- `BETTERP_DEMO_SMOKE_EMAIL`, normalmente `demo@betterp.net`
- `BETTERP_DEMO_SMOKE_PASSWORD`
- `BETTERP_DEMO_SMOKE_CAPA_ID` opcional

## Estrategia de ventas

Para cliente grande, usar demo guiado con datos que parezcan su operacion:

- Hoteles: habitaciones, ocupacion, cargos, portal cliente.
- Coliving: camas/habitaciones, rentas, pagos, WhatsApp.
- Condominios: cuotas, adeudos, gastos, cobranza y reportes.

El objetivo no es mostrar todo, sino demostrar que el sistema reduce retrabajo: captura una vez, conecta modulos y deja la informacion lista para decidir.
