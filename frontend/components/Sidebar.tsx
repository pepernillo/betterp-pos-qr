"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode } from "react";

import { useAuth } from "./auth/AuthProvider";
import { POS_NAV } from "@/lib/pos-segment";
import {
  hasPlanFeature,
  hasPlanModule,
  type PlanAccessSubscription,
} from "@/lib/plan-access";

type IconProps = { className?: string };

interface CapaNegocioLite {
  id: number;
  nombre: string;
  tipo_capa: string;
  activo: boolean;
}

interface SidebarProps {
  mobileOpen?: boolean;
  onClose?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  subscription?: PlanAccessSubscription;
}

function Icon({ className = "", children }: IconProps & { children: ReactNode }) {
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
      {children}
    </svg>
  );
}

const DashboardIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 13.5h8v7.5H3z" />
    <path d="M13 3h8v10h-8z" />
    <path d="M13 16.5h8V21h-8z" />
    <path d="M3 3h8v8H3z" />
  </Icon>
);

const CajaIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="7" width="18" height="13" rx="2" />
    <path d="M7 7V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2" />
    <path d="M7 12h4" />
    <path d="M15 16h2" />
  </Icon>
);

const MesaIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="9" r="5" />
    <path d="M12 14v7" />
    <path d="M8 21h8" />
  </Icon>
);

const ComandaIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
    <path d="M9 8h6" />
    <path d="M9 12h6" />
  </Icon>
);

const ProductoIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M21 8 12 3 3 8l9 5z" />
    <path d="M3 8v8l9 5 9-5V8" />
    <path d="M12 13v8" />
  </Icon>
);

const CatalogoIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-2z" />
    <path d="M8 7h6" />
    <path d="M8 11h6" />
  </Icon>
);

const InventarioIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 9h18v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
    <path d="M3 9 5 4h14l2 5" />
    <path d="M10 14h4" />
  </Icon>
);

const QrIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <path d="M14 14h3v3h-3z" />
    <path d="M20 14v3" />
    <path d="M14 20h7" />
  </Icon>
);

const CorteIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Icon>
);

const ReporteIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 20V10" />
    <path d="M10 20V4" />
    <path d="M16 20v-7" />
    <path d="M3 20h18" />
  </Icon>
);

const ClienteIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
    <path d="M17 8.5a3 3 0 1 0 0 5" />
    <path d="M21.5 20a5 5 0 0 0-3.5-4.8" />
  </Icon>
);

const ConfigIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" />
  </Icon>
);

const BackofficeIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 9h18" />
    <path d="M8 14h8" />
  </Icon>
);

function PanelToggleIcon({ className = "", collapsed = false }: IconProps & { collapsed?: boolean }) {
  return (
    <Icon className={className}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
      <path d={collapsed ? "M13 10l3 2-3 2" : "M17 10l-3 2 3 2"} />
    </Icon>
  );
}

const CloseIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 6l12 12" />
    <path d="M18 6 6 18" />
  </Icon>
);

function linkClasses(active: boolean, collapsed: boolean) {
  const base =
    "group flex items-center rounded-2xl border transition-colors duration-150 " +
    (collapsed ? "h-11 w-11 justify-center" : "gap-3 px-3 py-2.5");
  return active
    ? `${base} border-cyan-500/30 bg-cyan-500/10 text-white`
    : `${base} border-transparent text-zinc-400 hover:border-white/10 hover:bg-white/5 hover:text-zinc-100`;
}

function iconClasses(active: boolean) {
  return `h-5 w-5 shrink-0 ${active ? "text-cyan-300" : "text-zinc-500 group-hover:text-zinc-300"}`;
}

function SidebarLink({
  href,
  label,
  active,
  icon: IconComponent,
  collapsed = false,
  onClick,
}: {
  href: string;
  label: string;
  active: boolean;
  icon: (props: IconProps) => ReactNode;
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
      {IconComponent({ className: iconClasses(active) })}
      {collapsed ? null : <span className="font-medium">{label}</span>}
    </Link>
  );
}

