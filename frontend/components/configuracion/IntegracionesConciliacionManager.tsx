"use client";

import { buildApiUrl } from "@/lib/api";
import { FormEvent, useEffect, useMemo, useState } from "react";

import MensajeriaSalienteManager from "./MensajeriaSalienteManager";

const COMUNICACIONES_API_BASE = buildApiUrl("/comunicaciones");

type IntegrationTab =
  | "conexion"
  | "numeros"
  | "cola"
  | "comprobantes"
  | "salidas";
type WebhookStatusFilter =
  | "TODOS"
  | "PENDIENTE"
  | "PROCESANDO"
  | "PROCESADO"
  | "IGNORADO"
  | "ERROR";
type EvidenceView = "PENDIENTES" | "TODOS" | "INGRESOS" | "EGRESOS" | "APLICADAS";

interface CatalogoEntidad {
  id: number;
  nombre: string;
}

interface CatalogoCliente {
  id: number;
  nombre: string;
  entidad_id: number | null;
}

interface CatalogosComunicacion {
  entidades: CatalogoEntidad[];
  clientes: CatalogoCliente[];
}

interface WhatsappProductionChecklistItem {
  id: string;
  titulo: string;
  descripcion?: string | null;
  listo: boolean;
  detalle?: string | null;
}

interface WhatsappProductionPreparation {
  modo: string;
  activo: boolean;
  listo_para_cambio: boolean;
  bloqueantes: string[];
  nota?: string | null;
  numero_principal?: Record<string, unknown> | null;
  plantillas_whatsapp?: number;
  plantillas_meta_aprobadas?: number;
  automatizaciones_activas?: number;
}

interface WabaSubscribedApp {
  id?: string | null;
  name?: string | null;
  link?: string | null;
}

interface WabaSubscriptionState {
  success?: boolean;
  canal_id?: number;
  canal_nombre?: string | null;
  waba_id?: string | null;
  app_id_esperada?: string | null;
  suscrita: boolean;
  apps: WabaSubscribedApp[];
  checked_at?: string | null;
  mensaje?: string | null;
  accion?: Record<string, unknown> | null;
}

interface WhatsappCloudOverview {
  provider: string;
  backend_public_base_url: string | null;
  webhook_url: string | null;
  app_id: string | null;
  embedded_signup_config_id: string | null;
  verify_token_configurado: boolean;
  app_id_configurada: boolean;
  app_secret_configurada: boolean;
  config_id_configurada: boolean;
  embedded_signup_ready: boolean;
  graph_api_base_url: string;
  graph_api_version: string;
  canales_activos: number;
  canales_principales: number;
  waba_subscription?: WabaSubscriptionState | null;
  produccion_checklist?: WhatsappProductionChecklistItem[];
  produccion_preparacion?: WhatsappProductionPreparation | null;
}

interface WhatsappChannel {
  id: number;
  capa_id: number;
  proveedor: string;
  nombre: string;
  nombre_interno: string | null;
  display_phone_number: string | null;
  numero_wa_id: string | null;
  phone_number_id: string | null;
  business_account_id: string | null;
  waba_id: string | null;
  entidad_id: number | null;
  entidad_nombre: string | null;
  cliente_id: number | null;
  cliente_nombre: string | null;
  estado: string;
  puede_enviar: boolean;
  puede_recibir: boolean;
  es_principal: boolean;
  activo: boolean;
  metadata: Record<string, unknown>;
  webhook_fields: Record<string, unknown>;
  access_token_configurado: boolean;
  fecha_conexion: string | null;
  fecha_ultimo_check: string | null;
  fecha_actualizacion: string | null;
}

interface ConfiguracionComunicacionResponse {
  id: number;
  clave: string;
  green_api_api_url?: string | null;
  green_api_instance_id?: string | null;
  green_api_token?: string | null;
  green_api_webhook_url?: string | null;
  green_api_webhook_token?: string | null;
  green_api_modo_filtro?: string | null;
  green_api_sync_settings?: boolean;
  procesar_webhooks_async: boolean;
  make_webhook_url?: string | null;
  openai_model?: string | null;
  prompt_extraccion?: string | null;
  auto_detectar_comprobantes: boolean;
  auto_crear_eventos: boolean;
  auto_aplicar_eventos_confiables: boolean;
  auto_conciliar_eventos: boolean;
  umbral_confianza_autoaplicacion: number;
  ventana_match_dias: number;
  tolerancia_monto: number;
  email_activo: boolean;
  email_remitente_nombre?: string | null;
  email_remitente?: string | null;
  email_responder_a?: string | null;
  respetar_bajas_whatsapp: boolean;
  portal_token_horas: number;
  activo: boolean;
  whatsapp_cloud: WhatsappCloudOverview;
  canales_whatsapp: WhatsappChannel[];
}

interface ConfigFormState {
  clave: string;
  procesar_webhooks_async: boolean;
  auto_detectar_comprobantes: boolean;
  auto_crear_eventos: boolean;
  auto_aplicar_eventos_confiables: boolean;
  auto_conciliar_eventos: boolean;
  umbral_confianza_autoaplicacion: string;
  ventana_match_dias: string;
  tolerancia_monto: string;
  openai_model: string;
  prompt_extraccion: string;
  respetar_bajas_whatsapp: boolean;
  activo: boolean;
}

interface WhatsappChannelFormState {
  nombre: string;
  nombre_interno: string;
  display_phone_number: string;
  numero_wa_id: string;
  phone_number_id: string;
  business_account_id: string;
  waba_id: string;
  access_token: string;
  entidad_id: string;
  cliente_id: string;
  estado: string;
  puede_enviar: boolean;
  puede_recibir: boolean;
  es_principal: boolean;
  activo: boolean;
}

interface WebhookMetricas {
  pendientes: number;
  procesando: number;
  procesados: number;
  ignorados: number;
  errores: number;
}

interface WebhookEntranteItem {
  id: number;
  proveedor: string;
  tipo_webhook: string | null;
  origen_externo_id: string | null;
  chat_id: string | null;
  remitente: string | null;
  estatus_procesamiento: string;
  intentos_procesamiento: number;
  error_procesamiento: string | null;
  procesado: boolean;
  fecha_recepcion: string | null;
  fecha_procesamiento: string | null;
}

interface WebhooksResponse {
  metricas: WebhookMetricas;
  items: WebhookEntranteItem[];
}

interface EvidenciaPagoItem {
  id: number;
  caso_id: number | null;
  entidad_id: number | null;
  entidad_nombre: string | null;
  cliente_id: number | null;
  cliente_nombre: string | null;
  mensaje_id: number | null;
  canal: string;
  tipo_movimiento: string;
  origen_deteccion: string;
  url_archivo: string | null;
  hash_archivo: string | null;
  monto_reportado: number;
  fecha_pago_reportada: string | null;
  referencia_reportada: string | null;
  texto_extraido: string | null;
  confianza_clasificacion: number;
  requiere_revision_manual: boolean;
  categoria_sugerida: string | null;
  metadata: Record<string, unknown>;
  observaciones: string | null;
  estatus: string;
  fecha_registro: string | null;
}

interface EvidenceFormState {
  tipo_movimiento: string;
  entidad_id: string;
  cliente_id: string;
  categoria_sugerida: string;
  confianza_clasificacion: string;
  requiere_revision_manual: boolean;
  observaciones: string;
  crear_evento: boolean;
  aplicar_evento: boolean;
}

const EMPTY_CHANNEL_FORM: WhatsappChannelFormState = {
  nombre: "",
  nombre_interno: "",
  display_phone_number: "",
  numero_wa_id: "",
  phone_number_id: "",
  business_account_id: "",
  waba_id: "",
  access_token: "",
  entidad_id: "",
  cliente_id: "",
  estado: "PENDIENTE",
  puede_enviar: true,
  puede_recibir: true,
  es_principal: false,
  activo: true,
};

const TAB_OPTIONS: Array<{
  id: IntegrationTab;
  label: string;
  description: string;
}> = [
  {
    id: "conexion",
    label: "WhatsApp oficial",
    description:
      "Estado de Meta, webhook, app y motor de captura para operar sin sesiones frágiles.",
  },
  {
    id: "numeros",
    label: "Numeros conectados",
    description:
      "Registra 1 o varios números oficiales por capa y define cuál envía por defecto.",
  },
  {
    id: "cola",
    label: "Webhook y eventos",
    description:
      "Observa mensajes, estados y pendientes del canal oficial de WhatsApp.",
  },
  {
    id: "comprobantes",
    label: "Comprobantes",
    description:
      "Clasifica pagos y gastos detectados desde WhatsApp y llévalos a finanzas.",
  },
  {
    id: "salidas",
    label: "Mensajeria saliente",
    description:
      "Plantillas, campañas, portal cliente y recordatorios por correo y WhatsApp.",
  },
];

