"use client";

import { API_BASE_URL, buildApiUrl } from "@/lib/api";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent } from "react";

import {
  RentaInfoButton,
  RentaInfoModal,
  type RentaInfoContent,
} from "./RentaInfo";

const ESPACIOS_API_BASE = buildApiUrl("/espacios");
const BACKEND_MEDIA_BASE = API_BASE_URL.replace(/\/api\/?$/, "");

interface Entidad {
  id: number;
  nombre_comercial: string;
}

interface EspacioRow {
  id: number;
  entidad_id: number | null;
  entidad_nombre: string | null;
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

interface EspacioPhoto {
  id: number;
  url: string | null;
  titulo: string | null;
  orden: number;
  activo: boolean;
}

interface EspacioDetalle {
  id: number;
  entidad_id: number | null;
  codigo: string;
  estatus: string;
  tipo_id: number | null;
  tipo_nombre: string | null;
  renta_sugerida: number;
  renta_publicable: number;
  titulo_publico: string | null;
  titulo_publico_resuelto: string;
  resumen_publico: string | null;
  descripcion_publica: string | null;
  renta_publica: number | null;
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
  fotos: EspacioPhoto[];
}

interface FormState {
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

type StatusFilter = "TODOS" | "DISPONIBLE" | "OCUPADO" | "RESERVADO" | "MANTENIMIENTO";
type InfoFilter = "TODOS" | "COMPLETOS" | "PENDIENTES" | "PUBLICABLES";
type SpaceSortKey =
  | "espacio"
  | "ficha"
  | "precio"
  | "estatus"
  | "caracteristicas"
  | "faltantes"
  | "fotos";
type SortDirection = "asc" | "desc";

const PAGE_SIZE_OPTIONS = [25, 40, 60, 80, 100] as const;

const emptyForm: FormState = {
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

const MAX_SPACE_PHOTOS = 8;
const MAX_PHOTO_EDGE = 1800;
const MAX_PHOTO_UPLOAD_BYTES = 2_200_000;
const PHOTO_JPEG_QUALITY = 0.82;
const TITLE_MAX_LENGTH = 90;
const SUMMARY_MAX_LENGTH = 180;
const DESCRIPTION_MAX_LENGTH = 1000;
const MULTILINE_LIST_MAX_LENGTH = 1200;

const commercialFieldInfo = {
  titulo_publico: {
    title: "Titulo publico",
    summary:
      "Nombre visible en portales y publicaciones. Debe ser claro, corto y entendible para quien busca rentar.",
    details: [
      "Acepta letras, numeros, espacios y signos comunes.",
      `Maximo ${TITLE_MAX_LENGTH} caracteres.`,
      "No uses datos internos, codigos confusos ni texto tecnico.",
    ],
  },
  renta_publica: {
    title: "Renta publica",
    summary:
      "Precio mensual que se mostrara en canales de renta. Si lo dejas vacio, BettERP usa la renta sugerida del espacio o tipo.",
    details: [
      "Acepta solo numeros positivos y hasta 2 decimales.",
      "No acepta texto, signos de moneda ni montos en cero.",
      "Ejemplos validos: 15000, 15000.50.",
    ],
  },
  resumen_publico: {
    title: "Resumen",
    summary:
      "Frase breve para listados, buscadores y tarjetas. Sirve para explicar el valor del espacio sin saturar la publicacion.",
    details: [
      "Acepta texto corto en una sola linea.",
      `Maximo ${SUMMARY_MAX_LENGTH} caracteres.`,
      "Evita repetir toda la descripcion; aqui conviene una propuesta rapida.",
    ],
  },
  descripcion_publica: {
    title: "Descripcion",
    summary:
      "Texto principal de la publicacion. Aqui puedes detallar servicios, condiciones, ubicacion operativa y ventajas del espacio.",
    details: [
      "Acepta texto libre y saltos de linea.",
      `Maximo ${DESCRIPTION_MAX_LENGTH} caracteres.`,
      "No incluyas instrucciones internas ni datos sensibles del negocio.",
    ],
  },
  recamaras_comercial: {
    title: "Recamaras",
    summary:
      "Cantidad de recamaras que se mostrara en portales. En espacios no residenciales puede quedar en 0 o vacio.",
    details: [
      "Acepta solo numeros enteros.",
      "Rango permitido: 0 a 99.",
      "No acepta decimales ni texto.",
    ],
  },
  banos_comercial: {
    title: "Banos",
    summary:
      "Cantidad de banos publicable. Puedes usar medios banos cuando aplique.",
    details: [
      "Acepta numeros de 0 a 99 en incrementos de 0.5.",
      "Ejemplos validos: 1, 1.5, 2.",
      "No acepta texto ni mas de un decimal.",
    ],
  },
  metros_cuadrados_comercial: {
    title: "Metros",
    summary:
      "Superficie aproximada del espacio para portales y busqueda comercial.",
    details: [
      "Acepta solo numeros positivos y hasta 2 decimales.",
      "Ejemplos validos: 75, 75.50.",
      "Si no tienes el dato, dejalo vacio en lugar de capturar texto.",
    ],
  },
  capacidad_maxima: {
    title: "Capacidad",
    summary:
      "Numero maximo recomendado de personas para usar el espacio de forma normal.",
    details: [
      "Acepta solo numeros enteros.",
      "Rango permitido: 0 a 999.",
      "Usalo para oficinas, consultorios, habitaciones compartidas o amenidades.",
    ],
  },
  amenidades: {
    title: "Amenidades",
    summary:
      "Servicios o caracteristicas visibles para el prospecto. Cada linea se guarda como una amenidad separada.",
    details: [
      "Acepta texto en varias lineas.",
      `Maximo ${MULTILINE_LIST_MAX_LENGTH} caracteres en total.`,
      "Recomendado: una amenidad por linea, por ejemplo Internet, Cocina, Lavanderia.",
    ],
  },
  reglas_publicas: {
    title: "Reglas publicas",
    summary:
      "Condiciones visibles antes de que una persona solicite el espacio. Ayuda a evitar malos entendidos.",
    details: [
      "Acepta texto en varias lineas.",
      `Maximo ${MULTILINE_LIST_MAX_LENGTH} caracteres en total.`,
      "Recomendado: una regla por linea, por ejemplo No fumar, No fiestas, Estancia minima definida.",
    ],
  },
  publicar_en_renta: {
    title: "Publicar en renta",
    summary:
      "Controla si este espacio queda disponible para ser tomado por el modulo de renta y canales conectados.",
    details: [
      "Activo: el espacio puede aparecer como publicable si completa los datos requeridos.",
      "Inactivo: conserva la ficha, pero evita publicarlo.",
    ],
  },
  amueblado: {
    title: "Amueblado",
    summary: "Indica si el espacio se entrega con mobiliario base para uso inmediato.",
    details: ["Sirve para filtrar y describir mejor la publicacion."],
  },
  internet_incluido: {
    title: "Internet",
    summary: "Marca si el servicio de internet esta incluido en la renta publicada.",
    details: ["Ayuda a evitar preguntas repetidas en canales de renta."],
  },
  agua_caliente: {
    title: "Agua caliente",
    summary: "Indica si el espacio cuenta con agua caliente disponible.",
    details: ["Aplica principalmente para habitaciones, suites, departamentos y consultorios."],
  },
  limpieza_incluida: {
    title: "Limpieza",
    summary: "Marca si la renta incluye algun servicio de limpieza.",
    details: ["Si la limpieza tiene frecuencia especifica, agregala tambien en la descripcion."],
  },
  estacionamiento: {
    title: "Estacionamiento",
    summary: "Indica si el espacio incluye cajon, lugar o acceso a estacionamiento.",
    details: ["Si tiene costo extra o cupo limitado, aclaralo en reglas publicas."],
  },
  admite_mascotas: {
    title: "Mascotas",
    summary: "Marca si el espacio admite mascotas bajo las reglas del negocio.",
    details: ["Si hay restricciones de tamano, deposito o limpieza, agregalas en reglas publicas."],
  },
  bano_privado: {
    title: "Bano privado",
    summary: "Indica si el bano es privado para este espacio y no compartido.",
    details: ["Es un dato importante para habitaciones, suites, consultorios y oficinas."],
  },
  balcon: {
    title: "Balcon",
    summary: "Marca si el espacio cuenta con balcon, terraza privada o salida exterior propia.",
    details: ["Puede aumentar el atractivo comercial de la publicacion."],
  },
} as const;

type CommercialInfoKey = keyof typeof commercialFieldInfo;
type CommercialFieldErrors = Partial<Record<keyof FormState, string>>;

const catalogInfo: Record<string, RentaInfoContent> = {
  panel: {
    eyebrow: "Espacios",
    title: "Fichas comerciales",
    summary:
      "Esta vista concentra los espacios que pueden alimentar publicaciones y canales de renta.",
    details: [
      "La ficha comercial vive sobre el espacio operativo: no cambia contratos ni ocupaciones.",
      "Un espacio listo normalmente necesita titulo, resumen, precio publicable, fotos y bandera de publicar en renta.",
      "Los filtros permiten encontrar espacios pendientes antes de enviarlos a canales o compartirlos con prospectos.",
    ],
  },
  metricas: {
    eyebrow: "Espacios",
    title: "Indicadores de fichas",
    summary:
      "Los contadores muestran el estado de preparacion comercial de tu inventario.",
    details: [
      "Espacios indica todo el inventario visible para renta.",
      "Fichas completas y pendientes se calculan con los datos minimos para publicar con calidad.",
      "Publicables son espacios marcados para renta; aun pueden requerir canal activo para salir a una plataforma.",
    ],
  },
  filtros: {
    eyebrow: "Espacios",
    title: "Filtros de revision",
    summary:
      "Los filtros ayudan a revisar el inventario por unidad, estatus operativo y calidad de ficha.",
    details: [
      "Usa Entidad cuando trabajes una propiedad concreta.",
      "Usa Estatus para separar disponibles, ocupados, reservados o mantenimiento.",
      "Usa Ficha para priorizar pendientes, completas o publicables antes de sincronizar.",
    ],
  },
  tabla: {
    eyebrow: "Espacios",
    title: "Tabla de espacios",
    summary:
      "Lista los espacios con su ficha resumida y los datos que mas impactan la publicacion.",
    details: [
      "La columna Faltantes te dice que falta para dejar el espacio listo.",
      "El boton Configurar abre la ficha completa con textos, fotos, precio y atributos publicos.",
      "Ordena por precio, fotos o faltantes cuando quieras depurar el inventario rapidamente.",
    ],
  },
  fotos: {
    eyebrow: "Ficha comercial",
    title: "Fotos del espacio",
    summary:
      "Las fotos son parte central de la ficha comercial y de la calidad de publicacion.",
    details: [
      "La primera foto funciona como portada en listados y canales.",
      "Puedes arrastrar para reordenar y BettERP optimiza imagenes grandes antes de subirlas.",
      "Mantener fotos claras reduce rechazos o baja calidad en portales externos.",
    ],
  },
};

function formatMoney(value: number) {
  return moneyFormatter.format(value || 0);
}

function formatBytes(value: number) {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)} MB`;
  }
  if (value >= 1_000) {
    return `${Math.round(value / 1_000)} KB`;
  }
  return `${value} B`;
}

function fileNameWithoutExtension(name: string) {
  return name.replace(/\.[^.]+$/, "") || "foto";
}

function resolvePhotoUrl(url: string | null | undefined) {
  const cleanUrl = (url || "").trim();
  if (!cleanUrl) {
    return null;
  }
  if (
    cleanUrl.startsWith("http://") ||
    cleanUrl.startsWith("https://") ||
    cleanUrl.startsWith("data:") ||
    cleanUrl.startsWith("blob:")
  ) {
    return cleanUrl;
  }
  if (cleanUrl.startsWith("//")) {
    return `https:${cleanUrl}`;
  }
  if (cleanUrl.startsWith("/")) {
    return `${BACKEND_MEDIA_BASE}${cleanUrl}`;
  }
  return `${BACKEND_MEDIA_BASE}/${cleanUrl}`;
}

function PhotoPreviewImage({
  src,
  alt,
  className,
  fallbackLabel = "Sin foto",
}: {
  src: string | null | undefined;
  alt: string;
  className: string;
  fallbackLabel?: string;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const resolvedUrl = resolvePhotoUrl(src);
    setPreviewUrl(null);
    setFailed(false);

    if (!resolvedUrl) {
      return;
    }
    if (!resolvedUrl.startsWith(API_BASE_URL)) {
      setPreviewUrl(resolvedUrl);
      return;
    }

    const controller = new AbortController();
    let objectUrl: string | null = null;

    fetch(resolvedUrl, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`No se pudo cargar la foto (${response.status}).`);
        }
        return response.blob();
      })
      .then((blob) => {
        if (controller.signal.aborted) {
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        setPreviewUrl(objectUrl);
      })
      .catch((error) => {
        if (controller.signal.aborted) {
          return;
        }
        console.error("Error cargando miniatura de renta:", error);
        setFailed(true);
      });

    return () => {
      controller.abort();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [src]);

  if (!previewUrl || failed) {
    return (
      <div className="flex h-full w-full items-center justify-center text-[10px] text-zinc-600">
        {failed ? "Sin vista" : fallbackLabel}
      </div>
    );
  }

  return <img src={previewUrl} alt={alt} className={className} />;
}

function isImageFile(file: File) {
  return (
    file.type.startsWith("image/") ||
    /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)
  );
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("No se pudo optimizar la imagen."));
          return;
        }
        resolve(blob);
      },
      type,
      quality
    );
  });
}

async function optimizeImageForUpload(file: File) {
  if (!isImageFile(file)) {
    throw new Error(`${file.name} no es una imagen valida.`);
  }

  const optimizableTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
  if (!optimizableTypes.has(file.type)) {
    return file;
  }

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
    const largestSide = Math.max(bitmap.width, bitmap.height);
    const scale = largestSide > MAX_PHOTO_EDGE ? MAX_PHOTO_EDGE / largestSide : 1;
    const shouldOptimize = scale < 1 || file.size > MAX_PHOTO_UPLOAD_BYTES;

    if (!shouldOptimize) {
      return file;
    }

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) {
      return file;
    }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await canvasToBlob(canvas, "image/jpeg", PHOTO_JPEG_QUALITY);
    if (blob.size >= file.size && scale === 1) {
      return file;
    }
    return new File([blob], `${fileNameWithoutExtension(file.name)}.jpg`, {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
  } catch (error) {
    console.warn("No se pudo optimizar la imagen, se subira original:", error);
    return file;
  } finally {
    bitmap?.close();
  }
}

function cleanPublicText(value: string, maxLength: number, preserveLines = false) {
  const clean = value.replace(/\|/g, " ");
  if (!preserveLines) {
    return clean.replace(/\s+/g, " ").slice(0, maxLength).trim();
  }
  const compactLines = clean
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim());
  const lines: string[] = [];
  let previousBlank = false;
  for (const line of compactLines) {
    if (!line) {
      if (!previousBlank && lines.length > 0) {
        lines.push("");
      }
      previousBlank = true;
      continue;
    }
    lines.push(line);
    previousBlank = false;
  }
  return lines.join("\n").slice(0, maxLength).trim();
}

function parseOptionalNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function sanitizeSingleLineText(value: string, maxLength: number) {
  return value.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").slice(0, maxLength);
}

function sanitizeMultilineText(value: string, maxLength: number) {
  return value.replace(/\r\n/g, "\n").replace(/\t/g, " ").slice(0, maxLength);
}

function sanitizeIntegerInput(value: string, maxLength = 3) {
  return value.replace(/\D/g, "").slice(0, maxLength);
}

function sanitizeDecimalInput(value: string, decimalPlaces = 2, integerPlaces = 7) {
  const normalized = value.replace(",", ".").replace(/[^\d.]/g, "");
  const [integerPart = "", ...decimalParts] = normalized.split(".");
  const integer = integerPart.replace(/^0+(?=\d)/, "").slice(0, integerPlaces);
  const decimal = decimalParts.join("").slice(0, decimalPlaces);
  if (normalized.includes(".")) {
    return `${integer || "0"}.${decimal}`;
  }
  return integer;
}

function validateOptionalDecimal(
  value: string,
  label: string,
  options: {
    min?: number;
    max?: number;
    decimalPlaces?: number;
    multipleOf?: number;
    allowZero?: boolean;
  } = {}
) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  const decimalPlaces = options.decimalPlaces ?? 2;
  const decimalPattern = new RegExp(`^\\d+(\\.\\d{0,${decimalPlaces}})?$`);
  if (!decimalPattern.test(trimmed)) {
    return `${label} solo acepta numeros y hasta ${decimalPlaces} decimales.`;
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    return `${label} debe ser un numero valido.`;
  }
  if (!options.allowZero && parsed <= 0) {
    return `${label} debe ser mayor a 0.`;
  }
  if (options.allowZero && parsed < 0) {
    return `${label} no puede ser negativo.`;
  }
  if (options.min !== undefined && parsed < options.min) {
    return `${label} debe ser mayor o igual a ${options.min}.`;
  }
  if (options.max !== undefined && parsed > options.max) {
    return `${label} no puede ser mayor a ${options.max}.`;
  }
  if (
    options.multipleOf &&
    Math.abs(parsed / options.multipleOf - Math.round(parsed / options.multipleOf)) >
      0.000001
  ) {
    return `${label} debe capturarse en incrementos de ${options.multipleOf}.`;
  }
  return "";
}

function validateOptionalInteger(
  value: string,
  label: string,
  { min = 0, max = 999 }: { min?: number; max?: number } = {}
) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (!/^\d+$/.test(trimmed)) {
    return `${label} solo acepta numeros enteros.`;
  }
  const parsed = Number(trimmed);
  if (parsed < min || parsed > max) {
    return `${label} debe estar entre ${min} y ${max}.`;
  }
  return "";
}

function validateCommercialForm(form: FormState): CommercialFieldErrors {
  const errors: CommercialFieldErrors = {};
  if (form.titulo_publico.trim().length > TITLE_MAX_LENGTH) {
    errors.titulo_publico = `Titulo publico no puede superar ${TITLE_MAX_LENGTH} caracteres.`;
  }
  if (form.resumen_publico.trim().length > SUMMARY_MAX_LENGTH) {
    errors.resumen_publico = `Resumen no puede superar ${SUMMARY_MAX_LENGTH} caracteres.`;
  }
  if (form.descripcion_publica.trim().length > DESCRIPTION_MAX_LENGTH) {
    errors.descripcion_publica = `Descripcion no puede superar ${DESCRIPTION_MAX_LENGTH} caracteres.`;
  }
  if (form.amenidades.length > MULTILINE_LIST_MAX_LENGTH) {
    errors.amenidades = `Amenidades no puede superar ${MULTILINE_LIST_MAX_LENGTH} caracteres.`;
  }
  if (form.reglas_publicas.length > MULTILINE_LIST_MAX_LENGTH) {
    errors.reglas_publicas = `Reglas publicas no puede superar ${MULTILINE_LIST_MAX_LENGTH} caracteres.`;
  }

  const rentaError = validateOptionalDecimal(form.renta_publica, "Renta publica", {
    min: 0.01,
    max: 9999999.99,
    decimalPlaces: 2,
  });
  if (rentaError) errors.renta_publica = rentaError;

  const recamarasError = validateOptionalInteger(form.recamaras_comercial, "Recamaras", {
    min: 0,
    max: 99,
  });
  if (recamarasError) errors.recamaras_comercial = recamarasError;

  const banosError = validateOptionalDecimal(form.banos_comercial, "Banos", {
    min: 0,
    max: 99,
    decimalPlaces: 1,
    multipleOf: 0.5,
    allowZero: true,
  });
  if (banosError) errors.banos_comercial = banosError;

  const metrosError = validateOptionalDecimal(
    form.metros_cuadrados_comercial,
    "Metros",
    {
      min: 0.01,
      max: 99999.99,
      decimalPlaces: 2,
    }
  );
  if (metrosError) errors.metros_cuadrados_comercial = metrosError;

  const capacidadError = validateOptionalInteger(form.capacidad_maxima, "Capacidad", {
    min: 0,
    max: 999,
  });
  if (capacidadError) errors.capacidad_maxima = capacidadError;

  return errors;
}

function readError(body: unknown, fallback: string) {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail?: unknown }).detail;
    if (typeof detail === "string" && detail.trim()) {
      return detail;
    }
    if (Array.isArray(detail) && detail.length > 0) {
      return detail
        .map((item) => {
          if (typeof item === "string") return item;
          if (item && typeof item === "object" && "msg" in item) {
            return String((item as { msg?: unknown }).msg || "");
          }
          return JSON.stringify(item);
        })
        .filter(Boolean)
        .join(" ");
    }
    if (detail && typeof detail === "object") {
      return JSON.stringify(detail);
    }
  }
  return fallback;
}

async function readApiBody<T>(response: Response, fallback: string) {
  const text = await response.text();
  if (!text.trim()) {
    return {} as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    return {
      detail: response.ok
        ? fallback
        : "El servidor no devolvio una respuesta valida. Es probable que el backend aun no tenga este endpoint desplegado o haya respondido con una pagina de error.",
    } as T;
  }
}

function buildLocalCopySuggestion(
  selected: EspacioRow,
  detail: EspacioDetalle | null,
  form: FormState
): EspacioCopySuggestion {
  const title = `${selected.entidad_nombre || "Unidad de negocio"} - ${selected.codigo}`;
  const features = [
    form.recamaras_comercial ? `${form.recamaras_comercial} recamara(s)` : "",
    form.banos_comercial ? `${form.banos_comercial} bano(s)` : "",
    form.metros_cuadrados_comercial ? `${form.metros_cuadrados_comercial} m2` : "",
    form.amenidades
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 3)
      .join(", "),
  ].filter(Boolean);
  const price = form.renta_publica
    ? ` con renta mensual de ${formatMoney(Number(form.renta_publica) || 0)}`
    : "";
  const featureText =
    features.length > 0 ? features.join(", ") : "servicios y condiciones claras";
  const typeText = detail?.tipo_nombre || selected.tipo_nombre || "espacio";
  const summary = `Renta un espacio tipo ${typeText.toLowerCase()} en ${
    selected.entidad_nombre || "la unidad seleccionada"
  } listo para ocuparse, con ${featureText}${price}.`;
  const description = `Renta un espacio en ${
    selected.entidad_nombre || "la unidad seleccionada"
  }; te va a encantar.

- Espacio ${selected.codigo} tipo ${typeText.toLowerCase()}, listo para ocuparse.
- Cuenta con ${featureText}.
${form.renta_publica ? `- Renta mensual: ${formatMoney(Number(form.renta_publica) || 0)}.` : ""}

Agenda una visita y conoce este espacio antes de que se ocupe.`;
  return {
    titulo_publico: cleanPublicText(title, 90),
    resumen_publico: cleanPublicText(summary, 180),
    descripcion_publica: cleanPublicText(description, 1000, true),
    fuente: "plantilla",
    mensaje: "Ficha sugerida con plantilla local.",
  };
}

function detailToRow(current: EspacioRow, detail: EspacioDetalle): EspacioRow {
  const activePhotos = detail.fotos.filter((photo) => resolvePhotoUrl(photo.url));
  return {
    ...current,
    entidad_id: detail.entidad_id,
    codigo: detail.codigo,
    estatus: detail.estatus,
    tipo_nombre: detail.tipo_nombre,
    renta_publicable: detail.renta_publicable,
    foto_count: activePhotos.length,
    foto_portada_url: resolvePhotoUrl(activePhotos[0]?.url) || null,
    titulo_publico: detail.titulo_publico,
    titulo_publico_resuelto: detail.titulo_publico_resuelto,
    resumen_publico: detail.resumen_publico,
    recamaras_publicables: detail.recamaras_publicables,
    banos_publicables: detail.banos_publicables,
    metros_publicables: detail.metros_publicables,
    publicar_en_renta: detail.publicar_en_renta,
  };
}

function statusClass(status: string) {
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

function missingFields(space: EspacioRow) {
  const missing: string[] = [];
  if (!space.publicar_en_renta) missing.push("renta desactivada");
  if (!space.resumen_publico) missing.push("resumen");
  if (space.renta_publicable <= 0) missing.push("precio");
  if (space.foto_count <= 0) missing.push("fotos");
  if (space.recamaras_publicables === null) missing.push("recamaras");
  if (space.banos_publicables === null) missing.push("banos");
  if (space.metros_publicables === null) missing.push("metros");
  return missing;
}

function isReady(space: EspacioRow) {
  return missingFields(space).length === 0;
}

function compareStrings(a: string, b: string, direction: SortDirection) {
  const value = a.localeCompare(b, "es", { sensitivity: "base", numeric: true });
  return direction === "asc" ? value : -value;
}

function compareNumbers(a: number, b: number, direction: SortDirection) {
  const value = a - b;
  return direction === "asc" ? value : -value;
}

function spaceLabel(space: EspacioRow) {
  return `${space.entidad_nombre || ""} ${space.codigo || ""}`.trim();
}

function spaceTitle(space: EspacioRow) {
  return space.titulo_publico || space.titulo_publico_resuelto || space.codigo;
}

function characteristicsCount(space: EspacioRow) {
  return [
    space.recamaras_publicables,
    space.banos_publicables,
    space.metros_publicables,
  ].filter((value) => value !== null && value !== undefined).length;
}

function sortSpaces(spaces: EspacioRow[], sortKey: SpaceSortKey, direction: SortDirection) {
  return [...spaces].sort((a, b) => {
    let result = 0;
    switch (sortKey) {
      case "espacio":
        result = compareStrings(spaceLabel(a), spaceLabel(b), direction);
        break;
      case "ficha":
        result = compareStrings(spaceTitle(a), spaceTitle(b), direction);
        break;
      case "precio":
        result = compareNumbers(a.renta_publicable || 0, b.renta_publicable || 0, direction);
        break;
      case "estatus":
        result = compareStrings(a.estatus || "", b.estatus || "", direction);
        break;
      case "caracteristicas":
        result = compareNumbers(characteristicsCount(a), characteristicsCount(b), direction);
        break;
      case "faltantes":
        result = compareNumbers(missingFields(a).length, missingFields(b).length, direction);
        break;
      case "fotos":
        result = compareNumbers(a.foto_count || 0, b.foto_count || 0, direction);
        break;
      default:
        result = 0;
    }
    return result || compareStrings(spaceLabel(a), spaceLabel(b), "asc");
  });
}

function detailToForm(detail: EspacioDetalle): FormState {
  return {
    titulo_publico: detail.titulo_publico || "",
    resumen_publico: detail.resumen_publico || "",
    descripcion_publica: detail.descripcion_publica || "",
    renta_publica: detail.renta_publica === null ? "" : String(detail.renta_publica),
    recamaras_comercial:
      detail.recamaras_comercial === null ? "" : String(detail.recamaras_comercial),
    banos_comercial:
      detail.banos_comercial === null ? "" : String(detail.banos_comercial),
    metros_cuadrados_comercial:
      detail.metros_cuadrados_comercial === null
        ? ""
        : String(detail.metros_cuadrados_comercial),
    capacidad_maxima:
      detail.capacidad_maxima === null ? "" : String(detail.capacidad_maxima),
    amenidades: (detail.amenidades || []).join("\n"),
    reglas_publicas: (detail.reglas_publicas || []).join("\n"),
    amueblado: detail.amueblado,
    internet_incluido: detail.internet_incluido,
    agua_caliente: detail.agua_caliente,
    limpieza_incluida: detail.limpieza_incluida,
    estacionamiento: detail.estacionamiento,
    admite_mascotas: detail.admite_mascotas,
    bano_privado: detail.bano_privado,
    balcon: detail.balcon,
    publicar_en_renta: detail.publicar_en_renta,
  };
}

function InfoButton({
  onClick,
  label = "Ver informacion del campo",
}: {
  onClick: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-cyan-500/40 bg-cyan-500/10 text-[11px] font-semibold text-cyan-200 transition-colors hover:bg-cyan-500/20"
    >
      i
    </button>
  );
}

function FieldLabel({
  label,
  infoKey,
  optional = true,
  onInfo,
}: {
  label: string;
  infoKey: CommercialInfoKey;
  optional?: boolean;
  onInfo: (key: CommercialInfoKey) => void;
}) {
  return (
    <span className="mb-2 flex flex-wrap items-center gap-2 text-sm text-zinc-300">
      <span>{label}</span>
      <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200">
        {optional ? "Opcional" : "Obligatorio"}
      </span>
      <span
        role="button"
        tabIndex={0}
        onClick={(event) => {
          event.preventDefault();
          onInfo(infoKey);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onInfo(infoKey);
          }
        }}
        aria-label={`Ver informacion de ${label}`}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-cyan-500/40 bg-cyan-500/10 text-[11px] font-semibold text-cyan-200 transition-colors hover:bg-cyan-500/20"
      >
        i
      </span>
    </span>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) {
    return null;
  }
  return <span className="mt-1 block text-xs text-rose-200">{message}</span>;
}

function Toggle({
  label,
  checked,
  onChange,
  infoKey,
  onInfo,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  infoKey?: CommercialInfoKey;
  onInfo?: (key: CommercialInfoKey) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-sm transition-colors ${
        checked
          ? "border-cyan-500/20 bg-cyan-500/10 text-cyan-200"
          : "border-zinc-800 bg-zinc-900 text-zinc-400"
      }`}
    >
      <span className="flex items-center gap-2">
        <span>{label}</span>
        {infoKey && onInfo ? (
          <span
            role="button"
            tabIndex={0}
            onClick={(event) => {
              event.stopPropagation();
              onInfo(infoKey);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                event.stopPropagation();
                onInfo(infoKey);
              }
            }}
            aria-label={`Ver informacion de ${label}`}
            className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-cyan-500/40 bg-cyan-500/10 text-[11px] font-semibold text-cyan-200 transition-colors hover:bg-cyan-500/20"
          >
            i
          </span>
        ) : null}
      </span>
      <span className={`h-2 w-2 rounded-full ${checked ? "bg-cyan-300" : "bg-zinc-600"}`} />
    </button>
  );
}

