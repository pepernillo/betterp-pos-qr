"use client";

import { useEffect, useState } from "react";

import { buildApiUrl } from "@/lib/api";

type SalesMetrics = {
  ingreso_mensual_estimado: number;
  costos_operativos: number;
  utilidad_bruta: number;
  comision_estimada: number;
  margen: number;
};

type PortalClient = {
  id: number;
  estatus: string;
  periodicidad: string;
  plan: {
    nombre: string;
  };
  capa_negocio: {
    nombre: string;
    correo_contacto?: string | null;
  };
  asignacion_comercial?: {
    origen: string;
    porcentaje_comision: number;
    comision_activa: boolean;
    fecha_inicio?: string | null;
    fecha_fin?: string | null;
  } | null;
  costos_operativos: {
    id: number;
    categoria: string;
    concepto: string;
    monto_mensual: number;
    activo: boolean;
  }[];
  metricas_ventas: SalesMetrics;
};

type PortalPayload = {
  vendedor: {
    nombre: string;
    email: string;
  };
  resumen: SalesMetrics & {
    clientes: number;
    clientes_con_vendedor: number;
  };
  clientes: PortalClient[];
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function formatPercent(value: number) {
  return `${new Intl.NumberFormat("es-MX", { maximumFractionDigits: 1 }).format(value || 0)}%`;
}

function shellCardClass(extra = "") {
  return `rounded-[28px] border border-white/8 bg-zinc-950/75 shadow-[0_20px_80px_rgba(0,0,0,0.24)] ${extra}`;
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <article className={`${shellCardClass("p-5")} bg-gradient-to-br from-cyan-500/10 via-zinc-950/70 to-zinc-950/70`}>
      <p className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">{label}</p>
      <p className="mt-3 text-3xl font-semibold text-white">{value}</p>
    </article>
  );
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json().catch(() => ({}))) as T;
}

export default function SellerCommissionPortal({ token }: { token: string }) {
  const [data, setData] = useState<PortalPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    async function loadPortal() {
      try {
        const response = await fetch(buildApiUrl(`/billing/ventas/vendedor/${token}/`), {
          cache: "no-store",
        });
        const body = await readJson<PortalPayload & { detail?: string }>(response);
        if (!response.ok) {
          throw new Error(body.detail || "No se pudo abrir el portal del vendedor.");
        }
        setData(body);
      } catch (error) {
        setErrorMessage(
          error instanceof Error ? error.message : "No se pudo abrir el portal del vendedor."
        );
      } finally {
        setLoading(false);
      }
    }
    void loadPortal();
  }, [token]);

  return (
    <main className="min-h-screen bg-zinc-950 px-4 py-8 text-zinc-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-5">
        <section className={shellCardClass("p-5")}>
          <p className="text-[11px] uppercase tracking-[0.26em] text-zinc-500">
            Betterp | Portal vendedor
          </p>
          <h1 className="mt-3 text-2xl font-semibold text-white">
            {data?.vendedor.nombre || "Ventas BetterP"}
          </h1>
          <p className="mt-2 text-sm leading-7 text-zinc-400">
            Vista privada de clientes atribuidos, MRR, costos, utilidad y comision estimada.
          </p>
        </section>

        {loading ? (
          <div className="grid gap-4 md:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="h-40 animate-pulse rounded-[28px] border border-white/8 bg-zinc-900/60" />
            ))}
          </div>
        ) : null}

        {errorMessage ? (
          <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {errorMessage}
          </div>
        ) : null}

        {data ? (
          <>
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              <MetricCard label="Clientes" value={String(data.resumen.clientes)} />
              <MetricCard label="MRR atribuido" value={formatCurrency(data.resumen.ingreso_mensual_estimado)} />
              <MetricCard label="Costos" value={formatCurrency(data.resumen.costos_operativos)} />
              <MetricCard label="Utilidad bruta" value={formatCurrency(data.resumen.utilidad_bruta)} />
              <MetricCard label="Comision" value={formatCurrency(data.resumen.comision_estimada)} />
            </section>

            <section className={shellCardClass("p-5")}>
              <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Clientes vendidos</p>
              <div className="mt-5 space-y-4">
                {data.clientes.map((client) => (
                  <article key={client.id} className="rounded-3xl border border-white/8 bg-zinc-900/60 p-4">
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                      <div>
                        <h2 className="text-lg font-semibold text-white">{client.capa_negocio.nombre}</h2>
                        <p className="mt-2 text-sm text-zinc-400">
                          {client.plan.nombre} | {client.periodicidad} | {client.estatus}
                        </p>
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-right sm:grid-cols-5 xl:min-w-[520px]">
                        <div>
                          <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">MRR</p>
                          <p className="text-sm font-semibold text-white">{formatCurrency(client.metricas_ventas.ingreso_mensual_estimado)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Costos</p>
                          <p className="text-sm font-semibold text-white">{formatCurrency(client.metricas_ventas.costos_operativos)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Utilidad</p>
                          <p className="text-sm font-semibold text-white">{formatCurrency(client.metricas_ventas.utilidad_bruta)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Comision</p>
                          <p className="text-sm font-semibold text-white">{formatCurrency(client.metricas_ventas.comision_estimada)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Margen</p>
                          <p className="text-sm font-semibold text-white">{formatPercent(client.metricas_ventas.margen)}</p>
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-2 lg:grid-cols-3">
                      <div className="rounded-2xl border border-white/8 bg-zinc-950/70 p-3">
                        <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Comision</p>
                        <p className="mt-2 text-sm text-zinc-300">
                          {formatPercent(client.asignacion_comercial?.porcentaje_comision ?? 0)} | {client.asignacion_comercial?.comision_activa ? "Activa" : "Inactiva"}
                        </p>
                      </div>
                      {client.costos_operativos.filter((cost) => cost.activo).map((cost) => (
                        <div key={cost.id} className="rounded-2xl border border-white/8 bg-zinc-950/70 p-3">
                          <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">{cost.categoria}</p>
                          <p className="mt-2 text-sm text-zinc-300">{cost.concepto}</p>
                          <p className="mt-1 text-sm font-semibold text-white">{formatCurrency(cost.monto_mensual)}</p>
                        </div>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}
