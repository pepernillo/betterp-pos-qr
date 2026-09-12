"use client";

import { buildApiUrl } from '@/lib/api';

import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";

const FINANZAS_API_BASE = buildApiUrl("/finanzas");
const ESPACIOS_API_BASE = buildApiUrl("/espacios");

type FinanceMode = "cobranza" | "gastos";

interface FinanceSummary {
  entidad_id: number;
  entidad_nombre: string;
  fecha_corte_resumen: string;
  cobranza: {
    acumulado: {
      facturado: number;
      cobrado: number;
      pendiente: number;
      vencido: number;
      por_conciliar: number;
      incobrable: number;
    };
    mes_actual: {
      facturado: number;
      cobrado: number;
      pendiente: number;
      vencido: number;
    };
    saldo_a_favor: number;
  };
  gastos: {
    acumulado: {
      proyectado: number;
      pagado: number;
      pendiente: number;
      vencido: number;
    };
    mes_actual: {
      proyectado: number;
      pagado: number;
      pendiente: number;
      vencido: number;
    };
  };
  balance: {
    neto_proyectado_mes: number;
    neto_real_mes: number;
    neto_proyectado_acumulado: number;
    neto_real_acumulado: number;
  };
  cuentas_por_cobrar: CuentaPorCobrarRecord[];
  cuentas_por_pagar: CuentaPorPagarRecord[];
  programaciones_cxp: ProgramacionCxpRecord[];
  saldos_clientes: SaldoClienteRecord[];
}

interface CuentaPorCobrarRecord {
  id: number;
  cliente_id: number;
  cliente_nombre: string;
  espacio_codigo?: string | null;
  concepto: string;
  origen: string;
  periodicidad: string;
  fecha_periodo_inicio?: string | null;
  fecha_periodo_fin?: string | null;
  fecha_vencimiento: string;
  monto_total: number;
  monto_pagado: number;
  saldo_pendiente: number;
  estatus: string;
  referencia_unica?: string | null;
}

interface CuentaPorPagarRecord {
  id: number;
  programacion_id?: number | null;
  proveedor_nombre: string;
  categoria: string;
  naturaleza: string;
  concepto: string;
  periodicidad: string;
  fecha_periodo_inicio?: string | null;
  fecha_periodo_fin?: string | null;
  fecha_vencimiento: string;
  monto_proyectado: number;
  monto_real: number;
  monto_total: number;
  monto_pagado: number;
  saldo_pendiente: number;
  estatus: string;
  tipo_registro: string;
  referencia_unica?: string | null;
}

interface ProgramacionCxpRecord {
  id: number;
  nombre: string;
  categoria: string;
  naturaleza: string;
  proveedor_nombre: string;
  periodicidad: string;
  fecha_inicio: string;
  fecha_fin?: string | null;
  dia_vencimiento?: number | null;
  monto_base: number;
  prorrateable: boolean;
  activo: boolean;
  observaciones?: string | null;
}

interface SaldoClienteRecord {
  cliente_id: number;
  cliente_nombre: string;
  saldo_a_favor: number;
}

interface ClienteAsignable {
  id: number;
  nombre: string;
  rfc: string;
}

interface CobranzaPaymentFormState {
  clienteId: string;
  cuentaId: string;
  monto: string;
  fechaPago: string;
  metodo: string;
  referencia: string;
  notas: string;
}

interface ProgramacionFormState {
  nombre: string;
  categoria: string;
  naturaleza: string;
  proveedorNombre: string;
  periodicidad: string;
  fechaInicio: string;
  fechaFin: string;
  diaVencimiento: string;
  montoBase: string;
  prorrateable: boolean;
  activo: boolean;
  observaciones: string;
}

interface GastoManualFormState {
  proveedorNombre: string;
  categoria: string;
  naturaleza: string;
  concepto: string;
  periodicidad: string;
  fechaEmision: string;
  fechaVencimiento: string;
  fechaPeriodoInicio: string;
  fechaPeriodoFin: string;
  montoProyectado: string;
  montoReal: string;
  observaciones: string;
}

interface PagoGastoFormState {
  cuentaId: string;
  monto: string;
  fechaPago: string;
  metodo: string;
  referencia: string;
  notas: string;
}

interface FinanzasManagerProps {
  entidadId: string;
  mode: FinanceMode;
}

const CATEGORY_OPTIONS = [
  { value: "AGUA", label: "Agua" },
  { value: "LUZ", label: "Luz" },
  { value: "INTERNET", label: "Internet" },
  { value: "BASURA", label: "Basura" },
  { value: "LIMPIEZA", label: "Limpieza" },
  { value: "MANTENIMIENTO", label: "Mantenimiento" },
  { value: "SEGURIDAD", label: "Seguridad" },
  { value: "NOMINA", label: "Nomina" },
  { value: "IMPUESTOS", label: "Impuestos" },
  { value: "OTROS", label: "Otros" },
];

const NATURE_OPTIONS = [
  { value: "OPERATIVO", label: "Operativo" },
  { value: "ADMINISTRATIVO", label: "Administrativo" },
];

const PERIODICIDAD_OPTIONS = [
  { value: "UNICO", label: "Unico" },
  { value: "SEMANAL", label: "Semanal" },
  { value: "QUINCENAL", label: "Quincenal" },
  { value: "MENSUAL", label: "Mensual" },
  { value: "BIMESTRAL", label: "Bimestral" },
  { value: "ANUAL", label: "Anual" },
];

const PAYMENT_METHODS = [
  { value: "TRANSFERENCIA", label: "Transferencia" },
  { value: "EFECTIVO", label: "Efectivo" },
  { value: "TARJETA", label: "Tarjeta" },
  { value: "DEPOSITO", label: "Deposito" },
  { value: "AJUSTE", label: "Ajuste" },
];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function formatDate(value?: string | null) {
  if (!value) {
    return "Sin fecha";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(parsed);
}

function getErrorMessage(body: unknown, fallback: string) {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail?: unknown }).detail;
    if (typeof detail === "string" && detail.trim()) {
      return detail;
    }
  }

  return fallback;
}

