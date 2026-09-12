import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import BetterPLogo from "@/components/marketing/BetterPLogo";
import ContactLeadForm from "@/components/marketing/ContactLeadForm";
import LandingHostGuard from "@/components/marketing/LandingHostGuard";
import BetterPSocialLinks, { WhatsAppIconLink } from "@/components/marketing/SocialLinks";
import ThemeToggle from "@/components/theme/ThemeToggle";
import { solutionRegistrationPath } from "@/lib/solution-launch";

const WHATSAPP_LINK = "https://wa.me/525551087058";

const heroFeatureCards = [
  {
    label: "Módulo de espacios",
    title: "Control de ocupación",
    copy:
      "Consulta disponibilidad, asignaciones, entradas y salidas desde una sola vista. Cuando un espacio queda libre u ocupado, el sistema mantiene la operación actualizada.",
    tone: "border-cyan-400/18 bg-cyan-400/10 text-cyan-200",
  },
  {
    label: "Módulo de clientes",
    title: "Expediente central",
    copy:
      "Guarda datos generales, contratos e información de facturación. Información detallada desde el inicio de tu operación.",
    tone: "border-teal-400/18 bg-teal-400/10 text-teal-200",
  },
  {
    label: "Módulo de cobranza",
    title: "Cargos y saldos",
    copy:
      "Genera cargos, recargos y cuentas por cobrar. Automatiza recordatorios, valida pagos contra bancos e identifica rápido qué sigue pendiente.",
    tone: "border-fuchsia-400/18 bg-fuchsia-400/10 text-fuchsia-200",
  },
  {
    label: "Módulo bancario",
    title: "Conciliación rápida",
    copy:
      "Carga estados de cuenta y cruza depósitos, retiros y pagos. Ahorra revisión manual y detecta pendientes o duplicados.",
    tone: "border-rose-400/18 bg-rose-400/10 text-rose-200",
  },
  {
    label: "Módulo de gastos",
    title: "Egresos controlados",
    copy:
      "Registra proveedores, conceptos y salidas de dinero. Cada egreso alimenta saldos, reportes, proyecciones y la liquidez diaria.",
    tone: "border-indigo-400/18 bg-indigo-400/10 text-indigo-200",
  },
  {
    label: "Portal cliente",
    title: "Autoservicio",
    copy:
      "Tus clientes consultan historial, saldos, pagos, facturas y documentos desde un enlace conectado a BettERP.",
    tone: "border-amber-400/18 bg-amber-400/10 text-amber-200",
  },
];

const resolverCards = [
  {
    label: "Operación",
    icon: "network",
    tone: "border-cyan-400/18 bg-cyan-400/10 text-cyan-200",
    title: "Del retrabajo a la automatización",
    copy:
      "Al tener espacios, clientes, pagos, gastos y bancos integrados, el sistema reduce capturas duplicadas y convierte tareas repetitivas en procesos automáticos.",
    footer: "Menos tiempo operando, más resultados para administrar.",
  },
  {
    label: "Indicadores",
    icon: "eye",
    tone: "border-emerald-400/18 bg-emerald-400/10 text-emerald-200",
    title: "Decisiones ágiles",
    copy:
      "Un dashboard con información confiable te ayuda a revisar pendientes, ingresos, egresos y saldos para decidir rápido sin armar reportes desde cero.",
    footer: "Datos claros para tomar mejores decisiones de negocio.",
  },
  {
    label: "Flujo",
    icon: "chat",
    tone: "border-violet-400/18 bg-violet-400/10 text-violet-200",
    title: "Procesos más simples",
    copy:
      "Capta solicitudes, quejas, clientes y pagos por canales como WhatsApp para que el seguimiento quede ligado a la operación.",
    footer: "Más trazabilidad, menos mensajes perdidos.",
  },
];

