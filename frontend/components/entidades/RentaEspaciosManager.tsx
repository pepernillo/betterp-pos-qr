"use client";

import { buildApiUrl } from '@/lib/api';

import { useEffect, useMemo, useState } from "react";

const RENTA_API_BASE = buildApiUrl("/renta-espacios");

interface ChannelDefinition {
  code: string;
  label: string;
  mode: string;
  summary: string;
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
  listo_para_publicar: boolean;
  faltantes: string[];
}

interface DashboardSpace {
  id: number;
  codigo: string;
  estatus: string;
  tipo_nombre: string | null;
  titulo_publico: string;
  resumen_publico: string | null;
  renta_publicable: number;
  recamaras: number | null;
  banos: number | null;
  metros_cuadrados: number | null;
  publicar_en_renta: boolean;
  listo_para_publicar: boolean;
  faltantes: string[];
  foto_count: number;
  cover_url: string | null;
  publicaciones: SpacePublication[];
}

interface DashboardResponse {
  entidad: {
    id: number;
    nombre_comercial: string;
    ciudad: string | null;
  };
  summary: {
    total_espacios: number;
    disponibles: number;
    listos_para_publicar: number;
    con_fotos: number;
    canales_activos: number;
    publicaciones_en_cola: number;
    publicaciones_listas: number;
    publicaciones_activas: number;
  };
  channels: ChannelDefinition[];
  spaces: DashboardSpace[];
}

const moneyFormatter = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 0,
});

function extractErrorMessage(body: unknown, fallback: string) {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail?: unknown }).detail;
    if (typeof detail === "string" && detail.trim()) {
      return detail;
    }
  }
  return fallback;
}

function formatMoney(value: number) {
  return moneyFormatter.format(value || 0);
}

function getStatusStyles(status: string) {
  if (status === "EN_COLA") {
    return "border-blue-500/20 bg-blue-500/10 text-blue-300";
  }
  if (status === "LISTA") {
    return "border-cyan-500/20 bg-cyan-500/10 text-cyan-300";
  }
  if (status === "PUBLICADA") {
    return "border-emerald-500/20 bg-emerald-500/10 text-emerald-300";
  }
  if (status === "PAUSADA") {
    return "border-amber-500/20 bg-amber-500/10 text-amber-300";
  }
  if (status === "ERROR") {
    return "border-red-500/20 bg-red-500/10 text-red-300";
  }
  return "border-zinc-700 bg-zinc-900 text-zinc-400";
}

