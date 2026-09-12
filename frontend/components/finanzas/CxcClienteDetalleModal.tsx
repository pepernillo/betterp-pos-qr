"use client";

import { useState } from "react";

interface CxcDetailCuenta {
  id: number;
  entidad_nombre: string;
  espacio_codigo?: string | null;
  concepto: string;
  periodicidad: string;
  fecha_periodo_inicio?: string | null;
  fecha_periodo_fin?: string | null;
  fecha_vencimiento: string;
  fecha_liquidacion?: string | null;
  dias_gracia: number;
  fecha_limite_gracia: string;
  monto_base: number;
  monto_original: number;
  monto_pagado: number;
  interes_monto: number;
  total_a_pagar: number;
  categoria_tablero: string;
  comportamiento_pago: string;
  referencia_unica?: string | null;
}

interface CxcDetailPago {
  id: number;
  concepto: string;
  monto: number;
  fecha_pago: string;
  metodo: string;
  canal_origen: string;
  estatus_validacion: string;
  referencia?: string | null;
}

interface CxcTrendPoint {
  periodo: string;
  label: string;
  facturado: number;
  pagado: number;
  pendiente: number;
}

export interface CxcClientDetailResponse {
  cliente: {
    id: number;
    nombre: string;
    identificador?: string | null;
    rfc?: string | null;
    entidad_id?: number | null;
    entidad_nombre: string;
  };
  resumen: {
    score_pago: number;
    score_label: string;
    puntualidad_porcentaje: number;
    morosidad_porcentaje: number;
    cuentas_totales: number;
    cuentas_liquidadas: number;
    cuentas_vencidas_abiertas: number;
    cuentas_en_gracia: number;
    saldo_vivo: number;
    total_facturado: number;
    total_pagado: number;
    recargos_activos: number;
  };
  comportamiento: {
    pagadas_a_tiempo: number;
    pagadas_en_gracia: number;
    pagadas_tarde: number;
    abiertas_por_vencer: number;
    abiertas_en_gracia: number;
    abiertas_vencidas: number;
  };
  tendencia_periodos: CxcTrendPoint[];
  pagos_recientes: CxcDetailPago[];
  cuentas: CxcDetailCuenta[];
}

interface CxcClienteDetalleModalProps {
  isOpen: boolean;
  isLoading: boolean;
  detail: CxcClientDetailResponse | null;
  error: string;
  onClose: () => void;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function formatDate(value?: string | null) {
  if (!value) {
    return "Sin fecha";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(parsed);
}

function behaviorLabel(value: string) {
  switch (value) {
    case "PAGADA_A_TIEMPO":
      return "Pagada a tiempo";
    case "PAGADA_EN_GRACIA":
      return "Pagada en gracia";
    case "PAGADA_TARDE":
      return "Pagada tarde";
    case "ABIERTA_POR_VENCER":
      return "Por vencer";
    case "ABIERTA_EN_GRACIA":
      return "En gracia";
    case "ABIERTA_VENCIDA":
      return "Abierta vencida";
    default:
      return value;
  }
}

function paymentStatusLabel(value: string) {
  switch (value) {
    case "VALIDADO":
      return "Validado";
    case "APLICADO":
      return "Aplicado";
    case "RECHAZADO":
      return "Rechazado";
    default:
      return value;
  }
}

function scoreTone(score: number) {
  if (score >= 85) {
    return "text-emerald-300";
  }
  if (score >= 70) {
    return "text-cyan-300";
  }
  if (score >= 50) {
    return "text-amber-200";
  }
  return "text-red-300";
}

function buildDonutBackground(detail: CxcClientDetailResponse) {
  const segments = [
    { value: detail.comportamiento.pagadas_a_tiempo, color: "#34d399" },
    { value: detail.comportamiento.pagadas_en_gracia, color: "#22d3ee" },
    { value: detail.comportamiento.pagadas_tarde, color: "#f59e0b" },
    { value: detail.comportamiento.abiertas_vencidas, color: "#f87171" },
    { value: detail.comportamiento.abiertas_por_vencer, color: "#60a5fa" },
    { value: detail.comportamiento.abiertas_en_gracia, color: "#fde047" },
  ].filter((segment) => segment.value > 0);

  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  if (!total) {
    return "conic-gradient(#27272a 0deg 360deg)";
  }

  let consumed = 0;
  const stops = segments.map((segment) => {
    const start = (consumed / total) * 360;
    consumed += segment.value;
    const end = (consumed / total) * 360;
    return `${segment.color} ${start}deg ${end}deg`;
  });
  return `conic-gradient(${stops.join(", ")})`;
}

function MiniMetric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "emerald" | "amber" | "red" | "blue";
}) {
  const toneClass =
    tone === "emerald"
      ? "border-emerald-500/20 bg-emerald-500/10"
      : tone === "amber"
        ? "border-amber-500/20 bg-amber-500/10"
        : tone === "red"
          ? "border-red-500/20 bg-red-500/10"
          : tone === "blue"
            ? "border-blue-500/20 bg-blue-500/10"
            : "border-zinc-800 bg-zinc-900/60";

  return (
    <div className={`rounded-2xl border p-4 ${toneClass}`}>
      <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">
        {label}
      </p>
      <p className="mt-2 text-xl font-semibold text-white">{value}</p>
    </div>
  );
}

