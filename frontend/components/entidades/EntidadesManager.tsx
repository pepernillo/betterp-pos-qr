"use client";

import { buildApiUrl } from '@/lib/api';

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import EntidadFormModal from "./EntidadFormModal";
import EntidadSummaryModal from "./EntidadSummaryModal";

const EMPRESAS_API_BASE = buildApiUrl("/empresas");
const cardColors = [
  "bg-emerald-500",
  "bg-blue-500",
  "bg-cyan-500",
  "bg-amber-500",
  "bg-rose-500",
];

interface Entidad {
  id: number;
  nombre_comercial: string;
  ciudad?: string | null;
  rfc?: string | null;
  regimen_fiscal?: string | null;
  logo_url?: string | null;
  tipo_fecha_corte: string;
  activo: boolean;
  fecha_pausa?: string | null;
  clientes_count: number;
  espacios_total: number;
  espacios_ocupados: number;
  espacios_disponibles: number;
  espacios_reservados: number;
  espacios_mantenimiento: number;
  facturacion_activa: number;
  cxp_total: number;
  cxp_pagado: number;
  cxp_pendiente: number;
  cxp_vencido: number;
  cxp_por_conciliar: number;
  cxp_abierta: number;
  cxp_registros_abiertos: number;
}

interface BatchImportResult {
  mensaje: string;
  total_filas: number;
  entidades_creadas: number;
  entidades_actualizadas: number;
  tipos_creados: number;
  espacios_creados: number;
  espacios_actualizados: number;
  clientes_creados?: number;
  clientes_actualizados?: number;
  asignaciones_creadas?: number;
  asignaciones_actualizadas?: number;
  asignaciones_reemplazadas?: number;
  asignaciones_finalizadas?: number;
  cxc_creadas?: number;
  cxc_existentes?: number;
  filas_omitidas: number;
  errores: string[];
  errores_total?: number;
  archivo_errores_nombre?: string;
  archivo_errores_base64?: string;
}

interface StatusModalState {
  isOpen: boolean;
  entidad: Entidad | null;
}

interface DeleteModalState {
  isOpen: boolean;
  id: number | null;
  nombre: string;
}

interface SummaryModalState {
  isOpen: boolean;
  entidad: Entidad | null;
}

type ViewMode = "cards" | "table";
type EntityActionKind =
  | "summary"
  | "manage"
  | "status"
  | "clone"
  | "edit"
  | "delete";