function SectionLabel({ children, collapsed }: { children: ReactNode; collapsed: boolean }) {
  if (collapsed) return null;
  return (
    <p className="mb-2 px-1 text-[11px] uppercase tracking-[0.24em] text-zinc-500">{children}</p>
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
  const { memberships, currentMembership, selectedCapaId, selectCapa, isOwnerAdmin } = useAuth();

  const capas: CapaNegocioLite[] = memberships.map((membership) => ({
    id: membership.capa_negocio.id,
    nombre: membership.capa_negocio.nombre,
    tipo_capa: membership.capa_negocio.tipo_capa,
    activo: membership.capa_negocio.activo,
  }));
  const selectedCapa =
    currentMembership?.capa_negocio ??
    capas.find((item) => item.id === selectedCapaId) ??
    capas[0] ??
    null;

  const canUseModule = (moduleKey: string) => hasPlanModule(subscription, moduleKey);
  const canUseFeature = (featureKey: string) => hasPlanFeature(subscription, featureKey);
  const isActive = (href: string) => pathname === href;

  const venta = [
    { href: POS_NAV.caja, label: "Caja", icon: CajaIcon, show: canUseModule("pos_caja") },
    { href: POS_NAV.mesas, label: "Mesas", icon: MesaIcon, show: canUseModule("restaurante") },
    {
      href: POS_NAV.comandas,
      label: "Comandas",
      icon: ComandaIcon,
      show: canUseModule("restaurante"),
    },
    { href: POS_NAV.corte, label: "Corte de caja", icon: CorteIcon, show: canUseModule("pos_caja") },
  ];

  const catalogo = [
    { href: POS_NAV.productos, label: "Productos", icon: ProductoIcon, show: canUseModule("catalogo") },
    { href: POS_NAV.catalogos, label: "Catalogos", icon: CatalogoIcon, show: canUseModule("catalogo") },
    {
      href: POS_NAV.inventario,
      label: "Inventario",
      icon: InventarioIcon,
      show: canUseModule("inventario"),
    },
  ];

  const operacion = [
    { href: POS_NAV.cajas, label: "Puntos de venta", icon: QrIcon, show: canUseModule("pos_caja") },
    { href: POS_NAV.reportes, label: "Reportes", icon: ReporteIcon, show: canUseModule("reportes") },
    { href: "/clientes", label: "Clientes", icon: ClienteIcon, show: canUseModule("clientes") },
  ];

  const renderGroup = (
    titulo: string,
    items: { href: string; label: string; icon: (p: IconProps) => ReactNode; show: boolean }[]
  ) => {
    const visibles = items.filter((item) => item.show);
    if (visibles.length === 0) return null;
    return (
      <div>
        <SectionLabel collapsed={collapsed}>{titulo}</SectionLabel>
        <div className={`space-y-2 ${collapsed ? "flex flex-col items-center" : ""}`}>
          {visibles.map((item) => (
            <SidebarLink
              key={item.href}
              href={item.href}
              label={item.label}
              active={isActive(item.href)}
              icon={item.icon}
              collapsed={collapsed}
              onClick={onClose}
            />
          ))}
        </div>
      </div>
    );
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
              QR
            </div>
          ) : (
            <div>
              <h1 className="text-xl font-bold tracking-wide text-white">
                BetterP <span className="text-cyan-400">POS QR</span>
              </h1>
              <p className="mt-1 text-xs text-zinc-500">Mostrador y restaurante</p>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleCollapse}
            className="hidden h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-zinc-900/70 text-zinc-300 transition-colors hover:border-zinc-700 hover:text-white lg:flex"
            aria-label={collapsed ? "Expandir barra lateral" : "Contraer barra lateral"}
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

      <div className={`border-b border-white/6 ${collapsed ? "px-3 py-2" : "px-4 py-2"}`}>
        <div
          className={`rounded-[26px] border border-white/6 bg-zinc-900/65 ${
            collapsed ? "p-2" : "px-3 py-2.5"
          }`}
        >
          {collapsed ? null : (
            <p className="text-[9px] uppercase tracking-[0.2em] text-zinc-500">Empresa activa</p>
          )}
          <select
            value={selectedCapaId ?? ""}
            onChange={(event) => {
              if (!event.target.value) return;
              selectCapa(Number(event.target.value));
            }}
            className={`w-full rounded-2xl border border-zinc-800 bg-zinc-950 text-zinc-200 outline-none transition-colors focus:border-cyan-500 ${
              collapsed ? "px-2 py-1 text-[11px]" : "mt-1.5 px-3 py-1.5 text-[13px]"
            }`}
            aria-label="Empresa activa"
            title={selectedCapa ? selectedCapa.nombre : "Empresa activa"}
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

      <nav className={`flex-1 space-y-5 overflow-y-auto ${collapsed ? "px-3 py-4" : "px-4 py-5"}`}>
        <div>
          <SectionLabel collapsed={collapsed}>Resumen</SectionLabel>
          <div className={`space-y-2 ${collapsed ? "flex flex-col items-center" : ""}`}>
            {canUseModule("dashboard") ? (
              <SidebarLink
                href="/dashboard"
                label="Tablero"
                active={isActive("/dashboard")}
                icon={DashboardIcon}
                collapsed={collapsed}
                onClick={onClose}
              />
            ) : null}
          </div>
        </div>

        {renderGroup("Venta", venta)}
        {renderGroup("Catalogo", catalogo)}
        {renderGroup("Operacion", operacion)}

        <div>
          <SectionLabel collapsed={collapsed}>Cuenta</SectionLabel>
          <div className={`space-y-2 ${collapsed ? "flex flex-col items-center" : ""}`}>
            <SidebarLink
              href="/configuracion"
              label="Configuracion"
              active={isActive("/configuracion")}
              icon={ConfigIcon}
              collapsed={collapsed}
              onClick={onClose}
            />
            {isOwnerAdmin ? (
              <SidebarLink
                href="/backoffice"
                label="Backoffice"
                active={pathname.startsWith("/backoffice")}
                icon={BackofficeIcon}
                collapsed={collapsed}
                onClick={onClose}
              />
            ) : null}
          </div>
        </div>

        {collapsed || !canUseFeature("menu_qr_publico") ? null : (
          <p className="rounded-2xl border border-white/6 bg-zinc-900/50 px-3 py-2 text-[11px] leading-relaxed text-zinc-500">
            El menu por QR de cada mesa se administra desde{" "}
            <Link href={POS_NAV.mesas} className="text-cyan-300 hover:underline">
              Mesas
            </Link>
            .
          </p>
        )}
      </nav>
    </aside>
  );
}