export default function CxcClienteDetalleModal({
  isOpen,
  isLoading,
  detail,
  error,
  onClose,
}: CxcClienteDetalleModalProps) {
  const [copyMessage, setCopyMessage] = useState("");

  if (!isOpen) {
    return null;
  }

  const clienteIdentificador = detail?.cliente.identificador || "";

  const handleCopyReference = async (reference?: string | null) => {
    const value = reference?.trim();
    if (!value || value.startsWith("ESPACIO:")) {
      setCopyMessage("Esta cuenta no tiene una referencia de pago individual.");
      return;
    }

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const input = document.createElement("textarea");
        input.value = value;
        input.setAttribute("readonly", "true");
        input.style.position = "fixed";
        input.style.opacity = "0";
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        input.remove();
      }
      setCopyMessage(`Referencia copiada: ${value}`);
    } catch {
      setCopyMessage("No se pudo copiar la referencia. Seleccionala manualmente.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="max-h-[92vh] w-full max-w-7xl overflow-hidden rounded-[2rem] border border-zinc-800 bg-zinc-950 shadow-2xl">
        <div className="flex items-start justify-between border-b border-zinc-800 px-6 py-5">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-zinc-500">
              Detalle de cobranza
            </p>
            <h2 className="mt-2 text-2xl font-bold text-white">
              {detail?.cliente.nombre || "Cliente"}
            </h2>
            <p className="mt-1 text-sm text-zinc-500">
              {detail?.cliente.entidad_nombre || "Entidad"}
              {clienteIdentificador ? ` | ${clienteIdentificador}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setCopyMessage("");
              onClose();
            }}
            className="rounded-2xl border border-zinc-800 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
          >
            Cerrar
          </button>
        </div>

        <div className="max-h-[calc(92vh-96px)] overflow-y-auto px-6 py-6">
          {isLoading ? (
            <div className="rounded-3xl border border-zinc-800 bg-zinc-900/40 py-20 text-center text-zinc-500">
              Cargando detalle del cliente...
            </div>
          ) : error ? (
            <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300">
              {error}
            </div>
          ) : !detail ? (
            <div className="rounded-3xl border border-zinc-800 bg-zinc-900/40 py-20 text-center text-zinc-500">
              No hay detalle disponible para este cliente.
            </div>
          ) : (
            <div className="space-y-6">
              <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                <MiniMetric
                  label="Score de pago"
                  value={`${detail.resumen.score_pago}/100`}
                  tone="blue"
                />
                <MiniMetric
                  label="Puntualidad"
                  value={`${detail.resumen.puntualidad_porcentaje}%`}
                  tone="emerald"
                />
                <MiniMetric
                  label="Morosidad"
                  value={`${detail.resumen.morosidad_porcentaje}%`}
                  tone="red"
                />
                <MiniMetric
                  label="Saldo vivo"
                  value={formatCurrency(detail.resumen.saldo_vivo)}
                  tone="amber"
                />
              </section>

              <section className="grid grid-cols-1 gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
                <div className="rounded-3xl border border-zinc-800 bg-zinc-900/40 p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-lg font-semibold text-white">
                        Salud de pago
                      </h3>
                      <p className="mt-1 text-sm text-zinc-500">
                        Qué tan puntual y qué tan moroso ha sido este cliente.
                      </p>
                    </div>
                    <div className={`text-right ${scoreTone(detail.resumen.score_pago)}`}>
                      <p className="text-3xl font-bold">{detail.resumen.score_pago}</p>
                      <p className="text-xs uppercase tracking-[0.24em]">
                        {detail.resumen.score_label}
                      </p>
                    </div>
                  </div>

                  <div className="mt-6 flex items-center gap-5">
                    <div
                      className="relative h-32 w-32 shrink-0 rounded-full"
                      style={{ background: buildDonutBackground(detail) }}
                    >
                      <div className="absolute inset-5 flex items-center justify-center rounded-full border border-zinc-800 bg-zinc-950">
                        <div className="text-center">
                          <p className="text-2xl font-bold text-white">
                            {detail.resumen.cuentas_totales}
                          </p>
                          <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">
                            cuentas
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="flex-1 space-y-3">
                      {[
                        {
                          label: "A tiempo",
                          value: detail.comportamiento.pagadas_a_tiempo,
                          tone: "bg-emerald-400",
                        },
                        {
                          label: "En gracia",
                          value: detail.comportamiento.pagadas_en_gracia,
                          tone: "bg-cyan-400",
                        },
                        {
                          label: "Tardías",
                          value: detail.comportamiento.pagadas_tarde,
                          tone: "bg-amber-400",
                        },
                        {
                          label: "Vencidas",
                          value: detail.comportamiento.abiertas_vencidas,
                          tone: "bg-red-400",
                        },
                      ].map((segment) => (
                        <div key={segment.label}>
                          <div className="mb-1 flex items-center justify-between text-xs text-zinc-400">
                            <span>{segment.label}</span>
                            <span>{segment.value}</span>
                          </div>
                          <div className="h-2 rounded-full bg-zinc-900">
                            <div
                              className={`h-2 rounded-full ${segment.tone}`}
                              style={{
                                width: `${
                                  detail.resumen.cuentas_totales
                                    ? (segment.value / detail.resumen.cuentas_totales) * 100
                                    : 0
                                }%`,
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="mt-6 grid grid-cols-2 gap-3">
                    <MiniMetric
                      label="Facturado"
                      value={formatCurrency(detail.resumen.total_facturado)}
                    />
                    <MiniMetric
                      label="Pagado"
                      value={formatCurrency(detail.resumen.total_pagado)}
                      tone="emerald"
                    />
                    <MiniMetric
                      label="Recargos activos"
                      value={formatCurrency(detail.resumen.recargos_activos)}
                      tone="amber"
                    />
                    <MiniMetric
                      label="Abiertas vencidas"
                      value={String(detail.resumen.cuentas_vencidas_abiertas)}
                      tone="red"
                    />
                  </div>
                </div>

                <div className="rounded-3xl border border-zinc-800 bg-zinc-900/40 p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-lg font-semibold text-white">
                        Tendencia por periodo
                      </h3>
                      <p className="mt-1 text-sm text-zinc-500">
                        Facturado, pagado y saldo pendiente en los periodos más recientes.
                      </p>
                    </div>
                    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 px-4 py-2 text-xs uppercase tracking-[0.24em] text-zinc-500">
                      Últimos 6 cortes
                    </div>
                  </div>

                  {detail.tendencia_periodos.length === 0 ? (
                    <div className="mt-6 rounded-2xl border border-dashed border-zinc-800 bg-zinc-950/40 py-16 text-center text-sm text-zinc-500">
                      Aún no hay suficientes periodos para graficar.
                    </div>
                  ) : (
                    <div className="mt-6 space-y-5">
                      {detail.tendencia_periodos.map((point) => {
                        const maxValue = Math.max(
                          point.facturado,
                          point.pagado,
                          point.pendiente,
                          1
                        );
                        return (
                          <div key={point.periodo} className="space-y-2">
                            <div className="flex items-center justify-between text-sm">
                              <span className="font-medium text-white">{point.label}</span>
                              <span className="text-zinc-500">
                                {formatCurrency(point.facturado)}
                              </span>
                            </div>
                            <div className="space-y-2">
                              <div className="flex items-center gap-3">
                                <span className="w-20 text-xs text-zinc-500">Facturado</span>
                                <div className="h-2 flex-1 rounded-full bg-zinc-900">
                                  <div
                                    className="h-2 rounded-full bg-zinc-400"
                                    style={{ width: `${(point.facturado / maxValue) * 100}%` }}
                                  />
                                </div>
                              </div>
                              <div className="flex items-center gap-3">
                                <span className="w-20 text-xs text-zinc-500">Pagado</span>
                                <div className="h-2 flex-1 rounded-full bg-zinc-900">
                                  <div
                                    className="h-2 rounded-full bg-emerald-400"
                                    style={{ width: `${(point.pagado / maxValue) * 100}%` }}
                                  />
                                </div>
                              </div>
                              <div className="flex items-center gap-3">
                                <span className="w-20 text-xs text-zinc-500">Pendiente</span>
                                <div className="h-2 flex-1 rounded-full bg-zinc-900">
                                  <div
                                    className="h-2 rounded-full bg-amber-400"
                                    style={{ width: `${(point.pendiente / maxValue) * 100}%` }}
                                  />
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </section>

              <section className="grid grid-cols-1 gap-6 xl:grid-cols-[0.95fr_1.35fr]">
                <div className="rounded-3xl border border-zinc-800 bg-zinc-900/40 p-5">
                  <h3 className="text-lg font-semibold text-white">Pagos recientes</h3>
                  <p className="mt-1 text-sm text-zinc-500">
                    Últimos pagos aplicados al cliente.
                  </p>

                  {detail.pagos_recientes.length === 0 ? (
                    <div className="mt-5 rounded-2xl border border-dashed border-zinc-800 bg-zinc-950/40 py-12 text-center text-sm text-zinc-500">
                      No hay pagos registrados en este rango.
                    </div>
                  ) : (
                    <div className="mt-5 space-y-3">
                      {detail.pagos_recientes.map((payment) => (
                        <div
                          key={payment.id}
                          className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="font-medium text-white">{payment.concepto}</p>
                              <p className="mt-1 text-xs text-zinc-500">
                                {formatDate(payment.fecha_pago)} | {payment.metodo} |{" "}
                                {payment.canal_origen}
                              </p>
                              {payment.referencia ? (
                                <p className="mt-1 text-xs text-zinc-500">
                                  Ref. {payment.referencia}
                                </p>
                              ) : null}
                            </div>
                            <div className="text-right">
                              <p className="font-semibold text-emerald-300">
                                {formatCurrency(payment.monto)}
                              </p>
                              <p className="mt-1 text-xs text-zinc-500">
                                {paymentStatusLabel(payment.estatus_validacion)}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-3xl border border-zinc-800 bg-zinc-900/40 p-5">
                  <h3 className="text-lg font-semibold text-white">Histórico de cuentas</h3>
                  <p className="mt-1 text-sm text-zinc-500">
                    Cómo se comporta cada periodo: vencimiento, recargo, pago y resultado.
                  </p>

                  {copyMessage ? (
                    <div className="mt-4 rounded-2xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-100">
                      {copyMessage}
                    </div>
                  ) : null}

                  {detail.cuentas.length === 0 ? (
                    <div className="mt-5 rounded-2xl border border-dashed border-zinc-800 bg-zinc-950/40 py-12 text-center text-sm text-zinc-500">
                      No hay cuentas por mostrar.
                    </div>
                  ) : (
                    <div className="mt-5 overflow-x-auto">
                      <table className="min-w-full border-separate border-spacing-y-2 text-left text-sm">
                        <thead>
                          <tr className="text-xs uppercase tracking-wide text-zinc-500">
                            <th className="px-3 py-2">Periodo</th>
                            <th className="px-3 py-2">Concepto</th>
                            <th className="px-3 py-2">Comportamiento</th>
                            <th className="px-3 py-2">Montos</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.cuentas.map((cuenta) => (
                            <tr key={cuenta.id} className="rounded-2xl bg-zinc-950/70">
                              <td className="rounded-l-2xl px-3 py-3 align-top">
                                <p className="text-white">{formatDate(cuenta.fecha_periodo_inicio)}</p>
                                <p className="mt-1 text-xs text-zinc-500">
                                  al {formatDate(cuenta.fecha_periodo_fin)}
                                </p>
                                <p className="mt-1 text-xs text-zinc-500">
                                  vence {formatDate(cuenta.fecha_vencimiento)}
                                </p>
                              </td>
                              <td className="px-3 py-3 align-top">
                                <p className="font-medium text-white">{cuenta.concepto}</p>
                                <p className="mt-1 text-xs text-zinc-500">
                                  {cuenta.entidad_nombre} | {cuenta.espacio_codigo || "Sin espacio"}
                                </p>
                                {cuenta.referencia_unica ? (
                                  <div className="mt-2 flex flex-wrap items-center gap-2">
                                    <span className="rounded-full border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-[11px] uppercase tracking-[0.14em] text-zinc-400">
                                      Ref. {cuenta.referencia_unica}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => handleCopyReference(cuenta.referencia_unica)}
                                      className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2.5 py-1 text-[11px] font-semibold text-cyan-100 transition-colors hover:border-cyan-300/40 hover:bg-cyan-300/20"
                                    >
                                      Copiar
                                    </button>
                                  </div>
                                ) : null}
                                <p className="mt-1 text-xs text-zinc-500">
                                  liquidación {formatDate(cuenta.fecha_liquidacion)}
                                </p>
                              </td>
                              <td className="px-3 py-3 align-top">
                                <p className="text-zinc-200">
                                  {behaviorLabel(cuenta.comportamiento_pago)}
                                </p>
                                <p className="mt-1 text-xs text-zinc-500">
                                  gracia {cuenta.dias_gracia} días | límite{" "}
                                  {formatDate(cuenta.fecha_limite_gracia)}
                                </p>
                              </td>
                              <td className="rounded-r-2xl px-3 py-3 align-top">
                                <p className="text-white">
                                  Base {formatCurrency(cuenta.monto_original)}
                                </p>
                                <p className="mt-1 text-xs text-amber-200">
                                  Recargo {formatCurrency(cuenta.interes_monto)}
                                </p>
                                <p className="mt-1 text-xs text-cyan-300">
                                  Pagado {formatCurrency(cuenta.monto_pagado)}
                                </p>
                                <p className="mt-1 text-xs text-emerald-300">
                                  Exigible {formatCurrency(cuenta.total_a_pagar)}
                                </p>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