function getToday() {
  return new Date().toISOString().split("T")[0];
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

function extractFilename(contentDisposition: string | null, fallback: string) {
  if (!contentDisposition) {
    return fallback;
  }

  const match = contentDisposition.match(/filename="([^"]+)"/i);
  return match?.[1] || fallback;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function buildXlsxBlobFromBase64(contentBase64: string) {
  const binary = window.atob(contentBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function buildPageWindow(currentPage: number, totalPages: number, visibleCount = 6) {
  const safeTotal = Math.max(totalPages, 1);
  const safeCurrent = Math.min(Math.max(currentPage, 1), safeTotal);
  const halfWindow = Math.floor(visibleCount / 2);
  let start = Math.max(1, safeCurrent - halfWindow);
  const end = Math.min(safeTotal, start + visibleCount - 1);
  start = Math.max(1, end - visibleCount + 1);

  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function getEntityVisualKind(entidad: Entidad) {
  const normalized = entidad.nombre_comercial.toLowerCase();
  if (
    normalized.includes("casa") ||
    normalized.includes("villa") ||
    normalized.includes("home") ||
    normalized.includes("residencia")
  ) {
    return "house";
  }

  if (entidad.espacios_total > 0 && entidad.espacios_total <= 6) {
    return "house";
  }

  return "building";
}

function EntityVisual({ entidad }: { entidad: Entidad }) {
  const visualKind = getEntityVisualKind(entidad);
  const total = Math.max(entidad.espacios_total || 0, 1);
  const occupiedRatio = Math.min(
    Math.max((entidad.espacios_ocupados || 0) / total, 0),
    1
  );

  return (
    <div className="relative overflow-hidden rounded-xl border border-zinc-800/80 bg-gradient-to-br from-zinc-900 via-zinc-950 to-zinc-900 p-3 text-left transition-colors group-hover:border-zinc-700">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.14),transparent_38%),radial-gradient(circle_at_bottom_left,rgba(59,130,246,0.18),transparent_34%)]" />
      <div className="relative flex items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-cyan-300/80">
            Resumen visual
          </p>
          <p className="mt-1.5 max-w-[170px] text-xs leading-relaxed text-zinc-400">
            {visualKind === "house"
              ? "Vista tipo casa para operacion compacta."
              : "Vista tipo edificio para operacion multi-espacio."}
          </p>
        </div>

        <svg
          viewBox="0 0 160 120"
          className="h-24 w-32 shrink-0"
          aria-hidden="true"
        >
          {visualKind === "house" ? (
            <>
              <path
                d="M18 64L80 18l62 46"
                fill="none"
                stroke="#93c5fd"
                strokeWidth="6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <rect x="32" y="58" width="96" height="44" rx="8" fill="#18181b" />
              <rect x="69" y="70" width="22" height="32" rx="3" fill="#3f3f46" />
              <rect x="44" y="70" width="16" height="14" rx="2" fill="#38bdf8" />
              <rect x="100" y="70" width="16" height="14" rx="2" fill="#38bdf8" />
            </>
          ) : (
            <>
              <rect x="34" y="16" width="64" height="88" rx="8" fill="#18181b" />
              <rect x="84" y="28" width="42" height="76" rx="8" fill="#27272a" />
              <rect x="52" y="82" width="18" height="22" rx="3" fill="#3f3f46" />
              {[
                [48, 30],
                [74, 30],
                [48, 50],
                [74, 50],
                [48, 70],
                [74, 70],
                [94, 40],
                [94, 58],
                [94, 76],
              ].map(([x, y]) => (
                <rect
                  key={`${x}-${y}`}
                  x={x}
                  y={y}
                  width="12"
                  height="10"
                  rx="2"
                  fill="#60a5fa"
                />
              ))}
            </>
          )}
        </svg>
      </div>

      <div className="relative mt-3">
        <div className="h-2 rounded-full bg-zinc-800">
          <div
            className="h-2 rounded-full bg-gradient-to-r from-emerald-400 to-cyan-400"
            style={{ width: `${occupiedRatio * 100}%` }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between text-xs text-zinc-500">
          <span>{entidad.espacios_ocupados || 0} ocupados</span>
          <span>{entidad.espacios_total || 0} totales</span>
        </div>
      </div>
    </div>
  );
}

function EntityActionIcon({ kind }: { kind: EntityActionKind }) {
  const className = "h-4 w-4 stroke-current";

  if (kind === "summary") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className={className}>
        <path
          d="M3.5 12s3-5 8.5-5 8.5 5 8.5 5-3 5-8.5 5-8.5-5-8.5-5Z"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <circle cx="12" cy="12" r="2.5" strokeWidth="1.8" />
      </svg>
    );
  }

  if (kind === "manage") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className={className}>
        <path d="M4 7h16" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M4 12h10" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M4 17h7" strokeWidth="1.8" strokeLinecap="round" />
        <path
          d="m16 16 2 2 3-4"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (kind === "status") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className={className}>
        <path
          d="M8 6.5h8a5.5 5.5 0 0 1 0 11H8a5.5 5.5 0 0 1 0-11Z"
          strokeWidth="1.8"
        />
        <circle cx="8.5" cy="12" r="2.2" strokeWidth="1.8" />
      </svg>
    );
  }

  if (kind === "clone") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className={className}>
        <rect x="8" y="8" width="11" height="11" rx="2" strokeWidth="1.8" />
        <path
          d="M5 15.5V6.5A1.5 1.5 0 0 1 6.5 5h9"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (kind === "edit") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className={className}>
        <path
          d="M5 18.5h4.2L18.5 9.2a2 2 0 0 0 0-2.8l-.9-.9a2 2 0 0 0-2.8 0L5 15.3v3.2Z"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path d="m13.5 6.8 3.7 3.7" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M5 7h14" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M10 11v6" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M14 11v6" strokeWidth="1.8" strokeLinecap="round" />
      <path
        d="M8 7V5.5A1.5 1.5 0 0 1 9.5 4h5A1.5 1.5 0 0 1 16 5.5V7"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M7 7l.7 13h8.6L17 7" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function EntityActionButton({
  label,
  icon,
  tone = "default",
  onClick,
}: {
  label: string;
  icon: EntityActionKind;
  tone?: "default" | "accent" | "warning" | "danger" | "success";
  onClick: () => void;
}) {
  const toneClass =
    tone === "danger"
      ? "border-red-500/25 bg-red-500/10 text-red-200 hover:bg-red-500/15"
      : tone === "warning"
        ? "border-amber-500/25 bg-amber-500/10 text-amber-200 hover:bg-amber-500/15"
        : tone === "success"
          ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/15"
          : tone === "accent"
            ? "border-cyan-500/25 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20"
            : "border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800";

  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border transition-colors ${toneClass}`}
    >
      <EntityActionIcon kind={icon} />
    </button>
  );
}

export default function EntidadesManager() {
  const router = useRouter();

  const [entidades, setEntidades] = useState<Entidad[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [mensajeExito, setMensajeExito] = useState("");
  const [entidadEnEdicion, setEntidadEnEdicion] = useState<Entidad | null>(null);
  const [modalBorrado, setModalBorrado] = useState<DeleteModalState>({
    isOpen: false,
    id: null,
    nombre: "",
  });
  const [modalEstatus, setModalEstatus] = useState<StatusModalState>({
    isOpen: false,
    entidad: null,
  });
  const [modalResumen, setModalResumen] = useState<SummaryModalState>({
    isOpen: false,
    entidad: null,
  });
  const [fechaPausa, setFechaPausa] = useState(getToday());
  const [searchQuery, setSearchQuery] = useState("");
  const [filtroEstatus, setFiltroEstatus] = useState("Todas");
  const [ordenEntidades, setOrdenEntidades] = useState("nombre_asc");
  const [paginaActual, setPaginaActual] = useState(1);
  const [itemsPorPagina, setItemsPorPagina] = useState(25);
  const [pageJumpValue, setPageJumpValue] = useState("1");
  const [batchFile, setBatchFile] = useState<File | null>(null);
  const [batchInputKey, setBatchInputKey] = useState(0);
  const [batchError, setBatchError] = useState("");
  const [batchResult, setBatchResult] = useState<BatchImportResult | null>(null);
  const [isDownloadingTemplate, setIsDownloadingTemplate] = useState(false);
  const [isBatchImporting, setIsBatchImporting] = useState(false);
  const [mostrarBatch, setMostrarBatch] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("cards");

  const hasBatchErrorReport = Boolean(batchResult?.archivo_errores_base64);
  const batchErrorRows = batchResult?.errores_total ?? batchResult?.filas_omitidas ?? 0;

  const showSuccess = (message: string) => {
    setMensajeExito(message);
    window.setTimeout(() => setMensajeExito(""), 3200);
  };

  const fetchEntidades = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`${EMPRESAS_API_BASE}/lista/`, {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error("No se pudieron cargar las entidades.");
      }
      const data = (await response.json()) as Entidad[];
      setEntidades(data);
    } catch (error) {
      console.error("Error cargando entidades:", error);
      alert("No se pudieron cargar las entidades.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void fetchEntidades();
  }, []);

  useEffect(() => {
    if (batchResult) {
      setMostrarBatch(true);
    }
  }, [batchResult]);

  const entidadesFiltradas = useMemo(() => {
    const filtered = entidades.filter((entidad) => {
      const query = searchQuery.trim().toLowerCase();
      const coincideBusqueda =
        !query ||
        entidad.nombre_comercial.toLowerCase().includes(query) ||
        (entidad.rfc || "").toLowerCase().includes(query) ||
        (entidad.ciudad || "").toLowerCase().includes(query);

      if (!coincideBusqueda) {
        return false;
      }
      if (filtroEstatus === "Activas" && !entidad.activo) {
        return false;
      }
      if (filtroEstatus === "Inactivas" && entidad.activo) {
        return false;
      }
      return true;
    });

    return [...filtered].sort((first, second) => {
      const firstTotal = first.espacios_total || 0;
      const secondTotal = second.espacios_total || 0;
      const firstOccupation =
        firstTotal > 0 ? (first.espacios_ocupados || 0) / firstTotal : 0;
      const secondOccupation =
        secondTotal > 0 ? (second.espacios_ocupados || 0) / secondTotal : 0;

      if (ordenEntidades === "nombre_desc") {
        return second.nombre_comercial.localeCompare(first.nombre_comercial, "es");
      }
      if (ordenEntidades === "facturacion_desc") {
        return (second.facturacion_activa || 0) - (first.facturacion_activa || 0);
      }
      if (ordenEntidades === "facturacion_asc") {
        return (first.facturacion_activa || 0) - (second.facturacion_activa || 0);
      }
      if (ordenEntidades === "cxp_desc") {
        return (second.cxp_abierta || 0) - (first.cxp_abierta || 0);
      }
      if (ordenEntidades === "cxp_asc") {
        return (first.cxp_abierta || 0) - (second.cxp_abierta || 0);
      }
      if (ordenEntidades === "ocupacion_desc") {
        return secondOccupation - firstOccupation;
      }
      if (ordenEntidades === "ocupacion_asc") {
        return firstOccupation - secondOccupation;
      }
      if (ordenEntidades === "espacios_desc") {
        return secondTotal - firstTotal;
      }
      if (ordenEntidades === "espacios_asc") {
        return firstTotal - secondTotal;
      }
      return first.nombre_comercial.localeCompare(second.nombre_comercial, "es");
    });
  }, [entidades, filtroEstatus, ordenEntidades, searchQuery]);

  const totalPaginas = Math.max(
    1,
    Math.ceil(entidadesFiltradas.length / itemsPorPagina)
  );

  useEffect(() => {
    if (paginaActual > totalPaginas) {
      setPaginaActual(totalPaginas);
    }
  }, [paginaActual, totalPaginas]);

  useEffect(() => {
    setPageJumpValue(String(paginaActual || 1));
  }, [paginaActual]);

  const indiceUltimoItem = paginaActual * itemsPorPagina;
  const indicePrimerItem = indiceUltimoItem - itemsPorPagina;
  const entidadesPaginadas = entidadesFiltradas.slice(
    indicePrimerItem,
    indiceUltimoItem
  );
  const pageWindow = buildPageWindow(paginaActual, totalPaginas);
  const hayFiltrosActivos =
    searchQuery.trim().length > 0 ||
    filtroEstatus !== "Todas" ||
    ordenEntidades !== "nombre_asc";

  const handlePageJump = () => {
    const targetPage = Number.parseInt(pageJumpValue, 10);
    if (!Number.isFinite(targetPage)) return;
    setPaginaActual(Math.min(Math.max(targetPage, 1), totalPaginas));
  };

  const limpiarFiltros = () => {
    setSearchQuery("");
    setFiltroEstatus("Todas");
    setOrdenEntidades("nombre_asc");
    setPaginaActual(1);
  };

  const handleRegistroExitoso = () => {
    setIsModalOpen(false);
    setEntidadEnEdicion(null);
    void fetchEntidades();
    showSuccess("Entidad guardada correctamente.");
  };

  const handleNuevaEntidad = () => {
    setEntidadEnEdicion(null);
    setIsModalOpen(true);
  };

  const handleEditar = (entidad: Entidad) => {
    setEntidadEnEdicion(entidad);
    setIsModalOpen(true);
  };

  const iniciarCambioEstatus = (entidad: Entidad) => {
    setModalEstatus({ isOpen: true, entidad });
    setFechaPausa(entidad.fecha_pausa || getToday());
  };

  const abrirResumen = (entidad: Entidad) => {
    setModalResumen({ isOpen: true, entidad });
  };

  const confirmarCambioEstatus = async () => {
    const entidad = modalEstatus.entidad;
    if (!entidad) {
      return;
    }

    try {
      const payload = {
        nombre_comercial: entidad.nombre_comercial,
        ciudad: entidad.ciudad || "",
        rfc: entidad.rfc || "",
        regimen_fiscal: entidad.regimen_fiscal || "",
        tipo_fecha_corte: entidad.tipo_fecha_corte,
        activo: !entidad.activo,
        fecha_pausa: entidad.activo ? fechaPausa : null,
      };

      const response = await fetch(`${EMPRESAS_API_BASE}/${entidad.id}/`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error("No se pudo actualizar el estatus.");
      }

      await fetchEntidades();
      showSuccess(
        entidad.activo
          ? "Cobranza automatizada pausada."
          : "Entidad reactivada."
      );
    } catch (error) {
      console.error("Error actualizando estatus:", error);
      alert("Error al cambiar el estatus de la entidad.");
    } finally {
      setModalEstatus({ isOpen: false, entidad: null });
    }
  };

  const handleClonar = async (entidad: Entidad) => {
    try {
      const payload = {
        nombre_comercial: `${entidad.nombre_comercial} (Copia)`,
        ciudad: entidad.ciudad || "",
        rfc: entidad.rfc || "",
        regimen_fiscal: entidad.regimen_fiscal || "",
        tipo_fecha_corte: entidad.tipo_fecha_corte,
        activo: false,
      };

      const response = await fetch(`${EMPRESAS_API_BASE}/crear/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error("No se pudo clonar la entidad.");
      }

      await fetchEntidades();
      showSuccess("Entidad clonada correctamente.");
    } catch (error) {
      console.error("Error clonando entidad:", error);
      alert("Error al clonar la entidad.");
    }
  };

  const iniciarBorrado = (id: number, nombre: string) => {
    setModalBorrado({ isOpen: true, id, nombre });
  };

  const confirmarBorrado = async () => {
    if (!modalBorrado.id) {
      return;
    }

    try {
      const response = await fetch(`${EMPRESAS_API_BASE}/${modalBorrado.id}/`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("No se pudo eliminar la entidad.");
      }

      await fetchEntidades();
      showSuccess("Entidad eliminada correctamente.");
    } catch (error) {
      console.error("Error borrando entidad:", error);
      alert("Error al eliminar la entidad.");
    } finally {
      setModalBorrado({ isOpen: false, id: null, nombre: "" });
    }
  };

  const handleDownloadTemplate = async () => {
    setIsDownloadingTemplate(true);
    setBatchError("");

    try {
      const response = await fetch(`${EMPRESAS_API_BASE}/batch/plantilla/`);
      if (!response.ok) {
        throw new Error("No se pudo descargar la plantilla.");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = extractFilename(
        response.headers.get("content-disposition"),
        "plantilla-entidades-espacios.xlsx"
      );
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Error descargando plantilla:", error);
      setBatchError("No se pudo descargar la plantilla batch.");
    } finally {
      setIsDownloadingTemplate(false);
    }
  };

  const handleImportBatch = async () => {
    if (!batchFile) {
      setBatchError("Selecciona un archivo .xlsx, .xlsm o .csv antes de importar.");
      return;
    }

    setIsBatchImporting(true);
    setBatchError("");
    setBatchResult(null);

    try {
      const formData = new FormData();
      formData.append("file", batchFile);

      const response = await fetch(`${EMPRESAS_API_BASE}/batch/importar/`, {
        method: "POST",
        body: formData,
      });

      const body = (await response.json()) as BatchImportResult | { detail?: string };
      if (!response.ok) {
        throw new Error(getErrorMessage(body, "No se pudo importar el archivo."));
      }

      setBatchResult(body as BatchImportResult);
      setBatchFile(null);
      setBatchInputKey((current) => current + 1);
      await fetchEntidades();
      showSuccess(
        (body as BatchImportResult).filas_omitidas
          ? "Carga batch parcial completada."
          : "Carga batch completada."
      );
    } catch (error) {
      console.error("Error importando batch:", error);
      setBatchError(
        error instanceof Error ? error.message : "No se pudo importar el archivo."
      );
    } finally {
      setIsBatchImporting(false);
    }
  };

  const handleDownloadBatchErrors = () => {
    if (!batchResult?.archivo_errores_base64) {
      setBatchError("No hay archivo de errores disponible para esta carga.");
      return;
    }

    try {
      const blob = buildXlsxBlobFromBase64(batchResult.archivo_errores_base64);
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download =
        batchResult.archivo_errores_nombre || "errores-importacion-batch.xlsx";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Error descargando errores batch:", error);
      setBatchError("No se pudo descargar el archivo de errores.");
    }
  };

  return (
    <div className="relative space-y-4">
      {mensajeExito && (
        <div className="fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-lg border border-green-500/50 bg-green-500/20 px-4 py-2 text-green-400 shadow-lg">
          <span className="text-sm font-medium">{mensajeExito}</span>
        </div>
      )}

      {isBatchImporting ? (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/75 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-3xl border border-cyan-500/20 bg-zinc-950 p-6 text-center shadow-2xl shadow-cyan-950/40">
            <div className="mx-auto h-12 w-12 animate-spin rounded-full border-2 border-cyan-400/20 border-t-cyan-300" />
            <p className="mt-4 text-lg font-semibold text-white">
              Procesando carga batch
            </p>
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">
              Estamos validando unidades de negocio, espacios, clientes y rentas.
              Mantente en esta pantalla hasta que el servidor responda.
            </p>
          </div>
        </div>
      ) : null}

      {modalEstatus.isOpen && modalEstatus.entidad && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-sm rounded-xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl">
            <h3 className="mb-2 text-xl font-bold text-white">
              {modalEstatus.entidad.activo ? "Pausar operacion" : "Activar entidad"}
            </h3>

            <div className="mb-6 space-y-4 text-sm text-zinc-400">
              <p>
                Estas por{" "}
                <span className="font-semibold text-white">
                  {modalEstatus.entidad.activo ? "pausar" : "activar"}
                </span>{" "}
                a{" "}
                <span className="font-semibold text-white">
                  {modalEstatus.entidad.nombre_comercial}
                </span>
                .
              </p>

              {modalEstatus.entidad.activo ? (
                <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3">
                  <p className="mb-3 text-xs text-amber-300">
                    La fecha sirve para cortar automatizaciones y referencias futuras.
                  </p>
                  <label className="mb-1 block text-xs font-medium text-zinc-200">
                    Fecha de suspension
                  </label>
                  <input
                    type="date"
                    value={fechaPausa}
                    onChange={(event) => setFechaPausa(event.target.value)}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-900 p-2 text-sm text-white outline-none focus:ring-1 focus:ring-amber-500"
                  />
                </div>
              ) : (
                <p className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs text-emerald-300">
                  La entidad volvera a evaluarse en los procesos operativos y de
                  cobranza.
                </p>
              )}
            </div>

            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setModalEstatus({ isOpen: false, entidad: null })}
                className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white"
              >
                Cancelar
              </button>
              <button
                onClick={confirmarCambioEstatus}
                className={`rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors ${
                  modalEstatus.entidad.activo
                    ? "bg-amber-600 hover:bg-amber-500"
                    : "bg-emerald-600 hover:bg-emerald-500"
                }`}
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {modalBorrado.isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-sm rounded-xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl">
            <h3 className="mb-2 text-xl font-bold text-white">Eliminar entidad</h3>
            <p className="mb-6 text-sm text-zinc-400">
              Se eliminara{" "}
              <span className="font-semibold text-white">{modalBorrado.nombre}</span>{" "}
              junto con sus clientes, reglas y espacios relacionados.
            </p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() =>
                  setModalBorrado({ isOpen: false, id: null, nombre: "" })
                }
                className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white"
              >
                Cancelar
              </button>
              <button
                onClick={confirmarBorrado}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-500"
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950/70">
        <button
          type="button"
          onClick={() => setMostrarBatch((current) => !current)}
          className="flex w-full items-start justify-between gap-4 px-4 py-4 text-left transition-colors hover:bg-zinc-900/40"
        >
          <div className="max-w-3xl">
            <p className="text-xs uppercase tracking-[0.2em] text-cyan-300/80">
              Carga batch
            </p>
            <h2 className="mt-1.5 text-lg font-semibold text-white">
              Importa entidades, espacios, clientes y rentas desde Excel
            </h2>

            {!mostrarBatch && (
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                {batchFile && (
                  <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-emerald-200">
                    Archivo listo: {batchFile.name}
                  </span>
                )}
                {batchResult && (
                  <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-1 text-cyan-200">
                    Ultima carga: {batchResult.total_filas} filas procesadas
                  </span>
                )}
                {hasBatchErrorReport && (
                  <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-amber-200">
                    {batchErrorRows} por corregir
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            <span className="hidden rounded-full border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-xs font-medium text-zinc-300 sm:inline-flex">
              {mostrarBatch ? "Ocultar" : "Mostrar"}
            </span>
            <span
              className={`inline-flex h-9 w-9 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900 text-zinc-300 transition-transform ${
                mostrarBatch ? "rotate-180" : ""
              }`}
            >
              <svg
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </span>
          </div>
        </button>

        {mostrarBatch && (
          <div className="border-t border-zinc-800 px-4 pb-4 pt-1">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div className="max-w-2xl">
                <p className="mt-3 text-sm text-zinc-500">
                  Este flujo esta pensado para inventario real: una fila por
                  espacio, con su entidad, ubicacion, precio individual y ocupante
                  actual. Si cada habitacion o depto tiene una renta distinta, usa
                  este batch en lugar de cargarlo a mano o depender de una
                  generacion masiva con el mismo monto.
                </p>

                <div className="mt-3 grid grid-cols-1 gap-2.5 md:grid-cols-3">
                  <div className="page-section-tight">
                    <p className="text-sm font-medium text-white">1. Descarga</p>
                    <p className="mt-1 text-xs text-zinc-500">
                      Baja la plantilla lista para llenar.
                    </p>
                  </div>
                  <div className="page-section-tight">
                    <p className="text-sm font-medium text-white">2. Llena</p>
                    <p className="mt-1 text-xs text-zinc-500">
                      Una fila por espacio con precio, cliente y corte si aplica.
                    </p>
                  </div>
                  <div className="page-section-tight">
                    <p className="text-sm font-medium text-white">3. Importa</p>
                    <p className="mt-1 text-xs text-zinc-500">
                      BetterP procesa lo valido y devuelve un archivo con filas por corregir.
                    </p>
                  </div>
                </div>
              </div>

              <div className="page-section-tight w-full max-w-xl">
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  <button
                    onClick={() => void handleDownloadTemplate()}
                    disabled={isDownloadingTemplate || isBatchImporting}
                    className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-4 py-2.5 text-sm font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isDownloadingTemplate ? "Descargando..." : "Descargar plantilla"}
                  </button>

                  <button
                    onClick={() => void handleImportBatch()}
                    disabled={!batchFile || isBatchImporting}
                    className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isBatchImporting ? "Importando..." : "Importar archivo"}
                  </button>
                </div>

                <div className="mt-3">
                  <label className="mb-1 block text-sm font-medium text-zinc-300">
                    Archivo batch
                  </label>
                  <input
                    key={batchInputKey}
                    type="file"
                    accept=".xlsx,.xlsm,.csv"
                    disabled={isBatchImporting}
                    onChange={(event) => {
                      const selected = event.target.files?.[0] || null;
                      setBatchFile(selected);
                      setBatchError("");
                      setBatchResult(null);
                    }}
                    className="block w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-zinc-300 file:mr-4 file:rounded-md file:border-0 file:bg-zinc-800 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-zinc-700"
                  />
                  <p className="mt-2 text-xs text-zinc-500">
                    Compatible con archivos .xlsx, .xlsm y .csv.
                  </p>
                </div>

                {batchError && (
                  <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                    {batchError}
                  </div>
                )}

                {hasBatchErrorReport && (
                  <div className="mt-3 rounded-xl border border-amber-500/25 bg-amber-500/10 p-3">
                    <p className="text-sm font-semibold text-amber-100">
                      Hay filas listas para corregir
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-amber-100/80">
                      Descarga el mismo archivo con las filas rechazadas, corrige la
                      informacion indicada en Comentario de error y vuelve a
                      subirlo aqui.
                    </p>
                    <button
                      type="button"
                      onClick={handleDownloadBatchErrors}
                      className="mt-3 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs font-semibold text-amber-100 transition hover:bg-amber-400/20"
                    >
                      Descargar errores ({batchErrorRows})
                    </button>
                  </div>
                )}
              </div>
            </div>

            {batchResult && (
              <div className="page-section-soft mt-4">
                <div
                  className={`mb-4 rounded-xl border px-4 py-3 ${
                    batchResult.filas_omitidas
                      ? "border-amber-500/25 bg-amber-500/10 text-amber-100"
                      : "border-emerald-500/25 bg-emerald-500/10 text-emerald-100"
                  }`}
                >
                  <p className="text-sm font-semibold">
                    {batchResult.filas_omitidas
                      ? "Carga parcial procesada"
                      : "Carga procesada sin errores"}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed opacity-85">
                    {batchResult.filas_omitidas
                      ? `Se importaron las filas validas y ${batchResult.filas_omitidas} fila(s) quedaron en el archivo de correccion.`
                      : "Todas las filas validas del archivo fueron procesadas."}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4 xl:grid-cols-6">
                  <div className="metric-card-compact border-zinc-800 bg-zinc-950/70">
                    <p className="metric-label-compact">Filas</p>
                    <p className="metric-value-compact">
                      {batchResult.total_filas}
                    </p>
                  </div>
                  <div className="metric-card-compact border-zinc-800 bg-zinc-950/70">
                    <p className="metric-label-compact">Entidades nuevas</p>
                    <p className="metric-value-compact">
                      {batchResult.entidades_creadas}
                    </p>
                  </div>
                  <div className="metric-card-compact border-zinc-800 bg-zinc-950/70">
                    <p className="metric-label-compact">
                      Entidades actualizadas
                    </p>
                    <p className="metric-value-compact">
                      {batchResult.entidades_actualizadas}
                    </p>
                  </div>
                  <div className="metric-card-compact border-zinc-800 bg-zinc-950/70">
                    <p className="metric-label-compact">Tipos creados</p>
                    <p className="metric-value-compact">
                      {batchResult.tipos_creados}
                    </p>
                  </div>
                  <div className="metric-card-compact border-zinc-800 bg-zinc-950/70">
                    <p className="metric-label-compact">Espacios nuevos</p>
                    <p className="metric-value-compact">
                      {batchResult.espacios_creados}
                    </p>
                  </div>
                  <div className="metric-card-compact border-zinc-800 bg-zinc-950/70">
                    <p className="metric-label-compact">
                      Espacios actualizados
                    </p>
                    <p className="metric-value-compact">
                      {batchResult.espacios_actualizados}
                    </p>
                  </div>
                  <div className="metric-card-compact border-zinc-800 bg-zinc-950/70">
                    <p className="metric-label-compact">Clientes nuevos</p>
                    <p className="metric-value-compact">
                      {batchResult.clientes_creados || 0}
                    </p>
                  </div>
                  <div className="metric-card-compact border-zinc-800 bg-zinc-950/70">
                    <p className="metric-label-compact">
                      Clientes actualizados
                    </p>
                    <p className="metric-value-compact">
                      {batchResult.clientes_actualizados || 0}
                    </p>
                  </div>
                  <div className="metric-card-compact border-zinc-800 bg-zinc-950/70">
                    <p className="metric-label-compact">
                      Asignaciones nuevas
                    </p>
                    <p className="metric-value-compact">
                      {batchResult.asignaciones_creadas || 0}
                    </p>
                  </div>
                  <div className="metric-card-compact border-zinc-800 bg-zinc-950/70">
                    <p className="metric-label-compact">
                      Asignaciones actualizadas
                    </p>
                    <p className="metric-value-compact">
                      {batchResult.asignaciones_actualizadas || 0}
                    </p>
                  </div>
                  <div className="metric-card-compact border-zinc-800 bg-zinc-950/70">
                    <p className="metric-label-compact">
                      Asignaciones reemplazadas
                    </p>
                    <p className="metric-value-compact">
                      {batchResult.asignaciones_reemplazadas || 0}
                    </p>
                  </div>
                  <div className="metric-card-compact border-zinc-800 bg-zinc-950/70">
                    <p className="metric-label-compact">
                      Asignaciones finalizadas
                    </p>
                    <p className="metric-value-compact">
                      {batchResult.asignaciones_finalizadas || 0}
                    </p>
                  </div>
                  <div className="metric-card-compact border-zinc-800 bg-zinc-950/70">
                    <p className="metric-label-compact">Filas omitidas</p>
                    <p className="metric-value-compact">
                      {batchResult.filas_omitidas}
                    </p>
                  </div>
                  <div className="metric-card-compact border-zinc-800 bg-zinc-950/70">
                    <p className="metric-label-compact">CxC nuevas</p>
                    <p className="metric-value-compact">
                      {batchResult.cxc_creadas || 0}
                    </p>
                  </div>
                </div>

                {batchResult.errores.length > 0 && (
                  <div className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-sm font-semibold text-amber-200">
                          Filas con observaciones
                        </p>
                        <p className="mt-1 text-xs text-amber-100/75">
                          Se muestran los primeros avisos. El Excel descargable trae
                          todas las filas rechazadas con su comentario.
                        </p>
                      </div>
                      {hasBatchErrorReport && (
                        <button
                          type="button"
                          onClick={handleDownloadBatchErrors}
                          className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs font-semibold text-amber-100 transition hover:bg-amber-400/20"
                        >
                          Descargar archivo corregible
                        </button>
                      )}
                    </div>
                    <div className="mt-3 space-y-2 text-sm text-amber-100/90">
                      {batchResult.errores.map((error) => (
                        <p key={error}>{error}</p>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
        <div className="grid gap-3 md:grid-cols-[minmax(180px,0.8fr)_170px_180px_160px_210px_320px]">
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-[0.18em] text-zinc-500">
              Búsqueda
            </span>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-zinc-500">
                <svg
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
              </span>
              <input
                type="text"
                placeholder="Nombre, ciudad o RFC..."
                className="w-full rounded-lg border border-zinc-800 bg-zinc-900 py-2 pl-9 pr-4 text-sm text-white outline-none focus:ring-1 focus:ring-blue-500"
                value={searchQuery}
                onChange={(event) => {
                  setSearchQuery(event.target.value);
                  setPaginaActual(1);
                }}
              />
            </div>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-[0.18em] text-zinc-500">
              Estatus
            </span>
            <select
              className="w-full cursor-pointer rounded-lg border border-zinc-800 bg-zinc-900 py-2 pl-3 pr-8 text-sm text-zinc-300 outline-none focus:ring-1 focus:ring-blue-500"
              value={filtroEstatus}
              onChange={(event) => {
                setFiltroEstatus(event.target.value);
                setPaginaActual(1);
              }}
            >
              <option value="Todas">Todas</option>
              <option value="Activas">Solo activas</option>
              <option value="Inactivas">Solo inactivas</option>
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-[0.18em] text-zinc-500">
              Orden
            </span>
            <select
              className="w-full cursor-pointer rounded-lg border border-zinc-800 bg-zinc-900 py-2 pl-3 pr-8 text-sm text-zinc-300 outline-none focus:ring-1 focus:ring-blue-500"
              value={ordenEntidades}
              onChange={(event) => {
                setOrdenEntidades(event.target.value);
                setPaginaActual(1);
              }}
            >
              <option value="nombre_asc">Nombre A-Z</option>
              <option value="nombre_desc">Nombre Z-A</option>
              <option value="facturacion_desc">Facturación mayor</option>
              <option value="facturacion_asc">Facturación menor</option>
              <option value="cxp_desc">CxP abierta mayor</option>
              <option value="cxp_asc">CxP abierta menor</option>
              <option value="ocupacion_desc">Ocupación mayor</option>
              <option value="ocupacion_asc">Ocupación menor</option>
              <option value="espacios_desc">Más espacios</option>
              <option value="espacios_asc">Menos espacios</option>
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-[0.18em] text-zinc-500">
              Filas
            </span>
            <select
              className="w-full cursor-pointer rounded-lg border border-zinc-800 bg-zinc-900 py-2 pl-3 pr-8 text-sm text-zinc-300 outline-none focus:ring-1 focus:ring-blue-500"
              value={itemsPorPagina}
              onChange={(event) => {
                setItemsPorPagina(Number.parseInt(event.target.value, 10) || 25);
                setPaginaActual(1);
              }}
            >
              <option value={25}>25 por página</option>
              <option value={40}>40 por página</option>
              <option value={60}>60 por página</option>
              <option value={80}>80 por página</option>
              <option value={100}>100 por página</option>
            </select>
          </label>

          <div>
            <span className="mb-1 block text-xs uppercase tracking-[0.18em] text-zinc-500">
              Vista
            </span>
            <div className="grid grid-cols-2 rounded-lg border border-zinc-800 bg-zinc-950 p-1">
              <button
                type="button"
                onClick={() => setViewMode("cards")}
                className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  viewMode === "cards"
                    ? "bg-blue-600 text-white"
                    : "text-zinc-400 hover:bg-zinc-900 hover:text-white"
                }`}
              >
                Tarjetas
              </button>
              <button
                type="button"
                onClick={() => setViewMode("table")}
                className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  viewMode === "table"
                    ? "bg-blue-600 text-white"
                    : "text-zinc-400 hover:bg-zinc-900 hover:text-white"
                }`}
              >
                Tabla
              </button>
            </div>
          </div>

          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={limpiarFiltros}
              disabled={!hayFiltrosActivos}
              className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Limpiar
            </button>
            <button
              type="button"
              onClick={handleNuevaEntidad}
              className="flex-1 whitespace-nowrap rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-blue-500/20 transition-colors hover:bg-blue-500"
            >
              Nueva entidad
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
          <span className="rounded-full border border-zinc-800 bg-zinc-900 px-2.5 py-1">
            {entidadesFiltradas.length} unidades encontradas
          </span>
          <span className="rounded-full border border-zinc-800 bg-zinc-900 px-2.5 py-1">
            Página {paginaActual} de {totalPaginas}
          </span>
          {hayFiltrosActivos ? (
            <span className="rounded-full border border-blue-500/20 bg-blue-500/10 px-2.5 py-1 text-blue-200">
              Filtros activos
            </span>
          ) : null}
        </div>
      </div>

      {isLoading ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 py-12 text-center text-zinc-500">
          Cargando unidades de negocio...
        </div>
      ) : entidadesFiltradas.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 py-12 text-center text-zinc-500">
          No se encontraron entidades con esos filtros.
        </div>
      ) : (
        <>
          {viewMode === "cards" ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {entidadesPaginadas.map((entidad, index) => (
              <div
                key={entidad.id}
                className="group relative flex flex-col overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-950/80 shadow-lg transition-all hover:-translate-y-0.5 hover:border-zinc-700 hover:shadow-xl"
              >
                <div
                  className={`h-1.5 w-full ${cardColors[index % cardColors.length]}`}
                />

                <div className="absolute right-4 top-4 z-10 flex space-x-1.5 rounded-lg border border-zinc-800/80 bg-zinc-950/90 p-1 opacity-0 shadow-lg backdrop-blur-md transition-opacity group-hover:opacity-100">
                  <button
                    title="Clonar"
                    onClick={() => void handleClonar(entidad)}
                    className="rounded-md bg-blue-500/10 p-1.5 text-blue-300 transition-colors hover:bg-blue-500/20 hover:text-blue-200"
                  >
                    <svg
                      className="h-4 w-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                      />
                    </svg>
                  </button>
                  <button
                    title="Editar"
                    onClick={() => handleEditar(entidad)}
                    className="rounded-md bg-amber-500/10 p-1.5 text-amber-300 transition-colors hover:bg-amber-500/20 hover:text-amber-200"
                  >
                    <svg
                      className="h-4 w-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                      />
                    </svg>
                  </button>
                  <button
                    title="Eliminar"
                    onClick={() => iniciarBorrado(entidad.id, entidad.nombre_comercial)}
                    className="rounded-md bg-red-500/10 p-1.5 text-red-300 transition-colors hover:bg-red-500/20 hover:text-red-200"
                  >
                    <svg
                      className="h-4 w-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                      />
                    </svg>
                  </button>
                </div>

                <div className="flex flex-1 flex-col p-4">
                  <div className="mb-4 pr-20">
                    <h2 className="text-xl font-bold leading-tight text-white">
                      {entidad.nombre_comercial}
                    </h2>
                    <p className="mt-1 text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                      {entidad.rfc || "Sin RFC registrado"}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => abrirResumen(entidad)}
                    className="mb-5 block w-full"
                  >
                    <EntityVisual entidad={entidad} />
                  </button>

                  <div className="mb-4 space-y-2.5">
                    <div className="flex items-center justify-between rounded-lg border border-zinc-800/60 bg-zinc-900/60 p-3 transition-colors group-hover:border-zinc-700/60">
                      <div>
                        <p className="mb-1 text-xs text-zinc-500">Ciudad</p>
                        <p className="text-sm font-medium text-zinc-200">
                          {entidad.ciudad || "Sin ciudad"}
                        </p>
                      </div>
                      <div className="border-l border-zinc-800/60 pl-3 text-right">
                        <p className="mb-1 text-xs text-zinc-500">Facturacion</p>
                        <p className="text-sm font-medium text-emerald-300">
                          {formatCurrency(entidad.facturacion_activa || 0)}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between rounded-lg border border-zinc-800/60 bg-zinc-900/60 p-3 transition-colors group-hover:border-zinc-700/60">
                      <div>
                        <p className="mb-1 text-xs text-zinc-500">Operacion</p>
                        <p className="text-sm font-medium text-zinc-200">
                          {entidad.espacios_total || 0} espacios -{" "}
                          {entidad.clientes_count || 0} clientes
                        </p>
                      </div>
                      <div className="border-l border-zinc-800/60 pl-3 text-right">
                        <p className="mb-1 text-xs text-zinc-500">Disponibles</p>
                        <p className="text-sm font-medium text-blue-300">
                          {entidad.espacios_disponibles || 0}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between rounded-lg border border-zinc-800/60 bg-zinc-900/60 p-3 transition-colors group-hover:border-zinc-700/60">
                      <div>
                        <p className="mb-1 text-xs text-zinc-500">Cobertura</p>
                        <p className="text-sm font-medium text-zinc-200">
                          {entidad.espacios_ocupados || 0} ocupados -{" "}
                          {entidad.espacios_mantenimiento || 0} mantenimiento
                        </p>
                      </div>
                      <div className="border-l border-zinc-800/60 pl-3 text-right">
                        <p className="mb-1 text-xs text-zinc-500">Corte</p>
                        <p className="text-sm font-medium text-zinc-200">
                          {entidad.tipo_fecha_corte}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between rounded-lg border border-violet-500/20 bg-violet-500/10 p-3 transition-colors group-hover:border-violet-500/30">
                      <div>
                        <p className="mb-1 text-xs text-violet-200/70">CxP abierta</p>
                        <p className="text-sm font-medium text-violet-100">
                          {formatCurrency(entidad.cxp_abierta || 0)}
                        </p>
                      </div>
                      <div className="border-l border-violet-500/20 pl-3 text-right">
                        <p className="mb-1 text-xs text-violet-200/70">Vencida</p>
                        <p className="text-sm font-medium text-red-200">
                          {formatCurrency(entidad.cxp_vencido || 0)}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between rounded-lg border border-zinc-800/60 bg-zinc-900/60 p-3 transition-colors group-hover:border-zinc-700/60">
                      <div>
                        <p className="mb-1 text-xs text-zinc-500">Regimen fiscal</p>
                        <p className="text-sm font-medium text-zinc-200">
                          {entidad.regimen_fiscal || "No aplica"}
                        </p>
                      </div>
                      <button
                        onClick={() => iniciarCambioEstatus(entidad)}
                        title={
                          entidad.activo
                            ? "Pausar automatizaciones"
                            : "Reactivar entidad"
                        }
                        className={`rounded-md border px-2 py-1 text-xs font-medium transition-all ${
                          entidad.activo
                            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
                            : "border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20"
                        }`}
                      >
                        {entidad.activo ? "Activa" : "Inactiva"}
                      </button>
                    </div>
                  </div>

                  <div className="mt-auto border-t border-zinc-800/50 pt-3">
                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                      <button
                        onClick={() => abrirResumen(entidad)}
                        className="flex w-full items-center justify-center gap-2 rounded-lg border border-cyan-500/20 bg-cyan-500/10 py-2 text-sm font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20"
                      >
                        Ver resumen
                      </button>
                      <button
                        onClick={() => router.push(`/entidades/${entidad.id}`)}
                        className="flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 py-2 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-700 hover:bg-zinc-800 hover:text-white"
                      >
                        Gestionar entidad
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-zinc-800 bg-zinc-950/70">
              <div className="grid min-w-[1320px] grid-cols-[minmax(260px,1.35fr)_150px_120px_120px_110px_130px_140px_220px] gap-4 border-b border-zinc-800 bg-zinc-900/45 px-4 py-3 text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                <p>Unidad</p>
                <p>Ciudad</p>
                <p>Espacios</p>
                <p>Ocupación</p>
                <p>Clientes</p>
                <p>Facturación</p>
                <p>CxP abierta</p>
                <p className="text-right">Acciones</p>
              </div>

              {entidadesPaginadas.map((entidad) => {
                const totalEspacios = entidad.espacios_total || 0;
                const ocupados = entidad.espacios_ocupados || 0;
                const ocupacion =
                  totalEspacios > 0 ? Math.round((ocupados / totalEspacios) * 100) : 0;

                return (
                  <div
                    key={entidad.id}
                    className="grid min-w-[1320px] grid-cols-[minmax(260px,1.35fr)_150px_120px_120px_110px_130px_140px_220px] items-center gap-4 border-t border-zinc-800 px-4 py-3 first:border-t-0"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className={`h-2.5 w-2.5 rounded-full ${
                            entidad.activo ? "bg-emerald-400" : "bg-red-400"
                          }`}
                        />
                        <p className="truncate text-sm font-semibold text-white">
                          {entidad.nombre_comercial}
                        </p>
                      </div>
                      <p className="mt-1 truncate text-xs uppercase tracking-[0.16em] text-zinc-500">
                        {entidad.rfc || "Sin RFC registrado"}
                      </p>
                    </div>
                    <p className="truncate text-sm text-zinc-300">
                      {entidad.ciudad || "Sin ciudad"}
                    </p>
                    <div className="text-sm text-zinc-300">
                      <p className="font-semibold text-white">{totalEspacios}</p>
                      <p className="text-xs text-zinc-500">
                        {entidad.espacios_disponibles || 0} disponibles
                      </p>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-white">{ocupacion}%</p>
                      <p className="text-xs text-zinc-500">
                        {ocupados} ocupados
                      </p>
                    </div>
                    <p className="text-sm font-semibold text-white">
                      {entidad.clientes_count || 0}
                    </p>
                    <p className="text-sm font-semibold text-emerald-300">
                      {formatCurrency(entidad.facturacion_activa || 0)}
                    </p>
                    <div>
                      <p className="text-sm font-semibold text-violet-200">
                        {formatCurrency(entidad.cxp_abierta || 0)}
                      </p>
                      <p className="text-xs text-red-200">
                        {formatCurrency(entidad.cxp_vencido || 0)} vencido
                      </p>
                    </div>
                    <div className="flex items-center justify-end gap-2">
                      <EntityActionButton
                        label="Ver resumen"
                        icon="summary"
                        tone="accent"
                        onClick={() => abrirResumen(entidad)}
                      />
                      <EntityActionButton
                        label="Gestionar entidad"
                        icon="manage"
                        onClick={() => router.push(`/entidades/${entidad.id}`)}
                      />
                      <EntityActionButton
                        label={entidad.activo ? "Pausar automatizaciones" : "Reactivar entidad"}
                        icon="status"
                        tone={entidad.activo ? "success" : "danger"}
                        onClick={() => iniciarCambioEstatus(entidad)}
                      />
                      <EntityActionButton
                        label="Clonar"
                        icon="clone"
                        tone="accent"
                        onClick={() => void handleClonar(entidad)}
                      />
                      <EntityActionButton
                        label="Editar"
                        icon="edit"
                        tone="warning"
                        onClick={() => handleEditar(entidad)}
                      />
                      <EntityActionButton
                        label="Eliminar"
                        icon="delete"
                        tone="danger"
                        onClick={() => iniciarBorrado(entidad.id, entidad.nombre_comercial)}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="page-section-tight flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <span className="text-sm text-zinc-400">
              Mostrando {entidadesFiltradas.length === 0 ? 0 : indicePrimerItem + 1} -{" "}
              {Math.min(indiceUltimoItem, entidadesFiltradas.length)} de{" "}
              {entidadesFiltradas.length} unidades · {itemsPorPagina} filas por página
            </span>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setPaginaActual(1)}
                disabled={paginaActual <= 1}
                className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-30"
              >
                Inicio
              </button>
              <button
                type="button"
                onClick={() => setPaginaActual((current) => Math.max(current - 1, 1))}
                disabled={paginaActual <= 1}
                className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-30"
              >
                Anterior
              </button>

              {pageWindow.map((pageNumber) => (
                <button
                  type="button"
                  key={pageNumber}
                  onClick={() => setPaginaActual(pageNumber)}
                  className={`h-9 min-w-9 rounded-lg border px-3 text-sm font-medium transition-colors ${
                    pageNumber === paginaActual
                      ? "border-blue-500/40 bg-blue-500/20 text-blue-100"
                      : "border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                  }`}
                >
                  {pageNumber}
                </button>
              ))}

              <button
                type="button"
                onClick={() => setPaginaActual((current) => Math.min(current + 1, totalPaginas))}
                disabled={paginaActual >= totalPaginas}
                className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-30"
              >
                Siguiente
              </button>
              <button
                type="button"
                onClick={() => setPaginaActual(totalPaginas)}
                disabled={paginaActual >= totalPaginas}
                className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-30"
              >
                Final
              </button>

              <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1">
                <span className="text-xs text-zinc-500">Ir a</span>
                <input
                  type="number"
                  min={1}
                  max={totalPaginas}
                  value={pageJumpValue}
                  onChange={(event) => setPageJumpValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      handlePageJump();
                    }
                  }}
                  className="w-16 bg-transparent text-sm text-white outline-none"
                />
                <button
                  type="button"
                  onClick={handlePageJump}
                  className="rounded-md bg-zinc-800 px-2 py-1 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-700"
                >
                  Ir
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      <EntidadFormModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEntidadEnEdicion(null);
        }}
        onSuccess={handleRegistroExitoso}
        entidadAEditar={entidadEnEdicion}
      />
      <EntidadSummaryModal
        state={{ isOpen: modalResumen.isOpen, entity: modalResumen.entidad }}
        onClose={() => setModalResumen({ isOpen: false, entidad: null })}
      />
    </div>
  );
}
