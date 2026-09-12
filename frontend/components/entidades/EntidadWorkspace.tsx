"use client";

import { buildApiUrl } from '@/lib/api';

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import EntidadResumenPanel, {
  type EntitySummary,
} from "./EntidadResumenPanel";
import EspaciosManager from "./EspaciosManager";
import ReglasManager from "./ReglasManager";

const EMPRESAS_API_BASE = buildApiUrl("/empresas");

type WorkspaceTab =
  | "asignacion"
  | "reglas";

function resolveWorkspaceTab(value: string | null): WorkspaceTab | null {
  if (value === "asignacion" || value === "reglas") {
    return value;
  }
  return null;
}

interface EntidadDetail {
  id: number;
  nombre_comercial: string;
  ciudad?: string | null;
  rfc: string | null;
  regimen_fiscal: string | null;
  logo_url?: string | null;
  capa_negocio_id: number | null;
  capa_negocio_nombre: string | null;
  capa_negocio_tipo: string | null;
  capa_nombre_administrador?: string | null;
  capa_correo_contacto?: string | null;
  capa_telefono_contacto?: string | null;
  capa_periodicidad_cobro_default: string | null;
  capa_dia_vencimiento_default: number | null;
  capa_dias_gracia_default: number | null;
  tipo_fecha_corte: string;
  activo: boolean;
  fecha_pausa: string | null;
  clientes_count: number;
  espacios_total: number;
  espacios_ocupados: number;
  espacios_disponibles: number;
  espacios_reservados: number;
  espacios_mantenimiento: number;
  facturacion_activa: number;
  cxp_abierta: number;
  cxp_vencido: number;
  cxp_registros_abiertos: number;
}

interface EntidadWorkspaceProps {
  entidadId?: string;
}

function extractFilename(contentDisposition: string | null, fallback: string) {
  if (!contentDisposition) {
    return fallback;
  }

  const match = contentDisposition.match(/filename="([^"]+)"/i);
  return match?.[1] || fallback;
}

