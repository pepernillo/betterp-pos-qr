export type PlanAccessSubscription = {
  plan?: {
    nombre?: string | null;
    modulos_habilitados?: string[] | null;
    funciones_habilitadas?: string[] | null;
  } | null;
} | null;

export type PlanAccessDecision = {
  allowed: boolean;
  title?: string;
  description?: string;
  requirement?: string;
};

const MODULE_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  entidades: "Unidades de negocio",
  clientes: "Clientes",
  renta_espacios: "Renta de espacios",
  cxc: "Cuentas por cobrar",
  cxp: "Cuentas por pagar",
  conciliacion: "Conciliacion bancaria",
  cobranza: "Cobranza",
  marketing: "Marketing",
  facturacion_cfdi: "Facturacion CFDI",
};

const FEATURE_LABELS: Record<string, string> = {
  batch_import: "Carga batch",
  social_publishing: "Conexiones y publicacion en canales",
  whatsapp_automation: "Automatizacion por WhatsApp",
  ai_copy: "Copy asistido por IA",
  marketing_automation: "Automatizacion de marketing",
  marketing_learning_loop: "Learning loop de marketing",
  marketing_meta_insights: "Metricas de Meta para marketing",
  marketing_paid_brief: "Brief de pauta controlada",
  marketing_facebook: "Marketing en Facebook",
  marketing_instagram: "Marketing en Instagram",
  marketing_tiktok: "Marketing en TikTok",
  marketing_youtube: "Marketing en YouTube",
  webhooks_api: "Webhooks y API",
  advanced_users: "Usuarios avanzados",
  priority_support: "Soporte prioritario",
};

function getPlanName(subscription: PlanAccessSubscription) {
  return subscription?.plan?.nombre || "tu plan actual";
}

export function isPlanKnown(subscription: PlanAccessSubscription) {
  return Boolean(subscription?.plan);
}

export function hasPlanModule(
  subscription: PlanAccessSubscription,
  moduleKey: string
) {
  if (!isPlanKnown(subscription)) return true;
  return Boolean(
    subscription?.plan?.modulos_habilitados?.includes(moduleKey)
  );
}

export function hasPlanFeature(
  subscription: PlanAccessSubscription,
  featureKey: string
) {
  if (!isPlanKnown(subscription)) return true;
  return Boolean(
    subscription?.plan?.funciones_habilitadas?.includes(featureKey)
  );
}

function blockedByModule(
  subscription: PlanAccessSubscription,
  moduleKey: string
): PlanAccessDecision {
  const label = MODULE_LABELS[moduleKey] || "este modulo";
  return {
    allowed: false,
    title: `${label} no esta incluido en ${getPlanName(subscription)}`,
    description:
      "Puedes revisar la suscripcion para elegir un plan que incluya esta area de trabajo.",
    requirement: label,
  };
}

function blockedByFeature(
  subscription: PlanAccessSubscription,
  featureKey: string
): PlanAccessDecision {
  const label = FEATURE_LABELS[featureKey] || "esta funcion";
  return {
    allowed: false,
    title: `${label} no esta incluido en ${getPlanName(subscription)}`,
    description:
      "La informacion base sigue disponible, pero esta funcion requiere subir de plan.",
    requirement: label,
  };
}

function moduleDecision(
  subscription: PlanAccessSubscription,
  moduleKey: string
): PlanAccessDecision {
  if (hasPlanModule(subscription, moduleKey)) {
    return { allowed: true };
  }
  return blockedByModule(subscription, moduleKey);
}

export function getRoutePlanAccess(
  pathname: string,
  tab: string,
  subscription: PlanAccessSubscription,
  hasProviderCallback = false
): PlanAccessDecision {
  if (!isPlanKnown(subscription)) {
    return { allowed: true };
  }

  if (
    pathname === "/onboarding" ||
    pathname === "/configuracion" ||
    pathname === "/cuenta" ||
    pathname === "/documentacion"
  ) {
    return { allowed: true };
  }

  if (pathname === "/dashboard") return moduleDecision(subscription, "dashboard");
  if (pathname === "/clientes") return moduleDecision(subscription, "clientes");
  if (pathname === "/cxc") return moduleDecision(subscription, "cxc");
  if (pathname === "/cxp") return moduleDecision(subscription, "cxp");
  if (pathname === "/conciliacion") {
    return moduleDecision(subscription, "conciliacion");
  }
  if (pathname === "/cobranza") return moduleDecision(subscription, "cobranza");
  if (pathname === "/marketing") return moduleDecision(subscription, "marketing");

  if (pathname === "/entidades" || pathname.startsWith("/entidades/")) {
    return moduleDecision(subscription, "entidades");
  }

  if (pathname === "/renta-espacios") {
    const moduleAccess = moduleDecision(subscription, "renta_espacios");
    if (!moduleAccess.allowed) return moduleAccess;

    const activeTab = hasProviderCallback ? "conexiones" : tab || "espacios";
    if (activeTab === "batch" && !hasPlanFeature(subscription, "batch_import")) {
      return blockedByFeature(subscription, "batch_import");
    }
    if (
      (activeTab === "conexiones" || activeTab === "publicacion") &&
      !hasPlanFeature(subscription, "social_publishing")
    ) {
      return blockedByFeature(subscription, "social_publishing");
    }
  }

  return { allowed: true };
}
