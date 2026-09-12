"use client";

import { buildApiUrl } from "@/lib/api";

import { useCallback, useEffect, useMemo, useState } from "react";

const RENTA_API_BASE = buildApiUrl("/renta-espacios");

interface ChannelConfig {
  id: number | null;
  canal: string;
  label: string;
  summary: string;
  mode_default: string;
  modo_integracion: string;
  activo: boolean;
  estatus: "BORRADOR" | "PENDIENTE" | "CONECTADO" | "ERROR" | "PAUSADO";
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
  credenciales?: {
    ml_can_publish_real_estate?: boolean | null;
    ml_listing_blocked_code?: string;
    ml_listing_blocked_message?: string;
    ml_listing_blocked_at?: string;
  };
  fecha_ultima_validacion: string | null;
  fecha_actualizacion: string | null;
}

interface ChannelsResponse {
  channels: ChannelConfig[];
}

interface SpacePublication {
  canal: string;
  label: string;
  mode: string;
  summary: string;
  activo: boolean;
  sincronizacion_automatica: boolean;
  publicar_cuando_disponible: boolean;
  estatus: string;
  url_publicacion: string | null;
  identificador_externo: string | null;
  mensaje_estado: string | null;
  fecha_ultima_validacion: string | null;
  fecha_ultima_sincronizacion: string | null;
  metricas: {
    vistas: number;
    leads: number;
    mensajes: number;
    eventos_webhook: number;
    ultimo_evento: string;
    ultimo_evento_fecha: string;
  };
  listo_para_publicar: boolean;
  faltantes: string[];
}

interface DashboardSpace {
  id: number;
  codigo: string;
  estatus: string;
  tipo_nombre: string | null;
  titulo_publico: string;
  renta_publicable: number;
  listo_para_publicar: boolean;
  faltantes: string[];
  foto_count: number;
  publicaciones: SpacePublication[];
}

interface DashboardResponse {
  summary: {
    total_espacios: number;
    disponibles: number;
    listos_para_publicar: number;
    canales_activos: number;
    publicaciones_en_cola: number;
    publicaciones_listas: number;
    publicaciones_activas: number;
  };
  spaces: DashboardSpace[];
}

interface ChannelRow {
  canal: string;
  label: string;
  summary: string;
  mode: string;
  activo: boolean;
  estatus: ChannelConfig["estatus"];
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
  credenciales?: ChannelConfig["credenciales"];
  fecha_ultima_validacion: string | null;
  publicaciones: {
    space: DashboardSpace;
    publication: SpacePublication;
  }[];
  activas: number;
  listas: number;
  enCola: number;
  publicadas: number;
  pausadas: number;
  errores: number;
  pendientesFicha: number;
  automaticas: number;
  vistas: number;
  leads: number;
  eventos: number;
}

type PublicationItem = ChannelRow["publicaciones"][number];

function hasPublication(item: PublicationItem | null): item is PublicationItem {
  return item !== null;
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

function formatPercent(value: number) {
  return `${Number(value || 0).toFixed(2).replace(/\.00$/, "")}%`;
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function formatDate(value: string | null) {
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
  }).format(date);
}