function statusBadgeClass(status: string) {
  switch (status) {
    case "CONCILIADO":
    case "PAGADO":
      return "border-emerald-500/20 bg-emerald-500/10 text-emerald-300";
    case "VENCIDO":
    case "INCOBRABLE":
      return "border-red-500/20 bg-red-500/10 text-red-300";
    case "PARCIAL":
    case "POR_CONCILIAR":
      return "border-amber-500/20 bg-amber-500/10 text-amber-200";
    default:
      return "border-zinc-700 bg-zinc-900 text-zinc-200";
  }
}

function statusLabel(status: string) {
  switch (status) {
    case "CONCILIADO":
      return "Conciliado";
    case "PAGADO":
      return "Pagado";
    case "POR_CONCILIAR":
      return "Por conciliar";
    case "VENCIDO":
      return "Vencido";
    case "PARCIAL":
      return "Parcial";
    case "INCOBRABLE":
      return "Incobrable";
    case "PENDIENTE":
      return "Pendiente";
    default:
      return status;
  }
}

const EMPTY_COBRANZA_PAYMENT: CobranzaPaymentFormState = {
  clienteId: "",
  cuentaId: "",
  monto: "",
  fechaPago: todayIso(),
  metodo: "TRANSFERENCIA",
  referencia: "",
  notas: "",
};

const EMPTY_PROGRAMACION_FORM: ProgramacionFormState = {
  nombre: "",
  categoria: "INTERNET",
  naturaleza: "OPERATIVO",
  proveedorNombre: "",
  periodicidad: "MENSUAL",
  fechaInicio: todayIso(),
  fechaFin: "",
  diaVencimiento: "",
  montoBase: "",
  prorrateable: false,
  activo: true,
  observaciones: "",
};

const EMPTY_GASTO_MANUAL_FORM: GastoManualFormState = {
  proveedorNombre: "",
  categoria: "OTROS",
  naturaleza: "OPERATIVO",
  concepto: "",
  periodicidad: "UNICO",
  fechaEmision: todayIso(),
  fechaVencimiento: todayIso(),
  fechaPeriodoInicio: "",
  fechaPeriodoFin: "",
  montoProyectado: "",
  montoReal: "",
  observaciones: "",
};

const EMPTY_PAGO_GASTO_FORM: PagoGastoFormState = {
  cuentaId: "",
  monto: "",
  fechaPago: todayIso(),
  metodo: "TRANSFERENCIA",
  referencia: "",
  notas: "",
};

function MetricCard({
  title,
  value,
  tone = "default",
  helper,
}: {
  title: string;
  value: string;
  tone?: "default" | "emerald" | "amber" | "red" | "blue";
  helper?: string;
}) {
  const toneClass =
    tone === "emerald"
      ? "border-emerald-500/20 bg-emerald-500/10"
      : tone === "amber"
        ? "border-amber-500/20 bg-amber-500/10"
        : tone === "red"
          ? "border-red-500/20 bg-red-500/10"
          : tone === "blue"
            ? "border-blue-500/20 bg-blue-500/10"
            : "border-zinc-800 bg-zinc-950/80";

  return (
    <div className={`metric-card-compact ${toneClass}`}>
      <p className="metric-label-compact">{title}</p>
      <p className="metric-value-compact">{value}</p>
      {helper ? <p className="metric-helper-compact">{helper}</p> : null}
    </div>
  );
}

