"use client";

import { useEffect, useMemo, useState } from "react";

import AccessControlManager from "./AccessControlManager";
import AuditTrailManager from "./AuditTrailManager";
import BillingSubscriptionManager from "./BillingSubscriptionManager";
import CapaNegocioConfigManager from "./CapaNegocioConfigManager";
import IntegracionesConciliacionManager from "./IntegracionesConciliacionManager";
import PaymentGatewayBackofficeManager from "./PaymentGatewayBackofficeManager";
import PlatformBillingProfileManager from "./PlatformBillingProfileManager";

type GlobalConfigTab =
  | "integraciones"
  | "pasarela_pagos"
  | "plataforma_facturacion"
  | "admins"
  | "capa_negocio"
  | "seguridad"
  | "auditoria"
  | "billing";

type ConfiguracionAudience = "cliente" | "backoffice";

interface ConfiguracionManagerProps {
  audience?: ConfiguracionAudience;
}

const TAB_OPTIONS: Array<{
  id: GlobalConfigTab;
  label: string;
  description: string;
  audience: ConfiguracionAudience;
}> = [
  {
    id: "integraciones",
    label: "Integraciones y automatizacion",
    description:
      "WhatsApp oficial, webhook, cola operativa, comprobantes y disparadores financieros.",
    audience: "backoffice",
  },
  {
    id: "pasarela_pagos",
    label: "Pasarela de pagos",
    description:
      "Stripe, webhooks, price IDs y eventos de pago administrados por backoffice.",
    audience: "backoffice",
  },
  {
    id: "plataforma_facturacion",
    label: "Datos fiscales BetterP",
    description:
      "Emisor interno, domicilio fiscal, serie CFDI y cuenta bancaria para facturar suscripciones SaaS.",
    audience: "backoffice",
  },
  {
    id: "admins",
    label: "Administradores internos",
    description:
      "Invitaciones y accesos del equipo BetterP, separados de usuarios de clientes.",
    audience: "backoffice",
  },
  {
    id: "capa_negocio",
    label: "Datos de negocio y facturacion",
    description:
      "Datos fiscales, portal de clientes, transferencia referenciada y reglas marco.",
    audience: "cliente",
  },
  {
    id: "seguridad",
    label: "Seguridad y accesos",
    description:
      "Invitaciones, miembros activos, cambio de rol y control por capa.",
    audience: "cliente",
  },
  {
    id: "auditoria",
    label: "Auditoria",
    description:
      "Bitacora de cambios criticos para soporte, conciliacion y trazabilidad operativa.",
    audience: "cliente",
  },
  {
    id: "billing",
    label: "Suscripcion y facturacion",
    description:
      "Planes SaaS, limites, checkout y eventos de Stripe por capa.",
    audience: "cliente",
  },
];

const TAB_HASHES: Record<GlobalConfigTab, string> = {
  integraciones: "integraciones",
  pasarela_pagos: "pasarela-pagos",
  plataforma_facturacion: "datos-fiscales-betterp",
  admins: "administradores",
  capa_negocio: "datos-negocio",
  seguridad: "seguridad",
  auditoria: "auditoria",
  billing: "suscripcion",
};

function getTabFromHash(hash: string): GlobalConfigTab | null {
  const normalizedHash = hash.replace("#", "");
  const match = Object.entries(TAB_HASHES).find(
    ([, value]) => value === normalizedHash
  );
  return (match?.[0] as GlobalConfigTab | undefined) ?? null;
}

