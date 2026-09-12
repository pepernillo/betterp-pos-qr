"use client";

import { buildApiUrl } from '@/lib/api';

import { useEffect, useState } from "react";

import EntidadResumenPanel, {
  type EntitySummary,
} from "./EntidadResumenPanel";

const EMPRESAS_API_BASE = buildApiUrl("/empresas");

interface SummaryEntity {
  id: number;
  nombre_comercial: string;
}

interface SummaryModalState {
  isOpen: boolean;
  entity: SummaryEntity | null;
}

interface EntidadSummaryModalProps {
  state: SummaryModalState;
  onClose: () => void;
}

function extractFilename(contentDisposition: string | null, fallback: string) {
  if (!contentDisposition) {
    return fallback;
  }

  const match = contentDisposition.match(/filename="([^"]+)"/i);
  return match?.[1] || fallback;
}

export default function EntidadSummaryModal({
  state,
  onClose,
}: EntidadSummaryModalProps) {
  const [summary, setSummary] = useState<EntitySummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    const entityId = state.entity?.id;
    if (!state.isOpen || !entityId) {
      setSummary(null);
      setError("");
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();

    const loadSummary = async () => {
      setIsLoading(true);
      setError("");

      try {
        const response = await fetch(`${EMPRESAS_API_BASE}/${entityId}/resumen/`, {
          cache: "no-store",
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error("No se pudo cargar el resumen de la entidad.");
        }

        const body = (await response.json()) as EntitySummary;
        setSummary(body);
      } catch (fetchError) {
        if ((fetchError as Error).name === "AbortError") {
          return;
        }

        console.error("Error cargando resumen de entidad:", fetchError);
        setSummary(null);
        setError("No se pudo cargar el resumen de la entidad.");
      } finally {
        setIsLoading(false);
      }
    };

    void loadSummary();

    return () => controller.abort();
  }, [state.entity?.id, state.isOpen]);

  const handleExport = async () => {
    const entityId = state.entity?.id;
    if (!entityId) {
      return;
    }

    setIsExporting(true);
    try {
      const response = await fetch(
        `${EMPRESAS_API_BASE}/${entityId}/resumen/exportar/`
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
        `resumen-entidad-${entityId}.xlsx`
      );
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
    } catch (exportError) {
      console.error("Error exportando resumen:", exportError);
      setError("No se pudo exportar el resumen en Excel.");
    } finally {
      setIsExporting(false);
    }
  };

  if (!state.isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-full max-w-7xl flex-col overflow-hidden rounded-[28px] border border-zinc-800 bg-zinc-950 shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-5">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-cyan-300/80">
              Resumen de entidad
            </p>
            <h2 className="mt-2 text-2xl font-bold text-white">
              {state.entity?.nombre_comercial || "Entidad"}
            </h2>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => void handleExport()}
              disabled={isExporting || isLoading}
              className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm font-medium text-emerald-200 transition-colors hover:bg-emerald-500/20 disabled:opacity-50"
            >
              {isExporting ? "Exportando..." : "Exportar Excel"}
            </button>
            <button
              onClick={onClose}
              className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:bg-zinc-800 hover:text-white"
            >
              Cerrar
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
          {isLoading ? (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 py-16 text-center text-zinc-400">
              Cargando resumen operativo y financiero...
            </div>
          ) : error ? (
            <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300">
              {error}
            </div>
          ) : summary ? (
            <EntidadResumenPanel summary={summary} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
