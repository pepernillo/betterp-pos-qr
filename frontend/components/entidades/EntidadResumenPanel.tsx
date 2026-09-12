"use client";

export interface ChartItem {
  label: string;
  value: number;
  color: string;
}

export interface SummaryDetail {
  espacio_id: number;
  espacio_codigo: string;
  espacio_estatus: string;
  tipo_espacio?: string | null;
  cliente_id: number;
  cliente_nombre: string;
  cliente_telefono?: string | null;
  cliente_correo?: string | null;
  fecha_inicio: string;
  renta_pactada: number;
  deposito_pactado: number;
  cuenta_por_cobrar_id?: number | null;
  concepto?: string | null;
  fecha_vencimiento?: string | null;
  monto_facturado: number;
  monto_pagado: number;
  saldo_pendiente: number;
  categoria_cobro: string;
  estatus_adeudo?: string | null;
}

export interface EntitySummary {
  entidad_id: number;
  nombre_comercial: string;
  ciudad?: string | null;
  total_espacios: number;
  ocupados: number;
  disponibles: number;
  reservados: number;
  mantenimiento: number;
  clientes_activos: number;
  ocupacion_porcentaje: number;
  facturacion_activa: number;
  cargos_registrados: number;
  pagado: number;
  por_conciliar: number;
  pendiente: number;
  vencido: number;
  sin_cxc: number;
  cxp_total: number;
  cxp_pagado: number;
  cxp_pendiente: number;
  cxp_vencido: number;
  cxp_por_conciliar: number;
  cxp_abierta: number;
  cxp_registros_abiertos: number;
  chart_data: ChartItem[];
  detalle: SummaryDetail[];
}

