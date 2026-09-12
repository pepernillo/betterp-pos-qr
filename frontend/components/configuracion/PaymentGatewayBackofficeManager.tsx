"use client";

import { useEffect, useState } from "react";

import { buildApiUrl } from "@/lib/api";

type StripeMissingPlan = {
  id: number;
  nombre: string;
  clave: string;
  solution_id?: number | null;
  solution_key?: string | null;
  solution_name?: string | null;
};

type StripeSolutionStatus = {
  solution_id?: number | null;
  solution_key: string;
  solution_name: string;
  planes_activos: number;
  planes_sin_price_mensual: StripeMissingPlan[];
  planes_sin_price_anual: StripeMissingPlan[];
  missing_price_ids: number;
  ready: boolean;
};

type StripeStatusPayload = {
  proveedor: string;
  activo: boolean;
  modo: string;
  secret_key_configurada: boolean;
  webhook_secret_configurado: boolean;
  api_base_url: string;
  webhook_url: string;
  planes_activos: number;
  planes_sin_price_mensual: StripeMissingPlan[];
  planes_sin_price_anual: StripeMissingPlan[];
  soluciones?: StripeSolutionStatus[];
  eventos_recientes: Array<{
    id: number;
    tipo_evento: string;
    estatus: string;
    referencia_externa?: string | null;
    cliente?: string | null;
    fecha_creacion?: string | null;
    detalle_error?: string | null;
  }>;
};

function statusBadgeClasses(status: string) {
  switch (status) {
    case "PROCESADO":
    case "ACTIVA":
      return "border-emerald-500/20 bg-emerald-500/10 text-emerald-200";
    case "ERROR":
      return "border-rose-500/20 bg-rose-500/10 text-rose-200";
    case "RECIBIDO":
    default:
      return "border-white/10 bg-white/5 text-zinc-300";
  }
}

function formatDateTime(value?: string | null) {
  if (!value) return "Sin fecha";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin fecha";
  return new Intl.DateTimeFormat("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function ConfigChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "ok" | "warn" | "neutral";
}) {
  const toneClass =
    tone === "ok"
      ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-100"
      : tone === "warn"
        ? "border-amber-500/25 bg-amber-500/10 text-amber-100"
        : "border-white/10 bg-white/5 text-zinc-200";
  return (
    <div className={`rounded-2xl border px-4 py-3 ${toneClass}`}>
      <p className="text-[10px] uppercase tracking-[0.2em] opacity-70">{label}</p>
      <p className="mt-2 text-sm font-semibold">{value}</p>
    </div>
  );
}

