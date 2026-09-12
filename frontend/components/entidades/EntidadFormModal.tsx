"use client";

import { buildApiUrl } from '@/lib/api';

import { type FormEvent, useEffect, useMemo, useState } from "react";

const EMPRESAS_API_BASE = buildApiUrl("/empresas");

interface CapaNegocio {
  id: number;
  nombre: string;
  tipo_capa: string;
  nombre_administrador: string | null;
  correo_contacto: string | null;
  telefono_contacto: string | null;
  plazo_meses_default: number;
  periodicidad_cobro_default: string;
  dia_vencimiento_default: number | null;
  dias_gracia_default: number;
  auto_renueva_default: boolean;
  aplicacion_pagos: string;
  entidades_count: number;
}

interface EntidadRecord {
  id?: number;
  nombre_comercial?: string;
  ciudad?: string | null;
  rfc?: string | null;
  regimen_fiscal?: string | null;
  logo_url?: string | null;
  tipo_fecha_corte?: string;
  activo?: boolean;
  capa_negocio_id?: number | null;
  capa_negocio_nombre?: string | null;
}

interface EntidadFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  entidadAEditar?: EntidadRecord | null;
}

interface EntidadFormState {
  nombre_comercial: string;
  ciudad: string;
  rfc: string;
  regimen_fiscal: string;
  logo_url: string;
  tipo_fecha_corte: string;
  activo: boolean;
  capa_negocio_id: string;
}

interface FieldInfo {
  title: string;
  body: string;
  details?: string[];
}

type EntidadFormErrors = Partial<Record<keyof EntidadFormState, string>>;

const EMPTY_FORM: EntidadFormState = {
  nombre_comercial: "",
  ciudad: "",
  rfc: "",
  regimen_fiscal: "",
  logo_url: "",
  tipo_fecha_corte: "INDIVIDUAL",
  activo: true,
  capa_negocio_id: "",
};

const FIELD_INFO = {
  nombre_comercial: {
    title: "Nombre comercial / entidad",
    body:
      "Nombre operativo visible para el equipo. Usalo para identificar la unidad de negocio, edificio, sucursal, propiedad o administracion.",
    details: [
      "Obligatorio.",
      "Debe tener entre 3 y 120 caracteres.",
      "Puede incluir letras, numeros y signos comunes como guion, punto, coma, diagonal y &.",
    ],
  },
  ciudad: {
    title: "Ciudad / plaza",
    body:
      "Ubicacion comercial o plaza donde opera la entidad. Ayuda a filtrar, reportar y distinguir unidades con nombres similares.",
    details: [
      "Opcional.",
      "Maximo 80 caracteres.",
      "Acepta letras, numeros, espacios, punto, coma y guion.",
    ],
  },
  logo_url: {
    title: "Logo / imagen",
    body:
      "URL publica del logo o imagen de la entidad. Se usa como referencia visual en vistas operativas cuando esta disponible.",
    details: ["Opcional.", "Debe iniciar con http:// o https://.", "Maximo 300 caracteres."],
  },
  datos_fiscales: {
    title: "Datos fiscales",
    body:
      "Activa esta seccion solo si esta entidad emitira facturas o necesita guardar datos fiscales propios distintos a la capa.",
  },
  rfc: {
    title: "RFC",
    body:
      "RFC fiscal de la entidad. BetterP lo guarda en mayusculas y solo permite letras y numeros.",
    details: ["Obligatorio si activas datos fiscales.", "Debe tener 12 o 13 caracteres."],
  },
  regimen_fiscal: {
    title: "Regimen fiscal",
    body:
      "Regimen fiscal de la entidad cuando factura por cuenta propia. Usa el codigo SAT o el nombre del regimen que aparezca en la CSF.",
    details: ["Obligatorio si activas datos fiscales.", "Entre 3 y 100 caracteres."],
  },
  tipo_fecha_corte: {
    title: "Tipo de corte operativo",
    body:
      "Define como se calcularan cortes y vencimientos cuando la entidad genere cargos por ocupacion o cuotas.",
    details: [
      "Individual usa el aniversario o condiciones de cada cliente/asignacion.",
      "General agrupa cobros en una fecha comun para operacion masiva.",
    ],
  },
  activo: {
    title: "Entidad activa",
    body:
      "Si esta activa, la entidad aparece en la operacion diaria. Si la desactivas, queda como referencia historica.",
  },
  capa_negocio_id: {
    title: "Capa asociada",
    body:
      "Capa de negocio que aporta configuracion global, reglas heredables y defaults operativos para esta entidad.",
    details: [
      "Opcional si la entidad se manejara de forma independiente.",
      "Si eliges una capa, la entidad hereda su base operativa.",
    ],
  },
} satisfies Record<string, FieldInfo>;

