import type { Metadata } from "next";
import Link from "next/link";

import BetterPLogo from "@/components/marketing/BetterPLogo";
import ContactLeadForm from "@/components/marketing/ContactLeadForm";
import LandingHostGuard from "@/components/marketing/LandingHostGuard";
import BetterPSocialLinks, { WhatsAppIconLink } from "@/components/marketing/SocialLinks";
import ThemeToggle from "@/components/theme/ThemeToggle";

const WHATSAPP_LINK = "https://wa.me/525551087058";

const heroFeatureCards = [
  {
    label: "Operacion unificada",
    title: "Productos, inventario y catalogos",
    copy:
      "Una sola verdad de productos y existencias alimenta catalogos con reglas de precio distintas para cada canal.",
    tone: "border-cyan-400/18 bg-cyan-400/10 text-cyan-200",
  },
  {
    label: "Venta omnicanal",
    title: "POS, QR, caja y tienda online",
    copy:
      "Vende en mostrador, desde el celular o en tu e-commerce sin separar caja, pedidos, clientes ni stock.",
    tone: "border-emerald-400/18 bg-emerald-400/10 text-emerald-200",
  },
  {
    label: "Postventa",
    title: "Facturacion, envios y reportes",
    copy:
      "Da seguimiento a ventas, pagos y entregas, facilita la facturacion y consulta reportes detallados de la operacion.",
    tone: "border-amber-400/18 bg-amber-400/10 text-amber-200",
  },
];

const resolverCards = [
  {
    label: "Catalogos y reglas",
    title: "Un precio correcto para cada canal",
    copy:
      "Define productos por catalogo y aplica comisiones, envios, recargos o ajustes sin alterar el precio base del producto.",
    footer: "Precio base cuando no existe una regla comercial.",
  },
  {
    label: "Punto de venta",
    title: "Caja, tickets, QR y cobro",
    copy:
      "Registra ventas fisicas, emite tickets y cobra mediante QR o enlace usando el mismo inventario que tu tienda online.",
    footer: "Mostrador y e-commerce dentro de una sola operacion.",
  },
  {
    label: "Marketplaces",
    title: "Canales conectados sin trabajo duplicado",
    copy:
      "Mercado Libre ya opera desde el flujo unificado; Amazon y Walmart forman parte de la siguiente expansión de conectores.",
    footer: "Normalizacion, publicacion, vinculacion y sincronizacion.",
  },
];

const highlightedPoints = [
  {
    label: "Inventario",
    title: "Una verdad de existencias",
    copy:
      "Las ventas y movimientos actualizan el stock central que alimenta los canales conectados.",
  },
  {
    label: "Ventas",
    title: "Pedidos y pagos trazables",
    copy:
      "Consulta el detalle financiero de cada venta sin sobrecargar la operacion diaria.",
  },
  {
    label: "Logistica",
    title: "Envios y seguimiento",
    copy:
      "Centraliza el estado del pedido y del envio para atender la postventa desde un solo lugar.",
  },
  {
    label: "Administracion",
    title: "Facturacion y reportes",
    copy:
      "Facilita la facturacion de compras y mide ventas, conciliacion y rendimiento comercial.",
  },
];

const pricingPlans = [
  {
    key: "micro",
    name: "Micro",
    badge: "Low cost",
    monthly: "$200",
    annual: "$2,000",
    summary: "Para empezar con una tiendita sencilla, catalogo chico y cobro basico.",
    limits: ["1 tienda", "20 productos", "1 usuario", "QR y caja base"],
    includes: [
      "Mi tiendita POS",
      "Catalogo publico",
      "QR por producto",
      "Registro de ventas",
      "Cobro desde celular",
    ],
    tone: "border-sky-400/18 bg-sky-400/10 text-sky-200",
    featured: false,
  },
  {
    key: "starter",
    name: "Starter",
    badge: "Mi tiendita",
    monthly: "$1,499",
    annual: "$14,990",
    summary: "Para operar una tienda sencilla con catalogo, caja, tickets y cobro conectado.",
    limits: ["1 tienda", "Hasta 250 productos u ofertas", "3 usuarios", "Caja y tickets base"],
    includes: [
      "Storefront publico",
      "Mi tiendita POS",
      "QR por producto",
      "Pedidos, caja y clientes",
      "Soporte de activacion",
    ],
    tone: "border-cyan-400/18 bg-cyan-400/10 text-cyan-200",
    featured: false,
  },
  {
    key: "growth",
    name: "Growth",
    badge: "Mas completo",
    monthly: "$3,999",
    annual: "$39,990",
    summary: "Para vender en fisico y en linea con mas catalogos, clientes y reglas comerciales.",
    limits: ["3 tiendas", "Hasta 2,500 productos u ofertas", "10 usuarios", "Catalogos y POS"],
    includes: [
      "Todo Starter",
      "Catalogos por cliente",
      "Cobro QR, NFC y enlaces",
      "Pedidos B2B",
      "Inventario fisico y online",
    ],
    tone: "border-emerald-400/20 bg-emerald-400/10 text-emerald-200",
    featured: true,
  },
  {
    key: "scale",
    name: "Scale",
    badge: "Alto volumen",
    monthly: "$7,999",
    annual: "$79,990",
    summary: "Para operaciones con multiples puntos de venta, tiendas e integraciones.",
    limits: ["Tiendas multiples", "Catalogo extendido", "30 usuarios", "Flujos POS a medida"],
    includes: [
      "Todo Growth",
      "Reglas por canal",
      "Integraciones especiales",
      "Webhooks/API operativa",
      "Go-live guiado",
    ],
    tone: "border-amber-400/20 bg-amber-400/10 text-amber-200",
    featured: false,
  },
];

