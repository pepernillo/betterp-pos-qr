"use client";

import { buildApiUrl } from '@/lib/api';

import { type FormEvent, useEffect, useState } from "react";

import ConciliacionBancoPanel from "./ConciliacionBancoPanel";

const COMUNICACIONES_API_BASE = buildApiUrl("/comunicaciones");
const EMPRESAS_API_BASE = buildApiUrl("/empresas");
const CRM_API_BASE = buildApiUrl("/crm");
const FINANZAS_API_BASE = buildApiUrl("/finanzas");

interface SimpleOption {
  id: number;
  nombre: string;
}

interface CaseSummary {
  id: number;
  entidad_id?: number | null;
  entidad_nombre?: string | null;
  cliente_id?: number | null;
  cliente_nombre?: string | null;
  clave_externa?: string | null;
  grupo_externo_id?: string | null;
  canal: string;
  remitente: string;
  remitente_nombre?: string | null;
  estatus: string;
  texto_consolidado?: string | null;
  caption_consolidado?: string | null;
  mensajes_count: number;
  evidencias_count: number;
  eventos_count: number;
  fecha_ultimo_mensaje: string;
}

interface CaseEvidence {
  id: number;
  tipo_movimiento: string;
  monto_reportado: number;
  fecha_pago_reportada?: string | null;
  referencia_reportada?: string | null;
  texto_extraido?: string | null;
  url_archivo?: string | null;
  estatus: string;
}

interface CaseDetail extends CaseSummary {
  mensajes: Array<{
    id: number;
    fecha_mensaje: string;
    texto?: string | null;
    remitente: string;
    remitente_nombre?: string | null;
    url_adjunto?: string | null;
  }>;
  evidencias: CaseEvidence[];
  eventos: Array<{
    id: number;
    estatus: string;
    tipo_movimiento: string;
    monto_total_reportado: number;
    fecha_evento: string;
    transaccion_id?: number | null;
  }>;
}

interface EventSummary {
  id: number;
  estatus: string;
  origen_evento: string;
  tipo_movimiento: string;
  entidad_id?: number | null;
  entidad_nombre?: string | null;
  cliente_id?: number | null;
  cliente_nombre?: string | null;
  caso_id?: number | null;
  evidencia_id?: number | null;
  transaccion_id?: number | null;
  unidad_detectada?: string | null;
  beneficiario_principal?: string | null;
  referencia_principal?: string | null;
  fecha_evento: string;
  monto_total_reportado: number;
  confianza_global: number;
  requiere_revision_manual: boolean;
  texto_consolidado?: string | null;
  observaciones?: string | null;
  raw_data?: Record<string, unknown> | null;
  partidas_count: number;
  partidas_aplicadas: number;
}

interface EventCandidate {
  id: number;
  concepto: string;
  espacio_codigo?: string | null;
  proveedor_nombre?: string | null;
  categoria?: string | null;
  fecha_vencimiento: string;
  saldo_pendiente: number;
}

interface EventDetail extends EventSummary {
  partidas: EventPartida[];
  pagos_cxc: Array<{ id: number; monto: number; fecha_pago: string; cuenta_id: number }>;
  pagos_cxp: Array<{ id: number; monto: number; fecha_pago: string; cuenta_id: number }>;
  transaccion?: TransactionRow | null;
  evidencia?: {
    id: number;
    estatus: string;
    monto_reportado: number;
    fecha_pago_reportada?: string | null;
    referencia_reportada?: string | null;
    url_archivo?: string | null;
  } | null;
  caso?: {
    id: number;
    estatus: string;
    canal: string;
    remitente: string;
    remitente_nombre?: string | null;
    texto_consolidado?: string | null;
    caption_consolidado?: string | null;
  } | null;
  candidatos: {
    cxc: EventCandidate[];
    cxp: EventCandidate[];
  };
}

interface EventPartida {
  id?: number;
  orden: number;
  tipo_destino: string;
  entidad_id?: number | null;
  entidad_nombre?: string | null;
  cliente_id?: number | null;
  cliente_nombre?: string | null;
  cuenta_cxc_id?: number | null;
  cuenta_cxp_id?: number | null;
  concepto: string;
  beneficiario?: string | null;
  unidad_referencia?: string | null;
  periodo_referencia?: string | null;
  monto_partida: number;
  confianza: number;
  requiere_revision_manual: boolean;
  estatus: string;
  metadata?: Record<string, unknown>;
  observaciones?: string | null;
}

interface TransactionRow {
  id: number;
  origen: string;
  tipo_movimiento: string;
  monto: number;
  fecha_pago: string;
  concepto_bancario?: string | null;
  numero_referencia?: string | null;
  estatus_conciliacion: string;
  evento_id?: number | null;
}

interface EventsDashboardResponse {
  metricas: {
    total: number;
    nuevos: number;
    propuestos: number;
    pendientes_aplicacion: number;
    aplicados: number;
    conciliados: number;
    ambiguos: number;
    duplicados: number;
    no_identificados: number;
  };
  items: EventSummary[];
  transacciones_pendientes: TransactionRow[];
}

interface EventPartidaFormState {
  orden: string;
  tipo_destino: string;
  entidad_id: string;
  cliente_id: string;
  cuenta_cxc_id: string;
  cuenta_cxp_id: string;
  concepto: string;
  beneficiario: string;
  unidad_referencia: string;
  periodo_referencia: string;
  monto_partida: string;
  confianza: string;
  requiere_revision_manual: boolean;
  estatus: string;
  metadata?: Record<string, unknown>;
  observaciones: string;
}

interface EventFormState {
  id: number | null;
  caso_id: string;
  evidencia_id: string;
  entidad_id: string;
  cliente_id: string;
  transaccion_id: string;
  origen_evento: string;
  tipo_movimiento: string;
  unidad_detectada: string;
  beneficiario_principal: string;
  referencia_principal: string;
  fecha_evento: string;
  monto_total_reportado: string;
  confianza_global: string;
  requiere_revision_manual: boolean;
  texto_consolidado: string;
  observaciones: string;
  estatus: string;
  partidas: EventPartidaFormState[];
}

interface FilterState {
  estatus: string;
  tipo_movimiento: string;
  busqueda: string;
}

const DEFAULT_FILTERS: FilterState = {
  estatus: "",
  tipo_movimiento: "",
  busqueda: "",
};

function todayIsoString() {
  return new Date().toISOString().slice(0, 10);
}

function emptyPartida(
  tipoMovimiento = "INGRESO",
  entidadId = "",
  clienteId = ""
): EventPartidaFormState {
  return {
    orden: "1",
    tipo_destino: tipoMovimiento === "EGRESO" ? "CXP" : "CXC",
    entidad_id: entidadId,
    cliente_id: clienteId,
    cuenta_cxc_id: "",
    cuenta_cxp_id: "",
    concepto: "",
    beneficiario: "",
    unidad_referencia: "",
    periodo_referencia: "",
    monto_partida: "",
    confianza: "0",
    requiere_revision_manual: false,
    estatus: "PROPUESTA",
    metadata: {},
    observaciones: "",
  };
}

function emptyEventForm(): EventFormState {
  return {
    id: null,
    caso_id: "",
    evidencia_id: "",
    entidad_id: "",
    cliente_id: "",
    transaccion_id: "",
    origen_evento: "MANUAL",
    tipo_movimiento: "INGRESO",
    unidad_detectada: "",
    beneficiario_principal: "",
    referencia_principal: "",
    fecha_evento: todayIsoString(),
    monto_total_reportado: "",
    confianza_global: "0",
    requiere_revision_manual: false,
    texto_consolidado: "",
    observaciones: "",
    estatus: "PROPUESTO",
    partidas: [emptyPartida()],
  };
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
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail?: unknown }).detail;
    if (typeof detail === "string" && detail.trim()) {
      return detail;
    }
  }

  return fallback;
}