interface EntidadResumenPanelProps {
  summary: EntitySummary;
  showDetailTable?: boolean;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function formatPercent(value: number) {
  return new Intl.NumberFormat("es-MX", {
    maximumFractionDigits: 1,
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

function buildChartBackground(data: ChartItem[]) {
  const items = data.filter((item) => item.value > 0);
  const total = items.reduce((sum, item) => sum + item.value, 0);

  if (!total) {
    return "conic-gradient(#27272a 0deg 360deg)";
  }

  let current = 0;
  const stops = items.map((item) => {
    const start = current;
    const sweep = (item.value / total) * 360;
    current += sweep;
    return `${item.color} ${start}deg ${current}deg`;
  });

  return `conic-gradient(${stops.join(", ")})`;
}

function categoryLabel(category: string) {
  switch (category) {
    case "PAGADO":
      return "Pagado";
    case "POR_CONCILIAR":
      return "Por conciliar";
    case "VENCIDO":
      return "Vencido";
    case "PENDIENTE":
      return "Pendiente";
    case "SIN_CXC":
      return "Sin CxC";
    default:
      return category;
  }
}

export default function EntidadResumenPanel({
  summary,
  showDetailTable = true,
}: EntidadResumenPanelProps) {
  const chartBackground = buildChartBackground(summary.chart_data || []);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.25fr_0.95fr]">
        <div className="page-section-soft">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <div className="metric-card-compact border-zinc-800 bg-zinc-950/80">
              <p className="metric-label-compact">
                Espacios
              </p>
              <p className="metric-value-compact">
                {summary.total_espacios}
              </p>
            </div>
            <div className="metric-card-compact border-emerald-500/20 bg-emerald-500/10">
              <p className="metric-label-compact text-emerald-200/80">
                Ocupados
              </p>
              <p className="metric-value-compact text-emerald-300">
                {summary.ocupados}
              </p>
            </div>
            <div className="metric-card-compact border-blue-500/20 bg-blue-500/10">
              <p className="metric-label-compact text-blue-200/80">
                Disponibles
              </p>
              <p className="metric-value-compact text-blue-300">
                {summary.disponibles}
              </p>
            </div>
            <div className="metric-card-compact border-amber-500/20 bg-amber-500/10">
              <p className="metric-label-compact text-amber-200/80">
                Reservados
              </p>
              <p className="metric-value-compact text-amber-300">
                {summary.reservados}
              </p>
            </div>
            <div className="metric-card-compact border-rose-500/20 bg-rose-500/10">
              <p className="metric-label-compact text-rose-200/80">
                Mantenimiento
              </p>
              <p className="metric-value-compact text-rose-300">
                {summary.mantenimiento}
              </p>
            </div>
            <div className="metric-card-compact border-zinc-800 bg-zinc-950/80">
              <p className="metric-label-compact">
                Ocupacion
              </p>
              <p className="metric-value-compact">
                {formatPercent(summary.ocupacion_porcentaje)}%
              </p>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            <div className="metric-card-compact border-zinc-800 bg-zinc-950/80">
              <p className="text-sm text-zinc-500">Facturacion activa</p>
              <p className="metric-value-compact">
                {formatCurrency(summary.facturacion_activa)}
              </p>
              <p className="metric-helper-compact">
                Suma de rentas de espacios ocupados.
              </p>
            </div>
            <div className="metric-card-compact border-zinc-800 bg-zinc-950/80">
              <p className="text-sm text-zinc-500">Cargos registrados</p>
              <p className="metric-value-compact">
                {formatCurrency(summary.cargos_registrados)}
              </p>
              <p className="metric-helper-compact">
                Ultimo cargo localizado por cliente activo.
              </p>
            </div>
            <div className="metric-card-compact border-zinc-800 bg-zinc-950/80">
              <p className="text-sm text-zinc-500">Clientes activos</p>
              <p className="metric-value-compact">
                {summary.clientes_activos}
              </p>
              <p className="metric-helper-compact">
                Clientes con ocupacion vigente en la entidad.
              </p>
            </div>
            <div className="metric-card-compact border-violet-500/20 bg-violet-500/10">
              <p className="text-sm text-violet-200/80">CxP abierta</p>
              <p className="metric-value-compact text-violet-200">
                {formatCurrency(summary.cxp_abierta)}
              </p>
              <p className="metric-helper-compact">
                {summary.cxp_registros_abiertos} compromisos pendientes o vencidos.
              </p>
            </div>
            <div className="metric-card-compact border-red-500/20 bg-red-500/10">
              <p className="text-sm text-red-200/80">CxP vencida</p>
              <p className="metric-value-compact text-red-200">
                {formatCurrency(summary.cxp_vencido)}
              </p>
              <p className="metric-helper-compact">
                Pagos que ya requieren atencion de caja.
              </p>
            </div>
            <div className="metric-card-compact border-emerald-500/20 bg-emerald-500/10">
              <p className="text-sm text-emerald-200/80">CxP pagada</p>
              <p className="metric-value-compact text-emerald-200">
                {formatCurrency(summary.cxp_pagado)}
              </p>
              <p className="metric-helper-compact">
                Salidas ya cubiertas para la entidad.
              </p>
            </div>
          </div>
        </div>

        <div className="page-section-soft">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[220px_1fr] xl:grid-cols-1">
            <div className="mx-auto flex w-full max-w-[220px] flex-col items-center justify-center">
              <div
                className="relative h-48 w-48 rounded-full"
                style={{ background: chartBackground }}
              >
                <div className="absolute inset-[22%] flex items-center justify-center rounded-full border border-zinc-800 bg-zinc-950 text-center">
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                      Cobranza
                    </p>
                    <p className="mt-1.5 text-lg font-bold text-white">
                      {formatCurrency(
                        summary.pagado +
                          summary.por_conciliar +
                          summary.pendiente +
                          summary.vencido +
                          summary.sin_cxc
                      )}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {summary.chart_data.map((item) => (
                <div
                  key={item.label}
                  className="metric-card-compact border-zinc-800 bg-zinc-950/80"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: item.color }}
                    />
                    <p className="text-sm text-zinc-400">{item.label}</p>
                  </div>
                    <p className="metric-value-compact">
                      {formatCurrency(item.value)}
                    </p>
                  </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {showDetailTable && (
        <div className="page-section-soft">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="section-title-compact">
                Detalle por espacio ocupado
              </h3>
              <p className="section-copy-compact">
                Estado operativo, cliente asignado y situacion de cobro mas reciente.
              </p>
            </div>
          </div>

          {summary.detalle.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-950/60 py-12 text-center text-zinc-500">
              Esta entidad aun no tiene espacios ocupados con detalle para mostrar.
            </div>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full border-separate border-spacing-y-2 text-left text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-zinc-500">
                    <th className="px-3 py-2">Espacio</th>
                    <th className="px-3 py-2">Cliente</th>
                    <th className="px-3 py-2">Inicio</th>
                    <th className="px-3 py-2">Renta</th>
                    <th className="px-3 py-2">Facturado</th>
                    <th className="px-3 py-2">Pagado</th>
                    <th className="px-3 py-2">Saldo</th>
                    <th className="px-3 py-2">Cobro</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.detalle.map((item) => (
                    <tr
                      key={item.espacio_id}
                      className="rounded-2xl bg-zinc-950/80"
                    >
                      <td className="rounded-l-2xl px-3 py-3 align-top">
                        <p className="font-semibold text-white">
                          {item.espacio_codigo}
                        </p>
                        <p className="mt-1 text-xs text-zinc-500">
                          {item.tipo_espacio || "Sin tipo"} - {item.espacio_estatus}
                        </p>
                      </td>
                      <td className="px-3 py-3 align-top">
                        <p className="font-medium text-zinc-100">
                          {item.cliente_nombre}
                        </p>
                        <p className="mt-1 text-xs text-zinc-500">
                          {item.cliente_telefono || "Sin telefono"}
                        </p>
                        <p className="text-xs text-zinc-500">
                          {item.cliente_correo || "Sin correo"}
                        </p>
                      </td>
                      <td className="px-3 py-3 align-top text-zinc-300">
                        {formatDate(item.fecha_inicio)}
                      </td>
                      <td className="px-3 py-3 align-top text-zinc-100">
                        {formatCurrency(item.renta_pactada)}
                      </td>
                      <td className="px-3 py-3 align-top text-zinc-100">
                        {formatCurrency(item.monto_facturado)}
                      </td>
                      <td className="px-3 py-3 align-top text-emerald-300">
                        {formatCurrency(item.monto_pagado)}
                      </td>
                      <td className="px-3 py-3 align-top text-amber-300">
                        {formatCurrency(item.saldo_pendiente)}
                      </td>
                      <td className="rounded-r-2xl px-3 py-3 align-top">
                        <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-xs font-medium text-zinc-200">
                          {categoryLabel(item.categoria_cobro)}
                        </span>
                        <p className="mt-2 text-xs text-zinc-500">
                          {item.concepto || "Sin CxC"} -{" "}
                          {item.fecha_vencimiento
                            ? formatDate(item.fecha_vencimiento)
                            : "Sin vencimiento"}
                        </p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
