"use client";

import { buildApiUrl } from '@/lib/api';

import {
  type ChangeEvent,
  type DragEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

const ESPACIOS_API_BASE = buildApiUrl("/espacios");

interface EspacioRow {
  id: number;
  codigo: string;
  estatus: string;
  tipo_nombre: string | null;
  renta_publicable: number;
  foto_count: number;
  foto_portada_url: string | null;
  titulo_publico: string | null;
  titulo_publico_resuelto: string;
  resumen_publico: string | null;
  recamaras_publicables: number | null;
  banos_publicables: number | null;
  metros_publicables: number | null;
  publicar_en_renta: boolean;
}

interface EspacioFoto {
  id: number;
  titulo: string | null;
  orden: number;
  url: string | null;
  activo: boolean;
}

interface EspacioDetalle {
  id: number;
  codigo: string;
  estatus: string;
  tipo_nombre: string | null;
  renta_sugerida: number;
  titulo_publico: string | null;
  titulo_publico_resuelto: string;
  resumen_publico: string | null;
  descripcion_publica: string | null;
  renta_publica: number | null;
  renta_publicable: number;
  recamaras_comercial: number | null;
  recamaras_publicables: number | null;
  banos_comercial: number | null;
  banos_publicables: number | null;
  metros_cuadrados_comercial: number | null;
  metros_publicables: number | null;
  capacidad_maxima: number | null;
  amenidades: string[];
  reglas_publicas: string[];
  amueblado: boolean;
  internet_incluido: boolean;
  agua_caliente: boolean;
  limpieza_incluida: boolean;
  estacionamiento: boolean;
  admite_mascotas: boolean;
  bano_privado: boolean;
  balcon: boolean;
  publicar_en_renta: boolean;
  fotos: EspacioFoto[];
}

interface EspacioFormState {
  titulo_publico: string;
  resumen_publico: string;
  descripcion_publica: string;
  renta_publica: string;
  recamaras_comercial: string;
  banos_comercial: string;
  metros_cuadrados_comercial: string;
  capacidad_maxima: string;
  amenidades: string;
  reglas_publicas: string;
  amueblado: boolean;
  internet_incluido: boolean;
  agua_caliente: boolean;
  limpieza_incluida: boolean;
  estacionamiento: boolean;
  admite_mascotas: boolean;
  bano_privado: boolean;
  balcon: boolean;
  publicar_en_renta: boolean;
}

interface EspacioCopySuggestion {
  titulo_publico: string;
  resumen_publico: string;
  descripcion_publica: string;
  fuente: string;
  mensaje: string;
}

type CompletenessFilter = "TODOS" | "COMPLETOS" | "PENDIENTES" | "DISPONIBLES";

const EMPTY_FORM: EspacioFormState = {
  titulo_publico: "",
  resumen_publico: "",
  descripcion_publica: "",
  renta_publica: "",
  recamaras_comercial: "",
  banos_comercial: "",
  metros_cuadrados_comercial: "",
  capacidad_maxima: "",
  amenidades: "",
  reglas_publicas: "",
  amueblado: false,
  internet_incluido: false,
  agua_caliente: false,
  limpieza_incluida: false,
  estacionamiento: false,
  admite_mascotas: false,
  bano_privado: false,
  balcon: false,
  publicar_en_renta: true,
};

const moneyFormatter = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 0,
});

function formatMoney(value: number) {
  return moneyFormatter.format(value || 0);
}

function parseOptionalNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function getErrorMessage(body: unknown, fallback: string) {
  if (body && typeof body === "object") {
    if ("detail" in body && typeof body.detail === "string") {
      return body.detail;
    }
    if ("mensaje" in body && typeof body.mensaje === "string") {
      return body.mensaje;
    }
  }
  return fallback;
}

function getStatusStyles(status: string) {
  if (status === "OCUPADO") {
    return "border-amber-500/20 bg-amber-500/10 text-amber-300";
  }
  if (status === "DISPONIBLE") {
    return "border-emerald-500/20 bg-emerald-500/10 text-emerald-300";
  }
  if (status === "RESERVADO") {
    return "border-blue-500/20 bg-blue-500/10 text-blue-300";
  }
  return "border-zinc-700 bg-zinc-900 text-zinc-300";
}

function getCommercialMissingFields(space: EspacioRow) {
  const missing: string[] = [];
  if (!space.publicar_en_renta) {
    missing.push("habilitar para renta");
  }
  if (!space.resumen_publico) {
    missing.push("resumen comercial");
  }
  if (space.renta_publicable <= 0) {
    missing.push("precio publico");
  }
  if (space.foto_count <= 0) {
    missing.push("fotografias");
  }
  if (space.recamaras_publicables === null) {
    missing.push("recamaras");
  }
  if (space.banos_publicables === null) {
    missing.push("banos");
  }
  if (space.metros_publicables === null) {
    missing.push("metros cuadrados");
  }
  return missing;
}

