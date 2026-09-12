"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { buildApiUrl } from "@/lib/api";

type OptionItem = {
  value: string;
  label: string;
};

type SellerItem = {
  id: number;
  nombre: string;
  email: string;
  telefono?: string | null;
  activo: boolean;
  token_acceso?: string;
  porcentaje_comision_default: number;
  notas_internas?: string | null;
};

type SolutionItem = {
  id: number;
  clave: string;
  nombre: string;
};

type PlanItem = {
  id: number;
  clave?: string;
  nombre: string;
  solution?: SolutionItem | null;
  precio_mensual: number;
  precio_anual: number;
};

type SalesAssignment = {
  id: number;
  vendedor_id?: number | null;
  vendedor_nombre?: string | null;
  origen: string;
  porcentaje_comision: number;
  comision_activa: boolean;
  fecha_inicio?: string | null;
  fecha_fin?: string | null;
  notas_internas?: string | null;
};

type OperationalCost = {
  id: number;
  suscripcion_id: number;
  categoria: string;
  concepto: string;
  monto_mensual: number;
  activo: boolean;
  fecha_inicio?: string | null;
  fecha_fin?: string | null;
  notas_internas?: string | null;
};

type SalesMetrics = {
  ingreso_mensual_estimado: number;
  costos_operativos: number;
  utilidad_bruta: number;
  comision_estimada: number;
  margen: number;
};

type SalesClient = {
  id: number;
  estatus: string;
  periodicidad: string;
  plan: PlanItem;
  capa_negocio: {
    id: number;
    nombre: string;
    correo_contacto?: string | null;
    telefono_contacto?: string | null;
    activo: boolean;
  };
  asignacion_comercial?: SalesAssignment | null;
  costos_operativos: OperationalCost[];
  metricas_ventas: SalesMetrics;
};

type SalesPayload = {
  resumen: SalesMetrics & {
    clientes: number;
    clientes_con_vendedor: number;
  };
  vendedores: SellerItem[];
  clientes: SalesClient[];
  historical_clients?: Array<SalesClient & {
    read_only: true;
    history_reason: string;
    retired_into?: string | null;
    fecha_actualizacion?: string | null;
  }>;
  scope?: {
    operational: number;
    historical: number;
  };
  origenes: OptionItem[];
  categorias_costo: OptionItem[];
};

type SalesPlanControlRow = {
  planId: string;
  planName: string;
  clients: number;
  assigned: number;
  mrr: number;
  costs: number;
  profit: number;
  commission: number;
  margin: number;
  status: "OK" | "WARN" | "ERROR";
};

type SalesSolutionControlRow = {
  solutionKey: string;
  solutionName: string;
  clients: number;
  assigned: number;
  mrr: number;
  costs: number;
  profit: number;
  commission: number;
  margin: number;
  status: "OK" | "WARN" | "ERROR";
  action: string;
  plans: SalesPlanControlRow[];
};

type SellerDraft = {
  id?: number;
  nombre: string;
  email: string;
  telefono: string;
  activo: boolean;
  porcentaje_comision_default: string;
  notas_internas: string;
};

type AssignmentDraft = {
  vendedor_id: string;
  origen: string;
  porcentaje_comision: string;
  comision_activa: boolean;
  fecha_inicio: string;
  fecha_fin: string;
  notas_internas: string;
};

type CostDraft = {
  id?: number;
  suscripcion_id: string;
  categoria: string;
  concepto: string;
  monto_mensual: string;
  activo: boolean;
  fecha_inicio: string;
  fecha_fin: string;
  notas_internas: string;
};

function emptySellerDraft(): SellerDraft {
  return {
    nombre: "",
    email: "",
    telefono: "",
    activo: true,
    porcentaje_comision_default: "10",
    notas_internas: "",
  };
}

function sellerToDraft(seller: SellerItem): SellerDraft {
  return {
    id: seller.id,
    nombre: seller.nombre,
    email: seller.email,
    telefono: seller.telefono ?? "",
    activo: seller.activo,
    porcentaje_comision_default: String(seller.porcentaje_comision_default ?? 0),
    notas_internas: seller.notas_internas ?? "",
  };
}

function clientToAssignmentDraft(client: SalesClient): AssignmentDraft {
  const assignment = client.asignacion_comercial;
  return {
    vendedor_id: assignment?.vendedor_id ? String(assignment.vendedor_id) : "",
    origen: assignment?.origen ?? "ORGANICO",
    porcentaje_comision: String(assignment?.porcentaje_comision ?? 0),
    comision_activa: assignment?.comision_activa ?? false,
    fecha_inicio: assignment?.fecha_inicio ?? "",
    fecha_fin: assignment?.fecha_fin ?? "",
    notas_internas: assignment?.notas_internas ?? "",
  };
}

function emptyCostDraft(clientId: number, firstCategory = "SOPORTE"): CostDraft {
  return {
    suscripcion_id: String(clientId),
    categoria: firstCategory,
    concepto: "",
    monto_mensual: "0",
    activo: true,
    fecha_inicio: "",
    fecha_fin: "",
    notas_internas: "",
  };
}

