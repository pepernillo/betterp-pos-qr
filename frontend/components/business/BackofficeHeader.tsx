"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import ThemeToggle from "@/components/theme/ThemeToggle";
import {
  getBackofficeHref,
  getBackofficeSectionFromPath,
} from "./backoffice-nav";

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

function getBackofficeMeta(pathname: string) {
  const section = getBackofficeSectionFromPath(pathname);

  if (section === "clientes") {
    return {
      eyebrow: "Betterp",
      title: "Clientes SaaS",
      description:
        "Suscriptores, capacidad consumida, renovaciones y uso real de la plataforma Betterp.",
    };
  }

  if (section === "soluciones") {
    return {
      eyebrow: "BetterP",
      title: "Soluciones",
      description:
        "Catalogo master para operar Renta Facil y BetterP Commerce dentro de la plataforma.",
    };
  }

  if (section === "salud") {
    return {
      eyebrow: "Sistema",
      title: "Salud operativa",
      description:
        "Monitoreo interno de requests, backups, Stripe, webhooks y eventos criticos de BetterP.",
    };
  }

  if (section === "planes") {
    return {
      eyebrow: "Betterp",
      title: "Planes y oferta",
      description:
        "Edita precios, limites y propuestas personalizadas para el catalogo comercial de Betterp.",
    };
  }

  if (section === "admins") {
    return {
      eyebrow: "Betterp",
      title: "Admins de plataforma",
      description:
        "Gestion interna del equipo con acceso al backoffice, invitaciones y seguridad del ecosistema SaaS.",
    };
  }

  if (section === "marketing") {
    return {
      eyebrow: "Betterp",
      title: "Publicidad y mkt",
      description:
        "Canales, automatizaciones, embudo comercial y salud de la comunicacion de la plataforma.",
    };
  }

  if (section === "solicitudes") {
    return {
      eyebrow: "Betterp",
      title: "Solicitudes e inbox",
      description:
        "Landing, WhatsApp y comprobantes en una sola vista para seguimiento comercial y operativo.",
    };
  }

  if (section === "configuracion") {
    return {
      eyebrow: "Sistema",
      title: "Configuracion interna",
      description:
        "Proveedores, webhooks, WhatsApp, correo y parametros tecnicos administrados por BetterP.",
    };
  }

  if (pathname === "/configuracion") {
    return {
      eyebrow: "Sistema",
      title: "Configuracion interna",
      description: "Parametros, integraciones y datos base de la plataforma Betterp.",
    };
  }

  return {
    eyebrow: "Betterp",
    title: "Backoffice de plataforma",
    description:
      "Dashboard privado para suscriptores, ingresos, solicitudes, marketing y operacion comercial.",
  };
}

interface BackofficeHeaderProps {
  onMenuToggle?: () => void;
}

export default function BackofficeHeader({
  onMenuToggle,
}: BackofficeHeaderProps) {
  const pathname = usePathname();
  const { logout, user } = useAuth();
  const meta = getBackofficeMeta(pathname);
  const [todayLabel, setTodayLabel] = useState("");
  const menuRef = useRef<HTMLDetailsElement | null>(null);

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
          <details ref={menuRef} className="relative shrink-0">
          <summary className="flex cursor-pointer list-none items-center gap-2.5 rounded-2xl border border-white/10 bg-zinc-900/80 px-2 py-1.5 text-sm text-zinc-300 transition-colors hover:border-zinc-700 hover:text-white">
            <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 text-sm font-bold text-white shadow-lg shadow-cyan-950/40">
              {user?.initials ?? "BP"}
            </span>
            <span className="hidden min-w-0 pr-1 text-left sm:block">
              <span className="block text-sm font-medium text-white">
                {user?.nombre ?? "Backoffice"}
              </span>
              <span className="block text-[11px] text-zinc-500">
                Betterp | Plataforma SaaS
              </span>
            </span>
          </summary>

          <div className="absolute right-0 z-20 mt-3 w-72 rounded-3xl border border-white/10 bg-zinc-950/95 p-2 shadow-2xl">
            <div className="rounded-2xl border border-white/5 bg-zinc-900/60 px-4 py-4">
              <p className="text-sm font-semibold text-white">
                {user?.nombre ?? "Backoffice"}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-zinc-500">
                {user?.email ?? "Sin correo"}
              </p>
              <p className="mt-2 text-[11px] uppercase tracking-[0.18em] text-cyan-300">
                Admin de plataforma | Betterp
              </p>
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
                href="/backoffice"
                onClick={closeUserMenu}
                className="flex items-center justify-between rounded-2xl px-4 py-3 text-sm text-zinc-300 transition-colors hover:bg-zinc-900 hover:text-white"
              >
                <span>Dashboard de plataforma</span>
                <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                  SaaS
                </span>
              </Link>
              <Link
                href={getBackofficeHref("admins")}
                onClick={closeUserMenu}
                className="flex items-center justify-between rounded-2xl px-4 py-3 text-sm text-zinc-300 transition-colors hover:bg-zinc-900 hover:text-white"
              >
                <span>Admins de plataforma</span>
                <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                  Interno
                </span>
              </Link>
              <Link
                href={getBackofficeHref("solicitudes")}
                onClick={closeUserMenu}
                className="flex items-center justify-between rounded-2xl px-4 py-3 text-sm text-zinc-300 transition-colors hover:bg-zinc-900 hover:text-white"
              >
                <span>Inbox comercial</span>
                <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                  Leads
                </span>
              </Link>
              <button
                type="button"
                onClick={() => {
                  closeUserMenu();
                  void logout({ redirectTo: "/backoffice/login" });
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
