import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import BetterPLogo from "@/components/marketing/BetterPLogo";
import LandingHostGuard from "@/components/marketing/LandingHostGuard";
import BetterPSocialLinks, { WhatsAppIconLink } from "@/components/marketing/SocialLinks";
import ThemeToggle from "@/components/theme/ThemeToggle";

const solutions = [
  {
    name: "Renta Facil",
    eyebrow: "Renta, cobranza y facturacion",
    href: "/soluciones/renta-facil",
    summary:
      "Gestiona espacios, cuentas por cobrar, comprobantes, facturas y portal cliente desde una sola operacion.",
    metric: "1 a miles",
    metricLabel: "espacios administrables",
    accent: "cyan",
    modules: ["Cobranza", "CxC", "Facturacion", "Portal cliente"],
  },
  {
    name: "BetterP Commerce",
    eyebrow: "Sistema integral de ventas",
    href: "/soluciones/commerce",
    summary:
      "Unifica productos, inventario, catalogos, reglas por canal, POS, tienda online, marketplaces, facturacion, envios y reportes.",
    metric: "360°",
    metricLabel: "operacion comercial",
    accent: "emerald",
    modules: ["Inventario", "Catalogos", "POS y QR", "E-commerce", "Facturacion", "Reportes"],
  },
];

export const metadata: Metadata = {
  title: "BetterP | Soluciones web modulares",
  description:
    "BetterP conecta soluciones para operar renta, venta, cobranza, facturacion y procesos diarios con una plataforma modular.",
};

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-4 w-4">
      <path
        d="M5 12h14m-6-6 6 6-6 6"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

const heroFeatures = [
  { label: "Modular", kind: "box" },
  { label: "Escalable", kind: "trend" },
  { label: "Automatizacion", kind: "gear" },
  { label: "Flexible", kind: "sliders" },
];

