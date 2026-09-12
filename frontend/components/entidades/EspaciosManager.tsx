"use client";

import { buildApiUrl } from '@/lib/api';

import { type FormEvent, useEffect, useMemo, useState } from "react";

const ESPACIOS_API_BASE = buildApiUrl("/espacios");

interface TipoEspacio {
  id: number;
  nombre: string;
  descripcion: string | null;
  renta_base: number;
  deposito_base: number;
  recamaras: number | null;
  banos: number | null;
  metros_cuadrados: number | null;
  espacios_count: number;
  activo: boolean;
}

interface Espacio {
  id: number;
  codigo: string;
  estatus: string;
  tipo_id: number | null;
  tipo_nombre: string | null;
  renta_sugerida: number;
  deposito_sugerido: number;
  cliente_actual_id: number | null;
  cliente_actual_nombre: string | null;
  asignacion_activa_id: number | null;
  ocupacion_desde: string | null;
  periodicidad_cobro: string | null;
  dia_vencimiento: number | null;
  plazo_meses: number | null;
  fecha_fin_programada: string | null;
  auto_renueva: boolean;
  observaciones: string | null;
}

interface ClienteAsignable {
  id: number;
  nombre: string;
  rfc: string;
}

interface EspaciosManagerProps {
  entidadId?: string;
  viewMode?: "inventario" | "operacion" | "all";
}

interface TipoFormState {
  nombre: string;
  descripcion: string;
  renta_base: string;
  deposito_base: string;
  recamaras: string;
  banos: string;
  metros_cuadrados: string;
  activo: boolean;
}

interface QuickSpaceTemplate {
  key: string;
  nombre: string;
  descripcion: string;
  prefijo: string;
  tipoId: number | null;
  espaciosCount: number;
  rentaBase: number;
  exists: boolean;
  activo: boolean;
}

interface QuickSpaceDraft {
  selected: boolean;
  quantity: string;
  prefix?: string;
}

type TipoModalMode = "CREATE" | "EDIT";
type TipoFormErrors = Partial<Record<keyof TipoFormState, string>>;

interface FieldInfo {
  title: string;
  body: string;
  details?: string[];
}

interface AsignacionFormState {
  cliente_id: string;
  fecha_inicio: string;
  fecha_fin_programada: string;
  periodicidad_cobro: string;
  dia_vencimiento: string;
  plazo_meses: string;
  auto_renueva: string;
  renta_pactada: string;
  deposito_pactado: string;
  observaciones: string;
}

interface FinalizacionFormState {
  fecha_fin: string;
  observaciones: string;
}

const EMPTY_TIPO_FORM: TipoFormState = {
  nombre: "",
  descripcion: "",
  renta_base: "",
  deposito_base: "",
  recamaras: "",
  banos: "",
  metros_cuadrados: "",
  activo: true,
};

const moneyFormatter = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  minimumFractionDigits: 2,
});

const TIPO_FIELD_INFO = {
  nombre: {
    title: "Nombre del tipo",
    body:
      "Nombre operativo de la plantilla que agrupa espacios similares dentro de esta entidad. Se usa para clasificar inventario, sugerir rentas y crear espacios en bloque.",
    details: [
      "Obligatorio.",
      "Debe tener entre 3 y 150 caracteres.",
      "Debe incluir texto real; no se aceptan nombres formados solo por numeros.",
      "Ejemplos utiles: Habitacion, Suite, Penthouse, Oficina privada, Local comercial.",
    ],
  },
  descripcion: {
    title: "Descripcion corta",
    body:
      "Nota interna para que el equipo entienda que representa este tipo sin abrir cada espacio. No reemplaza las observaciones de un espacio individual.",
    details: [
      "Opcional.",
      "Maximo 250 caracteres.",
      "Usala para resumir distribucion, uso o diferencias importantes del tipo.",
      "Ejemplo: Cuarto estandar con bano privado o Unidad premium para estancia extendida.",
    ],
  },
  renta_base: {
    title: "Renta base",
    body:
      "Monto sugerido que heredaran los espacios creados con este tipo. Sirve como referencia operativa; el contrato o asignacion puede manejar una renta pactada distinta cuando sea necesario.",
    details: [
      "Opcional; si queda vacio se guarda como 0.",
      "Solo acepta numeros positivos y hasta 2 decimales.",
      "No escribas simbolos de moneda ni comas; usa 15000.00 en lugar de $15,000.",
      "Maximo permitido: 99,999,999.99.",
    ],
  },
  deposito_base: {
    title: "Deposito base",
    body:
      "Monto de deposito sugerido para los espacios de este tipo. Ayuda a estandarizar altas nuevas sin capturar el deposito desde cero cada vez.",
    details: [
      "Opcional; si queda vacio se guarda como 0.",
      "Solo acepta numeros positivos y hasta 2 decimales.",
      "No escribas simbolos de moneda ni comas.",
      "Puede ser distinto a la renta base si tu politica comercial lo requiere.",
    ],
  },
  recamaras: {
    title: "Recamaras",
    body:
      "Cantidad de recamaras sugerida para este tipo. Es una caracteristica descriptiva del inventario, util para filtrar y comparar espacios.",
    details: [
      "Opcional.",
      "Solo acepta numeros enteros de 0 a 99.",
      "No acepta texto ni decimales.",
      "Para tipos sin recamaras, como estacionamiento o bodega, puedes dejarlo vacio.",
    ],
  },
  banos: {
    title: "Banos",
    body:
      "Cantidad de banos de referencia para este tipo de espacio. Permite enteros y medios banos para reflejar inventario residencial, hotelero o comercial.",
    details: [
      "Opcional.",
      "Acepta valores enteros o medios, por ejemplo 1, 1.5 o 2.",
      "No acepta otros decimales como 1.25.",
      "Maximo permitido: 99.5.",
    ],
  },
  metros_cuadrados: {
    title: "Metros cuadrados",
    body:
      "Superficie aproximada que describe el tipo de espacio. Es una referencia de catalogo, no una medicion fiscal ni contractual obligatoria.",
    details: [
      "Opcional.",
      "Acepta numeros positivos con hasta 2 decimales.",
      "No acepta texto, unidades ni simbolos; captura 75.50, no 75.50 m2.",
      "Maximo permitido: 999,999.99.",
    ],
  },
  activo: {
    title: "Tipo activo",
    body:
      "Controla si esta plantilla puede usarse para nuevas altas. Desactivar un tipo no borra espacios existentes ni afecta el historial.",
    details: [
      "Activo: aparece disponible para crear o clasificar espacios nuevos.",
      "Inactivo: se conserva como referencia, pero no se recomienda para nuevas operaciones.",
      "Usalo cuando ya no quieres crear mas espacios con una plantilla vieja.",
    ],
  },
  prefijo: {
    title: "Prefijo",
    body:
      "Referencia que BetterP coloca antes del consecutivo al crear espacios desde las tarjetas. Ayuda a que los codigos queden claros para operacion.",
    details: [
      "Opcional, pero recomendable para inventarios grandes.",
      "Maximo 16 caracteres.",
      "Acepta letras, numeros, espacios, guion y diagonal.",
      "Ejemplos: HAB-, TORRE-A-, S1-, LOC/. Si lo dejas vacio, los codigos quedan solo con numero.",
    ],
  },
} satisfies Record<string, FieldInfo>;

const PERIODICIDAD_OPTIONS = [
  { value: "", label: "Usar configuracion base" },
  { value: "UNICO", label: "Unico" },
  { value: "SEMANAL", label: "Semanal" },
  { value: "QUINCENAL", label: "Quincenal" },
  { value: "MENSUAL", label: "Mensual" },
  { value: "BIMESTRAL", label: "Bimestral" },
  { value: "ANUAL", label: "Anual" },
];

