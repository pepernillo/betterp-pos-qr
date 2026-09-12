import type { Metadata } from "next";
import Link from "next/link";

import { SEGMENT_ENTRY_PATH, SOURCE_URL, segmentRegistrationPath } from "@/lib/pos-segment";

export const metadata: Metadata = {
  title: "BetterP POS QR",
  description:
    "Punto de venta para mostrador y restaurantes: catalogo de productos, caja con turnos, mesas, comandas, menu por codigo QR y cobro por QR.",
};

const CAPACIDADES = [
  {
    titulo: "Caja y tickets",
    detalle:
      "Cobra en mostrador con varias formas de pago, calcula el cambio y cierra el turno con su corte.",
  },
  {
    titulo: "Cobro por QR",
    detalle:
      "Genera un codigo QR por cuenta; el cliente lo escanea, paga y la cuenta se salda sola.",
  },
  {
    titulo: "Mesas y comandas",
    detalle:
      "Cuenta por mesa, indicaciones para cocina y estado de cada platillo hasta que se sirve.",
  },
  {
    titulo: "Menu por QR",
    detalle:
      "Cada mesa tiene su codigo. El comensal abre el menu en su telefono y levanta su propio pedido.",
  },
  {
    titulo: "Productos y catalogos",
    detalle:
      "Alta de productos, categorias, precios e imagenes, con inventario por bodega descontado en cada venta.",
  },
  {
    titulo: "Corte y reportes",
    detalle:
      "Corte por turno con diferencia de efectivo, y venta por periodo, producto y forma de pago.",
  },
];

const PLANES = [
  {
    clave: "pos_inicial",
    nombre: "POS Inicial",
    precio: "$299",
    resumen: "Una caja con catalogo chico, cobro por QR y menu QR para arrancar.",
    incluye: ["1 caja", "50 productos", "2 usuarios", "Menu QR", "Impresion de tickets"],
  },
  {
    clave: "pos_negocio",
    nombre: "POS Negocio",
    precio: "$899",
    destacado: true,
    resumen: "Mostrador con catalogo completo, mesas, propinas y reportes de venta.",
    incluye: [
      "2 cajas",
      "500 productos",
      "5 usuarios",
      "Mesas y comandas",
      "Propinas y descuentos",
      "Reportes de venta",
    ],
  },
  {
    clave: "pos_restaurante",
    nombre: "POS Restaurante",
    precio: "$1,799",
    resumen: "Restaurante completo: comandas, cuenta dividida, facturacion y finanzas.",
    incluye: [
      "4 cajas",
      "2,000 productos",
      "15 usuarios",
      "Pedido desde la mesa",
      "Cuenta dividida",
      "Facturacion CFDI",
    ],
  },
  {
    clave: "pos_multisucursal",
    nombre: "POS Multisucursal",
    precio: "$3,499",
    resumen: "Varias sucursales y cajas, API, webhooks y soporte prioritario.",
    incluye: [
      "25 cajas",
      "20,000 productos",
      "50 usuarios",
      "API y webhooks",
      "Soporte prioritario",
    ],
  },
];

export default function PosQrLandingPage() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-white/6">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
          <span className="text-lg font-bold tracking-wide">
            BetterP <span className="text-cyan-400">POS QR</span>
          </span>
          <Link
            href={SEGMENT_ENTRY_PATH}
            className="rounded-2xl border border-cyan-500/25 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:border-cyan-400/40 hover:bg-cyan-500/15"
          >
            Entrar
          </Link>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-5 py-16">
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-300">
          Mostrador y restaurantes
        </p>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold leading-tight sm:text-5xl">
          La caja, las mesas y el cobro por QR en un solo lugar
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-7 text-zinc-400">
          Da de alta tus productos, abre turno y cobra. El comensal escanea el codigo de su mesa
          para ver el menu y pagar desde su telefono, y el inventario se descuenta con cada venta.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href={SEGMENT_ENTRY_PATH}
            className="rounded-2xl bg-cyan-500 px-5 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-cyan-400"
          >
            Entrar a mi caja
          </Link>
          <Link
            href={segmentRegistrationPath("pos_negocio")}
            className="rounded-2xl border border-white/12 px-5 py-3 text-sm font-semibold text-zinc-200 transition hover:border-white/30 hover:text-white"
          >
            Crear cuenta
          </Link>
        </div>
      </section>

      <section className="border-y border-white/6 bg-zinc-900/30">
        <div className="mx-auto grid max-w-6xl gap-6 px-5 py-14 sm:grid-cols-2 lg:grid-cols-3">
          {CAPACIDADES.map((item) => (
            <article
              key={item.titulo}
              className="rounded-3xl border border-white/8 bg-zinc-900/50 p-6"
            >
              <h2 className="text-lg font-semibold text-white">{item.titulo}</h2>
              <p className="mt-3 text-sm leading-6 text-zinc-400">{item.detalle}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-16">
        <h2 className="text-2xl font-semibold">Planes</h2>
        <p className="mt-2 text-sm text-zinc-400">Precios mensuales por unidad de negocio.</p>
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {PLANES.map((plan) => (
            <article
              key={plan.clave}
              className={`flex flex-col rounded-3xl border p-6 ${
                plan.destacado
                  ? "border-cyan-500/30 bg-cyan-500/5"
                  : "border-white/8 bg-zinc-900/40"
              }`}
            >
              <h3 className="text-lg font-semibold text-white">{plan.nombre}</h3>
              <p className="mt-2 text-3xl font-semibold text-white">
                {plan.precio}
                <span className="text-sm font-normal text-zinc-500"> /mes</span>
              </p>
              <p className="mt-3 text-sm leading-6 text-zinc-400">{plan.resumen}</p>
              <ul className="mt-4 flex-1 space-y-2 text-sm text-zinc-300">
                {plan.incluye.map((linea) => (
                  <li key={linea} className="flex gap-2">
                    <span aria-hidden="true" className="text-cyan-400">
                      +
                    </span>
                    {linea}
                  </li>
                ))}
              </ul>
              <Link
                href={segmentRegistrationPath(plan.clave)}
                className={`mt-6 rounded-2xl px-4 py-3 text-center text-sm font-semibold transition ${
                  plan.destacado
                    ? "bg-cyan-500 text-zinc-950 hover:bg-cyan-400"
                    : "border border-white/12 text-zinc-200 hover:border-white/30 hover:text-white"
                }`}
              >
                Empezar
              </Link>
            </article>
          ))}
        </div>
      </section>

      <footer className="border-t border-white/6">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-8 text-sm text-zinc-500">
          <span>BetterP POS QR</span>
          <nav className="flex gap-5">
            <Link href="/privacy" className="hover:text-zinc-300">
              Privacidad
            </Link>
            <Link href="/terms" className="hover:text-zinc-300">
              Terminos
            </Link>
            <Link href={SEGMENT_ENTRY_PATH} className="hover:text-zinc-300">
              Entrar
            </Link>
            <a
              href={SOURCE_URL}
              target="_blank"
              rel="noreferrer"
              className="hover:text-zinc-300"
            >
              Codigo fuente
            </a>
          </nav>
        </div>
      </footer>
    </main>
  );
}
