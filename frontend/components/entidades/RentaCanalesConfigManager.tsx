"use client";

import { buildApiUrl } from "@/lib/api";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import {
  RentaInfoButton,
  RentaInfoModal,
  type RentaInfoContent,
} from "./RentaInfo";

const RENTA_API_BASE = buildApiUrl("/renta-espacios");

interface ChannelCredentials {
  account_id?: string;
  partner_account?: string;
  client_id?: string;
  property_id?: string;
  environment?: string;
  listing_segment?: string;
  category_id?: string;
  listing_type_id?: string;
  currency_id?: string;
  buying_mode?: string;
  condition?: string;
  redirect_uri?: string;
  webhook_url?: string;
  profile_url?: string;
  public_profile_url?: string;
  contact_url?: string;
  onboarding_status?: string;
  api_key?: string;
  access_token?: string;
  refresh_token?: string;
  api_secret?: string;
  ml_nickname?: string;
  ml_site_id?: string;
  ml_permalink?: string;
  expires_at?: string;
  api_base_url?: string;
  property_type?: string;
  operation_type?: string;
  easybroker_validated_at?: string;
  easybroker_sample_total?: number;
  webhook_events_total?: number;
  webhook_last_topic?: string;
  webhook_last_at?: string;
  traffic_views_total?: number;
  traffic_leads_total?: number;
  traffic_messages_total?: number;
  ml_listing_types?: string[];
  listing_type_checked_at?: string;
  test_user_id?: string;
  test_user_nickname?: string;
  test_user_site_id?: string;
  test_user_created_at?: string;
  api_key_configurada?: boolean;
  access_token_configurado?: boolean;
  refresh_token_configurado?: boolean;
  api_secret_configurado?: boolean;
}

interface ChannelConfig {
  id: number | null;
  canal: string;
  label: string;
  summary: string;
  mode_default: string;
  modo_integracion: string;
  activo: boolean;
  estatus: "BORRADOR" | "PENDIENTE" | "CONECTADO" | "ERROR" | "PAUSADO";
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
  fecha_ultima_validacion: string | null;
  fecha_actualizacion: string | null;
}

interface ChannelsResponse {
  entidad: {
    id: number;
    nombre_comercial: string;
    ciudad?: string | null;
  };
  channels: ChannelConfig[];
}

interface MercadoLibreTestAccess {
  nickname: string;
  password: string;
  siteId: string;
}

const ASSISTED_CHANNEL_CODES = new Set([
  "AIRBNB",
  "BOOKING",
]);
const COMMERCIAL_PERCENT_MAX = 9999;
const COMMERCIAL_FIXED_AMOUNT_MAX = 1_000_000_000;

type CommercialRuleField =
  | "comision_porcentaje"
  | "ajuste_temporada_porcentaje"
  | "promocion_porcentaje"
  | "comision_monto_fijo"
  | "ajuste_temporada_monto_fijo"
  | "promocion_monto_fijo";

const channelInfo: Record<string, RentaInfoContent> = {
  resumen: {
    eyebrow: "Conexiones",
    title: "Resumen de canales",
    summary:
      "Estos contadores muestran cuantas plataformas estan disponibles, conectadas, activas y con automatizacion encendida.",
    details: [
      "Conectado significa que existe una cuenta o configuracion suficiente para operar el canal.",
      "Activo significa que el canal participa en publicaciones para esta unidad de negocio.",
      "Automatico significa que BettERP puede publicar disponibles y pausar ocupados segun reglas configuradas.",
    ],
  },
  lista: {
    eyebrow: "Conexiones",
    title: "Lista de canales",
    summary:
      "Cada tarjeta representa una plataforma o flujo operativo disponible para esta unidad de negocio.",
    details: [
      "Selecciona un canal para revisar credenciales, automatizacion, reglas comerciales y notas.",
      "Los canales en construccion pueden guardar configuracion base sin sincronizar de forma automatica.",
      "Los canales asistidos generan paquete de publicacion para operarlo manualmente mientras llega la integracion directa.",
    ],
  },
  conexion: {
    eyebrow: "Conexiones",
    title: "Conexion del canal",
    summary:
      "Define como BettERP se comunica con la plataforma externa o como prepara el paquete para operacion asistida.",
    details: [
      "En canales API, las credenciales permiten validar, publicar, pausar o leer eventos del proveedor.",
      "En canales asistidos, los campos identifican perfiles, URLs o datos necesarios para operar manualmente.",
      "No todos los canales requieren todos los campos; BettERP muestra los datos relevantes para el proveedor seleccionado.",
    ],
  },
  automatizacion: {
    eyebrow: "Conexiones",
    title: "Automatizacion",
    summary:
      "Controla cuando el canal participa en el ciclo automatico de publicacion y pausa.",
    details: [
      "Canal activo habilita el canal para esta unidad.",
      "Publicar al detectar disponibilidad prepara o reactiva anuncios cuando el espacio esta libre.",
      "Pausar al ocuparse evita dobles rentas bajando o pausando el anuncio cuando el espacio deja de estar disponible.",
    ],
  },
  reglas: {
    eyebrow: "Conexiones",
    title: "Reglas comerciales",
    summary:
      "Ajustan el precio publicable para este canal sin cambiar la renta base del espacio.",
    details: [
      "Porcentajes aplican sobre la renta publicable del espacio.",
      "Montos fijos suman o restan una cantidad directa antes de preparar la publicacion.",
      "Usalos para reflejar comisiones, temporadas altas o promociones por plataforma.",
    ],
  },
  notas: {
    eyebrow: "Conexiones",
    title: "Notas operativas",
    summary:
      "Texto global que se agrega a las publicaciones de este canal para comunicar condiciones generales.",
    details: [
      "Conviene usarlo para reglas comunes del canal, restricciones o instrucciones de visita.",
      "No reemplaza la descripcion propia de cada espacio.",
      "Evita datos privados o informacion que no deba salir a prospectos.",
    ],
  },
};

const commercialRuleInfo: Record<CommercialRuleField, RentaInfoContent> = {
  comision_porcentaje: {
    eyebrow: "Reglas comerciales",
    title: "Comision %",
    summary:
      "Porcentaje que se suma al precio para cubrir comision o costo variable del canal.",
    details: [
      "Acepta de 0 a 9,999 con maximo 2 decimales.",
      "Ejemplo: 5 convierte una renta de 10,000 en 10,500 antes de otros ajustes.",
      "No modifica la renta base del espacio; solo afecta la publicacion de este canal.",
    ],
  },
  ajuste_temporada_porcentaje: {
    eyebrow: "Reglas comerciales",
    title: "Temporada alta %",
    summary:
      "Ajuste porcentual para aumentar o reducir el precio cuando opere una temporada especial.",
    details: [
      "Acepta de 0 a 9,999 con maximo 2 decimales.",
      "Usalo para temporadas de alta demanda o reglas comerciales temporales.",
      "Si no aplica temporada, dejalo en 0.",
    ],
  },
  promocion_porcentaje: {
    eyebrow: "Reglas comerciales",
    title: "Promocion %",
    summary:
      "Porcentaje promocional que se descuenta o considera como ajuste comercial del canal.",
    details: [
      "Acepta de 0 a 9,999 con maximo 2 decimales.",
      "Sirve para reflejar descuentos de campana sin editar cada espacio.",
      "Mantenerlo en 0 deja el precio sin promocion porcentual.",
    ],
  },
  comision_monto_fijo: {
    eyebrow: "Reglas comerciales",
    title: "Comision fija",
    summary:
      "Monto directo que se suma al precio para cubrir costos fijos del canal.",
    details: [
      "Acepta de 0 a 1,000,000,000 con maximo 2 decimales.",
      "Usalo para cargos fijos de publicacion, administracion o servicio.",
      "No cambia la renta del contrato; solo el precio calculado para el canal.",
    ],
  },
  ajuste_temporada_monto_fijo: {
    eyebrow: "Reglas comerciales",
    title: "Temporada fija",
    summary:
      "Monto directo para ajustar publicaciones durante una temporada comercial.",
    details: [
      "Acepta de 0 a 1,000,000,000 con maximo 2 decimales.",
      "Es util cuando el ajuste de temporada es una cantidad fija y no un porcentaje.",
      "Dejalo en 0 cuando no haya ajuste fijo.",
    ],
  },
  promocion_monto_fijo: {
    eyebrow: "Reglas comerciales",
    title: "Promocion fija",
    summary:
      "Monto fijo promocional usado para ajustar el precio final de este canal.",
    details: [
      "Acepta de 0 a 1,000,000,000 con maximo 2 decimales.",
      "Sirve para campanas con descuento o incentivo definido por cantidad.",
      "Se controla por canal para no afectar otras plataformas.",
    ],
  },
};

