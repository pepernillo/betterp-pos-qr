"use client";

import { useSearchParams } from "next/navigation";
import { DragEvent, FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { buildApiUrl } from "@/lib/api";
import CommerceSubjectSelector from "@/components/marketing/CommerceSubjectSelector";

const EMPRESAS_API_BASE = buildApiUrl("/empresas");
const MARKETING_API_BASE = buildApiUrl("/marketing");
const OAUTH_PENDING_STORAGE_KEY = "betterp_marketing_oauth_pending";
const COMMUNICATIONS_PAGE_SIZE = 10;
const MAX_CHANNEL_MEDIA = 1;
const COMMUNICATION_TITLE_MIN = 3;
const COMMUNICATION_TITLE_MAX = 120;
const COMMUNICATION_TEXT_MIN = 10;
const COMMUNICATION_TEXT_MAX = 2200;
const COMMUNICATION_MEDIA_URL_MAX = 500;
const VIDEO_MEDIA_EXTENSIONS = [".mp4", ".mov", ".m4v", ".webm"];
const IMAGE_MEDIA_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];

interface Entidad {
  id: number;
  nombre_comercial: string;
  ciudad?: string | null;
  activo: boolean;
  espacios_disponibles: number;
}

interface MarketingChannel {
  canal: string;
  label: string;
  summary: string;
  mode_default: string;
  modo_integracion: string;
  activo: boolean;
  estatus: string;
  publicar_automaticamente: boolean;
  requiere_aprobacion: boolean;
  requires_media: boolean;
  notas: string;
  credenciales: {
    account_id?: string;
    page_id?: string;
    page_name?: string;
    page_category?: string;
    meta_pages_count?: number;
    meta_pages?: Array<{
      id: string;
      name: string;
      category?: string;
    }>;
    profile_url?: string;
    instagram_user_id?: string;
    instagram_username?: string;
    access_token_configurado?: boolean;
    token_usuario_configurado?: boolean;
  };
}

interface MarketingCampaign {
  id: number;
  nombre: string;
  objetivo: string;
  estatus: string;
  segmento: string;
  presupuesto_estimado: number;
  canales: string[];
  fecha_inicio: string | null;
  fecha_fin: string | null;
  notas: string;
  comunicados_count: number;
}

interface MarketingPublication {
  id: number;
  canal: string;
  label: string;
  estatus: string;
  identificador_externo: string;
  url_publicacion: string;
  mensaje_estado: string;
  fecha_publicacion: string | null;
}

interface MarketingSpacePublicationStatus {
  canal: string;
  label: string;
  estatus: string;
  comunicado_id: number | null;
  comunicado_titulo: string;
  media_ready: boolean;
  media_count: number;
  blockers: string[];
  fecha_actualizacion: string | null;
}

interface MarketingCommunication {
  id: number;
  campana_id: number | null;
  campana_nombre: string;
  espacio_id: number | null;
  espacio_codigo: string;
  titulo: string;
  objetivo: string;
  formato: string;
  texto: string;
  cta_texto: string;
  cta_url: string;
  hashtags: string[];
  media_urls: string[];
  media_por_canal?: Record<string, string[]>;
  canales: string[];
  estatus: string;
  fecha_programada: string | null;
  fecha_actualizacion: string;
  publicaciones: MarketingPublication[];
}

interface MarketingUsageLimitItem {
  key: string;
  label: string;
  description: string;
  unit: string;
  used: number;
  included: number;
  remaining: number | null;
  unlimited: boolean;
  status: "OK" | "WARN" | "EXHAUSTED" | "BLOCKED";
  message: string;
  periodo: string;
  reset_at: string;
  blocks_at_limit: boolean;
}

interface MarketingUsageLimits {
  periodo: string;
  reset_at: string;
  items: MarketingUsageLimitItem[];
  alerts: MarketingUsageLimitItem[];
}

interface AvailableSpace {
  id: number;
  entidad_id: number;
  entidad_nombre: string;
  codigo: string;
  estatus: string;
  tipo_nombre: string | null;
  titulo_publico: string;
  resumen_publico: string;
  descripcion_publica: string;
  renta_publicable: number;
  recamaras: number | null;
  banos: number | null;
  metros_cuadrados: number | null;
  foto_count: number;
  cover_url: string | null;
  publication_statuses: MarketingSpacePublicationStatus[];
}

interface MarketingDashboard {
  entidad: {
    id: number;
    nombre_comercial: string;
    ciudad: string | null;
  };
  summary: {
    canales_activos: number;
    campanas_activas: number;
    comunicados_programados: number;
    espacios_disponibles: number;
  };
  channels: MarketingChannel[];
  campaigns: MarketingCampaign[];
  communications: MarketingCommunication[];
  available_spaces: AvailableSpace[];
  usage_limits?: MarketingUsageLimits;
  setup_required?: boolean;
  setup_message?: string;
}

interface MarketingAttributionReport {
  contract: string;
  generated_at: string;
  attribution_model: string;
  revenue_authority: string;
  window_version: string;
  rows: Array<{
    publication_id: number;
    channel: string;
    attribution_key: string;
    touches: number;
    orders: number;
    gross_sales: string;
    refunds: string;
    net_sales: string;
    confirmed_spend: string;
    currency: string;
    currency_compatible: boolean;
    roas: string | null;
    spend_observations: number;
  }>;
}

interface MarketingSubscriptionAccess {
  plan?: {
    nombre?: string | null;
    funciones_habilitadas?: string[] | null;
  } | null;
  effective_plan?: {
    funciones_habilitadas?: string[] | null;
  } | null;
}

type MarketingTab =
  | "comunicados"
  | "calendario"
  | "espacios"
  | "commerce"
  | "conexiones"
  | "metricas";

type ConnectionDifficulty = "facil" | "media" | "alta" | "muy_alta";

type MarketingActionAccess = {
  allowed: boolean;
  feature?: string;
  requirement?: string;
  message?: string;
};

const MARKETING_CHANNEL_FEATURES: Record<string, string> = {
  FACEBOOK: "marketing_facebook",
  INSTAGRAM: "marketing_instagram",
  TIKTOK: "marketing_tiktok",
  YOUTUBE: "marketing_youtube",
};

const MARKETING_FEATURE_LABELS: Record<string, string> = {
  social_publishing: "Publicacion social",
  marketing_facebook: "Facebook Pages",
  marketing_instagram: "Instagram Business",
  marketing_tiktok: "TikTok",
  marketing_youtube: "YouTube Shorts",
};

const MARKETING_CHANNEL_LABELS: Record<string, string> = {
  FACEBOOK: "Facebook Pages",
  INSTAGRAM: "Instagram Business",
  TIKTOK: "TikTok",
  YOUTUBE: "YouTube Shorts",
};

const MARKETING_USAGE_LIMIT_KEYS = {
  scheduledPublications: "marketing_publications_scheduled",
  socialPublishes: "marketing_social_publishes",
  mediaAssets: "marketing_media_assets",
};

const tabs: { value: MarketingTab; label: string; detail: string }[] = [
  { value: "comunicados", label: "Comunicados", detail: "Texto, imagen, video y variantes por red." },
  { value: "calendario", label: "Calendario", detail: "Programacion editorial." },
  { value: "espacios", label: "Espacios disponibles", detail: "Inventario listo para promocion." },
  { value: "commerce", label: "Commerce", detail: "Productos, catalogos y promociones verificadas." },
  { value: "conexiones", label: "Conexiones", detail: "Cuentas sociales por entidad." },
  { value: "metricas", label: "Metricas", detail: "Lectura de desempeno por canal." },
];

interface MarketingInfoContent {
  eyebrow?: string;
  title: string;
  summary: string;
  details: string[];
}

const marketingTabInfo: Record<MarketingTab, MarketingInfoContent> = {
  comunicados: {
    eyebrow: "Marketing",
    title: "Comunicados",
    summary:
      "Aqui se prepara la pieza comercial que despues puede publicarse en redes conectadas o quedar programada.",
    details: [
      "El comunicado concentra titulo, copy, formato, estado, fecha, canales y multimedia.",
      "Cada canal tiene reglas propias: Instagram requiere imagen, Facebook puede ir con texto o una imagen, TikTok y YouTube quedan como preparacion asistida con video.",
      "Usa Borrador para guardar ideas, Listo para piezas revisadas y Programado cuando ya tenga fecha y hora de salida.",
    ],
  },
  calendario: {
    eyebrow: "Marketing",
    title: "Calendario editorial",
    summary:
      "Muestra las publicaciones programadas por dia para revisar la agenda comercial sin abrir cada comunicado.",
    details: [
      "Puedes moverte por mes, elegir un dia y crear un comunicado programado desde la fecha seleccionada.",
      "Los eventos del calendario vienen de comunicados con fecha programada.",
      "Sirve para evitar saturar canales y para mantener constancia en la promocion de espacios disponibles.",
    ],
  },
  espacios: {
    eyebrow: "Marketing",
    title: "Espacios disponibles",
    summary:
      "Lista el inventario que puede convertirse en comunicado comercial para redes sociales.",
    details: [
      "La tabla indica si la ficha tiene fotos, resumen y datos suficientes para promocionarse.",
      "Crear comunicado precarga titulo y texto usando la informacion comercial del espacio.",
      "Si faltan datos, conviene corregir la ficha en Renta de espacios antes de pautar o publicar.",
    ],
  },
  commerce: {
    eyebrow: "Puente Commerce",
    title: "Sujetos comerciales",
    summary: "Selecciona evidencia firmada desde BetterP Commerce sin duplicar su autoridad comercial.",
    details: [
      "La consulta procesa solamente la pagina visible.",
      "Importar conserva precio, stock, URL, vigencia y firma como evidencia inmutable.",
      "Este corte no crea campanas, comunicados ni publicaciones sociales.",
    ],
  },
  conexiones: {
    eyebrow: "Marketing",
    title: "Conexiones",
    summary:
      "Centraliza las cuentas sociales configuradas por unidad de negocio para publicar comunicados.",
    details: [
      "Facebook e Instagram se conectan con OAuth; no se piden contrasenas al usuario final.",
      "TikTok y YouTube quedan como flujos asistidos hasta cerrar integraciones directas seguras.",
      "Cada entidad puede tener su propia conexion para que una pagina o cuenta no afecte a otra unidad.",
    ],
  },
  metricas: {
    eyebrow: "Marketing",
    title: "Metricas",
    summary:
      "Resume oportunidades, publicaciones activas, pendientes y errores para priorizar acciones comerciales.",
    details: [
      "Oportunidades sin comunicado son espacios disponibles que aun no tienen una pieza comercial.",
      "Pendientes por ejecutar incluye publicaciones listas o programadas que todavia no salen.",
      "Errores a corregir senala piezas que requieren ajuste de canal, media o permisos.",
    ],
  },
};

const marketingInfo: Record<string, MarketingInfoContent> = {
  modulo: {
    eyebrow: "Marketing",
    title: "Publicidad y marketing",
    summary:
      "Este modulo ayuda a convertir inventario disponible en comunicados listos para publicar o programar.",
    details: [
      "Trabaja por unidad de negocio para mantener separadas cuentas, espacios y agenda.",
      "El flujo recomendado es conectar canales, revisar espacios disponibles, crear comunicado y programarlo.",
      "Los estados y validaciones buscan evitar publicaciones incompletas o rechazadas por la red social.",
    ],
  },
  entidad: {
    eyebrow: "Marketing",
    title: "Unidad de negocio",
    summary:
      "Define sobre que entidad operan los comunicados, conexiones, calendario y metricas visibles.",
    details: [
      "Al cambiar la entidad se recargan canales, espacios disponibles y comunicados.",
      "Cada entidad puede tener conexiones sociales distintas.",
      "Si promocionas un espacio de otra entidad, BettERP cambia la entidad activa para mantener consistencia.",
    ],
  },
  resumen: {
    eyebrow: "Marketing",
    title: "Resumen operativo",
    summary:
      "Estos indicadores muestran el volumen actual de canales, comunicados, programaciones y espacios disponibles.",
    details: [
      "Canales activos mide conexiones operativas o habilitadas para la entidad.",
      "Comunicados cuenta piezas guardadas, sin importar si estan en borrador, listas o programadas.",
      "Espacios disponibles ayuda a ubicar inventario comercial que todavia puede promocionarse.",
    ],
  },
  formulario: {
    eyebrow: "Comunicados",
    title: "Formulario de comunicado",
    summary:
      "Captura la pieza base que se adaptara a los canales seleccionados.",
    details: [
      "Los campos tienen limites para mantener textos compatibles con redes y evitar datos basura.",
      "Titulo y texto son obligatorios; el sistema valida longitud, caracteres de control y seleccion de canales.",
      "La multimedia se valida por canal antes de guardar para evitar rechazos al publicar.",
    ],
  },
  espacio: {
    eyebrow: "Comunicados",
    title: "Espacio relacionado",
    summary:
      "Permite crear una pieza ligada a un espacio disponible o dejarla como comunicado general.",
    details: [
      "Si eliges un espacio, BettERP puede precargar titulo y copy usando la ficha comercial.",
      "Comunicado general sirve para avisos de marca, promociones amplias o publicaciones no ligadas a un inventario puntual.",
      "El campo es opcional, pero ayuda a medir que espacios ya tienen comunicados.",
    ],
  },
  titulo: {
    eyebrow: "Comunicados",
    title: "Titulo",
    summary:
      "Nombre interno y visible del comunicado para identificarlo en listados y calendario.",
    details: [
      `Obligatorio: de ${COMMUNICATION_TITLE_MIN} a ${COMMUNICATION_TITLE_MAX} caracteres.`,
      "Acepta letras, numeros, espacios y puntuacion comun. Se eliminan caracteres de control.",
      "Debe ser claro para que el equipo ubique la pieza sin abrirla.",
    ],
  },
  texto: {
    eyebrow: "Comunicados",
    title: "Texto del comunicado",
    summary:
      "Copy base que se usara para la publicacion o para preparar la pieza por canal.",
    details: [
      `Obligatorio: de ${COMMUNICATION_TEXT_MIN} a ${COMMUNICATION_TEXT_MAX} caracteres.`,
      "Acepta texto multilinea, emojis y puntuacion comun; se limpian caracteres invisibles de control.",
      "Evita datos privados o promesas no confirmadas porque puede salir directamente a redes.",
    ],
  },
  formato: {
    eyebrow: "Comunicados",
    title: "Formato",
    summary:
      "Indica el tipo principal de pieza para orientar reglas de multimedia y publicacion.",
    details: [
      "Texto + media permite copy con imagen o video segun canal.",
      "Imagen y Video ayudan a preparar la pieza con la regla visual adecuada.",
      "Texto se usa cuando el canal permite publicar sin archivo adjunto.",
    ],
  },
  estado: {
    eyebrow: "Comunicados",
    title: "Estado",
    summary:
      "Controla en que punto operativo esta el comunicado.",
    details: [
      "Borrador guarda la idea sin mandarla a publicar.",
      "Listo indica que ya fue revisado y puede publicarse manualmente.",
      "Programado requiere fecha y hora para entrar al calendario editorial.",
    ],
  },
  fecha: {
    eyebrow: "Comunicados",
    title: "Fecha programada",
    summary:
      "Define cuando debe salir el comunicado si se trabaja como programacion editorial.",
    details: [
      "Para estado Programado la fecha y hora son obligatorias.",
      "La hora usa intervalos de 15 minutos para evitar capturas ambiguas.",
      "Si limpias la fecha, el comunicado puede guardarse como Borrador o Listo.",
    ],
  },
  canales: {
    eyebrow: "Comunicados",
    title: "Canales",
    summary:
      "Redes o plataformas donde se preparara o publicara el comunicado.",
    details: [
      "Solo aparecen canales configurados y soportados para esta entidad.",
      "Debes elegir al menos un canal conectado para guardar.",
      "Cada canal puede imponer reglas distintas de archivo, formato y permisos.",
    ],
  },
  multimedia: {
    eyebrow: "Comunicados",
    title: "Multimedia por canal",
    summary:
      "Archivo o URL que acompana el comunicado segun la regla de cada red social.",
    details: [
      `Por ahora se permite ${MAX_CHANNEL_MEDIA} archivo por canal para mantener el flujo controlado.`,
      "Facebook acepta texto solo o una imagen; Instagram requiere una imagen.",
      "TikTok y YouTube requieren video para preparacion asistida.",
    ],
  },
  mediaUrl: {
    eyebrow: "Comunicados",
    title: "URL de multimedia",
    summary:
      "Liga publica a una imagen o video que ya esta disponible en internet.",
    details: [
      `Debe iniciar con http o https y tener maximo ${COMMUNICATION_MEDIA_URL_MAX} caracteres.`,
      "El archivo debe coincidir con la regla del canal seleccionado.",
      "Si la liga es privada o temporal, la red social podria rechazar la publicacion.",
    ],
  },
  recientes: {
    eyebrow: "Comunicados",
    title: "Comunicados recientes",
    summary:
      "Listado de piezas guardadas con acciones para editar, copiar, borrar o publicar por canal.",
    details: [
      "Editar reabre el comunicado con sus datos actuales.",
      "Copiar crea una nueva pieza basada en una anterior sin modificar la original.",
      "Publicar por canal usa las reglas de multimedia y permisos antes de mandar la pieza.",
    ],
  },
  calendario: marketingTabInfo.calendario,
  espacios: marketingTabInfo.espacios,
  commerce: marketingTabInfo.commerce,
  conexiones: marketingTabInfo.conexiones,
  metricas: marketingTabInfo.metricas,
};

function isMarketingTab(value: string | null): value is MarketingTab {
  return (
    value === "comunicados" ||
    value === "calendario" ||
    value === "espacios" ||
    value === "commerce" ||
    value === "conexiones" ||
    value === "metricas"
  );
}

const defaultChannels = ["FACEBOOK", "INSTAGRAM", "TIKTOK", "YOUTUBE"];
const defaultSelectedChannels = ["FACEBOOK", "INSTAGRAM"];
const supportedMarketingChannelCodes = new Set(defaultChannels);
const scheduleHourOptions = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const scheduleMinuteOptions = ["00", "15", "30", "45"];
const weekdayLabels = ["Dom", "Lun", "Mar", "Mie", "Jue", "Vie", "Sab"];

const difficultyStyles: Record<ConnectionDifficulty, string> = {
  facil: "border-emerald-500/20 bg-emerald-500/10 text-emerald-200",
  media: "border-cyan-500/20 bg-cyan-500/10 text-cyan-200",
  alta: "border-amber-500/20 bg-amber-500/10 text-amber-200",
  muy_alta: "border-red-500/20 bg-red-500/10 text-red-200",
};

const difficultyLabels: Record<ConnectionDifficulty, string> = {
  facil: "Mas facil",
  media: "Intermedia",
  alta: "Avanzada",
  muy_alta: "Mas dificil",
};

const connectionGuides: Record<
  string,
  {
    order: number;
    difficulty: ConnectionDifficulty;
    bestStart: string;
    testing: string;
    sandbox: string;
    envVars: string[];
    requirements: string[];
    steps: string[];
    production: string[];
    docs: { label: string; url: string }[];
  }
