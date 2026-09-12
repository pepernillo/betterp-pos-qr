"use client";

import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { buildApiUrl } from "@/lib/api";
import {
  ConfigInfoButton,
  ConfigInfoModal,
  type ConfigInfoContent,
} from "./ConfigInfo";

interface PlanItem {
  id: number;
  nombre: string;
  descripcion?: string | null;
  precio_mensual: number;
  precio_anual: number;
  max_usuarios: number;
  max_entidades: number;
  max_espacios: number;
  dias_prueba?: number;
  openai_tokens_incluidos?: number;
  whatsapp_mensajes_incluidos?: number;
  comprobantes_whatsapp_incluidos?: number;
  timbres_facturacion_incluidos?: number;
  emails_incluidos?: number;
  modulos_habilitados?: string[];
  funciones_habilitadas?: string[];
  es_default: boolean;
}

interface PlanDefinitionItem {
  clave: string;
  nombre: string;
  descripcion: string;
}

interface SubscriptionPayload {
  id: number;
  estatus: string;
  acceso_activo?: boolean;
  pago_requerido?: boolean;
  trial_activo?: boolean;
  trial_dias_restantes?: number;
  trial_finaliza_en?: string | null;
  periodicidad: string;
  fecha_inicio?: string | null;
  fecha_fin_periodo_actual?: string | null;
  periodo_dias_totales?: number;
  periodo_dias_restantes?: number;
  periodo_actual_vencido?: boolean;
  fecha_siguiente_pago?: string | null;
  siguiente_pago_dias_restantes?: number | null;
  auto_renueva: boolean;
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
  stripe_checkout_session_id?: string | null;
  metadata?: Record<string, unknown>;
  plan: PlanItem;
  usage: {
    usuarios_activos: number;
    entidades_activas: number;
    espacios_activos: number;
  };
  limits: {
    usuarios: number;
    entidades: number;
    espacios: number;
  };
}

interface UsageStatementPayload {
  periodo: string;
  total_extras: number;
  alertas?: Array<{
    nivel: "PREVENTIVA" | "EXCEDIDO" | string;
    categoria: string;
    nombre: string;
    mensaje: string;
  }>;
  resumen: Array<{
    categoria: string;
    nombre: string;
    consumido: number;
    incluido: number;
    excedente: number;
    unidad?: string;
    precio_unitario_extra: number;
    importe_extra: number;
  }>;
  movimientos: Array<{
    id: number;
    fecha_consumo: string;
    nombre: string;
    descripcion: string;
    cantidad: number;
    unidad: string;
    costo_estimado: number;
  }>;
}

interface StripeInvoicePreviewPayload {
  available: boolean;
  id?: string | null;
  currency: string;
  amount_due: number;
  subtotal: number;
  total: number;
  starting_balance: number;
  ending_balance: number;
  proration_date: number;
  lineas_prorrateo: Array<{
    id?: string | null;
    descripcion: string;
    importe: number;
    currency: string;
    periodo_inicio?: number | null;
    periodo_fin?: number | null;
  }>;
}

interface PlanChangePreviewPayload {
  plan_actual: PlanItem;
  plan_nuevo: PlanItem;
  periodicidad_actual: string;
  periodicidad_nueva: string;
  tipo: string;
  dias_totales_periodo: number;
  dias_restantes_periodo: number;
  precio_actual_periodo: number;
  precio_nuevo_periodo: number;
  credito_plan_actual: number;
  cargo_plan_nuevo: number;
  neto_estimado: number;
  monto_a_pagar: number;
  saldo_a_favor_estimado: number;
  requiere_pago: boolean;
  genera_saldo_a_favor: boolean;
  stripe_subscription_id?: string | null;
  stripe_proration_date?: number | null;
  stripe_proration_date_iso?: string | null;
  stripe_preview?: StripeInvoicePreviewPayload | null;
  stripe_preview_error?: string | null;
}

interface PlanChangePayload {
  id: number;
  tipo: string;
  modo: string;
  preferencia_credito: string;
  estatus: string;
  monto_a_pagar: number;
  saldo_a_favor_estimado: number;
  plan_anterior?: PlanItem;
  plan_nuevo?: PlanItem;
  periodicidad_anterior?: string;
  periodicidad_nueva?: string;
  fecha_creacion?: string;
  stripe_invoice_id?: string | null;
  stripe_refund_id?: string | null;
  revision?: PlanChangeReviewPayload;
}

interface PlanChangeReviewPayload {
  estado_operativo: string;
  requiere_revision_manual: boolean;
  accion_recomendada: string;
  bloquea_nuevo_cambio: boolean;
  tiene_invoice: boolean;
  tiene_refund: boolean;
  referencia_stripe_principal?: string | null;
  fecha_siguiente_revision?: string | null;
  dias_en_revision: number;
}

