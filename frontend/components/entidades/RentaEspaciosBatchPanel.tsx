"use client";

import { buildApiUrl } from "@/lib/api";

import { useRef, useState } from "react";

import {
  RentaInfoButton,
  RentaInfoModal,
  type RentaInfoContent,
} from "./RentaInfo";

const ESPACIOS_API_BASE = buildApiUrl("/espacios");

interface ImportResult {
  mensaje: string;
  total_filas?: number;
  actualizados: number;
  errores: string[];
  errores_total?: number;
  archivo_errores_nombre?: string;
  archivo_errores_base64?: string;
}

interface ImportAccepted {
  accepted: boolean;
  job_id: number;
  status: string;
  mensaje: string;
}

interface BackgroundJobStatus {
  id: number;
  status: "PENDING" | "RUNNING" | "SUCCESS" | "ERROR" | "CANCELLED";
  result?: ImportResult;
  error?: string | null;
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function readError(body: unknown, fallback: string) {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail?: unknown }).detail;
    if (typeof detail === "string" && detail.trim()) {
      return detail;
    }
  }
  return fallback;
}

const batchInfo: Record<string, RentaInfoContent> = {
  panel: {
    eyebrow: "Carga batch",
    title: "Carga batch de fichas",
    summary:
      "Este flujo actualiza fichas comerciales de espacios ya existentes por medio de CSV.",
    details: [
      "No crea nuevos espacios: usa las columnas entidad y codigo para encontrar el registro correcto.",
      "Procesa las filas validas y devuelve un CSV con las filas rechazadas para corregirlas sin perder trabajo.",
      "Usalo cuando quieras completar precio publico, textos, amenidades, reglas o banderas publicables en bloque.",
    ],
  },
  archivo: {
    eyebrow: "Carga batch",
    title: "Archivo CSV",
    summary:
      "Es el archivo que contiene las fichas que quieres actualizar. Debe respetar los encabezados de la plantilla.",
    details: [
      "La columna entidad identifica la unidad de negocio y codigo identifica el espacio dentro de esa unidad.",
      "Puedes dejar columnas vacias si no quieres modificar ese dato.",
      "Si una fila tiene errores, BettERP no la guarda y la devuelve con comentario para corregir.",
    ],
  },
  campos: {
    eyebrow: "Carga batch",
    title: "Campos disponibles",
    summary:
      "Son las columnas que la importacion reconoce para completar la ficha comercial publicable.",
    details: [
      "Los campos de dinero y medidas aceptan numeros; los campos booleanos aceptan si/no, true/false o 1/0.",
      "Amenidades y reglas publicas se separan con barra vertical para crear listas visibles.",
      "Los textos publicos tienen limite de longitud para mantener fichas limpias y compatibles con canales.",
    ],
  },
};

