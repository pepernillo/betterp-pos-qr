"use client";

import { API_BASE_URL, buildApiUrl } from "@/lib/api";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  RentaInfoButton,
  RentaInfoModal,
  type RentaInfoContent,
} from "./RentaInfo";

const RENTA_API_BASE = buildApiUrl("/renta-espacios");
const BACKEND_MEDIA_BASE = API_BASE_URL.replace(/\/api\/?$/, "");

interface Entidad {
  id: number;
  nombre_comercial: string;
  ciudad?: string | null;
  activo: boolean;
  espacios_disponibles: number;
}

interface WebhookTraceEvent {
  provider: string;
  topic: string;
  resource: string;
  user_id: string;
  application_id: string;
  received_at: string;
  payload: Record<string, unknown>;
}

interface SyncHistoryItem {
  provider: string;
  action: string;
  at: string;
  external_id: string;
  status: string;
}

interface TraceExternalLocation {
  country?: string;
  state?: string;
  city?: string;
  neighborhood?: string;
  address?: string;
}

interface TraceExternalResponse {
  id?: string;
  title?: string;
  price?: number | null;
  currency_id?: string;
  status?: string;
  sub_status?: string[];
  tags?: string[];
  permalink?: string;
  category_id?: string;
  listing_type_id?: string;
  condition?: string;
  buying_mode?: string;
  available_quantity?: number | null;
  sold_quantity?: number | null;
  seller_custom_field?: string;
  pictures_total?: number;
  date_created?: string;
  last_updated?: string;
  start_time?: string;
  stop_time?: string;
  location?: TraceExternalLocation;
}

interface AssistedPackagePhoto {
  id?: number;
  orden?: number;
  principal?: boolean;
  url?: string;
  nombre?: string;
}

interface AssistedPackage {
  channel?: string;
  channel_label?: string;
  channel_notes?: string;
  prepared_at?: string;
  title?: string;
  summary?: string;
  description?: string;
  manual_copy?: string;
  manual_fields?: Array<{
    label?: string;
    value?: string;
  }>;
  price?: number;
  currency_id?: string;
  photos?: AssistedPackagePhoto[];
  photos_total?: number;
  amenities?: string[];
  rules?: string[];
  details?: string[];
  next_steps?: string[];
}

interface PublicationTrace {
  traffic: {
    views: number;
    leads: number;
    messages: number;
    operations: number;
    last_sync_at: string;
  };
  webhooks: {
    total: number;
    last_topic: string;
    last_at: string;
    topics: Record<string, number>;
    recent_events: WebhookTraceEvent[];
  };
  sync: {
    last_action: string;
    last_at: string;
    description_last_at: string;
    history: SyncHistoryItem[];
    last_error: Record<string, unknown>;
    status_detail: Record<string, unknown>;
    last_response: TraceExternalResponse;
  };
  assisted_package?: AssistedPackage;
}

interface SpacePublication {
  canal: string;
  label: string;
  activo: boolean;
  sincronizacion_automatica: boolean;
  publicar_cuando_disponible: boolean;
  estatus: string;
  url_publicacion: string | null;
  identificador_externo: string | null;
  mensaje_estado: string | null;
  estado_externo?: string | null;
  subestados_externos?: string[];
  tags_externos?: string[];
  detalles_externos?: string[];
  fecha_ultima_validacion?: string | null;
  fecha_ultima_sincronizacion?: string | null;
  fecha_actualizacion?: string | null;
  fecha_creacion?: string | null;
  pausa?: {
    tipo?: "OCUPACION" | "PLATAFORMA" | string;
    label?: string;
    detalle?: string;
  } | null;
  metricas?: {
    vistas: number;
    leads: number;
    mensajes: number;
    eventos_webhook: number;
    ultimo_evento: string;
    ultimo_evento_fecha: string;
  };
  trazabilidad?: PublicationTrace;
  paquete_asistido?: AssistedPackage;
  faltantes: string[];
}

interface ChannelCredentials {
  account_id?: string;
  ml_nickname?: string;
  api_key_configurada?: boolean;
  access_token_configurado?: boolean;
  refresh_token_configurado?: boolean;
  [key: string]: unknown;
}

interface ChannelConfig {
  id: number | null;
  canal: string;
  label: string;
  modo_integracion: string;
  activo: boolean;
  estatus: string;
  credenciales: ChannelCredentials;
  comision_porcentaje: number;
  ajuste_temporada_porcentaje: number;
  promocion_porcentaje: number;
  comision_monto_fijo: number;
  ajuste_temporada_monto_fijo: number;
  promocion_monto_fijo: number;
  publicar_automaticamente: boolean;
  pausar_si_ocupado: boolean;
  registrar_origen_contratacion: boolean;
  notas: string;
}

interface GlobalChannelsResponse {
  items: Array<{
    entidad: {
      id: number;
      nombre_comercial: string;
      ciudad: string | null;
    };
    channels: ChannelConfig[];
  }>;
}

interface DashboardSpace {
  id: number;
  codigo: string;
  estatus: string;
  tipo_nombre: string | null;
  titulo_publico: string;
  resumen_publico: string | null;
  renta_publicable: number;
  recamaras: number | null;
  banos: number | null;
  metros_cuadrados: number | null;
  publicar_en_renta: boolean;
  listo_para_publicar: boolean;
  faltantes: string[];
  foto_count: number;
  cover_url: string | null;
  cover_preview_url?: string | null;
  publicaciones: SpacePublication[];
}

interface DashboardResponse {
  entidad: {
    id: number;
    nombre_comercial: string;
    ciudad: string | null;
  };
  summary: {
    total_espacios: number;
    disponibles: number;
    listos_para_publicar: number;
    publicaciones_en_cola: number;
    publicaciones_listas: number;
    publicaciones_activas: number;
  };
  spaces: DashboardSpace[];
}

interface GlobalDashboardResponse {
  dashboards: DashboardResponse[];
}

interface PublicationRow {
  entidad: Entidad;
  space: DashboardSpace;
}

interface TraceSelection {
  entidad: Entidad;
  space: DashboardSpace;
  publication: SpacePublication;
}

type PublicationFilter =
  | "DISPONIBLES"
  | "LISTOS"
  | "PUBLICADOS"
  | "PAUSADOS"
  | "ERRORES"
  | "TODOS";

type PauseFilter = "TODOS" | "OCUPACION" | "PLATAFORMA";
type PublicationSortKey =
  | "reciente"
  | "espacio"
  | "ficha"
  | "precio"
  | "publicacion"
  | "trafico"
  | "pendientes";
type SortDirection = "asc" | "desc";

const PAGE_SIZE_OPTIONS = [25, 40, 60, 80, 100] as const;

const publicationInfo: Record<string, RentaInfoContent> = {
  panel: {
    eyebrow: "Publicacion",
    title: "Publicacion automatizada",
    summary:
      "Esta vista concentra los espacios que ya pueden salir a canales comerciales y el estado de sincronizacion de cada anuncio.",
    details: [
      "BettERP usa la disponibilidad real del espacio para decidir si conviene publicar, actualizar o pausar un anuncio.",
      "La publicacion no sustituye la ficha del espacio: toma los datos comerciales, fotos, precio y reglas configuradas en la pestana Espacios.",
      "Cuando un espacio se ocupa, la automatizacion ayuda a evitar dobles rentas pausando o marcando la publicacion para revision.",
    ],
  },
  automation: {
    eyebrow: "Publicacion",
    title: "Automatizacion de Mercado Libre",
    summary:
      "Controla si BettERP debe sincronizar espacios disponibles con Mercado Libre y pausar publicaciones cuando dejan de estar libres.",
    details: [
      "Requiere que la cuenta este conectada en la pestana Conexiones y que cada espacio tenga ficha comercial suficiente.",
      "Disponibles se publican o actualizan; ocupados o bloqueados se pausan para reducir errores operativos.",
      "Si Mercado Libre devuelve una observacion, la tabla muestra el mensaje para que puedas corregir fotos, ubicacion, categoria o datos faltantes.",
    ],
  },
  metrics: {
    eyebrow: "Publicacion",
    title: "Indicadores de publicacion",
    summary:
      "Estos indicadores resumen cuantas fichas estan listas, publicadas, pausadas o con errores para dar seguimiento rapido.",
    details: [
      "Espacios cuenta el inventario comercial cargado para renta de espacios.",
      "Listos significa que la ficha tiene datos suficientes para enviarse a un canal conectado.",
      "Errores muestra publicaciones con observaciones tecnicas o datos incompletos que requieren correccion.",
    ],
  },
  filters: {
    eyebrow: "Publicacion",
    title: "Filtros y busqueda",
    summary:
      "Sirven para revisar solo los espacios que requieren accion: disponibles, listos, publicados, pausados o con errores.",
    details: [
      "La busqueda acepta codigo de espacio, entidad, titulo publico o tipo de espacio.",
      "El filtro Pausados permite separar pausas por ocupacion de pausas que vienen desde la plataforma.",
      "El ordenamiento ayuda a priorizar por precio, trafico, pendientes o publicacion mas reciente.",
    ],
  },
  table: {
    eyebrow: "Publicacion",
    title: "Tabla de publicaciones",
    summary:
      "La tabla muestra cada espacio con su ficha, estado en canal, trafico, pendientes y acciones de sincronizacion.",
    details: [
      "La columna Ficha resume titulo, fotos, precio y caracteristicas visibles para el canal.",
      "La columna Publicacion muestra estado, observaciones y enlace externo cuando existe.",
      "Acciones permite sincronizar un espacio puntual o revisar trazabilidad sin salir del modulo.",
    ],
  },
};

const moneyFormatter = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 0,
});

const numberFormatter = new Intl.NumberFormat("es-MX");

function formatMoney(value: number) {
  return moneyFormatter.format(value || 0);
}