function isCommercialReady(space: EspacioRow) {
  return getCommercialMissingFields(space).length === 0;
}

function Label({
  title,
  hint,
  optional = false,
}: {
  title: string;
  hint: string;
  optional?: boolean;
}) {
  return (
    <div className="mb-1.5 flex items-center gap-2">
      <label className="text-sm font-medium text-zinc-300">
        {title}
        {optional ? <span className="ml-1 text-zinc-500">(opcional)</span> : null}
      </label>
      <span
        title={hint}
        className="inline-flex h-5 w-5 cursor-help items-center justify-center rounded-full border border-zinc-700 bg-zinc-900 text-[11px] font-semibold text-zinc-400"
      >
        ?
      </span>
    </div>
  );
}

function ToggleField({
  checked,
  onChange,
  title,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`flex items-center justify-between rounded-xl border px-3 py-2 text-sm transition-colors ${
        checked
          ? "border-cyan-500/20 bg-cyan-500/10 text-cyan-200"
          : "border-zinc-800 bg-zinc-900 text-zinc-400"
      }`}
    >
      <span>{title}</span>
      <span
        className={`inline-flex h-5 w-9 items-center rounded-full p-0.5 transition-colors ${
          checked ? "bg-cyan-500" : "bg-zinc-700"
        }`}
      >
        <span
          className={`h-4 w-4 rounded-full bg-white transition-transform ${
            checked ? "translate-x-4" : ""
          }`}
        />
      </span>
    </button>
  );
}

