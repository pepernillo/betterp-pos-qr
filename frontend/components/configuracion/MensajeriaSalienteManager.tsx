"use client";

import { FormEvent, useEffect, useState } from "react";

import { buildApiUrl } from "@/lib/api";

const API_BASE = buildApiUrl("/comunicaciones");

type SalidaTab = "config" | "manual" | "automaticas" | "plantillas" | "historial";

interface CatalogItem {
  id: number;
  nombre: string;
}

interface ClienteCatalogItem extends CatalogItem {
  entidad_id?: number | null;
}

interface ConfigResponse {
  clave?: string;
  green_api_api_url?: string | null;
  green_api_instance_id?: string | null;
  green_api_token?: string | null;
  green_api_webhook_url?: string | null;
  green_api_webhook_token?: string | null;
  green_api_modo_filtro?: string;
  green_api_sync_settings?: boolean;
  procesar_webhooks_async?: boolean;
  make_webhook_url?: string | null;
  openai_model?: string | null;
  prompt_extraccion?: string | null;
  auto_detectar_comprobantes?: boolean;
  auto_crear_eventos?: boolean;
  auto_aplicar_eventos_confiables?: boolean;
  auto_conciliar_eventos?: boolean;
  umbral_confianza_autoaplicacion?: number;
  ventana_match_dias?: number;
  tolerancia_monto?: number;
  email_activo: boolean;
  email_remitente_nombre?: string | null;
  email_remitente?: string | null;
  email_responder_a?: string | null;
  respetar_bajas_whatsapp?: boolean;
  portal_token_horas: number;
  activo?: boolean;
  email_provider?: string;
  backend_public_base_url?: string | null;
  resend_webhook_url?: string | null;
  resend_configured?: boolean;
  resend_api_key_present?: boolean;
  resend_webhook_secret_present?: boolean;
  resend_domain?: string | null;
  resend_from_email_default?: string | null;
  resend_from_name_default?: string | null;
  resend_reply_to_default?: string | null;
}

interface TemplateItem {
  id: number;
  nombre: string;
  descripcion?: string | null;
  canal: string;
  tipo_plantilla: string;
  asunto?: string | null;
  cuerpo: string;
  incluye_link_portal: boolean;
  url_media?: string | null;
  whatsapp_template_name?: string | null;
  whatsapp_template_language?: string | null;
  whatsapp_template_category?: string | null;
  whatsapp_template_status?: string | null;
  whatsapp_template_notes?: string | null;
  activo: boolean;
}

interface RuleItem {
  id: number;
  nombre: string;
  descripcion?: string | null;
  plantilla_id: number;
  plantilla_nombre: string;
  entidad_id?: number | null;
  entidad_nombre?: string | null;
  canal: string;
  evento_base: string;
  desplazamiento_dias: number;
  segmento: string;
  activo: boolean;
}

interface HistoryItem {
  id: number;
  cliente_nombre: string;
  entidad_nombre?: string | null;
  plantilla_nombre?: string | null;
  automatizacion_nombre?: string | null;
  canal: string;
  tipo_envio: string;
  proveedor: string;
  destinatario?: string | null;
  asunto?: string | null;
  cuerpo_renderizado?: string | null;
  referencia_envio?: string | null;
  estatus: string;
  metadata?: Record<string, unknown>;
  fecha_envio: string;
}

interface PreviewItem {
  cliente_id: number;
  cliente_nombre: string;
  entidad_nombre: string;
  segmento: string;
  canales: string[];
  destinos: string[];
  asunto: string;
  mensaje: string;
  url_media?: string | null;
  portal_url?: string;
  referencia_pago?: string;
  saldo_vivo: number;
  recargo_total: number;
  total_exigible: number;
  cuentas_abiertas: number;
  fecha_vencimiento?: string;
  fecha_limite_gracia?: string;
}

interface AutomationPreviewRule {
  id: number;
  nombre: string;
  plantilla_nombre: string;
  canal: string;
  segmento: string;
  evento_base: string;
  desplazamiento_dias: number;
  candidatos: number;
  muestras: PreviewItem[];
}

interface AutomationPreviewResponse {
  fecha_referencia: string;
  reglas_activas: number;
  candidatos: number;
  reglas: AutomationPreviewRule[];
}

interface AutomationMonitorResponse {
  status: string;
  generated_at: string;
  cron: {
    status: string;
    detail: string;
    minutes_since_last_run?: number | null;
    expected_hours?: number;
    last_run?: {
      status: string;
      started_at: string;
      finished_at?: string | null;
      duration_ms?: number;
      summary?: string | null;
      global_run?: boolean;
      includes_current_layer?: boolean;
      coverage?: string;
      layer_summary?: {
        sent: number;
        skipped: number;
        errors: number;
        rules: number;
        candidates: number;
        limit_reached: boolean;
        no_entities: boolean;
        dry_run: boolean;
      } | null;
    } | null;
  };
  actividad: {
    total_24h: number;
    enviados_24h: number;
    omitidos_24h: number;
    errores_24h: number;
    total_7d: number;
    enviados_7d: number;
    omitidos_7d: number;
    errores_7d: number;
    whatsapp_7d: number;
    email_7d: number;
  };
  reglas: {
    total: number;
    activas: number;
    pausadas: number;
    whatsapp_activas: number;
    email_activas: number;
    whatsapp_bloqueadas?: Array<{
      id: number;
      nombre: string;
      plantilla_nombre: string;
      plantilla_estado: string;
    }>;
    actividad_7d?: Array<{
      id: number;
      nombre: string;
      total_7d: number;
      enviados_7d: number;
      omitidos_7d: number;
      errores_7d: number;
      whatsapp_7d: number;
      email_7d: number;
    }>;
  };
  plantillas: {
    total: number;
    activas: number;
    whatsapp_total: number;
    whatsapp_aprobadas: number;
    whatsapp_pendientes: number;
  };
  consumo?: Record<
    string,
    {
      canal: string;
      categoria: string;
      periodo: string;
      incluido: number;
      usado: number;
      restante: number;
      plan_nombre?: string | null;
    }
  >;
  alertas: Array<{ tipo: string; titulo: string; detalle: string }>;
  errores_recientes: HistoryItem[];
}

interface SendCampaignResponse {
  detail?: string;
  mensaje?: string;
  sent?: number;
  skipped?: number;
  errors?: string[];
}

interface TemplateFormState {
  nombre: string;
  descripcion: string;
  canal: string;
  tipo_plantilla: string;
  asunto: string;
  cuerpo: string;
  incluye_link_portal: boolean;
  url_media: string;
  whatsapp_template_name: string;
  whatsapp_template_language: string;
  whatsapp_template_category: string;
  whatsapp_template_status: string;
  whatsapp_template_notes: string;
  activo: boolean;
}

interface RuleFormState {
  nombre: string;
  descripcion: string;
  plantilla_id: string;
  entidad_id: string;
  canal: string;
  evento_base: string;
  desplazamiento_dias: string;
  segmento: string;
  activo: boolean;
}

interface ManualFormState {
  plantilla_id: string;
  entidad_id: string;
  cliente_id: string;
  segmento: string;
  canal: string;
  asunto: string;
  mensaje: string;
  incluye_link_portal: boolean;
  url_media: string;
}

const LOCAL_TABS: Array<{ id: SalidaTab; label: string; helper: string }> = [
  {
    id: "config",
    label: "Config saliente",
    helper: "Estado tecnico del envio, webhook y defaults del backend.",
  },
  {
    id: "manual",
    label: "Envio manual",
    helper: "Previsualiza una campana antes de mandarla.",
  },
  {
    id: "automaticas",
    label: "Automaticas",
    helper: "Recordatorios y avisos por vencimiento o gracia.",
  },
  {
    id: "plantillas",
    label: "Plantillas",
    helper: "Textos base para WhatsApp y correo.",
  },
  {
    id: "historial",
    label: "Historial",
    helper: "Trazabilidad de lo ya enviado.",
  },
];

const TEMPLATE_VARIABLES = [
  "{{cliente_nombre}}",
  "{{entidad_nombre}}",
  "{{concepto}}",
  "{{periodo}}",
  "{{fecha_vencimiento}}",
  "{{fecha_limite_gracia}}",
  "{{saldo_vivo_formato}}",
  "{{total_exigible_formato}}",
  "{{referencia_pago}}",
  "{{banco_transferencia}}",
  "{{clabe_transferencia}}",
  "{{beneficiario_transferencia}}",
  "{{portal_url}}",
];

const EMPTY_TEMPLATE: TemplateFormState = {
  nombre: "",
  descripcion: "",
  canal: "WHATSAPP",
  tipo_plantilla: "MENSAJE_PERSONALIZADO",
  asunto: "",
  cuerpo: "",
  incluye_link_portal: true,
  url_media: "",
  whatsapp_template_name: "",
  whatsapp_template_language: "es_MX",
  whatsapp_template_category: "",
  whatsapp_template_status: "NO_CONFIGURADA",
  whatsapp_template_notes: "",
  activo: true,
};