function getErrorMessage(body: unknown, fallback: string) {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail?: unknown }).detail;
    if (typeof detail === "string" && detail.trim()) {
      return detail;
    }
  }
  return fallback;
}

function parseOptionalInteger(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function formatCurrency(value: number | null | undefined) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "Sin fecha";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" }).format(date);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "Sin fecha";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function mapConfigToForm(config: ConfiguracionComunicacionResponse): ConfigFormState {
  return {
    clave: config.clave || "PRINCIPAL",
    procesar_webhooks_async: config.procesar_webhooks_async,
    auto_detectar_comprobantes: config.auto_detectar_comprobantes,
    auto_crear_eventos: config.auto_crear_eventos,
    auto_aplicar_eventos_confiables: config.auto_aplicar_eventos_confiables,
    auto_conciliar_eventos: config.auto_conciliar_eventos,
    umbral_confianza_autoaplicacion: String(
      config.umbral_confianza_autoaplicacion ?? 85
    ),
    ventana_match_dias: String(config.ventana_match_dias ?? 7),
    tolerancia_monto: String(config.tolerancia_monto ?? 0),
    openai_model: config.openai_model || "",
    prompt_extraccion: config.prompt_extraccion || "",
    respetar_bajas_whatsapp: config.respetar_bajas_whatsapp ?? true,
    activo: config.activo,
  };
}

function mapChannelToForm(channel: WhatsappChannel): WhatsappChannelFormState {
  return {
    nombre: channel.nombre,
    nombre_interno: channel.nombre_interno || "",
    display_phone_number: channel.display_phone_number || "",
    numero_wa_id: channel.numero_wa_id || "",
    phone_number_id: channel.phone_number_id || "",
    business_account_id: channel.business_account_id || "",
    waba_id: channel.waba_id || "",
    access_token: "",
    entidad_id: channel.entidad_id ? String(channel.entidad_id) : "",
    cliente_id: channel.cliente_id ? String(channel.cliente_id) : "",
    estado: channel.estado || "PENDIENTE",
    puede_enviar: channel.puede_enviar,
    puede_recibir: channel.puede_recibir,
    es_principal: channel.es_principal,
    activo: channel.activo,
  };
}

function mapEvidenceToForm(evidencia: EvidenciaPagoItem): EvidenceFormState {
  return {
    tipo_movimiento: evidencia.tipo_movimiento || "INGRESO",
    entidad_id: evidencia.entidad_id ? String(evidencia.entidad_id) : "",
    cliente_id: evidencia.cliente_id ? String(evidencia.cliente_id) : "",
    categoria_sugerida: evidencia.categoria_sugerida || "",
    confianza_clasificacion: String(evidencia.confianza_clasificacion ?? 0),
    requiere_revision_manual: evidencia.requiere_revision_manual,
    observaciones: evidencia.observaciones || "",
    crear_evento: true,
    aplicar_evento:
      evidencia.estatus === "APLICADA" ? false : !evidencia.requiere_revision_manual,
  };
}

function getWebhookStatusTone(status: string) {
  switch (status) {
    case "PROCESADO":
      return "border-emerald-500/20 bg-emerald-500/10 text-emerald-300";
    case "PROCESANDO":
      return "border-cyan-500/20 bg-cyan-500/10 text-cyan-300";
    case "IGNORADO":
      return "border-zinc-700 bg-zinc-900 text-zinc-300";
    case "ERROR":
      return "border-red-500/20 bg-red-500/10 text-red-300";
    default:
      return "border-amber-500/20 bg-amber-500/10 text-amber-300";
  }
}

function getEvidenceTone(type: string) {
  return type === "EGRESO"
    ? "border-red-500/20 bg-red-500/10 text-red-300"
    : "border-emerald-500/20 bg-emerald-500/10 text-emerald-300";
}

function getEvidenceStatusTone(status: string) {
  switch (status) {
    case "APLICADA":
      return "border-emerald-500/20 bg-emerald-500/10 text-emerald-300";
    case "DESCARTADA":
      return "border-zinc-700 bg-zinc-900 text-zinc-300";
    default:
      return "border-amber-500/20 bg-amber-500/10 text-amber-300";
  }
}

async function copyToClipboard(value: string) {
  await navigator.clipboard.writeText(value);
}