export default function EspaciosCatalogManager({
  entidadId,
}: {
  entidadId?: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [spaces, setSpaces] = useState<EspacioRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [search, setSearch] = useState("");
  const [completenessFilter, setCompletenessFilter] =
    useState<CompletenessFilter>("TODOS");
  const [selected, setSelected] = useState<EspacioRow | null>(null);
  const [detail, setDetail] = useState<EspacioDetalle | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generatingCopy, setGeneratingCopy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [draggingPhotoId, setDraggingPhotoId] = useState<number | null>(null);
  const [form, setForm] = useState<EspacioFormState>(EMPTY_FORM);

  const loadSpaces = async () => {
    if (!entidadId) {
      setLoading(false);
      setSpaces([]);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `${ESPACIOS_API_BASE}/entidades/${entidadId}/lista/`,
        {
          cache: "no-store",
        }
      );
      if (!response.ok) {
        throw new Error("No se pudo cargar el catalogo de espacios.");
      }
      const data = (await response.json()) as EspacioRow[];
      setSpaces(data);
    } catch (loadError) {
      console.error("Error cargando espacios comerciales:", loadError);
      setError("No se pudo cargar la ficha comercial de los espacios.");
      setSpaces([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSpaces();
  }, [entidadId]);

  const filteredSpaces = useMemo(() => {
    const query = search.trim().toLowerCase();
    return spaces.filter((space) => {
      if (completenessFilter === "COMPLETOS" && !isCommercialReady(space)) {
        return false;
      }
      if (completenessFilter === "PENDIENTES" && isCommercialReady(space)) {
        return false;
      }
      if (
        completenessFilter === "DISPONIBLES" &&
        space.estatus !== "DISPONIBLE"
      ) {
        return false;
      }
      if (!query) {
        return true;
      }
      return (
        space.codigo.toLowerCase().includes(query) ||
        (space.titulo_publico || "").toLowerCase().includes(query) ||
        (space.tipo_nombre || "").toLowerCase().includes(query)
      );
    });
  }, [completenessFilter, search, spaces]);

  const summary = useMemo(() => {
    const readySpaces = spaces.filter(isCommercialReady).length;
    return {
      total: spaces.length,
      conFotos: spaces.filter((space) => space.foto_count > 0).length,
      listosBase: readySpaces,
      pendientes: spaces.length - readySpaces,
      disponibles: spaces.filter((space) => space.estatus === "DISPONIBLE").length,
    };
  }, [spaces]);

  const mapDetailToForm = (space: EspacioDetalle): EspacioFormState => ({
    titulo_publico: space.titulo_publico || "",
    resumen_publico: space.resumen_publico || "",
    descripcion_publica: space.descripcion_publica || "",
    renta_publica:
      space.renta_publica !== null && space.renta_publica !== undefined
        ? String(space.renta_publica)
        : "",
    recamaras_comercial:
      space.recamaras_comercial !== null && space.recamaras_comercial !== undefined
        ? String(space.recamaras_comercial)
        : "",
    banos_comercial:
      space.banos_comercial !== null && space.banos_comercial !== undefined
        ? String(space.banos_comercial)
        : "",
    metros_cuadrados_comercial:
      space.metros_cuadrados_comercial !== null &&
      space.metros_cuadrados_comercial !== undefined
        ? String(space.metros_cuadrados_comercial)
        : "",
    capacidad_maxima:
      space.capacidad_maxima !== null && space.capacidad_maxima !== undefined
        ? String(space.capacidad_maxima)
        : "",
    amenidades: (space.amenidades || []).join("\n"),
    reglas_publicas: (space.reglas_publicas || []).join("\n"),
    amueblado: space.amueblado,
    internet_incluido: space.internet_incluido,
    agua_caliente: space.agua_caliente,
    limpieza_incluida: space.limpieza_incluida,
    estacionamiento: space.estacionamiento,
    admite_mascotas: space.admite_mascotas,
    bano_privado: space.bano_privado,
    balcon: space.balcon,
    publicar_en_renta: space.publicar_en_renta,
  });

  const openSpace = async (space: EspacioRow) => {
    setSelected(space);
    setDetailLoading(true);
    setError("");
    try {
      const response = await fetch(`${ESPACIOS_API_BASE}/espacios/${space.id}/detalle/`, {
        cache: "no-store",
      });
      const body = (await response.json()) as EspacioDetalle | { detail?: string };
      if (!response.ok) {
        throw new Error(getErrorMessage(body, "No se pudo cargar el detalle del espacio."));
      }
      const nextDetail = body as EspacioDetalle;
      setDetail(nextDetail);
      setForm(mapDetailToForm(nextDetail));
    } catch (detailError) {
      console.error("Error cargando detalle de espacio:", detailError);
      setError(
        detailError instanceof Error
          ? detailError.message
          : "No se pudo cargar el detalle del espacio."
      );
      setSelected(null);
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const closeModal = () => {
    setSelected(null);
    setDetail(null);
    setForm(EMPTY_FORM);
    setDraggingPhotoId(null);
  };

  const saveDetail = async () => {
    if (!selected) {
      return;
    }
    setSaving(true);
    setError("");
    try {
      const response = await fetch(
        `${ESPACIOS_API_BASE}/espacios/${selected.id}/detalle/`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            titulo_publico: form.titulo_publico.trim() || null,
            resumen_publico: form.resumen_publico.trim() || null,
            descripcion_publica: form.descripcion_publica.trim() || null,
            renta_publica: parseOptionalNumber(form.renta_publica),
            recamaras_comercial: parseOptionalNumber(form.recamaras_comercial),
            banos_comercial: parseOptionalNumber(form.banos_comercial),
            metros_cuadrados_comercial: parseOptionalNumber(
              form.metros_cuadrados_comercial
            ),
            capacidad_maxima: parseOptionalNumber(form.capacidad_maxima),
            amenidades: form.amenidades
              .split("\n")
              .map((item) => item.trim())
              .filter(Boolean),
            reglas_publicas: form.reglas_publicas
              .split("\n")
              .map((item) => item.trim())
              .filter(Boolean),
            amueblado: form.amueblado,
            internet_incluido: form.internet_incluido,
            agua_caliente: form.agua_caliente,
            limpieza_incluida: form.limpieza_incluida,
            estacionamiento: form.estacionamiento,
            admite_mascotas: form.admite_mascotas,
            bano_privado: form.bano_privado,
            balcon: form.balcon,
            publicar_en_renta: form.publicar_en_renta,
          }),
        }
      );
      const body =
        (await response.json()) as
          | { mensaje: string; space: EspacioDetalle }
          | { detail?: string };
      if (!response.ok) {
        throw new Error(getErrorMessage(body, "No se pudo guardar la ficha comercial."));
      }
      const nextDetail = (body as { mensaje: string; space: EspacioDetalle }).space;
      setDetail(nextDetail);
      setForm(mapDetailToForm(nextDetail));
      await loadSpaces();
      setSuccess("Ficha comercial actualizada.");
      window.setTimeout(() => setSuccess(""), 2600);
    } catch (saveError) {
      console.error("Error guardando ficha comercial:", saveError);
      setError(
        saveError instanceof Error
          ? saveError.message
          : "No se pudo guardar la ficha comercial."
      );
    } finally {
      setSaving(false);
    }
  };

  const generateCopySuggestion = async () => {
    if (!selected) {
      return;
    }
    setGeneratingCopy(true);
    setError("");
    try {
      const response = await fetch(
        `${ESPACIOS_API_BASE}/espacios/${selected.id}/detalle/sugerir-textos/`,
        { method: "POST" }
      );
      const body = (await response.json()) as
        | EspacioCopySuggestion
        | { detail?: string; mensaje?: string };
      if (!response.ok) {
        throw new Error(
          getErrorMessage(body, "No se pudo generar el contenido comercial.")
        );
      }
      const suggestion = body as EspacioCopySuggestion;
      setForm((current) => ({
        ...current,
        titulo_publico: suggestion.titulo_publico || current.titulo_publico,
        resumen_publico: suggestion.resumen_publico || current.resumen_publico,
        descripcion_publica:
          suggestion.descripcion_publica || current.descripcion_publica,
      }));
      setSuccess(
        suggestion.fuente === "openai"
          ? "Contenido sugerido con IA. Revisa y guarda la ficha."
          : "Contenido sugerido con plantilla. Revisa y guarda la ficha."
      );
      window.setTimeout(() => setSuccess(""), 3200);
    } catch (copyError) {
      console.error("Error generando contenido comercial:", copyError);
      setError(
        copyError instanceof Error
          ? copyError.message
          : "No se pudo generar el contenido comercial."
      );
    } finally {
      setGeneratingCopy(false);
    }
  };

  const handleFileSelection = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) {
      return;
    }
    await uploadFiles(files);
    event.target.value = "";
  };

  const uploadFiles = async (files: File[]) => {
    if (!selected) {
      return;
    }
    setUploading(true);
    setError("");
    try {
      for (const file of files) {
        const formData = new FormData();
        formData.append("file", file);
        await fetch(`${ESPACIOS_API_BASE}/espacios/${selected.id}/fotos/`, {
          method: "POST",
          body: formData,
        }).then(async (response) => {
          const body = await response.json();
          if (!response.ok) {
            throw new Error(
              getErrorMessage(body, `No se pudo subir la foto ${file.name}.`)
            );
          }
        });
      }

      const response = await fetch(`${ESPACIOS_API_BASE}/espacios/${selected.id}/detalle/`, {
        cache: "no-store",
      });
      const nextDetail = (await response.json()) as EspacioDetalle;
      setDetail(nextDetail);
      setForm(mapDetailToForm(nextDetail));
      await loadSpaces();
      setSuccess("Fotos cargadas correctamente.");
      window.setTimeout(() => setSuccess(""), 2600);
    } catch (uploadError) {
      console.error("Error cargando fotos:", uploadError);
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "No se pudieron cargar las fotos."
      );
    } finally {
      setUploading(false);
    }
  };

  const reorderPhotos = async (photoIds: number[]) => {
    if (!selected) {
      return;
    }
    try {
      const response = await fetch(
        `${ESPACIOS_API_BASE}/espacios/${selected.id}/fotos/reordenar/`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ foto_ids: photoIds }),
        }
      );
      const body =
        (await response.json()) as
          | { mensaje: string; fotos: EspacioFoto[] }
          | { detail?: string };
      if (!response.ok) {
        throw new Error(getErrorMessage(body, "No se pudo actualizar el orden."));
      }
      setDetail((current) =>
        current
          ? {
              ...current,
              fotos: (body as { mensaje: string; fotos: EspacioFoto[] }).fotos,
            }
          : current
      );
      await loadSpaces();
    } catch (reorderError) {
      console.error("Error reordenando fotos:", reorderError);
      setError(
        reorderError instanceof Error
          ? reorderError.message
          : "No se pudo actualizar el orden de las fotos."
      );
    }
  };

  const movePhoto = async (photoId: number, direction: "up" | "down") => {
    if (!detail) {
      return;
    }
    const photos = [...detail.fotos];
    const currentIndex = photos.findIndex((photo) => photo.id === photoId);
    if (currentIndex < 0) {
      return;
    }
    const nextIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (nextIndex < 0 || nextIndex >= photos.length) {
      return;
    }
    const [item] = photos.splice(currentIndex, 1);
    photos.splice(nextIndex, 0, item);
    await reorderPhotos(photos.map((photo) => photo.id));
  };

  const deletePhoto = async (photoId: number) => {
    if (!detail) {
      return;
    }
    try {
      const response = await fetch(`${ESPACIOS_API_BASE}/fotos/${photoId}/`, {
        method: "DELETE",
      });
      const body = (await response.json()) as { success?: boolean; detail?: string };
      if (!response.ok) {
        throw new Error(getErrorMessage(body, "No se pudo eliminar la foto."));
      }
      const nextResponse = await fetch(
        `${ESPACIOS_API_BASE}/espacios/${selected?.id}/detalle/`,
        {
          cache: "no-store",
        }
      );
      const nextDetail = (await nextResponse.json()) as EspacioDetalle;
      setDetail(nextDetail);
      setForm(mapDetailToForm(nextDetail));
      await loadSpaces();
    } catch (deleteError) {
      console.error("Error eliminando foto:", deleteError);
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "No se pudo eliminar la foto."
      );
    }
  };

  const handlePhotoDrop = async (
    event: DragEvent<HTMLDivElement>,
    targetPhotoId: number
  ) => {
    event.preventDefault();
    if (!detail || draggingPhotoId === null || draggingPhotoId === targetPhotoId) {
      return;
    }
    const photos = [...detail.fotos];
    const draggingIndex = photos.findIndex((photo) => photo.id === draggingPhotoId);
    const targetIndex = photos.findIndex((photo) => photo.id === targetPhotoId);
    if (draggingIndex < 0 || targetIndex < 0) {
      return;
    }
    const [item] = photos.splice(draggingIndex, 1);
    photos.splice(targetIndex, 0, item);
    setDraggingPhotoId(null);
    await reorderPhotos(photos.map((photo) => photo.id));
  };

  const completenessOptions: {
    value: CompletenessFilter;
    label: string;
    count: number;
  }[] = [
    { value: "TODOS", label: "Todos", count: summary.total },
    { value: "COMPLETOS", label: "Completos", count: summary.listosBase },
    { value: "PENDIENTES", label: "Pendientes", count: summary.pendientes },
    { value: "DISPONIBLES", label: "Disponibles", count: summary.disponibles },
  ];

  return (
    <div className="space-y-6">
      {success ? (
        <div className="fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-4 py-2 text-sm text-emerald-300 shadow-lg">
          {success}
        </div>
      ) : null}

      <section className="rounded-3xl border border-zinc-800 bg-zinc-950/70 p-5">
        <div className="flex flex-col gap-4 border-b border-zinc-800 pb-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-xl font-bold text-white">Espacios</h2>
            <p className="mt-1 text-sm text-zinc-500">
              Aqui preparas la ficha comercial de cada unidad: precio publico,
              amenidades, fotos y contenido listo para promocion.
            </p>
          </div>
          <div className="w-full max-w-md">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por codigo, titulo o tipo..."
              className="w-full rounded-2xl border border-zinc-800 bg-zinc-900 px-4 py-2.5 text-sm text-white outline-none placeholder:text-zinc-500 focus:ring-1 focus:ring-cyan-500"
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {completenessOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setCompletenessFilter(option.value)}
              className={`rounded-xl border px-3 py-2 text-sm transition-colors ${
                completenessFilter === option.value
                  ? "border-cyan-500/20 bg-cyan-500/10 text-cyan-200"
                  : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white"
              }`}
            >
              {option.label}
              <span className="ml-2 text-xs text-zinc-500">
                {option.count}
              </span>
            </button>
          ))}
        </div>

        <div className="mt-5 grid grid-cols-2 gap-4 xl:grid-cols-5">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4">
            <p className="text-xs uppercase tracking-wide text-zinc-500">
              Total espacios
            </p>
            <p className="mt-2 text-3xl font-bold text-white">{summary.total}</p>
          </div>
          <div className="rounded-2xl border border-blue-500/20 bg-blue-500/10 p-4">
            <p className="text-xs uppercase tracking-wide text-blue-200/80">
              Con fotos
            </p>
            <p className="mt-2 text-3xl font-bold text-blue-300">
              {summary.conFotos}
            </p>
          </div>
          <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-4">
            <p className="text-xs uppercase tracking-wide text-cyan-200/80">
              Ficha base lista
            </p>
            <p className="mt-2 text-3xl font-bold text-cyan-300">
              {summary.listosBase}
            </p>
          </div>
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4">
            <p className="text-xs uppercase tracking-wide text-amber-200/80">
              Ficha pendiente
            </p>
            <p className="mt-2 text-3xl font-bold text-amber-300">
              {summary.pendientes}
            </p>
          </div>
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4">
            <p className="text-xs uppercase tracking-wide text-emerald-200/80">
              Disponibles
            </p>
            <p className="mt-2 text-3xl font-bold text-emerald-300">
              {summary.disponibles}
            </p>
          </div>
        </div>

        {error ? (
          <div className="mt-5 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        ) : null}

        <div className="mt-5">
          {loading ? (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 py-16 text-center text-zinc-500">
              Cargando espacios...
            </div>
          ) : filteredSpaces.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/20 py-16 text-center text-zinc-500">
              No hay espacios con esos filtros.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-left text-sm text-zinc-300">
                <thead className="border-b border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="py-3 pr-4">Espacio</th>
                    <th className="py-3 pr-4">Estatus</th>
                    <th className="py-3 pr-4">Ficha comercial</th>
                    <th className="py-3 pr-4">Precio</th>
                    <th className="py-3 pr-4">Fotos</th>
                    <th className="py-3 pr-4">Habitabilidad</th>
                    <th className="py-3 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {filteredSpaces.map((space) => {
                    const missingFields = getCommercialMissingFields(space);
                    const hasBaseData = missingFields.length === 0;
                    return (
                      <tr key={space.id} className="align-top hover:bg-zinc-900/40">
                        <td className="py-4 pr-4">
                          <div className="flex items-start gap-3">
                            <div className="h-14 w-14 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
                              {space.foto_portada_url ? (
                                <img
                                  src={space.foto_portada_url}
                                  alt={space.codigo}
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <div className="flex h-full items-center justify-center text-xs text-zinc-600">
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
                                {space.titulo_publico || space.titulo_publico_resuelto}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="py-4 pr-4">
                          <span
                            className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${getStatusStyles(
                              space.estatus
                            )}`}
                          >
                            {space.estatus}
                          </span>
                          <div className="mt-2 text-xs text-zinc-500">
                            {space.publicar_en_renta
                              ? "Marcado para renta"
                              : "No se promociona"}
                          </div>
                        </td>
                        <td className="py-4 pr-4">
                          <div
                            className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${
                              hasBaseData
                                ? "border-cyan-500/20 bg-cyan-500/10 text-cyan-300"
                                : "border-zinc-700 bg-zinc-900 text-zinc-400"
                            }`}
                          >
                            {hasBaseData ? "Base completa" : "Pendiente"}
                          </div>
                          <div className="mt-2 max-w-xs text-xs text-zinc-500">
                            {hasBaseData
                              ? space.resumen_publico ||
                                "Ficha lista para publicar."
                              : `Falta: ${missingFields.slice(0, 3).join(", ")}${
                                  missingFields.length > 3 ? "..." : ""
                                }`}
                          </div>
                        </td>
                        <td className="py-4 pr-4">
                          <div className="font-medium text-white">
                            {formatMoney(space.renta_publicable)}
                          </div>
                          <div className="mt-1 text-xs text-zinc-500">
                            Precio publico sugerido
                          </div>
                        </td>
                        <td className="py-4 pr-4">
                          <div className="font-medium text-white">{space.foto_count}</div>
                          <div className="mt-1 text-xs text-zinc-500">
                            imagen{space.foto_count === 1 ? "" : "es"} cargadas
                          </div>
                        </td>
                        <td className="py-4 pr-4 text-xs text-zinc-400">
                          <div>
                            {space.recamaras_publicables ?? "-"} rec /{" "}
                            {space.banos_publicables ?? "-"} banos
                          </div>
                          <div className="mt-1">
                            {space.metros_publicables ?? "-"} m2
                          </div>
                        </td>
                        <td className="py-4 text-right">
                          <button
                            onClick={() => void openSpace(space)}
                            className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-3 py-2 text-xs font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20"
                          >
                            Editar ficha
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {selected ? (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm">
          <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-950 shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-zinc-800 px-6 py-5">
              <div>
                <h3 className="text-2xl font-bold text-white">
                  Espacio {selected.codigo}
                </h3>
                <p className="mt-1 text-sm text-zinc-500">
                  Completa la ficha comercial y la galeria visual para dejarlo
                  listo para promocion.
                </p>
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-400 transition-colors hover:text-white"
              >
                Cerrar
              </button>
            </div>

            <div className="overflow-y-auto px-6 py-5">
              {detailLoading || !detail ? (
                <div className="py-16 text-center text-zinc-500">
                  Cargando detalle del espacio...
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.2fr,0.8fr]">
                  <div className="space-y-5">
                    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <h4 className="text-lg font-semibold text-white">
                            Contenido comercial
                          </h4>
                          <p className="mt-1 text-sm text-zinc-500">
                            Este bloque alimenta la descripcion que veras en
                            portales, asesores o fichas internas.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void generateCopySuggestion()}
                          disabled={generatingCopy}
                          className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-3 py-2 text-sm font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20 disabled:opacity-50"
                        >
                          {generatingCopy ? "Generando..." : "Generar con IA"}
                        </button>
                      </div>

                      <div className="mt-5 grid grid-cols-1 gap-4">
                        <div>
                          <Label
                            title="Titulo publico"
                            hint="Si lo dejas vacio, BettERP armara un titulo base usando tipo, codigo y entidad."
                            optional
                          />
                          <input
                            value={form.titulo_publico}
                            onChange={(event) =>
                              setForm({ ...form, titulo_publico: event.target.value })
                            }
                            placeholder={detail.titulo_publico_resuelto}
                            className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none placeholder:text-zinc-500 focus:ring-1 focus:ring-cyan-500"
                          />
                        </div>

                        <div>
                          <Label
                            title="Resumen corto"
                            hint="Mensaje breve de una linea para tarjetas, mini fichas o portales con teaser."
                          />
                          <input
                            value={form.resumen_publico}
                            onChange={(event) =>
                              setForm({ ...form, resumen_publico: event.target.value })
                            }
                            placeholder="Ej. Suite amueblada con balcon y servicios incluidos"
                            className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none placeholder:text-zinc-500 focus:ring-1 focus:ring-cyan-500"
                          />
                        </div>

                        <div>
                          <Label
                            title="Descripcion comercial"
                            hint="Texto largo para explicar distribucion, ambiente, amenidades y diferenciales del espacio."
                          />
                          <textarea
                            rows={6}
                            value={form.descripcion_publica}
                            onChange={(event) =>
                              setForm({
                                ...form,
                                descripcion_publica: event.target.value,
                              })
                            }
                            placeholder="Describe el espacio, el estilo de vida, lo que incluye y por que conviene rentarlo."
                            className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none placeholder:text-zinc-500 focus:ring-1 focus:ring-cyan-500"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
                      <h4 className="text-lg font-semibold text-white">
                        Configuracion publicable
                      </h4>
                      <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
                        <div>
                          <Label
                            title="Renta publica"
                            hint="Si no la capturas, se usa la renta sugerida actual del espacio."
                            optional
                          />
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={form.renta_publica}
                            onChange={(event) =>
                              setForm({ ...form, renta_publica: event.target.value })
                            }
                            placeholder={String(detail.renta_sugerida)}
                            className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none placeholder:text-zinc-500 focus:ring-1 focus:ring-cyan-500"
                          />
                        </div>
                        <div>
                          <Label
                            title="Capacidad maxima"
                            hint="Numero de personas objetivo para esta ficha comercial."
                            optional
                          />
                          <input
                            type="number"
                            min="1"
                            value={form.capacidad_maxima}
                            onChange={(event) =>
                              setForm({ ...form, capacidad_maxima: event.target.value })
                            }
                            placeholder="Ej. 2"
                            className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none placeholder:text-zinc-500 focus:ring-1 focus:ring-cyan-500"
                          />
                        </div>
                        <div>
                          <Label
                            title="Recamaras"
                            hint="Si lo dejas vacio, se usa el dato del tipo de espacio."
                            optional
                          />
                          <input
                            type="number"
                            min="0"
                            value={form.recamaras_comercial}
                            onChange={(event) =>
                              setForm({
                                ...form,
                                recamaras_comercial: event.target.value,
                              })
                            }
                            placeholder={
                              detail.recamaras_publicables !== null
                                ? String(detail.recamaras_publicables)
                                : "Ej. 1"
                            }
                            className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none placeholder:text-zinc-500 focus:ring-1 focus:ring-cyan-500"
                          />
                        </div>
                        <div>
                          <Label
                            title="Banos"
                            hint="Admite medios banos o fracciones como 1.5."
                            optional
                          />
                          <input
                            type="number"
                            min="0"
                            step="0.5"
                            value={form.banos_comercial}
                            onChange={(event) =>
                              setForm({ ...form, banos_comercial: event.target.value })
                            }
                            placeholder={
                              detail.banos_publicables !== null
                                ? String(detail.banos_publicables)
                                : "Ej. 1"
                            }
                            className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none placeholder:text-zinc-500 focus:ring-1 focus:ring-cyan-500"
                          />
                        </div>
                        <div className="md:col-span-2">
                          <Label
                            title="Metros cuadrados"
                            hint="Si esta vacio, se usa el dato del tipo de espacio."
                            optional
                          />
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={form.metros_cuadrados_comercial}
                            onChange={(event) =>
                              setForm({
                                ...form,
                                metros_cuadrados_comercial: event.target.value,
                              })
                            }
                            placeholder={
                              detail.metros_publicables !== null
                                ? String(detail.metros_publicables)
                                : "Ej. 42"
                            }
                            className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none placeholder:text-zinc-500 focus:ring-1 focus:ring-cyan-500"
                          />
                        </div>
                      </div>

                      <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                        <ToggleField
                          title="Amueblado"
                          checked={form.amueblado}
                          onChange={(next) => setForm({ ...form, amueblado: next })}
                        />
                        <ToggleField
                          title="Internet incluido"
                          checked={form.internet_incluido}
                          onChange={(next) =>
                            setForm({ ...form, internet_incluido: next })
                          }
                        />
                        <ToggleField
                          title="Agua caliente"
                          checked={form.agua_caliente}
                          onChange={(next) =>
                            setForm({ ...form, agua_caliente: next })
                          }
                        />
                        <ToggleField
                          title="Limpieza incluida"
                          checked={form.limpieza_incluida}
                          onChange={(next) =>
                            setForm({ ...form, limpieza_incluida: next })
                          }
                        />
                        <ToggleField
                          title="Estacionamiento"
                          checked={form.estacionamiento}
                          onChange={(next) =>
                            setForm({ ...form, estacionamiento: next })
                          }
                        />
                        <ToggleField
                          title="Admite mascotas"
                          checked={form.admite_mascotas}
                          onChange={(next) =>
                            setForm({ ...form, admite_mascotas: next })
                          }
                        />
                        <ToggleField
                          title="Bano privado"
                          checked={form.bano_privado}
                          onChange={(next) =>
                            setForm({ ...form, bano_privado: next })
                          }
                        />
                        <ToggleField
                          title="Balcon"
                          checked={form.balcon}
                          onChange={(next) => setForm({ ...form, balcon: next })}
                        />
                        <ToggleField
                          title="Publicar en renta"
                          checked={form.publicar_en_renta}
                          onChange={(next) =>
                            setForm({ ...form, publicar_en_renta: next })
                          }
                        />
                      </div>

                      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
                        <div>
                          <Label
                            title="Amenidades"
                            hint="Una amenidad por linea. Ejemplo: rooftop, coworking, cocina equipada."
                            optional
                          />
                          <textarea
                            rows={5}
                            value={form.amenidades}
                            onChange={(event) =>
                              setForm({ ...form, amenidades: event.target.value })
                            }
                            placeholder={"Internet de alta velocidad\nCoworking\nLavanderia"}
                            className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none placeholder:text-zinc-500 focus:ring-1 focus:ring-cyan-500"
                          />
                        </div>
                        <div>
                          <Label
                            title="Reglas publicas"
                            hint="Tambien van una por linea. Sirven para fijar expectativas desde la publicacion."
                            optional
                          />
                          <textarea
                            rows={5}
                            value={form.reglas_publicas}
                            onChange={(event) =>
                              setForm({ ...form, reglas_publicas: event.target.value })
                            }
                            placeholder={"No fumar dentro del espacio\nNo fiestas\nEstancia minima de 3 meses"}
                            className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none placeholder:text-zinc-500 focus:ring-1 focus:ring-cyan-500"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-5">
                    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h4 className="text-lg font-semibold text-white">Fotos</h4>
                          <p className="mt-1 text-sm text-zinc-500">
                            Arrastra archivos o elige manualmente. El orden visual
                            sera el orden de publicacion.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => inputRef.current?.click()}
                          className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-200 transition-colors hover:bg-cyan-500/20"
                        >
                          Subir fotos
                        </button>
                        <input
                          ref={inputRef}
                          type="file"
                          multiple
                          accept="image/*"
                          onChange={handleFileSelection}
                          className="hidden"
                        />
                      </div>

                      <div
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => {
                          event.preventDefault();
                          const files = Array.from(event.dataTransfer.files || []);
                          if (files.length > 0) {
                            void uploadFiles(files);
                          }
                        }}
                        className="mt-4 rounded-2xl border border-dashed border-zinc-700 bg-zinc-950/70 px-4 py-6 text-center text-sm text-zinc-500"
                      >
                        {uploading
                          ? "Cargando imagenes..."
                          : "Suelta aqui las imagenes o usa el boton para seleccionarlas."}
                      </div>

                      {detail.fotos.length === 0 ? (
                        <div className="mt-4 rounded-2xl border border-dashed border-zinc-800 bg-zinc-950/60 py-10 text-center text-sm text-zinc-500">
                          Aun no hay fotos para este espacio.
                        </div>
                      ) : (
                        <div className="mt-4 space-y-3">
                          {detail.fotos.map((photo, index) => (
                            <div
                              key={photo.id}
                              draggable
                              onDragStart={() => setDraggingPhotoId(photo.id)}
                              onDragOver={(event) => event.preventDefault()}
                              onDrop={(event) => void handlePhotoDrop(event, photo.id)}
                              className="flex items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-950/80 p-3"
                            >
                              <div className="h-20 w-24 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
                                {photo.url ? (
                                  <img
                                    src={photo.url}
                                    alt={photo.titulo || `Foto ${index + 1}`}
                                    className="h-full w-full object-cover"
                                  />
                                ) : (
                                  <div className="flex h-full items-center justify-center text-xs text-zinc-600">
                                    Sin vista
                                  </div>
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-white">
                                  Foto {index + 1}
                                </p>
                                <p className="mt-1 text-xs text-zinc-500">
                                  Arrastra para reordenar. Esta posicion define
                                  la portada y la secuencia en portales.
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => void movePhoto(photo.id, "up")}
                                  className="rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-2 text-xs text-zinc-300 transition-colors hover:bg-zinc-800"
                                >
                                  Subir
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void movePhoto(photo.id, "down")}
                                  className="rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-2 text-xs text-zinc-300 transition-colors hover:bg-zinc-800"
                                >
                                  Bajar
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void deletePhoto(photo.id)}
                                  className="rounded-lg border border-red-500/20 bg-red-500/10 px-2.5 py-2 text-xs text-red-300 transition-colors hover:bg-red-500/20"
                                >
                                  Eliminar
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
                      <h4 className="text-lg font-semibold text-white">
                        Lectura rapida
                      </h4>
                      <div className="mt-4 space-y-3 text-sm text-zinc-400">
                        <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
                          <p className="text-xs uppercase tracking-wide text-zinc-500">
                            Titulo resultante
                          </p>
                          <p className="mt-2 text-white">
                            {form.titulo_publico.trim() || detail.titulo_publico_resuelto}
                          </p>
                        </div>
                        <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
                          <p className="text-xs uppercase tracking-wide text-zinc-500">
                            Precio visible
                          </p>
                          <p className="mt-2 text-white">
                            {formatMoney(
                              parseOptionalNumber(form.renta_publica) ?? detail.renta_sugerida
                            )}
                          </p>
                        </div>
                        <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
                          <p className="text-xs uppercase tracking-wide text-zinc-500">
                            Fotos activas
                          </p>
                          <p className="mt-2 text-white">{detail.fotos.length}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-zinc-800 px-6 py-4">
              <button
                type="button"
                onClick={closeModal}
                className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-2.5 text-sm text-zinc-400 transition-colors hover:text-white"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void saveDetail()}
                disabled={saving || detailLoading || generatingCopy}
                className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-2.5 text-sm font-medium text-emerald-200 transition-colors hover:bg-emerald-500/20 disabled:opacity-50"
              >
                {saving ? "Guardando..." : "Guardar ficha"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