interface PlanChangeReadinessPayload {
  stripe_modo: string;
  price_id_configurado: boolean;
  stripe_secret_configurada: boolean;
  stripe_subscription_configurada: boolean;
  puede_aplicar_inmediato: boolean;
  puede_programar_renovacion: boolean;
  requiere_confirmacion_live?: boolean;
  confirmacion_live_requerida?: string;
  modo_recomendado: "INMEDIATO" | "AL_RENOVAR";
  advertencias: string[];
  cambio_pendiente?: PlanChangePayload | null;
}

function formatMoney(value: number) {
  return value.toLocaleString("es-MX", {
    style: "currency",
    currency: "MXN",
  });
}

function formatNumber(value: number) {
  return value.toLocaleString("es-MX");
}

function formatDate(value?: string | null) {
  if (!value) return "Sin fecha";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin fecha";
  return new Intl.DateTimeFormat("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatPeriodicity(value?: string | null) {
  return value === "ANUAL" ? "Anual" : "Mensual";
}

function formatDays(value?: number | null) {
  if (value === null || value === undefined) return "Sin fecha";
  if (value === 0) return "Hoy";
  if (value === 1) return "1 dia";
  return `${value} dias`;
}

function formatPlanChangeType(value: string) {
  if (value === "UPGRADE") return "Subida de plan";
  if (value === "DOWNGRADE") return "Bajada de plan";
  if (value === "CAMBIO_CICLO") return "Cambio de ciclo";
  return "Cambio de plan";
}

function formatPlanChangeOperationalState(value?: string | null) {
  if (value === "REVISION_REEMBOLSO") return "Revision de reembolso";
  if (value === "REEMBOLSO_REGISTRADO") return "Reembolso registrado";
  if (value === "PENDIENTE_RENOVACION") return "Pendiente al renovar";
  if (value === "ESPERANDO_STRIPE") return "Esperando Stripe";
  if (value === "ERROR") return "Requiere correccion";
  if (value === "APLICADO") return "Aplicado";
  return "Sin pendiente";
}

function resolveDefinitionNames(keys: string[] | undefined, definitions: PlanDefinitionItem[]) {
  const definitionMap = new Map(definitions.map((item) => [item.clave, item.nombre]));
  return (keys ?? []).map((key) => definitionMap.get(key) ?? key.replaceAll("_", " "));
}

const billingInfo = {
  modulo: {
    eyebrow: "Billing",
    title: "Suscripcion SaaS",
    summary:
      "Aqui se revisa el plan activo, limites contratados, ciclo de cobro, extras y sincronizacion con Stripe.",
    details: [
      "Solo owner admin puede cambiar plan, abrir portal Stripe o iniciar checkout.",
      "Los cambios de plan se previsualizan antes de confirmar para estimar cargo, credito o saldo a favor.",
      "Los valores de consumo vienen del backend; esta vista no permite capturar importes libres.",
    ],
  },
  ciclo: {
    eyebrow: "Plan",
    title: "Ciclo de cobro",
    summary:
      "Permite comparar el mismo plan en mensual o anual antes de solicitar el cambio.",
    details: [
      "Mensual cobra periodo a periodo.",
      "Anual aplica el precio anual configurado en backoffice.",
      "La confirmacion final y prorrateo ocurren en Stripe.",
    ],
  },
};

export default function BillingSubscriptionManager() {
  const { isOwnerAdmin } = useAuth();
  const [plans, setPlans] = useState<PlanItem[]>([]);
  const [planModules, setPlanModules] = useState<PlanDefinitionItem[]>([]);
  const [planFeatures, setPlanFeatures] = useState<PlanDefinitionItem[]>([]);
  const [subscription, setSubscription] = useState<SubscriptionPayload | null>(null);
  const [usageStatement, setUsageStatement] = useState<UsageStatementPayload | null>(null);
  const [events, setEvents] = useState<
    Array<{
      id: number;
      proveedor: string;
      tipo_evento: string;
      estatus: string;
      fecha_creacion: string;
    }>
  >([]);
  const [planChanges, setPlanChanges] = useState<PlanChangePayload[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [billingCycle, setBillingCycle] = useState<"MENSUAL" | "ANUAL">("MENSUAL");
  const [planChangePreview, setPlanChangePreview] =
    useState<PlanChangePreviewPayload | null>(null);
  const [planChangeReadiness, setPlanChangeReadiness] =
    useState<PlanChangeReadinessPayload | null>(null);
  const [planChangeResult, setPlanChangeResult] =
    useState<PlanChangePayload | null>(null);
  const [planChangeLoading, setPlanChangeLoading] = useState(false);
  const [creditPreference, setCreditPreference] = useState<
    "SALDO" | "REEMBOLSO" | "TIEMPO"
  >("SALDO");
  const [livePlanChangeConfirmation, setLivePlanChangeConfirmation] = useState("");
  const [infoModal, setInfoModal] = useState<ConfigInfoContent | null>(null);
  const isAnnualSubscription = subscription?.periodicidad === "ANUAL";
  const livePlanChangeConfirmationRequired = Boolean(
    planChangeReadiness?.requiere_confirmacion_live &&
      planChangeReadiness.confirmacion_live_requerida
  );
  const livePlanChangeConfirmationMatches =
    !livePlanChangeConfirmationRequired ||
    livePlanChangeConfirmation.trim() === planChangeReadiness?.confirmacion_live_requerida;

  const loadData = async () => {
    setLoading(true);
    setMessage("");
    try {
      const [
        plansResponse,
        subscriptionResponse,
        eventsResponse,
        usageResponse,
        planChangesResponse,
      ] = await Promise.all([
        fetch(buildApiUrl("/billing/planes/"), { cache: "no-store" }),
        fetch(buildApiUrl("/billing/suscripcion/actual/"), { cache: "no-store" }),
        fetch(buildApiUrl("/billing/eventos/"), { cache: "no-store" }),
        fetch(buildApiUrl("/billing/consumo/estado-cuenta/"), { cache: "no-store" }),
        fetch(buildApiUrl("/billing/suscripcion/cambios-plan/"), { cache: "no-store" }),
      ]);

      if (
        !plansResponse.ok ||
        !subscriptionResponse.ok ||
        !eventsResponse.ok ||
        !usageResponse.ok ||
        !planChangesResponse.ok
      ) {
        throw new Error("No se pudo cargar la informacion de facturacion.");
      }

      const plansBody = (await plansResponse.json()) as {
        items: PlanItem[];
        modulos_disponibles?: PlanDefinitionItem[];
        funciones_disponibles?: PlanDefinitionItem[];
      };
      const subscriptionBody =
        (await subscriptionResponse.json()) as SubscriptionPayload;
      const eventsBody = (await eventsResponse.json()) as {
        items: Array<{
          id: number;
          proveedor: string;
          tipo_evento: string;
          estatus: string;
          fecha_creacion: string;
        }>;
      };
      const usageBody = (await usageResponse.json()) as UsageStatementPayload;
      const planChangesBody = (await planChangesResponse.json()) as {
        items: PlanChangePayload[];
      };

      setPlans(plansBody.items ?? []);
      setPlanModules(plansBody.modulos_disponibles ?? []);
      setPlanFeatures(plansBody.funciones_disponibles ?? []);
      setSubscription(subscriptionBody);
      setBillingCycle(
        subscriptionBody.periodicidad === "ANUAL" ? "ANUAL" : "MENSUAL"
      );
      setEvents(eventsBody.items ?? []);
      setUsageStatement(usageBody);
      setPlanChanges(planChangesBody.items ?? []);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "No se pudo cargar la suscripcion actual."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const previewPlanChange = async (planId: number) => {
    setMessage("");
    setPlanChangeResult(null);
    setLivePlanChangeConfirmation("");
    setPlanChangeLoading(true);
    try {
      const response = await fetch(
        buildApiUrl("/billing/suscripcion/cambio-plan/preview/"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            plan_id: planId,
            periodicidad: billingCycle,
            preferencia_credito: creditPreference,
            incluir_preview_stripe: true,
          }),
        }
      );
      const body = (await response.json().catch(() => ({}))) as {
        preview?: PlanChangePreviewPayload;
        readiness?: PlanChangeReadinessPayload;
        detail?: string;
      };
      if (!response.ok || !body.preview) {
        throw new Error(body.detail || "No se pudo calcular el cambio de plan.");
      }
      setPlanChangePreview(body.preview);
      setPlanChangeReadiness(body.readiness ?? null);
      setCreditPreference("SALDO");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "No se pudo calcular el cambio."
      );
    } finally {
      setPlanChangeLoading(false);
    }
  };

  const confirmPlanChange = async (mode: "INMEDIATO" | "AL_RENOVAR" = "INMEDIATO") => {
    if (!planChangePreview) return;
    setMessage("");
    setPlanChangeResult(null);
    setPlanChangeLoading(true);
    try {
      const response = await fetch(buildApiUrl("/billing/suscripcion/cambio-plan/"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan_id: planChangePreview.plan_nuevo.id,
          periodicidad: planChangePreview.periodicidad_nueva,
          modo: mode,
          preferencia_credito: mode === "AL_RENOVAR" ? "TIEMPO" : creditPreference,
          stripe_proration_date: planChangePreview.stripe_proration_date,
          confirmacion_live: mode === "INMEDIATO" ? livePlanChangeConfirmation.trim() : "",
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        change?: PlanChangePayload;
        detail?: string;
        mensaje?: string;
      };
      if (!response.ok || !body.change) {
        throw new Error(body.detail || "No se pudo aplicar el cambio de plan.");
      }
      setPlanChangeResult(body.change);
      setPlanChangeReadiness(null);
      setLivePlanChangeConfirmation("");
      setMessage(body.mensaje || "Cambio de plan enviado a Stripe.");
      await loadData();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "No se pudo aplicar el cambio."
      );
    } finally {
      setPlanChangeLoading(false);
    }
  };

  const launchCheckout = async (planId: number) => {
    setMessage("");
    if (
      subscription?.stripe_subscription_id &&
      subscription.estatus === "ACTIVA" &&
      (subscription.plan.id !== planId || subscription.periodicidad !== billingCycle)
    ) {
      await previewPlanChange(planId);
      return;
    }
    try {
      const response = await fetch(buildApiUrl("/billing/suscripcion/checkout/"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan_id: planId,
          periodicidad: billingCycle,
          success_url: `${window.location.origin}/configuracion`,
          cancel_url: `${window.location.origin}/configuracion`,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        checkout_url?: string;
        detail?: string;
      };
      if (!response.ok) {
        throw new Error(body.detail || "No se pudo crear el checkout.");
      }
      if (body.checkout_url) {
        window.open(body.checkout_url, "_blank", "noopener,noreferrer");
      }
      await loadData();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "No se pudo iniciar el checkout."
      );
    }
  };

  const openPortal = async () => {
    setMessage("");
    try {
      const response = await fetch(buildApiUrl("/billing/suscripcion/portal/"), {
        method: "POST",
      });
      const body = (await response.json().catch(() => ({}))) as {
        url?: string;
        detail?: string;
      };
      if (!response.ok) {
        throw new Error(body.detail || "No se pudo abrir el portal.");
      }
      if (body.url) {
        window.open(body.url, "_blank", "noopener,noreferrer");
      }
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "No se pudo abrir el portal."
      );
    }
  };

  return (
    <section className="rounded-3xl border border-zinc-800 bg-zinc-950/70 p-5">
      <ConfigInfoModal info={infoModal} onClose={() => setInfoModal(null)} />
      <div className="flex flex-col gap-3 border-b border-zinc-800 pb-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-white">Suscripcion SaaS</h2>
            <ConfigInfoButton info={billingInfo.modulo} onOpen={setInfoModal} />
          </div>
          <p className="mt-1 text-sm text-zinc-500">
            Controla plan, ciclo de cobro, limites operativos y sincronizacion con Stripe.
          </p>
        </div>
        <span className="text-xs uppercase tracking-[0.22em] text-zinc-500">
          Billing
        </span>
      </div>

      {message ? (
        <div className="mt-5 rounded-2xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100">
          {message}
        </div>
      ) : null}

      {!isOwnerAdmin ? (
        <div className="mt-5 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          Solo el owner admin puede cambiar plan, abrir portal o iniciar checkout.
        </div>
      ) : null}

      <div className="mt-5 grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="space-y-5">
          <div className="rounded-3xl border border-zinc-800 bg-zinc-900/40 p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-lg font-semibold text-white">Suscripcion actual</h3>
              <button
                type="button"
                onClick={() => void loadData()}
                className="rounded-2xl border border-zinc-700 px-3 py-2 text-xs text-zinc-300 transition hover:border-zinc-600 hover:text-white"
              >
                Refrescar
              </button>
            </div>
            {loading ? (
              <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-950/70 px-4 py-4 text-sm text-zinc-500">
                Cargando suscripcion...
              </div>
            ) : subscription ? (
              <div className="mt-4 space-y-3">
                <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 px-4 py-4">
                  <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">Plan</p>
                  <p className="mt-2 text-lg font-semibold text-white">
                    {subscription.plan.nombre}
                  </p>
                  <p className="mt-1 text-sm text-zinc-500">
                    Estatus: {subscription.estatus} | Ciclo: {subscription.periodicidad}
                  </p>
                  {subscription.estatus === "PENDIENTE_PAGO" ? (
                    <div className="mt-3 rounded-2xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
                      {subscription.metadata?.trial_expired_on
                        ? "La prueba gratuita termino. Para seguir usando BetterP, contrata un plan."
                        : "El plan queda pendiente hasta que Stripe confirme el pago. Al confirmarse, se activa automaticamente."}
                    </div>
                  ) : null}
                  {subscription.trial_activo ? (
                    <div className="mt-3 rounded-2xl border border-cyan-500/25 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-100">
                      Prueba gratuita activa: {subscription.trial_dias_restantes ?? 0} dias restantes. Finaliza el {formatDate(subscription.trial_finaliza_en)}.
                    </div>
                  ) : null}
                  {!subscription.trial_activo ? (
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 px-3 py-3">
                        <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                          Siguiente pago
                        </p>
                        <p className="mt-2 text-sm font-semibold text-white">
                          {formatDate(subscription.fecha_siguiente_pago)}
                        </p>
                        <p className="mt-1 text-xs text-zinc-500">
                          {subscription.auto_renueva
                            ? `${formatDays(subscription.siguiente_pago_dias_restantes)} restantes`
                            : "Renovacion manual"}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 px-3 py-3">
                        <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                          Periodo actual
                        </p>
                        <p className="mt-2 text-sm font-semibold text-white">
                          {formatDays(subscription.periodo_dias_restantes)} restantes
                        </p>
                        <p className="mt-1 text-xs text-zinc-500">
                          {subscription.periodo_dias_totales
                            ? `${subscription.periodo_dias_totales} dias del ciclo`
                            : "Pendiente de sincronizar"}
                        </p>
                      </div>
                    </div>
                  ) : null}
                  {subscription.pago_requerido && subscription.estatus !== "PENDIENTE_PAGO" ? (
                    <div className="mt-3 rounded-2xl border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
                      Esta suscripcion requiere atencion de pago para mantener la cuenta habilitada.
                    </div>
                  ) : null}
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 px-4 py-4">
                    <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">Usuarios</p>
                    <p className="mt-2 text-lg font-semibold text-white">
                      {subscription.usage.usuarios_activos}/{subscription.limits.usuarios}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 px-4 py-4">
                    <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">Entidades</p>
                    <p className="mt-2 text-lg font-semibold text-white">
                      {subscription.usage.entidades_activas}/{subscription.limits.entidades}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 px-4 py-4">
                    <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">Espacios</p>
                    <p className="mt-2 text-lg font-semibold text-white">
                      {subscription.usage.espacios_activos}/{subscription.limits.espacios}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-3">
                  <div className="flex items-center gap-2">
                    <ConfigInfoButton info={billingInfo.ciclo} onOpen={setInfoModal} />
                    <span className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                      Ciclo
                    </span>
                  </div>
                  <select
                    value={billingCycle}
                    onChange={(event) => {
                      setPlanChangePreview(null);
                      setPlanChangeReadiness(null);
                      setPlanChangeResult(null);
                      setBillingCycle(
                        event.target.value === "ANUAL" ? "ANUAL" : "MENSUAL"
                      );
                    }}
                    disabled={!isOwnerAdmin}
                    className="rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-500 disabled:opacity-60"
                  >
                    <option value="MENSUAL">Mensual</option>
                    <option value="ANUAL">Anual</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => void openPortal()}
                    disabled={!isOwnerAdmin}
                    className="rounded-2xl border border-zinc-700 px-4 py-3 text-sm text-zinc-200 transition hover:border-zinc-600 hover:text-white disabled:opacity-60"
                  >
                    Abrir portal Stripe
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          {planChangePreview ? (
            <div className="rounded-3xl border border-cyan-500/25 bg-cyan-500/10 p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.2em] text-cyan-200">
                    {formatPlanChangeType(planChangePreview.tipo)}
                  </p>
                  <h3 className="mt-2 text-lg font-semibold text-white">
                    {planChangePreview.plan_actual.nombre} a{" "}
                    {planChangePreview.plan_nuevo.nombre}
                  </h3>
                  <p className="mt-1 text-sm text-cyan-100/70">
                    Estimacion sobre {planChangePreview.dias_restantes_periodo} dias
                    restantes del periodo actual.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setPlanChangePreview(null);
                    setPlanChangeReadiness(null);
                    setPlanChangeResult(null);
                  }}
                  className="rounded-2xl border border-cyan-500/25 px-3 py-2 text-xs text-cyan-100 transition hover:border-cyan-300"
                >
                  Cerrar
                </button>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-cyan-500/20 bg-zinc-950/60 px-4 py-3">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-cyan-200/70">
                    Saldo del plan actual
                  </p>
                  <p className="mt-2 text-lg font-semibold text-white">
                    {formatMoney(planChangePreview.credito_plan_actual)}
                  </p>
                </div>
                <div className="rounded-2xl border border-cyan-500/20 bg-zinc-950/60 px-4 py-3">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-cyan-200/70">
                    Cargo nuevo periodo
                  </p>
                  <p className="mt-2 text-lg font-semibold text-white">
                    {formatMoney(planChangePreview.cargo_plan_nuevo)}
                  </p>
                </div>
                <div className="rounded-2xl border border-cyan-500/20 bg-zinc-950/60 px-4 py-3">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-cyan-200/70">
                    Resultado estimado
                  </p>
                  <p className="mt-2 text-lg font-semibold text-white">
                    {planChangePreview.genera_saldo_a_favor
                      ? `${formatMoney(planChangePreview.saldo_a_favor_estimado)} a favor`
                      : formatMoney(planChangePreview.monto_a_pagar)}
                  </p>
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-cyan-500/20 bg-zinc-950/60 px-4 py-3 text-sm text-cyan-100/80">
                BetterP conserva esta fecha de prorrateo para que el preview y la
                confirmacion usen la misma referencia en Stripe
                {planChangePreview.stripe_proration_date_iso
                  ? `: ${formatDate(planChangePreview.stripe_proration_date_iso)}.`
                  : "."}
                {planChangeReadiness ? (
                  <span className="mt-2 block text-cyan-100">
                    Modo Stripe {planChangeReadiness.stripe_modo}. Recomendacion:{" "}
                    {planChangeReadiness.modo_recomendado === "INMEDIATO"
                      ? "aplicar ahora"
                      : "programar al renovar"}
                    .
                  </span>
                ) : null}
              </div>

              {planChangePreview.stripe_preview ? (
                <div className="mt-4 rounded-2xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.18em] text-emerald-200/80">
                        Preview Stripe
                      </p>
                      <p className="mt-2 text-sm text-emerald-100/80">
                        Importe estimado por Stripe para confirmar ahora.
                      </p>
                    </div>
                    <p className="text-xl font-semibold text-white">
                      {formatMoney(planChangePreview.stripe_preview.amount_due)}
                    </p>
                  </div>
                  {planChangePreview.stripe_preview.lineas_prorrateo.length ? (
                    <div className="mt-3 divide-y divide-emerald-500/10 text-sm">
                      {planChangePreview.stripe_preview.lineas_prorrateo.map((line) => (
                        <div
                          key={line.id ?? `${line.descripcion}-${line.importe}`}
                          className="flex items-center justify-between gap-3 py-2 text-emerald-100/80"
                        >
                          <span className="truncate">{line.descripcion || "Prorrateo"}</span>
                          <span className="shrink-0 font-medium text-white">
                            {formatMoney(line.importe)}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {planChangePreview.stripe_preview_error ? (
                <div className="mt-4 rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                  No se pudo obtener el preview exacto de Stripe:{" "}
                  {planChangePreview.stripe_preview_error}
                </div>
              ) : null}

              {planChangeReadiness?.advertencias.length ? (
                <div className="mt-4 rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                  {planChangeReadiness.advertencias.map((warning) => (
                    <p key={warning}>{warning}</p>
                  ))}
                </div>
              ) : null}

              {livePlanChangeConfirmationRequired ? (
                <div className="mt-4 rounded-2xl border border-rose-500/25 bg-rose-500/10 px-4 py-3">
                  <label className="block text-sm font-semibold text-rose-100">
                    Confirmacion requerida para Stripe LIVE
                    <input
                      type="text"
                      value={livePlanChangeConfirmation}
                      onChange={(event) =>
                        setLivePlanChangeConfirmation(event.target.value)
                      }
                      placeholder={planChangeReadiness?.confirmacion_live_requerida}
                      className="mt-3 w-full rounded-xl border border-rose-400/25 bg-zinc-950 px-3 py-2 text-sm text-white outline-none transition placeholder:text-rose-100/45 focus:border-rose-300"
                    />
                  </label>
                  <p className="mt-2 text-xs text-rose-100/75">
                    Escribe {planChangeReadiness?.confirmacion_live_requerida} para
                    aplicar ahora. Tambien puedes programar el cambio al renovar.
                  </p>
                </div>
              ) : null}

              {planChangePreview.genera_saldo_a_favor ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-zinc-800 bg-zinc-950/70 px-4 py-3 text-sm text-zinc-200">
                    <input
                      type="radio"
                      checked={creditPreference === "SALDO"}
                      onChange={() => setCreditPreference("SALDO")}
                      className="mt-1 accent-cyan-400"
                    />
                    <span>
                      <span className="block font-semibold text-white">
                        Dejarlo como saldo a favor
                      </span>
                      Se aplica automaticamente en cobros futuros de Stripe.
                    </span>
                  </label>
                  <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-zinc-800 bg-zinc-950/70 px-4 py-3 text-sm text-zinc-200">
                    <input
                      type="radio"
                      checked={creditPreference === "REEMBOLSO"}
                      onChange={() => setCreditPreference("REEMBOLSO")}
                      className="mt-1 accent-cyan-400"
                    />
                    <span>
                      <span className="block font-semibold text-white">
                        Solicitar reembolso
                      </span>
                      BetterP lo deja pendiente para revision interna antes de devolver dinero.
                    </span>
                  </label>
                </div>
              ) : null}

              {planChangeResult ? (
                <div className="mt-4 rounded-2xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
                  Cambio {planChangeResult.estatus.toLowerCase()}.
                </div>
              ) : null}

              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => void confirmPlanChange("INMEDIATO")}
                  disabled={
                    !isOwnerAdmin ||
                    planChangeLoading ||
                    planChangeReadiness?.puede_aplicar_inmediato === false ||
                    !livePlanChangeConfirmationMatches
                  }
                  className="rounded-2xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {planChangeLoading ? "Procesando..." : "Confirmar cambio"}
                </button>
                {planChangeReadiness?.puede_programar_renovacion ||
                planChangePreview.genera_saldo_a_favor ? (
                  <button
                    type="button"
                    onClick={() => void confirmPlanChange("AL_RENOVAR")}
                    disabled={
                      !isOwnerAdmin ||
                      planChangeLoading ||
                      planChangeReadiness?.puede_programar_renovacion === false
                    }
                    className="rounded-2xl border border-zinc-700 px-4 py-3 text-sm text-zinc-200 transition hover:border-zinc-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Cambiar al renovar
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="rounded-3xl border border-zinc-800 bg-zinc-900/40 p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-lg font-semibold text-white">Estado de cuenta de extras</h3>
                <p className="mt-1 text-sm text-zinc-500">
                  {isAnnualSubscription
                    ? "Tu plan anual queda cubierto por el ciclo contratado; aqui veras solo los extras mensuales."
                    : "Tu cobro mensual puede incluir el plan contratado mas los extras que excedan lo incluido."}
                </p>
              </div>
              {usageStatement ? (
                <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-3 text-right">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-cyan-200">
                    Extras {usageStatement.periodo}
                  </p>
                  <p className="mt-1 text-lg font-semibold text-white">
                    {formatMoney(usageStatement.total_extras)}
                  </p>
                  <p className="mt-1 text-[11px] text-cyan-100/70">
                    {isAnnualSubscription ? "Cobro adicional del mes" : "Extra estimado del mes"}
                  </p>
                </div>
              ) : null}
            </div>

            {usageStatement ? (
              <div className="mt-4 space-y-3">
                {usageStatement.alertas?.length ? (
                  <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-3">
                    <p className="text-sm font-semibold text-amber-100">
                      Consumo cercano al limite
                    </p>
                    <div className="mt-2 space-y-1 text-sm text-amber-100/80">
                      {usageStatement.alertas.slice(0, 3).map((alert) => (
                        <p key={`${alert.categoria}-${alert.nivel}`}>
                          {alert.mensaje}
                        </p>
                      ))}
                    </div>
                  </div>
                ) : null}

                {usageStatement.resumen
                  .filter((item) => item.consumido > 0 || item.incluido > 0)
                  .map((item) => (
                    <div
                      key={item.categoria}
                      className="rounded-2xl border border-zinc-800 bg-zinc-950/70 px-4 py-3"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-medium text-white">{item.nombre}</p>
                        <p className="text-sm font-semibold text-cyan-100">
                          {formatMoney(item.importe_extra)}
                        </p>
                      </div>
                      <div className="mt-2 grid gap-2 text-xs text-zinc-500 sm:grid-cols-3">
                        <span>Usado: {formatNumber(item.consumido)}</span>
                        <span>Incluido: {formatNumber(item.incluido)}</span>
                        <span>Excedente: {formatNumber(item.excedente)}</span>
                      </div>
                    </div>
                  ))}

                <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 px-4 py-3">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                    Ultimos movimientos
                  </p>
                  <div className="mt-3 space-y-2">
                    {usageStatement.movimientos.length ? (
                      usageStatement.movimientos.slice(0, 5).map((movement) => (
                        <div
                          key={movement.id}
                          className="flex items-start justify-between gap-3 text-sm"
                        >
                          <div>
                            <p className="text-zinc-200">{movement.descripcion}</p>
                            <p className="text-xs text-zinc-600">
                              {movement.nombre} | {formatNumber(movement.cantidad)}{" "}
                              {movement.unidad}
                            </p>
                          </div>
                          <p className="text-zinc-300">
                            {formatMoney(movement.costo_estimado)}
                          </p>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-zinc-500">
                        Sin consumos extra registrados en este periodo.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-950/70 px-4 py-4 text-sm text-zinc-500">
                Cargando consumos...
              </div>
            )}
          </div>

          <div className="rounded-3xl border border-zinc-800 bg-zinc-900/40 p-4">
            <h3 className="text-lg font-semibold text-white">Cambios de plan</h3>
            <p className="mt-1 text-sm text-zinc-500">
              Historial de upgrades, downgrades, cambios de ciclo y solicitudes de saldo.
            </p>
            <div className="mt-4 space-y-3">
              {planChanges.length ? (
                planChanges.map((change) => (
                  <div
                    key={change.id}
                    className="rounded-2xl border border-zinc-800 bg-zinc-950/70 px-4 py-4"
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="font-medium text-white">
                          {formatPlanChangeType(change.tipo)}
                        </p>
                        <p className="mt-1 text-sm text-zinc-500">
                          {change.plan_anterior?.nombre ?? "Plan anterior"} a{" "}
                          {change.plan_nuevo?.nombre ?? "Plan nuevo"} |{" "}
                          {formatPeriodicity(change.periodicidad_nueva)}
                        </p>
                      </div>
                      <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-100">
                        {change.estatus.replaceAll("_", " ")}
                      </span>
                    </div>
                    <div className="mt-3 grid gap-2 text-xs text-zinc-500 sm:grid-cols-3">
                      <span>Fecha: {formatDate(change.fecha_creacion)}</span>
                      <span>Cargo: {formatMoney(change.monto_a_pagar)}</span>
                      <span>Saldo: {formatMoney(change.saldo_a_favor_estimado)}</span>
                    </div>
                    {change.revision ? (
                      <div className="mt-3 border-t border-zinc-800 pt-3 text-xs text-zinc-500">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <span className="font-medium text-zinc-200">
                            {formatPlanChangeOperationalState(
                              change.revision.estado_operativo
                            )}
                          </span>
                          <span
                            className={
                              change.revision.requiere_revision_manual
                                ? "text-amber-200"
                                : "text-emerald-200"
                            }
                          >
                            {change.revision.requiere_revision_manual
                              ? "Revision manual"
                              : "Sin revision manual"}
                          </span>
                        </div>
                        <p className="mt-2">{change.revision.accion_recomendada}</p>
                        {change.revision.referencia_stripe_principal ? (
                          <p className="mt-1">
                            Referencia Stripe:{" "}
                            {change.revision.referencia_stripe_principal}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 px-4 py-4 text-sm text-zinc-500">
                  Aun no hay cambios de plan registrados.
                </div>
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-zinc-800 bg-zinc-900/40 p-4">
            <h3 className="text-lg font-semibold text-white">Eventos recientes</h3>
            <div className="mt-4 space-y-3">
              {events.length ? (
                events.map((event) => (
                  <div
                    key={event.id}
                    className="rounded-2xl border border-zinc-800 bg-zinc-950/70 px-4 py-4"
                  >
                    <p className="font-medium text-white">{event.tipo_evento}</p>
                    <p className="mt-1 text-sm text-zinc-500">
                      {event.proveedor} | {event.estatus}
                    </p>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 px-4 py-4 text-sm text-zinc-500">
                  Aun no hay eventos de billing registrados para esta capa.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-zinc-800 bg-zinc-900/40 p-4">
          <h3 className="text-lg font-semibold text-white">Catalogo de planes</h3>
          <p className="mt-1 text-sm text-zinc-500">
            Elige el plan que mejor se ajusta a la escala operativa actual de tu portafolio.
          </p>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {plans.map((plan) => {
              const isCurrent = subscription?.plan.id === plan.id;
              const sameCycle = subscription?.periodicidad === billingCycle;
              const isSamePlanAndCycle = isCurrent && sameCycle;
              const price =
                billingCycle === "ANUAL" ? plan.precio_anual : plan.precio_mensual;
              return (
                <div
                  key={plan.id}
                  className={`rounded-3xl border p-4 ${
                    isCurrent
                      ? "border-cyan-500/25 bg-cyan-500/10"
                      : "border-zinc-800 bg-zinc-950/70"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h4 className="text-lg font-semibold text-white">{plan.nombre}</h4>
                      <p className="mt-1 text-sm text-zinc-500">{plan.descripcion}</p>
                    </div>
                    {plan.es_default ? (
                      <span className="rounded-full border border-cyan-500/25 bg-cyan-500/10 px-2.5 py-1 text-[11px] uppercase tracking-[0.2em] text-cyan-200">
                        Base
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-4 text-3xl font-semibold text-white">
                    ${price.toLocaleString("es-MX")}
                    <span className="ml-2 text-sm font-normal text-zinc-500">
                      / {billingCycle === "ANUAL" ? "anio" : "mes"}
                    </span>
                  </div>
                  {billingCycle === "ANUAL" ? (
                    <p className="mt-2 text-sm text-emerald-100">
                      Pago anual: pagas 10 meses y usas 12.
                    </p>
                  ) : null}

                  <div className="mt-4 space-y-2 text-sm text-zinc-300">
                    <p>Usuarios: hasta {plan.max_usuarios}</p>
                    <p>Entidades: hasta {plan.max_entidades}</p>
                    <p>Espacios: hasta {plan.max_espacios}</p>
                    <p>Prueba gratuita: {formatNumber(plan.dias_prueba ?? 0)} dias</p>
                    <p>
                      Operaciones inteligentes:{" "}
                      {formatNumber(Math.ceil((plan.openai_tokens_incluidos ?? 0) / 1000))} incluidas
                    </p>
                    <p>
                      Comprobantes WhatsApp:{" "}
                      {formatNumber(plan.comprobantes_whatsapp_incluidos ?? 0)} incluidos
                    </p>
                    <p>
                      Timbres CFDI: {formatNumber(plan.timbres_facturacion_incluidos ?? 0)} incluidos
                    </p>
                  </div>

                  <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-950/60 px-4 py-3">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                      Incluye
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {resolveDefinitionNames(plan.modulos_habilitados, planModules)
                        .slice(0, 6)
                        .map((name) => (
                          <span
                            key={name}
                            className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-1 text-xs text-cyan-100"
                          >
                            {name}
                          </span>
                        ))}
                      {resolveDefinitionNames(plan.funciones_habilitadas, planFeatures)
                        .slice(0, 4)
                        .map((name) => (
                          <span
                            key={name}
                            className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-100"
                          >
                            {name}
                          </span>
                        ))}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => void launchCheckout(plan.id)}
                    disabled={!isOwnerAdmin || isSamePlanAndCycle || planChangeLoading}
                    className={`mt-5 w-full rounded-2xl px-4 py-3 text-sm font-semibold transition ${
                      isSamePlanAndCycle
                        ? "border border-cyan-500/25 bg-transparent text-cyan-200"
                        : "bg-cyan-500 text-zinc-950 hover:bg-cyan-400"
                    } disabled:cursor-not-allowed disabled:opacity-60`}
                  >
                    {isSamePlanAndCycle
                      ? "Plan actual"
                      : subscription?.stripe_subscription_id && subscription.estatus === "ACTIVA"
                        ? isCurrent
                          ? `Cambiar a ${formatPeriodicity(billingCycle).toLowerCase()}`
                          : "Revisar cambio"
                        : "Contratar plan"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