const QUICK_SPACE_TOTAL_LIMIT = 200;
const QUICK_SPACE_PRESETS = [
  {
    key: "habitacion",
    nombre: "Habitacion",
    descripcion: "Cuartos de hotel, coliving o renta por habitacion.",
    prefijo: "HAB-",
  },
  {
    key: "departamento",
    nombre: "Departamento",
    descripcion: "Unidad completa para renta residencial o portafolio.",
    prefijo: "DEP-",
  },
  {
    key: "suite",
    nombre: "Suite",
    descripcion: "Unidad premium, hotelera o de estancia extendida.",
    prefijo: "SUI-",
  },
  {
    key: "oficina",
    nombre: "Oficina",
    descripcion: "Espacios privados para corporativos o cowork.",
    prefijo: "OFI-",
  },
  {
    key: "local-comercial",
    nombre: "Local comercial",
    descripcion: "Locales para renta comercial o plazas.",
    prefijo: "LOC-",
  },
  {
    key: "bodega",
    nombre: "Bodega",
    descripcion: "Almacen, mini bodega o espacio de resguardo.",
    prefijo: "BOD-",
  },
  {
    key: "estacionamiento",
    nombre: "Estacionamiento",
    descripcion: "Cajones, lugares o espacios vehiculares.",
    prefijo: "EST-",
  },
  {
    key: "cama",
    nombre: "Cama",
    descripcion: "Camas individuales para hostal, residencia o coliving.",
    prefijo: "CAM-",
  },
  {
    key: "consultorio",
    nombre: "Consultorio",
    descripcion: "Consultorios, cabinas o salas de atencion.",
    prefijo: "CON-",
  },
  {
    key: "amenidad",
    nombre: "Amenidad",
    descripcion: "Salon, terraza, sala de juntas u otra amenidad rentable.",
    prefijo: "AME-",
  },
];