const highlightedPoints = [
  {
    label: "Canales",
    title: "Publicación automática",
    icon: "listing",
    tone: "border-cyan-400/18 bg-cyan-400/10 text-cyan-200",
    copy:
      "Sube espacios disponibles a canales como Airbnb, Booking, Mercado Libre o Metros Cúbicos y baja anuncios cuando se ocupan.",
    footer: "Disponibilidad conectada con la venta.",
  },
  {
    label: "Reglas",
    title: "Precios por proveedor",
    icon: "price-rules",
    tone: "border-emerald-400/18 bg-emerald-400/10 text-emerald-200",
    copy:
      "Registra de qué plataforma llegó cada contratación y aplica reglas por comisión, servicio, promoción o temporada alta.",
    footer: "Cada canal opera con sus condiciones.",
  },
  {
    label: "Comunicación",
    title: "WhatsApp conectado",
    icon: "chat",
    tone: "border-violet-400/18 bg-violet-400/10 text-violet-200",
    copy:
      "Recibe quejas, datos de clientes y comprobantes de pago por WhatsApp para dar seguimiento sin perder contexto.",
    footer: "Atención, cobranza y operación en una misma línea.",
  },
  {
    label: "Finanzas",
    title: "Liquidez al día",
    icon: "liquidity",
    tone: "border-amber-400/18 bg-amber-400/10 text-amber-200",
    copy:
      "Controla gastos, saldos, ingresos y egresos para generar resúmenes de liquidez y proyecciones financieras.",
    footer: "Una lectura clara para decidir a tiempo.",
  },
];

const pricingPlans = [
  {
    key: "micro",
    name: "Micro",
    badge: "Desde $200",
    monthly: "$200",
    annual: "$2,000",
    summary: "Todo Renta Facil para empezar con una operacion muy chica y validar el flujo completo.",
    limits: [
      "1 usuario",
      "1 unidad de negocio",
      "3 espacios",
      "50 mensajes WhatsApp",
      "20 comprobantes OCR",
      "10 timbres CFDI",
    ],
    includes: [
      "Todos los modulos",
      "Cobranza y portal cliente",
      "Facturacion CFDI",
      "OCR de comprobantes",
      "Automatizaciones y webhooks",
    ],
    tone: "border-sky-400/18 bg-sky-400/10 text-sky-200",
    featured: false,
  },
  {
    key: "starter",
    name: "Starter",
    badge: "Para iniciar",
    monthly: "$1,499",
    annual: "$14,990",
    summary: "Misma funcionalidad completa con mas capacidad para cartera, espacios y cobranza.",
    limits: [
      "3 usuarios",
      "3 unidades de negocio",
      "40 espacios",
      "200 mensajes WhatsApp",
      "100 comprobantes OCR",
      "50 timbres CFDI",
    ],
    includes: [
      "Todos los modulos",
      "Cobranza y portal cliente",
      "Facturacion CFDI",
      "OCR de comprobantes",
      "Automatizaciones y webhooks",
    ],
    tone: "border-cyan-400/18 bg-cyan-400/10 text-cyan-200",
    featured: false,
  },
  {
    key: "growth",
    name: "Growth",
    badge: "Mas elegido",
    monthly: "$3,499",
    annual: "$34,990",
    summary: "Misma funcionalidad completa para operacion multi-entidad y mayor volumen mensual.",
    limits: [
      "10 usuarios",
      "15 unidades de negocio",
      "250 espacios",
      "1,000 mensajes WhatsApp",
      "500 comprobantes OCR",
      "250 timbres CFDI",
    ],
    includes: [
      "Todos los modulos",
      "Cobranza y portal cliente",
      "Facturacion CFDI",
      "OCR de comprobantes",
      "Automatizaciones y webhooks",
    ],
    tone: "border-emerald-400/20 bg-emerald-400/10 text-emerald-200",
    featured: true,
  },
  {
    key: "scale",
    name: "Scale",
    badge: "Portafolio amplio",
    monthly: "$6,999",
    annual: "$69,990",
    summary: "Misma funcionalidad completa para alto volumen, equipos distribuidos y portafolios amplios.",
    limits: [
      "50 usuarios",
      "100 unidades de negocio",
      "2,000 espacios",
      "5,000 mensajes WhatsApp",
      "2,000 comprobantes OCR",
      "1,000 timbres CFDI",
    ],
    includes: [
      "Todos los modulos",
      "Cobranza y portal cliente",
      "Facturacion CFDI",
      "OCR de comprobantes",
      "Automatizaciones y webhooks",
    ],
    tone: "border-violet-400/20 bg-violet-400/10 text-violet-200",
    featured: false,
  },
];