function channelStatusStyles(status: ChannelConfig["estatus"]) {
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

function publicationStatusStyles(status: string) {
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

export default function RentaInteraccionesPanel({
  entidadId,
  onManageRules,
}: {
  entidadId?: string;
  onManageRules?: () => void;
}) {
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [channels, setChannels] = useState<ChannelConfig[]>([]);
  const [selectedCode, setSelectedCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [syncingMetrics, setSyncingMetrics] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadData = useCallback(async () => {
    if (!entidadId) {
      setLoading(false);
      setDashboard(null);
      setChannels([]);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [dashboardResponse, channelsResponse] = await Promise.all([
        fetch(`${RENTA_API_BASE}/entidades/${entidadId}/dashboard/`, {
          cache: "no-store",
        }),
        fetch(`${RENTA_API_BASE}/entidades/${entidadId}/canales/`, {
          cache: "no-store",
        }),
      ]);
      const dashboardBody = (await dashboardResponse.json()) as
        | DashboardResponse
        | { detail?: string };
      const channelsBody = (await channelsResponse.json()) as
        | ChannelsResponse
        | { detail?: string };

      if (!dashboardResponse.ok) {
        throw new Error(
          extractErrorMessage(dashboardBody, "No se pudo cargar el resumen de renta.")
        );
      }
      if (!channelsResponse.ok) {
        throw new Error(
          extractErrorMessage(channelsBody, "No se pudieron cargar los canales.")
        );
      }

      const nextChannels = (channelsBody as ChannelsResponse).channels;
      setDashboard(dashboardBody as DashboardResponse);
      setChannels(nextChannels);
      setSelectedCode((current) => {
        if (current && nextChannels.some((channel) => channel.canal === current)) {
          return current;
        }
        return (
          nextChannels.find((channel) => channel.activo)?.canal ||
          nextChannels[0]?.canal ||
          ""
        );
      });
    } catch (loadError) {
      console.error("Error cargando interacciones de renta:", loadError);
      setError(
        loadError instanceof Error
          ? loadError.message
          : "No se pudo cargar el resumen de interacciones."
      );
      setDashboard(null);
      setChannels([]);
    } finally {
      setLoading(false);
    }
  }, [entidadId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const syncMercadoLibreMetrics = useCallback(async () => {
    if (!entidadId || !selectedCode) {
      return;
    }
    setSyncingMetrics(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        `${RENTA_API_BASE}/entidades/${entidadId}/canales/${selectedCode}/mercadolibre/metricas/`,
        {
          method: "POST",
        }
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          payload?.detail ||
            payload?.mensaje ||
            "No se pudieron actualizar las metricas de Mercado Libre."
        );
      }
      setNotice(payload?.mensaje || "Metricas de Mercado Libre actualizadas.");
      await loadData();
    } catch (syncError) {
      console.error("Error actualizando metricas de Mercado Libre:", syncError);
      setError(
        syncError instanceof Error
          ? syncError.message
          : "No se pudieron actualizar las metricas de Mercado Libre."
      );
    } finally {
      setSyncingMetrics(false);
    }
  }, [entidadId, loadData, selectedCode]);

  const channelRows = useMemo<ChannelRow[]>(() => {
    const spaces = dashboard?.spaces || [];
    return channels.map((channel) => {
      const publications = spaces
        .map((space) => {
          const publication = space.publicaciones.find(
            (item) => item.canal === channel.canal
          );
          return publication ? { space, publication } : null;
        })
        .filter(hasPublication);
      const activePublications = publications.filter(
        ({ publication }) => publication.activo
      );

      return {
        canal: channel.canal,
        label: channel.label,
        summary: channel.summary,
        mode: channel.modo_integracion || channel.mode_default,
        activo: channel.activo,
        estatus: channel.estatus,
        comision_porcentaje: channel.comision_porcentaje,
        ajuste_temporada_porcentaje: channel.ajuste_temporada_porcentaje,
        promocion_porcentaje: channel.promocion_porcentaje,
        comision_monto_fijo: channel.comision_monto_fijo,
        ajuste_temporada_monto_fijo: channel.ajuste_temporada_monto_fijo,
        promocion_monto_fijo: channel.promocion_monto_fijo,
        publicar_automaticamente: channel.publicar_automaticamente,
        pausar_si_ocupado: channel.pausar_si_ocupado,
        registrar_origen_contratacion: channel.registrar_origen_contratacion,
        notas: channel.notas,
        credenciales: channel.credenciales,
        fecha_ultima_validacion: channel.fecha_ultima_validacion,
        publicaciones: publications,
        activas: activePublications.length,
        listas: activePublications.filter(
          ({ publication }) => publication.estatus === "LISTA"
        ).length,
        enCola: activePublications.filter(
          ({ publication }) => publication.estatus === "EN_COLA"
        ).length,
        publicadas: activePublications.filter(
          ({ publication }) => publication.estatus === "PUBLICADA"
        ).length,
        pausadas: activePublications.filter(
          ({ publication }) => publication.estatus === "PAUSADA"
        ).length,
        errores: activePublications.filter(
          ({ publication }) => publication.estatus === "ERROR"
        ).length,
        pendientesFicha: activePublications.filter(
          ({ space, publication }) =>
            !space.listo_para_publicar ||
            space.faltantes.length > 0 ||
            publication.faltantes.length > 0
        ).length,
        automaticas: activePublications.filter(
          ({ publication }) =>
            publication.sincronizacion_automatica ||
            publication.publicar_cuando_disponible
        ).length,
        vistas: activePublications.reduce(
          (sum, { publication }) => sum + Number(publication.metricas?.vistas || 0),
          0
        ),
        leads: activePublications.reduce(
          (sum, { publication }) => sum + Number(publication.metricas?.leads || 0),
          0
        ),
        eventos: activePublications.reduce(
          (sum, { publication }) =>
            sum + Number(publication.metricas?.eventos_webhook || 0),
          0
        ),
      };
    });
  }, [channels, dashboard]);

  const selectedChannel = useMemo(() => {
    return (
      channelRows.find((channel) => channel.canal === selectedCode) ||
      channelRows[0] ||
      null
    );
  }, [channelRows, selectedCode]);

  const totals = useMemo(() => {
    return channelRows.reduce(
      (acc, channel) => {
        acc.canalesActivos += channel.activo ? 1 : 0;
        acc.publicacionesActivas += channel.activas;
        acc.listas += channel.listas;
        acc.enCola += channel.enCola;
        acc.pendientesFicha += channel.pendientesFicha;
        acc.errores += channel.errores;
        acc.vistas += channel.vistas;
        acc.leads += channel.leads;
        acc.eventos += channel.eventos;
        return acc;
      },
      {
        canalesActivos: 0,
        publicacionesActivas: 0,
        listas: 0,
        enCola: 0,
        pendientesFicha: 0,
        errores: 0,
        vistas: 0,
        leads: 0,
        eventos: 0,
      }
    );
  }, [channelRows]);

  if (loading) {
    return (
      <section className="page-section">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 py-16 text-center text-zinc-500">
          Cargando interacciones de renta...
        </div>
      </section>
    );
  }

  return (
    <section className="page-section space-y-5">
      <div className="flex flex-col gap-4 border-b border-zinc-800 pb-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">
            Interacciones y reglas
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-zinc-500">
            Lee que espacios estan listos por plataforma, que falta para
            publicarlos y que reglas comerciales se aplican antes de salir a
            cada canal.
          </p>
        </div>
        <button
          type="button"
          onClick={onManageRules}
          className="w-fit rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-2.5 text-sm font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20"
        >
          Configurar reglas
        </button>
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

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-6">
        <div className="metric-card-compact border-zinc-800 bg-zinc-950/80">
          <p className="metric-label-compact">Espacios</p>
          <p className="metric-value-compact">
            {dashboard?.summary.total_espacios || 0}
          </p>
        </div>
        <div className="metric-card-compact border-emerald-500/20 bg-emerald-500/10">
          <p className="metric-label-compact text-emerald-200/80">
            Disponibles
          </p>
          <p className="metric-value-compact text-emerald-300">
            {dashboard?.summary.disponibles || 0}
          </p>
        </div>
        <div className="metric-card-compact border-cyan-500/20 bg-cyan-500/10">
          <p className="metric-label-compact text-cyan-200/80">
            Canales activos
          </p>
          <p className="metric-value-compact text-cyan-300">
            {totals.canalesActivos}
          </p>
        </div>
        <div className="metric-card-compact border-blue-500/20 bg-blue-500/10">
          <p className="metric-label-compact text-blue-200/80">
            Publicaciones
          </p>
          <p className="metric-value-compact text-blue-300">
            {totals.publicacionesActivas}
          </p>
        </div>
        <div className="metric-card-compact border-amber-500/20 bg-amber-500/10">
          <p className="metric-label-compact text-amber-200/80">
            Pendientes ficha
          </p>
          <p className="metric-value-compact text-amber-300">
            {totals.pendientesFicha}
          </p>
        </div>
        <div className="metric-card-compact border-red-500/20 bg-red-500/10">
          <p className="metric-label-compact text-red-200/80">Errores</p>
          <p className="metric-value-compact text-red-300">{totals.errores}</p>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[420px_1fr]">
        <div className="space-y-3">
          {channelRows.map((channel) => (
            <button
              key={channel.canal}
              type="button"
              onClick={() => setSelectedCode(channel.canal)}
              className={`w-full rounded-2xl border p-4 text-left transition-colors ${
                selectedChannel?.canal === channel.canal
                  ? "border-cyan-500/30 bg-cyan-500/10"
                  : "border-zinc-800 bg-zinc-950/70 hover:border-zinc-700"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-white">
                    {channel.label}
                  </p>
                  <p className="mt-1 text-xs text-zinc-500">{channel.mode}</p>
                </div>
                <span
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${channelStatusStyles(
                    channel.estatus
                  )}`}
                >
                  {channel.estatus}
                </span>
              </div>
              <div className="mt-4 grid grid-cols-4 gap-2 text-center text-xs">
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-2">
                  <p className="font-semibold text-white">{channel.activas}</p>
                  <p className="mt-1 text-zinc-500">Activas</p>
                </div>
                <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 p-2">
                  <p className="font-semibold text-cyan-300">{channel.listas}</p>
                  <p className="mt-1 text-cyan-200/70">Listas</p>
                </div>
                <div className="rounded-xl border border-blue-500/20 bg-blue-500/10 p-2">
                  <p className="font-semibold text-blue-300">{channel.enCola}</p>
                  <p className="mt-1 text-blue-200/70">Cola</p>
                </div>
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-2">
                  <p className="font-semibold text-amber-300">
                    {channel.pendientesFicha}
                  </p>
                  <p className="mt-1 text-amber-200/70">Faltan</p>
                </div>
              </div>
            </button>
          ))}
        </div>

        {selectedChannel ? (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-5">
            <div className="flex flex-col gap-3 border-b border-zinc-800 pb-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-2xl font-semibold text-white">
                    {selectedChannel.label}
                  </h3>
                  <span
                    className={`rounded-full border px-2.5 py-1 text-xs font-medium ${channelStatusStyles(
                      selectedChannel.estatus
                    )}`}
                  >
                    {selectedChannel.estatus}
                  </span>
                </div>
                <p className="mt-2 max-w-2xl text-sm text-zinc-400">
                  {selectedChannel.summary}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {selectedChannel.canal === "MERCADO_LIBRE" ? (
                  <button
                    type="button"
                    onClick={() => void syncMercadoLibreMetrics()}
                    disabled={syncingMetrics}
                    className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-200 transition-colors hover:bg-emerald-500/20 disabled:opacity-50"
                  >
                    {syncingMetrics ? "Actualizando..." : "Actualizar metricas ML"}
                  </button>
                ) : null}
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-xs text-zinc-400">
                  Ultima validacion:{" "}
                  {formatDate(selectedChannel.fecha_ultima_validacion)}
                </div>
              </div>
            </div>

            {selectedChannel.credenciales?.ml_listing_blocked_code ===
            "seller.unable_to_list" ? (
              <div className="mt-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
                <p className="font-semibold text-amber-50">
                  Cuenta conectada, pero Mercado Libre bloqueo la publicacion de
                  inmuebles.
                </p>
                <p className="mt-2 leading-relaxed text-amber-100/80">
                  {selectedChannel.credenciales.ml_listing_blocked_message ||
                    "El vendedor necesita permisos para listar inmuebles, perfil completo o publicaciones disponibles antes de sincronizar."}
                </p>
                <p className="mt-2 text-xs uppercase tracking-[0.16em] text-amber-200/70">
                  Codigo ML: seller.unable_to_list
                </p>
              </div>
            ) : null}

            <div className="mt-5 grid gap-4 lg:grid-cols-3">
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
                  Reglas de precio
                </p>
                <div className="mt-4 space-y-3 text-sm">
                  <div className="flex justify-between gap-3">
                    <span className="text-zinc-500">Comision proveedor</span>
                    <span className="font-medium text-white">
                      {formatPercent(selectedChannel.comision_porcentaje)}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-zinc-500">Temporada</span>
                    <span className="font-medium text-white">
                      {formatPercent(selectedChannel.ajuste_temporada_porcentaje)}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-zinc-500">Promocion</span>
                    <span className="font-medium text-white">
                      {formatPercent(selectedChannel.promocion_porcentaje)}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3 border-t border-zinc-800 pt-3">
                    <span className="text-zinc-500">Comision fija</span>
                    <span className="font-medium text-white">
                      {formatMoney(selectedChannel.comision_monto_fijo)}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-zinc-500">Temporada fija</span>
                    <span className="font-medium text-white">
                      {formatMoney(selectedChannel.ajuste_temporada_monto_fijo)}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-zinc-500">Promocion fija</span>
                    <span className="font-medium text-white">
                      {formatMoney(selectedChannel.promocion_monto_fijo)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
                  Automatizacion
                </p>
                <div className="mt-4 space-y-2 text-sm text-zinc-300">
                  <div>
                    {selectedChannel.publicar_automaticamente
                      ? "Sube espacios al detectar disponibilidad."
                      : "La publicacion requiere preparacion manual."}
                  </div>
                  <div>
                    {selectedChannel.pausar_si_ocupado
                      ? "Pausa anuncios cuando el espacio se ocupa."
                      : "No pausa automaticamente al ocuparse."}
                  </div>
                  <div>
                    {selectedChannel.registrar_origen_contratacion
                      ? "Guarda origen de contratacion por plataforma."
                      : "Origen de contratacion sin seguimiento automatico."}
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
                  Trafico y estado
                </p>
                <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <p className="text-xl font-semibold text-white">
                      {selectedChannel.publicadas}
                    </p>
                    <p className="text-xs text-zinc-500">publicadas</p>
                  </div>
                  <div>
                    <p className="text-xl font-semibold text-white">
                      {selectedChannel.automaticas}
                    </p>
                    <p className="text-xs text-zinc-500">automaticas</p>
                  </div>
                  <div>
                    <p className="text-xl font-semibold text-white">
                      {selectedChannel.pausadas}
                    </p>
                    <p className="text-xs text-zinc-500">pausadas</p>
                  </div>
                  <div>
                    <p className="text-xl font-semibold text-white">
                      {selectedChannel.errores}
                    </p>
                    <p className="text-xs text-zinc-500">errores</p>
                  </div>
                  <div>
                    <p className="text-xl font-semibold text-cyan-300">
                      {selectedChannel.vistas}
                    </p>
                    <p className="text-xs text-zinc-500">vistas</p>
                  </div>
                  <div>
                    <p className="text-xl font-semibold text-emerald-300">
                      {selectedChannel.leads}
                    </p>
                    <p className="text-xs text-zinc-500">leads</p>
                  </div>
                  <div>
                    <p className="text-xl font-semibold text-blue-300">
                      {selectedChannel.eventos}
                    </p>
                    <p className="text-xs text-zinc-500">webhooks</p>
                  </div>
                </div>
              </div>
            </div>

            {selectedChannel.notas ? (
              <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 text-sm text-zinc-400">
                <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
                  Notas operativas
                </p>
                <p className="mt-2 leading-relaxed">{selectedChannel.notas}</p>
              </div>
            ) : null}

            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[980px] text-left text-sm text-zinc-300">
                <thead className="border-b border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="py-3 pr-4">Espacio</th>
                    <th className="py-3 pr-4">Disponibilidad</th>
                    <th className="py-3 pr-4">Publicacion</th>
                    <th className="py-3 pr-4">Auto</th>
                    <th className="py-3 pr-4">Trafico</th>
                    <th className="py-3 pr-4">Pendientes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {selectedChannel.publicaciones.map(({ space, publication }) => {
                    const missing = [
                      ...space.faltantes,
                      ...publication.faltantes,
                    ];
                    return (
                      <tr key={`${space.id}-${publication.canal}`} className="align-top">
                        <td className="py-4 pr-4">
                          <div className="font-medium text-white">{space.codigo}</div>
                          <div className="mt-1 text-xs text-zinc-500">
                            {space.tipo_nombre || "Sin tipo"} - {space.foto_count} fotos
                          </div>
                          <div className="mt-1 max-w-xs text-xs text-zinc-400">
                            {space.titulo_publico}
                          </div>
                        </td>
                        <td className="py-4 pr-4">
                          <span
                            className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${spaceStatusStyles(
                              space.estatus
                            )}`}
                          >
                            {space.estatus}
                          </span>
                        </td>
                        <td className="py-4 pr-4">
                          <span
                            className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${publicationStatusStyles(
                              publication.estatus
                            )}`}
                          >
                            {publication.estatus}
                          </span>
                          <div className="mt-2 text-xs text-zinc-500">
                            {publication.mensaje_estado || "Sin mensaje de canal."}
                          </div>
                          {publication.identificador_externo ? (
                            <div className="mt-2 text-xs text-zinc-500">
                              ID externo:{" "}
                              <span className="font-medium text-zinc-300">
                                {publication.identificador_externo}
                              </span>
                            </div>
                          ) : null}
                          {publication.url_publicacion ? (
                            <a
                              href={publication.url_publicacion}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-2 inline-flex text-xs font-medium text-cyan-300 hover:text-cyan-200"
                            >
                              Ver anuncio
                            </a>
                          ) : null}
                        </td>
                        <td className="py-4 pr-4 text-xs text-zinc-400">
                          <div>
                            {publication.sincronizacion_automatica
                              ? "Sync activo"
                              : "Sync manual"}
                          </div>
                          <div className="mt-1">
                            {publication.publicar_cuando_disponible
                              ? "Publica al estar libre"
                              : "No auto-publica"}
                          </div>
                        </td>
                        <td className="py-4 pr-4 text-xs text-zinc-400">
                          <div>
                            {publication.metricas?.vistas || 0} vistas
                          </div>
                          <div className="mt-1">
                            {publication.metricas?.leads || 0} leads
                          </div>
                          <div className="mt-1">
                            {publication.metricas?.eventos_webhook || 0} avisos
                          </div>
                        </td>
                        <td className="py-4 pr-4">
                          {missing.length === 0 ? (
                            <span className="text-xs text-emerald-300">
                              Listo para operar
                            </span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {missing.slice(0, 3).map((item) => (
                                <span
                                  key={item}
                                  className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-400"
                                >
                                  {item}
                                </span>
                              ))}
                              {missing.length > 3 ? (
                                <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-400">
                                  +{missing.length - 3}
                                </span>
                              ) : null}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/20 py-16 text-center text-zinc-500">
            No hay plataformas configurables para esta entidad.
          </div>
        )}
      </div>
    </section>
  );
}
