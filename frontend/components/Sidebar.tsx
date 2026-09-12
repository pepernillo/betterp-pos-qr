"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";

import { useAuth } from "./auth/AuthProvider";
import {
  DEFAULT_COBRANZA_TAB,
  canUseCobranzaInternalTools,
} from "@/lib/cobranzaAccess";
import {
  hasPlanFeature,
  hasPlanModule,
  type PlanAccessSubscription,
} from "@/lib/plan-access";

type IconProps = {
  className?: string;
};

interface CapaNegocioLite {
  id: number;
  nombre: string;
  tipo_capa: string;
  activo: boolean;
  entidades_count: number;
}

interface SidebarProps {
  mobileOpen?: boolean;
  onClose?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  subscription?: PlanAccessSubscription;
}

function DashboardIcon({ className = "" }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M3 13.5h8v7.5H3z" />
      <path d="M13 3h8v10h-8z" />
      <path d="M13 16.5h8V21h-8z" />
      <path d="M3 3h8v8H3z" />
    </svg>
  );
}

function BuildingIcon({ className = "" }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M4 21V5.5A1.5 1.5 0 0 1 5.5 4H14v17" />
      <path d="M14 9.5h4.5A1.5 1.5 0 0 1 20 11v10" />
      <path d="M8 8h2" />
      <path d="M8 12h2" />
      <path d="M8 16h2" />
      <path d="M16.5 13h1" />
      <path d="M16.5 16h1" />
      <path d="M3 21h18" />
    </svg>
  );
}

function UserGroupIcon({ className = "" }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
      <path d="M9.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
      <path d="M21 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16.5 3.13a4 4 0 0 1 0 7.74" />
    </svg>
  );
}

function KeyIcon({ className = "" }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="8.5" cy="15.5" r="3.5" />
      <path d="M11.5 12.5 20 4" />
      <path d="M16 4h4v4" />
      <path d="M15.5 8.5 18 11" />
    </svg>
  );
}

function MegaphoneIcon({ className = "" }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M4 13.5V10a2 2 0 0 1 2-2h2l8-3v13l-8-3H6a2 2 0 0 1-2-1.5Z" />
      <path d="M8 15l1.2 4H12" />
      <path d="M19 9.5a3 3 0 0 1 0 4" />
    </svg>
  );
}

function MessageCircleIcon({ className = "" }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M4 11.5A7.5 7.5 0 0 1 11.5 4h1A7.5 7.5 0 0 1 20 11.5v.5a7.5 7.5 0 0 1-10.8 6.7L5 20l1.3-4.1A7.4 7.4 0 0 1 4 11.5Z" />
      <path d="M8.5 11h7" />
      <path d="M8.5 14h4.5" />
    </svg>
  );
}

function WalletIcon({ className = "" }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H19a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6.5A2.5 2.5 0 0 1 4 16.5v-9Z" />
      <path d="M4 8h15" />
      <path d="M16.5 13h2.5" />
      <path d="M4 7.5 15.5 4" />
    </svg>
  );
}

function CheckListIcon({ className = "" }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M9 6h11" />
      <path d="M9 12h11" />
      <path d="M9 18h11" />
      <path d="m4 6 1.5 1.5L7.5 5" />
      <path d="m4 12 1.5 1.5L7.5 11" />
      <path d="m4 18 1.5 1.5L7.5 17" />
    </svg>
  );
}

function CommerceIcon({ className = "" }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M4 9h16l-1-5H5L4 9Z" />
      <path d="M5 9v10h14V9" />
      <path d="M9 19v-6h6v6" />
      <path d="M4 9a3 3 0 0 0 5 2 3 3 0 0 0 6 0 3 3 0 0 0 5-2" />
    </svg>
  );
}