function getSpaceStatusStyles(status: string) {
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

export default function RentaEspaciosManager({
  entidadId,
}: {
  entidadId?: string;
}) {
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [filter, setFilter] = useState<"TODOS" | "DISPONIBLES" | "LISTOS" | "PENDIENTES">(
    "DISPONIBLES"
  );
  const [selectedSpace, setSelectedSpace] = useState<DashboardSpace | null>(null);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const loadDashboard = async () => {
    if (!entidadId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `${RENTA_API_BASE}/entidades/${entidadId}/dashboard/`,
        {
          cache: "no-store",
        }
      );
      const body = (await response.json()) as DashboardResponse | { detail?: string };
      if (!response.ok) {
        throw new Error(extractErrorMessage(body, "No se pudo cargar el tablero de renta."));
      }
      setDashboard(body as DashboardResponse);
    } catch (loadError) {
      console.error("Error cargando renta de espacios:", loadError);
      setError(
        loadError instanceof Error
          ? loadError.message
          : "No se pudo cargar el tablero de renta."
      );
      setDashboard(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDashboard();
  }, [entidadId]);

  const spaces = useMemo(() => {
    if (!dashboard) {
      return [];
    }
    return dashboard.spaces.filter((space) => {
      if (filter === "DISPONIBLES") {
        return space.estatus === "DISPONIBLE";
      }
      if (filter === "LISTOS") {
        return space.listo_para_publicar;
      }
      if (filter === "PENDIENTES") {
        return space.faltantes.length > 0;
      }
      return true;
    });
  }, [dashboard, filter]);

  const saveChannels = async () => {
    if (!selectedSpace) {
      return;
    }
    setSaving(true);
    setError("");
    try {
      const response = await fetch(
        `${RENTA_API_BASE}/espacios/${selectedSpace.id}/publicaciones/`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            publicaciones: selectedSpace.publicaciones.map((publication) => ({
              canal: publication.canal,
              activo: publication.activo,
              sincronizacion_automatica: publication.sincronizacion_automatica,
              publicar_cuando_disponible: publication.publicar_cuando_disponible,
              modo_integracion: publication.mode,
            })),
          }),
        }
      );
      const body =
        (await response.json()) as
          | { mensaje: string; space: DashboardSpace }
          | { detail?: string };
      if (!response.ok) {
        throw new Error(extractErrorMessage(body, "No se pudieron actualizar los canales."));
      }
      const nextSpace = (body as { mensaje: string; space: DashboardSpace }).space;
      setSelectedSpace(nextSpace);
      setDashboard((current) =>
        current
          ? {
              ...current,
              spaces: current.spaces.map((space) =>
                space.id === nextSpace.id ? nextSpace : space
              ),
            }
          : current
      );
      setSuccess("Canales de renta actualizados.");
      window.setTimeout(() => setSuccess(""), 2600);
    } catch (saveError) {
      console.error("Error guardando canales:", saveError);
      setError(
        saveError instanceof Error
          ? saveError.message
          : "No se pudieron guardar los canales."
      );
    } finally {
      setSaving(false);
    }
  };

  const syncOneSpace = async (spaceId: number) => {
    setSyncing(true);
    setError("");
    try {
      const response = await fetch(`${RENTA_API_BASE}/espacios/${spaceId}/sincronizar/`, {
        method: "POST",
      });
      const body =
        (await response.json()) as
          | { mensaje: string; space: DashboardSpace }
          | { detail?: string };
      if (!response.ok) {
        throw new Error(
          extractErrorMessage(body, "No se pudo preparar la sincronizacion.")
        );
      }
      const nextSpace = (body as { mensaje: string; space: DashboardSpace }).space;
      setDashboard((current) =>
        current
          ? {
              ...current,
              spaces: current.spaces.map((space) =>
                space.id === nextSpace.id ? nextSpace : space
              ),
            }
          : current
      );
      if (selectedSpace?.id === nextSpace.id) {
        setSelectedSpace(nextSpace);
      }
      setSuccess("Sincronizacion enviada para el espacio.");
      window.setTimeout(() => setSuccess(""), 2600);
      await loadDashboard();
    } catch (syncError) {
      console.error("Error sincronizando espacio:", syncError);
      setError(
        syncError instanceof Error
          ? syncError.message
          : "No se pudo preparar la sincronizacion."
      );
    } finally {
      setSyncing(false);
    }
  };

  const syncEntity = async () => {
    if (!entidadId) {
      return;
    }
    setSyncing(true);
    setError("");
    try {
      const response = await fetch(
        `${RENTA_API_BASE}/entidades/${entidadId}/sincronizar/`,
        {
          method: "POST",
        }
      );
      const body = (await response.json()) as { mensaje?: string; detail?: string };
      if (!response.ok) {
        throw new Error(
          extractErrorMessage(body, "No se pudo preparar la sincronizacion masiva.")
        );
      }
      await loadDashboard();
      setSuccess(body.mensaje || "Sincronizacion masiva enviada.");
      window.setTimeout(() => setSuccess(""), 2600);
    } catch (syncError) {
      console.error("Error sincronizando entidad:", syncError);
      setError(
        syncError instanceof Error
          ? syncError.message
          : "No se pudo preparar la sincronizacion masiva."
      );
    } finally {
      setSyncing(false);
    }
  };

  const updatePublication = (
    channelCode: string,
    patch: Partial<SpacePublication>
  ) => {
    setSelectedSpace((current) =>
      current
        ? {
            ...current,
            publicaciones: current.publicaciones.map((publication) =>
              publication.canal === channelCode
                ? { ...publication, ...patch }
                : publication
            ),
          }
        : current
    );
  };

  return (
    <div className="space-y-6">
      {success ? (
        <div className="fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-4 py-2 text-sm text-emerald-300 shadow-lg">
          {success}
        </div>
      ) : null}

      <section className="page-section">
        <div className="flex justify-end border-b border-zinc-800 pb-4">
          <button
            type="button"
            onClick={() => void syncEntity()}
            disabled={syncing || loading}
            className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-2.5 text-sm font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20 disabled:opacity-50"
          >
            {syncing ? "Preparando..." : "Preparar sincronizacion masiva"}
          </button>
        </div>

        {error ? (
          <div className="mt-5 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        ) : null}

        {loading || !dashboard ? (
          <div className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-900/30 py-16 text-center text-zinc-500">
            Cargando tablero de renta...
          </div>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-6">
              <div className="metric-card-compact border-zinc-800 bg-zinc-950/80">
                <p className="metric-label-compact">
                  Espacios
                </p>
                <p className="metric-value-compact">
                  {dashboard.summary.total_espacios}
                </p>
              </div>
              <div className="metric-card-compact border-emerald-500/20 bg-emerald-500/10">
                <p className="metric-label-compact text-emerald-200/80">
                  Disponibles
                </p>
                <p className="metric-value-compact text-emerald-300">
                  {dashboard.summary.disponibles}
                </p>
              </div>
              <div className="metric-card-compact border-cyan-500/20 bg-cyan-500/10">
                <p className="metric-label-compact text-cyan-200/80">
                  Listos
                </p>
                <p className="metric-value-compact text-cyan-300">
                  {dashboard.summary.listos_para_publicar}
                </p>
              </div>
              <div className="metric-card-compact border-blue-500/20 bg-blue-500/10">
                <p className="metric-label-compact text-blue-200/80">
                  Con fotos
                </p>
                <p className="metric-value-compact text-blue-300">
                  {dashboard.summary.con_fotos}
                </p>
              </div>
              <div className="metric-card-compact border-violet-500/20 bg-violet-500/10">
                <p className="metric-label-compact text-violet-200/80">
                  Canales activos
                </p>
                <p className="metric-value-compact text-violet-300">
                  {dashboard.summary.canales_activos}
                </p>
              </div>
              <div className="metric-card-compact border-amber-500/20 bg-amber-500/10">
                <p className="metric-label-compact text-amber-200/80">
                  En cola
                </p>
                <p className="metric-value-compact text-amber-300">
                  {dashboard.summary.publicaciones_en_cola}
                </p>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              {[
                ["TODOS", "Todos"],
                ["DISPONIBLES", "Disponibles"],
                ["LISTOS", "Listos"],
                ["PENDIENTES", "Con faltantes"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() =>
                    setFilter(value as "TODOS" | "DISPONIBLES" | "LISTOS" | "PENDIENTES")
                  }
                  className={`rounded-xl border px-3 py-2 text-sm transition-colors ${
                    filter === value
                      ? "border-cyan-500/20 bg-cyan-500/10 text-cyan-200"
                      : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[1080px] text-left text-sm text-zinc-300">
                <thead className="border-b border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="py-3 pr-4">Espacio</th>
                    <th className="py-3 pr-4">Estatus</th>
                    <th className="py-3 pr-4">Precio</th>
                    <th className="py-3 pr-4">Ficha</th>
                    <th className="py-3 pr-4">Canales</th>
                    <th className="py-3 pr-4">Sync</th>
                    <th className="py-3 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {spaces.map((space) => {
                    const activeChannels = space.publicaciones.filter(
                      (publication) => publication.activo
                    );
                    const queueStates = activeChannels.filter(
                      (publication) =>
                        publication.estatus === "EN_COLA" ||
                        publication.estatus === "LISTA"
                    );

                    return (
                      <tr key={space.id} className="align-top hover:bg-zinc-900/40">
                        <td className="py-4 pr-4">
                          <div className="flex items-start gap-3">
                            <div className="h-14 w-14 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
                              {space.cover_url ? (
                                <img
                                  src={space.cover_url}
                                  alt={space.codigo}
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <div className="flex h-full items-center justify-center text-[11px] text-zinc-600">
                                  Sin foto
                                </div>
                              )}
                            </div>
                            <div>
                              <div className="font-medium text-white">{space.codigo}</div>
                              <div className="mt-1 text-xs text-zinc-500">
                                {space.tipo_nombre || "Sin tipo"}
                              </div>
                              <div className="mt-2 text-xs text-zinc-400">
                                {space.titulo_publico}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="py-4 pr-4">
                          <span
                            className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${getSpaceStatusStyles(
                              space.estatus
                            )}`}
                          >
                            {space.estatus}
                          </span>
                          <div className="mt-2 text-xs text-zinc-500">
                            {space.publicar_en_renta
                              ? "Visible para renta"
                              : "Excluido de promocion"}
                          </div>
                        </td>
                        <td className="py-4 pr-4">
                          <div className="font-medium text-white">
                            {formatMoney(space.renta_publicable)}
                          </div>
                          <div className="mt-1 text-xs text-zinc-500">
                            {space.foto_count} fotos
                          </div>
                        </td>
                        <td className="py-4 pr-4">
                          <div
                            className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${
                              space.listo_para_publicar
                                ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
                                : "border-zinc-700 bg-zinc-900 text-zinc-400"
                            }`}
                          >
                            {space.listo_para_publicar ? "Lista" : "Con faltantes"}
                          </div>
                          <div className="mt-2 max-w-xs text-xs text-zinc-500">
                            {space.faltantes.length > 0
                              ? space.faltantes[0]
                              : "Cumple la base comercial para salir a canales."}
                          </div>
                        </td>
                        <td className="py-4 pr-4">
                          <div className="font-medium text-white">
                            {activeChannels.length} activos
                          </div>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {activeChannels.slice(0, 3).map((publication) => (
                              <span
                                key={publication.canal}
                                className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-400"
                              >
                                {publication.label}
                              </span>
                            ))}
                            {activeChannels.length === 0 ? (
                              <span className="text-xs text-zinc-500">Sin canales</span>
                            ) : null}
                          </div>
                        </td>
                        <td className="py-4 pr-4">
                          <div className="font-medium text-white">
                            {queueStates.length}
                          </div>
                          <div className="mt-1 text-xs text-zinc-500">
                            listos o en cola
                          </div>
                        </td>
                        <td className="py-4 text-right">
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setSelectedSpace(space)}
                              className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-3 py-2 text-xs font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20"
                            >
                              Configurar
                            </button>
                            <button
                              type="button"
                              onClick={() => void syncOneSpace(space.id)}
                              className="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-800"
                            >
                              Preparar
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {selectedSpace ? (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm">
          <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-950 shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-zinc-800 px-6 py-5">
              <div>
                <h3 className="text-2xl font-bold text-white">
                  Renta de {selectedSpace.codigo}
                </h3>
                <p className="mt-1 text-sm text-zinc-500">
                  Activa los canales correctos y define si el espacio debe
                  prepararse automaticamente cuando quede disponible.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedSpace(null)}
                className="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-400 transition-colors hover:text-white"
              >
                Cerrar
              </button>
            </div>

            <div className="overflow-y-auto px-6 py-5">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
                  <p className="text-xs uppercase tracking-wide text-zinc-500">
                    Estado del espacio
                  </p>
                  <div className="mt-3 flex items-center gap-2">
                    <span
                      className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${getSpaceStatusStyles(
                        selectedSpace.estatus
                      )}`}
                    >
                      {selectedSpace.estatus}
                    </span>
                    <span className="text-sm text-zinc-400">
                      {selectedSpace.publicar_en_renta
                        ? "Se puede considerar en renta"
                        : "Marcado fuera de renta"}
                    </span>
                  </div>
                </div>
                <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
                  <p className="text-xs uppercase tracking-wide text-zinc-500">
                    Ficha comercial
                  </p>
                  <p className="mt-3 text-sm text-white">
                    {selectedSpace.listo_para_publicar
                      ? "La ficha base esta lista para promocion."
                      : "Aun hay faltantes antes de sincronizar."}
                  </p>
                  {selectedSpace.faltantes.length > 0 ? (
                    <p className="mt-2 text-xs text-zinc-500">
                      Primer faltante: {selectedSpace.faltantes[0]}
                    </p>
                  ) : null}
                </div>
                <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
                  <p className="text-xs uppercase tracking-wide text-zinc-500">
                    Precio base
                  </p>
                  <p className="mt-3 text-xl font-bold text-white">
                    {formatMoney(selectedSpace.renta_publicable)}
                  </p>
                </div>
              </div>

              <div className="mt-5 space-y-4">
                {selectedSpace.publicaciones.map((publication) => (
                  <div
                    key={publication.canal}
                    className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4"
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="max-w-2xl">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="text-lg font-semibold text-white">
                            {publication.label}
                          </h4>
                          <span
                            className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${getStatusStyles(
                              publication.estatus
                            )}`}
                          >
                            {publication.estatus}
                          </span>
                          <span className="rounded-full border border-zinc-700 bg-zinc-950 px-2.5 py-1 text-xs text-zinc-400">
                            {publication.mode}
                          </span>
                        </div>
                        <p className="mt-2 text-sm text-zinc-500">
                          {publication.summary}
                        </p>
                        <p className="mt-2 text-xs text-zinc-500">
                          {publication.mensaje_estado ||
                            "Sin diagnostico operativo todavia."}
                        </p>
                      </div>

                      <div className="flex flex-col gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            updatePublication(publication.canal, {
                              activo: !publication.activo,
                            })
                          }
                          className={`rounded-xl border px-3 py-2 text-sm transition-colors ${
                            publication.activo
                              ? "border-cyan-500/20 bg-cyan-500/10 text-cyan-200"
                              : "border-zinc-800 bg-zinc-950 text-zinc-400"
                          }`}
                        >
                          {publication.activo ? "Canal activo" : "Activar canal"}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            updatePublication(publication.canal, {
                              sincronizacion_automatica:
                                !publication.sincronizacion_automatica,
                            })
                          }
                          className={`rounded-xl border px-3 py-2 text-sm transition-colors ${
                            publication.sincronizacion_automatica
                              ? "border-violet-500/20 bg-violet-500/10 text-violet-200"
                              : "border-zinc-800 bg-zinc-950 text-zinc-400"
                          }`}
                        >
                          {publication.sincronizacion_automatica
                            ? "Auto-sync activo"
                            : "Auto-sync inactivo"}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            updatePublication(publication.canal, {
                              publicar_cuando_disponible:
                                !publication.publicar_cuando_disponible,
                            })
                          }
                          className={`rounded-xl border px-3 py-2 text-sm transition-colors ${
                            publication.publicar_cuando_disponible
                              ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-200"
                              : "border-zinc-800 bg-zinc-950 text-zinc-400"
                          }`}
                        >
                          {publication.publicar_cuando_disponible
                            ? "Publicar al quedar disponible"
                            : "No auto-publicar"}
                        </button>
                      </div>
                    </div>

                    {publication.faltantes.length > 0 ? (
                      <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-950/70 p-3">
                        <p className="text-xs uppercase tracking-wide text-zinc-500">
                          Faltantes para este canal
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {publication.faltantes.map((missing) => (
                            <span
                              key={missing}
                              className="rounded-full border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-400"
                            >
                              {missing}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-zinc-800 px-6 py-4">
              <button
                type="button"
                onClick={() => setSelectedSpace(null)}
                className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-2.5 text-sm text-zinc-400 transition-colors hover:text-white"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void syncOneSpace(selectedSpace.id)}
                disabled={syncing}
                className="rounded-xl border border-blue-500/20 bg-blue-500/10 px-4 py-2.5 text-sm font-medium text-blue-200 transition-colors hover:bg-blue-500/20 disabled:opacity-50"
              >
                {syncing ? "Preparando..." : "Preparar este espacio"}
              </button>
              <button
                type="button"
                onClick={() => void saveChannels()}
                disabled={saving}
                className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-2.5 text-sm font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20 disabled:opacity-50"
              >
                {saving ? "Guardando..." : "Guardar canales"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