function formatCount(value: number | null | undefined) {
  return numberFormatter.format(Number(value || 0));
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "Sin registro";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function resolvePhotoUrl(url: string | null | undefined) {
  const cleanUrl = (url || "").trim();
  if (!cleanUrl) {
    return null;
  }
  if (
    cleanUrl.startsWith("http://") ||
    cleanUrl.startsWith("https://") ||
    cleanUrl.startsWith("data:") ||
    cleanUrl.startsWith("blob:")
  ) {
    return cleanUrl;
  }
  if (cleanUrl.startsWith("//")) {
    return `https:${cleanUrl}`;
  }
  if (cleanUrl.startsWith("/")) {
    return `${BACKEND_MEDIA_BASE}${cleanUrl}`;
  }
  return `${BACKEND_MEDIA_BASE}/${cleanUrl}`;
}

function PhotoPreviewImage({
  src,
  alt,
  className,
}: {
  src: string | null | undefined;
  alt: string;
  className: string;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const resolvedUrl = resolvePhotoUrl(src);
    setPreviewUrl(null);
    setFailed(false);

    if (!resolvedUrl) {
      return;
    }
    if (!resolvedUrl.startsWith(API_BASE_URL)) {
      setPreviewUrl(resolvedUrl);
      return;
    }

    const controller = new AbortController();
    let objectUrl: string | null = null;

    fetch(resolvedUrl, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`No se pudo cargar la foto (${response.status}).`);
        }
        return response.blob();
      })
      .then((blob) => {
        if (controller.signal.aborted) {
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        setPreviewUrl(objectUrl);
      })
      .catch((error) => {
        if (controller.signal.aborted) {
          return;
        }
        console.error("Error cargando miniatura de publicacion:", error);
        setFailed(true);
      });

    return () => {
      controller.abort();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [src]);

  if (!previewUrl || failed) {
    return (
      <div className="flex h-full w-full items-center justify-center text-[10px] text-zinc-600">
        {failed ? "Sin vista" : "Sin foto"}
      </div>
    );
  }

  return <img src={previewUrl} alt={alt} className={className} />;
}

function extractErrorMessage(body: unknown, fallback: string) {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail?: unknown }).detail;
    if (typeof detail === "string" && detail.trim()) {
      return detail;
    }
    if (Array.isArray(detail)) {
      const messages = detail
        .map((item) => {
          if (typeof item === "string") {
            return item;
          }
          if (item && typeof item === "object" && "msg" in item) {
            return String((item as { msg?: unknown }).msg || "");
          }
          return "";
        })
        .filter(Boolean);
      if (messages.length > 0) {
        return messages.join(" ");
      }
    }
  }
  return fallback;
}

function isMercadoLibreSellerBlocked(message: string) {
  return message.includes("seller.unable_to_list");
}

function isConnectedChannel(channel: ChannelConfig | undefined) {
  if (!channel) {
    return false;
  }
  return (
    channel.estatus === "CONECTADO" ||
    channel.activo ||
    Boolean(channel.credenciales.account_id) ||
    Boolean(channel.credenciales.access_token_configurado) ||
    Boolean(channel.credenciales.api_key_configurada)
  );
}

function channelPayload(
  channel: ChannelConfig,
  overrides: Partial<ChannelConfig>
) {
  return {
    canal: channel.canal,
    activo: overrides.activo ?? channel.activo,
    modo_integracion: overrides.modo_integracion ?? channel.modo_integracion,
    credenciales: channel.credenciales,
    comision_porcentaje:
      overrides.comision_porcentaje ?? channel.comision_porcentaje,
    ajuste_temporada_porcentaje:
      overrides.ajuste_temporada_porcentaje ??
      channel.ajuste_temporada_porcentaje,
    promocion_porcentaje:
      overrides.promocion_porcentaje ?? channel.promocion_porcentaje,
    comision_monto_fijo:
      overrides.comision_monto_fijo ?? channel.comision_monto_fijo,
    ajuste_temporada_monto_fijo:
      overrides.ajuste_temporada_monto_fijo ??
      channel.ajuste_temporada_monto_fijo,
    promocion_monto_fijo:
      overrides.promocion_monto_fijo ?? channel.promocion_monto_fijo,
    publicar_automaticamente:
      overrides.publicar_automaticamente ?? channel.publicar_automaticamente,
    pausar_si_ocupado: overrides.pausar_si_ocupado ?? channel.pausar_si_ocupado,
    registrar_origen_contratacion:
      overrides.registrar_origen_contratacion ??
      channel.registrar_origen_contratacion,
    notas: overrides.notas ?? channel.notas,
  };
}

function sumResultValue(results: Array<Record<string, unknown>>, key: string) {
  return results.reduce((total, item) => total + Number(item[key] || 0), 0);
}

function statusStyles(status: string) {
  if (status === "PUBLICADA") {
    return "border-emerald-500/20 bg-emerald-500/10 text-emerald-300";
  }
  if (status === "LISTA") {
    return "border-cyan-500/20 bg-cyan-500/10 text-cyan-300";
  }
  if (status === "EN_COLA") {
    return "border-blue-500/20 bg-blue-500/10 text-blue-300";
  }
  if (status === "PAUSADA") {
    return "border-amber-500/20 bg-amber-500/10 text-amber-300";
  }
  if (status === "ERROR") {
    return "border-red-500/20 bg-red-500/10 text-red-300";
  }
  return "border-zinc-700 bg-zinc-900 text-zinc-400";
}

function compactExternalTrace(publication: SpacePublication) {
  const prefix = platformShortLabel(publication);
  return [
    publication.estado_externo ? `${prefix} ${publication.estado_externo}` : null,
    ...(publication.subestados_externos || []).map((item) => `Sub ${item}`),
    ...(publication.tags_externos || []).map((item) => `Tag ${item}`),
  ].filter(Boolean).slice(0, 4) as string[];
}

function platformShortLabel(publication: SpacePublication) {
  const label = publication.label || publication.canal;
  if (publication.canal === "MERCADO_LIBRE") {
    return "ML";
  }
  if (label.length <= 12) {
    return label;
  }
  return label
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 4)
    .toUpperCase();
}

function traceTopics(topics: Record<string, number> | undefined) {
  return Object.entries(topics || {})
    .filter(([, count]) => Number(count || 0) > 0)
    .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0));
}

function isEmptyRecord(value: Record<string, unknown> | undefined) {
  return !value || Object.keys(value).length === 0;
}

function humanizeSyncAction(action: string | undefined) {
  const normalized = (action || "").toLowerCase();
  const labels: Record<string, string> = {
    create: "Creacion enviada",
    update: "Actualizacion enviada",
    pause: "Pausa enviada",
    "webhook-refresh": "Actualizacion por aviso",
    description: "Descripcion actualizada",
    "prepare-assisted": "Ficha asistida preparada",
    "manual-status": "Estado manual actualizado",
  };
  return labels[normalized] || action || "Sin accion";
}

function humanizeExternalStatus(status: string | undefined) {
  const normalized = (status || "").toLowerCase();
  const labels: Record<string, string> = {
    active: "Activa",
    paused: "Pausada",
    closed: "Cerrada",
    under_review: "En revision",
    inactive: "Inactiva",
  };
  return labels[normalized] || status || "Sin estado";
}

function humanizeExternalTag(tag: string) {
  const labels: Record<string, string> = {
    test_item: "Publicacion de prueba",
    picture_download_pending: "Fotos pendientes de procesar",
    good_quality_picture: "Fotos aceptadas",
    immediate_payment: "Pago inmediato",
  };
  return labels[tag] || tag.replace(/_/g, " ");
}

function humanizeWebhookTopic(topic: string | undefined) {
  const normalized = (topic || "").toLowerCase();
  if (normalized.includes("question")) return "Pregunta recibida";
  if (normalized.includes("message")) return "Mensaje recibido";
  if (normalized.includes("order")) return "Operacion detectada";
  if (normalized.includes("item")) return "Cambio en publicacion";
  if (normalized.includes("lead")) return "Lead recibido";
  return topic || "Aviso recibido";
}

function friendlyPublicationMessage(
  message: string | null | undefined,
  status: string,
  tags: string[],
  subStatuses: string[]
) {
  const normalized = (message || "").toLowerCase();
  if (normalized.includes("seller.unable_to_list")) {
    return "La cuenta conectada no tiene habilitada la publicacion de inmuebles. Revisa el perfil, paquete disponible o permisos del vendedor.";
  }
  if (normalized.includes("location") || normalized.includes("ubicacion")) {
    return "Falta completar la ubicacion requerida por Mercado Libre antes de publicar.";
  }
  if (
    normalized.includes("total_area") ||
    normalized.includes("covered_area") ||
    normalized.includes("bathroom") ||
    normalized.includes("attributes")
  ) {
    return "Faltan caracteristicas obligatorias del inmueble para que Mercado Libre acepte el anuncio.";
  }
  if (
    tags.includes("picture_download_pending") ||
    subStatuses.includes("picture_download_pending")
  ) {
    return "Mercado Libre esta procesando las fotos. El anuncio puede tardar unos minutos en mostrarlas.";
  }
  if (status === "paused") {
    return "El anuncio esta pausado en Mercado Libre. Revisa si requiere activacion desde el portal o validacion del vendedor.";
  }
  if (status === "active") {
    return "Anuncio sincronizado con Mercado Libre.";
  }
  if (!message) {
    return "";
  }
  if (
    normalized.includes("validation_error") ||
    normalized.includes("field") ||
    normalized.includes("attribute") ||
    normalized.includes("codigo ml") ||
    message.includes("{") ||
    message.includes("}")
  ) {
    return "Mercado Libre devolvio una observacion tecnica. Revisa las alertas y los datos de la ficha para corregirla.";
  }
  return message;
}

function getExternalSubStatuses(publication: SpacePublication, trace?: PublicationTrace) {
  return [
    ...(trace?.sync.last_response?.sub_status || []),
    ...(publication.subestados_externos || []),
  ].filter(
    (item, index, values): item is string =>
      Boolean(item) && values.indexOf(item) === index
  );
}

function getExternalTags(publication: SpacePublication, trace?: PublicationTrace) {
  return [
    ...(trace?.sync.last_response?.tags || []),
    ...(publication.tags_externos || []),
  ].filter(
    (item, index, values): item is string =>
      Boolean(item) && values.indexOf(item) === index
  );
}

type TraceAlertTone = "success" | "info" | "warning" | "danger";

interface TraceAlert {
  tone: TraceAlertTone;
  title: string;
  body: string;
}

const traceAlertStyles: Record<TraceAlertTone, string> = {
  success: "border-emerald-500/20 bg-emerald-500/10 text-emerald-100",
  info: "border-cyan-500/20 bg-cyan-500/10 text-cyan-100",
  warning: "border-amber-500/20 bg-amber-500/10 text-amber-100",
  danger: "border-red-500/20 bg-red-500/10 text-red-100",
};

