"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, DragEvent, FormEvent, ReactNode } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { buildApiUrl } from "@/lib/api";
import {
  DEFAULT_COBRANZA_TAB,
  canUseCobranzaInternalTools,
  isInternalCobranzaTab,
} from "@/lib/cobranzaAccess";

const FINANZAS_API_BASE = buildApiUrl("/finanzas");
const COMMS_API_BASE = buildApiUrl("/comunicaciones");
const AUTOMATION_PREVIEW_HISTORY_KEY = "betterp:cobranza:automation-preview-history";
const AUTOMATION_PREVIEW_HISTORY_LIMIT = 5;
const EVIDENCE_FILE_ACCEPT =
  ".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf";
const EVIDENCE_ANALYSIS_TERMINAL_STATUSES = new Set(["APLICADA", "DESCARTADA"]);
const EVIDENCE_REUSED_AUTO_ANALYSIS_STATUSES = new Set([
  "VALIDADA",
  "APLICADA",
  "DESCARTADA",
]);
const CLOSED_CXC_STATUSES = new Set(["CONCILIADO", "CANCELADO", "INCOBRABLE"]);

type TabId =
  | "mensajes"
  | "plantillas"
  | "preparacion"
  | "automatizacion"
  | "comprobantes"
  | "cartera"
  | "reglas";

type Channel = "WHATSAPP" | "EMAIL" | "AMBOS";

interface MoneyBucket {
  count: number;
  total: number;
}

interface CxcMetrics {
  registros: number;
  clientes: number;
  totales: {
    cargos: number;
    cobrado: number;
    saldo: number;
    recargos: number;
    exigible: number;
    facturado: number;
    cuentas_abiertas: number;
    cuentas_pagadas: number;
  };
  por_vencer: MoneyBucket;
  en_gracia: MoneyBucket;
  vencidas: MoneyBucket;
  pagadas: MoneyBucket;
}

interface CxcRow {
  id: number;
  entidad_id: number | null;
  entidad_nombre: string;
  cliente_id: number;
  cliente_nombre: string;
  espacio_codigo?: string | null;
  concepto: string;
  fecha_periodo_inicio?: string | null;
  fecha_periodo_fin?: string | null;
  fecha_vencimiento: string | null;
  fecha_limite_gracia: string | null;
  dias_gracia: number;
  dias_atraso: number;
  dias_atraso_post_gracia: number;
  monto_base: number;
  monto_pagado: number;
  interes_monto: number;
  total_a_pagar: number;
  estatus: string;
  categoria_tablero: string;
  referencia_unica?: string | null;
  seguimiento_cobranza?: {
    estado: string;
    accion: string;
    vinculo?: "cuenta" | "cliente" | "ninguno" | string;
    ultimo_envio?: {
      id: number;
      canal: string;
      proveedor: string;
      estatus: string;
      fecha: string;
      automatizacion?: string | null;
      plantilla?: string | null;
      detalle?: string | null;
    } | null;
  };
}

interface CxcDashboard {
  fecha_referencia: string;
  metricas: CxcMetrics;
  page: number;
  total: number;
  total_pages: number;
  entidades: Array<{ id: number; nombre: string }>;
  clientes: Array<{ id: number; nombre: string }>;
  items: CxcRow[];
}

type FollowupFilter =
  | "TODAS"
  | "SIN_AVISO"
  | "REQUIERE_SEGUIMIENTO"
  | "ERROR"
  | "OMITIDO"
  | "CUENTA_EXACTA"
  | "CLIENTE";

interface Catalogos {
  entidades: Array<{ id: number; nombre: string }>;
  clientes: Array<{
    id: number;
    nombre: string;
    entidad_id: number;
    espacio_codigo?: string | null;
  }>;
}

interface WhatsappOverview {
  provider?: string | null;
  backend_public_base_url?: string | null;
  webhook_url?: string | null;
  app_id_configurada?: boolean;
  app_secret_configurado?: boolean;
  verify_token_configurado?: boolean;
  embedded_signup_ready?: boolean;
  graph_api_version?: string;
  canales_activos?: number;
  canales_principales?: number;
}

interface WhatsappChannel {
  id: number;
  nombre: string;
  nombre_interno?: string | null;
  display_phone_number?: string | null;
  numero_wa_id?: string | null;
  phone_number_id?: string | null;
  business_account_id?: string | null;
  waba_id?: string | null;
  entidad_id?: number | null;
  entidad_nombre?: string | null;
  cliente_id?: number | null;
  cliente_nombre?: string | null;
  estado: string;
  puede_enviar: boolean;
  puede_recibir: boolean;
  es_principal: boolean;
  activo: boolean;
  access_token_configurado: boolean;
}

interface CanalPermitido {
  id: number;
  canal: string;
  nombre: string;
  identificador_externo: string;
  entidad_nombre?: string | null;
  cliente_nombre?: string | null;
  capturar_evidencias: boolean;
  activo: boolean;
}

interface CommsConfig {
  id: number;
  clave: string;
  green_api_api_url?: string | null;
  green_api_instance_id?: string | null;
  green_api_token?: string | null;
  green_api_webhook_url?: string | null;
  green_api_webhook_token?: string | null;
  green_api_modo_filtro: string;
  green_api_sync_settings: boolean;
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
  email_provider?: string | null;
  resend_configured?: boolean;
  resend_api_key_present?: boolean;
  resend_webhook_secret_present?: boolean;
  resend_domain?: string | null;
  resend_webhook_url?: string | null;
  backend_public_base_url?: string | null;
  whatsapp_cloud?: WhatsappOverview;
  canales_permitidos?: CanalPermitido[];
  canales_whatsapp?: WhatsappChannel[];
}

interface WhatsappAgreementState {
  required: boolean;
  accepted: boolean;
  agreement: {
    tipo_acuerdo: string;
    version: string;
    titulo: string;
    texto: string;
    texto_hash: string;
    requerimientos: string[];
  };
  acceptance?: {
    id: number;
    version: string;
    texto_hash: string;
    fecha_aceptacion: string;
    aceptado_por?: string | null;
    aceptado_por_email?: string | null;
  } | null;
}

interface CobranzaOnboardingState {
  closed: boolean;
  closed_at?: string | null;
  closed_by_id?: number | null;
  closed_by_email?: string | null;
  closed_by_name?: string | null;
  progress: number;
  completed_steps: number;
  total_steps: number;
  blockers: string[];
  steps: Array<Record<string, unknown>>;
  reopened_at?: string | null;
  reopened_by_email?: string | null;
}

interface CobranzaOnboardingClosePayload {
  progreso: number;
  pasos_completos: number;
  pasos_totales: number;
  bloqueantes: string[];
  pasos: Array<Record<string, unknown>>;
}

interface CobranzaOnboardingResponse {
  success: boolean;
  mensaje: string;
  onboarding: CobranzaOnboardingState;
}

interface WhatsappLabContact {
  id: number;
  nombre: string;
  telefono: string;
  telefono_normalizado: string;
  notas?: string | null;
  consentimiento_confirmado: boolean;
  activo: boolean;
  fecha_creacion?: string | null;
  fecha_actualizacion?: string | null;
}

interface AutomationMonitoring {
  status: string;
  generated_at?: string;
  modo_seguro?: {
    integraciones_deshabilitadas: boolean;
    solo_numeros_whatsapp_permitidos: boolean;
    numeros_whatsapp_permitidos: string[];
    plantillas_bloqueadas_para_clientes: boolean;
    acuerdo_whatsapp_requerido: boolean;
    respetar_bajas_whatsapp: boolean;
    laboratorio_cobranza?: {
      habilitado: boolean;
      feature_activa: boolean;
      usuario_autorizado: boolean;
      capa_autorizada: boolean;
      usuario_actual?: string | null;
      capa_actual?: string | null;
      motivo?: string;
      contactos_whatsapp_prueba?: WhatsappLabContact[];
    };
  };
  cron?: {
    status: string;
    detail?: string;
    minutes_since_last_run?: number | null;
    expected_hours?: number;
    last_run?: {
      id?: number;
      status?: string;
      started_at?: string;
      finished_at?: string;
      duration_ms?: number;
      summary?: string | null;
      error?: string | null;
      metadata?: Record<string, unknown>;
      coverage?: string;
      includes_current_layer?: boolean;
      layer_summary?: Record<string, unknown>;
    } | null;
  };
  actividad?: {
    total_24h: number;
    enviados_24h: number;
    entregados_24h: number;
    omitidos_24h: number;
    errores_24h: number;
    total_7d: number;
    enviados_7d: number;
    omitidos_7d: number;
    errores_7d: number;
    whatsapp_7d: number;
    email_7d: number;
  };
  reglas?: {
    total: number;
    activas: number;
    pausadas: number;
    whatsapp_activas: number;
    email_activas: number;
    whatsapp_bloqueadas: Array<{
      id: number;
      nombre: string;
      plantilla_nombre: string;
      plantilla_estado: string;
    }>;
    actividad_7d: Array<{
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
  plantillas?: {
    total: number;
    activas: number;
    whatsapp_total: number;
    whatsapp_aprobadas: number;
    whatsapp_pendientes: number;
    ultima_sincronizacion_meta?: string | null;
    meta_total_visto?: number | null;
    canal_meta?: {
      id: number;
      nombre: string;
      display_phone_number?: string | null;
      waba_id?: string | null;
      estado: string;
    } | null;
    whatsapp_por_estado?: Array<{
      estado: string;
      total: number;
    }>;
    whatsapp_detalle?: Array<{
      id: number;
      nombre: string;
      tipo_plantilla: string;
      whatsapp_template_name?: string | null;
      whatsapp_template_language?: string | null;
      whatsapp_template_category?: string | null;
      whatsapp_template_status?: string | null;
      whatsapp_template_notes?: string | null;
      activo: boolean;
    }>;
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
  alertas?: Array<{ tipo: string; titulo: string; detalle: string }>;
  acciones_operativas?: Array<{
    tipo: string;
    titulo: string;
    detalle: string;
    accion: string;
  }>;
  errores_recientes?: HistoryItem[];
  onboarding?: CobranzaOnboardingState;
}

interface TemplateSyncResponse {
  success: boolean;
  meta_total: number;
  revisadas: number;
  actualizadas: number;
  sin_cambios: number;
  sin_coincidencia: number;
  plantillas: Template[];
  canal?: {
    id: number;
    nombre: string;
    display_phone_number?: string | null;
    waba_id?: string | null;
  };
}

interface WhatsappLabResult {
  success: boolean;
  mensaje: string;
  destino: string;
  plantilla: Template;
  preview: string;
  message_id?: string | null;
  provider?: string | null;
  historial?: HistoryItem;
}

interface CobranzaDemoMetaResult {
  success: boolean;
  dry_run: boolean;
  mensaje: string;
  capa: { id: number; nombre: string };
  entidad: { id: number; nombre: string };
  telefono: {
    codigo_pais: string;
    nacional: string;
    normalizado: string;
  };
  cliente: {
    id: number;
    nombre: string;
    telefono: string;
    creado: boolean;
    consentimiento: boolean;
  } | null;
  espacio: {
    id: number;
    codigo: string;
    creado: boolean;
  } | null;
  cuentas: Array<{
    id?: number;
    referencia_unica: string;
    escenario?: string;
    concepto?: string;
    fecha_vencimiento: string | null;
    fecha_periodo_inicio: string | null;
    fecha_periodo_fin: string | null;
    monto_total: number;
    monto_total_texto: string;
    estatus_adeudo?: string;
    creada?: boolean;
  }>;
}

interface CobranzaLabResetResult {
  success: boolean;
  mensaje: string;
  numero_destino: string;
  limpieza: {
    clientes: number;
    consentimientos_limpiados: number;
    otp_eliminados: number;
    historial_eliminado: number;
    comprobantes_eliminados: number;
    cxc_demo_eliminadas: number;
  };
  demo: CobranzaDemoMetaResult | null;
}

interface Template {
  id: number;
  nombre: string;
  descripcion?: string | null;
  canal: Channel;
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

interface AutomationRule {
  id: number;
  nombre: string;
  descripcion?: string | null;
  plantilla_id: number;
  plantilla_nombre: string;
  entidad_id?: number | null;
  entidad_nombre?: string | null;
  canal: Channel;
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
  canal: string;
  tipo_envio: string;
  proveedor: string;
  destinatario?: string | null;
  asunto?: string | null;
  cuerpo_renderizado?: string | null;
  referencia_envio?: string | null;
  estatus: string;
  metadata?: Record<string, unknown> | null;
  revision_operativa?: Record<string, unknown> | null;
  fecha_envio: string;
}

interface Evidence {
  id: number;
  cliente_id?: number | null;
  cliente_nombre?: string | null;
  entidad_id?: number | null;
  entidad_nombre?: string | null;
  canal: string;
  tipo_movimiento: string;
  origen_deteccion?: string | null;
  url_archivo?: string | null;
  monto_reportado?: number | null;
  fecha_pago_reportada?: string | null;
  referencia_reportada?: string | null;
  texto_extraido?: string | null;
  confianza_clasificacion?: number | null;
  requiere_revision_manual: boolean;
  categoria_sugerida?: string | null;
  metadata?: Record<string, unknown> | null;
  observaciones?: string | null;
  estatus: string;
  trazabilidad?: {
    etapa_actual: string;
    pasos: Array<{ clave: string; completo: boolean }>;
    pagos: {
      total: number;
      activos: number;
      validados: number;
      rechazados: number;
    };
    eventos: {
      total: number;
      activos: number;
      conciliados: number;
    };
    transacciones: {
      total: number;
      ids: number[];
    };
    evento_id?: number | null;
    transaccion_id?: number | null;
  } | null;
  duplicado_posible?: {
    posible: boolean;
    evidencia_ids: number[];
    motivos: string[];
  } | null;
  cxc_candidatas?: EvidenceCxcCandidate[];
  fecha_registro: string;
}

interface EvidenceCxcCandidate {
  id: number;
  concepto: string;
  entidad_nombre?: string | null;
  espacio_codigo?: string | null;
  fecha_periodo_inicio?: string | null;
  fecha_periodo_fin?: string | null;
  fecha_vencimiento?: string | null;
  monto_total: number;
  monto_pagado: number;
  saldo_pendiente: number;
  estatus_adeudo: string;
  referencia_unica?: string | null;
  motivos: string[];
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
  referencia_pago?: string | null;
  saldo_vivo: number;
  recargo_total: number;
  total_exigible: number;
  cuentas_abiertas: number;
  fecha_vencimiento: string;
  fecha_limite_gracia: string;
  validacion_contacto?: PreviewContactValidation | null;
  validacion_cobranza?: PreviewBillingValidation | null;
}

interface PreviewContactValidation {
  telefono?: {
    registrado?: string | null;
    codigo_pais?: string | null;
    display?: string | null;
    destino_whatsapp?: string | null;
    normalizado?: string | null;
    presente?: boolean;
    requerido?: boolean;
  } | null;
  correo?: {
    registrado?: string | null;
    destino?: string | null;
    presente?: boolean;
  } | null;
  consentimiento_cobranza?: {
    requerido?: boolean;
    aceptado?: boolean;
    bloquea_whatsapp?: boolean;
    plantilla_invitacion?: boolean;
    version_actual?: string | null;
    version_cliente?: string | null;
    fecha_aceptacion?: string | null;
  } | null;
  no_contactar_cobranza?: {
    bloqueado?: boolean;
    motivo?: string | null;
    fecha?: string | null;
  } | null;
  bloqueantes?: string[];
  listo_para_envio?: boolean;
}

interface PreviewBillingValidation {
  requerida?: boolean;
  cuentas?: {
    abiertas?: number;
    primary_cxc_id?: number | null;
  } | null;
  saldo?: {
    saldo_vivo?: number;
    saldo_vivo_formato?: string;
    total_exigible?: number;
    total_exigible_formato?: string;
    positivo?: boolean;
  } | null;
  vencimiento?: {
    fecha?: string | null;
    fecha_larga?: string | null;
    limite_gracia?: string | null;
    limite_gracia_larga?: string | null;
    presente?: boolean;
  } | null;
  referencia_pago?: string | null;
  bloqueantes?: string[];
  listo_para_envio?: boolean;
}

interface AutomationPreviewRule {
  id: number;
  nombre: string;
  plantilla_nombre: string;
  canal: Channel;
  segmento: string;
  evento_base: string;
  desplazamiento_dias: number;
  candidatos: number;
  muestras: PreviewItem[];
  error?: string | null;
  motivo_sin_candidatos?: string | null;
  detalle_sin_candidatos?: string | null;
  fecha_objetivo?: string | null;
  cuentas_fecha_objetivo?: number | null;
  cuentas_abiertas?: number | null;
}

interface AutomationPreviewResult {
  fecha_referencia: string;
  reglas_activas: number;
  candidatos: number;
  reglas: AutomationPreviewRule[];
  errores?: Array<{
    id: number;
    nombre: string;
    detalle: string;
  }>;
}

interface AutomationPreviewHistoryItem {
  id: string;
  fecha_referencia: string;
  generated_at: string;
  reglas_activas: number;
  reglas_con_candidatos: number;
  candidatos: number;
  errores: number;
}

interface Notice {
  type: "success" | "error" | "info";
  message: string;
}

type DialogTone = "default" | "danger" | "success" | "warning";

type CobranzaDialogState =
  | {
      type: "confirm";
      title: string;
      message: string;
      confirmLabel?: string;
      cancelLabel?: string;
      tone?: DialogTone;
      helper?: string;
    }
  | {
      type: "prompt";
      title: string;
      message: string;
      inputLabel: string;
      defaultValue?: string;
      placeholder?: string;
      inputType?: "text" | "date";
      confirmLabel?: string;
      cancelLabel?: string;
      tone?: DialogTone;
      helper?: string;
      required?: boolean;
    };

interface ReceiptProcessingState {
  evidenceId?: number | null;
  title: string;
  detail: string;
  fileName?: string | null;
}

interface ConfigForm {
  clave: string;
  green_api_api_url: string;
  green_api_instance_id: string;
  green_api_token: string;
  green_api_webhook_url: string;
  green_api_webhook_token: string;
  green_api_modo_filtro: string;
  green_api_sync_settings: boolean;
  procesar_webhooks_async: boolean;
  make_webhook_url: string;
  openai_model: string;
  prompt_extraccion: string;
  auto_detectar_comprobantes: boolean;
  auto_crear_eventos: boolean;
  auto_aplicar_eventos_confiables: boolean;
  auto_conciliar_eventos: boolean;
  umbral_confianza_autoaplicacion: string;
  ventana_match_dias: string;
  tolerancia_monto: string;
  email_activo: boolean;
  email_remitente_nombre: string;
  email_remitente: string;
  email_responder_a: string;
  respetar_bajas_whatsapp: boolean;
  portal_token_horas: string;
  activo: boolean;
}

interface MessageForm {
  plantilla_id: number | null;
  entidad_id: number | null;
  cliente_id: number | null;
  cliente_ids: number[];
  segmento: string;
  canal: Channel;
  asunto: string;
  mensaje: string;
  incluye_link_portal: boolean;
  url_media: string;
  fecha_referencia: string;
}

interface TemplateForm {
  nombre: string;
  descripcion: string;
  canal: Channel;
  tipo_plantilla: string;
  asunto: string;
  cuerpo: string;
  incluye_link_portal: boolean;
  url_media: string;
  activo: boolean;
}

interface RuleForm {
  nombre: string;
  descripcion: string;
  plantilla_id: number | null;
  entidad_id: number | null;
  canal: Channel;
  evento_base: string;
  desplazamiento_dias: string;
  segmento: string;
  activo: boolean;
}

interface EvidenceForm {
  cliente_id: number | null;
  entidad_id: number | null;
  canal: string;
  url_archivo: string;
  hash_archivo: string;
  monto_reportado: string;
  fecha_pago_reportada: string;
  referencia_reportada: string;
  texto_extraido: string;
  observaciones: string;
}

interface EvidenceUploadResult {
  success: boolean;
  mensaje: string;
  url: string | null;
  hash_archivo: string;
  nombre: string;
  content_type: string;
  size: number;
  texto_extraido?: string;
  evidencia_id?: number | null;
  duplicado?: boolean;
}

interface EvidenceSaveResult {
  id: number;
  created?: boolean;
  caso_id?: number | null;
  mensaje: string;
  evidencia?: Evidence;
}

interface EvidenceFilters {
  status: string;
  source: string;
  search: string;
  dateFrom: string;
  dateTo: string;
}

interface CobranzaInfoContent {
  eyebrow?: string;
  title: string;
  summary: string;
  details: string[];
}

const CUSTOMER_TABS: Array<{ id: TabId; title: string; description: string }> = [
  {
    id: "cartera",
    title: "Cartera CxC",
    description: "Saldos, vencimientos y clientes con riesgo.",
  },
  {
    id: "mensajes",
    title: "Mensajes",
    description: "Envio manual asistido con plantillas.",
  },
  {
    id: "comprobantes",
    title: "Comprobantes",
    description: "Captura, lectura y aplicacion a CxC.",
  },
  {
    id: "automatizacion",
    title: "Automatizacion",
    description: "Switches por recordatorio y etapa.",
  },
];

const INTERNAL_TABS: Array<{ id: TabId; title: string; description: string }> = [
  {
    id: "preparacion",
    title: "Preparacion",
    description: "Checklist interno de go-live y zona segura.",
  },
  {
    id: "reglas",
    title: "Onboarding",
    description: "Guia interna para capacitacion y soporte.",
  },
];

const MESSAGE_SUBJECT_MAX = 140;
const MESSAGE_MEDIA_URL_MAX = 500;
const TEMPLATE_NAME_MIN = 3;
const TEMPLATE_NAME_MAX = 100;
const TEMPLATE_DESCRIPTION_MAX = 240;
const TEMPLATE_BODY_MIN = 10;
const TEMPLATE_BODY_MAX = 3000;
const RULE_NAME_MIN = 3;
const RULE_NAME_MAX = 100;
const RULE_DESCRIPTION_MAX = 240;
const RULE_OFFSET_MIN = -30;
const RULE_OFFSET_MAX = 365;
const EVIDENCE_REFERENCE_MAX = 80;
const EVIDENCE_TEXT_MAX = 4000;
const EVIDENCE_OBSERVATIONS_MAX = 500;
const EVIDENCE_SEARCH_MAX = 120;
const MONEY_MAX = 1000000000;

const cobranzaTabInfo: Record<TabId, CobranzaInfoContent> = {
  mensajes: {
    eyebrow: "Cobranza",
    title: "Mensajes",
    summary:
      "Esta pestana permite enviar avisos manuales asistidos usando solo plantillas definidas por BetterP.",
    details: [
      "Primero se filtra la cartera por segmento, entidad o cliente especifico.",
      "La plantilla controla el texto final para mantener mensajes consistentes y evitar textos libres fuera de politica.",
      "El envio puede salir por WhatsApp, correo o ambos canales, segun los datos disponibles del cliente.",
    ],
  },
  plantillas: {
    eyebrow: "Cobranza",
    title: "Plantillas",
    summary:
      "Lista los mensajes base que BetterP usa para recordatorios, avisos de gracia y avisos con recargo.",
    details: [
      "Las variables entre llaves se reemplazan con datos reales del cliente, entidad, saldo, fechas y portal.",
      "Las plantillas de WhatsApp deben alinearse con reglas de Meta para evitar rechazos o bloqueo de mensajes.",
      "Los textos deben ser claros, profesionales y accionables: saldo, referencia, portal y siguiente paso.",
    ],
  },
  preparacion: {
    eyebrow: "WhatsApp",
    title: "Preparacion",
    summary:
      "Concentra el estado de Meta, reglas, cron, acuerdo legal y zona segura antes de encender envios reales.",
    details: [
      "Mientras Meta revisa plantillas, el tablero debe mostrarlas como pendientes y mantener bloqueadas las reglas WhatsApp.",
      "La sincronizacion con Meta actualiza BetterP cuando una plantilla pase a aprobada, rechazada o pausada.",
      "La zona segura confirma que los envios siguen limitados al numero permitido hasta que decidas abrir produccion.",
    ],
  },
  automatizacion: {
    eyebrow: "Cobranza",
    title: "Automatizacion",
    summary:
      "Aqui se activan o pausan los avisos automaticos por etapa de cobranza.",
    details: [
      "El desfase se mide en dias enteros: negativo antes del vencimiento, cero el dia base y positivo despues.",
      "Cada regla puede aplicar a todas las entidades o a una entidad especifica.",
      "Si la plantilla de WhatsApp no esta aprobada por Meta, la regla queda visible pero debe mantenerse apagada.",
    ],
  },
  comprobantes: {
    eyebrow: "Cobranza",
    title: "Comprobantes",
    summary:
      "Bandeja para registrar, validar y aplicar soportes de pago enviados por cliente, portal o captura manual.",
    details: [
      "El cliente es obligatorio porque permite ligar el comprobante a la cartera correcta.",
      "Monto, fecha, referencia y archivo ayudan a conciliacion; si algun dato falta, se puede dejar para revision.",
      "Aplicar a CxC debe usarse solo cuando el soporte ya fue validado contra monto, cliente y referencia.",
    ],
  },
  cartera: {
    eyebrow: "Cobranza",
    title: "Cartera CxC",
    summary:
      "Concentra cuentas abiertas y su estado de seguimiento para preparar avisos individuales o masivos.",
    details: [
      "Los filtros separan cuentas sin aviso, con seguimiento pendiente, errores y cuentas ya vinculadas a mensajes.",
      "La seleccion masiva prepara mensajes por cliente sin duplicar destinatarios.",
      "El buscador acepta cliente, entidad, espacio, concepto o referencia para ubicar cuentas rapido.",
    ],
  },
  reglas: {
    eyebrow: "Cobranza",
    title: "Onboarding",
    summary:
      "Acompana al usuario por el flujo recomendado para operar cobranza sin depender de una guia estatica.",
    details: [
      "El onboarding explica preparacion, envio manual, automatizacion, comprobantes y cartera.",
      "Cada paso aterriza una accion concreta dentro del modulo.",
      "Sirve para capacitar clientes nuevos sin darles control tecnico de plantillas.",
    ],
  },
};

const cobranzaFieldInfo: Record<string, CobranzaInfoContent> = {
  segmento: {
    eyebrow: "Campo",
    title: "Segmento de cobranza",
    summary:
      "Define que grupo de cuentas se usara para calcular destinatarios y previsualizar mensajes.",
    details: [
      "Cartera abierta incluye cuentas pendientes; Por vencer, En gracia y Vencida con recargo reducen el envio a un estado especifico.",
      "Si tambien eliges un cliente especifico, BetterP limita la vista previa a ese cliente.",
      "No captura texto libre; solo acepta opciones controladas para evitar envios al segmento equivocado.",
    ],
  },
  canal: {
    eyebrow: "Campo",
    title: "Canal",
    summary:
      "Indica si el aviso se prepara para WhatsApp, email o ambos canales.",
    details: [
      "WhatsApp usa plantillas y reglas del proveedor configurado.",
      "Email usa asunto y cuerpo cuando la plantilla lo define.",
      "Ambos mantiene el mismo mensaje base, adaptado a los destinos disponibles del cliente.",
    ],
  },
  entidad: {
    eyebrow: "Campo",
    title: "Entidad",
    summary:
      "Permite enfocar la cobranza en una unidad de negocio especifica.",
    details: [
      "Si se deja en Todas, BetterP revisa clientes y cuentas de toda la cartera disponible.",
      "Elegir entidad tambien filtra el selector de clientes para reducir errores operativos.",
      "No modifica la cartera; solo acota la consulta de envio o registro.",
    ],
  },
  cliente: {
    eyebrow: "Campo",
    title: "Cliente",
    summary:
      "Usa este campo cuando quieres preparar o registrar informacion para una persona o cuenta especifica.",
    details: [
      "En mensajes, si no eliges cliente, BetterP usa todos los clientes del segmento seleccionado.",
      "En comprobantes, el cliente es obligatorio para ligar el soporte al saldo correcto.",
      "El selector solo acepta clientes existentes en el sistema.",
    ],
  },
  plantilla: {
    eyebrow: "Campo",
    title: "Plantilla",
    summary:
      "Texto base que se usara para generar mensajes de cobranza.",
    details: [
      "La plantilla contiene variables que se sustituyen por saldo, vencimiento, portal y datos bancarios.",
      "Mantener plantillas controladas ayuda a cumplir reglas de Meta y a evitar mensajes inconsistentes.",
      "Para previsualizar o enviar, debe haber una plantilla seleccionada.",
    ],
  },
  fechaReferencia: {
    eyebrow: "Campo",
    title: "Fecha de referencia",
    summary:
      "Fecha usada para calcular como se veria la cobranza en un dia determinado.",
    details: [
      "Acepta solo fechas validas de calendario.",
      "Por default se usa el dia actual.",
      "Sirve para revisar cortes, gracia o recargos sin cambiar datos base.",
    ],
  },
  montoReportado: {
    eyebrow: "Campo",
    title: "Monto reportado",
    summary:
      "Importe que aparece en el comprobante enviado por el cliente.",
    details: [
      "Acepta solo dinero positivo con hasta 2 decimales.",
      "El limite operativo es $1,000,000,000 para evitar capturas accidentales enormes.",
      "Puede quedar vacio si el archivo requiere revision manual, pero si se captura debe ser mayor a cero.",
    ],
  },
  fechaPago: {
    eyebrow: "Campo",
    title: "Fecha de pago",
    summary:
      "Dia en que el cliente indica haber realizado el pago.",
    details: [
      "Acepta solo fecha de calendario.",
      "Ayuda a conciliacion bancaria y trazabilidad.",
      "Si el comprobante no muestra fecha clara, se puede dejar vacio para revision.",
    ],
  },
  referencia: {
    eyebrow: "Campo",
    title: "Referencia",
    summary:
      "Folio, concepto o referencia bancaria asociada al pago.",
    details: [
      "Acepta letras, numeros, guiones y espacios; maximo 80 caracteres.",
      "Evita pegar textos largos: el detalle amplio va en observaciones.",
      "Una referencia limpia facilita localizar la transaccion bancaria.",
    ],
  },
  urlArchivo: {
    eyebrow: "Campo",
    title: "URL del archivo",
    summary:
      "Liga al PDF, imagen o ticket que respalda el pago.",
    details: [
      "Debe iniciar con http:// o https:// cuando se capture manualmente.",
      "Maximo 500 caracteres.",
      "Si el comprobante viene desde portal o WhatsApp, normalmente BetterP llena este dato automaticamente.",
    ],
  },
  textoExtraido: {
    eyebrow: "Campo",
    title: "Texto extraido",
    summary:
      "Notas o lectura OCR/IA del comprobante cuando se captura manualmente.",
    details: [
      "Acepta texto amplio de hasta 4,000 caracteres.",
      "Se usa para dejar monto, fecha, banco o detalles que aparezcan en la imagen.",
      "No sustituye el archivo; complementa la revision.",
    ],
  },
  observaciones: {
    eyebrow: "Campo",
    title: "Observaciones internas",
    summary:
      "Comentario operativo para explicar por que un comprobante se valida, aplica o queda en revision.",
    details: [
      "Maximo 500 caracteres.",
      "Debe ser claro para el equipo interno; no es un mensaje al cliente.",
      "Conviene anotar diferencias de monto, referencias dudosas o pagos agrupados.",
    ],
  },
  filtrosComprobantes: {
    eyebrow: "Filtro",
    title: "Filtros de comprobantes",
    summary:
      "Reducen la bandeja por estado, origen, texto y rango de fechas.",
    details: [
      "El buscador acepta hasta 120 caracteres.",
      "Desde y Hasta deben ser fechas validas; si usas ambas, Desde no puede ser posterior a Hasta.",
      "Los filtros consultan API con un limite operativo para mantener la vista ligera.",
    ],
  },
  carteraFiltros: {
    eyebrow: "Filtro",
    title: "Filtros de cartera",
    summary:
      "Ayudan a priorizar a quien cobrar primero y que mensaje preparar.",
    details: [
      "Seguimiento separa cuentas sin aviso, con error o con aviso ya ligado a cuenta o cliente.",
      "Estado separa por vencer, gracia y vencidas con recargo.",
      "El buscador acepta hasta 120 caracteres y busca cliente, entidad, espacio, concepto o referencia.",
    ],
  },
  saldoVencimiento: {
    eyebrow: "Validacion",
    title: "Saldo y vencimiento",
    summary:
      "Bloquea envios que no tengan cuenta por cobrar abierta, saldo real o fecha alineada al tipo de aviso.",
    details: [
      "Evita mandar recordatorios fuera de etapa, por ejemplo preventivos despues del vencimiento.",
      "Revisa que el monto exigible sea mayor a cero antes de liberar un mensaje.",
      "Si falta fecha de vencimiento, BetterP pide corregir la CxC antes de enviar.",
    ],
  },
  telefonoConsentimiento: {
    eyebrow: "Validacion",
    title: "Telefono y consentimiento",
    summary:
      "Confirma que el cliente tenga destino valido y permiso operativo antes de enviar cobranza.",
    details: [
      "WhatsApp requiere telefono normalizado y, si aplica, consentimiento aceptado desde el portal.",
      "Si el cliente marco no contactar o uso STOP, BetterP lo muestra como bloqueante segun la configuracion.",
      "Estas validaciones reducen riesgo operativo y ayudan a evitar comunicaciones indebidas.",
    ],
  },
  historialEnvios: {
    eyebrow: "Auditoria",
    title: "Ultimos envios",
    summary:
      "Muestra el resultado reciente de envios manuales, pruebas y automatizaciones.",
    details: [
      "Enviado significa que el proveedor acepto el mensaje.",
      "Omitido indica que una regla de seguridad, allowlist o validacion impidio enviarlo.",
      "Error conserva la respuesta del proveedor o del sistema para corregir plantilla, parametros o contacto.",
    ],
  },
  archivoComprobante: {
    eyebrow: "Comprobante",
    title: "Archivo del comprobante",
    summary:
      "Permite cargar imagen, screenshot o PDF para que BetterP lo almacene y lo lea con OCR/IA visual.",
    details: [
      "El archivo se sube al almacenamiento configurado y se asocia al cliente y unidad seleccionados.",
      "Al terminar la carga, BetterP intenta extraer monto, fecha, referencia, banco y beneficiario.",
      "Si la lectura no es suficientemente confiable, el comprobante queda para revision humana antes de aplicar pago.",
    ],
  },
};

function isCobranzaTab(value: string | null): value is TabId {
  return (
    value === "mensajes" ||
    value === "preparacion" ||
    value === "automatizacion" ||
    value === "comprobantes" ||
    value === "cartera" ||
    value === "reglas"
  );
}

function channelUsesWhatsapp(value: Channel | string | null | undefined): boolean {
  const normalized = String(value || "").toUpperCase();
  return normalized === "AMBOS" || normalized.includes("WHATSAPP");
}

function isMetaWhatsappTemplate(template?: Template | null): boolean {
  return Boolean(
    template &&
      channelUsesWhatsapp(template.canal) &&
      (template.whatsapp_template_name || "").trim(),
  );
}

function isApprovedWhatsappTemplate(template?: Template | null): boolean {
  return Boolean(template && template.whatsapp_template_status === "APROBADA");
}

function whatsappNumberVariants(value: string | null | undefined): Set<string> {
  const digits = String(value || "").replace(/\D/g, "");
  const variants = new Set<string>();
  if (!digits) {
    return variants;
  }
  variants.add(digits);
  if (digits.length === 10) {
    variants.add(`52${digits}`);
    variants.add(`521${digits}`);
  }
  if (digits.startsWith("52") && digits.length === 12) {
    variants.add(`521${digits.slice(2)}`);
  }
  if (digits.startsWith("521") && digits.length === 13) {
    variants.add(`52${digits.slice(3)}`);
  }
  return variants;
}

function buildWhatsappAllowlistSet(numbers: string[]): Set<string> {
  const allowlist = new Set<string>();
  numbers.forEach((number) => {
    whatsappNumberVariants(number).forEach((variant) => allowlist.add(variant));
  });
  return allowlist;
}

function isWhatsappDestinationAllowed(
  destination: string | null | undefined,
  allowlist: Set<string>,
): boolean {
  const variants = whatsappNumberVariants(destination);
  if (!variants.size || !allowlist.size) {
    return false;
  }
  for (const variant of variants) {
    if (allowlist.has(variant)) {
      return true;
    }
  }
  return false;
}

function blockedWhatsappPreviewDestinations(
  previewItems: PreviewItem[],
  allowlist: Set<string>,
) {
  return previewItems.flatMap((item) =>
    item.canales
      .map((channel, index) => ({
        channel,
        destination: item.destinos[index] || "",
        clientName: item.cliente_nombre,
      }))
      .filter(
        (target) =>
          channelUsesWhatsapp(target.channel) &&
          !isWhatsappDestinationAllowed(target.destination, allowlist),
      ),
  );
}

function previewContactBlockers(item: PreviewItem): Set<string> {
  return new Set(item.validacion_contacto?.bloqueantes ?? []);
}

function previewContactIsBlocked(item: PreviewItem): boolean {
  return previewContactBlockers(item).size > 0;
}

function previewBillingBlockers(item: PreviewItem): Set<string> {
  return new Set(item.validacion_cobranza?.bloqueantes ?? []);
}

function previewBillingIsBlocked(item: PreviewItem): boolean {
  return previewBillingBlockers(item).size > 0;
}

function previewContactIssueLabel(code: string): string {
  if (code === "WHATSAPP_SIN_TELEFONO") {
    return "Falta telefono WhatsApp para el canal seleccionado.";
  }
  if (code === "CONSENTIMIENTO_PENDIENTE") {
    return "Falta consentimiento vigente de cobranza.";
  }
  if (code === "NO_CONTACTAR") {
    return "Cliente marcado como no contactar.";
  }
  return statusLabel(code);
}

function previewBillingIssueLabel(code: string): string {
  if (code === "SIN_CXC_ABIERTA") {
    return "No hay una cuenta por cobrar abierta para este aviso.";
  }
  if (code === "SALDO_NO_POSITIVO") {
    return "El saldo exigible no es mayor a cero.";
  }
  if (code === "SIN_VENCIMIENTO") {
    return "La cuenta no tiene vencimiento definido.";
  }
  return statusLabel(code);
}

function previewContactPhoneLabel(item: PreviewItem): string {
  const phone = item.validacion_contacto?.telefono;
  if (!phone?.requerido) {
    return "WhatsApp no requerido";
  }
  if (phone.presente) {
    return `WhatsApp ${phone.normalizado || phone.destino_whatsapp || phone.display || "listo"}`;
  }
  return "Sin telefono WhatsApp";
}

function previewConsentLabel(item: PreviewItem): string {
  const consent = item.validacion_contacto?.consentimiento_cobranza;
  if (consent?.plantilla_invitacion) {
    return "Invitacion permitida antes del consentimiento";
  }
  if (!consent?.requerido) {
    return "Consentimiento no requerido para este envio";
  }
  if (consent.aceptado) {
    return consent.fecha_aceptacion
      ? `Consentimiento aceptado ${shortDate(consent.fecha_aceptacion)}`
      : "Consentimiento vigente";
  }
  return "Consentimiento pendiente";
}

function previewBillingAmountLabel(item: PreviewItem): string {
  const validation = item.validacion_cobranza;
  if (!validation?.requerida) {
    return "Saldo no requerido para este mensaje";
  }
  return (
    validation.saldo?.total_exigible_formato ||
    money(validation.saldo?.total_exigible ?? item.total_exigible)
  );
}

function previewBillingDueDateLabel(item: PreviewItem): string {
  const validation = item.validacion_cobranza;
  if (!validation?.requerida) {
    return "Vencimiento no requerido para este mensaje";
  }
  if (validation.vencimiento?.presente) {
    return validation.vencimiento.fecha_larga || validation.vencimiento.fecha || item.fecha_vencimiento;
  }
  return "Sin vencimiento";
}

const SEGMENTS = [
  { value: "CXC_ABIERTA", label: "Cartera abierta" },
  { value: "POR_VENCER", label: "Por vencer" },
  { value: "EN_GRACIA", label: "En gracia" },
  { value: "VENCIDA_CON_RECARGO", label: "Vencida con recargo" },
  { value: "TODOS_ACTIVOS", label: "Todos los clientes activos" },
];

const TEMPLATE_TYPES = [
  { value: "PORTAL_AUTOSERVICIO", label: "Portal de autoservicio" },
  { value: "RECORDATORIO_PAGO", label: "Recordatorio de pago" },
  { value: "AVISO_INTERES", label: "Aviso de interes" },
  { value: "MENSAJE_PERSONALIZADO", label: "Mensaje personalizado" },
  { value: "LIBRE", label: "Libre" },
];

const EVENT_BASES = [
  { value: "FECHA_VENCIMIENTO", label: "Fecha de corte/vencimiento" },
  { value: "FECHA_LIMITE_GRACIA", label: "Fin de gracia" },
];

const STATUS_LABELS: Record<string, string> = {
  PAGADA: "Pagada",
  POR_VENCER: "Por vencer",
  EN_GRACIA: "En gracia",
  VENCIDA_CON_RECARGO: "Con recargo",
  ENVIADO: "Enviado",
  ENTREGADO: "Entregado",
  LEIDO: "Leido",
  ERROR: "Error",
  NO_CONFIGURADA: "No configurada",
  BORRADOR: "Borrador",
  EN_REVISION: "En revision",
  APROBADA: "Aprobada",
  RECHAZADA: "Rechazada",
  PAUSADA: "Pausada",
  NUEVA: "Nueva",
  VALIDADA: "Validada",
  APLICADA: "Aplicada",
  DESCARTADA: "Descartada",
  RECIBIDO: "Recibido",
  VALIDADO: "Validado",
  APLICADO: "Aplicado",
  CONCILIADO: "Conciliado",
  REVISION: "Revision",
  SIN_AVISO: "Sin aviso",
  AVISO_RECIENTE: "Aviso reciente",
  REQUIERE_SEGUIMIENTO: "Requiere seguimiento",
  OMITIDO: "Omitido",
};

const VARIABLES = [
  "{{cliente_nombre}}",
  "{{entidad_nombre}}",
  "{{concepto}}",
  "{{periodo}}",
  "{{fecha_vencimiento}}",
  "{{fecha_limite_gracia}}",
  "{{dias_gracia}}",
  "{{dias_atraso}}",
  "{{saldo_vivo_formato}}",
  "{{monto_recibido_formato}}",
  "{{saldo_pendiente_formato}}",
  "{{recargo_total_formato}}",
  "{{total_exigible_formato}}",
  "{{portal_url}}",
  "{{referencia_pago}}",
  "{{banco_transferencia}}",
  "{{clabe_transferencia}}",
  "{{beneficiario_transferencia}}",
];

const TEMPLATE_PRESETS: Array<{
  key: string;
  title: string;
  timing: string;
  draft: TemplateForm;
}> = [
  {
    key: "preventivo-3",
    title: "Recordatorio preventivo",
    timing: "3 dias antes",
    draft: {
      nombre: "Recordatorio 3 dias antes",
      descripcion: "Aviso amable antes del vencimiento.",
      canal: "AMBOS",
      tipo_plantilla: "RECORDATORIO_PAGO",
      asunto: "Tu pago esta por vencer",
      cuerpo:
        "Hola {{cliente_nombre}}, te recordamos que tu pago de {{concepto}} por {{total_exigible_formato}} vence el {{fecha_vencimiento}}.\n\nPuedes revisar tu estado y compartir comprobante aqui: {{portal_url}}.\n\nGracias.",
      incluye_link_portal: true,
      url_media: "",
      activo: true,
    },
  },
  {
    key: "vencimiento",
    title: "Dia de vencimiento",
    timing: "Dia 0",
    draft: {
      nombre: "Aviso dia de vencimiento",
      descripcion: "Aviso formal el dia que vence la cuenta.",
      canal: "AMBOS",
      tipo_plantilla: "RECORDATORIO_PAGO",
      asunto: "Tu pago vence hoy",
      cuerpo:
        "Hola {{cliente_nombre}}, hoy vence tu pago de {{concepto}} por {{total_exigible_formato}}.\n\nReferencia: {{referencia_pago}}\nBanco: {{banco_transferencia}}\nCLABE: {{clabe_transferencia}}\n\nTambien puedes consultar detalles en {{portal_url}}.",
      incluye_link_portal: true,
      url_media: "",
      activo: true,
    },
  },
  {
    key: "gracia-3",
    title: "Fin de gracia",
    timing: "3 dias despues",
    draft: {
      nombre: "Aviso 3 dias despues",
      descripcion: "Seguimiento cuando el cliente ya esta en gracia.",
      canal: "AMBOS",
      tipo_plantilla: "AVISO_INTERES",
      asunto: "Tu cuenta sigue pendiente",
      cuerpo:
        "Hola {{cliente_nombre}}, seguimos sin registrar el pago de {{concepto}}.\n\nSaldo actual: {{total_exigible_formato}}.\nDias de atraso: {{dias_atraso}}.\n\nPor favor envia tu comprobante o consulta el portal: {{portal_url}}.",
      incluye_link_portal: true,
      url_media: "",
      activo: true,
    },
  },
  {
    key: "restriccion-10",
    title: "Restriccion operativa",
    timing: "10 dias despues",
    draft: {
      nombre: "Aviso 10 dias restriccion",
      descripcion: "Aviso previo a restriccion de acceso por adeudo.",
      canal: "AMBOS",
      tipo_plantilla: "AVISO_INTERES",
      asunto: "Aviso importante por adeudo",
      cuerpo:
        "Hola {{cliente_nombre}}, tu cuenta presenta {{dias_atraso}} dias de atraso y un saldo pendiente de {{total_exigible_formato}}.\n\nSi no recibimos pago o aclaracion, se restringira el acceso al servicio o espacio conforme a las politicas acordadas.\n\nPuedes revisar y enviar comprobante aqui: {{portal_url}}.",
      incluye_link_portal: true,
      url_media: "",
      activo: true,
    },
  },
];

const emptyTemplateForm: TemplateForm = {
  nombre: "",
  descripcion: "",
  canal: "WHATSAPP",
  tipo_plantilla: "RECORDATORIO_PAGO",
  asunto: "",
  cuerpo: "",
  incluye_link_portal: true,
  url_media: "",
  activo: true,
};

const emptyRuleForm: RuleForm = {
  nombre: "",
  descripcion: "",
  plantilla_id: null,
  entidad_id: null,
  canal: "WHATSAPP",
  evento_base: "FECHA_VENCIMIENTO",
  desplazamiento_dias: "0",
  segmento: "CXC_ABIERTA",
  activo: true,
};

const emptyEvidenceForm: EvidenceForm = {
  cliente_id: null,
  entidad_id: null,
  canal: "MANUAL",
  url_archivo: "",
  hash_archivo: "",
  monto_reportado: "",
  fecha_pago_reportada: "",
  referencia_reportada: "",
  texto_extraido: "",
  observaciones: "",
};

const defaultEvidenceFilters: EvidenceFilters = {
  status: "PENDIENTES",
  source: "TODOS",
  search: "",
  dateFrom: "",
  dateTo: "",
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyMessageForm(): MessageForm {
  return {
    plantilla_id: null,
    entidad_id: null,
    cliente_id: null,
    cliente_ids: [],
    segmento: "CXC_ABIERTA",
    canal: "AMBOS",
    asunto: "",
    mensaje: "",
    incluye_link_portal: true,
    url_media: "",
    fecha_referencia: todayIso(),
  };
}

function money(value: number | null | undefined): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 2,
  }).format(Number(value ?? 0));
}

function parseDisplayDate(value?: string | null): Date | null {
  if (!value) {
    return null;
  }
  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const parsed = dateOnlyMatch
    ? new Date(
        Number(dateOnlyMatch[1]),
        Number(dateOnlyMatch[2]) - 1,
        Number(dateOnlyMatch[3]),
      )
    : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function shortDate(value?: string | null): string {
  const parsed = parseDisplayDate(value);
  if (!parsed) {
    if (!value) {
      return "Sin fecha";
    }
    return value;
  }
  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(parsed);
}

function dateTimeLabel(value?: string | null): string {
  const parsed = parseDisplayDate(value);
  if (!parsed) {
    if (!value) {
      return "Sin fecha";
    }
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

const WHATSAPP_CONTACT_COOLDOWN_HOURS = 24;

function nextWhatsappContactAt(value?: string | null): Date | null {
  const parsed = parseDisplayDate(value);
  if (!parsed) {
    return null;
  }
  return new Date(
    parsed.getTime() + WHATSAPP_CONTACT_COOLDOWN_HOURS * 60 * 60 * 1000,
  );
}

function nextWhatsappContactLabel(value?: string | null): string | null {
  const next = nextWhatsappContactAt(value);
  if (!next) {
    return null;
  }
  return `Proximo WhatsApp despues de ${dateTimeLabel(next.toISOString())}`;
}

function nextWhatsappContactLocked(value?: string | null): boolean {
  const next = nextWhatsappContactAt(value);
  return Boolean(next && Date.now() < next.getTime());
}

function monthYearLabel(value?: string | null): string {
  const parsed = parseDisplayDate(value);
  if (!parsed) {
    if (!value) {
      return "Periodo sin mes";
    }
    return value;
  }
  const label = new Intl.DateTimeFormat("es-MX", {
    month: "long",
    year: "numeric",
  }).format(parsed);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function candidatePeriodMonth(candidate: EvidenceCxcCandidate): string {
  return monthYearLabel(
    candidate.fecha_periodo_fin ||
      candidate.fecha_periodo_inicio ||
      candidate.fecha_vencimiento,
  );
}

function candidatePeriodRange(candidate: EvidenceCxcCandidate): string {
  const start = candidate.fecha_periodo_inicio;
  const end = candidate.fecha_periodo_fin;
  if (start && end) {
    return `${shortDate(start)} al ${shortDate(end)}`;
  }
  if (start) {
    return `Desde ${shortDate(start)}`;
  }
  if (end) {
    return `Hasta ${shortDate(end)}`;
  }
  return "Rango de periodo no definido";
}

function candidateConceptLabel(candidate: EvidenceCxcCandidate): string {
  if (candidate.espacio_codigo) {
    return `Renta ${candidate.espacio_codigo}`;
  }
  return candidate.concepto.split("|")[0]?.trim() || candidate.concepto;
}

function parseSelectId(value: string): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function limitPlainText(value: string, maxLength: number): string {
  return value.replace(/[<>]/g, "").slice(0, maxLength);
}

function limitMultilineText(value: string, maxLength: number): string {
  return value.replace(/[<>]/g, "").slice(0, maxLength);
}

function cleanReference(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9 _./#-]/g, "")
    .slice(0, EVIDENCE_REFERENCE_MAX);
}

function cleanMoneyInput(value: string): string {
  const normalized = value.replace(",", ".").replace(/[^\d.]/g, "");
  const [wholeRaw, ...decimalParts] = normalized.split(".");
  const whole = wholeRaw.replace(/^0+(?=\d)/, "").slice(0, 10);
  const decimals = decimalParts.join("").slice(0, 2);
  const candidate = decimalParts.length > 0 ? `${whole || "0"}.${decimals}` : whole;
  if (!candidate) {
    return "";
  }
  const parsed = Number(candidate);
  if (Number.isFinite(parsed) && parsed > MONEY_MAX) {
    return String(MONEY_MAX);
  }
  return candidate;
}

function cleanIntegerInput(value: string, min: number, max: number): string {
  const normalized = value.replace(/[^\d-]/g, "");
  const negative = normalized.startsWith("-");
  const digits = normalized.replace(/-/g, "");
  if (!digits) {
    return negative && min < 0 ? "-" : "";
  }
  const parsed = Number(`${negative ? "-" : ""}${digits}`);
  if (!Number.isFinite(parsed)) {
    return "";
  }
  return String(Math.min(max, Math.max(min, parsed)));
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00`);
  return !Number.isNaN(parsed.getTime());
}

function isValidHttpUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return true;
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function hasTwoDecimalsOrLess(value: string): boolean {
  return /^\d+(\.\d{1,2})?$/.test(value);
}

function parseMoneyValue(value: string): number | null {
  const cleaned = cleanMoneyInput(value);
  if (!cleaned) {
    return null;
  }
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstError(errors: Record<string, string>): string | null {
  const first = Object.values(errors)[0];
  return first || null;
}

function validateMessageForm(form: MessageForm): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!SEGMENTS.some((segment) => segment.value === form.segmento)) {
    errors.segmento = "Selecciona un segmento valido.";
  }
  if (!["WHATSAPP", "EMAIL", "AMBOS"].includes(form.canal)) {
    errors.canal = "Selecciona un canal valido.";
  }
  if (!form.plantilla_id) {
    errors.plantilla_id = "Selecciona una plantilla para previsualizar.";
  }
  if (!isValidDate(form.fecha_referencia)) {
    errors.fecha_referencia = "Fecha de referencia debe ser una fecha valida.";
  }
  if (form.asunto.length > MESSAGE_SUBJECT_MAX) {
    errors.asunto = `Asunto maximo ${MESSAGE_SUBJECT_MAX} caracteres.`;
  }
  if (form.url_media && !isValidHttpUrl(form.url_media)) {
    errors.url_media = "La URL de media debe iniciar con http:// o https://.";
  }
  return errors;
}

function validateTemplateForm(form: TemplateForm): Record<string, string> {
  const errors: Record<string, string> = {};
  const name = form.nombre.trim();
  const body = form.cuerpo.trim();
  if (name.length < TEMPLATE_NAME_MIN || name.length > TEMPLATE_NAME_MAX) {
    errors.nombre = `Nombre debe tener entre ${TEMPLATE_NAME_MIN} y ${TEMPLATE_NAME_MAX} caracteres.`;
  }
  if (form.descripcion.length > TEMPLATE_DESCRIPTION_MAX) {
    errors.descripcion = `Descripcion maximo ${TEMPLATE_DESCRIPTION_MAX} caracteres.`;
  }
  if (["EMAIL", "AMBOS"].includes(form.canal) && !form.asunto.trim()) {
    errors.asunto = "Asunto es obligatorio para email.";
  }
  if (form.asunto.length > MESSAGE_SUBJECT_MAX) {
    errors.asunto = `Asunto maximo ${MESSAGE_SUBJECT_MAX} caracteres.`;
  }
  if (body.length < TEMPLATE_BODY_MIN || body.length > TEMPLATE_BODY_MAX) {
    errors.cuerpo = `Cuerpo debe tener entre ${TEMPLATE_BODY_MIN} y ${TEMPLATE_BODY_MAX} caracteres.`;
  }
  if (form.url_media && !isValidHttpUrl(form.url_media)) {
    errors.url_media = "La URL de media debe iniciar con http:// o https://.";
  }
  return errors;
}

function validateRuleForm(form: RuleForm): Record<string, string> {
  const errors: Record<string, string> = {};
  const name = form.nombre.trim();
  const offset = Number(form.desplazamiento_dias);
  if (name.length < RULE_NAME_MIN || name.length > RULE_NAME_MAX) {
    errors.nombre = `Nombre debe tener entre ${RULE_NAME_MIN} y ${RULE_NAME_MAX} caracteres.`;
  }
  if (form.descripcion.length > RULE_DESCRIPTION_MAX) {
    errors.descripcion = `Descripcion maximo ${RULE_DESCRIPTION_MAX} caracteres.`;
  }
  if (!form.plantilla_id) {
    errors.plantilla_id = "Selecciona una plantilla para la regla.";
  }
  if (!Number.isInteger(offset) || offset < RULE_OFFSET_MIN || offset > RULE_OFFSET_MAX) {
    errors.desplazamiento_dias = `Desfase debe ser entero de ${RULE_OFFSET_MIN} a ${RULE_OFFSET_MAX} dias.`;
  }
  if (!EVENT_BASES.some((eventBase) => eventBase.value === form.evento_base)) {
    errors.evento_base = "Selecciona un evento base valido.";
  }
  if (!SEGMENTS.some((segment) => segment.value === form.segmento)) {
    errors.segmento = "Selecciona un segmento valido.";
  }
  return errors;
}

function validateEvidenceForm(form: EvidenceForm): Record<string, string> {
  const errors: Record<string, string> = {};
  const amount = parseMoneyValue(form.monto_reportado);
  const hasEvidenceContent = Boolean(
    form.url_archivo.trim() ||
      form.monto_reportado.trim() ||
      form.fecha_pago_reportada.trim() ||
      form.referencia_reportada.trim() ||
      form.texto_extraido.trim() ||
      form.observaciones.trim(),
  );
  if (!form.entidad_id) {
    errors.entidad_id = "Selecciona la unidad de negocio del comprobante.";
  }
  if (!form.cliente_id) {
    errors.cliente_id = "Selecciona el cliente que envio el comprobante.";
  }
  if (!hasEvidenceContent) {
    errors.url_archivo =
      "Sube un archivo o captura al menos un dato del comprobante antes de registrarlo.";
  }
  if (form.monto_reportado) {
    if (amount === null || amount <= 0 || amount > MONEY_MAX || !hasTwoDecimalsOrLess(form.monto_reportado)) {
      errors.monto_reportado = "Monto debe ser dinero positivo con hasta 2 decimales.";
    }
  }
  if (form.fecha_pago_reportada && !isValidDate(form.fecha_pago_reportada)) {
    errors.fecha_pago_reportada = "Fecha de pago debe ser una fecha valida.";
  }
  if (form.referencia_reportada.length > EVIDENCE_REFERENCE_MAX) {
    errors.referencia_reportada = `Referencia maximo ${EVIDENCE_REFERENCE_MAX} caracteres.`;
  }
  if (form.url_archivo && !isValidHttpUrl(form.url_archivo)) {
    errors.url_archivo = "URL archivo debe iniciar con http:// o https://.";
  }
  if (form.texto_extraido.length > EVIDENCE_TEXT_MAX) {
    errors.texto_extraido = `Texto extraido maximo ${EVIDENCE_TEXT_MAX} caracteres.`;
  }
  if (form.observaciones.length > EVIDENCE_OBSERVATIONS_MAX) {
    errors.observaciones = `Observaciones maximo ${EVIDENCE_OBSERVATIONS_MAX} caracteres.`;
  }
  return errors;
}

function validateEvidenceFilters(filters: EvidenceFilters): string | null {
  if (filters.search.length > EVIDENCE_SEARCH_MAX) {
    return `Busqueda maximo ${EVIDENCE_SEARCH_MAX} caracteres.`;
  }
  if (filters.dateFrom && !isValidDate(filters.dateFrom)) {
    return "Desde debe ser una fecha valida.";
  }
  if (filters.dateTo && !isValidDate(filters.dateTo)) {
    return "Hasta debe ser una fecha valida.";
  }
  if (filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo) {
    return "Desde no puede ser posterior a Hasta.";
  }
  return null;
}

function mergeUploadIntoEvidenceForm(
  current: EvidenceForm,
  response: EvidenceUploadResult,
): EvidenceForm {
  const extractedText = (response.texto_extraido || "").trim();
  const nextText = extractedText
    ? limitMultilineText(
        [current.texto_extraido.trim(), extractedText].filter(Boolean).join("\n\n"),
        EVIDENCE_TEXT_MAX,
      )
    : current.texto_extraido;
  const uploadNote = `Archivo cargado: ${response.nombre}`;
  const nextObservations = limitPlainText(
    [current.observaciones.trim(), uploadNote].filter(Boolean).join(" | "),
    EVIDENCE_OBSERVATIONS_MAX,
  );
  return {
    ...current,
    url_archivo: response.url || current.url_archivo,
    hash_archivo: response.hash_archivo || current.hash_archivo,
    texto_extraido: nextText,
    observaciones: nextObservations,
  };
}

function statusLabel(value: string | null | undefined): string {
  if (!value) {
    return "Sin estado";
  }
  return STATUS_LABELS[value] ?? value.replaceAll("_", " ").toLowerCase();
}

function cronCoverageLabel(value: string | null | undefined): string {
  if (value === "CAPA") {
    return "Solo esta capa";
  }
  if (value === "GLOBAL_DETALLADO") {
    return "Global con detalle de capa";
  }
  if (value === "GLOBAL_LEGACY") {
    return "Global anterior";
  }
  if (value === "SIN_COBERTURA") {
    return "No incluyo esta capa";
  }
  return "Sin cobertura";
}

function metadataString(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
): string {
  const value = metadata?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function metadataNumber(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
): number | null {
  const value = metadata?.[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function metadataBoolean(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
): boolean {
  return metadata?.[key] === true;
}

function metadataRecord(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
): Record<string, unknown> | null {
  const value = metadata?.[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function historyReviewInfo(
  item: HistoryItem,
): { reviewedAt: string; reviewedBy: string; note: string } | null {
  const review =
    item.revision_operativa || metadataRecord(item.metadata, "revision_operativa");
  const reviewedAt = metadataString(review, "reviewed_at");
  if (!reviewedAt) {
    return null;
  }
  return {
    reviewedAt,
    reviewedBy:
      metadataString(review, "reviewed_by_email") ||
      metadataString(review, "reviewed_by_name") ||
      "BetterP",
    note: metadataString(review, "note"),
  };
}

function historyNeedsReview(item: HistoryItem): boolean {
  return !historyReviewInfo(item);
}

function providerReferenceLabel(value?: string | null): string {
  const reference = (value || "").trim();
  if (!reference) {
    return "Sin referencia";
  }
  if (reference.startsWith("wamid.")) {
    return "ID Meta registrado";
  }
  return limitPlainText(reference, 56);
}

function durationLabel(milliseconds: number | null | undefined): string {
  if (!milliseconds || milliseconds < 0) {
    return "Sin duracion";
  }
  if (milliseconds < 1000) {
    return `${milliseconds} ms`;
  }
  return `${(milliseconds / 1000).toFixed(1)} s`;
}

function historyOperationalInsight(
  item: HistoryItem,
): { title: string; details: string[]; tone: "amber" | "rose" } | null {
  const metadata = item.metadata || {};
  let reason = metadataString(metadata, "reason");
  const error = metadataString(metadata, "error");
  const status = item.estatus || "";
  const provider = item.proveedor || "";
  if (!reason && status === "OMITIDO" && provider === "SAFETY_ALLOWLIST") {
    reason = "Destino WhatsApp fuera de allowlist";
  }
  if (!reason && status !== "OMITIDO" && status !== "ERROR" && !error) {
    return null;
  }

  if (status === "ERROR" || error) {
    const details: string[] = [];
    if (error) {
      details.push(limitPlainText(error, 280));
    } else {
      details.push("El proveedor rechazo el intento o no se pudo completar el envio.");
    }
    const attempts = metadataNumber(metadata, "attempts");
    if (attempts !== null && attempts > 1) {
      details.push(`Intentos realizados: ${attempts}.`);
    }
    const reference = metadataString(metadata, "referencia_pago");
    if (reference) {
      details.push(`Referencia de pago: ${reference}.`);
    }
    const total = metadataNumber(metadata, "total_exigible");
    if (total !== null && total > 0) {
      details.push(`Importe relacionado: ${money(total)}.`);
    }
    return {
      title: "Error de proveedor al enviar",
      details,
      tone: "rose",
    };
  }

  const normalized = reason.toLowerCase();
  let title = reason || "Envio omitido por control operativo";
  const details: string[] = [];

  if (normalized.includes("24 horas")) {
    title = "Contacto bloqueado por ventana de 24 horas";
    const availableAfter = metadataString(metadata, "available_after");
    if (availableAfter) {
      details.push(`Disponible despues de ${dateTimeLabel(availableAfter)}.`);
    }
    const lastSentAt = metadataString(metadata, "last_sent_at");
    const lastChannel = metadataString(metadata, "last_channel");
    const lastStatus = metadataString(metadata, "last_status");
    if (lastSentAt) {
      details.push(
        `Ultimo contacto: ${dateTimeLabel(lastSentAt)}${
          lastChannel ? ` por ${lastChannel}` : ""
        }${lastStatus ? ` (${statusLabel(lastStatus)})` : ""}.`,
      );
    }
  } else if (normalized.includes("allowlist")) {
    title = "Destino fuera de la lista segura de WhatsApp";
    details.push("El sistema esta en modo controlado y solo permite numeros autorizados.");
  } else if (normalized.includes("consentimiento")) {
    title = "Consentimiento de cobranza pendiente";
    details.push(
      "El cliente debe entrar al portal, validar su codigo y aceptar el consentimiento antes de recibir recordatorios de cobranza por WhatsApp.",
    );
    const consentVersion = metadataString(metadata, "consentimiento_version_actual");
    if (consentVersion) {
      details.push(`Version requerida: ${consentVersion}.`);
    }
  } else if (normalized.includes("limite maximo")) {
    title = "Limite de envios por corrida alcanzado";
    const maxSends = metadataNumber(metadata, "max_sends");
    if (maxSends !== null) {
      details.push(`Tope configurado para esta corrida: ${maxSends} envio(s).`);
    }
  } else if (normalized.includes("consumo")) {
    title = "Limite mensual de consumo alcanzado";
    const usage = metadata.consumo_saas;
    if (usage && typeof usage === "object" && !Array.isArray(usage)) {
      const usageData = usage as Record<string, unknown>;
      const used = metadataNumber(usageData, "usado");
      const included = metadataNumber(usageData, "incluido");
      if (used !== null && included !== null) {
        details.push(`Consumo del mes: ${used}/${included}.`);
      }
    }
  } else if (normalized.includes("sin canal")) {
    title = "Cliente sin canal de contacto disponible";
    details.push("Falta telefono WhatsApp o correo valido para enviar el aviso.");
  } else if (normalized.includes("no contactar")) {
    title = "Cliente bloqueado para cobranza";
    details.push(
      "El cliente esta marcado como no contactar, por lo que BetterP omitio el envio antes de llamar al proveedor.",
    );
    const motive = metadataString(metadata, "motivo");
    if (motive) {
      details.push(`Motivo registrado: ${motive}.`);
    }
  }

  const reference = metadataString(metadata, "referencia_pago");
  if (reference) {
    details.push(`Referencia de pago: ${reference}.`);
  }
  const total = metadataNumber(metadata, "total_exigible");
  if (total !== null && total > 0) {
    details.push(`Importe relacionado: ${money(total)}.`);
  }
  return { title, details, tone: "amber" };
}

function followupLinkLabel(value: string | null | undefined): string {
  if (value === "cuenta") return "Cuenta exacta";
  if (value === "cliente") return "Cliente";
  return "Sin vinculo";
}

function followupLinkClass(value: string | null | undefined): string {
  if (value === "cuenta") {
    return "border-emerald-400/25 bg-emerald-500/10 text-emerald-200";
  }
  if (value === "cliente") {
    return "border-amber-400/25 bg-amber-500/10 text-amber-200";
  }
  return "border-zinc-600/40 bg-zinc-800/70 text-zinc-300";
}

function clientCatalogLabel(client: Catalogos["clientes"][number]): string {
  const space = client.espacio_codigo?.trim();
  return space ? `${client.nombre} - ${space}` : client.nombre;
}

function rowMatchesFollowupFilter(row: CxcRow, filter: FollowupFilter): boolean {
  const followup = row.seguimiento_cobranza;
  if (filter === "TODAS") return true;
  if (filter === "CUENTA_EXACTA") return followup?.vinculo === "cuenta";
  if (filter === "CLIENTE") return followup?.vinculo === "cliente";
  return (followup?.estado || "SIN_AVISO") === filter;
}

function cxcRowOpenBalance(row: CxcRow): number {
  return Math.max(
    Number(row.total_a_pagar || 0) - Number(row.monto_pagado || 0),
    0,
  );
}

function cxcRowIsOpen(row: CxcRow): boolean {
  return cxcRowOpenBalance(row) > 0 && !CLOSED_CXC_STATUSES.has(row.estatus);
}

function cxcRowToEvidenceCandidate(
  row: CxcRow,
  evidence: Evidence,
): EvidenceCxcCandidate {
  const amount = Number(evidence.monto_reportado || 0);
  const balance = cxcRowOpenBalance(row);
  const reasons = ["seleccion manual"];
  if (amount > 0 && balance === amount) {
    reasons.unshift("monto exacto");
  } else if (amount > 0 && amount < balance) {
    reasons.unshift("pago parcial posible");
  } else if (amount > 0 && amount > balance) {
    reasons.unshift("excedente aplicable");
  }
  return {
    id: row.id,
    concepto: row.concepto,
    entidad_nombre: row.entidad_nombre,
    espacio_codigo: row.espacio_codigo,
    fecha_periodo_inicio: row.fecha_periodo_inicio,
    fecha_periodo_fin: row.fecha_periodo_fin,
    fecha_vencimiento: row.fecha_vencimiento,
    monto_total: row.total_a_pagar,
    monto_pagado: row.monto_pagado,
    saldo_pendiente: balance,
    estatus_adeudo: row.estatus,
    referencia_unica: row.referencia_unica,
    motivos: reasons,
  };
}

function buildManualCxcCandidates(
  evidence: Evidence,
  rows: CxcRow[],
): EvidenceCxcCandidate[] {
  if (!evidence.cliente_id) {
    return [];
  }
  return rows
    .filter((row) => row.cliente_id === evidence.cliente_id && cxcRowIsOpen(row))
    .sort((a, b) => {
      const left = a.fecha_vencimiento || "";
      const right = b.fecha_vencimiento || "";
      return left.localeCompare(right) || a.id - b.id;
    })
    .slice(0, 5)
    .map((row) => cxcRowToEvidenceCandidate(row, evidence));
}

function badgeClass(status: string | null | undefined): string {
  const value = status ?? "";
  if (
    [
      "PAGADA",
      "VALIDADA",
      "VALIDADO",
      "APLICADA",
      "APLICADO",
      "CONCILIADO",
      "ENTREGADO",
      "LEIDO",
      "APROBADA",
    ].includes(value)
  ) {
    return "border-emerald-400/25 bg-emerald-500/10 text-emerald-200";
  }
  if (["EN_GRACIA", "POR_VENCER", "ENVIADO", "NUEVA", "AVISO_RECIENTE"].includes(value)) {
    return "border-cyan-400/25 bg-cyan-500/10 text-cyan-200";
  }
  if (["VENCIDA_CON_RECARGO", "REQUIERE_SEGUIMIENTO", "OMITIDO", "EN_REVISION", "PAUSADA"].includes(value)) {
    return "border-amber-400/25 bg-amber-500/10 text-amber-200";
  }
  if (["ERROR", "DESCARTADA", "ERROR_SPAM", "RECHAZADA"].includes(value)) {
    return "border-rose-400/25 bg-rose-500/10 text-rose-200";
  }
  return "border-zinc-600/40 bg-zinc-800/70 text-zinc-300";
}

function evidenceSourceLabel(evidence: Evidence): string {
  const metadata = evidence.metadata || {};
  const origin = String(metadata.origen || evidence.origen_deteccion || evidence.canal || "").toUpperCase();
  if (origin === "PORTAL_CLIENTE" || evidence.categoria_sugerida === "Comprobante portal cliente") {
    return "Portal cliente";
  }
  if (origin.includes("META")) {
    return "WhatsApp Cloud";
  }
  if (origin.includes("GREEN")) {
    return "WhatsApp";
  }
  if (origin === "MANUAL") {
    return "Manual";
  }
  return evidence.canal || "Sin canal";
}

function evidenceMetadataText(evidence: Evidence, key: string): string {
  const value = evidence.metadata?.[key];
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

function evidenceMetadataRecord(
  evidence: Evidence,
  key: string,
): Record<string, unknown> | null {
  const value = evidence.metadata?.[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function displayDetailValue(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "Sin dato";
  }
  if (typeof value === "boolean") {
    return value ? "Si" : "No";
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "Sin dato";
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function metadataWithoutReading(evidence: Evidence): Record<string, unknown> {
  const metadata = evidence.metadata || {};
  return Object.fromEntries(
    Object.entries(metadata).filter(([key]) => key !== "lectura_ia"),
  );
}

function normalizeReceiptSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanDetectedReceiptValue(value: string): string {
  return value
    .replace(/^[\s:;.,*#|/-]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function readReceiptField(
  source: string,
  labels: string[],
  stops: string[],
): string {
  const normalizedSource = normalizeReceiptSearchText(source);
  if (!normalizedSource) {
    return "";
  }
  const labelPattern = labels.map(escapeRegExp).join("|");
  const stopPattern = stops.map(escapeRegExp).join("|");
  const expression = new RegExp(
    `(?:${labelPattern})\\s*:?\\s*([\\s\\S]{0,220}?)(?=\\s+(?:${stopPattern})\\s*:?|$)`,
    "i",
  );
  const match = normalizedSource.match(expression);
  return cleanDetectedReceiptValue(match?.[1] || "");
}

function buildReceiptTextSource(evidence: Evidence): string {
  return [evidence.texto_extraido, evidence.observaciones]
    .filter((value): value is string => Boolean(value?.trim()))
    .join("\n");
}

function formatDetectedAmount(value: unknown): string {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  const parsed = Number(raw.replace(/[^0-9.-]/g, ""));
  if (Number.isFinite(parsed) && parsed > 0) {
    return money(parsed);
  }
  return raw;
}

function buildDetectedReceiptRows(
  evidence: Evidence,
  aiReading: Record<string, unknown> | null,
): Array<[string, unknown]> {
  const source = buildReceiptTextSource(evidence);
  const normalizedSource = normalizeReceiptSearchText(source).toUpperCase();
  const stops = [
    "BBVA",
    "COMPROBANTE DE LA OPERACION",
    "Tipo de operacion",
    "Folio de la operacion",
    "Fecha",
    "Hora",
    "Concepto",
    "Importe transferido",
    "Cuenta de origen",
    "Nombre del beneficiario",
    "Nombre del banco",
    "Cuenta de destino",
    "BBVA Mexico",
  ];
  const field = (labels: string[]) => readReceiptField(source, labels, stops);
  const amount =
    formatDetectedAmount(aiReading?.monto) ||
    formatDetectedAmount(field(["Importe transferido", "Importe", "Monto"]));
  const detectedBank =
    aiReading?.banco ||
    field(["Nombre del banco"]) ||
    (normalizedSource.includes("BBVA") ? "BBVA" : "");

  return [
    ["Fuente OCR", aiReading?.fuente || "Sin lectura guardada"],
    ["Modelo OCR", aiReading?.modelo || "Sin modelo"],
    ["Banco detectado", detectedBank],
    ["Tipo de operacion", field(["Tipo de operacion"])],
    [
      "Folio / referencia",
      aiReading?.referencia || evidence.referencia_reportada || field(["Folio de la operacion", "Referencia"]),
    ],
    [
      "Fecha del comprobante",
      aiReading?.fecha_pago || evidence.fecha_pago_reportada || field(["Fecha"]),
    ],
    ["Hora", field(["Hora"])],
    ["Concepto", field(["Concepto"])],
    [
      "Importe transferido",
      amount || (evidence.monto_reportado ? money(evidence.monto_reportado) : ""),
    ],
    ["Cuenta de origen", field(["Cuenta de origen"])],
    ["Beneficiario", aiReading?.receptor || field(["Nombre del beneficiario", "Beneficiario"])],
    ["Banco destino", field(["Nombre del banco"])],
    ["Cuenta de destino", field(["Cuenta de destino"])],
  ];
}

function evidenceTraceMeta(evidence: Evidence): string {
  const trace = evidence.trazabilidad;
  if (!trace) return "Sin trazabilidad";
  if (trace.transaccion_id) return `Movimiento #${trace.transaccion_id}`;
  if (trace.evento_id) return `Evento #${trace.evento_id}`;
  if (trace.pagos.activos > 0) return `${trace.pagos.activos} pago(s) aplicado(s)`;
  return statusLabel(trace.etapa_actual);
}

function evidenceHasAnalysisInput(evidence: Evidence): boolean {
  return Boolean(
    evidence.url_archivo?.trim() ||
      evidence.texto_extraido?.trim() ||
      evidence.observaciones?.trim(),
  );
}

function evidenceHasSavedReading(evidence: Evidence): boolean {
  return Boolean(evidenceMetadataRecord(evidence, "lectura_ia"));
}

function evidenceCanRequestAnalysis(evidence: Evidence): boolean {
  return (
    evidenceHasAnalysisInput(evidence) &&
    !EVIDENCE_ANALYSIS_TERMINAL_STATUSES.has(evidence.estatus)
  );
}

function evidenceShouldAutoAnalyze(evidence: Evidence, reused: boolean): boolean {
  if (!evidenceCanRequestAnalysis(evidence)) {
    return false;
  }
  if (!reused) {
    return true;
  }
  return (
    !evidenceHasSavedReading(evidence) &&
    !EVIDENCE_REUSED_AUTO_ANALYSIS_STATUSES.has(evidence.estatus)
  );
}

function upsertEvidenceListItem(items: Evidence[], evidence: Evidence): Evidence[] {
  return [
    evidence,
    ...items.filter((item) => item.id !== evidence.id),
  ].slice(0, 100);
}

function getErrorMessage(value: unknown): string {
  if (value instanceof Error) {
    return value.message;
  }
  if (typeof value === "string") {
    return value;
  }
  return "No se pudo completar la operacion.";
}

function settledErrorMessage(
  label: string,
  result: PromiseSettledResult<unknown>,
): string | null {
  if (result.status === "fulfilled") {
    return null;
  }
  return `${label}: ${getErrorMessage(result.reason)}`;
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let payload: unknown = {};
  if (text) {
    if (/^\s*</.test(text)) {
      throw new Error("El servidor no pudo responder esta vista. Intenta de nuevo o revisa el modulo interno.");
    }
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { detail: text };
    }
  }
  if (!response.ok) {
    const detail =
      typeof payload === "object" && payload !== null && "detail" in payload
        ? String((payload as { detail?: unknown }).detail)
        : response.statusText;
    throw new Error(detail || `Error HTTP ${response.status}`);
  }
  return payload as T;
}

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  return readJsonResponse<T>(response);
}

function toConfigForm(config: CommsConfig | null): ConfigForm {
  return {
    clave: config?.clave || "PRINCIPAL",
    green_api_api_url: config?.green_api_api_url || "",
    green_api_instance_id: config?.green_api_instance_id || "",
    green_api_token: config?.green_api_token || "",
    green_api_webhook_url: config?.green_api_webhook_url || "",
    green_api_webhook_token: config?.green_api_webhook_token || "",
    green_api_modo_filtro: config?.green_api_modo_filtro || "SOLO_PERMITIDOS",
    green_api_sync_settings: Boolean(config?.green_api_sync_settings),
    procesar_webhooks_async: config?.procesar_webhooks_async ?? true,
    make_webhook_url: config?.make_webhook_url || "",
    openai_model: config?.openai_model || "gpt-4o-mini",
    prompt_extraccion:
      config?.prompt_extraccion ||
      "Extrae monto, fecha, referencia, banco, emisor y confianza del comprobante. Devuelve solo JSON.",
    auto_detectar_comprobantes: config?.auto_detectar_comprobantes ?? true,
    auto_crear_eventos: config?.auto_crear_eventos ?? true,
    auto_aplicar_eventos_confiables:
      config?.auto_aplicar_eventos_confiables ?? false,
    auto_conciliar_eventos: config?.auto_conciliar_eventos ?? false,
    umbral_confianza_autoaplicacion: String(
      config?.umbral_confianza_autoaplicacion ?? 85,
    ),
    ventana_match_dias: String(config?.ventana_match_dias ?? 7),
    tolerancia_monto: String(config?.tolerancia_monto ?? 0),
    email_activo: config?.email_activo ?? false,
    email_remitente_nombre: config?.email_remitente_nombre || "",
    email_remitente: config?.email_remitente || "",
    email_responder_a: config?.email_responder_a || "",
    respetar_bajas_whatsapp: config?.respetar_bajas_whatsapp ?? true,
    portal_token_horas: String(config?.portal_token_horas ?? 168),
    activo: config?.activo ?? true,
  };
}

function toTemplateForm(template: Template): TemplateForm {
  return {
    nombre: template.nombre,
    descripcion: template.descripcion || "",
    canal: template.canal,
    tipo_plantilla: template.tipo_plantilla,
    asunto: template.asunto || "",
    cuerpo: template.cuerpo,
    incluye_link_portal: template.incluye_link_portal,
    url_media: template.url_media || "",
    activo: template.activo,
  };
}

function toRuleForm(rule: AutomationRule): RuleForm {
  return {
    nombre: rule.nombre,
    descripcion: rule.descripcion || "",
    plantilla_id: rule.plantilla_id,
    entidad_id: rule.entidad_id ?? null,
    canal: rule.canal,
    evento_base: rule.evento_base,
    desplazamiento_dias: String(rule.desplazamiento_dias),
    segmento: rule.segmento,
    activo: rule.activo,
  };
}

function compactClientName(value: string): string {
  return value.length > 34 ? `${value.slice(0, 31)}...` : value;
}

function PreparationTab({
  monitoring,
  templates,
  rules,
  catalogs,
  whatsappAgreement,
  busy,
  labTemplateId,
  labDestination,
  labResult,
  labError,
  labContactName,
  labContactPhone,
  labContactConsent,
  labContactError,
  demoMetaEntityId,
  demoMetaResult,
  demoMetaError,
  onDemoMetaEntityChange,
  onPrepareDemoMeta,
  onResetLabProcess,
  onLabTemplateChange,
  onLabDestinationChange,
  onLabContactNameChange,
  onLabContactPhoneChange,
  onLabContactConsentChange,
  onAddLabContact,
  onDeleteLabContact,
  onSendLabTest,
  onSyncMeta,
  onRefresh,
  onInfo,
}: {
  monitoring: AutomationMonitoring | null;
  templates: Template[];
  rules: AutomationRule[];
  catalogs: Catalogos;
  whatsappAgreement: WhatsappAgreementState | null;
  busy: boolean;
  labTemplateId: number | null;
  labDestination: string;
  labResult: WhatsappLabResult | null;
  labError: string | null;
  labContactName: string;
  labContactPhone: string;
  labContactConsent: boolean;
  labContactError: string | null;
  demoMetaEntityId: number | null;
  demoMetaResult: CobranzaDemoMetaResult | null;
  demoMetaError: string | null;
  onDemoMetaEntityChange: (entityId: number | null) => void;
  onPrepareDemoMeta: () => void;
  onResetLabProcess: (destination?: string, label?: string) => void;
  onLabTemplateChange: (templateId: number | null) => void;
  onLabDestinationChange: (destination: string) => void;
  onLabContactNameChange: (value: string) => void;
  onLabContactPhoneChange: (value: string) => void;
  onLabContactConsentChange: (checked: boolean) => void;
  onAddLabContact: () => void;
  onDeleteLabContact: (contactId: number) => void;
  onSendLabTest: () => void;
  onSyncMeta: () => void;
  onRefresh: () => void;
  onInfo: (info: CobranzaInfoContent) => void;
}) {
  const whatsappTemplates = templates.filter(isMetaWhatsappTemplate);
  const cobranzaWhatsappTemplates = whatsappTemplates.filter((template) =>
    ["RECORDATORIO_PAGO", "AVISO_INTERES"].includes(template.tipo_plantilla),
  );
  const approvedTemplates = whatsappTemplates.filter(
    (template) => template.whatsapp_template_status === "APROBADA",
  );
  const approvedCollectionTemplates = cobranzaWhatsappTemplates.filter(
    (template) => template.whatsapp_template_status === "APROBADA",
  );
  const pendingCollectionTemplates = cobranzaWhatsappTemplates.filter(
    (template) => template.whatsapp_template_status !== "APROBADA",
  );
  const whatsappTemplateTotal =
    monitoring?.plantillas?.whatsapp_total ?? cobranzaWhatsappTemplates.length;
  const approvedTemplateTotal =
    monitoring?.plantillas?.whatsapp_aprobadas ?? approvedCollectionTemplates.length;
  const pendingTemplateTotal =
    monitoring?.plantillas?.whatsapp_pendientes ?? pendingCollectionTemplates.length;
  const metaTemplateRows =
    monitoring?.plantillas?.whatsapp_detalle?.length
      ? monitoring.plantillas.whatsapp_detalle
      : cobranzaWhatsappTemplates.map((template) => ({
          id: template.id,
          nombre: template.nombre,
          tipo_plantilla: template.tipo_plantilla,
          whatsapp_template_name: template.whatsapp_template_name,
          whatsapp_template_language: template.whatsapp_template_language,
          whatsapp_template_category: template.whatsapp_template_category,
          whatsapp_template_status: template.whatsapp_template_status,
          whatsapp_template_notes: template.whatsapp_template_notes,
          activo: template.activo,
        }));
  const metaStatusRows = monitoring?.plantillas?.whatsapp_por_estado ?? [];
  const metaChannel = monitoring?.plantillas?.canal_meta;
  const lastMetaSyncLabel = monitoring?.plantillas?.ultima_sincronizacion_meta
    ? dateTimeLabel(monitoring.plantillas.ultima_sincronizacion_meta)
    : "Sin sincronizacion registrada";
  const activeWhatsappRules = rules.filter(
    (rule) => rule.activo && channelUsesWhatsapp(rule.canal),
  );
  const blockedRules =
    monitoring?.reglas?.whatsapp_bloqueadas ??
    activeWhatsappRules
      .map((rule) => {
        const template = templates.find((item) => item.id === rule.plantilla_id);
        if (template?.whatsapp_template_status === "APROBADA") {
          return null;
        }
        return {
          id: rule.id,
          nombre: rule.nombre,
          plantilla_nombre: rule.plantilla_nombre,
          plantilla_estado: template?.whatsapp_template_status || "NO_CONFIGURADA",
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
  const agreementOk =
    !whatsappAgreement?.required || Boolean(whatsappAgreement?.accepted);
  const safeMode = monitoring?.modo_seguro;
  const testLab = safeMode?.laboratorio_cobranza;
  const allowedLabNumbers = safeMode?.numeros_whatsapp_permitidos ?? [];
  const allowedLabNumberSet = buildWhatsappAllowlistSet(allowedLabNumbers);
  const labContacts = testLab?.contactos_whatsapp_prueba ?? [];
  const labContactByNumber = new Map<string, WhatsappLabContact>();
  labContacts.forEach((contact) => {
    whatsappNumberVariants(contact.telefono_normalizado || contact.telefono).forEach(
      (variant) => labContactByNumber.set(variant, contact),
    );
  });
  const labNumberOptions = allowedLabNumbers.map((number) => {
    const contact = Array.from(whatsappNumberVariants(number)).reduce<
      WhatsappLabContact | undefined
    >((match, variant) => match || labContactByNumber.get(variant), undefined);
    return {
      number,
      label: contact ? `${contact.nombre} - ${number}` : number,
      contact,
    };
  });
  const labDestinationBlocked =
    Boolean(safeMode?.solo_numeros_whatsapp_permitidos) &&
    Boolean(labDestination) &&
    !isWhatsappDestinationAllowed(labDestination, allowedLabNumberSet);
  const labTemplates = approvedTemplates.filter(
    (template) => template.activo && Boolean(template.whatsapp_template_name),
  );
  const sandboxText = safeMode?.solo_numeros_whatsapp_permitidos
    ? `${allowedLabNumbers.length} numero(s) permitido(s)`
    : "Sin allowlist";
  const labSendDisabled =
    busy ||
    !testLab?.habilitado ||
    !labTemplates.length ||
    !allowedLabNumbers.length ||
    !labTemplateId ||
    !labDestination ||
    labDestinationBlocked;
  const selectedDemoEntity = catalogs.entidades.find(
    (entity) => entity.id === demoMetaEntityId,
  );
  const demoMetaDisabled =
    busy || !testLab?.habilitado || !allowedLabNumbers.length || !demoMetaEntityId;
  const checklist = [
    {
      label: "Acuerdo de uso aceptado",
      ok: agreementOk,
      detail: agreementOk
        ? "El descargo de responsabilidad ya esta cubierto para esta capa."
        : "Antes de enviar con el numero de BetterP, acepta el acuerdo.",
    },
    {
      label: "Plantillas aprobadas por Meta",
      ok: whatsappTemplateTotal > 0 && pendingTemplateTotal === 0,
      detail: `${approvedTemplateTotal}/${whatsappTemplateTotal} plantilla(s) WhatsApp de cobranza aprobadas.`,
    },
    {
      label: "Reglas sin bloqueo por plantilla",
      ok: blockedRules.length === 0,
      detail: blockedRules.length
        ? `${blockedRules.length} regla(s) activa(s) esperan aprobacion de Meta.`
        : "Las reglas activas ya apuntan a plantillas listas.",
    },
    {
      label: "Zona de prueba controlada",
      ok: Boolean(safeMode?.solo_numeros_whatsapp_permitidos),
      detail: sandboxText,
    },
    {
      label: "Bajas por WhatsApp",
      ok: Boolean(safeMode?.respetar_bajas_whatsapp),
      detail: safeMode?.respetar_bajas_whatsapp
        ? "Si un cliente responde BAJA, STOP o NO ENVIAR, BetterP lo marca como no contactar."
        : "Las solicitudes de baja quedan auditadas, pero no bloquean automaticamente los envios.",
    },
    {
      label: "Laboratorio limitado a Maya Coliving",
      ok: Boolean(testLab?.habilitado),
      detail: testLab?.habilitado
        ? `Disponible para ${testLab.usuario_actual || "usuario autorizado"} en ${testLab.capa_actual || "capa autorizada"}.`
        : testLab?.motivo ||
          "Solo 01.agodinez@gmail.com puede usarlo en la capa Maya Coliving.",
    },
    {
      label: "Plantillas bloqueadas para clientes",
      ok: Boolean(safeMode?.plantillas_bloqueadas_para_clientes),
      detail: safeMode?.plantillas_bloqueadas_para_clientes
        ? "Los clientes no pueden editar los textos de cobranza."
        : "Activa LOCK_TENANT_MESSAGE_TEMPLATES antes de produccion.",
    },
  ];
  const statusClass =
    monitoring?.status === "OK"
      ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-100"
      : monitoring?.status === "ERROR"
        ? "border-rose-400/25 bg-rose-500/10 text-rose-100"
        : "border-amber-400/25 bg-amber-500/10 text-amber-100";
  const cronLastRun = monitoring?.cron?.last_run ?? null;
  const cronLayerSummary = cronLastRun?.layer_summary ?? {};
  const cronMetadata = cronLastRun?.metadata ?? {};
  const cronSendWindow = metadataRecord(cronMetadata, "send_window");
  const cronReferenceTime = cronLastRun?.finished_at || cronLastRun?.started_at || null;
  const cronSent =
    metadataNumber(cronLayerSummary, "sent") ?? metadataNumber(cronMetadata, "sent") ?? 0;
  const cronSkipped =
    metadataNumber(cronLayerSummary, "skipped") ??
    metadataNumber(cronMetadata, "skipped") ??
    0;
  const cronErrors =
    metadataNumber(cronLayerSummary, "errors") ??
    metadataNumber(cronMetadata, "errors") ??
    0;
  const cronCandidates = metadataNumber(cronLayerSummary, "candidates") ?? 0;
  const cronRules = metadataNumber(cronLayerSummary, "rules") ?? 0;
  const cronMaxSends = metadataNumber(cronMetadata, "max_envios");
  const cronMaxPerLayer = metadataNumber(cronMetadata, "max_envios_por_capa");
  const cronIsDryRun =
    metadataBoolean(cronLayerSummary, "dry_run") || metadataBoolean(cronMetadata, "dry_run");
  const cronSkippedByWindow =
    metadataBoolean(cronMetadata, "skipped_by_send_window") ||
    cronSendWindow?.can_send === false;
  const cronWindowLabel = cronSendWindow
    ? `${metadataString(cronSendWindow, "window_start") || "?"}-${
        metadataString(cronSendWindow, "window_end") || "?"
      } ${metadataString(cronSendWindow, "timezone") || ""}`.trim()
    : "Sin ventana registrada";
  const cronWindowDetail = cronSendWindow
    ? metadataString(cronSendWindow, "detail") || "Sin detalle de ventana."
    : "La ultima corrida no reporto ventana operativa.";
  const operationalActions = monitoring?.acciones_operativas ?? [];

  return (
    <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="page-section">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="section-title-compact">Preparacion de WhatsApp</h2>
              <CobranzaInfoButton info={cobranzaTabInfo.preparacion} onOpen={onInfo} />
            </div>
            <p className="mt-2 section-copy-compact">
              Usa esta pantalla mientras Meta revisa las plantillas. Aqui puedes
              confirmar que BetterP sigue en modo controlado y detectar que falta
              antes de activar envios automaticos reales.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onRefresh}
              disabled={busy}
              className="rounded-2xl border border-white/10 bg-zinc-950/70 px-4 py-2 text-sm font-semibold text-zinc-100 transition hover:border-white/25 disabled:opacity-60"
            >
              Actualizar
            </button>
            <button
              type="button"
              onClick={onSyncMeta}
              disabled={busy}
              className="rounded-2xl border border-cyan-400/25 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:border-cyan-300/50 disabled:opacity-60"
            >
              Sincronizar Meta
            </button>
          </div>
        </div>

        <div className={`mt-5 rounded-2xl border px-4 py-3 text-sm ${statusClass}`}>
          Estado general: {monitoring ? statusLabel(monitoring.status) : "Sin monitoreo disponible"}
          {monitoring?.cron?.detail ? (
            <span className="ml-2 text-xs opacity-80">{monitoring.cron.detail}</span>
          ) : null}
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <MetricCard
            label="Plantillas Meta"
            value={`${approvedTemplateTotal}/${whatsappTemplateTotal}`}
            helper={`${pendingTemplateTotal} pendiente(s)`}
            tone={pendingTemplateTotal ? "amber" : "emerald"}
          />
          <MetricCard
            label="Reglas WhatsApp"
            value={String(activeWhatsappRules.length)}
            helper={`${blockedRules.length} bloqueada(s)`}
            tone={blockedRules.length ? "amber" : "cyan"}
          />
          <MetricCard
            label="Actividad 24h"
            value={String(monitoring?.actividad?.total_24h ?? 0)}
            helper={`${monitoring?.actividad?.errores_24h ?? 0} error(es)`}
            tone={monitoring?.actividad?.errores_24h ? "rose" : "blue"}
          />
        </div>

        <div className="mt-5 rounded-2xl border border-white/10 bg-zinc-950/60 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-sm font-semibold text-white">
                Operacion automatica
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                {cronReferenceTime
                  ? `Ultima corrida: ${dateTimeLabel(cronReferenceTime)}`
                  : "Sin corrida registrada"}
                {monitoring?.cron?.minutes_since_last_run !== null &&
                monitoring?.cron?.minutes_since_last_run !== undefined
                  ? ` | hace ${monitoring.cron.minutes_since_last_run} min`
                  : ""}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className={`rounded-full border px-2.5 py-1 text-xs ${badgeClass(monitoring?.cron?.status)}`}>
                Cron: {statusLabel(monitoring?.cron?.status)}
              </span>
              <span className="rounded-full border border-white/10 bg-zinc-900/80 px-2.5 py-1 text-xs text-zinc-300">
                {cronCoverageLabel(cronLastRun?.coverage)}
              </span>
              {cronIsDryRun ? (
                <span className="rounded-full border border-cyan-400/25 bg-cyan-500/10 px-2.5 py-1 text-xs text-cyan-200">
                  Dry-run
                </span>
              ) : null}
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label="Candidatos"
              value={String(cronCandidates)}
              helper={`${cronRules} regla(s) evaluada(s)`}
              tone={cronCandidates ? "cyan" : "blue"}
            />
            <MetricCard
              label="Enviados"
              value={String(cronSent)}
              helper={
                cronMaxSends !== null || cronMaxPerLayer !== null
                  ? `Limites ${cronMaxSends ?? "sin"} / capa ${cronMaxPerLayer ?? "sin"}`
                  : "Sin limites registrados"
              }
              tone={cronSent ? "emerald" : "blue"}
            />
            <MetricCard
              label="Omitidos"
              value={String(cronSkipped)}
              helper={cronSkippedByWindow ? "Por ventana operativa" : "Controles de seguridad"}
              tone={cronSkipped ? "amber" : "blue"}
            />
            <MetricCard
              label="Errores"
              value={String(cronErrors)}
              helper={durationLabel(cronLastRun?.duration_ms)}
              tone={cronErrors ? "rose" : "emerald"}
            />
          </div>

          <div className="mt-4 rounded-xl border border-white/8 bg-zinc-950/80 px-3 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                  Ventana operativa
                </p>
                <p className="mt-1 text-sm text-zinc-300">{cronWindowLabel}</p>
              </div>
              <span
                className={`rounded-full border px-2.5 py-1 text-xs ${
                  cronSkippedByWindow
                    ? "border-amber-400/25 bg-amber-500/10 text-amber-200"
                    : "border-emerald-400/25 bg-emerald-500/10 text-emerald-200"
                }`}
              >
                {cronSkippedByWindow ? "Detuvo envio" : "Sin bloqueo"}
              </span>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-zinc-500">
              {cronWindowDetail}
            </p>
          </div>

          <div className="mt-4 space-y-3">
            {operationalActions.map((action) => {
              const actionClass =
                action.tipo === "ERROR"
                  ? "border-rose-400/25 bg-rose-500/10 text-rose-100"
                  : action.tipo === "WARN"
                    ? "border-amber-400/25 bg-amber-500/10 text-amber-100"
                    : action.tipo === "OK"
                      ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-100"
                      : "border-cyan-400/25 bg-cyan-500/10 text-cyan-100";
              return (
                <div
                  key={`${action.tipo}-${action.titulo}`}
                  className={`rounded-2xl border px-3 py-3 text-sm ${actionClass}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">{action.titulo}</p>
                      <p className="mt-1 text-xs leading-relaxed opacity-80">
                        {action.detalle}
                      </p>
                    </div>
                    <span className="rounded-full border border-current/20 px-2.5 py-1 text-[11px]">
                      {statusLabel(action.tipo)}
                    </span>
                  </div>
                  <p className="mt-3 rounded-xl border border-current/15 bg-zinc-950/45 px-3 py-2 text-xs leading-relaxed opacity-90">
                    {action.accion}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-5 rounded-2xl border border-white/10 bg-zinc-950/60 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-sm font-semibold text-white">
                Estado Meta por plantilla
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                Ultima sincronizacion: {lastMetaSyncLabel}
                {metaChannel ? ` | Canal: ${metaChannel.nombre}` : ""}
                {typeof monitoring?.plantillas?.meta_total_visto === "number"
                  ? ` | Meta reporto ${monitoring.plantillas.meta_total_visto}`
                  : ""}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {metaStatusRows.length ? (
                metaStatusRows.map((row) => (
                  <span
                    key={row.estado}
                    className="rounded-full border border-white/10 bg-zinc-900/80 px-2.5 py-1 text-xs text-zinc-300"
                  >
                    {statusLabel(row.estado)}: {row.total}
                  </span>
                ))
              ) : (
                <span className="rounded-full border border-white/10 bg-zinc-900/80 px-2.5 py-1 text-xs text-zinc-300">
                  {approvedTemplateTotal}/{whatsappTemplateTotal} aprobadas
                </span>
              )}
            </div>
          </div>

          <div className="mt-4 overflow-hidden rounded-xl border border-white/8">
            {metaTemplateRows.length ? (
              metaTemplateRows.map((template) => {
                const status = template.whatsapp_template_status || "NO_CONFIGURADA";
                const approved = status === "APROBADA";
                return (
                  <div
                    key={template.id}
                    className="grid gap-3 border-b border-white/8 px-3 py-3 last:border-b-0 md:grid-cols-[minmax(0,1fr)_auto]"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-white">
                        {template.whatsapp_template_name || template.nombre}
                      </p>
                      <p className="mt-1 truncate text-xs text-zinc-500">
                        {template.nombre} | {template.whatsapp_template_language || "es_MX"}
                        {template.whatsapp_template_category
                          ? ` | ${template.whatsapp_template_category}`
                          : ""}
                      </p>
                      {template.whatsapp_template_notes ? (
                        <p className="mt-1 line-clamp-2 text-xs text-zinc-500">
                          {template.whatsapp_template_notes}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex items-start md:justify-end">
                      <span
                        className={`rounded-full border px-2.5 py-1 text-xs ${
                          approved
                            ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-200"
                            : "border-amber-400/25 bg-amber-500/10 text-amber-200"
                        }`}
                      >
                        {statusLabel(status)}
                      </span>
                    </div>
                  </div>
                );
              })
            ) : (
              <p className="px-3 py-4 text-sm text-zinc-500">
                No hay plantillas WhatsApp configuradas para mostrar.
              </p>
            )}
          </div>
        </div>

        <div className="mt-5 grid gap-3">
          {checklist.map((item) => (
            <div
              key={item.label}
              className="rounded-2xl border border-white/10 bg-zinc-950/70 p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-white">{item.label}</p>
                  <p className="mt-1 text-sm text-zinc-400">{item.detail}</p>
                </div>
                <span
                  className={`rounded-full border px-2.5 py-1 text-xs ${
                    item.ok
                      ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-200"
                      : "border-amber-400/25 bg-amber-500/10 text-amber-200"
                  }`}
                >
                  {item.ok ? "Listo" : "Pendiente"}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <aside className="space-y-6">
        <section className="page-section">
          <h3 className="text-base font-semibold text-white">Zona segura</h3>
          {testLab ? (
            <div
              className={`mt-4 rounded-2xl border px-3 py-3 text-sm ${
                testLab.habilitado
                  ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-100"
                  : "border-amber-400/25 bg-amber-500/10 text-amber-100"
              }`}
            >
              <p className="font-semibold">
                {testLab.habilitado
                  ? "Laboratorio de cobranza habilitado"
                  : "Laboratorio no habilitado aqui"}
              </p>
              <p className="mt-1 text-xs opacity-80">
                {testLab.motivo}
                {testLab.usuario_actual || testLab.capa_actual ? (
                  <>
                    {" "}
                    Cuenta: {testLab.usuario_actual || "sin correo"} | Capa:{" "}
                    {testLab.capa_actual || "sin capa"}.
                  </>
                ) : null}
              </p>
            </div>
          ) : null}
          <div className="mt-4 space-y-3 text-sm text-zinc-400">
            <SafeModeRow
              label="Integraciones"
              value={safeMode?.integraciones_deshabilitadas ? "Apagadas" : "Activas"}
              ok={Boolean(safeMode && !safeMode.integraciones_deshabilitadas)}
            />
            <SafeModeRow
              label="Allowlist WhatsApp"
              value={sandboxText}
              ok={Boolean(safeMode?.solo_numeros_whatsapp_permitidos)}
            />
            <SafeModeRow
              label="Acuerdo requerido"
              value={safeMode?.acuerdo_whatsapp_requerido ? "Si" : "No"}
              ok={Boolean(safeMode?.acuerdo_whatsapp_requerido)}
            />
          </div>
          {safeMode?.numeros_whatsapp_permitidos?.length ? (
            <div className="mt-4 rounded-xl border border-white/8 bg-zinc-950 px-3 py-2 text-xs text-zinc-500">
              Numeros permitidos:{" "}
              <span className="font-mono text-cyan-100">
                {safeMode.numeros_whatsapp_permitidos.join(", ")}
              </span>
            </div>
          ) : null}

          <div className="mt-5 rounded-2xl border border-emerald-400/20 bg-emerald-500/5 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-semibold text-emerald-100">
                  Datos demo Meta
                </h4>
                <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                  Prepara un cliente y cuatro CxC controladas para video o pruebas
                  sin tocar cartera real.
                </p>
              </div>
              <span
                className={`rounded-full border px-2.5 py-1 text-[11px] ${
                  testLab?.habilitado
                    ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-200"
                    : "border-amber-400/25 bg-amber-500/10 text-amber-200"
                }`}
              >
                {testLab?.habilitado ? "Seguro" : "Bloqueado"}
              </span>
            </div>

            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="field-label">Unidad de negocio demo</span>
                <select
                  value={demoMetaEntityId ?? ""}
                  onChange={(event) =>
                    onDemoMetaEntityChange(
                      event.target.value ? Number(event.target.value) : null,
                    )
                  }
                  className="mt-1 w-full rounded-xl border border-white/10 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-cyan-300/60"
                  disabled={busy || !catalogs.entidades.length}
                >
                  <option value="">Selecciona unidad</option>
                  {catalogs.entidades.map((entity) => (
                    <option key={entity.id} value={entity.id}>
                      {entity.nombre}
                    </option>
                  ))}
                </select>
              </label>

              <button
                type="button"
                onClick={onPrepareDemoMeta}
                disabled={demoMetaDisabled}
                className="w-full rounded-2xl border border-emerald-400/30 bg-emerald-500/15 px-4 py-2 text-sm font-semibold text-emerald-100 transition hover:border-emerald-300/60 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? "Preparando..." : "Preparar demo controlado"}
              </button>

              <button
                type="button"
                onClick={() => onResetLabProcess()}
                disabled={demoMetaDisabled}
                className="w-full rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-2 text-sm font-semibold text-amber-100 transition hover:border-amber-300/60 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? "Reiniciando..." : "Reiniciar prueba completa"}
              </button>
            </div>

            {selectedDemoEntity ? (
              <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">
                Se usara {selectedDemoEntity.nombre} y el numero seleccionado del
                laboratorio. Reiniciar limpia OTP, consentimiento, comprobantes,
                historial y CxC demo sin tocar cartera real.
              </p>
            ) : null}

            {demoMetaResult ? (
              <div className="mt-4 rounded-xl border border-emerald-400/20 bg-emerald-500/10 p-3 text-xs text-emerald-100">
                <p className="font-semibold">{demoMetaResult.mensaje}</p>
                <p className="mt-1 opacity-80">
                  {demoMetaResult.cliente?.nombre || "Cliente demo"} |{" "}
                  {demoMetaResult.entidad.nombre} |{" "}
                  {demoMetaResult.telefono.normalizado}
                </p>
                <div className="mt-3 space-y-2">
                  {demoMetaResult.cuentas.map((cuenta) => (
                    <div
                      key={cuenta.referencia_unica}
                      className="rounded-lg border border-white/10 bg-zinc-950/80 px-3 py-2"
                    >
                      <p className="font-mono text-[11px] text-cyan-100">
                        {cuenta.referencia_unica}
                      </p>
                      <p className="mt-1 text-zinc-300">
                        {cuenta.escenario || cuenta.concepto} | vence{" "}
                        {cuenta.fecha_vencimiento || "sin fecha"} | $
                        {cuenta.monto_total_texto}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {demoMetaError ? (
              <div className="mt-4 rounded-xl border border-rose-400/25 bg-rose-500/10 p-3 text-xs text-rose-100">
                <p className="font-semibold">No se pudo preparar el demo</p>
                <p className="mt-1 leading-relaxed opacity-90">{demoMetaError}</p>
              </div>
            ) : null}
          </div>

          <div className="mt-5 rounded-2xl border border-cyan-400/20 bg-cyan-500/5 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-semibold text-cyan-100">
                  Prueba segura real
                </h4>
                <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                  Envia una plantilla aprobada solo al numero permitido del laboratorio.
                </p>
              </div>
              <span
                className={`rounded-full border px-2.5 py-1 text-[11px] ${
                  testLab?.habilitado
                    ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-200"
                    : "border-amber-400/25 bg-amber-500/10 text-amber-200"
                }`}
              >
                {testLab?.habilitado ? "Habilitado" : "Bloqueado"}
              </span>
            </div>

            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="field-label">Plantilla aprobada</span>
                <select
                  value={labTemplateId ?? ""}
                  onChange={(event) =>
                    onLabTemplateChange(
                      event.target.value ? Number(event.target.value) : null,
                    )
                  }
                  className="mt-1 w-full rounded-xl border border-white/10 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-cyan-300/60"
                  disabled={busy || !labTemplates.length}
                >
                  <option value="">Selecciona plantilla</option>
                  {labTemplates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.nombre} | {template.whatsapp_template_name}
                    </option>
                  ))}
                </select>
              </label>

              <div className="rounded-2xl border border-white/10 bg-zinc-950/60 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-white">
                      Contactos demo autorizados
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-zinc-500">
                      Agrega numeros temporales para demos. Solo funcionan dentro
                      del laboratorio y no abren envios reales.
                    </p>
                  </div>
                  <span className="rounded-full border border-cyan-400/25 bg-cyan-500/10 px-2.5 py-1 text-[11px] text-cyan-100">
                    {labContacts.length} contacto(s)
                  </span>
                </div>

                <div className="mt-3 grid gap-2">
                  <input
                    type="text"
                    value={labContactName}
                    onChange={(event) => onLabContactNameChange(event.target.value)}
                    placeholder="Nombre para demo"
                    className="w-full rounded-xl border border-white/10 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-cyan-300/60"
                    disabled={busy || !testLab?.habilitado}
                  />
                  <input
                    type="tel"
                    value={labContactPhone}
                    onChange={(event) => onLabContactPhoneChange(event.target.value)}
                    placeholder="WhatsApp con lada. Ej. 525512345678"
                    className="w-full rounded-xl border border-white/10 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-cyan-300/60"
                    disabled={busy || !testLab?.habilitado}
                  />
                  <label className="flex items-start gap-2 rounded-xl border border-white/8 bg-zinc-950/80 px-3 py-2 text-xs leading-relaxed text-zinc-400">
                    <input
                      type="checkbox"
                      checked={labContactConsent}
                      onChange={(event) =>
                        onLabContactConsentChange(event.target.checked)
                      }
                      className="mt-0.5 h-4 w-4 accent-cyan-500"
                      disabled={busy || !testLab?.habilitado}
                    />
                    <span>
                      Confirmo que esta persona autorizo recibir mensajes de prueba
                      o demo desde BetterP.
                    </span>
                  </label>
                  <button
                    type="button"
                    onClick={onAddLabContact}
                    disabled={
                      busy ||
                      !testLab?.habilitado ||
                      !labContactName.trim() ||
                      !labContactPhone.trim() ||
                      !labContactConsent
                    }
                    className="rounded-xl border border-cyan-400/25 bg-cyan-500/10 px-3 py-2 text-sm font-semibold text-cyan-100 transition hover:border-cyan-300/60 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Guardar contacto demo
                  </button>
                </div>

                {labContactError ? (
                  <p className="mt-3 rounded-xl border border-rose-400/25 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
                    {labContactError}
                  </p>
                ) : null}

                {labContacts.length ? (
                  <div className="mt-3 space-y-2">
                    {labContacts.map((contact) => (
                      <div
                        key={contact.id}
                        className="flex items-center justify-between gap-3 rounded-xl border border-white/8 bg-zinc-950/80 px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-zinc-100">
                            {contact.nombre}
                          </p>
                          <p className="font-mono text-[11px] text-zinc-500">
                            {contact.telefono_normalizado}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              onResetLabProcess(
                                contact.telefono_normalizado,
                                contact.nombre,
                              )
                            }
                            disabled={demoMetaDisabled}
                            className="rounded-lg border border-amber-400/25 bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-100 transition hover:border-amber-300/60 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Reiniciar
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteLabContact(contact.id)}
                            disabled={busy}
                            className="rounded-lg border border-white/10 px-2.5 py-1 text-xs font-semibold text-zinc-300 transition hover:border-rose-300/40 hover:text-rose-100 disabled:opacity-50"
                          >
                            Quitar
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>

              <label className="block">
                <span className="field-label">Numero de destino</span>
                <select
                  value={labDestination}
                  onChange={(event) => onLabDestinationChange(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-white/10 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-cyan-300/60"
                  disabled={busy || !allowedLabNumbers.length}
                >
                  <option value="">Selecciona numero permitido</option>
                  {labNumberOptions.map((option) => (
                    <option key={option.number} value={option.number}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <button
                type="button"
                onClick={onSendLabTest}
                disabled={labSendDisabled}
                title={
                  labDestinationBlocked
                    ? "El destino no esta dentro de los numeros permitidos."
                    : undefined
                }
                className="w-full rounded-2xl border border-emerald-400/30 bg-emerald-500/15 px-4 py-2 text-sm font-semibold text-emerald-100 transition hover:border-emerald-300/60 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? "Enviando..." : "Enviar prueba segura"}
              </button>
            </div>

            {labDestinationBlocked ? (
              <div className="mt-4 rounded-xl border border-amber-400/25 bg-amber-500/10 p-3 text-xs text-amber-100">
                <p className="font-semibold">Destino fuera de lista segura</p>
                <p className="mt-1 leading-relaxed opacity-90">
                  Solo puedes enviar pruebas reales a los numeros autorizados del
                  laboratorio.
                </p>
              </div>
            ) : null}

            {labResult ? (
              <div className="mt-4 rounded-xl border border-emerald-400/20 bg-emerald-500/10 p-3 text-xs text-emerald-100">
                <p className="font-semibold">{labResult.mensaje}</p>
                <p className="mt-1 opacity-80">
                  {labResult.plantilla.nombre} a {labResult.destino}
                  {labResult.message_id ? ` | ${labResult.message_id}` : ""}
                </p>
                <pre className="mt-3 max-h-36 overflow-auto whitespace-pre-wrap rounded-lg bg-zinc-950/80 p-3 text-[11px] leading-relaxed text-zinc-300">
                  {labResult.preview}
                </pre>
              </div>
            ) : null}
            {labError ? (
              <div className="mt-4 rounded-xl border border-rose-400/25 bg-rose-500/10 p-3 text-xs text-rose-100">
                <p className="font-semibold">No se pudo enviar la prueba segura</p>
                <p className="mt-1 leading-relaxed opacity-90">{labError}</p>
              </div>
            ) : null}
          </div>
        </section>

        <section className="page-section">
          <h3 className="text-base font-semibold text-white">Alertas</h3>
          <div className="mt-4 space-y-3">
            {(monitoring?.alertas || []).map((alert) => (
              <div
                key={`${alert.tipo}-${alert.titulo}`}
                className={`rounded-2xl border px-3 py-3 text-sm ${
                  alert.tipo === "ERROR"
                    ? "border-rose-400/25 bg-rose-500/10 text-rose-100"
                    : "border-amber-400/25 bg-amber-500/10 text-amber-100"
                }`}
              >
                <p className="font-semibold">{alert.titulo}</p>
                <p className="mt-1 text-xs opacity-80">{alert.detalle}</p>
              </div>
            ))}
            {!monitoring?.alertas?.length ? (
              <p className="rounded-2xl border border-white/10 bg-zinc-950/70 px-3 py-3 text-sm text-zinc-500">
                Sin alertas de automatizacion.
              </p>
            ) : null}
          </div>
        </section>

        <section className="page-section">
          <h3 className="text-base font-semibold text-white">Bloqueos por Meta</h3>
          <div className="mt-4 space-y-3">
            {blockedRules.slice(0, 5).map((rule) => (
              <div
                key={rule.id}
                className="rounded-2xl border border-white/10 bg-zinc-950/70 px-3 py-3 text-sm"
              >
                <p className="font-semibold text-white">{rule.nombre}</p>
                <p className="mt-1 text-xs text-zinc-500">
                  {rule.plantilla_nombre} | {statusLabel(rule.plantilla_estado)}
                </p>
              </div>
            ))}
            {!blockedRules.length ? (
              <p className="rounded-2xl border border-white/10 bg-zinc-950/70 px-3 py-3 text-sm text-zinc-500">
                No hay reglas bloqueadas por plantilla.
              </p>
            ) : null}
          </div>
        </section>
      </aside>
    </section>
  );
}

function SafeModeRow({
  label,
  value,
  ok,
}: {
  label: string;
  value: string;
  ok: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span>{label}</span>
      <span
        className={`rounded-full border px-2.5 py-1 text-xs ${
          ok
            ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-200"
            : "border-zinc-600/40 bg-zinc-800/70 text-zinc-300"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

export default function CobranzaWorkspace() {
  const searchParams = useSearchParams();
  const { isOwnerAdmin, user } = useAuth();
  const tabParam = searchParams.get("tab");
  const canUseInternalTools = canUseCobranzaInternalTools(user, isOwnerAdmin);
  const visibleTabs = useMemo(
    () =>
      canUseInternalTools
        ? [...CUSTOMER_TABS, ...INTERNAL_TABS]
        : CUSTOMER_TABS,
    [canUseInternalTools],
  );
  const [activeTab, setActiveTab] = useState<TabId>(DEFAULT_COBRANZA_TAB);
  const [dashboard, setDashboard] = useState<CxcDashboard | null>(null);
  const [catalogs, setCatalogs] = useState<Catalogos>({
    entidades: [],
    clientes: [],
  });
  const [templates, setTemplates] = useState<Template[]>([]);
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [evidences, setEvidences] = useState<Evidence[]>([]);
  const [monitoring, setMonitoring] = useState<AutomationMonitoring | null>(null);
  const [whatsappAgreement, setWhatsappAgreement] =
    useState<WhatsappAgreementState | null>(null);
  const [previewItems, setPreviewItems] = useState<PreviewItem[]>([]);
  const [automationPreviewDate, setAutomationPreviewDate] = useState(todayIso());
  const [automationPreview, setAutomationPreview] =
    useState<AutomationPreviewResult | null>(null);
  const [automationPreviewLoading, setAutomationPreviewLoading] = useState(false);
  const [automationPreviewUpdatedAt, setAutomationPreviewUpdatedAt] =
    useState<string | null>(null);
  const [automationPreviewError, setAutomationPreviewError] = useState<string | null>(
    null,
  );
  const [automationPreviewHistory, setAutomationPreviewHistory] = useState<
    AutomationPreviewHistoryItem[]
  >([]);
  const [automationPreviewHistoryLoaded, setAutomationPreviewHistoryLoaded] =
    useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [evidenceUploadBusy, setEvidenceUploadBusy] = useState(false);
  const [whatsappLabTemplateId, setWhatsappLabTemplateId] = useState<number | null>(
    null,
  );
  const [whatsappLabDestination, setWhatsappLabDestination] = useState("");
  const [whatsappLabResult, setWhatsappLabResult] =
    useState<WhatsappLabResult | null>(null);
  const [whatsappLabError, setWhatsappLabError] = useState<string | null>(null);
  const [whatsappLabContactName, setWhatsappLabContactName] = useState("");
  const [whatsappLabContactPhone, setWhatsappLabContactPhone] = useState("");
  const [whatsappLabContactConsent, setWhatsappLabContactConsent] = useState(false);
  const [whatsappLabContactError, setWhatsappLabContactError] =
    useState<string | null>(null);
  const [demoMetaEntityId, setDemoMetaEntityId] = useState<number | null>(null);
  const [demoMetaResult, setDemoMetaResult] =
    useState<CobranzaDemoMetaResult | null>(null);
  const [demoMetaError, setDemoMetaError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [infoModal, setInfoModal] = useState<CobranzaInfoContent | null>(null);
  const [actionDialog, setActionDialog] = useState<CobranzaDialogState | null>(
    null,
  );
  const [receiptProcessing, setReceiptProcessing] =
    useState<ReceiptProcessingState | null>(null);
  const actionDialogResolverRef = useRef<((value: boolean | string | null) => void) | null>(
    null,
  );

  const [messageForm, setMessageForm] = useState<MessageForm>(emptyMessageForm);
  const [templateForm, setTemplateForm] =
    useState<TemplateForm>(emptyTemplateForm);
  const [ruleForm, setRuleForm] = useState<RuleForm>(emptyRuleForm);
  const [evidenceForm, setEvidenceForm] =
    useState<EvidenceForm>(emptyEvidenceForm);
  const [messageErrors, setMessageErrors] = useState<Record<string, string>>({});
  const [templateErrors, setTemplateErrors] = useState<Record<string, string>>({});
  const [ruleErrors, setRuleErrors] = useState<Record<string, string>>({});
  const [evidenceErrors, setEvidenceErrors] = useState<Record<string, string>>({});
  const [evidenceFilters, setEvidenceFilters] = useState<EvidenceFilters>(
    defaultEvidenceFilters,
  );
  const [editingTemplateId, setEditingTemplateId] = useState<number | null>(null);
  const [editingRuleId, setEditingRuleId] = useState<number | null>(null);

  const metrics = dashboard?.metricas;
  const openEvidenceCount = evidences.filter((item) =>
    ["NUEVA", "VALIDADA"].includes(item.estatus),
  ).length;
  const whatsappAgreementBlocked = Boolean(
    whatsappAgreement?.required && !whatsappAgreement.accepted,
  );

  const selectTab = (tab: TabId) => {
    if (isInternalCobranzaTab(tab) && !canUseInternalTools) {
      return;
    }
    setActiveTab(tab);
    if (typeof window !== "undefined") {
      window.history.replaceState({}, "", `/cobranza?tab=${tab}`);
      window.dispatchEvent(new CustomEvent("betterp-tab-change", { detail: { tab } }));
    }
  };

  useEffect(() => {
    if (!isCobranzaTab(tabParam)) {
      setActiveTab(DEFAULT_COBRANZA_TAB);
      return;
    }
    if (isInternalCobranzaTab(tabParam) && !canUseInternalTools) {
      setActiveTab(DEFAULT_COBRANZA_TAB);
      if (typeof window !== "undefined") {
        window.history.replaceState(
          {},
          "",
          `/cobranza?tab=${DEFAULT_COBRANZA_TAB}`,
        );
        window.dispatchEvent(
          new CustomEvent("betterp-tab-change", {
            detail: { tab: DEFAULT_COBRANZA_TAB },
          }),
        );
      }
      return;
    }
    setActiveTab(tabParam);
  }, [canUseInternalTools, tabParam]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(AUTOMATION_PREVIEW_HISTORY_KEY);
      if (!stored) {
        setAutomationPreviewHistoryLoaded(true);
        return;
      }
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        setAutomationPreviewHistory(
          parsed
            .filter((item): item is AutomationPreviewHistoryItem => {
              if (!item || typeof item !== "object") return false;
              const candidate = item as Partial<AutomationPreviewHistoryItem>;
              return Boolean(candidate.id && candidate.fecha_referencia);
            })
            .slice(0, AUTOMATION_PREVIEW_HISTORY_LIMIT),
        );
      }
    } catch {
      window.localStorage.removeItem(AUTOMATION_PREVIEW_HISTORY_KEY);
    } finally {
      setAutomationPreviewHistoryLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!automationPreviewHistoryLoaded) {
      return;
    }
    try {
      window.localStorage.setItem(
        AUTOMATION_PREVIEW_HISTORY_KEY,
        JSON.stringify(automationPreviewHistory),
      );
    } catch {
      // Storage is optional for this operational helper.
    }
  }, [automationPreviewHistory, automationPreviewHistoryLoaded]);

  const selectedTemplate = useMemo(
    () =>
      templates.find((template) => template.id === messageForm.plantilla_id) ??
      null,
    [messageForm.plantilla_id, templates],
  );

  useEffect(() => {
    if (whatsappLabTemplateId) {
      return;
    }
    const approvedTemplates = templates.filter(
      (template) => template.activo && isApprovedWhatsappTemplate(template),
    );
    const defaultTemplate =
      approvedTemplates.find(
        (template) =>
          (template.whatsapp_template_name || "").trim() ===
          "betterp_portal_bienvenida",
      ) ?? approvedTemplates[0];
    if (defaultTemplate) {
      setWhatsappLabTemplateId(defaultTemplate.id);
    }
  }, [templates, whatsappLabTemplateId]);

  useEffect(() => {
    const allowedNumbers =
      monitoring?.modo_seguro?.numeros_whatsapp_permitidos ?? [];
    const allowlist = buildWhatsappAllowlistSet(allowedNumbers);
    if (
      whatsappLabDestination &&
      isWhatsappDestinationAllowed(whatsappLabDestination, allowlist)
    ) {
      return;
    }
    const firstAllowed = allowedNumbers[0] ?? "";
    if (firstAllowed) {
      setWhatsappLabDestination(firstAllowed);
    } else if (whatsappLabDestination) {
      setWhatsappLabDestination("");
    }
  }, [monitoring, whatsappLabDestination]);

  useEffect(() => {
    if (demoMetaEntityId || !catalogs.entidades.length) {
      return;
    }
    const preferred =
      catalogs.entidades.find((entity) =>
        entity.nombre.toLowerCase().includes("arquitectura 44"),
      ) ?? catalogs.entidades.find((entity) => entity.nombre === "Maya Coliving");
    setDemoMetaEntityId(preferred?.id ?? catalogs.entidades[0]?.id ?? null);
  }, [catalogs.entidades, demoMetaEntityId]);

  const clientsForSelectedEntity = useMemo(() => {
    if (!messageForm.entidad_id) {
      return catalogs.clientes;
    }
    return catalogs.clientes.filter(
      (client) => client.entidad_id === messageForm.entidad_id,
    );
  }, [catalogs.clientes, messageForm.entidad_id]);

  const evidenceQuery = useMemo(() => {
    const params = new URLSearchParams({ limit: "100" });
    if (evidenceFilters.status === "PENDIENTES") {
      params.set("vista", "PENDIENTES");
    } else if (evidenceFilters.status !== "TODOS") {
      params.set("estatus", evidenceFilters.status);
    }
    if (evidenceFilters.source !== "TODOS") {
      params.set("origen", evidenceFilters.source);
    }
    const search = evidenceFilters.search.trim();
    if (search) {
      params.set("busqueda", search);
    }
    if (evidenceFilters.dateFrom) {
      params.set("fecha_desde", evidenceFilters.dateFrom);
    }
    if (evidenceFilters.dateTo) {
      params.set("fecha_hasta", evidenceFilters.dateTo);
    }
    return params.toString();
  }, [evidenceFilters]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [
        cxcResult,
        catalogsResult,
        templateResult,
        rulesResult,
        historyResult,
        evidenceResult,
        agreementResult,
        monitoringResult,
      ] = await Promise.allSettled([
        apiJson<CxcDashboard>(`${FINANZAS_API_BASE}/cxc/?page_size=100`),
        apiJson<Catalogos>(`${COMMS_API_BASE}/catalogos/`),
        apiJson<Template[]>(`${COMMS_API_BASE}/plantillas/`),
        apiJson<AutomationRule[]>(`${COMMS_API_BASE}/automatizaciones/`),
        apiJson<HistoryItem[]>(
          `${COMMS_API_BASE}/historial-envios/?limit=30`,
        ),
        apiJson<Evidence[]>(`${COMMS_API_BASE}/evidencias/?${evidenceQuery}`),
        apiJson<WhatsappAgreementState>(
          `${COMMS_API_BASE}/acuerdos/whatsapp-numero-compartido/`,
        ),
        apiJson<AutomationMonitoring>(
          `${COMMS_API_BASE}/automatizaciones-monitoreo/`,
        ),
      ]);
      if (cxcResult.status === "fulfilled") setDashboard(cxcResult.value);
      if (catalogsResult.status === "fulfilled") setCatalogs(catalogsResult.value);
      if (templateResult.status === "fulfilled") setTemplates(templateResult.value);
      if (rulesResult.status === "fulfilled") setRules(rulesResult.value);
      if (historyResult.status === "fulfilled") setHistory(historyResult.value);
      if (evidenceResult.status === "fulfilled") setEvidences(evidenceResult.value);
      if (agreementResult.status === "fulfilled") {
        setWhatsappAgreement(agreementResult.value);
      } else {
        setWhatsappAgreement(null);
      }
      if (monitoringResult.status === "fulfilled") {
        setMonitoring(monitoringResult.value);
      } else {
        setMonitoring(null);
      }

      const criticalFailures = [
        settledErrorMessage("Cartera CxC", cxcResult),
        settledErrorMessage("Catalogos", catalogsResult),
        settledErrorMessage("Plantillas", templateResult),
        settledErrorMessage("Automatizaciones", rulesResult),
        settledErrorMessage("Historial", historyResult),
        settledErrorMessage("Comprobantes", evidenceResult),
      ].filter((item): item is string => Boolean(item));
      const optionalFailures = [
        settledErrorMessage("Acuerdo WhatsApp", agreementResult),
        settledErrorMessage("Monitoreo WhatsApp", monitoringResult),
      ].filter((item): item is string => Boolean(item));

      if (criticalFailures.length) {
        setNotice({
          type: "error",
          message: `No se pudo cargar Cobranza completo. ${criticalFailures[0]}`,
        });
      } else if (optionalFailures.length) {
        setNotice({
          type: "info",
          message: `Cobranza cargo, pero falta revisar: ${optionalFailures.join(" | ")}`,
        });
      } else {
        setNotice(null);
      }
    } catch (error) {
      setNotice({ type: "error", message: getErrorMessage(error) });
    } finally {
      setLoading(false);
    }
  }, [evidenceQuery]);

  const refreshEvidences = useCallback(async () => {
    const items = await apiJson<Evidence[]>(
      `${COMMS_API_BASE}/evidencias/?${evidenceQuery}`,
    );
    setEvidences(items);
  }, [evidenceQuery]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!messageForm.plantilla_id && templates.length > 0) {
      const defaultTemplate =
        templates.find((item) => item.canal === "WHATSAPP" && item.activo) ??
        templates.find((item) => item.activo) ??
        templates[0];
      setMessageForm((current) => ({
        ...current,
        plantilla_id: defaultTemplate.id,
        canal: defaultTemplate.canal === "EMAIL" ? "EMAIL" : "AMBOS",
      }));
    }
  }, [messageForm.plantilla_id, templates]);

  const resolveActionDialog = useCallback((value: boolean | string | null) => {
    const resolver = actionDialogResolverRef.current;
    actionDialogResolverRef.current = null;
    setActionDialog(null);
    resolver?.(value);
  }, []);

  const openConfirm = useCallback(
    (dialog: Omit<Extract<CobranzaDialogState, { type: "confirm" }>, "type">) =>
      new Promise<boolean>((resolve) => {
        actionDialogResolverRef.current = (value) => resolve(value === true);
        setActionDialog({ type: "confirm", ...dialog });
      }),
    [],
  );

  const openPrompt = useCallback(
    (dialog: Omit<Extract<CobranzaDialogState, { type: "prompt" }>, "type">) =>
      new Promise<string | null>((resolve) => {
        actionDialogResolverRef.current = (value) =>
          resolve(typeof value === "string" ? value : null);
        setActionDialog({ type: "prompt", ...dialog });
      }),
    [],
  );

  function updateMessage<K extends keyof MessageForm>(
    key: K,
    value: MessageForm[K],
  ) {
    setMessageForm((current) => ({ ...current, [key]: value }));
    setPreviewItems([]);
    setMessageErrors((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[String(key)];
      return next;
    });
  }

  function startMessageFromDebtor(client: {
    cliente_id: number;
    entidad_id: number | null;
    segmento: string;
  }) {
    const defaultTemplate =
      templates.find((item) => item.canal === "WHATSAPP" && item.activo) ??
      templates.find((item) => item.activo) ??
      null;
    setPreviewItems([]);
    setMessageForm((current) => ({
      ...current,
      plantilla_id: defaultTemplate?.id ?? current.plantilla_id,
      entidad_id: client.entidad_id,
      cliente_id: client.cliente_id,
      cliente_ids: [client.cliente_id],
      segmento: client.segmento,
      canal: defaultTemplate?.canal === "EMAIL" ? "EMAIL" : "AMBOS",
      asunto: "",
      mensaje: "",
      incluye_link_portal: true,
      url_media: "",
    }));
    setNotice({
      type: "info",
      message: "Mensaje preparado para el cliente seleccionado. Revisa la previsualizacion antes de enviar.",
    });
    selectTab("mensajes");
  }

  function startMessagesFromRows(rows: CxcRow[]) {
    if (rows.length === 0) {
      setNotice({
        type: "error",
        message: "Selecciona al menos una cuenta para preparar mensajes.",
      });
      return;
    }
    const defaultTemplate =
      templates.find((item) => item.canal === "WHATSAPP" && item.activo) ??
      templates.find((item) => item.activo) ??
      null;
    const clienteIds = Array.from(new Set(rows.map((row) => row.cliente_id)));
    if (clienteIds.length > 10) {
      setNotice({
        type: "error",
        message:
          "El primer lote real debe mantenerse en maximo 10 clientes. Reduce la seleccion antes de preparar mensajes.",
      });
      selectTab("cartera");
      return;
    }
    const entidadIds = Array.from(
      new Set(rows.map((row) => row.entidad_id).filter((id): id is number => Boolean(id))),
    );
    const singleClient = clienteIds.length === 1 ? clienteIds[0] : null;
    setPreviewItems([]);
    setMessageForm((current) => ({
      ...current,
      plantilla_id: defaultTemplate?.id ?? current.plantilla_id,
      entidad_id: entidadIds.length === 1 ? entidadIds[0] : null,
      cliente_id: singleClient,
      cliente_ids: clienteIds,
      segmento: "CXC_ABIERTA",
      canal: defaultTemplate?.canal === "EMAIL" ? "EMAIL" : "AMBOS",
      asunto: "",
      mensaje: "",
      incluye_link_portal: true,
      url_media: "",
    }));
    setNotice({
      type: "info",
      message: `Mensajes preparados para ${clienteIds.length} cliente(s). Revisa la previsualizacion antes de enviar.`,
    });
    selectTab("mensajes");
  }

  function updateTemplate<K extends keyof TemplateForm>(
    key: K,
    value: TemplateForm[K],
  ) {
    setTemplateForm((current) => ({ ...current, [key]: value }));
    setTemplateErrors((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[String(key)];
      return next;
    });
  }

  function updateRule<K extends keyof RuleForm>(key: K, value: RuleForm[K]) {
    setRuleForm((current) => ({ ...current, [key]: value }));
    setRuleErrors((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[String(key)];
      return next;
    });
  }

  function updateEvidence<K extends keyof EvidenceForm>(
    key: K,
    value: EvidenceForm[K],
  ) {
    setEvidenceForm((current) => ({ ...current, [key]: value }));
    setEvidenceErrors((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[String(key)];
      return next;
    });
  }

  async function saveEvidence(form: EvidenceForm) {
    const amount = parseMoneyValue(form.monto_reportado);
    return apiJson<EvidenceSaveResult>(
      `${COMMS_API_BASE}/evidencias/`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entidad_id: form.entidad_id,
          cliente_id: form.cliente_id,
          canal: form.canal,
          tipo_movimiento: "INGRESO",
          url_archivo: form.url_archivo.trim(),
          hash_archivo: form.hash_archivo.trim(),
          monto_reportado: amount,
          fecha_pago_reportada: form.fecha_pago_reportada || null,
          referencia_reportada: form.referencia_reportada.trim(),
          texto_extraido: form.texto_extraido.trim(),
          origen_deteccion: "MANUAL",
          confianza_clasificacion: 70,
          requiere_revision_manual: true,
          categoria_sugerida: "COBRANZA",
          observaciones: form.observaciones.trim(),
        }),
      },
    );
  }

  async function processEvidenceWithOcr(
    evidence: Evidence,
    options: { automatic?: boolean; fileName?: string | null } = {},
  ): Promise<Evidence | null> {
    if (EVIDENCE_ANALYSIS_TERMINAL_STATUSES.has(evidence.estatus)) {
      setNotice({
        type: "info",
        message:
          evidence.estatus === "APLICADA"
            ? "Este comprobante ya esta aplicado. No se vuelve a leer con IA/OCR para evitar duplicar el proceso."
            : "Este comprobante esta descartado. Reactivalo o registra uno nuevo antes de leerlo con IA/OCR.",
      });
      return evidence;
    }
    if (!evidenceHasAnalysisInput(evidence)) {
      setNotice({
        type: "error",
        message:
          "Este registro no tiene archivo, texto u observaciones para leer. Sube un archivo y registra el comprobante antes de usar IA/OCR.",
      });
      return null;
    }
    setBusy(true);
    setReceiptProcessing({
      evidenceId: evidence.id,
      title: options.automatic
        ? "Procesando comprobante con IA visual"
        : "Leyendo comprobante con IA/OCR",
      detail:
        "BetterP esta enviando el archivo a Google Vision OCR y preparando los datos detectados.",
      fileName: options.fileName || evidenceMetadataText(evidence, "archivo_nombre"),
    });
    try {
      const response = await apiJson<{
        success: boolean;
        mensaje: string;
        evidencia?: Evidence;
      }>(
        `${COMMS_API_BASE}/evidencias/${evidence.id}/analisis-ia/`,
        { method: "POST" },
      );
      if (response.evidencia) {
        setEvidences((current) =>
          upsertEvidenceListItem(current, response.evidencia as Evidence),
        );
      }
      setNotice({
        type: "success",
        message: options.automatic
          ? "Comprobante cargado y leído con IA visual. Revisa los datos detectados antes de aplicar el pago."
          : response.mensaje,
      });
      return response.evidencia ?? evidence;
    } catch (error) {
      setNotice({ type: "error", message: getErrorMessage(error) });
      return null;
    } finally {
      setReceiptProcessing(null);
      setBusy(false);
    }
  }

  async function uploadEvidenceFile(file: File) {
    const formData = new FormData();
    formData.append("file", file);
    setEvidenceUploadBusy(true);
    try {
      const response = await apiJson<EvidenceUploadResult>(
        `${COMMS_API_BASE}/evidencias/archivo/`,
        {
          method: "POST",
          body: formData,
        },
      );
      const nextForm = mergeUploadIntoEvidenceForm(evidenceForm, response);
      setEvidenceForm(nextForm);
      setEvidenceErrors((current) => {
        const next = { ...current };
        delete next.url_archivo;
        delete next.texto_extraido;
        return next;
      });
      if (!nextForm.entidad_id || !nextForm.cliente_id) {
        setEvidenceErrors((current) => {
          const next = { ...current };
          if (!nextForm.entidad_id) {
            next.entidad_id = "Selecciona la unidad de negocio para registrar este comprobante.";
          }
          if (!nextForm.cliente_id) {
            next.cliente_id = "Selecciona el cliente para registrar este comprobante.";
          }
          return next;
        });
        setNotice({
          type: "info",
          message: `${response.mensaje} Selecciona la unidad de negocio y el cliente; despues da clic en Registrar comprobante para verlo en la bandeja.`,
        });
        return;
      }
      const saveResult = await saveEvidence(nextForm);
      let registeredEvidence: Evidence | null = null;
      if (saveResult.evidencia) {
        registeredEvidence = saveResult.evidencia as Evidence;
        setEvidences((current) =>
          upsertEvidenceListItem(current, registeredEvidence as Evidence),
        );
      } else {
        await refreshEvidences();
      }
      setEvidenceForm(emptyEvidenceForm);
      setEvidenceErrors({});
      if (
        registeredEvidence &&
        evidenceShouldAutoAnalyze(
          registeredEvidence,
          Boolean(response.duplicado || saveResult.created === false),
        )
      ) {
        await processEvidenceWithOcr(registeredEvidence, {
          automatic: true,
          fileName: response.nombre,
        });
        return;
      }
      setNotice({
        type: response.duplicado || saveResult.created === false ? "info" : "success",
        message: response.duplicado || saveResult.created === false
          ? "Este archivo ya estaba registrado. La bandeja se actualizo y no se volvio a ejecutar IA/OCR para evitar duplicados."
          : "Archivo cargado y comprobante registrado.",
      });
    } catch (error) {
      setNotice({ type: "error", message: getErrorMessage(error) });
    } finally {
      setEvidenceUploadBusy(false);
    }
  }

  function blockIfWhatsappAgreementMissing(channel: Channel | string): boolean {
    if (!whatsappAgreementBlocked || !channelUsesWhatsapp(channel)) {
      return false;
    }
    setNotice({
      type: "error",
      message:
        "Acepta el acuerdo de uso de WhatsApp antes de activar o enviar mensajes con el numero de BetterP.",
    });
    return true;
  }

  function blockIfCobranzaLabUnauthorized(channel: Channel | string): boolean {
    if (!channelUsesWhatsapp(channel)) {
      return false;
    }
    const safeMode = monitoring?.modo_seguro;
    if (!safeMode?.solo_numeros_whatsapp_permitidos) {
      return false;
    }
    if (safeMode.laboratorio_cobranza?.habilitado) {
      return false;
    }
    setNotice({
      type: "error",
      message:
        safeMode.laboratorio_cobranza?.motivo ||
        "El laboratorio de cobranza por WhatsApp solo esta habilitado para 01.agodinez@gmail.com en Maya Coliving.",
    });
    return true;
  }

  async function acceptWhatsappAgreement() {
    setBusy(true);
    try {
      const response = await apiJson<WhatsappAgreementState & {
        success: boolean;
        mensaje: string;
      }>(`${COMMS_API_BASE}/acuerdos/whatsapp-numero-compartido/aceptar/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          acepta_contacto_autorizado: true,
          acepta_datos_correctos: true,
          acepta_politicas_whatsapp: true,
          acepta_suspension_por_riesgo: true,
        }),
      });
      setWhatsappAgreement(response);
      setNotice({ type: "success", message: response.mensaje });
    } catch (error) {
      setNotice({ type: "error", message: getErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function syncMetaTemplates() {
    setBusy(true);
    try {
      const response = await apiJson<TemplateSyncResponse>(
        `${COMMS_API_BASE}/plantillas/sincronizar-meta/`,
        { method: "POST" },
      );
      setTemplates((current) => {
        const syncedById = new Map(
          response.plantillas.map((template) => [template.id, template]),
        );
        return current.map((template) => syncedById.get(template.id) ?? template);
      });
      setNotice({
        type: "success",
        message:
          `Sincronizacion Meta lista. Revisadas: ${response.revisadas}, ` +
          `actualizadas: ${response.actualizadas}, sin coincidencia: ${response.sin_coincidencia}.`,
      });
      await refresh();
    } catch (error) {
      setNotice({ type: "error", message: getErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function closeCobranzaOnboarding(
    payload: CobranzaOnboardingClosePayload,
  ) {
    setBusy(true);
    try {
      const response = await apiJson<CobranzaOnboardingResponse>(
        `${COMMS_API_BASE}/onboarding-cobranza/cerrar/`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      setMonitoring((current) =>
        current ? { ...current, onboarding: response.onboarding } : current,
      );
      setNotice({
        type: "success",
        message: response.mensaje || "Onboarding de cobranza cerrado.",
      });
      await refresh();
    } catch (error) {
      setNotice({ type: "error", message: getErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function reopenCobranzaOnboarding() {
    setBusy(true);
    try {
      const response = await apiJson<CobranzaOnboardingResponse>(
        `${COMMS_API_BASE}/onboarding-cobranza/reabrir/`,
        { method: "POST" },
      );
      setMonitoring((current) =>
        current ? { ...current, onboarding: response.onboarding } : current,
      );
      setNotice({
        type: "success",
        message: response.mensaje || "Onboarding de cobranza reabierto.",
      });
      await refresh();
    } catch (error) {
      setNotice({ type: "error", message: getErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function prepareDemoMetaDataset() {
    if (blockIfWhatsappAgreementMissing("WHATSAPP")) {
      return;
    }
    if (blockIfCobranzaLabUnauthorized("WHATSAPP")) {
      return;
    }
    if (!demoMetaEntityId) {
      const message = "Selecciona una unidad de negocio para preparar el demo.";
      setDemoMetaError(message);
      setNotice({ type: "error", message });
      return;
    }
    const destination =
      whatsappLabDestination ||
      monitoring?.modo_seguro?.numeros_whatsapp_permitidos?.[0] ||
      "";
    if (!destination) {
      const message =
        "Configura o selecciona un numero permitido antes de preparar el demo.";
      setDemoMetaError(message);
      setNotice({ type: "error", message });
      return;
    }

    setBusy(true);
    setDemoMetaResult(null);
    setDemoMetaError(null);
    try {
      const response = await apiJson<CobranzaDemoMetaResult>(
        `${COMMS_API_BASE}/laboratorio/demo-meta/`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            entidad_id: demoMetaEntityId,
            numero_destino: destination,
          }),
        },
      );
      setDemoMetaResult(response);
      setNotice({
        type: "success",
        message:
          response.mensaje ||
          "Cliente y cuentas demo preparados para el laboratorio.",
      });
      await refresh();
    } catch (error) {
      const message = getErrorMessage(error);
      setDemoMetaError(message);
      setNotice({ type: "error", message });
    } finally {
      setBusy(false);
    }
  }

  async function resetWhatsappLabProcess(
    destinationOverride?: string,
    destinationLabel?: string,
  ) {
    if (blockIfWhatsappAgreementMissing("WHATSAPP")) {
      return;
    }
    if (blockIfCobranzaLabUnauthorized("WHATSAPP")) {
      return;
    }
    if (!demoMetaEntityId) {
      const message = "Selecciona una unidad de negocio para reiniciar la prueba.";
      setDemoMetaError(message);
      setNotice({ type: "error", message });
      return;
    }
    const destination =
      destinationOverride ||
      whatsappLabDestination ||
      monitoring?.modo_seguro?.numeros_whatsapp_permitidos?.[0] ||
      "";
    if (!destination) {
      const message =
        "Configura o selecciona un numero permitido antes de reiniciar la prueba.";
      setDemoMetaError(message);
      setNotice({ type: "error", message });
      return;
    }

    const confirmed = await openConfirm({
      title: "Reiniciar prueba completa",
      message: `Se limpiaran OTP, consentimiento, historial, comprobantes, CxC demo y el perfil de prueba segura real de ${destinationLabel || destination}. No se toca cartera real fuera de datos demo.`,
      confirmLabel: "Reiniciar y preparar",
      cancelLabel: "Cancelar",
      tone: "warning",
    });
    if (!confirmed) {
      return;
    }

    setBusy(true);
    setDemoMetaResult(null);
    setDemoMetaError(null);
    setWhatsappLabResult(null);
    setWhatsappLabError(null);
    try {
      const response = await apiJson<CobranzaLabResetResult>(
        `${COMMS_API_BASE}/laboratorio/reset-prueba/`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            entidad_id: demoMetaEntityId,
            numero_destino: destination,
          }),
        },
      );
      if (destinationOverride) {
        setWhatsappLabDestination(destinationOverride);
      }
      if (response.demo) {
        setDemoMetaResult(response.demo);
      }
      const limpieza = response.limpieza;
      setNotice({
        type: "success",
        message: `${response.mensaje} Limpieza: ${limpieza.clientes} perfil(es), ${limpieza.otp_eliminados} OTP, ${limpieza.historial_eliminado} envio(s), ${limpieza.comprobantes_eliminados} comprobante(s).`,
      });
      await refresh();
    } catch (error) {
      const message = getErrorMessage(error);
      setDemoMetaError(message);
      setNotice({ type: "error", message });
    } finally {
      setBusy(false);
    }
  }

  async function addWhatsappLabContact() {
    if (blockIfCobranzaLabUnauthorized("WHATSAPP")) {
      return;
    }
    const name = whatsappLabContactName.trim();
    const phone = whatsappLabContactPhone.trim();
    if (!name) {
      const message = "Captura el nombre del contacto demo.";
      setWhatsappLabContactError(message);
      setNotice({ type: "error", message });
      return;
    }
    if (!phone) {
      const message = "Captura el numero WhatsApp del contacto demo.";
      setWhatsappLabContactError(message);
      setNotice({ type: "error", message });
      return;
    }
    if (!whatsappLabContactConsent) {
      const message =
        "Confirma que esta persona autorizo recibir mensajes de prueba o demo.";
      setWhatsappLabContactError(message);
      setNotice({ type: "error", message });
      return;
    }

    setBusy(true);
    setWhatsappLabContactError(null);
    try {
      const contact = await apiJson<WhatsappLabContact>(
        `${COMMS_API_BASE}/laboratorio/contactos-whatsapp/`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nombre: name,
            telefono: phone,
            consentimiento_confirmado: true,
          }),
        },
      );
      setWhatsappLabContactName("");
      setWhatsappLabContactPhone("");
      setWhatsappLabContactConsent(false);
      setWhatsappLabDestination(contact.telefono_normalizado);
      setNotice({
        type: "success",
        message: "Contacto demo agregado a la lista segura.",
      });
      await refresh();
    } catch (error) {
      const message = getErrorMessage(error);
      setWhatsappLabContactError(message);
      setNotice({ type: "error", message });
    } finally {
      setBusy(false);
    }
  }

  async function deleteWhatsappLabContact(contactId: number) {
    if (blockIfCobranzaLabUnauthorized("WHATSAPP")) {
      return;
    }
    setBusy(true);
    setWhatsappLabContactError(null);
    try {
      await apiJson<{ success: boolean }>(
        `${COMMS_API_BASE}/laboratorio/contactos-whatsapp/${contactId}/`,
        { method: "DELETE" },
      );
      setNotice({
        type: "success",
        message: "Contacto demo quitado de la lista segura.",
      });
      await refresh();
    } catch (error) {
      const message = getErrorMessage(error);
      setWhatsappLabContactError(message);
      setNotice({ type: "error", message });
    } finally {
      setBusy(false);
    }
  }

  async function sendWhatsappLabTest() {
    if (blockIfWhatsappAgreementMissing("WHATSAPP")) {
      return;
    }
    if (blockIfCobranzaLabUnauthorized("WHATSAPP")) {
      return;
    }
    if (!whatsappLabTemplateId) {
      setNotice({
        type: "error",
        message: "Selecciona una plantilla aprobada para enviar la prueba segura.",
      });
      return;
    }
    if (!whatsappLabDestination.trim()) {
      setNotice({
        type: "error",
        message: "Selecciona un numero permitido para enviar la prueba segura.",
      });
      return;
    }
    const safeMode = monitoring?.modo_seguro;
    if (safeMode?.solo_numeros_whatsapp_permitidos) {
      const allowlist = buildWhatsappAllowlistSet(
        safeMode.numeros_whatsapp_permitidos ?? [],
      );
      if (!isWhatsappDestinationAllowed(whatsappLabDestination, allowlist)) {
        const message =
          "El numero seleccionado no esta en la lista segura de WhatsApp. Selecciona un numero permitido antes de enviar.";
        setWhatsappLabError(message);
        setNotice({ type: "error", message });
        return;
      }
    }

    setBusy(true);
    setWhatsappLabResult(null);
    setWhatsappLabError(null);
    try {
      const response = await apiJson<WhatsappLabResult>(
        `${COMMS_API_BASE}/laboratorio/whatsapp-prueba/`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            plantilla_id: whatsappLabTemplateId,
            numero_destino: whatsappLabDestination.trim(),
          }),
        },
      );
      setWhatsappLabResult(response);
      if (response.historial) {
        setHistory((current) =>
          [response.historial as HistoryItem, ...current].slice(0, 30),
        );
      }
      setNotice({
        type: "success",
        message: response.mensaje || "Prueba WhatsApp enviada.",
      });
    } catch (error) {
      const message = getErrorMessage(error);
      setWhatsappLabError(message);
      setNotice({ type: "error", message });
    } finally {
      setBusy(false);
    }
  }

  function changeWhatsappLabTemplate(templateId: number | null) {
    setWhatsappLabTemplateId(templateId);
    setWhatsappLabResult(null);
    setWhatsappLabError(null);
  }

  function changeWhatsappLabDestination(destination: string) {
    setWhatsappLabDestination(destination);
    setWhatsappLabResult(null);
    setWhatsappLabError(null);
  }

  function changeDemoMetaEntity(entityId: number | null) {
    setDemoMetaEntityId(entityId);
    setDemoMetaResult(null);
    setDemoMetaError(null);
  }

  async function reviewHistoryItem(item: HistoryItem) {
    const note = await openPrompt({
      title: "Marcar envio revisado",
      message: `Confirma que revisaste este registro de ${item.cliente_nombre} (${statusLabel(item.estatus)}).`,
      inputLabel: "Nota operativa opcional",
      placeholder: "Ej. Revisado: llego bien y no requiere accion adicional.",
      confirmLabel: "Marcar revisado",
      cancelLabel: "Cancelar",
      tone: item.estatus === "ERROR" ? "warning" : "success",
    });
    if (note === null) {
      return;
    }
    setBusy(true);
    try {
      const response = await apiJson<{
        success: boolean;
        mensaje: string;
        historial: HistoryItem;
      }>(`${COMMS_API_BASE}/historial-envios/${item.id}/revisar/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nota: note }),
      });
      setHistory((current) =>
        current.map((historyItem) =>
          historyItem.id === item.id ? response.historial : historyItem,
        ),
      );
      setNotice({
        type: "success",
        message: response.mensaje || "Envio marcado como revisado.",
      });
    } catch (error) {
      setNotice({ type: "error", message: getErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function reviewPendingHistoryItems(items: HistoryItem[]) {
    const pendingItems = items.filter(historyNeedsReview);
    if (pendingItems.length === 0) {
      setNotice({
        type: "success",
        message: "No hay envios visibles pendientes de revision.",
      });
      return;
    }
    const note = await openPrompt({
      title: "Marcar pendientes revisados",
      message: `Confirma que revisaste ${pendingItems.length} envio(s) visible(s). Esta accion solo marca la revision operativa, no reenvia mensajes ni cambia estados de Meta.`,
      inputLabel: "Nota operativa opcional",
      placeholder: "Ej. Revisados en lote durante piloto controlado.",
      confirmLabel: "Marcar visibles",
      cancelLabel: "Cancelar",
      tone: "success",
    });
    if (note === null) {
      return;
    }
    setBusy(true);
    try {
      const responses = await Promise.all(
        pendingItems.map((item) =>
          apiJson<{
            success: boolean;
            mensaje: string;
            historial: HistoryItem;
          }>(`${COMMS_API_BASE}/historial-envios/${item.id}/revisar/`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nota: note }),
          }),
        ),
      );
      const updatedById = new Map(
        responses.map((response) => [response.historial.id, response.historial]),
      );
      setHistory((current) =>
        current.map((historyItem) => updatedById.get(historyItem.id) ?? historyItem),
      );
      setNotice({
        type: "success",
        message: `${updatedById.size} envio(s) marcado(s) como revisados.`,
      });
    } catch (error) {
      setNotice({ type: "error", message: getErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function saveTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const errors = validateTemplateForm(templateForm);
    setTemplateErrors(errors);
    const errorMessage = firstError(errors);
    if (errorMessage) {
      setNotice({
        type: "error",
        message: errorMessage,
      });
      return;
    }
    setBusy(true);
    try {
      const payload: TemplateForm = {
        ...templateForm,
        nombre: templateForm.nombre.trim(),
        descripcion: templateForm.descripcion.trim(),
        asunto: templateForm.asunto.trim(),
        cuerpo: templateForm.cuerpo.trim(),
        url_media: templateForm.url_media.trim(),
      };
      const url = editingTemplateId
        ? `${COMMS_API_BASE}/plantillas/${editingTemplateId}/`
        : `${COMMS_API_BASE}/plantillas/`;
      await apiJson<{ success: boolean }>(url, {
        method: editingTemplateId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setTemplateForm(emptyTemplateForm);
      setTemplateErrors({});
      setEditingTemplateId(null);
      setNotice({ type: "success", message: "Plantilla guardada." });
      await refresh();
    } catch (error) {
      setNotice({ type: "error", message: getErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function deleteTemplate(templateId: number) {
    const confirmed = await openConfirm({
      title: "Eliminar plantilla",
      message: "Esta plantilla se quitara del modulo de Cobranza.",
      confirmLabel: "Eliminar",
      cancelLabel: "Conservar",
      tone: "danger",
    });
    if (!confirmed) {
      return;
    }
    setBusy(true);
    try {
      await apiJson<{ success: boolean }>(
        `${COMMS_API_BASE}/plantillas/${templateId}/`,
        { method: "DELETE" },
      );
      setNotice({ type: "success", message: "Plantilla eliminada." });
      await refresh();
    } catch (error) {
      setNotice({ type: "error", message: getErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function saveRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (ruleForm.activo && blockIfWhatsappAgreementMissing(ruleForm.canal)) {
      return;
    }
    const selectedRuleTemplate = templates.find(
      (template) => template.id === ruleForm.plantilla_id,
    );
    if (
      ruleForm.activo &&
      channelUsesWhatsapp(ruleForm.canal) &&
      !isApprovedWhatsappTemplate(selectedRuleTemplate)
    ) {
      setNotice({
        type: "error",
        message:
          "No puedes activar esta regla todavia: la plantilla de WhatsApp no esta aprobada por Meta.",
      });
      return;
    }
    const errors = validateRuleForm(ruleForm);
    setRuleErrors(errors);
    const errorMessage = firstError(errors);
    if (errorMessage) {
      setNotice({
        type: "error",
        message: errorMessage,
      });
      return;
    }
    setBusy(true);
    try {
      const payload = {
        ...ruleForm,
        nombre: ruleForm.nombre.trim(),
        descripcion: ruleForm.descripcion.trim(),
        desplazamiento_dias: Number(ruleForm.desplazamiento_dias),
      };
      const url = editingRuleId
        ? `${COMMS_API_BASE}/automatizaciones/${editingRuleId}/`
        : `${COMMS_API_BASE}/automatizaciones/`;
      await apiJson<{ success: boolean }>(url, {
        method: editingRuleId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setRuleForm(emptyRuleForm);
      setRuleErrors({});
      setEditingRuleId(null);
      setNotice({ type: "success", message: "Regla guardada." });
      await refresh();
    } catch (error) {
      setNotice({ type: "error", message: getErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function deleteRule(ruleId: number) {
    const confirmed = await openConfirm({
      title: "Eliminar regla automatica",
      message: "La regla dejara de participar en simulaciones y corridas de cobranza.",
      confirmLabel: "Eliminar",
      cancelLabel: "Conservar",
      tone: "danger",
    });
    if (!confirmed) {
      return;
    }
    setBusy(true);
    try {
      await apiJson<{ success: boolean }>(
        `${COMMS_API_BASE}/automatizaciones/${ruleId}/`,
        { method: "DELETE" },
      );
      setNotice({ type: "success", message: "Regla eliminada." });
      await refresh();
    } catch (error) {
      setNotice({ type: "error", message: getErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function toggleRule(rule: AutomationRule) {
    const nextActive = !rule.activo;
    if (nextActive && blockIfWhatsappAgreementMissing(rule.canal)) {
      return;
    }
    const template = templates.find((item) => item.id === rule.plantilla_id);
    if (
      nextActive &&
      channelUsesWhatsapp(rule.canal) &&
      !isApprovedWhatsappTemplate(template)
    ) {
      setNotice({
        type: "error",
        message:
          "Esta regla sigue pausada porque su plantilla aun no esta aprobada por Meta.",
      });
      return;
    }
    setBusy(true);
    try {
      await apiJson<{ success: boolean }>(
        `${COMMS_API_BASE}/automatizaciones/${rule.id}/`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nombre: rule.nombre,
            descripcion: rule.descripcion || "",
            plantilla_id: rule.plantilla_id,
            entidad_id: rule.entidad_id,
            canal: rule.canal,
            evento_base: rule.evento_base,
            desplazamiento_dias: rule.desplazamiento_dias,
            segmento: rule.segmento,
            activo: nextActive,
          }),
        },
      );
      setNotice({
        type: "success",
        message: nextActive ? "Automatizacion activada." : "Automatizacion pausada.",
      });
      await refresh();
    } catch (error) {
      setNotice({ type: "error", message: getErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function runAutomations() {
    if (blockIfWhatsappAgreementMissing("WHATSAPP")) {
      return;
    }
    if (blockIfCobranzaLabUnauthorized("WHATSAPP")) {
      return;
    }
    const confirmed = await openConfirm({
      title: "Ejecutar revision de cobranza",
      message:
        "BetterP evaluara las reglas activas contra la cartera actual. Se respetan bloqueos, limites y zona segura.",
      confirmLabel: "Ejecutar",
      cancelLabel: "Cancelar",
      tone: "warning",
    });
    if (!confirmed) {
      return;
    }
    setBusy(true);
    try {
      const response = await apiJson<{
        ejecutadas?: number;
        enviadas?: number;
        omitidas?: number;
        sent?: number;
        skipped?: number;
        errors?: number;
      }>(`${COMMS_API_BASE}/automatizaciones/ejecutar/`, { method: "POST" });
      const sent = response.enviadas ?? response.sent ?? 0;
      const skipped = response.omitidas ?? response.skipped ?? 0;
      const errors = response.errors ?? 0;
      setNotice({
        type: errors ? "error" : "success",
        message: `Automatizaciones ejecutadas. Enviadas: ${sent}, omitidas: ${skipped}, errores: ${errors}.`,
      });
      await refresh();
    } catch (error) {
      setNotice({ type: "error", message: getErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function previewAutomations() {
    if (!isValidDate(automationPreviewDate)) {
      setNotice({
        type: "error",
        message: "Selecciona una fecha valida para simular automatizaciones.",
      });
      return;
    }
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 25000);
    setAutomationPreviewLoading(true);
    setAutomationPreviewError(null);
    try {
      const params = new URLSearchParams({
        fecha_referencia: automationPreviewDate,
      });
      const response = await apiJson<AutomationPreviewResult>(
        `${COMMS_API_BASE}/automatizaciones-preview/?${params.toString()}`,
        { signal: controller.signal },
      );
      const generatedAt = new Date().toISOString();
      const errorCount =
        response.errores?.length ??
        response.reglas.filter((rule) => Boolean(rule.error)).length;
      setAutomationPreview(response);
      setAutomationPreviewUpdatedAt(generatedAt);
      setAutomationPreviewHistory((current) => [
        {
          id: `${generatedAt}-${response.fecha_referencia}`,
          fecha_referencia: response.fecha_referencia,
          generated_at: generatedAt,
          reglas_activas: response.reglas_activas,
          reglas_con_candidatos: response.reglas.filter(
            (rule) => rule.candidatos > 0,
          ).length,
          candidatos: response.candidatos,
          errores: errorCount,
        },
        ...current,
      ].slice(0, AUTOMATION_PREVIEW_HISTORY_LIMIT));
      setNotice({
        type: errorCount ? "error" : "info",
        message: errorCount
          ? `Simulacion completada con ${errorCount} regla(s) con error. Candidatos calculados: ${response.candidatos}.`
          : `Simulacion lista para ${shortDate(response.fecha_referencia)}: ${response.candidatos} candidato(s) en ${response.reglas_activas} regla(s).`,
      });
    } catch (error) {
      const message =
        error instanceof DOMException && error.name === "AbortError"
          ? "La simulacion tardo demasiado. Reintenta con otra fecha o revisa logs del API."
          : getErrorMessage(error);
      setAutomationPreviewError(message);
      setNotice({ type: "error", message });
    } finally {
      window.clearTimeout(timeoutId);
      setAutomationPreviewLoading(false);
    }
  }

  function buildMessagePayload() {
    const clienteIds =
      messageForm.cliente_ids.length > 0
        ? Array.from(new Set(messageForm.cliente_ids))
        : messageForm.cliente_id
          ? [messageForm.cliente_id]
          : [];
    return {
      plantilla_id: messageForm.plantilla_id,
      entidad_id: messageForm.entidad_id,
      cliente_ids: clienteIds,
      segmento: messageForm.segmento,
      canal: messageForm.canal,
      asunto: messageForm.asunto.trim(),
      mensaje: messageForm.mensaje.trim(),
      incluye_link_portal: messageForm.incluye_link_portal,
      url_media: messageForm.url_media.trim(),
      fecha_referencia: messageForm.fecha_referencia || null,
    };
  }

  async function previewMessages(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (blockIfWhatsappAgreementMissing(messageForm.canal)) {
      return;
    }
    const errors = validateMessageForm(messageForm);
    setMessageErrors(errors);
    const errorMessage = firstError(errors);
    if (errorMessage) {
      setNotice({ type: "error", message: errorMessage });
      return;
    }
    setBusy(true);
    try {
      const response = await apiJson<{ total: number; items: PreviewItem[] }>(
        `${COMMS_API_BASE}/envios/preview/`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildMessagePayload()),
        },
      );
      setPreviewItems(response.items);
      setNotice({
        type: "info",
        message: `${response.total} destinatario(s) encontrados para este envio.`,
      });
    } catch (error) {
      setNotice({ type: "error", message: getErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function sendMessages() {
    if (blockIfWhatsappAgreementMissing(messageForm.canal)) {
      return;
    }
    if (blockIfCobranzaLabUnauthorized(messageForm.canal)) {
      return;
    }
    const safeMode = monitoring?.modo_seguro;
    if (
      channelUsesWhatsapp(messageForm.canal) &&
      safeMode?.solo_numeros_whatsapp_permitidos
    ) {
      const blockedTargets = blockedWhatsappPreviewDestinations(
        previewItems,
        buildWhatsappAllowlistSet(safeMode.numeros_whatsapp_permitidos ?? []),
      );
      if (blockedTargets.length) {
        setNotice({
          type: "error",
          message:
            "Envio bloqueado: la vista previa contiene destinos WhatsApp fuera de la lista segura.",
        });
        return;
      }
    }
    const errors = validateMessageForm(messageForm);
    setMessageErrors(errors);
    const errorMessage = firstError(errors);
    if (errorMessage) {
      setNotice({ type: "error", message: errorMessage });
      return;
    }
    const confirmed = await openConfirm({
      title: "Enviar mensajes",
      message: `Enviar este mensaje a ${previewItems.length || "los"} destinatario(s)?`,
      confirmLabel: "Enviar",
      cancelLabel: "Cancelar",
      tone: "warning",
      helper: "BetterP aplicara las restricciones de WhatsApp y las reglas anti-acoso antes de enviar.",
    });
    if (!confirmed) {
      return;
    }
    setBusy(true);
    try {
      const response = await apiJson<{
        success: boolean;
        mensaje: string;
        enviados?: number;
        omitidos?: number;
        errores?: number;
      }>(`${COMMS_API_BASE}/envios/masivo/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildMessagePayload()),
      });
      setNotice({
        type: "success",
        message: `${response.mensaje} Enviados: ${response.enviados ?? 0}, omitidos: ${response.omitidos ?? 0}, errores: ${response.errores ?? 0}.`,
      });
      setPreviewItems([]);
      await refresh();
    } catch (error) {
      setNotice({ type: "error", message: getErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function registerEvidence(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const errors = validateEvidenceForm(evidenceForm);
    setEvidenceErrors(errors);
    const errorMessage = firstError(errors);
    if (errorMessage) {
      setNotice({ type: "error", message: errorMessage });
      return;
    }
    setBusy(true);
    try {
      const saveResult = await saveEvidence(evidenceForm);
      let registeredEvidence: Evidence | null = null;
      if (saveResult.evidencia) {
        registeredEvidence = saveResult.evidencia as Evidence;
        setEvidences((current) =>
          upsertEvidenceListItem(current, registeredEvidence as Evidence),
        );
      } else {
        await refreshEvidences();
      }
      setEvidenceForm(emptyEvidenceForm);
      setEvidenceErrors({});
      if (
        registeredEvidence &&
        evidenceShouldAutoAnalyze(registeredEvidence, saveResult.created === false)
      ) {
        await processEvidenceWithOcr(registeredEvidence, { automatic: true });
        return;
      }
      setNotice({
        type: saveResult.created === false ? "info" : "success",
        message:
          saveResult.created === false
            ? "Este comprobante ya existia. Se reutilizo el registro y no se volvio a ejecutar IA/OCR."
            : "Comprobante registrado.",
      });
    } catch (error) {
      setNotice({ type: "error", message: getErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function classifyEvidence(
    evidence: Evidence,
    action: "REVIEW" | "VALIDATE" | "APPLY" | "DISCARD",
  ) {
    const applyEvent = action === "APPLY";
    const discardEvidence = action === "DISCARD";
    const validateEvidence = action === "VALIDATE";
    if (applyEvent || discardEvidence || validateEvidence || action === "REVIEW") {
      const confirmed = await openConfirm({
        title: discardEvidence
          ? "Descartar comprobante"
          : validateEvidence
            ? "Validar comprobante"
            : applyEvent
              ? "Aplicar a finanzas"
              : "Enviar a conciliacion",
        message: discardEvidence
          ? "El comprobante se ocultara de pendientes, pero podras consultarlo filtrando por descartados."
          : validateEvidence
            ? "El comprobante quedara validado sin aplicar pago a CxC."
            : applyEvent
              ? "Se creara el evento financiero correspondiente. Revisa monto y cliente antes de continuar."
              : "El comprobante quedara marcado para revision de conciliacion.",
        confirmLabel: discardEvidence
          ? "Descartar"
          : validateEvidence
            ? "Validar"
            : applyEvent
              ? "Aplicar"
              : "Enviar",
        cancelLabel: "Cancelar",
        tone: discardEvidence ? "danger" : "warning",
      });
      if (!confirmed) {
        return;
      }
    }
    setBusy(true);
    try {
      await apiJson<{ success: boolean }>(
        `${COMMS_API_BASE}/evidencias/${evidence.id}/clasificacion/`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tipo_movimiento: "INGRESO",
            entidad_id: evidence.entidad_id,
            cliente_id: evidence.cliente_id,
            categoria_sugerida: evidence.categoria_sugerida || "COBRANZA",
            confianza_clasificacion: evidence.confianza_clasificacion || 70,
            requiere_revision_manual: action === "REVIEW",
            observaciones: discardEvidence
              ? "Descartado desde Cobranza."
              : validateEvidence
                ? "Validado desde Cobranza; pendiente de conciliacion bancaria."
                : applyEvent
                  ? "Aplicado desde Cobranza."
                  : "Clasificado desde Cobranza.",
            estatus: discardEvidence ? "DESCARTADA" : validateEvidence ? "VALIDADA" : undefined,
            crear_evento: !discardEvidence && !validateEvidence,
            aplicar_evento: applyEvent,
          }),
        },
      );
      setNotice({
        type: "success",
        message: discardEvidence
          ? "Comprobante descartado."
          : validateEvidence
            ? "Comprobante validado sin aplicar."
            : applyEvent
              ? "Comprobante aplicado a finanzas."
              : "Comprobante clasificado para revision.",
      });
      await refresh();
    } catch (error) {
      setNotice({ type: "error", message: getErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function correctEvidenceData(evidence: Evidence) {
    const currentAmount = evidence.monto_reportado
      ? String(evidence.monto_reportado)
      : "";
    const amountInput = await openPrompt({
      title: "Corregir monto",
      message: "Captura el monto correcto que aparece en el comprobante.",
      inputLabel: "Monto",
      defaultValue: currentAmount,
      placeholder: "Ej. 11000.00",
      confirmLabel: "Continuar",
      cancelLabel: "Cancelar",
      required: true,
      helper: "Usa solo numeros y hasta dos decimales.",
    });
    if (amountInput === null) {
      return;
    }
    const amount = parseMoneyValue(amountInput);
    if (amount === null || amount <= 0 || amount > MONEY_MAX) {
      setNotice({
        type: "error",
        message: "Monto invalido. Usa formato como 11000.00.",
      });
      return;
    }
    const dateInput = await openPrompt({
      title: "Corregir fecha",
      message: "Captura la fecha de pago. Puedes dejarla vacia si el comprobante no la muestra.",
      inputLabel: "Fecha de pago",
      inputType: "date",
      defaultValue: evidence.fecha_pago_reportada || "",
      confirmLabel: "Continuar",
      cancelLabel: "Cancelar",
    });
    if (dateInput === null) {
      return;
    }
    const cleanDate = dateInput.trim();
    if (cleanDate && !isValidDate(cleanDate)) {
      setNotice({
        type: "error",
        message: "Fecha invalida. Usa formato YYYY-MM-DD.",
      });
      return;
    }
    const referenceInput = await openPrompt({
      title: "Corregir referencia",
      message: "Captura la referencia, folio o clave visible en el comprobante.",
      inputLabel: "Referencia",
      defaultValue: evidence.referencia_reportada || "",
      placeholder: "Ej. SPEI-123 o folio bancario",
      confirmLabel: "Guardar",
      cancelLabel: "Cancelar",
    });
    if (referenceInput === null) {
      return;
    }
    setBusy(true);
    try {
      await apiJson<{ success: boolean }>(
        `${COMMS_API_BASE}/evidencias/${evidence.id}/clasificacion/`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tipo_movimiento: "INGRESO",
            entidad_id: evidence.entidad_id,
            cliente_id: evidence.cliente_id,
            categoria_sugerida: evidence.categoria_sugerida || "COBRANZA",
            monto_reportado: amount.toFixed(2),
            fecha_pago_reportada: cleanDate || null,
            referencia_reportada: cleanReference(referenceInput),
            confianza_clasificacion: 100,
            requiere_revision_manual: true,
            observaciones: "Datos del comprobante corregidos manualmente.",
            estatus: evidence.estatus,
            crear_evento: false,
            aplicar_evento: false,
          }),
        },
      );
      setNotice({ type: "success", message: "Datos del comprobante actualizados." });
      await refresh();
    } catch (error) {
      setNotice({ type: "error", message: getErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function applyEvidenceToCxc(
    evidence: Evidence,
    candidate: EvidenceCxcCandidate,
  ) {
    const amount = Number(evidence.monto_reportado || 0);
    if (!amount || amount <= 0) {
      setNotice({
        type: "error",
        message: "El comprobante necesita un monto reportado mayor a cero.",
      });
      return;
    }
    const selectedBalance = Number(candidate.saldo_pendiente || 0);
    const duplicate = Boolean(evidence.duplicado_posible?.posible);
    const partial = amount < selectedBalance;
    const overage = amount > selectedBalance;
    const overageAmount = Math.max(amount - selectedBalance, 0);
    const confirmation = [
      `Aplicar ${money(amount)} empezando por la CxC #${candidate.id}?`,
      candidate.concepto,
      partial
        ? "Esto dejara un saldo pendiente en la cuenta seleccionada."
        : overage
          ? `El comprobante excede esta CxC por ${money(overageAmount)}. BetterP aplicara primero esta cuenta, luego otras CxC abiertas del mismo cliente y cualquier sobrante quedara como saldo a favor.`
          : "Esto cubrira el saldo de la cuenta seleccionada.",
      duplicate
        ? "El sistema detecto posible duplicado; revisa el soporte antes de confirmar."
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    const confirmed = await openConfirm({
      title: partial
        ? "Aplicar pago parcial"
        : overage
          ? "Aplicar pago con excedente"
          : "Aplicar pago",
      message: confirmation,
      confirmLabel: "Aplicar pago",
      cancelLabel: "Cancelar",
      tone: duplicate ? "warning" : "success",
    });
    if (!confirmed) {
      return;
    }
    setBusy(true);
    try {
      const response = await apiJson<{ success: boolean; mensaje: string }>(
        `${COMMS_API_BASE}/evidencias/${evidence.id}/aplicar-cxc/`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cuenta_id: candidate.id,
            monto: amount.toFixed(2),
            fecha_pago: evidence.fecha_pago_reportada || null,
            referencia: evidence.referencia_reportada || "",
            notas: "Aplicado manualmente desde Cobranza > Comprobantes.",
            confirmar_duplicado: duplicate,
          }),
        },
      );
      setNotice({ type: "success", message: response.mensaje });
      await refresh();
    } catch (error) {
      setNotice({ type: "error", message: getErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function analyzeEvidence(evidence: Evidence) {
    await processEvidenceWithOcr(evidence);
  }

  function editTemplate(template: Template) {
    setEditingTemplateId(template.id);
    setTemplateForm(toTemplateForm(template));
    setActiveTab("plantillas");
  }

  function applyTemplatePreset(preset: (typeof TEMPLATE_PRESETS)[number]) {
    setEditingTemplateId(null);
    setTemplateForm(preset.draft);
    setActiveTab("plantillas");
  }

  function editRule(rule: AutomationRule) {
    setEditingRuleId(rule.id);
    setRuleForm(toRuleForm(rule));
  }

  return (
    <div className="space-y-4">
      <CobranzaInfoModal info={infoModal} onClose={() => setInfoModal(null)} />
      <CobranzaActionDialog
        dialog={actionDialog}
        onResolve={resolveActionDialog}
      />
      <ReceiptProcessingOverlay state={receiptProcessing} />
      <WhatsappAgreementModal
        state={whatsappAgreementBlocked ? whatsappAgreement : null}
        busy={busy}
        onAccept={() => void acceptWhatsappAgreement()}
      />
      <section className="page-section">
        <div className="flex flex-col gap-3 border-b border-white/8 pb-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="inline-flex rounded-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-200">
              Cobranza
            </p>
            <div className="mt-3 flex items-center gap-2">
              <h1 className="page-title-compact">
                Cobranza y recordatorios
              </h1>
              <CobranzaInfoButton
                info={cobranzaTabInfo[activeTab]}
                onOpen={setInfoModal}
              />
            </div>
            <p className="mt-2 section-copy-compact">
              Administra mensajes por corte, gracia, recargos, comprobantes y
              seguimiento de pagos desde WhatsApp y correo.
            </p>
          </div>

          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading || busy}
            className="rounded-2xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:border-cyan-300/40 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Actualizar
          </button>
        </div>

        {notice ? (
          <div
            className={`mt-5 rounded-2xl border px-4 py-3 text-sm ${
              notice.type === "success"
                ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-100"
                : notice.type === "error"
                  ? "border-rose-400/25 bg-rose-500/10 text-rose-100"
                  : "border-cyan-400/20 bg-cyan-500/10 text-cyan-100"
            }`}
          >
            {notice.message}
          </div>
        ) : null}

        <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-5">
          <MetricCard
            label="Cartera abierta"
            value={money(metrics?.totales.exigible)}
            helper={`${metrics?.totales.cuentas_abiertas ?? 0} cuenta(s) abiertas`}
            tone="cyan"
          />
          <MetricCard
            label="Por vencer"
            value={String(metrics?.por_vencer.count ?? 0)}
            helper={money(metrics?.por_vencer.total)}
            tone="blue"
          />
          <MetricCard
            label="En gracia"
            value={String(metrics?.en_gracia.count ?? 0)}
            helper={money(metrics?.en_gracia.total)}
            tone="emerald"
          />
          <MetricCard
            label="Con recargo"
            value={String(metrics?.vencidas.count ?? 0)}
            helper={money(metrics?.vencidas.total)}
            tone="amber"
          />
          <MetricCard
            label="Comprobantes"
            value={String(openEvidenceCount)}
            helper="pendientes de validar"
            tone="rose"
          />
        </div>

        <div className="mt-4 work-tab-bar">
          {visibleTabs.map((tab) => (
            <div key={tab.id} className="relative">
              <button
                type="button"
                onClick={() => selectTab(tab.id)}
                className={`work-tab h-full w-full pr-10 ${
                  activeTab === tab.id
                    ? "work-tab-active"
                    : "work-tab-idle"
                }`}
              >
                <span>{tab.title}</span>
                {activeTab === tab.id ? (
                  <span className="work-tab-helper">{tab.description}</span>
                ) : null}
              </button>
              <CobranzaInfoButton
                info={cobranzaTabInfo[tab.id]}
                onOpen={setInfoModal}
                className="absolute right-3 top-3"
              />
            </div>
          ))}
        </div>
      </section>

      {loading ? (
        <section className="page-section">
          <p className="section-copy-compact">Cargando cobranza...</p>
        </section>
      ) : null}

      {!loading && activeTab === "mensajes" ? (
        <MessagesTab
          form={messageForm}
          selectedTemplate={selectedTemplate}
          templates={templates}
          catalogs={catalogs}
          clientsForSelectedEntity={clientsForSelectedEntity}
          previewItems={previewItems}
          history={history}
          busy={busy}
          errors={messageErrors}
          safeMode={monitoring?.modo_seguro ?? null}
          onUpdate={updateMessage}
          onPreview={previewMessages}
          onSend={() => void sendMessages()}
          onReviewHistory={(item) => void reviewHistoryItem(item)}
          onReviewPendingHistory={(items) => void reviewPendingHistoryItems(items)}
          onInfo={setInfoModal}
        />
      ) : null}

      {!loading && activeTab === "plantillas" ? (
        <TemplatesTab
          templateForm={templateForm}
          templates={templates}
          busy={busy}
          editingTemplateId={editingTemplateId}
          errors={templateErrors}
          onUpdate={updateTemplate}
          onSave={saveTemplate}
          onCancelEdit={() => {
            setEditingTemplateId(null);
            setTemplateForm(emptyTemplateForm);
          }}
          onEdit={editTemplate}
          onDelete={(templateId) => void deleteTemplate(templateId)}
          onApplyPreset={applyTemplatePreset}
          onSyncMeta={() => void syncMetaTemplates()}
          onInfo={setInfoModal}
        />
      ) : null}

      {!loading && activeTab === "preparacion" ? (
        <PreparationTab
          monitoring={monitoring}
          templates={templates}
          rules={rules}
          catalogs={catalogs}
          whatsappAgreement={whatsappAgreement}
          busy={busy}
          labTemplateId={whatsappLabTemplateId}
          labDestination={whatsappLabDestination}
          labResult={whatsappLabResult}
          labError={whatsappLabError}
          labContactName={whatsappLabContactName}
          labContactPhone={whatsappLabContactPhone}
          labContactConsent={whatsappLabContactConsent}
          labContactError={whatsappLabContactError}
          demoMetaEntityId={demoMetaEntityId}
          demoMetaResult={demoMetaResult}
          demoMetaError={demoMetaError}
          onDemoMetaEntityChange={changeDemoMetaEntity}
          onPrepareDemoMeta={() => void prepareDemoMetaDataset()}
          onResetLabProcess={(destination, label) =>
            void resetWhatsappLabProcess(destination, label)
          }
          onLabTemplateChange={changeWhatsappLabTemplate}
          onLabDestinationChange={changeWhatsappLabDestination}
          onLabContactNameChange={(value) => {
            setWhatsappLabContactName(value);
            setWhatsappLabContactError(null);
          }}
          onLabContactPhoneChange={(value) => {
            setWhatsappLabContactPhone(value);
            setWhatsappLabContactError(null);
          }}
          onLabContactConsentChange={(checked) => {
            setWhatsappLabContactConsent(checked);
            setWhatsappLabContactError(null);
          }}
          onAddLabContact={() => void addWhatsappLabContact()}
          onDeleteLabContact={(contactId) => void deleteWhatsappLabContact(contactId)}
          onSendLabTest={() => void sendWhatsappLabTest()}
          onSyncMeta={() => void syncMetaTemplates()}
          onRefresh={() => void refresh()}
          onInfo={setInfoModal}
        />
      ) : null}

      {!loading && activeTab === "automatizacion" ? (
        <AutomationTab
          ruleForm={ruleForm}
          rules={rules}
          templates={templates}
          catalogs={catalogs}
          busy={busy}
          editingRuleId={editingRuleId}
          errors={ruleErrors}
          previewDate={automationPreviewDate}
          previewResult={automationPreview}
          previewLoading={automationPreviewLoading}
          previewUpdatedAt={automationPreviewUpdatedAt}
          previewError={automationPreviewError}
          previewHistory={automationPreviewHistory}
          onUpdate={updateRule}
          onSave={saveRule}
          onCancelEdit={() => {
            setEditingRuleId(null);
            setRuleForm(emptyRuleForm);
          }}
          onEdit={editRule}
          onDelete={(ruleId) => void deleteRule(ruleId)}
          onToggle={(rule) => void toggleRule(rule)}
          onRun={() => void runAutomations()}
          onPreviewDateChange={setAutomationPreviewDate}
          onPreview={() => void previewAutomations()}
          onUsePreviewHistoryDate={setAutomationPreviewDate}
          onClearPreview={() => {
            setAutomationPreview(null);
            setAutomationPreviewUpdatedAt(null);
            setAutomationPreviewError(null);
          }}
          onClearPreviewHistory={() => setAutomationPreviewHistory([])}
          onInfo={setInfoModal}
        />
      ) : null}

      {!loading && activeTab === "comprobantes" ? (
        <EvidenceTab
          evidenceForm={evidenceForm}
          evidences={evidences}
          catalogs={catalogs}
          dashboard={dashboard}
          evidenceFilters={evidenceFilters}
          busy={busy}
          uploadBusy={evidenceUploadBusy}
          processingEvidenceId={receiptProcessing?.evidenceId ?? null}
          errors={evidenceErrors}
          onUpdate={updateEvidence}
          onFiltersChange={setEvidenceFilters}
          onUploadFile={(file) => void uploadEvidenceFile(file)}
          onSave={registerEvidence}
          onClassify={(evidence, action) =>
            void classifyEvidence(evidence, action)
          }
          onCorrect={(evidence) => void correctEvidenceData(evidence)}
          onAnalyze={(evidence) => void analyzeEvidence(evidence)}
          onApplyCxc={(evidence, candidate) =>
            void applyEvidenceToCxc(evidence, candidate)
          }
          onInfo={setInfoModal}
        />
      ) : null}

      {!loading && activeTab === "cartera" ? (
        <CarteraTab
          dashboard={dashboard}
          onStartMessage={startMessageFromDebtor}
          onStartBulkMessages={startMessagesFromRows}
          onInfo={setInfoModal}
        />
      ) : null}

      {!loading && activeTab === "reglas" ? (
        <RulesGuideTab
          templates={templates}
          rules={rules}
          monitoring={monitoring}
          whatsappAgreement={whatsappAgreement}
          dashboard={dashboard}
          evidences={evidences}
          history={history}
          busy={busy}
          onSelectTab={selectTab}
          onCloseOnboarding={(payload) => void closeCobranzaOnboarding(payload)}
          onReopenOnboarding={() => void reopenCobranzaOnboarding()}
          onInfo={setInfoModal}
        />
      ) : null}
    </div>
  );
}

function MetricCard({
  label,
  value,
  helper,
  tone,
}: {
  label: string;
  value: string;
  helper: string;
  tone: "cyan" | "blue" | "emerald" | "amber" | "rose";
}) {
  const toneClass = {
    cyan: "border-cyan-400/15 bg-cyan-500/10 text-cyan-200",
    blue: "border-blue-400/15 bg-blue-500/10 text-blue-200",
    emerald: "border-emerald-400/15 bg-emerald-500/10 text-emerald-200",
    amber: "border-amber-400/15 bg-amber-500/10 text-amber-200",
    rose: "border-rose-400/15 bg-rose-500/10 text-rose-200",
  }[tone];
  return (
    <div className={`metric-card-compact ${toneClass}`}>
      <p className="metric-label-compact">{label}</p>
      <p className="metric-value-compact">{value}</p>
      <p className="metric-helper-compact">{helper}</p>
    </div>
  );
}

function CobranzaInfoButton({
  info,
  onOpen,
  className = "",
}: {
  info: CobranzaInfoContent;
  onOpen: (info: CobranzaInfoContent) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onOpen(info);
      }}
      aria-label={`Informacion: ${info.title}`}
      title={info.title}
      className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-cyan-500/40 bg-cyan-500/10 text-xs font-semibold text-cyan-200 transition hover:bg-cyan-500/20 ${className}`}
    >
      i
    </button>
  );
}

function CobranzaInfoModal({
  info,
  onClose,
}: {
  info: CobranzaInfoContent | null;
  onClose: () => void;
}) {
  if (!info) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-xl rounded-3xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-cyan-300">
              {info.eyebrow || "Informacion operativa"}
            </p>
            <h3 className="mt-2 text-2xl font-bold text-white">{info.title}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-300 transition hover:text-white"
          >
            Cerrar
          </button>
        </div>
        <p className="mt-5 text-sm leading-relaxed text-zinc-300">
          {info.summary}
        </p>
        <div className="mt-5 space-y-3">
          {info.details.map((detail, index) => (
            <div
              key={`${info.title}-${index}`}
              className="rounded-2xl border border-zinc-800 bg-zinc-900/60 px-4 py-3 text-sm leading-relaxed text-zinc-300"
            >
              {detail}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CobranzaActionDialog({
  dialog,
  onResolve,
}: {
  dialog: CobranzaDialogState | null;
  onResolve: (value: boolean | string | null) => void;
}) {
  const [inputValue, setInputValue] = useState("");

  useEffect(() => {
    setInputValue(dialog?.type === "prompt" ? dialog.defaultValue || "" : "");
  }, [dialog]);

  if (!dialog) {
    return null;
  }

  const tone = dialog.tone || "default";
  const confirmClasses =
    tone === "danger"
      ? "border-rose-400/30 bg-rose-500/15 text-rose-100 hover:border-rose-300/60"
      : tone === "success"
        ? "border-emerald-400/30 bg-emerald-500/15 text-emerald-100 hover:border-emerald-300/60"
        : tone === "warning"
          ? "border-amber-400/30 bg-amber-500/15 text-amber-100 hover:border-amber-300/60"
          : "border-cyan-400/30 bg-cyan-500/15 text-cyan-100 hover:border-cyan-300/60";
  const promptIsEmpty = dialog.type === "prompt" && dialog.required && !inputValue.trim();

  return (
    <div className="fixed inset-0 z-[190] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-zinc-950 p-6 shadow-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300">
          Cobranza
        </p>
        <h3 className="mt-2 text-2xl font-bold text-white">{dialog.title}</h3>
        <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">
          {dialog.message}
        </p>

        {dialog.type === "prompt" ? (
          <label className="mt-5 block">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
              {dialog.inputLabel}
            </span>
            <input
              value={inputValue}
              type={dialog.inputType || "text"}
              placeholder={dialog.placeholder}
              onChange={(event) => setInputValue(event.target.value)}
              className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-300/50"
              autoFocus
            />
          </label>
        ) : null}

        {dialog.helper ? (
          <p className="mt-3 text-xs leading-relaxed text-zinc-500">{dialog.helper}</p>
        ) : null}

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={() => onResolve(null)}
            className="rounded-2xl border border-white/10 bg-zinc-900/70 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:border-white/25"
          >
            {dialog.cancelLabel || "Cancelar"}
          </button>
          <button
            type="button"
            disabled={promptIsEmpty}
            onClick={() =>
              onResolve(dialog.type === "prompt" ? inputValue.trim() : true)
            }
            className={`rounded-2xl border px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-45 ${confirmClasses}`}
          >
            {dialog.confirmLabel || "Confirmar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ReceiptProcessingOverlay({
  state,
}: {
  state: ReceiptProcessingState | null;
}) {
  if (!state) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[185] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-3xl border border-cyan-400/20 bg-zinc-950 p-6 text-center shadow-2xl">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-cyan-300/25 bg-cyan-500/10">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-300 border-t-transparent" />
        </div>
        <p className="mt-5 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300">
          IA visual
        </p>
        <h3 className="mt-2 text-2xl font-bold text-white">{state.title}</h3>
        <p className="mt-3 text-sm leading-relaxed text-zinc-400">{state.detail}</p>
        {state.fileName ? (
          <p className="mt-4 rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-zinc-300">
            {state.fileName}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function WhatsappAgreementModal({
  state,
  busy,
  onAccept,
}: {
  state: WhatsappAgreementState | null;
  busy: boolean;
  onAccept: () => void;
}) {
  const [checks, setChecks] = useState({
    contacto: false,
    datos: false,
    politicas: false,
    suspension: false,
  });

  useEffect(() => {
    if (state) {
      setChecks({
        contacto: false,
        datos: false,
        politicas: false,
        suspension: false,
      });
    }
  }, [state]);

  if (!state) {
    return null;
  }

  const allChecked =
    checks.contacto && checks.datos && checks.politicas && checks.suspension;

  const updateCheck = (key: keyof typeof checks) => {
    setChecks((current) => ({ ...current, [key]: !current[key] }));
  };

  return (
    <div className="fixed inset-0 z-[170] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col rounded-3xl border border-cyan-400/20 bg-zinc-950 shadow-2xl">
        <div className="border-b border-white/10 px-6 py-5">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300">
            Requisito antes de enviar
          </p>
          <h3 className="mt-2 text-2xl font-bold text-white">
            {state.agreement.titulo}
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-zinc-300">
            Para usar el numero de BetterP en cobranza, un administrador de la
            cuenta debe aceptar este acuerdo. Quedara registrado con fecha,
            usuario, version y huella del texto.
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div className="rounded-2xl border border-white/10 bg-zinc-900/70 p-4 text-sm leading-relaxed text-zinc-300 whitespace-pre-line">
            {state.agreement.texto}
          </div>

          <div className="mt-5 space-y-3">
            <AgreementCheckbox
              checked={checks.contacto}
              onChange={() => updateCheck("contacto")}
              label="Confirmo que tengo autorizacion o base legal para contactar a mis clientes."
            />
            <AgreementCheckbox
              checked={checks.datos}
              onChange={() => updateCheck("datos")}
              label="Confirmo que los datos de cobranza cargados son correctos y estan actualizados."
            />
            <AgreementCheckbox
              checked={checks.politicas}
              onChange={() => updateCheck("politicas")}
              label="Acepto respetar las politicas de Meta/WhatsApp y las reglas de uso de BetterP."
            />
            <AgreementCheckbox
              checked={checks.suspension}
              onChange={() => updateCheck("suspension")}
              label="Entiendo que BetterP puede pausar envios si detecta riesgo, quejas o mal uso."
            />
          </div>

          <p className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-500/10 px-4 py-3 text-sm leading-relaxed text-amber-100">
            Version {state.agreement.version} | Huella del texto{" "}
            <span className="font-mono">{state.agreement.texto_hash.slice(0, 12)}</span>
          </p>
        </div>

        <div className="flex flex-col gap-3 border-t border-white/10 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs leading-relaxed text-zinc-500">
            Sin esta aceptacion no se pueden activar automatizaciones ni enviar
            mensajes por WhatsApp con el numero compartido.
          </p>
          <button
            type="button"
            onClick={onAccept}
            disabled={busy || !allChecked}
            className="rounded-2xl border border-emerald-400/25 bg-emerald-500/10 px-5 py-2.5 text-sm font-semibold text-emerald-100 transition hover:border-emerald-300/50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Aceptar y habilitar
          </button>
        </div>
      </div>
    </div>
  );
}

function AgreementCheckbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <label className="flex items-start gap-3 rounded-2xl border border-white/10 bg-zinc-950/70 px-4 py-3 text-sm leading-relaxed text-zinc-300">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="mt-1 h-4 w-4 rounded border-zinc-700 bg-zinc-950 text-cyan-500"
      />
      <span>{label}</span>
    </label>
  );
}

function FieldHeader({
  label,
  required,
  optional,
  info,
  onInfo,
}: {
  label: string;
  required?: boolean;
  optional?: boolean;
  info?: CobranzaInfoContent;
  onInfo?: (info: CobranzaInfoContent) => void;
}) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span>{label}</span>
      {required ? (
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200">
          Obligatorio
        </span>
      ) : null}
      {!required && optional ? (
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
          Opcional
        </span>
      ) : null}
      {info && onInfo ? <CobranzaInfoButton info={info} onOpen={onInfo} /> : null}
    </span>
  );
}

function SelectField({
  label,
  value,
  onChange,
  children,
  helper,
  error,
  required,
  optional,
  info,
  onInfo,
  disabled = false,
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  children: ReactNode;
  helper?: string;
  error?: string;
  required?: boolean;
  optional?: boolean;
  info?: CobranzaInfoContent;
  onInfo?: (info: CobranzaInfoContent) => void;
  disabled?: boolean;
}) {
  return (
    <label className="block text-sm text-zinc-400">
      <FieldHeader
        label={label}
        required={required}
        optional={optional}
        info={info}
        onInfo={onInfo}
      />
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className={`mt-2 w-full rounded-2xl border bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none transition disabled:cursor-not-allowed disabled:opacity-55 focus:border-cyan-400/50 ${
          error ? "border-rose-400/50" : "border-white/10"
        }`}
      >
        {children}
      </select>
      {error ? <span className="mt-2 block text-xs text-rose-200">{error}</span> : null}
      {!error && helper ? <span className="mt-2 block text-xs text-zinc-500">{helper}</span> : null}
    </label>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  helper,
  error,
  required,
  optional,
  info,
  onInfo,
  maxLength,
  inputMode,
  min,
  max,
  step,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  helper?: string;
  error?: string;
  required?: boolean;
  optional?: boolean;
  info?: CobranzaInfoContent;
  onInfo?: (info: CobranzaInfoContent) => void;
  maxLength?: number;
  inputMode?: "text" | "search" | "email" | "tel" | "url" | "none" | "numeric" | "decimal";
  min?: number;
  max?: number;
  step?: number | string;
}) {
  return (
    <label className="block text-sm text-zinc-400">
      <FieldHeader
        label={label}
        required={required}
        optional={optional}
        info={info}
        onInfo={onInfo}
      />
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        inputMode={inputMode}
        min={min}
        max={max}
        step={step}
        className={`mt-2 w-full rounded-2xl border bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-700 focus:border-cyan-400/50 ${
          error ? "border-rose-400/50" : "border-white/10"
        }`}
      />
      {error ? <span className="mt-2 block text-xs text-rose-200">{error}</span> : null}
      {!error && helper ? <span className="mt-2 block text-xs text-zinc-500">{helper}</span> : null}
    </label>
  );
}

function TextareaField({
  label,
  value,
  onChange,
  rows = 4,
  placeholder,
  helper,
  error,
  required,
  optional,
  info,
  onInfo,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
  helper?: string;
  error?: string;
  required?: boolean;
  optional?: boolean;
  info?: CobranzaInfoContent;
  onInfo?: (info: CobranzaInfoContent) => void;
  maxLength?: number;
}) {
  return (
    <label className="block text-sm text-zinc-400">
      <FieldHeader
        label={label}
        required={required}
        optional={optional}
        info={info}
        onInfo={onInfo}
      />
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={rows}
        placeholder={placeholder}
        maxLength={maxLength}
        className={`mt-2 w-full rounded-2xl border bg-zinc-950 px-3 py-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-700 focus:border-cyan-400/50 ${
          error ? "border-rose-400/50" : "border-white/10"
        }`}
      />
      {error ? <span className="mt-2 block text-xs text-rose-200">{error}</span> : null}
      {!error && helper ? <span className="mt-2 block text-xs text-zinc-500">{helper}</span> : null}
    </label>
  );
}

function ToggleField({
  label,
  checked,
  onChange,
  helper,
  info,
  onInfo,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  helper?: string;
  info?: CobranzaInfoContent;
  onInfo?: (info: CobranzaInfoContent) => void;
}) {
  return (
    <label className="flex items-start gap-3 rounded-2xl border border-white/10 bg-zinc-950/60 px-3 py-3 text-sm text-zinc-300">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 h-4 w-4 rounded border-zinc-700 bg-zinc-950 text-cyan-400"
      />
      <span>
        <span className="flex items-center gap-2 font-medium text-zinc-100">
          {label}
          {info && onInfo ? <CobranzaInfoButton info={info} onOpen={onInfo} /> : null}
        </span>
        {helper ? <span className="mt-1 block text-xs text-zinc-500">{helper}</span> : null}
      </span>
    </label>
  );
}

function MessagesTab({
  form,
  selectedTemplate,
  templates,
  catalogs,
  clientsForSelectedEntity,
  previewItems,
  history,
  busy,
  errors,
  safeMode,
  onUpdate,
  onPreview,
  onSend,
  onReviewHistory,
  onReviewPendingHistory,
  onInfo,
}: {
  form: MessageForm;
  selectedTemplate: Template | null;
  templates: Template[];
  catalogs: Catalogos;
  clientsForSelectedEntity: Catalogos["clientes"];
  previewItems: PreviewItem[];
  history: HistoryItem[];
  busy: boolean;
  errors: Record<string, string>;
  safeMode: AutomationMonitoring["modo_seguro"] | null;
  onUpdate: <K extends keyof MessageForm>(key: K, value: MessageForm[K]) => void;
  onPreview: (event: FormEvent<HTMLFormElement>) => void;
  onSend: () => void;
  onReviewHistory: (item: HistoryItem) => void;
  onReviewPendingHistory: (items: HistoryItem[]) => void;
  onInfo: (info: CobranzaInfoContent) => void;
}) {
  const availableTemplates = templates.filter((template) => {
    if (form.canal === "AMBOS") {
      return (
        template.activo &&
        (!channelUsesWhatsapp(template.canal) || isApprovedWhatsappTemplate(template))
      );
    }
    if (form.canal === "WHATSAPP") {
      return (
        template.activo &&
        channelUsesWhatsapp(template.canal) &&
        isApprovedWhatsappTemplate(template)
      );
    }
    return template.activo && ["EMAIL", "AMBOS"].includes(template.canal);
  });
  const usesWhatsapp = channelUsesWhatsapp(form.canal);
  const testLab = safeMode?.laboratorio_cobranza;
  const safeWhatsappAllowlist = buildWhatsappAllowlistSet(
    safeMode?.numeros_whatsapp_permitidos ?? [],
  );
  const whatsappSandboxActive =
    usesWhatsapp && Boolean(safeMode?.solo_numeros_whatsapp_permitidos);
  const sendBlockedByLab =
    whatsappSandboxActive && !Boolean(testLab?.habilitado);
  const blockedPreviewTargets = whatsappSandboxActive
    ? blockedWhatsappPreviewDestinations(previewItems, safeWhatsappAllowlist)
    : [];
  const sendBlockedByAllowlist = blockedPreviewTargets.length > 0;
  const blockedBillingItems = previewItems.filter(previewBillingIsBlocked);
  const sendBlockedByBilling = blockedBillingItems.length > 0;
  const blockedContactItems = previewItems.filter(previewContactIsBlocked);
  const sendBlockedByContact = blockedContactItems.length > 0;
  const recentHistory = history;
  const pendingReviewCount = recentHistory.filter(historyNeedsReview).length;
  const reviewedHistoryCount = recentHistory.length - pendingReviewCount;
  const pendingVisibleHistory = recentHistory.filter(historyNeedsReview);
  const sendDisabledReason = sendBlockedByLab
    ? testLab?.motivo ||
      "El laboratorio de WhatsApp solo esta habilitado para 01.agodinez@gmail.com en Maya Coliving."
    : sendBlockedByBilling
      ? `${blockedBillingItems.length} destinatario(s) requieren saldo exigible y vencimiento confirmado antes de enviar.`
      : sendBlockedByContact
        ? `${blockedContactItems.length} destinatario(s) requieren telefono, consentimiento vigente o desbloqueo de contacto antes de enviar.`
        : sendBlockedByAllowlist
          ? `${blockedPreviewTargets.length} destino(s) WhatsApp estan fuera de la lista segura. Ajusta el cliente o usa la zona de laboratorio.`
          : "";
  const sendDisabled =
    busy ||
    !form.plantilla_id ||
    previewItems.length === 0 ||
    sendBlockedByLab ||
    sendBlockedByBilling ||
    sendBlockedByContact ||
    sendBlockedByAllowlist;
  return (
    <section className="grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
      <form onSubmit={onPreview} className="page-section space-y-5">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="section-title-compact">Vista previa de cobranza</h2>
            <CobranzaInfoButton info={cobranzaTabInfo.mensajes} onOpen={onInfo} />
          </div>
          <p className="mt-2 section-copy-compact">
            Envio manual controlado por plantilla. El usuario elige segmento,
            cliente, canal y fecha de referencia; BetterP genera el texto final
            sin permitir edicion libre del mensaje.
          </p>
        </div>

        {usesWhatsapp && safeMode ? (
          <div
            className={`rounded-2xl border px-4 py-3 text-sm ${
              testLab?.habilitado
                ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-100"
                : "border-amber-400/25 bg-amber-500/10 text-amber-100"
            }`}
          >
            <p className="font-semibold">
              {testLab?.habilitado
                ? "Envio WhatsApp en laboratorio"
                : "Envio WhatsApp restringido"}
            </p>
            <p className="mt-1 text-xs opacity-80">
              {testLab?.motivo}
              {safeMode.solo_numeros_whatsapp_permitidos ? (
                <>
                  {" "}
                  Numeros permitidos:{" "}
                  {safeMode.numeros_whatsapp_permitidos.join(", ") || "sin numeros"}.
                </>
              ) : null}
            </p>
          </div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2">
          <SelectField
            label="Segmento"
            value={form.segmento}
            onChange={(value) => onUpdate("segmento", value)}
            required
            info={cobranzaFieldInfo.segmento}
            onInfo={onInfo}
            error={errors.segmento}
          >
            {SEGMENTS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Canal"
            value={form.canal}
            onChange={(value) => onUpdate("canal", value as Channel)}
            required
            info={cobranzaFieldInfo.canal}
            onInfo={onInfo}
            error={errors.canal}
          >
            <option value="AMBOS">WhatsApp y email</option>
            <option value="WHATSAPP">Solo WhatsApp</option>
            <option value="EMAIL">Solo email</option>
          </SelectField>
          <SelectField
            label="Entidad"
            value={form.entidad_id ?? ""}
            onChange={(value) => onUpdate("entidad_id", parseSelectId(value))}
            optional
            info={cobranzaFieldInfo.entidad}
            onInfo={onInfo}
          >
            <option value="">Todas</option>
            {catalogs.entidades.map((item) => (
              <option key={item.id} value={item.id}>
                {item.nombre}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Cliente especifico"
            value={form.cliente_id ?? ""}
            onChange={(value) => {
              const clientId = parseSelectId(value);
              onUpdate("cliente_id", clientId);
              onUpdate("cliente_ids", clientId ? [clientId] : []);
            }}
            optional
            info={cobranzaFieldInfo.cliente}
            onInfo={onInfo}
          >
            <option value="">Todos los del segmento</option>
            {clientsForSelectedEntity.map((client) => (
              <option key={client.id} value={client.id}>
                {client.nombre}
              </option>
            ))}
          </SelectField>
          {form.cliente_ids.length > 1 ? (
            <div className="self-end rounded-2xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100">
              {form.cliente_ids.length} clientes seleccionados desde cartera.
            </div>
          ) : null}
          <SelectField
            label="Plantilla"
            value={form.plantilla_id ?? ""}
            onChange={(value) => onUpdate("plantilla_id", parseSelectId(value))}
            required
            info={cobranzaFieldInfo.plantilla}
            onInfo={onInfo}
            error={errors.plantilla_id}
          >
            <option value="">Selecciona plantilla</option>
            {availableTemplates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.nombre}
              </option>
            ))}
          </SelectField>
          <TextField
            label="Fecha de referencia"
            value={form.fecha_referencia}
            type="date"
            onChange={(value) => onUpdate("fecha_referencia", value)}
            required
            info={cobranzaFieldInfo.fechaReferencia}
            onInfo={onInfo}
            error={errors.fecha_referencia}
          />
        </div>
        {selectedTemplate ? (
          <div className="rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
              Texto estandar
            </p>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-zinc-300">
              {selectedTemplate.cuerpo}
            </p>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={busy || !form.plantilla_id}
            className="rounded-2xl border border-cyan-400/25 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:border-cyan-300/50 disabled:opacity-60"
          >
            Previsualizar
          </button>
          <button
            type="button"
            onClick={onSend}
            disabled={sendDisabled}
            title={sendDisabledReason || undefined}
            className="rounded-2xl border border-emerald-400/25 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-100 transition hover:border-emerald-300/50 disabled:opacity-60"
          >
            Enviar vista previa
          </button>
        </div>
        {sendDisabledReason ? (
          <p className="text-xs text-amber-200">{sendDisabledReason}</p>
        ) : null}
        {sendBlockedByAllowlist ? (
          <div className="rounded-2xl border border-amber-400/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            <p className="font-semibold">Envio bloqueado por lista segura</p>
            <p className="mt-1 text-xs leading-relaxed opacity-85">
              BetterP esta en modo controlado. Estos destinos no se enviaran
              desde la UI hasta agregarlos a la allowlist o desactivar el modo
              prueba.
            </p>
            <div className="mt-3 space-y-1 text-xs text-amber-50/80">
              {blockedPreviewTargets.slice(0, 5).map((target) => (
                <p key={`${target.clientName}-${target.destination}`}>
                  {target.clientName}:{" "}
                  <span className="font-mono">{target.destination || "sin destino"}</span>
                </p>
              ))}
              {blockedPreviewTargets.length > 5 ? (
                <p>+{blockedPreviewTargets.length - 5} destino(s) adicional(es).</p>
              ) : null}
            </div>
          </div>
        ) : null}
        {previewItems.length > 0 ? (
          <div
            className={`rounded-2xl border px-4 py-3 text-sm ${
              sendBlockedByBilling
                ? "border-amber-400/20 bg-amber-500/10 text-amber-100"
                : "border-emerald-400/20 bg-emerald-500/10 text-emerald-100"
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-semibold">Saldo y vencimiento</p>
                  <CobranzaInfoButton
                    info={cobranzaFieldInfo.saldoVencimiento}
                    onOpen={onInfo}
                  />
                </div>
                <p className="mt-1 text-xs leading-relaxed opacity-85">
                  BetterP confirma que cada aviso de cobranza tenga una CxC
                  abierta, saldo exigible positivo y fecha de vencimiento antes
                  de liberar el envio.
                </p>
              </div>
              <span
                className={`rounded-full border px-2.5 py-1 text-xs ${
                  sendBlockedByBilling
                    ? "border-amber-400/25 bg-amber-500/10 text-amber-100"
                    : "border-emerald-400/25 bg-emerald-500/10 text-emerald-100"
                }`}
              >
                {sendBlockedByBilling ? "Requiere revision" : "Listo"}
              </span>
            </div>
            <div className="mt-3 space-y-2">
              {previewItems.slice(0, 6).map((item) => {
                const blockers = Array.from(previewBillingBlockers(item));
                const validation = item.validacion_cobranza;
                return (
                  <div
                    key={`billing-${item.cliente_id}-${item.segmento}`}
                    className="rounded-xl border border-white/10 bg-zinc-950/60 px-3 py-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-white">
                        {item.cliente_nombre}
                      </p>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[11px] ${
                          blockers.length
                            ? "border-amber-400/25 bg-amber-500/10 text-amber-100"
                            : "border-emerald-400/25 bg-emerald-500/10 text-emerald-100"
                        }`}
                      >
                        {blockers.length ? "Atencion" : "OK"}
                      </span>
                    </div>
                    <div className="mt-2 grid gap-1 text-xs leading-5 text-zinc-400 md:grid-cols-2">
                      <span>Total exigible: {previewBillingAmountLabel(item)}</span>
                      <span>Vence: {previewBillingDueDateLabel(item)}</span>
                      <span>
                        CxC abiertas:{" "}
                        {validation?.cuentas?.abiertas ?? item.cuentas_abiertas}
                      </span>
                      <span>
                        Referencia: {validation?.referencia_pago || item.referencia_pago || "Sin referencia"}
                      </span>
                    </div>
                    {blockers.length ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {blockers.map((blocker) => (
                          <span
                            key={blocker}
                            className="rounded-full border border-amber-400/20 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-100"
                          >
                            {previewBillingIssueLabel(blocker)}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
              {previewItems.length > 6 ? (
                <p className="text-xs text-zinc-400">
                  +{previewItems.length - 6} destinatario(s) adicional(es).
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
        {previewItems.length > 0 ? (
          <div
            className={`rounded-2xl border px-4 py-3 text-sm ${
              sendBlockedByContact
                ? "border-amber-400/20 bg-amber-500/10 text-amber-100"
                : "border-emerald-400/20 bg-emerald-500/10 text-emerald-100"
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-semibold">Telefono y consentimiento</p>
                  <CobranzaInfoButton
                    info={cobranzaFieldInfo.telefonoConsentimiento}
                    onOpen={onInfo}
                  />
                </div>
                <p className="mt-1 text-xs leading-relaxed opacity-85">
                  BetterP revisa telefono WhatsApp, consentimiento vigente y
                  bandera de no contactar antes de liberar el envio.
                </p>
              </div>
              <span
                className={`rounded-full border px-2.5 py-1 text-xs ${
                  sendBlockedByContact
                    ? "border-amber-400/25 bg-amber-500/10 text-amber-100"
                    : "border-emerald-400/25 bg-emerald-500/10 text-emerald-100"
                }`}
              >
                {sendBlockedByContact ? "Requiere revision" : "Listo"}
              </span>
            </div>
            <div className="mt-3 space-y-2">
              {previewItems.slice(0, 6).map((item) => {
                const blockers = Array.from(previewContactBlockers(item));
                const noContact = item.validacion_contacto?.no_contactar_cobranza;
                return (
                  <div
                    key={`contact-${item.cliente_id}-${item.segmento}`}
                    className="rounded-xl border border-white/10 bg-zinc-950/60 px-3 py-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-white">
                        {item.cliente_nombre}
                      </p>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[11px] ${
                          blockers.length
                            ? "border-amber-400/25 bg-amber-500/10 text-amber-100"
                            : "border-emerald-400/25 bg-emerald-500/10 text-emerald-100"
                        }`}
                      >
                        {blockers.length ? "Atencion" : "OK"}
                      </span>
                    </div>
                    <div className="mt-2 grid gap-1 text-xs leading-5 text-zinc-400 md:grid-cols-2">
                      <span>{previewContactPhoneLabel(item)}</span>
                      <span>{previewConsentLabel(item)}</span>
                    </div>
                    {noContact?.bloqueado ? (
                      <p className="mt-1 text-xs text-amber-100/80">
                        No contactar{noContact.motivo ? `: ${noContact.motivo}` : "."}
                      </p>
                    ) : null}
                    {blockers.length ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {blockers.map((blocker) => (
                          <span
                            key={blocker}
                            className="rounded-full border border-amber-400/20 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-100"
                          >
                            {previewContactIssueLabel(blocker)}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
              {previewItems.length > 6 ? (
                <p className="text-xs text-zinc-400">
                  +{previewItems.length - 6} destinatario(s) adicional(es).
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
      </form>

      <div className="space-y-6">
        <section className="page-section">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="section-title-compact">Vista previa</h2>
                <CobranzaInfoButton info={cobranzaTabInfo.mensajes} onOpen={onInfo} />
              </div>
              <p className="mt-1 section-copy-compact">
                {previewItems.length} destinatario(s) calculados.
              </p>
            </div>
          </div>
          <div className="mt-5 space-y-3">
            {previewItems.length === 0 ? (
              <p className="rounded-2xl border border-white/10 bg-zinc-950/70 px-4 py-4 text-sm text-zinc-500">
                Genera una vista previa para revisar destinatarios, saldos y
                texto renderizado.
              </p>
            ) : (
              previewItems.slice(0, 5).map((item) => (
                <div
                  key={`${item.cliente_id}-${item.segmento}`}
                  className="rounded-2xl border border-white/10 bg-zinc-950/70 p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-white">
                        {item.cliente_nombre}
                      </p>
                      <p className="mt-1 text-xs text-zinc-500">
                        {item.entidad_nombre} | {item.canales.join(", ")} |{" "}
                        {money(item.total_exigible)}
                      </p>
                    </div>
                    <span className="rounded-full border border-cyan-400/25 bg-cyan-500/10 px-2.5 py-1 text-xs text-cyan-100">
                      {item.cuentas_abiertas} CxC
                    </span>
                  </div>
                  {item.asunto ? (
                    <p className="mt-3 text-sm font-medium text-zinc-200">
                      {item.asunto}
                    </p>
                  ) : null}
                  <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-400">
                    {item.mensaje}
                  </p>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="page-section">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="section-title-compact">Ultimos envios</h2>
                <CobranzaInfoButton info={cobranzaFieldInfo.historialEnvios} onOpen={onInfo} />
              </div>
              <p className="mt-2 section-copy-compact">
                Primer dia: revisa cada enviado, omitido o error antes de subir
                volumen.
              </p>
            </div>
            {recentHistory.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                    pendingReviewCount
                      ? "border-amber-400/25 bg-amber-500/10 text-amber-100"
                      : "border-emerald-400/25 bg-emerald-500/10 text-emerald-100"
                  }`}
                >
                  {pendingReviewCount
                    ? `${pendingReviewCount} por revisar`
                    : "Todo revisado"}
                </span>
                {pendingReviewCount > 0 ? (
                  <button
                    type="button"
                    onClick={() => onReviewPendingHistory(pendingVisibleHistory)}
                    disabled={busy}
                    className="rounded-full border border-cyan-400/25 bg-cyan-500/10 px-3 py-1 text-xs font-semibold text-cyan-100 transition hover:border-cyan-300/50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Marcar visibles revisados
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
          {recentHistory.length > 0 ? (
            <p className="mt-2 text-xs text-zinc-500">
              {reviewedHistoryCount}/{recentHistory.length} registro(s) revisado(s).
            </p>
          ) : null}
          <div className="mt-5 space-y-3">
            {recentHistory.map((item) => {
              const operationalInsight = historyOperationalInsight(item);
              const review = historyReviewInfo(item);
              const insightClass =
                operationalInsight?.tone === "rose"
                  ? "border-rose-400/20 bg-rose-500/5"
                  : "border-amber-400/20 bg-amber-500/5";
              const insightBoxClass =
                operationalInsight?.tone === "rose"
                  ? "border-rose-400/15 bg-zinc-950/60"
                  : "border-amber-400/15 bg-zinc-950/60";
              const insightTitleClass =
                operationalInsight?.tone === "rose" ? "text-rose-200" : "text-amber-200";
              return (
                <div
                  key={item.id}
                  className={`rounded-2xl border px-4 py-3 ${
                    operationalInsight
                      ? insightClass
                      : "border-white/10 bg-zinc-950/70"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-white">{item.cliente_nombre}</p>
                      <p className="mt-1 text-xs text-zinc-500">
                        {item.canal} | {item.proveedor} | {shortDate(item.fecha_envio)}
                      </p>
                      {item.plantilla_nombre ? (
                        <p className="mt-1 text-xs text-zinc-600">
                          Plantilla: {item.plantilla_nombre}
                        </p>
                      ) : null}
                    </div>
                    <span className={`rounded-full border px-2.5 py-1 text-xs ${badgeClass(item.estatus)}`}>
                      {statusLabel(item.estatus)}
                    </span>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-zinc-500 md:grid-cols-2">
                    <span>Destino: {item.destinatario || "Sin destino"}</span>
                    <span title={item.referencia_envio || undefined}>
                      Referencia: {providerReferenceLabel(item.referencia_envio)}
                    </span>
                  </div>
                  {operationalInsight ? (
                    <div className={`mt-3 rounded-2xl border px-3 py-3 ${insightBoxClass}`}>
                      <p className={`text-xs font-semibold uppercase tracking-[0.16em] ${insightTitleClass}`}>
                        {operationalInsight.title}
                      </p>
                      {operationalInsight.details.length > 0 ? (
                        <div className="mt-2 space-y-1 text-xs leading-5 text-zinc-400">
                          {operationalInsight.details.map((detail) => (
                            <p key={detail}>{detail}</p>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    {review ? (
                      <div className="rounded-2xl border border-emerald-400/15 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-100">
                        <p className="font-semibold">
                          Revisado {dateTimeLabel(review.reviewedAt)}
                        </p>
                        <p className="mt-1 text-emerald-200/80">
                          {review.reviewedBy}
                          {review.note ? ` | ${review.note}` : ""}
                        </p>
                      </div>
                    ) : (
                      <p className="text-xs text-amber-200">
                        Pendiente de revision manual del primer dia.
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => onReviewHistory(item)}
                      disabled={busy || Boolean(review)}
                      className="rounded-2xl border border-cyan-400/25 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-100 transition hover:border-cyan-300/50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {review ? "Revisado" : "Marcar revisado"}
                    </button>
                  </div>
                </div>
              );
            })}
            {recentHistory.length === 0 ? (
              <p className="text-sm text-zinc-500">Aun no hay envios registrados.</p>
            ) : null}
          </div>
        </section>
      </div>
    </section>
  );
}

function TemplatesTab({
  templateForm,
  templates,
  busy,
  editingTemplateId,
  errors,
  onUpdate,
  onSave,
  onCancelEdit,
  onEdit,
  onDelete,
  onApplyPreset,
  onSyncMeta,
  onInfo,
}: {
  templateForm: TemplateForm;
  templates: Template[];
  busy: boolean;
  editingTemplateId: number | null;
  errors: Record<string, string>;
  onUpdate: <K extends keyof TemplateForm>(key: K, value: TemplateForm[K]) => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
  onCancelEdit: () => void;
  onEdit: (template: Template) => void;
  onDelete: (templateId: number) => void;
  onApplyPreset: (preset: (typeof TEMPLATE_PRESETS)[number]) => void;
  onSyncMeta: () => void;
  onInfo: (info: CobranzaInfoContent) => void;
}) {
  void templateForm;
  void busy;
  void editingTemplateId;
  void errors;
  void onUpdate;
  void onSave;
  void onCancelEdit;
  void onEdit;
  void onDelete;
  void onApplyPreset;
  return (
    <section className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
      <section className="page-section">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
          <div className="flex items-center gap-2">
            <h2 className="section-title-compact">Plantillas estandar de cobranza</h2>
            <CobranzaInfoButton info={cobranzaTabInfo.plantillas} onOpen={onInfo} />
          </div>
          <p className="mt-2 section-copy-compact">
            Estas plantillas son administradas por BetterP para mantener mensajes
            consistentes y compatibles con WhatsApp Cloud API. El cliente ve el
            flujo, pero no edita textos libres desde este modulo.
          </p>
          </div>
          <button
            type="button"
            onClick={onSyncMeta}
            disabled={busy}
            className="rounded-2xl border border-cyan-400/25 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:border-cyan-300/50 disabled:opacity-60"
          >
            Sincronizar Meta
          </button>
        </div>
        <div className="mt-5 grid gap-3">
          {templates
            .filter((template) => template.tipo_plantilla !== "PORTAL_AUTOSERVICIO")
            .map((template) => (
            <div key={template.id} className="rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-white">{template.nombre}</p>
                  <p className="mt-1 text-xs text-zinc-500">
                    {template.canal} | {template.tipo_plantilla}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className={`rounded-full border px-2.5 py-1 text-xs ${template.activo ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-200" : "border-zinc-600/40 bg-zinc-800/70 text-zinc-300"}`}>
                    {template.activo ? "Activa" : "Pausada"}
                  </span>
                  {template.canal === "WHATSAPP" ? (
                    <span className={`rounded-full border px-2.5 py-1 text-xs ${template.whatsapp_template_status === "APROBADA" ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-200" : "border-amber-400/25 bg-amber-500/10 text-amber-200"}`}>
                      Meta {statusLabel(template.whatsapp_template_status || "NO_CONFIGURADA")}
                    </span>
                  ) : null}
                </div>
              </div>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-zinc-400">
                {template.cuerpo}
              </p>
              {template.whatsapp_template_name ? (
                <div className="mt-3 rounded-xl border border-white/8 bg-zinc-900/70 px-3 py-2 text-xs text-zinc-500">
                  Nombre Meta:{" "}
                  <span className="font-mono text-cyan-100">{template.whatsapp_template_name}</span>
                  {" | "}Idioma: {template.whatsapp_template_language || "es_MX"}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      <section className="page-section">
        <div className="mb-6">
          <div className="flex items-center gap-2">
            <h2 className="section-title-compact">Portal y consentimiento</h2>
            <CobranzaInfoButton info={cobranzaTabInfo.preparacion} onOpen={onInfo} />
          </div>
          <p className="mt-2 section-copy-compact">
            Estas plantillas operativas sirven para invitar al cliente al portal,
            validar acceso y aceptar el consentimiento antes de recibir cobranza.
          </p>
          <div className="mt-5 grid gap-3">
            {templates
              .filter((template) => template.tipo_plantilla === "PORTAL_AUTOSERVICIO")
              .map((template) => (
                <div key={template.id} className="rounded-2xl border border-cyan-400/15 bg-cyan-500/10 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-white">{template.nombre}</p>
                      <p className="mt-1 text-xs text-cyan-100/70">
                        {template.canal} | {template.tipo_plantilla}
                      </p>
                    </div>
                    <span className={`rounded-full border px-2.5 py-1 text-xs ${template.whatsapp_template_status === "APROBADA" ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-200" : "border-amber-400/25 bg-amber-500/10 text-amber-200"}`}>
                      Meta {statusLabel(template.whatsapp_template_status || "NO_CONFIGURADA")}
                    </span>
                  </div>
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-zinc-300">
                    {template.cuerpo}
                  </p>
                  {template.whatsapp_template_name ? (
                    <div className="mt-3 rounded-xl border border-cyan-400/15 bg-zinc-950/70 px-3 py-2 text-xs text-zinc-500">
                      Nombre Meta:{" "}
                      <span className="font-mono text-cyan-100">{template.whatsapp_template_name}</span>
                      {" | "}Idioma: {template.whatsapp_template_language || "es_MX"}
                    </div>
                  ) : null}
                </div>
              ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <h2 className="section-title-compact">Variables usadas</h2>
          <CobranzaInfoButton info={cobranzaTabInfo.reglas} onOpen={onInfo} />
        </div>
        <p className="mt-2 section-copy-compact">
          BetterP reemplaza estos valores al ejecutar la regla. Todas las
          plantillas incluyen liga al portal para pagar, consultar saldo y cargar
          comprobante.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          {VARIABLES.map((variable) => (
            <code
              key={variable}
              className="rounded-full border border-white/10 bg-zinc-950 px-3 py-1.5 text-xs text-cyan-100"
            >
              {variable}
            </code>
          ))}
        </div>
      </section>
    </section>
  );
}

function AutomationTab({
  ruleForm,
  rules,
  templates,
  catalogs,
  busy,
  editingRuleId,
  errors,
  previewDate,
  previewResult,
  previewLoading,
  previewUpdatedAt,
  previewError,
  previewHistory,
  onUpdate,
  onSave,
  onCancelEdit,
  onEdit,
  onDelete,
  onToggle,
  onRun,
  onPreviewDateChange,
  onPreview,
  onUsePreviewHistoryDate,
  onClearPreview,
  onClearPreviewHistory,
  onInfo,
}: {
  ruleForm: RuleForm;
  rules: AutomationRule[];
  templates: Template[];
  catalogs: Catalogos;
  busy: boolean;
  editingRuleId: number | null;
  errors: Record<string, string>;
  previewDate: string;
  previewResult: AutomationPreviewResult | null;
  previewLoading: boolean;
  previewUpdatedAt: string | null;
  previewError: string | null;
  previewHistory: AutomationPreviewHistoryItem[];
  onUpdate: <K extends keyof RuleForm>(key: K, value: RuleForm[K]) => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
  onCancelEdit: () => void;
  onEdit: (rule: AutomationRule) => void;
  onDelete: (ruleId: number) => void;
  onToggle: (rule: AutomationRule) => void;
  onRun: () => void;
  onPreviewDateChange: (value: string) => void;
  onPreview: () => void;
  onUsePreviewHistoryDate: (value: string) => void;
  onClearPreview: () => void;
  onClearPreviewHistory: () => void;
  onInfo: (info: CobranzaInfoContent) => void;
}) {
  void ruleForm;
  void catalogs;
  void editingRuleId;
  void errors;
  void onUpdate;
  void onSave;
  void onCancelEdit;
  void onEdit;
  void onDelete;
  const templateById = new Map(templates.map((template) => [template.id, template]));
  const previewRules = previewResult?.reglas ?? [];
  const previewRulesWithCandidates = previewRules.filter(
    (rule) => rule.candidatos > 0,
  ).length;
  const previewErrorCount =
    previewResult?.errores?.length ??
    previewRules.filter((rule) => Boolean(rule.error)).length;
  const previewUpdatedLabel = previewUpdatedAt
    ? new Intl.DateTimeFormat("es-MX", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).format(new Date(previewUpdatedAt))
    : null;
  return (
    <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
      <section className="page-section">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="section-title-compact">Reglas de cobranza automatica</h2>
              <CobranzaInfoButton info={cobranzaTabInfo.automatizacion} onOpen={onInfo} />
            </div>
            <p className="mt-2 section-copy-compact">
              Activa o pausa recordatorios por etapa. Cada switch usa una
              plantilla definida; si Meta no la ha aprobado, mantenlo apagado
              hasta sincronizar estados en Preparacion.
            </p>
          </div>
          <button
            type="button"
            onClick={onRun}
            disabled={busy}
            className="rounded-2xl border border-cyan-400/25 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:border-cyan-300/50 disabled:opacity-60"
          >
            Ejecutar revision ahora
          </button>
        </div>
        <div className="mt-5 space-y-3">
          {rules.map((rule) => {
            const template = templateById.get(rule.plantilla_id);
            const templateStatus =
              template?.whatsapp_template_status || "NO_CONFIGURADA";
            const templateApproved = isApprovedWhatsappTemplate(template);
            const whatsappBlocked = channelUsesWhatsapp(rule.canal) && !templateApproved;
            return (
              <div
                key={rule.id}
                className="rounded-2xl border border-white/10 bg-zinc-950/70 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-white">{rule.nombre}</p>
                    <p className="mt-1 text-sm text-zinc-500">
                      {rule.plantilla_nombre} | {rule.canal} |{" "}
                      {rule.entidad_nombre || "Todas las entidades"}
                    </p>
                  </div>
                  <label
                    className={`inline-flex items-center gap-3 rounded-2xl border border-white/10 bg-zinc-900/70 px-3 py-2 ${
                      whatsappBlocked
                        ? "cursor-not-allowed opacity-60"
                        : "cursor-pointer"
                    }`}
                    title={
                      whatsappBlocked
                        ? "Sincroniza Meta o espera la aprobacion de esta plantilla para activar la regla."
                        : undefined
                    }
                  >
                    <span
                      className={`text-xs font-semibold ${
                        rule.activo
                          ? "text-emerald-200"
                          : whatsappBlocked
                            ? "text-amber-200"
                            : "text-zinc-400"
                      }`}
                    >
                      {rule.activo
                        ? "Activa"
                        : whatsappBlocked
                          ? "Bloqueada por Meta"
                          : "Pausada"}
                    </span>
                    <input
                      type="checkbox"
                      checked={rule.activo}
                      onChange={() => onToggle(rule)}
                      disabled={busy || whatsappBlocked}
                      className="h-5 w-5 rounded border-zinc-700 bg-zinc-950 text-emerald-500"
                    />
                  </label>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <span
                    className={`rounded-full border px-2.5 py-1 text-xs ${badgeClass(
                      templateStatus,
                    )}`}
                  >
                    Meta {statusLabel(templateStatus)}
                  </span>
                  <span className="rounded-full border border-cyan-400/20 bg-cyan-500/10 px-2.5 py-1 text-xs text-cyan-100">
                    {statusLabel(rule.segmento)}
                  </span>
                  {whatsappBlocked ? (
                    <span className="rounded-full border border-amber-400/20 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-100">
                      Esperando aprobacion
                    </span>
                  ) : null}
                </div>
                <div className="mt-3 grid gap-2 text-xs text-zinc-500 md:grid-cols-3">
                  <span>Evento: {statusLabel(rule.evento_base)}</span>
                  <span>Desfase: {rule.desplazamiento_dias} dia(s)</span>
                  <span>Canal: {rule.canal}</span>
                </div>
              </div>
            );
          })}
          {rules.length === 0 ? (
            <p className="rounded-2xl border border-white/10 bg-zinc-950/70 px-4 py-4 text-sm text-zinc-500">
              Aun no hay reglas configuradas para esta capa.
            </p>
          ) : null}
        </div>
      </section>

      <aside className="page-section">
        <div className="flex items-center gap-2">
          <h2 className="section-title-compact">Simulador sin envio</h2>
          <CobranzaInfoButton info={cobranzaTabInfo.automatizacion} onOpen={onInfo} />
        </div>
        <p className="mt-2 section-copy-compact">
          Prueba una fecha antes de activar una corrida real. Esta consulta solo
          calcula candidatos y muestras; no contacta clientes ni crea historial.
        </p>

        <div className="mt-5 space-y-3">
          <TextField
            label="Fecha de simulacion"
            value={previewDate}
            type="date"
            onChange={onPreviewDateChange}
            required
            info={cobranzaFieldInfo.fechaReferencia}
            onInfo={onInfo}
          />
          <button
            type="button"
            onClick={onPreview}
            disabled={busy || previewLoading}
            className="w-full rounded-2xl border border-emerald-400/25 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-100 transition hover:border-emerald-300/50 disabled:opacity-60"
          >
            {previewLoading
              ? "Simulando..."
              : previewResult
                ? "Recalcular simulacion"
                : "Simular sin enviar"}
          </button>
          {previewResult ? (
            <button
              type="button"
              onClick={onClearPreview}
              disabled={busy || previewLoading}
              className="w-full rounded-2xl border border-white/10 bg-zinc-950/70 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:border-white/25 disabled:opacity-60"
            >
              Limpiar resultado
            </button>
          ) : null}
        </div>

        <div
          className={`mt-5 rounded-2xl border px-4 py-3 text-sm ${
            previewLoading
              ? "border-cyan-400/25 bg-cyan-500/10 text-cyan-100"
              : previewError
                ? "border-rose-400/25 bg-rose-500/10 text-rose-100"
              : previewResult
                ? previewErrorCount
                  ? "border-amber-400/25 bg-amber-500/10 text-amber-100"
                  : "border-emerald-400/25 bg-emerald-500/10 text-emerald-100"
                : "border-white/10 bg-zinc-950/70 text-zinc-400"
          }`}
          aria-live="polite"
        >
          <p className="font-semibold">
            {previewLoading
              ? "Calculando simulacion..."
              : previewError
                ? "No se pudo completar la simulacion"
              : previewResult
                ? previewErrorCount
                  ? "Simulacion completada con alertas"
                  : "Simulacion completada"
                : "Sin simulacion activa"}
          </p>
          <p className="mt-1 text-xs opacity-80">
            {previewLoading
              ? "Estamos revisando reglas, segmentos y candidatos. No se esta enviando ningun mensaje."
              : previewError
                ? previewError
              : previewResult
                ? `No se envio ningun mensaje. Ultima simulacion: ${previewUpdatedLabel || "ahora"}. ${
                    previewErrorCount
                      ? `${previewErrorCount} regla(s) no pudieron calcularse.`
                      : ""
                  }`
                : "Elige una fecha y ejecuta una simulacion para ver el resultado aqui."}
          </p>
        </div>

        {previewResult ? (
          <div className="mt-5 space-y-4">
            <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
              <MetricCard
                label="Fecha"
                value={shortDate(previewResult.fecha_referencia)}
                helper="Referencia"
                tone="blue"
              />
              <MetricCard
                label="Reglas"
                value={`${previewRulesWithCandidates}/${previewResult.reglas_activas}`}
                helper="Con candidatos"
                tone={previewRulesWithCandidates ? "cyan" : "amber"}
              />
              <MetricCard
                label="Candidatos"
                value={String(previewResult.candidatos)}
                helper="Sin enviar"
                tone={previewResult.candidatos ? "emerald" : "amber"}
              />
            </div>

            <div className="space-y-3">
              {previewRules.map((rule) => (
                <div
                  key={rule.id}
                  className="rounded-2xl border border-white/10 bg-zinc-950/70 p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-white">{rule.nombre}</p>
                      <p className="mt-1 text-xs text-zinc-500">
                        {rule.plantilla_nombre} | {rule.canal} |{" "}
                        {statusLabel(rule.segmento)}
                      </p>
                    </div>
                    <span
                      className={`rounded-full border px-2.5 py-1 text-xs ${
                        rule.candidatos
                          ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-200"
                          : "border-zinc-600/40 bg-zinc-800/70 text-zinc-300"
                      }`}
                    >
                      {rule.candidatos} candidato(s)
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-zinc-500">
                    Evento {statusLabel(rule.evento_base)} con desfase{" "}
                    {rule.desplazamiento_dias} dia(s).
                  </p>
                  {rule.error ? (
                    <p className="mt-3 rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                      No se pudo calcular esta regla: {rule.error}
                    </p>
                  ) : null}
                  {!rule.error && !rule.candidatos ? (
                    <div className="mt-3 rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-3 text-xs text-amber-100">
                      <p className="font-semibold uppercase tracking-[0.22em] text-amber-200">
                        Sin candidatos para esta fecha
                      </p>
                      <p className="mt-2 leading-5">
                        {rule.motivo_sin_candidatos ||
                          "No hay cuentas que coincidan con esta regla en la fecha simulada."}
                      </p>
                      {rule.detalle_sin_candidatos ? (
                        <p className="mt-1 leading-5 text-amber-100/80">
                          {rule.detalle_sin_candidatos}
                        </p>
                      ) : null}
                      {rule.fecha_objetivo ? (
                        <p className="mt-2 text-amber-100/70">
                          Fecha objetivo: {shortDate(rule.fecha_objetivo)}
                          {typeof rule.cuentas_fecha_objetivo === "number"
                            ? ` | CxC en fecha: ${rule.cuentas_fecha_objetivo}`
                            : ""}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  {rule.muestras.length ? (
                    <div className="mt-3 space-y-2">
                      {rule.muestras.slice(0, 2).map((item) => (
                        <div
                          key={`${rule.id}-${item.cliente_id}-${item.segmento}`}
                          className="rounded-xl border border-white/8 bg-zinc-900/70 px-3 py-3"
                        >
                          <p className="text-sm font-medium text-white">
                            {item.cliente_nombre}
                          </p>
                          <p className="mt-1 text-xs text-zinc-500">
                            {item.entidad_nombre} | {item.canales.join(", ")} |{" "}
                            {money(item.total_exigible)}
                          </p>
                          <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-xs leading-5 text-zinc-400">
                            {item.mensaje}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
              {previewRules.length === 0 ? (
                <p className="rounded-2xl border border-white/10 bg-zinc-950/70 px-4 py-4 text-sm text-zinc-500">
                  No hay reglas activas para simular.
                </p>
              ) : null}
            </div>
          </div>
        ) : (
          <p className="mt-5 rounded-2xl border border-white/10 bg-zinc-950/70 px-4 py-4 text-sm text-zinc-500">
            Ejecuta una simulacion para ver que clientes entrarian por fecha,
            etapa y plantilla.
          </p>
        )}

        <div className="mt-5 rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-semibold text-white">Historial de simulaciones</p>
              <p className="mt-1 text-xs text-zinc-500">
                Ultimas {AUTOMATION_PREVIEW_HISTORY_LIMIT} consultas de este navegador.
              </p>
            </div>
            {previewHistory.length ? (
              <button
                type="button"
                onClick={onClearPreviewHistory}
                disabled={busy || previewLoading}
                className="rounded-xl border border-white/10 bg-zinc-900/70 px-3 py-1.5 text-xs font-semibold text-zinc-200 transition hover:border-white/25 disabled:opacity-60"
              >
                Limpiar
              </button>
            ) : null}
          </div>

          <div className="mt-4 space-y-2">
            {previewHistory.map((item) => {
              const timeLabel = new Intl.DateTimeFormat("es-MX", {
                hour: "2-digit",
                minute: "2-digit",
              }).format(new Date(item.generated_at));
              return (
                <div
                  key={item.id}
                  className="rounded-xl border border-white/8 bg-zinc-900/70 px-3 py-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-white">
                        {shortDate(item.fecha_referencia)}
                      </p>
                      <p className="mt-1 text-xs text-zinc-500">
                        {timeLabel} | {item.reglas_con_candidatos}/
                        {item.reglas_activas} regla(s) | {item.candidatos} candidato(s)
                      </p>
                    </div>
                    <span
                      className={`rounded-full border px-2.5 py-1 text-xs ${
                        item.errores
                          ? "border-amber-400/25 bg-amber-500/10 text-amber-200"
                          : "border-emerald-400/25 bg-emerald-500/10 text-emerald-200"
                      }`}
                    >
                      {item.errores ? `${item.errores} alerta(s)` : "OK"}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onUsePreviewHistoryDate(item.fecha_referencia)}
                    disabled={busy || previewLoading}
                    className="mt-3 rounded-xl border border-cyan-400/20 bg-cyan-500/10 px-3 py-1.5 text-xs font-semibold text-cyan-100 transition hover:border-cyan-300/50 disabled:opacity-60"
                  >
                    Usar fecha
                  </button>
                </div>
              );
            })}
            {previewHistory.length === 0 ? (
              <p className="rounded-xl border border-white/8 bg-zinc-900/70 px-3 py-3 text-sm text-zinc-500">
                Aun no hay simulaciones en este navegador.
              </p>
            ) : null}
          </div>
        </div>
      </aside>
    </section>
  );
}

function EvidenceTab({
  evidenceForm,
  evidences,
  catalogs,
  dashboard,
  evidenceFilters,
  busy,
  uploadBusy,
  processingEvidenceId,
  errors,
  onUpdate,
  onFiltersChange,
  onUploadFile,
  onSave,
  onClassify,
  onCorrect,
  onAnalyze,
  onApplyCxc,
  onInfo,
}: {
  evidenceForm: EvidenceForm;
  evidences: Evidence[];
  catalogs: Catalogos;
  dashboard: CxcDashboard | null;
  evidenceFilters: EvidenceFilters;
  busy: boolean;
  uploadBusy: boolean;
  processingEvidenceId?: number | null;
  errors: Record<string, string>;
  onUpdate: <K extends keyof EvidenceForm>(key: K, value: EvidenceForm[K]) => void;
  onFiltersChange: (filters: EvidenceFilters) => void;
  onUploadFile: (file: File) => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
  onClassify: (
    evidence: Evidence,
    action: "REVIEW" | "VALIDATE" | "APPLY" | "DISCARD",
  ) => void;
  onCorrect: (evidence: Evidence) => void;
  onAnalyze: (evidence: Evidence) => void;
  onApplyCxc: (evidence: Evidence, candidate: EvidenceCxcCandidate) => void;
  onInfo: (info: CobranzaInfoContent) => void;
}) {
  const [copiedEvidenceId, setCopiedEvidenceId] = useState<number | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [detailEvidence, setDetailEvidence] = useState<Evidence | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dashboardRows = dashboard?.items ?? [];
  const evidenceClientsForSelectedEntity = useMemo(() => {
    if (!evidenceForm.entidad_id) {
      return [];
    }
    return catalogs.clientes.filter(
      (client) => client.entidad_id === evidenceForm.entidad_id,
    );
  }, [catalogs.clientes, evidenceForm.entidad_id]);
  const portalCount = evidences.filter(
    (evidence) => evidenceSourceLabel(evidence) === "Portal cliente",
  ).length;
  const reviewCount = evidences.filter(
    (evidence) => evidence.requiere_revision_manual || evidence.estatus === "NUEVA",
  ).length;
  const appliedCount = evidences.filter(
    (evidence) => evidence.estatus === "APLICADA",
  ).length;
  const totalAmount = evidences.reduce(
    (sum, evidence) => sum + Number(evidence.monto_reportado || 0),
    0,
  );
  const filterError = validateEvidenceFilters(evidenceFilters);

  useEffect(() => {
    if (!detailEvidence) {
      return;
    }
    const currentEvidence = evidences.find((item) => item.id === detailEvidence.id);
    if (currentEvidence && currentEvidence !== detailEvidence) {
      setDetailEvidence(currentEvidence);
    }
  }, [detailEvidence, evidences]);

  const copyEvidenceReference = async (evidence: Evidence) => {
    const reference = evidence.referencia_reportada?.trim();
    if (!reference) {
      return;
    }
    try {
      await navigator.clipboard.writeText(reference);
      setCopiedEvidenceId(evidence.id);
      window.setTimeout(() => {
        setCopiedEvidenceId((current) => (current === evidence.id ? null : current));
      }, 1800);
    } catch {
      // Clipboard may be blocked by browser permissions; keep it in-app.
    }
  };
  const handleEvidenceFiles = (files: File[]) => {
    if (uploadBusy) {
      return;
    }
    const [file] = files;
    if (!file) {
      return;
    }
    onUploadFile(file);
  };
  const handleEvidenceFileSelection = (event: ChangeEvent<HTMLInputElement>) => {
    handleEvidenceFiles(Array.from(event.target.files || []));
    event.target.value = "";
  };
  const handleEvidenceDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
    handleEvidenceFiles(Array.from(event.dataTransfer.files || []));
  };

  return (
    <section className="grid gap-6 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
      <form
        onSubmit={onSave}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          handleEvidenceFiles(Array.from(event.dataTransfer.files || []));
        }}
        className="page-section space-y-5"
      >
        <div>
          <div className="flex items-center gap-2">
            <h2 className="section-title-compact">Registrar comprobante</h2>
            <CobranzaInfoButton info={cobranzaTabInfo.comprobantes} onOpen={onInfo} />
          </div>
          <p className="mt-2 section-copy-compact">
            Para captura manual: registra el enlace al archivo y deja trazabilidad
            del pago. Los comprobantes enviados desde el portal entran directo a
            la bandeja de la derecha.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <SelectField
            label="Unidad de negocio"
            value={evidenceForm.entidad_id ?? ""}
            onChange={(value) => {
              const entityId = parseSelectId(value);
              const selectedClient = catalogs.clientes.find(
                (client) => client.id === evidenceForm.cliente_id,
              );
              onUpdate("entidad_id", entityId);
              if (!entityId || selectedClient?.entidad_id !== entityId) {
                onUpdate("cliente_id", null);
              }
            }}
            required
            info={cobranzaFieldInfo.entidad}
            onInfo={onInfo}
            error={errors.entidad_id}
          >
            <option value="">Selecciona unidad</option>
            {catalogs.entidades.map((entity) => (
              <option key={entity.id} value={entity.id}>
                {entity.nombre}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Cliente / espacio"
            value={evidenceForm.cliente_id ?? ""}
            onChange={(value) => onUpdate("cliente_id", parseSelectId(value))}
            required
            info={cobranzaFieldInfo.cliente}
            onInfo={onInfo}
            error={errors.cliente_id}
            disabled={!evidenceForm.entidad_id}
          >
            <option value="">
              {evidenceForm.entidad_id
                ? "Selecciona cliente"
                : "Primero selecciona unidad"}
            </option>
            {evidenceClientsForSelectedEntity.map((client) => (
              <option key={client.id} value={client.id}>
                {clientCatalogLabel(client)}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Canal"
            value={evidenceForm.canal}
            onChange={(value) => onUpdate("canal", value)}
            required
            info={cobranzaFieldInfo.canal}
            onInfo={onInfo}
          >
            <option value="WHATSAPP">WhatsApp</option>
            <option value="EMAIL">Email</option>
            <option value="PORTAL">Portal</option>
            <option value="MANUAL">Manual</option>
          </SelectField>
          <TextField
            label="Monto reportado"
            value={evidenceForm.monto_reportado}
            type="text"
            inputMode="decimal"
            maxLength={13}
            placeholder="Ej. 2500.00"
            onChange={(value) => onUpdate("monto_reportado", cleanMoneyInput(value))}
            optional
            info={cobranzaFieldInfo.montoReportado}
            onInfo={onInfo}
            helper="Solo dinero positivo, hasta 2 decimales."
            error={errors.monto_reportado}
          />
          <TextField
            label="Fecha de pago"
            value={evidenceForm.fecha_pago_reportada}
            type="date"
            onChange={(value) => onUpdate("fecha_pago_reportada", value)}
            optional
            info={cobranzaFieldInfo.fechaPago}
            onInfo={onInfo}
            error={errors.fecha_pago_reportada}
          />
          <TextField
            label="Referencia"
            value={evidenceForm.referencia_reportada}
            maxLength={EVIDENCE_REFERENCE_MAX}
            onChange={(value) => onUpdate("referencia_reportada", cleanReference(value))}
            optional
            info={cobranzaFieldInfo.referencia}
            onInfo={onInfo}
            helper={`Maximo ${EVIDENCE_REFERENCE_MAX} caracteres.`}
            error={errors.referencia_reportada}
          />
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-zinc-100">
                  Archivo del comprobante
                </p>
                <CobranzaInfoButton
                  info={cobranzaFieldInfo.archivoComprobante}
                  onOpen={onInfo}
                />
              </div>
              <p className="mt-1 text-xs text-zinc-500">
                Imagen, screenshot o PDF. Maximo 15 MB.
              </p>
            </div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadBusy}
              className="rounded-xl border border-cyan-400/20 px-3 py-1.5 text-xs font-semibold text-cyan-100 transition hover:border-cyan-300/50 disabled:cursor-not-allowed disabled:opacity-45"
            >
              Elegir archivo
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept={EVIDENCE_FILE_ACCEPT}
            onChange={handleEvidenceFileSelection}
            className="hidden"
          />
          <div
            onDragEnter={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setDragActive(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setDragActive(true);
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setDragActive(false);
            }}
            onDrop={handleEvidenceDrop}
            className={`rounded-2xl border border-dashed px-4 py-7 text-center transition ${
              dragActive
                ? "border-cyan-300/60 bg-cyan-500/10"
                : "border-white/12 bg-zinc-950/70"
            }`}
          >
            <p className="text-sm font-semibold text-zinc-100">
              {uploadBusy ? "Subiendo y leyendo comprobante..." : "Arrastra el comprobante aqui"}
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              O usa el boton para seleccionar una imagen, screenshot o PDF.
            </p>
            {evidenceForm.url_archivo ? (
              <div className="mt-4 rounded-xl border border-emerald-400/15 bg-emerald-500/10 px-3 py-2 text-left text-xs text-emerald-100">
                Archivo cargado correctamente.
                {evidenceForm.hash_archivo ? (
                  <span className="ml-1 text-emerald-200/70">
                    Hash: {evidenceForm.hash_archivo.slice(0, 12)}...
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
        <TextField
          label="URL archivo manual"
          value={evidenceForm.url_archivo}
          placeholder="Se llena automaticamente al subir archivo"
          type="url"
          inputMode="url"
          maxLength={MESSAGE_MEDIA_URL_MAX}
          onChange={(value) => onUpdate("url_archivo", limitPlainText(value, MESSAGE_MEDIA_URL_MAX))}
          optional
          info={cobranzaFieldInfo.urlArchivo}
          onInfo={onInfo}
          helper="Respaldo tecnico: puedes pegar una URL directa si ya tienes el archivo hospedado."
          error={errors.url_archivo}
        />
        <TextareaField
          label="Texto extraido u observaciones del comprobante"
          value={evidenceForm.texto_extraido}
          onChange={(value) => onUpdate("texto_extraido", limitMultilineText(value, EVIDENCE_TEXT_MAX))}
          rows={5}
          maxLength={EVIDENCE_TEXT_MAX}
          optional
          info={cobranzaFieldInfo.textoExtraido}
          onInfo={onInfo}
          helper={`Maximo ${EVIDENCE_TEXT_MAX} caracteres.`}
          error={errors.texto_extraido}
        />
        <TextField
          label="Observaciones internas"
          value={evidenceForm.observaciones}
          maxLength={EVIDENCE_OBSERVATIONS_MAX}
          onChange={(value) => onUpdate("observaciones", limitPlainText(value, EVIDENCE_OBSERVATIONS_MAX))}
          optional
          info={cobranzaFieldInfo.observaciones}
          onInfo={onInfo}
          helper={`Maximo ${EVIDENCE_OBSERVATIONS_MAX} caracteres.`}
          error={errors.observaciones}
        />
        <button
          type="submit"
          disabled={busy || uploadBusy}
          className="rounded-2xl border border-emerald-400/25 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-100 transition hover:border-emerald-300/50 disabled:opacity-60"
        >
          Registrar comprobante
        </button>
      </form>

      <section className="page-section">
        <div className="flex flex-col gap-3 border-b border-white/8 pb-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="section-title-compact">Comprobantes recibidos</h2>
              <CobranzaInfoButton info={cobranzaFieldInfo.filtrosComprobantes} onOpen={onInfo} />
            </div>
            <p className="mt-2 section-copy-compact">
              Revisa origen, archivo, monto y estado antes de enviar a conciliacion.
            </p>
          </div>
          <span className="rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1 text-sm text-cyan-100">
            {evidences.length} registro(s)
          </span>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-4">
          <MetricCard
            label="Portal"
            value={String(portalCount)}
            helper="Enviados por cliente"
            tone="cyan"
          />
          <MetricCard
            label="Revision"
            value={String(reviewCount)}
            helper="Por validar"
            tone="amber"
          />
          <MetricCard
            label="Aplicados"
            value={String(appliedCount)}
            helper="Con pago ligado"
            tone="emerald"
          />
          <MetricCard
            label="Monto"
            value={money(totalAmount)}
            helper="Reportado reciente"
            tone="blue"
          />
        </div>
        <div className="mt-5 grid gap-3 lg:grid-cols-[1fr_0.45fr_0.45fr]">
          <TextField
            label="Buscar"
            value={evidenceFilters.search}
            placeholder="Cliente, referencia, cuenta o archivo"
            onChange={(value) =>
              onFiltersChange({
                ...evidenceFilters,
                search: limitPlainText(value, EVIDENCE_SEARCH_MAX),
              })
            }
            maxLength={EVIDENCE_SEARCH_MAX}
            info={cobranzaFieldInfo.filtrosComprobantes}
            onInfo={onInfo}
            error={filterError?.includes("Busqueda") ? filterError : undefined}
          />
          <SelectField
            label="Estado"
            value={evidenceFilters.status}
            onChange={(value) =>
              onFiltersChange({ ...evidenceFilters, status: value })
            }
            info={cobranzaFieldInfo.filtrosComprobantes}
            onInfo={onInfo}
          >
            <option value="PENDIENTES">Pendientes</option>
            <option value="TODOS">Todos</option>
            <option value="NUEVA">Nueva</option>
            <option value="VALIDADA">Validada</option>
            <option value="APLICADA">Aplicada</option>
            <option value="DESCARTADA">Descartada</option>
          </SelectField>
          <SelectField
            label="Origen"
            value={evidenceFilters.source}
            onChange={(value) =>
              onFiltersChange({ ...evidenceFilters, source: value })
            }
            info={cobranzaFieldInfo.filtrosComprobantes}
            onInfo={onInfo}
          >
            <option value="TODOS">Todos</option>
            <option value="PORTAL">Portal cliente</option>
            <option value="WHATSAPP">WhatsApp</option>
            <option value="MANUAL">Manual</option>
          </SelectField>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <TextField
            label="Desde"
            type="date"
            value={evidenceFilters.dateFrom}
            onChange={(value) =>
              onFiltersChange({ ...evidenceFilters, dateFrom: value })
            }
            optional
            info={cobranzaFieldInfo.filtrosComprobantes}
            onInfo={onInfo}
            error={filterError?.includes("Desde") ? filterError : undefined}
          />
          <TextField
            label="Hasta"
            type="date"
            value={evidenceFilters.dateTo}
            onChange={(value) =>
              onFiltersChange({ ...evidenceFilters, dateTo: value })
            }
            optional
            info={cobranzaFieldInfo.filtrosComprobantes}
            onInfo={onInfo}
            error={filterError?.includes("Hasta") || filterError?.includes("posterior") ? filterError : undefined}
          />
        </div>
        <div className="mt-3 text-xs text-zinc-500">
          Mostrando {Math.min(evidences.length, 100)} comprobante(s) filtrados por API.
        </div>
        <div className="mt-5 space-y-3">
          {evidences.map((evidence) => {
            const sourceLabel = evidenceSourceLabel(evidence);
            const isApplied = evidence.estatus === "APLICADA";
            const accountId = evidenceMetadataText(evidence, "cuenta_id");
            const fileName = evidenceMetadataText(evidence, "archivo_nombre");
            const duplicateState = evidence.duplicado_posible;
            const cxcCandidates = evidence.cxc_candidatas ?? [];
            const manualCxcCandidates =
              cxcCandidates.length > 0
                ? []
                : buildManualCxcCandidates(evidence, dashboardRows);
            const visibleCxcCandidates =
              cxcCandidates.length > 0 ? cxcCandidates : manualCxcCandidates;
            const showingManualCxcCandidates =
              cxcCandidates.length === 0 && manualCxcCandidates.length > 0;
            const aiReading = evidenceMetadataRecord(evidence, "lectura_ia");
            const canAnalyze = evidenceHasAnalysisInput(evidence);
            const canRequestAnalysis = evidenceCanRequestAnalysis(evidence);
            const isProcessing = processingEvidenceId === evidence.id;
            return (
              <div key={evidence.id} className="rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-white">
                        {evidence.cliente_nombre || "Cliente pendiente"}
                      </p>
                      <span className="rounded-full border border-cyan-400/20 bg-cyan-500/10 px-2.5 py-1 text-xs text-cyan-100">
                        {sourceLabel}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-zinc-500">
                      {evidence.entidad_nombre || "Sin entidad"} | Recibido{" "}
                      {shortDate(evidence.fecha_registro)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-white">
                      {evidence.monto_reportado ? money(evidence.monto_reportado) : "Sin monto"}
                    </p>
                    <span className={`mt-1 inline-flex rounded-full border px-2.5 py-1 text-xs ${badgeClass(evidence.estatus)}`}>
                      {statusLabel(evidence.estatus)}
                    </span>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 text-sm md:grid-cols-3">
                  <div className="rounded-xl border border-white/8 bg-black/20 p-3">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                      Fecha pago
                    </p>
                    <p className="mt-1 text-zinc-200">
                      {shortDate(evidence.fecha_pago_reportada)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/8 bg-black/20 p-3">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                      Referencia
                    </p>
                    <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <p className="break-all text-zinc-200">
                        {evidence.referencia_reportada || "Sin referencia"}
                      </p>
                      {evidence.referencia_reportada ? (
                        <button
                          type="button"
                          onClick={() => void copyEvidenceReference(evidence)}
                          className="shrink-0 rounded-lg border border-cyan-400/20 px-2.5 py-1 text-[11px] font-semibold text-cyan-100 transition hover:border-cyan-300/50"
                        >
                          {copiedEvidenceId === evidence.id ? "Copiada" : "Copiar"}
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <div className="rounded-xl border border-white/8 bg-black/20 p-3">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                      Cuenta CxC
                    </p>
                    <p className="mt-1 text-zinc-200">
                      {accountId ? `#${accountId}` : "Por definir"}
                    </p>
                  </div>
                </div>

                {aiReading ? (
                  <div className="mt-4 grid gap-3 text-sm md:grid-cols-3">
                    <div className="rounded-xl border border-violet-400/15 bg-violet-500/10 p-3">
                      <p className="text-[10px] uppercase tracking-[0.18em] text-violet-200/70">
                        Lectura IA/OCR
                      </p>
                      <p className="mt-1 font-semibold text-violet-100">
                        {String(aiReading.fuente || "reglas")}
                        {aiReading.modelo ? ` | ${String(aiReading.modelo)}` : ""}
                      </p>
                    </div>
                    <div className="rounded-xl border border-white/8 bg-black/20 p-3">
                      <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                        Confianza
                      </p>
                      <p className="mt-1 text-zinc-200">
                        {String(aiReading.confianza || evidence.confianza_clasificacion || 0)}%
                      </p>
                    </div>
                    <div className="rounded-xl border border-white/8 bg-black/20 p-3">
                      <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                        Revision
                      </p>
                      <p className="mt-1 text-zinc-200">
                        {aiReading.requiere_revision_manual ? "Humana requerida" : "Lista para validar"}
                      </p>
                    </div>
                  </div>
                ) : null}

                {isProcessing ? (
                  <div className="mt-4 flex items-center gap-3 rounded-xl border border-cyan-400/20 bg-cyan-500/10 px-3 py-3 text-sm text-cyan-100">
                    <span className="h-3 w-3 animate-pulse rounded-full bg-cyan-300 shadow-[0_0_18px_rgba(103,232,249,0.8)]" />
                    Google Vision OCR esta leyendo este comprobante. Las acciones se activaran al terminar.
                  </div>
                ) : null}

                {duplicateState?.posible ? (
                  <div className="mt-4 rounded-xl border border-amber-400/20 bg-amber-500/10 p-3 text-sm text-amber-100">
                    Posible duplicado con comprobante(s):{" "}
                    {duplicateState.evidencia_ids.join(", ")}. Motivos:{" "}
                    {duplicateState.motivos.join(", ")}.
                  </div>
                ) : null}

                {!isApplied && visibleCxcCandidates.length > 0 ? (
                  <div className="mt-4 rounded-xl border border-emerald-400/15 bg-emerald-500/5 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.18em] text-emerald-200/70">
                          {showingManualCxcCandidates
                            ? "CxC disponibles del cliente"
                            : "CxC sugerida"}
                        </p>
                        <p className="mt-1 text-sm text-zinc-400">
                          {showingManualCxcCandidates
                            ? "No hubo match automatico; elige manualmente la cuenta de este cliente."
                            : "Revisa la cuenta antes de aplicar el comprobante."}
                        </p>
                      </div>
                      <span className="rounded-full border border-emerald-400/20 px-2.5 py-1 text-xs text-emerald-100">
                        {visibleCxcCandidates.length} opcion(es)
                      </span>
                    </div>
                    <div className="mt-3 space-y-2">
                      {visibleCxcCandidates.map((candidate) => {
                        const amount = Number(evidence.monto_reportado || 0);
                        const candidateBalance = Number(candidate.saldo_pendiente || 0);
                        const partial = amount > 0 && amount < candidateBalance;
                        const overage = amount > candidateBalance;
                        const applyDisabled = busy || isProcessing || amount <= 0;
                        const periodMonth = candidatePeriodMonth(candidate);
                        const periodRange = candidatePeriodRange(candidate);
                        const conceptLabel = candidateConceptLabel(candidate);
                        return (
                          <div
                            key={`${evidence.id}-cxc-${candidate.id}`}
                            className="rounded-lg border border-white/8 bg-black/20 p-3"
                          >
                            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="text-sm font-semibold text-white">
                                    #{candidate.id} | {conceptLabel}
                                  </p>
                                  <span className="rounded-full border border-cyan-400/20 bg-cyan-500/10 px-2 py-0.5 text-[11px] font-semibold text-cyan-100">
                                    {periodMonth}
                                  </span>
                                </div>
                                <p className="mt-1 text-xs font-medium text-zinc-300">
                                  Periodo: {periodRange}
                                </p>
                                <p className="mt-1 text-xs text-zinc-500">
                                  Vence {shortDate(candidate.fecha_vencimiento)} | Saldo{" "}
                                  {money(candidate.saldo_pendiente)} |{" "}
                                  {statusLabel(candidate.estatus_adeudo)}
                                </p>
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  {candidate.motivos.map((reason) => (
                                    <span
                                      key={`${candidate.id}-${reason}`}
                                      className="rounded-full border border-cyan-400/20 bg-cyan-500/10 px-2 py-0.5 text-[11px] text-cyan-100"
                                    >
                                      {reason}
                                    </span>
                                  ))}
                                  {partial ? (
                                    <span className="rounded-full border border-amber-400/20 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-100">
                                      pago parcial
                                    </span>
                                  ) : null}
                                  {overage ? (
                                    <span className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-100">
                                      excedente automatico
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => onApplyCxc(evidence, candidate)}
                                disabled={applyDisabled}
                                title={amount <= 0 ? "Corrige o lee el monto antes de aplicar pago." : undefined}
                                className="rounded-xl border border-emerald-400/25 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-100 transition hover:border-emerald-300/50 disabled:cursor-not-allowed disabled:opacity-45"
                              >
                                Aplicar pago
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                {!isApplied &&
                visibleCxcCandidates.length === 0 &&
                Number(evidence.monto_reportado || 0) > 0 ? (
                  <div className="mt-4 rounded-xl border border-amber-400/20 bg-amber-500/10 p-3 text-sm text-amber-100">
                    {evidence.cliente_id
                      ? `Este comprobante tiene cliente y monto, pero no encontramos una CxC abierta para aplicar. Revisa que ${evidence.cliente_nombre || "el cliente"} tenga una cuenta por cobrar pendiente en Cartera CxC o genera el cargo antes de aplicar.`
                      : "Este comprobante tiene monto, pero falta seleccionar el cliente para buscar sus CxC abiertas."}
                  </div>
                ) : null}

                {evidence.trazabilidad ? (
                  <div className="mt-4 rounded-xl border border-white/8 bg-black/20 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                          Trazabilidad
                        </p>
                        <p className="mt-1 text-sm font-semibold text-white">
                          {evidenceTraceMeta(evidence)}
                        </p>
                      </div>
                      <span className={`rounded-full border px-2.5 py-1 text-xs ${badgeClass(evidence.trazabilidad.etapa_actual)}`}>
                        {statusLabel(evidence.trazabilidad.etapa_actual)}
                      </span>
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-4">
                      {evidence.trazabilidad.pasos.map((step) => (
                        <div
                          key={`${evidence.id}-${step.clave}`}
                          className={`rounded-lg border px-3 py-2 text-xs ${
                            step.completo
                              ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-100"
                              : "border-white/8 bg-zinc-950/60 text-zinc-500"
                          }`}
                        >
                          {statusLabel(step.clave)}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {fileName || evidence.observaciones || evidence.texto_extraido ? (
                  <div className="mt-3 rounded-xl border border-white/8 bg-black/20 p-3 text-sm text-zinc-400">
                    {fileName ? <p>Archivo: {fileName}</p> : null}
                    {evidence.observaciones ? <p>{evidence.observaciones}</p> : null}
                    {evidence.texto_extraido ? <p>{evidence.texto_extraido}</p> : null}
                  </div>
                ) : null}

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {evidence.url_archivo ? (
                    <a
                      href={evidence.url_archivo}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-xl border border-cyan-400/20 px-3 py-1.5 text-xs font-semibold text-cyan-100 transition hover:border-cyan-300/50"
                    >
                      Abrir archivo
                    </a>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setDetailEvidence(evidence)}
                    className="rounded-xl border border-white/10 px-3 py-1.5 text-xs font-semibold text-zinc-200 transition hover:border-white/25 hover:text-white"
                  >
                    Ver datos
                  </button>
                  <button
                    type="button"
                    onClick={() => onAnalyze(evidence)}
                    disabled={busy || !canRequestAnalysis || isProcessing}
                    title={
                      !canAnalyze
                        ? "Sube o registra un archivo antes de leer IA/OCR."
                        : !canRequestAnalysis
                          ? "Este comprobante ya no se puede reanalizar."
                          : undefined
                    }
                    className="rounded-xl border border-violet-400/20 px-3 py-1.5 text-xs font-semibold text-violet-100 transition hover:border-violet-300/50 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    {isProcessing ? "Leyendo..." : "Leer IA/OCR"}
                  </button>
                  <button
                    type="button"
                    onClick={() => onCorrect(evidence)}
                    disabled={busy || isApplied || isProcessing}
                    className="rounded-xl border border-amber-400/20 px-3 py-1.5 text-xs font-semibold text-amber-100 transition hover:border-amber-300/50 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    Corregir datos
                  </button>
                  <button
                    type="button"
                    onClick={() => onClassify(evidence, "REVIEW")}
                    disabled={isApplied || isProcessing}
                    className="rounded-xl border border-cyan-400/20 px-3 py-1.5 text-xs font-semibold text-cyan-100 transition hover:border-cyan-300/50 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    Enviar a conciliacion
                  </button>
                  <button
                    type="button"
                    onClick={() => onClassify(evidence, "VALIDATE")}
                    disabled={isApplied || isProcessing}
                    className="rounded-xl border border-blue-400/20 px-3 py-1.5 text-xs font-semibold text-blue-100 transition hover:border-blue-300/50 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    Validar sin aplicar
                  </button>
                  <button
                    type="button"
                    onClick={() => onClassify(evidence, "DISCARD")}
                    disabled={isApplied || isProcessing}
                    className="rounded-xl border border-rose-400/20 px-3 py-1.5 text-xs font-semibold text-rose-100 transition hover:border-rose-300/50 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    Descartar
                  </button>
                  {isApplied ? (
                    <span className="text-xs text-emerald-200">
                      Pago aplicado; conserva el archivo como soporte.
                    </span>
                  ) : !evidence.monto_reportado ? (
                    <span className="text-xs text-amber-200">
                      Corrige o lee el monto para habilitar aplicar pago.
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })}
          {evidences.length === 0 ? (
            <p className="rounded-2xl border border-white/10 bg-zinc-950/70 px-4 py-4 text-sm text-zinc-500">
              No hay comprobantes para los filtros seleccionados.
            </p>
          ) : null}
        </div>
      </section>
      <EvidenceDataModal
        evidence={detailEvidence}
        onClose={() => setDetailEvidence(null)}
      />
    </section>
  );
}

function EvidenceDataModal({
  evidence,
  onClose,
}: {
  evidence: Evidence | null;
  onClose: () => void;
}) {
  if (!evidence) {
    return null;
  }

  const aiReading = evidenceMetadataRecord(evidence, "lectura_ia");
  const metadata = metadataWithoutReading(evidence);
  const detectedReceiptRows = buildDetectedReceiptRows(evidence, aiReading);
  const summaryRows: Array<[string, unknown]> = [
    ["Cliente", evidence.cliente_nombre || "Cliente pendiente"],
    ["Entidad", evidence.entidad_nombre || "Sin entidad"],
    ["Origen", evidenceSourceLabel(evidence)],
    ["Estado", statusLabel(evidence.estatus)],
    ["Revision", evidence.requiere_revision_manual ? "Humana requerida" : "Lista para validar"],
    ["Fecha recibido", shortDate(evidence.fecha_registro)],
  ];
  const extractedRows: Array<[string, unknown]> = [
    ["Monto reportado", evidence.monto_reportado ? money(evidence.monto_reportado) : "Sin monto"],
    ["Fecha de pago", shortDate(evidence.fecha_pago_reportada)],
    ["Referencia", evidence.referencia_reportada || "Sin referencia"],
    ["Confianza", `${Number(evidence.confianza_clasificacion || 0).toFixed(2)}%`],
    ["Categoria", evidence.categoria_sugerida || "Sin categoria"],
    ["Cuenta CxC", evidenceMetadataText(evidence, "cuenta_id") || "Por definir"],
    ["Archivo", evidenceMetadataText(evidence, "archivo_nombre") || "Sin archivo registrado"],
  ];

  return (
    <div className="fixed inset-0 z-[180] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col rounded-3xl border border-cyan-400/20 bg-zinc-950 shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-6 py-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300">
              Comprobante recibido
            </p>
            <h3 className="mt-2 text-2xl font-bold text-white">
              Datos extraidos
            </h3>
            <p className="mt-2 text-sm text-zinc-400">
              Revisa lo que BetterP pudo leer antes de corregir, validar o aplicar el pago.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-300 transition hover:text-white"
          >
            Cerrar
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div className="grid gap-3 md:grid-cols-2">
            <DetailBlock title="Resumen" rows={summaryRows} />
            <DetailBlock title="Lectura principal" rows={extractedRows} />
          </div>

          <section className="mt-4 rounded-2xl border border-cyan-400/15 bg-cyan-500/10 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200/80">
              Datos detectados del comprobante
            </p>
            <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {detectedReceiptRows.map(([label, value]) => (
                <DetailValue key={label} label={label} value={value} />
              ))}
            </div>
          </section>

          {aiReading ? (
            <section className="mt-4 rounded-2xl border border-violet-400/15 bg-violet-500/10 p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-200/80">
                Resultado IA/OCR
              </p>
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {Object.entries(aiReading).map(([key, value]) => (
                  <DetailValue key={key} label={key} value={value} />
                ))}
              </div>
            </section>
          ) : (
            <section className="mt-4 rounded-2xl border border-violet-400/15 bg-violet-500/10 p-4 text-sm text-violet-100">
              Aun no hay lectura IA/OCR guardada para este comprobante.
            </section>
          )}

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <TextDetail title="Texto extraido" value={evidence.texto_extraido} />
            <TextDetail title="Observaciones" value={evidence.observaciones} />
          </div>

          <section className="mt-4 rounded-2xl border border-white/10 bg-black/25 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
              Metadata disponible
            </p>
            <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-xl border border-white/8 bg-zinc-950 p-3 text-xs leading-relaxed text-zinc-300">
              {Object.keys(metadata).length
                ? JSON.stringify(metadata, null, 2)
                : "Sin metadata adicional"}
            </pre>
          </section>
        </div>
      </div>
    </div>
  );
}

function DetailBlock({
  title,
  rows,
}: {
  title: string;
  rows: Array<[string, unknown]>;
}) {
  return (
    <section className="rounded-2xl border border-white/10 bg-zinc-900/60 p-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
        {title}
      </p>
      <div className="mt-3 grid gap-2">
        {rows.map(([label, value]) => (
          <DetailValue key={label} label={label} value={value} />
        ))}
      </div>
    </section>
  );
}

function DetailValue({ label, value }: { label: string; value: unknown }) {
  const rendered = displayDetailValue(value);
  const multiline = rendered.includes("\n");
  return (
    <div className="rounded-xl border border-white/8 bg-black/25 px-3 py-2">
      <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">
        {label.replaceAll("_", " ")}
      </p>
      <p className={`mt-1 text-sm text-zinc-200 ${multiline ? "whitespace-pre-wrap break-words" : "break-words"}`}>
        {rendered}
      </p>
    </div>
  );
}

function TextDetail({
  title,
  value,
}: {
  title: string;
  value?: string | null;
}) {
  return (
    <section className="rounded-2xl border border-white/10 bg-black/25 p-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
        {title}
      </p>
      <p className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">
        {value?.trim() || "Sin dato"}
      </p>
    </section>
  );
}

function CarteraTab({
  dashboard,
  onStartMessage,
  onStartBulkMessages,
  onInfo,
}: {
  dashboard: CxcDashboard | null;
  onStartMessage: (client: {
    cliente_id: number;
    entidad_id: number | null;
    segmento: string;
  }) => void;
  onStartBulkMessages: (rows: CxcRow[]) => void;
  onInfo: (info: CobranzaInfoContent) => void;
}) {
  const [followupFilter, setFollowupFilter] = useState<FollowupFilter>("TODAS");
  const [statusFilter, setStatusFilter] = useState<string>("TODOS");
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedRowIds, setSelectedRowIds] = useState<Set<number>>(new Set());
  const pageSize = 25;
  const allRows = dashboard?.items ?? [];
  const followupFilters: Array<{ key: FollowupFilter; label: string; count: number }> = [
    { key: "TODAS", label: "Todas", count: allRows.length },
    {
      key: "SIN_AVISO",
      label: "Sin aviso",
      count: allRows.filter((row) => rowMatchesFollowupFilter(row, "SIN_AVISO")).length,
    },
    {
      key: "REQUIERE_SEGUIMIENTO",
      label: "Seguimiento",
      count: allRows.filter((row) => rowMatchesFollowupFilter(row, "REQUIERE_SEGUIMIENTO")).length,
    },
    {
      key: "ERROR",
      label: "Error",
      count: allRows.filter((row) => rowMatchesFollowupFilter(row, "ERROR")).length,
    },
    {
      key: "OMITIDO",
      label: "Omitido",
      count: allRows.filter((row) => rowMatchesFollowupFilter(row, "OMITIDO")).length,
    },
    {
      key: "CUENTA_EXACTA",
      label: "Cuenta exacta",
      count: allRows.filter((row) => rowMatchesFollowupFilter(row, "CUENTA_EXACTA")).length,
    },
    {
      key: "CLIENTE",
      label: "Cliente",
      count: allRows.filter((row) => rowMatchesFollowupFilter(row, "CLIENTE")).length,
    },
  ];
  const statusFilters = [
    { key: "TODOS", label: "Todos", count: allRows.length },
    {
      key: "POR_VENCER",
      label: "Por vencer",
      count: allRows.filter((row) => row.categoria_tablero === "POR_VENCER").length,
    },
    {
      key: "EN_GRACIA",
      label: "En gracia",
      count: allRows.filter((row) => row.categoria_tablero === "EN_GRACIA").length,
    },
    {
      key: "VENCIDA_CON_RECARGO",
      label: "Vencidas",
      count: allRows.filter((row) => row.categoria_tablero === "VENCIDA_CON_RECARGO").length,
    },
  ];
  const rows = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return allRows.filter((row) => {
      if (!rowMatchesFollowupFilter(row, followupFilter)) return false;
      if (statusFilter !== "TODOS" && row.categoria_tablero !== statusFilter) return false;
      if (!query) return true;
      return [
        row.cliente_nombre,
        row.entidad_nombre,
        row.espacio_codigo || "",
        row.concepto,
        row.referencia_unica || "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [allRows, followupFilter, searchTerm, statusFilter]);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const pageStart = (currentPage - 1) * pageSize;
  const paginatedRows = rows.slice(pageStart, pageStart + pageSize);
  const selectedRows = rows.filter((row) => selectedRowIds.has(row.id));
  const selectedClientCount = new Set(selectedRows.map((row) => row.cliente_id)).size;
  const selectedTotal = selectedRows.reduce((sum, row) => sum + Number(row.total_a_pagar || 0), 0);
  const pageIds = paginatedRows.map((row) => row.id);
  const allPageSelected =
    pageIds.length > 0 && pageIds.every((rowId) => selectedRowIds.has(rowId));
  const firstBatchClientLimit = 10;
  const selectedRowsWithMissingDueDate = selectedRows.filter(
    (row) => !row.fecha_vencimiento,
  ).length;
  const selectedRowsWithoutBalance = selectedRows.filter(
    (row) => Number(row.total_a_pagar || 0) <= 0,
  ).length;
  const selectedRowsWithoutReference = selectedRows.filter(
    (row) => !String(row.referencia_unica || "").trim(),
  ).length;
  const selectedRowsLocked24h = selectedRows.filter((row) => {
    const lastSentAt = row.seguimiento_cobranza?.ultimo_envio?.fecha;
    return Boolean(lastSentAt && nextWhatsappContactLocked(lastSentAt));
  }).length;
  const selectedEntities = new Set(
    selectedRows
      .map((row) => row.entidad_id)
      .filter((id): id is number => typeof id === "number"),
  );
  const firstBatchOverLimit = selectedClientCount > firstBatchClientLimit;
  const firstBatchRecommendedLow =
    selectedClientCount > 0 && selectedClientCount < 5;
  const firstBatchHardBlock =
    selectedRows.length === 0 ||
    firstBatchOverLimit ||
    selectedRowsWithMissingDueDate > 0 ||
    selectedRowsWithoutBalance > 0 ||
    selectedRowsLocked24h > 0;
  const firstBatchChecklist = [
    {
      label: "Lote chico",
      ok: selectedClientCount > 0 && !firstBatchOverLimit,
      detail: `${selectedClientCount}/${firstBatchClientLimit} cliente(s) seleccionados.`,
      tone: firstBatchOverLimit ? "rose" : firstBatchRecommendedLow ? "amber" : "emerald",
    },
    {
      label: "Saldo revisable",
      ok: selectedRows.length > 0 && selectedRowsWithoutBalance === 0,
      detail:
        selectedRowsWithoutBalance === 0
          ? `${money(selectedTotal)} total seleccionado.`
          : `${selectedRowsWithoutBalance} cuenta(s) no tienen saldo pendiente.`,
      tone: selectedRowsWithoutBalance === 0 ? "emerald" : "rose",
    },
    {
      label: "Vencimiento definido",
      ok: selectedRows.length > 0 && selectedRowsWithMissingDueDate === 0,
      detail:
        selectedRowsWithMissingDueDate === 0
          ? "Todas las cuentas tienen fecha de vencimiento."
          : `${selectedRowsWithMissingDueDate} cuenta(s) no tienen fecha de vencimiento.`,
      tone: selectedRowsWithMissingDueDate === 0 ? "emerald" : "rose",
    },
    {
      label: "Regla 24 horas",
      ok: selectedRows.length > 0 && selectedRowsLocked24h === 0,
      detail:
        selectedRowsLocked24h === 0
          ? "No hay cuentas bloqueadas por contacto reciente."
          : `${selectedRowsLocked24h} cuenta(s) aun estan dentro del cooldown.`,
      tone: selectedRowsLocked24h === 0 ? "emerald" : "rose",
    },
    {
      label: "Referencia de pago",
      ok: selectedRows.length > 0 && selectedRowsWithoutReference === 0,
      detail:
        selectedRowsWithoutReference === 0
          ? "Todas las cuentas muestran referencia."
          : `${selectedRowsWithoutReference} cuenta(s) no muestran referencia; revisalas antes de enviar.`,
      tone: selectedRowsWithoutReference === 0 ? "emerald" : "amber",
    },
    {
      label: "Unidad de negocio",
      ok: selectedRows.length > 0,
      detail:
        selectedEntities.size <= 1
          ? "El lote pertenece a una sola unidad o no requiere separacion."
          : `${selectedEntities.size} unidades seleccionadas; conviene separar por operacion.`,
      tone: selectedEntities.size <= 1 ? "emerald" : "amber",
    },
  ];

  useEffect(() => {
    setCurrentPage(1);
  }, [followupFilter, searchTerm, statusFilter]);

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages));
  }, [totalPages]);

  useEffect(() => {
    const validIds = new Set(allRows.map((row) => row.id));
    setSelectedRowIds((current) => {
      const next = new Set(Array.from(current).filter((rowId) => validIds.has(rowId)));
      return next.size === current.size ? current : next;
    });
  }, [allRows]);

  function toggleRowSelection(rowId: number) {
    setSelectedRowIds((current) => {
      const next = new Set(current);
      if (next.has(rowId)) {
        next.delete(rowId);
      } else {
        next.add(rowId);
      }
      return next;
    });
  }

  function togglePageSelection() {
    setSelectedRowIds((current) => {
      const next = new Set(current);
      if (allPageSelected) {
        pageIds.forEach((rowId) => next.delete(rowId));
      } else {
        pageIds.forEach((rowId) => next.add(rowId));
      }
      return next;
    });
  }

  return (
    <section className="space-y-6">
      <div className="page-section">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="section-title-compact">Bandeja de seguimiento</h2>
              <CobranzaInfoButton info={cobranzaTabInfo.cartera} onOpen={onInfo} />
            </div>
            <p className="mt-2 section-copy-compact">
              Filtra la cartera por estado de aviso para priorizar la accion operativa.
            </p>
          </div>
          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-zinc-300">
            {rows.length} de {allRows.length} cuenta(s)
          </span>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          {followupFilters.map((item) => {
            const active = followupFilter === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setFollowupFilter(item.key)}
                className={`rounded-2xl border px-3 py-2 text-xs font-semibold transition ${
                  active
                    ? "border-cyan-400/35 bg-cyan-500/15 text-cyan-100"
                    : "border-white/10 bg-zinc-950/70 text-zinc-400 hover:border-zinc-600 hover:text-zinc-100"
                }`}
              >
                {item.label} - {item.count}
              </button>
            );
          })}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {statusFilters.map((item) => {
            const active = statusFilter === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setStatusFilter(item.key)}
                className={`rounded-2xl border px-3 py-2 text-xs font-semibold transition ${
                  active
                    ? "border-emerald-400/35 bg-emerald-500/15 text-emerald-100"
                    : "border-white/10 bg-zinc-950/70 text-zinc-400 hover:border-zinc-600 hover:text-zinc-100"
                }`}
              >
                {item.label} - {item.count}
              </button>
            );
          })}
        </div>
        <div className="mt-5">
          <TextField
            label="Buscar"
            value={searchTerm}
            onChange={(value) => setSearchTerm(limitPlainText(value, EVIDENCE_SEARCH_MAX))}
            placeholder="Cliente, entidad, espacio, concepto o referencia"
            maxLength={EVIDENCE_SEARCH_MAX}
            info={cobranzaFieldInfo.carteraFiltros}
            onInfo={onInfo}
          />
        </div>
      </div>

      <div className="page-section">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="section-title-compact">Cartera CxC abierta</h2>
              <CobranzaInfoButton info={cobranzaFieldInfo.carteraFiltros} onOpen={onInfo} />
            </div>
            <p className="mt-2 section-copy-compact">
              Selecciona una o varias cuentas para preparar avisos de cobranza en lote.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {selectedRows.length > 0 ? (
              <span className="rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1 text-sm text-cyan-100">
                {selectedRows.length} cuenta(s) - {selectedClientCount} cliente(s) - {money(selectedTotal)}
              </span>
            ) : null}
            <button
              type="button"
              disabled={firstBatchHardBlock}
              onClick={() => onStartBulkMessages(selectedRows)}
              className="rounded-xl border border-cyan-400/20 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-100 transition hover:border-cyan-300/50 hover:bg-cyan-500/20 disabled:opacity-50"
            >
              Preparar primer lote
            </button>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-zinc-300">
              {rows.length} registros
            </span>
          </div>
        </div>

        {selectedRows.length > 0 ? (
          <div className="mt-5 rounded-2xl border border-cyan-400/20 bg-cyan-500/10 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-cyan-100">
                  Revision de primer lote controlado
                </p>
                <p className="mt-1 text-xs leading-5 text-zinc-400">
                  Antes de pasar a Mensajes, confirma que el lote sea chico,
                  cobrable y sin contacto reciente. Telefono y consentimiento se
                  revisan en la vista previa antes del envio final.
                </p>
              </div>
              <span
                className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                  firstBatchHardBlock
                    ? "border-amber-400/25 bg-amber-500/10 text-amber-200"
                    : "border-emerald-400/25 bg-emerald-500/10 text-emerald-200"
                }`}
              >
                {firstBatchHardBlock ? "Revisar antes de preparar" : "Listo para preparar"}
              </span>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {firstBatchChecklist.map((item) => {
                const toneClass =
                  item.tone === "emerald"
                    ? "border-emerald-400/20 bg-emerald-500/10"
                    : item.tone === "rose"
                      ? "border-rose-400/20 bg-rose-500/10"
                      : "border-amber-400/20 bg-amber-500/10";
                const badgeClassName =
                  item.tone === "emerald"
                    ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-200"
                    : item.tone === "rose"
                      ? "border-rose-400/25 bg-rose-500/10 text-rose-200"
                      : "border-amber-400/25 bg-amber-500/10 text-amber-200";
                return (
                  <div
                    key={item.label}
                    className={`rounded-2xl border p-3 ${toneClass}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-semibold text-white">{item.label}</p>
                      <span
                        className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${badgeClassName}`}
                      >
                        {item.ok ? "OK" : "Atencion"}
                      </span>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-zinc-400">
                      {item.detail}
                    </p>
                  </div>
                );
              })}
            </div>
            {firstBatchRecommendedLow && !firstBatchOverLimit ? (
              <p className="mt-3 rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-100">
                Este lote tiene menos de 5 clientes. Sirve para una prueba real
                muy controlada; para piloto comercial normal usa entre 5 y 10.
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="mt-6 overflow-x-auto rounded-2xl border border-white/10">
          <table className="w-full min-w-[1120px] text-left text-sm">
            <thead className="border-b border-white/10 bg-zinc-950/80 text-xs uppercase tracking-[0.18em] text-zinc-500">
              <tr>
                <th className="w-12 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={allPageSelected}
                    onChange={togglePageSelection}
                    aria-label="Seleccionar pagina"
                    className="h-4 w-4 rounded border-white/20 bg-zinc-950 text-cyan-400"
                  />
                </th>
                <th className="px-4 py-3">Cliente</th>
                <th className="px-4 py-3">Vencimiento</th>
                <th className="px-4 py-3">Seguimiento</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3 text-right">Accion</th>
              </tr>
            </thead>
            <tbody>
              {paginatedRows.map((row) => (
                <tr key={row.id} className="border-b border-white/6 last:border-b-0">
                  <td className="px-4 py-4 align-top">
                    <input
                      type="checkbox"
                      checked={selectedRowIds.has(row.id)}
                      onChange={() => toggleRowSelection(row.id)}
                      aria-label={`Seleccionar ${row.cliente_nombre}`}
                      className="h-4 w-4 rounded border-white/20 bg-zinc-950 text-cyan-400"
                    />
                  </td>
                  <td className="px-4 py-4 align-top">
                    <p className="font-semibold text-white">
                      {compactClientName(row.cliente_nombre)}
                    </p>
                    <p className="mt-1 text-xs text-zinc-500">
                      {row.entidad_nombre} | {row.espacio_codigo || row.concepto}
                    </p>
                    {row.referencia_unica ? (
                      <p className="mt-1 text-xs text-zinc-600">
                        Ref. {row.referencia_unica}
                      </p>
                    ) : null}
                    <span className={`mt-2 inline-flex rounded-full border px-2 py-0.5 text-[11px] ${followupLinkClass(row.seguimiento_cobranza?.vinculo)}`}>
                      {followupLinkLabel(row.seguimiento_cobranza?.vinculo)}
                    </span>
                  </td>
                  <td className="px-4 py-4 align-top text-zinc-400">
                    <p>{shortDate(row.fecha_vencimiento)}</p>
                    <p className="mt-1 text-xs text-zinc-500">
                      {row.dias_atraso > 0 ? `${row.dias_atraso} dia(s) atraso` : "Sin atraso"}
                    </p>
                  </td>
                  <td className="px-4 py-4 align-top">
                    <span className={`rounded-full border px-2.5 py-1 text-xs ${badgeClass(row.seguimiento_cobranza?.estado || "SIN_AVISO")}`}>
                      {statusLabel(row.seguimiento_cobranza?.estado || "SIN_AVISO")}
                    </span>
                    <p className="mt-2 max-w-xs text-xs leading-5 text-zinc-400">
                      {row.seguimiento_cobranza?.accion || "Preparar primer aviso de cobranza."}
                    </p>
                    <p className="mt-1 text-xs text-zinc-500">
                      {row.seguimiento_cobranza?.ultimo_envio
                        ? `Ultimo: ${shortDate(row.seguimiento_cobranza.ultimo_envio.fecha)} - ${statusLabel(row.seguimiento_cobranza.ultimo_envio.estatus)}`
                        : "Sin aviso registrado"}
                    </p>
                    {row.seguimiento_cobranza?.ultimo_envio ? (
                      <p
                        className={`mt-1 text-xs ${
                          nextWhatsappContactLocked(
                            row.seguimiento_cobranza.ultimo_envio.fecha,
                          )
                            ? "text-amber-300"
                            : "text-emerald-300"
                        }`}
                      >
                        {nextWhatsappContactLabel(
                          row.seguimiento_cobranza.ultimo_envio.fecha,
                        )}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-4 py-4 align-top">
                    <span className={`rounded-full border px-2.5 py-1 text-xs ${badgeClass(row.categoria_tablero)}`}>
                      {statusLabel(row.categoria_tablero)}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-right align-top font-semibold text-zinc-100">
                    {money(row.total_a_pagar)}
                  </td>
                  <td className="px-4 py-4 text-right align-top">
                    <button
                      type="button"
                      onClick={() =>
                        onStartMessage({
                          cliente_id: row.cliente_id,
                          entidad_id: row.entidad_id,
                          segmento: row.categoria_tablero,
                        })
                      }
                      className="rounded-xl border border-cyan-400/20 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-100 transition hover:border-cyan-300/50 hover:bg-cyan-500/20"
                    >
                      Preparar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {paginatedRows.length === 0 ? (
            <p className="px-4 py-5 text-sm text-zinc-500">
              No hay cuentas abiertas con los filtros actuales.
            </p>
          ) : null}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-zinc-400">
          <span>
            Mostrando {rows.length === 0 ? 0 : pageStart + 1}-
            {Math.min(pageStart + paginatedRows.length, rows.length)} de {rows.length}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
              className="rounded-xl border border-white/10 bg-zinc-950/70 px-3 py-2 text-xs font-semibold text-zinc-200 transition hover:border-zinc-600 disabled:opacity-50"
            >
              Anterior
            </button>
            <span className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-zinc-300">
              Pagina {currentPage} de {totalPages}
            </span>
            <button
              type="button"
              disabled={currentPage >= totalPages}
              onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
              className="rounded-xl border border-white/10 bg-zinc-950/70 px-3 py-2 text-xs font-semibold text-zinc-200 transition hover:border-zinc-600 disabled:opacity-50"
            >
              Siguiente
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function RulesGuideTab({
  templates,
  rules,
  monitoring,
  whatsappAgreement,
  dashboard,
  evidences,
  history,
  busy,
  onSelectTab,
  onCloseOnboarding,
  onReopenOnboarding,
  onInfo,
}: {
  templates: Template[];
  rules: AutomationRule[];
  monitoring: AutomationMonitoring | null;
  whatsappAgreement: WhatsappAgreementState | null;
  dashboard: CxcDashboard | null;
  evidences: Evidence[];
  history: HistoryItem[];
  busy: boolean;
  onSelectTab: (tab: TabId) => void;
  onCloseOnboarding: (payload: CobranzaOnboardingClosePayload) => void;
  onReopenOnboarding: () => void;
  onInfo: (info: CobranzaInfoContent) => void;
}) {
  type OnboardingStep = {
    title: string;
    timing: string;
    text: string;
    targetTab: TabId;
    evidence: string;
    checklist: string[];
    ok: boolean;
    blockers: string[];
  };
  type PilotStep = {
    title: string;
    detail: string;
    ok: boolean;
    targetTab: TabId;
    tone: "emerald" | "amber" | "rose" | "cyan";
  };

  const [step, setStep] = useState(0);

  const whatsappTemplates = templates.filter(isMetaWhatsappTemplate);
  const collectionTemplates = whatsappTemplates.filter((template) =>
    ["RECORDATORIO_PAGO", "AVISO_INTERES"].includes(template.tipo_plantilla),
  );
  const approvedCollectionTemplates = collectionTemplates.filter(
    (template) => template.whatsapp_template_status === "APROBADA",
  );
  const pendingCollectionTemplates = collectionTemplates.filter(
    (template) => template.whatsapp_template_status !== "APROBADA",
  );
  const whatsappTemplateTotal =
    monitoring?.plantillas?.whatsapp_total ?? collectionTemplates.length;
  const approvedTemplateTotal =
    monitoring?.plantillas?.whatsapp_aprobadas ?? approvedCollectionTemplates.length;
  const pendingTemplateTotal =
    monitoring?.plantillas?.whatsapp_pendientes ?? pendingCollectionTemplates.length;
  const activeWhatsappRules = rules.filter(
    (rule) => rule.activo && channelUsesWhatsapp(rule.canal),
  );
  const blockedRules =
    monitoring?.reglas?.whatsapp_bloqueadas ??
    activeWhatsappRules
      .map((rule) => {
        const template = templates.find((item) => item.id === rule.plantilla_id);
        if (isApprovedWhatsappTemplate(template)) {
          return null;
        }
        return {
          id: rule.id,
          nombre: rule.nombre,
          plantilla_nombre: rule.plantilla_nombre,
          plantilla_estado: template?.whatsapp_template_status || "NO_CONFIGURADA",
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
  const safeMode = monitoring?.modo_seguro;
  const lab = safeMode?.laboratorio_cobranza;
  const agreementOk =
    !whatsappAgreement?.required || Boolean(whatsappAgreement?.accepted);
  const templatesReady = whatsappTemplateTotal > 0 && pendingTemplateTotal === 0;
  const rulesReady = activeWhatsappRules.length > 0 && blockedRules.length === 0;
  const sandboxReady = Boolean(
    safeMode?.solo_numeros_whatsapp_permitidos &&
      safeMode?.numeros_whatsapp_permitidos?.length,
  );
  const labReady = Boolean(lab?.habilitado);
  const manualTestSent = history.some(
    (item) => item.estatus === "ENVIADO" && channelUsesWhatsapp(item.canal),
  );
  const cxcRows = dashboard?.items ?? [];
  const openAccounts = dashboard?.metricas.totales.cuentas_abiertas ?? cxcRows.length;
  const carteraReady = cxcRows.length > 0 || openAccounts > 0;
  const evidenceReviewed = evidences.some((evidence) =>
    ["VALIDADA", "APLICADA", "CONCILIADA"].includes(evidence.estatus),
  );
  const evidencePending = evidences.some((evidence) =>
    ["NUEVA", "REVISION", "POR_REVISAR"].includes(evidence.estatus),
  );
  const demoReferencePrefixes = ["BETT-META-VIDEO", "BETT-DEMO"];
  const demoCxcs = cxcRows.filter((row) => {
    const reference = (row.referencia_unica || "").toUpperCase();
    const concept = (row.concepto || "").toUpperCase();
    return (
      demoReferencePrefixes.some((prefix) => reference.startsWith(prefix)) ||
      concept.includes("DEMO") ||
      concept.includes("META")
    );
  });
  const allowedNumberSet = buildWhatsappAllowlistSet(
    safeMode?.numeros_whatsapp_permitidos ?? [],
  );
  const whatsappSentHistory = history.filter(
    (item) => item.estatus === "ENVIADO" && channelUsesWhatsapp(item.canal),
  );
  const labHistory = history.filter((item) =>
    metadataBoolean(item.metadata, "laboratorio_cobranza"),
  );
  const unsafeWhatsappSends = safeMode?.solo_numeros_whatsapp_permitidos
    ? whatsappSentHistory.filter(
        (item) =>
          item.destinatario &&
          !isWhatsappDestinationAllowed(item.destinatario, allowedNumberSet),
      )
    : [];
  const noUnsafeWhatsappSends = Boolean(
    safeMode?.solo_numeros_whatsapp_permitidos && unsafeWhatsappSends.length === 0,
  );
  const demoClientReady = Boolean(labReady && sandboxReady && (labHistory.length || demoCxcs.length));
  const historyTemplateText = (item: HistoryItem) => {
    const metadata = item.metadata || {};
    return [
      metadataString(metadata, "plantilla_meta"),
      metadataString(metadata, "whatsapp_template_name"),
      metadataString(metadata, "template_name"),
      item.plantilla_nombre || "",
    ]
      .join(" ")
      .toLowerCase();
  };
  const hasSentTemplate = (needles: string[], exclusions: string[] = []) =>
    whatsappSentHistory.some((item) => {
      const templateText = historyTemplateText(item);
      return (
        needles.some((needle) => templateText.includes(needle)) &&
        !exclusions.some((needle) => templateText.includes(needle))
      );
    });
  const preventivoSent = hasSentTemplate(["preventivo", "antes de vencimiento"]);
  const venceHoySent = hasSentTemplate(
    ["vence_hoy", "vence hoy", "dia de vencimiento"],
    ["antes de vencimiento"],
  );
  const graciaSent = hasSentTemplate(["gracia"]);
  const atrasoSent = hasSentTemplate(["atraso"]);
  const uploadedEvidence = evidences.some(
    (evidence) => Boolean(evidence.url_archivo) || Boolean(evidence.texto_extraido),
  );
  const appliedEvidence = evidences.some(
    (evidence) =>
      ["APLICADA", "CONCILIADA"].includes(evidence.estatus) ||
      (evidence.trazabilidad?.pagos.activos ?? 0) > 0,
  );
  const invoicedTotal = dashboard?.metricas.totales.facturado ?? 0;
  const portalInvoiceTested = invoicedTotal > 0;
  const reviewableHistoryCount = history.length;
  const reviewedHistoryCount = history.filter(
    (item) => Boolean(historyReviewInfo(item)),
  ).length;
  const historyReviewed =
    reviewableHistoryCount > 0 && reviewedHistoryCount === reviewableHistoryCount;
  const pilotSteps: PilotStep[] = [
    {
      title: "Cliente demo con numero seguro",
      ok: demoClientReady,
      targetTab: "preparacion",
      tone: demoClientReady ? "emerald" : "amber",
      detail: demoClientReady
        ? "Laboratorio, allowlist y evidencia demo detectados para Maya Coliving."
        : "Prepara el demo Meta o confirma que el numero permitido este ligado a Maya.",
    },
    {
      title: "3-5 CxC demo por fecha",
      ok: demoCxcs.length >= 3,
      targetTab: "cartera",
      tone: demoCxcs.length >= 3 ? "emerald" : "amber",
      detail: `${demoCxcs.length} cuenta(s) demo detectada(s) en la cartera visible.`,
    },
    {
      title: "Preventivo probado",
      ok: preventivoSent,
      targetTab: "mensajes",
      tone: preventivoSent ? "emerald" : "amber",
      detail: preventivoSent
        ? "Hay envio WhatsApp registrado con plantilla preventiva."
        : "Envia o registra una prueba segura de la plantilla preventiva.",
    },
    {
      title: "Vence hoy probado",
      ok: venceHoySent,
      targetTab: "mensajes",
      tone: venceHoySent ? "emerald" : "amber",
      detail: venceHoySent
        ? "Hay envio WhatsApp registrado para dia de vencimiento."
        : "Envia una prueba segura de pago vence hoy.",
    },
    {
      title: "Gracia probada",
      ok: graciaSent,
      targetTab: "mensajes",
      tone: graciaSent ? "emerald" : "amber",
      detail: graciaSent
        ? "Hay envio WhatsApp registrado para periodo de gracia."
        : "Valida la plantilla de gracia con una cuenta dentro de su ventana.",
    },
    {
      title: "Atraso probado",
      ok: atrasoSent,
      targetTab: "mensajes",
      tone: atrasoSent ? "emerald" : "amber",
      detail: atrasoSent
        ? "Hay envio WhatsApp registrado para atraso."
        : "Valida la plantilla de atraso solo con cuenta realmente vencida.",
    },
    {
      title: "Portal cliente probado",
      ok: manualTestSent && sandboxReady,
      targetTab: "mensajes",
      tone: manualTestSent && sandboxReady ? "emerald" : "amber",
      detail: manualTestSent
        ? "El link del portal ya se envio desde un flujo seguro."
        : "Falta enviar un link seguro y entrar al portal con OTP/consentimiento.",
    },
    {
      title: "Comprobante subido",
      ok: uploadedEvidence,
      targetTab: "comprobantes",
      tone: uploadedEvidence ? "emerald" : "amber",
      detail: uploadedEvidence
        ? "Hay comprobantes o lectura OCR/IA en la bandeja."
        : "Sube un comprobante desde portal o captura manual para validar OCR.",
    },
    {
      title: "Comprobante aplicado",
      ok: appliedEvidence,
      targetTab: "comprobantes",
      tone: appliedEvidence ? "emerald" : "amber",
      detail: appliedEvidence
        ? "Ya existe evidencia aplicada o conciliada contra CxC."
        : "Aplica un comprobante de prueba a una cuenta demo.",
    },
    {
      title: "Factura desde portal",
      ok: portalInvoiceTested,
      targetTab: "cartera",
      tone: portalInvoiceTested ? "emerald" : "amber",
      detail: portalInvoiceTested
        ? `La capa muestra ${money(invoicedTotal)} facturado en CxC.`
        : "Genera o verifica una factura desde el portal del cliente.",
    },
    {
      title: "Historial completo revisado",
      ok: historyReviewed,
      targetTab: "mensajes",
      tone: historyReviewed ? "emerald" : "amber",
      detail: historyReviewed
        ? `${reviewedHistoryCount}/${reviewableHistoryCount} registro(s) revisado(s).`
        : `${reviewedHistoryCount}/${reviewableHistoryCount} registro(s) revisado(s). Revisa ultimos envios, omitidos y errores antes de salir de laboratorio.`,
    },
    {
      title: "Sin envios reales accidentales",
      ok: noUnsafeWhatsappSends,
      targetTab: "preparacion",
      tone: noUnsafeWhatsappSends ? "emerald" : "rose",
      detail: noUnsafeWhatsappSends
        ? "El historial reciente no muestra WhatsApp enviado fuera de allowlist."
        : `${unsafeWhatsappSends.length} envio(s) requieren revision por destino fuera de allowlist.`,
    },
  ];
  const pilotComplete = pilotSteps.filter((item) => item.ok).length;
  const pilotProgress = Math.round((pilotComplete / pilotSteps.length) * 100);
  const releaseCronLastRun = monitoring?.cron?.last_run ?? null;
  const releaseCronLayerSummary = releaseCronLastRun?.layer_summary ?? {};
  const releaseCronMetadata = releaseCronLastRun?.metadata ?? {};
  const releaseCronMaxSends = metadataNumber(releaseCronMetadata, "max_envios");
  const releaseCronMaxPerLayer = metadataNumber(
    releaseCronMetadata,
    "max_envios_por_capa",
  );
  const releaseCronMinutesSinceLastRun = monitoring?.cron?.minutes_since_last_run ?? null;
  const releaseCronExpectedMinutes = (monitoring?.cron?.expected_hours ?? 30) * 60;
  const releaseCronFreshForLayer = Boolean(
    monitoring?.cron?.status === "OK" &&
      releaseCronLastRun?.includes_current_layer &&
      (releaseCronMinutesSinceLastRun === null ||
        releaseCronMinutesSinceLastRun <= releaseCronExpectedMinutes),
  );
  const releaseLowCronLimits = Boolean(
    releaseCronMaxSends !== null &&
      releaseCronMaxSends > 0 &&
      releaseCronMaxSends <= 10 &&
      releaseCronMaxPerLayer !== null &&
      releaseCronMaxPerLayer > 0 &&
      releaseCronMaxPerLayer <= 10,
  );
  const releaseCronDryRun =
    metadataBoolean(releaseCronLayerSummary, "dry_run") ||
    metadataBoolean(releaseCronMetadata, "dry_run");
  const releaseNoRecentErrors = (monitoring?.actividad?.errores_24h ?? 0) === 0;
  const releaseMachineSteps: PilotStep[] = [
    {
      title: "Piloto Maya validado",
      ok: pilotComplete === pilotSteps.length,
      targetTab: "reglas",
      tone: pilotComplete === pilotSteps.length ? "emerald" : "amber",
      detail: `${pilotComplete}/${pilotSteps.length} punto(s) del laboratorio completados antes de abrir clientes reales.`,
    },
    {
      title: "Plantillas y reglas listas",
      ok: templatesReady && rulesReady,
      targetTab: "preparacion",
      tone: templatesReady && rulesReady ? "emerald" : "amber",
      detail: `${approvedTemplateTotal}/${whatsappTemplateTotal} plantilla(s) aprobadas y ${blockedRules.length} regla(s) bloqueada(s).`,
    },
    {
      title: "Cron reciente para esta capa",
      ok: releaseCronFreshForLayer,
      targetTab: "preparacion",
      tone: releaseCronFreshForLayer ? "emerald" : "amber",
      detail: releaseCronLastRun
        ? `Ultima corrida ${dateTimeLabel(
            releaseCronLastRun.finished_at || releaseCronLastRun.started_at,
          )}; ${releaseCronLastRun.includes_current_layer ? "incluyo" : "no incluyo"} esta capa.`
        : "Aun no hay una corrida registrada para validar automatizacion real.",
    },
    {
      title: "Limite bajo por corrida",
      ok: releaseLowCronLimits && !releaseCronDryRun,
      targetTab: "preparacion",
      tone: releaseLowCronLimits && !releaseCronDryRun ? "emerald" : "amber",
      detail: `Limite actual: ${releaseCronMaxSends ?? "-"} envio(s) globales y ${
        releaseCronMaxPerLayer ?? "-"
      } por capa${releaseCronDryRun ? "; ultima corrida fue dry-run" : ""}.`,
    },
    {
      title: "Sin errores recientes",
      ok: releaseNoRecentErrors,
      targetTab: "mensajes",
      tone: releaseNoRecentErrors ? "emerald" : "rose",
      detail: `${monitoring?.actividad?.errores_24h ?? 0} error(es) en 24h y ${
        monitoring?.actividad?.errores_7d ?? 0
      } en 7 dias.`,
    },
    {
      title: "Candado de destinos activo",
      ok: labReady && sandboxReady && noUnsafeWhatsappSends,
      targetTab: "preparacion",
      tone: labReady && sandboxReady && noUnsafeWhatsappSends ? "emerald" : "rose",
      detail: sandboxReady
        ? `${safeMode?.numeros_whatsapp_permitidos?.length ?? 0} numero(s) permitidos; sin envios fuera de lista segura.`
        : "La allowlist debe seguir activa hasta escoger el lote real.",
    },
  ];
  const releaseMachineComplete = releaseMachineSteps.filter((item) => item.ok).length;
  const releaseMachineReady =
    releaseMachineComplete === releaseMachineSteps.length && releaseMachineSteps.length > 0;
  const releaseMachineProgress = Math.round(
    (releaseMachineComplete / releaseMachineSteps.length) * 100,
  );
  const releaseManualChecklist = [
    "Seleccionar maximo 5-10 clientes reales con saldo, telefono y consentimiento revisados.",
    "Confirmar periodo, fecha de corte, gracia y recargos antes de enviar.",
    "Mantener los limites bajos el primer dia y revisar cada mensaje antes de subir volumen.",
    "Monitorear respuestas, bajas, quejas y errores antes de ampliar el lote.",
  ];

  const onboarding: OnboardingStep[] = [
    {
      title: "Validar cartera CxC",
      timing: "Paso 1",
      targetTab: "cartera",
      ok: carteraReady,
      evidence: carteraReady
        ? `${openAccounts} cuenta(s) abiertas visibles para seguimiento.`
        : "Todavia no hay cartera disponible para operar cobranza.",
      text: "Revisa que saldos, periodos, espacios y referencias esten limpios antes de contactar clientes.",
      checklist: [
        "Revisar saldos abiertos",
        "Confirmar periodo mes/ano",
        "Identificar clientes sin aviso",
      ],
      blockers: carteraReady ? [] : ["Carga o depura la cartera CxC de la capa."],
    },
    {
      title: "Preparar permisos y zona segura",
      timing: "Paso 2",
      targetTab: "preparacion",
      ok: agreementOk && sandboxReady && labReady,
      evidence: agreementOk
        ? "Acuerdo cubierto; la zona segura controla pruebas y laboratorio."
        : "Falta acuerdo de uso para operar con el numero BetterP.",
      text: "Antes de abrir envios reales, confirma acuerdo, allowlist, laboratorio y bloqueo de edicion de plantillas.",
      checklist: [
        "Acuerdo aceptado",
        "Allowlist WhatsApp activa",
        "Laboratorio limitado a Maya Coliving",
      ],
      blockers: [
        ...(agreementOk ? [] : ["Aceptar acuerdo de uso WhatsApp."]),
        ...(sandboxReady ? [] : ["Configurar numero permitido de laboratorio."]),
        ...(labReady ? [] : ["Habilitar laboratorio seguro para la capa correcta."]),
      ],
    },
    {
      title: "Confirmar plantillas Meta",
      timing: "Paso 3",
      targetTab: "preparacion",
      ok: templatesReady,
      evidence: `${approvedTemplateTotal}/${whatsappTemplateTotal} plantilla(s) aprobadas; ${pendingTemplateTotal} pendiente(s).`,
      text: "Las reglas solo deben operar con plantillas aprobadas por Meta y administradas por BetterP.",
      checklist: [
        "Sincronizar Meta",
        "Ver 6/6 aprobadas",
        "Evitar texto libre del cliente",
      ],
      blockers: templatesReady
        ? []
        : ["Espera aprobacion Meta o sincroniza estados antes de activar envios."],
    },
    {
      title: "Probar envio manual",
      timing: "Paso 4",
      targetTab: "mensajes",
      ok: manualTestSent,
      evidence: manualTestSent
        ? "Ya existe al menos un envio WhatsApp registrado."
        : "Aun no hay evidencia de envio manual desde BetterP.",
      text: "Usa Mensajes para preparar una comunicacion asistida por plantilla y verificar que el destinatario correcto recibe el aviso.",
      checklist: ["Elegir cliente demo", "Previsualizar", "Confirmar recepcion"],
      blockers: manualTestSent
        ? []
        : ["Enviar una prueba segura al numero autorizado."],
    },
    {
      title: "Activar automatizacion controlada",
      timing: "Paso 5",
      targetTab: "automatizacion",
      ok: rulesReady && templatesReady,
      evidence: `${activeWhatsappRules.length} regla(s) WhatsApp activa(s); ${blockedRules.length} bloqueada(s).`,
      text: "Activa switches solo cuando la plantilla este aprobada, la etapa por fecha sea correcta y el cron este limitado.",
      checklist: ["Simular por fecha", "Revisar candidatos", "Mantener limites bajos"],
      blockers: [
        ...(activeWhatsappRules.length ? [] : ["Activa al menos una regla WhatsApp segura."]),
        ...(blockedRules.length ? ["Hay reglas detenidas por plantilla no aprobada."] : []),
      ],
    },
    {
      title: "Cerrar comprobantes y pagos",
      timing: "Paso 6",
      targetTab: "comprobantes",
      ok: evidenceReviewed || !evidencePending,
      evidence: evidenceReviewed
        ? "Ya hay comprobantes validados, aplicados o conciliados."
        : evidencePending
          ? "Hay comprobantes pendientes de revision."
          : "No hay comprobantes pendientes en la bandeja.",
      text: "Valida monto, fecha, referencia y cuenta CxC antes de aplicar pagos o conciliar saldos.",
      checklist: ["Leer IA/OCR", "Corregir datos", "Aplicar a CxC"],
      blockers: evidencePending && !evidenceReviewed
        ? ["Resolver comprobantes pendientes antes del piloto amplio."]
        : [],
    },
  ];

  const completeSteps = onboarding.filter((item) => item.ok).length;
  const progress = Math.round((completeSteps / onboarding.length) * 100);
  const current = onboarding[step] ?? onboarding[0];
  const criticalBlockers = onboarding.flatMap((item) => item.blockers);
  const readyForControlledPilot = criticalBlockers.length === 0;
  const onboardingState = monitoring?.onboarding;
  const reviewLabel = onboardingState?.closed_at
    ? dateTimeLabel(onboardingState.closed_at)
    : "Sin cierre registrado";
  const reviewOwner =
    onboardingState?.closed_by_name ||
    onboardingState?.closed_by_email ||
    "Sin responsable";
  const reopenLabel = onboardingState?.reopened_at
    ? `${dateTimeLabel(onboardingState.reopened_at)}${
        onboardingState.reopened_by_email
          ? ` por ${onboardingState.reopened_by_email}`
          : ""
      }`
    : null;

  function markReviewed() {
    onCloseOnboarding({
      progreso: progress,
      pasos_completos: completeSteps,
      pasos_totales: onboarding.length,
      bloqueantes: criticalBlockers,
      pasos: onboarding.map((item) => ({
        titulo: item.title,
        paso: item.timing,
        ok: item.ok,
        evidencia: item.evidence,
        bloqueantes: item.blockers,
        tab: item.targetTab,
      })),
    });
  }

  return (
    <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
      <div className="page-section">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="section-title-compact">Onboarding de cobranza</h2>
              <CobranzaInfoButton info={cobranzaTabInfo.reglas} onOpen={onInfo} />
            </div>
            <p className="mt-2 section-copy-compact">
              Guia viva para preparar una capa antes de abrir cobranza real. Los
              pasos se marcan con evidencia del sistema y mantienen visibles los
              bloqueantes operativos.
            </p>
          </div>
          <div className="rounded-2xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-3 text-right">
            <p className="text-xs uppercase tracking-[0.18em] text-cyan-200">
              Progreso
            </p>
            <p className="mt-1 text-2xl font-semibold text-white">{progress}%</p>
            <p className="text-xs text-zinc-400">
              {completeSteps}/{onboarding.length} paso(s)
            </p>
          </div>
        </div>

        <div className="mt-5 h-2 overflow-hidden rounded-full bg-zinc-900">
          <div
            className="h-full rounded-full bg-cyan-400 transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {onboarding.map((item, index) => {
            const selected = step === index;
            return (
              <button
                key={item.title}
                type="button"
                onClick={() => setStep(index)}
                className={`rounded-2xl border p-4 text-left transition ${
                  selected
                    ? "border-cyan-300/40 bg-cyan-500/15"
                    : item.ok
                      ? "border-emerald-400/20 bg-emerald-500/10 hover:border-emerald-300/40"
                      : "border-amber-400/20 bg-amber-500/10 hover:border-amber-300/40"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                      {item.timing}
                    </p>
                    <p className="mt-1 font-semibold text-white">{item.title}</p>
                  </div>
                  <span
                    className={`rounded-full border px-2.5 py-1 text-xs ${
                      item.ok
                        ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-200"
                        : "border-amber-400/25 bg-amber-500/10 text-amber-200"
                    }`}
                  >
                    {item.ok ? "Listo" : "Pendiente"}
                  </span>
                </div>
                <p className="mt-3 text-xs leading-5 text-zinc-400">{item.evidence}</p>
              </button>
            );
          })}
        </div>

        <div className="mt-5 rounded-2xl border border-white/10 bg-zinc-950/70 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">
                {current.timing}
              </p>
              <h3 className="mt-2 text-xl font-semibold text-white">{current.title}</h3>
            </div>
            <button
              type="button"
              onClick={() => onSelectTab(current.targetTab)}
              className="rounded-xl border border-cyan-400/25 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-100 transition hover:border-cyan-300/50"
            >
              Ir a {cobranzaTabInfo[current.targetTab].title}
            </button>
          </div>
          <p className="mt-3 text-sm leading-6 text-zinc-400">{current.text}</p>
          <div className="mt-4 grid gap-2 md:grid-cols-3">
            {current.checklist.map((item) => (
              <span
                key={item}
                className="rounded-xl border border-white/10 bg-zinc-900/70 px-3 py-2 text-xs text-zinc-300"
              >
                {item}
              </span>
            ))}
          </div>
          {current.blockers.length ? (
            <div className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-500/10 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-200">
                Pendiente antes de avanzar
              </p>
              <ul className="mt-3 space-y-2 text-sm text-amber-100">
                {current.blockers.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="mt-4 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
              Este paso ya tiene evidencia suficiente para continuar.
            </p>
          )}
        </div>
      </div>

      <aside className="space-y-6">
        <section className="page-section">
          <div className="flex items-center gap-2">
            <h2 className="section-title-compact">Activacion real</h2>
            <CobranzaInfoButton info={cobranzaTabInfo.preparacion} onOpen={onInfo} />
          </div>
          <div
            className={`mt-4 rounded-2xl border px-4 py-4 ${
              readyForControlledPilot
                ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-100"
                : "border-amber-400/25 bg-amber-500/10 text-amber-100"
            }`}
          >
            <p className="font-semibold">
              {readyForControlledPilot
                ? "Lista para piloto controlado"
                : "Piloto real bloqueado"}
            </p>
            <p className="mt-1 text-xs leading-5 opacity-80">
              {readyForControlledPilot
                ? "No hay bloqueantes criticos detectados en este tablero."
                : `${criticalBlockers.length} punto(s) requieren atencion antes de abrir envios reales.`}
            </p>
          </div>
          {criticalBlockers.length ? (
            <div className="mt-4 space-y-2">
              {criticalBlockers.slice(0, 6).map((item) => (
                <p
                  key={item}
                  className="rounded-xl border border-white/10 bg-zinc-950/70 px-3 py-2 text-xs text-zinc-300"
                >
                  {item}
                </p>
              ))}
            </div>
          ) : null}
        </section>

        <section className="page-section">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="section-title-compact">Piloto Maya Coliving</h2>
              <p className="mt-2 section-copy-compact">
                Checklist vivo del piloto con evidencia de cartera, envios,
                comprobantes, facturacion y zona segura.
              </p>
            </div>
            <div className="shrink-0 rounded-2xl border border-cyan-400/20 bg-cyan-500/10 px-3 py-2 text-right">
              <p className="text-xs font-semibold text-cyan-100">
                {pilotComplete}/{pilotSteps.length}
              </p>
              <p className="text-[11px] text-zinc-500">{pilotProgress}%</p>
            </div>
          </div>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-zinc-900">
            <div
              className="h-full rounded-full bg-cyan-400 transition-all"
              style={{ width: `${pilotProgress}%` }}
            />
          </div>
          <div className="mt-4 space-y-3">
            {pilotSteps.map((item) => {
              const toneClass =
                item.tone === "emerald"
                  ? "border-emerald-400/20 bg-emerald-500/10"
                  : item.tone === "rose"
                    ? "border-rose-400/20 bg-rose-500/10"
                    : item.tone === "cyan"
                      ? "border-cyan-400/20 bg-cyan-500/10"
                      : "border-amber-400/20 bg-amber-500/10";
              const badgeClassName =
                item.tone === "emerald"
                  ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-200"
                  : item.tone === "rose"
                    ? "border-rose-400/25 bg-rose-500/10 text-rose-200"
                    : item.tone === "cyan"
                      ? "border-cyan-400/25 bg-cyan-500/10 text-cyan-200"
                      : "border-amber-400/25 bg-amber-500/10 text-amber-200";
              return (
                <button
                  key={item.title}
                  type="button"
                  onClick={() => onSelectTab(item.targetTab)}
                  className={`w-full rounded-2xl border p-4 text-left transition hover:border-cyan-300/40 ${toneClass}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-semibold text-white">{item.title}</p>
                    <span
                      className={`shrink-0 rounded-full border px-2.5 py-1 text-xs ${badgeClassName}`}
                    >
                      {item.ok ? "Listo" : "Pendiente"}
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-zinc-400">
                    {item.detail}
                  </p>
                </button>
              );
            })}
          </div>
        </section>

        <section className="page-section">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="section-title-compact">Primer lote real</h2>
              <p className="mt-2 section-copy-compact">
                Control previo para pasar de laboratorio a 5-10 clientes reales
                sin abrir volumen masivo.
              </p>
            </div>
            <div
              className={`shrink-0 rounded-2xl border px-3 py-2 text-right ${
                releaseMachineReady
                  ? "border-emerald-400/20 bg-emerald-500/10"
                  : "border-amber-400/20 bg-amber-500/10"
              }`}
            >
              <p
                className={`text-xs font-semibold ${
                  releaseMachineReady ? "text-emerald-100" : "text-amber-100"
                }`}
              >
                {releaseMachineComplete}/{releaseMachineSteps.length}
              </p>
              <p className="text-[11px] text-zinc-500">{releaseMachineProgress}%</p>
            </div>
          </div>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-zinc-900">
            <div
              className={`h-full rounded-full transition-all ${
                releaseMachineReady ? "bg-emerald-400" : "bg-amber-400"
              }`}
              style={{ width: `${releaseMachineProgress}%` }}
            />
          </div>
          <div
            className={`mt-4 rounded-2xl border p-4 ${
              releaseMachineReady
                ? "border-emerald-400/20 bg-emerald-500/10"
                : "border-amber-400/20 bg-amber-500/10"
            }`}
          >
            <p
              className={`text-sm font-semibold ${
                releaseMachineReady ? "text-emerald-100" : "text-amber-100"
              }`}
            >
              {releaseMachineReady
                ? "Listo para preparar primer lote"
                : "Aun no abras lote real"}
            </p>
            <p className="mt-2 text-xs leading-5 text-zinc-400">
              {releaseMachineReady
                ? "La parte tecnica esta lista; el siguiente paso es seleccionar clientes y revisar datos uno por uno."
                : "Mantente en laboratorio hasta completar los bloqueos tecnicos pendientes."}
            </p>
          </div>
          <div className="mt-4 grid gap-3">
            {releaseMachineSteps.map((item) => {
              const toneClass =
                item.tone === "emerald"
                  ? "border-emerald-400/20 bg-emerald-500/10"
                  : item.tone === "rose"
                    ? "border-rose-400/20 bg-rose-500/10"
                    : item.tone === "cyan"
                      ? "border-cyan-400/20 bg-cyan-500/10"
                      : "border-amber-400/20 bg-amber-500/10";
              const badgeClassName =
                item.tone === "emerald"
                  ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-200"
                  : item.tone === "rose"
                    ? "border-rose-400/25 bg-rose-500/10 text-rose-200"
                    : item.tone === "cyan"
                      ? "border-cyan-400/25 bg-cyan-500/10 text-cyan-200"
                      : "border-amber-400/25 bg-amber-500/10 text-amber-200";
              return (
                <button
                  key={item.title}
                  type="button"
                  onClick={() => onSelectTab(item.targetTab)}
                  className={`w-full rounded-2xl border p-4 text-left transition hover:border-cyan-300/40 ${toneClass}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-semibold text-white">{item.title}</p>
                    <span
                      className={`shrink-0 rounded-full border px-2.5 py-1 text-xs ${badgeClassName}`}
                    >
                      {item.ok ? "Listo" : "Pendiente"}
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-zinc-400">
                    {item.detail}
                  </p>
                </button>
              );
            })}
          </div>
          <div className="mt-4 rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
              Checklist operativo
            </p>
            <div className="mt-3 space-y-2">
              {releaseManualChecklist.map((item) => (
                <p
                  key={item}
                  className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs leading-5 text-zinc-300"
                >
                  {item}
                </p>
              ))}
            </div>
          </div>
        </section>

        <section className="page-section">
          <h2 className="section-title-compact">Cierre del onboarding</h2>
          <p className="mt-2 section-copy-compact">
            Registra el cierre cuando el operador haya revisado los pasos y la
            capa este lista para el siguiente piloto.
          </p>
          <div className="mt-4 rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
              Estado de cierre
            </p>
            <p className="mt-2 text-sm font-semibold text-white">
              {onboardingState?.closed ? "Cerrado" : "Abierto"}
            </p>
            <p className="mt-1 text-xs text-zinc-400">
              {onboardingState?.closed
                ? `${reviewLabel} por ${reviewOwner}`
                : reopenLabel
                  ? `Ultima reapertura: ${reopenLabel}`
                  : reviewLabel}
            </p>
          </div>
          {onboardingState?.closed ? (
            <button
              type="button"
              onClick={onReopenOnboarding}
              disabled={busy}
              className="mt-4 w-full rounded-2xl border border-amber-400/25 bg-amber-500/10 px-4 py-2 text-sm font-semibold text-amber-100 transition hover:border-amber-300/50 disabled:opacity-60"
            >
              {busy ? "Procesando..." : "Reabrir revision"}
            </button>
          ) : (
            <button
              type="button"
              onClick={markReviewed}
              disabled={busy}
              className="mt-4 w-full rounded-2xl border border-emerald-400/25 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-100 transition hover:border-emerald-300/50 disabled:opacity-60"
            >
              {busy ? "Guardando cierre..." : "Marcar onboarding revisado"}
            </button>
          )}
        </section>

        <section className="page-section">
          <div className="flex items-center gap-2">
            <h2 className="section-title-compact">Cadencia activa</h2>
            <CobranzaInfoButton info={cobranzaTabInfo.automatizacion} onOpen={onInfo} />
          </div>
          <div className="mt-5 space-y-3">
            {rules.slice(0, 6).map((rule) => {
              const template = templates.find((item) => item.id === rule.plantilla_id);
              const blocked =
                channelUsesWhatsapp(rule.canal) && !isApprovedWhatsappTemplate(template);
              return (
                <div
                  key={rule.id}
                  className="rounded-2xl border border-white/10 bg-zinc-950/70 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-white">{rule.nombre}</p>
                      <p className="mt-1 text-xs text-zinc-500">
                        {statusLabel(rule.evento_base)} | {rule.desplazamiento_dias} dia(s)
                      </p>
                    </div>
                    <span
                      className={`rounded-full border px-2.5 py-1 text-xs ${
                        rule.activo && !blocked
                          ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-200"
                          : blocked
                            ? "border-amber-400/25 bg-amber-500/10 text-amber-200"
                            : "border-zinc-600/40 bg-zinc-800/70 text-zinc-300"
                      }`}
                    >
                      {blocked ? "Bloqueada" : rule.activo ? "Activa" : "Pausada"}
                    </span>
                  </div>
                </div>
              );
            })}
            {!rules.length ? (
              <p className="rounded-2xl border border-white/10 bg-zinc-950/70 px-4 py-4 text-sm text-zinc-500">
                Aun no hay reglas para mostrar.
              </p>
            ) : null}
          </div>
        </section>
      </aside>
    </section>
  );
}