function sanitizeLimitedText(value: string, maxLength: number) {
  return value.replace(/[\u0000-\u001F\u007F]/g, "").slice(0, maxLength);
}

function sanitizeEntityName(value: string) {
  return sanitizeLimitedText(value, 120).replace(/[^\p{L}\p{N}\s.,&()/_-]/gu, "");
}

function sanitizeCity(value: string) {
  return sanitizeLimitedText(value, 80).replace(/[^\p{L}\p{N}\s.,-]/gu, "");
}

function sanitizeRfc(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 13);
}

function sanitizeRegimenFiscal(value: string) {
  return sanitizeLimitedText(value, 100).replace(/[^\p{L}\p{N}\s.,()/_-]/gu, "");
}

function fieldLengthMessage(
  value: string,
  label: string,
  min: number,
  max: number,
  required = true
) {
  const trimmed = value.trim();
  if (!trimmed) {
    return required ? `${label} es obligatorio.` : "";
  }
  if (trimmed.length < min) {
    return `${label} debe tener al menos ${min} caracteres.`;
  }
  if (trimmed.length > max) {
    return `${label} no debe superar ${max} caracteres.`;
  }
  return "";
}

function isValidHttpUrl(value: string) {
  if (!value.trim()) return true;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function validateEntidadForm(
  form: EntidadFormState,
  conDatosFiscales: boolean
): EntidadFormErrors {
  const errors: EntidadFormErrors = {};
  errors.nombre_comercial = fieldLengthMessage(
    form.nombre_comercial,
    "Nombre comercial / entidad",
    3,
    120
  );
  errors.ciudad = fieldLengthMessage(form.ciudad, "Ciudad / plaza", 2, 80, false);
  if (form.logo_url.trim().length > 300) {
    errors.logo_url = "Logo / imagen no debe superar 300 caracteres.";
  } else if (!isValidHttpUrl(form.logo_url)) {
    errors.logo_url = "Logo / imagen debe ser una URL valida con http:// o https://.";
  }
  if (conDatosFiscales) {
    if (!form.rfc.trim()) {
      errors.rfc = "RFC es obligatorio si activas datos fiscales.";
    } else if (!/^[A-Z0-9]{12,13}$/.test(form.rfc.trim())) {
      errors.rfc = "RFC debe tener 12 o 13 caracteres alfanumericos.";
    }
    errors.regimen_fiscal = fieldLengthMessage(
      form.regimen_fiscal,
      "Regimen fiscal",
      3,
      100
    );
  }
  if (!["INDIVIDUAL", "GENERAL"].includes(form.tipo_fecha_corte)) {
    errors.tipo_fecha_corte = "Selecciona un tipo de corte valido.";
  }
  Object.keys(errors).forEach((key) => {
    if (!errors[key as keyof EntidadFormState]) {
      delete errors[key as keyof EntidadFormState];
    }
  });
  return errors;
}

function hasValidationErrors(errors: EntidadFormErrors) {
  return Object.values(errors).some(Boolean);
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

function InfoButton({
  info,
  onInfo,
}: {
  info: FieldInfo;
  onInfo: (info: FieldInfo) => void;
}) {
  return (
    <button
      type="button"
      title={info.title}
      aria-label={`Informacion: ${info.title}`}
      onClick={() => onInfo(info)}
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-cyan-500/25 bg-cyan-500/10 text-[11px] font-semibold text-cyan-100 transition hover:border-cyan-400/60 hover:bg-cyan-500/20"
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
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/75 px-4 py-6 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="entity-field-info-title"
        className="w-full max-w-lg rounded-2xl border border-cyan-500/20 bg-zinc-950 p-5 shadow-2xl shadow-black/60"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-200">
              Detalle del campo
            </p>
            <h3
              id="entity-field-info-title"
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
                className="rounded-xl border border-white/8 bg-zinc-900/70 px-4 py-3"
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

function FieldLabel({
  label,
  required = false,
  info,
  onInfo,
}: {
  label: string;
  required?: boolean;
  info: FieldInfo;
  onInfo: (info: FieldInfo) => void;
}) {
  return (
    <span className="mb-1 flex min-h-8 items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-zinc-500">
      <span>{label}</span>
      <span className={required ? "text-cyan-200" : "text-zinc-600"}>
        {required ? "Obligatorio" : "Opcional"}
      </span>
      <InfoButton info={info} onInfo={onInfo} />
    </span>
  );
}

function FieldFeedback({
  error,
  helper,
}: {
  error?: string;
  helper?: string;
}) {
  if (!error && !helper) return null;

  return (
    <p className={`mt-2 text-xs leading-5 ${error ? "text-rose-200" : "text-zinc-500"}`}>
      {error || helper}
    </p>
  );
}

function mapEntidadToForm(entidad: EntidadRecord): {
  form: EntidadFormState;
  conDatosFiscales: boolean;
} {
  const conDatosFiscales = Boolean(entidad.rfc || entidad.regimen_fiscal);

  return {
    conDatosFiscales,
    form: {
      nombre_comercial: entidad.nombre_comercial || "",
      ciudad: entidad.ciudad || "",
      rfc: entidad.rfc || "",
      regimen_fiscal: entidad.regimen_fiscal || "",
      logo_url: entidad.logo_url || "",
      tipo_fecha_corte: entidad.tipo_fecha_corte || "INDIVIDUAL",
      activo: entidad.activo !== undefined ? entidad.activo : true,
      capa_negocio_id:
        entidad.capa_negocio_id !== null && entidad.capa_negocio_id !== undefined
          ? String(entidad.capa_negocio_id)
          : "",
    },
  };
}

export default function EntidadFormModal({
  isOpen,
  onClose,
  onSuccess,
  entidadAEditar,
}: EntidadFormModalProps) {
  const [formData, setFormData] = useState<EntidadFormState>(EMPTY_FORM);
  const [capas, setCapas] = useState<CapaNegocio[]>([]);
  const [conDatosFiscales, setConDatosFiscales] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isHydrating, setIsHydrating] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [formError, setFormError] = useState("");
  const [fieldInfo, setFieldInfo] = useState<FieldInfo | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    let cancelled = false;

    const hydrate = async () => {
      setIsHydrating(true);

      try {
        const capasRes = await fetch(`${EMPRESAS_API_BASE}/capas/`, {
          cache: "no-store",
        });
        if (!capasRes.ok) {
          throw new Error("No se pudieron cargar las capas de negocio.");
        }

        const capasBody = (await capasRes.json()) as CapaNegocio[];
        if (!cancelled) {
          setCapas(capasBody);
        }

        if (!entidadAEditar?.id) {
          if (!cancelled) {
            setConDatosFiscales(false);
            setFormData(EMPTY_FORM);
            setSubmitAttempted(false);
            setFormError("");
          }
          return;
        }

        const entidadRes = await fetch(`${EMPRESAS_API_BASE}/${entidadAEditar.id}/`, {
          cache: "no-store",
        });
        if (!entidadRes.ok) {
          throw new Error("No se pudo cargar el detalle de la entidad.");
        }

        const entidadBody = (await entidadRes.json()) as EntidadRecord;
        if (cancelled) {
          return;
        }

        const mapped = mapEntidadToForm(entidadBody);
        setConDatosFiscales(mapped.conDatosFiscales);
        setFormData(mapped.form);
        setSubmitAttempted(false);
        setFormError("");
      } catch (error) {
        console.error("Error hidratando entidad:", error);
        if (!cancelled && entidadAEditar) {
          const mapped = mapEntidadToForm(entidadAEditar);
          setConDatosFiscales(mapped.conDatosFiscales);
          setFormData(mapped.form);
          setSubmitAttempted(false);
          setFormError("");
        }
      } finally {
        if (!cancelled) {
          setIsHydrating(false);
        }
      }
    };

    void hydrate();

    return () => {
      cancelled = true;
    };
  }, [entidadAEditar, isOpen]);

  const capaSeleccionada = useMemo(
    () => capas.find((capa) => String(capa.id) === formData.capa_negocio_id) || null,
    [capas, formData.capa_negocio_id]
  );

  const validationErrors = useMemo(
    () => validateEntidadForm(formData, conDatosFiscales),
    [conDatosFiscales, formData]
  );
  const fieldError = (field: keyof EntidadFormState) =>
    submitAttempted ? validationErrors[field] : undefined;

  const updateField = <K extends keyof EntidadFormState>(
    field: K,
    value: EntidadFormState[K]
  ) => {
    setFormData((current) => ({ ...current, [field]: value }));
    setFormError("");
  };

  if (!isOpen) {
    return null;
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitAttempted(true);
    setFormError("");
    if (hasValidationErrors(validationErrors)) {
      setFormError(
        Object.values(validationErrors).find(Boolean) ||
          "Revisa los campos de la entidad antes de continuar."
      );
      return;
    }

    setIsLoading(true);

    const payload = {
      nombre_comercial: formData.nombre_comercial.trim(),
      ciudad: formData.ciudad.trim(),
      rfc: conDatosFiscales ? formData.rfc.trim().toUpperCase() : "",
      regimen_fiscal: conDatosFiscales ? formData.regimen_fiscal.trim() : "",
      logo_url: formData.logo_url.trim(),
      tipo_fecha_corte: formData.tipo_fecha_corte,
      activo: formData.activo,
      capa_negocio_id: formData.capa_negocio_id
        ? Number(formData.capa_negocio_id)
        : null,
      capa_negocio_nombre: "",
      desvincular_capa_negocio: !formData.capa_negocio_id,
    };

    const url = entidadAEditar?.id
      ? `${EMPRESAS_API_BASE}/${entidadAEditar.id}/`
      : `${EMPRESAS_API_BASE}/crear/`;
    const method = entidadAEditar?.id ? "PUT" : "POST";

    try {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        onSuccess();
        return;
      }

      const errorBody = (await response.json()) as unknown;
      setFormError(getErrorMessage(errorBody, "No se pudo guardar la entidad."));
    } catch (error) {
      console.error("Error guardando entidad:", error);
      setFormError("Error de red al comunicarse con el servidor.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <FieldInfoModal info={fieldInfo} onClose={() => setFieldInfo(null)} />
      <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl">
        <div className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/95 px-6 py-5 backdrop-blur">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-2xl font-bold text-white">
                {entidadAEditar ? "Editar entidad de negocio" : "Nueva entidad de negocio"}
              </h3>
              <p className="mt-1 text-sm text-zinc-500">
                Vincula la entidad a una capa ya configurada y usa sus defaults como base operativa.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white"
            >
              Cerrar
            </button>
          </div>
        </div>

        {isHydrating ? (
          <div className="px-6 py-10 text-center text-sm text-zinc-500">
            Cargando configuracion actual...
          </div>
        ) : (
          <form noValidate onSubmit={handleSubmit} className="space-y-8 px-6 py-6">
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
              <section className="space-y-5 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
                <div className="border-b border-zinc-800/70 pb-3">
                  <h4 className="text-base font-semibold text-white">Entidad</h4>
                  <p className="mt-1 text-sm text-zinc-500">
                    Datos operativos propios de la propiedad o unidad de negocio.
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="md:col-span-2">
                    <FieldLabel
                      label="Nombre comercial / entidad"
                      required
                      info={FIELD_INFO.nombre_comercial}
                      onInfo={setFieldInfo}
                    />
                    <input
                      required
                      type="text"
                      placeholder="Ej. Coliving Casa Maya"
                      value={formData.nombre_comercial}
                      minLength={3}
                      maxLength={120}
                      aria-invalid={Boolean(fieldError("nombre_comercial"))}
                      onChange={(event) =>
                        updateField(
                          "nombre_comercial",
                          sanitizeEntityName(event.target.value)
                        )
                      }
                      className={`w-full rounded-lg border bg-zinc-950 p-2.5 text-sm text-white outline-none focus:ring-1 ${
                        fieldError("nombre_comercial")
                          ? "border-rose-500/70 focus:ring-rose-500"
                          : "border-zinc-800 focus:ring-blue-500"
                      }`}
                    />
                    <FieldFeedback
                      error={fieldError("nombre_comercial")}
                      helper={`${formData.nombre_comercial.length}/120 caracteres.`}
                    />
                  </div>

                  <div>
                    <FieldLabel
                      label="Ciudad / plaza"
                      info={FIELD_INFO.ciudad}
                      onInfo={setFieldInfo}
                    />
                    <input
                      type="text"
                      placeholder="Ej. CDMX, Tulum, Merida"
                      value={formData.ciudad}
                      maxLength={80}
                      aria-invalid={Boolean(fieldError("ciudad"))}
                      onChange={(event) =>
                        updateField("ciudad", sanitizeCity(event.target.value))
                      }
                      className={`w-full rounded-lg border bg-zinc-950 p-2.5 text-sm text-white outline-none focus:ring-1 ${
                        fieldError("ciudad")
                          ? "border-rose-500/70 focus:ring-rose-500"
                          : "border-zinc-800 focus:ring-blue-500"
                      }`}
                    />
                    <FieldFeedback
                      error={fieldError("ciudad")}
                      helper={`${formData.ciudad.length}/80 caracteres.`}
                    />
                  </div>

                  <div>
                    <FieldLabel
                      label="Logo / imagen"
                      info={FIELD_INFO.logo_url}
                      onInfo={setFieldInfo}
                    />
                    <input
                      type="url"
                      placeholder="https://..."
                      value={formData.logo_url}
                      maxLength={300}
                      aria-invalid={Boolean(fieldError("logo_url"))}
                      onChange={(event) =>
                        updateField("logo_url", sanitizeLimitedText(event.target.value, 300))
                      }
                      className={`w-full rounded-lg border bg-zinc-950 p-2.5 text-sm text-white outline-none focus:ring-1 ${
                        fieldError("logo_url")
                          ? "border-rose-500/70 focus:ring-rose-500"
                          : "border-zinc-800 focus:ring-blue-500"
                      }`}
                    />
                    <FieldFeedback
                      error={fieldError("logo_url")}
                      helper="Opcional. Debe ser una URL publica si lo capturas."
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between rounded-xl border border-zinc-800/70 bg-zinc-950/70 p-3.5">
                  <div>
                    <p className="flex items-center gap-2 text-sm font-medium text-zinc-200">
                      Datos fiscales
                      <InfoButton
                        info={FIELD_INFO.datos_fiscales}
                        onInfo={setFieldInfo}
                      />
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      Opcional. Activalo solo si esta entidad tambien factura.
                    </p>
                  </div>
                  <label className="relative inline-flex cursor-pointer items-center">
                    <input
                      type="checkbox"
                      className="peer sr-only"
                      checked={conDatosFiscales}
                      onChange={() => {
                        setConDatosFiscales((current) => !current);
                        setFormError("");
                      }}
                    />
                    <div className="h-6 w-11 rounded-full bg-zinc-800 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-zinc-300 after:transition-all after:content-[''] peer-checked:bg-blue-600 peer-checked:after:translate-x-full peer-checked:after:border-white" />
                  </label>
                </div>

                {conDatosFiscales && (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <FieldLabel
                        label="RFC"
                        required
                        info={FIELD_INFO.rfc}
                        onInfo={setFieldInfo}
                      />
                      <input
                        required={conDatosFiscales}
                        type="text"
                        placeholder="Ej. XAXX010101000"
                        value={formData.rfc}
                        maxLength={13}
                        inputMode="text"
                        aria-invalid={Boolean(fieldError("rfc"))}
                        onChange={(event) =>
                          updateField("rfc", sanitizeRfc(event.target.value))
                        }
                        className={`w-full rounded-lg border bg-zinc-950 p-2.5 text-sm uppercase text-white outline-none focus:ring-1 ${
                          fieldError("rfc")
                            ? "border-rose-500/70 focus:ring-rose-500"
                            : "border-zinc-800 focus:ring-blue-500"
                        }`}
                      />
                      <FieldFeedback
                        error={fieldError("rfc")}
                        helper={`${formData.rfc.length}/13 caracteres. Solo letras y numeros.`}
                      />
                    </div>

                    <div>
                      <FieldLabel
                        label="Regimen fiscal"
                        required
                        info={FIELD_INFO.regimen_fiscal}
                        onInfo={setFieldInfo}
                      />
                      <input
                        required={conDatosFiscales}
                        type="text"
                        placeholder="Ej. 626 o Arrendamiento"
                        value={formData.regimen_fiscal}
                        maxLength={100}
                        aria-invalid={Boolean(fieldError("regimen_fiscal"))}
                        onChange={(event) =>
                          updateField(
                            "regimen_fiscal",
                            sanitizeRegimenFiscal(event.target.value)
                          )
                        }
                        className={`w-full rounded-lg border bg-zinc-950 p-2.5 text-sm text-white outline-none focus:ring-1 ${
                          fieldError("regimen_fiscal")
                            ? "border-rose-500/70 focus:ring-rose-500"
                            : "border-zinc-800 focus:ring-blue-500"
                        }`}
                      />
                      <FieldFeedback
                        error={fieldError("regimen_fiscal")}
                        helper={`${formData.regimen_fiscal.length}/100 caracteres.`}
                      />
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <FieldLabel
                      label="Tipo de corte operativo"
                      required
                      info={FIELD_INFO.tipo_fecha_corte}
                      onInfo={setFieldInfo}
                    />
                    <select
                      value={formData.tipo_fecha_corte}
                      onChange={(event) =>
                        updateField("tipo_fecha_corte", event.target.value)
                      }
                      aria-invalid={Boolean(fieldError("tipo_fecha_corte"))}
                      className={`w-full cursor-pointer rounded-lg border bg-zinc-950 p-2.5 text-sm text-zinc-200 outline-none focus:ring-1 ${
                        fieldError("tipo_fecha_corte")
                          ? "border-rose-500/70 focus:ring-rose-500"
                          : "border-zinc-800 focus:ring-blue-500"
                      }`}
                    >
                      <option value="INDIVIDUAL">
                        Individual (al aniversario del inquilino)
                      </option>
                      <option value="GENERAL">
                        General (cobro masivo el mismo dia)
                      </option>
                    </select>
                    <FieldFeedback
                      error={fieldError("tipo_fecha_corte")}
                      helper="Obligatorio. Define como se programan cortes y vencimientos."
                    />
                  </div>

                  <div className="flex items-end">
                    <label className="flex w-full items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-300">
                      <span>
                        <span className="flex items-center gap-2 font-medium text-zinc-100">
                          Entidad activa
                          <InfoButton
                            info={FIELD_INFO.activo}
                            onInfo={setFieldInfo}
                          />
                        </span>
                        <span className="mt-1 block text-xs text-zinc-500">
                          Opcional. Controla si aparece en operacion diaria.
                        </span>
                      </span>
                      <input
                        type="checkbox"
                        checked={formData.activo}
                        onChange={(event) =>
                          updateField("activo", event.target.checked)
                        }
                        className="h-4 w-4 rounded border-zinc-700 bg-zinc-900 text-blue-500 focus:ring-blue-500"
                      />
                    </label>
                  </div>
                </div>
              </section>

              <section className="space-y-5 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
                <div className="border-b border-zinc-800/70 pb-3">
                  <h4 className="text-base font-semibold text-white">
                    Capa de negocio
                  </h4>
                  <p className="mt-1 text-sm text-zinc-500">
                    La configuracion global se administra desde Configuracion. Aqui solo eliges la base que quieres usar.
                  </p>
                </div>

                <div>
                  <FieldLabel
                    label="Capa asociada"
                    info={FIELD_INFO.capa_negocio_id}
                    onInfo={setFieldInfo}
                  />
                  <select
                    value={formData.capa_negocio_id}
                    onChange={(event) =>
                      updateField("capa_negocio_id", event.target.value)
                    }
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-zinc-200 outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="">Sin capa / entidad independiente</option>
                    {capas.map((capa) => (
                      <option key={capa.id} value={capa.id}>
                        {capa.nombre} - {capa.tipo_capa}
                      </option>
                    ))}
                  </select>
                  <FieldFeedback helper="Opcional. Selecciona una capa si quieres heredar defaults operativos." />
                </div>

                {capaSeleccionada ? (
                  <div className="space-y-4 rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-4">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h5 className="text-lg font-semibold text-white">
                          {capaSeleccionada.nombre}
                        </h5>
                        <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-1 text-xs font-medium text-cyan-300">
                          {capaSeleccionada.tipo_capa}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-cyan-100/80">
                        {capaSeleccionada.entidades_count} entidades vinculadas
                      </p>
                    </div>

                    <div className="grid grid-cols-1 gap-3 text-sm text-cyan-100/90 md:grid-cols-2">
                      <div>
                        <span className="text-cyan-200/60">Administrador:</span>{" "}
                        {capaSeleccionada.nombre_administrador || "Sin definir"}
                      </div>
                      <div>
                        <span className="text-cyan-200/60">Contacto:</span>{" "}
                        {capaSeleccionada.correo_contacto ||
                          capaSeleccionada.telefono_contacto ||
                          "Sin definir"}
                      </div>
                      <div>
                        <span className="text-cyan-200/60">Periodicidad:</span>{" "}
                        {capaSeleccionada.periodicidad_cobro_default}
                      </div>
                      <div>
                        <span className="text-cyan-200/60">Plazo:</span>{" "}
                        {capaSeleccionada.plazo_meses_default} meses
                      </div>
                      <div>
                        <span className="text-cyan-200/60">Vencimiento:</span>{" "}
                        {capaSeleccionada.dia_vencimiento_default
                          ? `Dia ${capaSeleccionada.dia_vencimiento_default}`
                          : "Sin definir"}
                      </div>
                      <div>
                        <span className="text-cyan-200/60">Gracia:</span>{" "}
                        {capaSeleccionada.dias_gracia_default} dias
                      </div>
                      <div>
                        <span className="text-cyan-200/60">Auto-renueva:</span>{" "}
                        {capaSeleccionada.auto_renueva_default ? "Si" : "No"}
                      </div>
                      <div>
                        <span className="text-cyan-200/60">Aplicacion pagos:</span>{" "}
                        {capaSeleccionada.aplicacion_pagos}
                      </div>
                    </div>

                    <div className="rounded-xl border border-cyan-500/20 bg-zinc-950/50 px-4 py-3 text-sm text-zinc-300">
                      Si necesitas cambiar estos defaults o sus reglas base, hazlo desde el menu de usuario en{" "}
                      <span className="font-semibold text-white">Configuracion</span>.
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-950/40 px-4 py-8 text-center text-sm text-zinc-500">
                    Esta entidad operara sin una capa compartida. Podras configurarla de forma independiente.
                  </div>
                )}
              </section>
            </div>

            {formError ? (
              <div className="rounded-xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm leading-6 text-rose-100">
                {formError}
              </div>
            ) : null}

            <div className="flex justify-end gap-3 border-t border-zinc-800/70 pt-5">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isLoading}
                className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
              >
                {isLoading
                  ? "Guardando..."
                  : entidadAEditar
                    ? "Guardar cambios"
                    : "Registrar entidad"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
