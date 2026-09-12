"use client";

import { buildApiUrl } from '@/lib/api';

import { useParams } from "next/navigation";
import { type FormEvent, useEffect, useMemo, useState } from "react";

const EMPRESAS_API_BASE = buildApiUrl("/empresas");

type VistaReglas = "ENTIDAD" | "CAPA";
type ReglaFormScope = "LOCAL" | "CAPA" | "PERSONALIZAR";

interface ReglaItem {
  id: number;
  nombre: string;
  tipo_calculo: string;
  valor: number;
  periodicidad: string;
  aplica_a_todos: boolean;
  dias_condicion: number | null;
  activo: boolean;
  origen: "LOCAL" | "GLOBAL" | "OVERRIDE";
  regla_marco_id: number | null;
  capa_negocio_id: number | null;
  capa_negocio_nombre: string | null;
  editable_en_entidad: boolean;
}

interface EntidadContext {
  id: number;
  nombre_comercial: string;
  capa_negocio_id: number | null;
  capa_negocio_nombre: string | null;
}

interface ReglaFormState {
  nombre: string;
  tipo_calculo: string;
  valor: string;
  periodicidad: string;
  aplica_a_todos: boolean;
  dias_condicion: string;
}

type ReglaFormErrors = Partial<Record<keyof ReglaFormState, string>>;

interface FieldInfo {
  title: string;
  body: string;
  details?: string[];
}

interface ModalBorradoState {
  isOpen: boolean;
  reglaId: number | null;
  nombre: string;
  scope: "LOCAL" | "CAPA";
}

interface ReglasManagerProps {
  entidadId?: string;
  embedded?: boolean;
}

const EMPTY_RULE_FORM: ReglaFormState = {
  nombre: "",
  tipo_calculo: "CARGO_FIJO",
  valor: "",
  periodicidad: "MENSUAL",
  aplica_a_todos: false,
  dias_condicion: "",
};

const LABELS_TIPO_CALCULO: Record<string, string> = {
  CARGO_FIJO: "Cargo fijo ($)",
  PORCENTAJE_RECARGO: "Recargo (+%)",
  DESCUENTO_FIJO: "Descuento fijo (-$)",
  PORCENTAJE_DESCUENTO: "Descuento (-%)",
};

const LABELS_PERIODICIDAD: Record<string, string> = {
  UNICO: "Unico",
  SEMANAL: "Semanal",
  QUINCENAL: "Quincenal",
  MENSUAL: "Mensual",
  BIMESTRAL: "Bimestral",
  ANUAL: "Anual",
};

const MONEY_RULE_TYPES = new Set(["CARGO_FIJO", "DESCUENTO_FIJO"]);
const PERCENT_RULE_TYPES = new Set([
  "PORCENTAJE_RECARGO",
  "PORCENTAJE_DESCUENTO",
]);

const REGLA_FIELD_INFO = {
  nombre: {
    title: "Nombre de la regla",
    body:
      "Nombre operativo que identifica la regla en la entidad o en la capa. Debe ser claro para que el equipo entienda cuando se aplica sin abrir el detalle.",
    details: [
      "Obligatorio.",
      "Debe tener entre 3 y 120 caracteres.",
      "Debe incluir texto real; no se aceptan nombres formados solo por numeros.",
      "Ejemplos utiles: Interes moratorio mensual, Descuento por pronto pago, Deposito de garantia.",
    ],
  },
  tipo_calculo: {
    title: "Impacto financiero",
    body:
      "Define como afecta la regla al saldo del cliente o al cargo operativo. El tipo elegido cambia la validacion del campo Valor.",
    details: [
      "Cargo fijo: suma un monto en pesos.",
      "Recargo porcentual: suma un porcentaje sobre el monto base.",
      "Descuento fijo: resta un monto en pesos.",
      "Descuento porcentual: resta un porcentaje sobre el monto base.",
    ],
  },
  valor: {
    title: "Valor",
    body:
      "Monto o porcentaje que se aplicara cuando la regla entre en vigor. BetterP valida el formato segun el impacto financiero seleccionado.",
    details: [
      "Para cargos y descuentos fijos, captura dinero mayor a 0 con hasta 2 decimales.",
      "Para recargos y descuentos porcentuales, captura un porcentaje mayor a 0 con hasta 2 decimales.",
      "No uses simbolos de moneda, comas ni texto. Escribe 1500.00 o 5.5.",
      "Los porcentajes se limitan a 999.99 y los montos a 99,999,999.99.",
    ],
  },
  periodicidad: {
    title: "Periodicidad",
    body:
      "Indica si la regla se aplica una sola vez o si se repite con una frecuencia operativa. Esto ayuda a separar cobros extraordinarios de reglas recurrentes.",
    details: [
      "Unico: se considera solo en el primer periodo o cuando el equipo lo aplique manualmente.",
      "Semanal, quincenal, mensual, bimestral o anual: se considera como regla recurrente.",
      "La periodicidad no genera cargos por si sola; define como se interpreta la regla.",
    ],
  },
  dias_condicion: {
    title: "Dias condicion",
    body:
      "Condicion temporal para aplicar la regla respecto al vencimiento. Sirve para recargos por atraso o descuentos por pronto pago.",
    details: [
      "Opcional. Si queda vacio, la regla no depende de dias.",
      "Usa 0 para aplicar el mismo dia del vencimiento.",
      "Usa numeros positivos para atrasos, por ejemplo 3 significa tres dias despues del vencimiento.",
      "En reglas locales o personalizadas puedes usar numeros negativos para pronto pago, por ejemplo -5 significa cinco dias antes del vencimiento.",
      "Las reglas base de capa aceptan de 0 a 365 dias por compatibilidad operativa.",
    ],
  },
  aplica_a_todos: {
    title: "Aplica a todos",
    body:
      "Controla si la regla se considera una base general para todos los clientes o espacios de la entidad. Si se desactiva, queda disponible como referencia o aplicacion manual.",
    details: [
      "Activado: se interpreta como regla general para la entidad o capa.",
      "Desactivado: conserva la regla, pero no se asume como automatica para toda la operacion.",
      "Usalo desactivado para reglas especiales que solo aplican por excepcion.",
    ],
  },
} satisfies Record<string, FieldInfo>;