export default function IntegracionesConciliacionManager() {
  const [activeTab, setActiveTab] = useState<IntegrationTab>("conexion");
  const [config, setConfig] = useState<ConfiguracionComunicacionResponse | null>(null);
  const [form, setForm] = useState<ConfigFormState | null>(null);
  const [catalogos, setCatalogos] = useState<CatalogosComunicacion>({
    entidades: [],
    clientes: [],
  });
  const [channelForm, setChannelForm] =
    useState<WhatsappChannelFormState>(EMPTY_CHANNEL_FORM);
  const [editingChannelId, setEditingChannelId] = useState<number | null>(null);
  const [webhooks, setWebhooks] = useState<WebhooksResponse>({
    metricas: {
      pendientes: 0,
      procesando: 0,
      procesados: 0,
      ignorados: 0,
      errores: 0,
    },
    items: [],
  });
  const [evidencias, setEvidencias] = useState<EvidenciaPagoItem[]>([]);
  const [selectedEvidenceId, setSelectedEvidenceId] = useState<number | null>(null);
  const [evidenceForm, setEvidenceForm] = useState<EvidenceFormState | null>(null);
  const [webhookStatusFilter, setWebhookStatusFilter] =
    useState<WebhookStatusFilter>("TODOS");
  const [evidenceView, setEvidenceView] = useState<EvidenceView>("PENDIENTES");
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshingData, setIsRefreshingData] = useState(false);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [isSavingChannel, setIsSavingChannel] = useState(false);
  const [isDispatchingQueue, setIsDispatchingQueue] = useState(false);
  const [isCheckingWabaSubscription, setIsCheckingWabaSubscription] = useState(false);
  const [isAligningWabaSubscription, setIsAligningWabaSubscription] = useState(false);
  const [isSavingEvidence, setIsSavingEvidence] = useState(false);
  const [mensaje, setMensaje] = useState("");

  const whatsappChannels = config?.canales_whatsapp || [];
  const wabaSubscription = config?.whatsapp_cloud?.waba_subscription || null;
  const selectedEvidence = useMemo(
    () => evidencias.find((item) => item.id === selectedEvidenceId) || null,
    [evidencias, selectedEvidenceId]
  );

  const webhookItems = useMemo(() => {
    if (webhookStatusFilter === "TODOS") {
      return webhooks.items;
    }
    return webhooks.items.filter(
      (item) => item.estatus_procesamiento === webhookStatusFilter
    );
  }, [webhooks.items, webhookStatusFilter]);

  const evidenceItems = useMemo(() => {
    switch (evidenceView) {
      case "INGRESOS":
        return evidencias.filter((item) => item.tipo_movimiento === "INGRESO");
      case "EGRESOS":
        return evidencias.filter((item) => item.tipo_movimiento === "EGRESO");
      case "APLICADAS":
        return evidencias.filter((item) => item.estatus === "APLICADA");
      case "PENDIENTES":
        return evidencias.filter(
          (item) => item.requiere_revision_manual || item.estatus !== "APLICADA"
        );
      default:
        return evidencias;
    }
  }, [evidenceView, evidencias]);

  const channelClientesDisponibles = useMemo(() => {
    if (!channelForm.entidad_id) {
      return catalogos.clientes;
    }
    const entidadId = Number(channelForm.entidad_id);
    return catalogos.clientes.filter(
      (item) => item.entidad_id === entidadId || item.entidad_id === null
    );
  }, [catalogos.clientes, channelForm.entidad_id]);

  const evidenceClientesDisponibles = useMemo(() => {
    if (!evidenceForm?.entidad_id) {
      return catalogos.clientes;
    }
    const entidadId = Number(evidenceForm.entidad_id);
    return catalogos.clientes.filter(
      (item) => item.entidad_id === entidadId || item.entidad_id === null
    );
  }, [catalogos.clientes, evidenceForm?.entidad_id]);

  const loadConfigAndCatalogs = async () => {
    const [configResponse, catalogosResponse] = await Promise.all([
      fetch(`${COMUNICACIONES_API_BASE}/configuracion/`, { cache: "no-store" }),
      fetch(`${COMUNICACIONES_API_BASE}/catalogos/`, { cache: "no-store" }),
    ]);

    const configBody = (await configResponse.json()) as unknown;
    if (!configResponse.ok) {
      throw new Error(
        getErrorMessage(configBody, "No se pudo cargar la configuracion de comunicaciones.")
      );
    }

    const catalogosBody = (await catalogosResponse.json()) as unknown;
    if (!catalogosResponse.ok) {
      throw new Error(
        getErrorMessage(catalogosBody, "No se pudieron cargar las entidades y clientes.")
      );
    }

    const configPayload = configBody as ConfiguracionComunicacionResponse;
    setConfig(configPayload);
    setForm(mapConfigToForm(configPayload));
    setCatalogos(catalogosBody as CatalogosComunicacion);
  };

  const loadOperationalData = async () => {
    const [webhooksResponse, evidenciasResponse] = await Promise.all([
      fetch(
        `${COMUNICACIONES_API_BASE}/webhooks/entrantes/?proveedor=META_CLOUD_API&limit=30`,
        { cache: "no-store" }
      ),
      fetch(`${COMUNICACIONES_API_BASE}/evidencias/`, { cache: "no-store" }),
    ]);

    const webhooksBody = (await webhooksResponse.json()) as unknown;
    if (!webhooksResponse.ok) {
      throw new Error(
        getErrorMessage(webhooksBody, "No se pudo cargar la cola del webhook oficial.")
      );
    }

    const evidenciasBody = (await evidenciasResponse.json()) as unknown;
    if (!evidenciasResponse.ok) {
      throw new Error(
        getErrorMessage(evidenciasBody, "No se pudo cargar la bandeja de comprobantes.")
      );
    }

    setWebhooks(webhooksBody as WebhooksResponse);
    setEvidencias(evidenciasBody as EvidenciaPagoItem[]);
  };

  const loadAll = async () => {
    setIsLoading(true);
    try {
      await Promise.all([loadConfigAndCatalogs(), loadOperationalData()]);
    } catch (error) {
      console.error("Error cargando integraciones:", error);
      alert(
        error instanceof Error
          ? error.message
          : "No se pudo cargar la configuracion de integraciones."
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
  }, []);

  useEffect(() => {
    if (!evidencias.length) {
      setSelectedEvidenceId(null);
      setEvidenceForm(null);
      return;
    }
    if (!selectedEvidence) {
      setSelectedEvidenceId(evidencias[0].id);
      setEvidenceForm(mapEvidenceToForm(evidencias[0]));
    }
  }, [evidencias, selectedEvidence]);

  const refreshOperationalData = async () => {
    setIsRefreshingData(true);
    try {
      await loadOperationalData();
    } catch (error) {
      console.error("Error recargando operacion:", error);
      alert(error instanceof Error ? error.message : "No se pudo refrescar la operacion.");
    } finally {
      setIsRefreshingData(false);
    }
  };

  const resetChannelForm = () => {
    setEditingChannelId(null);
    setChannelForm(EMPTY_CHANNEL_FORM);
  };

  const flashMessage = (value: string) => {
    setMensaje(value);
    window.setTimeout(() => setMensaje(""), 3000);
  };

  const handleSubmitConfig = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form || !config) {
      return;
    }
    setIsSavingConfig(true);
    try {
      const response = await fetch(
        `${COMUNICACIONES_API_BASE}/configuracion/?include_overview=false`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
          clave: form.clave.trim() || "PRINCIPAL",
          green_api_api_url: config.green_api_api_url || "",
          green_api_instance_id: config.green_api_instance_id || "",
          green_api_token: config.green_api_token || "",
          green_api_webhook_url: config.green_api_webhook_url || "",
          green_api_webhook_token: config.green_api_webhook_token || "",
          green_api_modo_filtro: config.green_api_modo_filtro || "SOLO_PERMITIDOS",
          green_api_sync_settings: Boolean(config.green_api_sync_settings),
          procesar_webhooks_async: form.procesar_webhooks_async,
          make_webhook_url: config.make_webhook_url || "",
          openai_model: form.openai_model.trim(),
          prompt_extraccion: form.prompt_extraccion.trim(),
          auto_detectar_comprobantes: form.auto_detectar_comprobantes,
          auto_crear_eventos: form.auto_crear_eventos,
          auto_aplicar_eventos_confiables: form.auto_aplicar_eventos_confiables,
          auto_conciliar_eventos: form.auto_conciliar_eventos,
          umbral_confianza_autoaplicacion:
            Number(form.umbral_confianza_autoaplicacion) || 85,
          ventana_match_dias: Math.max(Number(form.ventana_match_dias) || 7, 1),
          tolerancia_monto: Number(form.tolerancia_monto) || 0,
          email_activo: Boolean(config.email_activo),
          email_remitente_nombre: config.email_remitente_nombre || "",
          email_remitente: config.email_remitente || "",
          email_responder_a: config.email_responder_a || "",
          respetar_bajas_whatsapp: form.respetar_bajas_whatsapp,
          portal_token_horas: config.portal_token_horas || 168,
          activo: form.activo,
          }),
        }
      );
      const body = (await response.json()) as unknown;
      if (!response.ok) {
        throw new Error(getErrorMessage(body, "No se pudo guardar el motor operativo."));
      }
      flashMessage("Motor operativo actualizado correctamente.");
      await loadConfigAndCatalogs();
    } catch (error) {
      console.error("Error guardando configuracion:", error);
      alert(
        error instanceof Error ? error.message : "No se pudo guardar el motor operativo."
      );
    } finally {
      setIsSavingConfig(false);
    }
  };

  const handleSubmitChannel = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSavingChannel(true);
    const url = editingChannelId
      ? `${COMUNICACIONES_API_BASE}/configuracion/whatsapp-cloud/canales/${editingChannelId}/`
      : `${COMUNICACIONES_API_BASE}/configuracion/whatsapp-cloud/canales/`;
    const method = editingChannelId ? "PUT" : "POST";

    try {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...channelForm,
          nombre: channelForm.nombre.trim(),
          nombre_interno: channelForm.nombre_interno.trim(),
          display_phone_number: channelForm.display_phone_number.trim(),
          numero_wa_id: channelForm.numero_wa_id.trim(),
          phone_number_id: channelForm.phone_number_id.trim(),
          business_account_id: channelForm.business_account_id.trim(),
          waba_id: channelForm.waba_id.trim(),
          access_token: channelForm.access_token.trim(),
          entidad_id: parseOptionalInteger(channelForm.entidad_id),
          cliente_id: parseOptionalInteger(channelForm.cliente_id),
        }),
      });
      const body = (await response.json()) as unknown;
      if (!response.ok) {
        throw new Error(getErrorMessage(body, "No se pudo guardar el numero oficial."));
      }
      flashMessage(
        editingChannelId
          ? "Numero oficial actualizado correctamente."
          : "Numero oficial registrado correctamente."
      );
      resetChannelForm();
      await loadConfigAndCatalogs();
    } catch (error) {
      console.error("Error guardando canal oficial:", error);
      alert(
        error instanceof Error ? error.message : "No se pudo guardar el numero oficial."
      );
    } finally {
      setIsSavingChannel(false);
    }
  };

  const handleDeleteChannel = async (channelId: number) => {
    const confirmed = window.confirm(
      "Vas a eliminar este numero oficial. Si estaba activo para recepcion o salida, dejara de operar de inmediato."
    );
    if (!confirmed) {
      return;
    }
    try {
      const response = await fetch(
        `${COMUNICACIONES_API_BASE}/configuracion/whatsapp-cloud/canales/${channelId}/`,
        { method: "DELETE" }
      );
      const body = (await response.json()) as unknown;
      if (!response.ok) {
        throw new Error(getErrorMessage(body, "No se pudo eliminar el numero oficial."));
      }
      if (editingChannelId === channelId) {
        resetChannelForm();
      }
      flashMessage("Numero oficial eliminado correctamente.");
      await loadConfigAndCatalogs();
    } catch (error) {
      console.error("Error eliminando canal oficial:", error);
      alert(
        error instanceof Error ? error.message : "No se pudo eliminar el numero oficial."
      );
    }
  };

  const handleMakePrimary = async (channelId: number) => {
    try {
      const response = await fetch(
        `${COMUNICACIONES_API_BASE}/configuracion/whatsapp-cloud/canales/${channelId}/principal/`,
        { method: "POST" }
      );
      const body = (await response.json()) as unknown;
      if (!response.ok) {
        throw new Error(
          getErrorMessage(body, "No se pudo marcar el numero como principal.")
        );
      }
      flashMessage("Numero principal actualizado.");
      await loadConfigAndCatalogs();
    } catch (error) {
      console.error("Error marcando principal:", error);
      alert(
        error instanceof Error
          ? error.message
          : "No se pudo marcar el numero como principal."
      );
    }
  };

  const handleProcessPendingWebhooks = async () => {
    setIsDispatchingQueue(true);
    try {
      const response = await fetch(
        `${COMUNICACIONES_API_BASE}/webhooks/entrantes/procesar-pendientes/?proveedor=META_CLOUD_API`,
        { method: "POST" }
      );
      const body = (await response.json()) as unknown;
      if (!response.ok) {
        throw new Error(getErrorMessage(body, "No se pudo disparar el reproceso."));
      }
      flashMessage("Se reenviaron los eventos pendientes del canal oficial.");
      await refreshOperationalData();
    } catch (error) {
      console.error("Error procesando pendientes:", error);
      alert(error instanceof Error ? error.message : "No se pudo reprocesar.");
    } finally {
      setIsDispatchingQueue(false);
    }
  };

  const handleCheckWabaSubscription = async () => {
    setIsCheckingWabaSubscription(true);
    try {
      const response = await fetch(
        `${COMUNICACIONES_API_BASE}/configuracion/whatsapp-cloud/waba-subscription/`,
        { cache: "no-store" }
      );
      const body = (await response.json()) as unknown;
      if (!response.ok) {
        throw new Error(
          getErrorMessage(body, "No se pudo verificar la suscripcion WABA.")
        );
      }
      const state = body as WabaSubscriptionState;
      flashMessage(
        state.suscrita
          ? "WABA suscrito a la app de Meta."
          : "El WABA aun no aparece suscrito a la app esperada."
      );
      await loadConfigAndCatalogs();
    } catch (error) {
      console.error("Error verificando WABA:", error);
      alert(
        error instanceof Error
          ? error.message
          : "No se pudo verificar la suscripcion WABA."
      );
    } finally {
      setIsCheckingWabaSubscription(false);
    }
  };

  const handleAlignWabaSubscription = async () => {
    setIsAligningWabaSubscription(true);
    try {
      const response = await fetch(
        `${COMUNICACIONES_API_BASE}/configuracion/whatsapp-cloud/waba-subscription/`,
        { method: "POST" }
      );
      const body = (await response.json()) as unknown;
      if (!response.ok) {
        throw new Error(getErrorMessage(body, "No se pudo alinear WABA con Meta."));
      }
      const state = body as WabaSubscriptionState;
      flashMessage(
        state.suscrita
          ? "WABA alineado con el webhook."
          : "Meta respondio, pero la suscripcion sigue pendiente."
      );
      await loadConfigAndCatalogs();
    } catch (error) {
      console.error("Error alineando WABA:", error);
      alert(error instanceof Error ? error.message : "No se pudo alinear WABA.");
    } finally {
      setIsAligningWabaSubscription(false);
    }
  };

  const handleReprocessWebhook = async (webhookId: number) => {
    try {
      const response = await fetch(
        `${COMUNICACIONES_API_BASE}/webhooks/entrantes/${webhookId}/reprocesar/`,
        { method: "POST" }
      );
      const body = (await response.json()) as unknown;
      if (!response.ok) {
        throw new Error(getErrorMessage(body, "No se pudo reprocesar el evento."));
      }
      flashMessage("Evento reenviado a la cola.");
      await refreshOperationalData();
    } catch (error) {
      console.error("Error reprocesando webhook:", error);
      alert(error instanceof Error ? error.message : "No se pudo reprocesar el evento.");
    }
  };

  const handleSelectEvidence = (evidencia: EvidenciaPagoItem) => {
    setSelectedEvidenceId(evidencia.id);
    setEvidenceForm(mapEvidenceToForm(evidencia));
  };

  const handleSubmitEvidence = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedEvidence || !evidenceForm) {
      return;
    }
    setIsSavingEvidence(true);
    try {
      const response = await fetch(
        `${COMUNICACIONES_API_BASE}/evidencias/${selectedEvidence.id}/clasificacion/`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...evidenceForm,
            entidad_id: parseOptionalInteger(evidenceForm.entidad_id),
            cliente_id: parseOptionalInteger(evidenceForm.cliente_id),
            confianza_clasificacion:
              Number(evidenceForm.confianza_clasificacion) || 0,
          }),
        }
      );
      const body = (await response.json()) as unknown;
      if (!response.ok) {
        throw new Error(
          getErrorMessage(body, "No se pudo guardar la clasificacion del comprobante.")
        );
      }
      flashMessage("Comprobante clasificado y sincronizado correctamente.");
      await refreshOperationalData();
    } catch (error) {
      console.error("Error clasificando evidencia:", error);
      alert(
        error instanceof Error
          ? error.message
          : "No se pudo guardar la clasificacion."
      );
    } finally {
      setIsSavingEvidence(false);
    }
  };

  if (isLoading || !config || !form) {
    return (
      <div className="rounded-3xl border border-zinc-800 bg-zinc-950/70 p-8 text-sm text-zinc-400">
        Cargando integraciones de WhatsApp oficial...
      </div>
    );
  }

  const overview = config.whatsapp_cloud;

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-zinc-800 bg-gradient-to-br from-zinc-950 via-zinc-950 to-zinc-900 p-6 shadow-xl">
        <div className="max-w-4xl space-y-3">
          <h2 className="text-2xl font-bold text-white">
            Integraciones y automatizacion
          </h2>
          <p className="text-sm text-zinc-400">
            Reemplazamos la logica de sesiones conectadas por un canal oficial de
            WhatsApp Cloud API. Aqui defines el webhook, registras números reales y
            observas el flujo de recepción, comprobantes y automatizaciones.
          </p>
        </div>
        {mensaje ? (
          <div className="mt-4 rounded-2xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-200">
            {mensaje}
          </div>
        ) : null}
      </section>

      <section className="rounded-3xl border border-zinc-800 bg-zinc-950/70 p-5">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-5">
          {TAB_OPTIONS.map((tab) => {
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
                <p className="mt-2 text-sm text-zinc-500">{tab.description}</p>
              </button>
            );
          })}
        </div>
      </section>

      {activeTab === "conexion" ? (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="space-y-6">
            <section className="rounded-3xl border border-zinc-800 bg-zinc-950/60 p-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-white">Estado oficial de Meta</h3>
                  <p className="mt-1 text-sm text-zinc-500">
                    Esto resume si el proyecto ya tiene lo necesario para conectar
                    números oficiales y operar mensajes de entrada y salida.
                  </p>
                </div>
                <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-xs font-medium text-cyan-200">
                  {overview.provider}
                </span>
              </div>

              <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                {[
                  ["App de Meta", overview.app_id_configurada ? "Lista" : "Pendiente"],
                  ["Config ID", overview.config_id_configurada ? "Lista" : "Pendiente"],
                  [
                    "Verify token",
                    overview.verify_token_configurado ? "Listo" : "Pendiente",
                  ],
                  [
                    "Webhook publico",
                    overview.webhook_url ? "Disponible" : "Pendiente",
                  ],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="rounded-2xl border border-zinc-800 bg-zinc-900/40 px-4 py-4"
                  >
                    <p className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">
                      {label}
                    </p>
                    <p className="mt-2 text-lg font-semibold text-white">{value}</p>
                  </div>
                ))}
              </div>

              <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
                  <p className="text-sm font-medium text-white">Webhook de Meta</p>
                  <p className="mt-2 break-all text-sm text-zinc-400">
                    {overview.webhook_url || "Define BACKEND_PUBLIC_BASE_URL para generar la URL."}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        overview.webhook_url
                          ? copyToClipboard(overview.webhook_url).then(() =>
                              flashMessage("Webhook copiado al portapapeles.")
                            )
                          : null
                      }
                      disabled={!overview.webhook_url}
                      className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-300 disabled:opacity-50"
                    >
                      Copiar webhook
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        overview.backend_public_base_url
                          ? copyToClipboard(overview.backend_public_base_url).then(() =>
                              flashMessage("Base publica copiada.")
                            )
                          : null
                      }
                      disabled={!overview.backend_public_base_url}
                      className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-300 disabled:opacity-50"
                    >
                      Copiar base backend
                    </button>
                  </div>
                </div>

                <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
                  <p className="text-sm font-medium text-white">Onboarding sugerido</p>
                  <ol className="mt-3 space-y-2 text-sm text-zinc-400">
                    <li>1. Crea o conecta el webhook de Meta con la URL pública.</li>
                    <li>2. Registra el número oficial en la pestaña de números.</li>
                    <li>3. Marca un número principal para envíos automáticos.</li>
                    <li>4. Prueba recepción con un mensaje y salida con una campaña.</li>
                  </ol>
                </div>
              </div>
            </section>

            {overview.produccion_preparacion ? (
              <section className="rounded-3xl border border-emerald-500/20 bg-emerald-500/5 p-5">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-white">
                      Preparacion para numero definitivo
                    </h3>
                    <p className="mt-1 text-sm text-emerald-100/70">
                      Esto deja el corte listo para cuando Meta apruebe el numero real.
                      No enciende recordatorios ni automatizaciones.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-200">
                      {overview.produccion_preparacion.modo || "PREPARACION"}
                    </span>
                    <span className="rounded-full border border-zinc-700 bg-zinc-950 px-3 py-1 text-xs font-medium text-zinc-300">
                      {overview.produccion_preparacion.activo ? "Activo" : "Sin activar"}
                    </span>
                    <span
                      className={`rounded-full border px-3 py-1 text-xs font-medium ${
                        overview.produccion_preparacion.listo_para_cambio
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                          : "border-amber-500/30 bg-amber-500/10 text-amber-200"
                      }`}
                    >
                      {overview.produccion_preparacion.listo_para_cambio
                        ? "Listo para cambio"
                        : "Pendientes"}
                    </span>
                  </div>
                </div>

                <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div className="rounded-2xl border border-emerald-500/20 bg-zinc-950/70 p-4">
                    <p className="text-[11px] uppercase tracking-[0.24em] text-emerald-200/70">
                      Plantillas aprobadas
                    </p>
                    <p className="mt-2 text-2xl font-semibold text-white">
                      {overview.produccion_preparacion.plantillas_meta_aprobadas || 0}
                    </p>
                    <p className="mt-1 text-xs text-zinc-500">
                      De {overview.produccion_preparacion.plantillas_whatsapp || 0} registradas.
                    </p>
                  </div>
                  <div className="rounded-2xl border border-emerald-500/20 bg-zinc-950/70 p-4">
                    <p className="text-[11px] uppercase tracking-[0.24em] text-emerald-200/70">
                      Automatizaciones activas
                    </p>
                    <p className="mt-2 text-2xl font-semibold text-white">
                      {overview.produccion_preparacion.automatizaciones_activas || 0}
                    </p>
                    <p className="mt-1 text-xs text-zinc-500">
                      Para el corte deben quedar en cero hasta que decidas encenderlas.
                    </p>
                  </div>
                  <div className="rounded-2xl border border-emerald-500/20 bg-zinc-950/70 p-4">
                    <p className="text-[11px] uppercase tracking-[0.24em] text-emerald-200/70">
                      Numero principal
                    </p>
                    <p className="mt-2 text-2xl font-semibold text-white">
                      {overview.canales_principales}
                    </p>
                    <p className="mt-1 text-xs text-zinc-500">
                      Debe apuntar al numero definitivo cuando Meta lo apruebe.
                    </p>
                  </div>
                </div>

                {overview.produccion_checklist?.length ? (
                  <div className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-2">
                    {overview.produccion_checklist.map((item) => (
                      <div
                        key={item.id}
                        className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-semibold text-white">{item.titulo}</p>
                            {item.descripcion ? (
                              <p className="mt-1 text-sm text-zinc-500">{item.descripcion}</p>
                            ) : null}
                          </div>
                          <span
                            className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium ${
                              item.listo
                                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                                : "border-amber-500/30 bg-amber-500/10 text-amber-200"
                            }`}
                          >
                            {item.listo ? "Listo" : "Pendiente"}
                          </span>
                        </div>
                        {item.detalle ? (
                          <p className="mt-3 text-sm text-zinc-400">{item.detalle}</p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}

                {overview.produccion_preparacion.bloqueantes?.length ? (
                  <div className="mt-5 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">
                    <p className="font-semibold">Pendiente antes del cambio</p>
                    <ul className="mt-2 list-disc space-y-1 pl-5">
                      {overview.produccion_preparacion.bloqueantes.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div className="mt-5 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-100">
                    El corte esta preparado. Cuando tengas el numero definitivo solo cambia
                    el canal principal y activa las reglas manualmente.
                  </div>
                )}
              </section>
            ) : null}

            <section className="rounded-3xl border border-zinc-800 bg-zinc-950/60 p-5">
              <div>
                <h3 className="text-lg font-semibold text-white">Motor operativo</h3>
                <p className="mt-1 text-sm text-zinc-500">
                  Estas reglas siguen controlando cómo se procesan mensajes, se
                  detectan comprobantes y se disparan eventos financieros.
                </p>
              </div>

              <form onSubmit={handleSubmitConfig} className="mt-5 space-y-5">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <label className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 text-sm text-zinc-300">
                    <span className="block font-medium text-white">
                      Modelo de extracción
                    </span>
                    <input
                      type="text"
                      value={form.openai_model}
                      onChange={(event) =>
                        setForm({ ...form, openai_model: event.target.value })
                      }
                      placeholder="Ej. gpt-5.4-mini"
                      className="mt-3 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none placeholder:text-zinc-500"
                    />
                  </label>

                  <label className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 text-sm text-zinc-300">
                    <span className="block font-medium text-white">
                      Umbral de autoaplicación
                    </span>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      value={form.umbral_confianza_autoaplicacion}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          umbral_confianza_autoaplicacion: event.target.value,
                        })
                      }
                      className="mt-3 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none"
                    />
                  </label>

                  <label className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 text-sm text-zinc-300">
                    <span className="block font-medium text-white">Ventana de match (días)</span>
                    <input
                      type="number"
                      min="1"
                      value={form.ventana_match_dias}
                      onChange={(event) =>
                        setForm({ ...form, ventana_match_dias: event.target.value })
                      }
                      className="mt-3 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none"
                    />
                  </label>

                  <label className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 text-sm text-zinc-300">
                    <span className="block font-medium text-white">Tolerancia de monto</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.tolerancia_monto}
                      onChange={(event) =>
                        setForm({ ...form, tolerancia_monto: event.target.value })
                      }
                      className="mt-3 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none"
                    />
                  </label>
                </div>

                <label className="block rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 text-sm text-zinc-300">
                  <span className="block font-medium text-white">Prompt operativo</span>
                  <textarea
                    value={form.prompt_extraccion}
                    onChange={(event) =>
                      setForm({ ...form, prompt_extraccion: event.target.value })
                    }
                    rows={5}
                    placeholder="Instrucciones internas para clasificar pagos y gastos desde mensajes y comprobantes."
                    className="mt-3 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-3 text-sm text-white outline-none placeholder:text-zinc-500"
                  />
                </label>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {[
                    [
                      "procesar_webhooks_async",
                      "Procesar webhook en segundo plano",
                      "Mueve el trabajo pesado a la cola para no bloquear el callback de Meta.",
                    ],
                    [
                      "auto_detectar_comprobantes",
                      "Detectar comprobantes",
                      "Si entra una imagen o texto financiero, intenta crear evidencia automática.",
                    ],
                    [
                      "auto_crear_eventos",
                      "Crear eventos financieros",
                      "Genera propuestas de CxC o CxP al detectar pagos o gastos claros.",
                    ],
                    [
                      "auto_aplicar_eventos_confiables",
                      "Aplicar eventos confiables",
                      "Si la confianza supera el umbral, intenta aplicar sin intervención manual.",
                    ],
                    [
                      "auto_conciliar_eventos",
                      "Conciliar eventos",
                      "Deja la puerta lista para cierres y conciliación posterior.",
                    ],
                    [
                      "respetar_bajas_whatsapp",
                      "Respetar BAJA/STOP automaticamente",
                      "Si un cliente responde BAJA, STOP o NO ENVIAR, se marca como no contactar. Si se apaga, solo queda auditado.",
                    ],
                    [
                      "activo",
                      "Módulo activo",
                      "Si lo apagas, el canal deja de usarse como motor principal.",
                    ],
                  ].map(([key, title, description]) => (
                    <label
                      key={key}
                      className="flex items-start gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/40 px-4 py-3 text-sm text-zinc-300"
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(form[key as keyof ConfigFormState])}
                        onChange={(event) =>
                          setForm({
                            ...form,
                            [key]: event.target.checked,
                          } as ConfigFormState)
                        }
                        className="mt-1 h-4 w-4 rounded border-zinc-700 bg-zinc-900 text-cyan-500"
                      />
                      <span>
                        <span className="block font-medium text-white">{title}</span>
                        <span className="mt-1 block text-xs text-zinc-500">
                          {description}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={isSavingConfig}
                    className="rounded-2xl bg-cyan-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:opacity-50"
                  >
                    {isSavingConfig ? "Guardando..." : "Guardar motor"}
                  </button>
                </div>
              </form>
            </section>
          </div>

          <aside className="space-y-6">
            <section className="rounded-3xl border border-zinc-800 bg-zinc-950/60 p-5">
              <h3 className="text-lg font-semibold text-white">Resumen rapido</h3>
              <div className="mt-4 grid grid-cols-1 gap-3">
                {[
                  ["Canales activos", String(overview.canales_activos)],
                  ["Principal", String(overview.canales_principales)],
                  ["Webhooks pendientes", String(webhooks.metricas.pendientes)],
                  [
                    "Comprobantes por revisar",
                    String(
                      evidencias.filter(
                        (item) =>
                          item.requiere_revision_manual || item.estatus !== "APLICADA"
                      ).length
                    ),
                  ],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="rounded-2xl border border-zinc-800 bg-zinc-900/40 px-4 py-4"
                  >
                    <p className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">
                      {label}
                    </p>
                    <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
                  </div>
                ))}
              </div>
            </section>
          </aside>
        </div>
      ) : null}

      {activeTab === "numeros" ? (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(420px,0.9fr)]">
          <div className="rounded-3xl border border-zinc-800 bg-zinc-950/60 p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-white">Numeros oficiales</h3>
                <p className="mt-1 text-sm text-zinc-500">
                  Registra uno o varios números reales. Uno puede quedar como principal
                  para envíos automáticos y los demás para operación específica.
                </p>
              </div>
              <button
                type="button"
                onClick={resetChannelForm}
                className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm text-zinc-300"
              >
                Nuevo
              </button>
            </div>

            <div className="mt-5 space-y-3">
              {whatsappChannels.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/20 py-10 text-center text-sm text-zinc-500">
                  Aun no hay números oficiales registrados en esta capa.
                </div>
              ) : (
                whatsappChannels.map((channel) => (
                  <div
                    key={channel.id}
                    className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4"
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          {channel.es_principal ? (
                            <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-1 text-[11px] font-medium text-cyan-200">
                              Principal
                            </span>
                          ) : null}
                          <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-zinc-300">
                            {channel.estado}
                          </span>
                          {channel.puede_enviar ? (
                            <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-300">
                              Envio activo
                            </span>
                          ) : null}
                          {channel.puede_recibir ? (
                            <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-300">
                              Recepcion activa
                            </span>
                          ) : null}
                        </div>
                        <p className="text-base font-semibold text-white">{channel.nombre}</p>
                        <div className="flex flex-wrap gap-3 text-xs text-zinc-500">
                          <span>Display: {channel.display_phone_number || "-"}</span>
                          <span>Phone Number ID: {channel.phone_number_id || "-"}</span>
                          <span>WABA: {channel.waba_id || "-"}</span>
                        </div>
                        <div className="flex flex-wrap gap-3 text-xs text-zinc-500">
                          <span>Entidad: {channel.entidad_nombre || "Sin asignar"}</span>
                          <span>Cliente: {channel.cliente_nombre || "Sin asignar"}</span>
                          <span>
                            Token: {channel.access_token_configurado ? "Configurado" : "Pendiente"}
                          </span>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {!channel.es_principal ? (
                          <button
                            type="button"
                            onClick={() => void handleMakePrimary(channel.id)}
                            className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-3 py-2 text-xs font-medium text-cyan-200"
                          >
                            Hacer principal
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => {
                            setEditingChannelId(channel.id);
                            setChannelForm(mapChannelToForm(channel));
                          }}
                          className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-300"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteChannel(channel.id)}
                          className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-300"
                        >
                          Eliminar
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <aside className="rounded-3xl border border-zinc-800 bg-zinc-950/60 p-5">
            <h3 className="text-lg font-semibold text-white">
              {editingChannelId ? "Editar numero oficial" : "Registrar numero oficial"}
            </h3>
            <p className="mt-1 text-sm text-zinc-500">
              Puedes cargar el número ya aprobado en Meta y dejar listo si enviará,
              recibirá o será el principal de la capa.
            </p>

            <form onSubmit={handleSubmitChannel} className="mt-5 space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <input
                  type="text"
                  value={channelForm.nombre}
                  onChange={(event) =>
                    setChannelForm({ ...channelForm, nombre: event.target.value })
                  }
                  placeholder="Nombre visible. Ej. Cobranza principal"
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white placeholder:text-zinc-500"
                />
                <input
                  type="text"
                  value={channelForm.nombre_interno}
                  onChange={(event) =>
                    setChannelForm({ ...channelForm, nombre_interno: event.target.value })
                  }
                  placeholder="Alias interno opcional"
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white placeholder:text-zinc-500"
                />
                <input
                  type="text"
                  value={channelForm.display_phone_number}
                  onChange={(event) =>
                    setChannelForm({
                      ...channelForm,
                      display_phone_number: event.target.value,
                    })
                  }
                  placeholder="Display number de Meta. Ej. +52 999 000 0000"
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white placeholder:text-zinc-500"
                />
                <input
                  type="text"
                  value={channelForm.numero_wa_id}
                  onChange={(event) =>
                    setChannelForm({ ...channelForm, numero_wa_id: event.target.value })
                  }
                  placeholder="Numero WhatsApp sin formato. Ej. 529990000000"
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white placeholder:text-zinc-500"
                />
                <input
                  type="text"
                  value={channelForm.phone_number_id}
                  onChange={(event) =>
                    setChannelForm({ ...channelForm, phone_number_id: event.target.value })
                  }
                  placeholder="Phone Number ID"
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white placeholder:text-zinc-500"
                />
                <input
                  type="text"
                  value={channelForm.business_account_id}
                  onChange={(event) =>
                    setChannelForm({
                      ...channelForm,
                      business_account_id: event.target.value,
                    })
                  }
                  placeholder="Business Account ID"
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white placeholder:text-zinc-500"
                />
                <input
                  type="text"
                  value={channelForm.waba_id}
                  onChange={(event) =>
                    setChannelForm({ ...channelForm, waba_id: event.target.value })
                  }
                  placeholder="WABA ID"
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white placeholder:text-zinc-500"
                />
                <select
                  value={channelForm.estado}
                  onChange={(event) =>
                    setChannelForm({ ...channelForm, estado: event.target.value })
                  }
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-200"
                >
                  <option value="BORRADOR">Borrador</option>
                  <option value="PENDIENTE">Pendiente</option>
                  <option value="CONECTADO">Conectado</option>
                  <option value="ERROR">Error</option>
                  <option value="DESCONECTADO">Desconectado</option>
                </select>
              </div>

              <label className="block">
                <span className="mb-1 block text-sm font-medium text-zinc-400">
                  Access token del numero
                </span>
                <input
                  type="password"
                  value={channelForm.access_token}
                  onChange={(event) =>
                    setChannelForm({ ...channelForm, access_token: event.target.value })
                  }
                  placeholder={
                    editingChannelId
                      ? "Dejalo vacio si no quieres reemplazar el token actual"
                      : "Pega el access token del numero o del flujo oficial"
                  }
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white placeholder:text-zinc-500"
                />
              </label>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <select
                  value={channelForm.entidad_id}
                  onChange={(event) =>
                    setChannelForm({
                      ...channelForm,
                      entidad_id: event.target.value,
                      cliente_id:
                        channelForm.cliente_id &&
                        !catalogos.clientes.some(
                          (cliente) =>
                            String(cliente.id) === channelForm.cliente_id &&
                            (event.target.value === "" ||
                              cliente.entidad_id === Number(event.target.value) ||
                              cliente.entidad_id === null)
                        )
                          ? ""
                          : channelForm.cliente_id,
                    })
                  }
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-200"
                >
                  <option value="">Sin entidad fija</option>
                  {catalogos.entidades.map((entidad) => (
                    <option key={entidad.id} value={entidad.id}>
                      {entidad.nombre}
                    </option>
                  ))}
                </select>
                <select
                  value={channelForm.cliente_id}
                  onChange={(event) =>
                    setChannelForm({ ...channelForm, cliente_id: event.target.value })
                  }
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-200"
                >
                  <option value="">Sin cliente fijo</option>
                  {channelClientesDisponibles.map((cliente) => (
                    <option key={cliente.id} value={cliente.id}>
                      {cliente.nombre}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {[
                  ["puede_enviar", "Puede enviar mensajes"],
                  ["puede_recibir", "Puede recibir mensajes"],
                  ["es_principal", "Usar como principal"],
                  ["activo", "Canal activo"],
                ].map(([key, label]) => (
                  <label
                    key={key}
                    className="flex items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/40 px-4 py-3 text-sm text-zinc-300"
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(channelForm[key as keyof WhatsappChannelFormState])}
                      onChange={(event) =>
                        setChannelForm({
                          ...channelForm,
                          [key]: event.target.checked,
                        } as WhatsappChannelFormState)
                      }
                      className="h-4 w-4 rounded border-zinc-700 bg-zinc-900 text-cyan-500"
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>

              <div className="flex flex-wrap justify-end gap-2">
                {editingChannelId ? (
                  <button
                    type="button"
                    onClick={resetChannelForm}
                    className="rounded-2xl border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm font-medium text-zinc-300"
                  >
                    Cancelar
                  </button>
                ) : null}
                <button
                  type="submit"
                  disabled={isSavingChannel}
                  className="rounded-2xl bg-cyan-600 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50"
                >
                  {isSavingChannel
                    ? "Guardando..."
                    : editingChannelId
                    ? "Actualizar numero"
                    : "Registrar numero"}
                </button>
              </div>
            </form>
          </aside>
        </div>
      ) : null}

      {activeTab === "cola" ? (
        <section className="rounded-3xl border border-zinc-800 bg-zinc-950/60 p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h3 className="text-lg font-semibold text-white">Webhook y estados</h3>
              <p className="mt-1 text-sm text-zinc-500">
                Aqui ves lo que entro desde WhatsApp oficial, si ya se proceso,
                cuantas veces se intento y si algo quedo atorado.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={webhookStatusFilter}
                onChange={(event) =>
                  setWebhookStatusFilter(event.target.value as WebhookStatusFilter)
                }
                className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200"
              >
                <option value="TODOS">Todos los estados</option>
                <option value="PENDIENTE">Pendiente</option>
                <option value="PROCESANDO">Procesando</option>
                <option value="PROCESADO">Procesado</option>
                <option value="IGNORADO">Ignorado</option>
                <option value="ERROR">Error</option>
              </select>
              <button
                type="button"
                onClick={() => void refreshOperationalData()}
                disabled={isRefreshingData}
                className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-300 disabled:opacity-50"
              >
                {isRefreshingData ? "Actualizando..." : "Refrescar"}
              </button>
              <button
                type="button"
                onClick={() => void handleProcessPendingWebhooks()}
                disabled={isDispatchingQueue}
                className="rounded-xl bg-cyan-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {isDispatchingQueue ? "Enviando..." : "Procesar pendientes"}
              </button>
            </div>
          </div>

          <div
            className={`mt-5 rounded-2xl border p-4 ${
              wabaSubscription?.suscrita
                ? "border-emerald-500/20 bg-emerald-500/10"
                : "border-amber-500/20 bg-amber-500/10"
            }`}
          >
            <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="text-sm font-semibold text-white">
                    Alineacion WABA a webhook
                  </h4>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                      wabaSubscription?.suscrita
                        ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
                        : "border-amber-500/20 bg-amber-500/10 text-amber-300"
                    }`}
                  >
                    {wabaSubscription?.suscrita ? "Suscrito" : "Pendiente"}
                  </span>
                </div>
                <p className="mt-1 max-w-4xl text-sm text-zinc-400">
                  Meta puede aprobar plantillas y permitir envios aunque el WABA no
                  entregue mensajes entrantes al webhook. Verifica esta suscripcion
                  cuando no veas eventos nuevos.
                </p>
                <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-zinc-500 md:grid-cols-3">
                  <span>Canal: {wabaSubscription?.canal_nombre || "Sin verificacion"}</span>
                  <span>WABA: {wabaSubscription?.waba_id || "-"}</span>
                  <span>
                    App esperada:{" "}
                    {wabaSubscription?.app_id_esperada ||
                      config?.whatsapp_cloud?.app_id ||
                      "-"}
                  </span>
                </div>
                <p className="mt-2 text-xs text-zinc-500">
                  Apps suscritas:{" "}
                  {wabaSubscription?.apps?.length
                    ? wabaSubscription.apps
                        .map((app) => app.name || app.id || "App sin nombre")
                        .join(", ")
                    : "Sin lectura guardada."}
                </p>
                <p className="mt-1 text-xs text-zinc-600">
                  Ultima lectura: {formatDateTime(wabaSubscription?.checked_at)}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void handleCheckWabaSubscription()}
                  disabled={isCheckingWabaSubscription || isAligningWabaSubscription}
                  className="rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-2 text-sm font-medium text-zinc-200 disabled:opacity-50"
                >
                  {isCheckingWabaSubscription ? "Verificando..." : "Verificar WABA"}
                </button>
                <button
                  type="button"
                  onClick={() => void handleAlignWabaSubscription()}
                  disabled={
                    isCheckingWabaSubscription ||
                    isAligningWabaSubscription ||
                    Boolean(wabaSubscription?.suscrita)
                  }
                  className="rounded-xl bg-cyan-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {isAligningWabaSubscription ? "Alineando..." : "Alinear WABA"}
                </button>
              </div>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-5">
            {[
              ["Pendientes", webhooks.metricas.pendientes, "text-amber-200"],
              ["Procesando", webhooks.metricas.procesando, "text-cyan-200"],
              ["Procesados", webhooks.metricas.procesados, "text-emerald-200"],
              ["Ignorados", webhooks.metricas.ignorados, "text-zinc-300"],
              ["Errores", webhooks.metricas.errores, "text-red-200"],
            ].map(([label, value, tone]) => (
              <div
                key={label}
                className="rounded-2xl border border-zinc-800 bg-zinc-900/40 px-4 py-4"
              >
                <p className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">
                  {label}
                </p>
                <p className={`mt-2 text-2xl font-semibold ${tone}`}>{String(value)}</p>
              </div>
            ))}
          </div>

          <div className="mt-5 space-y-3">
            {webhookItems.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/20 py-10 text-center text-sm text-zinc-500">
                No hay eventos para el filtro actual.
              </div>
            ) : (
              webhookItems.map((item) => (
                <div
                  key={item.id}
                  className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4"
                >
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${getWebhookStatusTone(
                            item.estatus_procesamiento
                          )}`}
                        >
                          {item.estatus_procesamiento}
                        </span>
                        <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-zinc-300">
                          {item.tipo_webhook || "Sin tipo"}
                        </span>
                        <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-zinc-300">
                          Intentos: {item.intentos_procesamiento}
                        </span>
                      </div>
                      <p className="text-sm font-medium text-white">
                        {item.chat_id || item.remitente || "Origen no identificado"}
                      </p>
                      <div className="flex flex-wrap gap-3 text-xs text-zinc-500">
                        <span>ID externo: {item.origen_externo_id || "-"}</span>
                        <span>Recibido: {formatDateTime(item.fecha_recepcion)}</span>
                        <span>Procesado: {formatDateTime(item.fecha_procesamiento)}</span>
                      </div>
                      {item.error_procesamiento ? (
                        <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                          {item.error_procesamiento}
                        </div>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleReprocessWebhook(item.id)}
                      className="rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-3 py-2 text-xs font-medium text-cyan-200"
                    >
                      Reprocesar
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      ) : null}

      {activeTab === "comprobantes" ? (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(380px,0.85fr)]">
          <div className="rounded-3xl border border-zinc-800 bg-zinc-950/60 p-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h3 className="text-lg font-semibold text-white">Bandeja de comprobantes</h3>
                <p className="mt-1 text-sm text-zinc-500">
                  El sistema clasifica lo que entra por WhatsApp oficial y aqui lo
                  bajas al detalle para ingreso, gasto y aplicación financiera.
                </p>
              </div>
              <div className="flex gap-2">
                <select
                  value={evidenceView}
                  onChange={(event) => setEvidenceView(event.target.value as EvidenceView)}
                  className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200"
                >
                  <option value="PENDIENTES">Pendientes o por revisar</option>
                  <option value="TODOS">Todos</option>
                  <option value="INGRESOS">Solo ingresos</option>
                  <option value="EGRESOS">Solo egresos</option>
                  <option value="APLICADAS">Ya aplicadas</option>
                </select>
                <button
                  type="button"
                  onClick={() => void refreshOperationalData()}
                  disabled={isRefreshingData}
                  className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-300"
                >
                  {isRefreshingData ? "Actualizando..." : "Refrescar"}
                </button>
              </div>
            </div>

            <div className="mt-5 space-y-3">
              {evidenceItems.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/20 py-10 text-center text-sm text-zinc-500">
                  No hay comprobantes para la vista actual.
                </div>
              ) : (
                evidenceItems.map((evidencia) => {
                  const selected = evidencia.id === selectedEvidenceId;
                  return (
                    <button
                      key={evidencia.id}
                      type="button"
                      onClick={() => handleSelectEvidence(evidencia)}
                      className={`block w-full rounded-2xl border p-4 text-left ${
                        selected
                          ? "border-cyan-500/30 bg-cyan-500/10"
                          : "border-zinc-800 bg-zinc-900/30 hover:border-zinc-700"
                      }`}
                    >
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${getEvidenceTone(
                              evidencia.tipo_movimiento
                            )}`}
                          >
                            {evidencia.tipo_movimiento}
                          </span>
                          <span
                            className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${getEvidenceStatusTone(
                              evidencia.estatus
                            )}`}
                          >
                            {evidencia.estatus}
                          </span>
                        </div>
                        <p className="font-medium text-white">
                          {evidencia.cliente_nombre ||
                            evidencia.entidad_nombre ||
                            "Comprobante sin asignar"}
                        </p>
                        <div className="flex flex-wrap gap-3 text-xs text-zinc-500">
                          <span>Monto: {formatCurrency(evidencia.monto_reportado)}</span>
                          <span>Fecha: {formatDate(evidencia.fecha_pago_reportada)}</span>
                          <span>Confianza: {evidencia.confianza_clasificacion}%</span>
                          <span>Origen: {evidencia.origen_deteccion}</span>
                        </div>
                        <p className="line-clamp-2 text-sm text-zinc-400">
                          {evidencia.texto_extraido ||
                            evidencia.observaciones ||
                            "Sin texto disponible."}
                        </p>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <aside className="rounded-3xl border border-zinc-800 bg-zinc-950/60 p-5">
            <h3 className="text-lg font-semibold text-white">Revision y aplicacion</h3>
            {!selectedEvidence || !evidenceForm ? (
              <div className="mt-5 rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/20 py-10 text-center text-sm text-zinc-500">
                Selecciona un comprobante para revisarlo.
              </div>
            ) : (
              <form onSubmit={handleSubmitEvidence} className="mt-5 space-y-4">
                <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${getEvidenceTone(
                        selectedEvidence.tipo_movimiento
                      )}`}
                    >
                      {selectedEvidence.tipo_movimiento}
                    </span>
                    <span
                      className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${getEvidenceStatusTone(
                        selectedEvidence.estatus
                      )}`}
                    >
                      {selectedEvidence.estatus}
                    </span>
                  </div>
                  <div className="mt-3 space-y-2 text-sm text-zinc-400">
                    <p>
                      <span className="font-medium text-white">Monto:</span>{" "}
                      {formatCurrency(selectedEvidence.monto_reportado)}
                    </p>
                    <p>
                      <span className="font-medium text-white">Referencia:</span>{" "}
                      {selectedEvidence.referencia_reportada || "Sin referencia"}
                    </p>
                    <p>
                      <span className="font-medium text-white">Registrado:</span>{" "}
                      {formatDateTime(selectedEvidence.fecha_registro)}
                    </p>
                    <p>
                      <span className="font-medium text-white">Archivo:</span>{" "}
                      {selectedEvidence.url_archivo ? (
                        <a
                          href={selectedEvidence.url_archivo}
                          target="_blank"
                          rel="noreferrer"
                          className="text-cyan-300 hover:text-cyan-200"
                        >
                          Abrir comprobante
                        </a>
                      ) : (
                        "Sin adjunto"
                      )}
                    </p>
                  </div>
                  <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-sm text-zinc-400">
                    {selectedEvidence.texto_extraido ||
                      selectedEvidence.observaciones ||
                      "Sin texto extraido."}
                  </div>
                </div>

                <select
                  value={evidenceForm.tipo_movimiento}
                  onChange={(event) =>
                    setEvidenceForm({
                      ...evidenceForm,
                      tipo_movimiento: event.target.value,
                      cliente_id:
                        event.target.value === "EGRESO" ? "" : evidenceForm.cliente_id,
                    })
                  }
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-200"
                >
                  <option value="INGRESO">Ingreso / pago recibido</option>
                  <option value="EGRESO">Egreso / gasto pagado</option>
                </select>
                <input
                  type="text"
                  value={evidenceForm.categoria_sugerida}
                  onChange={(event) =>
                    setEvidenceForm({
                      ...evidenceForm,
                      categoria_sugerida: event.target.value,
                    })
                  }
                  placeholder="RENTA, LUZ, INTERNET, NOMINA..."
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white placeholder:text-zinc-500"
                />
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <select
                    value={evidenceForm.entidad_id}
                    onChange={(event) =>
                      setEvidenceForm({
                        ...evidenceForm,
                        entidad_id: event.target.value,
                        cliente_id:
                          evidenceForm.cliente_id &&
                          !catalogos.clientes.some(
                            (cliente) =>
                              String(cliente.id) === evidenceForm.cliente_id &&
                              (event.target.value === "" ||
                                cliente.entidad_id === Number(event.target.value) ||
                                cliente.entidad_id === null)
                          )
                            ? ""
                            : evidenceForm.cliente_id,
                      })
                    }
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-200"
                  >
                    <option value="">Sin asignar</option>
                    {catalogos.entidades.map((entidad) => (
                      <option key={entidad.id} value={entidad.id}>
                        {entidad.nombre}
                      </option>
                    ))}
                  </select>
                  <select
                    value={evidenceForm.cliente_id}
                    onChange={(event) =>
                      setEvidenceForm({ ...evidenceForm, cliente_id: event.target.value })
                    }
                    disabled={evidenceForm.tipo_movimiento === "EGRESO"}
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-200 disabled:opacity-50"
                  >
                    <option value="">Sin cliente</option>
                    {evidenceClientesDisponibles.map((cliente) => (
                      <option key={cliente.id} value={cliente.id}>
                        {cliente.nombre}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={evidenceForm.confianza_clasificacion}
                    onChange={(event) =>
                      setEvidenceForm({
                        ...evidenceForm,
                        confianza_clasificacion: event.target.value,
                      })
                    }
                    placeholder="Confianza"
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white"
                  />
                  <label className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3 text-sm text-zinc-300">
                    <input
                      type="checkbox"
                      checked={evidenceForm.requiere_revision_manual}
                      onChange={(event) =>
                        setEvidenceForm({
                          ...evidenceForm,
                          requiere_revision_manual: event.target.checked,
                        })
                      }
                      className="h-4 w-4 rounded border-zinc-700 bg-zinc-900 text-cyan-500"
                    />
                    Requiere revision manual
                  </label>
                </div>

                <textarea
                  value={evidenceForm.observaciones}
                  onChange={(event) =>
                    setEvidenceForm({
                      ...evidenceForm,
                      observaciones: event.target.value,
                    })
                  }
                  rows={4}
                  placeholder="Notas internas o criterio de clasificacion"
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-3 text-sm text-white placeholder:text-zinc-500"
                />

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <label className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3 text-sm text-zinc-300">
                    <input
                      type="checkbox"
                      checked={evidenceForm.crear_evento}
                      onChange={(event) =>
                        setEvidenceForm({
                          ...evidenceForm,
                          crear_evento: event.target.checked,
                        })
                      }
                      className="h-4 w-4 rounded border-zinc-700 bg-zinc-900 text-cyan-500"
                    />
                    Crear evento financiero
                  </label>
                  <label className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3 text-sm text-zinc-300">
                    <input
                      type="checkbox"
                      checked={evidenceForm.aplicar_evento}
                      onChange={(event) =>
                        setEvidenceForm({
                          ...evidenceForm,
                          aplicar_evento: event.target.checked,
                        })
                      }
                      className="h-4 w-4 rounded border-zinc-700 bg-zinc-900 text-cyan-500"
                    />
                    Aplicar si cumple condiciones
                  </label>
                </div>

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={isSavingEvidence}
                    className="rounded-2xl bg-cyan-600 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {isSavingEvidence ? "Guardando..." : "Guardar clasificacion"}
                  </button>
                </div>
              </form>
            )}
          </aside>
        </div>
      ) : null}

      {activeTab === "salidas" ? <MensajeriaSalienteManager /> : null}
    </div>
  );
}