export const metadata: Metadata = {
  title: "ERP para hoteles, coliving y condominios",
  description:
    "BettERP centraliza ocupacion, canales de venta, cobranza, gastos, conciliacion bancaria, portal cliente y liquidez para hoteles, coliving y condominios. Agenda una demo o consulta los planes.",
};

function HighlightIcon({ kind }: { kind: string }) {
  const iconClassName = "h-6 w-6 stroke-current";

  if (kind === "cube") {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        className={iconClassName}
      >
        <path
          d="M12 3.5 19 7.5v9L12 20.5l-7-4v-9l7-4Z"
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
        <path d="M12 3.5v17" strokeWidth="1.7" strokeLinejoin="round" />
        <path d="M5 7.5 12 12l7-4.5" strokeWidth="1.7" strokeLinejoin="round" />
      </svg>
    );
  }

  if (kind === "growth") {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        className={iconClassName}
      >
        <path d="M4 18h16" strokeWidth="1.7" strokeLinecap="round" />
        <path
          d="m6 15 4-4 3 3 5-6"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M14 8h4v4"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (kind === "network") {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        className={iconClassName}
      >
        <circle cx="6.5" cy="6.5" r="2.2" strokeWidth="1.7" />
        <circle cx="17.5" cy="6.5" r="2.2" strokeWidth="1.7" />
        <circle cx="12" cy="17.5" r="2.2" strokeWidth="1.7" />
        <path d="M8.8 6.5h6.4" strokeWidth="1.7" strokeLinecap="round" />
        <path d="M8.2 8.1 10.8 15" strokeWidth="1.7" strokeLinecap="round" />
        <path d="m15.8 8.1-2.6 6.9" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }

  if (kind === "eye") {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        className={iconClassName}
      >
        <path
          d="M3.5 12s3-5 8.5-5 8.5 5 8.5 5-3 5-8.5 5-8.5-5-8.5-5Z"
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
        <circle cx="12" cy="12" r="2.6" strokeWidth="1.7" />
      </svg>
    );
  }

  if (kind === "listing") {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        className={iconClassName}
      >
        <rect x="4" y="5" width="16" height="13" rx="2.5" strokeWidth="1.7" />
        <path d="M7.5 9h5" strokeWidth="1.7" strokeLinecap="round" />
        <path d="M7.5 12.5h8.5" strokeWidth="1.7" strokeLinecap="round" />
        <path d="M7.5 16h4.5" strokeWidth="1.7" strokeLinecap="round" />
        <path
          d="m16.5 7.2 1.1 1.1 2-2"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (kind === "price-rules") {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        className={iconClassName}
      >
        <path
          d="M4.5 7.5h8.2l6.8 6.8-5.2 5.2-6.8-6.8V4.5h4"
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
        <circle cx="10.2" cy="8.8" r="1.2" strokeWidth="1.7" />
        <path d="M13.3 15.8 17 12.1" strokeWidth="1.7" strokeLinecap="round" />
        <circle cx="13" cy="12" r=".8" fill="currentColor" />
        <circle cx="17.2" cy="16.1" r=".8" fill="currentColor" />
      </svg>
    );
  }

  if (kind === "chat") {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        className={iconClassName}
      >
        <path
          d="M5 6.5h14v9.2H10l-4.2 3.2v-3.2H5V6.5Z"
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
        <path d="M8.5 10h7" strokeWidth="1.7" strokeLinecap="round" />
        <path d="M8.5 13h4.8" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }

  if (kind === "liquidity") {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        className={iconClassName}
      >
        <path d="M4 18.5h16" strokeWidth="1.7" strokeLinecap="round" />
        <path
          d="M6 16v-4.5"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
        <path d="M10 16V8" strokeWidth="1.7" strokeLinecap="round" />
        <path d="M14 16v-6" strokeWidth="1.7" strokeLinecap="round" />
        <path d="M18 16V5.5" strokeWidth="1.7" strokeLinecap="round" />
        <path
          d="m5.8 9.8 3.1-2.9 3.4 2.5 5.2-5"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (kind === "automation") {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        className={iconClassName}
      >
        <path
          d="M12 4.5 14 8.5l4.5.6-3.2 3.1.8 4.3L12 14.6l-4.1 1.9.8-4.3-3.2-3.1 4.5-.6 2-4Z"
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
        <path d="M19 5.5v3" strokeWidth="1.7" strokeLinecap="round" />
        <path d="M20.5 7h-3" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }

  if (kind === "time-plus") {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        className={iconClassName}
      >
        <circle cx="10" cy="13" r="6" strokeWidth="1.7" />
        <path
          d="M10 10v3.2l2.2 1.6"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M17.5 5.5v4" strokeWidth="1.7" strokeLinecap="round" />
        <path d="M19.5 7.5h-4" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      className={iconClassName}
    >
      <path d="M5 7h14" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M5 12h10" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M5 17h14" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="16.5" cy="12" r="2" strokeWidth="1.7" />
      <circle cx="8.5" cy="7" r="2" strokeWidth="1.7" />
      <circle cx="13.5" cy="17" r="2" strokeWidth="1.7" />
    </svg>
  );
}