function getToday() {
  const current = new Date();
  const year = current.getFullYear();
  const month = `${current.getMonth() + 1}`.padStart(2, "0");
  const day = `${current.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseOptionalNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseRequiredNumber(value: string, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sanitizeTipoNameInput(value: string) {
  return value
    .replace(/[^\p{L}\p{N}\s.,'&/()-]/gu, "")
    .replace(/\s+/g, " ")
    .slice(0, 150);
}

function sanitizeDescriptionInput(value: string) {
  return value
    .replace(/[^\p{L}\p{N}\s.,:;'"%+$#/@&()_-]/gu, "")
    .replace(/\s+/g, " ")
    .slice(0, 250);
}

function sanitizeMoneyInput(value: string) {
  const normalized = value.replace(",", ".").replace(/[^\d.]/g, "");
  const [integerPart, ...decimalParts] = normalized.split(".");
  const integer = integerPart.replace(/^0+(?=\d)/, "").slice(0, 8);
  const decimals = decimalParts.join("").slice(0, 2);
  if (decimalParts.length > 0) {
    return `${integer || "0"}.${decimals}`;
  }
  return integer;
}

function sanitizeIntegerInput(value: string, maxDigits = 2) {
  return value.replace(/\D/g, "").slice(0, maxDigits);
}

function sanitizeDecimalInput(value: string, maxIntegerDigits = 3, decimals = 2) {
  const normalized = value.replace(",", ".").replace(/[^\d.]/g, "");
  const [integerPart, ...decimalParts] = normalized.split(".");
  const integer = integerPart.replace(/^0+(?=\d)/, "").slice(0, maxIntegerDigits);
  const decimal = decimalParts.join("").slice(0, decimals);
  if (decimalParts.length > 0) {
    return `${integer || "0"}.${decimal}`;
  }
  return integer;
}

function getTipoFormState(tipo: TipoEspacio): TipoFormState {
  return {
    nombre: tipo.nombre,
    descripcion: tipo.descripcion || "",
    renta_base: String(tipo.renta_base ?? 0),
    deposito_base: String(tipo.deposito_base ?? 0),
    recamaras: tipo.recamaras !== null ? String(tipo.recamaras) : "",
    banos: tipo.banos !== null ? String(tipo.banos) : "",
    metros_cuadrados:
      tipo.metros_cuadrados !== null ? String(tipo.metros_cuadrados) : "",
    activo: tipo.activo,
  };
}

function buildTipoPayload(form: TipoFormState) {
  return {
    nombre: form.nombre.trim(),
    descripcion: form.descripcion.trim() || null,
    renta_base: parseRequiredNumber(form.renta_base, 0),
    deposito_base: parseRequiredNumber(form.deposito_base, 0),
    recamaras: parseOptionalNumber(form.recamaras),
    banos: parseOptionalNumber(form.banos),
    metros_cuadrados: parseOptionalNumber(form.metros_cuadrados),
    activo: form.activo,
  };
}

function validateTipoForm(form: TipoFormState) {
  const errors: TipoFormErrors = {};
  const nombre = form.nombre.trim();
  const descripcion = form.descripcion.trim();
  const renta = form.renta_base.trim();
  const deposito = form.deposito_base.trim();
  const recamaras = form.recamaras.trim();
  const banos = form.banos.trim();
  const metros = form.metros_cuadrados.trim();

  if (nombre.length < 3) {
    errors.nombre = "Nombre del tipo debe tener al menos 3 caracteres.";
  } else if (!/[\p{L}]/u.test(nombre)) {
    errors.nombre = "Nombre del tipo debe incluir texto, no solo numeros.";
  } else if (nombre.length > 150) {
    errors.nombre = "Nombre del tipo no puede superar 150 caracteres.";
  }

  if (descripcion.length > 250) {
    errors.descripcion = "Descripcion corta no puede superar 250 caracteres.";
  }

  if (renta && !/^\d+(\.\d{1,2})?$/.test(renta)) {
    errors.renta_base = "Renta base solo acepta dinero con hasta 2 decimales.";
  } else if (Number(renta || "0") > 99999999.99) {
    errors.renta_base = "Renta base no puede superar $99,999,999.99.";
  }

  if (deposito && !/^\d+(\.\d{1,2})?$/.test(deposito)) {
    errors.deposito_base = "Deposito base solo acepta dinero con hasta 2 decimales.";
  } else if (Number(deposito || "0") > 99999999.99) {
    errors.deposito_base = "Deposito base no puede superar $99,999,999.99.";
  }

  if (recamaras && !/^\d+$/.test(recamaras)) {
    errors.recamaras = "Recamaras solo acepta numeros enteros.";
  } else if (Number(recamaras || "0") > 99) {
    errors.recamaras = "Recamaras no puede superar 99.";
  }

  if (banos && !/^\d+(\.\d)?$/.test(banos)) {
    errors.banos = "Banos acepta enteros o medios, por ejemplo 1.5.";
  } else if (banos && Number(banos) * 2 !== Math.round(Number(banos) * 2)) {
    errors.banos = "Banos debe capturarse en enteros o medios.";
  } else if (Number(banos || "0") > 99.5) {
    errors.banos = "Banos no puede superar 99.5.";
  }

  if (metros && !/^\d+(\.\d{1,2})?$/.test(metros)) {
    errors.metros_cuadrados =
      "Metros cuadrados solo acepta numeros con hasta 2 decimales.";
  } else if (Number(metros || "0") > 999999.99) {
    errors.metros_cuadrados =
      "Metros cuadrados no puede superar 999,999.99.";
  }

  return errors;
}

function hasTipoErrors(errors: TipoFormErrors) {
  return Object.values(errors).some(Boolean);
}

function formatMoney(value: number) {
  return moneyFormatter.format(value || 0);
}

function normalizeSpaceName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function buildPrefixFromName(value: string) {
  const asciiName = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ");
  const words = asciiName.split(/\s+/).filter(Boolean);
  const base =
    words.length > 1
      ? words.map((word) => word[0]).join("").slice(0, 5)
      : (words[0] || "ESP").slice(0, 4);

  return `${base || "ESP"}-`;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getNextSequenceStart(espacios: Espacio[], prefijo: string) {
  const matcher = new RegExp(`^${escapeRegex(prefijo)}(\\d+)$`, "i");
  let max = 0;

  espacios.forEach((espacio) => {
    const match = espacio.codigo.match(matcher);
    if (!match) {
      return;
    }
    const numericPart = Number(match[1]);
    if (Number.isFinite(numericPart) && numericPart > max) {
      max = numericPart;
    }
  });

  return max + 1;
}

function sanitizeQuantityInput(value: string) {
  const digits = value.replace(/\D/g, "");
  if (!digits) {
    return "";
  }
  return String(Math.min(Number(digits), QUICK_SPACE_TOTAL_LIMIT));
}

function sanitizePrefixInput(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 _/-]/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 16);
}

function parseQuickQuantity(value: string) {
  const quantity = Number(value);
  return Number.isInteger(quantity) && quantity > 0 ? quantity : 0;
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

  return "border-zinc-700 bg-zinc-800/70 text-zinc-300";
}

async function getErrorMessage(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as { detail?: string; mensaje?: string };
    return body.detail || body.mensaje || fallback;
  } catch {
    return fallback;
  }
}

function FieldLabel({
  label,
  info,
  onInfo,
  optional = false,
}: {
  label: string;
  info: FieldInfo;
  onInfo?: (info: FieldInfo) => void;
  optional?: boolean;
}) {
  return (
    <div className="mb-1.5 flex items-center gap-2">
      <label className="text-sm font-medium text-zinc-300">
        {label}
        <span
          className={`ml-2 text-[10px] font-semibold uppercase tracking-[0.16em] ${
            optional ? "text-zinc-500" : "text-cyan-300"
          }`}
        >
          {optional ? "Opcional" : "Obligatorio"}
        </span>
      </label>
      <InfoButton info={info} onInfo={onInfo} />
    </div>
  );
}

function InfoButton({
  info,
  onInfo,
}: {
  info: FieldInfo;
  onInfo?: (info: FieldInfo) => void;
}) {
  return (
    <button
      type="button"
      title={info.title}
      aria-label={`Informacion: ${info.title}`}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onInfo?.(info);
      }}
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-cyan-400/40 bg-cyan-400/10 text-[11px] font-semibold text-cyan-200 transition hover:border-cyan-300/70 hover:bg-cyan-400/20"
    >
      i
    </button>
  );
}

function FieldInfoModal({
  info,
  onClose,
}: {
  info: FieldInfo | null;
  onClose: () => void;
}) {
  if (!info) return null;

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/75 px-4 py-6 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="space-type-field-info-title"
        className="w-full max-w-lg rounded-2xl border border-cyan-500/20 bg-zinc-950 p-5 shadow-2xl shadow-black/60"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-200">
              Detalle del campo
            </p>
            <h3
              id="space-type-field-info-title"
              className="mt-2 text-xl font-semibold text-white"
            >
              {info.title}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-zinc-300 transition hover:bg-white/10"
          >
            Cerrar
          </button>
        </div>
        <p className="mt-4 text-sm leading-6 text-zinc-300">{info.body}</p>
        {info.details?.length ? (
          <ul className="mt-4 space-y-2 text-sm leading-6 text-zinc-400">
            {info.details.map((detail) => (
              <li
                key={detail}
                className="rounded-2xl border border-white/8 bg-zinc-900/70 px-4 py-3"
              >
                {detail}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) {
    return null;
  }

  return <p className="mt-2 text-xs text-red-300">{message}</p>;
}

export default function EspaciosManager({
  entidadId,
  viewMode = "all",
}: EspaciosManagerProps) {
  const [tipos, setTipos] = useState<TipoEspacio[]>([]);
  const [espacios, setEspacios] = useState<Espacio[]>([]);
  const [clientes, setClientes] = useState<ClienteAsignable[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [mensajeExito, setMensajeExito] = useState("");
  const [tipoModalMode, setTipoModalMode] = useState<TipoModalMode | null>(null);
  const [tipoEditando, setTipoEditando] = useState<TipoEspacio | null>(null);
  const [tipoEditForm, setTipoEditForm] =
    useState<TipoFormState>(EMPTY_TIPO_FORM);
  const [tipoFormErrors, setTipoFormErrors] = useState<TipoFormErrors>({});
  const [tipoModalSourceKey, setTipoModalSourceKey] = useState<string | null>(
    null
  );
  const [tipoBorrando, setTipoBorrando] = useState<TipoEspacio | null>(null);
  const [tipoDeleteAcknowledged, setTipoDeleteAcknowledged] = useState(false);
  const [tipoDeleteText, setTipoDeleteText] = useState("");
  const [fieldInfo, setFieldInfo] = useState<FieldInfo | null>(null);
  const [quickDrafts, setQuickDrafts] = useState<
    Record<string, QuickSpaceDraft>
  >({});
  const [espacioAsignando, setEspacioAsignando] = useState<Espacio | null>(null);
  const [asignacionForm, setAsignacionForm] = useState<AsignacionFormState>({
    cliente_id: "",
    fecha_inicio: getToday(),
    fecha_fin_programada: "",
    periodicidad_cobro: "",
    dia_vencimiento: "",
    plazo_meses: "",
    auto_renueva: "",
    renta_pactada: "",
    deposito_pactado: "",
    observaciones: "",
  });
  const [espacioFinalizando, setEspacioFinalizando] = useState<Espacio | null>(null);
  const [finalizacionForm, setFinalizacionForm] =
    useState<FinalizacionFormState>({
      fecha_fin: getToday(),
      observaciones: "",
    });
  const showInventario = viewMode !== "operacion";
  const showOperacion = viewMode !== "inventario";

  const loadData = async () => {
    if (!entidadId) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      const [tiposRes, espaciosRes, clientesRes] = await Promise.all([
        fetch(`${ESPACIOS_API_BASE}/entidades/${entidadId}/tipos/`, {
          cache: "no-store",
        }),
        fetch(`${ESPACIOS_API_BASE}/entidades/${entidadId}/lista/`, {
          cache: "no-store",
        }),
        fetch(`${ESPACIOS_API_BASE}/entidades/${entidadId}/clientes/`, {
          cache: "no-store",
        }),
      ]);

      if (!tiposRes.ok || !espaciosRes.ok || !clientesRes.ok) {
        throw new Error("No se pudo cargar la operacion de espacios.");
      }

      const [tiposData, espaciosData, clientesData] = await Promise.all([
        tiposRes.json() as Promise<TipoEspacio[]>,
        espaciosRes.json() as Promise<Espacio[]>,
        clientesRes.json() as Promise<ClienteAsignable[]>,
      ]);

      setTipos(tiposData);
      setEspacios(espaciosData);
      setClientes(clientesData);
    } catch (loadError) {
      console.error("Error cargando espacios:", loadError);
      setTipos([]);
      setEspacios([]);
      setClientes([]);
      setError("No se pudo cargar la configuracion de espacios de esta entidad.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [entidadId]);

  const stats = useMemo(() => {
    const total = espacios.length;
    const ocupados = espacios.filter((item) => item.estatus === "OCUPADO").length;
    const disponibles = espacios.filter(
      (item) => item.estatus === "DISPONIBLE"
    ).length;
    const reservados = espacios.filter(
      (item) => item.estatus === "RESERVADO"
    ).length;

    return {
      total,
      ocupados,
      disponibles,
      reservados,
    };
  }, [espacios]);

  const quickTemplates = useMemo<QuickSpaceTemplate[]>(() => {
    const existingByName = new Map(
      tipos.map((tipo) => [normalizeSpaceName(tipo.nombre), tipo])
    );
    const usedTypeIds = new Set<number>();
    const templates = QUICK_SPACE_PRESETS.map((preset) => {
      const tipo = existingByName.get(normalizeSpaceName(preset.nombre));
      if (tipo) {
        usedTypeIds.add(tipo.id);
      }

      return {
        key: tipo ? `tipo-${tipo.id}` : `preset-${preset.key}`,
        nombre: tipo?.nombre || preset.nombre,
        descripcion: tipo?.descripcion || preset.descripcion,
        prefijo: preset.prefijo,
        tipoId: tipo?.id || null,
        espaciosCount: tipo?.espacios_count || 0,
        rentaBase: tipo?.renta_base || 0,
        exists: Boolean(tipo),
        activo: tipo?.activo ?? true,
      };
    });

    tipos.forEach((tipo) => {
      if (usedTypeIds.has(tipo.id)) {
        return;
      }

      templates.push({
        key: `tipo-${tipo.id}`,
        nombre: tipo.nombre,
        descripcion: tipo.descripcion || "Tipo personalizado de esta entidad.",
        prefijo: buildPrefixFromName(tipo.nombre),
        tipoId: tipo.id,
        espaciosCount: tipo.espacios_count,
        rentaBase: tipo.renta_base,
        exists: true,
        activo: tipo.activo,
      });
    });

    return templates;
  }, [tipos]);

  const quickSelection = useMemo(
    () =>
      quickTemplates
        .map((template) => ({
          template,
          quantity: parseQuickQuantity(quickDrafts[template.key]?.quantity || ""),
          prefix: quickDrafts[template.key]?.prefix ?? template.prefijo,
          selected: quickDrafts[template.key]?.selected || false,
        }))
        .filter((item) => item.selected && item.quantity > 0),
    [quickDrafts, quickTemplates]
  );

  const quickSelectedTotal = useMemo(
    () => quickSelection.reduce((total, item) => total + item.quantity, 0),
    [quickSelection]
  );

  const updateQuickDraft = (
    key: string,
    patch: Partial<QuickSpaceDraft>
  ) => {
    setQuickDrafts((current) => {
      const previous = current[key] || { selected: false, quantity: "" };
      return {
        ...current,
        [key]: {
          ...previous,
          ...patch,
        },
      };
    });
  };

  const updateTipoForm = (patch: Partial<TipoFormState>) => {
    setTipoEditForm((current) => ({ ...current, ...patch }));
    setTipoFormErrors((current) => {
      const next = { ...current };
      Object.keys(patch).forEach((key) => {
        delete next[key as keyof TipoFormState];
      });
      return next;
    });
  };

  const getQuickDraftPrefix = (
    template: QuickSpaceTemplate,
    draft: QuickSpaceDraft
  ) => draft.prefix ?? template.prefijo;

  const findTipoIdByName = async (nombre: string) => {
    if (!entidadId) {
      return null;
    }

    const response = await fetch(
      `${ESPACIOS_API_BASE}/entidades/${entidadId}/tipos/`,
      { cache: "no-store" }
    );
    if (!response.ok) {
      return null;
    }
    const currentTipos = (await response.json()) as TipoEspacio[];
    const match = currentTipos.find(
      (tipo) => normalizeSpaceName(tipo.nombre) === normalizeSpaceName(nombre)
    );
    return match?.id || null;
  };

  const ensureQuickTipoId = async (template: QuickSpaceTemplate) => {
    if (template.tipoId) {
      return template.tipoId;
    }

    const existing = tipos.find(
      (tipo) =>
        normalizeSpaceName(tipo.nombre) === normalizeSpaceName(template.nombre)
    );
    if (existing) {
      return existing.id;
    }

    const response = await fetch(
      `${ESPACIOS_API_BASE}/entidades/${entidadId}/tipos/`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: template.nombre,
          descripcion: template.descripcion,
          renta_base: 0,
          deposito_base: 0,
          recamaras: null,
          banos: null,
          metros_cuadrados: null,
          activo: true,
        }),
      }
    );

    if (response.ok) {
      const body = (await response.json()) as { id?: number };
      if (body.id) {
        return body.id;
      }
    }

    const message = await getErrorMessage(
      response,
      "No se pudo crear el tipo de espacio."
    );
    if (message.toLowerCase().includes("ya existe")) {
      const existingId = await findTipoIdByName(template.nombre);
      if (existingId) {
        return existingId;
      }
    }

    throw new Error(message);
  };

  const handleQuickGenerateSpaces = async () => {
    if (!entidadId) {
      return;
    }

    if (quickSelection.length === 0) {
      setError("Selecciona al menos un tipo y captura cuantos espacios quieres crear.");
      return;
    }

    if (quickSelectedTotal > QUICK_SPACE_TOTAL_LIMIT) {
      setError(
        `Por seguridad, crea maximo ${QUICK_SPACE_TOTAL_LIMIT} espacios por carga rapida.`
      );
      return;
    }

    setIsSubmitting(true);
    setError("");

    const nextByPrefix = new Map<string, number>();
    let totalCreados = 0;
    let totalOmitidos = 0;

    try {
      for (const item of quickSelection) {
        const tipoId = await ensureQuickTipoId(item.template);
        const prefijo = item.prefix;
        const inicio =
          nextByPrefix.get(prefijo) || getNextSequenceStart(espacios, prefijo);
        const fin = inicio + item.quantity - 1;
        nextByPrefix.set(prefijo, fin + 1);

        const response = await fetch(
          `${ESPACIOS_API_BASE}/entidades/${entidadId}/generar/`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              prefijo,
              sufijo: "",
              inicio,
              fin,
              padding: 3,
              tipo_id: tipoId,
              observaciones: `Alta rapida por tipo: ${item.template.nombre}`,
            }),
          }
        );

        if (!response.ok) {
          throw new Error(
            await getErrorMessage(
              response,
              "No se pudo generar la seleccion de espacios."
            )
          );
        }

        const body = (await response.json()) as {
          total_creados: number;
          total_omitidos: number;
        };
        totalCreados += body.total_creados;
        totalOmitidos += body.total_omitidos;
      }

      setQuickDrafts({});
      setMensajeExito(
        `Alta rapida completada: ${totalCreados} creados, ${totalOmitidos} omitidos.`
      );
      window.setTimeout(() => setMensajeExito(""), 3500);
      await loadData();
    } catch (submitError) {
      console.error("Error en alta rapida:", submitError);
      setError(
        submitError instanceof Error
          ? submitError.message
          : "No se pudo generar la seleccion de espacios."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const closeTipoModal = () => {
    setTipoModalMode(null);
    setTipoEditando(null);
    setTipoEditForm(EMPTY_TIPO_FORM);
    setTipoFormErrors({});
    setTipoModalSourceKey(null);
  };

  const openCreateTipoModal = (template?: QuickSpaceTemplate) => {
    setTipoModalMode("CREATE");
    setTipoEditando(null);
    setTipoEditForm({
      ...EMPTY_TIPO_FORM,
      nombre: template?.nombre || "",
      descripcion: template?.descripcion || "",
    });
    setTipoFormErrors({});
    setTipoModalSourceKey(template?.key || null);
    setError("");
  };

  const openEditTipoModal = (tipo: TipoEspacio) => {
    setTipoModalMode("EDIT");
    setTipoEditando(tipo);
    setTipoEditForm(getTipoFormState(tipo));
    setTipoFormErrors({});
    setTipoModalSourceKey(null);
    setError("");
  };

  const openTemplateTipoModal = (template: QuickSpaceTemplate) => {
    const existing = template.tipoId
      ? tipos.find((tipo) => tipo.id === template.tipoId)
      : null;
    if (existing) {
      openEditTipoModal(existing);
      return;
    }
    openCreateTipoModal(template);
  };

  const handleSaveTipoModal = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!entidadId || !tipoModalMode) {
      return;
    }

    const errors = validateTipoForm(tipoEditForm);
    setTipoFormErrors(errors);
    if (hasTipoErrors(errors)) {
      return;
    }

    setIsSubmitting(true);
    setError("");

    try {
      const isEditing = tipoModalMode === "EDIT" && tipoEditando;
      const response = await fetch(
        isEditing
          ? `${ESPACIOS_API_BASE}/tipos/${tipoEditando.id}/`
          : `${ESPACIOS_API_BASE}/entidades/${entidadId}/tipos/`,
        {
          method: isEditing ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildTipoPayload(tipoEditForm)),
        }
      );

      if (!response.ok) {
        throw new Error(
          await getErrorMessage(
            response,
            "No se pudo actualizar el tipo de espacio."
          )
        );
      }

      const body = (await response.json()) as { id?: number };
      if (!isEditing && tipoModalSourceKey && body.id) {
        setQuickDrafts((current) => {
          const previous = current[tipoModalSourceKey];
          if (!previous) {
            return current;
          }
          const next = { ...current, [`tipo-${body.id}`]: previous };
          delete next[tipoModalSourceKey];
          return next;
        });
      }

      closeTipoModal();
      setMensajeExito(
        isEditing
          ? "Tipo de espacio actualizado correctamente."
          : "Tipo de espacio creado correctamente."
      );
      window.setTimeout(() => setMensajeExito(""), 3000);
      await loadData();
    } catch (submitError) {
      console.error("Error guardando tipo:", submitError);
      setError(
        submitError instanceof Error
          ? submitError.message
          : "No se pudo guardar el tipo de espacio."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const openDeleteTipoModal = (tipo: TipoEspacio) => {
    setTipoBorrando(tipo);
    setTipoDeleteAcknowledged(false);
    setTipoDeleteText("");
    setError("");
  };

  const handleDeleteTipo = async () => {
    if (!tipoBorrando || tipoDeleteText.trim() !== tipoBorrando.nombre) {
      return;
    }

    setIsSubmitting(true);
    setError("");

    try {
      const response = await fetch(
        `${ESPACIOS_API_BASE}/tipos/${tipoBorrando.id}/`,
        { method: "DELETE" }
      );

      if (!response.ok) {
        throw new Error(
          await getErrorMessage(
            response,
            "No se pudo eliminar el tipo de espacio."
          )
        );
      }

      const body = (await response.json()) as {
        espacios_desvinculados?: number;
      };
      const detached = body.espacios_desvinculados || 0;
      setTipoBorrando(null);
      setTipoDeleteAcknowledged(false);
      setTipoDeleteText("");
      setMensajeExito(
        detached > 0
          ? `Tipo eliminado. ${detached} espacio(s) quedaron sin tipo.`
          : "Tipo de espacio eliminado correctamente."
      );
      window.setTimeout(() => setMensajeExito(""), 3500);
      await loadData();
    } catch (submitError) {
      console.error("Error eliminando tipo:", submitError);
      setError(
        submitError instanceof Error
          ? submitError.message
          : "No se pudo eliminar el tipo de espacio."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const openAsignacionModal = (espacio: Espacio) => {
    setEspacioAsignando(espacio);
    setAsignacionForm({
      cliente_id: "",
      fecha_inicio: getToday(),
      fecha_fin_programada: "",
      periodicidad_cobro: "",
      dia_vencimiento: "",
      plazo_meses: "",
      auto_renueva: "",
      renta_pactada: espacio.renta_sugerida.toString(),
      deposito_pactado: espacio.deposito_sugerido.toString(),
      observaciones: "",
    });
  };

  const handleAsignar = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!espacioAsignando) {
      return;
    }

    setIsSubmitting(true);
    setError("");

    try {
      const response = await fetch(
        `${ESPACIOS_API_BASE}/espacios/${espacioAsignando.id}/asignar/`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cliente_id: parseRequiredNumber(asignacionForm.cliente_id),
            fecha_inicio: asignacionForm.fecha_inicio,
            fecha_fin_programada: asignacionForm.fecha_fin_programada || null,
            periodicidad_cobro: asignacionForm.periodicidad_cobro || null,
            dia_vencimiento: parseOptionalNumber(asignacionForm.dia_vencimiento),
            plazo_meses: parseOptionalNumber(asignacionForm.plazo_meses),
            auto_renueva:
              asignacionForm.auto_renueva === ""
                ? null
                : asignacionForm.auto_renueva === "true",
            renta_pactada: parseOptionalNumber(asignacionForm.renta_pactada),
            deposito_pactado: parseOptionalNumber(
              asignacionForm.deposito_pactado
            ),
            observaciones: asignacionForm.observaciones.trim() || null,
          }),
        }
      );

      if (!response.ok) {
        throw new Error(
          await getErrorMessage(response, "No se pudo asignar el cliente al espacio.")
        );
      }

      setEspacioAsignando(null);
      setMensajeExito("Cliente asignado correctamente.");
      window.setTimeout(() => setMensajeExito(""), 3000);
      await loadData();
    } catch (submitError) {
      console.error("Error asignando cliente:", submitError);
      setError(
        submitError instanceof Error
          ? submitError.message
          : "No se pudo asignar el cliente al espacio."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const openFinalizacionModal = (espacio: Espacio) => {
    setEspacioFinalizando(espacio);
    setFinalizacionForm({
      fecha_fin: getToday(),
      observaciones: "",
    });
  };

  const handleFinalizar = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!espacioFinalizando?.asignacion_activa_id) {
      return;
    }

    setIsSubmitting(true);
    setError("");

    try {
      const response = await fetch(
        `${ESPACIOS_API_BASE}/asignaciones/${espacioFinalizando.asignacion_activa_id}/finalizar/`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fecha_fin: finalizacionForm.fecha_fin,
            observaciones: finalizacionForm.observaciones.trim() || null,
          }),
        }
      );

      if (!response.ok) {
        throw new Error(
          await getErrorMessage(response, "No se pudo finalizar la ocupacion.")
        );
      }

      setEspacioFinalizando(null);
      setMensajeExito("Ocupacion finalizada correctamente.");
      window.setTimeout(() => setMensajeExito(""), 3000);
      await loadData();
    } catch (submitError) {
      console.error("Error finalizando ocupacion:", submitError);
      setError(
        submitError instanceof Error
          ? submitError.message
          : "No se pudo finalizar la ocupacion."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const canConfirmDeleteTipo = Boolean(
    tipoBorrando &&
      tipoDeleteAcknowledged &&
      tipoDeleteText.trim() === tipoBorrando.nombre
  );

  return (
    <div className="space-y-6">
      {mensajeExito && (
        <div className="fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-lg border border-green-500/50 bg-green-500/20 px-4 py-2 text-green-400 shadow-lg">
          <span className="text-sm font-medium">{mensajeExito}</span>
        </div>
      )}
      <FieldInfoModal info={fieldInfo} onClose={() => setFieldInfo(null)} />

      {tipoModalMode && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-cyan-200">
                  Catalogo de tipos
                </p>
                <h3 className="mt-2 text-2xl font-bold text-white">
                  {tipoModalMode === "EDIT"
                    ? "Editar tipo de espacio"
                    : "Configurar tipo de espacio"}
                </h3>
                <p className="mt-1 text-sm text-zinc-400">
                  {tipoModalMode === "EDIT"
                    ? "Ajusta la plantilla que heredan los espacios asociados a este tipo."
                    : "Define la plantilla base antes de crear espacios desde tarjetas predefinidas o alta manual."}
                </p>
              </div>
              <button
                type="button"
                onClick={closeTipoModal}
                className="rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
              >
                Cerrar
              </button>
            </div>

            <form onSubmit={handleSaveTipoModal} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <FieldLabel
                    label="Nombre del tipo"
                    info={TIPO_FIELD_INFO.nombre}
                    onInfo={setFieldInfo}
                  />
                  <input
                    required
                    maxLength={150}
                    placeholder="Ej. Habitacion"
                    value={tipoEditForm.nombre}
                    onChange={(event) =>
                      updateTipoForm({
                        nombre: sanitizeTipoNameInput(event.target.value),
                      })
                    }
                    className={`w-full rounded-lg border bg-zinc-900 p-2.5 text-sm text-zinc-200 outline-none focus:ring-1 ${
                      tipoFormErrors.nombre
                        ? "border-red-400/60 focus:ring-red-400"
                        : "border-zinc-800 focus:ring-blue-500"
                    }`}
                  />
                  <p className="mt-1 text-xs text-zinc-500">
                    De 3 a 150 caracteres; se limpian simbolos no operativos.
                  </p>
                  <FieldError message={tipoFormErrors.nombre} />
                </div>

                <div>
                  <FieldLabel
                    label="Descripcion corta"
                    info={TIPO_FIELD_INFO.descripcion}
                    onInfo={setFieldInfo}
                    optional
                  />
                  <input
                    maxLength={250}
                    placeholder="Ej. Cuarto estandar con bano privado"
                    value={tipoEditForm.descripcion}
                    onChange={(event) =>
                      updateTipoForm({
                        descripcion: sanitizeDescriptionInput(event.target.value),
                      })
                    }
                    className={`w-full rounded-lg border bg-zinc-900 p-2.5 text-sm text-zinc-200 outline-none focus:ring-1 ${
                      tipoFormErrors.descripcion
                        ? "border-red-400/60 focus:ring-red-400"
                        : "border-zinc-800 focus:ring-blue-500"
                    }`}
                  />
                  <p className="mt-1 text-xs text-zinc-500">
                    Maximo 250 caracteres para notas internas.
                  </p>
                  <FieldError message={tipoFormErrors.descripcion} />
                </div>

                <div>
                  <FieldLabel
                    label="Renta base"
                    info={TIPO_FIELD_INFO.renta_base}
                    onInfo={setFieldInfo}
                    optional
                  />
                  <input
                    type="text"
                    inputMode="decimal"
                    maxLength={11}
                    placeholder="Ej. 15000.00"
                    value={tipoEditForm.renta_base}
                    onChange={(event) =>
                      updateTipoForm({
                        renta_base: sanitizeMoneyInput(event.target.value),
                      })
                    }
                    className={`w-full rounded-lg border bg-zinc-900 p-2.5 text-sm text-zinc-200 outline-none focus:ring-1 ${
                      tipoFormErrors.renta_base
                        ? "border-red-400/60 focus:ring-red-400"
                        : "border-zinc-800 focus:ring-blue-500"
                    }`}
                  />
                  <p className="mt-1 text-xs text-zinc-500">
                    Solo dinero positivo o cero, hasta 2 decimales.
                  </p>
                  <FieldError message={tipoFormErrors.renta_base} />
                </div>

                <div>
                  <FieldLabel
                    label="Deposito base"
                    info={TIPO_FIELD_INFO.deposito_base}
                    onInfo={setFieldInfo}
                    optional
                  />
                  <input
                    type="text"
                    inputMode="decimal"
                    maxLength={11}
                    placeholder="Ej. 15000.00"
                    value={tipoEditForm.deposito_base}
                    onChange={(event) =>
                      updateTipoForm({
                        deposito_base: sanitizeMoneyInput(event.target.value),
                      })
                    }
                    className={`w-full rounded-lg border bg-zinc-900 p-2.5 text-sm text-zinc-200 outline-none focus:ring-1 ${
                      tipoFormErrors.deposito_base
                        ? "border-red-400/60 focus:ring-red-400"
                        : "border-zinc-800 focus:ring-blue-500"
                    }`}
                  />
                  <p className="mt-1 text-xs text-zinc-500">
                    Solo dinero positivo o cero, hasta 2 decimales.
                  </p>
                  <FieldError message={tipoFormErrors.deposito_base} />
                </div>

                <div>
                  <FieldLabel
                    label="Recamaras"
                    info={TIPO_FIELD_INFO.recamaras}
                    onInfo={setFieldInfo}
                    optional
                  />
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={2}
                    placeholder="Ej. 2"
                    value={tipoEditForm.recamaras}
                    onChange={(event) =>
                      updateTipoForm({
                        recamaras: sanitizeIntegerInput(event.target.value, 2),
                      })
                    }
                    className={`w-full rounded-lg border bg-zinc-900 p-2.5 text-sm text-zinc-200 outline-none focus:ring-1 ${
                      tipoFormErrors.recamaras
                        ? "border-red-400/60 focus:ring-red-400"
                        : "border-zinc-800 focus:ring-blue-500"
                    }`}
                  />
                  <p className="mt-1 text-xs text-zinc-500">
                    Solo numeros enteros de 0 a 99.
                  </p>
                  <FieldError message={tipoFormErrors.recamaras} />
                </div>

                <div>
                  <FieldLabel
                    label="Banos"
                    info={TIPO_FIELD_INFO.banos}
                    onInfo={setFieldInfo}
                    optional
                  />
                  <input
                    type="text"
                    inputMode="decimal"
                    maxLength={4}
                    placeholder="Ej. 1.5"
                    value={tipoEditForm.banos}
                    onChange={(event) =>
                      updateTipoForm({
                        banos: sanitizeDecimalInput(event.target.value, 2, 1),
                      })
                    }
                    className={`w-full rounded-lg border bg-zinc-900 p-2.5 text-sm text-zinc-200 outline-none focus:ring-1 ${
                      tipoFormErrors.banos
                        ? "border-red-400/60 focus:ring-red-400"
                        : "border-zinc-800 focus:ring-blue-500"
                    }`}
                  />
                  <p className="mt-1 text-xs text-zinc-500">
                    Acepta enteros o medios: 1, 1.5, 2.
                  </p>
                  <FieldError message={tipoFormErrors.banos} />
                </div>

                <div>
                  <FieldLabel
                    label="Metros cuadrados"
                    info={TIPO_FIELD_INFO.metros_cuadrados}
                    onInfo={setFieldInfo}
                    optional
                  />
                  <input
                    type="text"
                    inputMode="decimal"
                    maxLength={9}
                    placeholder="Ej. 75.50"
                    value={tipoEditForm.metros_cuadrados}
                    onChange={(event) =>
                      updateTipoForm({
                        metros_cuadrados: sanitizeDecimalInput(
                          event.target.value,
                          6,
                          2
                        ),
                      })
                    }
                    className={`w-full rounded-lg border bg-zinc-900 p-2.5 text-sm text-zinc-200 outline-none focus:ring-1 ${
                      tipoFormErrors.metros_cuadrados
                        ? "border-red-400/60 focus:ring-red-400"
                        : "border-zinc-800 focus:ring-blue-500"
                    }`}
                  />
                  <p className="mt-1 text-xs text-zinc-500">
                    Superficie de referencia, hasta 2 decimales.
                  </p>
                  <FieldError message={tipoFormErrors.metros_cuadrados} />
                </div>

                <label className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/70 p-4 text-sm text-zinc-200">
                  <input
                    type="checkbox"
                    checked={tipoEditForm.activo}
                    onChange={(event) =>
                      updateTipoForm({
                        activo: event.target.checked,
                      })
                    }
                    className="h-4 w-4 rounded border-zinc-700 bg-zinc-950 text-blue-500"
                  />
                  <span>
                    <span className="inline-flex items-center gap-2">
                      Tipo activo para nuevas operaciones.
                      <InfoButton
                        info={TIPO_FIELD_INFO.activo}
                        onInfo={setFieldInfo}
                      />
                    </span>
                    <span className="block text-xs text-zinc-500">
                      Si se desactiva, se conserva el historial pero no se sugiere
                      para nuevas altas.
                    </span>
                  </span>
                </label>
              </div>

              <div className="flex justify-end gap-3 border-t border-zinc-800 pt-4">
                <button
                  type="button"
                  onClick={closeTipoModal}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
                >
                  {tipoModalMode === "EDIT" ? "Guardar cambios" : "Crear tipo"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {tipoBorrando && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-2xl border border-red-500/20 bg-zinc-950 p-6 shadow-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-red-300">
              Confirmacion requerida
            </p>
            <h3 className="mt-2 text-2xl font-bold text-white">
              Eliminar tipo de espacio
            </h3>
            <p className="mt-2 text-sm text-zinc-400">
              Vas a eliminar <span className="font-semibold text-white">{tipoBorrando.nombre}</span>.
              Esta accion quita la plantilla del catalogo. Los{" "}
              {tipoBorrando.espacios_count} espacio(s) asociados no se borran,
              pero quedaran sin tipo asignado.
            </p>

            <div className="mt-5 space-y-4 rounded-2xl border border-red-500/20 bg-red-500/10 p-4">
              <label className="flex items-start gap-3 text-sm text-red-100">
                <input
                  type="checkbox"
                  checked={tipoDeleteAcknowledged}
                  onChange={(event) =>
                    setTipoDeleteAcknowledged(event.target.checked)
                  }
                  className="mt-0.5 h-4 w-4 rounded border-red-400/40 bg-zinc-950 text-red-500"
                />
                Entiendo que se eliminara solo el tipo de espacio y que los
                espacios existentes quedaran sin clasificacion.
              </label>

              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-red-200">
                  Escribe el nombre exacto para confirmar
                </label>
                <input
                  value={tipoDeleteText}
                  onChange={(event) => setTipoDeleteText(event.target.value)}
                  placeholder={tipoBorrando.nombre}
                  className="w-full rounded-lg border border-red-500/20 bg-zinc-950 p-2.5 text-sm text-zinc-100 outline-none focus:border-red-400"
                />
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setTipoBorrando(null)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteTipo()}
                disabled={isSubmitting || !canConfirmDeleteTipo}
                className="rounded-lg border border-red-500/30 bg-red-500/10 px-5 py-2 text-sm font-medium text-red-200 transition-colors hover:bg-red-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Eliminar tipo
              </button>
            </div>
          </div>
        </div>
      )}

      {espacioAsignando && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-2xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-xl font-bold text-white">
                  Asignar cliente a {espacioAsignando.codigo}
                </h3>
                <p className="mt-1 text-sm text-zinc-400">
                  Captura la relacion operativa sin cargar al usuario con un contrato
                  separado.
                </p>
              </div>
              <button
                onClick={() => setEspacioAsignando(null)}
                className="text-zinc-500 transition-colors hover:text-white"
              >
                <svg
                  className="h-6 w-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            <form onSubmit={handleAsignar} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-zinc-400">
                  Cliente
                </label>
                <select
                  required
                  value={asignacionForm.cliente_id}
                  onChange={(event) =>
                    setAsignacionForm({
                      ...asignacionForm,
                      cliente_id: event.target.value,
                    })
                  }
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-900 p-2.5 text-sm text-zinc-200 outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="">Selecciona un cliente</option>
                  {clientes.map((cliente) => (
                    <option key={cliente.id} value={cliente.id}>
                      {cliente.nombre} - {cliente.rfc}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-400">
                    Fecha inicio
                  </label>
                  <input
                    required
                    type="date"
                    value={asignacionForm.fecha_inicio}
                    onChange={(event) =>
                      setAsignacionForm({
                        ...asignacionForm,
                        fecha_inicio: event.target.value,
                      })
                    }
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-900 p-2.5 text-sm text-zinc-200 outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-400">
                    Renta pactada
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={asignacionForm.renta_pactada}
                    onChange={(event) =>
                      setAsignacionForm({
                        ...asignacionForm,
                        renta_pactada: event.target.value,
                      })
                    }
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-900 p-2.5 text-sm text-zinc-200 outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-400">
                    Deposito pactado
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={asignacionForm.deposito_pactado}
                    onChange={(event) =>
                      setAsignacionForm({
                        ...asignacionForm,
                        deposito_pactado: event.target.value,
                      })
                    }
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-900 p-2.5 text-sm text-zinc-200 outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-400">
                    Fecha fin programada
                  </label>
                  <input
                    type="date"
                    value={asignacionForm.fecha_fin_programada}
                    onChange={(event) =>
                      setAsignacionForm({
                        ...asignacionForm,
                        fecha_fin_programada: event.target.value,
                      })
                    }
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-900 p-2.5 text-sm text-zinc-200 outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-400">
                    Periodicidad de cobro
                  </label>
                  <select
                    value={asignacionForm.periodicidad_cobro}
                    onChange={(event) =>
                      setAsignacionForm({
                        ...asignacionForm,
                        periodicidad_cobro: event.target.value,
                      })
                    }
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-900 p-2.5 text-sm text-zinc-200 outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    {PERIODICIDAD_OPTIONS.map((option) => (
                      <option key={option.value || "default"} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-400">
                    Dia de vencimiento
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="31"
                    step="1"
                    placeholder="Usar configuracion base"
                    value={asignacionForm.dia_vencimiento}
                    onChange={(event) =>
                      setAsignacionForm({
                        ...asignacionForm,
                        dia_vencimiento: event.target.value,
                      })
                    }
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-900 p-2.5 text-sm text-zinc-200 outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-400">
                    Plazo en meses
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    placeholder="Usar configuracion base"
                    value={asignacionForm.plazo_meses}
                    onChange={(event) =>
                      setAsignacionForm({
                        ...asignacionForm,
                        plazo_meses: event.target.value,
                      })
                    }
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-900 p-2.5 text-sm text-zinc-200 outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="mb-1 block text-sm font-medium text-zinc-400">
                    Auto renovacion
                  </label>
                  <select
                    value={asignacionForm.auto_renueva}
                    onChange={(event) =>
                      setAsignacionForm({
                        ...asignacionForm,
                        auto_renueva: event.target.value,
                      })
                    }
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-900 p-2.5 text-sm text-zinc-200 outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="">Usar configuracion base</option>
                    <option value="true">Si, renovar automaticamente</option>
                    <option value="false">No, se cierra al finalizar</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-zinc-400">
                  Observaciones
                </label>
                <textarea
                  rows={3}
                  value={asignacionForm.observaciones}
                  onChange={(event) =>
                    setAsignacionForm({
                      ...asignacionForm,
                      observaciones: event.target.value,
                    })
                  }
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-900 p-2.5 text-sm text-zinc-200 outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="flex justify-end space-x-3 border-t border-zinc-800 pt-4">
                <button
                  type="button"
                  onClick={() => setEspacioAsignando(null)}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || clientes.length === 0}
                  className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
                >
                  Guardar asignacion
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {espacioFinalizando && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-xl font-bold text-white">
                  Finalizar ocupacion de {espacioFinalizando.codigo}
                </h3>
                <p className="mt-1 text-sm text-zinc-400">
                  El espacio quedara disponible para una nueva asignacion.
                </p>
              </div>
              <button
                onClick={() => setEspacioFinalizando(null)}
                className="text-zinc-500 transition-colors hover:text-white"
              >
                <svg
                  className="h-6 w-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            <form onSubmit={handleFinalizar} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-zinc-400">
                  Fecha fin
                </label>
                <input
                  required
                  type="date"
                  value={finalizacionForm.fecha_fin}
                  onChange={(event) =>
                    setFinalizacionForm({
                      ...finalizacionForm,
                      fecha_fin: event.target.value,
                    })
                  }
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-900 p-2.5 text-sm text-zinc-200 outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-zinc-400">
                  Observaciones
                </label>
                <textarea
                  rows={3}
                  value={finalizacionForm.observaciones}
                  onChange={(event) =>
                    setFinalizacionForm({
                      ...finalizacionForm,
                      observaciones: event.target.value,
                    })
                  }
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-900 p-2.5 text-sm text-zinc-200 outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="flex justify-end space-x-3 border-t border-zinc-800 pt-4">
                <button
                  type="button"
                  onClick={() => setEspacioFinalizando(null)}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="rounded-lg bg-amber-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-500 disabled:opacity-50"
                >
                  Finalizar ocupacion
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300">
          {error}
        </div>
      )}

      {showInventario && (
        <>
          <div className="page-section">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="section-title-compact">
                  Asignacion de espacios
                </h2>
                <p className="section-copy-compact text-zinc-400">
                  Configura el inventario real de la entidad, define plantillas,
                  crea unidades y vincula clientes sin una capa operativa
                  innecesaria.
                </p>
              </div>
              <div className="text-sm text-zinc-500">
                Clientes vinculados disponibles:{" "}
                <span className="font-semibold text-zinc-200">{clientes.length}</span>
              </div>
            </div>
          </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="metric-card-compact border-zinc-800 bg-zinc-950/80">
          <p className="metric-label-compact">
            Total espacios
          </p>
          <p className="metric-value-compact">{stats.total}</p>
        </div>
        <div className="metric-card-compact border-emerald-500/20 bg-emerald-500/10">
          <p className="metric-label-compact text-emerald-300/80">
            Disponibles
          </p>
          <p className="metric-value-compact">{stats.disponibles}</p>
        </div>
        <div className="metric-card-compact border-amber-500/20 bg-amber-500/10">
          <p className="metric-label-compact text-amber-300/80">
            Ocupados
          </p>
          <p className="metric-value-compact">{stats.ocupados}</p>
        </div>
        <div className="metric-card-compact border-blue-500/20 bg-blue-500/10">
          <p className="metric-label-compact text-blue-300/80">
            Reservados
          </p>
          <p className="metric-value-compact">{stats.reservados}</p>
        </div>
      </div>

      <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/[0.04] p-5">
        <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-200">
              Alta rapida de inventario
            </p>
            <h3 className="mt-2 text-2xl font-semibold text-white">
              Selecciona tipos de espacio y cantidad
            </h3>
            <p className="mt-2 max-w-3xl text-sm text-zinc-400">
              Marca los tipos que aplican para esta unidad de negocio. BetterP
              creara el tipo si aun no existe y generara codigos consecutivos
              listos para asignar clientes.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
            <button
              type="button"
              onClick={() => openCreateTipoModal()}
              className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-5 py-3 text-sm font-semibold text-cyan-100 transition-colors hover:bg-cyan-500/20"
            >
              Nuevo tipo de espacio
            </button>
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 px-4 py-3 text-sm text-zinc-300">
              <div className="text-xs uppercase tracking-[0.22em] text-zinc-500">
                Seleccion
              </div>
              <div className="mt-1 text-2xl font-semibold text-white">
                {quickSelectedTotal}
              </div>
              <div className="text-xs text-zinc-500">
                maximo {QUICK_SPACE_TOTAL_LIMIT} por carga
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
          {quickTemplates.map((template) => {
            const draft = quickDrafts[template.key] || {
              selected: false,
              quantity: "",
            };
            const quantity = parseQuickQuantity(draft.quantity);
            const prefix = getQuickDraftPrefix(template, draft);
            const start = getNextSequenceStart(espacios, prefix);
            const preview =
              draft.selected && quantity > 0
                ? `${prefix}${String(start).padStart(3, "0")} a ${prefix}${String(
                    start + quantity - 1
                  ).padStart(3, "0")}`
                : `Siguiente ${prefix}${String(start).padStart(3, "0")}`;

            return (
              <div
                key={template.key}
                className={`rounded-xl border p-4 transition-colors ${
                  draft.selected
                    ? "border-cyan-400/60 bg-cyan-500/10"
                    : "border-zinc-800 bg-zinc-950/70"
                }`}
              >
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={draft.selected}
                    onChange={(event) =>
                      updateQuickDraft(template.key, {
                        selected: event.target.checked,
                        quantity:
                          event.target.checked && !draft.quantity
                            ? "1"
                            : draft.quantity,
                        prefix: draft.prefix ?? template.prefijo,
                      })
                    }
                    className="mt-1 h-4 w-4 rounded border-zinc-700 bg-zinc-950 text-cyan-400"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-base font-semibold text-white">
                        {template.nombre}
                      </h4>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] ${
                          template.exists
                            ? "bg-emerald-500/10 text-emerald-300"
                            : "bg-zinc-800 text-zinc-400"
                        }`}
                      >
                        {template.exists ? "Configurado" : "Nuevo tipo"}
                      </span>
                      {!template.activo && (
                        <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-300">
                          Inactivo
                        </span>
                      )}
                    </div>
                    <p className="mt-2 line-clamp-2 text-sm text-zinc-400">
                      {template.descripcion}
                    </p>
                    <button
                      type="button"
                      onClick={() => openTemplateTipoModal(template)}
                      className="mt-3 rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-3 py-1.5 text-xs font-semibold text-cyan-200 transition-colors hover:bg-cyan-500/20"
                    >
                      {template.exists ? "Editar plantilla" : "Configurar plantilla"}
                    </button>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-[1fr_auto] items-end gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">
                      Cantidad
                    </label>
                    <input
                      inputMode="numeric"
                      pattern="[0-9]*"
                      min="1"
                      max={QUICK_SPACE_TOTAL_LIMIT}
                      value={draft.quantity}
                      disabled={!draft.selected}
                      placeholder="0"
                      onChange={(event) =>
                        updateQuickDraft(template.key, {
                          quantity: sanitizeQuantityInput(event.target.value),
                          selected:
                            event.target.value.trim() !== "" || draft.selected,
                        })
                      }
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-zinc-100 outline-none focus:border-cyan-400 disabled:cursor-not-allowed disabled:opacity-40"
                    />
                  </div>
                  <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-right text-xs text-zinc-400">
                    <div>{template.espaciosCount} actuales</div>
                    {template.rentaBase > 0 && (
                      <div className="mt-1 text-zinc-500">
                        {formatMoney(template.rentaBase)}
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-3">
                  <label className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">
                    Prefijo
                    <InfoButton
                      info={TIPO_FIELD_INFO.prefijo}
                      onInfo={setFieldInfo}
                    />
                  </label>
                  <input
                    value={prefix}
                    disabled={!draft.selected}
                    maxLength={16}
                    placeholder="Ej. HAB-"
                    onChange={(event) =>
                      updateQuickDraft(template.key, {
                        prefix: sanitizePrefixInput(event.target.value),
                        selected: draft.selected,
                      })
                    }
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm uppercase text-zinc-100 outline-none focus:border-cyan-400 disabled:cursor-not-allowed disabled:opacity-40"
                  />
                  <p className="mt-1 text-xs text-zinc-500">
                    Maximo 16 caracteres; acepta letras, numeros, espacios,
                    guion y diagonal.
                  </p>
                </div>

                <div className="mt-3 rounded-lg border border-zinc-800 bg-black/20 px-3 py-2 text-xs text-zinc-500">
                  {preview}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-5 flex flex-col gap-3 border-t border-zinc-800 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-zinc-500">
            Para una plantilla distinta, crea un nuevo tipo y despues selecciona
            la cantidad de espacios a generar.
          </p>
          <button
            type="button"
            disabled={isSubmitting || quickSelection.length === 0}
            onClick={() => void handleQuickGenerateSpaces()}
            className="rounded-lg bg-cyan-400 px-5 py-2.5 text-sm font-semibold text-zinc-950 transition-colors hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Crear espacios seleccionados
          </button>
        </div>
      </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-5">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-white">Catalogo de tipos</h3>
            <p className="mt-1 text-sm text-zinc-400">
              Aqui defines la renta sugerida por configuracion, no por contrato.
            </p>
          </div>
          <div className="text-sm text-zinc-500">Tipos activos: {tipos.length}</div>
        </div>

        {isLoading ? (
          <div className="py-8 text-center text-zinc-500">Cargando tipos...</div>
        ) : tipos.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/30 py-10 text-center text-sm text-zinc-500">
            Aun no hay tipos de espacio configurados.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {tipos.map((tipo) => (
              <div
                key={tipo.id}
                className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h4 className="font-semibold text-white">{tipo.nombre}</h4>
                    <p className="mt-1 text-sm text-zinc-400">
                      {tipo.descripcion || "Sin descripcion"}
                    </p>
                  </div>
                  <span className="rounded-full bg-zinc-800 px-2.5 py-1 text-xs text-zinc-300">
                    {tipo.espacios_count} espacios
                  </span>
                </div>
                <div className="mt-4 space-y-2 text-sm text-zinc-300">
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Renta base</span>
                    <span>{formatMoney(tipo.renta_base)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Deposito base</span>
                    <span>{formatMoney(tipo.deposito_base)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Recamaras</span>
                    <span>{tipo.recamaras ?? "-"}</span>
                  </div>
                </div>
                <div className="mt-5 flex justify-end gap-2 border-t border-zinc-800 pt-4">
                  <button
                    type="button"
                    onClick={() => openEditTipoModal(tipo)}
                    className="rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20"
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => openDeleteTipoModal(tipo)}
                    className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-200 transition-colors hover:bg-red-500/20"
                  >
                    Borrar
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
          </div>
        </>
      )}

      {showOperacion && (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-5">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-white">Operacion diaria</h3>
            <p className="mt-1 text-sm text-zinc-400">
              Visualiza disponibilidad, cliente actual y acciones por espacio.
            </p>
          </div>
          <button
            onClick={() => void loadData()}
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-800"
          >
            Refrescar
          </button>
        </div>

        {isLoading ? (
          <div className="py-10 text-center text-zinc-500">Cargando espacios...</div>
        ) : espacios.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/30 py-10 text-center text-sm text-zinc-500">
            Todavia no hay espacios registrados en esta entidad.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-left text-sm text-zinc-300">
              <thead className="border-b border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="py-3 pr-4">Espacio</th>
                  <th className="py-3 pr-4">Tipo</th>
                  <th className="py-3 pr-4">Estatus</th>
                  <th className="py-3 pr-4">Renta sugerida</th>
                  <th className="py-3 pr-4">Cliente actual</th>
                  <th className="py-3 pr-4">Inicio</th>
                  <th className="py-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {espacios.map((espacio) => (
                  <tr key={espacio.id} className="align-top hover:bg-zinc-900/40">
                    <td className="py-4 pr-4">
                      <div className="font-medium text-white">{espacio.codigo}</div>
                      {espacio.observaciones && (
                        <div className="mt-1 max-w-xs text-xs text-zinc-500">
                          {espacio.observaciones}
                        </div>
                      )}
                    </td>
                    <td className="py-4 pr-4 text-zinc-300">
                      {espacio.tipo_nombre || "Sin tipo"}
                    </td>
                    <td className="py-4 pr-4">
                      <span
                        className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${getStatusStyles(
                          espacio.estatus
                        )}`}
                      >
                        {espacio.estatus}
                      </span>
                    </td>
                    <td className="py-4 pr-4">
                      <div className="font-medium text-white">
                        {formatMoney(espacio.renta_sugerida)}
                      </div>
                      <div className="mt-1 text-xs text-zinc-500">
                        Deposito: {formatMoney(espacio.deposito_sugerido)}
                      </div>
                    </td>
                    <td className="py-4 pr-4">
                      {espacio.cliente_actual_nombre ? (
                        <>
                          <div className="font-medium text-white">
                            {espacio.cliente_actual_nombre}
                          </div>
                          <div className="mt-1 text-xs text-zinc-500">
                            {espacio.periodicidad_cobro || "Periodicidad base"}
                            {espacio.dia_vencimiento
                              ? ` - vence dia ${espacio.dia_vencimiento}`
                              : ""}
                            {espacio.auto_renueva ? " - auto-renueva" : ""}
                          </div>
                        </>
                      ) : (
                        <span className="text-zinc-500">Sin asignacion</span>
                      )}
                    </td>
                    <td className="py-4 pr-4 text-zinc-400">
                      <div>{espacio.ocupacion_desde || "-"}</div>
                      {espacio.fecha_fin_programada && (
                        <div className="mt-1 text-xs text-zinc-500">
                          Fin programado: {espacio.fecha_fin_programada}
                        </div>
                      )}
                    </td>
                    <td className="py-4 text-right">
                      <div className="flex justify-end gap-2">
                        {!espacio.asignacion_activa_id && (
                          <button
                            onClick={() => openAsignacionModal(espacio)}
                            disabled={clientes.length === 0}
                            className="rounded-lg border border-blue-500/20 bg-blue-500/10 px-3 py-2 text-xs font-medium text-blue-300 transition-colors hover:bg-blue-500/20 disabled:opacity-40"
                          >
                            Asignar
                          </button>
                        )}
                        {espacio.asignacion_activa_id && (
                          <button
                            onClick={() => openFinalizacionModal(espacio)}
                            className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-300 transition-colors hover:bg-amber-500/20"
                          >
                            Finalizar
                          </button>
                        )}
                      </div>
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