export const metadata: Metadata = {
  title: "BetterP Commerce | Sistema integral de ventas",
  description:
    "BetterP Commerce unifica productos, inventario, catalogos, reglas de venta, POS, QR, tienda online, marketplaces, facturacion, envios y reportes.",
};

function StorefrontVisual() {
  return (
    <div className="mt-5 overflow-hidden rounded-[18px] border border-white/8 bg-[#07101d] p-4 sm:mt-6 sm:rounded-[28px] sm:p-5">
      <div className="rounded-[22px] border border-cyan-400/15 bg-zinc-950/70 p-4">
        <div className="flex items-center justify-between gap-4 border-b border-white/8 pb-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.22em] text-cyan-200">
              Mi tiendita
            </p>
            <p className="mt-2 text-lg font-semibold text-white">Catalogo online + caja fisica</p>
          </div>
          <span className="rounded-full border border-emerald-300/30 bg-emerald-300/10 px-3 py-1 text-xs font-semibold text-emerald-100">
            Caja abierta
          </span>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          {[
            ["Ventas hoy", "$12.8k", "fisico + online"],
            ["Tickets", "38", "caja abierta"],
            ["Inventario", "1,246", "piezas disponibles"],
          ].map(([label, value, detail]) => (
            <div key={label} className="rounded-2xl border border-white/8 bg-white/[0.04] p-4">
              <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">{label}</p>
              <p className="mt-3 text-2xl font-semibold text-white">{value}</p>
              <p className="mt-1 text-xs text-zinc-500">{detail}</p>
            </div>
          ))}
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-[1fr_0.75fr]">
          <div className="rounded-2xl border border-white/8 bg-white/[0.04] p-4">
            <div className="flex items-center justify-between text-xs text-zinc-500">
              <span>Ventas recientes</span>
              <span>Cobro</span>
            </div>
            {[
              ["Cafe molido 500g", "$180", "QR pagado"],
              ["Servicio express", "$650", "NFC celular"],
              ["Renta sala junta", "$1,200", "Link enviado"],
            ].map(([name, amount, status]) => (
              <div key={name} className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-white/6 bg-zinc-950/60 px-3 py-3">
                <div>
                  <p className="text-sm font-semibold text-white">{name}</p>
                  <p className="mt-1 text-xs text-zinc-500">{amount}</p>
                </div>
                <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-[11px] text-cyan-100">
                  {status}
                </span>
              </div>
            ))}
          </div>

          <div className="rounded-2xl border border-white/8 bg-white/[0.04] p-4">
            <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">
              Mi tiendita
            </p>
            {[
              ["Mostrador", 76],
              ["E-commerce", 58],
              ["QR producto", 44],
            ].map(([label, value]) => (
              <div key={label} className="mt-5">
                <div className="flex justify-between text-sm text-zinc-300">
                  <span>{label}</span>
                  <span>{value}%</span>
                </div>
                <div className="mt-2 h-2 rounded-full bg-white/8">
                  <div
                    className="h-2 rounded-full bg-cyan-300"
                    style={{ width: `${value}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function TiendaFacilPage() {
  return (
    <main className="solution-landing solution-tienda min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.16),transparent_25%),radial-gradient(circle_at_top_right,rgba(16,185,129,0.14),transparent_28%),linear-gradient(180deg,#04070f_0%,#07101d_48%,#050816_100%)] text-white">
      <LandingHostGuard />

      <section className="relative">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/50 to-transparent" />
        <div className="mx-auto flex w-full max-w-7xl flex-col px-5 pb-16 pt-5 sm:px-8 lg:px-10 lg:pb-24 lg:pt-7">
          <header className="sticky top-0 z-40 -mx-5 border-b border-white/6 bg-transparent px-5 py-4 backdrop-blur-md sm:-mx-8 sm:px-8 lg:-mx-10 lg:px-10">
            <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center justify-between gap-3 sm:justify-start">
                <BetterPLogo priority />
                <div className="hidden lg:block">
                  <p className="text-sm font-medium text-zinc-300">
                    Inventario, ventas, POS, e-commerce y marketplaces.
                  </p>
                </div>
                <div className="flex items-center gap-2 sm:hidden">
                  <BetterPSocialLinks variant="dark" />
                  <WhatsAppIconLink variant="dark" className="rounded-full" />
                  <ThemeToggle />
                </div>
              </div>

              <div className="grid w-full grid-cols-[0.92fr_0.98fr_1.1fr] gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:justify-end sm:gap-3 xl:flex-nowrap">
                <Link
                  href="/"
                  className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-2 text-center text-sm text-zinc-200 transition hover:border-cyan-400/40 hover:bg-zinc-900/70 sm:px-4 xl:shrink-0 xl:whitespace-nowrap"
                >
                  Regresar
                </Link>
                <div className="hidden items-center justify-center gap-2 sm:flex">
                  <BetterPSocialLinks variant="dark" />
                  <WhatsAppIconLink variant="dark" className="rounded-full" />
                  <ThemeToggle />
                </div>
                <a
                  href="#planes"
                  className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-center text-sm font-medium text-cyan-100 transition hover:border-cyan-300/60 hover:bg-cyan-400/15 sm:px-4 xl:shrink-0 xl:whitespace-nowrap"
                >
                  Ver planes
                </a>
                <Link
                  href="/soluciones/commerce/entrar"
                  className="rounded-full bg-cyan-300 px-3 py-2 text-center text-sm font-semibold text-zinc-950 transition hover:bg-cyan-200 sm:px-5 sm:py-2.5 xl:shrink-0 xl:whitespace-nowrap"
                >
                  <span className="sm:hidden">Entrar</span>
                  <span className="hidden sm:inline">Entrar al sistema</span>
                </Link>
              </div>
            </div>
          </header>

          <div className="grid items-center gap-8 pt-8 lg:grid-cols-[1.02fr_0.98fr] lg:gap-18 lg:pt-18">
            <div className="max-w-4xl">
              <div className="inline-flex flex-col">
                <span className="text-[11px] uppercase tracking-[0.28em] text-cyan-200">
                  Sistema integral de ventas
                </span>
                <h1 className="mt-4 text-4xl font-semibold leading-none text-white sm:text-6xl lg:text-7xl">
                  <span>BetterP</span>
                  <span className="text-cyan-300">Commerce</span>
                </h1>
                <p className="mt-3 text-base text-zinc-500 sm:text-lg">
                  Toda tu operacion comercial en un solo sistema
                </p>
              </div>
              <h2 className="mt-6 max-w-4xl text-3xl font-semibold leading-[1.08] text-white sm:mt-8 sm:text-5xl sm:leading-[1.05] lg:text-7xl">
                Vende en cualquier canal sin duplicar productos, inventario ni trabajo.
              </h2>
              <p className="mt-6 max-w-2xl text-left text-base leading-8 text-zinc-300 sm:text-lg sm:leading-9 lg:max-w-3xl [text-wrap:pretty]">
                BetterP Commerce integra el catalogo maestro, las reglas de venta por
                canal, el POS, la tienda online y los marketplaces con facturacion,
                envios y reportes para operar todo el ciclo de la venta.
              </p>

              <div className="mt-8 grid gap-3 sm:flex sm:flex-wrap">
                <a
                  href="#contacto"
                  className="rounded-full bg-cyan-300 px-6 py-3 text-center text-sm font-semibold text-zinc-950 transition hover:bg-cyan-200"
                >
                  Solicitar demo
                </a>
                <a
                  href="#planes"
                  className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-6 py-3 text-center text-sm font-semibold text-cyan-100 transition hover:border-cyan-300/60 hover:bg-cyan-400/15"
                >
                  Ver planes
                </a>
                <a
                  href={WHATSAPP_LINK}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-full border border-white/10 px-6 py-3 text-center text-sm text-zinc-200 transition hover:border-zinc-600 hover:bg-zinc-900/70"
                >
                  Hablar por WhatsApp
                </a>
              </div>
            </div>

            <div className="relative">
              <div className="relative overflow-hidden rounded-[24px] border border-white/8 bg-zinc-950/75 p-3 shadow-[0_28px_80px_rgba(0,0,0,0.36)] backdrop-blur-xl sm:rounded-[32px] sm:p-6">
                <div className="rounded-[20px] border border-cyan-400/15 bg-[linear-gradient(160deg,rgba(8,15,29,0.95),rgba(7,12,22,0.78))] p-4 sm:rounded-[30px] sm:p-6">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.18em] text-cyan-200 sm:text-[11px] sm:tracking-[0.28em]">
                        Lectura comercial
                      </p>
                      <h2 className="mt-2 text-xl font-semibold leading-snug text-white sm:text-2xl">
                        Catalogos, inventario, canales, ventas y postventa en una misma operacion.
                      </h2>
                    </div>
                    <div className="flex min-h-[92px] w-full flex-col justify-center rounded-2xl border border-white/8 bg-white/5 px-4 py-3 sm:min-h-[112px] sm:w-[200px] sm:items-center sm:text-center">
                      <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 sm:tracking-[0.22em]">
                        Resultado
                      </p>
                      <p className="mt-2 text-base font-semibold leading-7 text-white sm:text-lg">
                        Comercio conectado de punta a punta
                      </p>
                    </div>
                  </div>

                  <StorefrontVisual />
                </div>
              </div>
            </div>
          </div>

          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {heroFeatureCards.map((item) => (
              <article
                key={item.label}
                className={`rounded-[20px] border px-5 py-5 text-center shadow-[0_18px_54px_rgba(0,0,0,0.18)] sm:rounded-[28px] sm:px-6 sm:py-7 ${item.tone}`}
              >
                <p className="text-[11px] uppercase tracking-[0.24em]">
                  {item.label}
                </p>
                <p className="mt-3 text-3xl font-semibold leading-tight text-white sm:mt-4 sm:text-[2.35rem] sm:leading-none">
                  {item.title}
                </p>
                <p className="mt-3 text-sm leading-7 text-zinc-300/90 sm:mt-5">
                  {item.copy}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y border-white/6 bg-zinc-950/45">
        <div className="mx-auto max-w-7xl px-5 py-16 sm:px-8 lg:px-10 lg:py-20">
          <div className="grid gap-10 lg:grid-cols-[0.72fr_1.28fr] lg:gap-16">
            <div>
              <p className="text-[11px] uppercase tracking-[0.26em] text-cyan-200">
                BetterP Commerce en una frase
              </p>
              <h2 className="mt-4 text-3xl font-semibold text-white sm:text-4xl">
                Una sola plataforma para preparar, vender y atender cada operacion.
              </h2>
              <p className="mt-5 max-w-xl text-left text-base leading-8 text-zinc-400 [text-wrap:pretty]">
                El producto y su inventario son la fuente central. Los catalogos deciden
                que se vende en cada canal y aplican sus propias reglas comerciales antes
                de publicar o actualizar el precio.
              </p>
              <p className="mt-4 max-w-xl text-left text-base leading-8 text-zinc-400 [text-wrap:pretty]">
                El mismo flujo soporta caja y QR, tienda online, Mercado Libre, pedidos,
                pagos, envios, facturacion y reportes. Amazon y Walmart se integraran
                sobre este mismo contrato de canales, no como sistemas separados.
              </p>
            </div>

            <div className="grid gap-5 lg:grid-cols-3">
              {resolverCards.map((card) => (
                <article
                  key={card.title}
                  className="flex h-full flex-col rounded-[20px] border border-white/8 bg-zinc-900/50 p-5 text-center sm:rounded-[30px]"
                >
                  <p className="text-[11px] uppercase tracking-[0.22em] text-cyan-200">
                    {card.label}
                  </p>
                  <h3 className="mt-3 text-xl font-semibold text-white sm:text-2xl">
                    {card.title}
                  </h3>
                  <p className="mt-4 text-sm leading-7 text-zinc-400">
                    {card.copy}
                  </p>
                  <p className="mt-auto pt-6 text-xs uppercase tracking-[0.18em] text-zinc-500">
                    {card.footer}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="bg-[#07101d]">
        <div className="mx-auto max-w-7xl px-5 py-18 sm:px-8 lg:px-10 lg:py-24">
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-[11px] uppercase tracking-[0.28em] text-cyan-200">
              Lo destacado
            </p>
            <h2 className="mt-4 text-3xl font-semibold text-white sm:text-4xl">
              Del inventario a la postventa sin duplicar trabajo.
            </h2>
            <p className="mt-5 text-base leading-8 text-zinc-400 [text-wrap:pretty]">
              BetterP Commerce conecta el producto, el canal, la venta, el cobro, el
              envio y la facturacion para dar una lectura completa del negocio.
            </p>
          </div>

          <div className="mt-10 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
            {highlightedPoints.map((point) => (
              <article
                key={point.title}
                className="flex h-full flex-col rounded-[20px] border border-white/8 bg-zinc-950/60 p-5 text-center shadow-[0_20px_64px_rgba(0,0,0,0.2)] sm:rounded-[30px] sm:p-6"
              >
                <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-200">
                  {point.label}
                </p>
                <h3 className="mt-5 text-2xl font-semibold text-white">
                  {point.title}
                </h3>
                <p className="mt-4 text-sm leading-7 text-zinc-400">
                  {point.copy}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="planes" className="border-t border-white/6 bg-zinc-950/80">
        <div className="mx-auto max-w-7xl px-5 py-16 sm:px-8 lg:px-10 lg:py-20">
          <div className="grid gap-8 lg:grid-cols-[0.72fr_1.28fr] lg:items-end">
            <div>
              <p className="text-[11px] uppercase tracking-[0.28em] text-cyan-200">
                Planes BetterP Commerce
              </p>
              <h2 className="mt-4 text-3xl font-semibold text-white sm:text-4xl">
                Empieza desde $200 y crece hacia e-commerce completo.
              </h2>
              <p className="mt-5 max-w-2xl text-base leading-8 text-zinc-400 [text-wrap:pretty]">
                El precio escala por cantidad de tiendas, puntos de venta, catalogo,
                usuarios, tickets, compradores, reglas comerciales e integraciones.
              </p>
            </div>
            <div className="rounded-[24px] border border-cyan-400/20 bg-cyan-400/10 p-5 text-cyan-50 sm:rounded-[32px] sm:p-6">
              <p className="text-[11px] uppercase tracking-[0.22em] text-cyan-200">
                Activacion guiada
              </p>
              <div className="mt-3 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <p className="max-w-xl text-sm leading-7 text-cyan-50/90">
                  Revisamos si venderas en linea, en mostrador, por QR, con NFC o con
                  links de pago para configurar el flujo correcto desde el primer dia.
                </p>
                <a
                  href="#contacto"
                  className="inline-flex shrink-0 items-center justify-center rounded-full bg-cyan-300 px-5 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-cyan-200"
                >
                  Solicitar demo
                </a>
              </div>
            </div>
          </div>

          <div className="mt-10 grid gap-5 lg:grid-cols-2 xl:grid-cols-4">
            {pricingPlans.map((plan) => (
              <article
                key={plan.name}
                className={`relative flex h-full flex-col rounded-[24px] border p-6 shadow-[0_22px_70px_rgba(0,0,0,0.22)] sm:rounded-[34px] ${
                  plan.featured
                    ? "border-emerald-300/35 bg-emerald-400/10"
                    : "border-white/8 bg-zinc-900/55"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className={`rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.18em] ${plan.tone}`}>
                    {plan.badge}
                  </span>
                  {plan.featured ? (
                    <span className="rounded-full bg-emerald-300 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-950">
                      Recomendado
                    </span>
                  ) : null}
                </div>

                <h3 className="mt-6 text-3xl font-semibold text-white">{plan.name}</h3>
                <p className="mt-3 min-h-[84px] text-sm leading-7 text-zinc-400">
                  {plan.summary}
                </p>

                <div className="mt-6 rounded-3xl border border-white/8 bg-zinc-950/55 p-5">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">
                    Desde
                  </p>
                  <div className="mt-2 flex items-end gap-2">
                    <span className="text-4xl font-semibold text-white">
                      {plan.monthly}
                    </span>
                    <span className="pb-1 text-sm text-zinc-500">/ mes</span>
                  </div>
                  <p className="mt-2 text-sm text-zinc-500">
                    Anual: {plan.annual}
                  </p>
                  <p className="mt-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-xs font-semibold text-cyan-100">
                    Compra anual: pagas 10 meses y recibes 12
                  </p>
                </div>

                <div className="mt-6 grid gap-2 text-sm text-zinc-300">
                  {plan.limits.map((item) => (
                    <p key={item} className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
                      {item}
                    </p>
                  ))}
                </div>

                <div className="mt-6">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">
                    Incluye
                  </p>
                  <ul className="mt-3 space-y-3 text-sm leading-6 text-zinc-300">
                    {plan.includes.map((item) => (
                      <li key={item} className="flex gap-3">
                        <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-300" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <a
                  href="#contacto"
                  className={`mt-auto inline-flex items-center justify-center rounded-full px-5 py-3 text-sm font-semibold transition ${
                    plan.featured
                      ? "bg-emerald-300 text-zinc-950 hover:bg-emerald-200"
                      : "border border-white/10 bg-white/[0.03] text-zinc-100 hover:border-cyan-400/40 hover:bg-cyan-400/10"
                  }`}
                >
                  Solicitar activacion
                </a>
              </article>
            ))}
          </div>

          <div className="mt-8 grid gap-4 lg:grid-cols-2">
            <div className="rounded-[24px] border border-white/8 bg-zinc-900/45 p-5 text-sm leading-7 text-zinc-400 sm:rounded-[32px] sm:p-6">
              Los precios son referencia comercial para el servicio contratado.
              Integraciones especiales, migracion de datos, pasarelas adicionales,
              reglas complejas de punto de venta o trabajo personalizado se revisan
              antes de activar la cuenta productiva.
            </div>
            <div className="rounded-[24px] border border-emerald-400/20 bg-emerald-400/10 p-5 text-sm leading-7 text-emerald-50/90 sm:rounded-[32px] sm:p-6">
              <p className="text-[11px] uppercase tracking-[0.22em] text-emerald-200">
                A medida
              </p>
              <p className="mt-2">
                Si necesitas multiples marcas, catalogos complejos, flujos B2B o
                operacion fisica con varios puntos de venta, armamos una activacion a medida.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section id="contacto" className="border-t border-white/6 bg-zinc-950/80">
        <div className="mx-auto max-w-7xl px-5 py-16 sm:px-8 lg:px-10 lg:py-20">
          <div className="mx-auto max-w-4xl">
            <ContactLeadForm
              variant="dark"
              solutionKey="tienda_facil"
              solutionName="BetterP Commerce"
            />
          </div>
        </div>
      </section>

      <footer className="border-t border-white/6 bg-[#050816]">
        <div className="mx-auto grid max-w-7xl gap-6 px-5 py-10 sm:px-8 lg:grid-cols-[1fr_1.25fr] lg:px-10">
          <div>
            <BetterPLogo className="h-auto w-[154px]" />
            <p className="mt-4 max-w-md text-sm leading-7 text-zinc-400">
              Plataforma para crear tiendas, catalogos, checkout, pedidos y clientes
              conectados a la operacion BetterP.
            </p>
          </div>

          <div className="grid gap-8 sm:grid-cols-3">
            <nav aria-label="Mapa del sitio">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-200">
                Mapa del sitio
              </p>
              <div className="mt-4 grid gap-3 text-sm text-zinc-400">
                <Link href="/" className="hover:text-cyan-200">
                  Inicio
                </Link>
                <a href="#planes" className="hover:text-cyan-200">
                  Planes BetterP Commerce
                </a>
                <a href="#contacto" className="hover:text-cyan-200">
                  Solicitar demo
                </a>
              </div>
            </nav>

            <nav aria-label="Soluciones BetterP">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-200">
                Soluciones
              </p>
              <div className="mt-4 grid gap-3 text-sm text-zinc-400">
                <Link href="/soluciones/renta-facil" className="hover:text-cyan-200">
                  Renta Facil
                </Link>
                <Link href="/soluciones/commerce" className="hover:text-cyan-200">
                  BetterP Commerce
                </Link>
              </div>
            </nav>

            <nav aria-label="Legal">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-200">
                Legal
              </p>
              <div className="mt-4 grid gap-3 text-sm text-zinc-400">
                <Link href="https://betterp.net/privacy" className="hover:text-cyan-200">
                  Privacidad
                </Link>
                <Link href="https://betterp.net/terms" className="hover:text-cyan-200">
                  Terminos
                </Link>
              </div>
            </nav>
          </div>

        </div>
      </footer>
    </main>
  );
}