function costToDraft(cost: OperationalCost): CostDraft {
  return {
    id: cost.id,
    suscripcion_id: String(cost.suscripcion_id),
    categoria: cost.categoria,
    concepto: cost.concepto,
    monto_mensual: String(cost.monto_mensual ?? 0),
    activo: cost.activo,
    fecha_inicio: cost.fecha_inicio ?? "",
    fecha_fin: cost.fecha_fin ?? "",
    notas_internas: cost.notas_internas ?? "",
  };
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function formatPercent(value: number) {
  return `${new Intl.NumberFormat("es-MX", { maximumFractionDigits: 1 }).format(value || 0)}%`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("es-MX").format(value || 0);
}

function salesClientSolutionKey(client: SalesClient) {
  return client.plan.solution?.clave || "sin_solucion";
}

function salesClientSolutionName(client: SalesClient) {
  return client.plan.solution?.nombre || "Sin solucion";
}

function buildSalesSummaryFromClients(clients: SalesClient[]): SalesPayload["resumen"] {
  const totals = clients.reduce(
    (summary, client) => {
      summary.ingreso_mensual_estimado += client.metricas_ventas.ingreso_mensual_estimado || 0;
      summary.costos_operativos += client.metricas_ventas.costos_operativos || 0;
      summary.utilidad_bruta += client.metricas_ventas.utilidad_bruta || 0;
      summary.comision_estimada += client.metricas_ventas.comision_estimada || 0;
      if (client.asignacion_comercial?.vendedor_id) {
        summary.clientes_con_vendedor += 1;
      }
      return summary;
    },
    {
      clientes: clients.length,
      clientes_con_vendedor: 0,
      ingreso_mensual_estimado: 0,
      costos_operativos: 0,
      utilidad_bruta: 0,
      comision_estimada: 0,
      margen: 0,
    }
  );
  totals.margen = totals.ingreso_mensual_estimado
    ? (totals.utilidad_bruta * 100) / totals.ingreso_mensual_estimado
    : 0;
  return totals;
}

function statusBadgeClasses(status: string) {
  switch (status) {
    case "ACTIVA":
      return "border-emerald-500/20 bg-emerald-500/10 text-emerald-200";
    case "TRIAL":
      return "border-cyan-500/20 bg-cyan-500/10 text-cyan-200";
    case "PAST_DUE":
    case "PENDIENTE_PAGO":
      return "border-amber-500/20 bg-amber-500/10 text-amber-200";
    case "CANCELADA":
    case "PAUSADA":
      return "border-rose-500/20 bg-rose-500/10 text-rose-200";
    default:
      return "border-white/10 bg-white/5 text-zinc-300";
  }
}

function salesControlStatusClasses(status?: string) {
  if (status === "ERROR") return "border-rose-500/25 bg-rose-500/10 text-rose-100";
  if (status === "WARN") return "border-amber-500/25 bg-amber-500/10 text-amber-100";
  return "border-emerald-500/20 bg-emerald-500/10 text-emerald-100";
}

function salesControlBarClass(status?: string) {
  if (status === "ERROR") return "bg-rose-400";
  if (status === "WARN") return "bg-amber-300";
  return "bg-cyan-300";
}

function salesControlStatusRank(status?: string) {
  if (status === "ERROR") return 0;
  if (status === "WARN") return 1;
  return 2;
}

function shellCardClass(extra = "") {
  return `rounded-[28px] border border-white/8 bg-zinc-950/70 shadow-[0_20px_80px_rgba(0,0,0,0.24)] ${extra}`;
}

function inputClass() {
  return "w-full rounded-2xl border border-white/8 bg-zinc-900/80 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-500";
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json().catch(() => ({}))) as T;
}

function MetricCard({
  label,
  value,
  tone = "cyan",
}: {
  label: string;
  value: string;
  tone?: "cyan" | "emerald" | "amber" | "rose";
}) {
  const toneClass =
    tone === "emerald"
      ? "from-emerald-500/10"
      : tone === "amber"
        ? "from-amber-500/10"
        : tone === "rose"
          ? "from-rose-500/10"
          : "from-cyan-500/10";
  return (
    <article className={`${shellCardClass("p-5")} bg-gradient-to-br ${toneClass} via-zinc-950/70 to-zinc-950/70`}>
      <p className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">{label}</p>
      <p className="mt-3 text-3xl font-semibold text-white">{value}</p>
    </article>
  );
}

