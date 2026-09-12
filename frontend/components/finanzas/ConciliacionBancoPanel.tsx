"use client";

import { buildApiUrl } from '@/lib/api';
import {
  FinanceFieldLabel,
  FinanceInfoButton,
  FinanceInfoModal,
  type FinanceInfoContent,
} from "@/components/finanzas/FinanceInfo";
import { useSearchParams } from "next/navigation";

import { type FormEvent, useEffect, useState } from "react";

const FINANZAS_API_BASE = buildApiUrl("/finanzas");

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

interface BackgroundJobStatus {
  id: number;
  status: "PENDING" | "RUNNING" | "SUCCESS" | "ERROR" | "CANCELLED";
  result?: Record<string, unknown>;
  error?: string | null;
}

interface BankAccount {
  id: number;
  nombre: string;
  alias?: string | null;
  banco?: string | null;
  numero_cuenta?: string | null;
  clabe?: string | null;
  ultima_4?: string | null;
  moneda?: string | null;
  activa?: boolean;
  capa_id?: number | null;
  capa_nombre?: string | null;
  lotes_cargados?: number;
  movimientos_registrados?: number;
  ultimo_periodo_desde?: string | null;
  ultimo_periodo_hasta?: string | null;
  ultimo_saldo_inicial?: number | null;
  ultimo_saldo_final?: number | null;
  ultimo_total_ingresos?: number | null;
  ultimo_total_egresos?: number | null;
}

interface LoadItem {
  id: number;
  cuenta_bancaria_nombre?: string | null;
  nombre_archivo?: string | null;
  fecha_carga: string;
  fecha_desde?: string | null;
  fecha_hasta?: string | null;
  saldo_inicial: number;
  saldo_final: number;
  saldo_calculado: number;
  total_ingresos: number;
  total_egresos: number;
  estatus_procesamiento: string;
  estatus_cuadre: string;
  registros_detectados: number;
  registros_conciliados: number;
  registros_pendientes: number;
  registros_no_identificados: number;
  registros_duplicados: number;
}

interface CandidateCxc {
  id: number;
  entidad_nombre?: string | null;
  cliente_nombre: string;
  espacio_codigo?: string | null;
  concepto: string;
  fecha_vencimiento: string;
  saldo_pendiente: number;
  score: number;
  reasons?: string[];
  confidence_band?: string;
  amount_difference?: number;
  recommended_action?: string;
  review_required?: boolean;
  signals?: string[];
  warnings?: string[];
  next_steps?: string[];
  apply_readiness?: SuggestionApplyReadiness | null;
}

interface CandidateCxp {
  id: number;
  entidad_nombre?: string | null;
  proveedor_nombre: string;
  categoria: string;
  concepto: string;
  fecha_vencimiento: string;
  saldo_pendiente: number;
  score: number;
  reasons?: string[];
  confidence_band?: string;
  amount_difference?: number;
  recommended_action?: string;
  review_required?: boolean;
  signals?: string[];
  warnings?: string[];
  next_steps?: string[];
  apply_readiness?: SuggestionApplyReadiness | null;
}

interface SuggestionApplyReadiness {
  state: string;
  label: string;
  detail: string;
  requires_manual_review: boolean;
  score: number;
  amount_difference: number;
  checklist?: string[];
  note_template?: string;
}

interface AutoMatchCandidate {
  id: number;
  scope?: string;
  score?: number;
  date_distance?: number | null;
  reference_match?: boolean;
  reasons?: string[];
  cliente_nombre?: string;
  beneficiario_principal?: string;
  referencia_principal?: string;
  proveedor_nombre?: string;
  concepto?: string;
  saldo_pendiente?: number;
  monto_total_reportado?: number;
  fecha_evento?: string;
  fecha_vencimiento?: string;
  estatus?: string;
}

interface AutoMatchTrace {
  scope?: string;
  match_status?: string;
  matched?: boolean;
  confidence_score?: number | null;
  confidence_band?: string | null;
  matched_id?: number | null;
  matched_type?: string | null;
  reasons?: string[];
  candidates?: AutoMatchCandidate[];
}

interface AppliedCxC {
  id: number;
  cuenta_id: number;
  concepto: string;
  cliente_nombre: string;
  monto: number;
  estatus_validacion: string;
  fecha_pago: string;
}

interface AppliedCxP {
  id: number;
  cuenta_id: number;
  concepto: string;
  proveedor_nombre: string;
  monto: number;
  estatus_validacion: string;
  fecha_pago: string;
}

interface TransactionRow {
  id: number;
  carga_id?: number | null;
  carga_nombre?: string | null;
  cuenta_bancaria_id?: number | null;
  cuenta_bancaria_nombre?: string | null;
  tipo_movimiento: string;
  monto: number;
  monto_aplicado: number;
  monto_disponible: number;
  fecha_pago: string;
  concepto_bancario?: string | null;
  numero_referencia?: string | null;
  folio_bancario?: string | null;
  saldo_resultante?: number | null;
  estatus_conciliacion: string;
  cuenta_por_cobrar_id?: number | null;
  cuenta_por_pagar_id?: number | null;
  evento_id?: number | null;
  duplicado_de_id?: number | null;
  notas_conciliacion?: string | null;
  auto_match?: AutoMatchTrace | null;
}

interface TransactionDetail {
  transaccion: TransactionRow;
  auto_match?: AutoMatchTrace | null;
  candidatos: {
    cxc: CandidateCxc[];
    cxp: CandidateCxp[];
  };
  pagos_cxc: AppliedCxC[];
  pagos_cxp: AppliedCxP[];
}

interface ReconciliationSuggestion {
  id: string;
  tipo: "CXC" | "CXP";
  transaccion: TransactionRow;
  candidato: CandidateCxc | CandidateCxp;
  score: number;
  reasons?: string[];
  confidence_band?: string;
  amount_difference?: number;
  recommended_action?: string;
  review_required?: boolean;
  signals?: string[];
  warnings?: string[];
  next_steps?: string[];
  apply_readiness?: SuggestionApplyReadiness | null;
  decision?: {
    queue: string;
    queue_position: number;
    priority: number;
    action: string;
    label: string;
    detail: string;
    requires_note: boolean;
    checklist: string[];
    blockers: string[];
  } | null;
}

interface SuggestionSummary {
  total: number;
  by_type: Record<string, number>;
  by_confidence: Record<string, number>;
  by_readiness: Record<string, number>;
  amount_by_readiness: Record<string, number>;
  primary_queue: string;
  risk_level: string;
  recommended_focus: string;
  first_ready_id?: string | null;
  first_review_id?: string | null;
  first_blocked_id?: string | null;
  top_blockers: Array<{ label: string; count: number }>;
  decision_queue: Array<{
    state: string;
    label: string;
    count: number;
    amount: number;
    first_id?: string | null;
    next_action: string;
    operator_focus: string;
  }>;
}

interface PaginationState {
  page: number;
  page_size: number;
  total_items: number;
  total_pages: number;
}

interface AutoMatchSummary {
  sin_analisis: number;
  revision_manual: number;
  matched: number;
  low_confidence: number;
  ambiguous: number;
  none: number;
  error: number;
}

interface MovementSummary {
  saldo_inicial: number;
  saldo_final: number;
  ingresos: number;
  egresos: number;
  ingresos_count: number;
  egresos_count: number;
  total_movimientos: number;
  cuenta_bancaria_id?: number | null;
  auto_match?: AutoMatchSummary;
}

interface ConciliacionBancoPanelProps {
  onUseInEditor?: (transactionId: number) => void;
}

interface UploadFormState {
  cuentaModo: "existing" | "new";
  cuentaId: string;
  nombreCuenta: string;
  aliasCuenta: string;
  banco: string;
  numeroCuenta: string;
  clabe: string;
  ultima4: string;
  fechaDesde: string;
  fechaHasta: string;
  saldoInicial: string;
  saldoFinal: string;
  observaciones: string;
  file: File | null;
}

interface AccountFormState {
  id: number;
  nombre: string;
  alias: string;
  banco: string;
  numeroCuenta: string;
  clabe: string;
  ultima4: string;
  moneda: string;
  activa: boolean;
}

interface DeleteAccountState {
  account: BankAccount;
  hasHistory: boolean;
}

interface DeleteLoadState {
  load: LoadItem;
  confirmReversal: boolean;
  confirmPhrase: string;
}

interface StatusUpdateState {
  transactionId: number;
  status: "EN_ESPERA" | "NO_IDENTIFICADO";
  reference: string;
  currentNote: string;
  note: string;
}

interface FiltersState {
  estatus: string;
  tipo: string;
  cuentaId: string;
  autoMatch: string;
  busqueda: string;
  modoBusqueda: string;
  mes: string;
  fechaDesde: string;
  fechaHasta: string;
  orden: string;
  pageSize: number;
  page: number;
}

const DEFAULT_UPLOAD_FORM: UploadFormState = {
  cuentaModo: "existing",
  cuentaId: "",
  nombreCuenta: "",
  aliasCuenta: "",
  banco: "",
  numeroCuenta: "",
  clabe: "",
  ultima4: "",
  fechaDesde: "",
  fechaHasta: "",
  saldoInicial: "",
  saldoFinal: "",
  observaciones: "",
  file: null,
};

const DEFAULT_FILTERS: FiltersState = {
  estatus: "",
  tipo: "",
  cuentaId: "",
  autoMatch: "",
  busqueda: "",
  modoBusqueda: "contiene",
  mes: "",
  fechaDesde: "",
  fechaHasta: "",
  orden: "fecha_desc",
  pageSize: 25,
  page: 1,
};

const EMPTY_AUTO_MATCH_SUMMARY: AutoMatchSummary = {
  sin_analisis: 0,
  revision_manual: 0,
  matched: 0,
  low_confidence: 0,
  ambiguous: 0,
  none: 0,
  error: 0,
};

const EMPTY_SUGGESTION_SUMMARY: SuggestionSummary = {
  total: 0,
  by_type: { CXC: 0, CXP: 0 },
  by_confidence: { ALTA: 0, MEDIA: 0, BAJA: 0, SIN_BANDA: 0 },
  by_readiness: { LISTA: 0, REVISAR: 0, NO_APLICAR_DIRECTO: 0, SIN_ESTADO: 0 },
  amount_by_readiness: { LISTA: 0, REVISAR: 0, NO_APLICAR_DIRECTO: 0, SIN_ESTADO: 0 },
  primary_queue: "VACIA",
  risk_level: "SIN_DATOS",
  recommended_focus: "No hay sugerencias pendientes con el alcance actual.",
  first_ready_id: null,
  first_review_id: null,
  first_blocked_id: null,
  top_blockers: [],
  decision_queue: [],
};

const MONEY_ABSOLUTE_LIMIT = 1_000_000_000;
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;
const TEXT_LIMITS = {
  accountName: 120,
  accountAlias: 80,
  bank: 80,
  currency: 3,
  notes: 500,
  search: 120,
};

const conciliacionInfo: Record<string, FinanceInfoContent> = {
  modulo: {
    eyebrow: "Conciliacion bancaria",
    title: "Mesa de conciliacion",
    summary:
      "Este modulo conecta estados de cuenta, movimientos bancarios, CxC y CxP para aplicar pagos con trazabilidad.",
    details: [
      "Empieza registrando o seleccionando la cuenta bancaria. Despues carga el estado de cuenta y revisa los movimientos detectados.",
      "Las sugerencias automaticas ayudan, pero los movimientos con baja confianza deben revisarse antes de aplicar pagos.",
      "Los saldos y periodos sirven para cuadrar el lote. Si el archivo oficial ya trae saldos, puedes usarlos como referencia.",
    ],
  },
  cuentas: {
    eyebrow: "Cuentas bancarias",
    title: "Cuenta que se va a conciliar",
    summary:
      "La cuenta bancaria agrupa cargas, movimientos y conciliaciones para que cada lote tenga contexto financiero claro.",
    details: [
      "Usa nombres operativos claros, por ejemplo BBVA Operadora o Santander Rentas.",
      "La CLABE debe tener 18 digitos. Los ultimos 4 digitos ayudan a identificar la cuenta sin exponer datos completos.",
      "Si una cuenta tiene historial y se borra, el sistema conserva la trazabilidad desactivandola cuando aplique.",
    ],
  },
  cuentaNombre: {
    title: "Nombre de cuenta",
    summary:
      "Nombre interno con el que el equipo reconocera la cuenta dentro de BetterP.",
    details: [
      "Obligatorio al guardar una cuenta manualmente.",
      "Acepta letras, numeros, espacios, guion, punto y diagonal. Maximo 120 caracteres.",
      "Evita nombres genericos como Cuenta 1; usa banco, entidad o proposito operativo.",
    ],
  },
  banco: {
    title: "Banco",
    summary:
      "Institucion bancaria de la cuenta. Ayuda a buscar, filtrar y explicar movimientos.",
    details: [
      "Campo opcional, maximo 80 caracteres.",
      "No escribas contrasenas, usuarios bancarios ni datos sensibles de acceso.",
      "Ejemplos utiles: BBVA Mexico, Santander, Banorte, STP.",
    ],
  },
  numeroCuenta: {
    title: "Numero de cuenta",
    summary:
      "Numero operativo de la cuenta bancaria cuando lo tengas disponible.",
    details: [
      "Solo acepta digitos, hasta 20 caracteres.",
      "Si no quieres guardar el numero completo, usa ultimos 4 digitos para identificar la cuenta.",
      "Este campo ayuda a detectar duplicados y a vincular estados de cuenta.",
    ],
  },
  clabe: {
    title: "CLABE",
    summary:
      "Clave Bancaria Estandarizada usada en Mexico para identificar cuentas receptoras.",
    details: [
      "Debe tener exactamente 18 digitos si se captura.",
      "No acepta letras, espacios ni guiones.",
      "Es util para pagos por transferencia, conciliacion y datos bancarios mostrados al cliente.",
    ],
  },
  ultima4: {
    title: "Ultimos 4 digitos",
    summary:
      "Referencia corta para reconocer la cuenta sin mostrar el numero completo.",
    details: [
      "Solo acepta 4 digitos.",
      "Sirve para distinguir cuentas del mismo banco.",
      "Si capturas CLABE o numero de cuenta, procura que coincida con sus ultimos 4 digitos.",
    ],
  },
  moneda: {
    title: "Moneda",
    summary:
      "Moneda operativa de la cuenta bancaria.",
    details: [
      "Usa codigos de tres letras, por ejemplo MXN o USD.",
      "Por default BetterP usa MXN.",
      "Mantener la moneda consistente evita lecturas financieras mezcladas.",
    ],
  },
  carga: {
    eyebrow: "Carga bancaria",
    title: "Importar estado de cuenta",
    summary:
      "Carga Excel, CSV o PDF para que BetterP detecte movimientos y los prepare para conciliacion.",
    details: [
      "El archivo debe pesar menos de 20 MB.",
      "Si seleccionas una cuenta existente, la carga queda asociada a esa cuenta.",
      "Si el archivo trae una cuenta nueva, BetterP puede sugerir crearla antes de procesar.",
    ],
  },
  periodo: {
    title: "Periodo del estado de cuenta",
    summary:
      "Fechas que delimitan el lote bancario cargado.",
    details: [
      "La fecha desde no puede ser posterior a la fecha hasta.",
      "Usalas para cuadrar movimientos del mes o del rango que trae el estado de cuenta.",
      "Si el archivo ya incluye fechas por movimiento, el periodo funciona como control del lote.",
    ],
  },
  saldos: {
    title: "Saldos del lote",
    summary:
      "Saldo inicial y saldo final reportados por el estado de cuenta.",
    details: [
      "Aceptan dinero con hasta 2 decimales y un limite absoluto de $1,000,000,000.",
      "Se permiten saldos negativos para cuentas con sobregiro o ajustes bancarios.",
      "Estos valores ayudan a detectar diferencias entre lo cargado y lo reportado por el banco.",
    ],
  },
  observaciones: {
    title: "Observaciones del lote",
    summary:
      "Nota interna para explicar particularidades del archivo o del periodo.",
    details: [
      "Opcional, maximo 500 caracteres.",
      "Usala para anotar cortes parciales, archivos corregidos o movimientos que requieren revision.",
      "No incluyas contrasenas, usuarios bancarios ni datos sensibles de acceso.",
    ],
  },
  filtros: {
    eyebrow: "Movimientos",
    title: "Filtros de conciliacion",
    summary:
      "Los filtros permiten revisar solo el rango, cuenta, flujo o estatus que necesita atencion.",
    details: [
      "El buscador acepta hasta 120 caracteres y busca por concepto, referencia o folio.",
      "Usa mes o rango de fechas, pero no ambos al mismo tiempo.",
      "El filtro de revision automatica ayuda a priorizar movimientos sin candidato confiable.",
    ],
  },
  automatch: {
    title: "Revision automatica",
    summary:
      "Resumen del motor que compara movimientos bancarios contra CxC, CxP y eventos internos.",
    details: [
      "Match aplicado significa que el sistema encontro una coincidencia fuerte.",
      "Baja confianza o ambiguo requiere decision manual antes de aplicar.",
      "Sin analisis indica que aun no se ha ejecutado la busqueda para ese movimiento.",
    ],
  },
  sugerencias: {
    eyebrow: "Sugerencias",
    title: "Candidatos de conciliacion",
    summary:
      "Comparativo entre un movimiento bancario y una cuenta por cobrar o por pagar candidata.",
    details: [
      "Revisa monto, diferencia, fecha, referencia y score antes de aplicar.",
      "Una sugerencia alta acelera el trabajo, pero no sustituye la revision operativa.",
      "La nota de aplicacion debe explicar por que se acepta el candidato.",
    ],
  },
  statusNote: {
    title: "Motivo de cambio",
    summary:
      "Nota requerida para reabrir o marcar un movimiento como no identificado.",
    details: [
      "Minimo 3 caracteres y maximo 500.",
      "Debe explicar por que se cambia el estado del movimiento.",
      "La nota queda como trazabilidad para futuras revisiones.",
    ],
  },
  suggestionNote: {
    title: "Nota de aplicacion",
    summary:
      "Justificacion interna que acompana la aplicacion de una sugerencia.",
    details: [
      "Minimo 3 caracteres y maximo 500.",
      "Debe mencionar la referencia, coincidencia de monto o criterio usado.",
      "Evita notas genericas; ayudan poco si despues se audita la conciliacion.",
    ],
  },
  cargas: {
    title: "Cargas bancarias",
    summary:
      "Historial de lotes importados con cuadre, movimientos detectados y pendientes.",
    details: [
      "Revisa cargas con diferencia antes de aplicar movimientos de forma masiva.",
      "Eliminar una carga puede revertir pagos asociados si ya hubo conciliacion.",
      "Mantener lotes limpios reduce duplicados y errores de lectura financiera.",
    ],
  },
};

const CURRENT_YEAR = new Date().getFullYear();
const MONTH_FILTER_OPTIONS = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
].map((label, index) => ({
  label,
  value: `${CURRENT_YEAR}-${String(index + 1).padStart(2, "0")}`,
}));

function buildAccountFormState(account: BankAccount): AccountFormState {
  return {
    id: account.id,
    nombre: account.nombre || "",
    alias: account.alias || "",
    banco: account.banco || "",
    numeroCuenta: account.numero_cuenta || "",
    clabe: account.clabe || "",
    ultima4: account.ultima_4 || "",
    moneda: account.moneda || "MXN",
    activa: account.activa ?? true,
  };
}

function getErrorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object") {
    if ("message" in payload && typeof (payload as { message?: unknown }).message === "string") {
      return (payload as { message: string }).message;
    }
    if ("detail" in payload && typeof (payload as { detail?: unknown }).detail === "string") {
      return (payload as { detail: string }).detail;
    }
  }
  return fallback;
}

async function readApiBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.toLowerCase() || "";
  if (contentType.includes("application/json")) {
    return (await response.json().catch(() => ({}))) as unknown;
  }

  const text = await response.text().catch(() => "");
  const normalized = text.trim();
  if (!normalized) {
    return {};
  }

  return {
    detail: normalized.startsWith("<")
      ? "El servidor devolvio una respuesta inesperada al procesar el estado de cuenta."
      : normalized,
  };
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 2,
  }).format(value || 0);
}