export default function PaymentGatewayBackofficeManager() {
  const [status, setStatus] = useState<StripeStatusPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  const loadStatus = async () => {
    setLoading(true);
    setErrorMessage("");
    try {
      const response = await fetch(buildApiUrl("/billing/admin/pagos/stripe/"), {
        cache: "no-store",
      });
      const body = (await response.json().catch(() => ({}))) as
        | StripeStatusPayload
        | { detail?: string };
      if (!response.ok) {
        throw new Error(
          "detail" in body && body.detail
            ? body.detail
            : "No se pudo cargar la pasarela de pagos."
        );
      }
      setStatus(body as StripeStatusPayload);
    } catch (error) {
      setStatus(null);
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "No se pudo cargar la pasarela de pagos."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadStatus();
  }, []);

  const missingMonthly = status?.planes_sin_price_mensual ?? [];
  const missingAnnual = status?.planes_sin_price_anual ?? [];
  const solutionStatuses = status?.soluciones ?? [];
  const hasMissingPrices = missingMonthly.length + missingAnnual.length > 0;

  return (
    <section className="rounded-3xl border border-zinc-800 bg-zinc-950/70 p-5">
      <div className="flex flex-col gap-4 border-b border-zinc-800 pb-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl">
          <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-300">
            Pasarela de pagos
          </p>
          <h2 className="mt-2 text-xl font-bold text-white">
            Stripe para altas, renovaciones y portal de facturacion SaaS
          </h2>
          <p className="mt-2 text-sm leading-7 text-zinc-500">
            Las credenciales viven en el backend. Desde aqui se verifica si Stripe
            esta listo, que planes tienen price IDs y si los webhooks estan entrando.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadStatus()}
          className="inline-flex items-center justify-center rounded-2xl border border-cyan-500/20 bg-cyan-500/10 px-5 py-3 text-sm font-medium text-cyan-100 transition hover:border-cyan-400/40 hover:bg-cyan-500/15"
        >
          {loading ? "Actualizando..." : "Refrescar pasarela"}
        </button>
      </div>

      {errorMessage ? (
        <div className="mt-5 rounded-2xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
          {errorMessage}
        </div>
      ) : null}

      {loading && !status ? (
        <div className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-900/40 px-4 py-5 text-sm text-zinc-500">
          Cargando configuracion de pagos...
        </div>
      ) : null}

      {status ? (
        <div className="mt-5 space-y-5">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <ConfigChip
              label="Stripe"
              value={status.activo ? "Listo para checkout" : "Falta secret key"}
              tone={status.activo ? "ok" : "warn"}
            />
            <ConfigChip
              label="Ambiente"
              value={status.modo === "live" ? "Produccion" : "Pruebas"}
              tone={status.modo === "live" ? "ok" : "neutral"}
            />
            <ConfigChip
              label="Firma webhook"
              value={status.webhook_secret_configurado ? "Activa" : "Pendiente"}
              tone={status.webhook_secret_configurado ? "ok" : "warn"}
            />
            <ConfigChip
              label="Price IDs"
              value={hasMissingPrices ? "Revisar planes" : "Completos"}
              tone={hasMissingPrices ? "warn" : "ok"}
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-[1fr_0.8fr]">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 px-4 py-4">
              <p className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">
                Webhook para Stripe
              </p>
              <p className="mt-2 break-all text-sm text-zinc-200">{status.webhook_url}</p>
              <p className="mt-3 text-xs leading-5 text-zinc-500">
                Configuralo en Stripe con eventos de checkout, subscription e invoice.
              </p>
            </div>
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 px-4 py-4">
              <p className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">
                Planes activos
              </p>
              <p className="mt-2 text-2xl font-semibold text-white">{status.planes_activos}</p>
              <p className="mt-2 text-sm text-zinc-500">
                Mensual sin price: {missingMonthly.length} | Anual sin price:{" "}
                {missingAnnual.length}
              </p>
            </div>
          </div>

          {hasMissingPrices ? (
            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-4">
              <p className="font-semibold text-amber-100">
                Hay planes activos sin price ID de Stripe
              </p>
              <p className="mt-1 text-sm text-amber-100/75">
                Completa esos IDs en Backoffice &gt; Planes para que checkout pueda
                crear suscripciones.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {[...missingMonthly, ...missingAnnual].slice(0, 8).map((plan) => (
                  <span
                    key={`${plan.id}-${plan.clave}`}
                    className="rounded-full border border-amber-500/25 bg-zinc-950/60 px-3 py-1 text-xs text-amber-100"
                  >
                    {plan.solution_name ? `${plan.solution_name}: ` : ""}
                    {plan.nombre}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {solutionStatuses.length ? (
            <div className="rounded-[28px] border border-zinc-800 bg-zinc-900/35 p-4">
              <div className="flex flex-col gap-1">
                <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">
                  Readiness por solucion
                </p>
                <p className="text-sm text-zinc-500">
                  Separacion operativa de Stripe para Renta Facil, BetterP Commerce y futuras soluciones.
                </p>
              </div>
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                {solutionStatuses.map((solution) => (
                  <article
                    key={solution.solution_key}
                    className="rounded-2xl border border-white/8 bg-zinc-950/60 px-4 py-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-white">
                          {solution.solution_name}
                        </p>
                        <p className="mt-1 text-xs text-zinc-500">
                          {solution.planes_activos} planes activos
                        </p>
                      </div>
                      <span
                        className={`rounded-full border px-2.5 py-1 text-[11px] ${
                          solution.ready
                            ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-200"
                            : "border-amber-500/25 bg-amber-500/10 text-amber-100"
                        }`}
                      >
                        {solution.ready ? "Listo" : `${solution.missing_price_ids} pendientes`}
                      </span>
                    </div>
                    <div className="mt-3 grid gap-2 text-xs text-zinc-400 sm:grid-cols-2">
                      <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-2">
                        Mensual sin price: {solution.planes_sin_price_mensual.length}
                      </div>
                      <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-2">
                        Anual sin price: {solution.planes_sin_price_anual.length}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ) : null}

          <div className="rounded-[28px] border border-zinc-800 bg-zinc-900/35 p-4">
            <div className="flex flex-col gap-1">
              <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">
                Eventos recientes
              </p>
              <p className="text-sm text-zinc-500">
                Lectura operativa para confirmar pagos, renovaciones o errores de webhook.
              </p>
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {status.eventos_recientes.length ? (
                status.eventos_recientes.map((event) => (
                  <article
                    key={event.id}
                    className="rounded-2xl border border-white/8 bg-zinc-950/60 px-4 py-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-white">
                          {event.tipo_evento}
                        </p>
                        <p className="mt-1 text-xs text-zinc-500">
                          {event.cliente || "Sin cliente"} |{" "}
                          {formatDateTime(event.fecha_creacion)}
                        </p>
                      </div>
                      <span
                        className={`rounded-full border px-2.5 py-1 text-[11px] ${statusBadgeClasses(
                          event.estatus
                        )}`}
                      >
                        {event.estatus}
                      </span>
                    </div>
                    {event.detalle_error ? (
                      <p className="mt-2 text-xs text-rose-200">
                        {event.detalle_error}
                      </p>
                    ) : null}
                  </article>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-white/10 bg-zinc-950/45 px-4 py-6 text-sm text-zinc-500 lg:col-span-2">
                  Aun no hay eventos de Stripe registrados.
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
