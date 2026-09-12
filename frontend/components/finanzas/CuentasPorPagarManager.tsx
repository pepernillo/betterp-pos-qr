"use client";

import { buildApiUrl } from '@/lib/api';

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";

import {
  FinanceFieldLabel,
  FinanceInfoButton,
  FinanceInfoModal,
  type FinanceInfoContent,
} from "@/components/finanzas/FinanceInfo";

const FINANZAS_API_BASE = buildApiUrl("/finanzas");

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

type CxpStatusFilter =
  | ""
  | "PENDIENTE"
  | "PARCIAL"
  | "POR_CONCILIAR"
  | "VENCIDO"
  | "PAGADO";

interface OptionItem {
  id: number;
  nombre: string;
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

interface CxpMetrics {
  registros: number;
  proyectado: number;
  pagado: number;
  pendiente: number;
  vencido: number;
  por_conciliar: number;
  antiguedad_saldo?: AgingBucket[];
}

interface CxpRow {
  id: number;
  entidad_id: number;
  entidad_nombre: string;
  programacion_id?: number | null;
  proveedor_nombre: string;
  banco_pago?: string | null;
  cuenta_pago?: string | null;
  clabe_pago?: string | null;
  prioridad: string;
  categoria: string;
  naturaleza: string;
  concepto: string;
  periodicidad: string;
  fecha_periodo_inicio?: string | null;
  fecha_periodo_fin?: string | null;
  fecha_vencimiento: string;
  monto_proyectado: number;
  monto_real: number;
  monto_total: number;
  monto_pagado: number;
  saldo_pendiente: number;
  dias_gracia: number;
  genera_recargo: boolean;
  estatus: string;
  tipo_registro: string;
  referencia_unica?: string | null;
}

interface BatchResult {
  mensaje: string;
  formato: string;
  hoja: string;
  periodo_inicio: string;
  periodo_fin: string;
  creados: number;
  existentes: number;
  omitidos: number;
  errores: string[];
}

interface BatchAccepted {
  accepted: boolean;
  job_id: number;
  status: string;
  mensaje: string;
}

interface BackgroundJobStatus {
  id: number;
  status: "PENDING" | "RUNNING" | "SUCCESS" | "ERROR" | "CANCELLED";
  result?: BatchResult;
  error?: string | null;
}

interface CxpDashboardResponse {
  fecha_referencia: string;
  metricas: CxpMetrics;
  entidades: OptionItem[];
  categorias: string[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
  items: CxpRow[];
}

interface CxpFilters {
  entidadId: string;
  categoria: string;
  status: CxpStatusFilter;
  fechaDesde: string;
  fechaHasta: string;
  busqueda: string;
}

const DEFAULT_FILTERS: CxpFilters = {
  entidadId: "",
  categoria: "",
  status: "",
  fechaDesde: "",
  fechaHasta: "",
  busqueda: "",
};

const CATEGORY_OPTIONS = [
  "RENTA",
  "AGUA",
  "LUZ",
  "GAS",
  "INTERNET",
  "BASURA",
  "LIMPIEZA",
  "MANTENIMIENTO",
  "REPARACIONES",
  "SEGURIDAD",
  "NOMINA",
  "IMPUESTOS",
  "CREDITO",
  "PUBLICIDAD",
  "CONTABILIDAD",
  "OTROS",
];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function monthIso() {
  return new Date().toISOString().slice(0, 7);
}

const DEFAULT_MANUAL_FORM = {
  entidadId: "",
  concepto: "",
  proveedorNombre: "",
  categoria: "OTROS",
  naturaleza: "OPERATIVO",
  bancoPago: "",
  cuentaPago: "",
  clabePago: "",
  prioridad: "MEDIA",
  fechaEmision: todayIso(),
  fechaVencimiento: todayIso(),
  monto: "",
  observaciones: "",
  generaRecargo: false,
};

const TEXT_MIN = 2;
const TEXT_MAX = 120;
const SEARCH_MAX = 120;
const MONEY_MAX = 1000000000;
const ACCOUNT_MAX = 40;
const OBSERVATIONS_MAX = 500;

const cxpInfo: Record<string, FinanceInfoContent> = {
  modulo: {
    eyebrow: "Cuentas",
    title: "Cuentas por pagar",
    summary:
      "Centraliza compromisos operativos y administrativos por entidad para que el equipo vea que se debe, cuando vence y que falta conciliar.",
    details: [
      "La alta rapida crea una cuenta puntual, ideal para gastos no recurrentes o ajustes manuales.",
      "La carga batch sirve para subir muchos compromisos del mismo periodo sin capturarlos uno por uno.",
      "Los filtros solo acotan la lectura; no modifican registros ni saldos.",
    ],
  },
  manual: {
    eyebrow: "Captura",
    title: "Alta rapida de CxP",
    summary:
      "Formulario para registrar un gasto puntual con entidad, proveedor, concepto, monto y vencimiento.",
    details: [
      "Entidad, concepto, beneficiario, monto y vencimiento son obligatorios.",
      "Monto acepta dinero positivo con hasta 2 decimales y se limita para evitar capturas accidentales enormes.",
      "Usa prioridad y categoria para ordenar pagos urgentes y facilitar reportes.",
    ],
  },
  entidad: {
    eyebrow: "Campo",
    title: "Entidad",
    summary:
      "Unidad de negocio a la que pertenece el compromiso por pagar.",
    details: [
      "El gasto se acumula en reportes y dashboard de esa entidad.",
      "Selecciona la entidad real que recibio el servicio o genero la obligacion.",
      "No acepta texto libre; solo entidades existentes.",
    ],
  },
  concepto: {
    eyebrow: "Campo",
    title: "Concepto",
    summary:
      "Descripcion corta del gasto o servicio que se va a pagar.",
    details: [
      "Debe tener entre 2 y 120 caracteres.",
      "Evita comentarios largos; los detalles operativos van en observaciones o en el soporte externo.",
      "Ejemplos: Luz edificio A, Limpieza mayo, Mantenimiento elevador.",
    ],
  },
  proveedor: {
    eyebrow: "Campo",
    title: "Beneficiario",
    summary:
      "Persona, proveedor o institucion a quien se le debe pagar.",
    details: [
      "Debe tener entre 2 y 120 caracteres.",
      "Usa nombres consistentes para que filtros y conciliacion funcionen mejor.",
      "Ejemplos: CFE, TELMEX, Proveedor de limpieza, Administrador externo.",
    ],
  },
  monto: {
    eyebrow: "Campo",
    title: "Monto",
    summary:
      "Importe proyectado del compromiso por pagar.",
    details: [
      "Acepta solo dinero positivo, hasta 2 decimales.",
      "No puede quedar en cero para crear una cuenta manual.",
      "El limite operativo es $1,000,000,000.",
    ],
  },
  vencimiento: {
    eyebrow: "Campo",
    title: "Vencimiento",
    summary:
      "Fecha limite esperada para pagar el compromiso.",
    details: [
      "Acepta solo fecha de calendario.",
      "Se usa para clasificar pendiente, vencido y antiguedad de saldo.",
      "Si el proveedor da una fecha oficial, usa esa fecha.",
    ],
  },
  prioridad: {
    eyebrow: "Campo",
    title: "Prioridad",
    summary:
      "Indica que tan urgente o critico es atender este pago.",
    details: [
      "Critica y Alta ayudan a identificar servicios que pueden bloquear operacion.",
      "Media funciona como default para gastos ordinarios.",
      "Baja queda para pagos no urgentes o de bajo impacto operativo.",
    ],
  },
  categoria: {
    eyebrow: "Campo",
    title: "Categoria",
    summary:
      "Clasificacion contable/operativa para agrupar gastos.",
    details: [
      "Permite filtrar por luz, agua, mantenimiento, nomina, publicidad y otros rubros.",
      "Mantener categorias limpias mejora dashboard, exportaciones y conciliacion.",
      "Si no sabes donde ubicarlo, usa OTROS y ajusta despues.",
    ],
  },
  batch: {
    eyebrow: "Carga masiva",
    title: "Carga batch CxP",
    summary:
      "Sube compromisos por pagar desde plantilla CSV o Excel para un periodo definido.",
    details: [
      "Periodo ubica todos los registros en el mes operativo correcto.",
      "Vencimiento default se usa cuando el archivo no trae fecha por fila.",
      "El archivo debe respetar columnas y tipos; los errores se reportan al final de la importacion.",
    ],
  },
  filtros: {
    eyebrow: "Filtro",
    title: "Filtros de CxP",
    summary:
      "Acotan la cartera por entidad, categoria, estado, fechas o texto de busqueda.",
    details: [
      "Fecha desde y hasta deben ser fechas validas; desde no puede ser posterior a hasta.",
      "Busqueda acepta hasta 120 caracteres y se usa para proveedor o concepto.",
      "Los filtros no cambian datos: solo modifican la lectura de la tabla.",
    ],
  },
};

function safeText(value: string, maxLength = TEXT_MAX): string {
  return value.replace(/[<>]/g, "").slice(0, maxLength);
}

function cleanMoneyInput(value: string): string {
  const normalized = value.replace(",", ".").replace(/[^\d.]/g, "");
  const [wholeRaw, ...decimalParts] = normalized.split(".");
  const whole = wholeRaw.replace(/^0+(?=\d)/, "").slice(0, 10);
  const decimals = decimalParts.join("").slice(0, 2);
  const candidate = decimalParts.length > 0 ? `${whole || "0"}.${decimals}` : whole;
  if (!candidate) return "";
  const parsed = Number(candidate);
  return Number.isFinite(parsed) && parsed > MONEY_MAX ? String(MONEY_MAX) : candidate;
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return !Number.isNaN(new Date(`${value}T00:00:00`).getTime());
}

function isValidMonth(value: string): boolean {
  return /^\d{4}-\d{2}$/.test(value);
}

function parseMoney(value: string): number {
  const parsed = Number(cleanMoneyInput(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function validateManualForm(form: typeof DEFAULT_MANUAL_FORM): Record<string, string> {
  const errors: Record<string, string> = {};
  const amount = parseMoney(form.monto);
  if (!form.entidadId) errors.entidadId = "Selecciona una entidad.";
  if (form.concepto.trim().length < TEXT_MIN) {
    errors.concepto = "Concepto debe tener al menos 2 caracteres.";
  }
  if (form.proveedorNombre.trim().length < TEXT_MIN) {
    errors.proveedorNombre = "Beneficiario debe tener al menos 2 caracteres.";
  }
  if (amount <= 0 || amount > MONEY_MAX) {
    errors.monto = "Monto debe ser mayor a cero y menor a $1,000,000,000.";
  }
  if (!isValidDate(form.fechaVencimiento)) {
    errors.fechaVencimiento = "Vencimiento debe ser una fecha valida.";
  }
  if (form.cuentaPago.length > ACCOUNT_MAX) {
    errors.cuentaPago = `Cuenta no debe superar ${ACCOUNT_MAX} caracteres.`;
  }
  if (form.observaciones.length > OBSERVATIONS_MAX) {
    errors.observaciones = `Observaciones maximo ${OBSERVATIONS_MAX} caracteres.`;
  }
  return errors;
}

function validateFilters(filters: CxpFilters): string | null {
  if (filters.busqueda.length > SEARCH_MAX) return `Busqueda maximo ${SEARCH_MAX} caracteres.`;
  if (filters.fechaDesde && !isValidDate(filters.fechaDesde)) return "Fecha desde no es valida.";
  if (filters.fechaHasta && !isValidDate(filters.fechaHasta)) return "Fecha hasta no es valida.";
  if (filters.fechaDesde && filters.fechaHasta && filters.fechaDesde > filters.fechaHasta) {
    return "Fecha desde no puede ser posterior a fecha hasta.";
  }
  return null;
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

function getErrorMessage(body: unknown, fallback: string) {
  if (typeof body === "string" && body.trim()) {
    return body.trim();
  }
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail?: unknown }).detail;
    if (typeof detail === "string" && detail.trim()) {
      return detail;
    }
  }
  return fallback;
}

async function readResponseBody(response: Response) {
  const text = await response.text();
  if (!text.trim()) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function badgeClass(status: string) {
  switch (status) {
    case "PAGADO":
      return "border-emerald-500/20 bg-emerald-500/10 text-emerald-300";
    case "VENCIDO":
      return "border-red-500/20 bg-red-500/10 text-red-300";
    case "PARCIAL":
      return "border-amber-500/20 bg-amber-500/10 text-amber-200";
    case "POR_CONCILIAR":
      return "border-violet-500/20 bg-violet-500/10 text-violet-200";
    default:
      return "border-blue-500/20 bg-blue-500/10 text-blue-300";
  }
}

function priorityClass(priority: string) {
  switch (priority) {
    case "CRITICA":
      return "border-red-500/30 bg-red-500/15 text-red-200";
    case "ALTA":
      return "border-amber-500/30 bg-amber-500/15 text-amber-200";
    case "MEDIA":
      return "border-cyan-500/20 bg-cyan-500/10 text-cyan-200";
    default:
      return "border-zinc-700 bg-zinc-900 text-zinc-400";
  }
}

function statusLabel(status: CxpStatusFilter | string) {
  switch (status) {
    case "PENDIENTE":
      return "Pendiente";
    case "PARCIAL":
      return "Parcial";
    case "POR_CONCILIAR":
      return "Por conciliar";
    case "VENCIDO":
      return "Vencido";
    case "PAGADO":
      return "Pagado";
    default:
      return "Todas";
  }
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

function MetricCard({
  title,
  value,
  helper,
  tone = "default",
  onInspect,
}: {
  title: string;
  value: string;
  helper?: string;
  tone?: "default" | "emerald" | "blue" | "amber" | "red" | "violet";
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
            : tone === "violet"
              ? "border-violet-500/20 bg-violet-500/10"
              : "border-zinc-800 bg-zinc-950/80";

  return (
    <div className={`metric-card-compact ${toneClass}`}>
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
  onClose,
}: {
  title: string;
  subtitle: string;
  buckets: AgingBucket[];
  onClose: () => void;
}) {
  const totalSaldo = buckets.reduce((sum, bucket) => sum + bucket.saldo, 0);
  const totalCuentas = buckets.reduce((sum, bucket) => sum + bucket.cuentas, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 px-4 py-6 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-3xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-zinc-800 pb-4">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-cyan-300">
              Antiguedad de saldo
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

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-3">
            <p className="text-xs uppercase tracking-[0.2em] text-red-200/70">Saldo vencido</p>
            <p className="mt-2 text-lg font-semibold text-white">{formatCurrency(totalSaldo)}</p>
          </div>
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
              </tr>
            </thead>
            <tbody>
              {buckets.map((bucket) => (
                <tr key={bucket.key} className="text-zinc-200">
                  <td className="border-b border-zinc-900 px-3 py-3 font-medium text-white">
                    {bucket.label}
                  </td>
                  <td className="border-b border-zinc-900 px-3 py-3">{bucket.cuentas}</td>
                  <td className="border-b border-zinc-900 px-3 py-3 font-semibold text-white">
                    {formatCurrency(bucket.saldo)}
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

export default function CuentasPorPagarManager() {
  const [filters, setFilters] = useState<CxpFilters>(DEFAULT_FILTERS);
  const [draftFilters, setDraftFilters] = useState<CxpFilters>(DEFAULT_FILTERS);
  const [data, setData] = useState<CxpDashboardResponse | null>(null);
  const [manualForm, setManualForm] = useState(DEFAULT_MANUAL_FORM);
  const [batchFile, setBatchFile] = useState<File | null>(null);
  const [batchPeriod, setBatchPeriod] = useState(monthIso());
  const [batchDueDate, setBatchDueDate] = useState(todayIso());
  const [batchFormat, setBatchFormat] = useState("auto");
  const [batchResult, setBatchResult] = useState<BatchResult | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [isCreatingManual, setIsCreatingManual] = useState(false);
  const [isImportingBatch, setIsImportingBatch] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [agingModalOpen, setAgingModalOpen] = useState(false);
  const [infoModal, setInfoModal] = useState<FinanceInfoContent | null>(null);
  const [manualErrors, setManualErrors] = useState<Record<string, string>>({});
  const [filterError, setFilterError] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadData = useCallback(async (activeFilters: CxpFilters, page = 1) => {
    const params = new URLSearchParams();
    if (activeFilters.entidadId) {
      params.set("entidad_id", activeFilters.entidadId);
    }
    if (activeFilters.categoria) {
      params.set("categoria", activeFilters.categoria);
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
    params.set("page", String(page));
    params.set("page_size", "20");

    const url = `${FINANZAS_API_BASE}/cxp/${params.toString() ? `?${params.toString()}` : ""}`;

    try {
      const response = await fetch(url, { cache: "no-store" });
      const body = await readResponseBody(response);
      if (!response.ok) {
        throw new Error(
          getErrorMessage(body, "No se pudo cargar la cartera de cuentas por pagar.")
        );
      }
      setData(body as CxpDashboardResponse);
      setError("");
    } catch (loadError) {
      console.error("Error cargando CxP:", loadError);
      setData(null);
      setError(
        loadError instanceof Error
          ? loadError.message
          : "No se pudo cargar la cartera de cuentas por pagar."
      );
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadData(filters, currentPage);
  }, [filters, currentPage, loadData]);

  const handleApplyFilters = (event: FormEvent) => {
    event.preventDefault();
    const validationError = validateFilters(draftFilters);
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

  const refreshData = () => {
    setIsRefreshing(true);
    void loadData(filters, currentPage);
  };

  const handleCreateManual = async (event: FormEvent) => {
    event.preventDefault();
    const errors = validateManualForm(manualForm);
    setManualErrors(errors);
    const firstError = Object.values(errors)[0];
    if (firstError) {
      setActionError(firstError);
      return;
    }
    setIsCreatingManual(true);
    setActionError("");
    try {
      const response = await fetch(`${FINANZAS_API_BASE}/cxp/manual/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entidad_id: manualForm.entidadId ? Number(manualForm.entidadId) : null,
          proveedor_nombre: manualForm.proveedorNombre.trim(),
          categoria: manualForm.categoria,
          naturaleza: manualForm.naturaleza,
          concepto: manualForm.concepto.trim(),
          banco_pago: manualForm.bancoPago.trim(),
          cuenta_pago: manualForm.cuentaPago.trim(),
          clabe_pago: manualForm.clabePago.trim(),
          prioridad: manualForm.prioridad,
          periodicidad: "UNICO",
          fecha_emision: manualForm.fechaEmision,
          fecha_vencimiento: manualForm.fechaVencimiento,
          monto_proyectado: parseMoney(manualForm.monto),
          monto_real: parseMoney(manualForm.monto),
          genera_recargo: manualForm.generaRecargo,
          observaciones: manualForm.observaciones.trim(),
        }),
      });
      const body = await readResponseBody(response);
      if (!response.ok) {
        throw new Error(getErrorMessage(body, "No se pudo crear el gasto."));
      }
      setManualForm(DEFAULT_MANUAL_FORM);
      setManualErrors({});
      refreshData();
    } catch (createError) {
      console.error("Error creando CxP manual:", createError);
      setActionError(
        createError instanceof Error
          ? createError.message
          : "No se pudo crear el gasto."
      );
    } finally {
      setIsCreatingManual(false);
    }
  };

  const handleDownloadTemplate = async () => {
    setActionError("");
    try {
      const response = await fetch(`${FINANZAS_API_BASE}/cxp/batch/plantilla/`);
      if (!response.ok) {
        throw new Error("No se pudo descargar la plantilla.");
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "plantilla-cuentas-por-pagar.csv";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
    } catch (downloadError) {
      setActionError(
        downloadError instanceof Error
          ? downloadError.message
          : "No se pudo descargar la plantilla."
      );
    }
  };

  const waitForBatchJob = async (jobId: number) => {
    for (let attempt = 0; attempt < 90; attempt += 1) {
      const response = await fetch(buildApiUrl(`/billing/jobs/${jobId}/`), {
        cache: "no-store",
      });
      const body = (await readResponseBody(response)) as
        | BackgroundJobStatus
        | { detail?: string }
        | null;
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
        throw new Error(job.error || "La carga batch de CxP termino con error.");
      }
      await sleep(2000);
    }
    throw new Error("La carga batch sigue en proceso. Revisa salud operativa en unos minutos.");
  };

  const handleImportBatch = async () => {
    if (!batchFile) {
      setActionError("Selecciona un archivo .xlsx, .xlsm o .csv.");
      return;
    }
    if (!isValidMonth(batchPeriod)) {
      setActionError("Periodo debe ser un mes valido.");
      return;
    }
    if (!isValidDate(batchDueDate)) {
      setActionError("Vencimiento default debe ser una fecha valida.");
      return;
    }
    setIsImportingBatch(true);
    setActionError("");
    setBatchResult(null);
    try {
      const formData = new FormData();
      formData.append("file", batchFile);
      formData.append("periodo", batchPeriod);
      formData.append("fecha_vencimiento", batchDueDate);
      formData.append("formato", batchFormat);
      const response = await fetch(`${FINANZAS_API_BASE}/cxp/batch/importar/?async_job=true`, {
        method: "POST",
        body: formData,
      });
      const body = (await readResponseBody(response)) as
        | BatchResult
        | BatchAccepted
        | { detail?: string }
        | null;
      if (!response.ok) {
        throw new Error(getErrorMessage(body, "No se pudo importar el archivo."));
      }
      const result =
        body && "accepted" in body && body.accepted
          ? await waitForBatchJob(body.job_id)
          : (body as BatchResult);
      setBatchResult(result);
      setBatchFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      refreshData();
    } catch (importError) {
      console.error("Error importando CxP batch:", importError);
      setActionError(
        importError instanceof Error
          ? importError.message
          : "No se pudo importar el archivo."
      );
    } finally {
      setIsImportingBatch(false);
    }
  };

  const rows = data?.items || [];
  const metricas = data?.metricas;

  return (
    <div className="space-y-4">
      <FinanceInfoModal info={infoModal} onClose={() => setInfoModal(null)} />
      {isImportingBatch ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-3xl border border-cyan-500/20 bg-zinc-950 p-6 text-center shadow-2xl shadow-cyan-950/40">
            <div className="mx-auto h-12 w-12 animate-spin rounded-full border-2 border-cyan-400/20 border-t-cyan-300" />
            <p className="mt-4 text-lg font-semibold text-white">
              Procesando carga batch
            </p>
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">
              Estamos validando el archivo y guardando las cuentas por pagar
              correctas. Mantente en esta pantalla hasta que el proceso termine.
            </p>
          </div>
        </div>
      ) : null}
      <section className="page-section">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="page-title-compact">Cuentas por pagar</h1>
              <FinanceInfoButton info={cxpInfo.modulo} onOpen={setInfoModal} />
            </div>
            <p className="section-copy-compact max-w-3xl">
              Controla compromisos operativos y administrativos por entidad con
              vencimientos, saldos y avance de pago.
            </p>
          </div>
          <div className="page-section-tight text-sm text-zinc-400">
            Fecha de referencia:{" "}
            <span className="font-semibold text-white">
              {data ? formatDate(data.fecha_referencia) : "Cargando..."}
            </span>
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <form onSubmit={handleCreateManual} className="page-section space-y-4">
          <div className="flex flex-col gap-2 border-b border-zinc-800 pb-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="section-title-compact">Alta rapida</h2>
                <FinanceInfoButton info={cxpInfo.manual} onOpen={setInfoModal} />
              </div>
              <p className="section-copy-compact">
                Captura un gasto puntual sin abrir pantallas adicionales.
              </p>
            </div>
            <button
              type="submit"
              disabled={isCreatingManual}
              className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:opacity-50"
            >
              {isCreatingManual ? "Guardando..." : "Guardar gasto"}
            </button>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-sm font-medium text-zinc-400">
              <FinanceFieldLabel
                required
                info={cxpInfo.entidad}
                onInfo={setInfoModal}
              >
                Entidad
              </FinanceFieldLabel>
              <select
                required
                value={manualForm.entidadId}
                onChange={(event) =>
                  setManualForm({ ...manualForm, entidadId: event.target.value })
                }
                className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-zinc-200 outline-none focus:ring-1 focus:ring-cyan-500"
              >
                <option value="">Seleccionar</option>
                {(data?.entidades || []).map((entity) => (
                  <option key={entity.id} value={entity.id}>
                    {entity.nombre}
                  </option>
                ))}
              </select>
              {manualErrors.entidadId ? (
                <span className="mt-1 block text-xs text-rose-200">{manualErrors.entidadId}</span>
              ) : null}
            </label>
            <label className="text-sm font-medium text-zinc-400">
              <FinanceFieldLabel
                required
                info={cxpInfo.concepto}
                onInfo={setInfoModal}
              >
                Concepto
              </FinanceFieldLabel>
              <input
                required
                value={manualForm.concepto}
                onChange={(event) =>
                  setManualForm({ ...manualForm, concepto: safeText(event.target.value) })
                }
                minLength={TEXT_MIN}
                maxLength={TEXT_MAX}
                className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                placeholder="LUZ, RENTA, LIMPIEZA..."
              />
              {manualErrors.concepto ? (
                <span className="mt-1 block text-xs text-rose-200">{manualErrors.concepto}</span>
              ) : (
                <span className="mt-1 block text-xs text-zinc-500">De 2 a 120 caracteres.</span>
              )}
            </label>
            <label className="text-sm font-medium text-zinc-400">
              <FinanceFieldLabel
                required
                info={cxpInfo.proveedor}
                onInfo={setInfoModal}
              >
                Beneficiario
              </FinanceFieldLabel>
              <input
                required
                value={manualForm.proveedorNombre}
                onChange={(event) =>
                  setManualForm({
                    ...manualForm,
                    proveedorNombre: safeText(event.target.value),
                  })
                }
                minLength={TEXT_MIN}
                maxLength={TEXT_MAX}
                className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                placeholder="CFE, TELMEX, arrendador..."
              />
              {manualErrors.proveedorNombre ? (
                <span className="mt-1 block text-xs text-rose-200">{manualErrors.proveedorNombre}</span>
              ) : (
                <span className="mt-1 block text-xs text-zinc-500">Nombre del proveedor o beneficiario.</span>
              )}
            </label>
            <label className="text-sm font-medium text-zinc-400">
              <FinanceFieldLabel
                required
                info={cxpInfo.monto}
                onInfo={setInfoModal}
              >
                Monto
              </FinanceFieldLabel>
              <input
                required
                type="text"
                inputMode="decimal"
                maxLength={13}
                value={manualForm.monto}
                onChange={(event) =>
                  setManualForm({ ...manualForm, monto: cleanMoneyInput(event.target.value) })
                }
                className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                placeholder="0.00"
              />
              {manualErrors.monto ? (
                <span className="mt-1 block text-xs text-rose-200">{manualErrors.monto}</span>
              ) : (
                <span className="mt-1 block text-xs text-zinc-500">Solo dinero positivo, hasta 2 decimales.</span>
              )}
            </label>
            <label className="text-sm font-medium text-zinc-400">
              <FinanceFieldLabel
                required
                info={cxpInfo.vencimiento}
                onInfo={setInfoModal}
              >
                Vencimiento
              </FinanceFieldLabel>
              <input
                required
                type="date"
                value={manualForm.fechaVencimiento}
                onChange={(event) =>
                  setManualForm({
                    ...manualForm,
                    fechaVencimiento: event.target.value,
                  })
                }
                className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
              />
              {manualErrors.fechaVencimiento ? (
                <span className="mt-1 block text-xs text-rose-200">{manualErrors.fechaVencimiento}</span>
              ) : null}
            </label>
            <label className="text-sm font-medium text-zinc-400">
              <FinanceFieldLabel info={cxpInfo.prioridad} onInfo={setInfoModal}>
                Prioridad
              </FinanceFieldLabel>
              <select
                value={manualForm.prioridad}
                onChange={(event) =>
                  setManualForm({ ...manualForm, prioridad: event.target.value })
                }
                className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-zinc-200 outline-none focus:ring-1 focus:ring-cyan-500"
              >
                <option value="BAJA">Baja</option>
                <option value="MEDIA">Media</option>
                <option value="ALTA">Alta</option>
                <option value="CRITICA">Critica</option>
              </select>
            </label>
            <label className="text-sm font-medium text-zinc-400">
              <FinanceFieldLabel info={cxpInfo.categoria} onInfo={setInfoModal}>
                Categoria
              </FinanceFieldLabel>
              <select
                value={manualForm.categoria}
                onChange={(event) =>
                  setManualForm({ ...manualForm, categoria: event.target.value })
                }
                className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-zinc-200 outline-none focus:ring-1 focus:ring-cyan-500"
              >
                {CATEGORY_OPTIONS.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 pt-6 text-sm font-medium text-zinc-300">
              <input
                type="checkbox"
                checked={manualForm.generaRecargo}
                onChange={(event) =>
                  setManualForm({
                    ...manualForm,
                    generaRecargo: event.target.checked,
                  })
                }
                className="h-4 w-4 rounded border-zinc-700 bg-zinc-950 text-cyan-500"
              />
              Genera recargo o corte critico
            </label>
          </div>
        </form>

        <div className="page-section space-y-4">
          <div className="flex flex-col gap-2 border-b border-zinc-800 pb-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="section-title-compact">Carga batch</h2>
                <FinanceInfoButton info={cxpInfo.batch} onOpen={setInfoModal} />
              </div>
              <p className="section-copy-compact">
                Acepta plantilla normalizada o matriz mensual por entidad.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleDownloadTemplate()}
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
            >
              Plantilla CSV
            </button>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-sm font-medium text-zinc-400">
              <FinanceFieldLabel required info={cxpInfo.batch} onInfo={setInfoModal}>
                Periodo
              </FinanceFieldLabel>
              <input
                type="month"
                value={batchPeriod}
                onChange={(event) => setBatchPeriod(event.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
              />
            </label>
            <label className="text-sm font-medium text-zinc-400">
              <FinanceFieldLabel required info={cxpInfo.vencimiento} onInfo={setInfoModal}>
                Vencimiento default
              </FinanceFieldLabel>
              <input
                type="date"
                value={batchDueDate}
                onChange={(event) => setBatchDueDate(event.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
              />
            </label>
            <label className="text-sm font-medium text-zinc-400">
              <FinanceFieldLabel info={cxpInfo.batch} onInfo={setInfoModal}>
                Formato
              </FinanceFieldLabel>
              <select
                value={batchFormat}
                onChange={(event) => setBatchFormat(event.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-zinc-200 outline-none focus:ring-1 focus:ring-cyan-500"
              >
                <option value="auto">Detectar automatico</option>
                <option value="matriz">Matriz por entidad</option>
                <option value="normalizado">Plantilla normalizada</option>
              </select>
            </label>
            <label className="text-sm font-medium text-zinc-400">
              <FinanceFieldLabel required info={cxpInfo.batch} onInfo={setInfoModal}>
                Archivo
              </FinanceFieldLabel>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xlsm,.csv"
                onChange={(event) => setBatchFile(event.target.files?.[0] || null)}
                className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2 text-sm text-zinc-300 file:mr-3 file:rounded-md file:border-0 file:bg-zinc-800 file:px-3 file:py-1.5 file:text-sm file:text-white"
              />
            </label>
          </div>
          <button
            type="button"
            onClick={() => void handleImportBatch()}
            disabled={!batchFile || isImportingBatch}
            className="w-full rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm font-medium text-emerald-200 transition-colors hover:bg-emerald-500/20 disabled:opacity-50"
          >
            {isImportingBatch ? "Importando..." : "Importar cuentas por pagar"}
          </button>

          {batchResult ? (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-100">
              <p className="font-semibold">
                {batchResult.creados} creados, {batchResult.existentes} existentes,
                {" "}{batchResult.omitidos} omitidos
              </p>
              <p className="mt-1 text-xs text-emerald-100/70">
                Hoja {batchResult.hoja} - formato {batchResult.formato}
              </p>
              {batchResult.errores.length > 0 ? (
                <ul className="mt-2 space-y-1 text-xs text-amber-200">
                  {batchResult.errores.slice(0, 4).map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

      {actionError ? (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300">
          {actionError}
        </div>
      ) : null}

      <form
        onSubmit={handleApplyFilters}
        className="page-section"
      >
        <div className="flex flex-col gap-3 border-b border-zinc-800 pb-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="section-title-compact">Filtros</h2>
              <FinanceInfoButton info={cxpInfo.filtros} onOpen={setInfoModal} />
            </div>
            <p className="section-copy-compact">
              Por default ves toda la cartera. Puedes acotar por entidad,
              categoria, periodo o proveedor.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleResetFilters}
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
            >
              Limpiar
            </button>
            <button
              type="submit"
              className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-500"
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

        <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-6">
          <div>
            <FinanceFieldLabel optional info={cxpInfo.entidad} onInfo={setInfoModal}>
              Entidad
            </FinanceFieldLabel>
            <select
              value={draftFilters.entidadId}
              onChange={(event) =>
                setDraftFilters({ ...draftFilters, entidadId: event.target.value })
              }
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-zinc-200 outline-none focus:ring-1 focus:ring-cyan-500"
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
            <FinanceFieldLabel optional info={cxpInfo.categoria} onInfo={setInfoModal}>
              Categoria
            </FinanceFieldLabel>
            <select
              value={draftFilters.categoria}
              onChange={(event) =>
                setDraftFilters({ ...draftFilters, categoria: event.target.value })
              }
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-zinc-200 outline-none focus:ring-1 focus:ring-cyan-500"
            >
              <option value="">Todas</option>
              {(data?.categorias || []).map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </div>

          <div>
            <FinanceFieldLabel optional info={cxpInfo.filtros} onInfo={setInfoModal}>
              Estado
            </FinanceFieldLabel>
            <select
              value={draftFilters.status}
              onChange={(event) =>
                setDraftFilters({
                  ...draftFilters,
                  status: event.target.value as CxpStatusFilter,
                })
              }
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-zinc-200 outline-none focus:ring-1 focus:ring-cyan-500"
            >
              <option value="">Todas</option>
              <option value="PENDIENTE">Pendiente</option>
              <option value="PARCIAL">Parcial</option>
              <option value="POR_CONCILIAR">Por conciliar</option>
              <option value="VENCIDO">Vencido</option>
              <option value="PAGADO">Pagado</option>
            </select>
          </div>

          <div>
            <FinanceFieldLabel optional info={cxpInfo.filtros} onInfo={setInfoModal}>
              Fecha desde
            </FinanceFieldLabel>
            <input
              type="date"
              value={draftFilters.fechaDesde}
              onChange={(event) =>
                setDraftFilters({ ...draftFilters, fechaDesde: event.target.value })
              }
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
            />
          </div>

          <div>
            <FinanceFieldLabel optional info={cxpInfo.filtros} onInfo={setInfoModal}>
              Fecha hasta
            </FinanceFieldLabel>
            <input
              type="date"
              value={draftFilters.fechaHasta}
              onChange={(event) =>
                setDraftFilters({ ...draftFilters, fechaHasta: event.target.value })
              }
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
            />
          </div>

          <div>
            <FinanceFieldLabel optional info={cxpInfo.filtros} onInfo={setInfoModal}>
              Buscar
            </FinanceFieldLabel>
            <input
              type="text"
              value={draftFilters.busqueda}
              onChange={(event) =>
                setDraftFilters({
                  ...draftFilters,
                  busqueda: safeText(event.target.value, SEARCH_MAX),
                })
              }
              maxLength={SEARCH_MAX}
              placeholder="Proveedor o concepto..."
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-white outline-none placeholder:text-zinc-500 focus:ring-1 focus:ring-cyan-500"
            />
          </div>
        </div>
      </form>

      {isLoading ? (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950 py-16 text-center text-zinc-500">
          Cargando cartera de CxP...
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300">
          {error}
        </div>
      ) : (
        <>
          <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
            <MetricCard
              title="Proyectado"
              value={formatCurrency(metricas?.proyectado || 0)}
              helper={`${metricas?.registros || 0} registros`}
              tone="blue"
            />
            <MetricCard
              title="Pagado"
              value={formatCurrency(metricas?.pagado || 0)}
              tone="emerald"
            />
            <MetricCard
              title="Pendiente"
              value={formatCurrency(metricas?.pendiente || 0)}
              tone="amber"
              onInspect={() => setAgingModalOpen(true)}
            />
            <MetricCard
              title="Por conciliar"
              value={formatCurrency(metricas?.por_conciliar || 0)}
              tone="violet"
            />
            <MetricCard
              title="Vencido"
              value={formatCurrency(metricas?.vencido || 0)}
              tone="red"
              onInspect={() => setAgingModalOpen(true)}
            />
          </section>

          <section className="page-section">
            <div className="flex flex-col gap-2 border-b border-zinc-800 pb-4 md:flex-row md:items-end md:justify-between">
              <div>
                <h2 className="section-title-compact">Gastos detallados</h2>
                <p className="section-copy-compact">
                  Vista global de gastos por entidad, proveedor y periodo.
                </p>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 px-4 py-2 text-sm text-zinc-400">
                Vista activa:{" "}
                <span className="font-semibold text-white">
                  {statusLabel(filters.status)}
                </span>
              </div>
            </div>

            {(data?.total || 0) > 0 ? (
              <div className="mt-4 flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-950/60 px-4 py-3 text-sm text-zinc-400 md:flex-row md:items-center md:justify-between">
                <span>
                  Mostrando {rows.length} de {data?.total || 0} registros
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={(data?.page || 1) <= 1 || isRefreshing}
                    onClick={() => {
                      setIsRefreshing(true);
                      setCurrentPage((page) => Math.max(page - 1, 1));
                    }}
                    className="rounded-lg border border-zinc-700 px-3 py-1.5 font-medium text-zinc-200 transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Anterior
                  </button>
                  <span className="px-2 text-zinc-500">
                    Pagina {data?.page || 1} de {data?.total_pages || 1}
                  </span>
                  <button
                    type="button"
                    disabled={
                      (data?.page || 1) >= (data?.total_pages || 1) || isRefreshing
                    }
                    onClick={() => {
                      setIsRefreshing(true);
                      setCurrentPage((page) => page + 1);
                    }}
                    className="rounded-lg border border-zinc-700 px-3 py-1.5 font-medium text-zinc-200 transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Siguiente
                  </button>
                </div>
              </div>
            ) : null}

            {rows.length === 0 ? (
              <div className="mt-4 rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/20 py-16 text-center text-zinc-500">
                No hay cuentas por pagar con los filtros actuales.
              </div>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full border-separate border-spacing-y-2 text-left text-sm">
                  <thead>
                    <tr className="text-xs uppercase tracking-wide text-zinc-500">
                      <th className="px-3 py-2">Entidad</th>
                      <th className="px-3 py-2">Proveedor</th>
                      <th className="px-3 py-2">Concepto</th>
                      <th className="px-3 py-2">Prioridad</th>
                      <th className="px-3 py-2">Periodo</th>
                      <th className="px-3 py-2">Vence</th>
                      <th className="px-3 py-2">Total</th>
                      <th className="px-3 py-2">Pagado</th>
                      <th className="px-3 py-2">Saldo</th>
                      <th className="px-3 py-2">Referencia</th>
                      <th className="px-3 py-2">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id} className="rounded-2xl bg-zinc-950/80">
                        <td className="rounded-l-2xl px-3 py-3 align-top">
                          <p className="font-semibold text-white">
                            {row.entidad_nombre}
                          </p>
                          <p className="mt-1 text-xs text-zinc-500">
                            {row.categoria} - {row.naturaleza}
                          </p>
                        </td>
                        <td className="px-3 py-3 align-top text-zinc-100">
                          <p>{row.proveedor_nombre}</p>
                          {(row.banco_pago || row.cuenta_pago || row.clabe_pago) && (
                            <p className="mt-1 text-xs text-zinc-500">
                              {[row.banco_pago, row.cuenta_pago || row.clabe_pago]
                                .filter(Boolean)
                                .join(" | ")}
                            </p>
                          )}
                        </td>
                        <td className="px-3 py-3 align-top">
                          <p className="text-zinc-200">{row.concepto}</p>
                          <p className="mt-1 text-xs text-zinc-500">
                            {row.tipo_registro} - {row.periodicidad}
                          </p>
                        </td>
                        <td className="px-3 py-3 align-top">
                          <span
                            className={`rounded-full border px-2.5 py-1 text-xs font-medium ${priorityClass(
                              row.prioridad
                            )}`}
                          >
                            {row.prioridad}
                          </span>
                          {row.genera_recargo ? (
                            <p className="mt-2 text-xs text-red-300">
                              Recargo/corte
                            </p>
                          ) : null}
                        </td>
                        <td className="px-3 py-3 align-top text-zinc-300">
                          <p>{formatDate(row.fecha_periodo_inicio)}</p>
                          <p className="mt-1 text-xs text-zinc-500">
                            al {formatDate(row.fecha_periodo_fin)}
                          </p>
                        </td>
                        <td className="px-3 py-3 align-top text-zinc-300">
                          {formatDate(row.fecha_vencimiento)}
                        </td>
                        <td className="px-3 py-3 align-top text-white">
                          {formatCurrency(row.monto_total)}
                        </td>
                        <td className="px-3 py-3 align-top text-emerald-300">
                          {formatCurrency(row.monto_pagado)}
                        </td>
                        <td className="px-3 py-3 align-top text-amber-200">
                          {formatCurrency(row.saldo_pendiente)}
                        </td>
                        <td className="px-3 py-3 align-top text-zinc-400">
                          <p>{row.referencia_unica || "Sin referencia"}</p>
                          <p className="mt-1 text-xs text-zinc-500">
                            {row.programacion_id
                              ? `Prog. #${row.programacion_id}`
                              : "Sin programacion"}
                          </p>
                        </td>
                        <td className="rounded-r-2xl px-3 py-3 align-top">
                          <span
                            className={`rounded-full border px-2.5 py-1 text-xs font-medium ${badgeClass(
                              row.estatus
                            )}`}
                          >
                            {statusLabel(row.estatus)}
                          </span>
                          <p className="mt-2 text-xs text-zinc-500">
                            Tipo: {row.tipo_registro}
                          </p>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
      {agingModalOpen ? (
        <AgingBalanceModal
          title="Composicion del saldo CxP"
          subtitle="Saldo pendiente agrupado por dias desde su vencimiento, usando los filtros activos."
          buckets={metricas?.antiguedad_saldo || []}
          onClose={() => setAgingModalOpen(false)}
        />
      ) : null}
    </div>
  );
}
