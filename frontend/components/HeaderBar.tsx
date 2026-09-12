"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { STORAGE_KEYS, buildApiUrl } from "@/lib/api";
import RentaAlertasBell from "./RentaAlertasBell";
import { useAuth } from "./auth/AuthProvider";
import ThemeToggle from "./theme/ThemeToggle";

function MenuIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </svg>
  );
}

function getPageMeta(pathname: string) {
  if (pathname === "/dashboard") {
    return {
      eyebrow: "Vista general",
      title: "Dashboard",
      description: "Cobranza, gastos, ocupacion y oportunidad comercial en una sola vista.",
    };
  }

  if (pathname === "/onboarding") {
    return {
      eyebrow: "Arranque",
      title: "Onboarding operativo",
      description: "Configura capa, reglas, carga batch, cartera y portal antes de operar.",
    };
  }

  if (pathname.startsWith("/entidades/")) {
    return {
      eyebrow: "Unidad de negocio",
      title: "Gestion de entidad",
      description: "Inventario, reglas y operacion diaria.",
    };
  }

  if (pathname === "/entidades") {
    return {
      eyebrow: "Portafolio",
      title: "Unidades de negocio",
      description: "Portafolio y operacion por unidad.",
    };
  }

  if (pathname === "/clientes") {
    return {
      eyebrow: "CRM",
      title: "Clientes",
      description: "Directorio, datos fiscales e historial.",
    };
  }

  if (pathname === "/renta-espacios") {
    return {
      eyebrow: "Comercial",
      title: "Renta de espacios",
      description: "Disponibilidad, fichas y canales.",
    };
  }

  if (pathname === "/marketing") {
    return {
      eyebrow: "Marketing",
      title: "Publicidad y comunicados",
      description: "Redes sociales, campanas y contenido para espacios disponibles.",
    };
  }

  if (pathname === "/cxc") {
    return {
      eyebrow: "Finanzas",
      title: "Cuentas por cobrar",
      description: "Cartera, vencimientos y pagos.",
    };
  }

  if (pathname === "/cxp") {
    return {
      eyebrow: "Finanzas",
      title: "Cuentas por pagar",
      description: "Gastos, compromisos y flujo.",
    };
  }

  if (pathname === "/configuracion") {
    return {
      eyebrow: "Administracion",
      title: "Configuracion del sistema",
      description: "Datos de negocio, facturacion, integraciones y accesos.",
    };
  }

  if (pathname === "/cuenta") {
    return {
      eyebrow: "Cuenta",
      title: "Configuracion de cuenta",
      description: "Contrasena, recuperacion por correo y seguridad personal de acceso.",
    };
  }

  if (pathname === "/conciliacion") {
    return {
      eyebrow: "Backoffice",
      title: "Conciliacion",
      description: "Movimientos, bancos y validacion.",
    };
  }

  if (pathname === "/documentacion") {
    return {
      eyebrow: "Ayuda",
      title: "Documentacion",
      description: "Guia operativa para usar BettERP por modulo.",
    };
  }

  if (
    pathname === "/administracion-negocio" ||
    pathname === "/backoffice" ||
    pathname === "/admin"
  ) {
    return {
      eyebrow: "BettERP",
      title: "Backoffice del negocio",
      description: "Clientes SaaS, ventas, solicitudes, cobranza y marketing en una sola vista.",
    };
  }

  return {
    eyebrow: "BettERP",
    title: "Panel de control",
    description: "Operacion central del sistema.",
  };
}

interface HeaderBarProps {
  onMenuToggle?: () => void;
  subscription?: HeaderSubscription | null;
}

type HeaderSubscription = {
  estatus: string;
  trial_activo?: boolean;
  trial_dias_restantes?: number;
  periodicidad?: string;
  fecha_fin_periodo_actual?: string | null;
  fecha_siguiente_pago?: string | null;
  siguiente_pago_dias_restantes?: number | null;
  plan?: {
    nombre: string;
  };
};