export default function FinanzasManager({
  entidadId,
  mode,
}: FinanzasManagerProps) {
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [clientes, setClientes] = useState<ClienteAsignable[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [cobranzaPayment, setCobranzaPayment] = useState<CobranzaPaymentFormState>(
    EMPTY_COBRANZA_PAYMENT
  );
  const [programForm, setProgramForm] =
    useState<ProgramacionFormState>(EMPTY_PROGRAMACION_FORM);
  const [manualExpenseForm, setManualExpenseForm] = useState<GastoManualFormState>(
    EMPTY_GASTO_MANUAL_FORM
  );
  const [payablePaymentForm, setPayablePaymentForm] =
    useState<PagoGastoFormState>(EMPTY_PAGO_GASTO_FORM);
  const [editingProgramId, setEditingProgramId] = useState<number | null>(null);

  const [isSubmittingCobranzaPayment, setIsSubmittingCobranzaPayment] =
    useState(false);
  const [isGeneratingCxc, setIsGeneratingCxc] = useState(false);
  const [isGeneratingCxp, setIsGeneratingCxp] = useState(false);
  const [isSubmittingProgram, setIsSubmittingProgram] = useState(false);
  const [isSubmittingManualExpense, setIsSubmittingManualExpense] =
    useState(false);
  const [isSubmittingPayablePayment, setIsSubmittingPayablePayment] =
    useState(false);

  const flashMessage = (value: string) => {
    setMessage(value);
    window.setTimeout(() => setMessage(""), 3500);
  };

  const loadFinance = useCallback(async () => {
    setIsLoading(true);
    setError("");

    try {
      const [summaryResponse, clientsResponse] = await Promise.all([
        fetch(`${FINANZAS_API_BASE}/entidades/${entidadId}/resumen/`, {
          cache: "no-store",
        }),
        fetch(`${ESPACIOS_API_BASE}/entidades/${entidadId}/clientes/`, {
          cache: "no-store",
        }),
      ]);

      if (!summaryResponse.ok) {
        const body = (await summaryResponse.json()) as unknown;
        throw new Error(
          getErrorMessage(body, "No se pudo cargar el resumen financiero.")
        );
      }
      if (!clientsResponse.ok) {
        const body = (await clientsResponse.json()) as unknown;
        throw new Error(
          getErrorMessage(body, "No se pudieron cargar los clientes de la entidad.")
        );
      }

      const summaryBody = (await summaryResponse.json()) as FinanceSummary;
      const clientsBody = (await clientsResponse.json()) as ClienteAsignable[];
      setSummary(summaryBody);
      setClientes(clientsBody);
    } catch (loadError) {
      console.error("Error cargando finanzas:", loadError);
      setSummary(null);
      setClientes([]);
      setError(
        loadError instanceof Error
          ? loadError.message
          : "No se pudo cargar la informacion financiera."
      );
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [entidadId]);

  useEffect(() => {
    void loadFinance();
  }, [loadFinance]);

  const refreshFinance = async () => {
    setIsRefreshing(true);
    await loadFinance();
  };

  const cuentasCliente = useMemo(() => {
    if (!summary || !cobranzaPayment.clienteId) {
      return [] as CuentaPorCobrarRecord[];
    }
    return summary.cuentas_por_cobrar.filter(
      (item) =>
        String(item.cliente_id) === cobranzaPayment.clienteId &&
        !["CONCILIADO", "CANCELADO", "INCOBRABLE"].includes(item.estatus)
    );
  }, [cobranzaPayment.clienteId, summary]);

  const cuentasPagablesAbiertas = useMemo(() => {
    if (!summary) {
      return [] as CuentaPorPagarRecord[];
    }
    return summary.cuentas_por_pagar.filter(
      (item) => !["PAGADO", "CANCELADO"].includes(item.estatus)
    );
  }, [summary]);

  const handleGenerateCxc = async () => {
    setIsGeneratingCxc(true);
    try {
      const response = await fetch(
        `${FINANZAS_API_BASE}/entidades/${entidadId}/cxc/generar/`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      );
      const body = (await response.json()) as unknown;
      if (!response.ok) {
        throw new Error(
          getErrorMessage(body, "No se pudieron generar las cuentas por cobrar.")
        );
      }
      await refreshFinance();
      flashMessage("Cuentas por cobrar generadas correctamente.");
    } catch (generateError) {
      console.error("Error generando CxC:", generateError);
      alert(
        generateError instanceof Error
          ? generateError.message
          : "No se pudieron generar las cuentas por cobrar."
      );
    } finally {
      setIsGeneratingCxc(false);
    }
  };

  const handleRegisterCobranzaPayment = async (event: FormEvent) => {
    event.preventDefault();
    if (!cobranzaPayment.clienteId) {
      alert("Selecciona el cliente al que corresponde el pago.");
      return;
    }

    setIsSubmittingCobranzaPayment(true);
    try {
      const response = await fetch(
        `${FINANZAS_API_BASE}/entidades/${entidadId}/cxc/pagos/`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cliente_id: Number(cobranzaPayment.clienteId),
            cuenta_id: cobranzaPayment.cuentaId
              ? Number(cobranzaPayment.cuentaId)
              : null,
            monto: cobranzaPayment.monto,
            fecha_pago: cobranzaPayment.fechaPago,
            metodo: cobranzaPayment.metodo,
            referencia: cobranzaPayment.referencia,
            notas: cobranzaPayment.notas,
          }),
        }
      );
      const body = (await response.json()) as unknown;
      if (!response.ok) {
        throw new Error(getErrorMessage(body, "No se pudo registrar el pago."));
      }

      await refreshFinance();
      setCobranzaPayment({
        ...EMPTY_COBRANZA_PAYMENT,
        fechaPago: todayIso(),
      });
      flashMessage("Pago registrado y aplicado correctamente.");
    } catch (paymentError) {
      console.error("Error registrando pago CxC:", paymentError);
      alert(
        paymentError instanceof Error
          ? paymentError.message
          : "No se pudo registrar el pago."
      );
    } finally {
      setIsSubmittingCobranzaPayment(false);
    }
  };

  const handleMarkIncobrable = async (cuentaId: number) => {
    try {
      const response = await fetch(
        `${FINANZAS_API_BASE}/cxc/${cuentaId}/estatus/`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ estatus: "INCOBRABLE" }),
        }
      );
      const body = (await response.json()) as unknown;
      if (!response.ok) {
        throw new Error(
          getErrorMessage(body, "No se pudo marcar la cuenta como incobrable.")
        );
      }
      await refreshFinance();
      flashMessage("Cuenta marcada como incobrable.");
    } catch (statusError) {
      console.error("Error actualizando estatus CxC:", statusError);
      alert(
        statusError instanceof Error
          ? statusError.message
          : "No se pudo actualizar el estatus."
      );
    }
  };

  const handleProgramSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setIsSubmittingProgram(true);

    try {
      const payload = {
        nombre: programForm.nombre,
        categoria: programForm.categoria,
        naturaleza: programForm.naturaleza,
        proveedor_nombre: programForm.proveedorNombre,
        periodicidad: programForm.periodicidad,
        fecha_inicio: programForm.fechaInicio,
        fecha_fin: programForm.fechaFin || null,
        dia_vencimiento: programForm.diaVencimiento
          ? Number(programForm.diaVencimiento)
          : null,
        monto_base: programForm.montoBase,
        prorrateable: programForm.prorrateable,
        activo: programForm.activo,
        observaciones: programForm.observaciones,
      };

      const endpoint = editingProgramId
        ? `${FINANZAS_API_BASE}/cxp/programaciones/${editingProgramId}/`
        : `${FINANZAS_API_BASE}/entidades/${entidadId}/cxp/programaciones/`;
      const method = editingProgramId ? "PUT" : "POST";

      const response = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json()) as unknown;
      if (!response.ok) {
        throw new Error(
          getErrorMessage(body, "No se pudo guardar la programacion.")
        );
      }

      await refreshFinance();
      setProgramForm({ ...EMPTY_PROGRAMACION_FORM, fechaInicio: todayIso() });
      setEditingProgramId(null);
      flashMessage(
        editingProgramId
          ? "Programacion actualizada correctamente."
          : "Programacion creada correctamente."
      );
    } catch (programError) {
      console.error("Error guardando programacion:", programError);
      alert(
        programError instanceof Error
          ? programError.message
          : "No se pudo guardar la programacion."
      );
    } finally {
      setIsSubmittingProgram(false);
    }
  };

  const handleEditProgram = (program: ProgramacionCxpRecord) => {
    setEditingProgramId(program.id);
    setProgramForm({
      nombre: program.nombre,
      categoria: program.categoria,
      naturaleza: program.naturaleza,
      proveedorNombre: program.proveedor_nombre,
      periodicidad: program.periodicidad,
      fechaInicio: program.fecha_inicio,
      fechaFin: program.fecha_fin || "",
      diaVencimiento: program.dia_vencimiento
        ? String(program.dia_vencimiento)
        : "",
      montoBase: String(program.monto_base || ""),
      prorrateable: program.prorrateable,
      activo: program.activo,
      observaciones: program.observaciones || "",
    });
  };

  const handleDeleteProgram = async (programId: number) => {
    try {
      const response = await fetch(
        `${FINANZAS_API_BASE}/cxp/programaciones/${programId}/`,
        {
          method: "DELETE",
        }
      );
      const body = (await response.json()) as unknown;
      if (!response.ok) {
        throw new Error(
          getErrorMessage(body, "No se pudo borrar la programacion.")
        );
      }
      await refreshFinance();
      if (editingProgramId === programId) {
        setEditingProgramId(null);
        setProgramForm({ ...EMPTY_PROGRAMACION_FORM, fechaInicio: todayIso() });
      }
      flashMessage("Programacion eliminada correctamente.");
    } catch (deleteError) {
      console.error("Error borrando programacion:", deleteError);
      alert(
        deleteError instanceof Error
          ? deleteError.message
          : "No se pudo borrar la programacion."
      );
    }
  };

  const handleGenerateCxp = async () => {
    setIsGeneratingCxp(true);
    try {
      const response = await fetch(
        `${FINANZAS_API_BASE}/entidades/${entidadId}/cxp/generar/`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      );
      const body = (await response.json()) as unknown;
      if (!response.ok) {
        throw new Error(
          getErrorMessage(body, "No se pudieron generar los gastos.")
        );
      }
      await refreshFinance();
      flashMessage("Cuentas por pagar generadas correctamente.");
    } catch (generateError) {
      console.error("Error generando CxP:", generateError);
      alert(
        generateError instanceof Error
          ? generateError.message
          : "No se pudieron generar los gastos."
      );
    } finally {
      setIsGeneratingCxp(false);
    }
  };

  const handleManualExpenseSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setIsSubmittingManualExpense(true);
    try {
      const response = await fetch(
        `${FINANZAS_API_BASE}/entidades/${entidadId}/cxp/manual/`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            proveedor_nombre: manualExpenseForm.proveedorNombre,
            categoria: manualExpenseForm.categoria,
            naturaleza: manualExpenseForm.naturaleza,
            concepto: manualExpenseForm.concepto,
            periodicidad: manualExpenseForm.periodicidad,
            fecha_emision: manualExpenseForm.fechaEmision,
            fecha_vencimiento: manualExpenseForm.fechaVencimiento,
            fecha_periodo_inicio: manualExpenseForm.fechaPeriodoInicio || null,
            fecha_periodo_fin: manualExpenseForm.fechaPeriodoFin || null,
            monto_proyectado: manualExpenseForm.montoProyectado,
            monto_real: manualExpenseForm.montoReal || null,
            observaciones: manualExpenseForm.observaciones,
          }),
        }
      );
      const body = (await response.json()) as unknown;
      if (!response.ok) {
        throw new Error(
          getErrorMessage(body, "No se pudo crear el gasto manual.")
        );
      }

      await refreshFinance();
      setManualExpenseForm({
        ...EMPTY_GASTO_MANUAL_FORM,
        fechaEmision: todayIso(),
        fechaVencimiento: todayIso(),
      });
      flashMessage("Gasto manual registrado correctamente.");
    } catch (manualError) {
      console.error("Error creando gasto manual:", manualError);
      alert(
        manualError instanceof Error
          ? manualError.message
          : "No se pudo crear el gasto manual."
      );
    } finally {
      setIsSubmittingManualExpense(false);
    }
  };

  const handlePayablePaymentSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!payablePaymentForm.cuentaId) {
      alert("Selecciona el gasto que vas a pagar.");
      return;
    }

    setIsSubmittingPayablePayment(true);
    try {
      const response = await fetch(
        `${FINANZAS_API_BASE}/cxp/${payablePaymentForm.cuentaId}/pagos/`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            monto: payablePaymentForm.monto,
            fecha_pago: payablePaymentForm.fechaPago,
            metodo: payablePaymentForm.metodo,
            referencia: payablePaymentForm.referencia,
            notas: payablePaymentForm.notas,
          }),
        }
      );
      const body = (await response.json()) as unknown;
      if (!response.ok) {
        throw new Error(
          getErrorMessage(body, "No se pudo registrar el pago del gasto.")
        );
      }
      await refreshFinance();
      setPayablePaymentForm({
        ...EMPTY_PAGO_GASTO_FORM,
        fechaPago: todayIso(),
      });
      flashMessage("Pago de gasto registrado correctamente.");
    } catch (paymentError) {
      console.error("Error registrando pago gasto:", paymentError);
      alert(
        paymentError instanceof Error
          ? paymentError.message
          : "No se pudo registrar el pago del gasto."
      );
    } finally {
      setIsSubmittingPayablePayment(false);
    }
  };

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950 py-14 text-center text-zinc-500">
        Cargando modulo financiero...
      </div>
    );
  }

  if (error || !summary) {
    return (
      <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300">
        {error || "No se pudo cargar la informacion financiera."}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {message ? (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          {message}
        </div>
      ) : null}

      {mode === "cobranza" ? (
        <>
          <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
            <MetricCard
              title="Facturado mes"
              value={formatCurrency(summary.cobranza.mes_actual.facturado)}
              tone="blue"
            />
            <MetricCard
              title="Cobrado mes"
              value={formatCurrency(summary.cobranza.mes_actual.cobrado)}
              tone="emerald"
            />
            <MetricCard
              title="Pendiente"
              value={formatCurrency(summary.cobranza.acumulado.pendiente)}
              tone="amber"
              helper="Pendiente acumulado"
            />
            <MetricCard
              title="Vencido"
              value={formatCurrency(summary.cobranza.acumulado.vencido)}
              tone="red"
              helper="Saldo vencido acumulado"
            />
            <MetricCard
              title="Saldo a favor"
              value={formatCurrency(summary.cobranza.saldo_a_favor)}
              helper="Disponible para aplicar"
            />
          </section>

          <section className="grid grid-cols-1 gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
            <form
              onSubmit={handleRegisterCobranzaPayment}
              className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-950/70 p-5"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-white">
                    Registrar pago
                  </h2>
                  <p className="mt-1 text-sm text-zinc-500">
                    Aplica primero al adeudo mas antiguo y deja excedentes como saldo
                    a favor.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleGenerateCxc()}
                  disabled={isGeneratingCxc}
                  className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20 disabled:opacity-50"
                >
                  {isGeneratingCxc ? "Generando..." : "Generar cargos"}
                </button>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-zinc-400">
                  Cliente
                </label>
                <select
                  value={cobranzaPayment.clienteId}
                  onChange={(event) =>
                    setCobranzaPayment({
                      ...cobranzaPayment,
                      clienteId: event.target.value,
                      cuentaId: "",
                    })
                  }
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-zinc-200 outline-none focus:ring-1 focus:ring-cyan-500"
                >
                  <option value="">Selecciona un cliente</option>
                  {clientes.map((cliente) => (
                    <option key={cliente.id} value={cliente.id}>
                      {cliente.nombre}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-zinc-400">
                  Cuenta especifica
                </label>
                <select
                  value={cobranzaPayment.cuentaId}
                  onChange={(event) =>
                    setCobranzaPayment({
                      ...cobranzaPayment,
                      cuentaId: event.target.value,
                    })
                  }
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-zinc-200 outline-none focus:ring-1 focus:ring-cyan-500"
                >
                  <option value="">Auto aplicar</option>
                  {cuentasCliente.map((cuenta) => (
                    <option key={cuenta.id} value={cuenta.id}>
                      {cuenta.concepto} - {formatCurrency(cuenta.saldo_pendiente)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-400">
                    Monto
                  </label>
                  <input
                    required
                    type="number"
                    min="0"
                    step="0.01"
                    value={cobranzaPayment.monto}
                    onChange={(event) =>
                      setCobranzaPayment({
                        ...cobranzaPayment,
                        monto: event.target.value,
                      })
                    }
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-400">
                    Fecha pago
                  </label>
                  <input
                    required
                    type="date"
                    value={cobranzaPayment.fechaPago}
                    onChange={(event) =>
                      setCobranzaPayment({
                        ...cobranzaPayment,
                        fechaPago: event.target.value,
                      })
                    }
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-400">
                    Metodo
                  </label>
                  <select
                    value={cobranzaPayment.metodo}
                    onChange={(event) =>
                      setCobranzaPayment({
                        ...cobranzaPayment,
                        metodo: event.target.value,
                      })
                    }
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-zinc-200 outline-none focus:ring-1 focus:ring-cyan-500"
                  >
                    {PAYMENT_METHODS.map((method) => (
                      <option key={method.value} value={method.value}>
                        {method.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-400">
                    Referencia
                  </label>
                  <input
                    type="text"
                    value={cobranzaPayment.referencia}
                    onChange={(event) =>
                      setCobranzaPayment({
                        ...cobranzaPayment,
                        referencia: event.target.value,
                      })
                    }
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-zinc-400">
                  Notas
                </label>
                <textarea
                  rows={3}
                  value={cobranzaPayment.notas}
                  onChange={(event) =>
                    setCobranzaPayment({
                      ...cobranzaPayment,
                      notas: event.target.value,
                    })
                  }
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                />
              </div>

              <button
                type="submit"
                disabled={isSubmittingCobranzaPayment}
                className="w-full rounded-lg bg-emerald-600 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
              >
                {isSubmittingCobranzaPayment ? "Guardando..." : "Registrar pago"}
              </button>
            </form>

            <section className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-950/70 p-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-white">
                    Cartera vigente
                  </h2>
                  <p className="mt-1 text-sm text-zinc-500">
                    Aqui ves rentas, depositos y saldos abiertos por cliente.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void refreshFinance()}
                  disabled={isRefreshing}
                  className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white disabled:opacity-50"
                >
                  {isRefreshing ? "Refrescando..." : "Refrescar"}
                </button>
              </div>

              {summary.saldos_clientes.length > 0 ? (
                <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4">
                  <p className="text-sm font-medium text-emerald-200">
                    Saldos a favor disponibles
                  </p>
                  <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                    {summary.saldos_clientes.map((item) => (
                      <div
                        key={item.cliente_id}
                        className="rounded-xl border border-emerald-500/20 bg-zinc-950/40 px-3 py-2"
                      >
                        <p className="text-sm font-medium text-white">
                          {item.cliente_nombre}
                        </p>
                        <p className="text-xs text-emerald-300">
                          {formatCurrency(item.saldo_a_favor)}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {summary.cuentas_por_cobrar.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/20 py-16 text-center text-zinc-500">
                  Aun no hay cargos generados para esta entidad.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full border-separate border-spacing-y-2 text-left text-sm">
                    <thead>
                      <tr className="text-xs uppercase tracking-wide text-zinc-500">
                        <th className="px-3 py-2">Cliente</th>
                        <th className="px-3 py-2">Concepto</th>
                        <th className="px-3 py-2">Vence</th>
                        <th className="px-3 py-2">Total</th>
                        <th className="px-3 py-2">Pagado</th>
                        <th className="px-3 py-2">Saldo</th>
                        <th className="px-3 py-2">Estatus</th>
                        <th className="px-3 py-2">Accion</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.cuentas_por_cobrar.map((cuenta) => (
                        <tr key={cuenta.id} className="rounded-2xl bg-zinc-950/80">
                          <td className="rounded-l-2xl px-3 py-3 align-top">
                            <p className="font-medium text-white">
                              {cuenta.cliente_nombre}
                            </p>
                            <p className="mt-1 text-xs text-zinc-500">
                              {cuenta.espacio_codigo || "Sin espacio"} -{" "}
                              {cuenta.origen}
                            </p>
                          </td>
                          <td className="px-3 py-3 align-top text-zinc-200">
                            {cuenta.concepto}
                          </td>
                          <td className="px-3 py-3 align-top text-zinc-300">
                            {formatDate(cuenta.fecha_vencimiento)}
                          </td>
                          <td className="px-3 py-3 align-top text-white">
                            {formatCurrency(cuenta.monto_total)}
                          </td>
                          <td className="px-3 py-3 align-top text-emerald-300">
                            {formatCurrency(cuenta.monto_pagado)}
                          </td>
                          <td className="px-3 py-3 align-top text-amber-200">
                            {formatCurrency(cuenta.saldo_pendiente)}
                          </td>
                          <td className="px-3 py-3 align-top">
                            <span
                              className={`rounded-full border px-2.5 py-1 text-xs font-medium ${statusBadgeClass(
                                cuenta.estatus
                              )}`}
                            >
                              {statusLabel(cuenta.estatus)}
                            </span>
                          </td>
                          <td className="rounded-r-2xl px-3 py-3 align-top">
                            {["PENDIENTE", "PARCIAL", "VENCIDO"].includes(
                              cuenta.estatus
                            ) ? (
                              <button
                                type="button"
                                onClick={() => void handleMarkIncobrable(cuenta.id)}
                                className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-200 transition-colors hover:bg-red-500/20"
                              >
                                Incobrable
                              </button>
                            ) : (
                              <span className="text-xs text-zinc-500">Sin accion</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </section>
        </>
      ) : (
        <>
          <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
            <MetricCard
              title="Gasto mes"
              value={formatCurrency(summary.gastos.mes_actual.proyectado)}
              tone="blue"
            />
            <MetricCard
              title="Pagado mes"
              value={formatCurrency(summary.gastos.mes_actual.pagado)}
              tone="emerald"
            />
            <MetricCard
              title="Pendiente"
              value={formatCurrency(summary.gastos.acumulado.pendiente)}
              tone="amber"
              helper="Saldo operativo por cubrir"
            />
            <MetricCard
              title="Vencido"
              value={formatCurrency(summary.gastos.acumulado.vencido)}
              tone="red"
            />
            <MetricCard
              title="Neto real mes"
              value={formatCurrency(summary.balance.neto_real_mes)}
              helper="Cobrado menos gasto pagado"
            />
          </section>

          <section className="grid grid-cols-1 gap-6 2xl:grid-cols-3">
            <form
              onSubmit={handleProgramSubmit}
              className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-950/70 p-5"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-white">
                    Programacion recurrente
                  </h2>
                  <p className="mt-1 text-sm text-zinc-500">
                    Define agua, luz, internet, limpieza y otros gastos repetitivos.
                  </p>
                </div>
                {editingProgramId ? (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingProgramId(null);
                      setProgramForm({
                        ...EMPTY_PROGRAMACION_FORM,
                        fechaInicio: todayIso(),
                      });
                    }}
                    className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
                  >
                    Cancelar edicion
                  </button>
                ) : null}
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-zinc-400">
                  Nombre interno
                </label>
                <input
                  required
                  type="text"
                  value={programForm.nombre}
                  onChange={(event) =>
                    setProgramForm({ ...programForm, nombre: event.target.value })
                  }
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-400">
                    Categoria
                  </label>
                  <select
                    value={programForm.categoria}
                    onChange={(event) =>
                      setProgramForm({
                        ...programForm,
                        categoria: event.target.value,
                      })
                    }
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-zinc-200 outline-none focus:ring-1 focus:ring-cyan-500"
                  >
                    {CATEGORY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-400">
                    Naturaleza
                  </label>
                  <select
                    value={programForm.naturaleza}
                    onChange={(event) =>
                      setProgramForm({
                        ...programForm,
                        naturaleza: event.target.value,
                      })
                    }
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-zinc-200 outline-none focus:ring-1 focus:ring-cyan-500"
                  >
                    {NATURE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-zinc-400">
                  Proveedor
                </label>
                <input
                  required
                  type="text"
                  value={programForm.proveedorNombre}
                  onChange={(event) =>
                    setProgramForm({
                      ...programForm,
                      proveedorNombre: event.target.value,
                    })
                  }
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-400">
                    Periodicidad
                  </label>
                  <select
                    value={programForm.periodicidad}
                    onChange={(event) =>
                      setProgramForm({
                        ...programForm,
                        periodicidad: event.target.value,
                      })
                    }
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-zinc-200 outline-none focus:ring-1 focus:ring-cyan-500"
                  >
                    {PERIODICIDAD_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-400">
                    Monto base
                  </label>
                  <input
                    required
                    type="number"
                    min="0"
                    step="0.01"
                    value={programForm.montoBase}
                    onChange={(event) =>
                      setProgramForm({
                        ...programForm,
                        montoBase: event.target.value,
                      })
                    }
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-400">
                    Inicio
                  </label>
                  <input
                    required
                    type="date"
                    value={programForm.fechaInicio}
                    onChange={(event) =>
                      setProgramForm({
                        ...programForm,
                        fechaInicio: event.target.value,
                      })
                    }
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-400">
                    Fin
                  </label>
                  <input
                    type="date"
                    value={programForm.fechaFin}
                    onChange={(event) =>
                      setProgramForm({
                        ...programForm,
                        fechaFin: event.target.value,
                      })
                    }
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-400">
                    Dia vence
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="31"
                    value={programForm.diaVencimiento}
                    onChange={(event) =>
                      setProgramForm({
                        ...programForm,
                        diaVencimiento: event.target.value,
                      })
                    }
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                  />
                </div>
              </div>

              <label className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  checked={programForm.prorrateable}
                  onChange={(event) =>
                    setProgramForm({
                      ...programForm,
                      prorrateable: event.target.checked,
                    })
                  }
                  className="h-4 w-4 rounded border-zinc-700 bg-zinc-900 text-cyan-500 focus:ring-cyan-500"
                />
                Marcar como prorrateable a futuro
              </label>

              <div>
                <label className="mb-1 block text-sm font-medium text-zinc-400">
                  Observaciones
                </label>
                <textarea
                  rows={3}
                  value={programForm.observaciones}
                  onChange={(event) =>
                    setProgramForm({
                      ...programForm,
                      observaciones: event.target.value,
                    })
                  }
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                />
              </div>

              <button
                type="submit"
                disabled={isSubmittingProgram}
                className="w-full rounded-lg bg-cyan-600 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:opacity-50"
              >
                {isSubmittingProgram
                  ? "Guardando..."
                  : editingProgramId
                    ? "Actualizar programacion"
                    : "Guardar programacion"}
              </button>
            </form>

            <form
              onSubmit={handleManualExpenseSubmit}
              className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-950/70 p-5"
            >
              <div>
                <h2 className="text-lg font-semibold text-white">
                  Gasto manual
                </h2>
                <p className="mt-1 text-sm text-zinc-500">
                  Para facturas unicas, compras o cargos fuera de plantilla.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-400">
                    Proveedor
                  </label>
                  <input
                    required
                    type="text"
                    value={manualExpenseForm.proveedorNombre}
                    onChange={(event) =>
                      setManualExpenseForm({
                        ...manualExpenseForm,
                        proveedorNombre: event.target.value,
                      })
                    }
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-400">
                    Categoria
                  </label>
                  <select
                    value={manualExpenseForm.categoria}
                    onChange={(event) =>
                      setManualExpenseForm({
                        ...manualExpenseForm,
                        categoria: event.target.value,
                      })
                    }
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-zinc-200 outline-none focus:ring-1 focus:ring-cyan-500"
                  >
                    {CATEGORY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-zinc-400">
                  Concepto
                </label>
                <input
                  required
                  type="text"
                  value={manualExpenseForm.concepto}
                  onChange={(event) =>
                    setManualExpenseForm({
                      ...manualExpenseForm,
                      concepto: event.target.value,
                    })
                  }
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-400">
                    Monto proyectado
                  </label>
                  <input
                    required
                    type="number"
                    min="0"
                    step="0.01"
                    value={manualExpenseForm.montoProyectado}
                    onChange={(event) =>
                      setManualExpenseForm({
                        ...manualExpenseForm,
                        montoProyectado: event.target.value,
                      })
                    }
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-400">
                    Monto real
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={manualExpenseForm.montoReal}
                    onChange={(event) =>
                      setManualExpenseForm({
                        ...manualExpenseForm,
                        montoReal: event.target.value,
                      })
                    }
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-400">
                    Emision
                  </label>
                  <input
                    required
                    type="date"
                    value={manualExpenseForm.fechaEmision}
                    onChange={(event) =>
                      setManualExpenseForm({
                        ...manualExpenseForm,
                        fechaEmision: event.target.value,
                      })
                    }
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-400">
                    Vencimiento
                  </label>
                  <input
                    required
                    type="date"
                    value={manualExpenseForm.fechaVencimiento}
                    onChange={(event) =>
                      setManualExpenseForm({
                        ...manualExpenseForm,
                        fechaVencimiento: event.target.value,
                      })
                    }
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmittingManualExpense}
                className="w-full rounded-lg bg-emerald-600 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
              >
                {isSubmittingManualExpense ? "Guardando..." : "Crear gasto manual"}
              </button>
            </form>

            <form
              onSubmit={handlePayablePaymentSubmit}
              className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-950/70 p-5"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-white">
                    Registrar pago de gasto
                  </h2>
                  <p className="mt-1 text-sm text-zinc-500">
                    Liquida parcial o totalmente una cuenta por pagar.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleGenerateCxp()}
                  disabled={isGeneratingCxp}
                  className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20 disabled:opacity-50"
                >
                  {isGeneratingCxp ? "Generando..." : "Generar gastos"}
                </button>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-zinc-400">
                  Gasto
                </label>
                <select
                  value={payablePaymentForm.cuentaId}
                  onChange={(event) =>
                    setPayablePaymentForm({
                      ...payablePaymentForm,
                      cuentaId: event.target.value,
                    })
                  }
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-zinc-200 outline-none focus:ring-1 focus:ring-cyan-500"
                >
                  <option value="">Selecciona un gasto abierto</option>
                  {cuentasPagablesAbiertas.map((cuenta) => (
                    <option key={cuenta.id} value={cuenta.id}>
                      {cuenta.concepto} - {formatCurrency(cuenta.saldo_pendiente)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-400">
                    Monto
                  </label>
                  <input
                    required
                    type="number"
                    min="0"
                    step="0.01"
                    value={payablePaymentForm.monto}
                    onChange={(event) =>
                      setPayablePaymentForm({
                        ...payablePaymentForm,
                        monto: event.target.value,
                      })
                    }
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-400">
                    Fecha pago
                  </label>
                  <input
                    required
                    type="date"
                    value={payablePaymentForm.fechaPago}
                    onChange={(event) =>
                      setPayablePaymentForm({
                        ...payablePaymentForm,
                        fechaPago: event.target.value,
                      })
                    }
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-400">
                    Metodo
                  </label>
                  <select
                    value={payablePaymentForm.metodo}
                    onChange={(event) =>
                      setPayablePaymentForm({
                        ...payablePaymentForm,
                        metodo: event.target.value,
                      })
                    }
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-zinc-200 outline-none focus:ring-1 focus:ring-cyan-500"
                  >
                    {PAYMENT_METHODS.map((method) => (
                      <option key={method.value} value={method.value}>
                        {method.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-400">
                    Referencia
                  </label>
                  <input
                    type="text"
                    value={payablePaymentForm.referencia}
                    onChange={(event) =>
                      setPayablePaymentForm({
                        ...payablePaymentForm,
                        referencia: event.target.value,
                      })
                    }
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmittingPayablePayment}
                className="w-full rounded-lg bg-amber-500 px-4 py-3 text-sm font-medium text-black transition-colors hover:bg-amber-400 disabled:opacity-50"
              >
                {isSubmittingPayablePayment ? "Guardando..." : "Registrar pago"}
              </button>
            </form>
          </section>

          <section className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-950/70 p-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-white">
                  Programaciones y gastos
                </h2>
                <p className="mt-1 text-sm text-zinc-500">
                  Control operativo por entidad para planeacion de pagos.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void refreshFinance()}
                disabled={isRefreshing}
                className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white disabled:opacity-50"
              >
                {isRefreshing ? "Refrescando..." : "Refrescar"}
              </button>
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[0.95fr_1.25fr]">
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
                  Plantillas activas
                </h3>
                {summary.programaciones_cxp.length === 0 ? (
                  <div className="mt-4 rounded-xl border border-dashed border-zinc-800 bg-zinc-950/40 py-8 text-center text-sm text-zinc-500">
                    Aun no hay programaciones definidas.
                  </div>
                ) : (
                  <div className="mt-4 space-y-3">
                    {summary.programaciones_cxp.map((program) => (
                      <div
                        key={program.id}
                        className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4"
                      >
                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                          <div>
                            <p className="font-semibold text-white">{program.nombre}</p>
                            <p className="mt-1 text-sm text-zinc-500">
                              {program.proveedor_nombre} - {program.categoria} -{" "}
                              {program.periodicidad}
                            </p>
                            <p className="mt-1 text-xs text-zinc-500">
                              Inicio {formatDate(program.fecha_inicio)} | Vence dia{" "}
                              {program.dia_vencimiento || "sin definir"}
                            </p>
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => handleEditProgram(program)}
                              className="rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20"
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDeleteProgram(program.id)}
                              className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-200 transition-colors hover:bg-red-500/20"
                            >
                              Borrar
                            </button>
                          </div>
                        </div>
                        <p className="mt-3 text-lg font-semibold text-white">
                          {formatCurrency(program.monto_base)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-4">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
                  Cuentas por pagar
                </h3>
                {summary.cuentas_por_pagar.length === 0 ? (
                  <div className="mt-4 rounded-xl border border-dashed border-zinc-800 bg-zinc-950/40 py-10 text-center text-sm text-zinc-500">
                    Aun no hay gastos generados o registrados.
                  </div>
                ) : (
                  <div className="mt-4 overflow-x-auto">
                    <table className="min-w-full border-separate border-spacing-y-2 text-left text-sm">
                      <thead>
                        <tr className="text-xs uppercase tracking-wide text-zinc-500">
                          <th className="px-3 py-2">Concepto</th>
                          <th className="px-3 py-2">Proveedor</th>
                          <th className="px-3 py-2">Vence</th>
                          <th className="px-3 py-2">Total</th>
                          <th className="px-3 py-2">Pagado</th>
                          <th className="px-3 py-2">Saldo</th>
                          <th className="px-3 py-2">Estatus</th>
                        </tr>
                      </thead>
                      <tbody>
                        {summary.cuentas_por_pagar.map((cuenta) => (
                          <tr key={cuenta.id} className="rounded-2xl bg-zinc-950/80">
                            <td className="rounded-l-2xl px-3 py-3 align-top">
                              <p className="font-medium text-white">
                                {cuenta.concepto}
                              </p>
                              <p className="mt-1 text-xs text-zinc-500">
                                {cuenta.categoria} - {cuenta.tipo_registro}
                              </p>
                            </td>
                            <td className="px-3 py-3 align-top text-zinc-200">
                              {cuenta.proveedor_nombre}
                            </td>
                            <td className="px-3 py-3 align-top text-zinc-300">
                              {formatDate(cuenta.fecha_vencimiento)}
                            </td>
                            <td className="px-3 py-3 align-top text-white">
                              {formatCurrency(cuenta.monto_total)}
                            </td>
                            <td className="px-3 py-3 align-top text-emerald-300">
                              {formatCurrency(cuenta.monto_pagado)}
                            </td>
                            <td className="px-3 py-3 align-top text-amber-200">
                              {formatCurrency(cuenta.saldo_pendiente)}
                            </td>
                            <td className="rounded-r-2xl px-3 py-3 align-top">
                              <span
                                className={`rounded-full border px-2.5 py-1 text-xs font-medium ${statusBadgeClass(
                                  cuenta.estatus
                                )}`}
                              >
                                {statusLabel(cuenta.estatus)}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