function buildTraceAlerts(
  publication: SpacePublication,
  trace: PublicationTrace | undefined
) {
  const alerts: TraceAlert[] = [];
  const external = trace?.sync.last_response;
  const platformName = publication.label || "la plataforma";
  const isMercadoLibre = publication.canal === "MERCADO_LIBRE";
  const status = (external?.status || publication.estado_externo || "").toLowerCase();
  const tags = getExternalTags(publication, trace);
  const subStatuses = getExternalSubStatuses(publication, trace);
  const hasLastError = !isEmptyRecord(trace?.sync.last_error);
  const friendlyMessage = friendlyPublicationMessage(
    publication.mensaje_estado,
    status,
    tags,
    subStatuses
  );

  if (publication.estatus === "ERROR") {
    alerts.push({
      tone: "danger",
      title: "Publicacion con error",
      body:
        friendlyMessage ||
        "La plataforma rechazo el ultimo intento. Revisa la ficha, la cuenta o los permisos del canal.",
    });
  }

  if (status === "paused" || publication.estatus === "PAUSADA") {
    const pauseInfo = publication.pausa;
    alerts.push({
      tone: pauseInfo?.tipo === "OCUPACION" ? "info" : "warning",
      title: pauseInfo?.label || "Anuncio pausado",
      body:
        pauseInfo?.detalle ||
        (isMercadoLibre
          ? "Mercado Libre dejo la publicacion en pausa. Puede requerir validacion, paquete disponible o activacion desde el portal."
          : `${platformName} esta marcado como pausado. Revisa si debe reactivarse o conservarse fuera de publicacion.`),
    });
  }

  if (tags.includes("picture_download_pending") || subStatuses.includes("picture_download_pending")) {
    alerts.push({
      tone: "warning",
      title: "Fotos en proceso",
      body:
        "Mercado Libre aun esta procesando las imagenes. El anuncio puede verse sin fotos por unos minutos.",
    });
  }

  if (!publication.url_publicacion) {
    alerts.push({
      tone: "info",
      title: "Sin enlace publico",
      body: "Todavia no tenemos un enlace publico de la publicacion para abrirla desde BettERP.",
    });
  }

  if ((trace?.webhooks.total || 0) === 0) {
    alerts.push({
      tone: "info",
      title: "Sin avisos de plataforma",
      body:
        "Aun no recibimos avisos de esta publicacion. Cuando la plataforma envie preguntas, mensajes o cambios, apareceran aqui.",
    });
  }

  if (!trace?.traffic.last_sync_at) {
    alerts.push({
      tone: "info",
      title: "Metricas pendientes",
      body:
        "Las vistas, preguntas y mensajes se actualizan cuando el canal conectado envie o confirme actividad.",
    });
  }

  if (hasLastError && publication.estatus !== "ERROR") {
    alerts.push({
      tone: "success",
      title: "Incidencia anterior resuelta",
      body:
        "El ultimo intento registrado ya no requiere accion inmediata. Se conserva el historial interno para soporte.",
    });
  }

  return alerts;
}

function getTracePublications(space: DashboardSpace) {
  return space.publicaciones.filter(
    (publication) =>
      publication.activo ||
      Boolean(publication.identificador_externo) ||
      publication.estatus !== "BORRADOR"
  );
}

function spaceStatusStyles(status: string) {
  if (status === "DISPONIBLE") {
    return "border-emerald-500/20 bg-emerald-500/10 text-emerald-300";
  }
  if (status === "OCUPADO") {
    return "border-amber-500/20 bg-amber-500/10 text-amber-300";
  }
  if (status === "RESERVADO") {
    return "border-blue-500/20 bg-blue-500/10 text-blue-300";
  }
  return "border-zinc-700 bg-zinc-900 text-zinc-300";
}

function getMainPublication(space: DashboardSpace) {
  return (
    space.publicaciones.find(
      (publication) =>
        publication.canal === "MERCADO_LIBRE" &&
        (publication.activo || publication.estatus !== "BORRADOR")
    ) ||
    space.publicaciones.find((publication) => publication.activo) ||
    space.publicaciones.find((publication) => publication.estatus !== "BORRADOR") ||
    space.publicaciones[0] ||
    null
  );
}

function getActivePublications(space: DashboardSpace) {
  return space.publicaciones.filter(
    (publication) => publication.activo || publication.estatus !== "BORRADOR"
  );
}

function isPublished(space: DashboardSpace) {
  return space.publicaciones.some(
    (publication) => publication.estatus === "PUBLICADA"
  );
}

function hasErrors(space: DashboardSpace) {
  return space.publicaciones.some((publication) => publication.estatus === "ERROR");
}

function getPausedPublications(space: DashboardSpace) {
  return space.publicaciones.filter(
    (publication) => publication.estatus === "PAUSADA"
  );
}

function isPaused(space: DashboardSpace) {
  return getPausedPublications(space).length > 0;
}

function publicationPauseType(publication: SpacePublication) {
  return publication.pausa?.tipo === "OCUPACION" ? "OCUPACION" : "PLATAFORMA";
}

function matchesPauseFilter(space: DashboardSpace, pauseFilter: PauseFilter) {
  const pausedPublications = getPausedPublications(space);
  if (pausedPublications.length === 0) return false;
  if (pauseFilter === "TODOS") return true;
  return pausedPublications.some(
    (publication) => publicationPauseType(publication) === pauseFilter
  );
}

function timestampFrom(value?: string | null) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function publicationActivityTimestamp(publication: SpacePublication) {
  return Math.max(
    timestampFrom(publication.fecha_ultima_sincronizacion),
    timestampFrom(publication.fecha_ultima_validacion),
    timestampFrom(publication.fecha_actualizacion),
    timestampFrom(publication.metricas?.ultimo_evento_fecha),
    timestampFrom(publication.fecha_creacion)
  );
}

function spaceActivityFallback(space: DashboardSpace) {
  return Number(space.id || 0);
}

function hasExternalPublication(publication: SpacePublication) {
  return Boolean(publication.identificador_externo || publication.url_publicacion);
}

function getPausedSortProfile(space: DashboardSpace) {
  const pausedPublications = getPausedPublications(space);
  return {
    hasExternal: pausedPublications.some(hasExternalPublication),
    hasOccupationPause: pausedPublications.some(
      (publication) => publicationPauseType(publication) === "OCUPACION"
    ),
    activity: Math.max(
      spaceActivityFallback(space),
      ...pausedPublications.map(publicationActivityTimestamp)
    ),
  };
}

function getRowActivity(row: PublicationRow) {
  return Math.max(
    spaceActivityFallback(row.space),
    ...row.space.publicaciones.map(publicationActivityTimestamp)
  );
}

function getRowTitle(row: PublicationRow) {
  return `${row.space.titulo_publico || ""} ${row.space.resumen_publico || ""}`.trim();
}

function getRowPublicationLabel(row: PublicationRow) {
  const mainPublication = getMainPublication(row.space);
  return `${mainPublication?.label || ""} ${mainPublication?.estatus || ""} ${
    mainPublication?.identificador_externo || ""
  }`.trim();
}

function getRowTraffic(row: PublicationRow) {
  return getActivePublications(row.space).reduce(
    (sum, publication) =>
      sum +
      Number(publication.metricas?.vistas || 0) +
      Number(publication.metricas?.leads || 0) +
      Number(publication.metricas?.mensajes || 0) +
      Number(publication.metricas?.eventos_webhook || 0),
    0
  );
}

function getRowMissingCount(row: PublicationRow) {
  const mainPublication = getMainPublication(row.space);
  return new Set([...row.space.faltantes, ...(mainPublication?.faltantes || [])])
    .size;
}

function compareStrings(a: string, b: string, direction: SortDirection) {
  const value = a.localeCompare(b);
  return direction === "asc" ? value : -value;
}

function compareNumbers(a: number, b: number, direction: SortDirection) {
  const value = a - b;
  return direction === "asc" ? value : -value;
}

function sortRows(a: PublicationRow, b: PublicationRow) {
  const availableDiff =
    Number(b.space.estatus === "DISPONIBLE") -
    Number(a.space.estatus === "DISPONIBLE");
  if (availableDiff !== 0) return availableDiff;

  const readyDiff =
    Number(b.space.listo_para_publicar) - Number(a.space.listo_para_publicar);
  if (readyDiff !== 0) return readyDiff;

  const publishedDiff = Number(isPublished(b.space)) - Number(isPublished(a.space));
  if (publishedDiff !== 0) return publishedDiff;

  const entityDiff = a.entidad.nombre_comercial.localeCompare(
    b.entidad.nombre_comercial
  );
  if (entityDiff !== 0) return entityDiff;

  return a.space.codigo.localeCompare(b.space.codigo);
}

function sortRowsForFilter(
  filter: PublicationFilter,
  sortKey: PublicationSortKey,
  direction: SortDirection
) {
  return (a: PublicationRow, b: PublicationRow) => {
    if (filter === "PAUSADOS") {
      const aProfile = getPausedSortProfile(a.space);
      const bProfile = getPausedSortProfile(b.space);

      const externalDiff =
        Number(bProfile.hasExternal) - Number(aProfile.hasExternal);
      if (externalDiff !== 0) return externalDiff;

      const occupationDiff =
        Number(bProfile.hasOccupationPause) - Number(aProfile.hasOccupationPause);
      if (occupationDiff !== 0) return occupationDiff;

      if (sortKey === "reciente") {
        const activityDiff = compareNumbers(
          aProfile.activity,
          bProfile.activity,
          direction
        );
        if (activityDiff !== 0) return activityDiff;
      }
    }

    let result = 0;
    switch (sortKey) {
      case "reciente":
        result = compareNumbers(getRowActivity(a), getRowActivity(b), direction);
        break;
      case "espacio":
        result = compareStrings(
          `${a.entidad.nombre_comercial} ${a.space.codigo}`,
          `${b.entidad.nombre_comercial} ${b.space.codigo}`,
          direction
        );
        break;
      case "ficha":
        result = compareStrings(getRowTitle(a), getRowTitle(b), direction);
        break;
      case "precio":
        result = compareNumbers(
          a.space.renta_publicable || 0,
          b.space.renta_publicable || 0,
          direction
        );
        break;
      case "publicacion":
        result = compareStrings(
          getRowPublicationLabel(a),
          getRowPublicationLabel(b),
          direction
        );
        break;
      case "trafico":
        result = compareNumbers(getRowTraffic(a), getRowTraffic(b), direction);
        break;
      case "pendientes":
        result = compareNumbers(
          getRowMissingCount(a),
          getRowMissingCount(b),
          direction
        );
        break;
    }
    if (result !== 0) return result;
    return sortRows(a, b);
  };
}