function SettingsIcon({ className = "" }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
      <path d="M19.4 15a1.8 1.8 0 0 0 .36 2l.05.05a2.1 2.1 0 0 1-2.97 2.97l-.05-.05a1.8 1.8 0 0 0-2-.36 1.8 1.8 0 0 0-1.1 1.65V21.4a2.1 2.1 0 0 1-4.2 0v-.07a1.8 1.8 0 0 0-1.1-1.65 1.8 1.8 0 0 0-2 .36l-.05.05a2.1 2.1 0 0 1-2.97-2.97l.05-.05a1.8 1.8 0 0 0 .36-2 1.8 1.8 0 0 0-1.65-1.1H2.1a2.1 2.1 0 0 1 0-4.2h.07a1.8 1.8 0 0 0 1.65-1.1 1.8 1.8 0 0 0-.36-2l-.05-.05a2.1 2.1 0 0 1 2.97-2.97l.05.05a1.8 1.8 0 0 0 2 .36 1.8 1.8 0 0 0 1.1-1.65V2.1a2.1 2.1 0 0 1 4.2 0v.07a1.8 1.8 0 0 0 1.1 1.65 1.8 1.8 0 0 0 2-.36l.05-.05a2.1 2.1 0 0 1 2.97 2.97l-.05.05a1.8 1.8 0 0 0-.36 2 1.8 1.8 0 0 0 1.65 1.1h.07a2.1 2.1 0 0 1 0 4.2h-.07A1.8 1.8 0 0 0 19.4 15Z" />
    </svg>
  );
}

function BriefcaseIcon({ className = "" }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M8 7V5.5A1.5 1.5 0 0 1 9.5 4h5A1.5 1.5 0 0 1 16 5.5V7" />
      <path d="M4 9.5A1.5 1.5 0 0 1 5.5 8h13A1.5 1.5 0 0 1 20 9.5v8A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5z" />
      <path d="M4 12h16" />
    </svg>
  );
}

function BookIcon({ className = "" }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M5 4.5h10.5A3.5 3.5 0 0 1 19 8v11.5H8.5A3.5 3.5 0 0 1 5 16z" />
      <path d="M8.5 8H15" />
      <path d="M8.5 12H16" />
      <path d="M8.5 16H14" />
    </svg>
  );
}

function ChevronIcon({
  className = "",
  expanded = false,
}: IconProps & { expanded?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`${className} transition-transform ${expanded ? "rotate-180" : ""}`}
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function CloseIcon({ className = "" }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="m6 6 12 12" />
      <path d="M18 6 6 18" />
    </svg>
  );
}

function PanelToggleIcon({
  className = "",
  collapsed = false,
}: IconProps & { collapsed?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5z" />
      <path d={collapsed ? "M9.5 4v16" : "M14.5 4v16"} />
    </svg>
  );
}

function linkClasses(active: boolean, compact = false, collapsed = false) {
  const base = collapsed
    ? "group flex h-12 w-12 items-center justify-center rounded-2xl border transition-colors"
    : "group flex items-center gap-3 rounded-2xl border transition-colors";

  if (compact) {
    return `${base} ${collapsed ? "" : "px-3 py-2 text-sm"} ${
      active
        ? "border-cyan-500/25 bg-cyan-500/10 text-white"
        : "border-transparent text-zinc-400 hover:border-zinc-800 hover:bg-zinc-900 hover:text-white"
    }`;
  }

  return `${base} ${collapsed ? "" : "px-4 py-3"} ${
    active
      ? "border-cyan-500/25 bg-cyan-500/10 text-white shadow-[0_0_0_1px_rgba(34,211,238,0.04)]"
      : "border-transparent text-zinc-400 hover:border-zinc-800 hover:bg-zinc-900 hover:text-white"
  }`;
}

function iconClasses(active: boolean) {
  return `h-5 w-5 shrink-0 ${
    active ? "text-cyan-300" : "text-zinc-500 group-hover:text-zinc-300"
  }`;
}