export default function LandingPage() {
  return (
    <main className="solution-landing solution-renta min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.16),transparent_25%),radial-gradient(circle_at_top_right,rgba(59,130,246,0.18),transparent_28%),linear-gradient(180deg,#04070f_0%,#070b14_48%,#050816_100%)] text-white">
      <LandingHostGuard />

      <section className="relative">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-400/50 to-transparent" />
        <div className="mx-auto flex w-full max-w-7xl flex-col px-5 pb-16 pt-5 sm:px-8 lg:px-10 lg:pb-24 lg:pt-7">
          <header className="sticky top-0 z-40 -mx-5 border-b border-white/6 bg-transparent px-5 py-4 backdrop-blur-md sm:-mx-8 sm:px-8 lg:-mx-10 lg:px-10">
            <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center justify-between gap-3 sm:justify-start">
                <BetterPLogo alt="BettERP" priority />
                <div className="hidden xl:block">
                  <p className="text-sm font-medium text-zinc-300">
                    Administración para hoteles, coliving y condominios.
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
                  href="/soluciones/renta-facil/entrar"
                  className="rounded-full bg-cyan-400 px-3 py-2 text-center text-sm font-semibold text-zinc-950 transition hover:bg-cyan-300 sm:px-5 sm:py-2.5 xl:shrink-0 xl:whitespace-nowrap"
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
                  ERP especializado para propiedades
                </span>
                <h1 className="mt-4 text-4xl font-semibold leading-none text-white sm:text-6xl lg:text-7xl">
                  <span>Renta</span>
                  <span className="text-cyan-300">Facil</span>
                </h1>
                <p className="mt-3 text-base text-zinc-500 sm:text-lg">
                  Operacion de rentas, espacios y propiedades
                </p>
              </div>
              <h2 className="mt-6 max-w-4xl text-3xl font-semibold leading-[1.08] text-white sm:mt-8 sm:text-5xl sm:leading-[1.05] lg:text-7xl">
                Controla ocupación, cobranza y operación de hoteles, coliving y condominios.
              </h2>
              <p className="mt-6 max-w-2xl text-left text-base leading-8 text-zinc-300 sm:text-lg sm:leading-9 lg:max-w-3xl [text-wrap:pretty]">
                BettERP está pensado para negocios que viven de administrar espacios:
                habitaciones, departamentos, locales, cuotas y rentas. Centraliza la
                operación para que tu administración y operación trabajen con la misma
                información en un solo lugar.
              </p>

              <div className="mt-8 grid gap-3 sm:flex sm:flex-wrap">
                <a
                  href="#contacto"
                  className="rounded-full bg-cyan-400 px-6 py-3 text-center text-sm font-semibold text-zinc-950 transition hover:bg-cyan-300"
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
                        Lectura ejecutiva
                      </p>
                      <h2 className="mt-2 text-xl font-semibold leading-snug text-white sm:text-2xl">
                        Una vista clara de ocupación, pagos y pendientes.
                      </h2>
                    </div>
                    <div className="flex min-h-[92px] w-full flex-col justify-center rounded-2xl border border-white/8 bg-white/5 px-4 py-3 sm:min-h-[112px] sm:w-[200px] sm:items-center sm:text-center">
                      <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 sm:tracking-[0.22em]">
                        Resultado
                      </p>
                      <p className="mt-2 text-base font-semibold leading-7 text-white sm:text-lg">
                        Operación y finanzas conectadas
                      </p>
                    </div>
                  </div>

                  <div className="mt-5 overflow-hidden rounded-[18px] border border-white/8 bg-[#07101d] sm:mt-6 sm:rounded-[28px]">
                    <Image
                      src="/landing-hero-visual.svg"
                      alt="Vista ejecutiva de BettERP"
                      width={1200}
                      height={920}
                      className="theme-logo-dark h-auto w-full"
                      priority
                    />
                    <Image
                      src="/landing-hero-visual-light.svg"
                      alt="Vista ejecutiva de BettERP"
                      width={1200}
                      height={920}
                      className="theme-logo-light h-auto w-full"
                      priority
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {heroFeatureCards.map((item) => (
              <article
                key={item.label}
                className={`rounded-[20px] border px-5 py-5 text-center shadow-[0_18px_54px_rgba(0,0,0,0.18)] sm:rounded-[28px] sm:px-6 sm:py-7 ${item.tone}`}
              >
                <p className="text-[11px] uppercase tracking-[0.24em]">
                  {item.label}
                </p>
                <p className="mt-3 text-3xl font-semibold leading-tight text-white sm:mt-4 sm:text-[2.55rem] sm:leading-none">
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
                BettERP en una frase
              </p>
              <h2 className="mt-4 text-3xl font-semibold text-white sm:text-4xl">
                BettERP simplifica tu operación.
              </h2>
              <p className="mt-5 max-w-xl text-left text-base leading-8 text-zinc-400 [text-wrap:pretty]">
                Haz que la administración de tu negocio no dependa de reportes a mano.
                Suelta el Excel y empieza a operar espacios, canales, cobranza, gastos
                y bancos desde un solo lugar.
              </p>
              <p className="mt-4 max-w-xl text-left text-base leading-8 text-zinc-400 [text-wrap:pretty]">
                Cuando un dato se actualiza en un módulo, el resto del sistema mantiene
                la relación. Eso ahorra tiempo, reduce errores de captura y convierte
                trabajo repetitivo en procesos automáticos.
              </p>
            </div>

            <div className="grid gap-5 lg:grid-cols-3">
              {resolverCards.map((card) => (
                <article
                  key={card.title}
                  className="flex h-full flex-col rounded-[20px] border border-white/8 bg-zinc-900/50 p-5 text-center sm:rounded-[30px]"
                >
                  <div className={`mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl ${card.tone}`}>
                    <HighlightIcon kind={card.icon} />
                  </div>
                  <p className="mt-5 text-[11px] uppercase tracking-[0.22em] text-cyan-200">
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
              Automatiza más que la administración interna.
            </h2>
            <p className="mt-5 text-base leading-8 text-zinc-400 [text-wrap:pretty]">
              BettERP conecta disponibilidad, canales de venta, portal cliente,
              WhatsApp, bancos y finanzas para que la operación avance con menos
              captura manual.
            </p>
          </div>

          <div className="mt-10 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
            {highlightedPoints.map((point) => (
              <article
                key={point.title}
                className="flex h-full flex-col rounded-[20px] border border-white/8 bg-zinc-950/60 p-5 text-center shadow-[0_20px_64px_rgba(0,0,0,0.2)] sm:rounded-[30px] sm:p-6"
              >
                <div className={`mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl ${point.tone}`}>
                  <HighlightIcon kind={point.icon} />
                </div>
                <p className="mt-5 text-[11px] uppercase tracking-[0.24em] text-zinc-500">
                  {point.label}
                </p>
                <h3 className="mt-5 text-2xl font-semibold text-white">
                  {point.title}
                </h3>
                <p className="mt-4 text-sm leading-7 text-zinc-400">
                  {point.copy}
                </p>
                <div className="mt-auto pt-7">
                  <div className="mx-auto h-px w-16 bg-white/8" />
                  <p className="mx-auto mt-4 max-w-[18rem] text-xs uppercase tracking-[0.16em] text-zinc-500 sm:tracking-[0.18em]">
                    {point.footer}
                  </p>
                </div>
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
                Planes BetterP
              </p>
              <h2 className="mt-4 text-3xl font-semibold text-white sm:text-4xl">
                Elige el plan segun la escala de tu operacion.
              </h2>
              <p className="mt-5 max-w-2xl text-base leading-8 text-zinc-400 [text-wrap:pretty]">
                Todos los planes tienen la funcionalidad completa de Renta Facil. Lo
                que cambia es el volumen incluido: unidades de negocio, espacios,
                usuarios, mensajes, comprobantes OCR, timbres, correos y consumos de IA.
              </p>
            </div>
            <div className="rounded-[24px] border border-cyan-400/20 bg-cyan-400/10 p-5 text-cyan-50 sm:rounded-[32px] sm:p-6">
              <p className="text-[11px] uppercase tracking-[0.22em] text-cyan-200">
                Demo guiada
              </p>
              <div className="mt-3 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <p className="max-w-xl text-sm leading-7 text-cyan-50/90">
                  Te mostramos BetterP aplicado a tu tipo de operacion. Si despues
                  conviene probar con datos reales, el equipo puede habilitar una
                  prueba controlada para tu cuenta.
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
                    ? "border-cyan-300/35 bg-cyan-400/10"
                    : "border-white/8 bg-zinc-900/55"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className={`rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.18em] ${plan.tone}`}>
                    {plan.badge}
                  </span>
                  {plan.featured ? (
                    <span className="rounded-full bg-cyan-300 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-950">
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
                  <p className="mt-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-100">
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
                  href={solutionRegistrationPath(plan.key)}
                  className={`mt-auto inline-flex items-center justify-center rounded-full px-5 py-3 text-sm font-semibold transition ${
                    plan.featured
                      ? "bg-cyan-300 text-zinc-950 hover:bg-cyan-200"
                      : "border border-white/10 bg-white/[0.03] text-zinc-100 hover:border-cyan-400/40 hover:bg-cyan-400/10"
                  }`}
                >
                  Contratar plan
                </a>
              </article>
            ))}
          </div>

          <div className="mt-8 grid gap-4 lg:grid-cols-2">
            <div className="rounded-[24px] border border-white/8 bg-zinc-900/45 p-5 text-sm leading-7 text-zinc-400 sm:rounded-[32px] sm:p-6">
              Los precios son referencia comercial para el servicio contratado. Todos los
              planes incluyen los mismos modulos; los excedentes de mensajes,
              comprobantes OCR, timbres, correos o tokens de IA se cobran segun consumo.
              Integraciones, implementacion especial o requerimientos fuera de plan se
              revisan antes de activar la cuenta productiva.
            </div>
            <div className="rounded-[24px] border border-cyan-400/20 bg-cyan-400/10 p-5 text-sm leading-7 text-cyan-50/90 sm:rounded-[32px] sm:p-6">
              <p className="text-[11px] uppercase tracking-[0.22em] text-cyan-200">
                Primer mes respaldado
              </p>
              <p className="mt-2">
                Si durante el primer mes BetterP no cumple con el alcance contratado,
                puedes solicitar cancelación y devolución conforme a la política
                comercial aplicable. Servicios de implementación, integraciones de
                terceros, consumos extraordinarios o trabajos personalizados se revisan
                por separado.
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
              solutionKey="renta_facil"
              solutionName="Renta Facil"
            />
          </div>
        </div>
      </section>

      <footer className="border-t border-white/6 bg-[#050816]">
        <div className="mx-auto grid max-w-7xl gap-6 px-5 py-10 sm:px-8 lg:grid-cols-[1fr_1.25fr] lg:px-10">
          <div>
            <BetterPLogo alt="BettERP" className="h-auto w-[154px]" />
            <p className="mt-4 max-w-md text-sm leading-7 text-zinc-400">
              Plataforma para operar espacios, cobranza, gastos, clientes,
              publicaciones y reportes desde un solo lugar.
            </p>
            {false && (
              <div className="hidden">
              <Link href="https://betterp.net/privacy" className="hover:text-cyan-200">
                Privacidad
              </Link>
              <Link href="https://betterp.net/terms" className="hover:text-cyan-200">
                Términos
              </Link>
              <a href="#planes" className="hover:text-cyan-200">
                Planes
              </a>
              </div>
            )}
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
                  Planes Renta Facil
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