function parseLocalDate(value?: string | null) {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function formatShortDate(value?: string | null) {
  const date = parseLocalDate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function getDaysUntil(value?: string | null) {
  const date = parseLocalDate(value);
  if (!date) return null;
  const today = new Date();
  const todayStart = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  );
  const diffMs = date.getTime() - todayStart.getTime();
  return Math.max(Math.ceil(diffMs / 86_400_000), 0);
}

function getBillingCycleLabel(subscription?: HeaderSubscription | null) {
  if (!subscription?.periodicidad) return "";
  return subscription.periodicidad === "ANUAL" ? "Anual" : "Mensual";
}

function getNextPaymentSummary(subscription?: HeaderSubscription | null) {
  if (!subscription) return "";
  const days =
    subscription.siguiente_pago_dias_restantes ??
    getDaysUntil(subscription.fecha_siguiente_pago ?? subscription.fecha_fin_periodo_actual);
  if (days === null) return "";
  if (days === 0) return "proximo pago hoy";
  if (days === 1) return "proximo pago en 1 dia";
  return `proximo pago en ${days} dias`;
}

function getSubscriptionSummary(subscription?: HeaderSubscription | null) {
  if (!subscription) return "";
  const planName = subscription.plan?.nombre || "Plan BetterP";
  const cycle = getBillingCycleLabel(subscription);
  const nextPayment = getNextPaymentSummary(subscription);
  const billingParts = [cycle, nextPayment].filter(Boolean);
  if (subscription.trial_activo) {
    const days = subscription.trial_dias_restantes ?? 0;
    return `${planName} · Trial ${days === 1 ? "1 dia" : `${days} dias`}`;
  }
  if (subscription.estatus === "ACTIVA") {
    return [`Plan ${planName}`, ...billingParts].join(" · ");
  }
  if (subscription.estatus === "PENDIENTE_PAGO") {
    return `${planName} · Pago pendiente`;
  }
  if (subscription.estatus === "PAST_DUE") {
    return `${planName} · Pago vencido`;
  }
  return `${planName} · ${subscription.estatus.replace("_", " ").toLowerCase()}`;
}

function getSubscriptionPillClasses(subscription?: HeaderSubscription | null) {
  if (!subscription) return "border-white/10 bg-white/[0.03] text-zinc-400";
  if (subscription.trial_activo) return "border-amber-300/25 bg-amber-300/10 text-amber-100";
  if (subscription.estatus === "ACTIVA") return "border-emerald-300/20 bg-emerald-300/10 text-emerald-100";
  if (subscription.estatus === "PENDIENTE_PAGO") return "border-cyan-300/20 bg-cyan-300/10 text-cyan-100";
  return "border-rose-300/20 bg-rose-300/10 text-rose-100";
}

export default function HeaderBar({ onMenuToggle, subscription }: HeaderBarProps) {
  const pathname = usePathname();
  const { currentMembership, logout, refreshProfile, user } = useAuth();
  const meta = getPageMeta(pathname);
  const subscriptionSummary = getSubscriptionSummary(subscription);
  const [todayLabel, setTodayLabel] = useState("");
  const [isResettingDemo, setIsResettingDemo] = useState(false);
  const [demoResetError, setDemoResetError] = useState("");
  const menuRef = useRef<HTMLDetailsElement | null>(null);
  const isDemoApp = process.env.NEXT_PUBLIC_APP_ENV === "demo";

  const closeUserMenu = () => {
    menuRef.current?.removeAttribute("open");
  };

  useEffect(() => {
    setTodayLabel(
      new Intl.DateTimeFormat("es-MX", {
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(new Date())
    );
  }, []);

  useEffect(() => {
    menuRef.current?.removeAttribute("open");
  }, [pathname]);

  const handleResetDemo = async () => {
    if (isResettingDemo) {
      return;
    }
    const confirmed = window.confirm(
      "Esto reiniciara los datos del demo y borrara cambios de prueba. No afecta produccion. Quieres continuar?"
    );
    if (!confirmed) {
      return;
    }
    setIsResettingDemo(true);
    setDemoResetError("");
    try {
      const response = await fetch(buildApiUrl("/billing/demo/reset/"), {
        method: "POST",
      });
      const body = (await response.json().catch(() => ({}))) as {
        detail?: string;
        mensaje?: string;
      };
      if (!response.ok) {
        throw new Error(body.detail || "No se pudo reiniciar el demo.");
      }
      window.localStorage.removeItem(STORAGE_KEYS.selectedCapaId);
      await refreshProfile();
      closeUserMenu();
      window.location.assign("/dashboard?demo_reset=1");
    } catch (error) {
      setDemoResetError(
        error instanceof Error ? error.message : "No se pudo reiniciar el demo."
      );
    } finally {
      setIsResettingDemo(false);
    }
  };

  return (
    <header className="sticky top-0 z-20 border-b border-white/6 bg-zinc-950/80 backdrop-blur-xl">
      <div className="flex items-start justify-between gap-4 px-4 py-2.5 sm:px-5 lg:px-6">
        <div className="flex min-w-0 items-start gap-3">
          <button
            type="button"
            onClick={onMenuToggle}
            className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-zinc-900/70 text-zinc-200 transition-colors hover:border-zinc-700 hover:bg-zinc-900 lg:hidden"
            aria-label="Abrir navegacion"
          >
            <MenuIcon />
          </button>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.2em] text-cyan-200">
                {meta.eyebrow}
              </span>
              <span className="hidden text-xs text-zinc-500 sm:inline">
                {todayLabel}
              </span>
            </div>

            <h1 className="mt-1.5 truncate text-base font-semibold text-white sm:text-xl">
              {meta.title}
            </h1>
            <p className="mt-0.5 max-w-2xl text-[11px] text-zinc-400 sm:text-xs">
              {meta.description}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <ThemeToggle />
          <RentaAlertasBell />

          <details ref={menuRef} className="relative shrink-0">
            <summary className="flex cursor-pointer list-none items-center gap-2.5 rounded-2xl border border-white/10 bg-zinc-900/80 px-2 py-1.5 text-sm text-zinc-300 transition-colors hover:border-zinc-700 hover:text-white">
              <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 text-sm font-bold text-white shadow-lg shadow-cyan-950/40">
                {user?.initials ?? "US"}
              </span>
              <span className="hidden min-w-0 pr-1 text-left sm:block">
                <span className="block text-sm font-medium text-white">
                  {user?.nombre ?? "Usuario"}
                </span>
                <span className="block text-[11px] text-zinc-500">
                  {currentMembership?.capa_negocio.nombre ?? "Sin capa activa"}
                </span>
                {subscriptionSummary ? (
                  <span className="block max-w-[12rem] truncate text-[10px] text-cyan-200">
                    {subscriptionSummary}
                  </span>
                ) : null}
              </span>
            </summary>

            <div className="absolute right-0 z-20 mt-3 w-72 rounded-3xl border border-white/10 bg-zinc-950/95 p-2 shadow-2xl">
              <div className="rounded-2xl border border-white/5 bg-zinc-900/60 px-4 py-4">
                <p className="text-sm font-semibold text-white">
                  {user?.nombre ?? "Usuario"}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-zinc-500">
                  {user?.email ?? "Sin correo"}
                </p>
                {currentMembership ? (
                  <p className="mt-2 text-[11px] uppercase tracking-[0.18em] text-cyan-300">
                    {currentMembership.rol.replace("_", " ")} | {currentMembership.capa_negocio.tipo_capa}
                  </p>
                ) : null}
                {subscriptionSummary ? (
                  <div className={`mt-3 rounded-2xl border px-3 py-2 text-xs ${getSubscriptionPillClasses(subscription)}`}>
                    <span className="block text-[10px] uppercase tracking-[0.18em] opacity-70">
                      Suscripcion
                    </span>
                    <span className="mt-1 block font-semibold">
                      {subscriptionSummary}
                    </span>
                    {subscription?.estatus === "ACTIVA" ? (
                      <span className="mt-1 block text-[11px] opacity-80">
                        {subscription.fecha_siguiente_pago ?? subscription.fecha_fin_periodo_actual
                          ? `Renueva ${formatShortDate(subscription.fecha_siguiente_pago ?? subscription.fecha_fin_periodo_actual)}`
                          : "Renovacion pendiente de sincronizar"}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div className="mt-2 space-y-1">
                <Link
                  href="/cuenta"
                  onClick={closeUserMenu}
                  className="flex items-center justify-between rounded-2xl px-4 py-3 text-sm text-zinc-300 transition-colors hover:bg-zinc-900 hover:text-white"
                >
                  <span>Configuracion de cuenta</span>
                  <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                    Acceso
                  </span>
                </Link>
                <Link
                  href="/configuracion#datos-negocio"
                  onClick={closeUserMenu}
                  className="flex items-center justify-between rounded-2xl px-4 py-3 text-sm text-zinc-300 transition-colors hover:bg-zinc-900 hover:text-white"
                >
                  <span>Datos de negocio</span>
                  <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                    Fiscal
                  </span>
                </Link>
                <Link
                  href="/configuracion#suscripcion"
                  onClick={closeUserMenu}
                  className="flex items-center justify-between rounded-2xl px-4 py-3 text-sm text-zinc-300 transition-colors hover:bg-zinc-900 hover:text-white"
                >
                  <span>Suscripcion y facturacion</span>
                  <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                    Plan
                  </span>
                </Link>
                <Link
                  href="/configuracion"
                  onClick={closeUserMenu}
                  className="flex items-center justify-between rounded-2xl px-4 py-3 text-sm text-zinc-300 transition-colors hover:bg-zinc-900 hover:text-white"
                >
                  <span>Configuracion del sistema</span>
                  <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                    Global
                  </span>
                </Link>
                {user?.is_platform_admin ? (
                  <Link
                    href="/backoffice"
                    onClick={closeUserMenu}
                    className="flex items-center justify-between rounded-2xl px-4 py-3 text-sm text-zinc-300 transition-colors hover:bg-zinc-900 hover:text-white"
                  >
                    <span>Backoffice del negocio</span>
                    <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                      SaaS
                    </span>
                  </Link>
                ) : null}
                <Link
                  href="/documentacion"
                  onClick={closeUserMenu}
                  className="flex items-center justify-between rounded-2xl px-4 py-3 text-sm text-zinc-300 transition-colors hover:bg-zinc-900 hover:text-white"
                >
                  <span>Documentacion</span>
                  <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                    Guia
                  </span>
                </Link>
                {isDemoApp ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void handleResetDemo()}
                      disabled={isResettingDemo}
                      className="flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left text-sm text-amber-200 transition-colors hover:bg-amber-500/10 hover:text-amber-100 disabled:cursor-wait disabled:opacity-60"
                    >
                      <span>{isResettingDemo ? "Reiniciando demo..." : "Reiniciar demo"}</span>
                      <span className="text-xs uppercase tracking-[0.2em] text-amber-300/70">
                        Reset
                      </span>
                    </button>
                    {demoResetError ? (
                      <p className="px-4 pb-2 text-xs leading-relaxed text-red-300">
                        {demoResetError}
                      </p>
                    ) : null}
                  </>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    closeUserMenu();
                    void logout();
                  }}
                  className="flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left text-sm text-zinc-300 transition-colors hover:bg-zinc-900 hover:text-white"
                >
                  <span>Cerrar sesion</span>
                  <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                    Salir
                  </span>
                </button>
              </div>
            </div>
          </details>
        </div>
      </div>
    </header>
  );
}