> = {
  FACEBOOK: {
    order: 1,
    difficulty: "facil",
    bestStart:
      "Es el mejor primer canal: permite probar OAuth, seleccion de pagina, permisos y publicacion organica antes de entrar a formatos mas estrictos.",
    testing:
      "Puedes probar con una app de Meta en modo desarrollo usando usuarios con rol de admin, developer o tester y una pagina que administres.",
    sandbox:
      "No hay sandbox separado como tal; el modo desarrollo limita el acceso a usuarios con rol en la app. Para publico real necesitas permisos aprobados y app en Live.",
    envVars: ["META_CLIENT_ID", "META_CLIENT_SECRET", "MARKETING_META_REDIRECT_URI"],
    requirements: [
      "Cuenta de Meta Developers.",
      "App tipo Business o Consumer con Facebook Login configurado.",
      "Pagina de Facebook administrada por el usuario que conectara la cuenta.",
      "Redirect URI exacto apuntando a /marketing en BetterP.",
    ],
    steps: [
      "Crear o abrir la app central de BetterP en Meta Developers.",
      "Agregar Facebook Login y registrar el redirect URI de produccion y demo.",
      "Configurar los permisos pages_show_list, pages_read_engagement y pages_manage_posts.",
      "Cargar META_CLIENT_ID, META_CLIENT_SECRET y MARKETING_META_REDIRECT_URI en Render.",
      "Desde BetterP, seleccionar la entidad, abrir Conexiones y presionar Conectar cuenta.",
      "Autorizar con un usuario que administre la pagina.",
      "Completar el intercambio del code por token, listar paginas y guardar page_id/page_access_token.",
      "Crear una publicacion de prueba en modo BORRADOR o LISTO y validar que se publique en la pagina elegida.",
    ],
    production: [
      "Solicitar App Review para los permisos usados por BetterP.",
      "Grabar video donde se vea BetterP creando o programando una publicacion en una pagina.",
      "Mover la app a Live cuando Meta apruebe permisos y politica.",
    ],
    docs: [
      {
        label: "Meta Pages API",
        url: "https://developers.facebook.com/docs/pages-api/posts/",
      },
      {
        label: "Meta Facebook Login",
        url: "https://developers.facebook.com/docs/facebook-login/",
      },
    ],
  },
  INSTAGRAM: {
    order: 2,
    difficulty: "media",
    bestStart:
      "Conviene despues de Facebook porque se activa desde la pagina conectada y requiere una cuenta profesional vinculada.",
    testing:
      "Se prueba con una pagina de Facebook que tenga una cuenta profesional de Instagram vinculada.",
    sandbox:
      "Usa el modo desarrollo de la app de Meta con usuarios que administren la pagina y la cuenta de Instagram.",
    envVars: [
      "META_CLIENT_ID",
      "META_CLIENT_SECRET",
      "MARKETING_META_REDIRECT_URI",
    ],
    requirements: [
      "Instagram Business o Creator vinculado a una pagina de Facebook.",
      "Usuario de Facebook con control sobre la pagina y la cuenta de Instagram.",
      "Permisos instagram_basic e instagram_content_publish en la app de Meta.",
      "Media publica o alojada en R2 con URL accesible para Meta.",
    ],
    steps: [
      "Confirmar que la cuenta de Instagram sea profesional y este vinculada a la pagina.",
      "Agregar instagram_basic e instagram_content_publish al flujo de Facebook Login.",
      "Reconectar Facebook Pages desde BetterP y autorizar los permisos de Instagram.",
      "BetterP detectara la cuenta de Instagram vinculada a la pagina.",
      "Guardar instagram_user_id, username y token del canal desde la conexion Meta.",
      "Publicar primero una imagen simple desde URL publica.",
      "Validar carrusel y reels cuando la publicacion simple ya funcione.",
    ],
    production: [
      "Solicitar App Review para permisos de Instagram Publishing.",
      "Preparar video mostrando creacion de media, publicacion y seleccion de cuenta.",
      "Asegurar que fotos/videos de espacios tengan URLs publicas temporales o permanentes aceptadas por Meta.",
    ],
    docs: [
      {
        label: "Instagram Content Publishing",
        url: "https://developers.facebook.com/docs/instagram-platform/content-publishing/",
      },
      {
        label: "Instagram API con Facebook Login",
        url: "https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/",
      },
    ],
  },
  YOUTUBE: {
    order: 3,
    difficulty: "alta",
    bestStart:
      "Es bueno para recorridos y Shorts, pero requiere OAuth de Google, pantalla de consentimiento y cuidado con cuotas.",
    testing:
      "Puedes probar con usuarios test en Google Cloud mientras la pantalla OAuth esta en Testing. Los refresh tokens sirven para automatizar publicaciones posteriores.",
    sandbox:
      "Google no tiene sandbox de YouTube separado. En modo Testing solo entran usuarios de prueba y puede haber limites de usuarios/expiracion segun configuracion.",
    envVars: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "MARKETING_GOOGLE_REDIRECT_URI"],
    requirements: [
      "Proyecto en Google Cloud.",
      "YouTube Data API v3 habilitada.",
      "OAuth consent screen configurada.",
      "OAuth Client tipo Web Application con redirect URI de BetterP.",
      "Canal de YouTube del cliente.",
    ],
    steps: [
      "Crear proyecto en Google Cloud o usar el proyecto central de BetterP.",
      "Habilitar YouTube Data API v3.",
      "Configurar OAuth consent screen con dominio betterp.net y usuarios test.",
      "Crear OAuth Client Web y registrar redirect URI.",
      "Guardar GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET y MARKETING_GOOGLE_REDIRECT_URI en Render.",
      "Conectar desde BetterP y pedir scopes youtube.upload y youtube.readonly.",
      "Intercambiar code por access_token y refresh_token.",
      "Subir un video corto de prueba con estado privado o no listado antes de publicar publico.",
    ],
    production: [
      "Enviar verificacion OAuth si Google la solicita por scopes sensibles.",
      "Preparar politicas de privacidad, dominio verificado y video de demostracion.",
      "Controlar cuota de videos.insert y manejar reintentos/resumable uploads.",
    ],
    docs: [
      {
        label: "YouTube OAuth",
        url: "https://developers.google.com/youtube/v3/guides/authentication",
      },
      {
        label: "Subir videos",
        url: "https://developers.google.com/youtube/v3/guides/uploading_a_video",
      },
    ],
  },
  TIKTOK: {
    order: 4,
    difficulty: "alta",
    bestStart:
      "Ideal para videos de espacios, pero la publicacion directa requiere aprobar scopes y pasar revision de TikTok.",
    testing:
      "TikTok permite sandbox de app y pruebas antes de auditoria; mientras no este auditado, la visibilidad puede quedar restringida.",
    sandbox:
      "TikTok Developer incluye Sandbox en App Management. Para publicar directo se requiere Content Posting API y scope video.publish aprobado.",
    envVars: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET", "MARKETING_TIKTOK_REDIRECT_URI"],
    requirements: [
      "App registrada en TikTok for Developers.",
      "Content Posting API agregado a la app.",
      "Direct Post habilitado si se quiere publicar sin intervencion manual.",
      "Dominio o URLs de media verificadas cuando se use PULL_FROM_URL.",
      "Videos en formato y duracion permitidos por TikTok.",
    ],
    steps: [
      "Registrar la app en TikTok for Developers.",
      "Agregar Sandbox y configurar redirect URI.",
      "Agregar el producto Content Posting API.",
      "Solicitar o habilitar scopes user.info.basic, video.upload y video.publish segun flujo.",
      "Guardar TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET y MARKETING_TIKTOK_REDIRECT_URI en Render.",
      "Conectar desde BetterP con OAuth y guardar access_token, refresh_token y open_id.",
      "Consultar creator_info antes de publicar para conocer privacidad y restricciones.",
      "Probar primero Upload o Direct Post con video privado/restringido.",
    ],
    production: [
      "Completar auditoria de TikTok para levantar restricciones de visibilidad.",
      "Documentar flujo de publicacion, consentimiento y manejo de errores.",
      "Validar estado de publicacion con publish_id despues de cada envio.",
    ],
    docs: [
      {
        label: "TikTok Content Posting API",
        url: "https://developers.tiktok.com/doc/content-posting-api-get-started/",
      },
      {
        label: "TikTok OAuth",
        url: "https://developers.tiktok.com/doc/oauth-user-access-token-management/",
      },
    ],
  },
  WHATSAPP: {
    order: 5,
    difficulty: "muy_alta",
    bestStart:
      "No lo recomiendo como primer canal de pruebas: no es red social de posteo abierto, funciona con opt-in, plantillas aprobadas y numero de WhatsApp Business.",
    testing:
      "Meta Cloud API tiene numero de prueba, token temporal y destinatarios test desde la seccion WhatsApp > API Setup.",
    sandbox:
      "El entorno de prueba de Meta usa un numero temporal y destinatarios verificados. Para produccion necesitas WABA, numero real y plantillas aprobadas.",
    envVars: ["META_CLIENT_ID", "META_CLIENT_SECRET", "MARKETING_META_REDIRECT_URI"],
    requirements: [
      "Business Manager de Meta.",
      "WhatsApp Business Account.",
      "Numero no registrado en WhatsApp personal o WhatsApp Business App.",
      "Plantillas aprobadas para iniciar conversaciones de marketing o utilidad.",
      "Webhooks para mensajes entrantes y estatus de entrega.",
    ],
    steps: [
      "Crear o abrir app en Meta Developers y agregar producto WhatsApp.",
      "Entrar a WhatsApp > API Setup y enviar mensaje con numero de prueba.",
      "Configurar webhook publico en BetterP para recibir mensajes y estados.",
      "Crear plantillas de mensaje para disponibilidad, visita y seguimiento.",
      "Solicitar aprobacion de plantillas en Meta Business Suite.",
      "Agregar numero real al WABA y verificarlo.",
      "Guardar phone_number_id, waba_id y token permanente del sistema.",
      "Enviar primero mensajes solo a leads con opt-in registrado en BetterP.",
    ],
    production: [
      "Verificar negocio en Meta Business Manager si el volumen o permisos lo requieren.",
      "Configurar metodo de pago y revisar limites de mensajeria.",
      "Mantener opt-in, baja y trazabilidad por lead para evitar bloqueos.",
    ],
    docs: [
      {
        label: "WhatsApp Cloud API",
        url: "https://developers.facebook.com/docs/whatsapp/cloud-api/get-started",
      },
      {
        label: "WhatsApp Webhooks",
        url: "https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks",
      },
    ],
  },
};