export default function RentaEspaciosCatalogoGlobal({
  entidades,
}: {
  entidades: Entidad[];
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [spaces, setSpaces] = useState<EspacioRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [entityFilter, setEntityFilter] = useState("TODAS");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("TODOS");
  const [infoFilter, setInfoFilter] = useState<InfoFilter>("PENDIENTES");
  const [sortKey, setSortKey] = useState<SpaceSortKey>("espacio");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [pageSize, setPageSize] =
    useState<(typeof PAGE_SIZE_OPTIONS)[number]>(25);
  const [currentPage, setCurrentPage] = useState(1);
  const [selected, setSelected] = useState<EspacioRow | null>(null);
  const [detail, setDetail] = useState<EspacioDetalle | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formErrors, setFormErrors] = useState<CommercialFieldErrors>({});
  const [infoModalKey, setInfoModalKey] = useState<CommercialInfoKey | null>(null);
  const [sectionInfoModal, setSectionInfoModal] =
    useState<RentaInfoContent | null>(null);
  const [saving, setSaving] = useState(false);
  const [generatingCopy, setGeneratingCopy] = useState(false);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [draggingPhotoId, setDraggingPhotoId] = useState<number | null>(null);
  const [draggingOverPhotoId, setDraggingOverPhotoId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const updateFormField = <Key extends keyof FormState>(
    field: Key,
    value: FormState[Key]
  ) => {
    setForm((current) => ({ ...current, [field]: value }));
    setFormErrors((current) => {
      if (!current[field]) {
        return current;
      }
      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  const openFieldInfo = (key: CommercialInfoKey) => {
    setInfoModalKey(key);
  };

  const loadSpaces = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${ESPACIOS_API_BASE}/renta/lista/`, {
        cache: "no-store",
      });
      const body = (await response.json()) as EspacioRow[] | { detail?: string };
      if (!response.ok) {
        throw new Error(readError(body, "No se pudo cargar el listado de espacios."));
      }
      setSpaces(body as EspacioRow[]);
    } catch (loadError) {
      console.error("Error cargando espacios de renta:", loadError);
      setError(
        loadError instanceof Error
          ? loadError.message
          : "No se pudo cargar el listado de espacios."
      );
      setSpaces([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSpaces();
  }, []);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const visibleSpaces = spaces.filter((space) => {
      if (entityFilter !== "TODAS" && String(space.entidad_id) !== entityFilter) {
        return false;
      }
      if (statusFilter !== "TODOS" && space.estatus !== statusFilter) {
        return false;
      }
      if (infoFilter === "COMPLETOS" && !isReady(space)) {
        return false;
      }
      if (infoFilter === "PENDIENTES" && isReady(space)) {
        return false;
      }
      if (infoFilter === "PUBLICABLES" && !space.publicar_en_renta) {
        return false;
      }
      if (!query) {
        return true;
      }

      return [
        space.codigo,
        space.entidad_nombre,
        space.tipo_nombre,
        space.titulo_publico,
        space.titulo_publico_resuelto,
        space.resumen_publico,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    });

    return sortSpaces(visibleSpaces, sortKey, sortDirection);
  }, [
    entityFilter,
    infoFilter,
    search,
    spaces,
    sortDirection,
    sortKey,
    statusFilter,
  ]);

  const summary = useMemo(() => {
    const complete = spaces.filter(isReady).length;
    return {
      total: spaces.length,
      complete,
      pending: spaces.length - complete,
      available: spaces.filter((space) => space.estatus === "DISPONIBLE").length,
      publishable: spaces.filter((space) => space.publicar_en_renta).length,
    };
  }, [spaces]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const pageStartIndex =
    filtered.length === 0 ? 0 : (safeCurrentPage - 1) * pageSize;
  const pageEndIndex = Math.min(pageStartIndex + pageSize, filtered.length);

  const paginatedRows = useMemo(
    () => filtered.slice(pageStartIndex, pageEndIndex),
    [filtered, pageEndIndex, pageStartIndex]
  );

  const visiblePageNumbers = useMemo(() => {
    const pages: number[] = [];
    const start = Math.max(
      1,
      Math.min(safeCurrentPage - 2, Math.max(totalPages - 4, 1))
    );
    const end = Math.min(totalPages, start + 4);

    for (let page = start; page <= end; page += 1) {
      pages.push(page);
    }

    return pages;
  }, [safeCurrentPage, totalPages]);

  const handleSort = useCallback(
    (nextKey: SpaceSortKey) => {
      if (sortKey === nextKey) {
        setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
        return;
      }

      setSortKey(nextKey);
      setSortDirection(
        nextKey === "precio" || nextKey === "fotos" || nextKey === "faltantes"
          ? "desc"
          : "asc"
      );
    },
    [sortKey]
  );

  const sortLabel = useCallback(
    (key: SpaceSortKey) => {
      if (sortKey !== key) {
        return "ORD";
      }

      return sortDirection === "asc" ? "ASC" : "DESC";
    },
    [sortDirection, sortKey]
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [
    entityFilter,
    infoFilter,
    pageSize,
    search,
    sortDirection,
    sortKey,
    statusFilter,
  ]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const openSpace = async (space: EspacioRow) => {
    setSelected(space);
    setDetail(null);
    setForm(emptyForm);
    setFormErrors({});
    setInfoModalKey(null);
    setError("");
    try {
      const response = await fetch(`${ESPACIOS_API_BASE}/espacios/${space.id}/detalle/`, {
        cache: "no-store",
      });
      const body = (await response.json()) as EspacioDetalle | { detail?: string };
      if (!response.ok) {
        throw new Error(readError(body, "No se pudo cargar la ficha del espacio."));
      }
      const nextDetail = body as EspacioDetalle;
      setDetail(nextDetail);
      setForm(detailToForm(nextDetail));
    } catch (detailError) {
      console.error("Error cargando ficha:", detailError);
      setError(
        detailError instanceof Error
          ? detailError.message
          : "No se pudo cargar la ficha del espacio."
      );
      setSelected(null);
    }
  };

  const closeModal = () => {
    setSelected(null);
    setDetail(null);
    setForm(emptyForm);
    setFormErrors({});
    setInfoModalKey(null);
  };

  const saveDetail = async () => {
    if (!selected) return;
    const validationErrors = validateCommercialForm(form);
    if (Object.keys(validationErrors).length > 0) {
      setFormErrors(validationErrors);
      setError("Revisa los campos marcados antes de guardar la ficha comercial.");
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
      const body = await readApiBody<
        | { mensaje?: string; space?: EspacioDetalle }
        | { detail?: string }
      >(response, "No se pudo guardar la ficha.");
      if (!response.ok) {
        throw new Error(readError(body, "No se pudo guardar la ficha."));
      }
      const savedSpace = (body as { space?: EspacioDetalle }).space;
      if (!savedSpace) {
        throw new Error("El servidor no confirmo la ficha guardada.");
      }
      const nextRow = detailToRow(selected, savedSpace);
      setSpaces((current) =>
        current.map((space) =>
          space.id === selected.id ? detailToRow(space, savedSpace) : space
        )
      );
      setSelected(nextRow);
      setDetail(savedSpace);
      setForm(detailToForm(savedSpace));
      setSuccess("Ficha comercial guardada.");
      window.setTimeout(() => setSuccess(""), 2600);
      closeModal();
    } catch (saveError) {
      console.error("Error guardando ficha:", saveError);
      setError(
        saveError instanceof Error ? saveError.message : "No se pudo guardar la ficha."
      );
    } finally {
      setSaving(false);
    }
  };

  const generateCommercialCopy = async () => {
    if (!selected) return;
    setGeneratingCopy(true);
    setError("");
    try {
      const response = await fetch(
        `${ESPACIOS_API_BASE}/espacios/${selected.id}/detalle/sugerir-textos/`,
        { method: "POST" }
      );
      const body = await readApiBody<
        | EspacioCopySuggestion
        | { detail?: string }
      >(response, "No se pudo generar la ficha comercial.");
      if (!response.ok) {
        const fallback = buildLocalCopySuggestion(selected, detail, form);
        setForm((current) => ({
          ...current,
          titulo_publico: fallback.titulo_publico || current.titulo_publico,
          resumen_publico: fallback.resumen_publico || current.resumen_publico,
          descripcion_publica:
            fallback.descripcion_publica || current.descripcion_publica,
        }));
        setSuccess(
          "No se pudo usar la IA del servidor. Se aplico una ficha base local para que puedas avanzar."
        );
        window.setTimeout(() => setSuccess(""), 4200);
        return;
      }
      const suggestionBody = body as EspacioCopySuggestion;
      const suggestion =
        suggestionBody.titulo_publico ||
        suggestionBody.resumen_publico ||
        suggestionBody.descripcion_publica
          ? suggestionBody
          : buildLocalCopySuggestion(selected, detail, form);
      setForm((current) => ({
        ...current,
        titulo_publico: suggestion.titulo_publico || current.titulo_publico,
        resumen_publico: suggestion.resumen_publico || current.resumen_publico,
        descripcion_publica:
          suggestion.descripcion_publica || current.descripcion_publica,
      }));
      setSuccess(
        suggestion.fuente === "openai"
          ? "Ficha sugerida con IA. Revisa y guarda los cambios."
          : "Ficha sugerida con plantilla. Revisa y guarda los cambios."
      );
      window.setTimeout(() => setSuccess(""), 3200);
    } catch (copyError) {
      console.error("Error generando ficha comercial:", copyError);
      const fallback = buildLocalCopySuggestion(selected, detail, form);
      setForm((current) => ({
        ...current,
        titulo_publico: fallback.titulo_publico || current.titulo_publico,
        resumen_publico: fallback.resumen_publico || current.resumen_publico,
        descripcion_publica:
          fallback.descripcion_publica || current.descripcion_publica,
      }));
      setSuccess(
        "No pude conectar con la IA del servidor. Se aplico una ficha base local para que puedas avanzar."
      );
      window.setTimeout(() => setSuccess(""), 4200);
    } finally {
      setGeneratingCopy(false);
    }
  };

  const reloadSelectedDetail = async (
    spaceId: number,
    options: { syncForm?: boolean } = {}
  ) => {
    const response = await fetch(`${ESPACIOS_API_BASE}/espacios/${spaceId}/detalle/`, {
      cache: "no-store",
    });
    const body = (await response.json()) as EspacioDetalle | { detail?: string };
    if (!response.ok) {
      throw new Error(readError(body, "No se pudo actualizar la ficha del espacio."));
    }
    const nextDetail = body as EspacioDetalle;
    setDetail(nextDetail);
    if (options.syncForm ?? true) {
      setForm(detailToForm(nextDetail));
    }
    setSpaces((current) =>
      current.map((space) =>
        space.id === spaceId ? detailToRow(space, nextDetail) : space
      )
    );
    setSelected((current) =>
      current && current.id === spaceId ? detailToRow(current, nextDetail) : current
    );
    return nextDetail;
  };

  const uploadPhotos = async (files: File[]) => {
    if (!selected || files.length === 0) return;
    const currentPhotoCount =
      detail?.fotos.filter((photo) => photo.activo !== false).length ??
      selected.foto_count;
    const availableSlots = MAX_SPACE_PHOTOS - currentPhotoCount;
    if (availableSlots <= 0) {
      setError(
        `Este espacio ya tiene ${MAX_SPACE_PHOTOS} fotos. Quita una foto antes de subir otra.`
      );
      return;
    }
    const imageFiles = files.filter(isImageFile);
    if (imageFiles.length === 0) {
      setError("Arrastra o selecciona archivos de imagen.");
      return;
    }
    const uploadableFiles = imageFiles.slice(0, availableSlots);
    const skippedByLimit = imageFiles.length - uploadableFiles.length;
    setUploadingPhotos(true);
    setError("");
    try {
      let optimizedCount = 0;
      for (const file of uploadableFiles) {
        const uploadFile = await optimizeImageForUpload(file);
        if (uploadFile !== file || uploadFile.size < file.size) {
          optimizedCount += 1;
        }
        const formData = new FormData();
        formData.append("file", uploadFile);
        formData.append("titulo", fileNameWithoutExtension(file.name));
        const response = await fetch(
          `${ESPACIOS_API_BASE}/espacios/${selected.id}/fotos/`,
          {
            method: "POST",
            body: formData,
          }
        );
        const body = await readApiBody<{ detail?: string }>(
          response,
          `No se pudo subir ${file.name}.`
        );
        if (!response.ok) {
          throw new Error(readError(body, `No se pudo subir ${file.name}.`));
        }
      }
      await reloadSelectedDetail(selected.id, { syncForm: false });
      const limitText =
        skippedByLimit > 0
          ? ` Solo se cargaron ${availableSlots} por el limite de ${MAX_SPACE_PHOTOS}.`
          : "";
      const optimizedText =
        optimizedCount > 0
          ? ` ${optimizedCount} foto${
              optimizedCount === 1 ? "" : "s"
            } se optimizaron antes de subir.`
          : "";
      setSuccess(`Fotos cargadas correctamente.${optimizedText}${limitText}`);
      window.setTimeout(() => setSuccess(""), 2600);
    } catch (uploadError) {
      console.error("Error subiendo fotos:", uploadError);
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "No se pudieron subir las fotos."
      );
    } finally {
      setUploadingPhotos(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const deletePhoto = async (photoId: number) => {
    if (!selected) return;
    setUploadingPhotos(true);
    setError("");
    try {
      const response = await fetch(`${ESPACIOS_API_BASE}/fotos/${photoId}/`, {
        method: "DELETE",
      });
      const body = await readApiBody<{ detail?: string }>(
        response,
        "No se pudo eliminar la foto."
      );
      if (!response.ok) {
        throw new Error(readError(body, "No se pudo eliminar la foto."));
      }
      await reloadSelectedDetail(selected.id, { syncForm: false });
      setSuccess("Foto eliminada correctamente.");
      window.setTimeout(() => setSuccess(""), 2600);
    } catch (deleteError) {
      console.error("Error eliminando foto:", deleteError);
      setError(
        deleteError instanceof Error ? deleteError.message : "No se pudo eliminar la foto."
      );
    } finally {
      setUploadingPhotos(false);
    }
  };

  const reorderPhotos = async (nextPhotos: EspacioPhoto[]) => {
    if (!selected || !detail) return;
    const previousDetail = detail;
    const nextDetail = { ...detail, fotos: nextPhotos };
    setDetail(nextDetail);
    setSpaces((current) =>
      current.map((space) =>
        space.id === selected.id ? detailToRow(space, nextDetail) : space
      )
    );
    setSelected((current) =>
      current && current.id === selected.id ? detailToRow(current, nextDetail) : current
    );
    setError("");
    try {
      const response = await fetch(
        `${ESPACIOS_API_BASE}/espacios/${selected.id}/fotos/reordenar/`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ foto_ids: nextPhotos.map((photo) => photo.id) }),
        }
      );
      const body = await readApiBody<
        { fotos?: EspacioPhoto[]; detail?: string } | { detail?: string }
      >(response, "No se pudo reordenar las fotos.");
      if (!response.ok) {
        throw new Error(readError(body, "No se pudo reordenar las fotos."));
      }
      const savedPhotos = (body as { fotos?: EspacioPhoto[] }).fotos;
      if (savedPhotos) {
        const savedDetail = { ...nextDetail, fotos: savedPhotos };
        setDetail(savedDetail);
        setSpaces((current) =>
          current.map((space) =>
            space.id === selected.id ? detailToRow(space, savedDetail) : space
          )
        );
        setSelected((current) =>
          current && current.id === selected.id
            ? detailToRow(current, savedDetail)
            : current
        );
      }
    } catch (reorderError) {
      console.error("Error reordenando fotos:", reorderError);
      setDetail(previousDetail);
      setSpaces((current) =>
        current.map((space) =>
          space.id === selected.id ? detailToRow(space, previousDetail) : space
        )
      );
      setSelected((current) =>
        current && current.id === selected.id
          ? detailToRow(current, previousDetail)
          : current
      );
      setError(
        reorderError instanceof Error
          ? reorderError.message
          : "No se pudo reordenar las fotos."
      );
    }
  };

  const movePhoto = (sourcePhotoId: number, targetPhotoId: number) => {
    if (!detail || sourcePhotoId === targetPhotoId) return;
    const nextPhotos = [...detail.fotos];
    const sourceIndex = nextPhotos.findIndex((photo) => photo.id === sourcePhotoId);
    const targetIndex = nextPhotos.findIndex((photo) => photo.id === targetPhotoId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const [movedPhoto] = nextPhotos.splice(sourceIndex, 1);
    nextPhotos.splice(targetIndex, 0, movedPhoto);
    void reorderPhotos(nextPhotos);
  };

  const handlePhotoFileDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (uploadingPhotos) return;
    const droppedFiles = Array.from(event.dataTransfer.files || []);
    if (droppedFiles.length > 0) {
      void uploadPhotos(droppedFiles);
    }
  };

  const handlePhotoDragStart = (
    event: DragEvent<HTMLDivElement>,
    photoId: number
  ) => {
    setDraggingPhotoId(photoId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(photoId));
  };

  const handlePhotoDrop = (event: DragEvent<HTMLDivElement>, targetPhotoId: number) => {
    event.preventDefault();
    event.stopPropagation();
    const draggedId =
      draggingPhotoId || Number(event.dataTransfer.getData("text/plain") || 0);
    setDraggingPhotoId(null);
    setDraggingOverPhotoId(null);
    if (draggedId) {
      movePhoto(draggedId, targetPhotoId);
    }
  };

  const activeInfo = infoModalKey ? commercialFieldInfo[infoModalKey] : null;

  return (
    <section className="page-section space-y-5">
      <RentaInfoModal
        info={sectionInfoModal}
        onClose={() => setSectionInfoModal(null)}
      />
      {success ? (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          {success}
        </div>
      ) : null}
      {error ? (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      ) : null}

      {activeInfo ? (
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-3xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-cyan-300">
                  Informacion del campo
                </p>
                <h3 className="mt-2 text-2xl font-bold text-white">
                  {activeInfo.title}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setInfoModalKey(null)}
                className="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-300 transition-colors hover:text-white"
              >
                Cerrar
              </button>
            </div>
            <p className="mt-5 text-sm leading-relaxed text-zinc-300">
              {activeInfo.summary}
            </p>
            <div className="mt-5 space-y-3">
              {activeInfo.details.map((detailText, index) => (
                <div
                  key={`${activeInfo.title}-${index}`}
                  className="rounded-2xl border border-zinc-800 bg-zinc-900/60 px-4 py-3 text-sm text-zinc-300"
                >
                  {detailText}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-3 border-b border-zinc-800 pb-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs uppercase tracking-[0.18em] text-cyan-300">
              Inventario comercial
            </p>
            <RentaInfoButton info={catalogInfo.panel} onOpen={setSectionInfoModal} />
          </div>
          <h2 className="mt-2 text-2xl font-bold text-white">
            Espacios y fichas publicables
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-zinc-500">
            Revisa que cada espacio tenga precio, textos, fotos y datos
            comerciales antes de publicarlo o enviarlo a canales conectados.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
          Indicadores
        </p>
        <RentaInfoButton info={catalogInfo.metricas} onOpen={setSectionInfoModal} />
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 px-3 py-2.5">
          <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Espacios</p>
          <p className="mt-1 text-xl font-semibold text-white">{summary.total}</p>
        </div>
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2.5">
          <p className="text-[10px] uppercase tracking-[0.18em] text-emerald-200/80">Disponibles</p>
          <p className="mt-1 text-xl font-semibold text-emerald-300">{summary.available}</p>
        </div>
        <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-3 py-2.5">
          <p className="text-[10px] uppercase tracking-[0.18em] text-cyan-200/80">Fichas completas</p>
          <p className="mt-1 text-xl font-semibold text-cyan-300">{summary.complete}</p>
        </div>
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2.5">
          <p className="text-[10px] uppercase tracking-[0.18em] text-amber-200/80">Pendientes</p>
          <p className="mt-1 text-xl font-semibold text-amber-300">{summary.pending}</p>
        </div>
        <div className="rounded-xl border border-blue-500/20 bg-blue-500/10 px-3 py-2.5">
          <p className="text-[10px] uppercase tracking-[0.18em] text-blue-200/80">Publicables</p>
          <p className="mt-1 text-xl font-semibold text-blue-300">{summary.publishable}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
          Filtros
        </p>
        <RentaInfoButton info={catalogInfo.filtros} onOpen={setSectionInfoModal} />
      </div>
      <div className="grid gap-3 lg:grid-cols-[1.2fr_0.8fr_0.8fr_0.8fr]">
        <div>
          <label className="text-xs uppercase tracking-[0.18em] text-zinc-500">
            Buscar
          </label>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Espacio, entidad, tipo o titulo..."
            className="mt-2 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-2.5 text-sm text-white outline-none placeholder:text-zinc-600 focus:ring-1 focus:ring-cyan-500"
          />
        </div>
        <div>
          <label className="text-xs uppercase tracking-[0.18em] text-zinc-500">
            Entidad
          </label>
          <select
            value={entityFilter}
            onChange={(event) => setEntityFilter(event.target.value)}
            className="mt-2 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
          >
            <option value="TODAS">Todas</option>
            {entidades.map((entidad) => (
              <option key={entidad.id} value={entidad.id}>
                {entidad.nombre_comercial}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs uppercase tracking-[0.18em] text-zinc-500">
            Estatus
          </label>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
            className="mt-2 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
          >
            <option value="TODOS">Todos</option>
            <option value="DISPONIBLE">Disponible</option>
            <option value="OCUPADO">Ocupado</option>
            <option value="RESERVADO">Reservado</option>
            <option value="MANTENIMIENTO">Mantenimiento</option>
          </select>
        </div>
        <div>
          <label className="text-xs uppercase tracking-[0.18em] text-zinc-500">
            Ficha
          </label>
          <select
            value={infoFilter}
            onChange={(event) => setInfoFilter(event.target.value as InfoFilter)}
            className="mt-2 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
          >
            <option value="TODOS">Todas</option>
            <option value="PENDIENTES">Con pendientes</option>
            <option value="COMPLETOS">Completas</option>
            <option value="PUBLICABLES">Publicables</option>
          </select>
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-white">Tabla de espacios</p>
              <RentaInfoButton info={catalogInfo.tabla} onOpen={setSectionInfoModal} />
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              {filtered.length === 0
                ? "Sin registros visibles"
                : `Mostrando ${pageStartIndex + 1}-${pageEndIndex} de ${
                    filtered.length
                  }`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={sortKey}
              onChange={(event) => setSortKey(event.target.value as SpaceSortKey)}
              className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
            >
              <option value="espacio">Orden: espacio</option>
              <option value="ficha">Orden: ficha</option>
              <option value="precio">Orden: precio</option>
              <option value="estatus">Orden: estatus</option>
              <option value="caracteristicas">Orden: caracteristicas</option>
              <option value="faltantes">Orden: faltantes</option>
              <option value="fotos">Orden: fotos</option>
            </select>
            <button
              type="button"
              onClick={() =>
                setSortDirection((current) => (current === "asc" ? "desc" : "asc"))
              }
              className="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 transition-colors hover:text-white"
            >
              {sortDirection === "asc" ? "Ascendente" : "Descendente"}
            </button>
            <select
              value={pageSize}
              onChange={(event) =>
                setPageSize(
                  Number(event.target.value) as (typeof PAGE_SIZE_OPTIONS)[number]
                )
              }
              className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
            >
              {PAGE_SIZE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option} filas
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-zinc-800">
        <table className="w-full min-w-[1040px] text-left text-sm text-zinc-300">
          <thead className="border-b border-zinc-800 bg-zinc-950/80 text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              {[
                ["espacio", "Espacio"],
                ["ficha", "Ficha"],
                ["precio", "Precio"],
                ["caracteristicas", "Caracteristicas"],
                ["faltantes", "Faltantes"],
              ].map(([key, label]) => (
                <th key={key} className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => handleSort(key as SpaceSortKey)}
                    className="flex items-center gap-2 text-left uppercase tracking-wide transition-colors hover:text-cyan-200"
                  >
                    {label}
                    <span className="rounded-full border border-zinc-700 px-1.5 py-0.5 text-[9px] text-zinc-500">
                      {sortLabel(key as SpaceSortKey)}
                    </span>
                  </button>
                </th>
              ))}
              <th className="px-4 py-3 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-zinc-500">
                  Cargando espacios...
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-zinc-500">
                  No hay espacios con esos filtros.
                </td>
              </tr>
            ) : (
              paginatedRows.map((space) => {
                const missing = missingFields(space);
                return (
                  <tr key={space.id} className="align-top hover:bg-zinc-900/40">
                    <td className="px-4 py-4">
                      <div className="flex gap-3">
                        <div className="h-12 w-12 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
                          {resolvePhotoUrl(space.foto_portada_url) ? (
                            <PhotoPreviewImage
                              src={space.foto_portada_url}
                              alt={space.codigo}
                              className="h-full w-full object-cover"
                              fallbackLabel="Sin foto"
                            />
                          ) : (
                            <div className="flex h-full items-center justify-center text-[10px] text-zinc-600">
                              Sin foto
                            </div>
                          )}
                        </div>
                        <div>
                          <p className="font-medium text-white">{space.codigo}</p>
                          <p className="mt-1 text-xs text-zinc-500">
                            {space.entidad_nombre || "Sin entidad"} |{" "}
                            {space.tipo_nombre || "Sin tipo"}
                          </p>
                          <span
                            className={`mt-2 inline-flex rounded-full border px-2 py-1 text-[11px] ${statusClass(
                              space.estatus
                            )}`}
                          >
                            {space.estatus}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <p className="font-medium text-white">
                        {space.titulo_publico || space.titulo_publico_resuelto}
                      </p>
                      <p className="mt-1 max-w-xs text-xs text-zinc-500">
                        {space.resumen_publico || "Sin resumen comercial."}
                      </p>
                    </td>
                    <td className="px-4 py-4">
                      <p className="font-medium text-white">
                        {formatMoney(space.renta_publicable)}
                      </p>
                      <p className="mt-1 text-xs text-zinc-500">
                        {space.foto_count} fotos
                      </p>
                    </td>
                    <td className="px-4 py-4 text-xs text-zinc-400">
                      <p>{space.recamaras_publicables ?? "-"} recamaras</p>
                      <p className="mt-1">{space.banos_publicables ?? "-"} banos</p>
                      <p className="mt-1">{space.metros_publicables ?? "-"} m2</p>
                    </td>
                    <td className="px-4 py-4">
                      {missing.length === 0 ? (
                        <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-300">
                          Completa
                        </span>
                      ) : (
                        <div className="flex max-w-xs flex-wrap gap-1">
                          {missing.slice(0, 4).map((item) => (
                            <span
                              key={item}
                              className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-400"
                            >
                              {item}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-4 text-right">
                      <button
                        type="button"
                        onClick={() => void openSpace(space)}
                        className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-3 py-2 text-sm font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20"
                      >
                        Configurar
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {!loading && filtered.length > 0 ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-zinc-800 bg-zinc-950/60 px-4 py-3 text-sm text-zinc-400 lg:flex-row lg:items-center lg:justify-between">
          <span>
            Pagina {safeCurrentPage} de {totalPages}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setCurrentPage(1)}
              disabled={safeCurrentPage <= 1}
              className="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              Inicio
            </button>
            <button
              type="button"
              onClick={() => setCurrentPage((current) => Math.max(1, current - 1))}
              disabled={safeCurrentPage <= 1}
              className="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              Anterior
            </button>
            {visiblePageNumbers.map((page) => (
              <button
                key={page}
                type="button"
                onClick={() => setCurrentPage(page)}
                className={`min-w-10 rounded-xl border px-3 py-2 transition-colors ${
                  page === safeCurrentPage
                    ? "border-cyan-500/30 bg-cyan-500/15 text-cyan-200"
                    : "border-zinc-800 bg-zinc-900 hover:text-white"
                }`}
              >
                {page}
              </button>
            ))}
            <button
              type="button"
              onClick={() =>
                setCurrentPage((current) => Math.min(totalPages, current + 1))
              }
              disabled={safeCurrentPage >= totalPages}
              className="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              Siguiente
            </button>
            <button
              type="button"
              onClick={() => setCurrentPage(totalPages)}
              disabled={safeCurrentPage >= totalPages}
              className="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              Final
            </button>
            <label className="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-zinc-500">
              Ir a
              <input
                type="number"
                min={1}
                max={totalPages}
                value={safeCurrentPage}
                onChange={(event) => {
                  const nextPage = Number(event.target.value);
                  if (Number.isFinite(nextPage)) {
                    setCurrentPage(Math.min(totalPages, Math.max(1, nextPage)));
                  }
                }}
                className="w-20 rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
              />
            </label>
          </div>
        </div>
      ) : null}

      {selected ? (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm">
          <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-950 shadow-2xl">
            <div className="flex flex-col gap-4 border-b border-zinc-800 px-6 py-5 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-cyan-300">
                  Ficha comercial
                </p>
                <h3 className="mt-1 text-2xl font-bold text-white">
                  {selected.entidad_nombre || "Unidad de negocio"} - {selected.codigo}
                </h3>
                <p className="mt-1 text-sm text-zinc-500">
                  {selected.tipo_nombre || "Sin tipo"} | {selected.estatus}
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => void generateCommercialCopy()}
                  disabled={!detail || generatingCopy}
                  className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-3 py-2 text-sm font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20 disabled:opacity-50"
                >
                  {generatingCopy ? "Generando..." : "Generar ficha con IA"}
                </button>
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-400 transition-colors hover:text-white"
                >
                  Cerrar
                </button>
              </div>
            </div>

            <div className="overflow-y-auto px-6 py-5">
              {!detail ? (
                <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 py-16 text-center text-zinc-500">
                  Cargando ficha...
                </div>
              ) : (
                <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
                      <div className="grid gap-4 md:grid-cols-2">
                        <label className="text-sm text-zinc-300">
                          <FieldLabel
                            label="Titulo publico"
                            infoKey="titulo_publico"
                            onInfo={openFieldInfo}
                          />
                          <input
                            value={form.titulo_publico}
                            onChange={(event) =>
                              updateFormField(
                                "titulo_publico",
                                sanitizeSingleLineText(
                                  event.target.value,
                                  TITLE_MAX_LENGTH
                                )
                              )
                            }
                            maxLength={TITLE_MAX_LENGTH}
                            className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                            placeholder={detail.titulo_publico_resuelto}
                          />
                          <span className="mt-1 block text-xs text-zinc-500">
                            Texto comercial, maximo {TITLE_MAX_LENGTH} caracteres.
                          </span>
                          <FieldError message={formErrors.titulo_publico} />
                        </label>
                        <label className="text-sm text-zinc-300">
                          <FieldLabel
                            label="Renta publica"
                            infoKey="renta_publica"
                            onInfo={openFieldInfo}
                          />
                          <input
                            type="text"
                            inputMode="decimal"
                            value={form.renta_publica}
                            onChange={(event) =>
                              updateFormField(
                                "renta_publica",
                                sanitizeDecimalInput(event.target.value, 2, 7)
                              )
                            }
                            className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                            placeholder={String(detail.renta_sugerida || 0)}
                          />
                          <span className="mt-1 block text-xs text-zinc-500">
                            Solo dinero positivo; hasta 2 decimales.
                          </span>
                          <FieldError message={formErrors.renta_publica} />
                        </label>
                        <label className="md:col-span-2 text-sm text-zinc-300">
                          <FieldLabel
                            label="Resumen"
                            infoKey="resumen_publico"
                            onInfo={openFieldInfo}
                          />
                          <input
                            value={form.resumen_publico}
                            onChange={(event) =>
                              updateFormField(
                                "resumen_publico",
                                sanitizeSingleLineText(
                                  event.target.value,
                                  SUMMARY_MAX_LENGTH
                                )
                              )
                            }
                            maxLength={SUMMARY_MAX_LENGTH}
                            className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                            placeholder="Resumen corto para portales y busqueda."
                          />
                          <span className="mt-1 block text-xs text-zinc-500">
                            Una linea, maximo {SUMMARY_MAX_LENGTH} caracteres.
                          </span>
                          <FieldError message={formErrors.resumen_publico} />
                        </label>
                        <label className="md:col-span-2 text-sm text-zinc-300">
                          <FieldLabel
                            label="Descripcion"
                            infoKey="descripcion_publica"
                            onInfo={openFieldInfo}
                          />
                          <textarea
                            rows={7}
                            value={form.descripcion_publica}
                            onChange={(event) =>
                              updateFormField(
                                "descripcion_publica",
                                sanitizeMultilineText(
                                  event.target.value,
                                  DESCRIPTION_MAX_LENGTH
                                )
                              )
                            }
                            maxLength={DESCRIPTION_MAX_LENGTH}
                            className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                            placeholder="Descripcion clara del espacio, servicios y condiciones principales."
                          />
                          <span className="mt-1 block text-xs text-zinc-500">
                            Texto visible para prospectos, maximo{" "}
                            {DESCRIPTION_MAX_LENGTH} caracteres.
                          </span>
                          <FieldError message={formErrors.descripcion_publica} />
                        </label>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
                      <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
                        Datos para plataformas
                      </p>
                      <div className="mt-4 grid gap-4 md:grid-cols-4">
                        <label className="text-sm text-zinc-300">
                          <FieldLabel
                            label="Recamaras"
                            infoKey="recamaras_comercial"
                            onInfo={openFieldInfo}
                          />
                          <input
                            type="text"
                            inputMode="numeric"
                            value={form.recamaras_comercial}
                            onChange={(event) =>
                              updateFormField(
                                "recamaras_comercial",
                                sanitizeIntegerInput(event.target.value, 2)
                              )
                            }
                            className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                          />
                          <span className="mt-1 block text-xs text-zinc-500">
                            Solo enteros de 0 a 99.
                          </span>
                          <FieldError message={formErrors.recamaras_comercial} />
                        </label>
                        <label className="text-sm text-zinc-300">
                          <FieldLabel
                            label="Banos"
                            infoKey="banos_comercial"
                            onInfo={openFieldInfo}
                          />
                          <input
                            type="text"
                            inputMode="decimal"
                            value={form.banos_comercial}
                            onChange={(event) =>
                              updateFormField(
                                "banos_comercial",
                                sanitizeDecimalInput(event.target.value, 1, 2)
                              )
                            }
                            className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                          />
                          <span className="mt-1 block text-xs text-zinc-500">
                            Enteros o medios banos: 0, 1, 1.5, 2.
                          </span>
                          <FieldError message={formErrors.banos_comercial} />
                        </label>
                        <label className="text-sm text-zinc-300">
                          <FieldLabel
                            label="Metros"
                            infoKey="metros_cuadrados_comercial"
                            onInfo={openFieldInfo}
                          />
                          <input
                            type="text"
                            inputMode="decimal"
                            value={form.metros_cuadrados_comercial}
                            onChange={(event) =>
                              updateFormField(
                                "metros_cuadrados_comercial",
                                sanitizeDecimalInput(event.target.value, 2, 5)
                              )
                            }
                            className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                          />
                          <span className="mt-1 block text-xs text-zinc-500">
                            Solo numeros positivos; hasta 2 decimales.
                          </span>
                          <FieldError
                            message={formErrors.metros_cuadrados_comercial}
                          />
                        </label>
                        <label className="text-sm text-zinc-300">
                          <FieldLabel
                            label="Capacidad"
                            infoKey="capacidad_maxima"
                            onInfo={openFieldInfo}
                          />
                          <input
                            type="text"
                            inputMode="numeric"
                            value={form.capacidad_maxima}
                            onChange={(event) =>
                              updateFormField(
                                "capacidad_maxima",
                                sanitizeIntegerInput(event.target.value, 3)
                              )
                            }
                            className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                          />
                          <span className="mt-1 block text-xs text-zinc-500">
                            Solo enteros de 0 a 999.
                          </span>
                          <FieldError message={formErrors.capacidad_maxima} />
                        </label>
                      </div>

                      <div className="mt-4 grid gap-2 md:grid-cols-3">
                        <Toggle
                          label="Publicar en renta"
                          checked={form.publicar_en_renta}
                          onChange={(next) =>
                            updateFormField("publicar_en_renta", next)
                          }
                          infoKey="publicar_en_renta"
                          onInfo={openFieldInfo}
                        />
                        <Toggle
                          label="Amueblado"
                          checked={form.amueblado}
                          onChange={(next) => updateFormField("amueblado", next)}
                          infoKey="amueblado"
                          onInfo={openFieldInfo}
                        />
                        <Toggle
                          label="Internet"
                          checked={form.internet_incluido}
                          onChange={(next) =>
                            updateFormField("internet_incluido", next)
                          }
                          infoKey="internet_incluido"
                          onInfo={openFieldInfo}
                        />
                        <Toggle
                          label="Agua caliente"
                          checked={form.agua_caliente}
                          onChange={(next) => updateFormField("agua_caliente", next)}
                          infoKey="agua_caliente"
                          onInfo={openFieldInfo}
                        />
                        <Toggle
                          label="Limpieza"
                          checked={form.limpieza_incluida}
                          onChange={(next) =>
                            updateFormField("limpieza_incluida", next)
                          }
                          infoKey="limpieza_incluida"
                          onInfo={openFieldInfo}
                        />
                        <Toggle
                          label="Estacionamiento"
                          checked={form.estacionamiento}
                          onChange={(next) => updateFormField("estacionamiento", next)}
                          infoKey="estacionamiento"
                          onInfo={openFieldInfo}
                        />
                        <Toggle
                          label="Mascotas"
                          checked={form.admite_mascotas}
                          onChange={(next) => updateFormField("admite_mascotas", next)}
                          infoKey="admite_mascotas"
                          onInfo={openFieldInfo}
                        />
                        <Toggle
                          label="Bano privado"
                          checked={form.bano_privado}
                          onChange={(next) => updateFormField("bano_privado", next)}
                          infoKey="bano_privado"
                          onInfo={openFieldInfo}
                        />
                        <Toggle
                          label="Balcon"
                          checked={form.balcon}
                          onChange={(next) => updateFormField("balcon", next)}
                          infoKey="balcon"
                          onInfo={openFieldInfo}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
                      <div className="mb-3 flex items-center gap-2">
                        <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
                          Amenidades
                        </p>
                        <InfoButton
                          onClick={() => openFieldInfo("amenidades")}
                          label="Ver informacion de Amenidades"
                        />
                      </div>
                      <textarea
                        rows={8}
                        value={form.amenidades}
                        onChange={(event) =>
                          updateFormField(
                            "amenidades",
                            sanitizeMultilineText(
                              event.target.value,
                              MULTILINE_LIST_MAX_LENGTH
                            )
                          )
                        }
                        maxLength={MULTILINE_LIST_MAX_LENGTH}
                        className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                        placeholder={"Internet\nCocina\nLavanderia"}
                      />
                      <span className="mt-1 block text-xs text-zinc-500">
                        Una amenidad por linea, maximo{" "}
                        {MULTILINE_LIST_MAX_LENGTH} caracteres.
                      </span>
                      <FieldError message={formErrors.amenidades} />
                    </div>
                    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
                      <div className="mb-3 flex items-center gap-2">
                        <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
                          Reglas publicas
                        </p>
                        <InfoButton
                          onClick={() => openFieldInfo("reglas_publicas")}
                          label="Ver informacion de Reglas publicas"
                        />
                      </div>
                      <textarea
                        rows={8}
                        value={form.reglas_publicas}
                        onChange={(event) =>
                          updateFormField(
                            "reglas_publicas",
                            sanitizeMultilineText(
                              event.target.value,
                              MULTILINE_LIST_MAX_LENGTH
                            )
                          )
                        }
                        maxLength={MULTILINE_LIST_MAX_LENGTH}
                        className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                        placeholder={"No fumar\nNo fiestas\nEstancia minima definida"}
                      />
                      <span className="mt-1 block text-xs text-zinc-500">
                        Una regla por linea, maximo {MULTILINE_LIST_MAX_LENGTH} caracteres.
                      </span>
                      <FieldError message={formErrors.reglas_publicas} />
                    </div>
                    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
                            Fotos
                          </p>
                          <p className="mt-1 text-xs text-zinc-500">
                            {detail.fotos.length}/{MAX_SPACE_PHOTOS} cargadas
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={uploadingPhotos || detail.fotos.length >= MAX_SPACE_PHOTOS}
                          className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-3 py-2 text-xs font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20 disabled:opacity-50"
                        >
                          {uploadingPhotos ? "Procesando..." : "Agregar fotos"}
                        </button>
                        <input
                          ref={fileInputRef}
                          type="file"
                          multiple
                          accept="image/*"
                          onChange={(event) =>
                            void uploadPhotos(Array.from(event.target.files || []))
                          }
                          className="hidden"
                        />
                      </div>
                      <div
                        onDragOver={(event) => {
                          event.preventDefault();
                          event.dataTransfer.dropEffect = "copy";
                        }}
                        onDrop={handlePhotoFileDrop}
                        className="mt-3 rounded-2xl border border-dashed border-zinc-700 bg-zinc-950/70 p-3 transition-colors hover:border-cyan-500/40"
                      >
                        <div className="flex flex-col gap-2 text-xs text-zinc-500 sm:flex-row sm:items-center sm:justify-between">
                          <span className="flex flex-wrap items-center gap-2">
                            <span>
                              Arrastra imagenes aqui o usa el boton. Maximo{" "}
                              {MAX_SPACE_PHOTOS} fotos.
                            </span>
                            <RentaInfoButton
                              info={catalogInfo.fotos}
                              onOpen={setSectionInfoModal}
                            />
                          </span>
                          <span className="rounded-full border border-zinc-800 px-2 py-1 text-zinc-400">
                            Primera foto = principal
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-zinc-600">
                          Si una foto pesa mas de {formatBytes(MAX_PHOTO_UPLOAD_BYTES)} o
                          supera {MAX_PHOTO_EDGE}px, se optimiza antes de subir.
                        </p>
                        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                          {detail.fotos.length === 0 ? (
                            <div className="col-span-2 rounded-xl border border-dashed border-zinc-800 py-8 text-center text-sm text-zinc-500 sm:col-span-4">
                              Suelta tus fotos aqui. La primera sera la portada.
                            </div>
                          ) : (
                            detail.fotos.map((photo, index) => {
                              const photoUrl = resolvePhotoUrl(photo.url);
                              return (
                                <div
                                  key={photo.id}
                                  draggable
                                  onDragStart={(event) =>
                                    handlePhotoDragStart(event, photo.id)
                                  }
                                  onDragOver={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    event.dataTransfer.dropEffect = "move";
                                    setDraggingOverPhotoId(photo.id);
                                  }}
                                  onDragLeave={() => {
                                    setDraggingOverPhotoId((current) =>
                                      current === photo.id ? null : current
                                    );
                                  }}
                                  onDrop={(event) => handlePhotoDrop(event, photo.id)}
                                  onDragEnd={() => {
                                    setDraggingPhotoId(null);
                                    setDraggingOverPhotoId(null);
                                  }}
                                  title="Arrastra para reordenar"
                                  className={`group relative aspect-[4/3] cursor-move overflow-hidden rounded-xl border bg-zinc-950 transition-all ${
                                    draggingPhotoId === photo.id
                                      ? "scale-[0.98] border-cyan-400 opacity-60"
                                      : draggingOverPhotoId === photo.id
                                        ? "border-cyan-400"
                                        : "border-zinc-800"
                                  }`}
                                >
                                  {photoUrl ? (
                                    <PhotoPreviewImage
                                      src={photoUrl}
                                      alt={photo.titulo || selected.codigo}
                                      className="h-full w-full object-cover"
                                      fallbackLabel="Sin vista"
                                    />
                                  ) : (
                                    <div className="flex h-full items-center justify-center text-xs text-zinc-600">
                                      Sin vista
                                    </div>
                                  )}
                                  <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-2">
                                    <span
                                      className={`max-w-[72%] truncate rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] shadow-lg ${
                                        index === 0
                                          ? "bg-cyan-500/90 text-zinc-950"
                                          : "bg-zinc-950/80 text-zinc-300"
                                      }`}
                                    >
                                      {index === 0 ? "Principal" : `Foto ${index + 1}`}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        void deletePhoto(photo.id);
                                      }}
                                      disabled={uploadingPhotos}
                                      className="pointer-events-auto rounded-full border border-red-500/30 bg-red-500/90 px-2 py-1 text-[10px] font-medium text-white opacity-0 shadow-lg transition-opacity hover:bg-red-500 disabled:opacity-40 group-hover:opacity-100"
                                    >
                                      Quitar
                                    </button>
                                  </div>
                                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2 pb-2 pt-8 text-[10px] text-zinc-200 opacity-0 transition-opacity group-hover:opacity-100">
                                    {photo.titulo || "Arrastra para cambiar orden."}
                                  </div>
                                </div>
                              );
                            })
                          )}
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
                disabled={saving || !detail || generatingCopy}
                className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-2.5 text-sm font-medium text-emerald-200 transition-colors hover:bg-emerald-500/20 disabled:opacity-50"
              >
                {saving ? "Guardando..." : "Guardar ficha"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