function eventStatusClass(status: string) {
  switch (status) {
    case "CONCILIADO":
      return "border-emerald-500/20 bg-emerald-500/10 text-emerald-300";
    case "APLICADO":
      return "border-cyan-500/20 bg-cyan-500/10 text-cyan-200";
    case "PENDIENTE_APLICACION":
      return "border-amber-500/20 bg-amber-500/10 text-amber-200";
    case "AMBIGUO":
    case "NO_IDENTIFICADO":
      return "border-red-500/20 bg-red-500/10 text-red-300";
    case "DUPLICADO":
      return "border-zinc-700 bg-zinc-900 text-zinc-400";
    default:
      return "border-blue-500/20 bg-blue-500/10 text-blue-300";
  }
}

function eventStatusLabel(status: string) {
  switch (status) {
    case "NUEVO":
      return "Nuevo";
    case "PROPUESTO":
      return "Propuesto";
    case "PENDIENTE_APLICACION":
      return "Pendiente";
    case "APLICADO":
      return "Aplicado";
    case "CONCILIADO":
      return "Conciliado";
    case "AMBIGUO":
      return "Ambiguo";
    case "DUPLICADO":
      return "Duplicado";
    case "NO_IDENTIFICADO":
      return "No identificado";
    case "DESCARTADO":
      return "Descartado";
    default:
      return status;
  }
}

