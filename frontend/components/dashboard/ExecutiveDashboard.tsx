"use client";

import Link from "next/link";

import { buildApiUrl } from "@/lib/api";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

const STATUS_API = buildApiUrl("").replace(/\/api\/?$/, "/health/");
const EMPRESAS_API = buildApiUrl("/empresas/lista/");
const AUTO_REFRESH_MS = 10 * 60_000;

function currentMonthEndIso() {
  const now = new Date();
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const year = endOfMonth.getFullYear();
  const month = String(endOfMonth.getMonth() + 1).padStart(2, "0");
  const day = String(endOfMonth.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildCxcDashboardUrl() {
  const params = new URLSearchParams({
    page: "1",
    page_size: "10",
    fecha_hasta: currentMonthEndIso(),
    include_items: "false",
  });
  return buildApiUrl(`/finanzas/cxc/?${params.toString()}`);
}

interface StatusResponse {
  sistema?: string;
  estado?: string;
  service?: string;
  status?: string;
  environment?: string;
  demo_mode?: boolean;
}

interface EntidadDashboardItem {
  id: number;
  nombre_comercial: string;
  ciudad?: string | null;
  activo: boolean;
  clientes_count: number;
  espacios_total: number;
  espacios_ocupados: number;
  espacios_disponibles: number;
  espacios_reservados: number;
  espacios_mantenimiento: number;
  facturacion_activa: number;
  cxp_abierta: number;
  cxp_vencido: number;
  cxp_registros_abiertos: number;
}

interface CxcMetricBucket {
  count: number;
  base: number;
  interes: number;
  total: number;
}

interface CxcMetrics {
  registros: number;
  clientes: number;
  deudores_principales?: CxcTopDebtor[];
  totales?: {
    cargos: number;
    cobrado: number;
    saldo: number;
    recargos: number;
    exigible: number;
    facturado: number;
    cuentas_abiertas: number;
    cuentas_pagadas: number;
  };
  por_mes?: Array<{
    periodo: string;
    cuentas: number;
    clientes: number;
    pagadas: number;
    abiertas: number;
    cargos: number;
    cobrado: number;
    saldo: number;
    recargos: number;
    exigible: number;
    facturado: number;
  }>;
  pagadas: CxcMetricBucket;
  vencidas: CxcMetricBucket;
  en_gracia: CxcMetricBucket;
  por_vencer: CxcMetricBucket;
}

function buildCxpDashboardUrl() {
  const params = new URLSearchParams({
    page: "1",
    page_size: "10",
    include_items: "false",
  });
  return buildApiUrl(`/finanzas/cxp/?${params.toString()}`);
}

interface CxcTopDebtor {
  cliente_id: number;
  cliente_nombre: string;
  entidad_nombre: string;
  total_a_pagar: number;
  cuentas: number;
  dias_atraso_post_gracia: number;
  fecha_vencimiento?: string | null;
}

interface CxcRow {
  id: number;
  entidad_id: number | null;
  entidad_nombre: string;
  cliente_id: number;
  cliente_nombre: string;
  cliente_identificador?: string | null;
  espacio_codigo?: string | null;
  concepto: string;
  fecha_vencimiento?: string | null;
  fecha_limite_gracia?: string | null;
  dias_atraso: number;
  dias_atraso_post_gracia: number;
  monto_base: number;
  monto_original: number;
  monto_pagado: number;
  interes_monto: number;
  total_a_pagar: number;
  estatus: string;
  categoria_tablero: string;
}

interface CxcDashboardResponse {
  fecha_referencia: string;
  metricas: CxcMetrics;
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
  items: CxcRow[];
}

interface CxpMetrics {
  registros: number;
  proyectado: number;
  pagado: number;
  pendiente: number;
  vencido: number;
  por_conciliar: number;
  conteo_estatus?: Record<string, number>;
  cuentas_prioritarias?: CxpPriorityAccount[];
}

interface CxpPriorityAccount {
  id: number;
  entidad_id: number;
  entidad_nombre: string;
  proveedor_nombre: string;
  concepto: string;
  fecha_vencimiento: string;
  saldo_pendiente: number;
  estatus: string;
  prioridad?: string | null;
}

interface CxpRow {
  id: number;
  entidad_id: number;
  entidad_nombre: string;
  proveedor_nombre: string;
  categoria: string;
  concepto: string;
  fecha_vencimiento: string;
  monto_total: number;
  monto_pagado: number;
  saldo_pendiente: number;
  estatus: string;
  prioridad?: string | null;
  naturaleza?: string | null;
  tipo_registro?: string | null;
}

interface CxpDashboardResponse {
  fecha_referencia: string;
  metricas: CxpMetrics;
  items: CxpRow[];
}

interface Segment {
  label: string;
  value: number;
  color: string;
}

interface ListRow {
  id: string;
  title: string;
  subtitle: string;
  value: string;
  meta?: string;
  tone?: "default" | "cyan" | "emerald" | "amber" | "red" | "violet";
}

interface KpiExplanation {
  title: string;
  value: string;
  purpose: string;
  formula: string;
  interpretation: string;
  source: string;
  details: Array<{
    label: string;
    value: string;
  }>;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function formatCompactCurrency(value: number) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value || 0);
}

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("es-MX", {
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function formatDateTime(value: Date | null) {
  if (!value) {
    return "Sin actualizar";
  }

  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

function formatShortDate(value?: string | null) {
  if (!value) {
    return "Sin fecha";
  }

  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short",
  }).format(date);
}

function InfoIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 10v6" />
      <path d="M12 7h.01" />
    </svg>
  );
}

function fetchJson<T>(url: string, fallbackMessage: string) {
  return fetch(url, { cache: "no-store" }).then(async (response) => {
    const rawBody = await response.text();
    if (!response.ok) {
      throw new Error(fallbackMessage);
    }

    if (!rawBody) {
      return {} as T;
    }

    if (rawBody.trim().startsWith("<")) {
      throw new Error(fallbackMessage);
    }

    try {
      return JSON.parse(rawBody) as T;
    } catch {
      throw new Error(fallbackMessage);
    }
  });
}

function MetricCard({
  title,
  value,
  helper,
  tone = "default",
}: {
  title: string;
  value: string;
  helper: string;
  tone?: "default" | "cyan" | "emerald" | "amber" | "red" | "violet";
}) {
  const toneClass =
    tone === "cyan"
      ? "border-cyan-500/20 bg-cyan-500/10"
      : tone === "emerald"
        ? "border-emerald-500/20 bg-emerald-500/10"
        : tone === "amber"
          ? "border-amber-500/20 bg-amber-500/10"
          : tone === "red"
            ? "border-red-500/20 bg-red-500/10"
            : tone === "violet"
              ? "border-violet-500/20 bg-violet-500/10"
              : "border-white/8 bg-zinc-950/70";

  return (
    <div className={`metric-card-compact ${toneClass}`}>
      <p className="metric-label-compact">{title}</p>
      <p className="metric-value-compact">{value}</p>
      <p className="metric-helper-compact">{helper}</p>
    </div>
  );
}