export default function ConfiguracionManager({
  audience = "cliente",
}: ConfiguracionManagerProps) {
  const isBackoffice = audience === "backoffice";
  const defaultTab: GlobalConfigTab = isBackoffice
    ? "integraciones"
    : "capa_negocio";
  const visibleTabs = useMemo(
    () =>
      TAB_OPTIONS.filter((tab) => tab.audience === audience),
    [audience]
  );
  const [activeTab, setActiveTab] = useState<GlobalConfigTab>(defaultTab);

  useEffect(() => {
    const syncHash = () => {
      const nextTab = getTabFromHash(window.location.hash);
      if (nextTab && visibleTabs.some((tab) => tab.id === nextTab)) {
        setActiveTab(nextTab);
        return;
      }
      setActiveTab(defaultTab);
    };

    syncHash();
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, [defaultTab, visibleTabs]);

  const selectTab = (tabId: GlobalConfigTab) => {
    setActiveTab(tabId);
    window.history.replaceState(null, "", `#${TAB_HASHES[tabId]}`);
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <section className="rounded-3xl border border-zinc-800 bg-gradient-to-br from-zinc-950 via-zinc-950 to-zinc-900 p-6 shadow-xl">
        <div className="max-w-4xl space-y-3">
          <h1 className="text-3xl font-bold text-white">
            {isBackoffice
              ? "Configuracion tecnica de plataforma"
              : "Configuracion del negocio"}
          </h1>
          <p className="text-sm text-zinc-400">
            {isBackoffice
              ? "Administra integraciones, proveedores, webhooks y parametros internos que no deben quedar expuestos al usuario final."
              : "Ajusta datos de negocio, seguridad, suscripcion y preferencias visibles para operar la capa sin mezclar credenciales tecnicas."}
          </p>
        </div>
      </section>

      <section className="rounded-3xl border border-zinc-800 bg-zinc-950/70 p-5">
        <div className="flex flex-col gap-4 border-b border-zinc-800 pb-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-xl font-bold text-white">
              {isBackoffice ? "Administracion interna" : "Preferencias"}
            </h2>
            <p className="mt-1 text-sm text-zinc-500">
              {isBackoffice
                ? "Navega por modulos tecnicos y operativos administrados por el equipo de BetterP."
                : "Navega por la configuracion que el cliente puede operar directamente."}
            </p>
          </div>
          <div className="text-xs uppercase tracking-[0.22em] text-zinc-500">
            {isBackoffice ? "Backoffice interno" : "BetterP Setup"}
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-2">
          {visibleTabs.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => selectTab(tab.id)}
                className={`rounded-2xl border p-4 text-left transition-colors ${
                  active
                    ? "border-cyan-500/30 bg-cyan-500/10"
                    : "border-zinc-800 bg-zinc-900/40 hover:border-zinc-700"
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="font-semibold text-white">{tab.label}</h3>
                    <p className="mt-2 text-sm text-zinc-500">{tab.description}</p>
                  </div>
                  <span
                    className={`mt-1 rounded-full border px-2.5 py-1 text-[11px] ${
                      active
                        ? "border-cyan-500/30 bg-cyan-500/10 text-cyan-200"
                        : "border-zinc-700 bg-zinc-900 text-zinc-400"
                    }`}
                  >
                    {active ? "Activa" : "Abrir"}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {isBackoffice && activeTab === "integraciones" ? (
        <IntegracionesConciliacionManager />
      ) : null}
      {isBackoffice && activeTab === "pasarela_pagos" ? (
        <PaymentGatewayBackofficeManager />
      ) : null}
      {isBackoffice && activeTab === "plataforma_facturacion" ? (
        <PlatformBillingProfileManager />
      ) : null}
      {isBackoffice && activeTab === "admins" ? (
        <section className="rounded-3xl border border-zinc-800 bg-zinc-950/70 p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-300">
                Accesos internos
              </p>
              <h2 className="mt-2 text-xl font-bold text-white">
                Administradores de plataforma
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-7 text-zinc-500">
                Gestiona solamente al equipo BetterP que puede entrar al backoffice.
                Los usuarios de cada cliente viven en su propia capa operativa.
              </p>
            </div>
            <a
              href="/backoffice/admins"
              className="inline-flex items-center justify-center rounded-2xl border border-cyan-500/20 bg-cyan-500/10 px-5 py-3 text-sm font-medium text-cyan-100 transition hover:border-cyan-400/40 hover:bg-cyan-500/15"
            >
              Abrir administradores
            </a>
          </div>
        </section>
      ) : null}
      {!isBackoffice && activeTab === "capa_negocio" ? (
        <CapaNegocioConfigManager />
      ) : null}
      {!isBackoffice && activeTab === "seguridad" ? <AccessControlManager /> : null}
      {!isBackoffice && activeTab === "auditoria" ? <AuditTrailManager /> : null}
      {!isBackoffice && activeTab === "billing" ? (
        <BillingSubscriptionManager />
      ) : null}
    </div>
  );
}
