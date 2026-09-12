"use client";

import { buildApiUrl } from '@/lib/api';

import {
  type ChangeEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import CxcClienteDetalleModal, {
  type CxcClientDetailResponse,
} from "@/components/finanzas/CxcClienteDetalleModal";
import {
  FinanceFieldLabel,
  FinanceInfoButton,
  FinanceInfoModal,
  type FinanceInfoContent,
} from "@/components/finanzas/FinanceInfo";
import {
  GENERIC_PUBLIC_NAME,
  GENERIC_PUBLIC_REGIME,
  GENERIC_PUBLIC_RFC,
  getFiscalRegimeOptions,
  isGenericPublicRfc,
  normalizeFiscalRegimeValue,
} from "@/lib/fiscalRegimes";

const FINANZAS_API_BASE = buildApiUrl("/finanzas");
const FACTURACION_API_BASE = buildApiUrl("/facturacion");
const CRM_API_BASE = buildApiUrl("/crm");

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

type CxcStatusFilter =
  | ""
  | "PAGADA"
  | "VENCIDA_CON_RECARGO"
  | "EN_GRACIA"
  | "POR_VENCER";

type CxcPeriodPreset =
  | ""
  | "current-month"
  | "previous-month"
  | "year-to-date"
  | "history";

type CxcGroupingMode = "" | "espacio";

interface CxcOption {
  id: number;
  nombre: string;
}

interface CxcMetricBucket {
  count: number;
  base: number;
  interes: number;
  total: number;
}

interface CxcMetricTotals {
  cargos: number;
  cobrado: number;
  saldo: number;
  recargos: number;
  exigible: number;
  facturado: number;
  cuentas_abiertas: number;
  cuentas_pagadas: number;
}

interface CxcMetricMonth {
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
}

interface AgingBucket {
  key: string;
  label: string;
  dias_min: number;
  dias_max: number | null;
  cuentas: number;
  saldo: number;
  recargos: number;
  total: number;
}

interface CxcMetrics {
  registros: number;
  clientes: number;
  totales?: CxcMetricTotals;
  antiguedad_saldo?: AgingBucket[];
  por_mes?: CxcMetricMonth[];
  pagadas: CxcMetricBucket;
  vencidas: CxcMetricBucket;
  en_gracia: CxcMetricBucket;
  por_vencer: CxcMetricBucket;
}

interface CxcRow {
  id: number;
  tipo_fila?: "CUENTA" | "AGRUPADA";
  group_key?: string;
  entidad_id?: number | null;
  entidad_nombre: string;
  cliente_id: number;
  cliente_nombre: string;
  cliente_identificador?: string | null;
  espacio_codigo?: string | null;
  concepto: string;
  origen: string;
  periodicidad: string;
  fecha_periodo_inicio?: string | null;
  fecha_periodo_fin?: string | null;
  fecha_vencimiento: string;
  dias_gracia: number;
  fecha_limite_gracia: string;
  dias_atraso: number;
  dias_atraso_post_gracia: number;
  monto_base: number;
  monto_original: number;
  monto_pagado: number;
  interes_nombre?: string | null;
  interes_porcentaje: number;
  interes_monto: number;
  total_a_pagar: number;
  estatus: string;
  categoria_tablero: CxcStatusFilter;
  referencia_unica?: string | null;
  factura?: ExistingInvoicePreview | null;
  cuentas?: CxcRow[];
  cuentas_count?: number;
  clientes_count?: number;
  periodos_count?: number;
}

interface CxcDashboardResponse {
  fecha_referencia: string;
  filtros: {
    entidad_id?: number | null;
    cliente_id?: number | null;
    status?: CxcStatusFilter | null;
    fecha_desde?: string | null;
    fecha_hasta?: string | null;
    busqueda?: string;
    agrupacion?: CxcGroupingMode;
  };
  metricas: CxcMetrics;
  entidades: CxcOption[];
  clientes: CxcOption[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
  items: CxcRow[];
}

interface BatchImportResult {
  mensaje: string;
  fecha_corte?: string;
  entidades?: number;
  formato?: string;
  hoja: string;
  periodo_inicio?: string;
  periodo_fin?: string;
  creados: number;
  existentes: number;
  omitidos: number;
  errores: string[];
}

interface BatchImportAccepted {
  accepted: boolean;
  job_id: number;
  status: string;
  mensaje: string;
}

interface BackgroundJobStatus {
  id: number;
  status: "PENDING" | "RUNNING" | "SUCCESS" | "ERROR" | "CANCELLED";
  result?: BatchImportResult;
  error?: string | null;
}

interface ExtractedCsfData {
  es_persona_moral?: boolean;
  razon_social?: string;
  rfc?: string;
  regimen_fiscal?: string;
  archivo_csf_url?: string;
  codigo_postal?: string;
}

interface FiscalFormState {
  razon_social: string;
  rfc: string;
  regimen_fiscal: string;
  codigo_postal: string;
  archivo_csf_url: string;
  es_persona_moral: boolean;
}

interface InvoiceDraftLine {
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  subtotal: number;
  impuestos: number;
  total: number;
  clave_producto_servicio: string;
  clave_unidad: string;
  objeto_impuesto: string;
}

interface InvoicePartyPreview {
  rfc: string;
  razon_social: string;
  regimen_fiscal: string;
  codigo_postal: string;
  uso_cfdi?: string;
}

interface InvoiceDraftPreview {
  contexto: string;
  proveedor: string;
  modo: string;
  serie: string;
  folio: string;
  idempotency_key: string;
  emisor: InvoicePartyPreview;
  receptor: InvoicePartyPreview;
  subtotal: number;
  impuestos: number;
  total: number;
  global_information?: {
    periodicity: string;
    months: string;
    year: number;
  } | null;
  partidas: InvoiceDraftLine[];
}

interface ExistingInvoicePreview {
  id: number;
  estatus: string;
  serie?: string | null;
  folio?: string | null;
  uuid?: string | null;
  proveedor_factura_id?: string | null;
  total: number;
  fecha_timbrado?: string | null;
  pdf_url?: string | null;
  xml_url?: string | null;
  error_proveedor?: string | null;
}

interface CxcInvoicePreview {
  cuenta: {
    id: number;
    concepto: string;
    periodicidad: string;
    fecha_periodo_inicio?: string | null;
    fecha_periodo_fin?: string | null;
    fecha_vencimiento?: string | null;
    monto_total: number;
    monto_pagado: number;
    saldo_pendiente: number;
    estatus: string;
  };
  cliente: {
    id: number;
    entidad_relacionada_id: number;
    razon_social: string;
    nombre_comercial: string;
    rfc: string;
    regimen_fiscal: string;
    codigo_postal: string;
    archivo_csf_url: string;
    es_persona_moral: boolean;
  };
  faltantes: string[];
  bloqueos: string[];
  factura_existente?: ExistingInvoicePreview | null;
  ya_timbrada: boolean;
  puede_timbrar: boolean;
  draft?: InvoiceDraftPreview | null;
}

interface CxcFilters {
  entidadId: string;
  clienteId: string;
  status: CxcStatusFilter;
  fechaDesde: string;
  fechaHasta: string;
  busqueda: string;
  periodPreset: CxcPeriodPreset;
  agrupacion: CxcGroupingMode;
}

const DEFAULT_FILTERS: CxcFilters = {
  entidadId: "",
  clienteId: "",
  status: "",
  fechaDesde: "",
  fechaHasta: "",
  busqueda: "",
  periodPreset: "",
  agrupacion: "",
};

const CXC_SEARCH_MAX = 120;
const CXC_NAME_MAX = 180;
const CXC_RFC_MAX = 13;
const CXC_CP_LENGTH = 5;

const cxcInfo: Record<string, FinanceInfoContent> = {
  modulo: {
    eyebrow: "Cuentas",
    title: "Cuentas por cobrar",
    summary:
      "Muestra cargos, saldos, pagos, recargos y facturacion de clientes activos sin crear cartera futura innecesaria.",
    details: [
      "Los cargos se generan para el periodo vigente y segun ocupacion real.",
      "Los filtros permiten revisar cartera por entidad, cliente, estado, periodo o referencia.",
      "Desde cada cuenta puedes copiar referencia, revisar detalle o preparar factura cuando aplique.",
    ],
  },
  filtros: {
    eyebrow: "Filtro",
    title: "Filtros de CxC",
    summary:
      "Acotan la cartera visible sin cambiar los registros originales.",
    details: [
      "Entidad y cliente limitan la lectura a una operacion o persona especifica.",
      "Fecha desde y hasta deben ser fechas validas; desde no puede ser posterior a hasta.",
      "Buscar acepta hasta 120 caracteres y localiza cliente, espacio, concepto o referencia.",
    ],
  },
  periodo: {
    eyebrow: "Periodo",
    title: "Accesos rapidos de periodo",
    summary:
      "Botones para revisar mes actual, mes anterior, ano a la fecha o historial completo.",
    details: [
      "Mes actual es la lectura operativa recomendada para cobranza diaria.",
      "Historico muestra periodos pasados sin generar cargos futuros.",
      "Actualizar mes actual crea o actualiza cargos del periodo vigente segun ocupaciones reales.",
    ],
  },
  batch: {
    eyebrow: "Carga masiva",
    title: "Carga batch CxC",
    summary:
      "Importa cargos por cobrar desde CSV o Excel para un periodo y vencimiento definidos.",
    details: [
      "Periodo ubica los cargos en el mes operativo correcto.",
      "Vencimiento default se usa si el archivo no trae fecha por registro.",
      "El archivo debe respetar columnas y tipos para evitar errores de importacion.",
    ],
  },
  factura: {
    eyebrow: "Facturacion",
    title: "Datos fiscales del receptor",
    summary:
      "Datos SAT usados para preparar o emitir la factura de una cuenta por cobrar pagada.",
    details: [
      "Nombre / razon social, RFC, regimen y codigo postal deben coincidir con la CSF.",
      "La CSF en PDF puede ayudar a completar los datos y reducir capturas incorrectas.",
      "RFC generico publico en general usa datos especiales y no requiere codigo postal del receptor.",
    ],
  },
  razonSocial: {
    eyebrow: "Campo fiscal",
    title: "Nombre / razon social",
    summary:
      "Nombre fiscal del receptor de la factura.",
    details: [
      "Persona fisica usa nombre completo; persona moral usa razon social.",
      "Debe tener al menos 3 caracteres y maximo 180.",
      "No debe usarse para cambiar el nombre operativo del cliente.",
    ],
  },
  rfc: {
    eyebrow: "Campo fiscal",
    title: "RFC",
    summary:
      "Registro Federal de Contribuyentes del receptor.",
    details: [
      "Persona fisica usa 13 caracteres; persona moral usa 12.",
      "Solo acepta letras y numeros, sin espacios ni guiones.",
      "Si se usa RFC generico, BetterP aplica defaults fiscales correspondientes.",
    ],
  },
  regimen: {
    eyebrow: "Campo fiscal",
    title: "Regimen fiscal",
    summary:
      "Regimen SAT del receptor, segun si es persona fisica o moral.",
    details: [
      "Debe coincidir con la Constancia de Situacion Fiscal.",
      "La lista cambia segun tipo de persona fiscal.",
      "Es obligatorio para construir el CFDI.",
    ],
  },
  codigoPostal: {
    eyebrow: "Campo fiscal",
    title: "Codigo postal",
    summary:
      "Codigo postal fiscal del receptor.",
    details: [
      "Acepta exactamente 5 digitos.",
      "Debe coincidir con la CSF del receptor.",
      "No se captura para RFC generico de publico en general.",
    ],
  },
};

const EMPTY_FISCAL_FORM: FiscalFormState = {
  razon_social: "",
  rfc: "",
  regimen_fiscal: "",
  codigo_postal: "",
  archivo_csf_url: "",
  es_persona_moral: true,
};

function applyGenericPublicDefaults(form: FiscalFormState): FiscalFormState {
  if (!isGenericPublicRfc(form.rfc)) {
    return form;
  }
  return {
    ...form,
    razon_social: GENERIC_PUBLIC_NAME,
    rfc: GENERIC_PUBLIC_RFC,
    regimen_fiscal: GENERIC_PUBLIC_REGIME,
    codigo_postal: "",
    es_persona_moral: false,
  };
}

const PAGE_SIZE_OPTIONS = [25, 40, 60, 80, 100];

function buildIsoDate(year: number, monthIndex: number, day: number) {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(
    2,
    "0"
  )}`;
}

function currentMonthRange() {
  const now = new Date();
  const year = now.getFullYear();
  const monthIndex = now.getMonth();
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  return {
    fechaDesde: buildIsoDate(year, monthIndex, 1),
    fechaHasta: buildIsoDate(year, monthIndex, lastDay),
  };
}

function currentYearToDateRange() {
  const now = new Date();
  const year = now.getFullYear();
  const currentMonth = currentMonthRange();
  return {
    fechaDesde: `${year}-01-01`,
    fechaHasta: currentMonth.fechaHasta,
  };
}

function previousMonthRange() {
  const now = new Date();
  const year = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const monthIndex = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  return {
    fechaDesde: buildIsoDate(year, monthIndex, 1),
    fechaHasta: buildIsoDate(year, monthIndex, lastDay),
  };
}

function safeText(value: string, maxLength: number): string {
  return value.replace(/[<>]/g, "").slice(0, maxLength);
}

function cleanRfc(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, CXC_RFC_MAX);
}

function cleanPostalCode(value: string): string {
  return value.replace(/\D/g, "").slice(0, CXC_CP_LENGTH);
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return !Number.isNaN(new Date(`${value}T00:00:00`).getTime());
}

function isValidMonth(value: string): boolean {
  return /^\d{4}-\d{2}$/.test(value);
}

function validateCxcFilters(filters: CxcFilters): string | null {
  if (filters.busqueda.length > CXC_SEARCH_MAX) return `Busqueda maximo ${CXC_SEARCH_MAX} caracteres.`;
  if (filters.fechaDesde && !isValidDate(filters.fechaDesde)) return "Fecha desde no es valida.";
  if (filters.fechaHasta && !isValidDate(filters.fechaHasta)) return "Fecha hasta no es valida.";
  if (filters.fechaDesde && filters.fechaHasta && filters.fechaDesde > filters.fechaHasta) {
    return "Fecha desde no puede ser posterior a fecha hasta.";
  }
  return null;
}

function validateFiscalForm(form: FiscalFormState): Record<string, string> {
  const normalized = applyGenericPublicDefaults(form);
  const errors: Record<string, string> = {};
  const rfcLength = normalized.es_persona_moral ? 12 : 13;
  if (normalized.razon_social.trim().length < 3 || normalized.razon_social.length > CXC_NAME_MAX) {
    errors.razon_social = `Nombre / razon social debe tener de 3 a ${CXC_NAME_MAX} caracteres.`;
  }
  if (!new RegExp(`^[A-Z0-9]{${rfcLength}}$`).test(normalized.rfc.trim().toUpperCase())) {
    errors.rfc = `RFC debe tener ${rfcLength} caracteres alfanumericos.`;
  }
  if (!normalized.regimen_fiscal.trim()) {
    errors.regimen_fiscal = "Selecciona regimen fiscal.";
  }
  if (!isGenericPublicRfc(normalized.rfc) && !/^\d{5}$/.test(normalized.codigo_postal.trim())) {
    errors.codigo_postal = "Codigo postal debe tener 5 digitos.";
  }
  return errors;
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

function parseIsoDate(value?: string | null) {
  if (!value) return null;
  const [year, month, day] = value.split("-").map((part) => Number.parseInt(part, 10));
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function diffDays(from?: string | null, to?: string | null) {
  const fromDate = parseIsoDate(from);
  const toDate = parseIsoDate(to);
  if (!fromDate || !toDate) return null;
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((toDate.getTime() - fromDate.getTime()) / msPerDay);
}

function cxcDueStatusText(row: CxcRow, referenceDate?: string | null) {
  if (row.estatus === "CONCILIADO" || row.estatus === "PAGADO") {
    return "Cuenta cerrada";
  }
  if (row.estatus === "POR_CONCILIAR") {
    return "Pago por conciliar";
  }
  if (row.dias_atraso_post_gracia > 0) {
    return `${row.dias_atraso_post_gracia} dias con recargo`;
  }
  if (row.dias_atraso > 0) {
    return `${row.dias_atraso} dias en gracia`;
  }
  const daysToDue = diffDays(referenceDate, row.fecha_vencimiento);
  if (daysToDue === null) {
    return "Sin lectura de vencimiento";
  }
  if (daysToDue === 0) {
    return "Vence hoy";
  }
  if (daysToDue === 1) {
    return "Vence manana";
  }
  if (daysToDue > 1) {
    return `Vence en ${daysToDue} dias`;
  }
  return `${Math.abs(daysToDue)} dias de atraso`;
}

function getErrorMessage(body: unknown, fallback: string) {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail?: unknown }).detail;
    if (typeof detail === "string" && detail.trim()) {
      return detail;
    }
  }
  return fallback;
}

type IconProps = {
  className?: string;
};

function EyeIcon({ className }: IconProps) {
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
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function ReceiptIcon({ className }: IconProps) {
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
      <path d="M6 3h12v18l-2-1.2-2 1.2-2-1.2-2 1.2-2-1.2L6 21V3Z" />
      <path d="M9 8h6" />
      <path d="M9 12h6" />
      <path d="M9 16h4" />
    </svg>
  );
}

function DownloadIcon({ className }: IconProps) {
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
      <path d="M12 3v11" />
      <path d="m8 10 4 4 4-4" />
      <path d="M5 20h14" />
    </svg>
  );
}

function cxcCategoryLabel(status: CxcStatusFilter) {
  switch (status) {
    case "PAGADA":
      return "Pagadas";
    case "VENCIDA_CON_RECARGO":
      return "Vencidas con recargo";
    case "EN_GRACIA":
      return "En gracia";
    case "POR_VENCER":
      return "Por vencer";
    default:
      return "Todas";
  }
}

function badgeClass(status: CxcStatusFilter) {
  switch (status) {
    case "PAGADA":
      return "border-emerald-500/20 bg-emerald-500/10 text-emerald-300";
    case "VENCIDA_CON_RECARGO":
      return "border-red-500/20 bg-red-500/10 text-red-300";
    case "EN_GRACIA":
      return "border-amber-500/20 bg-amber-500/10 text-amber-200";
    case "POR_VENCER":
      return "border-blue-500/20 bg-blue-500/10 text-blue-300";
    default:
      return "border-zinc-700 bg-zinc-900 text-zinc-200";
  }
}

function cxcRowClass(status: CxcStatusFilter) {
  switch (status) {
    case "PAGADA":
      return "border border-emerald-500/10 bg-emerald-500/5";
    case "VENCIDA_CON_RECARGO":
      return "border border-red-500/20 bg-red-500/10";
    case "EN_GRACIA":
      return "border border-amber-500/20 bg-amber-500/10";
    case "POR_VENCER":
      return "border border-blue-500/20 bg-blue-500/10";
    default:
      return "border border-zinc-900 bg-zinc-950/80";
  }
}

function MiniMetricCard({
  title,
  value,
  helper,
  tone = "default",
  onInspect,
}: {
  title: string;
  value: string;
  helper?: string;
  tone?: "default" | "emerald" | "blue" | "amber" | "red";
  onInspect?: () => void;
}) {
  const toneClass =
    tone === "emerald"
      ? "border-emerald-500/20 bg-emerald-500/10"
      : tone === "blue"
        ? "border-blue-500/20 bg-blue-500/10"
        : tone === "amber"
          ? "border-amber-500/20 bg-amber-500/10"
          : tone === "red"
            ? "border-red-500/20 bg-red-500/10"
            : "border-zinc-800 bg-zinc-950/80";

  return (
    <div className={`metric-card-compact relative ${toneClass}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="metric-label-compact">{title}</p>
        {onInspect ? (
          <button
            type="button"
            onClick={onInspect}
            title={`Ver antiguedad de ${title.toLowerCase()}`}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-cyan-500/20 bg-black/25 text-cyan-100 transition-colors hover:border-cyan-400/50 hover:bg-cyan-500/15"
          >
            <EyeIcon className="h-4 w-4" />
            <span className="sr-only">Ver antiguedad de {title}</span>
          </button>
        ) : null}
      </div>
      <p className="metric-value-compact">{value}</p>
      {helper ? <p className="metric-helper-compact">{helper}</p> : null}
    </div>
  );
}