function InsightCard({
  title,
  description,
  value,
  tone = "default",
}: {
  title: string;
  description: string;
  value: string;
  tone?: "default" | "cyan" | "emerald" | "amber" | "red";
}) {
  const toneClass =
    tone === "cyan"
      ? "border-cyan-500/20 bg-cyan-500/10"
      : tone === "emerald"
        ? "border-emerald-500/20 bg-emerald-500/10"
        : tone === "amber"
          ? "border-amber-500/20 bg-amber-500/10"
          : tone === "red"
            ? "border-red-500/20 bg-red-500/10"
            : "border-white/8 bg-zinc-950/70";

  return (
    <div className={`metric-card-compact ${toneClass}`}>
      <p className="metric-label-compact">{title}</p>
      <p className="mt-1.5 text-base font-bold text-white sm:text-lg">{value}</p>
      <p className="metric-helper-compact">{description}</p>
    </div>
  );
}

function DonutChart({
  title,
  subtitle,
  segments,
  centerLabel,
  centerValue,
  formatValue = formatCurrency,
}: {
  title: string;
  subtitle: string;
  segments: Segment[];
  centerLabel: string;
  centerValue: string;
  formatValue?: (value: number) => string;
}) {
  const total = segments.reduce((acc, segment) => acc + segment.value, 0);
  const radius = 58;
  const circumference = 2 * Math.PI * radius;
  let accumulated = 0;

  return (
    <div className="page-section-soft">
      <div className="border-b border-white/6 pb-2.5">
        <h2 className="section-title-compact">{title}</h2>
        <p className="section-copy-compact">{subtitle}</p>
      </div>

      <div className="mt-3 flex flex-col gap-3 xl:flex-row xl:items-center">
        <div className="relative mx-auto h-36 w-36 shrink-0">
          <svg viewBox="0 0 160 160" className="h-full w-full -rotate-90">
            <circle
              cx="80"
              cy="80"
              r={radius}
              fill="none"
              stroke="rgba(255,255,255,0.06)"
              strokeWidth="16"
            />
            {segments.map((segment) => {
              const ratio = total > 0 ? segment.value / total : 0;
              const length = circumference * ratio;
              const dashOffset = circumference - accumulated;
              accumulated += length;

              return (
                <circle
                  key={segment.label}
                  cx="80"
                  cy="80"
                  r={radius}
                  fill="none"
                  stroke={segment.color}
                  strokeWidth="16"
                  strokeDasharray={`${length} ${circumference - length}`}
                  strokeDashoffset={dashOffset}
                  strokeLinecap="butt"
                />
              );
            })}
          </svg>

          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
              {centerLabel}
            </span>
            <span className="mt-1.5 text-xl font-bold text-white">
              {centerValue}
            </span>
          </div>
        </div>

        <div className="flex-1 space-y-2">
          {segments.map((segment) => {
            const share = total > 0 ? (segment.value / total) * 100 : 0;

            return (
              <div key={segment.label} className="page-section-tight">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span
                      className="h-3.5 w-3.5 rounded-full"
                      style={{ backgroundColor: segment.color }}
                    />
                    <span className="text-xs font-medium text-white">{segment.label}</span>
                  </div>
                  <span className="text-xs text-zinc-400">{formatPercent(share)}</span>
                </div>

                <p className="mt-1 text-sm font-semibold text-zinc-100 sm:text-base">{formatValue(segment.value)}</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function HorizontalBarBoard({
  title,
  subtitle,
  rows,
}: {
  title: string;
  subtitle: string;
  rows: Array<{
    id: number;
    name: string;
    primaryValue: number;
    secondaryValue: number;
    tertiaryValue?: number;
    helper: string;
  }>;
}) {
  const maxValue = Math.max(
    1,
    ...rows.map((row) =>
      Math.max(row.primaryValue, row.secondaryValue, row.tertiaryValue || 0)
    )
  );

  return (
    <div className="page-section-soft">
      <div className="border-b border-white/6 pb-2.5">
        <h2 className="section-title-compact">{title}</h2>
        <p className="section-copy-compact">{subtitle}</p>
      </div>

      <div className="mt-3 space-y-2.5">
        {rows.map((row) => (
          <div key={row.id} className="page-section-tight">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-sm font-medium text-white">{row.name}</h3>
                <p className="text-xs text-zinc-500">{row.helper}</p>
              </div>

              <div className="text-left sm:text-right">
                <p className="text-xs font-semibold text-cyan-200 sm:text-sm">
                  {formatCurrency(row.primaryValue)}
                </p>
                <p className="text-[11px] text-amber-200">
                  Vacancia: {formatCurrency(row.secondaryValue)}
                </p>
                <p className="text-[11px] text-violet-200">
                  CxP: {formatCurrency(row.tertiaryValue || 0)}
                </p>
              </div>
            </div>

            <div className="mt-2.5 space-y-2">
              <div>
                <div className="mb-1 flex items-center justify-between text-[11px] uppercase tracking-[0.2em] text-zinc-500">
                  <span>Facturacion activa</span>
                  <span>{formatCompactCurrency(row.primaryValue)}</span>
                </div>
                <div className="h-2 rounded-full bg-zinc-800">
                  <div
                    className="h-2 rounded-full bg-gradient-to-r from-cyan-400 to-blue-500"
                    style={{ width: `${(row.primaryValue / maxValue) * 100}%` }}
                  />
                </div>
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between text-[11px] uppercase tracking-[0.2em] text-zinc-500">
                  <span>Ingreso no capturado</span>
                  <span>{formatCompactCurrency(row.secondaryValue)}</span>
                </div>
                <div className="h-2 rounded-full bg-zinc-800">
                  <div
                    className="h-2 rounded-full bg-gradient-to-r from-amber-400 to-rose-400"
                    style={{ width: `${(row.secondaryValue / maxValue) * 100}%` }}
                  />
                </div>
              </div>

              {row.tertiaryValue ? (
                <div>
                  <div className="mb-1 flex items-center justify-between text-[11px] uppercase tracking-[0.2em] text-zinc-500">
                    <span>CxP abierta</span>
                    <span>{formatCompactCurrency(row.tertiaryValue)}</span>
                  </div>
                  <div className="h-2 rounded-full bg-zinc-800">
                    <div
                      className="h-2 rounded-full bg-gradient-to-r from-violet-400 to-fuchsia-400"
                      style={{ width: `${(row.tertiaryValue / maxValue) * 100}%` }}
                    />
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function tonePillClass(tone: ListRow["tone"] = "default") {
  if (tone === "cyan") {
    return "border-cyan-500/20 bg-cyan-500/10 text-cyan-200";
  }
  if (tone === "emerald") {
    return "border-emerald-500/20 bg-emerald-500/10 text-emerald-200";
  }
  if (tone === "amber") {
    return "border-amber-500/20 bg-amber-500/10 text-amber-200";
  }
  if (tone === "red") {
    return "border-red-500/20 bg-red-500/10 text-red-200";
  }
  if (tone === "violet") {
    return "border-violet-500/20 bg-violet-500/10 text-violet-200";
  }
  return "border-white/10 bg-white/5 text-zinc-200";
}

function toneCardClass(tone: ListRow["tone"] = "default") {
  if (tone === "cyan") {
    return "border-cyan-500/20 bg-cyan-500/10";
  }
  if (tone === "emerald") {
    return "border-emerald-500/20 bg-emerald-500/10";
  }
  if (tone === "amber") {
    return "border-amber-500/20 bg-amber-500/10";
  }
  if (tone === "red") {
    return "border-red-500/20 bg-red-500/10";
  }
  if (tone === "violet") {
    return "border-violet-500/20 bg-violet-500/10";
  }
  return "border-white/8 bg-zinc-950/70";
}

function PriorityCard({
  label,
  title,
  value,
  helper,
  tone = "default",
  onInspect,
}: {
  label: string;
  title: string;
  value: string;
  helper: string;
  tone?: ListRow["tone"];
  onInspect?: () => void;
}) {
  return (
    <div className={`rounded-xl border px-3 py-2.5 ${toneCardClass(tone)}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">{label}</p>
            {onInspect ? (
              <button
                type="button"
                onClick={onInspect}
                title={`Como se compone ${title}`}
                className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-cyan-500/20 bg-black/20 text-cyan-100 transition-colors hover:border-cyan-400/50 hover:bg-cyan-500/15"
              >
                <InfoIcon className="h-3.5 w-3.5" />
                <span className="sr-only">Como se compone {title}</span>
              </button>
            ) : null}
          </div>
          <h3 className="mt-1 text-sm font-semibold text-white">{title}</h3>
        </div>
        <p className="shrink-0 text-right text-lg font-bold text-white">{value}</p>
      </div>
      <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-zinc-400">{helper}</p>
    </div>
  );
}

function KpiTile({
  label,
  value,
  helper,
  tone = "default",
  onInspect,
}: {
  label: string;
  value: string;
  helper: string;
  tone?: ListRow["tone"];
  onInspect?: () => void;
}) {
  return (
    <div className={`rounded-xl border px-3 py-2 ${toneCardClass(tone)}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">{label}</p>
        {onInspect ? (
          <button
            type="button"
            onClick={onInspect}
            title={`Como se compone ${label}`}
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-cyan-500/20 bg-black/20 text-cyan-100 transition-colors hover:border-cyan-400/50 hover:bg-cyan-500/15"
          >
            <InfoIcon className="h-3.5 w-3.5" />
            <span className="sr-only">Como se compone {label}</span>
          </button>
        ) : null}
      </div>
      <p className="mt-1 text-base font-semibold text-white">{value}</p>
      <p className="mt-0.5 truncate text-[11px] text-zinc-500">{helper}</p>
    </div>
  );
}

function KpiExplanationModal({
  explanation,
  onClose,
}: {
  explanation: KpiExplanation;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 px-4 py-6 backdrop-blur-sm">
      <div className="w-full max-w-3xl rounded-3xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-zinc-800 pb-4">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-cyan-300">
              Lectura del indicador
            </p>
            <h3 className="mt-2 text-xl font-semibold text-white">{explanation.title}</h3>
            <p className="mt-1 text-2xl font-bold text-white">{explanation.value}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900 text-xl text-zinc-300 transition-colors hover:border-zinc-600 hover:text-white"
          >
            x
          </button>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-3">
            <p className="text-xs uppercase tracking-[0.2em] text-cyan-200/80">
              Para que sirve
            </p>
            <p className="mt-2 text-sm leading-relaxed text-zinc-200">{explanation.purpose}</p>
          </div>
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-3">
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Formula</p>
            <p className="mt-2 text-sm leading-relaxed text-zinc-200">{explanation.formula}</p>
          </div>
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-3">
            <p className="text-xs uppercase tracking-[0.2em] text-amber-200/80">
              Como leerlo
            </p>
            <p className="mt-2 text-sm leading-relaxed text-zinc-200">
              {explanation.interpretation}
            </p>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-zinc-800 bg-black/30 p-3">
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Composicion</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {explanation.details.map((detail) => (
              <div
                key={detail.label}
                className="rounded-xl border border-zinc-800 bg-zinc-950/80 px-3 py-2"
              >
                <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">
                  {detail.label}
                </p>
                <p className="mt-1 text-sm font-semibold text-white">{detail.value}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-zinc-500">Fuente: {explanation.source}</p>
        </div>
      </div>
    </div>
  );
}

function DetailSection({
  title,
  subtitle,
  children,
  defaultOpen = false,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details
      open={defaultOpen}
      className="rounded-2xl border border-white/8 bg-zinc-950/50 p-3"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
        <div>
          <h2 className="section-title-compact">{title}</h2>
          <p className="section-copy-compact">{subtitle}</p>
        </div>
        <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-zinc-400">
          Detalle
        </span>
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

function CompactListBoard({
  title,
  subtitle,
  rows,
  emptyLabel,
}: {
  title: string;
  subtitle: string;
  rows: ListRow[];
  emptyLabel: string;
}) {
  return (
    <div className="page-section-soft">
      <div className="border-b border-white/6 pb-2.5">
        <h2 className="section-title-compact">{title}</h2>
        <p className="section-copy-compact">{subtitle}</p>
      </div>

      <div className="mt-3 space-y-2.5">
        {rows.length > 0 ? (
          rows.map((row) => (
            <div key={row.id} className="page-section-tight">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-medium text-white">{row.title}</h3>
                  <p className="mt-0.5 line-clamp-2 text-xs text-zinc-500">{row.subtitle}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold text-zinc-100">{row.value}</p>
                  {row.meta ? (
                    <span
                      className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] ${tonePillClass(row.tone)}`}
                    >
                      {row.meta}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="page-section-tight text-xs text-zinc-500">{emptyLabel}</div>
        )}
      </div>
    </div>
  );
}

export default function ExecutiveDashboard() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [entidades, setEntidades] = useState<EntidadDashboardItem[]>([]);
  const [cxc, setCxc] = useState<CxcDashboardResponse | null>(null);
  const [cxp, setCxp] = useState<CxpDashboardResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [activeExplanation, setActiveExplanation] =
    useState<KpiExplanation | null>(null);

  const loadDashboard = useCallback(async (silent = false) => {
    if (silent) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }

    const nextErrors: string[] = [];

    const [statusResult, entidadesResult, cxcResult, cxpResult] =
      await Promise.allSettled([
        fetchJson<StatusResponse>(STATUS_API, "No se pudo validar el backend."),
        fetchJson<EntidadDashboardItem[]>(
          EMPRESAS_API,
          "No se pudo cargar el resumen de entidades."
        ),
        fetchJson<CxcDashboardResponse>(
          buildCxcDashboardUrl(),
          "No se pudo cargar el tablero de cuentas por cobrar."
        ),
        fetchJson<CxpDashboardResponse>(
          buildCxpDashboardUrl(),
          "No se pudo cargar el tablero de cuentas por pagar."
        ),
      ]);

    if (statusResult.status === "fulfilled") {
      setStatus(statusResult.value);
    } else {
      setStatus(null);
      nextErrors.push("Backend sin respuesta");
    }

    if (entidadesResult.status === "fulfilled") {
      setEntidades(entidadesResult.value);
    } else {
      setEntidades([]);
      nextErrors.push("Resumen de entidades no disponible");
    }

    if (cxcResult.status === "fulfilled") {
      setCxc(cxcResult.value);
    } else {
      setCxc(null);
      nextErrors.push("CxC no disponible");
    }

    if (cxpResult.status === "fulfilled") {
      setCxp(cxpResult.value);
    } else {
      setCxp(null);
      nextErrors.push("CxP no disponible");
    }

    setErrors(nextErrors);
    setLastUpdated(new Date());
    setIsLoading(false);
    setIsRefreshing(false);
  }, []);

  useEffect(() => {
    void loadDashboard(false);

    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== "visible") {
        return;
      }
      void loadDashboard(true);
    }, AUTO_REFRESH_MS);

    return () => window.clearInterval(intervalId);
  }, [loadDashboard]);

  const derived = useMemo(() => {
    const activeEntities = entidades.filter((entity) => entity.activo).length;
    const inactiveEntities = entidades.length - activeEntities;
    const totalClients = entidades.reduce(
      (acc, entity) => acc + (entity.clientes_count || 0),
      0
    );
    const totalSpaces = entidades.reduce(
      (acc, entity) => acc + (entity.espacios_total || 0),
      0
    );
    const occupiedSpaces = entidades.reduce(
      (acc, entity) => acc + (entity.espacios_ocupados || 0),
      0
    );
    const availableSpaces = entidades.reduce(
      (acc, entity) => acc + (entity.espacios_disponibles || 0),
      0
    );
    const reservedSpaces = entidades.reduce(
      (acc, entity) => acc + (entity.espacios_reservados || 0),
      0
    );
    const maintenanceSpaces = entidades.reduce(
      (acc, entity) => acc + (entity.espacios_mantenimiento || 0),
      0
    );
    const activeBilling = entidades.reduce(
      (acc, entity) => acc + (entity.facturacion_activa || 0),
      0
    );
    const occupancyRate =
      totalSpaces > 0 ? (occupiedSpaces / totalSpaces) * 100 : 0;
    const averageRentPerOccupiedSpace =
      occupiedSpaces > 0 ? activeBilling / occupiedSpaces : 0;

    const entityRows = entidades.map((entity) => {
      const averageEntityRent =
        entity.espacios_ocupados > 0
          ? entity.facturacion_activa / entity.espacios_ocupados
          : averageRentPerOccupiedSpace;
      const vacancyEstimate = averageEntityRent * entity.espacios_disponibles;

      return {
        id: entity.id,
        name: entity.nombre_comercial,
        primaryValue: entity.facturacion_activa || 0,
        secondaryValue: vacancyEstimate,
        tertiaryValue: entity.cxp_abierta || 0,
        helper: `${entity.espacios_ocupados}/${entity.espacios_total || 0} ocupados - ${entity.espacios_disponibles} disponibles - ${entity.cxp_registros_abiertos || 0} CxP`,
        availableSpaces: entity.espacios_disponibles || 0,
      };
    });

    const totalVacancyEstimate = entityRows.reduce(
      (acc, row) => acc + row.secondaryValue,
      0
    );

    const topEntities = [...entityRows]
      .sort(
        (left, right) =>
          right.primaryValue + right.secondaryValue -
          (left.primaryValue + left.secondaryValue)
      )
      .slice(0, 5);

    const mostAvailableEntity = [...entityRows].sort(
      (left, right) => right.availableSpaces - left.availableSpaces
    )[0];

    const cxcOpen =
      (cxc?.metricas.vencidas.total || 0) +
      (cxc?.metricas.en_gracia.total || 0) +
      (cxc?.metricas.por_vencer.total || 0);

    const cxpOpen =
      (cxp?.metricas.pendiente || 0) +
      (cxp?.metricas.vencido || 0) +
      (cxp?.metricas.por_conciliar || 0);

    const coverageRatio = cxpOpen > 0 ? activeBilling / cxpOpen : 0;
    const coverageLabel = cxpOpen > 0 ? `${coverageRatio.toFixed(2)}x` : "Sin presion";
    const netOperatingPosition = activeBilling + cxcOpen - cxpOpen;
    const collectionPressure =
      activeBilling > 0 ? (cxcOpen / activeBilling) * 100 : 0;
    const delinquencyRate =
      cxcOpen > 0 ? ((cxc?.metricas.vencidas.total || 0) / cxcOpen) * 100 : 0;
    const payablePressure =
      cxpOpen > 0
        ? (((cxp?.metricas.vencido || 0) + (cxp?.metricas.por_conciliar || 0)) /
            cxpOpen) *
          100
        : 0;

    const payableCounts =
      cxp?.metricas.conteo_estatus ||
      (cxp?.items || []).reduce(
        (acc, item) => {
          acc[item.estatus] = (acc[item.estatus] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      );

    const metricDebtors = cxc?.metricas.deudores_principales || [];
    const topDebtors: ListRow[] =
      metricDebtors.length > 0
        ? metricDebtors.map((row) => ({
            id: String(row.cliente_id),
            title: row.cliente_nombre,
            subtitle: `${row.entidad_nombre} - ${row.cuentas} cuenta${
              row.cuentas === 1 ? "" : "s"
            } abierta${row.cuentas === 1 ? "" : "s"}`,
            value: formatCurrency(row.total_a_pagar),
            meta:
              row.dias_atraso_post_gracia > 0
                ? `${row.dias_atraso_post_gracia} dias`
                : formatShortDate(row.fecha_vencimiento),
            tone: row.dias_atraso_post_gracia > 0 ? "red" : "amber",
          }))
        : Array.from(
            (cxc?.items || []).reduce((acc, item) => {
              if (item.categoria_tablero === "PAGADA") {
                return acc;
              }
              const key = String(item.cliente_id);
              const current =
                acc.get(key) ||
                ({
                  id: key,
                  title: item.cliente_nombre,
                  subtitle: item.entidad_nombre,
                  value: 0,
                  accounts: 0,
                  worstDelay: 0,
                  nextDueDate: item.fecha_vencimiento || "",
                } as {
                  id: string;
                  title: string;
                  subtitle: string;
                  value: number;
                  accounts: number;
                  worstDelay: number;
                  nextDueDate: string;
                });
              current.value += item.total_a_pagar || 0;
              current.accounts += 1;
              current.worstDelay = Math.max(
                current.worstDelay,
                item.dias_atraso_post_gracia || 0
              );
              if (
                item.fecha_vencimiento &&
                (!current.nextDueDate || item.fecha_vencimiento < current.nextDueDate)
              ) {
                current.nextDueDate = item.fecha_vencimiento;
              }
              acc.set(key, current);
              return acc;
            }, new Map<string, { id: string; title: string; subtitle: string; value: number; accounts: number; worstDelay: number; nextDueDate: string }>())
              .values()
          )
            .sort((left, right) => right.value - left.value)
            .slice(0, 6)
            .map((row) => ({
              id: row.id,
              title: row.title,
              subtitle: `${row.subtitle} - ${row.accounts} cuenta${
                row.accounts === 1 ? "" : "s"
              } abierta${row.accounts === 1 ? "" : "s"}`,
              value: formatCurrency(row.value),
              meta:
                row.worstDelay > 0
                  ? `${row.worstDelay} dias`
                  : formatShortDate(row.nextDueDate),
              tone: row.worstDelay > 0 ? "red" : "amber",
            }));

    const metricPayables = cxp?.metricas.cuentas_prioritarias || [];
    const urgentPayables: ListRow[] =
      metricPayables.length > 0
        ? metricPayables.map((item) => ({
            id: String(item.id),
            title: item.proveedor_nombre || item.concepto,
            subtitle: `${item.entidad_nombre} - ${item.concepto}`,
            value: formatCurrency(item.saldo_pendiente),
            meta: item.estatus.replaceAll("_", " "),
            tone:
              item.estatus === "VENCIDO"
                ? "red"
                : item.estatus === "POR_CONCILIAR"
                  ? "violet"
                  : "amber",
          }))
        : [...(cxp?.items || [])]
            .filter((item) => item.saldo_pendiente > 0)
            .sort((left, right) => {
              const priorityScore = (item: CxpRow) =>
                item.estatus === "VENCIDO"
                  ? 0
                  : item.estatus === "POR_CONCILIAR"
                    ? 1
                    : item.estatus === "PENDIENTE" || item.estatus === "PARCIAL"
                      ? 2
                      : 3;
              return (
                priorityScore(left) - priorityScore(right) ||
                left.fecha_vencimiento.localeCompare(right.fecha_vencimiento) ||
                right.saldo_pendiente - left.saldo_pendiente
              );
            })
            .slice(0, 6)
            .map((item) => ({
              id: String(item.id),
              title: item.proveedor_nombre || item.concepto,
              subtitle: `${item.entidad_nombre} - ${item.concepto}`,
              value: formatCurrency(item.saldo_pendiente),
              meta: item.estatus.replaceAll("_", " "),
              tone:
                item.estatus === "VENCIDO"
                  ? "red"
                  : item.estatus === "POR_CONCILIAR"
                    ? "violet"
                    : "amber",
            }));

    const entityOperations: ListRow[] = [...entidades]
      .sort(
        (left, right) =>
          right.facturacion_activa +
          right.cxp_abierta -
          (left.facturacion_activa + left.cxp_abierta)
      )
      .slice(0, 6)
      .map((entity) => ({
        id: String(entity.id),
        title: entity.nombre_comercial,
        subtitle: `${entity.clientes_count || 0} clientes - ${entity.espacios_ocupados || 0}/${entity.espacios_total || 0} espacios ocupados`,
        value: formatCurrency(entity.facturacion_activa || 0),
        meta: `${formatCurrency(entity.cxp_abierta || 0)} CxP`,
        tone: (entity.cxp_vencido || 0) > 0 ? "red" : "cyan",
      }));

    return {
      activeEntities,
      inactiveEntities,
      totalClients,
      totalSpaces,
      occupiedSpaces,
      availableSpaces,
      reservedSpaces,
      maintenanceSpaces,
      activeBilling,
      occupancyRate,
      totalVacancyEstimate,
      topEntities,
      mostAvailableEntity,
      cxcOpen,
      cxpOpen,
      netOperatingPosition,
      collectionPressure,
      delinquencyRate,
      payablePressure,
      coverageLabel,
      payableCounts,
      topDebtors,
      urgentPayables,
      entityOperations,
    };
  }, [entidades, cxc, cxp]);

  const cobranzaSegments = useMemo<Segment[]>(
    () => [
      { label: "Pagadas", value: cxc?.metricas.pagadas.total || 0, color: "#34d399" },
      { label: "Vencidas", value: cxc?.metricas.vencidas.total || 0, color: "#f87171" },
      { label: "En gracia", value: cxc?.metricas.en_gracia.total || 0, color: "#fbbf24" },
      { label: "Por vencer", value: cxc?.metricas.por_vencer.total || 0, color: "#60a5fa" },
    ],
    [cxc]
  );

  const gastosSegments = useMemo<Segment[]>(
    () => [
      { label: "Pagados", value: cxp?.metricas.pagado || 0, color: "#34d399" },
      { label: "Vencidos", value: cxp?.metricas.vencido || 0, color: "#fb7185" },
      { label: "Pendientes", value: cxp?.metricas.pendiente || 0, color: "#f59e0b" },
      { label: "Por conciliar", value: cxp?.metricas.por_conciliar || 0, color: "#a78bfa" },
    ],
    [cxp]
  );

  const ocupacionSegments = useMemo<Segment[]>(
    () => [
      { label: "Ocupados", value: derived.occupiedSpaces, color: "#22c55e" },
      { label: "Disponibles", value: derived.availableSpaces, color: "#38bdf8" },
      { label: "Reservados", value: derived.reservedSpaces, color: "#f59e0b" },
      { label: "Mantenimiento", value: derived.maintenanceSpaces, color: "#f87171" },
    ],
    [derived]
  );

  const cxcReference =
    cobranzaSegments.reduce((acc, segment) => acc + segment.value, 0) || 0;
  const cxpReference =
    gastosSegments.reduce((acc, segment) => acc + segment.value, 0) || 0;
  const hasDashboardData =
    Boolean(cxc) || Boolean(cxp) || entidades.length > 0 || Boolean(status);

  const kpiExplanations = useMemo<Record<string, KpiExplanation>>(
    () => ({
      cobranzaVencida: {
        title: "Cobranza vencida",
        value: formatCurrency(cxc?.metricas.vencidas.total || 0),
        purpose:
          "Mide el dinero que ya requiere seguimiento inmediato porque supero el vencimiento y la gracia operativa.",
        formula: "CxC vencidas con recargo = base pendiente + recargos calculados.",
        interpretation:
          "Mientras mas alto sea contra la facturacion activa, mayor presion existe sobre caja y cobranza.",
        source: "Cuentas por cobrar filtradas hasta el cierre del mes actual.",
        details: [
          { label: "Cuentas vencidas", value: String(cxc?.metricas.vencidas.count || 0) },
          { label: "En gracia", value: String(cxc?.metricas.en_gracia.count || 0) },
          { label: "Base vencida", value: formatCurrency(cxc?.metricas.vencidas.base || 0) },
          { label: "Recargos", value: formatCurrency(cxc?.metricas.vencidas.interes || 0) },
        ],
      },
      compromisosCriticos: {
        title: "Compromisos criticos",
        value: formatCurrency((cxp?.metricas.vencido || 0) + (cxp?.metricas.por_conciliar || 0)),
        purpose:
          "Muestra pagos operativos que pueden afectar continuidad: vencidos o pendientes de conciliacion.",
        formula: "CxP vencida + CxP por conciliar.",
        interpretation:
          "Si crece, conviene priorizar validacion de pagos, proveedores criticos y flujo de efectivo.",
        source: "Cuentas por pagar abiertas del tablero global.",
        details: [
          { label: "Vencido", value: formatCurrency(cxp?.metricas.vencido || 0) },
          { label: "Por conciliar", value: formatCurrency(cxp?.metricas.por_conciliar || 0) },
          { label: "Gastos vencidos", value: String(derived.payableCounts.VENCIDO || 0) },
          { label: "Por conciliar", value: String(derived.payableCounts.POR_CONCILIAR || 0) },
        ],
      },
      capturaComercial: {
        title: "Captura comercial",
        value: formatCurrency(derived.totalVacancyEstimate),
        purpose:
          "Estima ingreso mensual que podria recuperarse al ocupar espacios disponibles.",
        formula: "Espacios disponibles x renta promedio de espacios ocupados por entidad.",
        interpretation:
          "Sirve para priorizar ventas, marketing o ajustes de precio en entidades con vacancia.",
        source: "Inventario de espacios y facturacion activa por entidad.",
        details: [
          { label: "Espacios disponibles", value: formatNumber(derived.availableSpaces) },
          { label: "Espacios ocupados", value: formatNumber(derived.occupiedSpaces) },
          { label: "Facturacion activa", value: formatCurrency(derived.activeBilling) },
          { label: "Estimado vacancia", value: formatCurrency(derived.totalVacancyEstimate) },
        ],
      },
      ocupacionGlobal: {
        title: "Ocupacion global",
        value: formatPercent(derived.occupancyRate),
        purpose:
          "Resume que tan utilizado esta el inventario activo de espacios.",
        formula: "Espacios ocupados / espacios activos totales.",
        interpretation:
          "Una ocupacion alta confirma estabilidad; una baja abre foco comercial u operativo.",
        source: "Resumen de entidades y espacios activos.",
        details: [
          { label: "Ocupados", value: formatNumber(derived.occupiedSpaces) },
          { label: "Totales", value: formatNumber(derived.totalSpaces) },
          { label: "Disponibles", value: formatNumber(derived.availableSpaces) },
          { label: "Mantenimiento", value: formatNumber(derived.maintenanceSpaces) },
        ],
      },
      facturacion: {
        title: "Facturacion",
        value: formatCurrency(derived.activeBilling),
        purpose:
          "Representa el run rate mensual vigente de renta/facturacion activa.",
        formula: "Suma de facturacion activa reportada por cada entidad.",
        interpretation:
          "Es la base para comparar cartera, gastos, cobertura y presion de cobranza.",
        source: "Resumen operativo de entidades.",
        details: [
          { label: "Entidades activas", value: formatNumber(derived.activeEntities) },
          { label: "Clientes", value: formatNumber(derived.totalClients) },
          { label: "Espacios ocupados", value: formatNumber(derived.occupiedSpaces) },
          { label: "Run rate", value: formatCurrency(derived.activeBilling) },
        ],
      },
      carteraAbierta: {
        title: "Cartera abierta",
        value: formatCurrency(derived.cxcOpen),
        purpose:
          "Mide todo lo pendiente por cobrar, incluyendo por vencer, gracia y vencido.",
        formula: "CxC vencida + CxC en gracia + CxC por vencer.",
        interpretation:
          "Ayuda a distinguir si el saldo total es normal del periodo o si ya se esta volviendo mora.",
        source: "Metricas globales de cuentas por cobrar.",
        details: [
          { label: "Vencida", value: formatCurrency(cxc?.metricas.vencidas.total || 0) },
          { label: "En gracia", value: formatCurrency(cxc?.metricas.en_gracia.total || 0) },
          { label: "Por vencer", value: formatCurrency(cxc?.metricas.por_vencer.total || 0) },
          { label: "Total abierto", value: formatCurrency(derived.cxcOpen) },
        ],
      },
      cxpAbierta: {
        title: "CxP abierta",
        value: formatCurrency(derived.cxpOpen),
        purpose:
          "Muestra obligaciones pendientes de pago o conciliacion.",
        formula: "CxP pendiente + CxP vencida + CxP por conciliar.",
        interpretation:
          "Es el monto que compite contra caja y debe revisarse junto con cobranza esperada.",
        source: "Metricas globales de cuentas por pagar.",
        details: [
          { label: "Pendiente", value: formatCurrency(cxp?.metricas.pendiente || 0) },
          { label: "Vencido", value: formatCurrency(cxp?.metricas.vencido || 0) },
          { label: "Por conciliar", value: formatCurrency(cxp?.metricas.por_conciliar || 0) },
          { label: "Total abierto", value: formatCurrency(derived.cxpOpen) },
        ],
      },
      cobertura: {
        title: "Cobertura",
        value: derived.coverageLabel,
        purpose:
          "Indica cuantas veces la facturacion activa cubre los pagos abiertos.",
        formula: "Facturacion activa / CxP abierta.",
        interpretation:
          "Mayor a 1x sugiere cobertura operativa; menor a 1x requiere revisar flujo y pagos.",
        source: "Facturacion activa y CxP abierta.",
        details: [
          { label: "Facturacion", value: formatCurrency(derived.activeBilling) },
          { label: "CxP abierta", value: formatCurrency(derived.cxpOpen) },
          { label: "Cobertura", value: derived.coverageLabel },
          { label: "Posicion operativa", value: formatCurrency(derived.netOperatingPosition) },
        ],
      },
      presionCobranza: {
        title: "Presion cobranza",
        value: formatPercent(derived.collectionPressure),
        purpose:
          "Compara la cartera abierta contra la facturacion activa para medir presion de cobro.",
        formula: "Cartera abierta / facturacion activa.",
        interpretation:
          "Arriba de 100% significa que la cartera abierta supera un mes de facturacion activa.",
        source: "CxC abierta y facturacion activa.",
        details: [
          { label: "Cartera abierta", value: formatCurrency(derived.cxcOpen) },
          { label: "Facturacion activa", value: formatCurrency(derived.activeBilling) },
          { label: "Mora sobre cartera", value: formatPercent(derived.delinquencyRate) },
          { label: "Presion", value: formatPercent(derived.collectionPressure) },
        ],
      },
      entidades: {
        title: "Entidades",
        value: `${derived.activeEntities}/${entidades.length}`,
        purpose:
          "Muestra cuantas unidades de negocio estan activas dentro de la capa.",
        formula: "Entidades activas / total de entidades registradas.",
        interpretation:
          "Sirve para validar cobertura operativa, adopcion y alcance del tablero.",
        source: "Resumen de entidades de negocio.",
        details: [
          { label: "Activas", value: formatNumber(derived.activeEntities) },
          { label: "Inactivas", value: formatNumber(derived.inactiveEntities) },
          { label: "Clientes", value: formatNumber(derived.totalClients) },
          { label: "Espacios", value: formatNumber(derived.totalSpaces) },
        ],
      },
    }),
    [cxc, cxp, derived, entidades.length]
  );

  return (
    <div className="mx-auto max-w-[1500px] space-y-3">
      <section className="rounded-2xl border border-white/8 bg-gradient-to-br from-zinc-950 via-zinc-950 to-zinc-900 p-3.5 shadow-xl">
        <div className="grid gap-2.5 xl:grid-cols-[1.5fr_0.65fr_auto] xl:items-center">
          <div className="max-w-3xl">
            <span className="inline-flex rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2 py-0.5 text-[9px] uppercase tracking-[0.2em] text-cyan-200">
              Tablero ejecutivo
            </span>
            <h2 className="mt-1.5 text-lg font-semibold text-white sm:text-xl">
              Resumen vivo de cobranza, gastos, clientes e inventario.
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-zinc-400">
              Lectura compacta para tomar decisiones sin perder de vista cartera,
              presion de pagos, ocupacion y actividad por entidad.
            </p>
          </div>

          <div className="page-section-tight">
            <p className="metric-label-compact">Actualizado</p>
            <p className="mt-1 text-sm font-medium text-white">{formatDateTime(lastUpdated)}</p>
            <p className="mt-1 text-[11px] text-zinc-500">
              Refresco automatico cada 10 minutos
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-start gap-2 xl:justify-end">
            <button
              type="button"
              onClick={() => void loadDashboard(true)}
              className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-3.5 py-2 text-xs font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20"
            >
              {isRefreshing ? "Actualizando..." : "Actualizar"}
            </button>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-cyan-400/20 bg-[linear-gradient(135deg,rgba(8,47,73,0.7),rgba(9,9,11,0.96)_62%)] shadow-[0_18px_70px_rgba(6,182,212,0.08)]">
        <div className="grid gap-6 p-5 lg:grid-cols-[1.05fr_1.4fr] lg:p-6">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-cyan-300">
              Sistema integral de ventas
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-white">BetterP Commerce</h2>
            <p className="mt-3 max-w-xl text-sm leading-7 text-zinc-300">
              Unifica productos, inventario, catalogos y reglas por canal con POS,
              tienda online, marketplaces, facturacion, envios y reportes.
            </p>
            <div className="mt-4 flex flex-wrap gap-2 text-[11px] font-medium">
              <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1.5 text-emerald-200">
                Mercado Libre conectado
              </span>
              <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1.5 text-amber-100">
                Amazon en preparacion
              </span>
              <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1.5 text-amber-100">
                Walmart en preparacion
              </span>
            </div>
            <Link
              href="/soluciones/commerce/entrar"
              className="mt-5 inline-flex items-center rounded-xl bg-cyan-300 px-4 py-2.5 text-sm font-semibold text-zinc-950 transition hover:bg-cyan-200"
            >
              Abrir BetterP Commerce
            </Link>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {[
              ["Productos", "/productos", "Maestro e inventario"],
              ["Catalogos", "/catalogos", "Reglas por canal"],
              ["Punto de venta", "/mi-tiendita", "Caja, QR y tickets"],
              ["Tienda online", "/tienda", "Storefront y checkout"],
              ["Canales", "/conexiones-ecommerce", "Marketplaces"],
              ["Ventas", "/ventas", "Facturacion y reportes"],
            ].map(([label, nextPath, detail]) => (
              <Link
                key={label}
                href={`/soluciones/commerce/entrar?next=${encodeURIComponent(nextPath)}`}
                className="rounded-xl border border-white/8 bg-white/[0.035] p-3 transition hover:border-cyan-300/30 hover:bg-cyan-300/[0.06]"
              >
                <p className="text-sm font-semibold text-white">{label}</p>
                <p className="mt-1 text-xs text-zinc-500">{detail}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {errors.length > 0 ? (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-200">
          Algunas fuentes no respondieron en este corte: {errors.join(", ")}.
          El tablero muestra la mejor foto disponible.
        </div>
      ) : null}

      {!hasDashboardData && isLoading ? (
        <div className="page-section-soft py-6 text-center text-sm text-zinc-500">
          Cargando tablero ejecutivo...
        </div>
      ) : (
        <>
          <section className="grid gap-2.5 xl:grid-cols-4">
            <PriorityCard
              label="1. Caja"
              title="Cobranza vencida"
              value={formatCurrency(cxc?.metricas.vencidas.total || 0)}
              helper={`${cxc?.metricas.vencidas.count || 0} cuentas vencidas y ${cxc?.metricas.en_gracia.count || 0} en gracia para seguimiento inmediato.`}
              tone="red"
              onInspect={() => setActiveExplanation(kpiExplanations.cobranzaVencida)}
            />
            <PriorityCard
              label="2. Pagos"
              title="Compromisos criticos"
              value={formatCurrency((cxp?.metricas.vencido || 0) + (cxp?.metricas.por_conciliar || 0))}
              helper={`${derived.payableCounts.VENCIDO || 0} gastos vencidos y ${derived.payableCounts.POR_CONCILIAR || 0} por conciliar.`}
              tone="violet"
              onInspect={() => setActiveExplanation(kpiExplanations.compromisosCriticos)}
            />
            <PriorityCard
              label="3. Ingreso"
              title="Captura comercial"
              value={formatCurrency(derived.totalVacancyEstimate)}
              helper={`${derived.availableSpaces} espacios disponibles para recuperar renta mensual estimada.`}
              tone="amber"
              onInspect={() => setActiveExplanation(kpiExplanations.capturaComercial)}
            />
            <PriorityCard
              label="4. Operacion"
              title="Ocupacion global"
              value={formatPercent(derived.occupancyRate)}
              helper={`${derived.occupiedSpaces} ocupados de ${derived.totalSpaces} espacios activos en inventario.`}
              tone="emerald"
              onInspect={() => setActiveExplanation(kpiExplanations.ocupacionGlobal)}
            />
          </section>

          <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
            <KpiTile
              label="Facturacion"
              value={formatCurrency(derived.activeBilling)}
              helper="Run rate mensual"
              tone="cyan"
              onInspect={() => setActiveExplanation(kpiExplanations.facturacion)}
            />
            <KpiTile
              label="Cartera abierta"
              value={formatCurrency(derived.cxcOpen)}
              helper="Por cobrar total"
              tone="emerald"
              onInspect={() => setActiveExplanation(kpiExplanations.carteraAbierta)}
            />
            <KpiTile
              label="CxP abierta"
              value={formatCurrency(derived.cxpOpen)}
              helper="Pagos pendientes"
              tone="violet"
              onInspect={() => setActiveExplanation(kpiExplanations.cxpAbierta)}
            />
            <KpiTile
              label="Cobertura"
              value={derived.coverageLabel}
              helper="Facturacion / CxP"
              tone="cyan"
              onInspect={() => setActiveExplanation(kpiExplanations.cobertura)}
            />
            <KpiTile
              label="Presion cobranza"
              value={formatPercent(derived.collectionPressure)}
              helper="Cartera / facturacion"
              tone={derived.collectionPressure > 100 ? "red" : "amber"}
              onInspect={() => setActiveExplanation(kpiExplanations.presionCobranza)}
            />
            <KpiTile
              label="Entidades"
              value={`${derived.activeEntities}/${entidades.length}`}
              helper={`${derived.totalClients} clientes`}
              tone="cyan"
              onInspect={() => setActiveExplanation(kpiExplanations.entidades)}
            />
          </section>

          <section className="grid gap-2.5 2xl:grid-cols-3">
            <CompactListBoard
              title="Clientes con mayor adeudo"
              subtitle="Cartera abierta ordenada por saldo exigible y dias posteriores a gracia."
              rows={derived.topDebtors}
              emptyLabel="No hay clientes con saldo abierto en la muestra cargada."
            />
            <CompactListBoard
              title="Pagos operativos urgentes"
              subtitle="Compromisos abiertos priorizados por vencimiento, conciliacion y monto."
              rows={derived.urgentPayables}
              emptyLabel="No hay compromisos abiertos con saldo pendiente."
            />
            <CompactListBoard
              title="Riesgos y oportunidades"
              subtitle="Lectura corta para decidir que mover primero."
              rows={[
                {
                  id: "mora",
                  title: "Riesgo de mora",
                  subtitle: "Porcentaje de cartera abierta que ya supero gracia.",
                  value: formatPercent(derived.delinquencyRate),
                  meta: "Cobranza",
                  tone: derived.delinquencyRate > 50 ? "red" : "amber",
                },
                {
                  id: "pagos",
                  title: "Riesgo de pagos",
                  subtitle: "Parte de CxP abierta vencida o por conciliar.",
                  value: formatPercent(derived.payablePressure),
                  meta: "Caja",
                  tone: derived.payablePressure > 50 ? "red" : "violet",
                },
                {
                  id: "vacancia",
                  title: derived.mostAvailableEntity?.name || "Sin entidad critica",
                  subtitle: derived.mostAvailableEntity
                    ? `${derived.mostAvailableEntity.availableSpaces} espacios disponibles con ${formatCurrency(derived.mostAvailableEntity.secondaryValue)} estimados sin capturar.`
                    : "No hay inventario suficiente para calcular vacancia prioritaria.",
                  value: `${derived.availableSpaces} espacios`,
                  meta: "Inventario",
                  tone: "cyan",
                },
                {
                  id: "posicion",
                  title: "Posicion operativa",
                  subtitle: "Facturacion activa mas cartera abierta, menos compromisos abiertos.",
                  value: formatCurrency(derived.netOperatingPosition),
                  meta: derived.netOperatingPosition >= 0 ? "Positiva" : "Negativa",
                  tone: derived.netOperatingPosition >= 0 ? "emerald" : "red",
                },
              ]}
              emptyLabel="Sin alertas de negocio para este corte."
            />
          </section>

          <section className="space-y-2.5">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="section-title-compact">Analisis detallado</h2>
                <p className="section-copy-compact">
                  Abre solo el frente que necesitas revisar: cobranza, pagos, inventario o entidades.
                </p>
              </div>
              <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">
                Ordenado por prioridad operativa
              </p>
            </div>

            <DetailSection
              title="Cobranza"
              subtitle="Composicion de cartera y cuentas que explican el riesgo de caja."
              defaultOpen
            >
              <div className="grid gap-2.5 xl:grid-cols-[0.95fr_1.05fr]">
                <DonutChart
                  title="Composicion de cobranza"
                  subtitle="Reparto global entre dinero cobrado, vencido y por cobrar."
                  segments={cobranzaSegments}
                  centerLabel="CxC total"
                  centerValue={formatCompactCurrency(cxcReference)}
                />
                <div className="grid gap-2 sm:grid-cols-2">
                  <KpiTile
                    label="CxC por vencer"
                    value={formatCurrency(cxc?.metricas.por_vencer.total || 0)}
                    helper={`${cxc?.metricas.por_vencer.count || 0} cuentas antes de vencer`}
                    tone="cyan"
                  />
                  <KpiTile
                    label="CxC en gracia"
                    value={formatCurrency(cxc?.metricas.en_gracia.total || 0)}
                    helper={`${cxc?.metricas.en_gracia.count || 0} cuentas en ventana`}
                    tone="amber"
                  />
                  <KpiTile
                    label="Cobrado"
                    value={formatCurrency(cxc?.metricas.totales?.cobrado || 0)}
                    helper={`${cxc?.metricas.totales?.cuentas_pagadas || 0} cuentas pagadas`}
                    tone="emerald"
                  />
                  <KpiTile
                    label="Clientes en cartera"
                    value={String(cxc?.metricas.clientes || 0)}
                    helper="Clientes con movimientos CxC"
                    tone="default"
                  />
                </div>
              </div>
            </DetailSection>

            <DetailSection
              title="Gastos y pagos"
              subtitle="Presion de caja por compromisos, vencidos y conciliaciones."
            >
              <div className="grid gap-2.5 xl:grid-cols-[0.95fr_1.05fr]">
                <DonutChart
                  title="Composicion de gastos"
                  subtitle="Pagos cubiertos frente a compromisos abiertos."
                  segments={gastosSegments}
                  centerLabel="CxP total"
                  centerValue={formatCompactCurrency(cxpReference)}
                />
                <div className="grid gap-2 sm:grid-cols-2">
                  <KpiTile
                    label="CxP vencida"
                    value={formatCurrency(cxp?.metricas.vencido || 0)}
                    helper={`${derived.payableCounts.VENCIDO || 0} registros vencidos`}
                    tone="red"
                  />
                  <KpiTile
                    label="Pendiente"
                    value={formatCurrency(cxp?.metricas.pendiente || 0)}
                    helper={`${derived.payableCounts.PENDIENTE || 0} por programar`}
                    tone="amber"
                  />
                  <KpiTile
                    label="Por conciliar"
                    value={formatCurrency(cxp?.metricas.por_conciliar || 0)}
                    helper={`${derived.payableCounts.POR_CONCILIAR || 0} registros`}
                    tone="violet"
                  />
                  <KpiTile
                    label="Pagado"
                    value={formatCurrency(cxp?.metricas.pagado || 0)}
                    helper="Salida registrada"
                    tone="emerald"
                  />
                </div>
              </div>
            </DetailSection>

            <DetailSection
              title="Inventario"
              subtitle="Ocupacion, vacancia y capacidad de captura comercial."
            >
              <div className="grid gap-2.5 xl:grid-cols-[0.95fr_1.05fr]">
                <DonutChart
                  title="Ocupacion del inventario"
                  subtitle="Inventario operando, vacante, reservado o en mantenimiento."
                  segments={ocupacionSegments}
                  centerLabel="Espacios"
                  centerValue={String(derived.totalSpaces)}
                  formatValue={(value) => String(value)}
                />
                <div className="grid gap-2 sm:grid-cols-2">
                  <KpiTile
                    label="Disponibles"
                    value={String(derived.availableSpaces)}
                    helper="Para renta inmediata"
                    tone="cyan"
                  />
                  <KpiTile
                    label="Reservados"
                    value={String(derived.reservedSpaces)}
                    helper="Separados o en proceso"
                    tone="amber"
                  />
                  <KpiTile
                    label="Mantenimiento"
                    value={String(derived.maintenanceSpaces)}
                    helper="Fuera de inventario activo"
                    tone="red"
                  />
                  <KpiTile
                    label="Renta no capturada"
                    value={formatCurrency(derived.totalVacancyEstimate)}
                    helper="Estimado mensual"
                    tone="emerald"
                  />
                </div>
              </div>
            </DetailSection>

            <DetailSection
              title="Entidades"
              subtitle="Ranking operativo por facturacion, vacancia y presion de CxP."
            >
              <div className="grid gap-2.5 xl:grid-cols-[1.2fr_0.8fr]">
                <HorizontalBarBoard
                  title="Mayor impacto economico"
                  subtitle="Cruce entre facturacion actual y vacancia estimada."
                  rows={derived.topEntities}
                />
                <CompactListBoard
                  title="Operacion por entidad"
                  subtitle="Facturacion activa, clientes, ocupacion y CxP."
                  rows={derived.entityOperations}
                  emptyLabel="Todavia no hay entidades operativas para resumir."
                />
              </div>
            </DetailSection>
          </section>
        </>
      )}
      {activeExplanation ? (
        <KpiExplanationModal
          explanation={activeExplanation}
          onClose={() => setActiveExplanation(null)}
        />
      ) : null}
    </div>
  );
}