function formatDate(value?: string | null) {
  if (!value) return "Sin fecha";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function sanitizeShortText(value: string, maxLength = 120) {
  return value.replace(/[<>]/g, "").replace(/\s{2,}/g, " ").slice(0, maxLength);
}

function sanitizeDigits(value: string, maxLength: number) {
  return value.replace(/\D/g, "").slice(0, maxLength);
}

function sanitizeCurrencyCode(value: string) {
  return value.replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, TEXT_LIMITS.currency);
}

function sanitizeMoneyInput(value: string, allowNegative = false) {
  let next = value.replace(",", ".").replace(/[^\d.-]/g, "");
  const isNegative = allowNegative && next.trim().startsWith("-");
  next = next.replace(/-/g, "");
  const [wholeRaw = "", decimalRaw = ""] = next.split(".");
  const whole = wholeRaw.replace(/\D/g, "").slice(0, 10);
  const decimal = decimalRaw.replace(/\D/g, "").slice(0, 2);
  const sign = isNegative ? "-" : "";
  const normalized = `${sign}${whole}${next.includes(".") ? `.${decimal}` : ""}`;
  const parsed = Number(normalized);
  if (Number.isFinite(parsed) && Math.abs(parsed) > MONEY_ABSOLUTE_LIMIT) {
    return `${sign}${MONEY_ABSOLUTE_LIMIT}`;
  }
  return normalized;
}

function hasValidMoneyValue(value: string, allowNegative = false) {
  if (!value.trim()) return true;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return false;
  if (!allowNegative && parsed < 0) return false;
  if (Math.abs(parsed) > MONEY_ABSOLUTE_LIMIT) return false;
  return /^\-?\d+(\.\d{1,2})?$/.test(value.trim());
}

function isDateRangeValid(start: string, end: string) {
  if (!start || !end) return true;
  return new Date(start).getTime() <= new Date(end).getTime();
}

function getUploadValidationError(form: UploadFormState) {
  if (!form.file) {
    return "Selecciona un archivo Excel, CSV o PDF antes de cargarlo.";
  }
  if (form.file.size > MAX_FILE_SIZE_BYTES) {
    return "El archivo no puede pesar mas de 20 MB.";
  }
  if (!isDateRangeValid(form.fechaDesde, form.fechaHasta)) {
    return "La fecha desde no puede ser posterior a la fecha hasta.";
  }
  if (!hasValidMoneyValue(form.saldoInicial, true)) {
    return "Saldo inicial solo acepta dinero con hasta 2 decimales.";
  }
  if (!hasValidMoneyValue(form.saldoFinal, true)) {
    return "Saldo final solo acepta dinero con hasta 2 decimales.";
  }
  if (form.cuentaModo === "new") {
    if (form.nombreCuenta.trim() && form.nombreCuenta.trim().length < 3) {
      return "Nombre de cuenta debe tener al menos 3 caracteres.";
    }
    if (form.clabe && form.clabe.length !== 18) {
      return "La CLABE debe tener exactamente 18 digitos.";
    }
    if (form.ultima4 && form.ultima4.length !== 4) {
      return "Ultimos 4 digitos debe tener exactamente 4 digitos.";
    }
  }
  return "";
}

function getAccountValidationError(form: AccountFormState | UploadFormState) {
  const nombre = "nombre" in form ? form.nombre : form.nombreCuenta;
  const alias = "alias" in form ? form.alias : form.aliasCuenta;
  const numeroCuenta = form.numeroCuenta;
  const clabe = form.clabe;
  const ultima4 = form.ultima4;
  const moneda = "moneda" in form ? form.moneda : "MXN";

  if (nombre.trim().length < 3) {
    return "Nombre de cuenta debe tener al menos 3 caracteres.";
  }
  if (nombre.trim().length > TEXT_LIMITS.accountName) {
    return "Nombre de cuenta rebasa el maximo de 120 caracteres.";
  }
  if (alias.trim().length > TEXT_LIMITS.accountAlias) {
    return "Alias interno rebasa el maximo de 80 caracteres.";
  }
  if (numeroCuenta && !/^\d{4,20}$/.test(numeroCuenta)) {
    return "Numero de cuenta solo acepta de 4 a 20 digitos.";
  }
  if (clabe && !/^\d{18}$/.test(clabe)) {
    return "La CLABE debe tener exactamente 18 digitos.";
  }
  if (ultima4 && !/^\d{4}$/.test(ultima4)) {
    return "Ultimos 4 digitos debe tener exactamente 4 digitos.";
  }
  if (moneda && !/^[A-Z]{3}$/.test(moneda)) {
    return "Moneda debe ser un codigo de 3 letras, por ejemplo MXN.";
  }
  return "";
}

function buildAccountLabel(account: BankAccount) {
  return [account.nombre, account.alias, account.banco, account.ultima_4 ? `****${account.ultima_4}` : null]
    .filter(Boolean)
    .join(" | ");
}

function buildPageWindow(currentPage: number, totalPages: number, visibleCount = 6) {
  if (totalPages <= visibleCount) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const halfWindow = Math.floor(visibleCount / 2);
  let start = Math.max(1, currentPage - halfWindow);
  let end = start + visibleCount - 1;

  if (end > totalPages) {
    end = totalPages;
    start = Math.max(1, end - visibleCount + 1);
  }

  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function countActiveMovementFilters(filters: FiltersState) {
  return [
    filters.estatus,
    filters.tipo,
    filters.cuentaId,
    filters.autoMatch,
    filters.busqueda.trim(),
    filters.mes,
    filters.fechaDesde,
    filters.fechaHasta,
  ].filter(Boolean).length;
}

function getSortLabel(order: string) {
  if (order === "fecha_asc") return "Fecha más antigua";
  if (order === "fecha_desc") return "Fecha más reciente";
  if (order === "monto_asc") return "Monto menor a mayor";
  if (order === "monto_desc") return "Monto mayor a menor";
  return "Sin orden";
}

function getMovementScopeLabel(filters: FiltersState, account: BankAccount | null) {
  const accountLabel = account ? buildAccountLabel(account) : "Todas las cuentas";
  if (filters.mes) {
    const monthLabel =
      MONTH_FILTER_OPTIONS.find((option) => option.value === filters.mes)?.label ||
      filters.mes;
    return `${accountLabel} | ${monthLabel} ${filters.mes.slice(0, 4)}`;
  }
  if (filters.fechaDesde || filters.fechaHasta) {
    return `${accountLabel} | ${filters.fechaDesde || "inicio"} a ${filters.fechaHasta || "fin"}`;
  }
  return account ? `${accountLabel} | Último periodo cargado` : "Todas las cuentas | Todos los periodos";
}

function getMovementTypeLabel(type: string) {
  if (type === "INGRESO") return "Depósito";
  if (type === "EGRESO") return "Retiro";
  return type || "Movimiento";
}

function getStatusLabel(status: string) {
  return status.replace(/_/g, " ").toLowerCase();
}

function getAutoMatchStatusLabel(status?: string | null) {
  switch (status) {
    case "MATCHED":
      return "Match aplicado";
    case "LOW_CONFIDENCE":
      return "Baja confianza";
    case "AMBIGUOUS":
      return "Ambiguo";
    case "NONE":
      return "Sin candidato";
    case "ERROR":
      return "Error";
    default:
      return status || "Sin analisis";
  }
}

function autoMatchStatusClass(trace?: AutoMatchTrace | null) {
  if (!trace) {
    return "border-zinc-700 bg-zinc-900 text-zinc-300";
  }
  if (trace.matched || trace.match_status === "MATCHED") {
    return "border-emerald-500/20 bg-emerald-500/10 text-emerald-200";
  }
  if (trace.match_status === "LOW_CONFIDENCE" || trace.confidence_band === "BAJA") {
    return "border-amber-500/20 bg-amber-500/10 text-amber-200";
  }
  if (trace.match_status === "AMBIGUOUS") {
    return "border-cyan-500/20 bg-cyan-500/10 text-cyan-200";
  }
  return "border-zinc-700 bg-zinc-900 text-zinc-300";
}

function autoMatchNextStep(trace?: AutoMatchTrace | null) {
  if (!trace) {
    return "Ejecuta Match para guardar el analisis del movimiento.";
  }
  if (trace.matched) {
    return "El movimiento ya quedo vinculado; revisa el soporte y pagos aplicados.";
  }
  if (trace.match_status === "LOW_CONFIDENCE") {
    return "Revisa candidatos antes de aplicar; falta una referencia o texto fuerte.";
  }
  if (trace.match_status === "AMBIGUOUS") {
    return "Hay candidatos muy parecidos; selecciona manualmente el correcto.";
  }
  if (trace.match_status === "NONE") {
    return "No se encontraron candidatos. Revisa cliente, concepto o registra manualmente.";
  }
  return "Revisa razones y candidatos antes de decidir.";
}

function autoMatchCandidateTitle(candidate: AutoMatchCandidate) {
  return (
    candidate.cliente_nombre ||
    candidate.proveedor_nombre ||
    candidate.beneficiario_principal ||
    candidate.concepto ||
    `Candidato ${candidate.id}`
  );
}

function autoMatchCandidateAmount(candidate: AutoMatchCandidate) {
  return candidate.saldo_pendiente ?? candidate.monto_total_reportado ?? null;
}

function autoMatchCandidateDate(candidate: AutoMatchCandidate) {
  return candidate.fecha_vencimiento || candidate.fecha_evento || null;
}

function buildSuggestionNote(suggestion: ReconciliationSuggestion) {
  const readiness = getSuggestionReadiness(suggestion);
  if (readiness?.note_template) {
    return readiness.note_template;
  }
  const reasons = suggestion.reasons?.slice(0, 3).join("; ");
  return [
    `Sugerencia ${suggestion.tipo} aplicada desde conciliacion bancaria.`,
    `Score ${suggestion.score}.`,
    reasons ? `Razones: ${reasons}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function getSuggestionReadiness(suggestion: ReconciliationSuggestion) {
  return suggestion.apply_readiness || suggestion.candidato.apply_readiness || null;
}

function getSuggestionReadinessClass(state?: string | null) {
  if (state === "LISTA") return "border-emerald-500/20 bg-emerald-500/10 text-emerald-100";
  if (state === "REVISAR") return "border-amber-500/20 bg-amber-500/10 text-amber-100";
  if (state === "NO_APLICAR_DIRECTO") return "border-red-500/20 bg-red-500/10 text-red-100";
  return "border-zinc-700 bg-zinc-900 text-zinc-300";
}

function getSuggestionRiskClass(value?: string | null) {
  if (value === "BAJO") return "border-emerald-500/20 bg-emerald-500/10 text-emerald-100";
  if (value === "MEDIO") return "border-amber-500/20 bg-amber-500/10 text-amber-100";
  if (value === "ALTO") return "border-red-500/20 bg-red-500/10 text-red-100";
  return "border-zinc-700 bg-zinc-900 text-zinc-300";
}

function getSuggestionQueueLabel(value?: string | null) {
  if (value === "LISTA") return "Listas primero";
  if (value === "REVISAR") return "Revision primero";
  if (value === "NO_APLICAR_DIRECTO") return "Resolver manual";
  return "Sin cola";
}

function getSuggestionApplyButtonLabel(suggestion: ReconciliationSuggestion) {
  const readiness = getSuggestionReadiness(suggestion);
  if (readiness?.state === "NO_APLICAR_DIRECTO") return "Revisar";
  if (readiness?.requires_manual_review) return "Revisar y aplicar";
  return `Aplicar a ${suggestion.tipo}`;
}

function getSuggestionScoreTone(score: number) {
  if (score >= 320) return "text-emerald-200";
  if (score >= 220) return "text-amber-200";
  return "text-zinc-300";
}

function getSuggestionScoreBadge(score: number) {
  if (score >= 320) {
    return "border-emerald-500/20 bg-emerald-500/10 text-emerald-100";
  }
  if (score >= 220) {
    return "border-amber-500/20 bg-amber-500/10 text-amber-100";
  }
  return "border-zinc-700 bg-zinc-900 text-zinc-300";
}

function getSuggestionScoreLabel(score: number) {
  if (score >= 320) return "Alta confianza";
  if (score >= 220) return "Revisar";
  return "Baja";
}

function getCandidateConfidenceLabel(value?: string | null) {
  if (value === "ALTA") return "Alta confianza";
  if (value === "MEDIA") return "Revision sugerida";
  if (value === "BAJA") return "Baja confianza";
  return "Sin banda";
}

function getCandidateConfidenceClass(value?: string | null) {
  if (value === "ALTA") return "border-emerald-500/20 bg-emerald-500/10 text-emerald-100";
  if (value === "MEDIA") return "border-amber-500/20 bg-amber-500/10 text-amber-100";
  if (value === "BAJA") return "border-zinc-700 bg-zinc-900 text-zinc-300";
  return "border-zinc-800 bg-zinc-950 text-zinc-500";
}

function SuggestionAssistBlock({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: "ok" | "warn" | "info";
}) {
  const toneClass =
    tone === "ok"
      ? "border-emerald-500/15 bg-emerald-500/5 text-emerald-100"
      : tone === "warn"
        ? "border-amber-500/15 bg-amber-500/5 text-amber-100"
        : "border-cyan-500/15 bg-cyan-500/5 text-cyan-100";
  return (
    <div className={`rounded-2xl border p-4 ${toneClass}`}>
      <p className="text-xs uppercase tracking-[0.18em] opacity-80">{title}</p>
      {items.length ? (
        <ul className="mt-3 space-y-1 text-xs leading-5 text-zinc-300">
          {items.slice(0, 4).map((item, index) => (
            <li key={`${title}-${index}`}>- {item}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-xs leading-5 text-zinc-500">Sin elementos.</p>
      )}
    </div>
  );
}

function getSuggestionAverageScore(items: ReconciliationSuggestion[]) {
  if (!items.length) return 0;
  return Math.round(items.reduce((total, item) => total + item.score, 0) / items.length);
}

function getSuggestionAmountDifference(suggestion: ReconciliationSuggestion) {
  return Math.abs(suggestion.transaccion.monto - suggestion.candidato.saldo_pendiente);
}

function isCxcCandidate(candidate: CandidateCxc | CandidateCxp): candidate is CandidateCxc {
  return "cliente_nombre" in candidate;
}

function getSuggestionTitle(suggestion: ReconciliationSuggestion) {
  if (isCxcCandidate(suggestion.candidato)) {
    return `${suggestion.candidato.cliente_nombre}${
      suggestion.candidato.espacio_codigo ? ` | ${suggestion.candidato.espacio_codigo}` : ""
    }`;
  }
  return suggestion.candidato.proveedor_nombre;
}

function getSuggestionSubtitle(suggestion: ReconciliationSuggestion) {
  if (isCxcCandidate(suggestion.candidato)) {
    return suggestion.candidato.concepto;
  }
  return `${suggestion.candidato.concepto} | ${suggestion.candidato.categoria}`;
}

function loadStatusClass(status: string) {
  if (status === "COMPLETADO") return "border-emerald-500/20 bg-emerald-500/10 text-emerald-200";
  if (status === "COMPLETADO_CON_ERRORES") return "border-amber-500/20 bg-amber-500/10 text-amber-200";
  return "border-zinc-700 bg-zinc-900 text-zinc-300";
}

function balanceStatusClass(status: string) {
  if (status === "CUADRADO") return "border-emerald-500/20 bg-emerald-500/10 text-emerald-200";
  if (status === "CON_DIFERENCIA") return "border-red-500/20 bg-red-500/10 text-red-200";
  return "border-zinc-700 bg-zinc-900 text-zinc-300";
}

function transactionStatusClass(status: string) {
  if (status === "VALIDADO") return "border-emerald-500/20 bg-emerald-500/10 text-emerald-200";
  if (status === "PARCIAL") return "border-amber-500/20 bg-amber-500/10 text-amber-200";
  if (status === "NO_IDENTIFICADO") return "border-red-500/20 bg-red-500/10 text-red-200";
  if (status === "DUPLICADO") return "border-fuchsia-500/20 bg-fuchsia-500/10 text-fuchsia-200";
  if (status === "VINCULADO") return "border-cyan-500/20 bg-cyan-500/10 text-cyan-200";
  return "border-zinc-700 bg-zinc-900 text-zinc-300";
}

type BankWorkspaceTab = "importar" | "lotes" | "movimientos" | "sugerencias";
type BankWorkspaceUrlTab = "bancos" | "cargas" | "movimientos" | "sugerencias";

function bankTabFromUrl(value: string | null): BankWorkspaceTab | null {
  if (value === "bancos") return "importar";
  if (value === "cargas") return "lotes";
  if (value === "movimientos" || value === "sugerencias") return value;
  return null;
}

function bankTabToUrl(value: BankWorkspaceTab): BankWorkspaceUrlTab {
  if (value === "importar") return "bancos";
  if (value === "lotes") return "cargas";
  return value;
}

function BankTabButton({
  active,
  label,
  helper,
  onClick,
}: {
  active: boolean;
  label: string;
  helper: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`work-tab ${
        active
          ? "work-tab-active"
          : "work-tab-idle"
      }`}
    >
      <span>{label}</span>
      {active ? <span className="work-tab-helper">{helper}</span> : null}
    </button>
  );
}

function SummaryStatCard({
  label,
  value,
  helper,
  tone = "default",
}: {
  label: string;
  value: string;
  helper: string;
  tone?: "default" | "positive" | "negative" | "accent";
}) {
  const toneClasses =
    tone === "positive"
      ? "text-emerald-200"
      : tone === "negative"
        ? "text-red-200"
        : tone === "accent"
          ? "text-cyan-200"
          : "text-white";

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 px-3 py-3">
      <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">
        {label}
      </p>
      <p className={`mt-1 text-base font-semibold md:text-lg ${toneClasses}`}>{value}</p>
      <p className="mt-1 line-clamp-2 text-xs leading-5 text-zinc-500">{helper}</p>
    </div>
  );
}

function AccountActionIcon({ kind }: { kind: "movements" | "upload" | "edit" | "delete" }) {
  const className = "h-4 w-4 stroke-current";

  if (kind === "movements") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className={className}>
        <path d="M4 7h16" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M4 12h10" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M4 17h7" strokeWidth="1.8" strokeLinecap="round" />
        <path
          d="m16 16 2 2 3-4"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (kind === "upload") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className={className}>
        <path d="M12 16V5" strokeWidth="1.8" strokeLinecap="round" />
        <path
          d="m8 9 4-4 4 4"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M5 19h14" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }

  if (kind === "edit") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className={className}>
        <path
          d="M5 18.5h4.2L18.5 9.2a2 2 0 0 0 0-2.8l-.9-.9a2 2 0 0 0-2.8 0L5 15.3v3.2Z"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path d="m13.5 6.8 3.7 3.7" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M5 7h14" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M10 11v6" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M14 11v6" strokeWidth="1.8" strokeLinecap="round" />
      <path
        d="M8 7V5.5A1.5 1.5 0 0 1 9.5 4h5A1.5 1.5 0 0 1 16 5.5V7"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M7 7l.7 13h8.6L17 7" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function AccountActionButton({
  label,
  tone = "default",
  icon,
  disabled,
  onClick,
}: {
  label: string;
  tone?: "default" | "accent" | "danger";
  icon: "movements" | "upload" | "edit" | "delete";
  disabled?: boolean;
  onClick: () => void;
}) {
  const toneClass =
    tone === "danger"
      ? "border-red-500/25 bg-red-500/10 text-red-200 hover:bg-red-500/15"
      : tone === "accent"
        ? "border-cyan-500/25 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20"
        : "border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800";

  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${toneClass}`}
    >
      <AccountActionIcon kind={icon} />
    </button>
  );
}

function LoadStatCell({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "positive" | "negative" | "accent" | "muted";
}) {
  const toneClass =
    tone === "positive"
      ? "text-emerald-200"
      : tone === "negative"
        ? "text-red-200"
        : tone === "accent"
          ? "text-cyan-200"
          : tone === "muted"
            ? "text-fuchsia-200"
            : "text-white";

  return (
    <div className="min-w-0 rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-2">
      <p className="truncate text-[10px] uppercase tracking-[0.2em] text-zinc-500">
        {label}
      </p>
      <p className={`mt-1 truncate text-sm font-semibold ${toneClass}`}>{value}</p>
    </div>
  );
}

