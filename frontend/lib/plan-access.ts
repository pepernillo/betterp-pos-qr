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
  dashboard: "Tablero de venta",
  catalogo: "Productos y catalogos",
  inventario: "Inventario",
  pos_caja: "Caja",
  cobro_qr: "Cobro por QR",
  restaurante: "Restaurante",
  clientes: "Clientes",
  facturacion_cfdi: "Facturacion CFDI",
  finanzas: "Finanzas",
  reportes: "Reportes de venta",
};

const FEATURE_LABELS: Record<string, string> = {
  menu_qr_publico: "Menu QR publico",
  pedido_desde_mesa: "Pedido desde la mesa",
  propinas: "Propinas",
  cuenta_dividida: "Cuenta dividida",
  descuentos: "Descuentos y promociones",
  multi_caja: "Varias cajas",
  impresion_tickets: "Impresion de tickets",
  batch_import: "Carga masiva",
  whatsapp_automation: "Automatizacion por WhatsApp",
  webhooks_api: "Webhooks y API",
  advanced_users: "Usuarios y permisos avanzados",
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

export function blockedByFeature(
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
  subscription: PlanAccessSubscription
): PlanAccessDecision {
  if (!isPlanKnown(subscription)) {
    return { allowed: true };
  }

  if (
    pathname === "/configuracion" ||
    pathname === "/cuenta" ||
    pathname === "/pos-qr/entrar"
  ) {
    return { allowed: true };
  }

  const ROUTE_MODULES: Record<string, string> = {
    "/dashboard": "dashboard",
    "/clientes": "clientes",
    "/pos-qr/caja": "pos_caja",
    "/pos-qr/cajas": "pos_caja",
    "/pos-qr/corte": "pos_caja",
    "/pos-qr/mesas": "restaurante",
    "/pos-qr/comandas": "restaurante",
    "/pos-qr/productos": "catalogo",
    "/pos-qr/catalogos": "catalogo",
    "/pos-qr/inventario": "inventario",
    "/pos-qr/reportes": "reportes",
  };

  const moduleKey = ROUTE_MODULES[pathname];
  if (moduleKey) {
    return moduleDecision(subscription, moduleKey);
  }

  return { allowed: true };
}