function statusStyles(status: ChannelConfig["estatus"]) {
  if (status === "CONECTADO") {
    return "border-emerald-500/20 bg-emerald-500/10 text-emerald-300";
  }
  if (status === "PENDIENTE") {
    return "border-amber-500/20 bg-amber-500/10 text-amber-300";
  }
  if (status === "ERROR") {
    return "border-red-500/20 bg-red-500/10 text-red-300";
  }
  if (status === "PAUSADO") {
    return "border-zinc-700 bg-zinc-900 text-zinc-400";
  }
  return "border-blue-500/20 bg-blue-500/10 text-blue-300";
}

function modeLabel(mode: string) {
  if (mode === "API_DIRECTA") {
    return "API directa";
  }
  if (mode === "PARTNER") {
    return "Partner";
  }
  return "Operacion manual";
}

function numberInputValue(value: number) {
  return Number.isFinite(value) ? String(value) : "0";
}

function sanitizeCommercialNumberInput(
  rawValue: string,
  maxValue: number,
  decimalPlaces = 2
) {
  const normalized = rawValue.replace(",", ".").replace(/[^\d.]/g, "");
  const [rawInteger = "", ...rawDecimals] = normalized.split(".");
  const integerPart = rawInteger.replace(/^0+(?=\d)/, "");
  const decimalPart = rawDecimals.join("").slice(0, decimalPlaces);
  const sanitized = normalized.includes(".")
    ? `${integerPart || "0"}.${decimalPart}`
    : integerPart;
  const parsed = Number(sanitized || "0");
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.min(Math.max(parsed, 0), maxValue);
}

function boundedCommercialNumber(value: number, maxValue: number) {
  return sanitizeCommercialNumberInput(String(value), maxValue);
}

function compactNumber(value?: number) {
  return new Intl.NumberFormat("es-MX").format(Number(value || 0));
}

function listingTypeLabel(value?: string) {
  if (value === "free") {
    return "Gratuita";
  }
  if (value === "gold_special") {
    return "Clasica";
  }
  if (value === "gold_pro" || value === "gold_premium") {
    return "Premium";
  }
  return value || "Gratuita";
}

function validationDetailToText(detail: unknown) {
  if (typeof detail === "string" && detail.trim()) {
    return detail;
  }
  if (!Array.isArray(detail)) {
    return "";
  }
  return detail
    .map((item) => {
      if (!item || typeof item !== "object") {
        return "";
      }
      const entry = item as { loc?: unknown; msg?: unknown };
      const location = Array.isArray(entry.loc)
        ? entry.loc.filter(Boolean).join(".")
        : "";
      const message = typeof entry.msg === "string" ? entry.msg : "";
      if (location && message) {
        return `${location}: ${message}`;
      }
      return message;
    })
    .filter(Boolean)
    .join(" ");
}

function extractErrorMessage(body: unknown, fallback: string) {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail?: unknown }).detail;
    const detailText = validationDetailToText(detail);
    if (detailText) {
      return detailText;
    }
  }
  return fallback;
}