function SidebarLink({
  href,
  label,
  active,
  icon,
  compact = false,
  collapsed = false,
  onClick,
}: {
  href: string;
  label: string;
  active: boolean;
  icon: ReactNode;
  compact?: boolean;
  collapsed?: boolean;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      className={linkClasses(active, compact, collapsed)}
      onClick={onClick}
      title={collapsed ? label : undefined}
      aria-label={label}
    >
      {icon}
      {collapsed ? null : <span className="font-medium">{label}</span>}
    </Link>
  );
}

function SidebarAccordion({
  title,
  subtitle,
  active,
  open,
  icon,
  collapsed,
  onToggle,
  children,
}: {
  title: string;
  subtitle: string;
  active: boolean;
  open: boolean;
  icon: ReactNode;
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="rounded-3xl border border-white/6 bg-zinc-900/50 p-2">
      <button
        type="button"
        onClick={onToggle}
        className={`group flex w-full items-center rounded-2xl border transition-colors ${
          collapsed ? "justify-center px-0 py-3" : "gap-3 px-4 py-3 text-left"
        } ${
          active || open
            ? "border-zinc-800 bg-zinc-900/80 text-white"
            : "border-transparent text-zinc-400 hover:border-zinc-800 hover:bg-zinc-900 hover:text-white"
        }`}
        title={collapsed ? title : undefined}
        aria-expanded={open}
        aria-label={title}
      >
        {icon}

        {collapsed ? null : (
          <>
            <div className="min-w-0 flex-1">
              <p className="font-medium">{title}</p>
              <p className="text-xs text-zinc-500">{subtitle}</p>
            </div>
            <ChevronIcon
              expanded={open}
              className={`h-4 w-4 ${active || open ? "text-zinc-300" : "text-zinc-500"}`}
            />
          </>
        )}
      </button>

      {open ? (
        <div
          className={`mt-2 space-y-1 ${
            collapsed ? "flex flex-col items-center pl-0" : "pl-3"
          }`}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

export default function Sidebar({
  mobileOpen = false,
  onClose,
  collapsed = false,
  onToggleCollapse,
  subscription = null,
}: SidebarProps) {
  const pathname = usePathname();
  const { memberships, currentMembership, selectedCapaId, selectCapa, user, isOwnerAdmin } = useAuth();
  const isOnboardingPath = pathname === "/onboarding";
  const isRentaPath = pathname === "/renta-espacios";
  const isMarketingPath = pathname === "/marketing";
  const isCobranzaPath = pathname === "/cobranza";
  const isAccountsPath = pathname === "/cxc" || pathname === "/cxp";
  const isConciliacionPath = pathname === "/conciliacion";
  const isConfiguracionPath = pathname === "/configuracion";
  const isBackofficePath =
    pathname === "/administracion-negocio" ||
    pathname.startsWith("/administracion-negocio/") ||
    pathname === "/backoffice" ||
    pathname.startsWith("/backoffice/") ||
    pathname === "/admin" ||
    pathname.startsWith("/admin/");
  const isDocumentationPath = pathname === "/documentacion";
  const [queryTab, setQueryTab] = useState("");
  const [hasProviderCallback, setHasProviderCallback] = useState(false);
  const [rentaOpen, setRentaOpen] = useState(isRentaPath);
  const [marketingOpen, setMarketingOpen] = useState(isMarketingPath);
  const [cobranzaOpen, setCobranzaOpen] = useState(isCobranzaPath);
  const [accountsOpen, setAccountsOpen] = useState(isAccountsPath);
  const [conciliacionOpen, setConciliacionOpen] = useState(isConciliacionPath);

  const capas: CapaNegocioLite[] = memberships.map((membership) => ({
    id: membership.capa_negocio.id,
    nombre: membership.capa_negocio.nombre,
    tipo_capa: membership.capa_negocio.tipo_capa,
    activo: membership.capa_negocio.activo,
    entidades_count: membership.capa_negocio.entidades_count ?? 0,
  }));

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const syncTabFromUrl = () => {
      const params = new URLSearchParams(window.location.search);
      setQueryTab(params.get("tab") || "");
      setHasProviderCallback(
        params.has("code") || params.has("state") || params.has("error")
      );
    };
    const syncTabFromEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ tab?: string }>).detail;
      if (detail?.tab) {
        setQueryTab(detail.tab);
        setHasProviderCallback(false);
        return;
      }
      syncTabFromUrl();
    };

    syncTabFromUrl();
    window.addEventListener("popstate", syncTabFromUrl);
    window.addEventListener("betterp-tab-change", syncTabFromEvent);
    return () => {
      window.removeEventListener("popstate", syncTabFromUrl);
      window.removeEventListener("betterp-tab-change", syncTabFromEvent);
    };
  }, [pathname]);

  useEffect(() => {
    if (isRentaPath) {
      setRentaOpen(true);
    }
  }, [isRentaPath]);

  useEffect(() => {
    if (isMarketingPath) {
      setMarketingOpen(true);
    }
  }, [isMarketingPath]);

  useEffect(() => {
    if (isCobranzaPath) {
      setCobranzaOpen(true);
    }
  }, [isCobranzaPath]);

  useEffect(() => {
    if (isAccountsPath) {
      setAccountsOpen(true);
    }
  }, [isAccountsPath]);

  useEffect(() => {
    if (isConciliacionPath) {
      setConciliacionOpen(true);
    }
  }, [isConciliacionPath]);

  const selectedCapa =
    currentMembership?.capa_negocio ??
    capas.find((item) => item.id === selectedCapaId) ??
    capas[0] ??
    null;
  const activeRentaTab =
    isRentaPath && hasProviderCallback ? "conexiones" : isRentaPath ? queryTab || "espacios" : "";
  const activeMarketingTab =
    isMarketingPath && hasProviderCallback
      ? "conexiones"
      : isMarketingPath
        ? queryTab || "comunicados"
        : "";
  const canUseInternalCobranza = canUseCobranzaInternalTools(user, isOwnerAdmin);
  const activeCobranzaTab = isCobranzaPath ? queryTab || DEFAULT_COBRANZA_TAB : "";
  const activeConciliacionTab = isConciliacionPath ? queryTab || "bancos" : "";
  const canUseModule = (moduleKey: string) =>
    hasPlanModule(subscription, moduleKey);
  const canUseFeature = (featureKey: string) =>
    hasPlanFeature(subscription, featureKey);
  const commerceModules = subscription?.plan?.modulos_habilitados || [];
  const canUseCommerce =
    isOwnerAdmin ||
    !subscription?.plan ||
    commerceModules.some(
      (moduleKey) =>
        moduleKey.startsWith("tienda_facil.") || moduleKey.startsWith("vende_facil.")
    );
  const canUseSocialPublishing = canUseFeature("social_publishing");
  const selectSidebarTab = (tab: string) => {
    setQueryTab(tab);
    setHasProviderCallback(false);
    onClose?.();
  };

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-40 flex ${
        collapsed ? "w-72 lg:w-24" : "w-72 lg:w-72"
      } flex-col border-r border-white/8 bg-zinc-950/95 text-zinc-300 shadow-2xl backdrop-blur-xl transition-[width,transform] duration-300 lg:translate-x-0 ${
        mobileOpen ? "translate-x-0" : "-translate-x-full"
      }`}
    >
      <div
        className={`flex h-[68px] items-center justify-between border-b border-white/6 ${
          collapsed ? "px-3" : "px-5"
        } py-3`}
      >
        <div className={collapsed ? "flex items-center justify-center" : ""}>
          {collapsed ? (
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-cyan-500/15 bg-cyan-500/10 text-sm font-bold tracking-[0.28em] text-cyan-200">
              BE
            </div>
          ) : (
            <div>
              <h1 className="text-xl font-bold tracking-wide text-white">
                Bett<span className="text-cyan-400">ERP</span>
              </h1>
              <p className="mt-1 text-xs text-zinc-500">Operacion centralizada</p>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleCollapse}
            className="hidden h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-zinc-900/70 text-zinc-300 transition-colors hover:border-zinc-700 hover:text-white lg:flex"
            aria-label={collapsed ? "Expandir barra lateral" : "Contraer barra lateral"}
            title={collapsed ? "Expandir navegacion" : "Contraer navegacion"}
          >
            <PanelToggleIcon className="h-5 w-5" collapsed={collapsed} />
          </button>

          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-zinc-900/70 text-zinc-300 transition-colors hover:border-zinc-700 hover:text-white lg:hidden"
            aria-label="Cerrar navegacion"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div
        className={`border-b border-white/6 ${
          collapsed ? "px-3 py-2" : "px-4 py-2"
        }`}
      >
        <div
          className={`rounded-[26px] border border-white/6 bg-zinc-900/65 ${
            collapsed ? "p-2" : "px-3 py-2.5"
          }`}
        >
          {collapsed ? null : (
            <p className="text-[9px] uppercase tracking-[0.2em] text-zinc-500">
              Empresa activa
            </p>
          )}

          <select
            value={selectedCapaId ?? ""}
            onChange={(event) => {
              if (!event.target.value) {
                return;
              }
              selectCapa(Number(event.target.value));
            }}
            className={`w-full rounded-2xl border border-zinc-800 bg-zinc-950 text-zinc-200 outline-none transition-colors focus:border-cyan-500 ${
              collapsed ? "px-2 py-1 text-[11px]" : "mt-1.5 px-3 py-1.5 text-[13px]"
            }`}
            aria-label="Empresa activa"
            title={
              selectedCapa
                ? `${selectedCapa.nombre} - ${selectedCapa.tipo_capa}`
                : "Empresa activa"
            }
          >
            {capas.length === 0 ? (
              <option value="">Sin empresas</option>
            ) : (
              capas.map((capa) => (
                <option key={capa.id} value={capa.id}>
                  {capa.nombre}
                </option>
              ))
            )}
          </select>
        </div>
      </div>

      <nav
        className={`flex-1 space-y-3 overflow-y-auto ${
          collapsed ? "px-3 py-4" : "px-4 py-5"
        }`}
      >
        <div>
          {collapsed ? null : (
            <p className="mb-2 px-1 text-[11px] uppercase tracking-[0.24em] text-zinc-500">
              Navegacion
            </p>
          )}

          <div className={`space-y-2 ${collapsed ? "flex flex-col items-center" : ""}`}>
            {canUseModule("dashboard") ? (
              <SidebarLink
                href="/dashboard"
                label="Dashboard"
                active={pathname === "/dashboard"}
                icon={<DashboardIcon className={iconClasses(pathname === "/dashboard")} />}
                collapsed={collapsed}
                onClick={onClose}
              />
            ) : null}

            {canUseCommerce ? (
              <SidebarLink
                href="/soluciones/commerce/entrar"
                label="BetterP Commerce"
                active={false}
                icon={<CommerceIcon className={iconClasses(false)} />}
                collapsed={collapsed}
                onClick={onClose}
              />
            ) : null}

            <SidebarLink
              href="/onboarding"
              label="Onboarding"
              active={isOnboardingPath}
              icon={<CheckListIcon className={iconClasses(isOnboardingPath)} />}
              collapsed={collapsed}
              onClick={onClose}
            />
          </div>
        </div>

        <div className={`space-y-2 ${collapsed ? "flex flex-col items-center" : ""}`}>
          {canUseModule("entidades") ? (
            <SidebarLink
              href="/entidades"
              label="Unidades de negocio"
              active={pathname === "/entidades" || pathname.startsWith("/entidades/")}
              icon={
                <BuildingIcon
                  className={iconClasses(
                    pathname === "/entidades" || pathname.startsWith("/entidades/")
                  )}
                />
              }
              collapsed={collapsed}
              onClick={onClose}
            />
          ) : null}

          {canUseModule("clientes") ? (
            <SidebarLink
              href="/clientes"
              label="Clientes"
              active={pathname === "/clientes"}
              icon={<UserGroupIcon className={iconClasses(pathname === "/clientes")} />}
              collapsed={collapsed}
              onClick={onClose}
            />
          ) : null}
        </div>

        {canUseModule("renta_espacios") ? (
          <SidebarAccordion
          title="Renta de espacios"
          subtitle="Espacios, conexiones y publicacion"
          active={isRentaPath}
          open={rentaOpen}
          collapsed={collapsed}
          onToggle={() => setRentaOpen((current) => !current)}
          icon={
            <KeyIcon
              className={`h-5 w-5 shrink-0 ${
                isRentaPath || rentaOpen
                  ? "text-cyan-300"
                  : "text-zinc-500 group-hover:text-zinc-300"
              }`}
            />
          }
        >
          <SidebarLink
            href="/renta-espacios?tab=espacios"
            label="Espacios"
            compact
            active={activeRentaTab === "espacios"}
            icon={<span className="h-2 w-2 rounded-full bg-cyan-400" />}
            collapsed={collapsed}
            onClick={() => selectSidebarTab("espacios")}
          />

          {canUseFeature("batch_import") ? (
            <SidebarLink
              href="/renta-espacios?tab=batch"
              label="Carga batch"
              compact
              active={activeRentaTab === "batch"}
              icon={<span className="h-2 w-2 rounded-full bg-sky-300" />}
              collapsed={collapsed}
              onClick={() => selectSidebarTab("batch")}
            />
          ) : null}

          {canUseSocialPublishing ? (
            <SidebarLink
              href="/renta-espacios?tab=conexiones"
              label="Conexiones"
              compact
              active={activeRentaTab === "conexiones"}
              icon={<span className="h-2 w-2 rounded-full bg-emerald-300" />}
              collapsed={collapsed}
              onClick={() => selectSidebarTab("conexiones")}
            />
          ) : null}

          {canUseSocialPublishing ? (
            <SidebarLink
              href="/renta-espacios?tab=publicacion"
              label="Publicacion"
              compact
              active={activeRentaTab === "publicacion"}
              icon={<span className="h-2 w-2 rounded-full bg-amber-300" />}
              collapsed={collapsed}
              onClick={() => selectSidebarTab("publicacion")}
            />
          ) : null}
          </SidebarAccordion>
        ) : null}

        {canUseModule("marketing") ? (
          <SidebarAccordion
          title="Marketing"
          subtitle="Comunicados, calendario y metricas"
          active={isMarketingPath}
          open={marketingOpen}
          collapsed={collapsed}
          onToggle={() => setMarketingOpen((current) => !current)}
          icon={
            <MegaphoneIcon
              className={`h-5 w-5 shrink-0 ${
                isMarketingPath || marketingOpen
                  ? "text-cyan-300"
                  : "text-zinc-500 group-hover:text-zinc-300"
              }`}
            />
          }
        >
          <SidebarLink
            href="/marketing?tab=comunicados"
            label="Comunicados"
            compact
            active={activeMarketingTab === "comunicados"}
            icon={<span className="h-2 w-2 rounded-full bg-fuchsia-300" />}
            collapsed={collapsed}
            onClick={() => selectSidebarTab("comunicados")}
          />

          <SidebarLink
            href="/marketing?tab=calendario"
            label="Calendario"
            compact
            active={activeMarketingTab === "calendario"}
            icon={<span className="h-2 w-2 rounded-full bg-sky-300" />}
            collapsed={collapsed}
            onClick={() => selectSidebarTab("calendario")}
          />

          <SidebarLink
            href="/marketing?tab=espacios"
            label="Espacios disponibles"
            compact
            active={activeMarketingTab === "espacios"}
            icon={<span className="h-2 w-2 rounded-full bg-emerald-300" />}
            collapsed={collapsed}
            onClick={() => selectSidebarTab("espacios")}
          />

          <SidebarLink
            href="/marketing?tab=conexiones"
            label="Conexiones"
            compact
            active={activeMarketingTab === "conexiones"}
            icon={<span className="h-2 w-2 rounded-full bg-cyan-400" />}
            collapsed={collapsed}
            onClick={() => selectSidebarTab("conexiones")}
          />

          <SidebarLink
            href="/marketing?tab=metricas"
            label="Metricas"
            compact
            active={activeMarketingTab === "metricas"}
            icon={<span className="h-2 w-2 rounded-full bg-violet-300" />}
            collapsed={collapsed}
            onClick={() => selectSidebarTab("metricas")}
          />
          </SidebarAccordion>
        ) : null}

        {canUseModule("cobranza") ? (
          <SidebarAccordion
          title="Cobranza"
          subtitle="Cartera, mensajes y pagos"
          active={isCobranzaPath}
          open={cobranzaOpen}
          collapsed={collapsed}
          onToggle={() => setCobranzaOpen((current) => !current)}
          icon={
            <MessageCircleIcon
              className={`h-5 w-5 shrink-0 ${
                isCobranzaPath || cobranzaOpen
                  ? "text-cyan-300"
                  : "text-zinc-500 group-hover:text-zinc-300"
              }`}
            />
          }
        >
          <SidebarLink
            href="/cobranza?tab=cartera"
            label="Cartera CxC"
            compact
            active={activeCobranzaTab === "cartera"}
            icon={<span className="h-2 w-2 rounded-full bg-amber-300" />}
            collapsed={collapsed}
            onClick={() => selectSidebarTab("cartera")}
          />

          <SidebarLink
            href="/cobranza?tab=mensajes"
            label="Mensajes"
            compact
            active={activeCobranzaTab === "mensajes"}
            icon={<span className="h-2 w-2 rounded-full bg-teal-300" />}
            collapsed={collapsed}
            onClick={() => selectSidebarTab("mensajes")}
          />

          <SidebarLink
            href="/cobranza?tab=comprobantes"
            label="Comprobantes"
            compact
            active={activeCobranzaTab === "comprobantes"}
            icon={<span className="h-2 w-2 rounded-full bg-emerald-300" />}
            collapsed={collapsed}
            onClick={() => selectSidebarTab("comprobantes")}
          />

          <SidebarLink
            href="/cobranza?tab=automatizacion"
            label="Automatizacion"
            compact
            active={activeCobranzaTab === "automatizacion"}
            icon={<span className="h-2 w-2 rounded-full bg-violet-300" />}
            collapsed={collapsed}
            onClick={() => selectSidebarTab("automatizacion")}
          />

          {canUseInternalCobranza ? (
            <SidebarLink
              href="/cobranza?tab=preparacion"
              label="Preparacion"
              compact
              active={activeCobranzaTab === "preparacion"}
              icon={<span className="h-2 w-2 rounded-full bg-cyan-400" />}
              collapsed={collapsed}
              onClick={() => selectSidebarTab("preparacion")}
            />
          ) : null}

          {canUseInternalCobranza ? (
            <SidebarLink
              href="/cobranza?tab=reglas"
              label="Onboarding"
              compact
              active={activeCobranzaTab === "reglas"}
              icon={<span className="h-2 w-2 rounded-full bg-zinc-300" />}
              collapsed={collapsed}
              onClick={() => selectSidebarTab("reglas")}
            />
          ) : null}
          </SidebarAccordion>
        ) : null}

        {canUseModule("cxc") || canUseModule("cxp") ? (
          <SidebarAccordion
          title="Cuentas"
          subtitle="CxC y CxP"
          active={isAccountsPath}
          open={accountsOpen}
          collapsed={collapsed}
          onToggle={() => setAccountsOpen((current) => !current)}
          icon={
            <WalletIcon
              className={`h-5 w-5 shrink-0 ${
                isAccountsPath || accountsOpen
                  ? "text-cyan-300"
                  : "text-zinc-500 group-hover:text-zinc-300"
              }`}
            />
          }
        >
          {canUseModule("cxc") ? (
            <SidebarLink
              href="/cxc"
              label="CxC"
              compact
              active={pathname === "/cxc"}
              icon={<span className="h-2 w-2 rounded-full bg-cyan-400" />}
              collapsed={collapsed}
              onClick={onClose}
            />
          ) : null}

          {canUseModule("cxp") ? (
            <SidebarLink
              href="/cxp"
              label="CxP"
              compact
              active={pathname === "/cxp"}
              icon={<span className="h-2 w-2 rounded-full bg-amber-300" />}
              collapsed={collapsed}
              onClick={onClose}
            />
          ) : null}
          </SidebarAccordion>
        ) : null}

        {canUseModule("conciliacion") ? (
          <SidebarAccordion
          title="Conciliacion"
          subtitle="Bancos, cargas y movimientos"
          active={isConciliacionPath}
          open={conciliacionOpen}
          collapsed={collapsed}
          onToggle={() => setConciliacionOpen((current) => !current)}
          icon={
            <CheckListIcon
              className={`h-5 w-5 shrink-0 ${
                isConciliacionPath || conciliacionOpen
                  ? "text-cyan-300"
                  : "text-zinc-500 group-hover:text-zinc-300"
              }`}
            />
          }
        >
          <SidebarLink
            href="/conciliacion?tab=bancos"
            label="Bancos"
            compact
            active={activeConciliacionTab === "bancos"}
            icon={<span className="h-2 w-2 rounded-full bg-cyan-400" />}
            collapsed={collapsed}
            onClick={() => selectSidebarTab("bancos")}
          />

          <SidebarLink
            href="/conciliacion?tab=cargas"
            label="Cargas"
            compact
            active={activeConciliacionTab === "cargas"}
            icon={<span className="h-2 w-2 rounded-full bg-sky-300" />}
            collapsed={collapsed}
            onClick={() => selectSidebarTab("cargas")}
          />

          <SidebarLink
            href="/conciliacion?tab=movimientos"
            label="Movimientos"
            compact
            active={activeConciliacionTab === "movimientos"}
            icon={<span className="h-2 w-2 rounded-full bg-emerald-300" />}
            collapsed={collapsed}
            onClick={() => selectSidebarTab("movimientos")}
          />

          <SidebarLink
            href="/conciliacion?tab=sugerencias"
            label="Sugerencias"
            compact
            active={activeConciliacionTab === "sugerencias"}
            icon={<span className="h-2 w-2 rounded-full bg-amber-300" />}
            collapsed={collapsed}
            onClick={() => selectSidebarTab("sugerencias")}
          />
          </SidebarAccordion>
        ) : null}

        <div className={`space-y-2 ${collapsed ? "flex flex-col items-center" : ""}`}>
          <SidebarLink
            href="/configuracion"
            label="Configuracion"
            active={isConfiguracionPath}
            icon={<SettingsIcon className={iconClasses(isConfiguracionPath)} />}
            collapsed={collapsed}
            onClick={onClose}
          />
        </div>
      </nav>

      <div
        className={`space-y-2 border-t border-white/6 ${
          collapsed ? "px-3 py-3" : "px-4 py-4"
        } ${collapsed ? "flex flex-col items-center" : ""}`}
      >
        {user?.is_platform_admin ? (
          <SidebarLink
            href="/backoffice"
            label="Backoffice del negocio"
            active={isBackofficePath}
            icon={<BriefcaseIcon className={iconClasses(isBackofficePath)} />}
            collapsed={collapsed}
            onClick={onClose}
          />
        ) : null}

        <SidebarLink
          href="/documentacion"
          label="Documentacion"
          active={isDocumentationPath}
          icon={<BookIcon className={iconClasses(isDocumentationPath)} />}
          collapsed={collapsed}
          onClick={onClose}
        />
      </div>
    </aside>
  );
}
