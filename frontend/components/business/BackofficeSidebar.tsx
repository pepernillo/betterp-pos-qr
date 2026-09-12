"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode } from "react";

import {
  getBackofficeHref,
  getBackofficeSectionFromPath,
} from "./backoffice-nav";

type IconProps = {
  className?: string;
};

interface BackofficeSidebarProps {
  mobileOpen?: boolean;
  onClose?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
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

function UsersIcon({ className = "" }: IconProps) {
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

function LayersIcon({ className = "" }: IconProps) {
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
      <path d="m12 3 9 4.5-9 4.5-9-4.5L12 3Z" />
      <path d="m3 12 9 4.5 9-4.5" />
      <path d="m3 16.5 9 4.5 9-4.5" />
    </svg>
  );
}

function SalesIcon({ className = "" }: IconProps) {
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
      <path d="M4 19h16" />
      <path d="m7 15 3.5-3.5 3 2.5L19 7" />
      <path d="M17 7h2v2" />
      <path d="M5 5.5A1.5 1.5 0 0 1 6.5 4h4A1.5 1.5 0 0 1 12 5.5V7H5z" />
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
      <path d="M3 11v2a2 2 0 0 0 2 2h2l4 4V5L7 9H5a2 2 0 0 0-2 2Z" />
      <path d="M16 8.5a4.5 4.5 0 0 1 0 7" />
      <path d="M18.5 6a8 8 0 0 1 0 12" />
    </svg>
  );
}

function InboxIcon({ className = "" }: IconProps) {
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
      <path d="M4 13.5V6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v7" />
      <path d="M4 13.5 6.5 19h11L20 13.5" />
      <path d="M9 13h6" />
    </svg>
  );
}

function ShieldIcon({ className = "" }: IconProps) {
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
      <path d="M12 3 5 6v6c0 4.5 2.9 7.9 7 9 4.1-1.1 7-4.5 7-9V6l-7-3Z" />
      <path d="m9.5 12 1.7 1.7L14.8 10" />
    </svg>
  );
}

function ActivityIcon({ className = "" }: IconProps) {
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
      <path d="M3 12h4l2-6 4 12 2-6h6" />
      <path d="M19 4v4h-4" />
      <path d="M15 8 19 4" />
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
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 1.55V21a2 2 0 0 1-4 0v-.08a1.7 1.7 0 0 0-1-1.52 1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 0 1 0-4h.08a1.7 1.7 0 0 0 1.52-1 1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.08a1.7 1.7 0 0 0 1 1.52 1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.23.58.79.98 1.42 1H21a2 2 0 0 1 0 4h-.08a1.7 1.7 0 0 0-1.52 1Z" />
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

function linkClasses(active: boolean, collapsed = false) {
  const base = collapsed
    ? "group flex h-12 w-12 items-center justify-center rounded-2xl border transition-colors"
    : "group flex items-center gap-3 rounded-2xl border px-4 py-3 transition-colors";

  return `${base} ${
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

function BackofficeLink({
  href,
  label,
  active,
  icon,
  collapsed = false,
  onClick,
}: {
  href: string;
  label: string;
  active: boolean;
  icon: ReactNode;
  collapsed?: boolean;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      className={linkClasses(active, collapsed)}
      onClick={onClick}
      title={collapsed ? label : undefined}
      aria-label={label}
    >
      {icon}
      {collapsed ? null : <span className="font-medium">{label}</span>}
    </Link>
  );
}

export default function BackofficeSidebar({
  mobileOpen = false,
  onClose,
  collapsed = false,
  onToggleCollapse,
}: BackofficeSidebarProps) {
  const pathname = usePathname();
  const currentSection = getBackofficeSectionFromPath(pathname);

  const navItems = [
    {
      href: getBackofficeHref("dashboard"),
      label: "Dashboard",
      active: currentSection === "dashboard",
      icon: <DashboardIcon className={iconClasses(currentSection === "dashboard")} />,
    },
    {
      href: getBackofficeHref("soluciones"),
      label: "Soluciones",
      active: currentSection === "soluciones",
      icon: <LayersIcon className={iconClasses(currentSection === "soluciones")} />,
    },
    {
      href: getBackofficeHref("salud"),
      label: "Salud operativa",
      active: currentSection === "salud",
      icon: <ActivityIcon className={iconClasses(currentSection === "salud")} />,
    },
    {
      href: getBackofficeHref("clientes"),
      label: "Clientes SaaS",
      active: currentSection === "clientes",
      icon: <UsersIcon className={iconClasses(currentSection === "clientes")} />,
    },
    {
      href: getBackofficeHref("ventas"),
      label: "Ventas BetterP",
      active: currentSection === "ventas",
      icon: <SalesIcon className={iconClasses(currentSection === "ventas")} />,
    },
    {
      href: getBackofficeHref("planes"),
      label: "Planes",
      active: currentSection === "planes",
      icon: <LayersIcon className={iconClasses(currentSection === "planes")} />,
    },
    {
      href: getBackofficeHref("admins"),
      label: "Admins de plataforma",
      active: currentSection === "admins",
      icon: <ShieldIcon className={iconClasses(currentSection === "admins")} />,
    },
    {
      href: getBackofficeHref("marketing"),
      label: "Publicidad y mkt",
      active: currentSection === "marketing",
      icon: <MegaphoneIcon className={iconClasses(currentSection === "marketing")} />,
    },
    {
      href: getBackofficeHref("solicitudes"),
      label: "Solicitudes",
      active: currentSection === "solicitudes",
      icon: <InboxIcon className={iconClasses(currentSection === "solicitudes")} />,
    },
    {
      href: getBackofficeHref("configuracion"),
      label: "Configuracion",
      active: currentSection === "configuracion",
      icon: <SettingsIcon className={iconClasses(currentSection === "configuracion")} />,
    },
  ];

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
              <p className="mt-1 text-xs text-zinc-500">Backoffice de plataforma</p>
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
            collapsed ? "p-3" : "px-3 py-3"
          }`}
        >
          {collapsed ? (
            <div className="flex justify-center">
              <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-cyan-200">
                BET
              </span>
            </div>
          ) : (
            <>
              <p className="text-[9px] uppercase tracking-[0.2em] text-zinc-500">
                Plataforma activa
              </p>
              <div className="mt-1.5 rounded-2xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-[13px] text-zinc-200">
                Betterp
              </div>
              <p className="mt-2 text-[11px] text-zinc-500">
                Ecosistema interno para ventas, suscriptores y operacion SaaS.
              </p>
            </>
          )}
        </div>
      </div>

      <nav
        className={`flex-1 space-y-5 overflow-y-auto ${
          collapsed ? "px-3 py-4" : "px-4 py-5"
        }`}
      >
        <div>
          {collapsed ? null : (
            <p className="mb-2 px-1 text-[11px] uppercase tracking-[0.24em] text-zinc-500">
              Backoffice
            </p>
          )}

          <div className={`space-y-2 ${collapsed ? "flex flex-col items-center" : ""}`}>
            {navItems.map((item) => (
              <BackofficeLink
                key={item.href}
                href={item.href}
                label={item.label}
                active={item.active}
                icon={item.icon}
                collapsed={collapsed}
                onClick={onClose}
              />
            ))}
          </div>
        </div>
      </nav>
    </aside>
  );
}