function BankLoadCard({
  load,
  disabled,
  onDelete,
}: {
  load: LoadItem;
  disabled?: boolean;
  onDelete: () => void;
}) {
  const loadLabel = load.nombre_archivo || `Carga #${load.id}`;

  return (
    <article className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4 transition-colors hover:border-zinc-700 hover:bg-zinc-950">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold text-white md:text-base">
              {loadLabel}
            </p>
            <span
              className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.14em] ${loadStatusClass(
                load.estatus_procesamiento
              )}`}
            >
              {load.estatus_procesamiento}
            </span>
            <span
              className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.14em] ${balanceStatusClass(
                load.estatus_cuadre
              )}`}
            >
              {load.estatus_cuadre}
            </span>
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            {load.cuenta_bancaria_nombre || "Sin cuenta"} | Cargado{" "}
            {formatDate(load.fecha_carga)}
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            Periodo {load.fecha_desde ? formatDate(load.fecha_desde) : "Sin inicio"} -{" "}
            {load.fecha_hasta ? formatDate(load.fecha_hasta) : "Sin fin"}
          </p>
        </div>

        <AccountActionButton
          label="Eliminar carga"
          icon="delete"
          tone="danger"
          disabled={disabled}
          onClick={onDelete}
        />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-3 2xl:grid-cols-6">
        <LoadStatCell
          label="Inicial"
          value={formatCurrency(load.saldo_inicial)}
          tone="default"
        />
        <LoadStatCell
          label="Final"
          value={formatCurrency(load.saldo_final)}
          tone="accent"
        />
        <LoadStatCell
          label="Ingresos"
          value={formatCurrency(load.total_ingresos)}
          tone="positive"
        />
        <LoadStatCell
          label="Egresos"
          value={formatCurrency(load.total_egresos)}
          tone="negative"
        />
        <LoadStatCell
          label="Procesados"
          value={String(load.registros_detectados)}
          tone="default"
        />
        <LoadStatCell
          label="Duplicados"
          value={String(load.registros_duplicados)}
          tone="muted"
        />
      </div>
    </article>
  );
}

function AccountOverviewCard({
  account,
  active,
  onUseForMovements,
  onUseForImport,
  onEdit,
  onDelete,
  disabled,
}: {
  account: BankAccount;
  active: boolean;
  onUseForMovements: () => void;
  onUseForImport: () => void;
  onEdit: () => void;
  onDelete: () => void;
  disabled?: boolean;
}) {
  return (
    <div
      className={`grid min-w-[1080px] grid-cols-[minmax(260px,1.3fr)_150px_140px_140px_190px_110px_178px] items-center gap-4 border-t px-4 py-3 transition-colors first:border-t-0 ${
        active
          ? "border-cyan-500/20 bg-cyan-500/10"
          : "border-zinc-800 bg-zinc-950/40"
      }`}
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-white">{account.nombre}</p>
        <p className="mt-1 truncate text-xs text-zinc-500">{buildAccountLabel(account)}</p>
      </div>
      <p className="text-sm font-semibold text-white">
        {account.ultimo_periodo_desde || account.ultimo_periodo_hasta
          ? `${formatDate(account.ultimo_periodo_desde)} - ${formatDate(account.ultimo_periodo_hasta)}`
          : "Sin periodo"}
      </p>
      <p className="text-sm font-semibold text-white">
        {formatCurrency(account.ultimo_saldo_inicial ?? 0)}
      </p>
      <p className="text-sm font-semibold text-cyan-200">
        {formatCurrency(account.ultimo_saldo_final ?? 0)}
      </p>
      <p className="text-sm font-semibold text-white">
        {formatCurrency(account.ultimo_total_ingresos ?? 0)} /{" "}
        <span className="text-red-200">{formatCurrency(account.ultimo_total_egresos ?? 0)}</span>
      </p>
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-white">
          {account.movimientos_registrados ?? 0}
        </span>
        <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-zinc-400">
          {account.lotes_cargados ?? 0} lotes
        </span>
      </div>
      <div className="flex items-center justify-end gap-2">
        <AccountActionButton
          label="Ver movimientos"
          icon="movements"
          onClick={onUseForMovements}
        />
        <AccountActionButton
          label="Cargar estado"
          icon="upload"
          tone="accent"
          onClick={onUseForImport}
        />
        <AccountActionButton
          label="Editar"
          icon="edit"
          disabled={disabled}
          onClick={onEdit}
        />
        <AccountActionButton
          label="Borrar"
          icon="delete"
          tone="danger"
          disabled={disabled}
          onClick={onDelete}
        />
      </div>
    </div>
  );
}