async function parseJsonResponse(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export default function RentaCanalesConfigManager({
  entidadId,
  onEntidadSeleccionada,
}: {
  entidadId?: string;
  onEntidadSeleccionada?: (entidadId: number) => void;
}) {
  const { user } = useAuth();
  const [channels, setChannels] = useState<ChannelConfig[]>([]);
  const [selectedCode, setSelectedCode] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [savingCode, setSavingCode] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [testAccess, setTestAccess] = useState<MercadoLibreTestAccess | null>(
    null
  );
  const [disconnectPendingChannel, setDisconnectPendingChannel] =
    useState<ChannelConfig | null>(null);
  const [showMlTestTools, setShowMlTestTools] = useState(false);
  const [copiedTestField, setCopiedTestField] = useState("");
  const [infoModal, setInfoModal] = useState<RentaInfoContent | null>(null);
  const oauthHandledRef = useRef(false);

  const selectedChannel = useMemo(() => {
    return channels.find((channel) => channel.canal === selectedCode) || channels[0];
  }, [channels, selectedCode]);

  const connectedCount = channels.filter(
    (channel) => channel.estatus === "CONECTADO"
  ).length;
  const activeCount = channels.filter((channel) => channel.activo).length;
  const autoCount = channels.filter(
    (channel) => channel.activo && channel.publicar_automaticamente
  ).length;
  const selectedIsMercadoLibre = selectedChannel?.canal === "MERCADO_LIBRE";
  const selectedIsEasyBroker = selectedChannel?.canal === "EASYBROKER";
  const selectedIsConstructionChannel =
    selectedChannel?.canal === "AIRBNB" || selectedChannel?.canal === "BOOKING";
  const selectedIsAssisted = Boolean(
    selectedChannel &&
      !selectedIsEasyBroker &&
      (ASSISTED_CHANNEL_CODES.has(selectedChannel.canal) ||
        selectedChannel.modo_integracion === "PARTNER" ||
        selectedChannel.modo_integracion === "OPERACION_MANUAL")
  );
  const selectedShowsTechnicalApi = Boolean(
    selectedChannel &&
      !selectedIsMercadoLibre &&
      !selectedIsEasyBroker &&
      !selectedIsAssisted
  );
  const showInternalMlTestTools =
    Boolean(user?.is_platform_admin) || showMlTestTools;
  const mercadoLibreWebhookUrl = `${RENTA_API_BASE}/webhooks/mercadolibre/TU_TOKEN_SECRETO/`;

  const loadChannels = useCallback(async () => {
    if (!entidadId) {
      setLoading(false);
      setError("No se encontro la entidad para configurar canales.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `${RENTA_API_BASE}/entidades/${entidadId}/canales/`,
        { cache: "no-store" }
      );
      if (!response.ok) {
        throw new Error("No se pudieron cargar los canales de renta.");
      }
      const body = (await response.json()) as ChannelsResponse;
      setChannels(body.channels);
      setSelectedCode((current) => current || body.channels[0]?.canal || "");
    } catch (loadError) {
      console.error("Error cargando canales de renta:", loadError);
      setError(
        loadError instanceof Error
          ? loadError.message
          : "No se pudieron cargar los canales de renta."
      );
      setChannels([]);
    } finally {
      setLoading(false);
    }
  }, [entidadId]);

  useEffect(() => {
    void loadChannels();
  }, [loadChannels]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      const params = new URLSearchParams(window.location.search);
      setShowMlTestTools(
        params.get("ml_test_tools") === "1" ||
          window.localStorage.getItem("betterp-ml-test-tools") === "true"
      );
    } catch {
      setShowMlTestTools(false);
    }
  }, []);

  const updateChannel = (canal: string, patch: Partial<ChannelConfig>) => {
    setChannels((current) =>
      current.map((channel) =>
        channel.canal === canal ? { ...channel, ...patch } : channel
      )
    );
  };

  const updateCommercialRule = (
    canal: string,
    field: CommercialRuleField,
    rawValue: string,
    maxValue: number
  ) => {
    updateChannel(canal, {
      [field]: sanitizeCommercialNumberInput(rawValue, maxValue),
    } as Partial<ChannelConfig>);
  };

  const updateCredentials = (
    canal: string,
    patch: Partial<ChannelCredentials>
  ) => {
    setChannels((current) =>
      current.map((channel) =>
        channel.canal === canal
          ? {
              ...channel,
              credenciales: { ...channel.credenciales, ...patch },
            }
          : channel
      )
    );
  };

  const saveChannel = async (channel: ChannelConfig, silent = false) => {
    if (!entidadId) {
      return null;
    }
    setSavingCode(channel.canal);
    setError("");
    try {
      const commercialRules = {
        comision_porcentaje: boundedCommercialNumber(
          channel.comision_porcentaje,
          COMMERCIAL_PERCENT_MAX
        ),
        ajuste_temporada_porcentaje: boundedCommercialNumber(
          channel.ajuste_temporada_porcentaje,
          COMMERCIAL_PERCENT_MAX
        ),
        promocion_porcentaje: boundedCommercialNumber(
          channel.promocion_porcentaje,
          COMMERCIAL_PERCENT_MAX
        ),
        comision_monto_fijo: boundedCommercialNumber(
          channel.comision_monto_fijo,
          COMMERCIAL_FIXED_AMOUNT_MAX
        ),
        ajuste_temporada_monto_fijo: boundedCommercialNumber(
          channel.ajuste_temporada_monto_fijo,
          COMMERCIAL_FIXED_AMOUNT_MAX
        ),
        promocion_monto_fijo: boundedCommercialNumber(
          channel.promocion_monto_fijo,
          COMMERCIAL_FIXED_AMOUNT_MAX
        ),
      };
      const response = await fetch(
        `${RENTA_API_BASE}/entidades/${entidadId}/canales/${channel.canal}/`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            canal: channel.canal,
            activo: channel.activo,
            modo_integracion: channel.modo_integracion,
            credenciales: channel.credenciales,
            comision_porcentaje: commercialRules.comision_porcentaje,
            ajuste_temporada_porcentaje:
              commercialRules.ajuste_temporada_porcentaje,
            promocion_porcentaje: commercialRules.promocion_porcentaje,
            comision_monto_fijo: commercialRules.comision_monto_fijo,
            ajuste_temporada_monto_fijo:
              commercialRules.ajuste_temporada_monto_fijo,
            promocion_monto_fijo: commercialRules.promocion_monto_fijo,
            publicar_automaticamente: channel.publicar_automaticamente,
            pausar_si_ocupado: channel.pausar_si_ocupado,
            registrar_origen_contratacion: channel.registrar_origen_contratacion,
            notas: channel.notas || "",
          }),
        }
      );
      const body = (await parseJsonResponse(response)) as
        | { mensaje: string; channel: ChannelConfig }
        | { detail?: unknown }
        | null;
      if (!response.ok) {
        throw new Error(extractErrorMessage(body, "No se pudo guardar el canal."));
      }
      const nextChannel = (body as { channel: ChannelConfig }).channel;
      updateChannel(channel.canal, nextChannel);
      if (!silent) {
        setSuccess("Configuracion del canal guardada.");
        window.setTimeout(() => setSuccess(""), 2600);
      }
      return nextChannel;
    } catch (saveError) {
      console.error("Error guardando canal de renta:", saveError);
      setError(
        saveError instanceof Error
          ? saveError.message
          : "No se pudo guardar el canal."
      );
      return null;
    } finally {
      setSavingCode(null);
    }
  };

  const beginMercadoLibreOAuth = async (channel: ChannelConfig) => {
    if (!entidadId) {
      return;
    }
    setSavingCode(channel.canal);
    setError("");
    try {
      const savedChannel = await saveChannel(channel, true);
      if (!savedChannel) {
        return;
      }
      const response = await fetch(
        `${RENTA_API_BASE}/entidades/${entidadId}/canales/${channel.canal}/oauth/start/`,
        { method: "POST" }
      );
      const body = (await parseJsonResponse(response)) as
        | { auth_url?: string; detail?: unknown }
        | null;
      if (!response.ok) {
        throw new Error(
          extractErrorMessage(body, "No se pudo iniciar la conexion con Mercado Libre.")
        );
      }
      if (!body?.auth_url) {
        throw new Error("Mercado Libre no regreso una URL de autorizacion.");
      }
      window.location.assign(body.auth_url);
    } catch (oauthError) {
      console.error("Error iniciando OAuth de Mercado Libre:", oauthError);
      setError(
        oauthError instanceof Error
          ? oauthError.message
          : "No se pudo iniciar la conexion con Mercado Libre."
      );
    } finally {
      setSavingCode(null);
    }
  };

  const completeMercadoLibreOAuth = useCallback(async () => {
    if (oauthHandledRef.current || typeof window === "undefined") {
      return;
    }
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code") || "";
    const state = url.searchParams.get("state") || "";
    const oauthError = url.searchParams.get("error") || "";
    const oauthErrorDescription = url.searchParams.get("error_description") || "";
    if (!code && !state && !oauthError) {
      return;
    }
    oauthHandledRef.current = true;
    setSavingCode("MERCADO_LIBRE");
    setError("");
    try {
      const response = await fetch(`${RENTA_API_BASE}/mercadolibre/oauth/callback/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          state,
          error: oauthError,
          error_description: oauthErrorDescription,
        }),
      });
      const body = (await parseJsonResponse(response)) as
        | {
            mensaje?: string;
            entidad_id?: number;
            canal?: string;
            channel?: ChannelConfig;
            detail?: unknown;
          }
        | null;
      if (!response.ok) {
        throw new Error(
          extractErrorMessage(body, "No se pudo completar la conexion con Mercado Libre.")
        );
      }
      if (body?.entidad_id) {
        onEntidadSeleccionada?.(body.entidad_id);
      }
      if (body?.channel) {
        updateChannel(body.channel.canal, body.channel);
        setSelectedCode(body.channel.canal);
      }
      await loadChannels();
      setSuccess(body?.mensaje || "Mercado Libre conectado correctamente.");
      window.setTimeout(() => setSuccess(""), 3600);
    } catch (callbackError) {
      console.error("Error completando OAuth de Mercado Libre:", callbackError);
      setError(
        callbackError instanceof Error
          ? callbackError.message
          : "No se pudo completar la conexion con Mercado Libre."
      );
    } finally {
      url.searchParams.delete("code");
      url.searchParams.delete("state");
      url.searchParams.delete("error");
      url.searchParams.delete("error_description");
      const nextSearch = url.searchParams.toString();
      window.history.replaceState(
        {},
        "",
        `${url.pathname}${nextSearch ? `?${nextSearch}` : ""}${url.hash}`
      );
      setSavingCode(null);
    }
  }, [loadChannels, onEntidadSeleccionada]);

  useEffect(() => {
    void completeMercadoLibreOAuth();
  }, [completeMercadoLibreOAuth]);

  const copyTestCredential = async (field: string, value: string) => {
    if (!value) {
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      setCopiedTestField(field);
      window.setTimeout(() => setCopiedTestField(""), 1800);
    } catch {
      setError(
        "No se pudo copiar al portapapeles. Selecciona el dato manualmente."
      );
    }
  };

  const createMercadoLibreTestUser = async (channel: ChannelConfig) => {
    if (!entidadId) {
      return;
    }
    setSavingCode(channel.canal);
    setError("");
    try {
      const response = await fetch(
        `${RENTA_API_BASE}/entidades/${entidadId}/canales/${channel.canal}/mercadolibre/test-user/`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ site_id: "MLM" }),
        }
      );
      const body = (await parseJsonResponse(response)) as
        | {
            mensaje?: string;
            channel?: ChannelConfig;
            test_user?: {
              nickname?: string;
              password?: string;
              site_id?: string;
              siteId?: string;
            };
            detail?: unknown;
          }
        | null;
      if (!response.ok) {
        throw new Error(
          extractErrorMessage(body, "No se pudo crear el usuario de prueba.")
        );
      }
      if (body?.channel) {
        updateChannel(body.channel.canal, body.channel);
      }
      const nickname = body?.test_user?.nickname;
      const password = body?.test_user?.password;
      if (nickname && password) {
        setTestAccess({
          nickname,
          password,
          siteId:
            body?.test_user?.site_id ||
            body?.test_user?.siteId ||
            body?.channel?.credenciales.test_user_site_id ||
            "MLM",
        });
        setSuccess(
          "Usuario test creado. Copia sus accesos y reconecta Mercado Libre con esa cuenta."
        );
      } else {
        setSuccess(body?.mensaje || "Usuario test creado.");
      }
      window.setTimeout(() => setSuccess(""), 9000);
    } catch (testUserError) {
      console.error("Error creando usuario test de Mercado Libre:", testUserError);
      setError(
        testUserError instanceof Error
          ? testUserError.message
          : "No se pudo crear el usuario de prueba."
      );
    } finally {
      setSavingCode(null);
    }
  };

  const disconnectMercadoLibre = async (channel: ChannelConfig) => {
    if (!entidadId) {
      return;
    }
    setSavingCode(channel.canal);
    setError("");
    try {
      const response = await fetch(
        `${RENTA_API_BASE}/entidades/${entidadId}/canales/${channel.canal}/mercadolibre/logout/`,
        { method: "POST" }
      );
      const body = (await parseJsonResponse(response)) as
        | { mensaje?: string; channel?: ChannelConfig; detail?: unknown }
        | null;
      if (!response.ok) {
        throw new Error(
          extractErrorMessage(body, "No se pudo cerrar la sesion de Mercado Libre.")
        );
      }
      if (body?.channel) {
        updateChannel(body.channel.canal, body.channel);
      }
      setDisconnectPendingChannel(null);
      setSuccess(body?.mensaje || "Sesion de Mercado Libre cerrada.");
      window.setTimeout(() => setSuccess(""), 4200);
    } catch (disconnectError) {
      console.error("Error cerrando sesion de Mercado Libre:", disconnectError);
      setError(
        disconnectError instanceof Error
          ? disconnectError.message
          : "No se pudo cerrar la sesion de Mercado Libre."
      );
    } finally {
      setSavingCode(null);
    }
  };

  const validateChannel = async (channel: ChannelConfig) => {
    if (!entidadId) {
      return;
    }
    setSavingCode(channel.canal);
    setError("");
    try {
      const response = await fetch(
        `${RENTA_API_BASE}/entidades/${entidadId}/canales/${channel.canal}/validar/`,
        { method: "POST" }
      );
      const body = (await parseJsonResponse(response)) as
        | { mensaje: string; channel: ChannelConfig }
        | { detail?: unknown }
        | null;
      if (!response.ok) {
        throw new Error(extractErrorMessage(body, "No se pudo validar el canal."));
      }
      const nextChannel = (body as { channel: ChannelConfig }).channel;
      updateChannel(channel.canal, nextChannel);
      setSuccess("Validacion del canal registrada.");
      window.setTimeout(() => setSuccess(""), 2600);
    } catch (validateError) {
      console.error("Error validando canal de renta:", validateError);
      setError(
        validateError instanceof Error
          ? validateError.message
          : "No se pudo validar el canal."
      );
    } finally {
      setSavingCode(null);
    }
  };

  if (loading) {
    return (
      <section className="page-section">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 py-16 text-center text-zinc-500">
          Cargando configuracion de canales...
        </div>
      </section>
    );
  }

  if (!selectedChannel) {
    return (
      <section className="page-section space-y-3">
        {error ? (
          <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        ) : null}
        <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/20 px-6 py-12 text-center text-zinc-500">
          <p>
            {error
              ? "No se pudo cargar la configuracion de conexiones."
              : "No hay canales configurables para esta entidad."}
          </p>
          {entidadId ? (
            <button
              type="button"
              onClick={() => void loadChannels()}
              className="mt-4 rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20"
            >
              Reintentar
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <section className="page-section space-y-5">
      <RentaInfoModal info={infoModal} onClose={() => setInfoModal(null)} />

      {success ? (
        <div className="fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-4 py-2 text-sm text-emerald-300 shadow-lg">
          {success}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      ) : null}

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
            Resumen de canales
          </p>
          <RentaInfoButton info={channelInfo.resumen} onOpen={setInfoModal} />
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="metric-card-compact border-zinc-800 bg-zinc-950/80">
            <p className="metric-label-compact">Canales</p>
            <p className="metric-value-compact">{channels.length}</p>
          </div>
          <div className="metric-card-compact border-emerald-500/20 bg-emerald-500/10">
            <p className="metric-label-compact text-emerald-200/80">Conectados</p>
            <p className="metric-value-compact text-emerald-300">{connectedCount}</p>
          </div>
          <div className="metric-card-compact border-cyan-500/20 bg-cyan-500/10">
            <p className="metric-label-compact text-cyan-200/80">Activos</p>
            <p className="metric-value-compact text-cyan-300">{activeCount}</p>
          </div>
          <div className="metric-card-compact border-amber-500/20 bg-amber-500/10">
            <p className="metric-label-compact text-amber-200/80">Automaticos</p>
            <p className="metric-value-compact text-amber-300">{autoCount}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[360px_1fr]">
        <div className="space-y-3">
          <div className="flex items-center gap-2 px-1">
            <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
              Canales disponibles
            </p>
            <RentaInfoButton info={channelInfo.lista} onOpen={setInfoModal} />
          </div>
          {channels.map((channel) => (
            <button
              key={channel.canal}
              type="button"
              onClick={() => setSelectedCode(channel.canal)}
              className={`w-full rounded-2xl border p-4 text-left transition-colors ${
                selectedChannel.canal === channel.canal
                  ? "border-cyan-500/30 bg-cyan-500/10"
                  : "border-zinc-800 bg-zinc-950/70 hover:border-zinc-700"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-white">
                    {channel.label}
                  </p>
                  <p className="mt-1 text-xs text-zinc-500">
                    {modeLabel(channel.modo_integracion)}
                  </p>
                </div>
                <span
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${statusStyles(
                    channel.estatus
                  )}`}
                >
                  {channel.estatus}
                </span>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-zinc-400">
                {channel.summary}
              </p>
            </button>
          ))}
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-5">
          <div className="flex flex-col gap-3 border-b border-zinc-800 pb-4 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-2xl font-semibold text-white">
                  {selectedChannel.label}
                </h2>
                <RentaInfoButton info={channelInfo.conexion} onOpen={setInfoModal} />
                <span
                  className={`rounded-full border px-2.5 py-1 text-xs font-medium ${statusStyles(
                    selectedChannel.estatus
                  )}`}
                >
                  {selectedChannel.estatus}
                </span>
              </div>
              <p className="mt-2 max-w-2xl text-sm text-zinc-400">
                {selectedIsMercadoLibre
                  ? "Conecta Mercado Libre como canal tecnico; Metros Cubicos se atiende como alcance de esa misma publicacion cuando la cuenta y categoria lo permiten."
                  : selectedIsEasyBroker
                    ? "EasyBroker lo trabajamos bajo solicitud para configurar correctamente inventario, publicacion y seguimiento sin exponer credenciales al usuario final."
                  : selectedIsAssisted
                    ? selectedIsConstructionChannel
                      ? "Canal en construccion. BettERP conserva la configuracion base mientras cerramos el flujo operativo seguro."
                      : "BettERP prepara ficha, fotos, precio y pasos para operar el canal sin pedir tokens al usuario final."
                    : "Conecta la cuenta y define reglas simples. BettERP toma la disponibilidad real del espacio: si esta libre prepara la publicacion, si se ocupa la pausa o baja para evitar dobles rentas."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {selectedChannel.canal === "MERCADO_LIBRE" ? (
                <>
                  <button
                    type="button"
                    onClick={() => void beginMercadoLibreOAuth(selectedChannel)}
                    disabled={savingCode === selectedChannel.canal}
                    className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-200 transition-colors hover:bg-emerald-500/20 disabled:opacity-50"
                  >
                    {selectedChannel.credenciales.access_token_configurado
                      ? "Reconectar ML"
                      : "Conectar ML"}
                  </button>
                  {selectedChannel.credenciales.access_token_configurado ? (
                    <button
                      type="button"
                      onClick={() => setDisconnectPendingChannel(selectedChannel)}
                      disabled={savingCode === selectedChannel.canal}
                      className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-800 disabled:opacity-50"
                    >
                      Cerrar sesion ML
                    </button>
                  ) : null}
                </>
              ) : null}
              <button
                type="button"
                onClick={() => void validateChannel(selectedChannel)}
                disabled={savingCode === selectedChannel.canal}
                className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800 disabled:opacity-50"
              >
                Validar
              </button>
              <button
                type="button"
                onClick={() => void saveChannel(selectedChannel)}
                disabled={savingCode === selectedChannel.canal}
                className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20 disabled:opacity-50"
              >
                {savingCode === selectedChannel.canal ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <div className="space-y-4">
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4">
                <div className="flex items-center gap-2">
                  <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
                    Conexion
                  </p>
                  <RentaInfoButton
                    info={channelInfo.conexion}
                    onOpen={setInfoModal}
                  />
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {selectedChannel.canal === "MERCADO_LIBRE" &&
                  (selectedChannel.credenciales.ml_nickname ||
                    selectedChannel.credenciales.test_user_nickname) ? (
                    <div className="sm:col-span-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-100">
                      <p className="text-xs uppercase tracking-[0.16em] text-emerald-200/70">
                        Conexion Mercado Libre / Metros Cubicos
                      </p>
                      <p className="mt-2 font-medium">
                        {selectedChannel.credenciales.ml_nickname
                          ? `Cuenta conectada: ${selectedChannel.credenciales.ml_nickname}`
                          : "Cuenta conectada"}
                      </p>
                      {showInternalMlTestTools &&
                      selectedChannel.credenciales.test_user_nickname ? (
                        <div className="mt-3 rounded-lg border border-blue-500/20 bg-blue-500/10 p-3 text-xs text-blue-100">
                          <p className="uppercase tracking-[0.14em] text-blue-200/70">
                            Usuario test creado
                          </p>
                          <p className="mt-1 font-semibold text-white">
                            {selectedChannel.credenciales.test_user_nickname}
                          </p>
                          <p className="mt-1 leading-relaxed text-blue-100/70">
                            Para probar publicaciones, cierra sesion en Mercado
                            Libre, entra con este usuario y usa Reconectar ML.
                          </p>
                        </div>
                      ) : null}
                      {showInternalMlTestTools ? (
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-100">
                          <div>
                            <p className="uppercase tracking-[0.14em] text-amber-200/70">
                              Herramienta interna de pruebas
                            </p>
                            <p className="mt-1 text-amber-100/75">
                              Crea usuarios test solo para validar flujos de
                              sandbox o cambios de cuenta.
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              void createMercadoLibreTestUser(selectedChannel)
                            }
                            disabled={
                              savingCode === selectedChannel.canal ||
                              !selectedChannel.credenciales.access_token_configurado
                            }
                            className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-100 transition-colors hover:bg-amber-500/20 disabled:opacity-50"
                          >
                            Crear usuario test
                          </button>
                        </div>
                      ) : null}
                      <div className="mt-3 rounded-lg border border-emerald-500/20 bg-zinc-950/40 p-2 text-xs text-emerald-100/80">
                        <span className="text-emerald-200/60">
                          Publicacion preferida:
                        </span>{" "}
                        <span className="font-medium text-white">
                          {listingTypeLabel(
                            selectedChannel.credenciales.listing_type_id
                          )}
                        </span>
                        {selectedChannel.credenciales.ml_listing_types?.length ? (
                          <span className="ml-1 text-emerald-200/60">
                            | disponibles:{" "}
                            {selectedChannel.credenciales.ml_listing_types
                              .map(listingTypeLabel)
                              .join(", ")}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-2 rounded-lg border border-cyan-500/20 bg-cyan-500/10 p-2 text-xs leading-relaxed text-cyan-100/80">
                        Metros Cubicos se maneja dentro del alcance de Mercado
                        Libre Inmuebles; no requiere una conexion separada.
                      </p>
                      <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                        <div className="rounded-lg border border-emerald-500/20 bg-zinc-950/40 p-2">
                          <p className="font-semibold text-white">
                            {compactNumber(
                              selectedChannel.credenciales.traffic_views_total
                            )}
                          </p>
                          <p className="mt-1 text-emerald-200/70">vistas</p>
                        </div>
                        <div className="rounded-lg border border-emerald-500/20 bg-zinc-950/40 p-2">
                          <p className="font-semibold text-white">
                            {compactNumber(
                              selectedChannel.credenciales.traffic_leads_total
                            )}
                          </p>
                          <p className="mt-1 text-emerald-200/70">leads</p>
                        </div>
                        <div className="rounded-lg border border-emerald-500/20 bg-zinc-950/40 p-2">
                          <p className="font-semibold text-white">
                            {compactNumber(
                              selectedChannel.credenciales.webhook_events_total
                            )}
                          </p>
                          <p className="mt-1 text-emerald-200/70">eventos</p>
                        </div>
                      </div>
                    </div>
                  ) : null}
                  {selectedIsMercadoLibre ? (
                    <div className="sm:col-span-2 rounded-xl border border-cyan-500/20 bg-cyan-500/10 p-3 text-sm text-cyan-100">
                      <p className="text-xs uppercase tracking-[0.16em] text-cyan-200/70">
                        Webhook listo para Mercado Libre
                      </p>
                      <p className="mt-2 break-all text-xs text-cyan-100/90">
                        {mercadoLibreWebhookUrl}
                      </p>
                      <p className="mt-2 text-xs leading-relaxed text-cyan-100/70">
                        Usalo en la app de Mercado Libre para recibir preguntas,
                        mensajes, publicaciones y eventos. BettERP conserva el
                        historico para medir vistas, leads y avisos operativos.
                      </p>
                    </div>
                  ) : null}
                  {selectedIsEasyBroker ? (
                    <div className="sm:col-span-2 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-100">
                      <p className="text-xs uppercase tracking-[0.16em] text-amber-200/70">
                        Bajo solicitud
                      </p>
                      <p className="mt-2 font-medium text-white">
                        EasyBroker se activa con acompaniamiento BetterP.
                      </p>
                      <p className="mt-2 text-xs leading-relaxed text-amber-100/75">
                        Lo trabajamos bajo solicitud para revisar cuenta,
                        mapeo de inventario, politicas de publicacion y reglas
                        de pausa antes de encender el canal.
                      </p>
                    </div>
                  ) : null}
                  {selectedIsAssisted ? (
                    <>
                      <div className="sm:col-span-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-100">
                        <p className="text-xs uppercase tracking-[0.16em] text-emerald-200/70">
                          {selectedIsConstructionChannel
                            ? "Canal en construccion"
                            : "Operacion asistida"}
                        </p>
                        <p className="mt-2 text-xs leading-relaxed text-emerald-100/80">
                          {selectedIsConstructionChannel
                            ? "Estamos preparando el flujo para publicar con control de disponibilidad, calendario y reglas del proveedor. Por ahora queda visible como canal futuro."
                            : "Este canal no requiere tokens visibles. BettERP prepara titulo, descripcion, precio, fotos y pasos para publicar; despues puedes marcar el anuncio como publicado y pegar su liga."}
                        </p>
                      </div>
                      {!selectedIsConstructionChannel ? (
                        <>
                          <label className="space-y-1.5 text-sm text-zinc-300">
                            Cuenta o perfil
                            <input
                              value={selectedChannel.credenciales.account_id || ""}
                              onChange={(event) =>
                                updateCredentials(selectedChannel.canal, {
                                  account_id: event.target.value,
                                })
                              }
                              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                              placeholder="Usuario, host o nombre de cuenta"
                            />
                          </label>
                          <label className="space-y-1.5 text-sm text-zinc-300">
                            URL de perfil o panel
                            <input
                              value={
                                selectedChannel.credenciales.profile_url || ""
                              }
                              onChange={(event) =>
                                updateCredentials(selectedChannel.canal, {
                                  profile_url: event.target.value,
                                })
                              }
                              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                              placeholder="https://..."
                            />
                          </label>
                          <label className="space-y-1.5 text-sm text-zinc-300">
                            Segmento
                            <input
                              value={
                                selectedChannel.credenciales.listing_segment || ""
                              }
                              onChange={(event) =>
                                updateCredentials(selectedChannel.canal, {
                                  listing_segment: event.target.value,
                                })
                              }
                              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                              placeholder="habitaciones, estancias, coliving..."
                            />
                          </label>
                          <label className="space-y-1.5 text-sm text-zinc-300">
                            Contacto operativo
                            <input
                              value={
                                selectedChannel.credenciales.contact_url || ""
                              }
                              onChange={(event) =>
                                updateCredentials(selectedChannel.canal, {
                                  contact_url: event.target.value,
                                })
                              }
                              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                              placeholder="Email, WhatsApp o URL interna"
                            />
                          </label>
                        </>
                      ) : null}
                    </>
                  ) : null}
                  <label
                    className={`space-y-1.5 text-sm text-zinc-300 ${
                      selectedShowsTechnicalApi ? "" : "hidden"
                    }`}
                  >
                    Cuenta o usuario
                    <input
                      value={selectedChannel.credenciales.account_id || ""}
                      onChange={(event) =>
                        updateCredentials(selectedChannel.canal, {
                          account_id: event.target.value,
                        })
                      }
                      className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                      placeholder="ID de cuenta"
                    />
                  </label>
                  <label
                    className={`space-y-1.5 text-sm text-zinc-300 ${
                      selectedShowsTechnicalApi ? "" : "hidden"
                    }`}
                  >
                    Cliente / App ID
                    <input
                      value={selectedChannel.credenciales.client_id || ""}
                      onChange={(event) =>
                        updateCredentials(selectedChannel.canal, {
                          client_id: event.target.value,
                        })
                      }
                      className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                      placeholder="Client ID"
                    />
                  </label>
                  <label
                    className={`space-y-1.5 text-sm text-zinc-300 ${
                      selectedShowsTechnicalApi ? "" : "hidden"
                    }`}
                  >
                    Propiedad / sucursal
                    <input
                      value={selectedChannel.credenciales.property_id || ""}
                      onChange={(event) =>
                        updateCredentials(selectedChannel.canal, {
                          property_id: event.target.value,
                        })
                      }
                      className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                      placeholder="ID externo"
                    />
                  </label>
                  <label
                    className={`space-y-1.5 text-sm text-zinc-300 ${
                      selectedShowsTechnicalApi ? "" : "hidden"
                    }`}
                  >
                    Modo
                    <select
                      value={selectedChannel.modo_integracion}
                      onChange={(event) =>
                        updateChannel(selectedChannel.canal, {
                          modo_integracion: event.target.value,
                        })
                      }
                      className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                    >
                      <option value="API_DIRECTA">API directa</option>
                      <option value="PARTNER">Partner</option>
                      <option value="OPERACION_MANUAL">Operacion manual</option>
                    </select>
                  </label>
                  <label
                    className={`space-y-1.5 text-sm text-zinc-300 ${
                      selectedShowsTechnicalApi ? "" : "hidden"
                    }`}
                  >
                    Ambiente API
                    <select
                      value={selectedChannel.credenciales.environment || "sandbox"}
                      onChange={(event) =>
                        updateCredentials(selectedChannel.canal, {
                          environment: event.target.value,
                        })
                      }
                      className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                    >
                      <option value="sandbox">Sandbox / pruebas</option>
                      <option value="production">Produccion</option>
                    </select>
                  </label>
                  <label
                    className={`space-y-1.5 text-sm text-zinc-300 ${
                      selectedShowsTechnicalApi ? "" : "hidden"
                    }`}
                  >
                    Segmento
                    <input
                      value={selectedChannel.credenciales.listing_segment || ""}
                      onChange={(event) =>
                        updateCredentials(selectedChannel.canal, {
                          listing_segment: event.target.value,
                        })
                      }
                      className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                      placeholder="rentas, hospedaje, inmuebles..."
                    />
                  </label>
                  <label
                    className={`space-y-1.5 text-sm text-zinc-300 ${
                      selectedShowsTechnicalApi ? "" : "hidden"
                    }`}
                  >
                    Cuenta partner
                    <input
                      value={selectedChannel.credenciales.partner_account || ""}
                      onChange={(event) =>
                        updateCredentials(selectedChannel.canal, {
                          partner_account: event.target.value,
                        })
                      }
                      className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                      placeholder="Partner, host, seller o hotel id"
                    />
                  </label>
                  <label
                    className={`space-y-1.5 text-sm text-zinc-300 ${
                      selectedShowsTechnicalApi ? "" : "hidden"
                    }`}
                  >
                    API key
                    <input
                      value={selectedChannel.credenciales.api_key || ""}
                      onChange={(event) =>
                        updateCredentials(selectedChannel.canal, {
                          api_key: event.target.value,
                        })
                      }
                      className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                      placeholder={
                        selectedChannel.credenciales.api_key_configurada
                          ? "Configurada"
                          : "Nueva API key"
                      }
                      type="password"
                    />
                  </label>
                  <label
                    className={`space-y-1.5 text-sm text-zinc-300 ${
                      selectedShowsTechnicalApi ? "" : "hidden"
                    }`}
                  >
                    {selectedIsMercadoLibre ? "Client secret" : "API secret"}
                    <input
                      value={selectedChannel.credenciales.api_secret || ""}
                      onChange={(event) =>
                        updateCredentials(selectedChannel.canal, {
                          api_secret: event.target.value,
                        })
                      }
                      className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                      placeholder={
                        selectedChannel.credenciales.api_secret_configurado
                          ? "Configurado"
                          : "Nuevo secreto"
                      }
                      type="password"
                    />
                  </label>
                  <label
                    className={`space-y-1.5 text-sm text-zinc-300 ${
                      selectedShowsTechnicalApi ? "" : "hidden"
                    }`}
                  >
                    Access token
                    <input
                      value={selectedChannel.credenciales.access_token || ""}
                      onChange={(event) =>
                        updateCredentials(selectedChannel.canal, {
                          access_token: event.target.value,
                        })
                      }
                      className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                      placeholder={
                        selectedChannel.credenciales.access_token_configurado
                          ? "Configurado"
                          : "Nuevo token"
                      }
                      type="password"
                    />
                  </label>
                  <label
                    className={`space-y-1.5 text-sm text-zinc-300 sm:col-span-2 ${
                      selectedShowsTechnicalApi ? "" : "hidden"
                    }`}
                  >
                    Refresh token
                    <input
                      value={selectedChannel.credenciales.refresh_token || ""}
                      onChange={(event) =>
                        updateCredentials(selectedChannel.canal, {
                          refresh_token: event.target.value,
                        })
                      }
                      className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                      placeholder={
                        selectedChannel.credenciales.refresh_token_configurado
                          ? "Configurado"
                          : "Nuevo refresh token"
                      }
                      type="password"
                    />
                  </label>
                  <label
                    className={`space-y-1.5 text-sm text-zinc-300 sm:col-span-2 ${
                      selectedShowsTechnicalApi ? "" : "hidden"
                    }`}
                  >
                    Redirect URI
                    <input
                      value={selectedChannel.credenciales.redirect_uri || ""}
                      onChange={(event) =>
                        updateCredentials(selectedChannel.canal, {
                          redirect_uri: event.target.value,
                        })
                      }
                      className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                      placeholder="https://betterp.net/renta-espacios/oauth/callback"
                    />
                  </label>
                  <label
                    className={`space-y-1.5 text-sm text-zinc-300 sm:col-span-2 ${
                      selectedShowsTechnicalApi ? "" : "hidden"
                    }`}
                  >
                    Webhook URL
                    <input
                      value={selectedChannel.credenciales.webhook_url || ""}
                      onChange={(event) =>
                        updateCredentials(selectedChannel.canal, {
                          webhook_url: event.target.value,
                        })
                      }
                      className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                      placeholder="https://api.betterp.net/api/renta-espacios/webhooks/..."
                    />
                  </label>
                </div>
              </div>

              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4">
                <div className="flex items-center gap-2">
                  <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
                    Automatizacion
                  </p>
                  <RentaInfoButton
                    info={channelInfo.automatizacion}
                    onOpen={setInfoModal}
                  />
                </div>
                <div className="mt-4 space-y-3">
                  {[
                    [
                      "activo",
                      "Canal activo",
                      "Permite que este proveedor participe en la publicacion.",
                    ],
                    [
                      "publicar_automaticamente",
                      "Publicar al detectar disponibilidad",
                      "Si un espacio queda disponible, se prepara para salir al canal.",
                    ],
                    [
                      "pausar_si_ocupado",
                      "Pausar al ocuparse",
                      "Si se asigna o renta el espacio, BettERP lo baja del canal.",
                    ],
                    [
                      "registrar_origen_contratacion",
                      "Registrar origen de contratacion",
                      "Guarda de que plataforma vino la operacion comercial.",
                    ],
                  ].map(([key, title, detail]) => (
                    <label
                      key={key}
                      className="flex items-start gap-3 rounded-xl border border-zinc-800 bg-zinc-950/70 p-3"
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(
                          selectedChannel[key as keyof ChannelConfig]
                        )}
                        onChange={(event) =>
                          updateChannel(selectedChannel.canal, {
                            [key]: event.target.checked,
                          } as Partial<ChannelConfig>)
                        }
                        className="mt-1 h-4 w-4 rounded border-zinc-700 bg-zinc-950 text-cyan-500"
                      />
                      <span>
                        <span className="block text-sm font-medium text-white">
                          {title}
                        </span>
                        <span className="mt-1 block text-xs leading-relaxed text-zinc-500">
                          {detail}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4">
                <div className="flex items-center gap-2">
                  <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
                    Reglas comerciales
                  </p>
                  <RentaInfoButton
                    info={channelInfo.reglas}
                    onOpen={setInfoModal}
                  />
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  <label className="space-y-1.5 text-sm text-zinc-300">
                    <span className="flex items-center gap-2">
                      Comision %
                      <RentaInfoButton
                        info={commercialRuleInfo.comision_porcentaje}
                        onOpen={setInfoModal}
                        className="h-5 w-5 text-[10px]"
                      />
                    </span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={numberInputValue(selectedChannel.comision_porcentaje)}
                      onChange={(event) =>
                        updateCommercialRule(
                          selectedChannel.canal,
                          "comision_porcentaje",
                          event.target.value,
                          COMMERCIAL_PERCENT_MAX
                        )
                      }
                      maxLength={7}
                      className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                    />
                    <span className="block text-xs text-zinc-500">
                      0 a 9,999; hasta 2 decimales.
                    </span>
                  </label>
                  <label className="space-y-1.5 text-sm text-zinc-300">
                    <span className="flex items-center gap-2">
                      Temporada alta %
                      <RentaInfoButton
                        info={commercialRuleInfo.ajuste_temporada_porcentaje}
                        onOpen={setInfoModal}
                        className="h-5 w-5 text-[10px]"
                      />
                    </span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={numberInputValue(
                        selectedChannel.ajuste_temporada_porcentaje
                      )}
                      onChange={(event) =>
                        updateCommercialRule(
                          selectedChannel.canal,
                          "ajuste_temporada_porcentaje",
                          event.target.value,
                          COMMERCIAL_PERCENT_MAX
                        )
                      }
                      maxLength={7}
                      className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                    />
                    <span className="block text-xs text-zinc-500">
                      0 a 9,999; hasta 2 decimales.
                    </span>
                  </label>
                  <label className="space-y-1.5 text-sm text-zinc-300">
                    <span className="flex items-center gap-2">
                      Promocion %
                      <RentaInfoButton
                        info={commercialRuleInfo.promocion_porcentaje}
                        onOpen={setInfoModal}
                        className="h-5 w-5 text-[10px]"
                      />
                    </span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={numberInputValue(selectedChannel.promocion_porcentaje)}
                      onChange={(event) =>
                        updateCommercialRule(
                          selectedChannel.canal,
                          "promocion_porcentaje",
                          event.target.value,
                          COMMERCIAL_PERCENT_MAX
                        )
                      }
                      maxLength={7}
                      className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                    />
                    <span className="block text-xs text-zinc-500">
                      0 a 9,999; hasta 2 decimales.
                    </span>
                  </label>
                  <label className="space-y-1.5 text-sm text-zinc-300">
                    <span className="flex items-center gap-2">
                      Comision fija
                      <RentaInfoButton
                        info={commercialRuleInfo.comision_monto_fijo}
                        onOpen={setInfoModal}
                        className="h-5 w-5 text-[10px]"
                      />
                    </span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={numberInputValue(selectedChannel.comision_monto_fijo)}
                      onChange={(event) =>
                        updateCommercialRule(
                          selectedChannel.canal,
                          "comision_monto_fijo",
                          event.target.value,
                          COMMERCIAL_FIXED_AMOUNT_MAX
                        )
                      }
                      maxLength={13}
                      className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                    />
                    <span className="block text-xs text-zinc-500">
                      0 a 1,000,000,000; hasta 2 decimales.
                    </span>
                  </label>
                  <label className="space-y-1.5 text-sm text-zinc-300">
                    <span className="flex items-center gap-2">
                      Temporada fija
                      <RentaInfoButton
                        info={commercialRuleInfo.ajuste_temporada_monto_fijo}
                        onOpen={setInfoModal}
                        className="h-5 w-5 text-[10px]"
                      />
                    </span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={numberInputValue(
                        selectedChannel.ajuste_temporada_monto_fijo
                      )}
                      onChange={(event) =>
                        updateCommercialRule(
                          selectedChannel.canal,
                          "ajuste_temporada_monto_fijo",
                          event.target.value,
                          COMMERCIAL_FIXED_AMOUNT_MAX
                        )
                      }
                      maxLength={13}
                      className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                    />
                    <span className="block text-xs text-zinc-500">
                      0 a 1,000,000,000; hasta 2 decimales.
                    </span>
                  </label>
                  <label className="space-y-1.5 text-sm text-zinc-300">
                    <span className="flex items-center gap-2">
                      Promocion fija
                      <RentaInfoButton
                        info={commercialRuleInfo.promocion_monto_fijo}
                        onOpen={setInfoModal}
                        className="h-5 w-5 text-[10px]"
                      />
                    </span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={numberInputValue(selectedChannel.promocion_monto_fijo)}
                      onChange={(event) =>
                        updateCommercialRule(
                          selectedChannel.canal,
                          "promocion_monto_fijo",
                          event.target.value,
                          COMMERCIAL_FIXED_AMOUNT_MAX
                        )
                      }
                      maxLength={13}
                      className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                    />
                    <span className="block text-xs text-zinc-500">
                      0 a 1,000,000,000; hasta 2 decimales.
                    </span>
                  </label>
                </div>

                <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
                  <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">
                    Logica esperada
                  </p>
                  <p className="mt-2 text-sm leading-relaxed text-zinc-300">
                    BettERP parte de la renta publicable, aplica comision del
                    proveedor, ajustes de temporada y promociones por
                    porcentaje o monto fijo antes de preparar la ficha para
                    este canal. Si el espacio deja de estar disponible, la
                    publicacion se pausa para evitar dobles rentas.
                  </p>
                </div>
              </div>

              <label className="block rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4 text-sm text-zinc-300">
                <span className="flex items-center gap-2">
                  Notas operativas
                  <RentaInfoButton
                    info={channelInfo.notas}
                    onOpen={setInfoModal}
                  />
                </span>
                <span className="mt-1 block text-xs leading-relaxed text-zinc-500">
                  Si este campo tiene texto, BettERP lo agrega al final de la
                  descripcion de todos los espacios publicados en este canal.
                </span>
                <textarea
                  value={selectedChannel.notas || ""}
                  onChange={(event) =>
                    updateChannel(selectedChannel.canal, {
                      notas: event.target.value,
                    })
                  }
                  className="mt-2 min-h-[150px] w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-600 focus:ring-1 focus:ring-cyan-500"
                  placeholder="Ej. No se admiten mascotas. No fumar dentro del inmueble. No se permiten fiestas ni eventos. Visitas solo con cita confirmada."
                />
              </label>
            </div>
          </div>
        </div>
      </div>
      {disconnectPendingChannel ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm">
          <div className="w-full max-w-xl overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-950 shadow-2xl">
            <div className="border-b border-zinc-800 px-6 py-5">
              <p className="text-xs uppercase tracking-[0.22em] text-amber-300">
                Confirmar cierre de sesion
              </p>
              <h3 className="mt-2 text-2xl font-semibold text-white">
                Cerrar sesion de Mercado Libre
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                Esta accion desconecta la cuenta vendedora de{" "}
                <span className="font-medium text-white">
                  {disconnectPendingChannel.credenciales.ml_nickname ||
                    "Mercado Libre"}
                </span>
                .
              </p>
            </div>

            <div className="space-y-4 px-6 py-5">
              <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">
                <p className="font-semibold text-white">
                  Los procesos de Mercado Libre quedaran bloqueados hasta
                  reconectar.
                </p>
                <ul className="mt-3 list-disc space-y-2 pl-5 text-amber-100/75">
                  <li>No se podran publicar o reactivar espacios desde BettERP.</li>
                  <li>No se podran pausar anuncios ocupados de forma remota.</li>
                  <li>No se podran validar metricas, leads o eventos del canal.</li>
                </ul>
              </div>

              <p className="text-xs leading-relaxed text-zinc-500">
                Los anuncios que ya existan en Mercado Libre no se eliminan por
                esta accion, pero BettERP dejara de sincronizarlos hasta que se
                conecte nuevamente una cuenta vendedora.
              </p>

              <div className="flex flex-wrap justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setDisconnectPendingChannel(null)}
                  disabled={savingCode === disconnectPendingChannel.canal}
                  className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-2 text-sm text-zinc-200 transition-colors hover:bg-zinc-800 disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void disconnectMercadoLibre(disconnectPendingChannel)
                  }
                  disabled={savingCode === disconnectPendingChannel.canal}
                  className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-100 transition-colors hover:bg-red-500/20 disabled:opacity-50"
                >
                  {savingCode === disconnectPendingChannel.canal
                    ? "Cerrando..."
                    : "Si, cerrar sesion"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {testAccess ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-3xl border border-zinc-800 bg-zinc-950 shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-zinc-800 px-6 py-5">
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-cyan-300">
                  Mercado Libre test
                </p>
                <h3 className="mt-2 text-2xl font-semibold text-white">
                  Usuario de prueba creado
                </h3>
                <p className="mt-2 max-w-xl text-sm leading-relaxed text-zinc-400">
                  Estos accesos solo se muestran en este momento. BettERP guarda
                  el usuario test para referencia, pero no conserva la
                  contrasena.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setTestAccess(null);
                  setCopiedTestField("");
                }}
                className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-2 text-sm text-zinc-300 transition-colors hover:bg-zinc-800"
              >
                Cerrar
              </button>
            </div>

            <div className="space-y-5 px-6 py-5">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 sm:col-span-2">
                  <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">
                    Usuario
                  </p>
                  <p className="mt-2 break-all text-lg font-semibold text-white">
                    {testAccess.nickname}
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      void copyTestCredential("usuario", testAccess.nickname)
                    }
                    className="mt-3 rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-100 transition-colors hover:bg-cyan-500/20"
                  >
                    {copiedTestField === "usuario" ? "Copiado" : "Copiar"}
                  </button>
                </div>
                <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">
                    Sitio
                  </p>
                  <p className="mt-2 text-lg font-semibold text-white">
                    {testAccess.siteId}
                  </p>
                </div>
                <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 sm:col-span-3">
                  <p className="text-xs uppercase tracking-[0.16em] text-amber-200/70">
                    Contrasena temporal
                  </p>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                    <p className="break-all text-lg font-semibold text-white">
                      {testAccess.password}
                    </p>
                    <button
                      type="button"
                      onClick={() =>
                        void copyTestCredential("password", testAccess.password)
                      }
                      className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100 transition-colors hover:bg-amber-500/20"
                    >
                      {copiedTestField === "password" ? "Copiado" : "Copiar"}
                    </button>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-4 text-sm text-cyan-100">
                <p className="font-semibold text-white">Siguiente prueba</p>
                <ol className="mt-3 list-decimal space-y-2 pl-5 text-cyan-100/80">
                  <li>Cierra sesion en Mercado Libre.</li>
                  <li>Inicia sesion con el usuario test y esta contrasena.</li>
                  <li>Regresa a BettERP y presiona Reconectar ML.</li>
                  <li>Autoriza la app, valida el canal y prepara un espacio.</li>
                </ol>
              </div>

              <div className="flex flex-wrap justify-end gap-3">
                <button
                  type="button"
                  onClick={() =>
                    void copyTestCredential(
                      "todo",
                      `Usuario: ${testAccess.nickname}\nPassword: ${testAccess.password}\nSitio: ${testAccess.siteId}`
                    )
                  }
                  className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-2 text-sm text-zinc-200 transition-colors hover:bg-zinc-800"
                >
                  {copiedTestField === "todo" ? "Copiado" : "Copiar todo"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTestAccess(null);
                    setCopiedTestField("");
                  }}
                  className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-100 transition-colors hover:bg-emerald-500/20"
                >
                  Entendido
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