export default function RentaEspaciosBatchPanel() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloadingTemplate, setDownloadingTemplate] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState("");
  const [infoModal, setInfoModal] = useState<RentaInfoContent | null>(null);
  const hasErrorReport = Boolean(result?.archivo_errores_base64);
  const errorRows = result?.errores_total ?? result?.errores?.length ?? 0;

  const downloadTemplate = async () => {
    setDownloadingTemplate(true);
    setError("");
    try {
      const response = await fetch(`${ESPACIOS_API_BASE}/renta/plantilla/`, {
        cache: "no-store",
      });
      if (!response.ok) {
        let detail = "No se pudo descargar la plantilla CSV.";
        try {
          detail = readError(await response.json(), detail);
        } catch {
          // La respuesta puede venir como texto/HTML si el backend rechazo la sesion.
        }
        throw new Error(detail);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "plantilla-espacios-renta.csv";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (downloadError) {
      console.error("Error descargando plantilla de espacios:", downloadError);
      setError(
        downloadError instanceof Error
          ? downloadError.message
          : "No se pudo descargar la plantilla CSV."
      );
    } finally {
      setDownloadingTemplate(false);
    }
  };

  const importFile = async () => {
    if (!file) {
      setError("Selecciona un archivo CSV antes de importar.");
      return;
    }
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch(`${ESPACIOS_API_BASE}/renta/importar/?async_job=true`, {
        method: "POST",
        body: formData,
      });
      const body = (await response.json()) as
        | ImportResult
        | ImportAccepted
        | { detail?: string };
      if (!response.ok) {
        throw new Error(readError(body, "No se pudo importar la carga batch."));
      }
      const importResult =
        "accepted" in body && body.accepted
          ? await waitForImportJob(body.job_id)
          : (body as ImportResult);
      setResult(importResult);
      setFile(null);
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    } catch (importError) {
      console.error("Error importando espacios de renta:", importError);
      setError(
        importError instanceof Error
          ? importError.message
          : "No se pudo importar la carga batch."
      );
    } finally {
      setLoading(false);
    }
  };

  const waitForImportJob = async (jobId: number) => {
    for (let attempt = 0; attempt < 90; attempt += 1) {
      const response = await fetch(buildApiUrl(`/billing/jobs/${jobId}/`), {
        cache: "no-store",
      });
      const body = (await response.json().catch(() => ({}))) as
        | BackgroundJobStatus
        | { detail?: string };
      if (!response.ok) {
        throw new Error(readError(body, "No se pudo consultar el estado de la carga."));
      }
      const job = body as BackgroundJobStatus;
      if (job.status === "SUCCESS" && job.result) {
        return job.result;
      }
      if (job.status === "ERROR" || job.status === "CANCELLED") {
        throw new Error(job.error || "La carga batch termino con error.");
      }
      await sleep(2000);
    }
    throw new Error("La carga sigue en proceso. Revisa salud operativa en unos minutos.");
  };

  const downloadErrorReport = () => {
    if (!result?.archivo_errores_base64) {
      setError("No hay archivo de errores disponible para esta carga.");
      return;
    }
    try {
      const binary = window.atob(result.archivo_errores_base64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      const blob = new Blob([bytes], { type: "text/csv;charset=utf-8" });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = result.archivo_errores_nombre || "errores-fichas-renta.csv";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (downloadError) {
      console.error("Error descargando errores de renta:", downloadError);
      setError("No se pudo descargar el archivo de errores.");
    }
  };

  return (
    <section className="page-section space-y-5">
      <RentaInfoModal info={infoModal} onClose={() => setInfoModal(null)} />
      {loading ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-3xl border border-cyan-500/20 bg-zinc-950 p-6 text-center shadow-2xl shadow-cyan-950/40">
            <div className="mx-auto h-12 w-12 animate-spin rounded-full border-2 border-cyan-400/20 border-t-cyan-300" />
            <p className="mt-4 text-lg font-semibold text-white">
              Procesando carga batch
            </p>
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">
              Estamos validando el CSV y guardando las filas correctas. Mantente en
              esta pantalla hasta que el proceso termine.
            </p>
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-3 border-b border-zinc-800 pb-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-2xl font-semibold text-white">
              Carga batch de fichas
            </h2>
            <RentaInfoButton info={batchInfo.panel} onOpen={setInfoModal} />
          </div>
          <p className="mt-2 max-w-3xl text-sm text-zinc-500">
            Descarga tus espacios activos precargados, completa la informacion
            comercial y vuelve a subir el CSV. La carga no crea espacios nuevos:
            solo actualiza lo que cambie usando entidad y codigo.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void downloadTemplate()}
          disabled={downloadingTemplate || loading}
          className="w-fit rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-2.5 text-sm font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {downloadingTemplate ? "Descargando..." : "Descargar plantilla CSV"}
        </button>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      ) : null}

      {result ? (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            hasErrorReport
              ? "border-amber-500/25 bg-amber-500/10 text-amber-100"
              : "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
          }`}
        >
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="font-semibold">{result.mensaje}</p>
              <p className="mt-1 text-sm opacity-90">
                {result.actualizados} espacio(s) actualizado(s)
                {result.total_filas !== undefined
                  ? ` de ${result.total_filas} fila(s) leida(s)`
                  : ""}
                {hasErrorReport ? `; ${errorRows} fila(s) por corregir.` : "."}
              </p>
            </div>
            {hasErrorReport ? (
              <button
                type="button"
                onClick={downloadErrorReport}
                className="w-fit rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-2 text-sm font-semibold text-amber-100 transition hover:bg-amber-400/20"
              >
                Descargar errores ({errorRows})
              </button>
            ) : null}
          </div>
          {hasErrorReport ? (
            <p className="mt-3 text-xs leading-relaxed text-amber-100/80">
              El CSV descargado conserva las filas rechazadas e incluye el
              comentario de error. Corrige esos datos y vuelve a subirlo en esta
              misma pantalla.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
              Archivo
            </p>
            <RentaInfoButton info={batchInfo.archivo} onOpen={setInfoModal} />
          </div>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => setFile(event.target.files?.[0] || null)}
              disabled={loading}
              className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-300 file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-800 file:px-3 file:py-2 file:text-zinc-200"
            />
            <button
              type="button"
              onClick={() => void importFile()}
              disabled={!file || loading}
              className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-2.5 text-sm font-medium text-emerald-200 transition-colors hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "Importando..." : "Importar"}
            </button>
          </div>
          <p className="mt-4 text-sm text-zinc-500">
            Columnas llave: entidad y codigo. Puedes llenar o modificar solo las
            columnas que quieras actualizar.
          </p>
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
              Campos disponibles
            </p>
            <RentaInfoButton info={batchInfo.campos} onOpen={setInfoModal} />
          </div>
          <div className="mt-4 grid gap-2 text-sm text-zinc-400 md:grid-cols-2">
            <span>titulo_publico</span>
            <span>resumen_publico</span>
            <span>descripcion_publica</span>
            <span>renta_publica</span>
            <span>recamaras, banos, metros</span>
            <span>capacidad_maxima</span>
            <span>amenidades separadas por |</span>
            <span>reglas_publicas separadas por |</span>
            <span>publicar_en_renta</span>
            <span>amueblado, internet, limpieza</span>
          </div>
        </div>
      </div>

      {result?.errores?.length ? (
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4">
          <p className="text-sm font-semibold text-amber-200">
            Registros que requieren revision
          </p>
          <div className="mt-3 max-h-64 overflow-y-auto text-sm text-amber-100/80">
            {result.errores.map((item) => (
              <p key={item} className="border-b border-amber-500/10 py-2">
                {item}
              </p>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