function metadataValue(data: Record<string, unknown> | null | undefined, key: string): string {
  const value = data?.[key];
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

function isPortalEvent(event?: EventSummary | EventDetail | null): boolean {
  if (!event) {
    return false;
  }
  if (metadataValue(event.raw_data, "origen") === "PORTAL_CLIENTE") {
    return true;
  }
  return event.origen_evento === "ESTADO_CUENTA" && /portal cliente/i.test(event.observaciones || "");
}

function eventSourceLabel(event: EventSummary | EventDetail): string {
  if (isPortalEvent(event)) {
    return "Portal cliente";
  }
  switch (event.origen_evento) {
    case "WHATSAPP":
      return "WhatsApp";
    case "ESTADO_CUENTA":
      return "Estado de cuenta";
    case "WEBHOOK":
      return "Webhook";
    case "AJUSTE_SISTEMA":
      return "Ajuste sistema";
    default:
      return "Manual";
  }
}

function appliedPendingBank(event?: EventSummary | EventDetail | null): boolean {
  return Boolean(isPortalEvent(event) && event?.estatus === "APLICADO" && !event.transaccion_id);
}

function transactionStatusClass(status: string) {
  switch (status) {
    case "VINCULADO":
      return "border-emerald-500/20 bg-emerald-500/10 text-emerald-300";
    case "NO_IDENTIFICADO":
      return "border-red-500/20 bg-red-500/10 text-red-300";
    default:
      return "border-amber-500/20 bg-amber-500/10 text-amber-200";
  }
}

function transactionStatusLabel(status: string) {
  switch (status) {
    case "EN_ESPERA":
      return "En espera";
    case "NO_IDENTIFICADO":
      return "No identificado";
    case "VINCULADO":
      return "Vinculado";
    default:
      return status;
  }
}

function caseStatusClass(status: string) {
  switch (status) {
    case "CONCILIADO":
      return "border-emerald-500/20 bg-emerald-500/10 text-emerald-300";
    case "VINCULADO":
      return "border-cyan-500/20 bg-cyan-500/10 text-cyan-200";
    case "EN_REVISION":
      return "border-amber-500/20 bg-amber-500/10 text-amber-200";
    case "DESCARTADO":
      return "border-zinc-700 bg-zinc-900 text-zinc-400";
    default:
      return "border-blue-500/20 bg-blue-500/10 text-blue-300";
  }
}

function mapEventDetailToForm(detail: EventDetail): EventFormState {
  return {
    id: detail.id,
    caso_id: detail.caso_id ? String(detail.caso_id) : "",
    evidencia_id: detail.evidencia_id ? String(detail.evidencia_id) : "",
    entidad_id: detail.entidad_id ? String(detail.entidad_id) : "",
    cliente_id: detail.cliente_id ? String(detail.cliente_id) : "",
    transaccion_id: detail.transaccion_id ? String(detail.transaccion_id) : "",
    origen_evento: detail.origen_evento,
    tipo_movimiento: detail.tipo_movimiento,
    unidad_detectada: detail.unidad_detectada || "",
    beneficiario_principal: detail.beneficiario_principal || "",
    referencia_principal: detail.referencia_principal || "",
    fecha_evento: detail.fecha_evento ? String(detail.fecha_evento).slice(0, 10) : todayIsoString(),
    monto_total_reportado: String(detail.monto_total_reportado || ""),
    confianza_global: String(detail.confianza_global || 0),
    requiere_revision_manual: detail.requiere_revision_manual,
    texto_consolidado: detail.texto_consolidado || "",
    observaciones: detail.observaciones || "",
    estatus: detail.estatus,
    partidas:
      detail.partidas.length > 0
        ? detail.partidas.map((partida, index) => ({
            orden: String(partida.orden || index + 1),
            tipo_destino: partida.tipo_destino,
            entidad_id: partida.entidad_id ? String(partida.entidad_id) : "",
            cliente_id: partida.cliente_id ? String(partida.cliente_id) : "",
            cuenta_cxc_id: partida.cuenta_cxc_id ? String(partida.cuenta_cxc_id) : "",
            cuenta_cxp_id: partida.cuenta_cxp_id ? String(partida.cuenta_cxp_id) : "",
            concepto: partida.concepto || "",
            beneficiario: partida.beneficiario || "",
            unidad_referencia: partida.unidad_referencia || "",
            periodo_referencia: partida.periodo_referencia || "",
            monto_partida: String(partida.monto_partida || ""),
            confianza: String(partida.confianza || 0),
            requiere_revision_manual: partida.requiere_revision_manual,
            estatus: partida.estatus || "PROPUESTA",
            metadata: partida.metadata || {},
            observaciones: partida.observaciones || "",
          }))
        : [emptyPartida(detail.tipo_movimiento)],
  };
}

function buildEventPayload(form: EventFormState) {
  const partidas = form.partidas
    .filter((item) => item.concepto.trim() || item.monto_partida.trim())
    .map((item, index) => ({
      orden: Number(item.orden) || index + 1,
      tipo_destino: item.tipo_destino,
      entidad_id: item.entidad_id ? Number(item.entidad_id) : null,
      cliente_id: item.cliente_id ? Number(item.cliente_id) : null,
      cuenta_cxc_id: item.cuenta_cxc_id ? Number(item.cuenta_cxc_id) : null,
      cuenta_cxp_id: item.cuenta_cxp_id ? Number(item.cuenta_cxp_id) : null,
      concepto: item.concepto.trim() || "Sin concepto",
      beneficiario: item.beneficiario.trim(),
      unidad_referencia: item.unidad_referencia.trim(),
      periodo_referencia: item.periodo_referencia.trim(),
      monto_partida: Number(item.monto_partida) || 0,
      confianza: Number(item.confianza) || 0,
      requiere_revision_manual: item.requiere_revision_manual,
      estatus: item.estatus,
      metadata: item.metadata || {},
      observaciones: item.observaciones.trim(),
    }));

  const montoTotal =
    Number(form.monto_total_reportado) ||
    partidas.reduce((sum, item) => sum + Number(item.monto_partida || 0), 0);

  return {
    caso_id: form.caso_id ? Number(form.caso_id) : null,
    evidencia_id: form.evidencia_id ? Number(form.evidencia_id) : null,
    entidad_id: form.entidad_id ? Number(form.entidad_id) : null,
    cliente_id: form.cliente_id ? Number(form.cliente_id) : null,
    transaccion_id: form.transaccion_id ? Number(form.transaccion_id) : null,
    origen_evento: form.origen_evento,
    tipo_movimiento: form.tipo_movimiento,
    unidad_detectada: form.unidad_detectada.trim(),
    beneficiario_principal: form.beneficiario_principal.trim(),
    referencia_principal: form.referencia_principal.trim(),
    fecha_evento: form.fecha_evento,
    monto_total_reportado: montoTotal,
    confianza_global: Number(form.confianza_global) || 0,
    requiere_revision_manual: form.requiere_revision_manual,
    texto_consolidado: form.texto_consolidado,
    observaciones: form.observaciones,
    estatus: form.estatus,
    partidas,
  };
}

function MetricCard({
  label,
  value,
  helper,
  tone = "default",
}: {
  label: string;
  value: string;
  helper?: string;
  tone?: "default" | "blue" | "emerald" | "amber" | "red";
}) {
  const toneClass =
    tone === "blue"
      ? "border-blue-500/20 bg-blue-500/10"
      : tone === "emerald"
        ? "border-emerald-500/20 bg-emerald-500/10"
        : tone === "amber"
          ? "border-amber-500/20 bg-amber-500/10"
          : tone === "red"
            ? "border-red-500/20 bg-red-500/10"
            : "border-zinc-800 bg-zinc-950/70";

  return (
    <div className={`metric-card-compact ${toneClass}`}>
      <p className="metric-label-compact">
        {label}
      </p>
      <p className="metric-value-compact">{value}</p>
      {helper ? <p className="metric-helper-compact">{helper}</p> : null}
    </div>
  );
}

type ConciliacionTab = "ruta" | "banco" | "revision" | "editor";

function ConciliacionTabButton({
  active,
  label,
  helper,
  badge,
  onClick,
}: {
  active: boolean;
  label: string;
  helper: string;
  badge: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-w-[220px] rounded-2xl border px-4 py-3 text-left transition-colors ${
        active
          ? "border-cyan-500/30 bg-cyan-500/10"
          : "border-zinc-800 bg-zinc-950/60 hover:border-zinc-700"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-white">{label}</p>
          <p className="mt-1 text-xs text-zinc-500">{helper}</p>
        </div>
        <span
          className={`rounded-full border px-2.5 py-1 text-[11px] uppercase tracking-[0.18em] ${
            active
              ? "border-cyan-500/30 bg-cyan-500/10 text-cyan-200"
              : "border-zinc-800 bg-zinc-900 text-zinc-500"
          }`}
        >
          {badge}
        </span>
      </div>
    </button>
  );
}

function WorkflowCard({
  step,
  title,
  description,
  tone = "neutral",
}: {
  step: string;
  title: string;
  description: string;
  tone?: "neutral" | "cyan" | "emerald" | "amber";
}) {
  const toneClass =
    tone === "cyan"
      ? "border-cyan-500/20 bg-cyan-500/10"
      : tone === "emerald"
        ? "border-emerald-500/20 bg-emerald-500/10"
        : tone === "amber"
          ? "border-amber-500/20 bg-amber-500/10"
          : "border-zinc-800 bg-zinc-950/60";

  return (
    <article className={`rounded-2xl border p-5 ${toneClass}`}>
      <p className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">
        Paso {step}
      </p>
      <h3 className="mt-3 text-lg font-semibold text-white">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-zinc-400">{description}</p>
    </article>
  );
}

export default function ConciliacionManager() {
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [draftFilters, setDraftFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [dashboard, setDashboard] = useState<EventsDashboardResponse | null>(null);
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [entities, setEntities] = useState<SimpleOption[]>([]);
  const [clients, setClients] = useState<SimpleOption[]>([]);
  const [selectedCase, setSelectedCase] = useState<CaseDetail | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<EventDetail | null>(null);
  const [selectedTransactionId, setSelectedTransactionId] = useState<number | null>(
    null
  );
  const [form, setForm] = useState<EventFormState>(emptyEventForm());
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isWorkingAction, setIsWorkingAction] = useState(false);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [activeTab, setActiveTab] = useState<ConciliacionTab>("ruta");

  const loadOptions = async () => {
    const [entitiesResponse, clientsResponse] = await Promise.all([
      fetch(`${EMPRESAS_API_BASE}/lista/`, { cache: "no-store" }),
      fetch(`${CRM_API_BASE}/lista/?page=1&page_size=100`, { cache: "no-store" }),
    ]);

    const entitiesBody = (await entitiesResponse.json()) as unknown;
    if (entitiesResponse.ok && Array.isArray(entitiesBody)) {
      setEntities(
        entitiesBody.map((item) => ({
          id: Number((item as { id: number }).id),
          nombre: String(
            (item as { nombre_comercial?: string; nombre?: string }).nombre_comercial ||
              (item as { nombre?: string }).nombre ||
              `Entidad ${(item as { id: number }).id}`
          ),
        }))
      );
    }

    const clientsBody = (await clientsResponse.json()) as unknown;
    if (
      clientsResponse.ok &&
      clientsBody &&
      typeof clientsBody === "object" &&
      "items" in clientsBody &&
      Array.isArray((clientsBody as { items: unknown[] }).items)
    ) {
      setClients(
        (clientsBody as { items: Array<{ id: number; nombre: string }> }).items.map(
          (item) => ({
            id: item.id,
            nombre: item.nombre,
          })
        )
      );
    }
  };

  const loadDashboard = async (activeFilters: FilterState) => {
    const params = new URLSearchParams();
    if (activeFilters.estatus) {
      params.set("estatus", activeFilters.estatus);
    }
    if (activeFilters.tipo_movimiento) {
      params.set("tipo_movimiento", activeFilters.tipo_movimiento);
    }
    if (activeFilters.busqueda.trim()) {
      params.set("busqueda", activeFilters.busqueda.trim());
    }

    const response = await fetch(
      `${FINANZAS_API_BASE}/conciliacion/eventos/${params.toString() ? `?${params.toString()}` : ""}`,
      { cache: "no-store" }
    );
    const body = (await response.json()) as unknown;
    if (!response.ok) {
      throw new Error(
        getErrorMessage(body, "No se pudo cargar la bandeja de conciliacion.")
      );
    }
    setDashboard(body as EventsDashboardResponse);
  };

  const loadCases = async () => {
    const response = await fetch(`${COMUNICACIONES_API_BASE}/casos/`, {
      cache: "no-store",
    });
    const body = (await response.json()) as unknown;
    if (!response.ok) {
      throw new Error(
        getErrorMessage(body, "No se pudo cargar la bandeja de casos.")
      );
    }
    setCases(body as CaseSummary[]);
  };

  const loadEventDetail = async (eventId: number) => {
    const response = await fetch(
      `${FINANZAS_API_BASE}/conciliacion/eventos/${eventId}/`,
      { cache: "no-store" }
    );
    const body = (await response.json()) as unknown;
    if (!response.ok) {
      throw new Error(getErrorMessage(body, "No se pudo cargar el evento."));
    }
    const detail = body as EventDetail;
    setSelectedEvent(detail);
    setForm(mapEventDetailToForm(detail));
    setSelectedTransactionId(detail.transaccion_id || null);
    setActiveTab("editor");
    return detail;
  };

  const loadCaseDetail = async (caseId: number) => {
    const response = await fetch(`${COMUNICACIONES_API_BASE}/casos/${caseId}/`, {
      cache: "no-store",
    });
    const body = (await response.json()) as unknown;
    if (!response.ok) {
      throw new Error(getErrorMessage(body, "No se pudo cargar el caso."));
    }
    const detail = body as CaseDetail;
    setSelectedCase(detail);
    return detail;
  };

  const loadAll = async (activeFilters: FilterState) => {
    setIsLoading(true);
    try {
      await Promise.all([loadOptions(), loadDashboard(activeFilters), loadCases()]);
      setError("");
    } catch (loadError) {
      console.error("Error cargando conciliacion:", loadError);
      setError(
        loadError instanceof Error
          ? loadError.message
          : "No se pudo cargar la bandeja de conciliacion."
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadAll(filters);
  }, [filters]);

  const handleApplyFilters = (event: FormEvent) => {
    event.preventDefault();
    setFilters(draftFilters);
  };

  const handleResetForm = (caseDetail?: CaseDetail | null) => {
    const activeCase = caseDetail ?? selectedCase;
    setSelectedEvent(null);
    setSelectedTransactionId(null);
    if (activeCase) {
      const firstEvidence = activeCase.evidencias[0];
      setForm({
        id: null,
        caso_id: String(activeCase.id),
        evidencia_id: firstEvidence ? String(firstEvidence.id) : "",
        entidad_id: activeCase.entidad_id ? String(activeCase.entidad_id) : "",
        cliente_id: activeCase.cliente_id ? String(activeCase.cliente_id) : "",
        transaccion_id: "",
        origen_evento: "WHATSAPP",
        tipo_movimiento: firstEvidence?.tipo_movimiento || "INGRESO",
        unidad_detectada: "",
        beneficiario_principal: activeCase.cliente_nombre || "",
        referencia_principal: firstEvidence?.referencia_reportada || "",
        fecha_evento:
          firstEvidence?.fecha_pago_reportada?.slice(0, 10) || todayIsoString(),
        monto_total_reportado: firstEvidence ? String(firstEvidence.monto_reportado) : "",
        confianza_global: "0",
        requiere_revision_manual: false,
        texto_consolidado:
          [activeCase.caption_consolidado, activeCase.texto_consolidado]
            .filter(Boolean)
            .join("\n")
            .trim() || "",
        observaciones: "",
        estatus: "PROPUESTO",
        partidas: [
          {
            ...emptyPartida(
              firstEvidence?.tipo_movimiento || "INGRESO",
              activeCase.entidad_id ? String(activeCase.entidad_id) : "",
              activeCase.cliente_id ? String(activeCase.cliente_id) : ""
            ),
            concepto:
              firstEvidence?.tipo_movimiento === "EGRESO"
                ? "Egreso por clasificar"
                : "Cobro por clasificar",
            monto_partida: firstEvidence ? String(firstEvidence.monto_reportado) : "",
            beneficiario: activeCase.cliente_nombre || "",
          },
        ],
      });
      return;
    }
    setForm(emptyEventForm());
  };

  const handleSelectCase = async (caseId: number) => {
    try {
      const detail = await loadCaseDetail(caseId);
      setMensaje(`Caso ${detail.id} cargado en el editor.`);
      window.setTimeout(() => setMensaje(""), 2500);
      handleResetForm(detail);
    } catch (caseError) {
      console.error("Error cargando caso:", caseError);
      alert(caseError instanceof Error ? caseError.message : "No se pudo cargar el caso.");
    }
  };

  const handleSaveEvent = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSaving(true);

    const url = form.id
      ? `${FINANZAS_API_BASE}/conciliacion/eventos/${form.id}/?include_event_detail=false`
      : `${FINANZAS_API_BASE}/conciliacion/eventos/?include_event_detail=false`;
    const method = form.id ? "PUT" : "POST";

    try {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildEventPayload(form)),
      });
      const body = (await response.json()) as unknown;
      if (!response.ok) {
        throw new Error(getErrorMessage(body, "No se pudo guardar el evento."));
      }

      const payload = body as { id?: number; evento?: { id?: number } | null };
      const savedEventId = payload.evento?.id || payload.id;
      setMensaje(
        form.id
          ? "Evento financiero actualizado correctamente."
          : "Evento financiero creado correctamente."
      );
      window.setTimeout(() => setMensaje(""), 3000);
      await loadDashboard(filters);
      await loadCases();
      if (savedEventId) {
        await loadEventDetail(savedEventId);
      } else {
        handleResetForm();
      }
    } catch (saveError) {
      console.error("Error guardando evento:", saveError);
      alert(saveError instanceof Error ? saveError.message : "No se pudo guardar el evento.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleApplyEvent = async () => {
    if (!form.id) {
      alert("Primero guarda el evento financiero antes de aplicarlo.");
      return;
    }

    setIsWorkingAction(true);
    try {
      const response = await fetch(
        `${FINANZAS_API_BASE}/conciliacion/eventos/${form.id}/aplicar/?include_event_detail=false`,
        { method: "POST" }
      );
      const body = (await response.json()) as unknown;
      if (!response.ok) {
        throw new Error(getErrorMessage(body, "No se pudo aplicar el evento."));
      }

      setMensaje("Evento aplicado correctamente.");
      window.setTimeout(() => setMensaje(""), 3000);
      await loadDashboard(filters);
      await loadCases();
      await loadEventDetail(form.id);
    } catch (actionError) {
      console.error("Error aplicando evento:", actionError);
      alert(actionError instanceof Error ? actionError.message : "No se pudo aplicar el evento.");
    } finally {
      setIsWorkingAction(false);
    }
  };

  const handleConciliateEvent = async (transactionId?: number | null) => {
    if (!form.id) {
      alert("Primero guarda el evento financiero antes de conciliarlo.");
      return;
    }

    const targetTransactionId =
      transactionId || selectedTransactionId || (form.transaccion_id ? Number(form.transaccion_id) : null);

    if (!targetTransactionId) {
      alert("Selecciona una transaccion bancaria para conciliar.");
      return;
    }

    setIsWorkingAction(true);
    try {
      const response = await fetch(
        `${FINANZAS_API_BASE}/conciliacion/eventos/${form.id}/conciliar/?include_event_detail=false`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transaccion_id: targetTransactionId,
            notas: "Conciliado manualmente desde la bandeja.",
          }),
        }
      );
      const body = (await response.json()) as unknown;
      if (!response.ok) {
        throw new Error(getErrorMessage(body, "No se pudo conciliar el evento."));
      }

      setMensaje("Evento conciliado correctamente.");
      window.setTimeout(() => setMensaje(""), 3000);
      setSelectedTransactionId(targetTransactionId);
      await loadDashboard(filters);
      await loadCases();
      await loadEventDetail(form.id);
    } catch (actionError) {
      console.error("Error conciliando evento:", actionError);
      alert(
        actionError instanceof Error ? actionError.message : "No se pudo conciliar el evento."
      );
    } finally {
      setIsWorkingAction(false);
    }
  };

  const handleAutoLinkTransaction = async (transactionId: number) => {
    setIsWorkingAction(true);
    try {
      const response = await fetch(
        `${FINANZAS_API_BASE}/conciliacion/transacciones/${transactionId}/auto-vincular/?include_detail=false&include_event_detail=false&include_transaction=false`,
        {
          method: "POST",
        }
      );
      const body = (await response.json()) as unknown;
      if (!response.ok) {
        throw new Error(
          getErrorMessage(body, "No se pudo auto-vincular la transaccion.")
        );
      }

      const payload = body as { evento?: EventDetail | null };
      setMensaje("Se ejecuto la busqueda automatica para esta transaccion.");
      window.setTimeout(() => setMensaje(""), 3000);
      await loadDashboard(filters);
      if (payload.evento?.id) {
        setSelectedTransactionId(transactionId);
        setActiveTab("editor");
        await loadEventDetail(payload.evento.id);
      }
    } catch (actionError) {
      console.error("Error auto-vinculando transaccion:", actionError);
      alert(
        actionError instanceof Error
          ? actionError.message
          : "No se pudo auto-vincular la transaccion."
      );
    } finally {
      setIsWorkingAction(false);
    }
  };

  const handleUseBankTransactionInEditor = (transactionId: number) => {
    setSelectedTransactionId(transactionId);
    setForm((current) => ({
      ...current,
      transaccion_id: String(transactionId),
    }));
    setActiveTab("editor");
    setMensaje(`Transaccion ${transactionId} vinculada al editor actual.`);
    window.setTimeout(() => setMensaje(""), 2500);
  };

  const handlePartidaChange = (
    index: number,
    field: keyof EventPartidaFormState,
    value: string | boolean
  ) => {
    setForm((current) => ({
      ...current,
      partidas: current.partidas.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item
      ),
    }));
  };

  const dashboardItems = dashboard?.items || [];
  const pendingTransactions = dashboard?.transacciones_pendientes || [];

  return (
    <div className="space-y-4">
      <section className="page-section">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-zinc-500">
              Conciliacion operativa
            </p>
            <h1 className="mt-1.5 page-title-compact">
              Centro de conciliacion
            </h1>
            <p className="section-copy-compact max-w-4xl">
              Organiza la conciliacion por etapas para que cualquier usuario
              entienda si primero debe revisar el banco, bajar a casos y eventos,
              o entrar directo al editor para cerrar una aplicacion.
            </p>
          </div>

          {activeTab === "revision" ? (
            <form
              onSubmit={handleApplyFilters}
              className="grid grid-cols-1 gap-3 rounded-2xl border border-zinc-800 bg-zinc-950/80 p-3 md:grid-cols-4"
            >
              <select
                value={draftFilters.estatus}
                onChange={(event) =>
                  setDraftFilters({ ...draftFilters, estatus: event.target.value })
                }
                className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-200 outline-none focus:ring-1 focus:ring-cyan-500"
              >
                <option value="">Todos los estatus</option>
                <option value="NUEVO">Nuevo</option>
                <option value="PROPUESTO">Propuesto</option>
                <option value="PENDIENTE_APLICACION">Pendiente aplicacion</option>
                <option value="APLICADO">Aplicado</option>
                <option value="CONCILIADO">Conciliado</option>
                <option value="AMBIGUO">Ambiguo</option>
                <option value="NO_IDENTIFICADO">No identificado</option>
              </select>

              <select
                value={draftFilters.tipo_movimiento}
                onChange={(event) =>
                  setDraftFilters({
                    ...draftFilters,
                    tipo_movimiento: event.target.value,
                  })
                }
                className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-200 outline-none focus:ring-1 focus:ring-cyan-500"
              >
                <option value="">Ingreso y egreso</option>
                <option value="INGRESO">Ingresos</option>
                <option value="EGRESO">Egresos</option>
              </select>

              <input
                type="text"
                placeholder="Buscar referencia, cliente o unidad..."
                value={draftFilters.busqueda}
                onChange={(event) =>
                  setDraftFilters({ ...draftFilters, busqueda: event.target.value })
                }
                className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none placeholder:text-zinc-500 focus:ring-1 focus:ring-cyan-500"
              />

              <button
                type="submit"
                className="rounded-xl bg-cyan-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-cyan-500"
              >
                Aplicar filtros
              </button>
            </form>
          ) : (
              <div className="page-section-tight text-sm text-zinc-400 xl:max-w-sm">
              {activeTab === "banco"
                ? "Banco se enfoca en cargar y limpiar el estado de cuenta antes de bajar a revision."
                : activeTab === "editor"
                  ? "Editor se enfoca en clasificar y aplicar un evento sin distraerte con la bandeja."
                  : "Usa Vista guiada para entender el flujo completo antes de operar."}
            </div>
          )}
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="flex flex-wrap gap-3">
            <ConciliacionTabButton
              active={activeTab === "ruta"}
              label="Vista guiada"
              helper="Resumen rapido del flujo y del estado operativo."
              badge="Inicio"
              onClick={() => setActiveTab("ruta")}
            />
            <ConciliacionTabButton
              active={activeTab === "banco"}
              label="Banco"
              helper="Importa estados, valida lotes y revisa movimientos."
              badge="Paso 1"
              onClick={() => setActiveTab("banco")}
            />
            <ConciliacionTabButton
              active={activeTab === "revision"}
              label="Revision"
              helper="Explora casos, propuestas y pendientes operativos."
              badge="Paso 2"
              onClick={() => setActiveTab("revision")}
            />
            <ConciliacionTabButton
              active={activeTab === "editor"}
              label="Editor"
              helper="Ajusta el evento, define partidas y concilia."
              badge="Paso 3"
              onClick={() => setActiveTab("editor")}
            />
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
              Como recorrer la vista
            </p>
            <div className="mt-3 space-y-2 text-sm text-zinc-400">
              <p>
                1. En <span className="text-white">Banco</span> importas y limpias
                el estado de cuenta.
              </p>
              <p>
                2. En <span className="text-white">Revision</span> confirmas que
                caso o evento necesita criterio humano.
              </p>
              <p>
                3. En <span className="text-white">Editor</span> cierras la
                clasificacion y la aplicacion contable.
              </p>
            </div>
          </div>
        </div>
      </section>

      {mensaje ? (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          {mensaje}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300">
          {error}
        </div>
      ) : null}

      {activeTab === "ruta" || activeTab === "revision" ? (
        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-6">
          <MetricCard
            label="Eventos"
            value={String(dashboard?.metricas.total || 0)}
            helper="Bandeja visible"
          />
          <MetricCard
            label="Nuevos"
            value={String(dashboard?.metricas.nuevos || 0)}
            helper="Casos recien capturados"
            tone="blue"
          />
          <MetricCard
            label="Pendientes"
            value={String(dashboard?.metricas.pendientes_aplicacion || 0)}
            helper="Requieren revision"
            tone="amber"
          />
          <MetricCard
            label="Aplicados"
            value={String(dashboard?.metricas.aplicados || 0)}
            helper="Listos para banco"
            tone="blue"
          />
          <MetricCard
            label="Conciliados"
            value={String(dashboard?.metricas.conciliados || 0)}
            helper="Ciclo completo"
            tone="emerald"
          />
          <MetricCard
            label="Ambiguos"
            value={String(
              (dashboard?.metricas.ambiguos || 0) +
                (dashboard?.metricas.no_identificados || 0)
            )}
            helper="Casos por resolver"
            tone="red"
          />
        </section>
      ) : null}

      {activeTab === "ruta" ? (
        <>
          <section className="grid grid-cols-1 gap-4 xl:grid-cols-4">
            <WorkflowCard
              step="01"
              title="Carga bancaria"
              description="Empieza importando el estado de cuenta para detectar movimientos duplicados, pendientes o no identificados."
              tone="cyan"
            />
            <WorkflowCard
              step="02"
              title="Revision operativa"
              description="Casos y eventos te ayudan a entender cliente, entidad, referencia y contexto real del dinero."
              tone="amber"
            />
            <WorkflowCard
              step="03"
              title="Edicion del evento"
              description="En el editor ajustas el origen, el tipo de movimiento y la forma correcta de repartir el monto."
            />
            <WorkflowCard
              step="04"
              title="Cierre"
              description="Cuando banco y operacion coinciden, aplicas las partidas y dejas la conciliacion lista."
              tone="emerald"
            />
          </section>

          <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label="Caso activo"
              value={selectedCase ? `#${selectedCase.id}` : "-"}
              helper={
                selectedCase
                  ? selectedCase.remitente_nombre || selectedCase.remitente
                  : "Aun no hay caso seleccionado"
              }
            />
            <MetricCard
              label="Evento actual"
              value={selectedEvent ? `#${selectedEvent.id}` : "-"}
              helper={
                selectedEvent
                  ? selectedEvent.referencia_principal || "Evento listo para ajuste"
                  : "Abre un evento desde Revision"
              }
              tone="blue"
            />
            <MetricCard
              label="Movimiento ligado"
              value={selectedTransactionId ? `#${selectedTransactionId}` : "-"}
              helper={
                selectedTransactionId
                  ? "Ya existe un movimiento bancario ligado"
                  : "Selecciona un movimiento desde Banco"
              }
              tone="amber"
            />
            <MetricCard
              label="Pendientes de banco"
              value={String(pendingTransactions.length)}
              helper="Movimientos visibles sin cierre completo"
              tone="red"
            />
          </section>
        </>
      ) : null}

      {activeTab === "banco" ? (
        <ConciliacionBancoPanel onUseInEditor={handleUseBankTransactionInEditor} />
      ) : null}

      {activeTab === "revision" ? (isLoading ? (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950 py-16 text-center text-zinc-500">
          Cargando bandeja de conciliacion...
        </div>
      ) : (
        <>
          <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <WorkflowCard
              step="A"
              title="Casos"
              description="Entradas crudas desde WhatsApp o captura manual que todavia requieren contexto."
            />
            <WorkflowCard
              step="B"
              title="Eventos"
              description="Propuestas listas para editar, aplicar o conciliar cuando el sistema ya encontro patron."
              tone="cyan"
            />
            <WorkflowCard
              step="C"
              title="Banco pendiente"
              description="Movimientos sin una asignacion final o que necesitan una decision humana."
              tone="amber"
            />
          </section>

          <section className="grid grid-cols-1 gap-6 xl:grid-cols-[320px_minmax(0,1fr)_340px]">
            <div className="rounded-3xl border border-zinc-800 bg-zinc-950/70 p-5">
              <div className="flex items-center justify-between gap-3 border-b border-zinc-800 pb-4">
                <div>
                  <h2 className="text-lg font-semibold text-white">Casos</h2>
                  <p className="mt-1 text-sm text-zinc-500">
                    Entradas desde WhatsApp o captura manual.
                  </p>
                </div>
                <span className="rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1 text-xs uppercase tracking-[0.2em] text-zinc-500">
                  {cases.length}
                </span>
              </div>

              <div className="mt-4 space-y-3">
                {cases.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/20 py-10 text-center text-sm text-zinc-500">
                    No hay casos registrados.
                  </div>
                ) : (
                  cases.slice(0, 15).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => void handleSelectCase(item.id)}
                      className={`w-full rounded-2xl border p-4 text-left transition-colors ${
                        selectedCase?.id === item.id
                          ? "border-cyan-500/30 bg-cyan-500/10"
                          : "border-zinc-800 bg-zinc-900/40 hover:border-zinc-700"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium text-white">
                            {item.remitente_nombre || item.remitente}
                          </p>
                          <p className="mt-1 text-xs text-zinc-500">
                            {item.cliente_nombre || "Cliente por detectar"}
                          </p>
                          <p className="mt-1 text-xs text-zinc-500">
                            {item.entidad_nombre || "Sin entidad"} | {formatDate(item.fecha_ultimo_mensaje)}
                          </p>
                        </div>
                        <span
                          className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${caseStatusClass(
                            item.estatus
                          )}`}
                        >
                          {item.estatus}
                        </span>
                      </div>
                      <div className="mt-3 flex items-center gap-3 text-xs text-zinc-500">
                        <span>{item.mensajes_count} mensajes</span>
                        <span>{item.evidencias_count} evidencias</span>
                        <span>{item.eventos_count} eventos</span>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-3xl border border-zinc-800 bg-zinc-950/70 p-5">
              <div className="flex items-center justify-between gap-3 border-b border-zinc-800 pb-4">
                <div>
                  <h2 className="text-lg font-semibold text-white">
                    Eventos financieros
                  </h2>
                  <p className="mt-1 text-sm text-zinc-500">
                    Propuestas y eventos ya listos para aplicar o conciliar.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    handleResetForm();
                    setActiveTab("editor");
                  }}
                  className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
                >
                  Nuevo evento
                </button>
              </div>

              <div className="mt-4 space-y-3">
                {dashboardItems.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/20 py-12 text-center text-sm text-zinc-500">
                    No hay eventos con los filtros actuales.
                  </div>
                ) : (
                  dashboardItems.map((item) => {
                    const isPortal = isPortalEvent(item);
                    const pendingBank = appliedPendingBank(item);
                    return (
                      <div
                        key={item.id}
                        className={`rounded-2xl border p-4 transition-colors ${
                          selectedEvent?.id === item.id
                            ? "border-cyan-500/30 bg-cyan-500/10"
                            : pendingBank
                              ? "border-emerald-500/20 bg-emerald-500/5"
                              : "border-zinc-800 bg-zinc-900/40"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <button
                            type="button"
                            onClick={() => void loadEventDetail(item.id)}
                            className="min-w-0 flex-1 text-left"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-medium text-white">
                                {item.referencia_principal || `Evento #${item.id}`}
                              </p>
                              <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-1 text-[11px] text-cyan-100">
                                {eventSourceLabel(item)}
                              </span>
                              {pendingBank ? (
                                <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] text-emerald-100">
                                  Pendiente banco
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-1 text-sm text-zinc-400">
                              {item.cliente_nombre || item.beneficiario_principal || "Sin cliente"} |{" "}
                              {item.entidad_nombre || "Sin entidad"}
                            </p>
                            <p className="mt-1 text-xs text-zinc-500">
                              {formatDate(item.fecha_evento)} | {item.tipo_movimiento}
                            </p>
                            {isPortal ? (
                              <p className="mt-2 text-xs text-emerald-200">
                                Pago ya aplicado a CxC; vincula el movimiento bancario cuando aparezca.
                              </p>
                            ) : null}
                          </button>
                          <div className="text-right">
                            <span
                              className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${eventStatusClass(
                                item.estatus
                              )}`}
                            >
                              {eventStatusLabel(item.estatus)}
                            </span>
                            <p className="mt-2 font-semibold text-white">
                              {formatCurrency(item.monto_total_reportado)}
                            </p>
                            <p className="mt-1 text-xs text-zinc-500">
                              {item.partidas_aplicadas}/{item.partidas_count} partidas
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className="rounded-3xl border border-zinc-800 bg-zinc-950/70 p-5">
              <div className="flex items-center justify-between gap-3 border-b border-zinc-800 pb-4">
                <div>
                  <h2 className="text-lg font-semibold text-white">
                    Banco pendiente
                  </h2>
                  <p className="mt-1 text-sm text-zinc-500">
                    Movimientos sin validar o sin asignacion clara.
                  </p>
                </div>
                <span className="rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1 text-xs uppercase tracking-[0.2em] text-zinc-500">
                  {pendingTransactions.length}
                </span>
              </div>

              <div className="mt-4 space-y-3">
                {pendingTransactions.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/20 py-10 text-center text-sm text-zinc-500">
                    No hay transacciones pendientes.
                  </div>
                ) : (
                  pendingTransactions.map((item) => (
                    <div
                      key={item.id}
                      className={`rounded-2xl border p-4 ${
                        selectedTransactionId === item.id
                          ? "border-cyan-500/30 bg-cyan-500/10"
                          : "border-zinc-800 bg-zinc-900/40"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedTransactionId(item.id)}
                        className="w-full text-left"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-medium text-white">
                              {formatCurrency(item.monto)}
                            </p>
                            <p className="mt-1 text-xs text-zinc-500">
                              {item.tipo_movimiento} | {formatDate(item.fecha_pago)}
                            </p>
                            <p className="mt-1 text-xs text-zinc-500">
                              {item.numero_referencia || item.concepto_bancario || "Sin referencia"}
                            </p>
                          </div>
                          <span
                            className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${transactionStatusClass(
                              item.estatus_conciliacion
                            )}`}
                          >
                            {transactionStatusLabel(item.estatus_conciliacion)}
                          </span>
                        </div>
                      </button>

                      <div className="mt-3 flex gap-2">
                        <button
                          type="button"
                          onClick={() => void handleAutoLinkTransaction(item.id)}
                          className="rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20"
                        >
                          Auto buscar
                        </button>
                        {form.id ? (
                          <button
                            type="button"
                            onClick={() => void handleConciliateEvent(item.id)}
                            className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-200 transition-colors hover:bg-emerald-500/20"
                          >
                            Conciliar con evento
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>
        </>
      )) : null}

      {activeTab === "editor" ? (
          <form
            onSubmit={handleSaveEvent}
            className="rounded-3xl border border-zinc-800 bg-zinc-950/70 p-6"
          >
            <div className="flex flex-col gap-4 border-b border-zinc-800 pb-5 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <h2 className="text-xl font-bold text-white">
                  {form.id ? `Evento #${form.id}` : "Editor de evento financiero"}
                </h2>
                <p className="mt-1 text-sm text-zinc-500">
                  Ajusta la propuesta, decide partidas y luego aplica o concilia.
                </p>
                {selectedCase ? (
                  <p className="mt-2 text-xs text-zinc-500">
                    Caso activo: #{selectedCase.id} | {selectedCase.remitente_nombre || selectedCase.remitente}
                  </p>
                ) : null}
                {appliedPendingBank(selectedEvent) ? (
                  <div className="mt-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-100">
                    Este pago viene del portal cliente y ya fue aplicado a CxC.
                    El siguiente paso es vincularlo con una transaccion bancaria,
                    no volver a aplicarlo.
                  </div>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => handleResetForm()}
                  className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
                >
                  Limpiar
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="rounded-xl bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:opacity-50"
                >
                  {isSaving ? "Guardando..." : form.id ? "Guardar cambios" : "Crear evento"}
                </button>
                {form.id ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void handleApplyEvent()}
                      disabled={isWorkingAction || appliedPendingBank(selectedEvent)}
                      className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-2 text-sm font-medium text-amber-200 transition-colors hover:bg-amber-500/20 disabled:opacity-50"
                    >
                      Aplicar
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleConciliateEvent()}
                      disabled={isWorkingAction}
                      className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-200 transition-colors hover:bg-emerald-500/20 disabled:opacity-50"
                    >
                      Conciliar
                    </button>
                  </>
                ) : null}
              </div>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-3">
              <WorkflowCard
                step="1"
                title="Origen y soporte"
                description="Relaciona el evento con su caso, evidencia y transaccion bancaria para no perder trazabilidad."
                tone="cyan"
              />
              <WorkflowCard
                step="2"
                title="Clasificacion"
                description="Confirma entidad, cliente, tipo de movimiento, monto y confianza antes de aplicar."
                tone="amber"
              />
              <WorkflowCard
                step="3"
                title="Partidas"
                description="Divide el movimiento entre CxC, CxP, saldo a favor o excepciones no identificadas."
                tone="emerald"
              />
            </div>

            <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-zinc-400">
                  Caso
                </label>
                <input
                  type="number"
                  value={form.caso_id}
                  onChange={(event) =>
                    setForm({ ...form, caso_id: event.target.value })
                  }
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-zinc-400">
                  Evidencia
                </label>
                <input
                  type="number"
                  value={form.evidencia_id}
                  onChange={(event) =>
                    setForm({ ...form, evidencia_id: event.target.value })
                  }
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-zinc-400">
                  Transaccion bancaria
                </label>
                <input
                  type="number"
                  value={form.transaccion_id}
                  onChange={(event) =>
                    setForm({ ...form, transaccion_id: event.target.value })
                  }
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-zinc-400">
                  Estatus
                </label>
                <select
                  value={form.estatus}
                  onChange={(event) =>
                    setForm({ ...form, estatus: event.target.value })
                  }
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-200 outline-none focus:ring-1 focus:ring-cyan-500"
                >
                  <option value="PROPUESTO">Propuesto</option>
                  <option value="PENDIENTE_APLICACION">Pendiente aplicacion</option>
                  <option value="APLICADO">Aplicado</option>
                  <option value="CONCILIADO">Conciliado</option>
                  <option value="NO_IDENTIFICADO">No identificado</option>
                  <option value="AMBIGUO">Ambiguo</option>
                  <option value="DESCARTADO">Descartado</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-zinc-400">
                  Entidad
                </label>
                <select
                  value={form.entidad_id}
                  onChange={(event) =>
                    setForm({ ...form, entidad_id: event.target.value })
                  }
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-200 outline-none focus:ring-1 focus:ring-cyan-500"
                >
                  <option value="">Sin entidad</option>
                  {entities.map((entity) => (
                    <option key={entity.id} value={entity.id}>
                      {entity.nombre}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-zinc-400">
                  Cliente
                </label>
                <select
                  value={form.cliente_id}
                  onChange={(event) =>
                    setForm({ ...form, cliente_id: event.target.value })
                  }
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-200 outline-none focus:ring-1 focus:ring-cyan-500"
                >
                  <option value="">Sin cliente</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.nombre}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-zinc-400">
                  Origen del evento
                </label>
                <select
                  value={form.origen_evento}
                  onChange={(event) =>
                    setForm({ ...form, origen_evento: event.target.value })
                  }
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-200 outline-none focus:ring-1 focus:ring-cyan-500"
                >
                  <option value="MANUAL">Manual</option>
                  <option value="WHATSAPP">WhatsApp</option>
                  <option value="ESTADO_CUENTA">Estado de cuenta</option>
                  <option value="WEBHOOK">Webhook</option>
                  <option value="AJUSTE_SISTEMA">Ajuste sistema</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-zinc-400">
                  Tipo de movimiento
                </label>
                <select
                  value={form.tipo_movimiento}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      tipo_movimiento: event.target.value,
                      partidas:
                        form.partidas.length > 0
                          ? form.partidas.map((item) => ({
                              ...item,
                              tipo_destino:
                                item.tipo_destino === "SALDO_A_FAVOR" ||
                                item.tipo_destino === "NO_IDENTIFICADO"
                                  ? item.tipo_destino
                                  : event.target.value === "EGRESO"
                                    ? "CXP"
                                    : "CXC",
                            }))
                          : [emptyPartida(event.target.value, form.entidad_id, form.cliente_id)],
                    })
                  }
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-200 outline-none focus:ring-1 focus:ring-cyan-500"
                >
                  <option value="INGRESO">Ingreso</option>
                  <option value="EGRESO">Egreso</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-zinc-400">
                  Fecha del evento
                </label>
                <input
                  type="date"
                  value={form.fecha_evento}
                  onChange={(event) =>
                    setForm({ ...form, fecha_evento: event.target.value })
                  }
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-zinc-400">
                  Monto total reportado
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.monto_total_reportado}
                  onChange={(event) =>
                    setForm({ ...form, monto_total_reportado: event.target.value })
                  }
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-zinc-400">
                  Confianza global
                </label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={form.confianza_global}
                  onChange={(event) =>
                    setForm({ ...form, confianza_global: event.target.value })
                  }
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                />
              </div>

              <div className="flex items-end">
                <label className="flex w-full items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-300">
                  <input
                    type="checkbox"
                    checked={form.requiere_revision_manual}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        requiere_revision_manual: event.target.checked,
                      })
                    }
                    className="h-4 w-4 rounded border-zinc-700 bg-zinc-900 text-cyan-500 focus:ring-cyan-500"
                  />
                  Requiere revision manual
                </label>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-zinc-400">
                  Beneficiario principal
                </label>
                <input
                  type="text"
                  value={form.beneficiario_principal}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      beneficiario_principal: event.target.value,
                    })
                  }
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-zinc-400">
                  Referencia principal
                </label>
                <input
                  type="text"
                  value={form.referencia_principal}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      referencia_principal: event.target.value,
                    })
                  }
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                />
              </div>

              <div className="md:col-span-2 xl:col-span-2">
                <label className="mb-1 block text-sm font-medium text-zinc-400">
                  Unidad detectada
                </label>
                <input
                  type="text"
                  value={form.unidad_detectada}
                  onChange={(event) =>
                    setForm({ ...form, unidad_detectada: event.target.value })
                  }
                  placeholder="Ej. Hills 1404 B"
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none placeholder:text-zinc-500 focus:ring-1 focus:ring-cyan-500"
                />
              </div>

              <div className="md:col-span-2 xl:col-span-4">
                <label className="mb-1 block text-sm font-medium text-zinc-400">
                  Texto consolidado
                </label>
                <textarea
                  rows={4}
                  value={form.texto_consolidado}
                  onChange={(event) =>
                    setForm({ ...form, texto_consolidado: event.target.value })
                  }
                  className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-3 py-3 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                />
              </div>

              <div className="md:col-span-2 xl:col-span-4">
                <label className="mb-1 block text-sm font-medium text-zinc-400">
                  Observaciones
                </label>
                <textarea
                  rows={3}
                  value={form.observaciones}
                  onChange={(event) =>
                    setForm({ ...form, observaciones: event.target.value })
                  }
                  className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-3 py-3 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                />
              </div>
            </div>

            <div className="mt-6 rounded-3xl border border-zinc-800 bg-zinc-950/60 p-5">
              <div className="flex items-center justify-between gap-3 border-b border-zinc-800 pb-4">
                <div>
                  <h3 className="text-lg font-semibold text-white">Partidas</h3>
                  <p className="mt-1 text-sm text-zinc-500">
                    Divide el movimiento en CxC, CxP, saldo a favor o no identificado.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setForm({
                      ...form,
                      partidas: [
                        ...form.partidas,
                        emptyPartida(form.tipo_movimiento, form.entidad_id, form.cliente_id),
                      ],
                    })
                  }
                  className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20"
                >
                  Agregar partida
                </button>
              </div>

              <div className="mt-4 space-y-4">
                {form.partidas.map((partida, index) => (
                  <div
                    key={`${index}-${partida.orden}`}
                    className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4"
                  >
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
                      <div>
                        <label className="mb-1 block text-xs font-medium text-zinc-500">
                          Orden
                        </label>
                        <input
                          type="number"
                          min="1"
                          value={partida.orden}
                          onChange={(event) =>
                            handlePartidaChange(index, "orden", event.target.value)
                          }
                          className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-medium text-zinc-500">
                          Destino
                        </label>
                        <select
                          value={partida.tipo_destino}
                          onChange={(event) =>
                            handlePartidaChange(index, "tipo_destino", event.target.value)
                          }
                          className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 outline-none focus:ring-1 focus:ring-cyan-500"
                        >
                          <option value="CXC">CxC</option>
                          <option value="CXP">CxP</option>
                          <option value="SALDO_A_FAVOR">Saldo a favor</option>
                          <option value="NO_IDENTIFICADO">No identificado</option>
                        </select>
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-medium text-zinc-500">
                          Monto
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={partida.monto_partida}
                          onChange={(event) =>
                            handlePartidaChange(index, "monto_partida", event.target.value)
                          }
                          className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-medium text-zinc-500">
                          Confianza
                        </label>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          value={partida.confianza}
                          onChange={(event) =>
                            handlePartidaChange(index, "confianza", event.target.value)
                          }
                          className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                        />
                      </div>

                      <div className="flex items-end justify-end">
                        <button
                          type="button"
                          onClick={() =>
                            setForm({
                              ...form,
                              partidas:
                                form.partidas.length === 1
                                  ? [emptyPartida(form.tipo_movimiento, form.entidad_id, form.cliente_id)]
                                  : form.partidas.filter((_, itemIndex) => itemIndex !== index),
                            })
                          }
                          className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-300 transition-colors hover:bg-red-500/20"
                        >
                          Quitar
                        </button>
                      </div>

                      <div className="xl:col-span-2">
                        <label className="mb-1 block text-xs font-medium text-zinc-500">
                          Concepto
                        </label>
                        <input
                          type="text"
                          value={partida.concepto}
                          onChange={(event) =>
                            handlePartidaChange(index, "concepto", event.target.value)
                          }
                          className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                        />
                      </div>

                      <div className="xl:col-span-2">
                        <label className="mb-1 block text-xs font-medium text-zinc-500">
                          Beneficiario
                        </label>
                        <input
                          type="text"
                          value={partida.beneficiario}
                          onChange={(event) =>
                            handlePartidaChange(index, "beneficiario", event.target.value)
                          }
                          className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-medium text-zinc-500">
                          Unidad referencia
                        </label>
                        <input
                          type="text"
                          value={partida.unidad_referencia}
                          onChange={(event) =>
                            handlePartidaChange(index, "unidad_referencia", event.target.value)
                          }
                          className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-medium text-zinc-500">
                          Periodo referencia
                        </label>
                        <input
                          type="text"
                          value={partida.periodo_referencia}
                          onChange={(event) =>
                            handlePartidaChange(index, "periodo_referencia", event.target.value)
                          }
                          className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-medium text-zinc-500">
                          Cuenta CxC
                        </label>
                        <input
                          type="number"
                          value={partida.cuenta_cxc_id}
                          onChange={(event) =>
                            handlePartidaChange(index, "cuenta_cxc_id", event.target.value)
                          }
                          className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-medium text-zinc-500">
                          Cuenta CxP
                        </label>
                        <input
                          type="number"
                          value={partida.cuenta_cxp_id}
                          onChange={(event) =>
                            handlePartidaChange(index, "cuenta_cxp_id", event.target.value)
                          }
                          className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                        />
                      </div>

                      <div className="xl:col-span-5">
                        <label className="mb-1 block text-xs font-medium text-zinc-500">
                          Observaciones
                        </label>
                        <textarea
                          rows={2}
                          value={partida.observaciones}
                          onChange={(event) =>
                            handlePartidaChange(index, "observaciones", event.target.value)
                          }
                          className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {selectedEvent ? (
              <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
                <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
                  <h3 className="text-sm font-semibold text-white">
                    Candidatos CxC
                  </h3>
                  <div className="mt-3 space-y-2">
                    {selectedEvent.candidatos.cxc.length === 0 ? (
                      <p className="text-sm text-zinc-500">
                        No hay cuentas por cobrar sugeridas.
                      </p>
                    ) : (
                      selectedEvent.candidatos.cxc.map((item) => (
                        <div
                          key={`cxc-${item.id}`}
                          className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-3 py-2"
                        >
                          <p className="text-sm font-medium text-white">
                            #{item.id} | {item.concepto}
                          </p>
                          <p className="mt-1 text-xs text-zinc-500">
                            {item.espacio_codigo || "Sin espacio"} | vence{" "}
                            {formatDate(item.fecha_vencimiento)} |{" "}
                            {formatCurrency(item.saldo_pendiente)}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
                  <h3 className="text-sm font-semibold text-white">
                    Candidatos CxP
                  </h3>
                  <div className="mt-3 space-y-2">
                    {selectedEvent.candidatos.cxp.length === 0 ? (
                      <p className="text-sm text-zinc-500">
                        No hay cuentas por pagar sugeridas.
                      </p>
                    ) : (
                      selectedEvent.candidatos.cxp.map((item) => (
                        <div
                          key={`cxp-${item.id}`}
                          className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-3 py-2"
                        >
                          <p className="text-sm font-medium text-white">
                            #{item.id} | {item.concepto}
                          </p>
                          <p className="mt-1 text-xs text-zinc-500">
                            {item.proveedor_nombre || item.categoria || "Sin proveedor"} | vence{" "}
                            {formatDate(item.fecha_vencimiento)} |{" "}
                            {formatCurrency(item.saldo_pendiente)}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            ) : null}
          </form>
      ) : null}
    </div>
  );
}