function PublicationTraceModal({
  selection,
  onClose,
  onManualStatusUpdated,
}: {
  selection: TraceSelection;
  onClose: () => void;
  onManualStatusUpdated: (updatedSpace?: DashboardSpace) => Promise<void> | void;
}) {
  const { entidad, space, publication } = selection;
  const trace = publication.trazabilidad;
  const traffic = trace?.traffic;
  const webhooks = trace?.webhooks;
  const sync = trace?.sync;
  const assistedPackage = publication.paquete_asistido || trace?.assisted_package || null;
  const isMercadoLibre = publication.canal === "MERCADO_LIBRE";
  const canUpdateManualStatus = Boolean(assistedPackage && !isMercadoLibre);
  const assistedPrice = assistedPackage?.price;
  const [manualUrl, setManualUrl] = useState(publication.url_publicacion || "");
  const [manualExternalId, setManualExternalId] = useState(
    publication.identificador_externo || ""
  );
  const [manualSaving, setManualSaving] = useState("");
  const [manualError, setManualError] = useState("");
  const [manualNotice, setManualNotice] = useState("");
  useEffect(() => {
    setManualUrl(publication.url_publicacion || "");
    setManualExternalId(publication.identificador_externo || "");
    setManualError("");
    setManualNotice("");
  }, [
    publication.canal,
    publication.identificador_externo,
    publication.url_publicacion,
  ]);
  const topics = traceTopics(webhooks?.topics);
  const external = sync?.last_response || {};
  const alerts = buildTraceAlerts(publication, trace);
  const actionableAlerts = alerts.filter((alert) => alert.tone !== "success").length;
  const subStatuses = getExternalSubStatuses(publication, trace);
  const tags = getExternalTags(publication, trace);
  const friendlyStatusMessage = friendlyPublicationMessage(
    publication.mensaje_estado,
    (external.status || publication.estado_externo || "").toLowerCase(),
    tags,
    subStatuses
  );
  const locationSummary = [
    external.location?.neighborhood,
    external.location?.city,
    external.location?.state,
    external.location?.country,
  ]
    .filter(Boolean)
    .join(", ");
  const detailRows = [
    { label: "ID externo", value: external.id || publication.identificador_externo },
    { label: "Titulo", value: external.title || assistedPackage?.title },
    { label: "Estado externo", value: humanizeExternalStatus(external.status || publication.estado_externo || "") },
    { label: "Plan de publicacion", value: external.listing_type_id },
    {
      label: "Precio",
      value:
        typeof external.price === "number"
          ? `${formatMoney(external.price)} ${external.currency_id || ""}`.trim()
          : typeof assistedPrice === "number"
          ? `${formatMoney(assistedPrice)} ${assistedPackage?.currency_id || "MXN"}`.trim()
          : "",
    },
    { label: "Fotos recibidas", value: external.pictures_total ? formatCount(external.pictures_total) : "" },
    { label: "Ubicacion", value: locationSummary },
    { label: "Direccion", value: external.location?.address },
    { label: "Cantidad disponible", value: typeof external.available_quantity === "number" ? formatCount(external.available_quantity) : "" },
    { label: "Operaciones", value: typeof external.sold_quantity === "number" ? formatCount(external.sold_quantity) : "" },
    { label: isMercadoLibre ? "Creado en ML" : "Creado", value: formatDateTime(external.date_created) },
    { label: isMercadoLibre ? "Actualizado en ML" : "Actualizado", value: formatDateTime(external.last_updated) },
  ].filter((row) => row.value && row.value !== "Sin registro");
  const metricCards = [
    {
      label: "Vistas",
      value: traffic?.views || 0,
      note: isMercadoLibre ? "consultadas en ML" : "registradas en BettERP",
      className: "border-cyan-500/20 bg-cyan-500/10 text-cyan-200",
    },
    {
      label: "Preguntas",
      value: traffic?.leads || 0,
      note: isMercadoLibre ? "consultadas en ML" : "registradas en BettERP",
      className: "border-emerald-500/20 bg-emerald-500/10 text-emerald-200",
    },
    {
      label: "Mensajes",
      value: traffic?.messages || 0,
      note: "avisos recibidos",
      className: "border-teal-500/20 bg-teal-500/10 text-teal-200",
    },
    {
      label: "Operaciones",
      value: traffic?.operations || 0,
      note: "eventos detectados",
      className: "border-blue-500/20 bg-blue-500/10 text-blue-200",
    },
    {
      label: "Webhooks",
      value: webhooks?.total || 0,
      note: "avisos recibidos",
      className: "border-amber-500/20 bg-amber-500/10 text-amber-200",
    },
  ];

  const markManualStatus = async (status: "PUBLICADA" | "PAUSADA") => {
    setManualSaving(status);
    setManualError("");
    setManualNotice("");
    try {
      const response = await fetch(
        `${RENTA_API_BASE}/espacios/${space.id}/publicaciones/${publication.canal}/manual/estado/`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            estatus: status,
            url_publicacion: manualUrl,
            identificador_externo: manualExternalId,
            mensaje_estado:
              status === "PUBLICADA"
                ? "Publicacion manual marcada como publicada."
                : "Publicacion manual marcada como pausada.",
          }),
        }
      );
      const body = (await response.json().catch(() => ({}))) as {
        detail?: string;
        mensaje?: string;
        space?: DashboardSpace;
      };
      if (!response.ok) {
        throw new Error(
          extractErrorMessage(body, "No se pudo actualizar el estado manual.")
        );
      }
      setManualNotice(body.mensaje || "Estado manual actualizado.");
      await Promise.resolve(onManualStatusUpdated(body.space));
    } catch (error) {
      console.error("Error actualizando estado manual de publicacion:", error);
      setManualError(
        error instanceof Error
          ? error.message
          : "No se pudo actualizar el estado manual."
      );
    } finally {
      setManualSaving("");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-5">
      <div className="max-h-[92vh] w-full overflow-hidden rounded-t-3xl border border-zinc-800 bg-zinc-950 shadow-2xl sm:max-w-5xl sm:rounded-3xl">
        <div className="flex flex-col gap-4 border-b border-zinc-800 p-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-cyan-300">
              Trazabilidad de plataforma
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <h3 className="text-2xl font-semibold text-white">
                {publication.label}
              </h3>
              <span
                className={`rounded-full border px-2.5 py-1 text-xs font-medium ${statusStyles(
                  publication.estatus
                )}`}
              >
                {publication.estatus}
              </span>
            </div>
            <p className="mt-2 text-sm text-zinc-400">
              {entidad.nombre_comercial} - {space.codigo}
              {publication.identificador_externo
                ? ` | ID externo ${publication.identificador_externo}`
                : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {publication.url_publicacion ? (
              <a
                href={publication.url_publicacion}
                target="_blank"
                rel="noreferrer"
                className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20"
              >
                Ver anuncio
              </a>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-2 text-sm text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
            >
              Cerrar
            </button>
          </div>
        </div>

        <div className="max-h-[calc(92vh-118px)] overflow-y-auto p-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {metricCards.map((card) => (
              <div key={card.label} className={`rounded-2xl border p-4 ${card.className}`}>
                <p className="text-xs uppercase tracking-[0.18em] opacity-70">
                  {card.label}
                </p>
                <p className="mt-2 text-2xl font-semibold">{formatCount(card.value)}</p>
                <p className="mt-1 text-xs opacity-65">{card.note}</p>
              </div>
            ))}
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1.15fr]">
            <div className="space-y-4">
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
                    Alertas y atencion
                  </p>
                  <span className="rounded-full border border-zinc-800 bg-zinc-950 px-3 py-1 text-xs text-zinc-400">
                    {actionableAlerts > 0 ? `${actionableAlerts} por revisar` : "Sin pendientes"}
                  </span>
                </div>
                <div className="mt-3 space-y-2">
                  {alerts.length > 0 ? (
                    alerts.map((alert, index) => (
                      <div
                        key={`${alert.title}-${index}`}
                        className={`rounded-xl border p-3 ${traceAlertStyles[alert.tone]}`}
                      >
                        <p className="text-sm font-semibold">{alert.title}</p>
                        <p className="mt-1 text-sm leading-relaxed opacity-80">
                          {alert.body}
                        </p>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-100">
                      La publicacion no tiene alertas pendientes.
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
                  Estado y sincronizacion
                </p>
                <div className="mt-4 space-y-3 text-sm">
                  <div className="flex justify-between gap-4">
                    <span className="text-zinc-500">Ultima accion</span>
                    <span className="text-right font-medium text-white">
                      {humanizeSyncAction(sync?.last_action)}
                    </span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-zinc-500">Sync plataforma</span>
                    <span className="text-right text-zinc-300">
                      {formatDateTime(sync?.last_at)}
                    </span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-zinc-500">Descripcion</span>
                    <span className="text-right text-zinc-300">
                      {formatDateTime(sync?.description_last_at)}
                    </span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-zinc-500">Metricas</span>
                    <span className="text-right text-zinc-300">
                      {formatDateTime(traffic?.last_sync_at)}
                    </span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-zinc-500">Ultimo webhook</span>
                    <span className="text-right text-zinc-300">
                      {formatDateTime(webhooks?.last_at)}
                    </span>
                  </div>
                </div>
                {friendlyStatusMessage ? (
                  <p className="mt-4 rounded-xl border border-zinc-800 bg-zinc-950/80 p-3 text-sm leading-relaxed text-zinc-300">
                    {friendlyStatusMessage}
                  </p>
                ) : null}
              </div>

              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
                  Avisos por tipo
                </p>
                {topics.length === 0 ? (
                  <p className="mt-3 text-sm text-zinc-500">
                    Aun no hay eventos recibidos para esta publicacion.
                  </p>
                ) : (
                  <div className="mt-3 space-y-2">
                    {topics.map(([topic, count]) => (
                      <div
                        key={topic}
                        className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-950/70 px-3 py-2 text-sm"
                      >
                        <span className="truncate text-zinc-300">
                          {humanizeWebhookTopic(topic)}
                        </span>
                        <span className="font-medium text-cyan-200">
                          {count}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-4">
              {assistedPackage ? (
                <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.18em] text-emerald-200/75">
                        Paquete asistido
                      </p>
                      <h4 className="mt-2 text-lg font-semibold text-white">
                        {assistedPackage.title || space.titulo_publico}
                      </h4>
                      <p className="mt-1 text-sm text-emerald-100/75">
                        {assistedPackage.channel_label || publication.label}
                        {assistedPackage.prepared_at
                          ? ` | ${formatDateTime(assistedPackage.prepared_at)}`
                          : ""}
                      </p>
                    </div>
                    <div className="rounded-xl border border-emerald-500/20 bg-zinc-950/70 px-3 py-2 text-right">
                      <p className="text-xs uppercase tracking-[0.16em] text-emerald-200/70">
                        Renta
                      </p>
                      <p className="text-base font-semibold text-white">
                        {formatMoney(Number(assistedPackage.price || 0))}
                      </p>
                    </div>
                  </div>
                  {assistedPackage.summary ? (
                    <p className="mt-3 rounded-xl border border-emerald-500/20 bg-zinc-950/60 p-3 text-sm leading-relaxed text-emerald-50/85">
                      {assistedPackage.summary}
                    </p>
                  ) : null}
                  {assistedPackage.channel_notes ? (
                    <p className="mt-3 rounded-xl border border-cyan-500/20 bg-cyan-500/10 p-3 text-sm leading-relaxed text-cyan-100/80">
                      {assistedPackage.channel_notes}
                    </p>
                  ) : null}
                  {assistedPackage.manual_fields?.length ? (
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {assistedPackage.manual_fields.map((field, index) => (
                        <div
                          key={`${field.label || "campo"}-${index}`}
                          className="rounded-xl border border-zinc-800 bg-zinc-950/65 p-3"
                        >
                          <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">
                            {field.label || "Campo"}
                          </p>
                          <p className="mt-1 text-sm leading-relaxed text-zinc-100">
                            {field.value || "Sin registro"}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {assistedPackage.manual_copy ? (
                    <textarea
                      readOnly
                      value={assistedPackage.manual_copy}
                      className="mt-3 h-40 w-full resize-none rounded-xl border border-zinc-800 bg-zinc-950/80 p-3 text-sm leading-relaxed text-zinc-200 outline-none"
                    />
                  ) : null}
                  {assistedPackage.photos?.length ? (
                    <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-6">
                      {assistedPackage.photos.slice(0, 8).map((photo, index) => (
                        <div
                          key={`${photo.id || photo.url || index}`}
                          className="relative aspect-square overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950"
                        >
                          <PhotoPreviewImage
                            src={photo.url}
                            alt={`${assistedPackage.title || publication.label} ${index + 1}`}
                            className="h-full w-full object-cover"
                          />
                          {photo.principal || index === 0 ? (
                            <span className="absolute left-1 top-1 rounded-full bg-cyan-400 px-2 py-0.5 text-[10px] font-semibold text-black">
                              Principal
                            </span>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div className="mt-3 grid gap-2 text-xs text-emerald-100/75 sm:grid-cols-2">
                    <p>Fotos listas: {formatCount(assistedPackage.photos_total || 0)}</p>
                    <p>Amenidades: {(assistedPackage.amenities || []).join(", ") || "Sin registro"}</p>
                    <p>Reglas: {(assistedPackage.rules || []).join(", ") || "Sin registro"}</p>
                    <p>Detalles: {(assistedPackage.details || []).join(", ") || "Sin registro"}</p>
                  </div>
                  {assistedPackage.next_steps?.length ? (
                    <div className="mt-3 rounded-xl border border-emerald-500/20 bg-zinc-950/50 p-3">
                      <p className="text-xs uppercase tracking-[0.16em] text-emerald-200/70">
                        Siguientes pasos
                      </p>
                      <ul className="mt-2 space-y-1 text-sm text-emerald-50/80">
                        {assistedPackage.next_steps.map((step) => (
                          <li key={step}>- {step}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {canUpdateManualStatus ? (
                <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-cyan-200/75">
                    Estado manual del canal
                  </p>
                  <p className="mt-2 text-sm leading-relaxed text-cyan-100/75">
                    Cuando publiques o pauses este espacio en la plataforma,
                    registra aqui el enlace y el estado para mantener la
                    trazabilidad del canal.
                  </p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="space-y-1.5 text-sm text-cyan-100">
                      URL del anuncio
                      <input
                        value={manualUrl}
                        onChange={(event) => setManualUrl(event.target.value)}
                        placeholder="https://..."
                        className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                      />
                    </label>
                    <label className="space-y-1.5 text-sm text-cyan-100">
                      ID externo
                      <input
                        value={manualExternalId}
                        onChange={(event) =>
                          setManualExternalId(event.target.value)
                        }
                        placeholder="ID o folio de la plataforma"
                        className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                      />
                    </label>
                  </div>
                  {manualError ? (
                    <p className="mt-3 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                      {manualError}
                    </p>
                  ) : null}
                  {manualNotice ? (
                    <p className="mt-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
                      {manualNotice}
                    </p>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void markManualStatus("PUBLICADA")}
                      disabled={Boolean(manualSaving)}
                      className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-200 transition-colors hover:bg-emerald-500/20 disabled:opacity-50"
                    >
                      {manualSaving === "PUBLICADA"
                        ? "Guardando..."
                        : "Marcar publicada"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void markManualStatus("PAUSADA")}
                      disabled={Boolean(manualSaving)}
                      className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-2 text-sm font-medium text-amber-200 transition-colors hover:bg-amber-500/20 disabled:opacity-50"
                    >
                      {manualSaving === "PAUSADA"
                        ? "Guardando..."
                        : "Marcar pausada"}
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
                  Detalles de plataforma
                </p>
                {detailRows.length > 0 ? (
                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    {detailRows.map((row) => (
                      <div
                        key={row.label}
                        className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3"
                      >
                        <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">
                          {row.label}
                        </p>
                        <p className="mt-1 text-sm font-medium text-zinc-200">
                          {row.value}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-zinc-500">
                    Aun no hay detalle devuelto por la plataforma para este
                    anuncio.
                  </p>
                )}
                {tags.length || subStatuses.length ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {[...tags, ...subStatuses].map((item) => (
                      <span
                        key={item}
                        className="rounded-full border border-zinc-700 bg-zinc-950 px-3 py-1 text-xs text-zinc-300"
                      >
                        {humanizeExternalTag(item)}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
                  Webhooks recientes
                </p>
                {webhooks?.recent_events?.length ? (
                  <div className="mt-3 space-y-3">
                    {webhooks.recent_events.map((event, index) => (
                      <div
                        key={`${event.received_at}-${event.topic}-${index}`}
                        className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-medium text-white">
                            {humanizeWebhookTopic(event.topic)}
                          </p>
                          <span className="text-xs text-zinc-500">
                            {formatDateTime(event.received_at)}
                          </span>
                        </div>
                        <div className="mt-2 grid gap-2 text-xs text-zinc-400 sm:grid-cols-2">
                          <p>
                            Actividad:{" "}
                            {event.resource
                              ? humanizeWebhookTopic(event.topic)
                              : "Aviso recibido"}
                          </p>
                          <p>
                            Canal:{" "}
                            {event.user_id
                              ? `${publication.label} conectado`
                              : publication.label}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-zinc-500">
                    Cuando la plataforma envie avisos, apareceran aqui como
                    actividad relacionada con este espacio.
                  </p>
                )}
              </div>

              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
                  Historial de sincronizacion
                </p>
                {sync?.history?.length ? (
                  <div className="mt-3 space-y-2">
                    {sync.history.map((event, index) => (
                      <div
                        key={`${event.at}-${event.action}-${index}`}
                        className="rounded-xl border border-zinc-800 bg-zinc-950/70 px-3 py-2 text-sm"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium text-white">
                            {humanizeSyncAction(event.action)}
                          </span>
                          <span className="text-xs text-zinc-500">
                            {formatDateTime(event.at)}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-zinc-500">
                          ID {event.external_id || "sin id"} | Estado{" "}
                          {event.status || "sin estado"}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-zinc-500">
                    Aun no hay historial de sincronizacion para este canal.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function RentaPublicacionPanel({
  entidades,
  onManageConnections,
}: {
  entidades: Entidad[];
  onManageConnections: () => void;
}) {
  const [dashboards, setDashboards] = useState<DashboardResponse[]>([]);
  const [channelConfigsByEntity, setChannelConfigsByEntity] = useState<
    Record<number, ChannelConfig[]>
  >({});
  const [loading, setLoading] = useState(true);
  const [loadingChannels, setLoadingChannels] = useState(true);
  const [filter, setFilter] = useState<PublicationFilter>("DISPONIBLES");
  const [pauseFilter, setPauseFilter] = useState<PauseFilter>("TODOS");
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<PublicationSortKey>("reciente");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [pageSize, setPageSize] =
    useState<(typeof PAGE_SIZE_OPTIONS)[number]>(25);
  const [currentPage, setCurrentPage] = useState(1);
  const [syncingSpaceId, setSyncingSpaceId] = useState<number | null>(null);
  const [syncingAll, setSyncingAll] = useState(false);
  const [savingAutomation, setSavingAutomation] = useState(false);
  const [traceSelection, setTraceSelection] = useState<TraceSelection | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [noticeTone, setNoticeTone] = useState<"success" | "warning">("success");
  const [infoModal, setInfoModal] = useState<RentaInfoContent | null>(null);

  const activeEntities = useMemo(
    () => entidades.filter((entidad) => entidad.activo),
    [entidades]
  );

  const loadDashboards = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${RENTA_API_BASE}/dashboard/`, {
        cache: "no-store",
      });
      const body = (await response.json()) as
        | GlobalDashboardResponse
        | { detail?: string };
      if (!response.ok) {
        throw new Error(
          extractErrorMessage(body, "No se pudo cargar la publicacion de renta.")
        );
      }
      const activeIds = new Set(activeEntities.map((entidad) => entidad.id));
      setDashboards(
        (body as GlobalDashboardResponse).dashboards.filter((dashboard) =>
          activeIds.has(dashboard.entidad.id)
        )
      );
    } catch (loadError) {
      console.error("Error cargando publicacion de renta:", loadError);
      setDashboards([]);
      setError(
        loadError instanceof Error
          ? loadError.message
          : "No se pudo cargar la publicacion de renta."
      );
    } finally {
      setLoading(false);
    }
  }, [activeEntities]);

  const loadChannelConfigs = useCallback(async () => {
    setLoadingChannels(true);
    try {
      const response = await fetch(`${RENTA_API_BASE}/canales/`, {
        cache: "no-store",
      });
      const body = (await response.json()) as
        | GlobalChannelsResponse
        | { detail?: string };
      if (!response.ok) {
        throw new Error(
          extractErrorMessage(body, "No se pudieron cargar canales de renta.")
        );
      }
      const activeIds = new Set(activeEntities.map((entidad) => entidad.id));
      const next: Record<number, ChannelConfig[]> = {};
      (body as GlobalChannelsResponse).items.forEach((item) => {
        if (activeIds.has(item.entidad.id)) {
          next[item.entidad.id] = item.channels;
        }
      });
      setChannelConfigsByEntity(next);
    } catch (loadError) {
      console.error("Error cargando canales de renta:", loadError);
      setChannelConfigsByEntity({});
    } finally {
      setLoadingChannels(false);
    }
  }, [activeEntities]);

  useEffect(() => {
    void loadDashboards();
  }, [loadDashboards]);

  useEffect(() => {
    void loadChannelConfigs();
  }, [loadChannelConfigs]);

  const rows = useMemo<PublicationRow[]>(() => {
    const byId = new Map(activeEntities.map((entidad) => [entidad.id, entidad]));
    return dashboards
      .flatMap((dashboard) => {
        const entidad = byId.get(dashboard.entidad.id);
        if (!entidad) {
          return [];
        }
        return dashboard.spaces.map((space) => ({ entidad, space }));
      })
      .filter(({ space, entidad }) => {
        const normalized = query.trim().toLowerCase();
        if (filter === "DISPONIBLES" && space.estatus !== "DISPONIBLE") {
          return false;
        }
        if (filter === "LISTOS" && !space.listo_para_publicar) {
          return false;
        }
        if (filter === "PUBLICADOS" && !isPublished(space)) {
          return false;
        }
        if (filter === "PAUSADOS" && !matchesPauseFilter(space, pauseFilter)) {
          return false;
        }
        if (filter === "ERRORES" && !hasErrors(space)) {
          return false;
        }
        if (!normalized) {
          return true;
        }
        const publicationText = space.publicaciones
          .map(
            (publication) =>
              `${publication.label} ${publication.estatus} ${
                publication.identificador_externo || ""
              }`
          )
          .join(" ")
          .toLowerCase();
        return (
          space.codigo.toLowerCase().includes(normalized) ||
          (space.titulo_publico || "").toLowerCase().includes(normalized) ||
          (space.tipo_nombre || "").toLowerCase().includes(normalized) ||
          entidad.nombre_comercial.toLowerCase().includes(normalized) ||
          publicationText.includes(normalized)
        );
      })
      .sort(sortRowsForFilter(filter, sortKey, sortDirection));
  }, [activeEntities, dashboards, filter, pauseFilter, query, sortDirection, sortKey]);

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);

  const paginatedRows = useMemo(() => {
    const start = (safeCurrentPage - 1) * pageSize;
    return rows.slice(start, start + pageSize);
  }, [pageSize, rows, safeCurrentPage]);

  const visiblePages = useMemo(() => {
    const pages: number[] = [];
    const start = Math.max(1, safeCurrentPage - 2);
    const end = Math.min(totalPages, start + 4);
    const adjustedStart = Math.max(1, end - 4);
    for (let page = adjustedStart; page <= end; page += 1) {
      pages.push(page);
    }
    return pages;
  }, [safeCurrentPage, totalPages]);

  const firstVisibleRow =
    rows.length === 0 ? 0 : (safeCurrentPage - 1) * pageSize + 1;
  const lastVisibleRow = Math.min(rows.length, safeCurrentPage * pageSize);

  const goToPage = useCallback(
    (page: number) => {
      const nextPage = Math.min(Math.max(1, page || 1), totalPages);
      setCurrentPage(nextPage);
    },
    [totalPages]
  );

  const handleSort = useCallback(
    (nextKey: PublicationSortKey) => {
      if (sortKey === nextKey) {
        setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
        return;
      }
      setSortKey(nextKey);
      setSortDirection(
        nextKey === "precio" || nextKey === "trafico" || nextKey === "reciente"
          ? "desc"
          : "asc"
      );
    },
    [sortKey]
  );

  const sortLabel = useCallback(
    (key: PublicationSortKey) =>
      sortKey === key ? (sortDirection === "asc" ? "ASC" : "DESC") : "ORD",
    [sortDirection, sortKey]
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [filter, pageSize, pauseFilter, query, sortDirection, sortKey]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  useEffect(() => {
    if (filter === "PAUSADOS") {
      setSortKey("reciente");
      setSortDirection("desc");
    }
  }, [filter]);

  const totals = useMemo(() => {
    const allRows = dashboards.flatMap((dashboard) => dashboard.spaces);
    return {
      espacios: allRows.length,
      disponibles: allRows.filter((space) => space.estatus === "DISPONIBLE").length,
      listos: allRows.filter((space) => space.listo_para_publicar).length,
      publicados: allRows.filter(isPublished).length,
      pausados: allRows.filter(isPaused).length,
      pausadosOcupacion: allRows.filter((space) =>
        matchesPauseFilter(space, "OCUPACION")
      ).length,
      pausadosPlataforma: allRows.filter((space) =>
        matchesPauseFilter(space, "PLATAFORMA")
      ).length,
      errores: allRows.filter(hasErrors).length,
    };
  }, [dashboards]);

  const mercadoLibreConfigs = useMemo(
    () =>
      activeEntities
        .map((entidad) => ({
          entidad,
          channel: channelConfigsByEntity[entidad.id]?.find(
            (item) => item.canal === "MERCADO_LIBRE"
          ),
        }))
        .filter(
          (item): item is { entidad: Entidad; channel: ChannelConfig } =>
            Boolean(item.channel)
        ),
    [activeEntities, channelConfigsByEntity]
  );

  const connectedMercadoLibreConfigs = useMemo(
    () =>
      mercadoLibreConfigs.filter(({ channel }) => isConnectedChannel(channel)),
    [mercadoLibreConfigs]
  );

  const automationStats = useMemo(() => {
    const connected = connectedMercadoLibreConfigs.length;
    const active = connectedMercadoLibreConfigs.filter(
      ({ channel }) => channel.activo
    ).length;
    const automatic = connectedMercadoLibreConfigs.filter(
      ({ channel }) =>
        channel.activo &&
        channel.publicar_automaticamente &&
        channel.pausar_si_ocupado
    ).length;

    return { connected, active, automatic };
  }, [connectedMercadoLibreConfigs]);

  const mercadoLibreAutomationEnabled =
    automationStats.connected > 0 &&
    automationStats.automatic === automationStats.connected;

  const toggleMercadoLibreAutomation = async () => {
    const eligibleChannels = connectedMercadoLibreConfigs;
    if (eligibleChannels.length === 0) {
      setNoticeTone("warning");
      setNotice(
        "Primero conecta Mercado Libre en la pestana Conexiones para activar la sincronizacion automatica."
      );
      return;
    }

    const nextEnabled = !mercadoLibreAutomationEnabled;
    setSavingAutomation(true);
    setError("");
    setNotice("");
    try {
      await Promise.all(
        eligibleChannels.map(async ({ entidad, channel }) => {
          const response = await fetch(
            `${RENTA_API_BASE}/entidades/${entidad.id}/canales/${channel.canal}/`,
            {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(
                channelPayload(channel, {
                  activo: nextEnabled ? true : channel.activo,
                  publicar_automaticamente: nextEnabled,
                  pausar_si_ocupado: nextEnabled ? true : channel.pausar_si_ocupado,
                  registrar_origen_contratacion: true,
                })
              ),
            }
          );
          const body = (await response.json()) as ChannelConfig | { detail?: string };
          if (!response.ok) {
            throw new Error(
              extractErrorMessage(
                body,
                `No se pudo actualizar ${entidad.nombre_comercial}.`
              )
            );
          }
        })
      );
      await Promise.all([loadChannelConfigs(), loadDashboards()]);
      setNoticeTone("success");
      setNotice(
        nextEnabled
          ? "Automatizacion activa: los espacios completos se publicaran al estar disponibles y se pausaran cuando se ocupen."
          : "Automatizacion desactivada. Las publicaciones quedan para sincronizacion manual."
      );
      window.setTimeout(() => setNotice(""), 9000);
    } catch (automationError) {
      console.error("Error actualizando automatizacion:", automationError);
      setError(
        automationError instanceof Error
          ? automationError.message
          : "No se pudo actualizar la automatizacion de Mercado Libre."
      );
    } finally {
      setSavingAutomation(false);
    }
  };

  const syncAllEntities = async () => {
    if (activeEntities.length === 0) {
      return;
    }
    setSyncingAll(true);
    setError("");
    setNotice("");
    setNoticeTone("success");
    try {
      const settled = await Promise.allSettled(
        activeEntities.map(async (entidad) => {
          const response = await fetch(
            `${RENTA_API_BASE}/entidades/${entidad.id}/sincronizar/`,
            { method: "POST" }
          );
          const body = (await response.json()) as Record<string, unknown>;
          if (!response.ok) {
            throw new Error(
              extractErrorMessage(
                body,
                `No se pudo sincronizar ${entidad.nombre_comercial}.`
              )
            );
          }
          return body;
        })
      );

      const okResults: Array<Record<string, unknown>> = [];
      const failed: string[] = [];
      settled.forEach((result) => {
        if (result.status === "fulfilled") {
          okResults.push(result.value);
        } else {
          failed.push(
            result.reason instanceof Error
              ? result.reason.message
              : "No se pudo sincronizar una entidad."
          );
        }
      });

      await loadDashboards();
      if (failed.length > 0) {
        setNoticeTone("warning");
      }
      setNotice(
        `Sincronizacion terminada: ${okResults.length} entidades revisadas, ` +
          `${sumResultValue(okResults, "publicadas")} publicadas, ` +
          `${sumResultValue(okResults, "pausadas")} pausadas, ` +
          `${sumResultValue(okResults, "errores")} con error.` +
          (failed.length ? ` ${failed.slice(0, 2).join(" ")}` : "")
      );
      window.setTimeout(() => setNotice(""), 9000);
    } catch (syncError) {
      console.error("Error sincronizando publicaciones:", syncError);
      setError(
        syncError instanceof Error
          ? syncError.message
          : "No se pudo sincronizar la publicacion de renta."
      );
    } finally {
      setSyncingAll(false);
    }
  };

  const syncOneSpace = async (spaceId: number) => {
    setSyncingSpaceId(spaceId);
    setError("");
    setNotice("");
    setNoticeTone("success");
    try {
      const response = await fetch(`${RENTA_API_BASE}/espacios/${spaceId}/sincronizar/`, {
        method: "POST",
      });
      const body = (await response.json()) as {
        mensaje?: string;
        detail?: string;
        space?: DashboardSpace;
      };
      if (!response.ok) {
        throw new Error(
          extractErrorMessage(body, "No se pudo preparar la publicacion.")
        );
      }
      const mainPublication = body.space ? getMainPublication(body.space) : null;
      const statusText = mainPublication
        ? ` Canal principal: ${mainPublication.label} (${mainPublication.estatus}).`
        : "";
      const message = body.mensaje || "Publicacion preparada correctamente.";
      const zeroChannels = message.includes("0 canales");
      setNoticeTone(zeroChannels ? "warning" : "success");
      setNotice(
        zeroChannels
          ? "No hay canales activos para sincronizar este espacio. Revisa que exista al menos un canal activo en la pestana Conexiones."
          : `${message}${statusText}`
      );
      await loadDashboards();
      window.setTimeout(() => setNotice(""), 9000);
    } catch (syncError) {
      console.error("Error preparando publicacion:", syncError);
      setError(
        syncError instanceof Error
          ? syncError.message
          : "No se pudo preparar la publicacion."
      );
    } finally {
      setSyncingSpaceId(null);
    }
  };

  const handleTraceManualStatusUpdated = async (updatedSpace?: DashboardSpace) => {
    if (updatedSpace) {
      setTraceSelection((current) => {
        if (!current || current.space.id !== updatedSpace.id) {
          return current;
        }
        const updatedPublication =
          updatedSpace.publicaciones.find(
            (item) => item.canal === current.publication.canal
          ) || current.publication;
        return {
          ...current,
          space: updatedSpace,
          publication: updatedPublication,
        };
      });
    }
    await loadDashboards();
  };

  return (
    <section className="page-section space-y-5">
      <RentaInfoModal info={infoModal} onClose={() => setInfoModal(null)} />

      <div className="flex flex-col gap-4 border-b border-zinc-800 pb-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-xs uppercase tracking-[0.18em] text-cyan-300">
              Publicacion automatizada
            </p>
            <RentaInfoButton info={publicationInfo.panel} onOpen={setInfoModal} />
          </div>
          <h2 className="mt-2 text-2xl font-bold text-white">
            Espacios listos para canales
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-zinc-500">
            Controla que espacios completos salen a los canales conectados. Si
            un espacio se ocupa, la siguiente sincronizacion pausa el anuncio
            para evitar dobles rentas.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void syncAllEntities()}
            disabled={syncingAll || loading}
            className="w-fit rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-2.5 text-sm font-medium text-emerald-200 transition-colors hover:bg-emerald-500/20 disabled:opacity-50"
          >
            {syncingAll ? "Sincronizando..." : "Sincronizar ahora"}
          </button>
          <button
            type="button"
            onClick={onManageConnections}
            className="w-fit rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-2.5 text-sm font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20"
          >
            Conexiones
          </button>
        </div>
      </div>

      {error ? (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            isMercadoLibreSellerBlocked(error)
              ? "border-amber-500/25 bg-amber-500/10 text-amber-100"
              : "border-red-500/20 bg-red-500/10 text-red-300"
          }`}
        >
          {isMercadoLibreSellerBlocked(error) ? (
            <>
              <p className="font-semibold">
                Mercado Libre no habilito esta cuenta para publicar inmuebles.
              </p>
              <p className="mt-1 text-amber-100/80">
                Revisa en Mercado Libre que el vendedor tenga perfil completo,
                permisos para listar inmuebles y publicaciones o paquete
                disponible. BettERP ya dejo la publicacion marcada para reintentar
                cuando la cuenta quede habilitada.
              </p>
            </>
          ) : (
            error
          )}
        </div>
      ) : null}
      {notice ? (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            noticeTone === "warning"
              ? "border-amber-500/20 bg-amber-500/10 text-amber-200"
              : "border-emerald-500/20 bg-emerald-500/10 text-emerald-200"
          }`}
        >
          {notice}
        </div>
      ) : null}

      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
        <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs uppercase tracking-[0.18em] text-cyan-300">
                Mercado Libre
              </p>
              <RentaInfoButton
                info={publicationInfo.automation}
                onOpen={setInfoModal}
              />
              <span
                className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${
                  mercadoLibreAutomationEnabled
                    ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
                    : "border-zinc-700 bg-zinc-900 text-zinc-400"
                }`}
              >
                {mercadoLibreAutomationEnabled ? "Automatico" : "Manual"}
              </span>
            </div>
            <h3 className="mt-2 text-lg font-semibold text-white">
              Publicar disponibles y pausar ocupados
            </h3>
            <p className="mt-1 max-w-3xl text-sm text-zinc-500">
              Cuando esta activo, BettERP revisa los espacios completos:
              disponibles se publican o actualizan; ocupados se pausan en el
              canal durante la siguiente sincronizacion.
            </p>
            <div className="mt-4 grid gap-2 text-xs text-zinc-400 sm:grid-cols-3">
              <div className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2">
                <p className="text-zinc-500">Conexiones listas</p>
                <p className="mt-1 text-lg font-semibold text-white">
                  {loadingChannels ? "..." : automationStats.connected}
                </p>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2">
                <p className="text-zinc-500">Canales activos</p>
                <p className="mt-1 text-lg font-semibold text-white">
                  {loadingChannels ? "..." : automationStats.active}
                </p>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2">
                <p className="text-zinc-500">Con pausa al ocupar</p>
                <p className="mt-1 text-lg font-semibold text-white">
                  {loadingChannels ? "..." : automationStats.automatic}
                </p>
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-2 lg:items-end">
            <button
              type="button"
              role="switch"
              aria-checked={mercadoLibreAutomationEnabled}
              onClick={() => void toggleMercadoLibreAutomation()}
              disabled={savingAutomation || loadingChannels}
              className={`flex min-w-[210px] items-center justify-between rounded-2xl border px-4 py-3 text-sm font-semibold transition-colors disabled:opacity-50 ${
                mercadoLibreAutomationEnabled
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                  : "border-zinc-700 bg-zinc-900 text-zinc-300"
              }`}
            >
              <span>
                {savingAutomation
                  ? "Guardando..."
                  : mercadoLibreAutomationEnabled
                    ? "Automatizacion activa"
                    : "Activar automatizacion"}
              </span>
              <span
                className={`relative h-6 w-11 rounded-full border transition-colors ${
                  mercadoLibreAutomationEnabled
                    ? "border-emerald-400/40 bg-emerald-400/30"
                    : "border-zinc-600 bg-zinc-800"
                }`}
              >
                <span
                  className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-transform ${
                    mercadoLibreAutomationEnabled
                      ? "translate-x-5"
                      : "translate-x-1"
                  }`}
                />
              </span>
            </button>
            <p className="max-w-xs text-xs text-zinc-500 lg:text-right">
              Para correr sin clicks, programa el endpoint o comando de
              sincronizacion cada 10 a 30 minutos.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
            Indicadores
          </p>
          <RentaInfoButton info={publicationInfo.metrics} onOpen={setInfoModal} />
        </div>
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-6">
          <div className="metric-card-compact border-zinc-800 bg-zinc-950/80">
            <p className="metric-label-compact">Espacios</p>
            <p className="metric-value-compact">{totals.espacios}</p>
          </div>
          <div className="metric-card-compact border-emerald-500/20 bg-emerald-500/10">
            <p className="metric-label-compact text-emerald-200/80">
              Disponibles
            </p>
            <p className="metric-value-compact text-emerald-300">
              {totals.disponibles}
            </p>
          </div>
          <div className="metric-card-compact border-cyan-500/20 bg-cyan-500/10">
            <p className="metric-label-compact text-cyan-200/80">Listos</p>
            <p className="metric-value-compact text-cyan-300">{totals.listos}</p>
          </div>
          <div className="metric-card-compact border-blue-500/20 bg-blue-500/10">
            <p className="metric-label-compact text-blue-200/80">Publicados</p>
            <p className="metric-value-compact text-blue-300">
              {totals.publicados}
            </p>
          </div>
          <div className="metric-card-compact border-amber-500/20 bg-amber-500/10">
            <p className="metric-label-compact text-amber-200/80">Pausados</p>
            <p className="metric-value-compact text-amber-300">
              {totals.pausados}
            </p>
          </div>
          <div className="metric-card-compact border-red-500/20 bg-red-500/10">
            <p className="metric-label-compact text-red-200/80">Errores</p>
            <p className="metric-value-compact text-red-300">{totals.errores}</p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
        <div className="mb-3 flex items-center gap-2">
          <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
            Filtros
          </p>
          <RentaInfoButton info={publicationInfo.filters} onOpen={setInfoModal} />
        </div>
        <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <label className="text-xs uppercase tracking-[0.18em] text-zinc-500">
              Buscar
            </label>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Habitacion, entidad, titulo o tipo..."
              className="mt-2 w-full rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-2.5 text-sm text-white outline-none placeholder:text-zinc-500 focus:ring-1 focus:ring-cyan-500"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              ["DISPONIBLES", "Disponibles"],
              ["LISTOS", "Listos"],
              ["PUBLICADOS", "Publicados"],
              ["PAUSADOS", "Pausados"],
              ["ERRORES", "Errores"],
              ["TODOS", "Todos"],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  const nextFilter = value as PublicationFilter;
                  setFilter(nextFilter);
                  if (nextFilter !== "PAUSADOS") {
                    setPauseFilter("TODOS");
                  }
                }}
                className={`rounded-xl border px-3 py-2 text-sm transition-colors ${
                  filter === value
                    ? "border-cyan-500/20 bg-cyan-500/10 text-cyan-200"
                    : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {filter === "PAUSADOS" ? (
          <div className="mt-3 flex flex-wrap gap-2 border-t border-zinc-800 pt-3">
            {[
              ["TODOS", `Todos (${totals.pausados})`],
              ["OCUPACION", `Por ocupacion (${totals.pausadosOcupacion})`],
              ["PLATAFORMA", `Por plataforma (${totals.pausadosPlataforma})`],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setPauseFilter(value as PauseFilter)}
                className={`rounded-xl border px-3 py-2 text-xs font-medium transition-colors ${
                  pauseFilter === value
                    ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
                    : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {loading ? (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 py-16 text-center text-zinc-500">
          Cargando espacios disponibles...
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/20 py-16 text-center">
          <p className="font-medium text-white">No hay espacios para este filtro.</p>
          <p className="mt-2 text-sm text-zinc-500">
            Revisa que el espacio este disponible, con ficha completa y marcado
            para publicarse en renta.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950/80">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-white">
                  Tabla de publicaciones
                </p>
                <RentaInfoButton
                  info={publicationInfo.table}
                  onOpen={setInfoModal}
                  className="h-5 w-5 text-[10px]"
                />
              </div>
              <p className="text-xs text-zinc-500">
                Mostrando {firstVisibleRow}-{lastVisibleRow} de {rows.length}{" "}
                espacios
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={sortKey}
                onChange={(event) => {
                  const nextKey = event.target.value as PublicationSortKey;
                  setSortKey(nextKey);
                  setSortDirection(
                    nextKey === "precio" ||
                      nextKey === "trafico" ||
                      nextKey === "reciente"
                      ? "desc"
                      : "asc"
                  );
                }}
                className="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
              >
                <option value="reciente">Mas reciente</option>
                <option value="espacio">Espacio</option>
                <option value="ficha">Ficha</option>
                <option value="precio">Precio</option>
                <option value="publicacion">Publicacion</option>
                <option value="trafico">Trafico</option>
                <option value="pendientes">Pendientes</option>
              </select>
              <button
                type="button"
                onClick={() =>
                  setSortDirection((current) =>
                    current === "asc" ? "desc" : "asc"
                  )
                }
                className="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 transition-colors hover:text-white"
              >
                {sortDirection === "asc" ? "Ascendente" : "Descendente"}
              </button>
              <select
                value={pageSize}
                onChange={(event) =>
                  setPageSize(
                    Number(event.target.value) as (typeof PAGE_SIZE_OPTIONS)[number]
                  )
                }
                className="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
              >
                {PAGE_SIZE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    Filas {option}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1120px] text-left text-sm text-zinc-300">
              <thead className="border-b border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="py-3 pl-4 pr-4">
                    <button
                      type="button"
                      onClick={() => handleSort("espacio")}
                      className="flex items-center gap-2 text-left transition-colors hover:text-cyan-200"
                    >
                      Espacio
                      <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-[10px]">
                        {sortLabel("espacio")}
                      </span>
                    </button>
                  </th>
                  <th className="py-3 pr-4">
                    <button
                      type="button"
                      onClick={() => handleSort("ficha")}
                      className="flex items-center gap-2 text-left transition-colors hover:text-cyan-200"
                    >
                      Ficha
                      <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-[10px]">
                        {sortLabel("ficha")}
                      </span>
                    </button>
                  </th>
                  <th className="py-3 pr-4">
                    <button
                      type="button"
                      onClick={() => handleSort("publicacion")}
                      className="flex items-center gap-2 text-left transition-colors hover:text-cyan-200"
                    >
                      Publicacion
                      <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-[10px]">
                        {sortLabel("publicacion")}
                      </span>
                    </button>
                  </th>
                  <th className="py-3 pr-4">
                    <button
                      type="button"
                      onClick={() => handleSort("trafico")}
                      className="flex items-center gap-2 text-left transition-colors hover:text-cyan-200"
                    >
                      Trafico
                      <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-[10px]">
                        {sortLabel("trafico")}
                      </span>
                    </button>
                  </th>
                  <th className="py-3 pr-4">
                    <button
                      type="button"
                      onClick={() => handleSort("pendientes")}
                      className="flex items-center gap-2 text-left transition-colors hover:text-cyan-200"
                    >
                      Pendientes
                      <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-[10px]">
                        {sortLabel("pendientes")}
                      </span>
                    </button>
                  </th>
                  <th className="py-3 pr-4 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {paginatedRows.map(({ entidad, space }) => {
                const mainPublication = getMainPublication(space);
                const activePublications = getActivePublications(space);
                const missing = [
                  ...space.faltantes,
                  ...(mainPublication?.faltantes || []),
                ];
                const views = activePublications.reduce(
                  (sum, publication) =>
                    sum + Number(publication.metricas?.vistas || 0),
                  0
                );
                const leads = activePublications.reduce(
                  (sum, publication) =>
                    sum + Number(publication.metricas?.leads || 0),
                  0
                );
                const externalTrace = mainPublication
                  ? compactExternalTrace(mainPublication)
                  : [];
                const mainStatus = (
                  mainPublication?.trazabilidad?.sync.last_response?.status ||
                  mainPublication?.estado_externo ||
                  ""
                ).toLowerCase();
                const mainTags = mainPublication
                  ? getExternalTags(mainPublication, mainPublication.trazabilidad)
                  : [];
                const mainSubStatuses = mainPublication
                  ? getExternalSubStatuses(mainPublication, mainPublication.trazabilidad)
                  : [];
                const channelMessage = mainPublication
                  ? friendlyPublicationMessage(
                      mainPublication.mensaje_estado || undefined,
                      mainStatus,
                      mainTags,
                      mainSubStatuses
                    )
                  : "";
                const pauseInfo =
                  mainPublication?.estatus === "PAUSADA"
                    ? mainPublication.pausa
                    : null;
                return (
                  <tr key={`${entidad.id}-${space.id}`} className="align-top hover:bg-zinc-900/40">
                    <td className="py-4 pl-4 pr-4">
                      <div className="flex items-start gap-3">
                        <div className="h-14 w-14 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
                          {space.cover_preview_url || space.cover_url ? (
                            <PhotoPreviewImage
                              src={space.cover_preview_url || space.cover_url}
                              alt={space.codigo}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full items-center justify-center text-[10px] text-zinc-600">
                              Sin foto
                            </div>
                          )}
                        </div>
                        <div>
                          <p className="font-semibold text-white">
                            {entidad.nombre_comercial} - {space.codigo}
                          </p>
                          <p className="mt-1 text-xs text-zinc-500">
                            {space.tipo_nombre || "Sin tipo"} |{" "}
                            {formatMoney(space.renta_publicable)}
                          </p>
                          <span
                            className={`mt-2 inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium ${spaceStatusStyles(
                              space.estatus
                            )}`}
                          >
                            {space.estatus}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="py-4 pr-4">
                      <p className="font-medium text-white">{space.titulo_publico}</p>
                      <p className="mt-1 max-w-sm text-xs text-zinc-500">
                        {space.resumen_publico || "Sin resumen comercial."}
                      </p>
                      <p className="mt-2 text-xs text-zinc-500">
                        {space.foto_count} fotos | {space.recamaras ?? "-"} rec. |{" "}
                        {space.banos ?? "-"} banos | {space.metros_cuadrados ?? "-"} m2
                      </p>
                    </td>
                    <td className="py-4 pr-4">
                      {mainPublication ? (
                        <>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-medium text-zinc-400">
                              {mainPublication.label}
                            </span>
                            <span
                              className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${statusStyles(
                                mainPublication.estatus
                              )}`}
                            >
                              {mainPublication.estatus}
                            </span>
                          </div>
                          <p className="mt-2 max-w-xs text-xs text-zinc-500">
                            {channelMessage || "Sin mensaje de canal."}
                          </p>
                          {pauseInfo ? (
                            <p
                              className={`mt-2 max-w-xs rounded-xl border px-3 py-2 text-xs ${
                                pauseInfo.tipo === "OCUPACION"
                                  ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-200"
                                  : "border-amber-500/20 bg-amber-500/10 text-amber-200"
                              }`}
                            >
                              <span className="font-semibold">
                                {pauseInfo.label || "Pausado"}
                              </span>
                              :{" "}
                              {pauseInfo.detalle ||
                                "Revisa el detalle de la publicacion."}
                            </p>
                          ) : null}
                          {externalTrace.length > 0 ? (
                            <div className="mt-2 flex max-w-xs flex-wrap gap-1">
                              {externalTrace.map((item) => (
                                <span
                                  key={item}
                                  className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-400"
                                >
                                  {item}
                                </span>
                              ))}
                            </div>
                          ) : null}
                          {mainPublication.identificador_externo ? (
                            <p className="mt-2 text-xs text-zinc-500">
                              ID externo:{" "}
                              <span className="font-medium text-zinc-300">
                                {mainPublication.identificador_externo}
                              </span>
                            </p>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-xs text-zinc-500">
                          Sin publicacion preparada.
                        </span>
                      )}
                    </td>
                    <td className="py-4 pr-4 text-xs text-zinc-400">
                      <p>{views} vistas</p>
                      <p className="mt-1">{leads} leads</p>
                      <p className="mt-1">
                        {activePublications.length} canales con actividad
                      </p>
                    </td>
                    <td className="py-4 pr-4">
                      {missing.length === 0 ? (
                        <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-300">
                          Lista
                        </span>
                      ) : (
                        <div className="flex max-w-xs flex-wrap gap-1">
                          {missing.slice(0, 4).map((item) => (
                            <span
                              key={item}
                              className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-400"
                            >
                              {item}
                            </span>
                          ))}
                          {missing.length > 4 ? (
                            <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-400">
                              +{missing.length - 4}
                            </span>
                          ) : null}
                        </div>
                      )}
                    </td>
                    <td className="py-4 pr-4 text-right">
                      <div className="flex flex-wrap justify-end gap-2">
                        {getTracePublications(space).map((publication) => (
                          <button
                            key={`${space.id}-${publication.canal}-trace`}
                            type="button"
                            title={`Ver trazabilidad de ${publication.label}`}
                            onClick={() =>
                              setTraceSelection({ entidad, space, publication })
                            }
                            className={`rounded-xl border px-3 py-2 text-xs font-semibold transition-colors ${
                              publication.estatus === "ERROR"
                                ? "border-red-500/20 bg-red-500/10 text-red-200 hover:bg-red-500/20"
                                : publication.estatus === "PUBLICADA"
                                  ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20"
                                  : "border-cyan-500/20 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20"
                            }`}
                          >
                            {platformShortLabel(publication)}
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => void syncOneSpace(space.id)}
                          disabled={syncingSpaceId === space.id}
                          className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-3 py-2 text-xs font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20 disabled:opacity-50"
                        >
                          {syncingSpaceId === space.id
                            ? "Sincronizando..."
                            : "Sincronizar"}
                        </button>
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800 px-4 py-3 text-sm text-zinc-400">
            <span>
              Pagina {safeCurrentPage} de {totalPages}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => goToPage(1)}
                disabled={safeCurrentPage === 1}
                className="rounded-lg border border-zinc-800 px-3 py-1.5 transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                Inicio
              </button>
              <button
                type="button"
                onClick={() => goToPage(safeCurrentPage - 1)}
                disabled={safeCurrentPage === 1}
                className="rounded-lg border border-zinc-800 px-3 py-1.5 transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                Anterior
              </button>
              {visiblePages.map((page) => (
                <button
                  key={page}
                  type="button"
                  onClick={() => goToPage(page)}
                  className={`rounded-lg border px-3 py-1.5 transition-colors ${
                    page === safeCurrentPage
                      ? "border-cyan-500/30 bg-cyan-500/10 text-cyan-200"
                      : "border-zinc-800 hover:text-white"
                  }`}
                >
                  {page}
                </button>
              ))}
              <button
                type="button"
                onClick={() => goToPage(safeCurrentPage + 1)}
                disabled={safeCurrentPage === totalPages}
                className="rounded-lg border border-zinc-800 px-3 py-1.5 transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                Siguiente
              </button>
              <button
                type="button"
                onClick={() => goToPage(totalPages)}
                disabled={safeCurrentPage === totalPages}
                className="rounded-lg border border-zinc-800 px-3 py-1.5 transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                Final
              </button>
              <label className="flex items-center gap-2">
                <span className="text-xs uppercase tracking-[0.16em] text-zinc-500">
                  Ir a
                </span>
                <input
                  type="number"
                  min={1}
                  max={totalPages}
                  value={safeCurrentPage}
                  onChange={(event) => goToPage(Number(event.target.value))}
                  className="w-20 rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-white outline-none focus:ring-1 focus:ring-cyan-500"
                />
              </label>
            </div>
          </div>
        </div>
      )}

      {traceSelection ? (
        <PublicationTraceModal
          selection={traceSelection}
          onClose={() => setTraceSelection(null)}
          onManualStatusUpdated={handleTraceManualStatusUpdated}
        />
      ) : null}
    </section>
  );
}