export default function EntidadWorkspace({
  entidadId,
}: EntidadWorkspaceProps) {
  const searchParams = useSearchParams();
  const requestedTab = resolveWorkspaceTab(searchParams.get("tab"));
  const [activeTab, setActiveTab] = useState<WorkspaceTab>(
    requestedTab || "asignacion"
  );
  const [entidad, setEntidad] = useState<EntidadDetail | null>(null);
  const [summary, setSummary] = useState<EntitySummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSummaryOpen, setIsSummaryOpen] = useState(false);
  const [isLoadingSummary, setIsLoadingSummary] = useState(false);
  const [isExportingSummary, setIsExportingSummary] = useState(false);
  const [error, setError] = useState("");
  const [summaryError, setSummaryError] = useState("");

  const loadWorkspace = useCallback(async () => {
    if (!entidadId) {
      setEntidad(null);
      setSummary(null);
      setIsLoading(false);
      setIsSummaryOpen(false);
      setIsLoadingSummary(false);
      setError("No se encontro el identificador de la entidad.");
      return;
    }

    setIsLoading(true);
    setIsLoadingSummary(false);
    setError("");
    setSummary(null);
    setSummaryError("");
    setIsSummaryOpen(false);

    try {
      const entityData = await fetch(`${EMPRESAS_API_BASE}/${entidadId}/`, {
        cache: "no-store",
      }).then(async (response) => {
        if (!response.ok) {
          throw new Error("No se pudo cargar la entidad.");
        }
        return (await response.json()) as EntidadDetail;
      });
      setEntidad(entityData);
    } catch (loadError) {
      console.error("Error cargando entidad:", loadError);
      setEntidad(null);
      setError("No se pudo cargar la entidad seleccionada.");
    } finally {
      setIsLoading(false);
    }
  }, [entidadId]);

  const loadSummary = useCallback(async () => {
    if (!entidadId) {
      return;
    }

    setIsLoadingSummary(true);
    setSummaryError("");

    try {
      const summaryData = await fetch(`${EMPRESAS_API_BASE}/${entidadId}/resumen/`, {
        cache: "no-store",
      }).then(async (response) => {
        if (!response.ok) {
          throw new Error("No se pudo cargar el resumen financiero.");
        }
        return (await response.json()) as EntitySummary;
      });
      setSummary(summaryData);
    } catch (loadError) {
      console.error("Error cargando resumen:", loadError);
      setSummary(null);
      setSummaryError("No se pudo cargar el resumen operativo y financiero.");
    } finally {
      setIsLoadingSummary(false);
    }
  }, [entidadId]);

  const toggleSummary = () => {
    setIsSummaryOpen((current) => {
      const next = !current;
      if (next && !summary && !isLoadingSummary) {
        void loadSummary();
      }
      return next;
    });
  };

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  useEffect(() => {
    if (requestedTab) {
      setActiveTab(requestedTab);
    }
  }, [requestedTab]);

  const handleExportSummary = async () => {
    if (!entidadId) {
      return;
    }

    setIsExportingSummary(true);
    try {
      const response = await fetch(
        `${EMPRESAS_API_BASE}/${entidadId}/resumen/exportar/`
      );
      if (!response.ok) {
        throw new Error("No se pudo exportar el resumen.");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = extractFilename(
        response.headers.get("content-disposition"),
        `resumen-entidad-${entidadId}.xlsx`
      );
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
    } catch (exportError) {
      console.error("Error exportando resumen:", exportError);
      setSummaryError("No se pudo exportar el resumen en Excel.");
    } finally {
      setIsExportingSummary(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <Link
        href="/entidades"
        className="flex w-fit items-center text-sm font-medium text-zinc-500 transition-colors hover:text-blue-400"
      >
        <svg
          className="mr-1.5 h-4 w-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M10 19l-7-7m0 0l7-7m-7 7h18"
          />
        </svg>
        Volver a unidades de negocio
      </Link>

      <div className="rounded-2xl border border-zinc-800 bg-gradient-to-br from-zinc-950 via-zinc-950 to-zinc-900 p-4 shadow-xl">
        <div className="space-y-3">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="page-title-compact">
                {entidad?.nombre_comercial || "Entidad"}
              </h1>
              {entidad && (
                <span
                  className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                    entidad.activo
                      ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
                      : "border-red-500/20 bg-red-500/10 text-red-300"
                  }`}
                >
                  {entidad.activo ? "Activa" : "Inactiva"}
                </span>
              )}
              {entidad?.capa_negocio_nombre && (
                <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-xs font-semibold text-cyan-300">
                  {entidad.capa_negocio_tipo || "CAPA"} -{" "}
                  {entidad.capa_negocio_nombre}
                </span>
              )}
            </div>

            <p className="max-w-3xl text-sm text-zinc-400">
              Esta vista concentra la base operativa de la entidad: inventario de
              espacios, lectura ejecutiva y reglas heredables.
            </p>

            {entidad?.capa_negocio_nombre && (
              <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100/90">
                Base comercial compartida: periodicidad{" "}
                <span className="font-semibold">
                  {entidad.capa_periodicidad_cobro_default || "MENSUAL"}
                </span>
                {entidad.capa_dia_vencimiento_default
                  ? ` - vence dia ${entidad.capa_dia_vencimiento_default}`
                  : ""}
                {entidad.capa_dias_gracia_default
                  ? ` - ${entidad.capa_dias_gracia_default} dias de gracia`
                  : ""}
              </div>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300">
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950 py-12 text-center text-zinc-500">
          Cargando detalle de la entidad...
        </div>
      ) : entidad ? (
        <>
          <section className="page-section">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="section-title-compact">
                  Panorama de la entidad
                </h2>
                <p className="section-copy-compact">
                  Resumen operativo y financiero bajo demanda para mantener limpia
                  la gestion diaria.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                {isSummaryOpen && (
                  <button
                    onClick={() => void handleExportSummary()}
                    disabled={isExportingSummary || isLoadingSummary}
                    className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm font-medium text-emerald-200 transition-colors hover:bg-emerald-500/20 disabled:opacity-50"
                  >
                    {isExportingSummary ? "Exportando..." : "Exportar Excel"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={toggleSummary}
                  className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-2.5 text-sm font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20"
                >
                  {isSummaryOpen ? "Ocultar panorama" : "Mostrar panorama"}
                </button>
              </div>
            </div>

            {isSummaryOpen ? (
              <div className="mt-5 border-t border-zinc-800 pt-5">
              {isLoadingSummary ? (
                <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 py-16 text-center text-zinc-400">
                  Cargando resumen operativo y financiero...
                </div>
              ) : summaryError ? (
                <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300">
                  {summaryError}
                </div>
              ) : summary ? (
                <EntidadResumenPanel summary={summary} showDetailTable={false} />
              ) : null}
              </div>
            ) : null}
          </section>

          <div className="flex space-x-2 overflow-x-auto border-b border-zinc-800 pb-2">
            <button
              onClick={() => setActiveTab("asignacion")}
              className={`rounded-lg px-5 py-2.5 text-sm font-medium transition-colors ${
                activeTab === "asignacion"
                  ? "bg-blue-500/10 text-blue-400"
                  : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
              }`}
            >
              Asignacion de espacios
            </button>
            <button
              onClick={() => setActiveTab("reglas")}
              className={`rounded-lg px-5 py-2.5 text-sm font-medium transition-colors ${
                activeTab === "reglas"
                  ? "bg-blue-500/10 text-blue-400"
                  : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
              }`}
            >
              Reglas
            </button>
          </div>

          {activeTab === "asignacion" ? (
            <EspaciosManager entidadId={entidadId} viewMode="inventario" />
          ) : (
            <ReglasManager entidadId={entidadId} embedded />
          )}
        </>
      ) : null}
    </div>
  );
}