function AgingBalanceModal({
  title,
  subtitle,
  buckets,
  showRecargos = false,
  onClose,
}: {
  title: string;
  subtitle: string;
  buckets: AgingBucket[];
  showRecargos?: boolean;
  onClose: () => void;
}) {
  const totalSaldo = buckets.reduce((sum, bucket) => sum + bucket.saldo, 0);
  const totalRecargos = buckets.reduce((sum, bucket) => sum + bucket.recargos, 0);
  const totalCuentas = buckets.reduce((sum, bucket) => sum + bucket.cuentas, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 px-4 py-6 backdrop-blur-sm">
      <div className="w-full max-w-3xl rounded-3xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-zinc-800 pb-4">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-cyan-300">
              Cartera por antiguedad
            </p>
            <h3 className="mt-2 text-xl font-semibold text-white">{title}</h3>
            <p className="mt-1 text-sm text-zinc-400">{subtitle}</p>
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
          <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-3">
            <p className="text-xs uppercase tracking-[0.2em] text-red-200/70">Saldo vencido</p>
            <p className="mt-2 text-lg font-semibold text-white">{formatCurrency(totalSaldo)}</p>
          </div>
          {showRecargos ? (
            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-3">
              <p className="text-xs uppercase tracking-[0.2em] text-amber-200/70">Recargos</p>
              <p className="mt-2 text-lg font-semibold text-white">
                {formatCurrency(totalRecargos)}
              </p>
            </div>
          ) : null}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-3">
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Cuentas</p>
            <p className="mt-2 text-lg font-semibold text-white">{totalCuentas}</p>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-[0.2em] text-zinc-500">
              <tr>
                <th className="border-b border-zinc-800 px-3 py-3">Rango</th>
                <th className="border-b border-zinc-800 px-3 py-3">Cuentas</th>
                <th className="border-b border-zinc-800 px-3 py-3">Saldo</th>
                {showRecargos ? (
                  <th className="border-b border-zinc-800 px-3 py-3">Recargos</th>
                ) : null}
                <th className="border-b border-zinc-800 px-3 py-3">Total</th>
              </tr>
            </thead>
            <tbody>
              {buckets.map((bucket) => (
                <tr key={bucket.key} className="text-zinc-200">
                  <td className="border-b border-zinc-900 px-3 py-3 font-medium text-white">
                    {bucket.label}
                  </td>
                  <td className="border-b border-zinc-900 px-3 py-3">{bucket.cuentas}</td>
                  <td className="border-b border-zinc-900 px-3 py-3">
                    {formatCurrency(bucket.saldo)}
                  </td>
                  {showRecargos ? (
                    <td className="border-b border-zinc-900 px-3 py-3">
                      {formatCurrency(bucket.recargos)}
                    </td>
                  ) : null}
                  <td className="border-b border-zinc-900 px-3 py-3 font-semibold text-white">
                    {formatCurrency(bucket.total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function buildVisiblePages(currentPage: number, totalPages: number) {
  if (totalPages <= 5) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const start = Math.max(currentPage - 2, 1);
  const end = Math.min(start + 4, totalPages);
  const adjustedStart = Math.max(end - 4, 1);
  return Array.from(
    { length: end - adjustedStart + 1 },
    (_, index) => adjustedStart + index
  );
}

function buildFiscalForm(preview: CxcInvoicePreview): FiscalFormState {
  return applyGenericPublicDefaults({
    razon_social: preview.cliente.razon_social || preview.cliente.nombre_comercial || "",
    rfc: preview.cliente.rfc || "",
    regimen_fiscal:
      normalizeFiscalRegimeValue(
        preview.cliente.regimen_fiscal,
        preview.cliente.es_persona_moral
      ) || "",
    codigo_postal: preview.cliente.codigo_postal || "",
    archivo_csf_url: preview.cliente.archivo_csf_url || "",
    es_persona_moral: preview.cliente.es_persona_moral,
  });
}

function invoiceFolio(invoice?: ExistingInvoicePreview | null) {
  if (!invoice) {
    return "";
  }
  return `${invoice.serie || ""}${invoice.folio || ""}`.trim();
}

function invoiceDownloadFilename(
  response: Response,
  invoice: ExistingInvoicePreview,
  format: "pdf" | "xml"
) {
  const disposition = response.headers.get("Content-Disposition") || "";
  const match = /filename="?([^"]+)"?/i.exec(disposition);
  if (match?.[1]) {
    return match[1];
  }
  return `${invoiceFolio(invoice) || `factura-${invoice.id}`}.${format}`;
}

function periodButtonClass(isActive: boolean, tone: "cyan" | "emerald" = "cyan") {
  if (isActive) {
    return tone === "emerald"
      ? "border-emerald-400/40 bg-emerald-500/20 text-emerald-100 shadow-[0_0_0_1px_rgba(52,211,153,0.18)]"
      : "border-cyan-400/40 bg-cyan-500/20 text-cyan-100 shadow-[0_0_0_1px_rgba(34,211,238,0.18)]";
  }
  return "border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 hover:text-white";
}

function isGroupedCxcRow(row: CxcRow) {
  return row.tipo_fila === "AGRUPADA";
}

export default function CuentasPorCobrarManager() {
  const [filters, setFilters] = useState<CxcFilters>(DEFAULT_FILTERS);
  const [draftFilters, setDraftFilters] = useState<CxcFilters>(DEFAULT_FILTERS);
  const [data, setData] = useState<CxcDashboardResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [batchFile, setBatchFile] = useState<File | null>(null);
  const [batchPeriod, setBatchPeriod] = useState(() => new Date().toISOString().slice(0, 7));
  const [batchDueDate, setBatchDueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [isDownloadingTemplate, setIsDownloadingTemplate] = useState(false);
  const [isImportingBatch, setIsImportingBatch] = useState(false);
  const [isGeneratingReceivables, setIsGeneratingReceivables] = useState(false);
  const [batchResult, setBatchResult] = useState<BatchImportResult | null>(null);
  const [batchError, setBatchError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [invoicingId, setInvoicingId] = useState<number | null>(null);
  const [downloadingInvoiceFormat, setDownloadingInvoiceFormat] =
    useState<"" | "pdf" | "xml">("");
  const csfInputRef = useRef<HTMLInputElement | null>(null);
  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false);
  const [selectedInvoiceCuentaId, setSelectedInvoiceCuentaId] = useState<number | null>(null);
  const [invoicePreview, setInvoicePreview] = useState<CxcInvoicePreview | null>(null);
  const [invoiceFiscalForm, setInvoiceFiscalForm] =
    useState<FiscalFormState>(EMPTY_FISCAL_FORM);
  const [invoiceModalError, setInvoiceModalError] = useState("");
  const [isInvoicePreviewLoading, setIsInvoicePreviewLoading] = useState(false);
  const [isSavingFiscal, setIsSavingFiscal] = useState(false);
  const [isParsingCsf, setIsParsingCsf] = useState(false);

  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [detail, setDetail] = useState<CxcClientDetailResponse | null>(null);
  const [groupDetailRow, setGroupDetailRow] = useState<CxcRow | null>(null);
  const [agingModalOpen, setAgingModalOpen] = useState(false);
  const [infoModal, setInfoModal] = useState<FinanceInfoContent | null>(null);
  const [filterError, setFilterError] = useState("");
  const [fiscalErrors, setFiscalErrors] = useState<Record<string, string>>({});

  const loadData = useCallback(
    async (activeFilters: CxcFilters, activePage: number, activePageSize: number) => {
      const params = new URLSearchParams();
      if (activeFilters.entidadId) {
        params.set("entidad_id", activeFilters.entidadId);
      }
      if (activeFilters.clienteId) {
        params.set("cliente_id", activeFilters.clienteId);
      }
      if (activeFilters.status) {
        params.set("status", activeFilters.status);
      }
      if (activeFilters.fechaDesde) {
        params.set("fecha_desde", activeFilters.fechaDesde);
      }
      if (activeFilters.fechaHasta) {
        params.set("fecha_hasta", activeFilters.fechaHasta);
      }
      if (activeFilters.busqueda.trim()) {
        params.set("busqueda", activeFilters.busqueda.trim());
      }
      if (activeFilters.agrupacion) {
        params.set("agrupacion", activeFilters.agrupacion);
      }
      params.set("page", String(activePage));
      params.set("page_size", String(activePageSize));

      const url = `${FINANZAS_API_BASE}/cxc/?${params.toString()}`;

      try {
        const response = await fetch(url, { cache: "no-store" });
        const body = (await response.json()) as unknown;
        if (!response.ok) {
          throw new Error(
            getErrorMessage(body, "No se pudo cargar la cartera de cuentas por cobrar.")
          );
        }
        const payload = body as CxcDashboardResponse;
        setData(payload);
        if (payload.page !== activePage) {
          setCurrentPage(payload.page);
        }
        if (payload.page_size !== activePageSize) {
          setPageSize(payload.page_size);
        }
        setError("");
      } catch (loadError) {
        console.error("Error cargando CxC:", loadError);
        setData(null);
        setError(
          loadError instanceof Error
            ? loadError.message
            : "No se pudo cargar la cartera de cuentas por cobrar."
        );
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    []
  );

  useEffect(() => {
    void loadData(filters, currentPage, pageSize);
  }, [filters, currentPage, pageSize, loadData]);

  const handleApplyFilters = (event: FormEvent) => {
    event.preventDefault();
    const validationError = validateCxcFilters(draftFilters);
    if (validationError) {
      setFilterError(validationError);
      return;
    }
    setFilterError("");
    setIsRefreshing(true);
    setCurrentPage(1);
    setFilters(draftFilters);
  };

  const handleResetFilters = () => {
    setDraftFilters(DEFAULT_FILTERS);
    setIsRefreshing(true);
    setCurrentPage(1);
    setFilters(DEFAULT_FILTERS);
  };

  const applyPeriodRange = (
    range: Pick<CxcFilters, "fechaDesde" | "fechaHasta">,
    periodPreset: CxcPeriodPreset,
    agrupacion: CxcGroupingMode = ""
  ) => {
    const nextFilters = {
      ...draftFilters,
      fechaDesde: range.fechaDesde,
      fechaHasta: range.fechaHasta,
      periodPreset,
      agrupacion,
    };
    setDraftFilters(nextFilters);
    setIsRefreshing(true);
    setCurrentPage(1);
    setFilters(nextFilters);
  };

  const handleShowAllHistory = () => {
    applyPeriodRange({ fechaDesde: "", fechaHasta: "" }, "history", "espacio");
  };

  const handleCopyReference = async (reference?: string | null) => {
    const value = reference?.trim();
    if (!value || value.startsWith("ESPACIO:")) {
      setActionMessage("Esta fila no tiene una referencia de pago individual para copiar.");
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
      setActionMessage(`Referencia copiada: ${value}`);
    } catch {
      setActionMessage("No se pudo copiar la referencia. Seleccionala manualmente.");
    }
  };

  const handleGenerateReceivables = async () => {
    setIsGeneratingReceivables(true);
    setActionMessage("");
    setError("");
    try {
      const fechaCorte = currentMonthRange().fechaHasta;
      const response = await fetch(`${FINANZAS_API_BASE}/cxc/generar/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fecha_corte: fechaCorte,
          entidad_id: filters.entidadId ? Number(filters.entidadId) : null,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        mensaje?: string;
        detail?: string;
        creados?: number;
        existentes?: number;
        entidades?: number;
      };
      if (!response.ok) {
        throw new Error(
          body.detail || "No se pudieron actualizar las cuentas por cobrar."
        );
      }
      setActionMessage(
        `${body.mensaje || "Cuentas por cobrar actualizadas al mes actual."} ${
          body.creados ?? 0
        } nuevas, ${body.existentes ?? 0} existentes en ${
          body.entidades ?? 0
        } entidades.`
      );
      setIsRefreshing(true);
      setCurrentPage(1);
      await loadData(filters, 1, pageSize);
    } catch (generateError) {
      setError(
        generateError instanceof Error
          ? generateError.message
          : "No se pudieron actualizar las cuentas por cobrar."
      );
    } finally {
      setIsGeneratingReceivables(false);
      setIsRefreshing(false);
    }
  };

  const handleDownloadBatchTemplate = async () => {
    setIsDownloadingTemplate(true);
    setBatchError("");
    try {
      const response = await fetch(`${FINANZAS_API_BASE}/cxc/batch/plantilla/`);
      if (!response.ok) {
        throw new Error("No se pudo descargar la plantilla.");
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "plantilla-cuentas-por-cobrar.csv";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
    } catch (downloadError) {
      setBatchError(
        downloadError instanceof Error
          ? downloadError.message
          : "No se pudo descargar la plantilla."
      );
    } finally {
      setIsDownloadingTemplate(false);
    }
  };

  const waitForBatchJob = async (jobId: number) => {
    for (let attempt = 0; attempt < 90; attempt += 1) {
      const response = await fetch(buildApiUrl(`/billing/jobs/${jobId}/`), {
        cache: "no-store",
      });
      const body = (await response.json().catch(() => ({}))) as
        | BackgroundJobStatus
        | { detail?: string };
      if (!response.ok) {
        throw new Error(
          getErrorMessage(body, "No se pudo consultar el estado de la carga batch.")
        );
      }
      const job = body as BackgroundJobStatus;
      if (job.status === "SUCCESS" && job.result) {
        return job.result;
      }
      if (job.status === "ERROR" || job.status === "CANCELLED") {
        throw new Error(job.error || "La carga batch de CxC termino con error.");
      }
      await sleep(2000);
    }
    throw new Error("La carga batch sigue en proceso. Revisa salud operativa en unos minutos.");
  };

  const handleImportBatch = async () => {
    if (!batchFile) {
      setBatchError("Selecciona un archivo CSV o Excel para importar.");
      return;
    }
    if (!isValidMonth(batchPeriod)) {
      setBatchError("Periodo debe ser un mes valido.");
      return;
    }
    if (!isValidDate(batchDueDate)) {
      setBatchError("Vencimiento default debe ser una fecha valida.");
      return;
    }
    setIsImportingBatch(true);
    setBatchError("");
    setBatchResult(null);
    const formData = new FormData();
    formData.append("file", batchFile);
    formData.append("periodo", batchPeriod);
    formData.append("fecha_vencimiento", batchDueDate);

    try {
      const response = await fetch(`${FINANZAS_API_BASE}/cxc/batch/importar/?async_job=true`, {
        method: "POST",
        body: formData,
      });
      const body = (await response.json()) as
        | BatchImportResult
        | BatchImportAccepted
        | { detail?: string };
      if (!response.ok) {
        throw new Error(
          getErrorMessage(body, "No se pudo importar la carga batch de CxC.")
        );
      }
      const result =
        "accepted" in body && body.accepted
          ? await waitForBatchJob(body.job_id)
          : (body as BatchImportResult);
      setBatchResult(result);
      setBatchFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      setCurrentPage(1);
      setIsRefreshing(true);
      await loadData(filters, 1, pageSize);
    } catch (importError) {
      setBatchError(
        importError instanceof Error
          ? importError.message
          : "No se pudo importar la carga batch de CxC."
      );
    } finally {
      setIsImportingBatch(false);
    }
  };

  const handleChangePage = (page: number) => {
    if (!data || page < 1 || page > data.total_pages || page === currentPage) {
      return;
    }
    setIsRefreshing(true);
    setCurrentPage(page);
  };

  const handleOpenDetail = async (clienteId: number) => {
    setIsDetailOpen(true);
    setIsDetailLoading(true);
    setDetail(null);
    setDetailError("");

    const params = new URLSearchParams();
    if (filters.entidadId) {
      params.set("entidad_id", filters.entidadId);
    }
    if (filters.fechaDesde) {
      params.set("fecha_desde", filters.fechaDesde);
    }
    if (filters.fechaHasta) {
      params.set("fecha_hasta", filters.fechaHasta);
    }

    try {
      const response = await fetch(
        `${FINANZAS_API_BASE}/cxc/clientes/${clienteId}/detalle/${params.toString() ? `?${params.toString()}` : ""}`,
        { cache: "no-store" }
      );
      const body = (await response.json()) as unknown;
      if (!response.ok) {
        throw new Error(
          getErrorMessage(body, "No se pudo cargar el detalle del cliente.")
        );
      }
      setDetail(body as CxcClientDetailResponse);
    } catch (detailLoadError) {
      console.error("Error cargando detalle CxC:", detailLoadError);
      setDetailError(
        detailLoadError instanceof Error
          ? detailLoadError.message
          : "No se pudo cargar el detalle del cliente."
      );
    } finally {
      setIsDetailLoading(false);
    }
  };

  const loadInvoicePreview = async (cuentaId: number) => {
    setIsInvoicePreviewLoading(true);
    setInvoiceModalError("");
    try {
      const response = await fetch(`${FACTURACION_API_BASE}/cxc/${cuentaId}/preview/`, {
        cache: "no-store",
      });
      const body = (await response.json().catch(() => ({}))) as unknown;
      if (!response.ok) {
        throw new Error(getErrorMessage(body, "No se pudo preparar la factura."));
      }
      const preview = body as CxcInvoicePreview;
      setInvoicePreview(preview);
      setInvoiceFiscalForm(buildFiscalForm(preview));
      return preview;
    } catch (previewError) {
      setInvoiceModalError(
        previewError instanceof Error
          ? previewError.message
          : "No se pudo preparar la factura."
      );
      return null;
    } finally {
      setIsInvoicePreviewLoading(false);
    }
  };

  const handleOpenInvoiceModal = async (cuentaId: number) => {
    setSelectedInvoiceCuentaId(cuentaId);
    setInvoicePreview(null);
    setInvoiceFiscalForm(EMPTY_FISCAL_FORM);
    setInvoiceModalError("");
    setInvoiceModalOpen(true);
    await loadInvoicePreview(cuentaId);
  };

  const handleCloseInvoiceModal = () => {
    setInvoiceModalOpen(false);
    setSelectedInvoiceCuentaId(null);
    setInvoicePreview(null);
    setInvoiceModalError("");
    setFiscalErrors({});
    setInvoiceFiscalForm(EMPTY_FISCAL_FORM);
  };

  const handleParseInvoiceCsf = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      setInvoiceModalError("Solo se admite la Constancia de Situacion Fiscal en PDF.");
      event.target.value = "";
      return;
    }

    setIsParsingCsf(true);
    setInvoiceModalError("");
    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch(`${CRM_API_BASE}/extraer-csf/`, {
        method: "POST",
        body: formData,
      });
      const body = (await response.json().catch(() => ({}))) as {
        detail?: string;
        datos_extraidos?: ExtractedCsfData;
      };

      if (!response.ok) {
        throw new Error(body.detail || "No se pudo procesar la CSF.");
      }

      const extracted = body.datos_extraidos || {};
      setInvoiceFiscalForm((prev) => {
        const nextIsMoral =
          extracted.es_persona_moral !== undefined
            ? extracted.es_persona_moral
            : prev.es_persona_moral;
        return applyGenericPublicDefaults({
          ...prev,
          es_persona_moral: nextIsMoral,
          razon_social: extracted.razon_social || prev.razon_social,
          rfc: extracted.rfc || prev.rfc,
          regimen_fiscal:
            normalizeFiscalRegimeValue(
              extracted.regimen_fiscal || prev.regimen_fiscal,
              nextIsMoral
            ) || "",
          codigo_postal: extracted.codigo_postal || prev.codigo_postal,
          archivo_csf_url: extracted.archivo_csf_url || prev.archivo_csf_url,
        });
      });
    } catch (parseError) {
      setInvoiceModalError(
        parseError instanceof Error
          ? parseError.message
          : "No se pudo procesar la CSF."
      );
    } finally {
      setIsParsingCsf(false);
      event.target.value = "";
    }
  };

  const handleSaveInvoiceFiscal = async () => {
    if (!selectedInvoiceCuentaId) {
      return;
    }
    const validationErrors = validateFiscalForm(invoiceFiscalForm);
    setFiscalErrors(validationErrors);
    const firstError = Object.values(validationErrors)[0];
    if (firstError) {
      setInvoiceModalError(firstError);
      return;
    }
    setIsSavingFiscal(true);
    setInvoiceModalError("");
    try {
      const fiscalPayload = applyGenericPublicDefaults(invoiceFiscalForm);
      const response = await fetch(
        `${FACTURACION_API_BASE}/cxc/${selectedInvoiceCuentaId}/receptor-fiscal/`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            razon_social: fiscalPayload.razon_social.trim(),
            rfc: fiscalPayload.rfc.trim().toUpperCase(),
            regimen_fiscal: fiscalPayload.regimen_fiscal.trim(),
            codigo_postal: fiscalPayload.codigo_postal.trim(),
            archivo_csf_url: fiscalPayload.archivo_csf_url.trim(),
            es_persona_moral: fiscalPayload.es_persona_moral,
          }),
        }
      );
      const body = (await response.json().catch(() => ({}))) as unknown;
      if (!response.ok) {
        throw new Error(getErrorMessage(body, "No se pudieron guardar los datos fiscales."));
      }
      const preview = body as CxcInvoicePreview;
      setInvoicePreview(preview);
      setInvoiceFiscalForm(buildFiscalForm(preview));
      setFiscalErrors({});
      setActionMessage("Datos fiscales actualizados para esta factura.");
    } catch (saveError) {
      setInvoiceModalError(
        saveError instanceof Error
          ? saveError.message
          : "No se pudieron guardar los datos fiscales."
      );
    } finally {
      setIsSavingFiscal(false);
    }
  };

  const handleInvoiceFiscalPersonTypeChange = (isPersonaMoral: boolean) => {
    setInvoiceFiscalForm((prev) => {
      if (isGenericPublicRfc(prev.rfc)) {
        return applyGenericPublicDefaults(prev);
      }
      return {
        ...prev,
        es_persona_moral: isPersonaMoral,
        regimen_fiscal: normalizeFiscalRegimeValue(
          prev.regimen_fiscal,
          isPersonaMoral
        ),
      };
    });
  };

  const handleInvoiceFiscalRfcChange = (value: string) => {
    setInvoiceFiscalForm((prev) =>
      applyGenericPublicDefaults({
        ...prev,
        rfc: cleanRfc(value),
      })
    );
    setFiscalErrors((current) => {
      if (!current.rfc) return current;
      const next = { ...current };
      delete next.rfc;
      return next;
    });
  };

  const handleConfirmEmitInvoice = async () => {
    if (!selectedInvoiceCuentaId) {
      return;
    }
    setInvoicingId(selectedInvoiceCuentaId);
    setActionMessage("");
    try {
      const response = await fetch(`${FACTURACION_API_BASE}/cxc/${selectedInvoiceCuentaId}/emitir/`, {
        method: "POST",
      });
      const body = (await response.json().catch(() => ({}))) as {
        mensaje?: string;
        detail?: string;
        factura?: ExistingInvoicePreview;
      };
      if (!response.ok) {
        throw new Error(body.detail || "No se pudo emitir la factura.");
      }
      const serieFolio = `${body.factura?.serie || ""}${body.factura?.folio || ""}`.trim();
      if (body.factura) {
        setInvoicePreview((prev) =>
          prev
            ? {
                ...prev,
                factura_existente: body.factura || null,
                ya_timbrada:
                  body.factura?.estatus === "TIMBRADA" || Boolean(body.factura?.uuid),
                puede_timbrar: false,
              }
            : prev
        );
      }
      setActionMessage(
        `${body.mensaje || "Factura emitida correctamente."}${
          serieFolio ? ` Folio ${serieFolio}.` : ""
        }${body.factura?.uuid ? ` UUID ${body.factura.uuid}.` : ""}`
      );
      setInvoiceModalError("");
      await loadInvoicePreview(selectedInvoiceCuentaId);
      await loadData(filters, currentPage, pageSize);
    } catch (invoiceError) {
      setInvoiceModalError(
        invoiceError instanceof Error
          ? invoiceError.message
          : "No se pudo emitir la factura."
      );
    } finally {
      setInvoicingId(null);
    }
  };

  const handleDownloadInvoiceFile = async (
    invoice: ExistingInvoicePreview,
    format: "pdf" | "xml"
  ) => {
    setDownloadingInvoiceFormat(format);
    setInvoiceModalError("");
    try {
      const response = await fetch(
        `${FACTURACION_API_BASE}/facturas/${invoice.id}/${format}/`,
        { cache: "no-store" }
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as unknown;
        throw new Error(
          getErrorMessage(body, `No se pudo descargar el archivo ${format.toUpperCase()}.`)
        );
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = invoiceDownloadFilename(response, invoice, format);
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (downloadError) {
      setInvoiceModalError(
        downloadError instanceof Error
          ? downloadError.message
          : `No se pudo descargar el archivo ${format.toUpperCase()}.`
      );
    } finally {
      setDownloadingInvoiceFormat("");
    }
  };

  const rows = data?.items || [];
  const metricas = data?.metricas;
  const metricTotals = metricas?.totales;
  const monthlySummary = metricas?.por_mes || [];
  const groupDetailAccounts = groupDetailRow?.cuentas || [];
  const showingFrom = data?.total ? (data.page - 1) * data.page_size + 1 : 0;
  const showingTo = data?.total ? showingFrom + rows.length - 1 : 0;
  const visiblePages = buildVisiblePages(data?.page || 1, data?.total_pages || 1);

  const activePeriodLabel = useMemo(() => {
    if (filters.fechaDesde && filters.fechaHasta) {
      return `${formatDate(filters.fechaDesde)} al ${formatDate(filters.fechaHasta)}`;
    }
    if (filters.fechaDesde) {
      return `Desde ${formatDate(filters.fechaDesde)}`;
    }
    if (filters.fechaHasta) {
      return `Hasta ${formatDate(filters.fechaHasta)}`;
    }
    return "Toda la cartera";
  }, [filters.fechaDesde, filters.fechaHasta]);
  const existingInvoice = invoicePreview?.factura_existente || null;
  const existingInvoiceFolio = invoiceFolio(existingInvoice);
  const selectedInvoicePeriod = invoicePreview
    ? `${formatDate(
        invoicePreview.cuenta.fecha_periodo_inicio ||
          invoicePreview.cuenta.fecha_vencimiento
      )} al ${formatDate(
        invoicePreview.cuenta.fecha_periodo_fin ||
          invoicePreview.cuenta.fecha_vencimiento
      )}`
    : "";
  const invoiceFiscalRegimeOptions = getFiscalRegimeOptions(
    invoiceFiscalForm.es_persona_moral
  );
  const invoiceIsGenericPublic = isGenericPublicRfc(invoiceFiscalForm.rfc);

  return (
    <>
      <FinanceInfoModal info={infoModal} onClose={() => setInfoModal(null)} />
      <div className="space-y-4">
        <section className="page-section">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.28em] text-zinc-500">
                Cobranza viva
              </p>
              <div className="mt-1.5 flex items-center gap-2">
                <h1 className="page-title-compact">
                  Cuentas por cobrar
                </h1>
                <FinanceInfoButton info={cxcInfo.modulo} onOpen={setInfoModal} />
              </div>
              <p className="section-copy-compact max-w-3xl">
                Genera cargos mensuales de clientes activos, aplica pagos y revisa
                cartera por mes, ano o periodo.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="page-section-tight text-sm text-zinc-400">
                Referencia:{" "}
                <span className="font-semibold text-white">
                  {data ? formatDate(data.fecha_referencia) : "Cargando..."}
                </span>
              </div>
              <div className="page-section-tight text-sm text-zinc-400">
                Periodo:{" "}
                <span className="font-semibold text-white">{activePeriodLabel}</span>
              </div>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(350px,0.9fr)]">
          <form
            onSubmit={handleApplyFilters}
            className="page-section"
          >
            <div className="flex flex-col gap-3 border-b border-zinc-800 pb-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="section-title-compact">Filtros</h2>
                  <FinanceInfoButton info={cxcInfo.filtros} onOpen={setInfoModal} />
                </div>
                <p className="section-copy-compact">
                  Mantengo todos tus filtros, pero en una lectura mas compacta.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleResetFilters}
                  className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
                >
                  Limpiar
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-500"
                >
                  {isRefreshing ? "Filtrando..." : "Aplicar filtros"}
                </button>
              </div>
            </div>
            {filterError ? (
              <div className="mt-4 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                {filterError}
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => applyPeriodRange(currentMonthRange(), "current-month")}
                className={`rounded-xl border px-3 py-2 text-xs font-medium uppercase tracking-[0.18em] transition-colors ${periodButtonClass(
                  draftFilters.periodPreset === "current-month"
                )}`}
              >
                Mes actual
              </button>
              <button
                type="button"
                onClick={() => applyPeriodRange(previousMonthRange(), "previous-month")}
                className={`rounded-xl border px-3 py-2 text-xs font-medium uppercase tracking-[0.18em] transition-colors ${periodButtonClass(
                  draftFilters.periodPreset === "previous-month"
                )}`}
              >
                Mes anterior
              </button>
              <button
                type="button"
                onClick={() => applyPeriodRange(currentYearToDateRange(), "year-to-date")}
                className={`rounded-xl border px-3 py-2 text-xs font-medium uppercase tracking-[0.18em] transition-colors ${periodButtonClass(
                  draftFilters.periodPreset === "year-to-date"
                )}`}
              >
                Año a la fecha
              </button>
              <button
                type="button"
                onClick={handleShowAllHistory}
                className={`rounded-xl border px-3 py-2 text-xs font-medium uppercase tracking-[0.18em] transition-colors ${periodButtonClass(
                  draftFilters.periodPreset === "history"
                )}`}
              >
                Historico
              </button>
              <FinanceInfoButton info={cxcInfo.periodo} onOpen={setInfoModal} />
              <button
                type="button"
                onClick={() => void handleGenerateReceivables()}
                disabled={isGeneratingReceivables}
                className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-medium uppercase tracking-[0.18em] text-emerald-200 transition-colors hover:bg-emerald-500/20 disabled:cursor-wait disabled:opacity-60"
              >
                {isGeneratingReceivables ? "Actualizando..." : "Actualizar mes actual"}
              </button>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              <div>
                <FinanceFieldLabel optional info={cxcInfo.filtros} onInfo={setInfoModal}>
                  Entidad
                </FinanceFieldLabel>
                <select
                  value={draftFilters.entidadId}
                  onChange={(event) =>
                    setDraftFilters({ ...draftFilters, entidadId: event.target.value })
                  }
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-200 outline-none focus:ring-1 focus:ring-cyan-500"
                >
                  <option value="">Todas</option>
                  {(data?.entidades || []).map((entity) => (
                    <option key={entity.id} value={entity.id}>
                      {entity.nombre}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <FinanceFieldLabel optional info={cxcInfo.filtros} onInfo={setInfoModal}>
                  Cliente
                </FinanceFieldLabel>
                <select
                  value={draftFilters.clienteId}
                  onChange={(event) =>
                    setDraftFilters({ ...draftFilters, clienteId: event.target.value })
                  }
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-200 outline-none focus:ring-1 focus:ring-cyan-500"
                >
                  <option value="">Todos</option>
                  {(data?.clientes || []).map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.nombre}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <FinanceFieldLabel optional info={cxcInfo.filtros} onInfo={setInfoModal}>
                  Estado
                </FinanceFieldLabel>
                <select
                  value={draftFilters.status}
                  onChange={(event) =>
                    setDraftFilters({
                      ...draftFilters,
                      status: event.target.value as CxcStatusFilter,
                    })
                  }
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-200 outline-none focus:ring-1 focus:ring-cyan-500"
                >
                  <option value="">Todas</option>
                  <option value="PAGADA">Pagadas</option>
                  <option value="VENCIDA_CON_RECARGO">Vencidas con recargo</option>
                  <option value="EN_GRACIA">En gracia</option>
                  <option value="POR_VENCER">Por vencer</option>
                </select>
              </div>

              <div>
                <FinanceFieldLabel optional info={cxcInfo.filtros} onInfo={setInfoModal}>
                  Fecha desde
                </FinanceFieldLabel>
                <input
                  type="date"
                  value={draftFilters.fechaDesde}
                  onChange={(event) =>
                    setDraftFilters({
                      ...draftFilters,
                      fechaDesde: event.target.value,
                      periodPreset: "",
                      agrupacion: "",
                    })
                  }
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                />
              </div>

              <div>
                <FinanceFieldLabel optional info={cxcInfo.filtros} onInfo={setInfoModal}>
                  Fecha hasta
                </FinanceFieldLabel>
                <input
                  type="date"
                  value={draftFilters.fechaHasta}
                  onChange={(event) =>
                    setDraftFilters({
                      ...draftFilters,
                      fechaHasta: event.target.value,
                      periodPreset: "",
                      agrupacion: "",
                    })
                  }
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                />
              </div>

              <div>
                <FinanceFieldLabel optional info={cxcInfo.filtros} onInfo={setInfoModal}>
                  Buscar
                </FinanceFieldLabel>
                <input
                  type="text"
                  value={draftFilters.busqueda}
                  onChange={(event) =>
                    setDraftFilters({
                      ...draftFilters,
                      busqueda: safeText(event.target.value, CXC_SEARCH_MAX),
                    })
                  }
                  maxLength={CXC_SEARCH_MAX}
                  placeholder="Cliente, espacio, referencia..."
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none placeholder:text-zinc-500 focus:ring-1 focus:ring-cyan-500"
                />
              </div>
            </div>
          </form>

          <section className="page-section">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-white">Resumen del periodo</h2>
                <p className="section-copy-compact">
                  Cargos, pagos y saldo con los filtros activos.
                </p>
              </div>
              <div className="page-section-tight text-xs uppercase tracking-[0.24em] text-zinc-500">
                {cxcCategoryLabel(filters.status)}
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <MiniMetricCard
                title="Cargos"
                value={formatCurrency(metricTotals?.cargos || 0)}
                helper={`${metricas?.registros || 0} cuentas visibles`}
                tone="blue"
              />
              <MiniMetricCard
                title="Cobrado"
                value={formatCurrency(metricTotals?.cobrado || 0)}
                helper={`${metricTotals?.cuentas_pagadas || 0} pagadas`}
                tone="emerald"
              />
              <MiniMetricCard
                title="Saldo"
                value={formatCurrency(metricTotals?.saldo || 0)}
                helper={`${metricTotals?.cuentas_abiertas || 0} abiertas`}
                tone="red"
                onInspect={() => setAgingModalOpen(true)}
              />
              <MiniMetricCard
                title="Recargos"
                value={formatCurrency(metricTotals?.recargos || 0)}
                helper={`${metricas?.vencidas.count || 0} vencidas`}
                tone="amber"
              />
              <div className="col-span-2">
                <MiniMetricCard
                  title="Clientes visibles"
                  value={String(metricas?.clientes || 0)}
                  helper={`Facturado ${formatCurrency(metricTotals?.facturado || 0)}`}
                />
              </div>
            </div>

          </section>
        </section>

        <section className="page-section py-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">
                Historico mensual
              </p>
              <p className="section-copy-compact">
                Meses reales hasta el periodo actual; los cargos futuros no se muestran aqui.
              </p>
            </div>
            <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">
              {monthlySummary.length} meses
            </span>
          </div>
          <div className="mt-3 flex gap-3 overflow-x-auto pb-1">
            {monthlySummary.length ? (
              monthlySummary.slice(0, 12).map((month) => (
                <div
                  key={month.periodo}
                  className="min-w-[210px] rounded-2xl border border-zinc-800 bg-zinc-950/70 px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-white">{month.periodo}</p>
                    <p className="text-sm font-semibold text-cyan-200">
                      {formatCurrency(month.saldo)}
                    </p>
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">
                    {month.cuentas} cuentas | {formatCurrency(month.cobrado)} cobrado
                  </p>
                </div>
              ))
            ) : (
              <p className="w-full rounded-2xl border border-dashed border-zinc-800 py-6 text-center text-sm text-zinc-500">
                Sin meses para mostrar.
              </p>
            )}
          </div>
        </section>

        <details className="page-section" open={Boolean(batchError || batchResult)}>
          <summary className="cursor-pointer list-none">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="section-title-compact">Carga batch opcional</h2>
                  <FinanceInfoButton info={cxcInfo.batch} onOpen={setInfoModal} />
                </div>
                <p className="section-copy-compact">
                  Despliega solo cuando necesites importar cargos masivos.
                </p>
              </div>
              <span className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-200">
                Abrir carga
              </span>
            </div>
          </summary>

          <div className="mt-5 flex flex-col gap-4 border-t border-zinc-800 pt-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h3 className="text-base font-semibold text-white">Importar CxC</h3>
              <p className="section-copy-compact">
                Sube cargos por cliente con unidad, cliente, concepto y monto como base.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleDownloadBatchTemplate()}
              disabled={isDownloadingTemplate}
              className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-800 hover:text-white disabled:cursor-wait disabled:opacity-60"
            >
              {isDownloadingTemplate ? "Descargando..." : "Plantilla CSV"}
            </button>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-[180px_180px_minmax(0,1fr)_auto] md:items-end">
            <div>
              <FinanceFieldLabel required info={cxcInfo.batch} onInfo={setInfoModal}>
                Periodo
              </FinanceFieldLabel>
              <input
                type="month"
                value={batchPeriod}
                onChange={(event) => setBatchPeriod(event.target.value)}
                className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
              />
            </div>

            <div>
              <FinanceFieldLabel required info={cxcInfo.batch} onInfo={setInfoModal}>
                Vencimiento default
              </FinanceFieldLabel>
              <input
                type="date"
                value={batchDueDate}
                onChange={(event) => setBatchDueDate(event.target.value)}
                className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
              />
            </div>

            <div>
              <FinanceFieldLabel required info={cxcInfo.batch} onInfo={setInfoModal}>
                Archivo
              </FinanceFieldLabel>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xlsm"
                onChange={(event) => setBatchFile(event.target.files?.[0] ?? null)}
                className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-300 file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-800 file:px-3 file:py-2 file:text-sm file:text-zinc-100"
              />
            </div>

            <button
              type="button"
              onClick={() => void handleImportBatch()}
              disabled={isImportingBatch}
              className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm font-medium text-emerald-200 transition-colors hover:bg-emerald-500/20 disabled:cursor-wait disabled:opacity-60"
            >
              {isImportingBatch ? "Importando..." : "Importar CxC"}
            </button>
          </div>

          {batchError ? (
            <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">
              {batchError}
            </div>
          ) : null}

          {batchResult ? (
            <div className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-200">
              {batchResult.mensaje} {batchResult.creados} creados,{" "}
              {batchResult.existentes} existentes, {batchResult.omitidos} omitidos.
              {batchResult.errores?.length ? (
                <p className="mt-1 text-xs text-amber-200">
                  Primer aviso: {batchResult.errores[0]}
                </p>
              ) : null}
            </div>
          ) : null}
        </details>

        {isLoading ? (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950 py-16 text-center text-zinc-500">
            Cargando cartera de CxC...
          </div>
        ) : error ? (
          <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300">
            {error}
          </div>
        ) : (
          <section className="page-section">
            {actionMessage ? (
              <div className="mb-4 rounded-xl border border-cyan-500/20 bg-cyan-500/10 p-3 text-sm text-cyan-100">
                {actionMessage}
              </div>
            ) : null}
            <div className="flex flex-col gap-3 border-b border-zinc-800 pb-4 xl:flex-row xl:items-end xl:justify-between">
              <div>
                <h2 className="text-xl font-bold text-white">Cartera detallada</h2>
                <p className="section-copy-compact">
                  La tabla es ahora la protagonista: periodo, saldo, recargo y acciones.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 rounded-2xl border border-zinc-800 bg-zinc-950/80 px-3 py-2 text-sm text-zinc-400">
                  <span>Mostrar</span>
                  <select
                    value={pageSize}
                    onChange={(event) => {
                      setIsRefreshing(true);
                      setPageSize(Number(event.target.value));
                      setCurrentPage(1);
                    }}
                    className="bg-transparent text-sm font-medium text-white outline-none"
                  >
                    {PAGE_SIZE_OPTIONS.map((option) => (
                      <option key={option} value={option} className="bg-zinc-950">
                        {option}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="page-section-tight text-sm text-zinc-400">
                  {data?.total
                    ? `Mostrando ${showingFrom}-${showingTo} de ${data.total}`
                    : "Sin registros"}
                </div>
              </div>
            </div>

            {rows.length === 0 ? (
              <div className="mt-4 rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/20 py-16 text-center text-zinc-500">
                No hay cuentas por cobrar con los filtros actuales.
              </div>
            ) : (
              <>
                <div className="mt-4 overflow-x-auto">
                  <table className="min-w-full border-separate border-spacing-y-2 text-left text-sm">
                    <thead>
                      <tr className="text-xs uppercase tracking-wide text-zinc-500">
                        <th className="px-3 py-2">Cliente</th>
                        <th className="px-3 py-2">Entidad / operacion</th>
                        <th className="px-3 py-2">Periodo y vencimiento</th>
                        <th className="px-3 py-2">Saldo exigible</th>
                        <th className="px-3 py-2">Estado</th>
                        <th className="px-3 py-2">Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr
                          key={row.group_key || row.id}
                          className={`rounded-2xl ${cxcRowClass(row.categoria_tablero)}`}
                        >
                          <td className="rounded-l-2xl px-3 py-3 align-top">
                            <p className="font-semibold text-white">{row.cliente_nombre}</p>
                            <p className="mt-1 text-xs text-zinc-500">
                              {isGroupedCxcRow(row)
                                ? `${row.clientes_count || 0} clientes vinculados`
                                : row.cliente_identificador || "Sin identificador"}
                            </p>
                            <p className="mt-1 text-xs text-zinc-500">
                              Ref. {row.referencia_unica || "Sin referencia"}
                            </p>
                            {!isGroupedCxcRow(row) && row.referencia_unica ? (
                              <button
                                type="button"
                                onClick={() => void handleCopyReference(row.referencia_unica)}
                                className="mt-2 rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-2 py-1 text-xs font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20"
                              >
                                Copiar ref.
                              </button>
                            ) : null}
                          </td>

                          <td className="px-3 py-3 align-top">
                            <p className="text-zinc-100">{row.entidad_nombre}</p>
                            <p className="mt-1 text-xs text-zinc-500">
                              {row.espacio_codigo || "Sin espacio"} | {row.concepto}
                            </p>
                            <p className="mt-1 text-xs text-zinc-500">
                              {isGroupedCxcRow(row)
                                ? `${row.cuentas_count || 0} cargos | ${
                                    row.periodos_count || 0
                                  } periodos`
                                : `${row.origen} | ${row.periodicidad}`}
                            </p>
                          </td>

                          <td className="px-3 py-3 align-top">
                            <p className="text-zinc-200">
                              {formatDate(row.fecha_periodo_inicio)}
                            </p>
                            <p className="mt-1 text-xs text-zinc-500">
                              al {formatDate(row.fecha_periodo_fin)}
                            </p>
                            <p className="mt-2 text-xs text-zinc-400">
                              {isGroupedCxcRow(row) ? "ultimo vencimiento" : "vence"}{" "}
                              {formatDate(row.fecha_vencimiento)}
                            </p>
                            <p className="mt-1 text-xs text-zinc-500">
                              gracia {row.dias_gracia} dias | limite{" "}
                              {formatDate(row.fecha_limite_gracia)}
                            </p>
                          </td>

                          <td className="px-3 py-3 align-top">
                            <p className="font-medium text-white">
                              {formatCurrency(row.total_a_pagar)}
                            </p>
                            <p className="mt-1 text-xs text-zinc-500">
                              Base {formatCurrency(row.monto_base)}
                            </p>
                            <p className="mt-1 text-xs text-amber-200">
                              Interes {formatCurrency(row.interes_monto)}
                            </p>
                            <p className="mt-1 text-xs text-cyan-300">
                              Pagado {formatCurrency(row.monto_pagado)}
                            </p>
                          </td>

                          <td className="px-3 py-3 align-top">
                            <span
                              className={`rounded-full border px-2.5 py-1 text-xs font-medium ${badgeClass(
                                row.categoria_tablero
                              )}`}
                            >
                              {cxcCategoryLabel(row.categoria_tablero)}
                            </span>
                            <p className="mt-2 text-xs text-zinc-500">
                              Estatus interno: {row.estatus}
                            </p>
                            {row.factura ? (
                              <p className="mt-1 text-xs text-emerald-300">
                                Factura {invoiceFolio(row.factura) || row.factura.estatus}
                              </p>
                            ) : isGroupedCxcRow(row) ? (
                              <p className="mt-1 text-xs text-cyan-300">
                                Ver detalle para revisar cada cuenta
                              </p>
                            ) : null}
                            <p className="mt-1 text-xs text-zinc-500">
                              {cxcDueStatusText(row, data?.fecha_referencia)}
                            </p>
                          </td>

                          <td className="rounded-r-2xl px-3 py-3 align-top">
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  isGroupedCxcRow(row)
                                    ? setGroupDetailRow(row)
                                    : void handleOpenDetail(row.cliente_id)
                                }
                                title={
                                  isGroupedCxcRow(row)
                                    ? "Ver cuentas del espacio"
                                    : "Ver detalle"
                                }
                                aria-label={
                                  isGroupedCxcRow(row)
                                    ? "Ver cuentas del espacio"
                                    : "Ver detalle"
                                }
                                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-500/20 bg-cyan-500/10 text-cyan-200 transition-colors hover:bg-cyan-500/20"
                              >
                                <EyeIcon className="h-4 w-4" />
                              </button>
                              {!isGroupedCxcRow(row) ? (
                                <button
                                  type="button"
                                  onClick={() => void handleOpenInvoiceModal(row.id)}
                                  disabled={invoicingId === row.id}
                                  title={row.factura?.estatus === "TIMBRADA" ? "Ver factura" : "Facturar"}
                                  aria-label={
                                    row.factura?.estatus === "TIMBRADA"
                                      ? "Ver factura"
                                      : "Facturar"
                                  }
                                  className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-200 transition-colors hover:bg-emerald-500/20 disabled:cursor-wait disabled:opacity-60"
                                >
                                  <ReceiptIcon className="h-4 w-4" />
                                </button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-5 flex flex-col gap-3 border-t border-zinc-800 pt-4 md:flex-row md:items-center md:justify-between">
                  <div className="text-sm text-zinc-500">
                    Pagina <span className="font-semibold text-white">{data?.page || 1}</span>{" "}
                    de <span className="font-semibold text-white">{data?.total_pages || 1}</span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleChangePage(1)}
                      disabled={!data || data.page <= 1}
                      className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Inicio
                    </button>
                    <button
                      type="button"
                      onClick={() => handleChangePage((data?.page || 1) - 1)}
                      disabled={!data || data.page <= 1}
                      className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Anterior
                    </button>

                    {visiblePages.map((page) => (
                      <button
                        key={page}
                        type="button"
                        onClick={() => handleChangePage(page)}
                        className={`rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
                          page === data?.page
                            ? "bg-cyan-600 text-white"
                            : "border border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 hover:text-white"
                        }`}
                      >
                        {page}
                      </button>
                    ))}

                    <button
                      type="button"
                      onClick={() => handleChangePage((data?.page || 1) + 1)}
                      disabled={!data || data.page >= data.total_pages}
                      className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Siguiente
                    </button>
                    <button
                      type="button"
                      onClick={() => handleChangePage(data?.total_pages || 1)}
                      disabled={!data || data.page >= data.total_pages}
                      className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Final
                    </button>
                  </div>
                </div>
              </>
            )}
          </section>
        )}
      </div>

      {invoiceModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/75 px-4 py-6 backdrop-blur-sm">
          <div className="w-full max-w-6xl rounded-3xl border border-zinc-800 bg-[#07080d] shadow-2xl">
            <div className="flex flex-col gap-3 border-b border-zinc-800 px-6 py-5 md:flex-row md:items-start md:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.28em] text-cyan-300">
                  Facturacion CxC
                </p>
                <h2 className="mt-2 text-2xl font-bold text-white">
                  Preparar factura del periodo
                </h2>
                <p className="mt-1 max-w-3xl text-sm text-zinc-400">
                  La factura se genera por esta cuenta por cobrar. Si el cliente
                  debe varios meses, cada periodo se timbra desde su propia fila
                  para evitar duplicados y mantener trazabilidad.
                </p>
              </div>
              <button
                type="button"
                onClick={handleCloseInvoiceModal}
                className="self-start rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
              >
                Cerrar
              </button>
            </div>

            <div className="space-y-5 px-6 py-5">
              {invoiceModalError ? (
                <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">
                  {invoiceModalError}
                </div>
              ) : null}

              {isInvoicePreviewLoading ? (
                <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 py-12 text-center text-sm text-zinc-500">
                  Preparando borrador de factura...
                </div>
              ) : invoicePreview ? (
                <>
                  <div className="grid gap-4 lg:grid-cols-[1fr_0.9fr]">
                    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div>
                          <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
                            Periodo a facturar
                          </p>
                          <h3 className="mt-2 text-xl font-semibold text-white">
                            {invoicePreview.cuenta.concepto}
                          </h3>
                          <p className="mt-1 text-sm text-zinc-400">
                            {selectedInvoicePeriod}
                          </p>
                          <p className="mt-1 text-xs text-zinc-500">
                            Vence {formatDate(invoicePreview.cuenta.fecha_vencimiento)} |
                            Estatus {invoicePreview.cuenta.estatus}
                          </p>
                        </div>
                        <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-3 text-right">
                          <p className="text-xs uppercase tracking-[0.24em] text-cyan-200">
                            Total periodo
                          </p>
                          <p className="mt-1 text-2xl font-bold text-white">
                            {formatCurrency(invoicePreview.cuenta.monto_total)}
                          </p>
                          <p className="mt-1 text-xs text-zinc-400">
                            Pagado {formatCurrency(invoicePreview.cuenta.monto_pagado)} |
                            Saldo {formatCurrency(invoicePreview.cuenta.saldo_pendiente)}
                          </p>
                        </div>
                      </div>

                      {existingInvoice ? (
                        <div
                          className={`mt-4 rounded-2xl border p-3 text-sm ${
                            invoicePreview.ya_timbrada
                              ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-100"
                              : "border-amber-500/20 bg-amber-500/10 text-amber-100"
                          }`}
                        >
                          <p className="font-semibold">
                            {invoicePreview.ya_timbrada
                              ? "Esta CxC ya esta facturada."
                              : "Ya existe un borrador para esta CxC."}
                          </p>
                          <p className="mt-1 text-xs opacity-80">
                            Folio {existingInvoiceFolio || "sin folio"} |
                            Estatus {existingInvoice.estatus}
                            {existingInvoice.fecha_timbrado
                              ? ` | Timbrada ${formatDate(existingInvoice.fecha_timbrado)}`
                              : ""}
                            {existingInvoice.uuid
                              ? ` | UUID ${existingInvoice.uuid}`
                              : ""}
                          </p>
                          {invoicePreview.ya_timbrada ? (
                            <div className="mt-3 flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => void handleDownloadInvoiceFile(existingInvoice, "pdf")}
                                disabled={downloadingInvoiceFormat === "pdf"}
                                title="Descargar PDF"
                                className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-100 transition-colors hover:bg-emerald-500/20 disabled:cursor-wait disabled:opacity-60"
                              >
                                <DownloadIcon className="h-4 w-4" />
                                {downloadingInvoiceFormat === "pdf" ? "Descargando..." : "PDF"}
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleDownloadInvoiceFile(existingInvoice, "xml")}
                                disabled={downloadingInvoiceFormat === "xml"}
                                title="Descargar XML"
                                className="inline-flex items-center gap-2 rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs font-medium text-cyan-100 transition-colors hover:bg-cyan-500/20 disabled:cursor-wait disabled:opacity-60"
                              >
                                <DownloadIcon className="h-4 w-4" />
                                {downloadingInvoiceFormat === "xml" ? "Descargando..." : "XML"}
                              </button>
                            </div>
                          ) : null}
                        </div>
                      ) : null}

                      {invoicePreview.bloqueos.length || invoicePreview.faltantes.length ? (
                        <div className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-100">
                          <p className="font-semibold">
                            Pendientes antes de timbrar
                          </p>
                          <ul className="mt-2 space-y-1 text-xs text-amber-100/90">
                            {[...invoicePreview.bloqueos, ...invoicePreview.faltantes].map(
                              (item) => (
                                <li key={item}>- {item}</li>
                              )
                            )}
                          </ul>
                        </div>
                      ) : null}
                    </div>

                    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
                      <div className="flex items-center gap-2">
                        <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
                          Datos fiscales del receptor
                        </p>
                        <FinanceInfoButton info={cxcInfo.factura} onOpen={setInfoModal} />
                      </div>
                      <div className="mt-4 flex flex-wrap items-center gap-3">
                        <button
                          type="button"
                          onClick={() => csfInputRef.current?.click()}
                          disabled={isParsingCsf}
                          className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-100 transition-colors hover:bg-cyan-500/20 disabled:cursor-wait disabled:opacity-60"
                        >
                          {isParsingCsf ? "Leyendo constancia..." : "Cargar CSF"}
                        </button>
                        {invoiceFiscalForm.archivo_csf_url ? (
                          <a
                            href={invoiceFiscalForm.archivo_csf_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-cyan-300 underline underline-offset-2"
                          >
                            Abrir constancia vinculada
                          </a>
                        ) : (
                          <span className="text-xs text-zinc-500">
                            PDF de Constancia de Situacion Fiscal.
                          </span>
                        )}
                        <input
                          ref={csfInputRef}
                          type="file"
                          accept="application/pdf"
                          onChange={handleParseInvoiceCsf}
                          className="hidden"
                        />
                      </div>

                      <div className="mt-4 grid gap-3 md:grid-cols-2">
                        <label className="space-y-1">
                          <FinanceFieldLabel
                            required
                            info={cxcInfo.razonSocial}
                            onInfo={setInfoModal}
                          >
                            Nombre / razon social
                          </FinanceFieldLabel>
                          <input
                            type="text"
                            value={invoiceFiscalForm.razon_social}
                            onChange={(event) =>
                              setInvoiceFiscalForm((prev) => ({
                                ...prev,
                                razon_social: safeText(event.target.value, CXC_NAME_MAX),
                              }))
                            }
                            minLength={3}
                            maxLength={CXC_NAME_MAX}
                            disabled={invoiceIsGenericPublic}
                            className="w-full rounded-xl border border-zinc-800 bg-black px-3 py-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                          />
                          {fiscalErrors.razon_social ? (
                            <span className="block text-xs text-rose-200">{fiscalErrors.razon_social}</span>
                          ) : null}
                        </label>
                        <label className="space-y-1">
                          <FinanceFieldLabel required info={cxcInfo.rfc} onInfo={setInfoModal}>
                            RFC
                          </FinanceFieldLabel>
                          <input
                            type="text"
                            value={invoiceFiscalForm.rfc}
                            onChange={(event) =>
                              handleInvoiceFiscalRfcChange(event.target.value)
                            }
                            maxLength={CXC_RFC_MAX}
                            className="w-full rounded-xl border border-zinc-800 bg-black px-3 py-2.5 text-sm uppercase text-white outline-none focus:ring-1 focus:ring-cyan-500"
                          />
                          {fiscalErrors.rfc ? (
                            <span className="block text-xs text-rose-200">{fiscalErrors.rfc}</span>
                          ) : null}
                        </label>
                        <label className="space-y-1">
                          <FinanceFieldLabel required info={cxcInfo.regimen} onInfo={setInfoModal}>
                            Regimen fiscal
                          </FinanceFieldLabel>
                          <select
                            value={invoiceFiscalForm.regimen_fiscal}
                            onChange={(event) =>
                              setInvoiceFiscalForm((prev) => ({
                                ...prev,
                                regimen_fiscal: event.target.value,
                              }))
                            }
                            disabled={invoiceIsGenericPublic}
                            className="w-full rounded-xl border border-zinc-800 bg-black px-3 py-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                          >
                            <option value="">
                              Selecciona regimen fiscal
                            </option>
                            {invoiceFiscalRegimeOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                          {fiscalErrors.regimen_fiscal ? (
                            <span className="block text-xs text-rose-200">{fiscalErrors.regimen_fiscal}</span>
                          ) : null}
                        </label>
                        {invoiceIsGenericPublic ? (
                          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2.5 text-sm text-emerald-100">
                            <span className="block text-xs uppercase tracking-[0.18em] text-emerald-300/80">
                              Codigo postal receptor
                            </span>
                            <p className="mt-1 text-xs leading-relaxed text-emerald-100/80">
                              No se captura para RFC generico; el CFDI usa el CP
                              del lugar de expedicion del emisor.
                            </p>
                          </div>
                        ) : (
                          <label className="space-y-1">
                            <FinanceFieldLabel
                              required
                              info={cxcInfo.codigoPostal}
                              onInfo={setInfoModal}
                            >
                              Codigo postal
                            </FinanceFieldLabel>
                            <input
                              type="text"
                              inputMode="numeric"
                              maxLength={CXC_CP_LENGTH}
                              value={invoiceFiscalForm.codigo_postal}
                              onChange={(event) =>
                                setInvoiceFiscalForm((prev) => ({
                                  ...prev,
                                  codigo_postal: cleanPostalCode(event.target.value),
                                }))
                              }
                              className="w-full rounded-xl border border-zinc-800 bg-black px-3 py-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                            />
                            {fiscalErrors.codigo_postal ? (
                              <span className="block text-xs text-rose-200">{fiscalErrors.codigo_postal}</span>
                            ) : null}
                          </label>
                        )}
                      </div>

                      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                        <label className="flex items-center gap-2 text-sm text-zinc-300">
                          <input
                            type="checkbox"
                            checked={invoiceFiscalForm.es_persona_moral}
                            onChange={(event) =>
                              handleInvoiceFiscalPersonTypeChange(event.target.checked)
                            }
                            disabled={invoiceIsGenericPublic}
                            className="h-4 w-4 rounded border-zinc-700 bg-black"
                          />
                          Persona moral
                        </label>
                        <button
                          type="button"
                          onClick={() => void handleSaveInvoiceFiscal()}
                          disabled={isSavingFiscal}
                          className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-100 transition-colors hover:bg-cyan-500/20 disabled:cursor-wait disabled:opacity-60"
                        >
                          {isSavingFiscal ? "Guardando..." : "Guardar datos fiscales"}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
                    <div className="flex flex-col gap-2 border-b border-zinc-800 pb-4 md:flex-row md:items-start md:justify-between">
                      <div>
                        <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
                          Borrador CFDI
                        </p>
                        <h3 className="mt-2 text-xl font-semibold text-white">
                          Resumen antes de timbrar
                        </h3>
                      </div>
                      {invoicePreview.draft ? (
                        <div className="text-sm text-zinc-400 md:text-right">
                          <p>
                            {invoicePreview.draft.proveedor} | {invoicePreview.draft.modo}
                          </p>
                          <p className="text-xs text-zinc-500">
                            Folio {invoicePreview.draft.serie}
                            {invoicePreview.draft.folio}
                          </p>
                          {invoicePreview.draft.global_information ? (
                            <p className="text-xs text-emerald-300">
                              Global mensual{" "}
                              {invoicePreview.draft.global_information.months}/
                              {invoicePreview.draft.global_information.year}
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                    </div>

                    {invoicePreview.draft ? (
                      <div className="mt-4 grid gap-4 lg:grid-cols-[0.9fr_1.2fr]">
                        <div className="grid gap-3 text-sm">
                          <div className="rounded-2xl border border-zinc-800 bg-black p-3">
                            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                              Emisor
                            </p>
                            <p className="mt-2 font-semibold text-white">
                              {invoicePreview.draft.emisor.razon_social}
                            </p>
                            <p className="text-xs text-zinc-400">
                              {invoicePreview.draft.emisor.rfc} | Regimen{" "}
                              {invoicePreview.draft.emisor.regimen_fiscal} | CP{" "}
                              {invoicePreview.draft.emisor.codigo_postal}
                            </p>
                          </div>
                          <div className="rounded-2xl border border-zinc-800 bg-black p-3">
                            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                              Receptor
                            </p>
                            <p className="mt-2 font-semibold text-white">
                              {invoicePreview.draft.receptor.razon_social}
                            </p>
                            <p className="text-xs text-zinc-400">
                              {invoicePreview.draft.receptor.rfc} | Regimen{" "}
                              {invoicePreview.draft.receptor.regimen_fiscal} | CP{" "}
                              {invoicePreview.draft.receptor.codigo_postal}
                            </p>
                          </div>
                        </div>

                        <div className="overflow-hidden rounded-2xl border border-zinc-800">
                          <table className="min-w-full text-left text-sm">
                            <thead className="bg-zinc-900/80 text-xs uppercase tracking-[0.18em] text-zinc-500">
                              <tr>
                                <th className="px-3 py-3">Concepto</th>
                                <th className="px-3 py-3 text-right">Subtotal</th>
                                <th className="px-3 py-3 text-right">IVA</th>
                                <th className="px-3 py-3 text-right">Total</th>
                              </tr>
                            </thead>
                            <tbody>
                              {invoicePreview.draft.partidas.map((line, index) => (
                                <tr key={`${line.descripcion}-${index}`} className="border-t border-zinc-800">
                                  <td className="px-3 py-3 text-zinc-200">
                                    <p className="font-medium text-white">{line.descripcion}</p>
                                    <p className="mt-1 text-xs text-zinc-500">
                                      SAT {line.clave_producto_servicio} | Unidad{" "}
                                      {line.clave_unidad}
                                    </p>
                                  </td>
                                  <td className="px-3 py-3 text-right text-zinc-300">
                                    {formatCurrency(line.subtotal)}
                                  </td>
                                  <td className="px-3 py-3 text-right text-zinc-300">
                                    {formatCurrency(line.impuestos)}
                                  </td>
                                  <td className="px-3 py-3 text-right font-semibold text-white">
                                    {formatCurrency(line.total)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot className="border-t border-zinc-800 bg-black">
                              <tr>
                                <td className="px-3 py-3 text-right text-zinc-400" colSpan={3}>
                                  Total CFDI
                                </td>
                                <td className="px-3 py-3 text-right text-lg font-bold text-white">
                                  {formatCurrency(invoicePreview.draft.total)}
                                </td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-4 rounded-2xl border border-zinc-800 bg-black p-4 text-sm text-zinc-400">
                        Guarda los datos fiscales pendientes para construir el borrador.
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 py-12 text-center text-sm text-zinc-500">
                  No se pudo cargar la informacion de facturacion.
                </div>
              )}
            </div>

            <div className="flex flex-col gap-3 border-t border-zinc-800 px-6 py-5 md:flex-row md:items-center md:justify-end">
              <button
                type="button"
                onClick={handleCloseInvoiceModal}
                className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
              >
                Cerrar
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmEmitInvoice()}
                disabled={
                  !invoicePreview?.puede_timbrar ||
                  isSavingFiscal ||
                  isParsingCsf ||
                  invoicingId === selectedInvoiceCuentaId
                }
                className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm font-medium text-emerald-100 transition-colors hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {invoicePreview?.ya_timbrada
                  ? "CFDI timbrado"
                  : invoicingId === selectedInvoiceCuentaId
                    ? "Timbrando..."
                    : "Timbrar CFDI"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {groupDetailRow ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/75 px-4 py-6 backdrop-blur-sm">
          <div className="w-full max-w-5xl rounded-3xl border border-zinc-800 bg-[#07080d] shadow-2xl">
            <div className="flex flex-col gap-3 border-b border-zinc-800 px-6 py-5 md:flex-row md:items-start md:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.28em] text-cyan-300">
                  Historico por espacio
                </p>
                <h2 className="mt-2 text-2xl font-bold text-white">
                  {groupDetailRow.espacio_codigo || "Sin espacio"}
                </h2>
                <p className="mt-1 text-sm text-zinc-400">
                  {groupDetailRow.entidad_nombre} | {groupDetailRow.cuentas_count || 0}{" "}
                  cuentas por cobrar | Saldo {formatCurrency(groupDetailRow.monto_base)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setGroupDetailRow(null)}
                className="self-start rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
              >
                Cerrar
              </button>
            </div>

            <div className="px-6 py-5">
              <div className="grid gap-3 md:grid-cols-4">
                <MiniMetricCard
                  title="Cargos"
                  value={formatCurrency(groupDetailRow.monto_original)}
                  helper={`${groupDetailRow.cuentas_count || 0} cuentas`}
                  tone="blue"
                />
                <MiniMetricCard
                  title="Cobrado"
                  value={formatCurrency(groupDetailRow.monto_pagado)}
                  helper="Aplicado"
                  tone="emerald"
                />
                <MiniMetricCard
                  title="Saldo"
                  value={formatCurrency(groupDetailRow.monto_base)}
                  helper="Pendiente"
                  tone="red"
                />
                <MiniMetricCard
                  title="Recargos"
                  value={formatCurrency(groupDetailRow.interes_monto)}
                  helper="Por vencimiento"
                  tone="amber"
                />
              </div>

              <div className="mt-5 overflow-x-auto">
                <table className="min-w-full border-separate border-spacing-y-2 text-left text-sm">
                  <thead>
                    <tr className="text-xs uppercase tracking-wide text-zinc-500">
                      <th className="px-3 py-2">Cliente</th>
                      <th className="px-3 py-2">Periodo</th>
                      <th className="px-3 py-2">Concepto</th>
                      <th className="px-3 py-2">Saldo</th>
                      <th className="px-3 py-2">Estado</th>
                      <th className="px-3 py-2">Accion</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupDetailAccounts.map((account) => (
                      <tr
                        key={account.id}
                        className={`rounded-2xl ${cxcRowClass(account.categoria_tablero)}`}
                      >
                        <td className="rounded-l-2xl px-3 py-3 align-top">
                          <p className="font-semibold text-white">{account.cliente_nombre}</p>
                          <p className="mt-1 text-xs text-zinc-500">
                            {account.cliente_identificador || "Sin identificador"}
                          </p>
                          <p className="mt-1 text-xs text-zinc-500">
                            Ref. {account.referencia_unica || "Sin referencia"}
                          </p>
                          {account.referencia_unica ? (
                            <button
                              type="button"
                              onClick={() => void handleCopyReference(account.referencia_unica)}
                              className="mt-2 rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-2 py-1 text-xs font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20"
                            >
                              Copiar ref.
                            </button>
                          ) : null}
                        </td>
                        <td className="px-3 py-3 align-top text-zinc-300">
                          <p>{formatDate(account.fecha_periodo_inicio)}</p>
                          <p className="mt-1 text-xs text-zinc-500">
                            al {formatDate(account.fecha_periodo_fin)}
                          </p>
                          <p className="mt-1 text-xs text-zinc-500">
                            vence {formatDate(account.fecha_vencimiento)}
                          </p>
                          <p className="mt-1 text-xs text-zinc-400">
                            {cxcDueStatusText(account, data?.fecha_referencia)}
                          </p>
                        </td>
                        <td className="px-3 py-3 align-top">
                          <p className="text-zinc-200">{account.concepto}</p>
                          <p className="mt-1 text-xs text-zinc-500">
                            {account.origen} | {account.periodicidad}
                          </p>
                        </td>
                        <td className="px-3 py-3 align-top">
                          <p className="font-semibold text-white">
                            {formatCurrency(account.total_a_pagar)}
                          </p>
                          <p className="mt-1 text-xs text-cyan-300">
                            Pagado {formatCurrency(account.monto_pagado)}
                          </p>
                        </td>
                        <td className="px-3 py-3 align-top">
                          <span
                            className={`rounded-full border px-2.5 py-1 text-xs font-medium ${badgeClass(
                              account.categoria_tablero
                            )}`}
                          >
                            {cxcCategoryLabel(account.categoria_tablero)}
                          </span>
                          {account.factura ? (
                            <p className="mt-2 text-xs text-emerald-300">
                              Factura {invoiceFolio(account.factura) || account.factura.estatus}
                            </p>
                          ) : null}
                        </td>
                        <td className="rounded-r-2xl px-3 py-3 align-top">
                          <button
                            type="button"
                            onClick={() => {
                              setGroupDetailRow(null);
                              void handleOpenInvoiceModal(account.id);
                            }}
                            title={account.factura?.estatus === "TIMBRADA" ? "Ver factura" : "Facturar"}
                            aria-label={
                              account.factura?.estatus === "TIMBRADA"
                                ? "Ver factura"
                                : "Facturar"
                            }
                            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-200 transition-colors hover:bg-emerald-500/20"
                          >
                            <ReceiptIcon className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {agingModalOpen ? (
        <AgingBalanceModal
          title="Composicion del saldo CxC"
          subtitle="Saldo abierto agrupado por dias desde su vencimiento, usando los filtros activos."
          buckets={metricas?.antiguedad_saldo || []}
          showRecargos
          onClose={() => setAgingModalOpen(false)}
        />
      ) : null}

      <CxcClienteDetalleModal
        isOpen={isDetailOpen}
        isLoading={isDetailLoading}
        detail={detail}
        error={detailError}
        onClose={() => {
          setIsDetailOpen(false);
          setDetail(null);
          setDetailError("");
        }}
      />
    </>
  );
}