function getConnectionGuide(channelCode: string) {
  return (
    connectionGuides[channelCode] || {
      order: 99,
      difficulty: "media" as ConnectionDifficulty,
      bestStart: "Canal pendiente de documentar.",
      testing: "Define primero el proveedor y sus permisos.",
      sandbox: "Revisar ambiente de pruebas del proveedor.",
      envVars: [],
      requirements: [],
      steps: [],
      production: [],
      docs: [],
    }
  );
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "Sin fecha";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
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
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function toDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toMonthInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}-01`;
}

function parseDateInput(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) {
    return new Date();
  }
  return new Date(year, month - 1, day);
}

function monthLabel(value: string) {
  const date = parseDateInput(value);
  return new Intl.DateTimeFormat("es-MX", {
    month: "long",
    year: "numeric",
  }).format(date);
}

function dateInputLabel(value: string) {
  const date = parseDateInput(value);
  return new Intl.DateTimeFormat("es-MX", {
    weekday: "long",
    day: "2-digit",
    month: "short",
  }).format(date);
}

function extractErrorMessage(body: unknown, fallback: string) {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail?: unknown }).detail;
    if (typeof detail === "string" && detail.trim()) {
      return detail;
    }
  }
  return fallback;
}

async function readJsonResponse<T>(response: Response): Promise<T | { detail?: string }> {
  const text = await response.text();
  if (!text.trim()) {
    return {};
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    return {
      detail:
        response.status >= 500
          ? "No se pudo completar la solicitud. Intenta de nuevo o contacta soporte."
          : "La respuesta del servidor no se pudo leer.",
    };
  }
}

function statusStyles(status: string) {
  if (
    status === "ACTIVA" ||
    status === "CONECTADO" ||
    status === "PUBLICADO" ||
    status === "PUBLICADA"
  ) {
    return "border-emerald-500/20 bg-emerald-500/10 text-emerald-300";
  }
  if (status === "AUTORIZADO") {
    return "border-cyan-500/20 bg-cyan-500/10 text-cyan-300";
  }
  if (status === "PROGRAMADO" || status === "PROGRAMADA" || status === "PENDIENTE") {
    return "border-blue-500/20 bg-blue-500/10 text-blue-300";
  }
  if (status === "LISTO") {
    return "border-cyan-500/20 bg-cyan-500/10 text-cyan-300";
  }
  if (status === "PAUSADA") {
    return "border-amber-500/20 bg-amber-500/10 text-amber-300";
  }
  if (status === "ERROR") {
    return "border-red-500/20 bg-red-500/10 text-red-300";
  }
  if (status === "ELIMINADA") {
    return "border-zinc-700 bg-zinc-900/80 text-zinc-500";
  }
  return "border-zinc-700 bg-zinc-900 text-zinc-400";
}

function publicationStatusLabel(status: string) {
  if (status === "SIN_COMUNICADO") return "Sin comunicado";
  if (status === "PROGRAMADA") return "Programada";
  return status;
}

function buildSpacePost(space: AvailableSpace, entityName: string) {
  const parts = [
    space.titulo_publico,
    space.resumen_publico || space.descripcion_publica,
    `Renta: ${formatMoney(space.renta_publicable)}`,
    [
      space.recamaras ? `${space.recamaras} rec.` : "",
      space.banos ? `${space.banos} banos` : "",
      space.metros_cuadrados ? `${space.metros_cuadrados} m2` : "",
    ]
      .filter(Boolean)
      .join(" | "),
    `Disponible en ${entityName}. Agenda una visita o pide mas informacion.`,
  ].filter(Boolean);
  return parts.join("\n\n");
}

function isSupportedMarketingChannel(channel: string) {
  return supportedMarketingChannelCodes.has(channel.toUpperCase());
}

function sanitizeMarketingChannels(channels: string[]) {
  return channels
    .map((channel) => channel.toUpperCase())
    .filter((channel, index, list) => isSupportedMarketingChannel(channel) && list.indexOf(channel) === index);
}

function channelsOrDefault(channels: string[]) {
  const cleanChannels = sanitizeMarketingChannels(channels);
  return cleanChannels.length > 0 ? cleanChannels : [...defaultSelectedChannels];
}

function getSpaceMissingItems(space: AvailableSpace) {
  return [
    space.foto_count <= 0 ? "Sin foto" : "",
    !space.resumen_publico && !space.descripcion_publica ? "Sin resumen comercial" : "",
    !space.recamaras ? "Sin recamaras" : "",
    !space.banos ? "Sin banos" : "",
    !space.metros_cuadrados ? "Sin m2" : "",
  ].filter(Boolean);
}

function getSpaceSpecs(space: AvailableSpace) {
  return [
    `${space.foto_count} fotos`,
    space.recamaras ? `${space.recamaras} rec.` : "Sin rec.",
    space.banos ? `${space.banos} banos` : "Sin banos",
    space.metros_cuadrados ? `${space.metros_cuadrados} m2` : "Sin m2",
  ].join(" | ");
}

function compactChannelLabels(channels: string[], allChannels: MarketingChannel[]) {
  if (channels.length === 0) {
    return "Sin canales";
  }
  return channels
    .map((code) => allChannels.find((channel) => channel.canal === code)?.label || code)
    .join(", ");
}

function uniqueCleanUrls(values: Array<string | null | undefined>) {
  const urls: string[] = [];
  values.forEach((value) => {
    const url = (value || "").trim();
    if (url && !urls.includes(url)) {
      urls.push(url);
    }
  });
  return urls;
}

function isHttpUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function cleanSingleLineText(value: string, maxLength: number) {
  return value.replace(/[\u0000-\u001F\u007F]/g, "").slice(0, maxLength);
}

function cleanMultilineText(value: string, maxLength: number) {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").slice(0, maxLength);
}

function isValidDateTimeLocal(value: string) {
  if (!value) {
    return false;
  }
  const date = new Date(value);
  return !Number.isNaN(date.getTime());
}

function toDatetimeLocal(value: string | null | undefined) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 16);
}

function scheduleDatePart(value: string) {
  return value.includes("T") ? value.split("T", 1)[0] : "";
}

function scheduleTimePart(value: string) {
  if (!value.includes("T")) {
    return "09:00";
  }
  return value.split("T")[1]?.slice(0, 5) || "09:00";
}

function combineScheduleDateTime(date: string, time: string) {
  if (!date) {
    return "";
  }
  return `${date}T${time || "09:00"}`;
}

function clockParts(time: string) {
  const [rawHour, rawMinute] = (time || "09:00").split(":");
  const hour24 = Math.min(Math.max(Number(rawHour) || 9, 0), 23);
  const minute = String(Math.min(Math.max(Number(rawMinute) || 0, 0), 59)).padStart(2, "0");
  return {
    hour12: hour24 % 12 || 12,
    minute,
    period: hour24 >= 12 ? "PM" : "AM",
  };
}

function buildClockTime(hour12: number, minute: string, period: string) {
  let hour24 = hour12 % 12;
  if (period === "PM") {
    hour24 += 12;
  }
  return `${String(hour24).padStart(2, "0")}:${minute}`;
}

function formatScheduleTime(time: string) {
  const parts = clockParts(time);
  return `${String(parts.hour12).padStart(2, "0")}:${parts.minute} ${parts.period === "PM" ? "p.m." : "a.m."}`;
}

function localDateKey(value: string | null | undefined) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return toDateInputValue(date);
}

function localTimeLabel(value: string | null | undefined) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat("es-MX", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function mediaLabel(url: string) {
  try {
    const parsed = new URL(url);
    const name = parsed.pathname.split("/").filter(Boolean).pop();
    return name ? decodeURIComponent(name).slice(0, 44) : parsed.hostname;
  } catch {
    return url.slice(0, 44);
  }
}

function isVideoMediaUrl(url: string) {
  const normalized = url.split("?", 1)[0].toLowerCase();
  return VIDEO_MEDIA_EXTENSIONS.some((extension) => normalized.endsWith(extension));
}

function hasKnownImageExtension(value: string) {
  const normalized = value.split("?", 1)[0].toLowerCase();
  return IMAGE_MEDIA_EXTENSIONS.some((extension) => normalized.endsWith(extension));
}

function isVideoFile(file: File) {
  return file.type.startsWith("video/") || isVideoMediaUrl(file.name);
}

function isImageFile(file: File) {
  return file.type.startsWith("image/") || hasKnownImageExtension(file.name);
}

function getMediaSummary(mediaUrls: string[]) {
  const videoCount = mediaUrls.filter(isVideoMediaUrl).length;
  return {
    total: mediaUrls.length,
    imageCount: mediaUrls.length - videoCount,
    videoCount,
  };
}

function getMediaPolicyStatus(channels: string[], mediaUrls: string[]) {
  const cleanChannels = sanitizeMarketingChannels(channels);
  const summary = getMediaSummary(mediaUrls);
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (cleanChannels.includes("FACEBOOK")) {
    if (summary.videoCount > 0 || summary.imageCount > 1) {
      blockers.push("Facebook Pages directo en BetterP permite texto solo o una imagen.");
    }
  }

  if (cleanChannels.includes("INSTAGRAM")) {
    if (summary.total === 0) {
      blockers.push("Instagram requiere una imagen para publicar desde BetterP.");
    } else if (summary.videoCount > 0) {
      blockers.push("Instagram directo en BetterP acepta una imagen; videos y Reels quedan para una siguiente etapa.");
    } else if (summary.imageCount !== 1) {
      blockers.push("Instagram directo en BetterP publica una imagen. Deja solo una imagen o quita Instagram.");
    }
  }

  if (cleanChannels.includes("TIKTOK")) {
    if (summary.videoCount !== 1 || summary.imageCount > 0) {
      blockers.push("TikTok requiere un video vertical como pieza principal.");
    } else {
      warnings.push("TikTok queda listo para preparacion asistida; la publicacion directa requiere autorizacion del canal.");
    }
  }

  if (cleanChannels.includes("YOUTUBE")) {
    if (summary.videoCount !== 1 || summary.imageCount > 0) {
      blockers.push("YouTube Shorts requiere un video vertical como pieza principal.");
    } else {
      warnings.push("YouTube Shorts queda listo para preparacion asistida.");
    }
  }

  return { blockers, warnings, summary };
}

function getChannelMediaRule(channel: string) {
  const code = channel.toUpperCase();
  if (code === "FACEBOOK") {
    return {
      accept: "image/*",
      description: "Texto solo o una imagen.",
      emptyText: "Puedes dejarlo sin imagen o soltar una aqui.",
      invalidFileMessage: "Facebook Pages directo en BetterP solo acepta imagen en este flujo.",
    };
  }
  if (code === "INSTAGRAM") {
    return {
      accept: "image/*",
      description: "Una imagen obligatoria.",
      emptyText: "Suelta la imagen para Instagram.",
      invalidFileMessage: "Instagram directo en BetterP requiere una imagen, no video.",
    };
  }
  return {
    accept: "video/*",
    description: "Un video vertical para preparacion asistida.",
    emptyText: "Suelta el video para este canal.",
    invalidFileMessage: `${code} requiere un video como pieza principal en esta etapa.`,
  };
}

function fileMatchesChannelMediaRule(channel: string, file: File) {
  const code = channel.toUpperCase();
  if (code === "FACEBOOK" || code === "INSTAGRAM") {
    return isImageFile(file);
  }
  if (code === "TIKTOK" || code === "YOUTUBE") {
    return isVideoFile(file);
  }
  return isImageFile(file) || isVideoFile(file);
}

function communicationMediaForChannel(item: MarketingCommunication, channel: string) {
  if (
    item.media_por_canal &&
    Object.prototype.hasOwnProperty.call(item.media_por_canal, channel)
  ) {
    return item.media_por_canal[channel] || [];
  }
  return item.media_urls;
}

function isConfiguredMarketingChannel(channel: MarketingChannel) {
  const credentials = channel.credenciales || {};
  return (
    isSupportedMarketingChannel(channel.canal) &&
    Boolean(channel.activo) &&
    (channel.estatus === "CONECTADO" ||
      channel.estatus === "AUTORIZADO" ||
      Boolean(credentials.access_token_configurado) ||
      Boolean(credentials.token_usuario_configurado))
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

function channelIconLabel(channel: string) {
  const labels: Record<string, string> = {
    FACEBOOK: "f",
    INSTAGRAM: "IG",
    TIKTOK: "TT",
    YOUTUBE: "YT",
    WHATSAPP: "WA",
  };
  return labels[channel] || channel.slice(0, 2);
}

function channelIconStyles(channel: string, status: string) {
  if (status === "ELIMINADA") {
    return "border-zinc-700 bg-zinc-900 text-zinc-500";
  }
  if (status === "ERROR") {
    return "border-red-500/30 bg-red-500/10 text-red-200";
  }
  if (status !== "PUBLICADA") {
    return "border-zinc-700 bg-zinc-900 text-zinc-400";
  }
  const styles: Record<string, string> = {
    FACEBOOK: "border-blue-500/30 bg-blue-500/10 text-blue-200",
    INSTAGRAM: "border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-200",
    TIKTOK: "border-cyan-500/30 bg-cyan-500/10 text-cyan-200",
    YOUTUBE: "border-red-500/30 bg-red-500/10 text-red-200",
    WHATSAPP: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
  };
  return styles[channel] || "border-cyan-500/30 bg-cyan-500/10 text-cyan-200";
}

function calendarChannelStyles(channel: string) {
  const styles: Record<string, string> = {
    FACEBOOK: "border-blue-500/25 bg-blue-500/10 text-blue-200",
    INSTAGRAM: "border-fuchsia-500/25 bg-fuchsia-500/10 text-fuchsia-200",
    TIKTOK: "border-cyan-500/25 bg-cyan-500/10 text-cyan-200",
    YOUTUBE: "border-red-500/25 bg-red-500/10 text-red-200",
  };
  return styles[channel] || "border-zinc-700 bg-zinc-900 text-zinc-300";
}

function subscriptionFeatureKeys(subscription: MarketingSubscriptionAccess | null) {
  return (
    subscription?.effective_plan?.funciones_habilitadas ||
    subscription?.plan?.funciones_habilitadas ||
    []
  );
}

function planIsKnown(subscription: MarketingSubscriptionAccess | null) {
  return Boolean(subscription?.effective_plan || subscription?.plan);
}

function featureLabel(feature: string) {
  return MARKETING_FEATURE_LABELS[feature] || feature;
}

function channelLabel(channel: string) {
  return MARKETING_CHANNEL_LABELS[channel] || channel;
}

function buildFeatureBlockedAccess(feature: string, message: string): MarketingActionAccess {
  return {
    allowed: false,
    feature,
    requirement: featureLabel(feature),
    message,
  };
}

function formatInteger(value: number | null | undefined) {
  return new Intl.NumberFormat("es-MX").format(Number(value || 0));
}

function buildUsageLimitBlockedAccess(
  item: MarketingUsageLimitItem,
  increment = 1
): MarketingActionAccess {
  const remaining = item.remaining ?? 0;
  const unitLabel = increment === 1 ? item.unit : `${item.unit}s`;
  return {
    allowed: false,
    feature: item.key,
    requirement: item.label,
    message:
      item.message ||
      `Tu plan no tiene espacio para ${formatInteger(increment)} ${unitLabel} mas. Usado: ${formatInteger(
        item.used
      )}/${formatInteger(item.included)}. Restante: ${formatInteger(remaining)}.`,
  };
}

function usageLimitStatusStyles(status: MarketingUsageLimitItem["status"]) {
  const styles: Record<MarketingUsageLimitItem["status"], string> = {
    OK: "border-emerald-500/20 bg-emerald-500/10 text-emerald-100",
    WARN: "border-amber-500/20 bg-amber-500/10 text-amber-100",
    EXHAUSTED: "border-red-500/20 bg-red-500/10 text-red-100",
    BLOCKED: "border-zinc-700 bg-zinc-900 text-zinc-400",
  };
  return styles[status] || styles.OK;
}

export default function MarketingWorkspace() {
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const [entidades, setEntidades] = useState<Entidad[]>([]);
  const [selectedEntityId, setSelectedEntityId] = useState<number | null>(null);
  const [dashboard, setDashboard] = useState<MarketingDashboard | null>(null);
  const [attributionReport, setAttributionReport] = useState<MarketingAttributionReport | null>(null);
  const [attributionLoading, setAttributionLoading] = useState(false);
  const [subscriptionAccess, setSubscriptionAccess] =
    useState<MarketingSubscriptionAccess | null>(null);
  const [activeTab, setActiveTab] = useState<MarketingTab>("comunicados");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedConnectionCode, setSelectedConnectionCode] = useState("");
  const [selectedPublicationDetail, setSelectedPublicationDetail] = useState<{
    communication: MarketingCommunication;
    publication: MarketingPublication;
  } | null>(null);
  const [infoModal, setInfoModal] = useState<MarketingInfoContent | null>(null);

  const [selectedSpaceId, setSelectedSpaceId] = useState<number | "">("");
  const [communicationTitle, setCommunicationTitle] = useState("");
  const [communicationText, setCommunicationText] = useState("");
  const [communicationStatus, setCommunicationStatus] = useState("BORRADOR");
  const [communicationFormat, setCommunicationFormat] = useState("MIXTO");
  const [selectedChannels, setSelectedChannels] = useState<string[]>([
    ...defaultSelectedChannels,
  ]);
  const [scheduledAt, setScheduledAt] = useState("");
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => toMonthInputValue(new Date()));
  const [selectedCalendarDate, setSelectedCalendarDate] = useState(() =>
    toDateInputValue(new Date())
  );
  const [editingCommunicationId, setEditingCommunicationId] = useState<number | null>(null);
  const [channelMediaInputs, setChannelMediaInputs] = useState<Record<string, string>>({});
  const [channelMediaUrls, setChannelMediaUrls] = useState<Record<string, string[]>>({});
  const [communicationsPage, setCommunicationsPage] = useState(1);
  const [communicationAttempted, setCommunicationAttempted] = useState(false);

  const selectTab = (tab: MarketingTab) => {
    setActiveTab(tab);
    if (typeof window !== "undefined") {
      window.history.replaceState({}, "", `/marketing?tab=${tab}`);
      window.dispatchEvent(new CustomEvent("betterp-tab-change", { detail: { tab } }));
    }
  };

  const activeEntities = useMemo(
    () => entidades.filter((entidad) => entidad.activo),
    [entidades]
  );

  const selectedEntity = useMemo(
    () => entidades.find((entidad) => entidad.id === selectedEntityId) || null,
    [entidades, selectedEntityId]
  );

  const loadEntities = useCallback(async () => {
    try {
      const response = await fetch(`${EMPRESAS_API_BASE}/lista/`, {
        cache: "no-store",
      });
      const body = await readJsonResponse<Entidad[]>(response);
      if (!response.ok) {
        throw new Error(extractErrorMessage(body, "No se pudieron cargar las entidades."));
      }
      setEntidades(body as Entidad[]);
    } catch (loadError) {
      console.error("Error cargando entidades para marketing:", loadError);
      setError(
        loadError instanceof Error
          ? loadError.message
          : "No se pudieron cargar las entidades."
      );
      setEntidades([]);
    }
  }, []);

  const loadSubscriptionAccess = useCallback(async () => {
    try {
      const response = await fetch(buildApiUrl("/billing/suscripcion/actual/"), {
        cache: "no-store",
      });
      const body = await readJsonResponse<MarketingSubscriptionAccess>(response);
      if (!response.ok) {
        setSubscriptionAccess(null);
        return;
      }
      setSubscriptionAccess(body as MarketingSubscriptionAccess);
    } catch {
      setSubscriptionAccess(null);
    }
  }, []);

  const loadDashboard = useCallback(async () => {
    if (!selectedEntityId) {
      setDashboard(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const response = await fetch(
        `${MARKETING_API_BASE}/entidades/${selectedEntityId}/dashboard/`,
        { cache: "no-store" }
      );
      const body = await readJsonResponse<MarketingDashboard>(response);
      if (!response.ok) {
        throw new Error(extractErrorMessage(body, "No se pudo cargar marketing."));
      }
      setDashboard(body as MarketingDashboard);
    } catch (loadError) {
      console.error("Error cargando marketing:", loadError);
      setError(
        loadError instanceof Error
          ? loadError.message
          : "No se pudo cargar el modulo de marketing."
      );
      setDashboard(null);
    } finally {
      setLoading(false);
    }
  }, [selectedEntityId]);

  useEffect(() => {
    void loadEntities();
  }, [loadEntities]);

  useEffect(() => {
    void loadSubscriptionAccess();
  }, [loadSubscriptionAccess]);

  useEffect(() => {
    if (entidades.length === 0) {
      setSelectedEntityId(null);
      return;
    }
    if (selectedEntityId && entidades.some((entidad) => entidad.id === selectedEntityId)) {
      return;
    }
    const preferred =
      entidades.find((entidad) => entidad.activo && entidad.espacios_disponibles > 0) ||
      entidades.find((entidad) => entidad.activo) ||
      entidades[0];
    setSelectedEntityId(preferred.id);
  }, [entidades, selectedEntityId]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    if (activeTab !== "metricas" || !selectedEntityId) return;
    let cancelled = false;
    setAttributionLoading(true);
    void fetch(`${MARKETING_API_BASE}/entidades/${selectedEntityId}/commerce/atribucion/`, {
      cache: "no-store",
    })
      .then(async (response) => {
        const body = await readJsonResponse<MarketingAttributionReport>(response);
        if (!cancelled) setAttributionReport(response.ok ? (body as MarketingAttributionReport) : null);
      })
      .catch(() => {
        if (!cancelled) setAttributionReport(null);
      })
      .finally(() => {
        if (!cancelled) setAttributionLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, selectedEntityId]);

  useEffect(() => {
    if (isMarketingTab(tabParam)) {
      setActiveTab(tabParam);
    }
  }, [tabParam]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code") || "";
    const state = params.get("state") || "";
    const oauthError = params.get("error") || "";
    const errorDescription = params.get("error_description") || "";
    const marketingOAuth = params.get("marketing_oauth") || "";
    const marketingOAuthMessage = params.get("message") || "";
    const marketingTab = params.get("tab") || "";
    const marketingChannel = params.get("channel") || "";
    if (marketingOAuth) {
      window.sessionStorage.removeItem(OAUTH_PENDING_STORAGE_KEY);
      if (marketingTab === "conexiones") {
        setActiveTab("conexiones");
      }
      if (marketingChannel) {
        setSelectedConnectionCode(marketingChannel.toUpperCase());
      }
      if (marketingOAuth === "success") {
        setError("");
        setNotice(marketingOAuthMessage || "Cuenta autorizada.");
        void loadDashboard();
      } else {
        setNotice("");
        setError(marketingOAuthMessage || "No se pudo completar la autorizacion.");
      }
      window.history.replaceState({}, "", "/marketing");
      return;
    }
    if (!state && !oauthError) {
      const pendingOauth = window.sessionStorage.getItem(OAUTH_PENDING_STORAGE_KEY);
      if (pendingOauth) {
        window.sessionStorage.removeItem(OAUTH_PENDING_STORAGE_KEY);
        try {
          const pending = JSON.parse(pendingOauth) as {
            canal?: string;
            label?: string;
            startedAt?: number;
          };
          const isRecent = Date.now() - Number(pending.startedAt || 0) < 15 * 60 * 1000;
          if (isRecent && pending.canal) {
            setActiveTab("conexiones");
            setSelectedConnectionCode(pending.canal.toUpperCase());
            setError(
              `La autorizacion de ${pending.label || pending.canal} no regreso a BetterP. Si el proveedor mostro un error, revisa la configuracion de la app y vuelve a intentar.`
            );
          }
        } catch {
          // Ignora datos corruptos de un intento anterior de OAuth.
        }
      }
      return;
    }

    const registerCallback = async () => {
      setSaving("oauth-callback");
      setError("");
      setNotice("");
      try {
        setActiveTab("conexiones");
        setSelectedConnectionCode("FACEBOOK");
        const response = await fetch(`${MARKETING_API_BASE}/oauth/callback/`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code,
            state,
            error: oauthError,
            error_description: errorDescription,
          }),
        });
        const body = (await readJsonResponse<{
          detail?: string;
          mensaje?: string;
        }>(response)) as {
          detail?: string;
          mensaje?: string;
        };
        if (!response.ok) {
          throw new Error(
            body.detail || "No se pudo registrar la autorizacion."
          );
        }
        setNotice(body.mensaje || "Cuenta autorizada.");
        window.history.replaceState({}, "", "/marketing");
        await loadDashboard();
      } catch (callbackError) {
        window.history.replaceState({}, "", "/marketing");
        setError(
          callbackError instanceof Error
            ? callbackError.message
            : "No se pudo registrar la autorizacion."
        );
      } finally {
        setSaving("");
      }
    };

    void registerCallback();
  }, [loadDashboard]);

  useEffect(() => {
    if (!dashboard || communicationText || selectedSpaceId === "") {
      return;
    }
    const space = dashboard.available_spaces.find((item) => item.id === selectedSpaceId);
    if (!space) {
      return;
    }
    setCommunicationTitle(
      cleanSingleLineText(`Promocion ${space.codigo}`, COMMUNICATION_TITLE_MAX)
    );
    setCommunicationText(
      cleanMultilineText(
        buildSpacePost(space, space.entidad_nombre || dashboard.entidad.nombre_comercial),
        COMMUNICATION_TEXT_MAX
      )
    );
  }, [communicationText, dashboard, selectedSpaceId]);

  useEffect(() => {
    setCommunicationsPage(1);
  }, [selectedEntityId]);

  const availableSpaces = useMemo(
    () => dashboard?.available_spaces || [],
    [dashboard?.available_spaces]
  );
  const communications = useMemo(
    () => dashboard?.communications || [],
    [dashboard?.communications]
  );
  const knownPlan = planIsKnown(subscriptionAccess);
  const enabledFeatures = useMemo(
    () => subscriptionFeatureKeys(subscriptionAccess),
    [subscriptionAccess]
  );
  const hasMarketingFeature = useCallback(
    (feature: string) => !knownPlan || enabledFeatures.includes(feature),
    [enabledFeatures, knownPlan]
  );
  const canUseSocialPublishing = hasMarketingFeature("social_publishing");
  const missingChannelFeatures = useMemo(
    () =>
      Object.entries(MARKETING_CHANNEL_FEATURES)
        .filter(([, feature]) => knownPlan && !enabledFeatures.includes(feature))
        .map(([channel, feature]) => ({
          channel,
          feature,
          label: channelLabel(channel),
        })),
    [enabledFeatures, knownPlan]
  );
  const getMarketingChannelAccess = useCallback(
    (channel: string): MarketingActionAccess => {
      if (!hasMarketingFeature("social_publishing")) {
        return buildFeatureBlockedAccess(
          "social_publishing",
          "Tu plan actual no incluye publicacion social. Puedes preparar comunicados, pero necesitas un plan superior para conectar cuentas o publicar desde BetterP."
        );
      }
      const channelFeature = MARKETING_CHANNEL_FEATURES[channel.toUpperCase()];
      if (channelFeature && !hasMarketingFeature(channelFeature)) {
        return buildFeatureBlockedAccess(
          channelFeature,
          `Tu plan actual no incluye ${channelLabel(channel.toUpperCase())}.`
        );
      }
      return { allowed: true };
    },
    [hasMarketingFeature]
  );
  const marketingUsage = dashboard?.usage_limits || null;
  const usageLimitByKey = useMemo(
    () =>
      Object.fromEntries(
        (marketingUsage?.items || []).map((item) => [item.key, item])
      ) as Record<string, MarketingUsageLimitItem>,
    [marketingUsage]
  );
  const getUsageLimitAccess = useCallback(
    (usageKey: string, increment = 1): MarketingActionAccess => {
      const item = usageLimitByKey[usageKey];
      if (!item || !item.blocks_at_limit || item.unlimited || increment <= 0) {
        return { allowed: true };
      }
      const remaining = item.remaining ?? 0;
      if (remaining < increment) {
        return buildUsageLimitBlockedAccess(item, increment);
      }
      return { allowed: true };
    },
    [usageLimitByKey]
  );
  const getCommunicationPublicationIncrement = useCallback(
    (channels: string[]) => {
      const uniqueChannels = Array.from(new Set(channels));
      if (!editingCommunicationId) {
        return uniqueChannels.length;
      }
      const current = communications.find((item) => item.id === editingCommunicationId);
      const existingChannels = new Set(
        (current?.publicaciones || []).map((publication) => publication.canal)
      );
      return uniqueChannels.filter((channel) => !existingChannels.has(channel)).length;
    },
    [communications, editingCommunicationId]
  );

  const selectedSpace = useMemo(() => {
    if (!dashboard || selectedSpaceId === "") {
      return null;
    }
    return dashboard.available_spaces.find((space) => space.id === selectedSpaceId) || null;
  }, [dashboard, selectedSpaceId]);

  const selectedScheduleDate = scheduleDatePart(scheduledAt);
  const selectedScheduleTime = scheduleTimePart(scheduledAt);
  const selectedClockParts = clockParts(selectedScheduleTime);

  const scheduledCommunications = useMemo(
    () =>
      communications
        .filter((item) => item.fecha_programada)
        .sort(
          (left, right) =>
            new Date(left.fecha_programada || "").getTime() -
            new Date(right.fecha_programada || "").getTime()
        ),
    [communications]
  );

  const calendarCells = useMemo(() => {
    const monthDate = parseDateInput(calendarMonth);
    const firstDay = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
    const startOffset = firstDay.getDay();
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(
        firstDay.getFullYear(),
        firstDay.getMonth(),
        index - startOffset + 1
      );
      const key = toDateInputValue(date);
      return {
        key,
        day: date.getDate(),
        inMonth: date.getMonth() === firstDay.getMonth(),
        isToday: key === toDateInputValue(new Date()),
        isSelected: key === selectedCalendarDate,
        items: scheduledCommunications.filter(
          (item) => localDateKey(item.fecha_programada) === key
        ),
      };
    });
  }, [calendarMonth, scheduledCommunications, selectedCalendarDate]);

  const selectedCalendarDayItems = useMemo(
    () =>
      scheduledCommunications.filter(
        (item) => localDateKey(item.fecha_programada) === selectedCalendarDate
      ),
    [scheduledCommunications, selectedCalendarDate]
  );

  const communicationsTotalPages = Math.max(
    1,
    Math.ceil(communications.length / COMMUNICATIONS_PAGE_SIZE)
  );
  const safeCommunicationsPage = Math.min(communicationsPage, communicationsTotalPages);
  const pagedCommunications = communications.slice(
    (safeCommunicationsPage - 1) * COMMUNICATIONS_PAGE_SIZE,
    safeCommunicationsPage * COMMUNICATIONS_PAGE_SIZE
  );
  const visibleCommunicationPages = buildVisiblePages(
    safeCommunicationsPage,
    communicationsTotalPages
  );
  const communicationsShowingFrom =
    communications.length === 0
      ? 0
      : (safeCommunicationsPage - 1) * COMMUNICATIONS_PAGE_SIZE + 1;
  const communicationsShowingTo = Math.min(
    safeCommunicationsPage * COMMUNICATIONS_PAGE_SIZE,
    communications.length
  );

  const orderedChannels = useMemo(() => {
    return [...(dashboard?.channels || [])]
      .filter((channel) => isSupportedMarketingChannel(channel.canal))
      .sort(
        (left, right) =>
          getConnectionGuide(left.canal).order - getConnectionGuide(right.canal).order
      );
  }, [dashboard]);

  const configuredChannels = useMemo(
    () => orderedChannels.filter(isConfiguredMarketingChannel),
    [orderedChannels]
  );
  const configuredChannelCodes = useMemo(
    () => configuredChannels.map((channel) => channel.canal),
    [configuredChannels]
  );
  const selectedConfiguredChannels = useMemo(
    () => configuredChannels.filter((channel) => selectedChannels.includes(channel.canal)),
    [configuredChannels, selectedChannels]
  );
  const channelMediaForSave = useMemo(() => {
    const entries: Record<string, string[]> = {};
    selectedChannels
      .filter((channel) => configuredChannelCodes.includes(channel))
      .forEach((channel) => {
        const manualMedia = uniqueCleanUrls(channelMediaUrls[channel] || []);
        const automaticMedia =
          manualMedia.length === 0 &&
          selectedSpace?.cover_url &&
          ["FACEBOOK", "INSTAGRAM"].includes(channel)
            ? selectedSpace.cover_url
            : "";
        entries[channel] = uniqueCleanUrls([automaticMedia, ...manualMedia]);
      });
    return entries;
  }, [channelMediaUrls, configuredChannelCodes, selectedChannels, selectedSpace?.cover_url]);
  const communicationMediaForSave = useMemo(
    () => uniqueCleanUrls(Object.values(channelMediaForSave).flat()),
    [channelMediaForSave]
  );
  const communicationValidation = useMemo(() => {
    const errors: Record<string, string> = {};
    const title = communicationTitle.trim();
    const text = communicationText.trim();
    const channelsForSave = sanitizeMarketingChannels(selectedChannels).filter((channel) =>
      configuredChannelCodes.includes(channel)
    );

    if (title.length < COMMUNICATION_TITLE_MIN) {
      errors.titulo = `Titulo obligatorio: minimo ${COMMUNICATION_TITLE_MIN} caracteres.`;
    } else if (title.length > COMMUNICATION_TITLE_MAX) {
      errors.titulo = `Titulo maximo ${COMMUNICATION_TITLE_MAX} caracteres.`;
    }

    if (text.length < COMMUNICATION_TEXT_MIN) {
      errors.texto = `Texto obligatorio: minimo ${COMMUNICATION_TEXT_MIN} caracteres.`;
    } else if (communicationText.length > COMMUNICATION_TEXT_MAX) {
      errors.texto = `Texto maximo ${COMMUNICATION_TEXT_MAX} caracteres.`;
    }

    if (!["MIXTO", "IMAGEN", "VIDEO", "TEXTO"].includes(communicationFormat)) {
      errors.formato = "Selecciona un formato valido.";
    }

    if (!["BORRADOR", "LISTO", "PROGRAMADO"].includes(communicationStatus)) {
      errors.estado = "Selecciona un estado valido.";
    }

    if (communicationStatus === "PROGRAMADO" && !isValidDateTimeLocal(scheduledAt)) {
      errors.fecha = "Para programar, selecciona dia y hora validos.";
    }

    if (channelsForSave.length === 0) {
      errors.canales = "Selecciona al menos un canal conectado.";
    }

    channelsForSave.forEach((channel) => {
      const mediaPolicy = getMediaPolicyStatus([channel], channelMediaForSave[channel] || []);
      if (mediaPolicy.blockers.length > 0) {
        errors.multimedia = mediaPolicy.blockers[0];
      }
    });

    return {
      errors,
      isValid: Object.keys(errors).length === 0,
      channelsForSave,
    };
  }, [
    channelMediaForSave,
    communicationFormat,
    communicationStatus,
    communicationText,
    communicationTitle,
    configuredChannelCodes,
    scheduledAt,
    selectedChannels,
  ]);
  const communicationFieldError = (field: string) =>
    communicationAttempted ? communicationValidation.errors[field] || "" : "";
  const communicationPublicationIncrement = getCommunicationPublicationIncrement(
    communicationValidation.channelsForSave
  );
  const communicationSaveLimitAccess = getUsageLimitAccess(
    MARKETING_USAGE_LIMIT_KEYS.scheduledPublications,
    communicationPublicationIncrement
  );

  const selectedConnectionChannel = useMemo(() => {
    if (orderedChannels.length === 0) {
      return null;
    }
    return (
      orderedChannels.find((channel) => channel.canal === selectedConnectionCode) ||
      orderedChannels[0]
    );
  }, [orderedChannels, selectedConnectionCode]);

  const selectedConnectionGuide = selectedConnectionChannel
    ? getConnectionGuide(selectedConnectionChannel.canal)
    : null;
  const selectedConnectionAccess = selectedConnectionChannel
    ? getMarketingChannelAccess(selectedConnectionChannel.canal)
    : { allowed: true };

  const allPublications = communications.flatMap((item) =>
    item.publicaciones.filter((publication) =>
      isSupportedMarketingChannel(publication.canal)
    )
  );
  const publishedPublications = allPublications.filter(
    (publication) => publication.estatus === "PUBLICADA"
  );
  const pendingPublications = allPublications.filter(
    (publication) =>
      !["PUBLICADA", "PAUSADA", "ELIMINADA", "ERROR"].includes(publication.estatus)
  );
  const erroredPublications = allPublications.filter(
    (publication) => publication.estatus === "ERROR"
  );
  const spacesWithCommunication = new Set(
    communications
      .map((item) => item.espacio_id)
      .filter((spaceId): spaceId is number => Boolean(spaceId))
  );
  const spacesWithoutCommunication = availableSpaces.filter(
    (space) => !spacesWithCommunication.has(space.id)
  );

  useEffect(() => {
    if (orderedChannels.length === 0) {
      setSelectedConnectionCode("");
      return;
    }
    if (
      selectedConnectionCode &&
      orderedChannels.some((channel) => channel.canal === selectedConnectionCode)
    ) {
      return;
    }
    setSelectedConnectionCode(orderedChannels[0].canal);
  }, [orderedChannels, selectedConnectionCode]);

  useEffect(() => {
    if (!dashboard) {
      return;
    }
    setSelectedChannels((current) => {
      const cleanCurrent = current.filter((channel) =>
        configuredChannelCodes.includes(channel)
      );
      if (cleanCurrent.length > 0) {
        return cleanCurrent;
      }
      return configuredChannelCodes.slice(0, 2);
    });
  }, [configuredChannelCodes, dashboard]);

  useEffect(() => {
    if (communicationsPage > communicationsTotalPages) {
      setCommunicationsPage(communicationsTotalPages);
    }
  }, [communicationsPage, communicationsTotalPages]);

  const toggleChannel = (channel: string) => {
    setSelectedChannels((current) =>
      current.includes(channel)
        ? current.filter((item) => item !== channel)
        : [...current, channel]
    );
  };

  const updateScheduledDate = (date: string) => {
    setScheduledAt(combineScheduleDateTime(date, selectedScheduleTime));
  };

  const updateScheduledTime = (time: string) => {
    const date = selectedScheduleDate || toDateInputValue(new Date());
    setScheduledAt(combineScheduleDateTime(date, time));
  };

  const updateClockHour = (hour12: number) => {
    updateScheduledTime(
      buildClockTime(hour12, selectedClockParts.minute, selectedClockParts.period)
    );
  };

  const updateClockMinute = (minute: string) => {
    updateScheduledTime(
      buildClockTime(selectedClockParts.hour12, minute, selectedClockParts.period)
    );
  };

  const updateClockPeriod = (period: string) => {
    updateScheduledTime(
      buildClockTime(selectedClockParts.hour12, selectedClockParts.minute, period)
    );
  };

  const moveCalendarMonth = (months: number) => {
    const current = parseDateInput(calendarMonth);
    setCalendarMonth(
      toMonthInputValue(new Date(current.getFullYear(), current.getMonth() + months, 1))
    );
  };

  const jumpCalendarToToday = () => {
    const today = new Date();
    setCalendarMonth(toMonthInputValue(today));
    setSelectedCalendarDate(toDateInputValue(today));
  };

  const startCommunicationForDate = (dateKey: string) => {
    setSelectedCalendarDate(dateKey);
    setEditingCommunicationId(null);
    setCommunicationTitle("");
    setCommunicationText("");
    setCommunicationStatus("PROGRAMADO");
    setScheduledAt(`${dateKey}T09:00`);
    setTimePickerOpen(false);
    setNotice("Fecha cargada. Completa el comunicado y guarda la programacion.");
    selectTab("comunicados");
  };

  const resetCommunicationForm = () => {
    setEditingCommunicationId(null);
    setSelectedSpaceId("");
    setCommunicationTitle("");
    setCommunicationText("");
    setCommunicationStatus("BORRADOR");
    setCommunicationFormat("MIXTO");
    setSelectedChannels(configuredChannelCodes.slice(0, 2));
    setScheduledAt("");
    setTimePickerOpen(false);
    setChannelMediaInputs({});
    setChannelMediaUrls({});
    setCommunicationAttempted(false);
  };

  const addCommunicationMediaUrl = (channel: string) => {
    const url = (channelMediaInputs[channel] || "").trim();
    if (!url) {
      return;
    }
    if ((channelMediaUrls[channel] || []).length >= MAX_CHANNEL_MEDIA) {
      setError(`Este canal ya tiene el maximo de ${MAX_CHANNEL_MEDIA} archivo.`);
      return;
    }
    if (!isHttpUrl(url)) {
      setError("Agrega una URL publica valida que inicie con http o https.");
      return;
    }
    if (url.length > COMMUNICATION_MEDIA_URL_MAX) {
      setError(`La URL no puede superar ${COMMUNICATION_MEDIA_URL_MAX} caracteres.`);
      return;
    }
    const nextUrls = uniqueCleanUrls([...(channelMediaUrls[channel] || []), url]);
    const mediaPolicy = getMediaPolicyStatus([channel], nextUrls);
    if (mediaPolicy.blockers.length > 0) {
      setError(mediaPolicy.blockers[0]);
      return;
    }
    setChannelMediaUrls((current) => ({
      ...current,
      [channel]: uniqueCleanUrls([...(current[channel] || []), url]),
    }));
    setChannelMediaInputs((current) => ({ ...current, [channel]: "" }));
    setError("");
  };

  const uploadCommunicationMedia = async (channel: string, files: FileList | null) => {
    if (!selectedEntityId || !files || files.length === 0) {
      return;
    }
    const selectedFiles = Array.from(files);
    const acceptedFiles = selectedFiles.filter((file) =>
      fileMatchesChannelMediaRule(channel, file)
    );
    if (acceptedFiles.length === 0) {
      setError(getChannelMediaRule(channel).invalidFileMessage);
      return;
    }
    const remainingSlots = MAX_CHANNEL_MEDIA - (channelMediaUrls[channel] || []).length;
    if (remainingSlots <= 0) {
      setError(`Este canal ya tiene el maximo de ${MAX_CHANNEL_MEDIA} archivo.`);
      return;
    }
    const filesToUpload = acceptedFiles.slice(0, remainingSlots);
    const mediaLimitAccess = getUsageLimitAccess(
      MARKETING_USAGE_LIMIT_KEYS.mediaAssets,
      filesToUpload.length
    );
    if (!mediaLimitAccess.allowed) {
      setNotice("");
      setError(mediaLimitAccess.message || "Tu plan llego al limite mensual de multimedia.");
      return;
    }
    setSaving("communication-media");
    setError("");
    setNotice("");
    try {
      const uploadedUrls: string[] = [];
      for (const file of filesToUpload) {
        const formData = new FormData();
        formData.append("file", file);
        const response = await fetch(
          `${MARKETING_API_BASE}/entidades/${selectedEntityId}/media/`,
          {
            method: "POST",
            body: formData,
          }
        );
        const body = (await readJsonResponse<{
          detail?: string;
          mensaje?: string;
          url?: string;
        }>(response)) as {
          detail?: string;
          mensaje?: string;
          url?: string;
        };
        if (!response.ok || !body.url) {
          throw new Error(body.detail || `No se pudo subir ${file.name}.`);
        }
        uploadedUrls.push(body.url);
      }
      setChannelMediaUrls((current) => ({
        ...current,
        [channel]: uniqueCleanUrls([...(current[channel] || []), ...uploadedUrls]),
      }));
      setNotice(
        [
          uploadedUrls.length === 1
            ? "Multimedia cargada al comunicado."
            : `${uploadedUrls.length} archivos cargados al comunicado.`,
          selectedFiles.length > acceptedFiles.length
            ? `Se omitieron ${selectedFiles.length - acceptedFiles.length} por regla del canal.`
            : "",
          acceptedFiles.length > filesToUpload.length
            ? `Se omitieron ${acceptedFiles.length - filesToUpload.length} por el limite de ${MAX_CHANNEL_MEDIA}.`
            : "",
        ]
          .filter(Boolean)
          .join(" ")
      );
      await loadDashboard();
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "No se pudo subir la multimedia."
      );
    } finally {
      setSaving("");
    }
  };

  const handleCommunicationMediaDrop = (channel: string, event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    void uploadCommunicationMedia(channel, event.dataTransfer.files);
  };

  const editCommunication = (item: MarketingCommunication) => {
    const linkedSpace = dashboard?.available_spaces.find(
      (space) => space.id === item.espacio_id
    );
    setEditingCommunicationId(item.id);
    setSelectedSpaceId(item.espacio_id || "");
    setCommunicationTitle(cleanSingleLineText(item.titulo, COMMUNICATION_TITLE_MAX));
    setCommunicationText(cleanMultilineText(item.texto, COMMUNICATION_TEXT_MAX));
    setCommunicationStatus(item.estatus || "BORRADOR");
    setCommunicationFormat(item.formato || "MIXTO");
    setSelectedChannels(channelsOrDefault(item.canales));
    setScheduledAt(toDatetimeLocal(item.fecha_programada));
    setChannelMediaInputs({});
    const mediaByChannel =
      item.media_por_canal && Object.keys(item.media_por_canal).length > 0
        ? item.media_por_canal
        : Object.fromEntries(item.canales.map((channel) => [channel, item.media_urls]));
    setChannelMediaUrls(
      Object.fromEntries(
        Object.entries(mediaByChannel).map(([channel, urls]) => [
          channel,
          uniqueCleanUrls(urls).filter((url) =>
            ["FACEBOOK", "INSTAGRAM"].includes(channel)
              ? url !== linkedSpace?.cover_url
              : true
          ),
        ])
      )
    );
    setActiveTab("comunicados");
    setError("");
    setNotice(`Editando comunicado: ${item.titulo}`);
    setCommunicationAttempted(false);
  };

  const copyCommunication = (item: MarketingCommunication) => {
    const linkedSpace = dashboard?.available_spaces.find(
      (space) => space.id === item.espacio_id
    );
    setEditingCommunicationId(null);
    setSelectedSpaceId(item.espacio_id || "");
    setCommunicationTitle(
      cleanSingleLineText(`${item.titulo} (copia)`, COMMUNICATION_TITLE_MAX)
    );
    setCommunicationText(cleanMultilineText(item.texto, COMMUNICATION_TEXT_MAX));
    setCommunicationStatus("BORRADOR");
    setCommunicationFormat(item.formato || "MIXTO");
    setSelectedChannels(channelsOrDefault(item.canales));
    setScheduledAt("");
    setChannelMediaInputs({});
    const mediaByChannel =
      item.media_por_canal && Object.keys(item.media_por_canal).length > 0
        ? item.media_por_canal
        : Object.fromEntries(item.canales.map((channel) => [channel, item.media_urls]));
    setChannelMediaUrls(
      Object.fromEntries(
        Object.entries(mediaByChannel).map(([channel, urls]) => [
          channel,
          uniqueCleanUrls(urls).filter((url) =>
            ["FACEBOOK", "INSTAGRAM"].includes(channel)
              ? url !== linkedSpace?.cover_url
              : true
          ),
        ])
      )
    );
    setActiveTab("comunicados");
    setError("");
    setNotice("Copia cargada en el formulario. Revisa y guarda para crear un nuevo comunicado.");
    setCommunicationAttempted(false);
  };

  const saveCommunication = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedEntityId) {
      return;
    }
    setCommunicationAttempted(true);
    if (!communicationValidation.isValid) {
      const firstError = Object.values(communicationValidation.errors)[0];
      setError(firstError || "Revisa los campos obligatorios del comunicado.");
      return;
    }
    if (!communicationSaveLimitAccess.allowed) {
      setNotice("");
      setError(
        communicationSaveLimitAccess.message ||
          "Tu plan llego al limite mensual de publicaciones preparadas."
      );
      return;
    }
    setSaving("communication");
    setError("");
    setNotice("");
    try {
      const targetEntityId = selectedSpace?.entidad_id || selectedEntityId;
      const endpoint = editingCommunicationId
        ? `${MARKETING_API_BASE}/comunicados/${editingCommunicationId}/`
        : `${MARKETING_API_BASE}/entidades/${targetEntityId}/comunicados/`;
      const response = await fetch(
        endpoint,
        {
          method: editingCommunicationId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            titulo: communicationTitle.trim(),
            texto: communicationText.trim(),
            formato: communicationFormat,
            estatus: communicationStatus,
            canales: communicationValidation.channelsForSave,
            espacio_id: selectedSpaceId || null,
            fecha_programada: scheduledAt ? new Date(scheduledAt).toISOString() : null,
            cta_texto: "Pedir informacion",
            hashtags: ["BetterP", "Renta", "EspaciosDisponibles"],
            media_urls: communicationMediaForSave,
            media_por_canal: channelMediaForSave,
          }),
        }
      );
      const body = (await readJsonResponse<{
        detail?: string;
        mensaje?: string;
      }>(response)) as {
        detail?: string;
        mensaje?: string;
      };
      if (!response.ok) {
        throw new Error(extractErrorMessage(body, "No se pudo guardar el comunicado."));
      }
      setNotice(body.mensaje || "Comunicado guardado.");
      resetCommunicationForm();
      await loadDashboard();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "No se pudo guardar el comunicado."
      );
    } finally {
      setSaving("");
    }
  };

  const toggleChannelConnection = async (channel: MarketingChannel) => {
    if (!selectedEntityId) {
      return;
    }
    setSaving(channel.canal);
    setError("");
    setNotice("");
    try {
      const nextActive = !channel.activo;
      const response = await fetch(
        `${MARKETING_API_BASE}/entidades/${selectedEntityId}/canales/${channel.canal}/`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            canal: channel.canal,
            activo: nextActive,
            modo_integracion: channel.modo_integracion || channel.mode_default,
            publicar_automaticamente: nextActive ? channel.publicar_automaticamente : false,
            requiere_aprobacion: channel.requiere_aprobacion,
            notas: channel.notas,
            credenciales: {},
          }),
        }
      );
      const body = (await readJsonResponse<{
        detail?: string;
        mensaje?: string;
      }>(response)) as {
        detail?: string;
        mensaje?: string;
      };
      if (!response.ok) {
        throw new Error(extractErrorMessage(body, "No se pudo actualizar el canal."));
      }
      setNotice(body.mensaje || "Canal actualizado.");
      await loadDashboard();
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "No se pudo actualizar el canal."
      );
    } finally {
      setSaving("");
    }
  };

  const startOAuthConnection = async (channel: MarketingChannel) => {
    if (!selectedEntityId) {
      return;
    }
    const channelAccess = getMarketingChannelAccess(channel.canal);
    if (!channelAccess.allowed) {
      setNotice("");
      setError(channelAccess.message || "Tu plan actual no permite conectar este canal.");
      return;
    }
    setSaving(`oauth-${channel.canal}`);
    setError("");
    setNotice("");
    try {
      const authorizationUrl = await requestOAuthAuthorizationUrl(channel);
      window.sessionStorage.setItem(
        OAUTH_PENDING_STORAGE_KEY,
        JSON.stringify({
          canal: channel.canal,
          label: channel.label,
          startedAt: Date.now(),
        })
      );
      window.location.assign(authorizationUrl);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "No se pudo iniciar la conexion del canal."
      );
    } finally {
      setSaving("");
    }
  };

  const requestOAuthAuthorizationUrl = async (channel: MarketingChannel) => {
    const response = await fetch(
      `${MARKETING_API_BASE}/entidades/${selectedEntityId}/canales/${channel.canal}/oauth/iniciar/`,
      { method: "POST" }
    );
    const body = (await readJsonResponse<{
      authorization_url?: string;
      detail?: string;
    }>(response)) as {
      authorization_url?: string;
      detail?: string;
    };
    if (!response.ok || !body.authorization_url) {
      throw new Error(body.detail || "No se pudo iniciar la conexion del canal.");
    }
    return body.authorization_url;
  };

  const copyOAuthDiagnosticUrl = async (channel: MarketingChannel) => {
    if (!selectedEntityId) {
      return;
    }
    const channelAccess = getMarketingChannelAccess(channel.canal);
    if (!channelAccess.allowed) {
      setNotice("");
      setError(channelAccess.message || "Tu plan actual no permite conectar este canal.");
      return;
    }
    setSaving(`oauth-debug-${channel.canal}`);
    setError("");
    setNotice("");
    try {
      const authorizationUrl = await requestOAuthAuthorizationUrl(channel);
      await navigator.clipboard.writeText(authorizationUrl);
      const parsedUrl = new URL(authorizationUrl);
      const clientId = parsedUrl.searchParams.get("client_id") || "sin client_id";
      const redirectUri = parsedUrl.searchParams.get("redirect_uri") || "sin redirect_uri";
      setNotice(
        `URL de diagnostico copiada. Client ID: ${clientId}. Redirect: ${redirectUri}.`
      );
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "No se pudo copiar la URL de diagnostico."
      );
    } finally {
      setSaving("");
    }
  };

  const disconnectChannel = async (channel: MarketingChannel) => {
    if (!selectedEntityId) {
      return;
    }
    const channelAccess = getMarketingChannelAccess(channel.canal);
    if (!channelAccess.allowed) {
      setNotice("");
      setError(channelAccess.message || "Tu plan actual no permite administrar este canal.");
      return;
    }
    setSaving(`disconnect-${channel.canal}`);
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        `${MARKETING_API_BASE}/entidades/${selectedEntityId}/canales/${channel.canal}/desconectar/`,
        { method: "POST" }
      );
      const body = (await readJsonResponse<{
        detail?: string;
        mensaje?: string;
      }>(response)) as {
        detail?: string;
        mensaje?: string;
      };
      if (!response.ok) {
        throw new Error(body.detail || "No se pudo desconectar el canal.");
      }
      setNotice(body.mensaje || "Canal desconectado.");
      await loadDashboard();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "No se pudo desconectar el canal."
      );
    } finally {
      setSaving("");
    }
  };

  const deleteCommunication = async (item: MarketingCommunication) => {
    if (
      !window.confirm(
        "Este comunicado se borrara de BetterP junto con su historial de publicaciones. Si ya se publico en una red social, la publicacion externa no se elimina automaticamente."
      )
    ) {
      return;
    }
    setSaving(`communication-delete-${item.id}`);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`${MARKETING_API_BASE}/comunicados/${item.id}/`, {
        method: "DELETE",
      });
      const body = (await readJsonResponse<{
        detail?: string;
        mensaje?: string;
      }>(response)) as {
        detail?: string;
        mensaje?: string;
      };
      if (!response.ok) {
        throw new Error(body.detail || "No se pudo borrar el comunicado.");
      }
      if (editingCommunicationId === item.id) {
        resetCommunicationForm();
      }
      setSelectedPublicationDetail((current) =>
        current?.communication.id === item.id ? null : current
      );
      setNotice(body.mensaje || "Comunicado eliminado.");
      await loadDashboard();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "No se pudo borrar el comunicado."
      );
    } finally {
      setSaving("");
    }
  };

  const publishCommunication = async (communication: MarketingCommunication, channel: string) => {
    const channelAccess = getMarketingChannelAccess(channel);
    if (!channelAccess.allowed) {
      setNotice("");
      setError(channelAccess.message || "Tu plan actual no permite publicar en este canal.");
      return;
    }
    const publishLimitAccess = getUsageLimitAccess(
      MARKETING_USAGE_LIMIT_KEYS.socialPublishes,
      1
    );
    if (!publishLimitAccess.allowed) {
      setNotice("");
      setError(
        publishLimitAccess.message ||
          "Tu plan llego al limite mensual de publicaciones remotas."
      );
      return;
    }
    const mediaPolicy = getMediaPolicyStatus(
      [channel],
      communicationMediaForChannel(communication, channel)
    );
    if (mediaPolicy.blockers.length > 0) {
      setError(mediaPolicy.blockers[0]);
      editCommunication(communication);
      return;
    }
    const communicationId = communication.id;
    setSaving(`publish-${communicationId}-${channel}`);
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        `${MARKETING_API_BASE}/comunicados/${communicationId}/publicar/${channel}/`,
        { method: "POST" }
      );
      const body = (await readJsonResponse<{
        detail?: string;
        mensaje?: string;
      }>(response)) as {
        detail?: string;
        mensaje?: string;
      };
      if (!response.ok) {
        throw new Error(body.detail || "No se pudo publicar el comunicado.");
      }
      setNotice(body.mensaje || "Comunicado publicado.");
      await loadDashboard();
    } catch (publishError) {
      setError(
        publishError instanceof Error
          ? publishError.message
          : "No se pudo publicar el comunicado."
      );
    } finally {
      setSaving("");
    }
  };

  const deletePublication = async (publicationId: number) => {
    const publication = selectedPublicationDetail?.publication;
    const publicationAccess = publication
      ? getMarketingChannelAccess(publication.canal)
      : { allowed: true };
    if (!publicationAccess.allowed) {
      setNotice("");
      setError(publicationAccess.message || "Tu plan actual no permite esta accion.");
      return;
    }
    if (
      !window.confirm("Esta publicacion se borrara de Facebook. Esta accion no se puede deshacer.")
    ) {
      return;
    }
    setSaving(`publication-delete-${publicationId}`);
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        `${MARKETING_API_BASE}/publicaciones/${publicationId}/eliminar/`,
        { method: "POST" }
      );
      const body = (await readJsonResponse<{
        detail?: string;
        mensaje?: string;
      }>(response)) as {
        detail?: string;
        mensaje?: string;
      };
      if (!response.ok) {
        throw new Error(
          body.detail || "No se pudo borrar la publicacion."
        );
      }
      setSelectedPublicationDetail(null);
      setNotice(body.mensaje || "Publicacion eliminada.");
      await loadDashboard();
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "No se pudo borrar la publicacion."
      );
    } finally {
      setSaving("");
    }
  };

  const selectedPublicationAccess = selectedPublicationDetail
    ? getMarketingChannelAccess(selectedPublicationDetail.publication.canal)
    : { allowed: true };

  if (loading && !dashboard) {
    return (
      <section className="page-section">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 py-16 text-center text-zinc-500">
          Cargando marketing...
        </div>
      </section>
    );
  }

  return (
    <section className="page-section space-y-4">
      <MarketingInfoModal info={infoModal} onClose={() => setInfoModal(null)} />

      <div className="flex flex-col gap-4 border-b border-zinc-800 pb-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-white">Publicidad y marketing</h2>
            <MarketingInfoButton info={marketingInfo.modulo} onOpen={setInfoModal} />
          </div>
          <p className="mt-1 max-w-3xl text-sm text-zinc-500">
            Crea comunicados y publicaciones sociales usando los espacios disponibles
            como inventario comercial.
          </p>
        </div>
        <label className="block w-full xl:w-80">
          <FieldLabel
            label="Unidad de negocio"
            required
            info={marketingInfo.entidad}
            onInfo={setInfoModal}
          />
          <select
            value={selectedEntityId ?? ""}
            onChange={(event) => setSelectedEntityId(Number(event.target.value))}
            className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
          >
            {activeEntities.map((entidad) => (
              <option key={entidad.id} value={entidad.id}>
                {entidad.nombre_comercial}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {notice}
        </div>
      ) : null}
      {dashboard?.setup_required ? (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          {dashboard.setup_message ||
            "Falta aplicar migraciones para guardar marketing."}
        </div>
      ) : null}
      {knownPlan && !canUseSocialPublishing ? (
        <PlanUpgradeNotice
          title="Publicacion social no incluida"
          body="Puedes preparar comunicados y revisar inventario, pero conectar cuentas, publicar o borrar publicaciones remotas requiere un plan con publicacion social."
          requirement="Publicacion social"
        />
      ) : null}
      {knownPlan && canUseSocialPublishing && missingChannelFeatures.length > 0 ? (
        <PlanUpgradeNotice
          title="Canales limitados por tu plan"
          body={`Tu plan actual no incluye ${missingChannelFeatures
            .map((item) => item.label)
            .join(", ")}. Los canales disponibles siguen activos para preparar y publicar.`}
          requirement="Canales de marketing"
        />
      ) : null}

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
            Resumen operativo
          </p>
          <MarketingInfoButton info={marketingInfo.resumen} onOpen={setInfoModal} />
        </div>
        <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
          <Metric label="Canales activos" value={dashboard?.summary.canales_activos || 0} tone="cyan" />
          <Metric label="Comunicados" value={communications.length} tone="emerald" />
          <Metric label="Programados" value={dashboard?.summary.comunicados_programados || 0} tone="blue" />
          <Metric label="Espacios disponibles" value={dashboard?.summary.espacios_disponibles || 0} tone="amber" />
        </div>
        {marketingUsage ? <MarketingUsageSummary usage={marketingUsage} /> : null}
      </div>

      <div className="work-tab-bar">
        {tabs.map((tab) => (
          <div key={tab.value} className="relative">
            <button
              type="button"
              onClick={() => selectTab(tab.value)}
              className={`work-tab pr-10 ${
                activeTab === tab.value
                  ? "work-tab-active"
                  : "work-tab-idle"
              }`}
            >
              <span>{tab.label}</span>
              {activeTab === tab.value ? (
                <span className="work-tab-helper">{tab.detail}</span>
              ) : null}
            </button>
            <MarketingInfoButton
              info={marketingTabInfo[tab.value]}
              onOpen={setInfoModal}
              className="absolute right-2 top-1/2 -translate-y-1/2"
            />
          </div>
        ))}
      </div>

      {activeTab === "comunicados" ? (
        <div className="grid gap-5 xl:grid-cols-[420px_1fr]">
          <form
            onSubmit={saveCommunication}
            className={`relative rounded-2xl border border-zinc-800 bg-zinc-950/80 p-5 ${
              timePickerOpen ? "z-50" : "z-0"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-semibold text-white">
                    {editingCommunicationId ? "Editar comunicado" : "Nuevo comunicado"}
                  </h3>
                  <MarketingInfoButton
                    info={marketingInfo.formulario}
                    onOpen={setInfoModal}
                  />
                </div>
                {editingCommunicationId ? (
                  <p className="mt-1 text-xs text-cyan-300">
                    Actualizando comunicado #{editingCommunicationId}
                  </p>
                ) : null}
              </div>
              {editingCommunicationId ? (
                <button
                  type="button"
                  onClick={resetCommunicationForm}
                  className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
                >
                  Cancelar
                </button>
              ) : null}
            </div>
            <div className="mt-4 space-y-3">
              <label className="block text-sm text-zinc-300">
                <FieldLabel
                  label="Espacio"
                  info={marketingInfo.espacio}
                  onInfo={setInfoModal}
                />
                <select
                  value={selectedSpaceId}
                  onChange={(event) => {
                    const value = event.target.value ? Number(event.target.value) : "";
                    setSelectedSpaceId(value);
                    const nextSpace = availableSpaces.find((space) => space.id === value);
                    if (nextSpace && nextSpace.entidad_id !== selectedEntityId) {
                      setSelectedEntityId(nextSpace.entidad_id);
                    }
                    setCommunicationText("");
                  }}
                  className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-white outline-none focus:ring-1 focus:ring-cyan-500"
                >
                  <option value="">Comunicado general</option>
                  {availableSpaces.map((space) => (
                    <option key={space.id} value={space.id}>
                      {space.entidad_nombre ? `${space.entidad_nombre} - ` : ""}
                      {space.codigo} - {space.titulo_publico}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm text-zinc-300">
                <FieldLabel
                  label="Titulo"
                  required
                  info={marketingInfo.titulo}
                  onInfo={setInfoModal}
                />
                <input
                  value={communicationTitle}
                  onChange={(event) =>
                    setCommunicationTitle(
                      cleanSingleLineText(
                        event.target.value,
                        COMMUNICATION_TITLE_MAX
                      )
                    )
                  }
                  maxLength={COMMUNICATION_TITLE_MAX}
                  className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-white outline-none focus:ring-1 focus:ring-cyan-500"
                  placeholder="Ej. Habitacion disponible en Roma Norte"
                />
                {communicationFieldError("titulo") ? (
                  <FieldHelp tone="error">{communicationFieldError("titulo")}</FieldHelp>
                ) : (
                  <FieldHelp>{`${communicationTitle.length}/${COMMUNICATION_TITLE_MAX} caracteres.`}</FieldHelp>
                )}
              </label>
              <label className="block text-sm text-zinc-300">
                <FieldLabel
                  label="Texto"
                  required
                  info={marketingInfo.texto}
                  onInfo={setInfoModal}
                />
                <textarea
                  value={communicationText}
                  onChange={(event) =>
                    setCommunicationText(
                      cleanMultilineText(event.target.value, COMMUNICATION_TEXT_MAX)
                    )
                  }
                  maxLength={COMMUNICATION_TEXT_MAX}
                  rows={8}
                  className="mt-1 w-full resize-none rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-white outline-none focus:ring-1 focus:ring-cyan-500"
                  placeholder="Escribe el copy base para redes sociales."
                />
                {communicationFieldError("texto") ? (
                  <FieldHelp tone="error">{communicationFieldError("texto")}</FieldHelp>
                ) : (
                  <FieldHelp>{`${communicationText.length}/${COMMUNICATION_TEXT_MAX} caracteres. Minimo ${COMMUNICATION_TEXT_MIN}.`}</FieldHelp>
                )}
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm text-zinc-300">
                  <FieldLabel
                    label="Formato"
                    required
                    info={marketingInfo.formato}
                    onInfo={setInfoModal}
                  />
                  <select
                    value={communicationFormat}
                    onChange={(event) => setCommunicationFormat(event.target.value)}
                    className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-white outline-none focus:ring-1 focus:ring-cyan-500"
                  >
                    <option value="MIXTO">Texto + media</option>
                    <option value="IMAGEN">Imagen</option>
                    <option value="VIDEO">Video</option>
                    <option value="TEXTO">Texto</option>
                  </select>
                  {communicationFieldError("formato") ? (
                    <FieldHelp tone="error">{communicationFieldError("formato")}</FieldHelp>
                  ) : null}
                </label>
                <label className="block text-sm text-zinc-300">
                  <FieldLabel
                    label="Estado"
                    required
                    info={marketingInfo.estado}
                    onInfo={setInfoModal}
                  />
                  <select
                    value={communicationStatus}
                    onChange={(event) => setCommunicationStatus(event.target.value)}
                    className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-white outline-none focus:ring-1 focus:ring-cyan-500"
                  >
                    <option value="BORRADOR">Borrador</option>
                    <option value="LISTO">Listo</option>
                    <option value="PROGRAMADO">Programado</option>
                  </select>
                  {communicationFieldError("estado") ? (
                    <FieldHelp tone="error">{communicationFieldError("estado")}</FieldHelp>
                  ) : null}
                </label>
              </div>
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-zinc-200">
                        Fecha programada
                      </p>
                      <MarketingInfoButton
                        info={marketingInfo.fecha}
                        onOpen={setInfoModal}
                      />
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-zinc-500">
                      Elige el dia y despues la hora de publicacion.
                    </p>
                  </div>
                  {scheduledAt ? (
                    <button
                      type="button"
                      onClick={() => {
                        setScheduledAt("");
                        setTimePickerOpen(false);
                      }}
                      className="rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:text-white"
                    >
                      Limpiar
                    </button>
                  ) : null}
                </div>
                <div className="mt-3 grid gap-3 lg:grid-cols-[180px_1fr]">
                  <label className="block text-xs uppercase tracking-[0.16em] text-zinc-500">
                    Dia {communicationStatus === "PROGRAMADO" ? "obligatorio" : "opcional"}
                    <input
                      type="date"
                      value={selectedScheduleDate}
                      onChange={(event) => updateScheduledDate(event.target.value)}
                      className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                    />
                  </label>
                  <div className="relative z-50">
                    <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">Hora</p>
                    <button
                      type="button"
                      onClick={() => {
                        if (!selectedScheduleDate) {
                          updateScheduledTime(selectedScheduleTime);
                        }
                        setTimePickerOpen((current) => !current);
                      }}
                      className="mt-1 flex w-full items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-left transition-colors hover:border-cyan-500/30"
                    >
                      <span>
                        <span className="block text-lg font-semibold text-white">
                          {formatScheduleTime(selectedScheduleTime)}
                        </span>
                        <span className="text-xs text-zinc-500">
                          {timePickerOpen ? "Seleccionando hora" : "Tocar para elegir hora"}
                        </span>
                      </span>
                      <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-xs font-medium text-cyan-200">
                        Reloj
                      </span>
                    </button>
                    {timePickerOpen ? (
                      <div className="absolute right-0 top-full z-[80] mt-3 w-[min(26rem,calc(100vw-3rem))] rounded-2xl border border-zinc-800 bg-zinc-950 p-4 shadow-2xl shadow-black/50">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-full border border-cyan-500/25 bg-cyan-500/10 text-center">
                            <div>
                              <p className="text-2xl font-semibold text-cyan-100">
                                {`${String(selectedClockParts.hour12).padStart(2, "0")}:${selectedClockParts.minute}`}
                              </p>
                              <p className="text-xs font-medium text-cyan-300">
                                {selectedClockParts.period === "PM" ? "p.m." : "a.m."}
                              </p>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            {["AM", "PM"].map((period) => (
                              <button
                                key={period}
                                type="button"
                                onClick={() => updateClockPeriod(period)}
                                className={`rounded-xl border px-4 py-2 text-sm font-semibold transition-colors ${
                                  selectedClockParts.period === period
                                    ? "border-cyan-500/30 bg-cyan-500/10 text-cyan-200"
                                    : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white"
                                }`}
                              >
                                {period === "PM" ? "p.m." : "a.m."}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="mt-4">
                          <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">
                            Hora
                          </p>
                          <div className="mt-2 grid grid-cols-6 gap-2">
                            {scheduleHourOptions.map((hour) => (
                              <button
                                key={hour}
                                type="button"
                                onClick={() => updateClockHour(hour)}
                                className={`aspect-square rounded-full border text-sm font-semibold transition-colors ${
                                  selectedClockParts.hour12 === hour
                                    ? "border-cyan-500/40 bg-cyan-500 text-zinc-950"
                                    : "border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-cyan-500/30 hover:text-white"
                                }`}
                              >
                                {hour}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="mt-4">
                          <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">
                            Minutos
                          </p>
                          <div className="mt-2 grid grid-cols-4 gap-2">
                            {scheduleMinuteOptions.map((minute) => (
                              <button
                                key={minute}
                                type="button"
                                onClick={() => updateClockMinute(minute)}
                                className={`rounded-xl border px-3 py-2 text-sm font-semibold transition-colors ${
                                  selectedClockParts.minute === minute
                                    ? "border-cyan-500/30 bg-cyan-500/10 text-cyan-200"
                                    : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white"
                                }`}
                              >
                                :{minute}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="mt-4 flex justify-end">
                          <button
                            type="button"
                            onClick={() => setTimePickerOpen(false)}
                            className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20"
                          >
                            Listo
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
                {communicationFieldError("fecha") ? (
                  <FieldHelp tone="error">{communicationFieldError("fecha")}</FieldHelp>
                ) : null}
              </div>
              <ChannelPicker
                channels={configuredChannels}
                selectedChannels={selectedChannels}
                onToggle={toggleChannel}
                onInfo={setInfoModal}
                error={communicationFieldError("canales")}
              />
              {configuredChannels.length === 0 ? (
                <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">
                  Conecta al menos una red social para preparar multimedia por canal.
                </div>
              ) : null}
              {configuredChannels.length > 0 && selectedConfiguredChannels.length === 0 ? (
                <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">
                  Selecciona una red conectada para habilitar su contenido.
                </div>
              ) : null}
              {selectedConfiguredChannels.map((channel) => {
                const mediaUrls = channelMediaForSave[channel.canal] || [];
                const mediaPolicy = getMediaPolicyStatus([channel.canal], mediaUrls);
                const inputValue = channelMediaInputs[channel.canal] || "";
                const mediaRule = getChannelMediaRule(channel.canal);
                const manualMediaCount = (channelMediaUrls[channel.canal] || []).length;
                const mediaLimitAccess = getUsageLimitAccess(
                  MARKETING_USAGE_LIMIT_KEYS.mediaAssets,
                  1
                );
                return (
                  <div
                    key={channel.canal}
                    className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
                            Multimedia | {channel.label}
                          </p>
                          <MarketingInfoButton
                            info={marketingInfo.multimedia}
                            onOpen={setInfoModal}
                            className="h-5 w-5 text-[10px]"
                          />
                        </div>
                        <p className="mt-1 text-sm font-medium text-zinc-200">
                          {mediaUrls.length}/{MAX_CHANNEL_MEDIA} cargado
                        </p>
                        <p className="mt-1 text-xs leading-relaxed text-zinc-500">
                          {mediaRule.description}
                        </p>
                      </div>
                      <label
                        className={`rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-200 transition-colors hover:bg-cyan-500/20 ${
                          !mediaLimitAccess.allowed || manualMediaCount >= MAX_CHANNEL_MEDIA
                            ? "cursor-not-allowed opacity-50"
                            : "cursor-pointer"
                        }`}
                      >
                        {saving === "communication-media" ? "Subiendo..." : "Agregar"}
                        <input
                          type="file"
                          accept={mediaRule.accept}
                          className="hidden"
                          disabled={
                            saving === "communication-media" ||
                            manualMediaCount >= MAX_CHANNEL_MEDIA ||
                            !mediaLimitAccess.allowed
                          }
                          onChange={(event) => {
                            void uploadCommunicationMedia(channel.canal, event.target.files);
                            event.target.value = "";
                          }}
                        />
                      </label>
                    </div>
                    <div
                      onDragOver={(event) => {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "copy";
                      }}
                      onDrop={(event) => handleCommunicationMediaDrop(channel.canal, event)}
                      className="mt-3 rounded-2xl border border-dashed border-zinc-700 bg-zinc-950/70 p-3 transition-colors hover:border-cyan-500/40"
                    >
                      <div className="flex flex-col gap-2 text-xs text-zinc-500 sm:flex-row sm:items-center sm:justify-between">
                        <span>Suelta el archivo aqui o usa el boton.</span>
                        <span className="rounded-full border border-zinc-800 px-2 py-1 text-zinc-400">
                          Regla del canal
                        </span>
                      </div>
                      <div className="mt-3 grid grid-cols-1 gap-3">
                        {mediaUrls.length === 0 ? (
                          <div className="rounded-xl border border-dashed border-zinc-800 py-7 text-center text-sm text-zinc-500">
                            {mediaRule.emptyText}
                          </div>
                        ) : (
                          mediaUrls.map((url, index) => {
                            const isVideo = isVideoMediaUrl(url);
                            const isAutomatic =
                              selectedSpace?.cover_url === url &&
                              ["FACEBOOK", "INSTAGRAM"].includes(channel.canal);
                            return (
                              <div
                                key={url}
                                className="group relative aspect-[4/3] overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900"
                              >
                                {isVideo ? (
                                  <div className="flex h-full flex-col items-center justify-center px-2 text-center text-xs text-zinc-400">
                                    <span className="text-lg font-semibold text-cyan-200">
                                      VIDEO
                                    </span>
                                    <span className="mt-1 line-clamp-2">{mediaLabel(url)}</span>
                                  </div>
                                ) : (
                                  <img
                                    src={url}
                                    alt={mediaLabel(url)}
                                    className="h-full w-full object-cover"
                                  />
                                )}
                                <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-2">
                                  <span className="rounded-full bg-cyan-500/90 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-950 shadow-lg">
                                    {index === 0 ? "Principal" : isVideo ? "Video" : "Imagen"}
                                  </span>
                                  {isAutomatic ? (
                                    <span className="rounded-full bg-emerald-500/90 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-950">
                                      Auto
                                    </span>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setChannelMediaUrls((current) => ({
                                          ...current,
                                          [channel.canal]: (current[channel.canal] || []).filter(
                                            (item) => item !== url
                                          ),
                                        }))
                                      }
                                      className="rounded-full bg-red-500/90 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-white opacity-0 transition-opacity group-hover:opacity-100"
                                    >
                                      Quitar
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                    <div className="mt-3 flex gap-2">
                      <input
                        type="url"
                        inputMode="url"
                        value={inputValue}
                        onChange={(event) =>
                          setChannelMediaInputs((current) => ({
                            ...current,
                            [channel.canal]: cleanSingleLineText(
                              event.target.value,
                              COMMUNICATION_MEDIA_URL_MAX
                            ),
                          }))
                        }
                        maxLength={COMMUNICATION_MEDIA_URL_MAX}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            addCommunicationMediaUrl(channel.canal);
                          }
                        }}
                        className="min-w-0 flex-1 rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                        placeholder="https://.../archivo"
                      />
                      <MarketingInfoButton
                        info={marketingInfo.mediaUrl}
                        onOpen={setInfoModal}
                        className="mt-2 h-5 w-5 text-[10px]"
                      />
                      <button
                        type="button"
                        onClick={() => addCommunicationMediaUrl(channel.canal)}
                        disabled={manualMediaCount >= MAX_CHANNEL_MEDIA}
                        className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Agregar URL
                      </button>
                    </div>
                    <div className="mt-3 space-y-2">
                      {inputValue.length >= COMMUNICATION_MEDIA_URL_MAX ? (
                        <p className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                          La URL llego al limite de {COMMUNICATION_MEDIA_URL_MAX} caracteres.
                        </p>
                      ) : null}
                      {mediaPolicy.blockers.map((message) => (
                        <p
                          key={message}
                          className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-100"
                        >
                          {message}
                        </p>
                      ))}
                      {!mediaLimitAccess.allowed ? (
                        <p className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                          {mediaLimitAccess.message}
                        </p>
                      ) : null}
                      {mediaPolicy.warnings.map((message) => (
                        <p
                          key={message}
                          className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-100"
                        >
                          {message}
                        </p>
                      ))}
                      {mediaPolicy.blockers.length === 0 && mediaUrls.length > 0 ? (
                        <p className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
                          Contenido compatible para {channel.label}.
                        </p>
                      ) : null}
                    </div>
                  </div>
                );
              })}
              {communicationFieldError("multimedia") ? (
                <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                  {communicationFieldError("multimedia")}
                </div>
              ) : null}
              {!communicationSaveLimitAccess.allowed ? (
                <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                  {communicationSaveLimitAccess.message}
                </div>
              ) : null}
              <button
                type="submit"
                disabled={saving === "communication" || !communicationSaveLimitAccess.allowed}
                className="w-full rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-2.5 text-sm font-semibold text-cyan-200 transition-colors hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving === "communication"
                  ? "Guardando..."
                  : !communicationSaveLimitAccess.allowed
                    ? `Requiere ${communicationSaveLimitAccess.requirement || "upgrade"}`
                  : editingCommunicationId
                    ? "Actualizar comunicado"
                    : "Guardar comunicado"}
              </button>
            </div>
          </form>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80">
            <ListHeader
              title="Comunicados recientes"
              count={dashboard?.communications.length || 0}
              info={marketingInfo.recientes}
              onInfo={setInfoModal}
            />
            <div className="flex flex-col gap-2 border-b border-zinc-800 px-4 py-3 text-sm text-zinc-500 md:flex-row md:items-center md:justify-between">
              <span>
                {communications.length
                  ? `Mostrando ${communicationsShowingFrom}-${communicationsShowingTo} de ${communications.length}`
                  : "Sin registros"}
              </span>
              <span>10 por pagina</span>
            </div>
            <div className="divide-y divide-zinc-800">
              {pagedCommunications.map((item) => {
                const publishableChannels = item.canales.filter((channel) =>
                  ["FACEBOOK", "INSTAGRAM"].includes(channel) &&
                  configuredChannelCodes.includes(channel)
                );
                const itemMediaHasIssues = item.canales.some((channel) =>
                  getMediaPolicyStatus(
                    [channel],
                    communicationMediaForChannel(item, channel)
                  ).blockers.length > 0
                );
                return (
                  <div key={item.id} className="p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-white">{item.titulo}</p>
                        <p className="mt-1 text-xs text-zinc-500">
                          {item.espacio_codigo || "General"} |{" "}
                          {compactChannelLabels(item.canales, dashboard?.channels || [])}
                        </p>
                        <p className="mt-1 text-xs text-zinc-600">
                          Actualizado {formatDateTime(item.fecha_actualizacion)}
                        </p>
                      </div>
                      <span className={`rounded-full border px-2.5 py-1 text-xs ${statusStyles(item.estatus)}`}>
                        {item.estatus}
                      </span>
                    </div>
                    <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-zinc-400">
                      {item.texto}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                      {item.media_urls.length > 0 ? (
                        <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-emerald-200">
                          {item.media_urls.length} media
                        </span>
                      ) : (
                        <span className="rounded-full border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-zinc-500">
                          sin media
                        </span>
                      )}
                      {itemMediaHasIssues ? (
                        <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-amber-200">
                          Revisar multimedia
                        </span>
                      ) : null}
                    </div>
                    {item.publicaciones.length > 0 ? (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {item.publicaciones.map((publication) => (
                          <button
                            key={publication.id}
                            type="button"
                            onClick={() =>
                              setSelectedPublicationDetail({
                                communication: item,
                                publication,
                              })
                            }
                            className={`flex h-10 w-10 items-center justify-center rounded-full border text-xs font-bold transition-transform hover:scale-105 ${channelIconStyles(
                              publication.canal,
                              publication.estatus
                            )}`}
                            title={`${publication.label}: ${publication.estatus}`}
                            aria-label={`Ver detalle de ${publication.label}`}
                          >
                            {channelIconLabel(publication.canal)}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    {publishableChannels.length > 0 ? (
                      <div className="mt-4 flex flex-wrap gap-2">
                        {publishableChannels.map((channel) => {
                          const publication = item.publicaciones.find(
                            (candidate) => candidate.canal === channel
                          );
                          const isPublished = publication?.estatus === "PUBLICADA";
                          const channelMediaPolicy = getMediaPolicyStatus(
                            [channel],
                            communicationMediaForChannel(item, channel)
                          );
                          const blockedByMedia = channelMediaPolicy.blockers.length > 0;
                          const channelAccess = getMarketingChannelAccess(channel);
                          const publishLimitAccess = getUsageLimitAccess(
                            MARKETING_USAGE_LIMIT_KEYS.socialPublishes,
                            1
                          );
                          const label =
                            (dashboard?.channels || []).find((candidate) => candidate.canal === channel)
                              ?.label || channel;
                          return (
                            <button
                              key={channel}
                              type="button"
                              onClick={() => void publishCommunication(item, channel)}
                              disabled={
                                saving === `publish-${item.id}-${channel}` ||
                                isPublished ||
                                blockedByMedia ||
                                !channelAccess.allowed ||
                                !publishLimitAccess.allowed
                              }
                              className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-200 transition-colors hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {saving === `publish-${item.id}-${channel}`
                                ? "Publicando..."
                                : isPublished
                                  ? `Publicado en ${label}`
                                  : !channelAccess.allowed
                                    ? `Requiere ${channelAccess.requirement || "upgrade"}`
                                  : !publishLimitAccess.allowed
                                    ? `Requiere ${publishLimitAccess.requirement || "upgrade"}`
                                  : blockedByMedia
                                    ? "Revisar multimedia"
                                  : `Publicar en ${label}`}
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                    <div className="mt-4 flex flex-wrap gap-2 border-t border-zinc-900 pt-3">
                      <button
                        type="button"
                        onClick={() => editCommunication(item)}
                        className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-3 py-2 text-xs font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => copyCommunication(item)}
                        className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
                      >
                        Copiar
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteCommunication(item)}
                        disabled={saving === `communication-delete-${item.id}`}
                        className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-200 transition-colors hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {saving === `communication-delete-${item.id}` ? "Borrando..." : "Borrar"}
                      </button>
                    </div>
                  </div>
                );
              })}
              {communications.length === 0 ? (
                <EmptyState text="Todavia no hay comunicados guardados." />
              ) : null}
            </div>
            {communications.length > COMMUNICATIONS_PAGE_SIZE ? (
              <PaginationFooter
                page={safeCommunicationsPage}
                totalPages={communicationsTotalPages}
                visiblePages={visibleCommunicationPages}
                onChangePage={setCommunicationsPage}
              />
            ) : null}
          </div>
        </div>
      ) : null}

      {activeTab === "calendario" ? (
        <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950/80">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-white">Calendario editorial</p>
                <MarketingInfoButton
                  info={marketingInfo.calendario}
                  onOpen={setInfoModal}
                  className="h-5 w-5 text-[10px]"
                />
              </div>
              <p className="text-xs text-zinc-500">
                {scheduledCommunications.length} publicaciones programadas en{" "}
                {selectedEntity?.nombre_comercial || "esta entidad"}.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={jumpCalendarToToday}
                className="rounded-xl border border-cyan-500/25 bg-cyan-500/10 px-3 py-2 text-sm font-medium text-cyan-100 transition-colors hover:bg-cyan-500/20"
              >
                Hoy
              </button>
              <button
                type="button"
                onClick={() => moveCalendarMonth(-1)}
                className="flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900 text-lg text-zinc-300 transition-colors hover:text-white"
                aria-label="Mes anterior"
              >
                {"<"}
              </button>
              <div className="min-w-[190px] rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-center text-sm font-medium capitalize text-white">
                {monthLabel(calendarMonth)}
              </div>
              <button
                type="button"
                onClick={() => moveCalendarMonth(1)}
                className="flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900 text-lg text-zinc-300 transition-colors hover:text-white"
                aria-label="Mes siguiente"
              >
                {">"}
              </button>
            </div>
          </div>
          <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="min-w-0">
              <div className="grid grid-cols-7 border-b border-zinc-800 bg-zinc-900/30 text-center text-[11px] uppercase tracking-[0.16em] text-zinc-500">
                {weekdayLabels.map((day) => (
                  <div key={day} className="px-2 py-2">
                    {day}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7">
                {calendarCells.map((cell) => (
                  <button
                    key={cell.key}
                    type="button"
                    onClick={() => setSelectedCalendarDate(cell.key)}
                    className={`min-h-32 border-b border-r border-zinc-900 p-2 text-left transition-colors ${
                      cell.inMonth ? "bg-zinc-950/60" : "bg-zinc-950/25 text-zinc-700"
                    } ${cell.isSelected ? "ring-1 ring-inset ring-cyan-400/70" : "hover:bg-zinc-900/40"}`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span
                        className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
                          cell.isToday
                            ? "bg-cyan-500 text-zinc-950"
                            : cell.isSelected
                              ? "bg-zinc-800 text-white"
                              : cell.inMonth
                                ? "text-zinc-300"
                                : "text-zinc-700"
                        }`}
                      >
                        {cell.day}
                      </span>
                      {cell.items.length > 0 ? (
                        <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2 py-0.5 text-[10px] text-cyan-200">
                          {cell.items.length}
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-2 block space-y-1">
                      {cell.items.slice(0, 3).map((item) => (
                        <span
                          key={item.id}
                          className="block rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-2 py-1"
                        >
                          <span className="block text-[11px] font-semibold text-cyan-100">
                            {localTimeLabel(item.fecha_programada)}
                          </span>
                          <span className="block truncate text-[11px] text-zinc-300">
                            {item.titulo}
                          </span>
                        </span>
                      ))}
                      {cell.items.length > 3 ? (
                        <span className="block rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-500">
                          +{cell.items.length - 3} mas
                        </span>
                      ) : null}
                      {cell.inMonth && cell.items.length === 0 ? (
                        <span className="block rounded-lg border border-dashed border-zinc-800 px-2 py-1 text-[11px] text-zinc-500">
                          Sin publicaciones
                        </span>
                      ) : null}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <aside className="border-t border-zinc-800 bg-zinc-950/70 p-4 lg:border-l lg:border-t-0">
              <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                Dia seleccionado
              </p>
              <h3 className="mt-2 text-lg font-semibold text-white">
                {dateInputLabel(selectedCalendarDate)}
              </h3>
              <p className="mt-1 text-sm text-zinc-500">
                {selectedCalendarDayItems.length
                  ? `${selectedCalendarDayItems.length} publicacion${
                      selectedCalendarDayItems.length === 1 ? "" : "es"
                    } programada${selectedCalendarDayItems.length === 1 ? "" : "s"}.`
                  : "Sin publicaciones programadas."}
              </p>
              <div className="mt-4 space-y-2">
                {selectedCalendarDayItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => editCommunication(item)}
                    className="w-full rounded-2xl border border-zinc-800 bg-zinc-900/70 px-4 py-3 text-left transition-colors hover:border-cyan-500/30"
                  >
                    <span className="text-xs font-semibold text-cyan-200">
                      {localTimeLabel(item.fecha_programada)}
                    </span>
                    <span className="mt-1 block text-sm font-medium text-white">
                      {item.titulo}
                    </span>
                    <span className="mt-2 flex flex-wrap gap-1.5">
                      {item.canales.map((channel) => (
                        <span
                          key={channel}
                          className={`rounded-full border px-2 py-0.5 text-[10px] ${calendarChannelStyles(channel)}`}
                        >
                          {channelIconLabel(channel)}
                        </span>
                      ))}
                    </span>
                  </button>
                ))}
              </div>
              <div className="mt-4 grid gap-2">
                <button
                  type="button"
                  onClick={() => startCommunicationForDate(selectedCalendarDate)}
                  className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20"
                >
                  Programar comunicado
                </button>
                <button
                  type="button"
                  onClick={() => selectTab("espacios")}
                  className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-2 text-sm text-zinc-300 transition-colors hover:text-white"
                >
                  Ver espacios disponibles
                </button>
              </div>
            </aside>
          </div>
          <div className="border-t border-zinc-800 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-white">Proximas publicaciones</p>
                <p className="text-xs text-zinc-500">
                  Ordenadas por fecha para revisar la agenda sin entrar dia por dia.
                </p>
              </div>
            </div>
            <div className="mt-3 divide-y divide-zinc-800 rounded-2xl border border-zinc-800 bg-zinc-950/70">
              {scheduledCommunications.slice(0, 8).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => editCommunication(item)}
                  className="grid w-full gap-2 px-4 py-3 text-left text-sm transition-colors hover:bg-zinc-900/50 md:grid-cols-[150px_1fr_190px]"
                >
                  <span className="font-medium text-cyan-200">
                    {formatDateTime(item.fecha_programada)}
                  </span>
                  <span className="text-white">{item.titulo}</span>
                  <span className="text-zinc-500">
                    {compactChannelLabels(item.canales, dashboard?.channels || [])}
                  </span>
                </button>
              ))}
              {scheduledCommunications.length === 0 ? (
                <EmptyState text="No hay comunicados programados." />
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === "espacios" ? (
        <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950/80">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-white">
                  Tabla de espacios para promocion
                </p>
                <MarketingInfoButton
                  info={marketingInfo.espacios}
                  onOpen={setInfoModal}
                  className="h-5 w-5 text-[10px]"
                />
              </div>
              <p className="text-xs text-zinc-500">
                Mostrando {availableSpaces.length > 0 ? `1-${availableSpaces.length}` : "0"} de{" "}
                {availableSpaces.length} espacios disponibles
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setSelectedSpaceId("");
                setCommunicationTitle("");
                setCommunicationText("");
                setActiveTab("comunicados");
              }}
              className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20"
            >
              Comunicado general
            </button>
          </div>
          {availableSpaces.length === 0 ? (
            <EmptyState text="No hay espacios disponibles para promocionar." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1180px] text-left text-sm text-zinc-300">
                <thead className="border-b border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="py-3 pl-4 pr-4">Espacio</th>
                    <th className="py-3 pr-4">Ficha comercial</th>
                    <th className="py-3 pr-4">Oportunidad</th>
                    <th className="py-3 pr-4">Publicacion por canal</th>
                    <th className="py-3 pr-4">Preparacion</th>
                    <th className="py-3 pr-4 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {availableSpaces.map((space) => {
                    const missing = getSpaceMissingItems(space);
                    const isReady = missing.length === 0;
                    return (
                      <tr key={space.id} className="align-top hover:bg-zinc-900/40">
                        <td className="py-4 pl-4 pr-4">
                          <div className="flex items-start gap-3">
                            <div className="h-14 w-14 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
                              {space.cover_url ? (
                                <img
                                  src={space.cover_url}
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
                              <p className="font-semibold text-white">{space.codigo}</p>
                              <p className="mt-0.5 text-xs text-cyan-200/80">
                                {space.entidad_nombre || "Sin entidad"}
                              </p>
                              <p className="mt-1 text-xs text-zinc-500">
                                {space.tipo_nombre || "Sin tipo"} | {formatMoney(space.renta_publicable)}
                              </p>
                              <span
                                className={`mt-2 inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium ${statusStyles(
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
                          <p className="mt-1 max-w-sm text-xs leading-relaxed text-zinc-500">
                            {space.resumen_publico || space.descripcion_publica || "Sin resumen comercial."}
                          </p>
                          <p className="mt-2 text-xs text-zinc-500">{getSpaceSpecs(space)}</p>
                        </td>
                        <td className="py-4 pr-4">
                          <p className="font-semibold text-emerald-300">
                            {formatMoney(space.renta_publicable)}
                          </p>
                          <p className="mt-1 max-w-xs text-xs leading-relaxed text-zinc-500">
                            {isReady
                              ? "Listo para convertir en comunicado y publicar en canales conectados."
                              : "Puede promocionarse, pero conviene completar la ficha antes de pautar."}
                          </p>
                        </td>
                        <td className="py-4 pr-4">
                          <div className="flex max-w-sm flex-col gap-2">
                            {space.publication_statuses.length > 0 ? (
                              space.publication_statuses.map((status) => (
                                <div
                                  key={status.canal}
                                  className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-3 py-2"
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-xs font-semibold text-zinc-200">
                                      {status.label}
                                    </span>
                                    <span
                                      className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${statusStyles(
                                        status.estatus
                                      )}`}
                                    >
                                      {publicationStatusLabel(status.estatus)}
                                    </span>
                                  </div>
                                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-500">
                                    {status.comunicado_titulo ? (
                                      <span className="line-clamp-1 max-w-[14rem]">
                                        {status.comunicado_titulo}
                                      </span>
                                    ) : (
                                      <span>Sin pieza comercial</span>
                                    )}
                                    {status.media_count > 0 ? (
                                      <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-emerald-200">
                                        {status.media_count} media
                                      </span>
                                    ) : null}
                                    {!status.media_ready && status.blockers.length > 0 ? (
                                      <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-amber-200">
                                        Requiere ajuste
                                      </span>
                                    ) : null}
                                  </div>
                                </div>
                              ))
                            ) : (
                              <span className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-xs text-zinc-500">
                                Sin canales disponibles
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-4 pr-4">
                          <div className="flex max-w-md flex-wrap gap-2">
                            {isReady ? (
                              <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] text-emerald-200">
                                Lista para comunicar
                              </span>
                            ) : (
                              <>
                                {missing.slice(0, 4).map((item) => (
                                  <span
                                    key={item}
                                    className="rounded-full border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-[11px] text-zinc-400"
                                  >
                                    {item}
                                  </span>
                                ))}
                                {missing.length > 4 ? (
                                  <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-[11px] text-zinc-400">
                                    +{missing.length - 4}
                                  </span>
                                ) : null}
                              </>
                            )}
                          </div>
                        </td>
                        <td className="py-4 pr-4 text-right">
                          <button
                            type="button"
                            onClick={() => {
                              if (space.entidad_id !== selectedEntityId) {
                                setSelectedEntityId(space.entidad_id);
                              }
                              setSelectedSpaceId(space.id);
                              setCommunicationTitle(
                                cleanSingleLineText(
                                  `Promocion ${space.codigo}`,
                                  COMMUNICATION_TITLE_MAX
                                )
                              );
                              setCommunicationText(
                                cleanMultilineText(
                                  buildSpacePost(
                                    space,
                                    space.entidad_nombre || dashboard?.entidad.nombre_comercial || "BetterP"
                                  ),
                                  COMMUNICATION_TEXT_MAX
                                )
                              );
                              setActiveTab("comunicados");
                            }}
                            className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20"
                          >
                            Crear comunicado
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      {activeTab === "commerce" ? (
        <CommerceSubjectSelector entityId={selectedEntityId} />
      ) : null}

      {activeTab === "conexiones" ? (
        <div className="space-y-5">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
                Resumen de conexiones
              </p>
              <MarketingInfoButton info={marketingInfo.conexiones} onOpen={setInfoModal} />
            </div>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Canales</p>
                <p className="mt-2 text-2xl font-semibold text-white">{orderedChannels.length}</p>
              </div>
              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-emerald-200/80">
                  Conectados
                </p>
                <p className="mt-2 text-2xl font-semibold text-emerald-300">
                  {orderedChannels.filter((channel) => channel.estatus === "CONECTADO").length}
                </p>
              </div>
              <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-cyan-200/80">
                  Activos
                </p>
                <p className="mt-2 text-2xl font-semibold text-cyan-300">
                  {orderedChannels.filter((channel) => channel.activo).length}
                </p>
              </div>
              <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-amber-200/80">
                  Pendientes
                </p>
                <p className="mt-2 text-2xl font-semibold text-amber-300">
                  {orderedChannels.filter((channel) => channel.estatus !== "CONECTADO").length}
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-5 xl:grid-cols-[360px_1fr]">
            <div className="space-y-3">
              <div className="flex items-center gap-2 px-1">
                <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
                  Canales disponibles
                </p>
                <MarketingInfoButton info={marketingInfo.conexiones} onOpen={setInfoModal} />
              </div>
              {orderedChannels.map((channel, index) => {
                const guide = getConnectionGuide(channel.canal);
                const isReady = Boolean(channel.credenciales.access_token_configurado);
                const isAuthorized =
                  isReady ||
                  channel.estatus === "AUTORIZADO" ||
                  Boolean(channel.credenciales.token_usuario_configurado);
                return (
                  <button
                    key={channel.canal}
                    type="button"
                    onClick={() => setSelectedConnectionCode(channel.canal)}
                    className={`w-full rounded-2xl border p-4 text-left transition-colors ${
                      selectedConnectionChannel?.canal === channel.canal
                        ? "border-cyan-500/30 bg-cyan-500/10"
                        : "border-zinc-800 bg-zinc-950/70 hover:border-zinc-700"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">
                          Canal {index + 1}
                        </p>
                        <p className="mt-1 text-sm font-semibold text-white">
                          {channel.label}
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
                      {isAuthorized
                        ? channel.credenciales.page_name || "Cuenta autorizada"
                        : channel.summary}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <span
                        className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium ${difficultyStyles[guide.difficulty]}`}
                      >
                        {difficultyLabels[guide.difficulty]}
                      </span>
                      {isAuthorized ? (
                        <span
                          className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium ${
                            isReady
                              ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-200"
                              : "border-cyan-500/20 bg-cyan-500/10 text-cyan-200"
                          }`}
                        >
                          {isReady ? "Lista para publicar" : "Cuenta autorizada"}
                        </span>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>

            {selectedConnectionChannel && selectedConnectionGuide ? (
              <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-5">
                <div className="flex flex-col gap-4 border-b border-zinc-800 pb-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-2xl font-semibold text-white">
                        {selectedConnectionChannel.label}
                      </h3>
                      <MarketingInfoButton
                        info={marketingInfo.conexiones}
                        onOpen={setInfoModal}
                      />
                      <span
                        className={`rounded-full border px-2.5 py-1 text-xs font-medium ${statusStyles(
                          selectedConnectionChannel.estatus
                        )}`}
                      >
                        {selectedConnectionChannel.estatus}
                      </span>
                      <span
                        className={`rounded-full border px-2.5 py-1 text-xs font-medium ${difficultyStyles[selectedConnectionGuide.difficulty]}`}
                      >
                        {difficultyLabels[selectedConnectionGuide.difficulty]}
                      </span>
                    </div>
                    <p className="mt-2 max-w-3xl text-sm leading-relaxed text-zinc-400">
                      {selectedConnectionChannel.credenciales.access_token_configurado
                        ? selectedConnectionChannel.canal === "INSTAGRAM"
                          ? "La cuenta de Instagram esta lista para pruebas de publicacion desde BetterP."
                          : "La pagina esta lista para crear publicaciones desde BetterP."
                        : selectedConnectionChannel.credenciales.token_usuario_configurado
                          ? "La cuenta esta autorizada. Falta elegir o autorizar una pagina administrable para publicar."
                          : selectedConnectionChannel.canal === "INSTAGRAM"
                            ? "Conecta la cuenta profesional de Instagram donde quieres publicar comunicados."
                            : "Conecta una cuenta que administre la pagina donde quieres publicar comunicados."}
                    </p>
                    {!selectedConnectionAccess.allowed ? (
                      <div className="mt-3 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                        <p className="font-medium text-amber-50">
                          {selectedConnectionAccess.message}
                        </p>
                        <p className="mt-1 text-xs leading-relaxed text-amber-100/75">
                          Requiere {selectedConnectionAccess.requirement || "plan superior"}.
                        </p>
                      </div>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {selectedConnectionChannel.canal !== "WHATSAPP" ? (
                      <button
                        type="button"
                        onClick={() => void startOAuthConnection(selectedConnectionChannel)}
                        disabled={
                          saving === `oauth-${selectedConnectionChannel.canal}` ||
                          !selectedConnectionAccess.allowed
                        }
                        className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-200 transition-colors hover:bg-emerald-500/20 disabled:opacity-50"
                      >
                        {saving === `oauth-${selectedConnectionChannel.canal}`
                          ? "Abriendo..."
                          : !selectedConnectionAccess.allowed
                            ? `Requiere ${selectedConnectionAccess.requirement || "upgrade"}`
                          : selectedConnectionChannel.credenciales.access_token_configurado ||
                              selectedConnectionChannel.credenciales.token_usuario_configurado
                            ? "Reconectar cuenta"
                            : "Conectar cuenta"}
                      </button>
                    ) : null}
                    {selectedConnectionChannel.canal === "INSTAGRAM" ? (
                      <button
                        type="button"
                        onClick={() => void copyOAuthDiagnosticUrl(selectedConnectionChannel)}
                        disabled={
                          saving === `oauth-debug-${selectedConnectionChannel.canal}` ||
                          !selectedConnectionAccess.allowed
                        }
                        className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20 disabled:opacity-50"
                      >
                        {saving === `oauth-debug-${selectedConnectionChannel.canal}`
                          ? "Copiando..."
                          : "Copiar URL de diagnostico"}
                      </button>
                    ) : null}
                    {selectedConnectionChannel.credenciales.access_token_configurado ||
                    selectedConnectionChannel.credenciales.token_usuario_configurado ? (
                      <button
                        type="button"
                        onClick={() => void disconnectChannel(selectedConnectionChannel)}
                        disabled={
                          saving === `disconnect-${selectedConnectionChannel.canal}` ||
                          !selectedConnectionAccess.allowed
                        }
                        className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-200 transition-colors hover:bg-red-500/20 disabled:opacity-50"
                      >
                        {saving === `disconnect-${selectedConnectionChannel.canal}`
                          ? "Desconectando..."
                          : "Desconectar"}
                      </button>
                    ) : null}
                  </div>
                </div>

                {selectedConnectionChannel.credenciales.access_token_configurado ? (
                  <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_340px]">
                    <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4">
                      <p className="text-xs uppercase tracking-[0.18em] text-emerald-200/80">
                        {selectedConnectionChannel.canal === "INSTAGRAM"
                          ? "Cuenta conectada"
                          : "Pagina principal"}
                      </p>
                      <p className="mt-2 text-sm font-semibold text-white">
                        {selectedConnectionChannel.credenciales.instagram_username ||
                          selectedConnectionChannel.credenciales.page_name ||
                          selectedConnectionChannel.credenciales.account_id ||
                          selectedConnectionChannel.label}
                      </p>
                      <p className="mt-1 text-sm leading-relaxed text-emerald-100/75">
                        {selectedConnectionChannel.credenciales.instagram_user_id
                          ? `Instagram ${selectedConnectionChannel.credenciales.instagram_user_id}`
                          : selectedConnectionChannel.credenciales.page_id
                          ? `Pagina ${selectedConnectionChannel.credenciales.page_id}`
                          : "Token recibido y guardado para este canal."}
                        {selectedConnectionChannel.credenciales.meta_pages_count
                          ? ` ${selectedConnectionChannel.credenciales.meta_pages_count} pagina(s) autorizadas.`
                          : ""}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4">
                      <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
                        Publicacion
                      </p>
                      <p className="mt-3 text-sm leading-relaxed text-zinc-300">
                        {selectedConnectionChannel.canal === "INSTAGRAM"
                          ? "Los comunicados se publicaran en la cuenta de Instagram autorizada. Puedes reconectar para cambiar de cuenta o desconectarla."
                          : "Los comunicados se publicaran en la pagina principal seleccionada durante la autorizacion. Puedes reconectar para cambiar de pagina o desconectar la cuenta."}
                      </p>
                    </div>
                    {selectedConnectionChannel.credenciales.meta_pages &&
                    selectedConnectionChannel.credenciales.meta_pages.length > 1 ? (
                      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4 lg:col-span-2">
                        <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
                          Paginas autorizadas
                        </p>
                        <div className="mt-3 grid gap-2 md:grid-cols-2">
                          {selectedConnectionChannel.credenciales.meta_pages.slice(0, 6).map((page) => (
                            <div
                              key={page.id}
                              className="rounded-xl border border-zinc-800 bg-zinc-950/70 px-3 py-2"
                            >
                              <p className="text-sm font-medium text-white">{page.name}</p>
                              <p className="mt-0.5 text-xs text-zinc-500">
                                {page.category || "Pagina"} - {page.id}
                              </p>
                            </div>
                          ))}
                        </div>
                        <p className="mt-3 text-xs leading-relaxed text-zinc-500">
                          Por ahora BetterP usa una pagina principal por entidad. La seleccion por cliente,
                          campana o comunicado queda preparada para una siguiente version multi-cuenta.
                        </p>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="mt-5 rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-cyan-200/80">
                      {selectedConnectionChannel.credenciales.token_usuario_configurado
                        ? "Cuenta autorizada"
                        : "Sin conexion"}
                    </p>
                    <p className="mt-2 text-sm leading-relaxed text-cyan-50/80">
                      {selectedConnectionChannel.credenciales.token_usuario_configurado
                        ? selectedConnectionChannel.canal === "INSTAGRAM"
                          ? "Instagram autorizo la cuenta, pero falta completar el perfil publicable. Reconecta la cuenta y confirma los permisos de publicacion."
                          : "Facebook autorizo tu cuenta, pero no regreso paginas administrables para publicar. Usa Reconectar cuenta y entra a Editar configuracion para seleccionar la pagina."
                        : selectedConnectionChannel.canal === "INSTAGRAM"
                          ? "Al conectar, Instagram te pedira autorizar a BetterP para leer el perfil y crear publicaciones. No necesitas compartir contrasenas ni datos tecnicos."
                          : "Al conectar, Facebook te pedira elegir la pagina y autorizar a BetterP para leerla y crear publicaciones. No necesitas compartir contrasenas ni datos tecnicos."}
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <EmptyState text="No hay canales de marketing configurables." />
            )}
          </div>
        </div>
      ) : null}

      {activeTab === "metricas" ? (
        <div className="space-y-4">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
                Indicadores comerciales
              </p>
              <MarketingInfoButton info={marketingInfo.metricas} onOpen={setInfoModal} />
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-cyan-200/80">
                  Oportunidades sin comunicado
                </p>
                <p className="mt-2 text-2xl font-semibold text-cyan-200">
                  {spacesWithoutCommunication.length}
                </p>
                <p className="mt-1 text-xs text-cyan-50/60">
                  Espacios disponibles que aun no tienen pieza comercial.
                </p>
              </div>
              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-emerald-200/80">
                  Publicaciones activas
                </p>
                <p className="mt-2 text-2xl font-semibold text-emerald-200">
                  {publishedPublications.length}
                </p>
                <p className="mt-1 text-xs text-emerald-50/60">
                  Piezas ya publicadas y listas para medir respuesta.
                </p>
              </div>
              <div className="rounded-2xl border border-blue-500/20 bg-blue-500/10 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-blue-200/80">
                  Pendientes por ejecutar
                </p>
                <p className="mt-2 text-2xl font-semibold text-blue-200">
                  {pendingPublications.length}
                </p>
                <p className="mt-1 text-xs text-blue-50/60">
                  Programadas, listas o esperando aprobacion.
                </p>
              </div>
              <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-red-200/80">
                  Errores a corregir
                </p>
                <p className="mt-2 text-2xl font-semibold text-red-200">
                  {erroredPublications.length}
                </p>
                <p className="mt-1 text-xs text-red-50/60">
                  Publicaciones que requieren ajuste antes de vender.
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-cyan-300">
                  Lectura para convertir
                </p>
                <h3 className="mt-2 text-lg font-semibold text-white">
                  Prioriza inventario disponible, corrige fricciones y publica en canales conectados.
                </h3>
                <p className="mt-1 max-w-3xl text-sm leading-relaxed text-zinc-500">
                  La tabla conserva el detalle por canal; estos accesos ayudan a convertir la
                  informacion en acciones comerciales sin repetir configuraciones tecnicas.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setActiveTab("espacios")}
                  className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20"
                >
                  Ver oportunidades
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("comunicados")}
                  className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
                >
                  Revisar comunicados
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("conexiones")}
                  className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
                >
                  Canales conectados
                </button>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-5">
            <p className="text-xs uppercase tracking-[0.18em] text-emerald-300">
              Atribucion Commerce
            </p>
            <h3 className="mt-2 text-lg font-semibold text-white">
              Ventas netas y ROAS verificables por publicacion
            </h3>
            <p className="mt-1 text-sm text-zinc-500">
              Una visita sin pedido pagado cuenta como trafico, no como ingreso. Las devoluciones
              confirmadas se descuentan antes de calcular ROAS.
            </p>
            {attributionLoading ? (
              <p className="mt-4 text-sm text-zinc-400">Calculando con evidencia de Commerce...</p>
            ) : attributionReport?.rows.length ? (
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="text-xs uppercase tracking-[0.14em] text-zinc-500">
                    <tr>
                      <th className="px-3 py-2">Canal</th>
                      <th className="px-3 py-2">Visitas</th>
                      <th className="px-3 py-2">Pedidos</th>
                      <th className="px-3 py-2">Venta neta</th>
                      <th className="px-3 py-2">Gasto confirmado</th>
                      <th className="px-3 py-2">ROAS</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800">
                    {attributionReport.rows.map((row) => (
                      <tr key={row.attribution_key} className="text-zinc-300">
                        <td className="px-3 py-3">{channelLabel(row.channel)}</td>
                        <td className="px-3 py-3">{row.touches}</td>
                        <td className="px-3 py-3">{row.orders}</td>
                        <td className="px-3 py-3">{formatMoney(Number(row.net_sales))}</td>
                        <td className="px-3 py-3">{formatMoney(Number(row.confirmed_spend))}</td>
                        <td className="px-3 py-3 font-medium text-emerald-200">
                          {row.roas === null ? "Sin gasto comparable" : `${Number(row.roas).toFixed(2)}x`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-4 text-sm text-zinc-500">
                Aun no hay publicaciones Commerce con evidencia atribuible.
              </p>
            )}
          </div>

          <ResponsiveTable
            headers={["Canal", "Comunicados", "Publicados", "Pendientes", "Errores"]}
            rows={orderedChannels.map((channel) => {
              const publications = communications.flatMap((item) =>
                item.publicaciones.filter((publication) => publication.canal === channel.canal)
              );
              return [
                channel.label,
                String(publications.length),
                String(publications.filter((item) => item.estatus === "PUBLICADA").length),
                String(
                  publications.filter(
                    (item) =>
                      !["PUBLICADA", "PAUSADA", "ELIMINADA", "ERROR"].includes(
                        item.estatus
                      )
                  ).length
                ),
                String(publications.filter((item) => item.estatus === "ERROR").length),
              ];
            })}
            emptyText="Aun no hay metricas de publicaciones."
          />
        </div>
      ) : null}

      {selectedPublicationDetail ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-zinc-800 pb-4">
              <div className="flex items-start gap-3">
                <div
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border text-sm font-bold ${channelIconStyles(
                    selectedPublicationDetail.publication.canal,
                    selectedPublicationDetail.publication.estatus
                  )}`}
                >
                  {channelIconLabel(selectedPublicationDetail.publication.canal)}
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
                    Publicacion por canal
                  </p>
                  <h3 className="mt-1 text-xl font-semibold text-white">
                    {selectedPublicationDetail.publication.label}
                  </h3>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedPublicationDetail(null)}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900 text-sm text-zinc-400 transition-colors hover:text-white"
                aria-label="Cerrar detalle"
              >
                X
              </button>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-3">
                <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">Estado</p>
                <span
                  className={`mt-2 inline-flex rounded-full border px-2.5 py-1 text-xs ${statusStyles(
                    selectedPublicationDetail.publication.estatus
                  )}`}
                >
                  {selectedPublicationDetail.publication.estatus}
                </span>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-3">
                <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">Fecha</p>
                <p className="mt-2 text-sm text-zinc-200">
                  {formatDateTime(selectedPublicationDetail.publication.fecha_publicacion)}
                </p>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-3">
                <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">Comunicado</p>
                <p className="mt-2 text-sm font-medium text-white">
                  {selectedPublicationDetail.communication.titulo}
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  {selectedPublicationDetail.communication.espacio_codigo || "General"}
                </p>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-3">
                <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">Referencia</p>
                <p className="mt-2 break-all text-sm text-zinc-200">
                  {selectedPublicationDetail.publication.identificador_externo || "Sin identificador"}
                </p>
              </div>
            </div>

            {selectedPublicationDetail.publication.mensaje_estado ? (
              <div className="mt-3 rounded-xl border border-cyan-500/20 bg-cyan-500/10 p-3 text-sm text-cyan-100">
                {selectedPublicationDetail.publication.mensaje_estado}
              </div>
            ) : null}
            {!selectedPublicationAccess.allowed ? (
              <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-100">
                {selectedPublicationAccess.message} Requiere{" "}
                {selectedPublicationAccess.requirement || "plan superior"}.
              </div>
            ) : null}

            <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900/30 p-3">
              <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">Texto</p>
              <p className="mt-2 max-h-40 overflow-auto text-sm leading-relaxed text-zinc-300">
                {selectedPublicationDetail.communication.texto}
              </p>
            </div>

            <div className="mt-5 flex flex-wrap justify-end gap-2">
              {selectedPublicationDetail.publication.url_publicacion &&
              selectedPublicationDetail.publication.estatus !== "ELIMINADA" ? (
                <a
                  href={selectedPublicationDetail.publication.url_publicacion}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20"
                >
                  Abrir publicacion
                </a>
              ) : null}
              {selectedPublicationDetail.publication.canal === "FACEBOOK" &&
              selectedPublicationDetail.publication.estatus !== "ELIMINADA" &&
              selectedPublicationDetail.publication.identificador_externo ? (
                <button
                  type="button"
                  onClick={() =>
                    void deletePublication(selectedPublicationDetail.publication.id)
                  }
                  disabled={
                    saving ===
                      `publication-delete-${selectedPublicationDetail.publication.id}` ||
                    !selectedPublicationAccess.allowed
                  }
                  className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-200 transition-colors hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving === `publication-delete-${selectedPublicationDetail.publication.id}`
                    ? "Borrando..."
                    : !selectedPublicationAccess.allowed
                      ? `Requiere ${selectedPublicationAccess.requirement || "upgrade"}`
                      : "Borrar de Facebook"}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone: "cyan" | "emerald" | "blue" | "amber" }) {
  const styles = {
    cyan: "border-cyan-500/20 bg-cyan-500/10 text-cyan-300",
    emerald: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
    blue: "border-blue-500/20 bg-blue-500/10 text-blue-300",
    amber: "border-amber-500/20 bg-amber-500/10 text-amber-300",
  };
  return (
    <div className={`rounded-xl border p-3 ${styles[tone]}`}>
      <p className="text-xs uppercase tracking-[0.18em] opacity-70">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </div>
  );
}

function MarketingInfoButton({
  info,
  onOpen,
  className = "",
}: {
  info: MarketingInfoContent;
  onOpen: (info: MarketingInfoContent) => void;
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
      className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-cyan-500/40 bg-cyan-500/10 text-xs font-semibold text-cyan-200 transition-colors hover:bg-cyan-500/20 ${className}`}
    >
      i
    </button>
  );
}

function MarketingInfoModal({
  info,
  onClose,
}: {
  info: MarketingInfoContent | null;
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
              {info.eyebrow || "Marketing"}
            </p>
            <h3 className="mt-2 text-2xl font-bold text-white">{info.title}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-300 transition-colors hover:text-white"
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

function FieldLabel({
  label,
  required,
  info,
  onInfo,
}: {
  label: string;
  required?: boolean;
  info: MarketingInfoContent;
  onInfo: (info: MarketingInfoContent) => void;
}) {
  return (
    <span className="mb-1 flex items-center gap-2 text-sm text-zinc-300">
      <span>{label}</span>
      <span className="text-[11px] uppercase tracking-[0.16em] text-cyan-200">
        {required ? "Obligatorio" : "Opcional"}
      </span>
      <MarketingInfoButton info={info} onOpen={onInfo} className="h-5 w-5 text-[10px]" />
    </span>
  );
}

function FieldHelp({
  children,
  tone = "muted",
}: {
  children: string;
  tone?: "muted" | "error";
}) {
  return (
    <p
      className={`mt-1 text-xs leading-relaxed ${
        tone === "error" ? "text-red-200" : "text-zinc-500"
      }`}
    >
      {children}
    </p>
  );
}

function PlanUpgradeNotice({
  title,
  body,
  requirement,
}: {
  title: string;
  body: string;
  requirement: string;
}) {
  return (
    <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-semibold text-amber-50">{title}</p>
          <p className="mt-1 max-w-4xl leading-relaxed text-amber-100/80">{body}</p>
        </div>
        <span className="inline-flex shrink-0 items-center rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-xs font-semibold text-amber-50">
          Requiere {requirement}
        </span>
      </div>
    </div>
  );
}

function MarketingUsageSummary({ usage }: { usage: MarketingUsageLimits }) {
  const priority = [
    MARKETING_USAGE_LIMIT_KEYS.scheduledPublications,
    MARKETING_USAGE_LIMIT_KEYS.socialPublishes,
    MARKETING_USAGE_LIMIT_KEYS.mediaAssets,
    "marketing_ai_batches",
    "marketing_meta_syncs",
    "marketing_advanced_exports",
  ];
  const items = [...(usage.items || [])]
    .filter((item) => item.included !== 0 || item.used > 0 || item.status !== "BLOCKED")
    .sort((left, right) => priority.indexOf(left.key) - priority.indexOf(right.key));
  if (items.length === 0) {
    return null;
  }
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
            Uso del mes
          </p>
          <p className="mt-1 text-sm text-zinc-400">
            Periodo {usage.periodo}
            {usage.reset_at ? ` | reinicia ${formatDate(usage.reset_at)}` : ""}
          </p>
        </div>
        {usage.alerts?.length ? (
          <span className="inline-flex rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-100">
            {usage.alerts.length} alerta(s)
          </span>
        ) : (
          <span className="inline-flex rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-100">
            Dentro del plan
          </span>
        )}
      </div>
      <div className="mt-4 grid gap-2 md:grid-cols-3">
        {items.map((item) => {
          const includedText = item.unlimited ? "Ilimitado" : formatInteger(item.included);
          const remainingText = item.unlimited
            ? "Ilimitado"
            : formatInteger(item.remaining ?? 0);
          const ratio =
            item.unlimited || item.included <= 0
              ? 0
              : Math.min(100, Math.round((item.used / item.included) * 100));
          return (
            <div
              key={item.key}
              className={`rounded-xl border p-3 ${usageLimitStatusStyles(item.status)}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">{item.label}</p>
                  <p className="mt-1 text-xs opacity-80">
                    {formatInteger(item.used)} / {includedText} {item.unit}
                  </p>
                </div>
                <span className="rounded-full border border-current/20 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em]">
                  {item.status === "EXHAUSTED"
                    ? "Lleno"
                    : item.status === "WARN"
                      ? "Cerca"
                      : item.status === "BLOCKED"
                        ? "No incluido"
                        : "OK"}
                </span>
              </div>
              {!item.unlimited && item.included > 0 ? (
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-black/20">
                  <div className="h-full rounded-full bg-current" style={{ width: `${ratio}%` }} />
                </div>
              ) : null}
              <p className="mt-2 text-xs opacity-80">Restante: {remainingText}</p>
              {item.message ? <p className="mt-2 text-xs opacity-90">{item.message}</p> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ChannelPicker({
  channels,
  selectedChannels,
  onToggle,
  onInfo,
  error,
}: {
  channels: MarketingChannel[];
  selectedChannels: string[];
  onToggle: (channel: string) => void;
  onInfo: (info: MarketingInfoContent) => void;
  error?: string;
}) {
  const options = channels.filter((channel) => isSupportedMarketingChannel(channel.canal));
  return (
    <div>
      <FieldLabel
        label="Canales"
        required
        info={marketingInfo.canales}
        onInfo={onInfo}
      />
      <div className="mt-2 flex flex-wrap gap-2">
        {options.length === 0 ? (
          <span className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
            Conecta una red social para preparar comunicados.
          </span>
        ) : null}
        {options.map((channel) => (
          <button
            key={channel.canal}
            type="button"
            onClick={() => onToggle(channel.canal)}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
              selectedChannels.includes(channel.canal)
                ? "border-cyan-500/30 bg-cyan-500/10 text-cyan-200"
                : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white"
            }`}
          >
            {channel.label}
          </button>
        ))}
      </div>
      {error ? <FieldHelp tone="error">{error}</FieldHelp> : null}
    </div>
  );
}

function ListHeader({
  title,
  count,
  info,
  onInfo,
}: {
  title: string;
  count: number;
  info?: MarketingInfoContent;
  onInfo?: (info: MarketingInfoContent) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
      <div className="flex items-center gap-2">
        <h3 className="font-semibold text-white">{title}</h3>
        {info && onInfo ? (
          <MarketingInfoButton
            info={info}
            onOpen={onInfo}
            className="h-5 w-5 text-[10px]"
          />
        ) : null}
      </div>
      <span className="rounded-full border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-400">
        {count}
      </span>
    </div>
  );
}

function PaginationFooter({
  page,
  totalPages,
  visiblePages,
  onChangePage,
}: {
  page: number;
  totalPages: number;
  visiblePages: number[];
  onChangePage: (page: number) => void;
}) {
  return (
    <div className="flex flex-col gap-3 border-t border-zinc-800 px-4 py-4 md:flex-row md:items-center md:justify-between">
      <div className="text-sm text-zinc-500">
        Pagina <span className="font-semibold text-white">{page}</span> de{" "}
        <span className="font-semibold text-white">{totalPages}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onChangePage(1)}
          disabled={page <= 1}
          className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          Inicio
        </button>
        <button
          type="button"
          onClick={() => onChangePage(page - 1)}
          disabled={page <= 1}
          className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          Anterior
        </button>
        {visiblePages.map((candidate) => (
          <button
            key={candidate}
            type="button"
            onClick={() => onChangePage(candidate)}
            className={`rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
              candidate === page
                ? "bg-cyan-600 text-white"
                : "border border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 hover:text-white"
            }`}
          >
            {candidate}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onChangePage(page + 1)}
          disabled={page >= totalPages}
          className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          Siguiente
        </button>
        <button
          type="button"
          onClick={() => onChangePage(totalPages)}
          disabled={page >= totalPages}
          className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          Final
        </button>
      </div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/20 p-8 text-center text-sm text-zinc-500">
      {text}
    </div>
  );
}

function ConnectionInfoCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4">
      <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">{title}</p>
      <p className="mt-3 text-sm leading-relaxed text-zinc-300">{body}</p>
    </div>
  );
}

function ConnectionListCard({
  title,
  items,
  emptyText = "Sin elementos pendientes.",
}: {
  title: string;
  items: string[];
  emptyText?: string;
}) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4">
      <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">{title}</p>
      <ul className="mt-4 space-y-2">
        {items.map((item) => (
          <li key={item} className="flex gap-2 text-sm leading-relaxed text-zinc-300">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">{emptyText}</p>
      ) : null}
    </div>
  );
}

function ResponsiveTable({
  headers,
  rows,
  emptyText,
}: {
  headers: string[];
  rows: string[][];
  emptyText: string;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950/80">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm text-zinc-300">
          <thead className="border-b border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              {headers.map((header) => (
                <th key={header} className="px-4 py-3">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {rows.map((row, rowIndex) => (
              <tr key={`${row[0]}-${rowIndex}`} className="hover:bg-zinc-900/40">
                {row.map((cell, index) => (
                  <td key={`${cell}-${index}`} className="px-4 py-3">
                    {index === 1 && ["ACTIVA", "BORRADOR", "PAUSADA", "CERRADA"].includes(cell) ? (
                      <span className={`rounded-full border px-2.5 py-1 text-xs ${statusStyles(cell)}`}>
                        {cell}
                      </span>
                    ) : (
                      cell
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 ? <EmptyState text={emptyText} /> : null}
    </div>
  );
}