const EMPTY_RULE: RuleFormState = {
  nombre: "",
  descripcion: "",
  plantilla_id: "",
  entidad_id: "",
  canal: "WHATSAPP",
  evento_base: "FECHA_VENCIMIENTO",
  desplazamiento_dias: "0",
  segmento: "CXC_ABIERTA",
  activo: true,
};

const EMPTY_MANUAL: ManualFormState = {
  plantilla_id: "",
  entidad_id: "",
  cliente_id: "",
  segmento: "CXC_ABIERTA",
  canal: "WHATSAPP",
  asunto: "",
  mensaje: "",
  incluye_link_portal: true,
  url_media: "",
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 2,
  }).format(value || 0);
}

function formatInteger(value?: number | null) {
  return new Intl.NumberFormat("es-MX").format(Number(value || 0));
}

function formatElapsedMinutes(value?: number | null) {
  if (value === undefined || value === null) {
    return "Sin ejecucion";
  }
  if (value < 60) {
    return `${value} min`;
  }
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return minutes ? `${hours} h ${minutes} min` : `${hours} h`;
}

function formatDateTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

const WHATSAPP_TEMPLATE_STATUS_LABELS: Record<string, string> = {
  NO_CONFIGURADA: "No configurada",
  BORRADOR: "Borrador",
  EN_REVISION: "En revision",
  APROBADA: "Aprobada",
  RECHAZADA: "Rechazada",
  PAUSADA: "Pausada",
};

function formatTemplateStatus(value?: string | null) {
  return WHATSAPP_TEMPLATE_STATUS_LABELS[value || ""] || "No configurada";
}

function historyStatusClass(status: string) {
  if (status === "ENTREGADO" || status === "LEIDO") {
    return "border-emerald-500/20 bg-emerald-500/10 text-emerald-200";
  }
  if (status === "ERROR" || status === "ERROR_SPAM") {
    return "border-red-500/20 bg-red-500/10 text-red-200";
  }
  if (status === "OMITIDO") {
    return "border-amber-500/20 bg-amber-500/10 text-amber-200";
  }
  return "border-cyan-500/20 bg-cyan-500/10 text-cyan-100";
}

function monitorStatusClass(status: string) {
  if (status === "OK" || status === "SUCCESS") {
    return "border-emerald-500/20 bg-emerald-500/10 text-emerald-100";
  }
  if (status === "ERROR") {
    return "border-red-500/20 bg-red-500/10 text-red-100";
  }
  return "border-amber-500/20 bg-amber-500/10 text-amber-100";
}

function getMetadataText(item: HistoryItem, key: string) {
  const value = item.metadata?.[key];
  if (value === undefined || value === null || value === "") {
    return "";
  }
  return String(value);
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
    if (Array.isArray(detail) && detail.length > 0) {
      return detail
        .map((item) => {
          if (typeof item === "string") {
            return item;
          }
          if (item && typeof item === "object" && "msg" in item) {
            return String((item as { msg?: unknown }).msg || "");
          }
          return JSON.stringify(item);
        })
        .filter(Boolean)
        .join(" ");
    }
    if (detail && typeof detail === "object") {
      return JSON.stringify(detail);
    }
  }
  if (body && typeof body === "object" && "message" in body) {
    const message = (body as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }
  return fallback;
}

async function readApiBody(response: Response): Promise<unknown> {
  const text = await response.text();
  const trimmed = text.trim();

  if (!trimmed) {
    return {};
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const readableText = trimmed
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const status = `${response.status || ""} ${response.statusText || ""}`.trim();

    return {
      detail:
        readableText.length > 0
          ? `${status ? `${status}: ` : ""}${readableText.slice(0, 700)}`
          : status
            ? `La API respondio ${status}, pero no devolvio JSON.`
            : "La API no devolvio JSON.",
    };
  }
}

async function copyText(value: string, successMessage: string) {
  await navigator.clipboard.writeText(value);
  window.alert(successMessage);
}