function getEntidadIdFromParams(
  value: string | string[] | undefined,
  fallback?: string
) {
  if (typeof value === "string" && value.trim()) {
    return value;
  }

  if (Array.isArray(value) && value.length > 0 && value[0]) {
    return value[0];
  }

  return fallback;
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

function getOrigenStyles(origen: ReglaItem["origen"]) {
  if (origen === "GLOBAL") {
    return "border-cyan-500/20 bg-cyan-500/10 text-cyan-300";
  }

  if (origen === "OVERRIDE") {
    return "border-amber-500/20 bg-amber-500/10 text-amber-300";
  }

  return "border-emerald-500/20 bg-emerald-500/10 text-emerald-300";
}

function getOrigenLabel(origen: ReglaItem["origen"]) {
  if (origen === "GLOBAL") {
    return "Heredada";
  }

  if (origen === "OVERRIDE") {
    return "Personalizada";
  }

  return "Local";
}

function buildRulePayload(form: ReglaFormState) {
  return {
    ...form,
    valor: Number(form.valor || 0),
    dias_condicion:
      form.dias_condicion.trim() === "" ? null : Number(form.dias_condicion),
  };
}

function sanitizeRuleNameInput(value: string) {
  return value
    .replace(/[^\p{L}\p{N}\s.,()+/%$#_-]/gu, "")
    .replace(/\s{2,}/g, " ")
    .slice(0, 120);
}

function sanitizeDecimalInput(value: string, maxIntegerDigits: number) {
  const normalized = value.replace(",", ".").replace(/[^\d.]/g, "");
  const hasDecimalPoint = normalized.includes(".");
  const parts = normalized.split(".");
  const rawInteger = parts[0] ?? "";
  const integerPart = rawInteger.slice(0, maxIntegerDigits);
  const decimalPart = parts.slice(1).join("").slice(0, 2);

  if (!hasDecimalPoint) {
    return integerPart;
  }

  return `${integerPart || "0"}.${decimalPart}`;
}

function sanitizeRuleValueInput(value: string, tipoCalculo: string) {
  return sanitizeDecimalInput(value, MONEY_RULE_TYPES.has(tipoCalculo) ? 8 : 3);
}

function sanitizeRuleDaysInput(value: string, allowNegative: boolean) {
  const trimmed = value.trim();
  const isNegative = allowNegative && trimmed.startsWith("-");
  const digits = value.replace(/\D/g, "").slice(0, 3);

  if (!digits) {
    return isNegative ? "-" : "";
  }

  return `${isNegative ? "-" : ""}${digits}`;
}

function validateRuleForm(
  form: ReglaFormState,
  scope: ReglaFormScope
): ReglaFormErrors {
  const errors: ReglaFormErrors = {};
  const nombre = form.nombre.trim();
  const valor = form.valor.trim();
  const diasCondicion = form.dias_condicion.trim();

  if (!nombre) {
    errors.nombre = "Nombre de la regla es obligatorio.";
  } else if (nombre.length < 3) {
    errors.nombre = "Nombre debe tener al menos 3 caracteres.";
  } else if (nombre.length > 120) {
    errors.nombre = "Nombre no puede exceder 120 caracteres.";
  } else if (!/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(nombre)) {
    errors.nombre = "Nombre debe incluir texto, no solo numeros o simbolos.";
  }

  if (!LABELS_TIPO_CALCULO[form.tipo_calculo]) {
    errors.tipo_calculo = "Selecciona un impacto financiero valido.";
  }

  if (!valor) {
    errors.valor = "Valor es obligatorio.";
  } else if (!/^\d+(\.\d{1,2})?$/.test(valor)) {
    errors.valor = "Valor solo acepta numeros y hasta 2 decimales.";
  } else {
    const parsedValue = Number(valor);

    if (!Number.isFinite(parsedValue)) {
      errors.valor = "Valor debe ser numerico.";
    } else if (parsedValue <= 0) {
      errors.valor = "Valor debe ser mayor a 0 para que la regla tenga impacto.";
    } else if (MONEY_RULE_TYPES.has(form.tipo_calculo) && parsedValue > 99999999.99) {
      errors.valor = "El monto maximo permitido es 99,999,999.99.";
    } else if (
      PERCENT_RULE_TYPES.has(form.tipo_calculo) &&
      parsedValue > 999.99
    ) {
      errors.valor = "El porcentaje maximo permitido es 999.99.";
    }
  }

  if (!LABELS_PERIODICIDAD[form.periodicidad]) {
    errors.periodicidad = "Selecciona una periodicidad valida.";
  }

  if (diasCondicion && !/^-?\d+$/.test(diasCondicion)) {
    errors.dias_condicion = "Dias condicion solo acepta numeros enteros.";
  } else if (diasCondicion) {
    const parsedDays = Number(diasCondicion);

    if (!Number.isInteger(parsedDays)) {
      errors.dias_condicion = "Dias condicion debe ser un numero entero.";
    } else if (scope === "CAPA" && parsedDays < 0) {
      errors.dias_condicion =
        "En reglas base de capa usa dias de 0 a 365. Para pronto pago usa una regla local o personalizacion.";
    } else if (parsedDays < -365 || parsedDays > 365) {
      errors.dias_condicion = "Dias condicion debe estar entre -365 y 365.";
    }
  }

  return errors;
}

function hasRuleErrors(errors: ReglaFormErrors) {
  return Object.values(errors).some(Boolean);
}

function getRuleFieldClass(error?: string) {
  return `w-full rounded-lg border bg-zinc-950 p-2.5 text-sm text-white outline-none transition focus:ring-1 ${
    error
      ? "border-red-400/60 focus:ring-red-400"
      : "border-zinc-700 focus:ring-blue-500"
  }`;
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
        aria-labelledby="rule-field-info-title"
        className="w-full max-w-lg rounded-2xl border border-cyan-500/20 bg-zinc-950 p-5 shadow-2xl shadow-black/60"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-200">
              Detalle del campo
            </p>
            <h3
              id="rule-field-info-title"
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

function RuleFieldLabel({
  label,
  required,
  info,
  onInfo,
}: {
  label: string;
  required?: boolean;
  info: FieldInfo;
  onInfo: (info: FieldInfo) => void;
}) {
  return (
    <div className="mb-1 flex flex-wrap items-center gap-2">
      <span className="text-sm font-medium text-zinc-400">{label}</span>
      <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-200">
        {required ? "Obligatorio" : "Opcional"}
      </span>
      <InfoButton info={info} onInfo={onInfo} />
    </div>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) {
    return null;
  }

  return <p className="mt-2 text-xs text-red-300">{message}</p>;
}

export default function ReglasManager({
  entidadId: propEntidadId,
  embedded = false,
}: ReglasManagerProps) {
  const params = useParams<{ id?: string | string[] }>();
  const entidadId = getEntidadIdFromParams(params?.id, propEntidadId);

  const [vistaReglas, setVistaReglas] = useState<VistaReglas>("ENTIDAD");
  const [entidadContext, setEntidadContext] = useState<EntidadContext | null>(
    null
  );
  const [reglas, setReglas] = useState<ReglaItem[]>([]);
  const [reglasCapa, setReglasCapa] = useState<ReglaItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [mostrarFormulario, setMostrarFormulario] = useState(false);
  const [mensajeExito, setMensajeExito] = useState("");
  const [formScope, setFormScope] = useState<ReglaFormScope>("LOCAL");
  const [reglaEnEdicion, setReglaEnEdicion] = useState<ReglaItem | null>(null);
  const [modalBorrado, setModalBorrado] = useState<ModalBorradoState>({
    isOpen: false,
    reglaId: null,
    nombre: "",
    scope: "LOCAL",
  });
  const [montoBase, setMontoBase] = useState(1000);
  const [simularProntoPago, setSimularProntoPago] = useState(false);
  const [simularAtraso, setSimularAtraso] = useState(false);
  const [nuevaRegla, setNuevaRegla] = useState<ReglaFormState>(EMPTY_RULE_FORM);
  const [formErrors, setFormErrors] = useState<ReglaFormErrors>({});
  const [fieldInfo, setFieldInfo] = useState<FieldInfo | null>(null);

  const canManageCapa = Boolean(entidadContext?.capa_negocio_id);

  const updateNuevaRegla = (patch: Partial<ReglaFormState>) => {
    setNuevaRegla((current) => ({ ...current, ...patch }));
    setFormErrors((current) => {
      const next = { ...current };
      (Object.keys(patch) as Array<keyof ReglaFormState>).forEach((key) => {
        delete next[key];
      });
      return next;
    });
  };

  const fetchReglas = async () => {
    if (!entidadId) {
      setEntidadContext(null);
      setReglas([]);
      setReglasCapa([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    try {
      const entidadRes = await fetch(`${EMPRESAS_API_BASE}/${entidadId}/`, {
        cache: "no-store",
      });

      if (!entidadRes.ok) {
        throw new Error("No se pudo cargar la entidad.");
      }

      const entidadData = (await entidadRes.json()) as EntidadContext;
      setEntidadContext(entidadData);

      const reglasRes = await fetch(`${EMPRESAS_API_BASE}/${entidadId}/reglas/`, {
        cache: "no-store",
      });

      if (!reglasRes.ok) {
        throw new Error("No se pudieron cargar las reglas.");
      }

      const reglasData = (await reglasRes.json()) as ReglaItem[];
      setReglas(reglasData);

      if (entidadData.capa_negocio_id) {
        const reglasCapaRes = await fetch(
          `${EMPRESAS_API_BASE}/capas/${entidadData.capa_negocio_id}/reglas/`,
          { cache: "no-store" }
        );

        if (!reglasCapaRes.ok) {
          throw new Error("No se pudieron cargar las reglas base de la capa.");
        }

        const reglasCapaData = (await reglasCapaRes.json()) as ReglaItem[];
        setReglasCapa(reglasCapaData);
      } else {
        setReglasCapa([]);
        setVistaReglas("ENTIDAD");
      }
    } catch (error) {
      console.error("Error cargando reglas:", error);
      setEntidadContext(null);
      setReglas([]);
      setReglasCapa([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void fetchReglas();
  }, [entidadId]);

  const resetFormulario = () => {
    setNuevaRegla(EMPTY_RULE_FORM);
    setFormErrors({});
    setReglaEnEdicion(null);
    setFormScope("LOCAL");
    setMostrarFormulario(false);
  };

  const openNuevaRegla = (scope: ReglaFormScope) => {
    setNuevaRegla(EMPTY_RULE_FORM);
    setFormErrors({});
    setReglaEnEdicion(null);
    setFormScope(scope);
    setMostrarFormulario(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleGuardarRegla = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!entidadId) {
      return;
    }

    const validationErrors = validateRuleForm(nuevaRegla, formScope);
    setFormErrors(validationErrors);

    if (hasRuleErrors(validationErrors)) {
      return;
    }

    const payload = buildRulePayload(nuevaRegla);
    let url = `${EMPRESAS_API_BASE}/${entidadId}/reglas/`;
    let method = "POST";
    let finalPayload: Record<string, unknown> = payload;

    if (reglaEnEdicion) {
      if (formScope === "PERSONALIZAR") {
        url = `${EMPRESAS_API_BASE}/${entidadId}/reglas/personalizar/`;
        method = "POST";
        finalPayload = {
          ...payload,
          regla_marco_id: reglaEnEdicion.regla_marco_id ?? reglaEnEdicion.id,
        };
      } else if (formScope === "CAPA") {
        url = `${EMPRESAS_API_BASE}/capas/reglas/${reglaEnEdicion.id}/`;
        method = "PUT";
      } else {
        url = `${EMPRESAS_API_BASE}/reglas/${reglaEnEdicion.id}/`;
        method = "PUT";
      }
    } else if (formScope === "CAPA") {
      if (!entidadContext?.capa_negocio_id) {
        alert("Esta entidad no tiene una capa de negocio vinculada.");
        return;
      }
      url = `${EMPRESAS_API_BASE}/capas/${entidadContext.capa_negocio_id}/reglas/`;
    }

    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(finalPayload),
      });

      if (!res.ok) {
        const errorBody = (await res.json()) as unknown;
        throw new Error(getErrorMessage(errorBody, "No se pudo guardar la regla."));
      }

      const successMessage =
        formScope === "CAPA"
          ? reglaEnEdicion
            ? "Regla base actualizada correctamente."
            : "Regla base creada correctamente."
          : formScope === "PERSONALIZAR"
            ? "Personalizacion guardada correctamente."
            : reglaEnEdicion
              ? "Regla local actualizada correctamente."
              : "Regla local creada correctamente.";

      resetFormulario();
      await fetchReglas();
      setMensajeExito(successMessage);
      window.setTimeout(() => setMensajeExito(""), 3000);
    } catch (error) {
      console.error("Error al guardar la regla:", error);
      alert(
        error instanceof Error ? error.message : "Error al guardar la regla."
      );
    }
  };

  const iniciarBorrado = (regla: ReglaItem, scope: "LOCAL" | "CAPA") => {
    setModalBorrado({
      isOpen: true,
      reglaId: regla.id,
      nombre: regla.nombre,
      scope,
    });
  };

  const confirmarBorrado = async () => {
    if (!modalBorrado.reglaId) {
      return;
    }

    const url =
      modalBorrado.scope === "CAPA"
        ? `${EMPRESAS_API_BASE}/capas/reglas/${modalBorrado.reglaId}/`
        : `${EMPRESAS_API_BASE}/reglas/${modalBorrado.reglaId}/`;

    try {
      const res = await fetch(url, { method: "DELETE" });

      if (!res.ok) {
        throw new Error("No se pudo eliminar la regla.");
      }

      await fetchReglas();
      setMensajeExito(
        modalBorrado.scope === "CAPA"
          ? "Regla base eliminada correctamente."
          : "Regla eliminada correctamente."
      );
      window.setTimeout(() => setMensajeExito(""), 3000);
    } catch (error) {
      console.error("Error al eliminar la regla:", error);
      alert("Error al eliminar la regla.");
    } finally {
      setModalBorrado({
        isOpen: false,
        reglaId: null,
        nombre: "",
        scope: "LOCAL",
      });
    }
  };

  const handleEditarRegla = (regla: ReglaItem) => {
    setNuevaRegla({
      nombre: regla.nombre,
      tipo_calculo: regla.tipo_calculo,
      valor: regla.valor.toString(),
      periodicidad: regla.periodicidad,
      aplica_a_todos: regla.aplica_a_todos,
      dias_condicion:
        regla.dias_condicion === null ? "" : regla.dias_condicion.toString(),
    });
    setFormErrors({});
    setReglaEnEdicion(regla);

    if (vistaReglas === "CAPA") {
      setFormScope("CAPA");
    } else if (regla.origen === "GLOBAL" || regla.origen === "OVERRIDE") {
      setFormScope("PERSONALIZAR");
    } else {
      setFormScope("LOCAL");
    }

    setMostrarFormulario(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleClonarRegla = (regla: ReglaItem) => {
    setNuevaRegla({
      nombre: `${regla.nombre} (Copia)`,
      tipo_calculo: regla.tipo_calculo,
      valor: regla.valor.toString(),
      periodicidad: regla.periodicidad,
      aplica_a_todos: regla.aplica_a_todos,
      dias_condicion:
        regla.dias_condicion === null ? "" : regla.dias_condicion.toString(),
    });
    setFormErrors({});
    setReglaEnEdicion(null);
    setFormScope(vistaReglas === "CAPA" ? "CAPA" : "LOCAL");
    setMostrarFormulario(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const simulacion = useMemo(() => {
    const desglose: Array<{
      nombre: string;
      impacto: number;
      esUnico: boolean;
      origen: ReglaItem["origen"];
    }> = [];

    let pagosUnicos = 0;
    let totalRecurrente = montoBase;

    reglas.forEach((regla) => {
      if (regla.dias_condicion !== null) {
        if (regla.dias_condicion < 0 && !simularProntoPago) {
          return;
        }

        if (regla.dias_condicion > 0 && !simularAtraso) {
          return;
        }
      }

      const valor = Number(regla.valor);
      let impacto = 0;

      if (regla.tipo_calculo === "CARGO_FIJO") {
        impacto = valor;
      }

      if (regla.tipo_calculo === "DESCUENTO_FIJO") {
        impacto = -valor;
      }

      if (regla.tipo_calculo === "PORCENTAJE_RECARGO") {
        impacto = montoBase * (valor / 100);
      }

      if (regla.tipo_calculo === "PORCENTAJE_DESCUENTO") {
        impacto = -(montoBase * (valor / 100));
      }

      desglose.push({
        nombre: regla.nombre,
        impacto,
        esUnico: regla.periodicidad === "UNICO",
        origen: regla.origen,
      });

      if (regla.periodicidad === "UNICO") {
        pagosUnicos += impacto;
        return;
      }

      totalRecurrente += impacto;
    });

    return {
      pagosUnicos,
      totalRecurrente,
      desglose,
      granTotal: totalRecurrente + pagosUnicos,
    };
  }, [montoBase, reglas, simularAtraso, simularProntoPago]);

  const visibleRules = vistaReglas === "CAPA" ? reglasCapa : reglas;

  const formTitle = useMemo(() => {
    if (formScope === "CAPA") {
      return reglaEnEdicion ? "Editar regla base" : "Nueva regla base";
    }

    if (formScope === "PERSONALIZAR") {
      return "Personalizar regla heredada";
    }

    return reglaEnEdicion ? "Editar regla local" : "Nueva regla local";
  }, [formScope, reglaEnEdicion]);

  return (
    <div className="relative mx-auto max-w-7xl space-y-6">
      {mensajeExito && (
        <div className="fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-lg border border-green-500/50 bg-green-500/20 px-4 py-2 text-green-400 shadow-lg">
          <span className="text-sm font-medium">{mensajeExito}</span>
        </div>
      )}

      <FieldInfoModal info={fieldInfo} onClose={() => setFieldInfo(null)} />

      {modalBorrado.isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl">
            <h3 className="mb-2 text-xl font-bold text-white">Eliminar regla</h3>
            <p className="mb-6 text-sm text-zinc-400">
              Vas a eliminar de forma permanente la regla{" "}
              <span className="font-semibold text-white">
                "{modalBorrado.nombre}"
              </span>
              .
            </p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() =>
                  setModalBorrado({
                    isOpen: false,
                    reglaId: null,
                    nombre: "",
                    scope: "LOCAL",
                  })
                }
                className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white"
              >
                Cancelar
              </button>
              <button
                onClick={confirmarBorrado}
                className="rounded-lg border border-red-600/20 bg-red-600/10 px-4 py-2 text-sm font-medium text-red-400 transition-all hover:bg-red-600 hover:text-white"
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}

      {embedded && (
        <div className="flex flex-col gap-4 rounded-2xl border border-zinc-800 bg-zinc-950/70 p-5">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold text-white">
                Reglas y automatizaciones
              </h2>
              <p className="mt-1 text-sm text-zinc-400">
                Gestiona reglas locales de esta entidad y, si existe, la base
                compartida de su capa de negocio.
              </p>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              {canManageCapa && (
                <button
                  onClick={() => openNuevaRegla("CAPA")}
                  className="rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-300 transition-colors hover:bg-cyan-500/20"
                >
                  Nueva regla base
                </button>
              )}
              <button
                onClick={() => openNuevaRegla("LOCAL")}
                className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-blue-500/20 transition-colors hover:bg-blue-500"
              >
                Nueva regla local
              </button>
            </div>
          </div>

          {canManageCapa && entidadContext?.capa_negocio_nombre && (
            <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100/90">
              Esta entidad hereda reglas y defaults desde la capa{" "}
              <span className="font-semibold">
                {entidadContext.capa_negocio_nombre}
              </span>
              . Desde aqui puedes crear reglas locales o reglas base compartidas.
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            {canManageCapa && (
              <div className="flex flex-wrap gap-2 rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
                <button
                  onClick={() => setVistaReglas("ENTIDAD")}
                  className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                    vistaReglas === "ENTIDAD"
                      ? "bg-blue-500/10 text-blue-400"
                      : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                  }`}
                >
                  Vista entidad
                </button>
                <button
                  onClick={() => setVistaReglas("CAPA")}
                  className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                    vistaReglas === "CAPA"
                      ? "bg-cyan-500/10 text-cyan-300"
                      : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                  }`}
                >
                  Vista capa
                </button>
              </div>
            )}

            {mostrarFormulario && (
              <form
                onSubmit={handleGuardarRegla}
                className="space-y-5 rounded-xl border border-blue-500/20 bg-zinc-900/80 p-5"
              >
                <div className="border-b border-zinc-800 pb-3">
                  <h3 className="font-medium text-white">{formTitle}</h3>
                  <p className="mt-1 text-sm text-zinc-500">
                    {formScope === "CAPA"
                      ? "Esta regla quedara disponible para todas las entidades conectadas a la misma capa."
                      : formScope === "PERSONALIZAR"
                        ? "Guardaras una excepcion para esta entidad sin modificar la regla base."
                        : "Esta regla solo impactara a la entidad actual."}
                  </p>
                </div>

                {!reglaEnEdicion && canManageCapa && (
                  <div className="flex flex-wrap gap-2 rounded-lg border border-zinc-800 bg-zinc-950 p-2">
                    <button
                      type="button"
                      onClick={() => {
                        setFormScope("LOCAL");
                        setFormErrors({});
                      }}
                      className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                        formScope === "LOCAL"
                          ? "bg-emerald-500/10 text-emerald-300"
                          : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                      }`}
                    >
                      Solo entidad
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setFormScope("CAPA");
                        setNuevaRegla((current) => ({
                          ...current,
                          dias_condicion: sanitizeRuleDaysInput(
                            current.dias_condicion,
                            false
                          ),
                        }));
                        setFormErrors({});
                      }}
                      className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                        formScope === "CAPA"
                          ? "bg-cyan-500/10 text-cyan-300"
                          : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                      }`}
                    >
                      Toda la capa
                    </button>
                  </div>
                )}

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <RuleFieldLabel
                      label="Nombre de la regla"
                      required
                      info={REGLA_FIELD_INFO.nombre}
                      onInfo={setFieldInfo}
                    />
                    <input
                      required
                      type="text"
                      maxLength={120}
                      placeholder="Ej. Interes moratorio, poliza juridica"
                      value={nuevaRegla.nombre}
                      onChange={(event) =>
                        updateNuevaRegla({
                          nombre: sanitizeRuleNameInput(event.target.value),
                        })
                      }
                      aria-invalid={Boolean(formErrors.nombre)}
                      className={getRuleFieldClass(formErrors.nombre)}
                    />
                    <p className="mt-2 text-xs text-zinc-500">
                      De 3 a 120 caracteres; evita claves internas que no entienda
                      el equipo.
                    </p>
                    <FieldError message={formErrors.nombre} />
                  </div>

                  <div>
                    <RuleFieldLabel
                      label="Impacto financiero"
                      required
                      info={REGLA_FIELD_INFO.tipo_calculo}
                      onInfo={setFieldInfo}
                    />
                    <select
                      value={nuevaRegla.tipo_calculo}
                      onChange={(event) => {
                        const tipoCalculo = event.target.value;
                        updateNuevaRegla({
                          tipo_calculo: tipoCalculo,
                          valor: sanitizeRuleValueInput(
                            nuevaRegla.valor,
                            tipoCalculo
                          ),
                        });
                      }}
                      aria-invalid={Boolean(formErrors.tipo_calculo)}
                      className={getRuleFieldClass(formErrors.tipo_calculo)}
                    >
                      {Object.entries(LABELS_TIPO_CALCULO).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <p className="mt-2 text-xs text-zinc-500">
                      El tipo define si el valor se captura como dinero o porcentaje.
                    </p>
                    <FieldError message={formErrors.tipo_calculo} />
                  </div>

                  <div>
                    <RuleFieldLabel
                      label="Valor"
                      required
                      info={REGLA_FIELD_INFO.valor}
                      onInfo={setFieldInfo}
                    />
                    <input
                      required
                      type="text"
                      inputMode="decimal"
                      placeholder={
                        MONEY_RULE_TYPES.has(nuevaRegla.tipo_calculo)
                          ? "Ej. 1500.00"
                          : "Ej. 5.50"
                      }
                      value={nuevaRegla.valor}
                      onChange={(event) =>
                        updateNuevaRegla({
                          valor: sanitizeRuleValueInput(
                            event.target.value,
                            nuevaRegla.tipo_calculo
                          ),
                        })
                      }
                      aria-invalid={Boolean(formErrors.valor)}
                      className={getRuleFieldClass(formErrors.valor)}
                    />
                    <p className="mt-2 text-xs text-zinc-500">
                      {MONEY_RULE_TYPES.has(nuevaRegla.tipo_calculo)
                        ? "Solo dinero mayor a 0, sin simbolos ni comas, hasta 2 decimales."
                        : "Solo porcentaje mayor a 0, sin simbolo %, hasta 2 decimales."}
                    </p>
                    <FieldError message={formErrors.valor} />
                  </div>

                  <div>
                    <RuleFieldLabel
                      label="Periodicidad"
                      required
                      info={REGLA_FIELD_INFO.periodicidad}
                      onInfo={setFieldInfo}
                    />
                    <select
                      value={nuevaRegla.periodicidad}
                      onChange={(event) =>
                        updateNuevaRegla({
                          periodicidad: event.target.value,
                        })
                      }
                      aria-invalid={Boolean(formErrors.periodicidad)}
                      className={getRuleFieldClass(formErrors.periodicidad)}
                    >
                      {Object.entries(LABELS_PERIODICIDAD).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <p className="mt-2 text-xs text-zinc-500">
                      Define si la regla es unica o se interpreta como recurrente.
                    </p>
                    <FieldError message={formErrors.periodicidad} />
                  </div>

                  <div>
                    <RuleFieldLabel
                      label="Dias condicion"
                      info={REGLA_FIELD_INFO.dias_condicion}
                      onInfo={setFieldInfo}
                    />
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="Ej. 3 atraso, -5 pronto pago"
                      value={nuevaRegla.dias_condicion}
                      onChange={(event) =>
                        updateNuevaRegla({
                          dias_condicion: sanitizeRuleDaysInput(
                            event.target.value,
                            formScope !== "CAPA"
                          ),
                        })
                      }
                      aria-invalid={Boolean(formErrors.dias_condicion)}
                      className={getRuleFieldClass(formErrors.dias_condicion)}
                    />
                    <p className="mt-2 text-xs text-zinc-500">
                      {formScope === "CAPA"
                        ? "Opcional. Solo enteros de 0 a 365 en reglas base de capa."
                        : "Opcional. Enteros de -365 a 365; negativo para pronto pago."}
                    </p>
                    <FieldError message={formErrors.dias_condicion} />
                  </div>

                  <div className="flex items-end">
                    <label className="flex w-full items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-300">
                      <input
                        type="checkbox"
                        checked={nuevaRegla.aplica_a_todos}
                        onChange={(event) =>
                          updateNuevaRegla({
                            aplica_a_todos: event.target.checked,
                          })
                        }
                        className="h-4 w-4 rounded border-zinc-700 bg-zinc-900 text-blue-500 focus:ring-blue-500"
                      />
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2 font-medium text-zinc-200">
                          Aplica a todos
                          <InfoButton
                            info={REGLA_FIELD_INFO.aplica_a_todos}
                            onInfo={setFieldInfo}
                          />
                        </span>
                        <span className="mt-1 block text-xs text-zinc-500">
                          Desactivala solo si la regla sera de referencia o excepcion.
                        </span>
                      </span>
                    </label>
                  </div>
                </div>

                <div className="flex justify-end gap-3 border-t border-zinc-800 pt-4">
                  <button
                    type="button"
                    onClick={resetFormulario}
                    className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500"
                  >
                    Guardar
                  </button>
                </div>
              </form>
            )}

            <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-5">
              <div className="flex flex-col gap-4 border-b border-zinc-800 pb-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-white">
                    {vistaReglas === "CAPA"
                      ? "Reglas base de la capa"
                      : "Reglas efectivas de la entidad"}
                  </h3>
                  <p className="mt-1 text-sm text-zinc-500">
                    {vistaReglas === "CAPA"
                      ? "Estas reglas impactan a todas las entidades conectadas a la misma capa."
                      : "Aqui ves lo que realmente aplica hoy en esta entidad: heredado, local y personalizado."}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {vistaReglas === "ENTIDAD" ? (
                    <button
                      onClick={() => openNuevaRegla("LOCAL")}
                      className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500"
                    >
                      Nueva local
                    </button>
                  ) : (
                    <button
                      onClick={() => openNuevaRegla("CAPA")}
                      className="rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-300 transition-colors hover:bg-cyan-500/20"
                    >
                      Nueva base
                    </button>
                  )}
                </div>
              </div>

              {isLoading ? (
                <div className="py-10 text-center text-sm text-zinc-500">
                  Cargando reglas...
                </div>
              ) : visibleRules.length === 0 ? (
                <div className="py-10 text-center text-sm text-zinc-500">
                  {vistaReglas === "CAPA"
                    ? "Aun no hay reglas base en esta capa."
                    : "Aun no hay reglas registradas para esta entidad."}
                </div>
              ) : (
                <div className="mt-5 space-y-3">
                  {visibleRules.map((regla) => (
                    <div
                      key={`${vistaReglas}-${regla.id}`}
                      className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4"
                    >
                      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="text-base font-semibold text-white">
                              {regla.nombre}
                            </h4>
                            <span
                              className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${getOrigenStyles(
                                regla.origen
                              )}`}
                            >
                              {getOrigenLabel(regla.origen)}
                            </span>
                            {regla.capa_negocio_nombre && (
                              <span className="rounded-full border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-[11px] text-zinc-300">
                                {regla.capa_negocio_nombre}
                              </span>
                            )}
                          </div>

                          <div className="mt-3 grid grid-cols-1 gap-3 text-sm text-zinc-400 md:grid-cols-2">
                            <div>
                              <span className="text-zinc-500">Tipo:</span>{" "}
                              {LABELS_TIPO_CALCULO[regla.tipo_calculo] ||
                                regla.tipo_calculo}
                            </div>
                            <div>
                              <span className="text-zinc-500">Valor:</span>{" "}
                              {Number(regla.valor).toFixed(2)}
                            </div>
                            <div>
                              <span className="text-zinc-500">Periodicidad:</span>{" "}
                              {LABELS_PERIODICIDAD[regla.periodicidad] ||
                                regla.periodicidad}
                            </div>
                            <div>
                              <span className="text-zinc-500">Condicion:</span>{" "}
                              {regla.dias_condicion === null
                                ? "Sin condicion"
                                : `${regla.dias_condicion} dias`}
                            </div>
                          </div>

                          {vistaReglas === "ENTIDAD" && regla.origen === "GLOBAL" && (
                            <p className="mt-3 text-xs text-cyan-300/80">
                              Esta regla viene de la capa. Si la editas desde aqui,
                              crearas una personalizacion solo para esta entidad.
                            </p>
                          )}
                        </div>

                        <div className="flex flex-wrap gap-2 md:justify-end">
                          {vistaReglas === "CAPA" ? (
                            <>
                              <button
                                title="Editar base"
                                onClick={() => handleEditarRegla(regla)}
                                className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-300 transition-colors hover:bg-amber-500/20"
                              >
                                Editar base
                              </button>
                              <button
                                title="Clonar"
                                onClick={() => handleClonarRegla(regla)}
                                className="rounded-lg border border-blue-500/20 bg-blue-500/10 px-3 py-2 text-xs font-medium text-blue-300 transition-colors hover:bg-blue-500/20"
                              >
                                Clonar
                              </button>
                              <button
                                title="Eliminar"
                                onClick={() => iniciarBorrado(regla, "CAPA")}
                                className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-300 transition-colors hover:bg-red-500/20"
                              >
                                Eliminar
                              </button>
                            </>
                          ) : regla.origen === "GLOBAL" ? (
                            <>
                              <button
                                title="Personalizar"
                                onClick={() => handleEditarRegla(regla)}
                                className="rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-3 py-2 text-xs font-medium text-cyan-300 transition-colors hover:bg-cyan-500/20"
                              >
                                Personalizar
                              </button>
                              <button
                                title="Clonar"
                                onClick={() => handleClonarRegla(regla)}
                                className="rounded-lg border border-blue-500/20 bg-blue-500/10 px-3 py-2 text-xs font-medium text-blue-300 transition-colors hover:bg-blue-500/20"
                              >
                                Clonar
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                title="Editar"
                                onClick={() => handleEditarRegla(regla)}
                                className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-300 transition-colors hover:bg-amber-500/20"
                              >
                                Editar
                              </button>
                              <button
                                title="Clonar"
                                onClick={() => handleClonarRegla(regla)}
                                className="rounded-lg border border-blue-500/20 bg-blue-500/10 px-3 py-2 text-xs font-medium text-blue-300 transition-colors hover:bg-blue-500/20"
                              >
                                Clonar
                              </button>
                              <button
                                title="Eliminar"
                                onClick={() => iniciarBorrado(regla, "LOCAL")}
                                className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-300 transition-colors hover:bg-red-500/20"
                              >
                                Eliminar
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-5">
              <h3 className="text-lg font-semibold text-white">
                Simulador rapido
              </h3>
              <p className="mt-1 text-sm text-zinc-500">
                Usa las reglas efectivas de la entidad para estimar primer mes y
                meses recurrentes.
              </p>

              <div className="mt-5 space-y-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-400">
                    Monto base
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={montoBase}
                    onChange={(event) =>
                      setMontoBase(Number(event.target.value || 0))
                    }
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-900 p-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <label className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-zinc-300">
                  <input
                    type="checkbox"
                    checked={simularProntoPago}
                    onChange={(event) => setSimularProntoPago(event.target.checked)}
                    className="h-4 w-4 rounded border-zinc-700 bg-zinc-900 text-blue-500 focus:ring-blue-500"
                  />
                  Incluir descuentos por pronto pago
                </label>

                <label className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-zinc-300">
                  <input
                    type="checkbox"
                    checked={simularAtraso}
                    onChange={(event) => setSimularAtraso(event.target.checked)}
                    className="h-4 w-4 rounded border-zinc-700 bg-zinc-900 text-blue-500 focus:ring-blue-500"
                  />
                  Incluir recargos por atraso
                </label>
              </div>

              <div className="mt-5 rounded-lg border border-zinc-800 bg-zinc-900 p-4">
                <div className="mb-3 flex items-center justify-between border-b border-zinc-800 pb-2">
                  <span className="text-xs uppercase tracking-wide text-zinc-500">
                    Primer mes
                  </span>
                  <span className="text-lg font-bold text-white">
                    ${simulacion.granTotal.toFixed(2)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-zinc-500">Meses siguientes</span>
                  <span className="font-semibold text-zinc-200">
                    ${simulacion.totalRecurrente.toFixed(2)}
                  </span>
                </div>
              </div>

              <div className="mt-5 space-y-2 rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                <h4 className="text-sm font-semibold text-white">Desglose</h4>
                {simulacion.desglose.length === 0 ? (
                  <p className="text-sm text-zinc-500">
                    Todavia no hay reglas activas para simular.
                  </p>
                ) : (
                  simulacion.desglose.map((item, index) => (
                    <div
                      key={`${item.nombre}-${index}`}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <div className="min-w-0">
                        <span
                          className={`mr-2 inline-flex rounded-full border px-2 py-0.5 text-[10px] ${getOrigenStyles(
                            item.origen
                          )}`}
                        >
                          {getOrigenLabel(item.origen)}
                        </span>
                        <span className="truncate text-zinc-400">{item.nombre}</span>
                      </div>
                      <span
                        className={
                          item.impacto < 0 ? "text-green-400" : "text-blue-400"
                        }
                      >
                        {item.impacto < 0 ? "-" : "+"}$
                        {Math.abs(item.impacto).toFixed(2)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
      </div>
    </div>
  );
}