function FeatureIcon({ kind }: { kind: string }) {
  if (kind === "trend") {
    return (
      <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" className="h-8 w-8">
        <path d="M5 23 13 15l5 5 9-12" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
        <path d="M21 8h6v6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
      </svg>
    );
  }

  if (kind === "gear") {
    return (
      <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" className="h-8 w-8">
        <path d="M16 20.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Z" stroke="currentColor" strokeWidth="2" />
        <path
          d="m26 17.7-2.5 1 .2 2.7-3 2.3-2.4-1.4-2.3.7-1.3 2.4h-3.8L9.6 23 7.3 22.3 4.9 23.7l-3-2.3.2-2.7-2.5-1v-3.8l2.5-1-.2-2.7 3-2.3 2.4 1.4 2.3-.7 1.3-2.4h3.8L16 8.6l2.3.7 2.4-1.4 3 2.3-.2 2.7 2.5 1v3.8Z"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
          transform="translate(3 0)"
        />
      </svg>
    );
  }

  if (kind === "sliders") {
    return (
      <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" className="h-8 w-8">
        <path d="M5 9h22M5 16h22M5 23h22" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
        <circle cx="12" cy="9" r="3" fill="white" stroke="currentColor" strokeWidth="2" />
        <circle cx="21" cy="16" r="3" fill="white" stroke="currentColor" strokeWidth="2" />
        <circle cx="15" cy="23" r="3" fill="white" stroke="currentColor" strokeWidth="2" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" className="h-8 w-8">
      <path d="m16 4 10 5.8v12.4L16 28 6 22.2V9.8L16 4Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="2" />
      <path d="m6.8 10 9.2 5.4 9.2-5.4M16 15.4V28" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
    </svg>
  );
}

function getSolutionAccentClasses(accent: string) {
  if (accent === "blue") {
    return {
      badge: "rounded-md border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-800",
      button:
        "mt-8 inline-flex items-center gap-2 rounded-md bg-blue-600 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-700",
    };
  }

  if (accent === "emerald") {
    return {
      badge:
        "rounded-md border border-emerald-100 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800",
      button:
        "mt-8 inline-flex items-center gap-2 rounded-md bg-emerald-600 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-700",
    };
  }

  return {
    badge: "rounded-md border border-cyan-100 bg-cyan-50 px-3 py-1 text-xs font-semibold text-cyan-800",
    button:
      "mt-8 inline-flex items-center gap-2 rounded-md bg-cyan-600 px-5 py-3 text-sm font-semibold text-white hover:bg-cyan-700",
  };
}

function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-8 sm:py-4 lg:px-10">
        <Link href="/" className="inline-flex items-center">
          <BetterPLogo className="h-auto w-[126px] sm:w-[158px]" priority />
        </Link>

        <div className="flex items-center gap-2">
          <BetterPSocialLinks />
          <WhatsAppIconLink />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

function HeroVisual() {
  return (
    <div className="home-hero-visual relative overflow-hidden rounded-lg border border-sky-100 bg-white shadow-[0_28px_120px_rgba(14,165,233,0.14)]">
      <div className="home-hero-grid absolute inset-0 bg-[linear-gradient(#dbeafe_1px,transparent_1px),linear-gradient(90deg,#dbeafe_1px,transparent_1px)] bg-[size:48px_48px] opacity-55" />
      <div className="home-hero-glow-left absolute -left-20 top-8 hidden h-[560px] w-[360px] rounded-full bg-sky-100/70 blur-3xl lg:block" />
      <div className="home-hero-glow-right absolute -right-24 bottom-0 hidden h-[520px] w-[420px] rounded-full bg-cyan-100/70 blur-3xl lg:block" />

      <div className="relative grid min-h-[500px] items-center gap-8 px-5 py-10 sm:min-h-[560px] sm:px-10 lg:grid-cols-[1fr_1.35fr_1fr] lg:px-12 lg:py-16">
        <div className="hidden h-full min-h-[420px] items-center lg:flex">
          <div className="relative h-[360px] w-full">
            <div className="absolute left-5 top-8 h-28 w-28 rounded-lg border border-sky-200 bg-sky-50 shadow-sm" />
            <div className="absolute left-16 top-40 h-28 w-28 rounded-lg bg-sky-500 shadow-[0_18px_40px_rgba(14,165,233,0.28)]" />
            <div className="absolute right-8 top-20 h-20 w-20 rounded-lg bg-sky-100 shadow-sm" />
            <div className="absolute right-20 bottom-16 h-24 w-24 rounded-lg bg-cyan-500 shadow-[0_18px_40px_rgba(6,182,212,0.25)]" />
            <div className="absolute left-28 top-24 h-px w-36 border-t border-dashed border-sky-300" />
            <div className="absolute left-32 top-52 h-px w-40 border-t border-dashed border-sky-300" />
            <div className="absolute left-44 top-24 h-32 border-l border-dashed border-sky-300" />
            <span className="absolute left-24 top-4 h-3 w-3 rounded-full bg-sky-500" />
            <span className="absolute left-10 top-32 h-3 w-3 rounded-full border-2 border-sky-500 bg-white" />
            <span className="absolute right-10 top-48 h-3 w-3 rounded-full border-2 border-sky-300 bg-white" />
          </div>
        </div>

        <div className="mx-auto max-w-3xl text-center">
          <div className="mx-auto flex justify-center">
            <Image
              src="/betterp-logo-original.png"
              alt="BettERP"
              width={815}
              height={668}
              priority
              className="theme-logo-light h-auto w-[168px] sm:w-[260px]"
            />
            <Image
              src="/betterp-logo-dark.png"
              alt="BettERP"
              width={216}
              height={70}
              priority
              className="theme-logo-dark h-auto w-[190px] sm:w-[300px]"
            />
          </div>
          <h1 className="mt-6 text-3xl font-semibold leading-tight text-slate-950 sm:mt-7 sm:text-6xl">
            Soluciones web <span className="text-sky-500">modulares</span> y ERP agil
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-slate-600 sm:mt-5 sm:text-lg sm:leading-8">
            Sistemas que se adaptan a tu negocio, mercado y operacion para administrar renta, ventas y procesos diarios desde una base clara.
          </p>

          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Link
              href="/soluciones/commerce"
              className="inline-flex items-center justify-center gap-2 rounded-md bg-slate-950 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800"
              style={{ color: "#ffffff" }}
            >
              Ver BetterP Commerce <ArrowIcon />
            </Link>
            <Link
              href="/soluciones/renta-facil"
              className="inline-flex items-center justify-center gap-2 rounded-md border border-sky-200 bg-white px-5 py-3 text-sm font-semibold text-sky-800 hover:border-sky-300 hover:bg-sky-50"
            >
              Ver Renta Facil <ArrowIcon />
            </Link>
          </div>

          <div className="mx-auto mt-9 grid max-w-2xl grid-cols-2 gap-4 sm:grid-cols-4">
            {heroFeatures.map((feature) => (
              <div key={feature.label} className="flex flex-col items-center gap-2 border-r border-sky-100 px-3 last:border-r-0 sm:last:border-r-0">
                <span className="text-sky-600">
                  <FeatureIcon kind={feature.kind} />
                </span>
                <span className="text-sm font-semibold text-slate-700">{feature.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="hidden h-full min-h-[420px] items-center lg:flex">
          <div className="relative h-[390px] w-full">
            <div className="absolute right-0 top-0 w-[330px] rounded-lg border border-sky-100 bg-white/92 p-5 shadow-[0_20px_70px_rgba(14,165,233,0.16)]">
              <div className="mb-5 flex gap-2">
                <span className="h-3 w-3 rounded-full bg-sky-300" />
                <span className="h-3 w-3 rounded-full bg-sky-300" />
                <span className="h-3 w-3 rounded-full bg-sky-300" />
              </div>
              <div className="flex items-center gap-5">
                <div className="h-24 w-24 rounded-full border-[18px] border-sky-200 border-l-sky-500" />
                <div className="flex-1 space-y-3">
                  <div className="h-3 rounded-full bg-slate-100" />
                  <div className="h-3 rounded-full bg-slate-100" />
                  <div className="h-3 w-2/3 rounded-full bg-slate-100" />
                </div>
              </div>
              <div className="mt-7 flex h-24 items-end gap-3 border-b border-l border-sky-100 px-4">
                {[36, 58, 46, 72, 94, 64, 82].map((height, index) => (
                  <span
                    key={index}
                    className={index % 2 ? "w-5 rounded-t bg-sky-300" : "w-5 rounded-t bg-sky-500"}
                    style={{ height }}
                  />
                ))}
              </div>
            </div>
            <div className="absolute bottom-4 left-0 w-[260px] rounded-lg border border-sky-100 bg-white/92 p-5 shadow-[0_18px_60px_rgba(14,165,233,0.14)]">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-700">Automatizacion</p>
              {["Backoffice", "Cobranza", "Integraciones"].map((label, index) => (
                <div key={label} className="mt-4">
                  <div className="flex justify-between text-sm font-semibold text-slate-700">
                    <span>{label}</span>
                    <span>{[92, 78, 64][index]}%</span>
                  </div>
                  <div className="mt-2 h-2 rounded-full bg-slate-100">
                    <div className="h-2 rounded-full bg-cyan-500" style={{ width: `${[92, 78, 64][index]}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <main className="home-landing min-h-screen bg-white text-slate-950">
      <LandingHostGuard />
      <Header />

      <section className="relative overflow-hidden border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-5 py-14 sm:px-8 sm:py-16 lg:px-10 lg:py-20">
          <HeroVisual />
        </div>
      </section>

      <section id="soluciones" className="border-b border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-7xl px-5 py-14 sm:px-8 lg:px-10 lg:py-16">
          <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
            <div>
              <p className="text-sm font-semibold uppercase text-sky-700">Conoce nuestras soluciones</p>
              <h2 className="mt-3 max-w-2xl text-3xl font-semibold text-slate-950 sm:text-5xl">
                Herramientas BetterP para operar mejor.
              </h2>
            </div>
            <p className="max-w-xl text-base leading-8 text-slate-600">
              Elige el modulo que se adapta a tu operacion actual. Puedes empezar con una solucion y sumar nuevas capacidades cuando tu negocio lo necesite.
            </p>
          </div>

          <div className="mt-10 grid gap-5 lg:grid-cols-2">
            {solutions.map((solution) => {
              const accentClasses = getSolutionAccentClasses(solution.accent);
              return (
                <article key={solution.name} className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className={accentClasses.badge}>
                      {solution.eyebrow}
                    </span>
                    <span className="text-sm font-semibold text-slate-500">Solucion BetterP</span>
                  </div>
                  <h3 className="mt-6 text-3xl font-semibold text-slate-950">{solution.name}</h3>
                  <p className="mt-4 text-base leading-8 text-slate-600">{solution.summary}</p>
                  <div className="mt-6 flex flex-wrap gap-2">
                    {solution.modules.map((module) => (
                      <span key={module} className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700">
                        {module}
                      </span>
                    ))}
                  </div>
                  <Link
                    href={solution.href}
                    className={accentClasses.button}
                    style={{ color: "#ffffff" }}
                  >
                    Conocer {solution.name} <ArrowIcon />
                  </Link>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-5 py-8 text-sm text-slate-600 sm:px-8 lg:flex-row lg:items-center lg:justify-between lg:px-10">
          <div className="flex items-center gap-3">
            <BetterPLogo alt="BettERP" className="h-auto w-[124px]" />
            <span>Soluciones web modulares.</span>
          </div>
          <div className="flex flex-wrap gap-4">
            <Link href="/privacy" className="hover:text-sky-700">
              Privacidad
            </Link>
            <Link href="/terms" className="hover:text-sky-700">
              Terminos
            </Link>
            <Link href="/login" className="hover:text-sky-700">
              Acceso clientes
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