export default function ConciliacionBancoPanel({
  onUseInEditor,
}: ConciliacionBancoPanelProps) {
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [loads, setLoads] = useState<LoadItem[]>([]);
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [suggestions, setSuggestions] = useState<ReconciliationSuggestion[]>([]);
  const [suggestionSummary, setSuggestionSummary] = useState<SuggestionSummary>(
    EMPTY_SUGGESTION_SUMMARY
  );
  const [movementSummary, setMovementSummary] = useState<MovementSummary>({
    saldo_inicial: 0,
    saldo_final: 0,
    ingresos: 0,
    egresos: 0,
    ingresos_count: 0,
    egresos_count: 0,
    total_movimientos: 0,
    cuenta_bancaria_id: null,
    auto_match: EMPTY_AUTO_MATCH_SUMMARY,
  });
  const [pagination, setPagination] = useState<PaginationState>({
    page: 1,
    page_size: 25,
    total_items: 0,
    total_pages: 1,
  });
  const [filters, setFilters] = useState<FiltersState>(DEFAULT_FILTERS);
  const [pageJumpValue, setPageJumpValue] = useState("1");
  const [uploadForm, setUploadForm] = useState<UploadFormState>(DEFAULT_UPLOAD_FORM);
  const [accountForm, setAccountForm] = useState<AccountFormState | null>(null);
  const [deleteAccount, setDeleteAccount] = useState<DeleteAccountState | null>(null);
  const [deleteLoad, setDeleteLoad] = useState<DeleteLoadState | null>(null);
  const [statusUpdate, setStatusUpdate] = useState<StatusUpdateState | null>(null);
  const [selectedTransaction, setSelectedTransaction] = useState<TransactionDetail | null>(null);
  const [selectedSuggestion, setSelectedSuggestion] = useState<ReconciliationSuggestion | null>(null);
  const [suggestionNote, setSuggestionNote] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [isSavingAccount, setIsSavingAccount] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [isDeletingLoad, setIsDeletingLoad] = useState(false);
  const [isWorking, setIsWorking] = useState(false);
  const [isAutoReconciling, setIsAutoReconciling] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [infoModal, setInfoModal] = useState<FinanceInfoContent | null>(null);
  const [activeTab, setActiveTab] = useState<BankWorkspaceTab>("importar");

  const selectTab = (tab: BankWorkspaceTab) => {
    setActiveTab(tab);
    if (typeof window !== "undefined") {
      const urlTab = bankTabToUrl(tab);
      window.history.replaceState({}, "", `/conciliacion?tab=${urlTab}`);
      window.dispatchEvent(new CustomEvent("betterp-tab-change", { detail: { tab: urlTab } }));
    }
  };

  const loadAccounts = async () => {
    const response = await fetch(`${FINANZAS_API_BASE}/conciliacion/cuentas-bancarias/`, {
      cache: "no-store",
    });
    const body = await readApiBody(response);
    if (!response.ok) {
      throw new Error(getErrorMessage(body, "No se pudieron cargar las cuentas bancarias."));
    }
    setAccounts(body as BankAccount[]);
  };

  const loadLoads = async (accountId?: string) => {
    const params = new URLSearchParams();
    params.set("page", "1");
    params.set("page_size", "8");
    if (accountId) {
      params.set("cuenta_bancaria_id", accountId);
    }
    const response = await fetch(
      `${FINANZAS_API_BASE}/conciliacion/cargas/?${params.toString()}`,
      { cache: "no-store" }
    );
    const body = await readApiBody(response);
    if (!response.ok) {
      throw new Error(getErrorMessage(body, "No se pudieron cargar las cargas bancarias."));
    }
    const payload = body as { items: LoadItem[] };
    setLoads(payload.items || []);
  };

  const loadTransactions = async (activeFilters: FiltersState) => {
    const params = new URLSearchParams();
    if (activeFilters.estatus) params.set("estatus", activeFilters.estatus);
    if (activeFilters.tipo) params.set("tipo_movimiento", activeFilters.tipo);
    if (activeFilters.cuentaId) params.set("cuenta_bancaria_id", activeFilters.cuentaId);
    if (activeFilters.autoMatch) params.set("auto_match", activeFilters.autoMatch);
    if (activeFilters.busqueda.trim()) params.set("busqueda", activeFilters.busqueda.trim());
    if (activeFilters.modoBusqueda) params.set("modo_busqueda", activeFilters.modoBusqueda);
    if (activeFilters.mes) params.set("mes", activeFilters.mes);
    if (activeFilters.fechaDesde) params.set("fecha_desde", activeFilters.fechaDesde);
    if (activeFilters.fechaHasta) params.set("fecha_hasta", activeFilters.fechaHasta);
    if (activeFilters.orden) params.set("orden", activeFilters.orden);
    params.set("page", String(activeFilters.page));
    params.set("page_size", String(activeFilters.pageSize));

    const response = await fetch(
      `${FINANZAS_API_BASE}/conciliacion/transacciones/?${params.toString()}`,
      { cache: "no-store" }
    );
    const body = await readApiBody(response);
    if (!response.ok) {
      throw new Error(
        getErrorMessage(body, "No se pudieron cargar los movimientos bancarios.")
      );
    }
    const payload = body as {
      items: TransactionRow[];
      pagination: PaginationState;
      summary?: MovementSummary;
    };
    setTransactions(payload.items || []);
    setMovementSummary(
      payload.summary || {
        saldo_inicial: 0,
        saldo_final: 0,
        ingresos: 0,
        egresos: 0,
        ingresos_count: 0,
        egresos_count: 0,
        total_movimientos: 0,
        cuenta_bancaria_id: null,
        auto_match: EMPTY_AUTO_MATCH_SUMMARY,
      }
    );
    setPagination(payload.pagination || { page: 1, page_size: 25, total_items: 0, total_pages: 1 });
  };

  const loadTransactionDetail = async (transactionId: number) => {
    const response = await fetch(
      `${FINANZAS_API_BASE}/conciliacion/transacciones/${transactionId}/`,
      { cache: "no-store" }
    );
    const body = await readApiBody(response);
    if (!response.ok) {
      throw new Error(
        getErrorMessage(body, "No se pudo cargar el detalle del movimiento bancario.")
      );
    }
    setSelectedTransaction(body as TransactionDetail);
    selectTab("movimientos");
  };

  const loadSuggestions = async (activeFilters: FiltersState) => {
    const params = new URLSearchParams();
    params.set("limit", "80");
    if (activeFilters.cuentaId) {
      params.set("cuenta_bancaria_id", activeFilters.cuentaId);
    }
    const response = await fetch(
      `${FINANZAS_API_BASE}/conciliacion/sugerencias/?${params.toString()}`,
      { cache: "no-store" }
    );
    const body = await readApiBody(response);
    if (!response.ok) {
      throw new Error(getErrorMessage(body, "No se pudieron cargar las sugerencias."));
    }
    const payload = body as {
      items?: ReconciliationSuggestion[];
      summary?: SuggestionSummary;
    };
    setSuggestions(payload.items || []);
    setSuggestionSummary(payload.summary || EMPTY_SUGGESTION_SUMMARY);
  };

  const refreshAll = async (activeFilters: FiltersState) => {
    setIsLoading(true);
    try {
      await Promise.all([
        loadAccounts(),
        loadLoads(activeFilters.cuentaId),
        loadTransactions(activeFilters),
        loadSuggestions(activeFilters),
      ]);
      setError("");
    } catch (loadError) {
      console.error("Error cargando panel bancario:", loadError);
      setError(
        loadError instanceof Error
          ? loadError.message
          : "No se pudo cargar el panel bancario."
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void refreshAll(filters);
  }, [filters]);

  useEffect(() => {
    const nextTab = bankTabFromUrl(tabParam);
    if (nextTab) {
      setActiveTab(nextTab);
    }
  }, [tabParam]);

  useEffect(() => {
    setPageJumpValue(String(pagination.page || 1));
  }, [pagination.page]);

  const updateFilters = (updates: Partial<FiltersState>) => {
    setFilters((current) => ({
      ...current,
      ...updates,
      page: updates.page ?? 1,
    }));
  };

  const clearMovementFilters = () => {
    setFilters((current) => ({
      ...DEFAULT_FILTERS,
      cuentaId: current.cuentaId,
      pageSize: current.pageSize,
    }));
  };

  const applyAccountContext = (accountId: string, tab: BankWorkspaceTab) => {
    setUploadForm((current) => ({
      ...current,
      cuentaModo: "existing",
      cuentaId: accountId,
    }));
    updateFilters({ cuentaId: accountId });
    selectTab(tab);
  };

  const selectedAccount = accounts.find(
    (account) => String(account.id) === filters.cuentaId
  ) || null;

  const pageWindow = buildPageWindow(pagination.page, pagination.total_pages);
  const activeMovementFilters = countActiveMovementFilters(filters);
  const autoMatchSummary = movementSummary.auto_match || EMPTY_AUTO_MATCH_SUMMARY;
  const cxcSuggestions = suggestions.filter((item) => item.tipo === "CXC");
  const cxpSuggestions = suggestions.filter((item) => item.tipo === "CXP");
  const averageSuggestionScore = getSuggestionAverageScore(suggestions);
  const readySuggestions = suggestions.filter(
    (item) => getSuggestionReadiness(item)?.state === "LISTA"
  );
  const reviewSuggestions = suggestions.filter(
    (item) => getSuggestionReadiness(item)?.requires_manual_review
  );
  const readySuggestionCount = suggestionSummary.by_readiness.LISTA || readySuggestions.length;
  const reviewSuggestionCount =
    suggestionSummary.by_readiness.REVISAR || reviewSuggestions.length;
  const blockedSuggestionCount = suggestionSummary.by_readiness.NO_APLICAR_DIRECTO || 0;
  const selectedSuggestionReadiness = selectedSuggestion
    ? getSuggestionReadiness(selectedSuggestion)
    : null;
  const autoMatchQuickFilters = [
    {
      value: "REVISION_MANUAL",
      label: "Por revisar",
      count: autoMatchSummary.revision_manual,
      tone: "border-amber-500/20 bg-amber-500/10 text-amber-100",
    },
    {
      value: "SIN_ANALISIS",
      label: "Sin analisis",
      count: autoMatchSummary.sin_analisis,
      tone: "border-zinc-700 bg-zinc-900 text-zinc-300",
    },
    {
      value: "MATCHED",
      label: "Match",
      count: autoMatchSummary.matched,
      tone: "border-emerald-500/20 bg-emerald-500/10 text-emerald-100",
    },
    {
      value: "LOW_CONFIDENCE",
      label: "Baja confianza",
      count: autoMatchSummary.low_confidence,
      tone: "border-amber-500/20 bg-amber-500/10 text-amber-100",
    },
    {
      value: "AMBIGUOUS",
      label: "Ambiguos",
      count: autoMatchSummary.ambiguous,
      tone: "border-cyan-500/20 bg-cyan-500/10 text-cyan-100",
    },
    {
      value: "ERROR",
      label: "Error",
      count: autoMatchSummary.error,
      tone: "border-red-500/20 bg-red-500/10 text-red-100",
    },
  ];
  const pageOptions = Array.from(
    { length: Math.max(pagination.total_pages, 1) },
    (_, index) => index + 1
  );

  const handlePageJump = () => {
    const targetPage = Number.parseInt(pageJumpValue, 10);
    if (!Number.isFinite(targetPage)) return;
    const normalizedPage = Math.min(
      Math.max(targetPage, 1),
      Math.max(pagination.total_pages, 1)
    );
    updateFilters({ page: normalizedPage });
  };

  const handleSortChange = (target: "fecha" | "monto") => {
    if (target === "fecha") {
      updateFilters({
        orden: filters.orden === "fecha_asc" ? "fecha_desc" : "fecha_asc",
      });
      return;
    }

    updateFilters({
      orden: filters.orden === "monto_asc" ? "monto_desc" : "monto_asc",
    });
  };

  const waitForUploadJob = async (jobId: number) => {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const response = await fetch(buildApiUrl(`/billing/jobs/${jobId}/`), {
        cache: "no-store",
      });
      const body = (await readApiBody(response)) as
        | BackgroundJobStatus
        | { detail?: string }
        | null;
      if (!response.ok) {
        throw new Error(getErrorMessage(body, "No se pudo consultar el estado de la carga."));
      }
      const job = body as BackgroundJobStatus;
      if (job.status === "SUCCESS" && job.result) {
        return job.result;
      }
      if (job.status === "ERROR" || job.status === "CANCELLED") {
        throw new Error(job.error || "La carga bancaria termino con error.");
      }
      await sleep(2000);
    }
    throw new Error("La carga bancaria sigue en proceso. Revisa salud operativa en unos minutos.");
  };

  const handleUpload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const validationError = getUploadValidationError(uploadForm);
    if (validationError) {
      alert(validationError);
      return;
    }

    setIsUploading(true);
    try {
      const submitUpload = async (
        formState: UploadFormState,
        confirmCreateAccount = false
      ) => {
        const formData = new FormData();
        formData.append("file", formState.file as File);
        formData.append("cuenta_modo", formState.cuentaModo);
        if (formState.cuentaModo === "existing" && formState.cuentaId) {
          formData.append("cuenta_bancaria_id", formState.cuentaId);
        }
        if (formState.cuentaModo === "new") {
          formData.append("nombre_cuenta", formState.nombreCuenta);
          formData.append("alias_cuenta", formState.aliasCuenta);
          formData.append("banco", formState.banco);
          formData.append("numero_cuenta", formState.numeroCuenta);
          formData.append("clabe", formState.clabe);
          formData.append("ultima_4", formState.ultima4);
        }
        if (confirmCreateAccount) {
          formData.append("confirmar_creacion_cuenta", "true");
        }
        if (formState.fechaDesde) formData.append("fecha_desde", formState.fechaDesde);
        if (formState.fechaHasta) formData.append("fecha_hasta", formState.fechaHasta);
        if (formState.saldoInicial) formData.append("saldo_inicial", formState.saldoInicial);
        if (formState.saldoFinal) formData.append("saldo_final", formState.saldoFinal);
        if (formState.observaciones.trim()) {
          formData.append("observaciones", formState.observaciones.trim());
        }

        const response = await fetch(`${FINANZAS_API_BASE}/conciliacion/cargar/?async_job=true`, {
          method: "POST",
          body: formData,
        });
        const body = await readApiBody(response);
        return { response, body };
      };

      let { response, body } = await submitUpload(uploadForm);
      if (
        response.status === 409 &&
        body &&
        typeof body === "object" &&
        "requires_account_creation_confirmation" in body &&
        (body as { requires_account_creation_confirmation?: boolean })
          .requires_account_creation_confirmation
      ) {
        const suggestion = (body as {
          sugerencia_creacion_cuenta?: {
            capa_id?: number;
            capa_nombre?: string;
            titular_detectado?: string;
            nombre_cuenta?: string;
            alias_cuenta?: string | null;
            banco?: string | null;
            numero_cuenta?: string | null;
            clabe?: string | null;
            ultima_4?: string | null;
          };
        }).sugerencia_creacion_cuenta;

        if (suggestion) {
          const shouldCreate = window.confirm(
            `Detectamos la cuenta ${
              suggestion.banco ? `${suggestion.banco} ` : ""
            }${suggestion.ultima_4 ? `****${suggestion.ultima_4} ` : ""}para ${
              suggestion.capa_nombre || suggestion.titular_detectado || "tu negocio"
            }. ¿Quieres crear esta cuenta y continuar con la importación?`
          );
          if (!shouldCreate) {
            setMessage("La importación quedó en pausa para que revises la cuenta bancaria.");
            setUploadForm((current) => ({
              ...current,
              cuentaModo: "new",
              nombreCuenta: suggestion.nombre_cuenta || current.nombreCuenta,
              aliasCuenta: suggestion.alias_cuenta || current.aliasCuenta,
              banco: suggestion.banco || current.banco,
              numeroCuenta: suggestion.numero_cuenta || current.numeroCuenta,
              clabe: suggestion.clabe || current.clabe,
              ultima4: suggestion.ultima_4 || current.ultima4,
            }));
            return;
          }

          const confirmedForm: UploadFormState = {
            ...uploadForm,
            cuentaModo: "new",
            nombreCuenta: suggestion.nombre_cuenta || uploadForm.nombreCuenta,
            aliasCuenta: suggestion.alias_cuenta || uploadForm.aliasCuenta,
            banco: suggestion.banco || uploadForm.banco,
            numeroCuenta: suggestion.numero_cuenta || uploadForm.numeroCuenta,
            clabe: suggestion.clabe || uploadForm.clabe,
            ultima4: suggestion.ultima_4 || uploadForm.ultima4,
          };
          setUploadForm(confirmedForm);
          ({ response, body } = await submitUpload(confirmedForm, true));
        }
      }

      if (!response.ok) {
        throw new Error(getErrorMessage(body, "No se pudo cargar el estado de cuenta."));
      }

      const jobResult =
        body &&
        typeof body === "object" &&
        "accepted" in body &&
        (body as { accepted?: boolean }).accepted
          ? await waitForUploadJob(
              Number((body as unknown as { job_id: number }).job_id)
            )
          : (body as Record<string, unknown>);
      if (jobResult?.requires_account_creation_confirmation) {
        const suggestion = (jobResult as {
          sugerencia_creacion_cuenta?: {
            capa_nombre?: string;
            titular_detectado?: string;
            nombre_cuenta?: string;
            alias_cuenta?: string | null;
            banco?: string | null;
            numero_cuenta?: string | null;
            clabe?: string | null;
            ultima_4?: string | null;
          };
        }).sugerencia_creacion_cuenta;
        if (!suggestion) {
          throw new Error("La carga requiere confirmar la creacion de la cuenta bancaria.");
        }
        const shouldCreate = window.confirm(
          `Detectamos la cuenta ${
            suggestion.banco ? `${suggestion.banco} ` : ""
          }${suggestion.ultima_4 ? `****${suggestion.ultima_4} ` : ""}para ${
            suggestion.capa_nombre || suggestion.titular_detectado || "tu negocio"
          }. Â¿Quieres crear esta cuenta y continuar con la importaciÃ³n?`
        );
        if (!shouldCreate) {
          setMessage("La importaciÃ³n quedÃ³ en pausa para que revises la cuenta bancaria.");
          setUploadForm((current) => ({
            ...current,
            cuentaModo: "new",
            nombreCuenta: suggestion.nombre_cuenta || current.nombreCuenta,
            aliasCuenta: suggestion.alias_cuenta || current.aliasCuenta,
            banco: suggestion.banco || current.banco,
            numeroCuenta: suggestion.numero_cuenta || current.numeroCuenta,
            clabe: suggestion.clabe || current.clabe,
            ultima4: suggestion.ultima_4 || current.ultima4,
          }));
          return;
        }
        const confirmedForm: UploadFormState = {
          ...uploadForm,
          cuentaModo: "new",
          nombreCuenta: suggestion.nombre_cuenta || uploadForm.nombreCuenta,
          aliasCuenta: suggestion.alias_cuenta || uploadForm.aliasCuenta,
          banco: suggestion.banco || uploadForm.banco,
          numeroCuenta: suggestion.numero_cuenta || uploadForm.numeroCuenta,
          clabe: suggestion.clabe || uploadForm.clabe,
          ultima4: suggestion.ultima_4 || uploadForm.ultima4,
        };
        setUploadForm(confirmedForm);
        const confirmed = await submitUpload(confirmedForm, true);
        if (!confirmed.response.ok) {
          throw new Error(
            getErrorMessage(confirmed.body, "No se pudo cargar el estado de cuenta.")
          );
        }
        if (
          confirmed.body &&
          typeof confirmed.body === "object" &&
          "accepted" in confirmed.body &&
          (confirmed.body as { accepted?: boolean }).accepted
        ) {
          await waitForUploadJob(
            Number((confirmed.body as unknown as { job_id: number }).job_id)
          );
        }
      }

      setMessage("Estado de cuenta importado correctamente.");
      setUploadForm((current) => ({
        ...DEFAULT_UPLOAD_FORM,
        cuentaModo: current.cuentaModo,
      }));
      await refreshAll({ ...filters, page: 1 });
    } catch (uploadError) {
      console.error("Error cargando estado de cuenta:", uploadError);
      alert(
        uploadError instanceof Error
          ? uploadError.message
          : "No se pudo cargar el estado de cuenta."
      );
    } finally {
      setIsUploading(false);
    }
  };

  const handleCreateAccount = async () => {
    if (uploadForm.cuentaModo !== "new") return;
    const validationError = getAccountValidationError(uploadForm);
    if (validationError) {
      alert(validationError);
      return;
    }

    setIsSavingAccount(true);
    try {
      const response = await fetch(`${FINANZAS_API_BASE}/conciliacion/cuentas-bancarias/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: uploadForm.nombreCuenta.trim(),
          alias: uploadForm.aliasCuenta.trim(),
          banco: uploadForm.banco.trim(),
          numero_cuenta: uploadForm.numeroCuenta.trim(),
          clabe: uploadForm.clabe.trim(),
          ultima_4: uploadForm.ultima4.trim(),
          moneda: "MXN",
          activa: true,
        }),
      });
      const body = await readApiBody(response);
      if (!response.ok) {
        throw new Error(getErrorMessage(body, "No se pudo guardar la cuenta bancaria."));
      }

      const payload = body as { cuenta?: BankAccount; mensaje?: string };
      const createdAccount = payload.cuenta;
      await loadAccounts();
      if (createdAccount?.id) {
        await loadLoads(String(createdAccount.id));
      }
      setUploadForm((current) => ({
        ...current,
        cuentaModo: "existing",
        cuentaId: createdAccount?.id ? String(createdAccount.id) : current.cuentaId,
      }));
      setMessage(payload.mensaje || "Cuenta bancaria guardada correctamente.");
      setError("");
    } catch (saveError) {
      console.error("Error guardando cuenta bancaria:", saveError);
      alert(
        saveError instanceof Error
          ? saveError.message
          : "No se pudo guardar la cuenta bancaria."
      );
    } finally {
      setIsSavingAccount(false);
    }
  };

  const handleStartEditAccount = (account: BankAccount) => {
    setAccountForm(buildAccountFormState(account));
    setMessage("");
    setError("");
  };

  const handleUpdateAccount = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!accountForm) return;
    const validationError = getAccountValidationError(accountForm);
    if (validationError) {
      alert(validationError);
      return;
    }

    setIsSavingAccount(true);
    try {
      const response = await fetch(
        `${FINANZAS_API_BASE}/conciliacion/cuentas-bancarias/${accountForm.id}/`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nombre: accountForm.nombre.trim(),
            alias: accountForm.alias.trim(),
            banco: accountForm.banco.trim(),
            numero_cuenta: accountForm.numeroCuenta.trim(),
            clabe: accountForm.clabe.trim(),
            ultima_4: accountForm.ultima4.trim(),
            moneda: accountForm.moneda.trim() || "MXN",
            activa: accountForm.activa,
          }),
        }
      );
      const body = await readApiBody(response);
      if (!response.ok) {
        throw new Error(getErrorMessage(body, "No se pudo actualizar la cuenta bancaria."));
      }

      const payload = body as { cuenta?: BankAccount; mensaje?: string };
      await refreshAll(filters);
      if (payload.cuenta?.id) {
        setUploadForm((current) => ({
          ...current,
          cuentaModo: "existing",
          cuentaId: String(payload.cuenta?.id),
        }));
      }
      setAccountForm(null);
      setMessage(payload.mensaje || "Cuenta bancaria actualizada correctamente.");
      setError("");
    } catch (updateError) {
      console.error("Error actualizando cuenta bancaria:", updateError);
      alert(
        updateError instanceof Error
          ? updateError.message
          : "No se pudo actualizar la cuenta bancaria."
      );
    } finally {
      setIsSavingAccount(false);
    }
  };

  const handleRequestDeleteAccount = (account: BankAccount) => {
    const hasHistory =
      (account.lotes_cargados ?? 0) > 0 || (account.movimientos_registrados ?? 0) > 0;
    setDeleteAccount({ account, hasHistory });
    setMessage("");
    setError("");
  };

  const handleConfirmDeleteAccount = async () => {
    if (!deleteAccount) return;
    const account = deleteAccount.account;

    setIsDeletingAccount(true);
    try {
      const response = await fetch(
        `${FINANZAS_API_BASE}/conciliacion/cuentas-bancarias/${account.id}/`,
        { method: "DELETE" }
      );
      const body = await readApiBody(response);
      if (!response.ok) {
        throw new Error(getErrorMessage(body, "No se pudo borrar la cuenta bancaria."));
      }

      const payload = body as { mensaje?: string };
      if (String(account.id) === filters.cuentaId) {
        updateFilters({ cuentaId: "", page: 1 });
      } else {
        await refreshAll(filters);
      }
      if (String(account.id) === uploadForm.cuentaId) {
        setUploadForm((current) => ({ ...current, cuentaId: "" }));
      }
      if (accountForm?.id === account.id) {
        setAccountForm(null);
      }
      setDeleteAccount(null);
      setMessage(payload.mensaje || "Cuenta bancaria borrada correctamente.");
      setError("");
    } catch (deleteError) {
      console.error("Error borrando cuenta bancaria:", deleteError);
      alert(
        deleteError instanceof Error
          ? deleteError.message
          : "No se pudo borrar la cuenta bancaria."
      );
    } finally {
      setIsDeletingAccount(false);
    }
  };

  const handleAutoLink = async (transactionId: number) => {
    setIsWorking(true);
    try {
      const response = await fetch(
        `${FINANZAS_API_BASE}/conciliacion/transacciones/${transactionId}/auto-vincular/?include_detail=false&include_event_detail=false&include_transaction=false`,
        { method: "POST" }
      );
      const body = await readApiBody(response);
      if (!response.ok) {
        throw new Error(getErrorMessage(body, "No se pudo auto-vincular el movimiento."));
      }
      setMessage("Se ejecutó la búsqueda automática para el movimiento.");
      await refreshAll(filters);
      await loadTransactionDetail(transactionId);
    } catch (actionError) {
      console.error("Error auto-vinculando movimiento:", actionError);
      alert(
        actionError instanceof Error
          ? actionError.message
          : "No se pudo auto-vincular el movimiento."
      );
    } finally {
      setIsWorking(false);
    }
  };

  const handleAutoReconcilePending = async () => {
    setIsAutoReconciling(true);
    setError("");
    try {
      const response = await fetch(
        `${FINANZAS_API_BASE}/conciliacion/auto-conciliar-pendientes/`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cuenta_bancaria_id: filters.cuentaId ? Number(filters.cuentaId) : null,
            limite: 500,
          }),
        }
      );
      const body = await readApiBody(response);
      if (!response.ok) {
        throw new Error(getErrorMessage(body, "No se pudo ejecutar la conciliacion automatica."));
      }
      const result = (body as { resultado?: Record<string, number> }).resultado || {};
      setMessage(
        `Conciliacion automatica: ${result.aplicados || 0} aplicados, ${result.ambiguos || 0} ambiguos, ${result.sin_candidato || 0} sin candidato.`
      );
      await refreshAll({ ...filters, page: 1 });
      if (selectedTransaction) {
        await loadTransactionDetail(selectedTransaction.transaccion.id);
      }
    } catch (actionError) {
      console.error("Error conciliando pendientes:", actionError);
      alert(
        actionError instanceof Error
          ? actionError.message
          : "No se pudo ejecutar la conciliacion automatica."
      );
    } finally {
      setIsAutoReconciling(false);
    }
  };

  const handleApplyCxC = async (cuentaId: number) => {
    if (!selectedTransaction) return;
    setIsWorking(true);
    try {
      const response = await fetch(
        `${FINANZAS_API_BASE}/conciliacion/transacciones/${selectedTransaction.transaccion.id}/aplicar-cxc/?include_transaction=false`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cuenta_id: cuentaId }),
        }
      );
      const body = await readApiBody(response);
      if (!response.ok) {
        throw new Error(getErrorMessage(body, "No se pudo aplicar el movimiento a CxC."));
      }
      setMessage("Movimiento aplicado a la cuenta por cobrar.");
      await refreshAll(filters);
      await loadTransactionDetail(selectedTransaction.transaccion.id);
    } catch (actionError) {
      console.error("Error aplicando CxC:", actionError);
      alert(
        actionError instanceof Error
          ? actionError.message
          : "No se pudo aplicar el movimiento a CxC."
      );
    } finally {
      setIsWorking(false);
    }
  };

  const handleApplyCxP = async (cuentaId: number) => {
    if (!selectedTransaction) return;
    setIsWorking(true);
    try {
      const response = await fetch(
        `${FINANZAS_API_BASE}/conciliacion/transacciones/${selectedTransaction.transaccion.id}/aplicar-cxp/?include_transaction=false`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cuenta_id: cuentaId }),
        }
      );
      const body = await readApiBody(response);
      if (!response.ok) {
        throw new Error(getErrorMessage(body, "No se pudo aplicar el movimiento a CxP."));
      }
      setMessage("Movimiento aplicado a la cuenta por pagar.");
      await refreshAll(filters);
      await loadTransactionDetail(selectedTransaction.transaccion.id);
    } catch (actionError) {
      console.error("Error aplicando CxP:", actionError);
      alert(
        actionError instanceof Error
          ? actionError.message
          : "No se pudo aplicar el movimiento a CxP."
      );
    } finally {
      setIsWorking(false);
    }
  };

  const openSuggestionReview = (suggestion: ReconciliationSuggestion) => {
    setSelectedSuggestion(suggestion);
    setSuggestionNote(buildSuggestionNote(suggestion));
    setError("");
  };

  const closeSuggestionReview = () => {
    setSelectedSuggestion(null);
    setSuggestionNote("");
    setError("");
  };

  const openSuggestedTransactionDetail = async (suggestion: ReconciliationSuggestion) => {
    closeSuggestionReview();
    await loadTransactionDetail(suggestion.transaccion.id);
  };

  const handleApplySuggestion = async (suggestion: ReconciliationSuggestion) => {
    const note = suggestionNote.trim();
    if (note.length < 3) {
      setError("Agrega una nota breve antes de aplicar la sugerencia.");
      return;
    }
    const readiness = getSuggestionReadiness(suggestion);
    setIsWorking(true);
    try {
      const endpoint =
        suggestion.tipo === "CXC"
          ? `${FINANZAS_API_BASE}/conciliacion/transacciones/${suggestion.transaccion.id}/aplicar-cxc/?include_transaction=false`
          : `${FINANZAS_API_BASE}/conciliacion/transacciones/${suggestion.transaccion.id}/aplicar-cxp/?include_transaction=false`;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cuenta_id: suggestion.candidato.id,
          notas: note,
          sugerencia_id: suggestion.id,
          sugerencia_score: suggestion.score,
          sugerencia_confianza:
            suggestion.confidence_band || suggestion.candidato.confidence_band || "",
          sugerencia_estado: readiness?.state || "",
          sugerencia_requiere_revision:
            readiness?.requires_manual_review ?? suggestion.review_required ?? false,
          sugerencia_razones: suggestion.reasons || suggestion.candidato.reasons || [],
        }),
      });
      const body = await readApiBody(response);
      if (!response.ok) {
        throw new Error(getErrorMessage(body, "No se pudo aplicar la sugerencia."));
      }
      setMessage(`Sugerencia aplicada a ${suggestion.tipo}.`);
      closeSuggestionReview();
      await refreshAll(filters);
    } catch (actionError) {
      console.error("Error aplicando sugerencia:", actionError);
      alert(
        actionError instanceof Error
          ? actionError.message
          : "No se pudo aplicar la sugerencia."
      );
    } finally {
      setIsWorking(false);
    }
  };

  const handleUpdateTransactionStatus = async (status: string) => {
    if (!selectedTransaction) return;
    setIsWorking(true);
    try {
      const response = await fetch(
        `${FINANZAS_API_BASE}/conciliacion/transacciones/${selectedTransaction.transaccion.id}/estatus/`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ estatus: status }),
        }
      );
      const body = await readApiBody(response);
      if (!response.ok) {
        throw new Error(getErrorMessage(body, "No se pudo actualizar el estatus."));
      }
      setMessage("Estatus del movimiento actualizado.");
      await refreshAll(filters);
      await loadTransactionDetail(selectedTransaction.transaccion.id);
    } catch (actionError) {
      console.error("Error actualizando estatus:", actionError);
      alert(
        actionError instanceof Error
          ? actionError.message
          : "No se pudo actualizar el estatus del movimiento."
      );
    } finally {
      setIsWorking(false);
    }
  };

  const handleQuickValidateTransaction = async (transactionId: number) => {
    setIsWorking(true);
    try {
      const response = await fetch(
        `${FINANZAS_API_BASE}/conciliacion/transacciones/${transactionId}/estatus/`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ estatus: "VALIDADO" }),
        }
      );
      const body = await readApiBody(response);
      if (!response.ok) {
        throw new Error(getErrorMessage(body, "No se pudo validar el movimiento."));
      }
      setMessage("Movimiento validado correctamente.");
      await refreshAll(filters);
      if (selectedTransaction?.transaccion.id === transactionId) {
        await loadTransactionDetail(transactionId);
      }
    } catch (actionError) {
      console.error("Error validando movimiento:", actionError);
      alert(
        actionError instanceof Error
          ? actionError.message
          : "No se pudo validar el movimiento."
      );
    } finally {
      setIsWorking(false);
    }
  };

  const requestStatusUpdate = (
    transaction: TransactionRow,
    status: "EN_ESPERA" | "NO_IDENTIFICADO",
  ) => {
    setStatusUpdate({
      transactionId: transaction.id,
      status,
      reference:
        transaction.numero_referencia ||
        transaction.folio_bancario ||
        transaction.concepto_bancario ||
        `Movimiento ${transaction.id}`,
      currentNote: transaction.notas_conciliacion || "",
      note:
        status === "NO_IDENTIFICADO"
          ? "No se encontro candidato confiable en CxC, CxP o eventos."
          : "Se reabre para nueva revision operativa.",
    });
    setError("");
  };

  const handleConfirmStatusUpdate = async () => {
    if (!statusUpdate) return;
    const note = statusUpdate.note.trim();
    if (note.length < 3) {
      setError("Agrega una nota breve para guardar el motivo del cambio.");
      return;
    }
    setIsWorking(true);
    try {
      const response = await fetch(
        `${FINANZAS_API_BASE}/conciliacion/transacciones/${statusUpdate.transactionId}/estatus/`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            estatus: statusUpdate.status,
            notas: note,
          }),
        }
      );
      const body = await readApiBody(response);
      if (!response.ok) {
        throw new Error(getErrorMessage(body, "No se pudo actualizar el movimiento."));
      }
      setMessage(
        statusUpdate.status === "NO_IDENTIFICADO"
          ? "Movimiento marcado como no identificado."
          : "Movimiento reabierto para revision."
      );
      await refreshAll(filters);
      if (selectedTransaction?.transaccion.id === statusUpdate.transactionId) {
        await loadTransactionDetail(statusUpdate.transactionId);
      }
      setStatusUpdate(null);
      setError("");
    } catch (actionError) {
      console.error("Error actualizando movimiento:", actionError);
      alert(
        actionError instanceof Error
          ? actionError.message
          : "No se pudo actualizar el movimiento."
      );
    } finally {
      setIsWorking(false);
    }
  };

  const handleRequestDeleteLoad = (load: LoadItem) => {
    setDeleteLoad({ load, confirmReversal: false, confirmPhrase: "" });
    setMessage("");
    setError("");
  };

  const handleConfirmDeleteLoad = async () => {
    if (!deleteLoad) return;
    const confirmPhrase = deleteLoad.confirmPhrase.trim().toUpperCase();
    if (!deleteLoad.confirmReversal || confirmPhrase !== "ELIMINAR") {
      setError("Confirma la reversa de pagos y escribe ELIMINAR para continuar.");
      return;
    }

    const load = deleteLoad.load;
    const params = new URLSearchParams({
      forzar: "true",
      confirmacion: "ELIMINAR",
    });
    setIsDeletingLoad(true);
    try {
      const response = await fetch(
        `${FINANZAS_API_BASE}/conciliacion/cargas/${load.id}/?${params.toString()}`,
        {
          method: "DELETE",
        }
      );
      const body = await readApiBody(response);
      if (!response.ok) {
        throw new Error(getErrorMessage(body, "No se pudo eliminar la carga bancaria."));
      }
      setSelectedTransaction((current) =>
        current?.transaccion.carga_id === load.id ? null : current
      );
      setDeleteLoad(null);
      const responseData =
        body && typeof body === "object" ? (body as Record<string, unknown>) : {};
      const pagosCxc = Number(responseData.pagos_cxc_revertidos ?? 0);
      const pagosCxp = Number(responseData.pagos_cxp_revertidos ?? 0);
      const eventos = Number(responseData.eventos_reabiertos ?? 0);
      const resumen =
        pagosCxc || pagosCxp || eventos
          ? ` Pagos CxC revertidos: ${pagosCxc}. Pagos CxP revertidos: ${pagosCxp}. Eventos reabiertos: ${eventos}.`
          : "";
      setMessage(
        `${getErrorMessage(body, "La carga bancaria se elimino correctamente.")}${resumen}`
      );
      setError("");
      await refreshAll({ ...filters, page: 1 });
    } catch (deleteError) {
      console.error("Error eliminando carga bancaria:", deleteError);
      setDeleteLoad(null);
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "No se pudo eliminar la carga bancaria."
      );
    } finally {
      setIsDeletingLoad(false);
    }
  };

  const canConfirmDeleteLoad = Boolean(
    deleteLoad?.confirmReversal &&
      deleteLoad.confirmPhrase.trim().toUpperCase() === "ELIMINAR"
  );

  return (
    <section className="page-section">
      <FinanceInfoModal info={infoModal} onClose={() => setInfoModal(null)} />
      <div className="border-b border-zinc-800 pb-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs uppercase tracking-[0.28em] text-cyan-300">
              Conciliación bancaria
            </p>
            <FinanceInfoButton info={conciliacionInfo.modulo} onOpen={setInfoModal} />
          </div>
          <h2 className="mt-2 text-xl font-bold text-white">
            Bancos, estados de cuenta y movimientos en una sola vista.
          </h2>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-zinc-500">
            Separa cuentas, cargas y movimientos para que la conciliación se
            opere por etapas, con menos ruido visual y más contexto útil.
          </p>
        </div>
      </div>

      <div className="mt-4 work-tab-bar">
        <BankTabButton
          active={activeTab === "importar"}
          label="Bancos"
          helper="Consulta cuentas bancarias y carga estados o archivos."
          onClick={() => selectTab("importar")}
        />
        <BankTabButton
          active={activeTab === "lotes"}
          label="Cargas"
          helper="Revisa cuadre, diferencias y lotes pendientes."
          onClick={() => selectTab("lotes")}
        />
        <BankTabButton
          active={activeTab === "movimientos"}
          label="Movimientos"
          helper="Filtra, ordena, valida y asigna movimientos en una sola mesa."
          onClick={() => selectTab("movimientos")}
        />
        <BankTabButton
          active={activeTab === "sugerencias"}
          label="Sugerencias"
          helper="Compara candidatos y decide que pagos aplicar."
          onClick={() => selectTab("sugerencias")}
        />
      </div>

      {activeTab === "importar" ? (
      <div className="mt-6 rounded-3xl border border-zinc-800 bg-zinc-950/80 p-5">
        <div className="flex flex-col gap-3 border-b border-zinc-800 pb-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
              Bancos de la capa activa
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-semibold text-white">
                Empieza por la cuenta bancaria que vas a conciliar
              </h3>
              <FinanceInfoButton info={conciliacionInfo.cuentas} onOpen={setInfoModal} />
            </div>
            <p className="mt-1 text-sm text-zinc-500">
              Revisa saldos, último periodo cargado y entra directo a cargar el
              estado de cuenta o a consultar los movimientos de ese banco.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                selectTab("movimientos");
                clearMovementFilters();
              }}
              className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-800"
            >
              Ver todos los movimientos
            </button>
            <button
              type="button"
              onClick={() =>
                setUploadForm((current) => ({
                  ...DEFAULT_UPLOAD_FORM,
                  cuentaModo: current.cuentaId ? "existing" : current.cuentaModo,
                  cuentaId: current.cuentaId,
                }))
              }
              className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20"
            >
              Nueva carga
            </button>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto rounded-2xl border border-zinc-800 bg-zinc-950/70">
          {accounts.length === 0 ? (
            <div className="py-12 text-center text-sm text-zinc-500">
              Aún no hay cuentas bancarias registradas para esta capa de negocio.
            </div>
          ) : (
            <div>
              <div className="grid min-w-[1080px] grid-cols-[minmax(260px,1.3fr)_150px_140px_140px_190px_110px_178px] gap-4 border-b border-zinc-800 bg-zinc-900/45 px-4 py-3 text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                <p>Cuenta</p>
                <p>Periodo</p>
                <p>Saldo inicial</p>
                <p>Saldo final</p>
                <p>Ingresos / egresos</p>
                <p>Movs.</p>
                <p className="text-right">Acciones</p>
              </div>
              {accounts.map((account) => (
                <AccountOverviewCard
                  key={account.id}
                  account={account}
                  active={String(account.id) === filters.cuentaId}
                  onUseForMovements={() => applyAccountContext(String(account.id), "movimientos")}
                  onUseForImport={() => applyAccountContext(String(account.id), "importar")}
                  onEdit={() => handleStartEditAccount(account)}
                  onDelete={() => handleRequestDeleteAccount(account)}
                  disabled={isSavingAccount || isDeletingAccount}
                />
              ))}
            </div>
          )}
        </div>

        {accountForm ? (
          <form
            onSubmit={handleUpdateAccount}
            className="mt-4 rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4"
          >
            <div className="flex flex-col gap-2 border-b border-cyan-500/10 pb-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs uppercase tracking-[0.22em] text-cyan-200">
                    Editar cuenta bancaria
                  </p>
                  <FinanceInfoButton info={conciliacionInfo.cuentas} onOpen={setInfoModal} />
                </div>
                <p className="mt-1 text-sm text-zinc-400">
                  CLABE, número de cuenta y banco se validan para evitar duplicados en esta capa.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAccountForm(null)}
                className="w-fit rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-800"
              >
                Cancelar
              </button>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950/70 px-3 py-2 text-xs text-zinc-400 md:col-span-2 xl:col-span-4">
                <span className="uppercase tracking-[0.16em] text-zinc-500">
                  Ayuda de campos
                </span>
                <FinanceInfoButton info={conciliacionInfo.cuentaNombre} onOpen={setInfoModal} />
                <FinanceInfoButton info={conciliacionInfo.banco} onOpen={setInfoModal} />
                <FinanceInfoButton info={conciliacionInfo.numeroCuenta} onOpen={setInfoModal} />
                <FinanceInfoButton info={conciliacionInfo.clabe} onOpen={setInfoModal} />
                <FinanceInfoButton info={conciliacionInfo.ultima4} onOpen={setInfoModal} />
                <FinanceInfoButton info={conciliacionInfo.moneda} onOpen={setInfoModal} />
              </div>
              <input
                type="text"
                placeholder="Nombre de la cuenta"
                value={accountForm.nombre}
                maxLength={TEXT_LIMITS.accountName}
                onChange={(event) =>
                  setAccountForm((current) =>
                    current
                      ? { ...current, nombre: sanitizeShortText(event.target.value, TEXT_LIMITS.accountName) }
                      : current
                  )
                }
                className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none placeholder:text-zinc-500 focus:ring-1 focus:ring-cyan-500"
              />
              <input
                type="text"
                placeholder="Alias interno"
                value={accountForm.alias}
                maxLength={TEXT_LIMITS.accountAlias}
                onChange={(event) =>
                  setAccountForm((current) =>
                    current
                      ? { ...current, alias: sanitizeShortText(event.target.value, TEXT_LIMITS.accountAlias) }
                      : current
                  )
                }
                className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none placeholder:text-zinc-500 focus:ring-1 focus:ring-cyan-500"
              />
              <input
                type="text"
                placeholder="Banco"
                value={accountForm.banco}
                maxLength={TEXT_LIMITS.bank}
                onChange={(event) =>
                  setAccountForm((current) =>
                    current ? { ...current, banco: sanitizeShortText(event.target.value, TEXT_LIMITS.bank) } : current
                  )
                }
                className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none placeholder:text-zinc-500 focus:ring-1 focus:ring-cyan-500"
              />
              <input
                type="text"
                placeholder="Moneda"
                value={accountForm.moneda}
                maxLength={TEXT_LIMITS.currency}
                onChange={(event) =>
                  setAccountForm((current) =>
                    current ? { ...current, moneda: sanitizeCurrencyCode(event.target.value) } : current
                  )
                }
                className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm uppercase text-white outline-none placeholder:text-zinc-500 focus:ring-1 focus:ring-cyan-500"
              />
              <input
                type="text"
                placeholder="Número de cuenta"
                value={accountForm.numeroCuenta}
                inputMode="numeric"
                maxLength={20}
                onChange={(event) =>
                  setAccountForm((current) =>
                    current ? { ...current, numeroCuenta: sanitizeDigits(event.target.value, 20) } : current
                  )
                }
                className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none placeholder:text-zinc-500 focus:ring-1 focus:ring-cyan-500"
              />
              <input
                type="text"
                placeholder="CLABE"
                value={accountForm.clabe}
                inputMode="numeric"
                maxLength={18}
                onChange={(event) =>
                  setAccountForm((current) =>
                    current ? { ...current, clabe: sanitizeDigits(event.target.value, 18) } : current
                  )
                }
                className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none placeholder:text-zinc-500 focus:ring-1 focus:ring-cyan-500"
              />
              <input
                type="text"
                placeholder="Últimos 4 dígitos"
                value={accountForm.ultima4}
                inputMode="numeric"
                maxLength={4}
                onChange={(event) =>
                  setAccountForm((current) =>
                    current ? { ...current, ultima4: sanitizeDigits(event.target.value, 4) } : current
                  )
                }
                className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none placeholder:text-zinc-500 focus:ring-1 focus:ring-cyan-500"
              />
              <button
                type="submit"
                disabled={isSavingAccount}
                className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-2.5 text-sm font-medium text-cyan-100 transition-colors hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSavingAccount ? "Guardando..." : "Guardar cambios"}
              </button>
            </div>
          </form>
        ) : null}
      </div>
      ) : null}

      {message ? (
        <div className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          {message}
        </div>
      ) : null}

      {error ? (
        <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      ) : null}

      {deleteAccount ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-3xl border border-red-500/20 bg-zinc-950 p-5 shadow-[0_24px_90px_rgba(0,0,0,0.55)]">
            <div className="flex items-start gap-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-red-500/25 bg-red-500/10 text-red-200">
                <AccountActionIcon kind="delete" />
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-red-200">
                  Confirmar borrado
                </p>
                <h3 className="mt-2 text-xl font-semibold text-white">
                  ¿Seguro que quieres borrar esta cuenta?
                </h3>
                <p className="mt-3 text-sm leading-6 text-zinc-400">
                  Esta acción no tiene vuelta atrás para cuentas sin historial. Si la cuenta ya
                  tiene movimientos o cargas, se desactivará para conservar la información de
                  conciliaciones anteriores.
                </p>
              </div>
            </div>

            <div className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
              <p className="text-sm font-semibold text-white">
                {deleteAccount.account.nombre}
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                {buildAccountLabel(deleteAccount.account)}
              </p>
              <p className="mt-3 text-xs uppercase tracking-[0.16em] text-zinc-500">
                {deleteAccount.hasHistory
                  ? "Tiene historial: se desactivará."
                  : "Sin historial: se eliminará permanentemente."}
              </p>
            </div>

            <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setDeleteAccount(null)}
                disabled={isDeletingAccount}
                className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmDeleteAccount()}
                disabled={isDeletingAccount}
                className="rounded-xl border border-red-500/30 bg-red-500/15 px-4 py-2 text-sm font-semibold text-red-100 transition-colors hover:bg-red-500/25 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isDeletingAccount ? "Borrando..." : "Sí, borrar cuenta"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {deleteLoad ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-3xl border border-red-500/20 bg-zinc-950 p-5 shadow-[0_24px_90px_rgba(0,0,0,0.55)]">
            <div className="flex items-start gap-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-red-500/25 bg-red-500/10 text-red-200">
                <AccountActionIcon kind="delete" />
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-red-200">
                  Confirmar eliminacion
                </p>
                <h3 className="mt-2 text-xl font-semibold text-white">
                  Eliminar esta carga bancaria
                </h3>
                <p className="mt-3 text-sm leading-6 text-zinc-400">
                  Esta accion borra el archivo cargado y sus movimientos asociados. Si la
                  carga ya tiene CxC, CxP o eventos conciliados, el sistema quitara esos
                  pagos, recalculara saldos y dejara los eventos como no identificados.
                  No hay vuelta atras una vez confirmada.
                </p>
              </div>
            </div>

            <div className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
              <p className="text-sm font-semibold text-white">
                {deleteLoad.load.nombre_archivo || `Carga #${deleteLoad.load.id}`}
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                {deleteLoad.load.cuenta_bancaria_nombre || "Sin cuenta"} |{" "}
                {formatDate(deleteLoad.load.fecha_carga)}
              </p>
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <LoadStatCell
                  label="Ingresos"
                  value={formatCurrency(deleteLoad.load.total_ingresos)}
                  tone="positive"
                />
                <LoadStatCell
                  label="Egresos"
                  value={formatCurrency(deleteLoad.load.total_egresos)}
                  tone="negative"
                />
                <LoadStatCell
                  label="Procesados"
                  value={String(deleteLoad.load.registros_detectados)}
                />
                <LoadStatCell
                  label="Duplicados"
                  value={String(deleteLoad.load.registros_duplicados)}
                  tone="muted"
                />
              </div>
            </div>

            <div className="mt-5 space-y-3 rounded-2xl border border-red-500/20 bg-red-500/10 p-4">
              <label className="flex items-start gap-3 text-sm leading-6 text-red-100">
                <input
                  type="checkbox"
                  checked={deleteLoad.confirmReversal}
                  onChange={(event) =>
                    setDeleteLoad((current) =>
                      current
                        ? { ...current, confirmReversal: event.target.checked }
                        : current
                    )
                  }
                  className="mt-1 h-4 w-4 rounded border-red-300/40 bg-zinc-950 text-red-400"
                />
                <span>
                  Entiendo que se revertiran los pagos aplicados a CxC/CxP y que los
                  movimientos de esta carga se eliminaran.
                </span>
              </label>
              <div>
                <label className="text-xs uppercase tracking-[0.22em] text-red-200">
                  Escribe ELIMINAR
                </label>
                <input
                  type="text"
                  value={deleteLoad.confirmPhrase}
                  onChange={(event) =>
                    setDeleteLoad((current) =>
                      current
                        ? { ...current, confirmPhrase: event.target.value }
                        : current
                    )
                  }
                  className="mt-2 w-full rounded-xl border border-red-500/20 bg-zinc-950 px-3 py-2 text-sm font-semibold uppercase tracking-[0.18em] text-white outline-none transition-colors placeholder:text-zinc-600 focus:border-red-300/60"
                  placeholder="ELIMINAR"
                />
              </div>
            </div>

            <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setDeleteLoad(null)}
                disabled={isDeletingLoad}
                className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmDeleteLoad()}
                disabled={isDeletingLoad || !canConfirmDeleteLoad}
                className="rounded-xl border border-red-500/30 bg-red-500/15 px-4 py-2 text-sm font-semibold text-red-100 transition-colors hover:bg-red-500/25 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isDeletingLoad ? "Eliminando..." : "Revertir y eliminar carga"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === "importar" ? (
        <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
        <form
          onSubmit={handleUpload}
          className="rounded-3xl border border-zinc-800 bg-zinc-950/80 p-5"
        >
          <div className="border-b border-zinc-800 pb-4">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-semibold text-white">Cargar movimientos o estado de cuenta</h3>
              <FinanceInfoButton info={conciliacionInfo.carga} onOpen={setInfoModal} />
            </div>
            <p className="mt-1 text-sm text-zinc-500">
              La carga soporta Excel, CSV y PDF. Si subes un estado de cuenta oficial,
              el sistema intentará leer fechas, saldos y movimientos para cuadrar la
              apertura y el cierre del periodo.
            </p>
          </div>

          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-2 gap-2 rounded-2xl border border-zinc-800 bg-zinc-950 p-1">
              <button
                type="button"
                onClick={() =>
                  setUploadForm((current) => ({ ...current, cuentaModo: "existing" }))
                }
                className={`rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
                  uploadForm.cuentaModo === "existing"
                    ? "bg-cyan-600 text-white"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                Cuenta existente
              </button>
              <button
                type="button"
                onClick={() =>
                  setUploadForm((current) => ({ ...current, cuentaModo: "new" }))
                }
                className={`rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
                  uploadForm.cuentaModo === "new"
                    ? "bg-cyan-600 text-white"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                Crear cuenta
              </button>
            </div>

            {uploadForm.cuentaModo === "existing" ? (
              <label className="block">
                <FinanceFieldLabel optional info={conciliacionInfo.cuentas} onInfo={setInfoModal}>
                  Cuenta bancaria
                </FinanceFieldLabel>
                <select
                  value={uploadForm.cuentaId}
                  onChange={(event) =>
                    setUploadForm((current) => ({ ...current, cuentaId: event.target.value }))
                  }
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-200 outline-none focus:ring-1 focus:ring-cyan-500"
                >
                  <option value="">Selecciona una cuenta bancaria</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.nombre}
                      {account.capa_nombre ? ` | ${account.capa_nombre}` : ""}
                      {account.banco ? ` | ${account.banco}` : ""}
                      {account.ultima_4 ? ` | ****${account.ultima_4}` : ""}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 px-4 py-3 text-sm text-cyan-100 md:col-span-2">
                  La cuenta bancaria se asociará automáticamente a tu capa de negocio activa.
                </div>
                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950/70 px-3 py-2 text-xs text-zinc-400 md:col-span-2">
                  <span className="uppercase tracking-[0.16em] text-zinc-500">
                    Ayuda de campos
                  </span>
                  <FinanceInfoButton info={conciliacionInfo.cuentaNombre} onOpen={setInfoModal} />
                  <FinanceInfoButton info={conciliacionInfo.banco} onOpen={setInfoModal} />
                  <FinanceInfoButton info={conciliacionInfo.numeroCuenta} onOpen={setInfoModal} />
                  <FinanceInfoButton info={conciliacionInfo.clabe} onOpen={setInfoModal} />
                  <FinanceInfoButton info={conciliacionInfo.ultima4} onOpen={setInfoModal} />
                </div>
                <input
                  type="text"
                  placeholder="Nombre de la cuenta"
                  value={uploadForm.nombreCuenta}
                  maxLength={TEXT_LIMITS.accountName}
                  onChange={(event) =>
                    setUploadForm((current) => ({
                      ...current,
                      nombreCuenta: sanitizeShortText(event.target.value, TEXT_LIMITS.accountName),
                    }))
                  }
                  className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none placeholder:text-zinc-500 focus:ring-1 focus:ring-cyan-500"
                />
                <input
                  type="text"
                  placeholder="Alias interno"
                  value={uploadForm.aliasCuenta}
                  maxLength={TEXT_LIMITS.accountAlias}
                  onChange={(event) =>
                    setUploadForm((current) => ({
                      ...current,
                      aliasCuenta: sanitizeShortText(event.target.value, TEXT_LIMITS.accountAlias),
                    }))
                  }
                  className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none placeholder:text-zinc-500 focus:ring-1 focus:ring-cyan-500"
                />
                <input
                  type="text"
                  placeholder="Banco"
                  value={uploadForm.banco}
                  maxLength={TEXT_LIMITS.bank}
                  onChange={(event) =>
                    setUploadForm((current) => ({
                      ...current,
                      banco: sanitizeShortText(event.target.value, TEXT_LIMITS.bank),
                    }))
                  }
                  className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none placeholder:text-zinc-500 focus:ring-1 focus:ring-cyan-500"
                />
                <input
                  type="text"
                  placeholder="Número de cuenta"
                  value={uploadForm.numeroCuenta}
                  inputMode="numeric"
                  maxLength={20}
                  onChange={(event) =>
                    setUploadForm((current) => ({
                      ...current,
                      numeroCuenta: sanitizeDigits(event.target.value, 20),
                    }))
                  }
                  className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none placeholder:text-zinc-500 focus:ring-1 focus:ring-cyan-500"
                />
                <input
                  type="text"
                  placeholder="CLABE"
                  value={uploadForm.clabe}
                  inputMode="numeric"
                  maxLength={18}
                  onChange={(event) =>
                    setUploadForm((current) => ({ ...current, clabe: sanitizeDigits(event.target.value, 18) }))
                  }
                  className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none placeholder:text-zinc-500 focus:ring-1 focus:ring-cyan-500"
                />
                <input
                  type="text"
                  placeholder="Últimos 4 dígitos"
                  value={uploadForm.ultima4}
                  inputMode="numeric"
                  maxLength={4}
                  onChange={(event) =>
                    setUploadForm((current) => ({ ...current, ultima4: sanitizeDigits(event.target.value, 4) }))
                  }
                  className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none placeholder:text-zinc-500 focus:ring-1 focus:ring-cyan-500"
                />
                <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-3 text-sm text-zinc-400 md:col-span-2">
                  <p>
                    Puedes guardar la cuenta bancaria antes de importar el archivo, o dejar que el
                    sistema la cree durante la carga si detecta una cuenta nueva para la misma capa de negocio.
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => void handleCreateAccount()}
                      disabled={isSavingAccount || isUploading}
                      className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-200 transition-colors hover:bg-cyan-500/15 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isSavingAccount ? "Guardando cuenta..." : "Guardar cuenta bancaria"}
                    </button>
                    <p className="text-xs text-zinc-500">
                      Al guardarla, quedará seleccionada automáticamente para esta importación.
                    </p>
                  </div>
                </div>
              </div>
            )}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <label>
                <FinanceFieldLabel optional info={conciliacionInfo.periodo} onInfo={setInfoModal}>
                  Fecha desde
                </FinanceFieldLabel>
                <input
                  type="date"
                  value={uploadForm.fechaDesde}
                  onChange={(event) =>
                    setUploadForm((current) => ({ ...current, fechaDesde: event.target.value }))
                  }
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-200 outline-none focus:ring-1 focus:ring-cyan-500"
                />
              </label>
              <label>
                <FinanceFieldLabel optional info={conciliacionInfo.periodo} onInfo={setInfoModal}>
                  Fecha hasta
                </FinanceFieldLabel>
                <input
                  type="date"
                  value={uploadForm.fechaHasta}
                  min={uploadForm.fechaDesde || undefined}
                  onChange={(event) =>
                    setUploadForm((current) => ({ ...current, fechaHasta: event.target.value }))
                  }
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-200 outline-none focus:ring-1 focus:ring-cyan-500"
                />
              </label>
              <label>
                <FinanceFieldLabel optional info={conciliacionInfo.saldos} onInfo={setInfoModal}>
                  Saldo inicial
                </FinanceFieldLabel>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={uploadForm.saldoInicial}
                  onChange={(event) =>
                    setUploadForm((current) => ({
                      ...current,
                      saldoInicial: sanitizeMoneyInput(event.target.value, true),
                    }))
                  }
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none placeholder:text-zinc-500 focus:ring-1 focus:ring-cyan-500"
                />
              </label>
              <label>
                <FinanceFieldLabel optional info={conciliacionInfo.saldos} onInfo={setInfoModal}>
                  Saldo final
                </FinanceFieldLabel>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={uploadForm.saldoFinal}
                  onChange={(event) =>
                    setUploadForm((current) => ({
                      ...current,
                      saldoFinal: sanitizeMoneyInput(event.target.value, true),
                    }))
                  }
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none placeholder:text-zinc-500 focus:ring-1 focus:ring-cyan-500"
                />
              </label>
            </div>

            <label className="block">
              <FinanceFieldLabel optional info={conciliacionInfo.observaciones} onInfo={setInfoModal}>
                Observaciones
              </FinanceFieldLabel>
              <textarea
                placeholder="Observaciones del lote o del estado de cuenta"
                value={uploadForm.observaciones}
                maxLength={TEXT_LIMITS.notes}
                onChange={(event) =>
                  setUploadForm((current) => ({
                    ...current,
                    observaciones: sanitizeShortText(event.target.value, TEXT_LIMITS.notes),
                  }))
                }
                className="min-h-[92px] w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none placeholder:text-zinc-500 focus:ring-1 focus:ring-cyan-500"
              />
              <span className="mt-1 block text-xs text-zinc-600">
                Maximo {TEXT_LIMITS.notes} caracteres.
              </span>
            </label>

            <label className="block">
              <FinanceFieldLabel required info={conciliacionInfo.carga} onInfo={setInfoModal}>
                Archivo
              </FinanceFieldLabel>
              <input
                type="file"
                accept=".xlsx,.xlsm,.csv,.pdf"
                onChange={(event) =>
                  setUploadForm((current) => ({
                    ...current,
                    file: event.target.files?.[0] || null,
                  }))
                }
                className="w-full rounded-xl border border-dashed border-zinc-700 bg-zinc-950 px-3 py-3 text-sm text-zinc-300 file:mr-3 file:rounded-lg file:border-0 file:bg-cyan-600 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-cyan-500"
              />
              <span className="mt-1 block text-xs text-zinc-600">
                Formatos: XLSX, XLSM, CSV o PDF. Maximo 20 MB.
              </span>
            </label>

            <button
              type="submit"
              disabled={isUploading}
              className="w-full rounded-xl bg-cyan-600 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:opacity-50"
            >
              {isUploading ? "Procesando carga..." : "Importar estado de cuenta"}
            </button>
          </div>
        </form>

        <div className="rounded-3xl border border-zinc-800 bg-zinc-950/80 p-5">
          <div className="flex items-center justify-between gap-3 border-b border-zinc-800 pb-4">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-semibold text-white">Cargas recientes</h3>
                <FinanceInfoButton info={conciliacionInfo.cargas} onOpen={setInfoModal} />
              </div>
              <p className="mt-1 text-sm text-zinc-500">
                Aquí validas si la carga cuadró, cuántos movimientos detectó y si
                quedó algo por revisar antes de pasar a la mesa operativa.
              </p>
            </div>
            <span className="rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1 text-xs uppercase tracking-[0.2em] text-zinc-500">
              {loads.length}
            </span>
          </div>

          <div className="mt-4 space-y-3">
            {loads.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/20 py-12 text-center text-sm text-zinc-500">
                Aún no hay cargas bancarias registradas.
              </div>
            ) : (
              loads.map((load) => (
                <BankLoadCard
                  key={load.id}
                  load={load}
                  disabled={isDeletingLoad || isUploading}
                  onDelete={() => handleRequestDeleteLoad(load)}
                />
              ))
            )}
          </div>
        </div>
        </div>
      ) : null}

      {activeTab === "lotes" ? (
        <div className="mt-6 rounded-3xl border border-zinc-800 bg-zinc-950/80 p-5">
          <div className="border-b border-zinc-800 pb-4">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-semibold text-white">Cargas bancarias</h3>
              <FinanceInfoButton info={conciliacionInfo.cargas} onOpen={setInfoModal} />
            </div>
            <p className="mt-1 text-sm text-zinc-500">
              Aquí revisas si cada archivo cuadró, cuántos movimientos detectó y
              si hubo diferencias o alertas pendientes por resolver.
            </p>
          </div>

          <div className="mt-4 space-y-3">
            {loads.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/20 py-12 text-center text-sm text-zinc-500">
                Aún no hay cargas bancarias registradas.
              </div>
            ) : (
              loads.map((load) => (
                <BankLoadCard
                  key={`tab-load-${load.id}`}
                  load={load}
                  disabled={isDeletingLoad || isUploading}
                  onDelete={() => handleRequestDeleteLoad(load)}
                />
              ))
            )}
          </div>
        </div>
      ) : null}

      {activeTab === "sugerencias" ? (
        <div className="mt-6 rounded-3xl border border-zinc-800 bg-zinc-950/80 p-5">
          <div className="flex flex-col gap-3 border-b border-zinc-800 pb-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
                Sugerencias pendientes
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-semibold text-white">
                  Revisa candidatos antes de aplicar pagos
                </h3>
                <FinanceInfoButton info={conciliacionInfo.sugerencias} onOpen={setInfoModal} />
              </div>
              <p className="mt-1 text-sm text-zinc-500">
                Cada tarjeta compara un movimiento bancario con una CxC o CxP sugerida.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void loadSuggestions(filters)}
              className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-800"
            >
              Actualizar sugerencias
            </button>
          </div>

          {suggestions.length === 0 ? (
            <p className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4 text-sm text-zinc-500">
              No hay sugerencias pendientes con el alcance actual.
            </p>
          ) : (
            <>
            <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Total</p>
                <p className="mt-2 text-2xl font-semibold text-white">
                  {suggestionSummary.total || suggestions.length}
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  {suggestionSummary.by_type.CXC || cxcSuggestions.length} CxC |{" "}
                  {suggestionSummary.by_type.CXP || cxpSuggestions.length} CxP
                </p>
              </div>
              <div className="rounded-2xl border border-emerald-500/10 bg-emerald-500/5 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-emerald-200/80">Listas</p>
                <p className="mt-2 text-2xl font-semibold text-emerald-100">{readySuggestionCount}</p>
                <p className="mt-1 text-xs text-zinc-500">
                  {formatCurrency(suggestionSummary.amount_by_readiness.LISTA || 0)}
                </p>
              </div>
              <div className="rounded-2xl border border-amber-500/10 bg-amber-500/5 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-amber-200/80">Revision</p>
                <p className="mt-2 text-2xl font-semibold text-amber-100">{reviewSuggestionCount}</p>
                <p className="mt-1 text-xs text-zinc-500">
                  {formatCurrency(suggestionSummary.amount_by_readiness.REVISAR || 0)}
                </p>
              </div>
              <div className="rounded-2xl border border-cyan-500/10 bg-cyan-500/5 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-cyan-200/80">Riesgo</p>
                <p className={`mt-2 text-2xl font-semibold ${getSuggestionScoreTone(averageSuggestionScore)}`}>
                  {suggestionSummary.risk_level}
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  {blockedSuggestionCount} no aplicar directo
                </p>
              </div>
            </div>

            <div className={`mt-5 rounded-2xl border p-4 ${getSuggestionRiskClass(suggestionSummary.risk_level)}`}>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] opacity-80">
                    Cola asistida
                  </p>
                  <p className="mt-2 text-sm font-semibold text-white">
                    {getSuggestionQueueLabel(suggestionSummary.primary_queue)}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-zinc-300">
                    {suggestionSummary.recommended_focus}
                  </p>
                </div>
                <div className="grid gap-2 text-xs text-zinc-300 sm:grid-cols-3 lg:min-w-[420px]">
                  <span className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-2">
                    Alta {suggestionSummary.by_confidence.ALTA || 0}
                  </span>
                  <span className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-2">
                    Media {suggestionSummary.by_confidence.MEDIA || 0}
                  </span>
                  <span className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-2">
                    Baja {suggestionSummary.by_confidence.BAJA || 0}
                  </span>
                </div>
              </div>
              {suggestionSummary.top_blockers.length ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {suggestionSummary.top_blockers.map((item) => (
                    <span
                      key={item.label}
                      className="rounded-full border border-zinc-800 bg-zinc-950/70 px-3 py-1 text-xs text-zinc-300"
                    >
                      {item.count}x {item.label}
                    </span>
                  ))}
                </div>
              ) : null}
              {suggestionSummary.decision_queue.length ? (
                <div className="mt-4 grid gap-3 lg:grid-cols-3">
                  {suggestionSummary.decision_queue.slice(0, 3).map((queue) => (
                    <div
                      key={queue.state}
                      className={`rounded-2xl border p-3 ${getSuggestionReadinessClass(queue.state)}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-white">{queue.label}</p>
                          <p className="mt-1 text-xs leading-5 text-zinc-300">{queue.next_action}</p>
                        </div>
                        <span className="rounded-full border border-zinc-800 bg-zinc-950/70 px-2 py-0.5 text-xs text-zinc-200">
                          {queue.count}
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-zinc-400">
                        {formatCurrency(queue.amount)} | {queue.operator_focus}
                      </p>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-2">
              {(["CXC", "CXP"] as const).map((scope) => {
                const scopedSuggestions = scope === "CXC" ? cxcSuggestions : cxpSuggestions;
                const scopedAverage = getSuggestionAverageScore(scopedSuggestions);
                return (
                  <div key={scope} className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4">
                    <div className="flex flex-col gap-3 border-b border-zinc-800 pb-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <h4 className="font-semibold text-white">Sugerencias {scope}</h4>
                        <p className="mt-1 text-sm text-zinc-500">
                          {scope === "CXC"
                            ? "Depositos contra adeudos de clientes."
                            : "Retiros contra cuentas por pagar."}
                        </p>
                      </div>
                      <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 px-3 py-2 text-right">
                        <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">Score prom.</p>
                        <p className={`mt-1 text-lg font-semibold ${getSuggestionScoreTone(scopedAverage)}`}>
                          {scopedAverage}
                        </p>
                      </div>
                    </div>
                    <div className="mt-4 space-y-3">
                      {scopedSuggestions.length === 0 ? (
                        <p className="text-sm text-zinc-500">No hay sugerencias {scope}.</p>
                      ) : (
                        scopedSuggestions.map((suggestion) => {
                          const amountDifference = getSuggestionAmountDifference(suggestion);
                          const readiness = getSuggestionReadiness(suggestion);
                          const decision = suggestion.decision;
                          return (
                            <div
                              key={suggestion.id}
                              className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4"
                            >
                              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                                <div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <p className="font-medium text-white">
                                      {getSuggestionTitle(suggestion)}
                                    </p>
                                    <span
                                      className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${getSuggestionScoreBadge(
                                        suggestion.score,
                                      )}`}
                                    >
                                      {getSuggestionScoreLabel(suggestion.score)}
                                    </span>
                                    {readiness ? (
                                      <span
                                        className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${getSuggestionReadinessClass(
                                          readiness.state,
                                        )}`}
                                      >
                                        {readiness.label}
                                      </span>
                                    ) : null}
                                  </div>
                                  <p className="mt-1 text-sm text-zinc-400">
                                    {getSuggestionSubtitle(suggestion)}
                                  </p>
                                  <p className="mt-1 text-xs text-zinc-500">
                                    Banco {formatDate(suggestion.transaccion.fecha_pago)} |{" "}
                                    {formatCurrency(suggestion.transaccion.monto)} | Score {suggestion.score}
                                  </p>
                                  {decision ? (
                                    <div className="mt-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <span className="rounded-full border border-zinc-700 bg-zinc-950 px-2 py-0.5 text-[11px] text-zinc-300">
                                          Cola #{decision.queue_position}
                                        </span>
                                        <span className="text-xs font-semibold text-white">
                                          {decision.label}
                                        </span>
                                      </div>
                                      <p className="mt-1 text-xs leading-5 text-zinc-400">
                                        {decision.detail}
                                      </p>
                                      {decision.blockers.length ? (
                                        <p className="mt-1 text-xs text-amber-200">
                                          {decision.blockers[0]}
                                        </p>
                                      ) : null}
                                    </div>
                                  ) : null}
                                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                                    <span className="rounded-full border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-zinc-400">
                                      Candidato {formatCurrency(suggestion.candidato.saldo_pendiente)}
                                    </span>
                                    <span
                                      className={`rounded-full border px-2 py-0.5 ${
                                        amountDifference === 0
                                          ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-200"
                                          : "border-amber-500/20 bg-amber-500/10 text-amber-200"
                                      }`}
                                    >
                                      Dif. {formatCurrency(amountDifference)}
                                    </span>
                                  </div>
                                  {suggestion.reasons?.length ? (
                                    <ul className="mt-3 space-y-1 text-xs text-zinc-500">
                                      {suggestion.reasons.slice(0, 3).map((reason, index) => (
                                        <li key={`${suggestion.id}-reason-${index}`}>- {reason}</li>
                                      ))}
                                    </ul>
                                  ) : null}
                                </div>
                                <div className="flex shrink-0 flex-col gap-2 md:items-end">
                                  <p className="text-right text-lg font-semibold text-white">
                                    {formatCurrency(suggestion.candidato.saldo_pendiente)}
                                  </p>
                                  <button
                                    type="button"
                                    disabled={isWorking}
                                    onClick={() => openSuggestionReview(suggestion)}
                                    className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                                      suggestion.tipo === "CXC"
                                        ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20"
                                        : "border-amber-500/20 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20"
                                    }`}
                                  >
                                    {decision?.label || getSuggestionApplyButtonLabel(suggestion)}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => openSuggestionReview(suggestion)}
                                    className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-800"
                                  >
                                    Ver detalle
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void openSuggestedTransactionDetail(suggestion)}
                                    className="rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20"
                                  >
                                    Movimiento
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            </>
          )}
        </div>
      ) : null}

      {activeTab === "movimientos" ? (
        <div className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4">
          <div className="border-b border-zinc-800 pb-4">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-lg font-semibold text-white">Movimientos bancarios</h3>
                  <FinanceInfoButton info={conciliacionInfo.filtros} onOpen={setInfoModal} />
                </div>
                <p className="mt-1 text-sm text-zinc-500">
                  Mesa de trabajo para localizar, ordenar y resolver depósitos y retiros.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs uppercase tracking-[0.18em] text-zinc-500">
                  {activeMovementFilters} filtros activos
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs uppercase tracking-[0.18em] text-zinc-500">
                  {getSortLabel(filters.orden)}
                </div>
                <label className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-300">
                  <span className="text-xs uppercase tracking-[0.18em] text-zinc-500">
                    Filas
                  </span>
                  <select
                    value={filters.pageSize}
                    onChange={(event) =>
                      updateFilters({ pageSize: Number.parseInt(event.target.value, 10) || 25 })
                    }
                    className="bg-transparent text-sm text-white outline-none"
                  >
                    <option value={10}>10</option>
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => void handleAutoReconcilePending()}
                  disabled={isAutoReconciling || isWorking}
                  className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-200 transition-colors hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isAutoReconciling ? "Conciliando..." : "Conciliar pendientes"}
                </button>
                <button
                  type="button"
                  onClick={clearMovementFilters}
                  className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-800"
                >
                  Reiniciar vista
                </button>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 rounded-xl border border-zinc-800 bg-zinc-950/60 p-3 text-sm xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">
                  Alcance visible
                </p>
                <p className="mt-1 truncate font-medium text-white">
                  {getMovementScopeLabel(filters, selectedAccount)}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs text-zinc-400 sm:grid-cols-4">
                <div>
                  <p className="uppercase tracking-[0.16em] text-zinc-500">Inicial</p>
                  <p className="mt-1 font-semibold text-white">
                    {formatCurrency(movementSummary.saldo_inicial)}
                  </p>
                </div>
                <div>
                  <p className="uppercase tracking-[0.16em] text-zinc-500">Final</p>
                  <p className="mt-1 font-semibold text-cyan-200">
                    {formatCurrency(movementSummary.saldo_final)}
                  </p>
                </div>
                <div>
                  <p className="uppercase tracking-[0.16em] text-zinc-500">Depósitos</p>
                  <p className="mt-1 font-semibold text-emerald-200">
                    {movementSummary.ingresos_count} | {formatCurrency(movementSummary.ingresos)}
                  </p>
                </div>
                <div>
                  <p className="uppercase tracking-[0.16em] text-zinc-500">Retiros</p>
                  <p className="mt-1 font-semibold text-red-200">
                    {movementSummary.egresos_count} | {formatCurrency(movementSummary.egresos)}
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
              <div className="mb-4 rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">
                        Revision automatica
                      </p>
                      <FinanceInfoButton
                        info={conciliacionInfo.automatch}
                        onOpen={setInfoModal}
                        className="h-5 w-5 text-[10px]"
                      />
                    </div>
                    <p className="mt-1 text-sm text-zinc-400">
                      Conteo dentro del alcance visible, antes del filtro de auto-match.
                    </p>
                  </div>
                  {filters.autoMatch ? (
                    <button
                      type="button"
                      onClick={() => updateFilters({ autoMatch: "" })}
                      className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-800"
                    >
                      Ver todos
                    </button>
                  ) : null}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
                  {autoMatchQuickFilters.map((item) => (
                    <button
                      key={`auto-match-quick-${item.value}`}
                      type="button"
                      onClick={() => updateFilters({ autoMatch: item.value })}
                      className={`rounded-xl border px-3 py-2 text-left transition-colors hover:border-cyan-500/30 ${
                        filters.autoMatch === item.value
                          ? "border-cyan-400/40 bg-cyan-500/15 text-cyan-100"
                          : item.tone
                      }`}
                    >
                      <span className="block text-[11px] uppercase tracking-[0.16em] opacity-75">
                        {item.label}
                      </span>
                      <span className="mt-1 block text-lg font-semibold">{item.count}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
                <label className="space-y-1 xl:col-span-2">
                  <span className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                    Cuenta
                  </span>
                  <select
                    value={filters.cuentaId}
                    onChange={(event) => updateFilters({ cuentaId: event.target.value })}
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 outline-none focus:ring-1 focus:ring-cyan-500"
                  >
                    <option value="">Todas las cuentas</option>
                    {accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {buildAccountLabel(account)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                    Mes
                  </span>
                  <select
                    value={filters.mes}
                    onChange={(event) =>
                      updateFilters({
                        mes: event.target.value,
                        fechaDesde: "",
                        fechaHasta: "",
                      })
                    }
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 outline-none focus:ring-1 focus:ring-cyan-500"
                  >
                    <option value="">Todos los meses</option>
                    {MONTH_FILTER_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                    Desde
                  </span>
                  <input
                    type="date"
                    value={filters.fechaDesde}
                    onChange={(event) =>
                      updateFilters({ fechaDesde: event.target.value, mes: "" })
                    }
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 outline-none focus:ring-1 focus:ring-cyan-500"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                    Hasta
                  </span>
                  <input
                    type="date"
                    value={filters.fechaHasta}
                    min={filters.fechaDesde || undefined}
                    onChange={(event) =>
                      updateFilters({ fechaHasta: event.target.value, mes: "" })
                    }
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 outline-none focus:ring-1 focus:ring-cyan-500"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                    Orden
                  </span>
                  <select
                    value={filters.orden}
                    onChange={(event) => updateFilters({ orden: event.target.value })}
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 outline-none focus:ring-1 focus:ring-cyan-500"
                  >
                    <option value="fecha_desc">Fecha reciente</option>
                    <option value="fecha_asc">Fecha antigua</option>
                    <option value="monto_desc">Monto mayor</option>
                    <option value="monto_asc">Monto menor</option>
                  </select>
                </label>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-[280px_190px_minmax(260px,1fr)_180px]">
                <div className="space-y-1">
                  <span className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                    Flujo
                  </span>
                  <div className="grid grid-cols-3 gap-1 rounded-lg border border-zinc-800 bg-zinc-950 p-1">
                    {[
                      { value: "", label: "Todos" },
                      { value: "INGRESO", label: "Depósitos" },
                      { value: "EGRESO", label: "Retiros" },
                    ].map((option) => (
                      <button
                        key={`tipo-${option.value || "todos"}`}
                        type="button"
                        onClick={() => updateFilters({ tipo: option.value })}
                        className={`min-w-0 rounded-md px-2 py-1.5 text-center text-xs font-medium leading-5 transition-colors ${
                          filters.tipo === option.value
                            ? "bg-cyan-600 text-white"
                            : "text-zinc-400 hover:text-white"
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="space-y-1">
                  <span className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                    Coincidencia
                  </span>
                  <select
                    value={filters.modoBusqueda}
                    onChange={(event) => updateFilters({ modoBusqueda: event.target.value })}
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 outline-none focus:ring-1 focus:ring-cyan-500"
                  >
                    <option value="contiene">Contiene</option>
                    <option value="exacto">Exacta</option>
                    <option value="empieza">Empieza con</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                    Buscar
                  </span>
                  <input
                    type="text"
                    placeholder="Concepto, referencia o folio"
                    value={filters.busqueda}
                    maxLength={TEXT_LIMITS.search}
                    onChange={(event) =>
                      updateFilters({
                        busqueda: sanitizeShortText(event.target.value, TEXT_LIMITS.search),
                      })
                    }
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-500 focus:ring-1 focus:ring-cyan-500"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                    Estatus
                  </span>
                  <select
                    value={filters.estatus}
                    onChange={(event) => updateFilters({ estatus: event.target.value })}
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 outline-none focus:ring-1 focus:ring-cyan-500"
                  >
                    <option value="">Todos</option>
                    <option value="EN_ESPERA">En espera</option>
                    <option value="PARCIAL">Parcial</option>
                    <option value="NO_IDENTIFICADO">No identificado</option>
                    <option value="VINCULADO">Vinculado</option>
                    <option value="VALIDADO">Validado</option>
                    <option value="DUPLICADO">Duplicado</option>
                  </select>
                </label>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-[minmax(240px,320px)_1fr]">
                <label className="space-y-1">
                  <span className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                    Revision automatica
                  </span>
                  <select
                    value={filters.autoMatch}
                    onChange={(event) => updateFilters({ autoMatch: event.target.value })}
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 outline-none focus:ring-1 focus:ring-cyan-500"
                  >
                    <option value="">Todos</option>
                    <option value="SIN_ANALISIS">Sin analisis</option>
                    <option value="REVISION_MANUAL">Requiere revision</option>
                    <option value="MATCHED">Match aplicado</option>
                    <option value="LOW_CONFIDENCE">Baja confianza</option>
                    <option value="AMBIGUOUS">Ambiguo</option>
                    <option value="NONE">Sin candidato</option>
                    <option value="ERROR">Error</option>
                  </select>
                </label>
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 px-3 py-2 text-xs leading-5 text-zinc-500">
                  Usa este filtro para revisar primero lo que el motor no pudo resolver con seguridad.
                  El detalle conserva razones, candidatos y score de cada intento.
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
            <SummaryStatCard
              label="Depósitos"
              value={formatCurrency(movementSummary.ingresos)}
              helper={`${movementSummary.ingresos_count} movimientos de ingreso`}
              tone="positive"
            />
            <SummaryStatCard
              label="Retiros"
              value={formatCurrency(movementSummary.egresos)}
              helper={`${movementSummary.egresos_count} movimientos de egreso`}
              tone="negative"
            />
            <SummaryStatCard
              label="Movimientos"
              value={String(movementSummary.total_movimientos)}
              helper={`${pagination.total_items} registros encontrados`}
            />
          </div>

        {isLoading ? (
          <div className="py-16 text-center text-sm text-zinc-500">
            Cargando movimientos bancarios...
          </div>
        ) : transactions.length === 0 ? (
          <div className="py-16 text-center text-sm text-zinc-500">
            No hay movimientos con los filtros actuales.
          </div>
        ) : (
          <>
            <div className="mt-4 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/60">
              <div className="flex flex-col gap-2 border-b border-zinc-800 px-4 py-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-sm font-medium text-white">Tabla de movimientos</p>
                  <p className="mt-1 text-xs text-zinc-500">
                    Ordena por fecha o monto y resuelve cada partida desde acciones.
                  </p>
                </div>
                <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                  {pagination.total_items} registros visibles
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-zinc-800 text-xs">
                  <thead className="sticky top-0 z-10 bg-zinc-950/95 backdrop-blur">
                    <tr className="text-left text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                      <th className="px-3 py-2.5">
                        <button
                          type="button"
                          onClick={() => handleSortChange("fecha")}
                          className="inline-flex items-center gap-2 text-left transition-colors hover:text-zinc-300"
                        >
                          Fecha
                          <span className="text-[10px] text-zinc-600">
                            {filters.orden === "fecha_asc"
                              ? "asc"
                              : filters.orden === "fecha_desc"
                                ? "desc"
                                : ""}
                          </span>
                        </button>
                      </th>
                      <th className="px-3 py-2.5">Cuenta / lote</th>
                      <th className="px-3 py-2.5">Referencia / concepto</th>
                      <th className="px-3 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => handleSortChange("monto")}
                          className="inline-flex items-center gap-2 text-right transition-colors hover:text-zinc-300"
                        >
                          Monto
                          <span className="text-[10px] text-zinc-600">
                            {filters.orden === "monto_asc"
                              ? "asc"
                              : filters.orden === "monto_desc"
                                ? "desc"
                                : ""}
                          </span>
                        </button>
                      </th>
                      <th className="px-3 py-2.5 text-right">Saldo</th>
                      <th className="px-3 py-2.5 text-right">Aplicado</th>
                      <th className="px-3 py-2.5 text-right">Disponible</th>
                      <th className="px-3 py-2.5">Estatus</th>
                      <th className="px-3 py-2.5 text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800">
                    {transactions.map((item) => (
                      <tr
                        key={item.id}
                        className={`align-top text-zinc-300 transition-colors hover:bg-zinc-900/40 ${
                          selectedTransaction?.transaccion.id === item.id
                            ? "bg-cyan-500/5"
                            : ""
                        }`}
                      >
                        <td className="whitespace-nowrap px-3 py-2.5">
                          <p>{formatDate(item.fecha_pago)}</p>
                          <p
                            className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                              item.tipo_movimiento === "INGRESO"
                                ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-200"
                                : "border-red-500/20 bg-red-500/10 text-red-200"
                            }`}
                          >
                            {getMovementTypeLabel(item.tipo_movimiento)}
                          </p>
                        </td>
                        <td className="px-3 py-2.5">
                          <p className="max-w-[190px] truncate text-zinc-200">
                            {item.cuenta_bancaria_nombre || "Sin cuenta"}
                          </p>
                          <p className="mt-1 text-xs text-zinc-500">
                            {item.carga_nombre || "Sin lote"}
                          </p>
                        </td>
                        <td className="px-3 py-2.5">
                          <p className="max-w-[360px] truncate font-medium text-white">
                            {item.numero_referencia ||
                              item.folio_bancario ||
                              item.concepto_bancario ||
                              "Sin referencia"}
                          </p>
                          <p className="mt-1 max-w-[360px] truncate text-xs text-zinc-500">
                            {item.concepto_bancario || "Sin descripción"}
                          </p>
                          {item.notas_conciliacion ? (
                            <p
                              className="mt-1 max-w-[360px] truncate rounded-md border border-cyan-500/10 bg-cyan-500/5 px-2 py-1 text-[11px] text-cyan-100/80"
                              title={item.notas_conciliacion}
                            >
                              Nota: {item.notas_conciliacion}
                            </p>
                          ) : null}
                        </td>
                        <td
                          className={`whitespace-nowrap px-3 py-2.5 text-right font-semibold ${
                            item.tipo_movimiento === "INGRESO" ? "text-emerald-200" : "text-red-200"
                          }`}
                        >
                          {formatCurrency(item.monto)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right text-zinc-300">
                          {item.saldo_resultante != null
                            ? formatCurrency(item.saldo_resultante)
                            : "Sin saldo"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right text-emerald-200">
                          {formatCurrency(item.monto_aplicado)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right text-amber-200">
                          {formatCurrency(item.monto_disponible)}
                        </td>
                        <td className="px-3 py-2.5">
                          <span
                            className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium ${transactionStatusClass(
                              item.estatus_conciliacion
                            )}`}
                          >
                            {getStatusLabel(item.estatus_conciliacion)}
                          </span>
                          <span
                            className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[10px] ${autoMatchStatusClass(
                              item.auto_match,
                            )}`}
                          >
                            {getAutoMatchStatusLabel(item.auto_match?.match_status)}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex min-w-[220px] flex-wrap justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => void loadTransactionDetail(item.id)}
                              className="rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-800"
                            >
                              Detalle
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleQuickValidateTransaction(item.id)}
                              disabled={isWorking || item.monto_disponible > 0}
                              title={
                                item.monto_disponible > 0
                                  ? "Primero aplica el monto disponible"
                                  : "Validar pago"
                              }
                              className="rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1.5 text-xs font-medium text-emerald-200 transition-colors hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Validar
                            </button>
                            {item.estatus_conciliacion === "NO_IDENTIFICADO" ? (
                              <button
                                type="button"
                                onClick={() => requestStatusUpdate(item, "EN_ESPERA")}
                                disabled={isWorking}
                                className="rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                Reabrir
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => requestStatusUpdate(item, "NO_IDENTIFICADO")}
                                disabled={
                                  isWorking ||
                                  ["VALIDADO", "DUPLICADO", "RECHAZADO"].includes(
                                    item.estatus_conciliacion,
                                  )
                                }
                                title="Marcar como no identificado"
                                className="rounded-md border border-red-500/20 bg-red-500/10 px-2.5 py-1.5 text-xs font-medium text-red-200 transition-colors hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                No ident.
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => void handleAutoLink(item.id)}
                              className="rounded-md border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-1.5 text-xs font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20"
                            >
                              Match
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="mt-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <p className="text-sm text-zinc-500">
                Página {pagination.page} de {pagination.total_pages} ·{" "}
                {pagination.total_items} movimientos · {pagination.page_size} filas por página
              </p>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  disabled={pagination.page <= 1}
                  onClick={() => updateFilters({ page: 1 })}
                  className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-300 transition-colors hover:bg-zinc-800 disabled:opacity-40"
                >
                  Inicio
                </button>
                <button
                  type="button"
                  disabled={pagination.page <= 1}
                  onClick={() => updateFilters({ page: pagination.page - 1 })}
                  className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm text-zinc-300 transition-colors hover:bg-zinc-800 disabled:opacity-40"
                >
                  Anterior
                </button>
                {pageWindow.map((pageNumber) => (
                  <button
                    key={`page-${pageNumber}`}
                    type="button"
                    onClick={() => updateFilters({ page: pageNumber })}
                    className={`rounded-xl border px-3 py-2 text-sm transition-colors ${
                      pageNumber === pagination.page
                        ? "border-cyan-500/30 bg-cyan-500/10 text-cyan-200"
                        : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
                    }`}
                  >
                    {pageNumber}
                  </button>
                ))}
                <button
                  type="button"
                  disabled={pagination.page >= pagination.total_pages}
                  onClick={() => updateFilters({ page: pagination.page + 1 })}
                  className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm text-zinc-300 transition-colors hover:bg-zinc-800 disabled:opacity-40"
                >
                  Siguiente
                </button>
                <button
                  type="button"
                  disabled={pagination.page >= pagination.total_pages}
                  onClick={() => updateFilters({ page: pagination.total_pages })}
                  className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-300 transition-colors hover:bg-zinc-800 disabled:opacity-40"
                >
                  Final
                </button>
                <div className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950 px-2 py-2">
                  <span className="text-xs uppercase tracking-[0.18em] text-zinc-500">
                    Ir a
                  </span>
                  <select
                    value={pageJumpValue}
                    onChange={(event) => setPageJumpValue(event.target.value)}
                    className="w-24 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 outline-none focus:ring-1 focus:ring-cyan-500"
                  >
                    {pageOptions.map((pageNumber) => (
                      <option key={`jump-${pageNumber}`} value={String(pageNumber)}>
                        {pageNumber}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handlePageJump}
                    className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-3 py-2 text-sm font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20"
                  >
                    Ir
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
        </div>
      ) : null}

      {statusUpdate ? (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/70 px-4 py-6 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-3xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl shadow-black/40">
            <div className="flex items-start justify-between gap-4 border-b border-zinc-800 pb-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs uppercase tracking-[0.24em] text-cyan-200">
                    Nota de conciliacion
                  </p>
                  <FinanceInfoButton info={conciliacionInfo.statusNote} onOpen={setInfoModal} />
                </div>
                <h3 className="mt-2 text-lg font-semibold text-white">
                  {statusUpdate.status === "NO_IDENTIFICADO"
                    ? "Marcar como no identificado"
                    : "Reabrir movimiento"}
                </h3>
                <p className="mt-1 text-sm text-zinc-500">{statusUpdate.reference}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setStatusUpdate(null);
                  setError("");
                }}
                className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
              >
                Cerrar
              </button>
            </div>

            {statusUpdate.currentNote ? (
              <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-3">
                <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
                  Nota actual
                </p>
                <p className="mt-2 text-sm leading-6 text-zinc-300">
                  {statusUpdate.currentNote}
                </p>
              </div>
            ) : null}

            <label className="mt-4 block space-y-2">
              <span className="text-xs uppercase tracking-[0.18em] text-zinc-500">
                Motivo
              </span>
              <textarea
                value={statusUpdate.note}
                onChange={(event) =>
                  setStatusUpdate((current) =>
                    current
                      ? { ...current, note: sanitizeShortText(event.target.value, TEXT_LIMITS.notes) }
                      : current,
                  )
                }
                maxLength={TEXT_LIMITS.notes}
                rows={4}
                className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm leading-6 text-white outline-none placeholder:text-zinc-500 focus:ring-1 focus:ring-cyan-500"
                placeholder="Ej. No coincide referencia, monto o beneficiario."
              />
            </label>

            {error ? (
              <p className="mt-3 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-100">
                {error}
              </p>
            ) : null}

            <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => {
                  setStatusUpdate(null);
                  setError("");
                }}
                className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-800"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isWorking || statusUpdate.note.trim().length < 3}
                onClick={() => void handleConfirmStatusUpdate()}
                className={`rounded-xl border px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  statusUpdate.status === "NO_IDENTIFICADO"
                    ? "border-red-500/20 bg-red-500/10 text-red-100 hover:bg-red-500/20"
                    : "border-cyan-500/20 bg-cyan-500/10 text-cyan-100 hover:bg-cyan-500/20"
                }`}
              >
                {statusUpdate.status === "NO_IDENTIFICADO"
                  ? "Guardar no identificado"
                  : "Guardar reapertura"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {selectedSuggestion ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 px-4 py-6 backdrop-blur-sm">
          <div className="w-full max-w-5xl rounded-3xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl shadow-black/40">
            <div className="flex flex-col gap-3 border-b border-zinc-800 pb-4 md:flex-row md:items-start md:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-cyan-200">
                  Comparativo {selectedSuggestion.tipo}
                </p>
                <h3 className="mt-2 text-xl font-semibold text-white">
                  Banco vs {selectedSuggestion.tipo}
                </h3>
                <p className="mt-1 text-sm text-zinc-500">
                  Revisa monto, fecha, referencia y razones antes de aplicar.
                </p>
                {selectedSuggestionReadiness ? (
                  <span
                    className={`mt-3 inline-flex rounded-full border px-3 py-1 text-xs font-medium ${getSuggestionReadinessClass(
                      selectedSuggestionReadiness.state,
                    )}`}
                  >
                    {selectedSuggestionReadiness.label}
                  </span>
                ) : null}
              </div>
              <button
                type="button"
                onClick={closeSuggestionReview}
                className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
              >
                Cerrar
              </button>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                  Movimiento bancario
                </p>
                <p className="mt-3 text-2xl font-semibold text-white">
                  {formatCurrency(selectedSuggestion.transaccion.monto)}
                </p>
                <div className="mt-4 space-y-2 text-sm text-zinc-400">
                  <p>Fecha: {formatDate(selectedSuggestion.transaccion.fecha_pago)}</p>
                  <p>Tipo: {getMovementTypeLabel(selectedSuggestion.transaccion.tipo_movimiento)}</p>
                  <p>Cuenta: {selectedSuggestion.transaccion.cuenta_bancaria_nombre || "Sin cuenta"}</p>
                  <p>Referencia: {selectedSuggestion.transaccion.numero_referencia || selectedSuggestion.transaccion.folio_bancario || "Sin referencia"}</p>
                  <p>Concepto: {selectedSuggestion.transaccion.concepto_bancario || "Sin concepto"}</p>
                  <p>
                    Disponible: {formatCurrency(selectedSuggestion.transaccion.monto_disponible)}
                  </p>
                </div>
              </div>

              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                  Cuenta sugerida
                </p>
                <p className="mt-3 text-2xl font-semibold text-white">
                  {formatCurrency(selectedSuggestion.candidato.saldo_pendiente)}
                </p>
                <div className="mt-4 space-y-2 text-sm text-zinc-400">
                  <p>Destino: {getSuggestionTitle(selectedSuggestion)}</p>
                  <p>Concepto: {getSuggestionSubtitle(selectedSuggestion)}</p>
                  <p>Entidad: {selectedSuggestion.candidato.entidad_nombre || "Sin entidad"}</p>
                  <p>Vencimiento: {formatDate(selectedSuggestion.candidato.fecha_vencimiento)}</p>
                  <p>
                    Score:{" "}
                    <span className={getSuggestionScoreTone(selectedSuggestion.score)}>
                      {selectedSuggestion.score} | {getSuggestionScoreLabel(selectedSuggestion.score)}
                    </span>
                  </p>
                  <p>
                    Confianza:{" "}
                    <span className={`rounded-full border px-2 py-0.5 text-xs ${getCandidateConfidenceClass(selectedSuggestion.confidence_band || selectedSuggestion.candidato.confidence_band)}`}>
                      {getCandidateConfidenceLabel(selectedSuggestion.confidence_band || selectedSuggestion.candidato.confidence_band)}
                    </span>
                  </p>
                  <p>
                    Diferencia:{" "}
                    {formatCurrency(
                      selectedSuggestion.amount_difference ??
                        selectedSuggestion.candidato.amount_difference ??
                        getSuggestionAmountDifference(selectedSuggestion)
                    )}
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-cyan-500/15 bg-cyan-500/10 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-cyan-200">
                Accion recomendada
              </p>
              <p className="mt-2 text-sm leading-6 text-zinc-200">
                {selectedSuggestion.recommended_action ||
                  selectedSuggestion.candidato.recommended_action ||
                  "Revisa la referencia y el saldo antes de aplicar."}
              </p>
            </div>

            {selectedSuggestionReadiness ? (
              <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                      Estado asistido
                    </p>
                    <p className="mt-2 text-sm leading-6 text-zinc-300">
                      {selectedSuggestionReadiness.detail}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium ${getSuggestionReadinessClass(
                      selectedSuggestionReadiness.state,
                    )}`}
                  >
                    {selectedSuggestionReadiness.label}
                  </span>
                </div>
                {selectedSuggestionReadiness.checklist?.length ? (
                  <ul className="mt-3 grid gap-2 text-xs leading-5 text-zinc-400 sm:grid-cols-3">
                    {selectedSuggestionReadiness.checklist.map((item, index) => (
                      <li
                        key={`readiness-check-${index}`}
                        className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-2"
                      >
                        {item}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}

            <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                Razones de sugerencia
              </p>
              {selectedSuggestion.reasons?.length ? (
                <ul className="mt-3 space-y-1 text-sm text-zinc-400">
                  {selectedSuggestion.reasons.map((reason, index) => (
                    <li key={`detail-reason-${index}`}>- {reason}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-zinc-500">
                  Sin razones detalladas para esta sugerencia.
                </p>
              )}
            </div>

            {(
              selectedSuggestion.signals?.length ||
              selectedSuggestion.candidato.signals?.length ||
              selectedSuggestion.warnings?.length ||
              selectedSuggestion.candidato.warnings?.length ||
              selectedSuggestion.next_steps?.length ||
              selectedSuggestion.candidato.next_steps?.length
            ) ? (
              <div className="mt-4 grid gap-3 lg:grid-cols-3">
                <SuggestionAssistBlock
                  title="Senales"
                  tone="ok"
                  items={selectedSuggestion.signals || selectedSuggestion.candidato.signals || []}
                />
                <SuggestionAssistBlock
                  title="Alertas"
                  tone="warn"
                  items={selectedSuggestion.warnings || selectedSuggestion.candidato.warnings || []}
                />
                <SuggestionAssistBlock
                  title="Siguientes pasos"
                  tone="info"
                  items={selectedSuggestion.next_steps || selectedSuggestion.candidato.next_steps || []}
                />
              </div>
            ) : null}

            <label className="mt-4 block space-y-2 rounded-2xl border border-cyan-500/10 bg-cyan-500/5 p-4">
              <span className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.2em] text-cyan-200">
                Nota de aplicacion
                <FinanceInfoButton info={conciliacionInfo.suggestionNote} onOpen={setInfoModal} />
              </span>
              <textarea
                value={suggestionNote}
                onChange={(event) =>
                  setSuggestionNote(sanitizeShortText(event.target.value, TEXT_LIMITS.notes))
                }
                maxLength={TEXT_LIMITS.notes}
                rows={4}
                className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm leading-6 text-white outline-none placeholder:text-zinc-500 focus:ring-1 focus:ring-cyan-500"
                placeholder="Describe por que se aplica esta sugerencia."
              />
            </label>

            {error ? (
              <p className="mt-3 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-100">
                {error}
              </p>
            ) : null}

            <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={closeSuggestionReview}
                className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-800"
              >
                Revisar despues
              </button>
              <button
                type="button"
                disabled={isWorking}
                onClick={() => void openSuggestedTransactionDetail(selectedSuggestion)}
                className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-100 transition-colors hover:bg-cyan-500/20 disabled:opacity-50"
              >
                Abrir movimiento
              </button>
              <button
                type="button"
                disabled={isWorking || suggestionNote.trim().length < 3}
                onClick={() => void handleApplySuggestion(selectedSuggestion)}
                className={`rounded-xl border px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-60 ${
                  selectedSuggestion.tipo === "CXC"
                    ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-100 hover:bg-emerald-500/25"
                    : "border-amber-500/30 bg-amber-500/15 text-amber-100 hover:bg-amber-500/25"
                }`}
              >
                {getSuggestionApplyButtonLabel(selectedSuggestion)}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === "movimientos" && selectedTransaction ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 px-4 py-6 backdrop-blur-sm">
          <div className="w-full max-w-6xl rounded-3xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl shadow-black/40">
          <div className="flex flex-col gap-4 border-b border-zinc-800 pb-4 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <h3 className="text-lg font-semibold text-white">
                Trazabilidad del movimiento #{selectedTransaction.transaccion.id}
              </h3>
              <p className="mt-1 text-sm text-zinc-500">
                {selectedTransaction.transaccion.numero_referencia ||
                  selectedTransaction.transaccion.folio_bancario ||
                  selectedTransaction.transaccion.concepto_bancario ||
                  "Sin referencia"}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setSelectedTransaction(null)}
                className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
              >
                Cerrar
              </button>
              <button
                type="button"
                onClick={() => onUseInEditor?.(selectedTransaction.transaccion.id)}
                className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
              >
                Usar en editor
              </button>
              <button
                type="button"
                disabled={isWorking}
                onClick={() =>
                  requestStatusUpdate(
                    selectedTransaction.transaccion,
                    selectedTransaction.transaccion.estatus_conciliacion === "NO_IDENTIFICADO"
                      ? "EN_ESPERA"
                      : "NO_IDENTIFICADO",
                  )
                }
                className={`rounded-xl border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
                  selectedTransaction.transaccion.estatus_conciliacion === "NO_IDENTIFICADO"
                    ? "border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800"
                    : "border-red-500/20 bg-red-500/10 text-red-200 hover:bg-red-500/20"
                }`}
              >
                {selectedTransaction.transaccion.estatus_conciliacion === "NO_IDENTIFICADO"
                  ? "Reabrir movimiento"
                  : "Marcar no identificado"}
              </button>
              <button
                type="button"
                disabled={
                  isWorking || selectedTransaction.transaccion.monto_disponible > 0
                }
                onClick={() => void handleUpdateTransactionStatus("VALIDADO")}
                className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-200 transition-colors hover:bg-emerald-500/20 disabled:opacity-50"
              >
                Validar movimiento
              </button>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                {selectedTransaction.transaccion.tipo_movimiento === "INGRESO"
                  ? "Fecha de deposito"
                  : "Fecha de retiro"}
              </p>
              <p className="mt-2 text-lg font-semibold text-white">
                {formatDate(selectedTransaction.transaccion.fecha_pago)}
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                {getMovementTypeLabel(selectedTransaction.transaccion.tipo_movimiento)}
              </p>
            </div>
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Monto</p>
              <p className="mt-2 text-2xl font-semibold text-white">
                {formatCurrency(selectedTransaction.transaccion.monto)}
              </p>
            </div>
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Aplicado</p>
              <p className="mt-2 text-2xl font-semibold text-emerald-200">
                {formatCurrency(selectedTransaction.transaccion.monto_aplicado)}
              </p>
            </div>
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Disponible</p>
              <p className="mt-2 text-2xl font-semibold text-amber-200">
                {formatCurrency(selectedTransaction.transaccion.monto_disponible)}
              </p>
            </div>
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Estatus</p>
              <p className="mt-2 text-lg font-semibold text-white">
                {getStatusLabel(selectedTransaction.transaccion.estatus_conciliacion)}
              </p>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-3">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4 xl:col-span-2">
              <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Referencia bancaria</p>
              <p className="mt-2 font-medium text-white">
                {selectedTransaction.transaccion.numero_referencia ||
                  selectedTransaction.transaccion.folio_bancario ||
                  "Sin referencia"}
              </p>
              <p className="mt-2 text-sm text-zinc-400">
                {selectedTransaction.transaccion.concepto_bancario || "Sin concepto bancario"}
              </p>
              {selectedTransaction.transaccion.notas_conciliacion ? (
                <div className="mt-3 rounded-xl border border-cyan-500/10 bg-cyan-500/5 p-3">
                  <p className="text-xs uppercase tracking-[0.18em] text-cyan-200/80">
                    Nota operativa
                  </p>
                  <p className="mt-2 text-sm leading-6 text-cyan-50/80">
                    {selectedTransaction.transaccion.notas_conciliacion}
                  </p>
                </div>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-zinc-500">
                <span>{selectedTransaction.transaccion.cuenta_bancaria_nombre || "Sin cuenta bancaria"}</span>
                <span>|</span>
                <span>{selectedTransaction.transaccion.carga_nombre || "Sin lote"}</span>
                {selectedTransaction.transaccion.saldo_resultante != null ? (
                  <>
                    <span>|</span>
                    <span>Saldo resultante {formatCurrency(selectedTransaction.transaccion.saldo_resultante)}</span>
                  </>
                ) : null}
              </div>
            </div>
            <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-cyan-200">
                    Analisis automatico
                  </p>
                  <p className="mt-2 text-sm font-medium text-white">
                    {getAutoMatchStatusLabel(selectedTransaction.auto_match?.match_status)}
                  </p>
                </div>
                <span
                  className={`rounded-full border px-2.5 py-1 text-xs ${autoMatchStatusClass(
                    selectedTransaction.auto_match,
                  )}`}
                >
                  {selectedTransaction.auto_match?.confidence_band || "Sin banda"}
                </span>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
                  <p className="uppercase tracking-[0.16em] text-zinc-500">Alcance</p>
                  <p className="mt-1 font-medium text-zinc-200">
                    {selectedTransaction.auto_match?.scope || "Sin analisis"}
                  </p>
                </div>
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
                  <p className="uppercase tracking-[0.16em] text-zinc-500">Score</p>
                  <p className="mt-1 font-medium text-zinc-200">
                    {selectedTransaction.auto_match?.confidence_score ?? "-"}
                  </p>
                </div>
              </div>

              <p className="mt-4 rounded-xl border border-zinc-800 bg-zinc-950/70 p-3 text-xs leading-5 text-zinc-300">
                {autoMatchNextStep(selectedTransaction.auto_match)}
              </p>

              {selectedTransaction.auto_match?.reasons?.length ? (
                <div className="mt-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
                    Razones
                  </p>
                  <ul className="mt-2 space-y-2 text-xs text-zinc-400">
                    {selectedTransaction.auto_match.reasons.slice(0, 5).map((reason, index) => (
                      <li
                        key={`auto-reason-${index}`}
                        className="rounded-xl border border-zinc-800 bg-zinc-950/70 px-3 py-2"
                      >
                        {reason}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {selectedTransaction.auto_match?.candidates?.length ? (
                <div className="mt-4 border-t border-cyan-500/10 pt-3">
                  <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
                    Candidatos del analisis
                  </p>
                  <div className="mt-2 space-y-2">
                    {selectedTransaction.auto_match.candidates.slice(0, 4).map((candidate) => {
                      const candidateAmount = autoMatchCandidateAmount(candidate);
                      const candidateDate = autoMatchCandidateDate(candidate);
                      return (
                        <div
                          key={`auto-candidate-${candidate.scope || "item"}-${candidate.id}`}
                          className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-xs font-medium text-zinc-200">
                                {autoMatchCandidateTitle(candidate)}
                              </p>
                              {candidate.referencia_principal ? (
                                <p className="mt-1 text-xs text-zinc-500">
                                  Ref. {candidate.referencia_principal}
                                </p>
                              ) : null}
                            </div>
                            {candidate.score != null ? (
                              <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2 py-0.5 text-xs text-cyan-200">
                                {candidate.score}
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2 text-xs text-zinc-500">
                            {candidateAmount != null ? (
                              <span>{formatCurrency(candidateAmount)}</span>
                            ) : null}
                            {candidateDate ? <span>{formatDate(candidateDate)}</span> : null}
                            {candidate.date_distance != null ? (
                              <span>{candidate.date_distance} dia(s)</span>
                            ) : null}
                            {candidate.reference_match ? (
                              <span className="text-emerald-200">referencia coincide</span>
                            ) : null}
                            {candidate.estatus ? <span>{getStatusLabel(candidate.estatus)}</span> : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4">
              <div className="border-b border-zinc-800 pb-3">
                <h4 className="font-semibold text-white">Sugerencias CxC</h4>
                <p className="mt-1 text-sm text-zinc-500">
                  Aplicacion directa sobre adeudos de clientes.
                </p>
              </div>
              <div className="mt-4 space-y-3">
                {selectedTransaction.candidatos.cxc.length === 0 ? (
                  <p className="text-sm text-zinc-500">
                    No hay candidatos claros de cuentas por cobrar.
                  </p>
                ) : (
                  selectedTransaction.candidatos.cxc.map((candidate) => (
                    <div
                      key={candidate.id}
                      className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium text-white">
                            {candidate.cliente_nombre}
                            {candidate.espacio_codigo ? ` | ${candidate.espacio_codigo}` : ""}
                          </p>
                          <p className="mt-1 text-sm text-zinc-400">{candidate.concepto}</p>
                          <p className="mt-1 text-xs text-zinc-500">
                            Vence {formatDate(candidate.fecha_vencimiento)} | Score {candidate.score}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <span className={`rounded-full border px-2 py-0.5 text-[11px] ${getCandidateConfidenceClass(candidate.confidence_band)}`}>
                              {getCandidateConfidenceLabel(candidate.confidence_band)}
                            </span>
                            {candidate.amount_difference != null ? (
                              <span className="rounded-full border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-[11px] text-zinc-400">
                                Dif. {formatCurrency(candidate.amount_difference)}
                              </span>
                            ) : null}
                          </div>
                          {candidate.recommended_action ? (
                            <p className="mt-2 rounded-xl border border-cyan-500/10 bg-cyan-500/5 px-3 py-2 text-xs leading-5 text-cyan-50/80">
                              {candidate.recommended_action}
                            </p>
                          ) : null}
                          {candidate.warnings?.length ? (
                            <p className="mt-2 rounded-xl border border-amber-500/10 bg-amber-500/5 px-3 py-2 text-xs leading-5 text-amber-100/80">
                              {candidate.warnings[0]}
                            </p>
                          ) : null}
                          {candidate.reasons?.length ? (
                            <ul className="mt-3 space-y-1 text-xs text-zinc-500">
                              {candidate.reasons.slice(0, 4).map((reason, index) => (
                                <li key={`cxc-${candidate.id}-reason-${index}`}>- {reason}</li>
                              ))}
                            </ul>
                          ) : null}
                        </div>
                        <div className="text-right">
                          <p className="font-semibold text-white">
                            {formatCurrency(candidate.saldo_pendiente)}
                          </p>
                          <button
                            type="button"
                            disabled={isWorking}
                            onClick={() => void handleApplyCxC(candidate.id)}
                            className="mt-3 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-200 transition-colors hover:bg-emerald-500/20 disabled:opacity-50"
                          >
                            Aplicar a CxC
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4">
              <div className="border-b border-zinc-800 pb-3">
                <h4 className="font-semibold text-white">Sugerencias CxP</h4>
                <p className="mt-1 text-sm text-zinc-500">
                  Clasificacion directa de salidas hacia gastos operativos.
                </p>
              </div>
              <div className="mt-4 space-y-3">
                {selectedTransaction.candidatos.cxp.length === 0 ? (
                  <p className="text-sm text-zinc-500">
                    No hay candidatos claros de cuentas por pagar.
                  </p>
                ) : (
                  selectedTransaction.candidatos.cxp.map((candidate) => (
                    <div
                      key={candidate.id}
                      className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium text-white">{candidate.proveedor_nombre}</p>
                          <p className="mt-1 text-sm text-zinc-400">
                            {candidate.concepto} | {candidate.categoria}
                          </p>
                          <p className="mt-1 text-xs text-zinc-500">
                            Vence {formatDate(candidate.fecha_vencimiento)} | Score {candidate.score}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <span className={`rounded-full border px-2 py-0.5 text-[11px] ${getCandidateConfidenceClass(candidate.confidence_band)}`}>
                              {getCandidateConfidenceLabel(candidate.confidence_band)}
                            </span>
                            {candidate.amount_difference != null ? (
                              <span className="rounded-full border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-[11px] text-zinc-400">
                                Dif. {formatCurrency(candidate.amount_difference)}
                              </span>
                            ) : null}
                          </div>
                          {candidate.recommended_action ? (
                            <p className="mt-2 rounded-xl border border-cyan-500/10 bg-cyan-500/5 px-3 py-2 text-xs leading-5 text-cyan-50/80">
                              {candidate.recommended_action}
                            </p>
                          ) : null}
                          {candidate.warnings?.length ? (
                            <p className="mt-2 rounded-xl border border-amber-500/10 bg-amber-500/5 px-3 py-2 text-xs leading-5 text-amber-100/80">
                              {candidate.warnings[0]}
                            </p>
                          ) : null}
                          {candidate.reasons?.length ? (
                            <ul className="mt-3 space-y-1 text-xs text-zinc-500">
                              {candidate.reasons.slice(0, 4).map((reason, index) => (
                                <li key={`cxp-${candidate.id}-reason-${index}`}>- {reason}</li>
                              ))}
                            </ul>
                          ) : null}
                        </div>
                        <div className="text-right">
                          <p className="font-semibold text-white">
                            {formatCurrency(candidate.saldo_pendiente)}
                          </p>
                          <button
                            type="button"
                            disabled={isWorking}
                            onClick={() => void handleApplyCxP(candidate.id)}
                            className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-200 transition-colors hover:bg-amber-500/20 disabled:opacity-50"
                          >
                            Aplicar a CxP
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4">
              <h4 className="font-semibold text-white">Pagos CxC ya aplicados</h4>
              <div className="mt-4 space-y-3">
                {selectedTransaction.pagos_cxc.length === 0 ? (
                  <p className="text-sm text-zinc-500">Aún no hay aplicaciones a CxC.</p>
                ) : (
                  selectedTransaction.pagos_cxc.map((payment) => (
                    <div
                      key={payment.id}
                      className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium text-white">{payment.cliente_nombre}</p>
                          <p className="mt-1 text-sm text-zinc-400">{payment.concepto}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold text-white">
                            {formatCurrency(payment.monto)}
                          </p>
                          <p className="mt-1 text-xs text-zinc-500">
                            {payment.estatus_validacion}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4">
              <h4 className="font-semibold text-white">Pagos CxP ya aplicados</h4>
              <div className="mt-4 space-y-3">
                {selectedTransaction.pagos_cxp.length === 0 ? (
                  <p className="text-sm text-zinc-500">Aún no hay aplicaciones a CxP.</p>
                ) : (
                  selectedTransaction.pagos_cxp.map((payment) => (
                    <div
                      key={payment.id}
                      className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium text-white">{payment.proveedor_nombre}</p>
                          <p className="mt-1 text-sm text-zinc-400">{payment.concepto}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold text-white">
                            {formatCurrency(payment.monto)}
                          </p>
                          <p className="mt-1 text-xs text-zinc-500">
                            {payment.estatus_validacion}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
        </div>
      ) : null}
    </section>
  );
}