export default function BusinessSalesManager() {
  const { user } = useAuth();
  const [data, setData] = useState<SalesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [sellerDraft, setSellerDraft] = useState<SellerDraft>(emptySellerDraft());
  const [assignmentDrafts, setAssignmentDrafts] = useState<Record<number, AssignmentDraft>>({});
  const [costDraft, setCostDraft] = useState<CostDraft | null>(null);
  const [solutionFilter, setSolutionFilter] = useState("TODOS");
  const [planFilter, setPlanFilter] = useState("TODOS");

  const firstCostCategory = data?.categorias_costo[0]?.value ?? "SOPORTE";
  const activeSellers = useMemo(
    () => (data?.vendedores ?? []).filter((seller) => seller.activo),
    [data?.vendedores]
  );
  const salesSolutionFilters = useMemo(() => {
    const byKey = new Map<string, { key: string; label: string; count: number }>();
    for (const client of data?.clientes ?? []) {
      const key = salesClientSolutionKey(client);
      const current = byKey.get(key);
      if (current) {
        current.count += 1;
      } else {
        byKey.set(key, { key, label: salesClientSolutionName(client), count: 1 });
      }
    }
    return Array.from(byKey.values()).sort((first, second) =>
      first.label.localeCompare(second.label)
    );
  }, [data?.clientes]);
  const salesSolutionScope = useMemo(
    () =>
      solutionFilter === "TODOS"
        ? data?.clientes ?? []
        : (data?.clientes ?? []).filter(
            (client) => salesClientSolutionKey(client) === solutionFilter
          ),
    [data?.clientes, solutionFilter]
  );
  const salesPlanFilters = useMemo(() => {
    const byKey = new Map<string, { key: string; label: string; count: number }>();
    for (const client of salesSolutionScope) {
      const key = String(client.plan.id);
      const current = byKey.get(key);
      if (current) {
        current.count += 1;
      } else {
        byKey.set(key, { key, label: client.plan.nombre, count: 1 });
      }
    }
    return Array.from(byKey.values()).sort((first, second) =>
      first.label.localeCompare(second.label)
    );
  }, [salesSolutionScope]);
  const filteredSalesClients = useMemo(
    () =>
      planFilter === "TODOS"
        ? salesSolutionScope
        : salesSolutionScope.filter((client) => String(client.plan.id) === planFilter),
    [planFilter, salesSolutionScope]
  );
  const filteredSalesSummary = useMemo(
    () => buildSalesSummaryFromClients(filteredSalesClients),
    [filteredSalesClients]
  );
  const salesSolutionControlRows = useMemo<SalesSolutionControlRow[]>(() => {
    type SalesSolutionDraft = SalesSolutionControlRow & {
      planMap: Map<string, SalesPlanControlRow>;
    };
    const bySolution = new Map<string, SalesSolutionDraft>();
    const ensureSolution = (client: SalesClient): SalesSolutionDraft => {
      const key = salesClientSolutionKey(client);
      const current = bySolution.get(key);
      if (current) return current;
      const created: SalesSolutionDraft = {
        solutionKey: key,
        solutionName: salesClientSolutionName(client),
        clients: 0,
        assigned: 0,
        mrr: 0,
        costs: 0,
        profit: 0,
        commission: 0,
        margin: 0,
        status: "OK",
        action: "Segmento comercial sano.",
        plans: [],
        planMap: new Map(),
      };
      bySolution.set(key, created);
      return created;
    };
    const ensurePlan = (
      solution: SalesSolutionDraft,
      client: SalesClient
    ): SalesPlanControlRow => {
      const key = String(client.plan.id);
      const current = solution.planMap.get(key);
      if (current) return current;
      const created: SalesPlanControlRow = {
        planId: key,
        planName: client.plan.nombre,
        clients: 0,
        assigned: 0,
        mrr: 0,
        costs: 0,
        profit: 0,
        commission: 0,
        margin: 0,
        status: "OK",
      };
      solution.planMap.set(key, created);
      return created;
    };
    const applyClient = (
      row: SalesSolutionControlRow | SalesPlanControlRow,
      client: SalesClient
    ) => {
      row.clients += 1;
      if (client.asignacion_comercial?.vendedor_id) row.assigned += 1;
      row.mrr += client.metricas_ventas.ingreso_mensual_estimado || 0;
      row.costs += client.metricas_ventas.costos_operativos || 0;
      row.profit += client.metricas_ventas.utilidad_bruta || 0;
      row.commission += client.metricas_ventas.comision_estimada || 0;
    };
    const finalize = (row: SalesSolutionControlRow | SalesPlanControlRow) => {
      row.margin = row.mrr ? (row.profit * 100) / row.mrr : 0;
      if (row.profit < 0 || (row.mrr > 0 && row.margin < 20)) {
        row.status = "ERROR";
      } else if (row.assigned < row.clients || (row.mrr > 0 && row.margin < 50)) {
        row.status = "WARN";
      } else {
        row.status = "OK";
      }
    };

    for (const client of data?.clientes ?? []) {
      const solution = ensureSolution(client);
      const plan = ensurePlan(solution, client);
      applyClient(solution, client);
      applyClient(plan, client);
    }

    return Array.from(bySolution.values())
      .map((solution) => {
        solution.plans = Array.from(solution.planMap.values())
          .map((plan) => {
            finalize(plan);
            return plan;
          })
          .sort((first, second) => {
            if (first.status !== second.status) {
              return salesControlStatusRank(first.status) - salesControlStatusRank(second.status);
            }
            return second.mrr - first.mrr;
          });
        finalize(solution);
        if (solution.profit < 0) {
          solution.action = "Corregir precio, costos o alcance antes de escalar.";
        } else if (solution.assigned < solution.clients) {
          solution.action = "Completar atribucion comercial para todos los clientes.";
        } else if (solution.margin < 50 && solution.mrr > 0) {
          solution.action = "Revisar costos y comisiones para proteger margen.";
        }
        return solution;
      })
      .sort((first, second) => {
        if (first.status !== second.status) {
          return salesControlStatusRank(first.status) - salesControlStatusRank(second.status);
        }
        return second.mrr - first.mrr;
      });
  }, [data?.clientes]);

  async function loadSales(soft = false) {
    setErrorMessage("");
    if (soft) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    try {
      const response = await fetch(buildApiUrl("/billing/admin/ventas/"), {
        cache: "no-store",
      });
      const body = await readJson<SalesPayload & { detail?: string }>(response);
      if (!response.ok) {
        throw new Error(body.detail || "No se pudo cargar ventas BetterP.");
      }
      setData(body);
      setAssignmentDrafts((current) => {
        const next: Record<number, AssignmentDraft> = {};
        for (const client of body.clientes) {
          next[client.id] = current[client.id] ?? clientToAssignmentDraft(client);
        }
        return next;
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "No se pudo cargar ventas BetterP.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void loadSales();
  }, []);

  async function submitJson(path: string, method: "POST" | "PATCH" | "DELETE", body?: unknown) {
    const response = await fetch(buildApiUrl(path), {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = await readJson<{ detail?: string; mensaje?: string }>(response);
    if (!response.ok) {
      throw new Error(payload.detail || "No se pudo guardar la informacion.");
    }
    return payload;
  }

  async function handleSaveSeller(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice("");
    setErrorMessage("");
    const payload = {
      ...sellerDraft,
      porcentaje_comision_default: Number(sellerDraft.porcentaje_comision_default || 0),
    };
    try {
      const path = sellerDraft.id
        ? `/billing/admin/ventas/vendedores/${sellerDraft.id}/`
        : "/billing/admin/ventas/vendedores/";
      const method = sellerDraft.id ? "PATCH" : "POST";
      const result = await submitJson(path, method, payload);
      setNotice(result.mensaje || "Vendedor guardado correctamente.");
      setSellerDraft(emptySellerDraft());
      await loadSales(true);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "No se pudo guardar el vendedor.");
    }
  }

  async function handleRotateToken(sellerId: number) {
    setNotice("");
    setErrorMessage("");
    try {
      const result = await submitJson(
        `/billing/admin/ventas/vendedores/${sellerId}/rotar-token/`,
        "POST"
      );
      setNotice(result.mensaje || "Link actualizado correctamente.");
      await loadSales(true);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "No se pudo actualizar el link.");
    }
  }

  async function handleSaveAssignment(clientId: number) {
    const draft = assignmentDrafts[clientId];
    if (!draft) return;
    setNotice("");
    setErrorMessage("");
    try {
      const result = await submitJson(`/billing/admin/ventas/asignaciones/${clientId}/`, "PATCH", {
        ...draft,
        vendedor_id: draft.vendedor_id ? Number(draft.vendedor_id) : null,
        porcentaje_comision: Number(draft.porcentaje_comision || 0),
      });
      setNotice(result.mensaje || "Asignacion guardada correctamente.");
      await loadSales(true);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "No se pudo guardar la asignacion.");
    }
  }

  async function handleSaveCost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!costDraft) return;
    setNotice("");
    setErrorMessage("");
    try {
      const payload = {
        ...costDraft,
        suscripcion_id: Number(costDraft.suscripcion_id),
        monto_mensual: Number(costDraft.monto_mensual || 0),
      };
      const path = costDraft.id
        ? `/billing/admin/ventas/costos/${costDraft.id}/`
        : "/billing/admin/ventas/costos/";
      const method = costDraft.id ? "PATCH" : "POST";
      const result = await submitJson(path, method, payload);
      setNotice(result.mensaje || "Costo guardado correctamente.");
      setCostDraft(null);
      await loadSales(true);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "No se pudo guardar el costo.");
    }
  }

  async function handleDeactivateCost(costId: number) {
    setNotice("");
    setErrorMessage("");
    try {
      const result = await submitJson(`/billing/admin/ventas/costos/${costId}/`, "DELETE");
      setNotice(result.mensaje || "Costo desactivado correctamente.");
      await loadSales(true);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "No se pudo desactivar el costo.");
    }
  }

  function sellerPortalUrl(seller: SellerItem) {
    if (!seller.token_acceso || typeof window === "undefined") return "";
    return `${window.location.origin}/vendedores/${seller.token_acceso}`;
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5">
      <section className={`${shellCardClass("p-4 sm:p-5")} flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between`}>
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-[0.26em] text-zinc-500">
            Betterp | Ventas BetterP
          </p>
          <p className="mt-2 text-sm leading-7 text-zinc-400">
            {user?.nombre || "Admin de plataforma"} | Gestion interna de vendedores,
            atribucion comercial, costos y comisiones SaaS.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadSales(true)}
          className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-zinc-900/70 px-4 py-2.5 text-sm text-white transition hover:border-zinc-700 hover:bg-zinc-900"
        >
          {refreshing ? "Actualizando..." : "Refrescar vista"}
        </button>
      </section>

      {notice ? (
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {notice}
        </div>
      ) : null}

      {errorMessage ? (
        <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {errorMessage}
        </div>
      ) : null}

      {loading || !data ? (
        <div className="grid gap-4 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div
              key={index}
              className="h-40 animate-pulse rounded-[28px] border border-white/8 bg-zinc-900/60"
            />
          ))}
        </div>
      ) : (
        <>
          <section className={`${shellCardClass("p-5")} space-y-4`}>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">
                  Segmentacion comercial
                </p>
                <p className="mt-1 text-sm text-zinc-500">
                  Mostrando {filteredSalesClients.length} de {data.clientes.length} cliente(s) SaaS.
                </p>
              </div>
              <div className="flex flex-wrap gap-2 text-xs text-zinc-300">
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
                  {filteredSalesSummary.clientes} clientes
                </span>
                <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1.5 text-cyan-100">
                  {filteredSalesSummary.clientes_con_vendedor} con vendedor
                </span>
              </div>
            </div>

            <div className="grid gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-600">Solucion</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSolutionFilter("TODOS");
                      setPlanFilter("TODOS");
                    }}
                    className={`rounded-2xl border px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] transition ${
                      solutionFilter === "TODOS"
                        ? "border-cyan-400/40 bg-cyan-500/15 text-cyan-100"
                        : "border-white/10 bg-white/[0.03] text-zinc-400 hover:border-cyan-500/25 hover:bg-cyan-500/10 hover:text-cyan-100"
                    }`}
                  >
                    Todas · {data.clientes.length}
                  </button>
                  {salesSolutionFilters.map((filter) => (
                    <button
                      key={filter.key}
                      type="button"
                      onClick={() => {
                        setSolutionFilter(filter.key);
                        setPlanFilter("TODOS");
                      }}
                      className={`rounded-2xl border px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] transition ${
                        solutionFilter === filter.key
                          ? "border-cyan-400/40 bg-cyan-500/15 text-cyan-100"
                          : "border-white/10 bg-white/[0.03] text-zinc-400 hover:border-cyan-500/25 hover:bg-cyan-500/10 hover:text-cyan-100"
                      }`}
                    >
                      {filter.label} · {filter.count}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-600">Plan</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setPlanFilter("TODOS")}
                    className={`rounded-2xl border px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] transition ${
                      planFilter === "TODOS"
                        ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-100"
                        : "border-white/10 bg-white/[0.03] text-zinc-400 hover:border-emerald-500/25 hover:bg-emerald-500/10 hover:text-emerald-100"
                    }`}
                  >
                    Todos · {salesSolutionScope.length}
                  </button>
                  {salesPlanFilters.map((filter) => (
                    <button
                      key={filter.key}
                      type="button"
                      onClick={() => setPlanFilter(filter.key)}
                      className={`rounded-2xl border px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] transition ${
                        planFilter === filter.key
                          ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-100"
                          : "border-white/10 bg-white/[0.03] text-zinc-400 hover:border-emerald-500/25 hover:bg-emerald-500/10 hover:text-emerald-100"
                      }`}
                    >
                      {filter.label} · {filter.count}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {salesSolutionControlRows.length ? (
            <section className={`${shellCardClass("p-5")} space-y-4`}>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.22em] text-cyan-200/80">
                    Control comercial por solucion
                  </p>
                  <p className="mt-1 text-sm leading-6 text-zinc-500">
                    Rentabilidad, atribucion y margen para operar Renta Facil y BetterP Commerce
                    sin mezclar indicadores historicos.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-300">
                    {formatNumber(salesSolutionControlRows.length)} solucion(es)
                  </span>
                  <span className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-cyan-100">
                    {formatNumber(salesSolutionControlRows.reduce((total, item) => total + item.plans.length, 0))} plan(es)
                  </span>
                </div>
              </div>

              <div className="grid gap-3 xl:grid-cols-2">
                {salesSolutionControlRows.map((solution) => (
                  <article
                    key={solution.solutionKey}
                    className="rounded-3xl border border-white/8 bg-white/[0.03] p-4"
                  >
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate text-base font-semibold text-white">
                            {solution.solutionName}
                          </h3>
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${salesControlStatusClasses(
                              solution.status
                            )}`}
                          >
                            {solution.status}
                          </span>
                        </div>
                        <p className="mt-2 text-xs leading-5 text-zinc-500">
                          {solution.action}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setSolutionFilter(solution.solutionKey);
                          setPlanFilter("TODOS");
                        }}
                        className="shrink-0 rounded-2xl border border-cyan-500/20 bg-cyan-500/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-cyan-100 transition hover:border-cyan-400/40 hover:bg-cyan-500/15"
                      >
                        Ver solucion
                      </button>
                    </div>

                    <div className="mt-4 grid gap-2 sm:grid-cols-4">
                      <div className="rounded-2xl border border-white/8 bg-black/20 p-3">
                        <p className="text-[9px] uppercase tracking-[0.14em] text-zinc-500">
                          MRR
                        </p>
                        <p className="mt-1 text-lg font-semibold text-white">
                          {formatCurrency(solution.mrr)}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-white/8 bg-black/20 p-3">
                        <p className="text-[9px] uppercase tracking-[0.14em] text-zinc-500">
                          Utilidad
                        </p>
                        <p className="mt-1 text-lg font-semibold text-white">
                          {formatCurrency(solution.profit)}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-white/8 bg-black/20 p-3">
                        <p className="text-[9px] uppercase tracking-[0.14em] text-zinc-500">
                          Margen
                        </p>
                        <p className="mt-1 text-lg font-semibold text-white">
                          {formatPercent(solution.margin)}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-white/8 bg-black/20 p-3">
                        <p className="text-[9px] uppercase tracking-[0.14em] text-zinc-500">
                          Vendedor
                        </p>
                        <p className="mt-1 text-lg font-semibold text-white">
                          {formatNumber(solution.assigned)}/{formatNumber(solution.clients)}
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 space-y-2">
                      {solution.plans.slice(0, 4).map((plan) => {
                        const share = solution.mrr ? Math.round((plan.mrr / solution.mrr) * 100) : 0;
                        return (
                          <button
                            key={`${solution.solutionKey}-${plan.planId}`}
                            type="button"
                            onClick={() => {
                              setSolutionFilter(solution.solutionKey);
                              setPlanFilter(plan.planId);
                            }}
                            className="w-full rounded-2xl border border-white/8 bg-black/20 px-3 py-2 text-left transition hover:border-emerald-500/25 hover:bg-emerald-500/10"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="min-w-0 truncate text-xs font-semibold text-zinc-200">
                                {plan.planName}
                              </span>
                              <span
                                className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] ${salesControlStatusClasses(
                                  plan.status
                                )}`}
                              >
                                {formatNumber(plan.clients)} cliente(s)
                              </span>
                            </div>
                            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/8">
                              <div
                                className={`h-full rounded-full ${salesControlBarClass(plan.status)}`}
                                style={{ width: `${Math.min(Math.max(share, 4), 100)}%` }}
                              />
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-zinc-500">
                              <span>{formatCurrency(plan.mrr)} MRR</span>
                              <span>{formatCurrency(plan.profit)} utilidad</span>
                              <span>{formatNumber(plan.assigned)}/{formatNumber(plan.clients)} vendedores</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <MetricCard label="MRR estimado" value={formatCurrency(filteredSalesSummary.ingreso_mensual_estimado)} />
            <MetricCard label="Costos" value={formatCurrency(filteredSalesSummary.costos_operativos)} tone="amber" />
            <MetricCard label="Utilidad bruta" value={formatCurrency(filteredSalesSummary.utilidad_bruta)} tone="emerald" />
            <MetricCard label="Comisiones" value={formatCurrency(filteredSalesSummary.comision_estimada)} tone="rose" />
            <MetricCard label="Margen" value={formatPercent(filteredSalesSummary.margen)} />
          </section>

          <section className="grid gap-5 xl:grid-cols-[0.9fr_1.6fr]">
            <article className={shellCardClass("p-5")}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Vendedores</p>
                  <h2 className="mt-2 text-xl font-semibold text-white">Equipo comercial interno</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setSellerDraft(emptySellerDraft())}
                  className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-2 text-sm text-cyan-100 transition hover:border-cyan-400/40"
                >
                  Nuevo
                </button>
              </div>

              <form onSubmit={handleSaveSeller} className="mt-5 grid gap-4">
                <input className={inputClass()} placeholder="Nombre" value={sellerDraft.nombre} onChange={(event) => setSellerDraft({ ...sellerDraft, nombre: event.target.value })} />
                <input className={inputClass()} placeholder="Correo" type="email" value={sellerDraft.email} onChange={(event) => setSellerDraft({ ...sellerDraft, email: event.target.value })} />
                <input className={inputClass()} placeholder="Telefono" value={sellerDraft.telefono} onChange={(event) => setSellerDraft({ ...sellerDraft, telefono: event.target.value })} />
                <input className={inputClass()} placeholder="Comision default %" type="number" min="0" max="100" step="0.01" value={sellerDraft.porcentaje_comision_default} onChange={(event) => setSellerDraft({ ...sellerDraft, porcentaje_comision_default: event.target.value })} />
                <textarea className={inputClass()} placeholder="Notas internas" rows={3} value={sellerDraft.notas_internas} onChange={(event) => setSellerDraft({ ...sellerDraft, notas_internas: event.target.value })} />
                <label className="flex items-center gap-3 rounded-2xl border border-white/8 bg-zinc-900/60 px-4 py-3 text-sm text-zinc-300">
                  <input type="checkbox" checked={sellerDraft.activo} onChange={(event) => setSellerDraft({ ...sellerDraft, activo: event.target.checked })} />
                  Vendedor activo
                </label>
                <button type="submit" className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 px-5 py-3 text-sm font-medium text-cyan-100 transition hover:border-cyan-400/40">
                  {sellerDraft.id ? "Guardar vendedor" : "Registrar vendedor"}
                </button>
              </form>

              <div className="mt-6 space-y-3">
                {data.vendedores.map((seller) => (
                  <div key={seller.id} className="rounded-3xl border border-white/8 bg-zinc-900/60 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-white">{seller.nombre}</p>
                        <p className="mt-1 break-all text-sm text-zinc-400">{seller.email}</p>
                        <p className="mt-1 text-sm text-zinc-500">
                          {formatPercent(seller.porcentaje_comision_default)} default | {seller.activo ? "Activo" : "Inactivo"}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSellerDraft(sellerToDraft(seller))}
                        className="rounded-xl border border-white/10 px-3 py-2 text-xs text-zinc-200 transition hover:border-zinc-600"
                      >
                        Editar
                      </button>
                    </div>
                    <div className="mt-3 rounded-2xl border border-white/8 bg-zinc-950/70 p-3">
                      <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">Portal vendedor</p>
                      <p className="mt-2 break-all text-xs text-zinc-300">{sellerPortalUrl(seller)}</p>
                      <button
                        type="button"
                        onClick={() => void handleRotateToken(seller.id)}
                        className="mt-3 rounded-xl border border-white/10 px-3 py-2 text-xs text-zinc-200 transition hover:border-zinc-600"
                      >
                        Regenerar link
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </article>

            <article className={shellCardClass("p-5")}>
              <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Clientes SaaS</p>
              <h2 className="mt-2 text-xl font-semibold text-white">Atribucion, rentabilidad y comisiones</h2>

              <div className="mt-5 space-y-4">
                {filteredSalesClients.map((client) => {
                  const draft = assignmentDrafts[client.id] ?? clientToAssignmentDraft(client);
                  return (
                    <div key={client.id} className="rounded-3xl border border-white/8 bg-zinc-900/60 p-4">
                      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-lg font-semibold text-white">{client.capa_negocio.nombre}</h3>
                            <span className={`rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.18em] ${statusBadgeClasses(client.estatus)}`}>
                              {client.estatus}
                            </span>
                          </div>
                          <p className="mt-2 text-sm text-zinc-400">
                            {client.plan.solution?.nombre ? `${client.plan.solution.nombre} | ` : ""}{client.plan.nombre} | {client.periodicidad} | {client.capa_negocio.correo_contacto || "Sin correo"}
                          </p>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-right sm:grid-cols-5 xl:min-w-[520px]">
                          <div>
                            <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">MRR</p>
                            <p className="text-sm font-semibold text-white">{formatCurrency(client.metricas_ventas.ingreso_mensual_estimado)}</p>
                          </div>
                          <div>
                            <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Costos</p>
                            <p className="text-sm font-semibold text-white">{formatCurrency(client.metricas_ventas.costos_operativos)}</p>
                          </div>
                          <div>
                            <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Utilidad</p>
                            <p className="text-sm font-semibold text-white">{formatCurrency(client.metricas_ventas.utilidad_bruta)}</p>
                          </div>
                          <div>
                            <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Comision</p>
                            <p className="text-sm font-semibold text-white">{formatCurrency(client.metricas_ventas.comision_estimada)}</p>
                          </div>
                          <div>
                            <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Margen</p>
                            <p className="text-sm font-semibold text-white">{formatPercent(client.metricas_ventas.margen)}</p>
                          </div>
                        </div>
                      </div>

                      <div className="mt-5 grid gap-3 xl:grid-cols-6">
                        <select className={inputClass()} value={draft.origen} onChange={(event) => setAssignmentDrafts((current) => ({ ...current, [client.id]: { ...draft, origen: event.target.value } }))}>
                          {data.origenes.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                        <select className={inputClass()} value={draft.vendedor_id} onChange={(event) => setAssignmentDrafts((current) => ({ ...current, [client.id]: { ...draft, vendedor_id: event.target.value } }))}>
                          <option value="">Sin vendedor</option>
                          {activeSellers.map((seller) => <option key={seller.id} value={seller.id}>{seller.nombre}</option>)}
                        </select>
                        <input className={inputClass()} type="number" min="0" max="100" step="0.01" value={draft.porcentaje_comision} onChange={(event) => setAssignmentDrafts((current) => ({ ...current, [client.id]: { ...draft, porcentaje_comision: event.target.value } }))} />
                        <input className={inputClass()} type="date" value={draft.fecha_inicio} onChange={(event) => setAssignmentDrafts((current) => ({ ...current, [client.id]: { ...draft, fecha_inicio: event.target.value } }))} />
                        <input className={inputClass()} type="date" value={draft.fecha_fin} onChange={(event) => setAssignmentDrafts((current) => ({ ...current, [client.id]: { ...draft, fecha_fin: event.target.value } }))} />
                        <label className="flex items-center gap-3 rounded-2xl border border-white/8 bg-zinc-900/80 px-4 py-3 text-sm text-zinc-300">
                          <input type="checkbox" checked={draft.comision_activa} onChange={(event) => setAssignmentDrafts((current) => ({ ...current, [client.id]: { ...draft, comision_activa: event.target.checked } }))} />
                          Comision activa
                        </label>
                      </div>
                      <textarea className={`${inputClass()} mt-3`} rows={2} placeholder="Notas internas de atribucion" value={draft.notas_internas} onChange={(event) => setAssignmentDrafts((current) => ({ ...current, [client.id]: { ...draft, notas_internas: event.target.value } }))} />
                      <div className="mt-4 flex flex-wrap gap-3">
                        <button type="button" onClick={() => void handleSaveAssignment(client.id)} className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-2.5 text-sm text-cyan-100 transition hover:border-cyan-400/40">
                          Guardar asignacion
                        </button>
                        <button type="button" onClick={() => setCostDraft(emptyCostDraft(client.id, firstCostCategory))} className="rounded-2xl border border-white/10 bg-zinc-950/70 px-4 py-2.5 text-sm text-zinc-200 transition hover:border-zinc-600">
                          Agregar costo
                        </button>
                      </div>

                      {client.costos_operativos.length ? (
                        <div className="mt-4 grid gap-2 lg:grid-cols-2">
                          {client.costos_operativos.map((cost) => (
                            <div key={cost.id} className="rounded-2xl border border-white/8 bg-zinc-950/70 p-3">
                              <div className="flex items-start justify-between gap-2">
                                <div>
                                  <p className="font-medium text-white">{cost.concepto}</p>
                                  <p className="mt-1 text-xs text-zinc-500">{cost.categoria} | {cost.activo ? "Activo" : "Inactivo"}</p>
                                </div>
                                <p className="text-sm font-semibold text-white">{formatCurrency(cost.monto_mensual)}</p>
                              </div>
                              <div className="mt-3 flex gap-2">
                                <button type="button" onClick={() => setCostDraft(costToDraft(cost))} className="rounded-xl border border-white/10 px-3 py-2 text-xs text-zinc-200 transition hover:border-zinc-600">
                                  Editar
                                </button>
                                {cost.activo ? (
                                  <button type="button" onClick={() => void handleDeactivateCost(cost.id)} className="rounded-xl border border-rose-500/20 px-3 py-2 text-xs text-rose-200 transition hover:border-rose-400/40">
                                    Desactivar
                                  </button>
                                ) : null}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                {filteredSalesClients.length === 0 ? (
                  <div className="rounded-3xl border border-dashed border-white/10 bg-white/[0.03] px-4 py-8 text-center">
                    <p className="text-sm font-semibold text-white">Sin clientes en este filtro</p>
                    <p className="mt-2 text-sm leading-6 text-zinc-500">
                      Cambia la solucion o el plan para revisar otro segmento comercial.
                    </p>
                  </div>
                ) : null}
              </div>
            </article>
          </section>

          {(data.historical_clients ?? []).length ? (
            <details className={shellCardClass("p-5")}>
              <summary className="cursor-pointer list-none">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">
                      Historial comercial
                    </p>
                    <h2 className="mt-2 text-lg font-semibold text-white">
                      Vende Facil conservado sin acciones operativas
                    </h2>
                    <p className="mt-1 text-sm leading-6 text-zinc-500">
                      Suscripciones, atribucion y costos anteriores permanecen disponibles solo
                      para consulta y auditoria.
                    </p>
                  </div>
                  <span className="w-fit rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-zinc-300">
                    {(data.historical_clients ?? []).length} registro(s)
                  </span>
                </div>
              </summary>
              <div className="mt-5 grid gap-3 lg:grid-cols-2">
                {(data.historical_clients ?? []).map((client) => (
                  <article
                    key={`historical-sales-${client.id}`}
                    className="rounded-3xl border border-white/8 bg-black/20 p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-white">
                          {client.capa_negocio.nombre}
                        </p>
                        <p className="mt-1 text-sm text-zinc-500">
                          {client.plan.solution?.nombre || "Vende Facil (legacy)"} | {client.plan.nombre}
                        </p>
                      </div>
                      <span className="rounded-full border border-zinc-500/20 bg-zinc-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-300">
                        Solo lectura
                      </span>
                    </div>
                    <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-600">Estado</p>
                        <p className="mt-1 text-zinc-300">{client.estatus}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-600">MRR final</p>
                        <p className="mt-1 text-zinc-300">
                          {formatCurrency(client.metricas_ventas.ingreso_mensual_estimado)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-600">Costos</p>
                        <p className="mt-1 text-zinc-300">
                          {formatCurrency(client.metricas_ventas.costos_operativos)}
                        </p>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </details>
          ) : null}
        </>
      )}

      {costDraft && data ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-8 backdrop-blur-sm">
          <form onSubmit={handleSaveCost} className="w-full max-w-2xl rounded-[28px] border border-white/10 bg-zinc-950 p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Costo operativo</p>
                <h2 className="mt-2 text-xl font-semibold text-white">{costDraft.id ? "Editar costo" : "Nuevo costo"}</h2>
              </div>
              <button type="button" onClick={() => setCostDraft(null)} className="rounded-2xl border border-white/10 px-4 py-2 text-sm text-zinc-200 transition hover:border-zinc-600">
                Cerrar
              </button>
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <select className={inputClass()} value={costDraft.suscripcion_id} onChange={(event) => setCostDraft({ ...costDraft, suscripcion_id: event.target.value })}>
                {data.clientes.map((client) => <option key={client.id} value={client.id}>{client.capa_negocio.nombre}</option>)}
              </select>
              <select className={inputClass()} value={costDraft.categoria} onChange={(event) => setCostDraft({ ...costDraft, categoria: event.target.value })}>
                {data.categorias_costo.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <input className={inputClass()} placeholder="Concepto" value={costDraft.concepto} onChange={(event) => setCostDraft({ ...costDraft, concepto: event.target.value })} />
              <input className={inputClass()} type="number" min="0" step="0.01" placeholder="Monto mensual" value={costDraft.monto_mensual} onChange={(event) => setCostDraft({ ...costDraft, monto_mensual: event.target.value })} />
              <input className={inputClass()} type="date" value={costDraft.fecha_inicio} onChange={(event) => setCostDraft({ ...costDraft, fecha_inicio: event.target.value })} />
              <input className={inputClass()} type="date" value={costDraft.fecha_fin} onChange={(event) => setCostDraft({ ...costDraft, fecha_fin: event.target.value })} />
            </div>
            <textarea className={`${inputClass()} mt-4`} rows={3} placeholder="Notas internas" value={costDraft.notas_internas} onChange={(event) => setCostDraft({ ...costDraft, notas_internas: event.target.value })} />
            <label className="mt-4 flex items-center gap-3 rounded-2xl border border-white/8 bg-zinc-900/60 px-4 py-3 text-sm text-zinc-300">
              <input type="checkbox" checked={costDraft.activo} onChange={(event) => setCostDraft({ ...costDraft, activo: event.target.checked })} />
              Costo activo
            </label>
            <div className="mt-5 flex justify-end">
              <button type="submit" className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 px-5 py-3 text-sm font-medium text-cyan-100 transition hover:border-cyan-400/40">
                Guardar costo
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
