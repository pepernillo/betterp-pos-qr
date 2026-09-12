"use client";

import { type ReactNode, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useAuth } from "./auth/AuthProvider";
import BackofficeHeader from "./business/BackofficeHeader";
import BackofficeSidebar from "./business/BackofficeSidebar";
import HeaderBar from "./HeaderBar";
import Sidebar from "./Sidebar";
import { buildApiUrl } from "@/lib/api";
import { getRoutePlanAccess } from "@/lib/plan-access";

interface AppShellProps {
  children: ReactNode;
}

type SubscriptionAccessState = {
  estatus: string;
  acceso_activo?: boolean;
  pago_requerido?: boolean;
  trial_activo?: boolean;
  trial_dias_restantes?: number;
  trial_finaliza_en?: string | null;
  plan?: {
    nombre: string;
    modulos_habilitados?: string[];
    funciones_habilitadas?: string[];
  };
  metadata?: Record<string, unknown>;
};

function formatDate(value?: string | null) {
  if (!value) return "Sin fecha";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin fecha";
  return new Intl.DateTimeFormat("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function TrialWarningBanner({ subscription }: { subscription: SubscriptionAccessState }) {
  if (!subscription.trial_activo) return null;
  const days = subscription.trial_dias_restantes ?? 0;
  if (days > 3) return null;
  return (
    <div className="mb-4 rounded-3xl border border-amber-500/25 bg-amber-500/10 px-5 py-4 text-sm text-amber-100">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <p>
          Tu prueba gratuita termina {days === 0 ? "hoy" : `en ${days} dias`}. Puedes contratar un plan para mantener la plataforma activa.
        </p>
        <Link
          href="/configuracion#suscripcion"
          className="inline-flex items-center justify-center rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-2 text-sm font-medium text-amber-50 transition hover:bg-amber-400/15"
        >
          Ver planes
        </Link>
      </div>
    </div>
  );
}

function TrialExpiredScreen({ subscription }: { subscription: SubscriptionAccessState }) {
  const isCheckoutPending =
    subscription.estatus === "PENDIENTE_PAGO" &&
    subscription.metadata?.source === "checkout";
  return (
    <section className="mx-auto flex min-h-[62vh] max-w-3xl items-center justify-center">
      <div className="rounded-[32px] border border-amber-500/25 bg-zinc-950/80 p-8 text-center shadow-[0_24px_90px_rgba(0,0,0,0.35)]">
        <p className="text-[11px] uppercase tracking-[0.28em] text-amber-200">
          {isCheckoutPending ? "Pago pendiente" : "Prueba finalizada"}
        </p>
        <h1 className="mt-4 text-3xl font-semibold text-white">
          {isCheckoutPending
            ? "Completa el pago para activar BetterP"
            : "Tu acceso de prueba ya termino"}
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-zinc-400">
          {isCheckoutPending
            ? "Tu cuenta ya esta creada, pero la plataforma queda pausada hasta que Stripe confirme el pago del plan elegido."
            : "La plataforma queda pausada para evitar seguir operando sin plan activo. Si BetterP te funciono, contrata un plan y el acceso se reactiva cuando Stripe confirme el pago."}
        </p>
        <div className="mt-6 grid gap-3 rounded-3xl border border-white/8 bg-zinc-900/45 p-4 text-left sm:grid-cols-2">
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
              Plan base
            </p>
            <p className="mt-2 text-sm font-semibold text-white">
              {subscription.plan?.nombre || "Plan BetterP"}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
              {isCheckoutPending ? "Estatus" : "Fecha de termino"}
            </p>
            <p className="mt-2 text-sm font-semibold text-white">
              {isCheckoutPending
                ? "Pendiente de pago"
                : formatDate(subscription.trial_finaliza_en)}
            </p>
          </div>
        </div>
        <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
          <Link
            href="/configuracion#suscripcion"
            className="inline-flex items-center justify-center rounded-2xl bg-cyan-500 px-5 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-cyan-400"
          >
            {isCheckoutPending ? "Completar pago" : "Contratar plan"}
          </Link>
          <Link
            href="/cuenta"
            className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-medium text-zinc-200 transition hover:bg-white/10"
          >
            Revisar cuenta
          </Link>
        </div>
      </div>
    </section>
  );
}

function PlanLockedScreen({
  subscription,
  title,
  description,
  requirement,
}: {
  subscription: SubscriptionAccessState;
  title: string;
  description: string;
  requirement?: string;
}) {
  return (
    <section className="mx-auto flex min-h-[62vh] max-w-3xl items-center justify-center">
      <div className="rounded-[32px] border border-cyan-500/20 bg-zinc-950/80 p-8 text-center shadow-[0_24px_90px_rgba(0,0,0,0.35)]">
        <p className="text-[11px] uppercase tracking-[0.28em] text-cyan-200">
          Plan actual
        </p>
        <h1 className="mt-4 text-3xl font-semibold text-white">{title}</h1>
        <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-zinc-400">
          {description}
        </p>
        <div className="mt-6 grid gap-3 rounded-3xl border border-white/8 bg-zinc-900/45 p-4 text-left sm:grid-cols-2">
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
              Suscripcion
            </p>
            <p className="mt-2 text-sm font-semibold text-white">
              {subscription.plan?.nombre || "Plan BetterP"}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
              Requiere
            </p>
            <p className="mt-2 text-sm font-semibold text-white">
              {requirement || "Plan superior"}
            </p>
          </div>
        </div>
        <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
          <Link
            href="/configuracion#suscripcion"
            className="inline-flex items-center justify-center rounded-2xl bg-cyan-500 px-5 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-cyan-400"
          >
            Revisar planes
          </Link>
          <Link
            href="/dashboard"
            className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-medium text-zinc-200 transition hover:bg-white/10"
          >
            Volver al dashboard
          </Link>
        </div>
      </div>
    </section>
  );
}

export default function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const { status } = useAuth();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [subscriptionAccess, setSubscriptionAccess] =
    useState<SubscriptionAccessState | null>(null);
  const [routeTab, setRouteTab] = useState("");
  const [hasProviderCallback, setHasProviderCallback] = useState(false);

  const isPublicRoute =
    pathname === "/" ||
    pathname === "/privacy" ||
    pathname === "/terms" ||
    pathname === "/data-deletion" ||
    pathname === "/pos-qr" ||
    pathname === "/login" ||
    pathname === "/registro" ||
    pathname === "/backoffice/login" ||
    pathname === "/recuperar-acceso" ||
    pathname.startsWith("/backoffice/invitacion/") ||
    pathname.startsWith("/invitacion/") ||
    pathname.startsWith("/menu/") ||
    pathname.startsWith("/pagar/") ||
    pathname.startsWith("/pago/") ||
    pathname.startsWith("/restablecer-acceso/");
  const isBackofficeRoute =
    pathname === "/backoffice" || pathname.startsWith("/backoffice/");
  const canAccessBillingResolution =
    pathname === "/configuracion" || pathname === "/cuenta";

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const syncRouteQuery = () => {
      const params = new URLSearchParams(window.location.search);
      setRouteTab(params.get("tab") || "");
      setHasProviderCallback(
        params.has("code") || params.has("state") || params.has("error")
      );
    };
    const syncRouteQueryFromEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ tab?: string }>).detail;
      if (detail?.tab) {
        setRouteTab(detail.tab);
        setHasProviderCallback(false);
        return;
      }
      syncRouteQuery();
    };

    syncRouteQuery();
    window.addEventListener("popstate", syncRouteQuery);
    window.addEventListener("betterp-tab-change", syncRouteQueryFromEvent);
    return () => {
      window.removeEventListener("popstate", syncRouteQuery);
      window.removeEventListener("betterp-tab-change", syncRouteQueryFromEvent);
    };
  }, [pathname]);

  useEffect(() => {
    if (isPublicRoute) {
      return;
    }
    if (typeof window === "undefined") {
      return;
    }

    const storedValue = window.localStorage.getItem("betterp-sidebar-collapsed");
    if (storedValue === "1") {
      setSidebarCollapsed(true);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const media = window.matchMedia("(min-width: 1024px)");
    const sync = () => setIsDesktop(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(
      "betterp-sidebar-collapsed",
      sidebarCollapsed ? "1" : "0"
    );
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (status !== "authenticated" || isPublicRoute || isBackofficeRoute) {
      setSubscriptionAccess(null);
      return;
    }
    let cancelled = false;
    const loadSubscriptionAccess = async () => {
      try {
        const response = await fetch(buildApiUrl("/billing/suscripcion/actual/"), {
          cache: "no-store",
        });
        if (!response.ok) return;
        const body = (await response.json()) as SubscriptionAccessState;
        if (!cancelled) {
          setSubscriptionAccess(body);
        }
      } catch {
        if (!cancelled) {
          setSubscriptionAccess(null);
        }
      }
    };
    void loadSubscriptionAccess();
    return () => {
      cancelled = true;
    };
  }, [status, isPublicRoute, isBackofficeRoute, pathname]);

  if (isPublicRoute) {
    return <>{children}</>;
  }

  if (status === "loading") {
    return (
      <div className="app-loading-screen flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-300">
        <div className="app-loading-card rounded-3xl border border-white/10 bg-zinc-900/80 px-6 py-5 text-sm">
          Validando acceso y capa de negocio...
        </div>
      </div>
    );
  }

  if (status === "anonymous") {
    return null;
  }

  const routeAccess = getRoutePlanAccess(pathname, routeTab, subscriptionAccess);

  return (
    <div className="app-shell relative min-h-screen bg-transparent text-zinc-100">
      {mobileNavOpen ? (
        <button
          type="button"
          aria-label="Cerrar navegacion"
          onClick={() => setMobileNavOpen(false)}
          className="fixed inset-0 z-30 bg-black/65 backdrop-blur-[2px] lg:hidden"
        />
      ) : null}

      {isBackofficeRoute ? (
        <BackofficeSidebar
          mobileOpen={mobileNavOpen}
          onClose={() => setMobileNavOpen(false)}
          collapsed={isDesktop ? sidebarCollapsed : false}
          onToggleCollapse={() => setSidebarCollapsed((current) => !current)}
        />
      ) : (
        <Sidebar
          mobileOpen={mobileNavOpen}
          onClose={() => setMobileNavOpen(false)}
          collapsed={isDesktop ? sidebarCollapsed : false}
          onToggleCollapse={() => setSidebarCollapsed((current) => !current)}
          subscription={subscriptionAccess}
        />
      )}

      <div
        className={`relative flex min-h-screen flex-col ${
          isDesktop && sidebarCollapsed ? "lg:pl-24" : "lg:pl-72"
        }`}
      >
        {isBackofficeRoute ? (
          <BackofficeHeader
            onMenuToggle={() => setMobileNavOpen((current) => !current)}
          />
        ) : (
          <HeaderBar
            onMenuToggle={() => setMobileNavOpen((current) => !current)}
            subscription={subscriptionAccess}
          />
        )}
        <main className="flex-1 px-4 pb-5 pt-3 sm:px-5 sm:pb-6 lg:px-6 lg:pb-8 lg:pt-4">
          {subscriptionAccess?.pago_requerido &&
          !subscriptionAccess.acceso_activo &&
          !canAccessBillingResolution ? (
            <TrialExpiredScreen subscription={subscriptionAccess} />
          ) : subscriptionAccess && !routeAccess.allowed ? (
            <PlanLockedScreen
              subscription={subscriptionAccess}
              title={
                routeAccess.title ||
                "Este modulo no esta incluido en tu plan"
              }
              description={
                routeAccess.description ||
                "Puedes revisar los planes para activar esta area de trabajo."
              }
              requirement={routeAccess.requirement}
            />
          ) : (
            <>
              {pathname !== "/configuracion" && subscriptionAccess ? (
                <TrialWarningBanner subscription={subscriptionAccess} />
              ) : null}
              {children}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