export default function MensajeriaSalienteManager() {
  const [activeTab, setActiveTab] = useState<SalidaTab>("config");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [entidades, setEntidades] = useState<CatalogItem[]>([]);
  const [clientes, setClientes] = useState<ClienteCatalogItem[]>([]);
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [rules, setRules] = useState<RuleItem[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyChannelFilter, setHistoryChannelFilter] = useState("TODOS");
  const [historyStatusFilter, setHistoryStatusFilter] = useState("TODOS");
  const [historySearch, setHistorySearch] = useState("");
  const [historyDateFrom, setHistoryDateFrom] = useState("");
  const [historyDateTo, setHistoryDateTo] = useState("");
  const [templateForm, setTemplateForm] = useState<TemplateFormState>(EMPTY_TEMPLATE);
  const [editingTemplateId, setEditingTemplateId] = useState<number | null>(null);
  const [ruleForm, setRuleForm] = useState<RuleFormState>(EMPTY_RULE);
  const [editingRuleId, setEditingRuleId] = useState<number | null>(null);
  const [manualForm, setManualForm] = useState<ManualFormState>(EMPTY_MANUAL);
  const [preview, setPreview] = useState<PreviewItem[]>([]);
  const [lastPreviewSignature, setLastPreviewSignature] = useState("");
  const [automationPreview, setAutomationPreview] =
    useState<AutomationPreviewResponse | null>(null);
  const [automationMonitor, setAutomationMonitor] =
    useState<AutomationMonitorResponse | null>(null);
  const [saving, setSaving] = useState(false);

  const buildHistoryUrl = (
    channelFilter = historyChannelFilter,
    statusFilter = historyStatusFilter,
    searchText = historySearch,
    dateFrom = historyDateFrom,
    dateTo = historyDateTo
  ) => {
    const params = new URLSearchParams({ limit: "100" });
    if (channelFilter !== "TODOS") {
      params.set("canal", channelFilter);
    }
    if (statusFilter !== "TODOS") {
      params.set("estatus", statusFilter);
    }
    if (searchText.trim()) {
      params.set("busqueda", searchText.trim());
    }
    if (dateFrom) {
      params.set("fecha_desde", dateFrom);
    }
    if (dateTo) {
      params.set("fecha_hasta", dateTo);
    }
    return `${API_BASE}/historial-envios/?${params.toString()}`;
  };

  const loadAll = async () => {
    setLoading(true);
    try {
      const [
        configResponse,
        catalogosResponse,
        templatesResponse,
        rulesResponse,
        historyResponse,
        monitorResponse,
      ] = await Promise.all([
          fetch(`${API_BASE}/configuracion/`, { cache: "no-store" }),
          fetch(`${API_BASE}/catalogos/`, { cache: "no-store" }),
          fetch(`${API_BASE}/plantillas/`, { cache: "no-store" }),
          fetch(`${API_BASE}/automatizaciones/`, { cache: "no-store" }),
          fetch(buildHistoryUrl(), { cache: "no-store" }),
          fetch(`${API_BASE}/automatizaciones-monitoreo/`, { cache: "no-store" }),
        ]);

      const configBody = await readApiBody(configResponse);
      const catalogosBody = await readApiBody(catalogosResponse);
      const templatesBody = await readApiBody(templatesResponse);
      const rulesBody = await readApiBody(rulesResponse);
      const historyBody = await readApiBody(historyResponse);
      const monitorBody = await readApiBody(monitorResponse);

      if (!configResponse.ok) {
        throw new Error(getErrorMessage(configBody, "No se pudo cargar la configuracion."));
      }
      if (!catalogosResponse.ok) {
        throw new Error(getErrorMessage(catalogosBody, "No se pudieron cargar las entidades."));
      }
      if (!templatesResponse.ok) {
        throw new Error(getErrorMessage(templatesBody, "No se pudieron cargar las plantillas."));
      }
      if (!rulesResponse.ok) {
        throw new Error(getErrorMessage(rulesBody, "No se pudieron cargar las automatizaciones."));
      }
      if (!historyResponse.ok) {
        throw new Error(getErrorMessage(historyBody, "No se pudo cargar el historial."));
      }

      const configPayload = configBody as ConfigResponse;
      const catalogosPayload = catalogosBody as {
        entidades?: CatalogItem[];
        clientes?: ClienteCatalogItem[];
      };
      setConfig(configPayload);
      setEntidades(catalogosPayload.entidades || []);
      setClientes(catalogosPayload.clientes || []);
      setTemplates(templatesBody as TemplateItem[]);
      setRules(rulesBody as RuleItem[]);
      setHistory(historyBody as HistoryItem[]);
      setAutomationMonitor(
        monitorResponse.ok ? (monitorBody as AutomationMonitorResponse) : null
      );
    } catch (error) {
      console.error("Error cargando mensajeria saliente:", error);
      alert(error instanceof Error ? error.message : "No se pudo cargar mensajeria saliente.");
    } finally {
      setLoading(false);
    }
  };

  const loadHistoryOnly = async (
    channelFilter = historyChannelFilter,
    statusFilter = historyStatusFilter,
    searchText = historySearch,
    dateFrom = historyDateFrom,
    dateTo = historyDateTo
  ) => {
    setSaving(true);
    try {
      const response = await fetch(
        buildHistoryUrl(channelFilter, statusFilter, searchText, dateFrom, dateTo),
        {
          cache: "no-store",
        }
      );
      const body = await readApiBody(response);
      if (!response.ok) {
        throw new Error(getErrorMessage(body, "No se pudo cargar el historial."));
      }
      setHistory(body as HistoryItem[]);
    } catch (error) {
      alert(error instanceof Error ? error.message : "No se pudo cargar el historial.");
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    void loadAll();
  }, []);

  const resetTemplateEditor = () => {
    setTemplateForm(EMPTY_TEMPLATE);
    setEditingTemplateId(null);
  };

  const resetRuleEditor = () => {
    setRuleForm(EMPTY_RULE);
    setEditingRuleId(null);
  };

  const selectedCliente = clientes.find((item) => String(item.id) === manualForm.cliente_id);
  const filteredClientes = clientes.filter((item) => {
    if (!manualForm.entidad_id) {
      return true;
    }
    return String(item.entidad_id ?? "") === manualForm.entidad_id;
  });

  const getEntidadName = (entidadId?: number | null) =>
    entidades.find((item) => item.id === entidadId)?.nombre || "";

  const handleManualEntityChange = (entidadId: string) => {
    setManualForm((current) => {
      const currentCliente = clientes.find((item) => String(item.id) === current.cliente_id);
      const clienteStillMatches =
        !entidadId || !currentCliente || String(currentCliente.entidad_id ?? "") === entidadId;
      return {
        ...current,
        entidad_id: entidadId,
        cliente_id: clienteStillMatches ? current.cliente_id : "",
      };
    });
    setPreview([]);
  };

  const handleManualClienteChange = (clienteId: string) => {
    setManualForm((current) => ({ ...current, cliente_id: clienteId }));
    setPreview([]);
  };

  const buildManualPayload = () => {
    const { cliente_id: clienteId, ...payload } = manualForm;
    return {
      ...payload,
      plantilla_id: payload.plantilla_id ? Number(payload.plantilla_id) : null,
      entidad_id: payload.entidad_id ? Number(payload.entidad_id) : null,
      cliente_ids: clienteId ? [Number(clienteId)] : [],
    };
  };

  const buildManualPayloadSignature = (payload: ReturnType<typeof buildManualPayload>) =>
    JSON.stringify(payload);

  const handleSaveTemplate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    try {
      const endpoint = editingTemplateId
        ? `${API_BASE}/plantillas/${editingTemplateId}/`
        : `${API_BASE}/plantillas/`;
      const response = await fetch(endpoint, {
        method: editingTemplateId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(templateForm),
      });
      const body = await readApiBody(response);
      if (!response.ok) {
        throw new Error(getErrorMessage(body, "No se pudo guardar la plantilla."));
      }
      resetTemplateEditor();
      setMessage("Plantilla guardada.");
      await loadAll();
    } catch (error) {
      alert(error instanceof Error ? error.message : "No se pudo guardar la plantilla.");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveRule = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    try {
      const endpoint = editingRuleId
        ? `${API_BASE}/automatizaciones/${editingRuleId}/`
        : `${API_BASE}/automatizaciones/`;
      const response = await fetch(endpoint, {
        method: editingRuleId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...ruleForm,
          plantilla_id: Number(ruleForm.plantilla_id),
          entidad_id: ruleForm.entidad_id ? Number(ruleForm.entidad_id) : null,
          desplazamiento_dias: Number(ruleForm.desplazamiento_dias) || 0,
        }),
      });
      const body = await readApiBody(response);
      if (!response.ok) {
        throw new Error(getErrorMessage(body, "No se pudo guardar la automatizacion."));
      }
      resetRuleEditor();
      setMessage("Automatizacion guardada.");
      await loadAll();
    } catch (error) {
      alert(error instanceof Error ? error.message : "No se pudo guardar la automatizacion.");
    } finally {
      setSaving(false);
    }
  };

  const handlePreview = async () => {
    setSaving(true);
    const payload = buildManualPayload();
    const signature = buildManualPayloadSignature(payload);
    try {
      const response = await fetch(`${API_BASE}/envios/preview/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await readApiBody(response)) as { items?: PreviewItem[]; detail?: string };
      if (!response.ok) {
        throw new Error(getErrorMessage(body, "No se pudo generar la previsualizacion."));
      }
      if (!Array.isArray(body.items)) {
        throw new Error(getErrorMessage(body, "La API no devolvio una previsualizacion valida."));
      }
      setPreview(body.items);
      setLastPreviewSignature(signature);
    } catch (error) {
      alert(error instanceof Error ? error.message : "No se pudo generar la previsualizacion.");
    } finally {
      setSaving(false);
    }
  };

  const handleSendManual = async () => {
    const payload = buildManualPayload();
    const signature = buildManualPayloadSignature(payload);
    const previewIsCurrent = preview.length > 0 && signature === lastPreviewSignature;
    const confirmed = window.confirm(
      previewIsCurrent
        ? `Se enviara esta campana a ${preview.length} destinatario${
            preview.length === 1 ? "" : "s"
          } previsualizado${preview.length === 1 ? "" : "s"}.`
        : "La campana no tiene una previsualizacion vigente. Genera una vista previa para confirmar destinatarios y mensaje antes de enviar. ¿Quieres enviarla de todos modos?"
    );
    if (!confirmed) {
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(`${API_BASE}/envios/masivo/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await readApiBody(response)) as SendCampaignResponse;
      if (!response.ok) {
        throw new Error(getErrorMessage(body, "No se pudo enviar la campana."));
      }
      const sent = Number(body.sent || 0);
      const skipped = Number(body.skipped || 0);
      const errorCount = Array.isArray(body.errors) ? body.errors.length : 0;
      setMessage(
        body.mensaje ||
          `Campana procesada. Enviados: ${sent} | Omitidos: ${skipped} | Errores: ${errorCount}`
      );
      setPreview([]);
      setLastPreviewSignature("");
      await loadAll();
    } catch (error) {
      alert(error instanceof Error ? error.message : "No se pudo enviar la campana.");
    } finally {
      setSaving(false);
    }
  };

  const handleRunAutomations = async () => {
    const confirmed = window.confirm(
      "Se enviaran los recordatorios automaticos pendientes para hoy segun reglas activas. Revisa la vista previa antes si necesitas confirmar destinatarios."
    );
    if (!confirmed) {
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(`${API_BASE}/automatizaciones/ejecutar/`, {
        method: "POST",
      });
      const body = (await readApiBody(response)) as {
        detail?: string;
        sent?: number;
        skipped?: number;
      };
      if (!response.ok) {
        throw new Error(getErrorMessage(body, "No se pudieron ejecutar las automatizaciones."));
      }
      setMessage(
        `Automatizaciones ejecutadas. Enviados: ${body.sent || 0} | Omitidos: ${
          body.skipped || 0
        }`
      );
      setAutomationPreview(null);
      await loadAll();
    } catch (error) {
      alert(
        error instanceof Error ? error.message : "No se pudieron ejecutar las automatizaciones."
      );
    } finally {
      setSaving(false);
    }
  };

  const handlePreviewAutomations = async () => {
    setSaving(true);
    try {
      const response = await fetch(`${API_BASE}/automatizaciones-preview/`, {
        cache: "no-store",
      });
      const body = (await readApiBody(response)) as AutomationPreviewResponse & {
        detail?: string;
      };
      if (!response.ok) {
        throw new Error(getErrorMessage(body, "No se pudo generar la vista previa."));
      }
      setAutomationPreview(body);
      setMessage(
        `Vista previa lista. ${body.candidatos || 0} envios candidatos en ${
          body.reglas_activas || 0
        } reglas activas.`
      );
    } catch (error) {
      alert(error instanceof Error ? error.message : "No se pudo generar la vista previa.");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteTemplate = async (templateId: number) => {
    const confirmed = window.confirm(
      "Esta accion eliminara la plantilla. Si ya esta en uso por alguna automatizacion, deberias actualizarla antes."
    );
    if (!confirmed) {
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(`${API_BASE}/plantillas/${templateId}/`, {
        method: "DELETE",
      });
      const body = (await readApiBody(response)) as { detail?: string };
      if (!response.ok) {
        throw new Error(getErrorMessage(body, "No se pudo eliminar la plantilla."));
      }
      if (editingTemplateId === templateId) {
        resetTemplateEditor();
      }
      setMessage("Plantilla eliminada.");
      await loadAll();
    } catch (error) {
      alert(error instanceof Error ? error.message : "No se pudo eliminar la plantilla.");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteRule = async (ruleId: number) => {
    const confirmed = window.confirm(
      "Esta accion eliminara la automatizacion seleccionada."
    );
    if (!confirmed) {
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(`${API_BASE}/automatizaciones/${ruleId}/`, {
        method: "DELETE",
      });
      const body = (await readApiBody(response)) as { detail?: string };
      if (!response.ok) {
        throw new Error(getErrorMessage(body, "No se pudo eliminar la automatizacion."));
      }
      if (editingRuleId === ruleId) {
        resetRuleEditor();
      }
      setMessage("Automatizacion eliminada.");
      await loadAll();
    } catch (error) {
      alert(error instanceof Error ? error.message : "No se pudo eliminar la automatizacion.");
    } finally {
      setSaving(false);
    }
  };

  const filteredHistory = history.filter((item) => {
    const channelMatches =
      historyChannelFilter === "TODOS" || item.canal === historyChannelFilter;
    const statusMatches =
      historyStatusFilter === "TODOS" || item.estatus === historyStatusFilter;
    return channelMatches && statusMatches;
  });
  const historyChannels = Array.from(
    new Set(["WHATSAPP", "EMAIL", ...history.map((item) => item.canal)])
  ).sort();
  const historyStatuses = Array.from(
    new Set([
      "ENVIADO",
      "ENTREGADO",
      "LEIDO",
      "OMITIDO",
      "ERROR",
      "ERROR_SPAM",
      ...history.map((item) => item.estatus),
    ])
  ).sort();
  const historySummary = {
    total: history.length,
    enviados: history.filter((item) => item.estatus === "ENVIADO").length,
    entregados: history.filter((item) => item.estatus === "ENTREGADO" || item.estatus === "LEIDO").length,
    errores: history.filter((item) => item.estatus === "ERROR" || item.estatus === "ERROR_SPAM").length,
    omitidos: history.filter((item) => item.estatus === "OMITIDO").length,
  };

  if (loading) {
    return (
      <section className="rounded-3xl border border-zinc-800 bg-zinc-950/70 p-6 text-sm text-zinc-500">
        Cargando mensajeria saliente...
      </section>
    );
  }

  return (
    <section className="space-y-5">
      <section className="rounded-3xl border border-zinc-800 bg-zinc-950/70 p-5">
        <div className="flex flex-col gap-4 border-b border-zinc-800 pb-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-xl font-bold text-white">
              Mensajeria saliente y recordatorios
            </h2>
            <p className="mt-1 text-sm text-zinc-500">
              Administra plantillas, recordatorios automaticos, enlaces del portal y campanas manuales.
            </p>
          </div>
          {message ? (
            <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-200">
              {message}
            </div>
          ) : null}
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-5">
          {LOCAL_TABS.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`rounded-2xl border p-4 text-left transition-colors ${
                  active
                    ? "border-cyan-500/30 bg-cyan-500/10"
                    : "border-zinc-800 bg-zinc-900/40 hover:border-zinc-700"
                }`}
              >
                <p className="font-semibold text-white">{tab.label}</p>
                <p className="mt-2 text-xs leading-5 text-zinc-500">{tab.helper}</p>
              </button>
            );
          })}
        </div>
      </section>

      {activeTab === "config" ? (
        <section className="rounded-3xl border border-zinc-800 bg-zinc-950/70 p-5">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
              <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">Proveedor detectado</p>
              <p className="mt-2 text-lg font-semibold text-white">
                {config?.email_provider || "SMTP"}
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                Si existe `RESEND_API_KEY`, BettERP enviara por API y mantendra SMTP solo como respaldo.
              </p>
            </div>
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
              <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">Dominio verificado</p>
              <p className="mt-2 text-lg font-semibold text-white">
                {config?.resend_domain || "Pendiente"}
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                Remitente sugerido: {config?.resend_from_email_default || "notificaciones@mail.tudominio.com"}
              </p>
            </div>
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
              <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">API key Resend</p>
              <p className="mt-2 text-lg font-semibold text-white">
                {config?.resend_api_key_present ? "Configurada" : "Falta configurar"}
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                Webhook secret: {config?.resend_webhook_secret_present ? "listo" : "pendiente"}
              </p>
            </div>
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
              <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">Base publica backend</p>
              <p className="mt-2 truncate text-sm font-semibold text-white">
                {config?.backend_public_base_url || "Sin BACKEND_PUBLIC_BASE_URL"}
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                Define esta URL para que el webhook publicado no apunte a localhost ni a una URL interna.
              </p>
            </div>
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
              <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">Operacion correo</p>
              <p className="mt-2 text-lg font-semibold text-white">
                {config?.email_activo ? "Activa" : "Desactivada"}
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                Vigencia del portal: {config?.portal_token_horas || 168} horas.
              </p>
            </div>
          </div>
          <div className="mt-4 rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-cyan-300">Webhook Resend</p>
                <p className="mt-2 break-all font-medium text-white">
                  {config?.resend_webhook_url || "Configura BACKEND_PUBLIC_BASE_URL para publicar esta URL."}
                </p>
                <p className="mt-2 text-xs text-zinc-400">
                  En Resend crea el webhook con eventos `sent`, `delivered`, `delivery_delayed`, `opened`, `clicked`, `failed`, `bounced` y `complained`.
                </p>
              </div>
              {config?.resend_webhook_url ? (
                <button
                  type="button"
                  onClick={() =>
                    void copyText(
                      config.resend_webhook_url || "",
                      "Webhook Resend copiado al portapapeles."
                    )
                  }
                  className="rounded-2xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm text-white"
                >
                  Copiar URL
                </button>
              ) : null}
            </div>
          </div>
          <div className="mt-4 grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 text-sm text-zinc-400">
              <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">
                Configuracion administrada por backend
              </p>
              <p className="mt-3 leading-6 text-zinc-300">
                El remitente, reply-to, activacion de correo y defaults del proveedor ya no se
                mueven desde esta pantalla. La idea es que esta seccion quede como supervision
                tecnica para revisar dominio, webhook, proveedor y el estado real del canal.
              </p>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-3">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">From efectivo</p>
                  <p className="mt-2 break-all text-sm font-medium text-white">
                    {config?.resend_from_email_default || config?.email_remitente || "Pendiente en backend"}
                  </p>
                </div>
                <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-3">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Reply-to</p>
                  <p className="mt-2 break-all text-sm font-medium text-white">
                    {config?.resend_reply_to_default || config?.email_responder_a || "Sin reply-to global"}
                  </p>
                </div>
                <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-3">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Nombre remitente</p>
                  <p className="mt-2 break-all text-sm font-medium text-white">
                    {config?.resend_from_name_default || config?.email_remitente_nombre || "BettERP"}
                  </p>
                </div>
              </div>
            </div>
            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-100">
              <p className="text-xs uppercase tracking-[0.22em] text-amber-300">
                Personalizacion de URL
              </p>
              <p className="mt-3 leading-6 text-amber-100/90">
                La unica salida que tiene sentido personalizar para usuarios de negocio es la URL
                del portal cliente. Esa configuracion vive por capa en
                <span className="font-medium text-white"> Capas registradas - Portal cliente activo - URL base del portal</span>.
              </p>
              <div className="mt-4 rounded-2xl border border-amber-500/20 bg-zinc-950/60 p-3 text-xs leading-5 text-zinc-300">
                Si no defines una URL propia por capa, BettERP usa la URL publica del frontend
                configurada en backend para construir el acceso del cliente dentro de correos y recordatorios.
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {activeTab === "manual" ? (
        <section className="space-y-4 rounded-3xl border border-zinc-800 bg-zinc-950/70 p-5">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <label className="space-y-2">
              <span className="text-sm text-zinc-400">Plantilla</span>
              <select
                value={manualForm.plantilla_id}
                onChange={(event) =>
                  setManualForm((current) => ({ ...current, plantilla_id: event.target.value }))
                }
                className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white"
              >
                <option value="">Sin plantilla</option>
                {templates.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.nombre}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-2">
              <span className="text-sm text-zinc-400">Entidad opcional</span>
              <select
                value={manualForm.entidad_id}
                onChange={(event) => handleManualEntityChange(event.target.value)}
                className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white"
              >
                <option value="">Todas las entidades</option>
                {entidades.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.nombre}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-2">
              <span className="text-sm text-zinc-400">Cliente opcional</span>
              <select
                value={manualForm.cliente_id}
                onChange={(event) => handleManualClienteChange(event.target.value)}
                className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white"
              >
                <option value="">Segun segmento</option>
                {filteredClientes.map((item) => {
                  const entidadNombre = getEntidadName(item.entidad_id);
                  return (
                    <option key={item.id} value={item.id}>
                      {item.nombre}
                      {entidadNombre ? ` | ${entidadNombre}` : ""}
                    </option>
                  );
                })}
              </select>
            </label>
            <label className="space-y-2">
              <span className="text-sm text-zinc-400">Segmento</span>
              <select
                value={manualForm.segmento}
                onChange={(event) =>
                  setManualForm((current) => ({ ...current, segmento: event.target.value }))
                }
                className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white"
              >
                <option value="TODOS_ACTIVOS">Todos activos</option>
                <option value="CXC_ABIERTA">Cartera abierta</option>
                <option value="POR_VENCER">Por vencer</option>
                <option value="EN_GRACIA">En gracia</option>
                <option value="VENCIDA_CON_RECARGO">Vencida con recargo</option>
              </select>
            </label>
            <label className="space-y-2">
              <span className="text-sm text-zinc-400">Canal</span>
              <select
                value={manualForm.canal}
                onChange={(event) =>
                  setManualForm((current) => ({ ...current, canal: event.target.value }))
                }
                className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white"
              >
                <option value="WHATSAPP">WhatsApp</option>
                <option value="EMAIL">Email</option>
                <option value="AMBOS">Ambos</option>
              </select>
            </label>
          </div>
          <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4 text-sm text-cyan-100/90">
            {selectedCliente ? (
              <p>
                Envio directo a <span className="font-semibold text-white">{selectedCliente.nombre}</span>
                {getEntidadName(selectedCliente.entidad_id)
                  ? ` (${getEntidadName(selectedCliente.entidad_id)})`
                  : ""}
                . El segmento todavia aplica: si el cliente no tiene cuentas dentro de ese segmento,
                la previsualizacion saldra vacia.
              </p>
            ) : (
              <p>
                Puedes enviar por segmento usando solo entidad, o elegir un cliente especifico sin
                seleccionar entidad para una prueba o recordatorio puntual.
              </p>
            )}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2">
              <span className="text-sm text-zinc-400">Asunto email opcional</span>
              <input
                value={manualForm.asunto}
                onChange={(event) =>
                  setManualForm((current) => ({ ...current, asunto: event.target.value }))
                }
                className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white"
                placeholder="Si lo dejas vacio usamos el asunto de plantilla o uno sugerido."
              />
            </label>
            <label className="space-y-2">
              <span className="text-sm text-zinc-400">URL de imagen o adjunto</span>
              <input
                value={manualForm.url_media}
                onChange={(event) =>
                  setManualForm((current) => ({ ...current, url_media: event.target.value }))
                }
                className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white"
                placeholder="https://..."
              />
            </label>
          </div>
          <label className="block space-y-2">
            <span className="text-sm text-zinc-400">Mensaje personalizado</span>
            <textarea
              rows={5}
              value={manualForm.mensaje}
              onChange={(event) =>
                setManualForm((current) => ({ ...current, mensaje: event.target.value }))
              }
              className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white"
              placeholder="Usa variables como {{cliente_nombre}}, {{saldo_vivo_formato}}, {{portal_url}}."
            />
          </label>
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
              Variables disponibles
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {TEMPLATE_VARIABLES.map((variable) => (
                <button
                  key={variable}
                  type="button"
                  onClick={() => void copyText(variable, "Variable copiada.")}
                  className="rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs text-zinc-200 transition-colors hover:border-cyan-400/40 hover:text-cyan-100"
                >
                  {variable}
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-3 text-sm text-zinc-400">
            <input
              type="checkbox"
              checked={manualForm.incluye_link_portal}
              onChange={(event) =>
                setManualForm((current) => ({
                  ...current,
                  incluye_link_portal: event.target.checked,
                }))
              }
            />
            Incluir link del portal cliente
          </label>
          <div className="flex flex-wrap justify-end gap-3">
            {preview.length > 0 ? (
              <div className="mr-auto rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-300">
                {buildManualPayloadSignature(buildManualPayload()) === lastPreviewSignature
                  ? `${preview.length} destinatario${
                      preview.length === 1 ? "" : "s"
                    } listo${preview.length === 1 ? "" : "s"} para enviar.`
                  : "La vista previa ya no coincide con los cambios actuales."}
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => void handlePreview()}
              disabled={saving}
              className="rounded-2xl border border-zinc-700 bg-zinc-900 px-5 py-3 text-sm text-white disabled:opacity-60"
            >
              Previsualizar
            </button>
            <button
              type="button"
              onClick={() => void handleSendManual()}
              disabled={saving}
              className="rounded-2xl bg-cyan-500 px-5 py-3 text-sm font-semibold text-zinc-950 disabled:opacity-60"
            >
              Enviar campana
            </button>
          </div>
          <div className="grid gap-3">
            {preview.length === 0 ? (
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 text-sm text-zinc-500">
                Genera una previsualizacion para ver clientes, canales y mensaje final antes de enviar.
                Si elegiste un cliente y no aparece, prueba el segmento Todos activos o revisa que tenga CxC abierta.
              </div>
            ) : (
              preview.slice(0, 8).map((item) => (
                <div key={item.cliente_id} className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
                  <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <p className="font-semibold text-white">{item.cliente_nombre}</p>
                      <p className="text-xs text-zinc-500">
                        {item.entidad_nombre} | {item.canales.join(", ")} | {item.destinos.join(", ")}
                      </p>
                    </div>
                    <div className="text-sm text-cyan-200">
                      {formatCurrency(item.total_exigible)}
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-zinc-300 sm:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 px-3 py-2">
                      <span className="block uppercase tracking-[0.18em] text-zinc-500">
                        Referencia
                      </span>
                      <span className="mt-1 block font-medium text-white">
                        {item.referencia_pago || "Sin referencia"}
                      </span>
                    </div>
                    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 px-3 py-2">
                      <span className="block uppercase tracking-[0.18em] text-zinc-500">
                        Vencimiento
                      </span>
                      <span className="mt-1 block font-medium text-white">
                        {item.fecha_vencimiento || "Sin fecha"}
                      </span>
                    </div>
                    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 px-3 py-2">
                      <span className="block uppercase tracking-[0.18em] text-zinc-500">
                        Gracia
                      </span>
                      <span className="mt-1 block font-medium text-white">
                        {item.fecha_limite_gracia || "Sin limite"}
                      </span>
                    </div>
                    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 px-3 py-2">
                      <span className="block uppercase tracking-[0.18em] text-zinc-500">
                        Cuentas
                      </span>
                      <span className="mt-1 block font-medium text-white">
                        {item.cuentas_abiertas}
                      </span>
                    </div>
                  </div>
                  {item.portal_url ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                      <span className="max-w-full truncate rounded-full border border-zinc-800 bg-zinc-950 px-3 py-1 text-zinc-400">
                        {item.portal_url}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          void copyText(item.portal_url || "", "Link del portal copiado.")
                        }
                        className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 font-semibold text-cyan-100"
                      >
                        Copiar portal
                      </button>
                    </div>
                  ) : null}
                  <p className="mt-3 text-xs uppercase tracking-[0.2em] text-zinc-500">
                    Vista previa
                  </p>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-300">{item.mensaje}</p>
                </div>
              ))
            )}
          </div>
        </section>
      ) : null}

      {activeTab === "automaticas" ? (
        <section className="space-y-5 rounded-3xl border border-zinc-800 bg-zinc-950/70 p-5">
          <div className="flex flex-wrap justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-white">Reglas automaticas</h3>
              <p className="mt-1 text-sm text-zinc-500">
                Usa desplazamiento en dias sobre vencimiento o limite de gracia.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handlePreviewAutomations()}
                disabled={saving}
                className="rounded-2xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
              >
                Revisar pendientes hoy
              </button>
              <button
                type="button"
                onClick={() => void handleRunAutomations()}
                disabled={saving}
                className="rounded-2xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-zinc-950 disabled:opacity-60"
              >
                Ejecutar pendientes hoy
              </button>
            </div>
          </div>
          {automationMonitor ? (
            <div className="space-y-3 rounded-3xl border border-zinc-800 bg-zinc-900/40 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">
                    Monitoreo operativo
                  </p>
                  <p className="mt-1 text-sm text-zinc-300">
                    Ultima lectura: {formatDateTime(automationMonitor.generated_at)}
                  </p>
                </div>
                <span
                  className={`rounded-full border px-3 py-1 text-xs font-semibold ${monitorStatusClass(
                    automationMonitor.status
                  )}`}
                >
                  {automationMonitor.status}
                </span>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Cron</p>
                  <p className="mt-2 text-lg font-semibold text-white">
                    {automationMonitor.cron.status}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-zinc-500">
                    {formatElapsedMinutes(automationMonitor.cron.minutes_since_last_run)} desde la ultima corrida.
                  </p>
                  <p className="mt-2 text-xs leading-5 text-zinc-400">
                    {automationMonitor.cron.detail}
                  </p>
                  {automationMonitor.cron.last_run?.summary ? (
                    <p className="mt-2 text-xs leading-5 text-cyan-100">
                      {automationMonitor.cron.last_run.summary}
                    </p>
                  ) : null}
                </div>
                <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Ultimas 24h</p>
                  <p className="mt-2 text-lg font-semibold text-white">
                    {formatInteger(automationMonitor.actividad.total_24h)}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-zinc-500">
                    {formatInteger(automationMonitor.actividad.enviados_24h)} enviados |{" "}
                    {formatInteger(automationMonitor.actividad.errores_24h)} errores.
                  </p>
                </div>
                <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Reglas activas</p>
                  <p className="mt-2 text-lg font-semibold text-white">
                    {formatInteger(automationMonitor.reglas.activas)}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-zinc-500">
                    {formatInteger(automationMonitor.reglas.whatsapp_activas)} WhatsApp |{" "}
                    {formatInteger(automationMonitor.reglas.email_activas)} email.
                  </p>
                </div>
                <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Meta aprobadas</p>
                  <p className="mt-2 text-lg font-semibold text-white">
                    {formatInteger(automationMonitor.plantillas.whatsapp_aprobadas)}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-zinc-500">
                    {formatInteger(automationMonitor.plantillas.whatsapp_pendientes)} pendientes.
                  </p>
                </div>
              </div>
              {automationMonitor.alertas.length > 0 ? (
                <div className="grid gap-2 md:grid-cols-2">
                  {automationMonitor.alertas.map((alerta) => (
                    <div
                      key={`${alerta.tipo}-${alerta.titulo}`}
                      className={`rounded-2xl border p-3 text-sm ${monitorStatusClass(alerta.tipo)}`}
                    >
                      <p className="font-semibold">{alerta.titulo}</p>
                      <p className="mt-1 text-xs leading-5 opacity-80">{alerta.detalle}</p>
                    </div>
                  ))}
                </div>
              ) : null}
              {automationMonitor.consumo && Object.keys(automationMonitor.consumo).length > 0 ? (
                <div className="grid gap-3 md:grid-cols-2">
                  {Object.values(automationMonitor.consumo).map((item) => (
                    <div key={item.canal} className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">
                            Cuota {item.canal}
                          </p>
                          <p className="mt-2 text-sm font-semibold text-white">
                            {formatInteger(item.usado)} / {formatInteger(item.incluido)}
                          </p>
                        </div>
                        <span
                          className={`rounded-full border px-3 py-1 text-xs ${
                            item.restante <= 0
                              ? "border-red-500/20 bg-red-500/10 text-red-100"
                              : item.usado >= item.incluido * 0.8
                                ? "border-amber-500/20 bg-amber-500/10 text-amber-100"
                                : "border-emerald-500/20 bg-emerald-500/10 text-emerald-100"
                          }`}
                        >
                          {formatInteger(item.restante)} restantes
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-zinc-500">
                        {item.plan_nombre || "Plan activo"} | {item.periodo}
                      </p>
                    </div>
                  ))}
                </div>
              ) : null}
              {automationMonitor.reglas.actividad_7d?.length ? (
                <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">
                        Actividad por regla
                      </p>
                      <p className="mt-1 text-xs text-zinc-500">
                        Ultimos 7 dias, solo automatizaciones con historial.
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    {automationMonitor.reglas.actividad_7d.slice(0, 6).map((item) => (
                      <div key={item.id} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 text-xs text-zinc-300">
                        <div className="flex items-start justify-between gap-3">
                          <p className="font-semibold text-white">{item.nombre}</p>
                          <span
                            className={`rounded-full border px-2 py-0.5 ${
                              item.errores_7d > 0
                                ? "border-red-500/20 bg-red-500/10 text-red-100"
                                : "border-emerald-500/20 bg-emerald-500/10 text-emerald-100"
                            }`}
                          >
                            {formatInteger(item.total_7d)}
                          </span>
                        </div>
                        <p className="mt-2 text-zinc-500">
                          {formatInteger(item.enviados_7d)} enviados |{" "}
                          {formatInteger(item.omitidos_7d)} omitidos |{" "}
                          {formatInteger(item.errores_7d)} errores
                        </p>
                        <p className="mt-1 text-zinc-600">
                          {formatInteger(item.whatsapp_7d)} WhatsApp |{" "}
                          {formatInteger(item.email_7d)} email
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {automationMonitor.reglas.whatsapp_bloqueadas?.length ? (
                <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
                  <p className="text-xs uppercase tracking-[0.22em] text-amber-200">
                    Reglas bloqueadas por plantilla Meta
                  </p>
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    {automationMonitor.reglas.whatsapp_bloqueadas.slice(0, 4).map((item) => (
                      <div key={item.id} className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3 text-xs text-zinc-300">
                        <p className="font-semibold text-white">{item.nombre}</p>
                        <p className="mt-1 text-zinc-500">
                          {item.plantilla_nombre} | {formatTemplateStatus(item.plantilla_estado)}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
          {automationPreview ? (
            <div className="rounded-3xl border border-cyan-500/20 bg-cyan-500/5 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.22em] text-cyan-100/70">
                    Vista previa automatica
                  </p>
                  <p className="mt-1 text-sm text-cyan-50">
                    {automationPreview.candidatos} envios candidatos en{" "}
                    {automationPreview.reglas_activas} reglas activas.
                  </p>
                </div>
                <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-xs text-cyan-100">
                  {automationPreview.fecha_referencia}
                </span>
              </div>
              <div className="mt-4 grid gap-3">
                {automationPreview.reglas.map((rule) => (
                  <div key={rule.id} className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-white">{rule.nombre}</p>
                        <p className="mt-1 text-xs text-zinc-500">
                          {rule.plantilla_nombre} | {rule.segmento} |{" "}
                          {rule.evento_base} {rule.desplazamiento_dias >= 0 ? "+" : ""}
                          {rule.desplazamiento_dias} dias
                        </p>
                      </div>
                      <span className="rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs text-zinc-200">
                        {rule.candidatos} candidatos
                      </span>
                    </div>
                    {rule.muestras.length > 0 ? (
                      <div className="mt-3 grid gap-2 md:grid-cols-2">
                        {rule.muestras.slice(0, 4).map((item) => (
                          <div key={`${rule.id}-${item.cliente_id}`} className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-3 text-xs text-zinc-300">
                            <p className="font-semibold text-white">{item.cliente_nombre}</p>
                            <p className="mt-1 text-zinc-500">
                              {item.entidad_nombre} | {item.destinos.join(", ")}
                            </p>
                            <p className="mt-2 text-cyan-100">
                              {formatCurrency(item.total_exigible)} | {item.referencia_pago || "Sin referencia"}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-3 text-sm text-zinc-500">
                        Sin destinatarios para esta regla en el corte de hoy.
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          <form onSubmit={handleSaveRule} className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <input
              value={ruleForm.nombre}
              onChange={(event) => setRuleForm((current) => ({ ...current, nombre: event.target.value }))}
              className="rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white"
              placeholder="Nombre de la regla"
            />
            <input
              value={ruleForm.descripcion}
              onChange={(event) =>
                setRuleForm((current) => ({ ...current, descripcion: event.target.value }))
              }
              className="rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white"
              placeholder="Descripcion corta operativa"
            />
            <select
              value={ruleForm.plantilla_id}
              onChange={(event) =>
                setRuleForm((current) => ({ ...current, plantilla_id: event.target.value }))
              }
              className="rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white"
            >
              <option value="">Plantilla</option>
              {templates.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.nombre}
                </option>
              ))}
            </select>
            <select
              value={ruleForm.entidad_id}
              onChange={(event) =>
                setRuleForm((current) => ({ ...current, entidad_id: event.target.value }))
              }
              className="rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white"
            >
              <option value="">Todas las entidades</option>
              {entidades.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.nombre}
                </option>
              ))}
            </select>
            <select
              value={ruleForm.canal}
              onChange={(event) => setRuleForm((current) => ({ ...current, canal: event.target.value }))}
              className="rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white"
            >
              <option value="WHATSAPP">WhatsApp</option>
              <option value="EMAIL">Email</option>
              <option value="AMBOS">Ambos</option>
            </select>
            <select
              value={ruleForm.evento_base}
              onChange={(event) =>
                setRuleForm((current) => ({ ...current, evento_base: event.target.value }))
              }
              className="rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white"
            >
              <option value="FECHA_VENCIMIENTO">Fecha de vencimiento</option>
              <option value="FECHA_LIMITE_GRACIA">Limite de gracia</option>
            </select>
            <input
              type="number"
              value={ruleForm.desplazamiento_dias}
              onChange={(event) =>
                setRuleForm((current) => ({
                  ...current,
                  desplazamiento_dias: event.target.value,
                }))
              }
              className="rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white"
              placeholder="Dias"
            />
            <select
              value={ruleForm.segmento}
              onChange={(event) =>
                setRuleForm((current) => ({ ...current, segmento: event.target.value }))
              }
              className="rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white"
            >
              <option value="CXC_ABIERTA">Cartera abierta</option>
              <option value="POR_VENCER">Por vencer</option>
              <option value="EN_GRACIA">En gracia</option>
              <option value="VENCIDA_CON_RECARGO">Vencida con recargo</option>
            </select>
            <label className="flex items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={ruleForm.activo}
                onChange={(event) =>
                  setRuleForm((current) => ({ ...current, activo: event.target.checked }))
                }
              />
              Regla activa
            </label>
            <button
              type="submit"
              disabled={saving}
              className="rounded-2xl bg-cyan-500 px-5 py-3 text-sm font-semibold text-zinc-950 disabled:opacity-60"
            >
              {editingRuleId ? "Actualizar regla" : "Guardar regla"}
            </button>
            <button
              type="button"
              onClick={resetRuleEditor}
              disabled={saving}
              className="rounded-2xl border border-zinc-700 bg-zinc-900 px-5 py-3 text-sm text-white disabled:opacity-60"
            >
              Limpiar editor
            </button>
          </form>
          <div className="grid gap-3">
            {rules.map((item) => (
              <div
                key={item.id}
                className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4 text-left"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-white">{item.nombre}</p>
                    <p className="mt-1 text-xs text-zinc-500">
                      {item.plantilla_nombre} | {item.segmento} | {item.evento_base} {item.desplazamiento_dias >= 0 ? "+" : ""}
                      {item.desplazamiento_dias} dias
                    </p>
                    {item.descripcion ? (
                      <p className="mt-2 text-sm text-zinc-400">{item.descripcion}</p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-zinc-700 bg-zinc-950 px-3 py-1 text-xs text-zinc-300">
                      {item.activo ? "Activa" : "Pausada"}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setRuleForm({
                          nombre: item.nombre,
                          descripcion: item.descripcion || "",
                          plantilla_id: String(item.plantilla_id),
                          entidad_id: item.entidad_id ? String(item.entidad_id) : "",
                          canal: item.canal,
                          evento_base: item.evento_base,
                          desplazamiento_dias: String(item.desplazamiento_dias),
                          segmento: item.segmento,
                          activo: item.activo,
                        });
                        setEditingRuleId(item.id);
                      }}
                      className="rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-white"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeleteRule(item.id)}
                      disabled={saving}
                      className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200 disabled:opacity-60"
                    >
                      Borrar
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {activeTab === "plantillas" ? (
        <section className="space-y-5 rounded-3xl border border-zinc-800 bg-zinc-950/70 p-5">
          <form onSubmit={handleSaveTemplate} className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <input
              value={templateForm.nombre}
              onChange={(event) => setTemplateForm((current) => ({ ...current, nombre: event.target.value }))}
              className="rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white"
              placeholder="Nombre"
            />
            <input
              value={templateForm.descripcion}
              onChange={(event) =>
                setTemplateForm((current) => ({ ...current, descripcion: event.target.value }))
              }
              className="rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white"
              placeholder="Descripcion corta operativa"
            />
            <select
              value={templateForm.canal}
              onChange={(event) => setTemplateForm((current) => ({ ...current, canal: event.target.value }))}
              className="rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white"
            >
              <option value="WHATSAPP">WhatsApp</option>
              <option value="EMAIL">Email</option>
              <option value="AMBOS">Ambos</option>
            </select>
            <select
              value={templateForm.tipo_plantilla}
              onChange={(event) =>
                setTemplateForm((current) => ({ ...current, tipo_plantilla: event.target.value }))
              }
              className="rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white"
            >
              <option value="MENSAJE_PERSONALIZADO">Personalizada</option>
              <option value="RECORDATORIO_PAGO">Recordatorio pago</option>
              <option value="AVISO_INTERES">Aviso interes</option>
              <option value="LIBRE">Libre</option>
            </select>
            <input
              value={templateForm.asunto}
              onChange={(event) => setTemplateForm((current) => ({ ...current, asunto: event.target.value }))}
              className="rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white"
              placeholder="Asunto email"
            />
            <input
              value={templateForm.url_media}
              onChange={(event) => setTemplateForm((current) => ({ ...current, url_media: event.target.value }))}
              className="rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white md:col-span-2"
              placeholder="URL de imagen o adjunto"
            />
            <input
              value={templateForm.whatsapp_template_name}
              onChange={(event) =>
                setTemplateForm((current) => ({
                  ...current,
                  whatsapp_template_name: event.target.value,
                }))
              }
              className="rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white"
              placeholder="Nombre plantilla Meta"
            />
            <input
              value={templateForm.whatsapp_template_language}
              onChange={(event) =>
                setTemplateForm((current) => ({
                  ...current,
                  whatsapp_template_language: event.target.value,
                }))
              }
              className="rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white"
              placeholder="Idioma, ej. es_MX"
            />
            <select
              value={templateForm.whatsapp_template_category}
              onChange={(event) =>
                setTemplateForm((current) => ({
                  ...current,
                  whatsapp_template_category: event.target.value,
                }))
              }
              className="rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white"
            >
              <option value="">Categoria Meta</option>
              <option value="UTILITY">Utility</option>
              <option value="MARKETING">Marketing</option>
              <option value="AUTHENTICATION">Authentication</option>
            </select>
            <select
              value={templateForm.whatsapp_template_status}
              onChange={(event) =>
                setTemplateForm((current) => ({
                  ...current,
                  whatsapp_template_status: event.target.value,
                }))
              }
              className="rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white"
            >
              <option value="NO_CONFIGURADA">No configurada</option>
              <option value="BORRADOR">Borrador</option>
              <option value="EN_REVISION">En revision</option>
              <option value="APROBADA">Aprobada</option>
              <option value="RECHAZADA">Rechazada</option>
              <option value="PAUSADA">Pausada</option>
            </select>
            <input
              value={templateForm.whatsapp_template_notes}
              onChange={(event) =>
                setTemplateForm((current) => ({
                  ...current,
                  whatsapp_template_notes: event.target.value,
                }))
              }
              className="rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white md:col-span-2"
              placeholder="Notas de aprobacion o cambios pendientes"
            />
            <label className="flex items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={templateForm.incluye_link_portal}
                onChange={(event) =>
                  setTemplateForm((current) => ({
                    ...current,
                    incluye_link_portal: event.target.checked,
                  }))
                }
              />
              Incluir link portal
            </label>
            <label className="flex items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={templateForm.activo}
                onChange={(event) =>
                  setTemplateForm((current) => ({ ...current, activo: event.target.checked }))
                }
              />
              Plantilla activa
            </label>
            <textarea
              rows={6}
              value={templateForm.cuerpo}
              onChange={(event) => setTemplateForm((current) => ({ ...current, cuerpo: event.target.value }))}
              className="rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white md:col-span-2 xl:col-span-4"
              placeholder="Usa variables como {{cliente_nombre}}, {{saldo_vivo_formato}}, {{portal_url}}."
            />
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4 md:col-span-2 xl:col-span-4">
              <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                Variables disponibles
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {TEMPLATE_VARIABLES.map((variable) => (
                  <button
                    key={variable}
                    type="button"
                    onClick={() => void copyText(variable, "Variable copiada.")}
                    className="rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs text-zinc-200 transition-colors hover:border-cyan-400/40 hover:text-cyan-100"
                  >
                    {variable}
                  </button>
                ))}
              </div>
            </div>
            <button
              type="submit"
              disabled={saving}
              className="rounded-2xl bg-cyan-500 px-5 py-3 text-sm font-semibold text-zinc-950 disabled:opacity-60"
            >
              {editingTemplateId ? "Actualizar plantilla" : "Guardar plantilla"}
            </button>
            <button
              type="button"
              onClick={resetTemplateEditor}
              disabled={saving}
              className="rounded-2xl border border-zinc-700 bg-zinc-900 px-5 py-3 text-sm text-white disabled:opacity-60"
            >
              Limpiar editor
            </button>
          </form>
          <div className="grid gap-3">
            {templates.map((item) => (
              <div
                key={item.id}
                className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4 text-left"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-white">{item.nombre}</p>
                    <p className="mt-1 text-xs text-zinc-500">
                      {item.canal} | {item.tipo_plantilla}
                    </p>
                    {item.descripcion ? (
                      <p className="mt-2 text-sm text-zinc-400">{item.descripcion}</p>
                    ) : null}
                    {item.whatsapp_template_name || item.whatsapp_template_status ? (
                      <p className="mt-2 text-xs text-zinc-400">
                        Meta: {item.whatsapp_template_name || "sin nombre"} |{" "}
                        {item.whatsapp_template_language || "es_MX"} |{" "}
                        {formatTemplateStatus(item.whatsapp_template_status)}
                      </p>
                    ) : null}
                    {item.whatsapp_template_notes ? (
                      <p className="mt-1 text-xs text-zinc-500">
                        {item.whatsapp_template_notes}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-zinc-700 bg-zinc-950 px-3 py-1 text-xs text-zinc-300">
                      {item.activo ? "Activa" : "Inactiva"}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingTemplateId(item.id);
                        setTemplateForm({
                          nombre: item.nombre,
                          descripcion: item.descripcion || "",
                          canal: item.canal,
                          tipo_plantilla: item.tipo_plantilla,
                          asunto: item.asunto || "",
                          cuerpo: item.cuerpo,
                          incluye_link_portal: item.incluye_link_portal,
                          url_media: item.url_media || "",
                          whatsapp_template_name: item.whatsapp_template_name || "",
                          whatsapp_template_language:
                            item.whatsapp_template_language || "es_MX",
                          whatsapp_template_category:
                            item.whatsapp_template_category || "",
                          whatsapp_template_status:
                            item.whatsapp_template_status || "NO_CONFIGURADA",
                          whatsapp_template_notes: item.whatsapp_template_notes || "",
                          activo: item.activo,
                        });
                      }}
                      className="rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-white"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeleteTemplate(item.id)}
                      disabled={saving}
                      className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200 disabled:opacity-60"
                    >
                      Borrar
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {activeTab === "historial" ? (
        <section className="space-y-4 rounded-3xl border border-zinc-800 bg-zinc-950/70 p-5">
          <div className="grid gap-3 md:grid-cols-5">
            {[
              { label: "Total", value: historySummary.total, tone: "border-zinc-800 bg-zinc-900/60" },
              { label: "Enviados", value: historySummary.enviados, tone: "border-cyan-500/20 bg-cyan-500/10" },
              { label: "Entregados", value: historySummary.entregados, tone: "border-emerald-500/20 bg-emerald-500/10" },
              { label: "Omitidos", value: historySummary.omitidos, tone: "border-amber-500/20 bg-amber-500/10" },
              { label: "Errores", value: historySummary.errores, tone: "border-red-500/20 bg-red-500/10" },
            ].map((item) => (
              <div key={item.label} className={`rounded-2xl border p-4 ${item.tone}`}>
                <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">
                  {item.label}
                </p>
                <p className="mt-2 text-2xl font-semibold text-white">{item.value}</p>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-white">Historial de envios</h3>
              <p className="mt-1 text-sm text-zinc-500">
                {filteredHistory.length} de {history.length} registros visibles.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <label className="space-y-2">
                <span className="block text-xs uppercase tracking-[0.18em] text-zinc-500">
                  Buscar
                </span>
                <input
                  value={historySearch}
                  onChange={(event) => setHistorySearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      void loadHistoryOnly(
                        historyChannelFilter,
                        historyStatusFilter,
                        historySearch,
                        historyDateFrom,
                        historyDateTo
                      );
                    }
                  }}
                  className="w-64 rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white"
                  placeholder="Cliente, destino, referencia"
                />
              </label>
              <label className="space-y-2">
                <span className="block text-xs uppercase tracking-[0.18em] text-zinc-500">
                  Desde
                </span>
                <input
                  type="date"
                  value={historyDateFrom}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setHistoryDateFrom(nextValue);
                    void loadHistoryOnly(
                      historyChannelFilter,
                      historyStatusFilter,
                      historySearch,
                      nextValue,
                      historyDateTo
                    );
                  }}
                  className="rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white"
                />
              </label>
              <label className="space-y-2">
                <span className="block text-xs uppercase tracking-[0.18em] text-zinc-500">
                  Hasta
                </span>
                <input
                  type="date"
                  value={historyDateTo}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setHistoryDateTo(nextValue);
                    void loadHistoryOnly(
                      historyChannelFilter,
                      historyStatusFilter,
                      historySearch,
                      historyDateFrom,
                      nextValue
                    );
                  }}
                  className="rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white"
                />
              </label>
              <label className="space-y-2">
                <span className="block text-xs uppercase tracking-[0.18em] text-zinc-500">
                  Canal
                </span>
                <select
                  value={historyChannelFilter}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setHistoryChannelFilter(nextValue);
                    void loadHistoryOnly(
                      nextValue,
                      historyStatusFilter,
                      historySearch,
                      historyDateFrom,
                      historyDateTo
                    );
                  }}
                  className="rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white"
                >
                  <option value="TODOS">Todos</option>
                  {historyChannels.map((channel) => (
                    <option key={channel} value={channel}>
                      {channel}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-2">
                <span className="block text-xs uppercase tracking-[0.18em] text-zinc-500">
                  Estatus
                </span>
                <select
                  value={historyStatusFilter}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setHistoryStatusFilter(nextValue);
                    void loadHistoryOnly(
                      historyChannelFilter,
                      nextValue,
                      historySearch,
                      historyDateFrom,
                      historyDateTo
                    );
                  }}
                  className="rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white"
                >
                  <option value="TODOS">Todos</option>
                  {historyStatuses.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex items-end gap-2">
                <button
                  type="button"
                  onClick={() =>
                    void loadHistoryOnly(
                      historyChannelFilter,
                      historyStatusFilter,
                      historySearch,
                      historyDateFrom,
                      historyDateTo
                    )
                  }
                  disabled={saving}
                  className="rounded-2xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
                >
                  Buscar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setHistorySearch("");
                    setHistoryDateFrom("");
                    setHistoryDateTo("");
                    setHistoryChannelFilter("TODOS");
                    setHistoryStatusFilter("TODOS");
                    void loadHistoryOnly("TODOS", "TODOS", "", "", "");
                  }}
                  disabled={saving}
                  className="rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-300 disabled:opacity-60"
                >
                  Limpiar
                </button>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm text-zinc-300">
              <thead className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                <tr>
                  <th className="px-3 py-3">Cliente</th>
                  <th className="px-3 py-3">Canal</th>
                  <th className="px-3 py-3">Tipo</th>
                  <th className="px-3 py-3">Destino</th>
                  <th className="px-3 py-3">Plantilla</th>
                  <th className="px-3 py-3">Estatus</th>
                  <th className="px-3 py-3">Fecha</th>
                  <th className="px-3 py-3">Detalle</th>
                </tr>
              </thead>
              <tbody>
                {filteredHistory.map((item) => {
                  const referenciaPago = getMetadataText(item, "referencia_pago");
                  const portalUrl = getMetadataText(item, "portal_url");
                  const totalExigible = getMetadataText(item, "total_exigible");
                  const error = getMetadataText(item, "error");
                  return (
                    <tr key={item.id} className="border-t border-zinc-900 align-top">
                      <td className="px-3 py-4">
                        <div className="font-medium text-white">{item.cliente_nombre}</div>
                        <div className="text-xs text-zinc-500">
                          {item.entidad_nombre || "Sin entidad"}
                        </div>
                      </td>
                      <td className="px-3 py-4">{item.canal}</td>
                      <td className="px-3 py-4">{item.tipo_envio}</td>
                      <td className="px-3 py-4">
                        <div>{item.destinatario || "-"}</div>
                        {item.referencia_envio ? (
                          <div className="mt-1 max-w-[180px] truncate text-xs text-zinc-500">
                            {item.referencia_envio}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-4">
                        <div>{item.plantilla_nombre || item.automatizacion_nombre || "-"}</div>
                        {item.asunto ? (
                          <div className="mt-1 max-w-[220px] truncate text-xs text-zinc-500">
                            {item.asunto}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-4">
                        <span
                          className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${historyStatusClass(
                            item.estatus
                          )}`}
                        >
                          {item.estatus}
                        </span>
                        {error ? (
                          <div className="mt-2 max-w-[220px] text-xs text-red-200">{error}</div>
                        ) : null}
                      </td>
                      <td className="px-3 py-4">{formatDateTime(item.fecha_envio)}</td>
                      <td className="px-3 py-4">
                        <details className="group max-w-[320px]">
                          <summary className="cursor-pointer text-xs font-semibold text-cyan-100">
                            Ver envio
                          </summary>
                          <div className="mt-2 space-y-2 rounded-2xl border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-300">
                            <div className="flex flex-wrap gap-2">
                              {referenciaPago ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    void copyText(referenciaPago, "Referencia copiada.")
                                  }
                                  className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 font-semibold text-cyan-100"
                                >
                                  Copiar referencia
                                </button>
                              ) : null}
                              {portalUrl ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    void copyText(portalUrl, "Link del portal copiado.")
                                  }
                                  className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 font-semibold text-cyan-100"
                                >
                                  Copiar portal
                                </button>
                              ) : null}
                              {item.cuerpo_renderizado ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    void copyText(
                                      item.cuerpo_renderizado || "",
                                      "Mensaje copiado."
                                    )
                                  }
                                  className="rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 font-semibold text-zinc-100"
                                >
                                  Copiar mensaje
                                </button>
                              ) : null}
                            </div>
                            {referenciaPago ? (
                              <p>
                                <span className="text-zinc-500">Referencia:</span>{" "}
                                {referenciaPago}
                              </p>
                            ) : null}
                            {portalUrl ? (
                              <p className="break-all">
                                <span className="text-zinc-500">Portal:</span>{" "}
                                {portalUrl}
                              </p>
                            ) : null}
                            {totalExigible ? (
                              <p>
                                <span className="text-zinc-500">Total:</span>{" "}
                                {formatCurrency(Number(totalExigible))}
                              </p>
                            ) : null}
                            {item.cuerpo_renderizado ? (
                              <p className="whitespace-pre-wrap text-zinc-300">
                                {item.cuerpo_renderizado}
                              </p>
                            ) : (
                              <p className="text-zinc-500">Sin cuerpo registrado.</p>
                            )}
                          </div>
                        </details>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {filteredHistory.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-950/60 py-10 text-center text-sm text-zinc-500">
              No hay envios con estos filtros.
            </div>
          ) : null}
        </section>
      ) : null}
    </section>
  );
}
