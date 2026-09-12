"use client";

import { useEffect, useMemo, useState } from "react";

import { buildApiUrl } from "@/lib/api";

import {
  ConfigFieldLabel,
  ConfigInfoButton,
  ConfigInfoModal,
  type ConfigInfoContent,
} from "./ConfigInfo";

const EMPRESAS_API_BASE = buildApiUrl("/empresas");

interface ReglaMarco {
  id: number;
  nombre: string;
  tipo_calculo: string;
  valor: number;
  periodicidad: string;
  aplica_a_todos: boolean;
  dias_condicion: number | null;
  activo: boolean;
}

interface SuggestedRule {
  nombre: string;
  descripcion: string;
  tipo_calculo: string;
  valor: number;
  periodicidad: string;
  aplica_a_todos: boolean;
  dias_condicion: number | null;
}

interface ReglaFormState {
  id: number | null;
  nombre: string;
  tipo_calculo: string;
  valor: string;
  periodicidad: string;
  aplica_a_todos: boolean;
  dias_condicion: string;
  activo: boolean;
}

interface RuleSaveResult {
  ok: boolean;
  error?: string;
}

const EMPTY_RULE_FORM: ReglaFormState = {
  id: null,
  nombre: "",
  tipo_calculo: "CARGO_FIJO",
  valor: "",
  periodicidad: "MENSUAL",
  aplica_a_todos: false,
  dias_condicion: "",
  activo: true,
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

const RULE_CATALOGS = {
  tipos_calculo: Object.entries(LABELS_TIPO_CALCULO).map(([value, label]) => ({
    value,
    label,
  })),
  periodicidades: Object.entries(LABELS_PERIODICIDAD).map(([value, label]) => ({
    value,
    label,
  })),
};

const SUGGESTED_RULES: SuggestedRule[] = [
  {
    nombre: "Interes moratorio mensual",
    tipo_calculo: "PORCENTAJE_RECARGO",
    valor: 5,
    periodicidad: "MENSUAL",
    aplica_a_todos: true,
    dias_condicion: 3,
    descripcion:
      "Recargo porcentual para adeudos que ya pasaron la ventana de gracia.",
  },
  {
    nombre: "Penalizacion administrativa por atraso",
    tipo_calculo: "CARGO_FIJO",
    valor: 0,
    periodicidad: "UNICO",
    aplica_a_todos: false,
    dias_condicion: 10,
    descripcion:
      "Plantilla editable para cargos o bloqueo operativo despues de atraso severo.",
  },
  {
    nombre: "Cobro extraordinario o amenity",
    tipo_calculo: "CARGO_FIJO",
    valor: 0,
    periodicidad: "UNICO",
    aplica_a_todos: false,
    dias_condicion: null,
    descripcion:
      "Base para lavanderia, estacionamiento, limpieza, amenidades u otros extras.",
  },
  {
    nombre: "Deposito de garantia",
    tipo_calculo: "CARGO_FIJO",
    valor: 0,
    periodicidad: "UNICO",
    aplica_a_todos: false,
    dias_condicion: null,
    descripcion:
      "Referencia para estandarizar depositos al migrar o dar de alta operaciones.",
  },
];

const ruleInfo = {
  modulo: {
    eyebrow: "Politicas globales",
    title: "Reglas de capa de negocio",
    summary:
      "Las reglas heredables son la base que reciben las unidades de negocio y ocupaciones nuevas.",
    details: [
      "Usalas para cargos, recargos, descuentos, depositos o condiciones repetibles.",
      "La capa mantiene la regla base; cada entidad puede personalizarla despues si su operacion cambia.",
      "Conviene mantener aqui solo reglas vigentes y entendibles para el equipo operativo.",
    ],
  },
  plantillas: {
    eyebrow: "Reglas predefinidas",
    title: "Plantillas listas para activar",
    summary:
      "Son reglas sugeridas para arrancar una operacion sin capturar todo desde cero.",
    details: [
      "Selecciona solo las que realmente vas a usar.",
      "Al crear varias, el modal te lleva una por una para validar monto, porcentaje y condicion.",
      "Las plantillas con valor cero deben completarse antes de poder guardarse.",
    ],
  },
  manual: {
    eyebrow: "Regla personalizada",
    title: "Crear regla manual",
    summary:
      "Permite crear una regla heredable que no venga dentro de las plantillas predefinidas.",
    details: [
      "Usala para politicas propias de la administracion, cargos internos o reglas comerciales particulares.",
      "El nombre debe ser operativo y el valor debe ser mayor a cero.",
    ],
  },
  listado: {
    eyebrow: "Reglas activas",
    title: "Listado editable",
    summary:
      "Aqui puedes revisar, editar o borrar las reglas base ya creadas para la capa.",
    details: [
      "Editar cambia la regla base de la capa.",
      "Borrar elimina la regla heredable; revisa antes si ya la usan entidades u operaciones.",
    ],
  },
  nombre: {
    eyebrow: "Campo obligatorio",
    title: "Nombre de la regla",
    summary:
      "Nombre visible para identificar la politica dentro de configuracion, entidades y cobranza.",
    details: ["Debe tener de 3 a 80 caracteres."],
  },
  tipo: {
    eyebrow: "Calculo",
    title: "Tipo de calculo",
    summary:
      "Define si la regla suma o descuenta dinero, o si aplica un porcentaje sobre el saldo/cargo.",
    details: [
      "Cargo fijo y descuento fijo usan monto en pesos.",
      "Recargo y descuento porcentual usan porcentaje.",
    ],
  },
  valor: {
    eyebrow: "Monto o porcentaje",
    title: "Valor de la regla",
    summary:
      "Es el importe o porcentaje que aplicara la regla segun su tipo de calculo.",
    details: [
      "Debe ser mayor a cero.",
      "Acepta hasta 2 decimales.",
      "Los porcentajes se limitan a 9999 y los importes a 10000000.",
    ],
  },
  dias: {
    eyebrow: "Condicion",
    title: "Dias condicion",
    summary:
      "Numero de dias que deben pasar para aplicar la regla. Es opcional.",
    details: ["Solo acepta enteros de 0 a 365."],
  },
  estado: {
    eyebrow: "Alcance",
    title: "Aplica a todos y regla activa",
    summary:
      "Controla si la regla entra como politica global y si queda vigente para nuevas operaciones.",
    details: [
      "Aplica a todos se usa cuando la regla debe heredarse de forma general.",
      "Regla activa conserva o pausa la regla sin borrarla.",
    ],
  },
};

function getErrorMessage(body: unknown, fallback: string) {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail?: unknown }).detail;
    if (typeof detail === "string" && detail.trim()) {
      return detail;
    }
  }

  return fallback;
}

function sanitizeText(value: string, maxLength = 80) {
  return value.replace(/[<>]/g, "").slice(0, maxLength);
}

function sanitizeIntegerInput(value: string, maxLength = 3) {
  return value.replace(/\D/g, "").slice(0, maxLength);
}

function sanitizeMoneyInput(value: string) {
  const normalized = value.replace(",", ".").replace(/[^\d.]/g, "");
  const [integerPart, ...decimalParts] = normalized.split(".");
  const decimals = decimalParts.join("").slice(0, 2);
  return decimalParts.length > 0 ? `${integerPart}.${decimals}` : integerPart;
}

function parseOptionalInteger(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function parseMoneyInput(value: string | number | null | undefined) {
  const parsed = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function isPercentageRuleType(type: string) {
  return type.includes("PORCENTAJE");
}

function ruleValueFieldLabel(type: string) {
  return isPercentageRuleType(type) ? "Porcentaje" : "Monto";
}

function formatRuleValue(rule: Pick<ReglaMarco | SuggestedRule, "tipo_calculo" | "valor">) {
  const value = Number(rule.valor || 0).toLocaleString("es-MX", {
    maximumFractionDigits: 2,
  });
  return isPercentageRuleType(rule.tipo_calculo) ? `${value}%` : `$${value}`;
}

function ruleConditionLabel(rule: Pick<ReglaMarco, "aplica_a_todos" | "dias_condicion">) {
  const scope = rule.aplica_a_todos ? "Aplica a todos" : "Aplicacion manual";
  if (rule.dias_condicion === null || rule.dias_condicion === undefined) {
    return scope;
  }
  return `${scope} - desde dia ${rule.dias_condicion}`;
}

function businessRuleValueHelper(type: string) {
  return isPercentageRuleType(type)
    ? "Solo numeros. Hasta 2 decimales y porcentaje mayor a 0."
    : "Solo numeros. Hasta 2 decimales y monto mayor a 0.";
}

function validateRuleForm(form: ReglaFormState) {
  const errors: Partial<Record<keyof ReglaFormState, string>> = {};
  const nameLength = form.nombre.trim().length;
  if (nameLength < 3) {
    errors.nombre = "Nombre debe tener al menos 3 caracteres.";
  } else if (nameLength > 80) {
    errors.nombre = "Nombre no debe superar 80 caracteres.";
  }

  const value = form.valor.trim();
  const maxValue = isPercentageRuleType(form.tipo_calculo) ? 9999 : 10000000;
  const label = ruleValueFieldLabel(form.tipo_calculo);
  if (!value) {
    errors.valor = `${label} es obligatorio.`;
  } else if (!/^\d+(\.\d{1,2})?$/.test(value)) {
    errors.valor = `${label} solo acepta numeros y hasta 2 decimales.`;
  } else {
    const parsed = parseMoneyInput(value);
    if (parsed <= 0) {
      errors.valor = `${label} debe ser mayor a 0.`;
    } else if (parsed > maxValue) {
      errors.valor = `${label} no debe superar ${maxValue}.`;
    }
  }

  if (form.dias_condicion.trim()) {
    if (!/^\d+$/.test(form.dias_condicion.trim())) {
      errors.dias_condicion = "Dias condicion solo acepta enteros.";
    } else {
      const days = Number(form.dias_condicion);
      if (days < 0 || days > 365) {
        errors.dias_condicion = "Dias condicion debe estar entre 0 y 365.";
      }
    }
  }

  return errors;
}

function hasValidationErrors(errors: Partial<Record<string, string>>) {
  return Object.values(errors).some(Boolean);
}

function mapRuleToForm(rule: ReglaMarco): ReglaFormState {
  return {
    id: rule.id,
    nombre: sanitizeText(rule.nombre),
    tipo_calculo: rule.tipo_calculo || "CARGO_FIJO",
    valor: String(rule.valor ?? 0),
    periodicidad: rule.periodicidad || "UNICO",
    aplica_a_todos: Boolean(rule.aplica_a_todos),
    dias_condicion:
      rule.dias_condicion !== null && rule.dias_condicion !== undefined
        ? String(rule.dias_condicion)
        : "",
    activo: Boolean(rule.activo),
  };
}

function mapSuggestedRuleToForm(rule: SuggestedRule): ReglaFormState {
  return {
    id: null,
    nombre: sanitizeText(rule.nombre),
    tipo_calculo: rule.tipo_calculo || "CARGO_FIJO",
    valor: rule.valor > 0 ? String(rule.valor) : "",
    periodicidad: rule.periodicidad || "UNICO",
    aplica_a_todos: Boolean(rule.aplica_a_todos),
    dias_condicion:
      rule.dias_condicion !== null && rule.dias_condicion !== undefined
        ? String(rule.dias_condicion)
        : "",
    activo: true,
  };
}

function buildRulePayload(form: ReglaFormState) {
  return {
    nombre: sanitizeText(form.nombre).trim(),
    tipo_calculo: form.tipo_calculo || "CARGO_FIJO",
    valor: parseMoneyInput(form.valor),
    periodicidad: form.periodicidad || "UNICO",
    aplica_a_todos: form.aplica_a_todos,
    dias_condicion: parseOptionalInteger(form.dias_condicion),
    activo: form.activo,
  };
}

export default function ReglasMarcoManager({
  capaId,
  capaNombre,
}: {
  capaId: number;
  capaNombre: string;
}) {
  const [reglas, setReglas] = useState<ReglaMarco[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [mensaje, setMensaje] = useState("");
  const [infoModal, setInfoModal] = useState<ConfigInfoContent | null>(null);
  const [editorForm, setEditorForm] = useState<ReglaFormState | null>(null);
  const [editorError, setEditorError] = useState("");
  const [selectedSuggestedRuleNames, setSelectedSuggestedRuleNames] = useState<string[]>([]);
  const [suggestedWizard, setSuggestedWizard] = useState<{
    rules: SuggestedRule[];
    index: number;
    form: ReglaFormState;
    error: string;
  } | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<ReglaMarco | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");

  const loadRules = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`${EMPRESAS_API_BASE}/capas/${capaId}/reglas/`, {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error("No se pudieron cargar las reglas marco.");
      }

      const body = (await response.json()) as ReglaMarco[];
      setReglas(body);
    } catch (error) {
      console.error("Error cargando reglas marco:", error);
      setReglas([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadRules();
  }, [capaId]);

  const suggestedRules = useMemo(() => {
    const existingNames = new Set(reglas.map((rule) => rule.nombre));
    return SUGGESTED_RULES.map((rule) => ({
      ...rule,
      ya_existe: existingNames.has(rule.nombre),
    }));
  }, [reglas]);

  const selectableSuggestedRules = useMemo(
    () => suggestedRules.filter((rule) => !rule.ya_existe),
    [suggestedRules]
  );

  const selectedSuggestedRules = useMemo(
    () =>
      selectableSuggestedRules.filter((rule) =>
        selectedSuggestedRuleNames.includes(rule.nombre)
      ),
    [selectableSuggestedRules, selectedSuggestedRuleNames]
  );

  const reglasActivas = reglas.filter((rule) => rule.activo).length;
  const reglasGlobales = reglas.filter((rule) => rule.aplica_a_todos).length;

  const toggleSuggestedRuleSelection = (ruleName: string) => {
    setSelectedSuggestedRuleNames((current) =>
      current.includes(ruleName)
        ? current.filter((name) => name !== ruleName)
        : [...current, ruleName]
    );
  };

  const persistRuleForm = async (
    form: ReglaFormState,
    options: { quiet?: boolean } = {}
  ): Promise<RuleSaveResult> => {
    const errors = validateRuleForm(form);
    if (hasValidationErrors(errors)) {
      return { ok: false, error: Object.values(errors).find(Boolean) };
    }

    setIsSaving(true);
    try {
      const url = form.id
        ? `${EMPRESAS_API_BASE}/capas/reglas/${form.id}/`
        : `${EMPRESAS_API_BASE}/capas/${capaId}/reglas/`;
      const method = form.id ? "PUT" : "POST";

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildRulePayload(form)),
      });

      if (!response.ok) {
        const errorBody = (await response.json().catch(() => ({}))) as unknown;
        throw new Error(getErrorMessage(errorBody, "No se pudo guardar la regla."));
      }

      if (!options.quiet) {
        setMensaje(form.id ? "Regla actualizada correctamente." : "Regla creada correctamente.");
        window.setTimeout(() => setMensaje(""), 3000);
      }
      await loadRules();
      return { ok: true };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "No se pudo guardar la regla.";
      if (!options.quiet) {
        setMensaje(message);
      }
      return { ok: false, error: message };
    } finally {
      setIsSaving(false);
    }
  };

  const openSuggestedRuleWizard = () => {
    if (!selectedSuggestedRules.length) {
      return;
    }
    setSuggestedWizard({
      rules: selectedSuggestedRules,
      index: 0,
      form: mapSuggestedRuleToForm(selectedSuggestedRules[0]),
      error: "",
    });
  };

  const saveSuggestedRuleWizard = async () => {
    if (!suggestedWizard) {
      return;
    }

    const result = await persistRuleForm(
      { ...suggestedWizard.form, id: null },
      { quiet: true }
    );
    if (!result.ok) {
      setSuggestedWizard((current) =>
        current ? { ...current, error: result.error || "No se pudo crear la regla." } : current
      );
      return;
    }

    const nextIndex = suggestedWizard.index + 1;
    if (nextIndex >= suggestedWizard.rules.length) {
      setSuggestedWizard(null);
      setSelectedSuggestedRuleNames([]);
      setMensaje("Reglas seleccionadas creadas correctamente.");
      window.setTimeout(() => setMensaje(""), 3000);
      return;
    }

    const nextRule = suggestedWizard.rules[nextIndex];
    setSuggestedWizard({
      rules: suggestedWizard.rules,
      index: nextIndex,
      form: mapSuggestedRuleToForm(nextRule),
      error: "",
    });
  };

  const saveEditorRule = async () => {
    if (!editorForm) {
      return;
    }
    const result = await persistRuleForm(editorForm);
    if (!result.ok) {
      setEditorError(result.error || "No se pudo guardar la regla.");
      return;
    }
    setEditorForm(null);
    setEditorError("");
  };

  const deleteRule = async () => {
    if (!deleteCandidate || deleteConfirmation !== "BORRAR") {
      return;
    }

    try {
      const response = await fetch(
        `${EMPRESAS_API_BASE}/capas/reglas/${deleteCandidate.id}/`,
        { method: "DELETE" }
      );

      if (!response.ok) {
        throw new Error("No se pudo borrar la regla marco.");
      }

      setMensaje("Regla borrada correctamente.");
      window.setTimeout(() => setMensaje(""), 3000);
      setDeleteCandidate(null);
      setDeleteConfirmation("");
      await loadRules();
    } catch (error) {
      console.error("Error borrando regla marco:", error);
      setMensaje("No se pudo borrar la regla marco.");
    }
  };

  return (
    <section className="overflow-hidden rounded-3xl border border-cyan-500/15 bg-gradient-to-br from-zinc-950 via-zinc-950 to-cyan-950/20 shadow-xl">
      <ConfigInfoModal info={infoModal} onClose={() => setInfoModal(null)} />
      {editorForm ? (
        <RuleEditorModal
          form={editorForm}
          saving={isSaving}
          error={editorError}
          onUpdate={(patch) => setEditorForm((current) => (current ? { ...current, ...patch } : current))}
          onClose={() => {
            if (!isSaving) {
              setEditorForm(null);
              setEditorError("");
            }
          }}
          onInfo={setInfoModal}
          onSave={saveEditorRule}
        />
      ) : null}
      {suggestedWizard ? (
        <SuggestedRuleWizardModal
          rule={suggestedWizard.rules[suggestedWizard.index]}
          form={suggestedWizard.form}
          index={suggestedWizard.index}
          total={suggestedWizard.rules.length}
          saving={isSaving}
          error={suggestedWizard.error}
          onUpdate={(patch) =>
            setSuggestedWizard((current) =>
              current ? { ...current, form: { ...current.form, ...patch } } : current
            )
          }
          onClose={() => {
            if (!isSaving) {
              setSuggestedWizard(null);
            }
          }}
          onInfo={setInfoModal}
          onSave={saveSuggestedRuleWizard}
        />
      ) : null}
      {deleteCandidate ? (
        <DeleteRuleModal
          rule={deleteCandidate}
          confirmation={deleteConfirmation}
          onConfirmationChange={setDeleteConfirmation}
          onClose={() => {
            setDeleteCandidate(null);
            setDeleteConfirmation("");
          }}
          onDelete={deleteRule}
        />
      ) : null}

      <div className="border-b border-zinc-800/80 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-300">
              Politicas globales
            </p>
            <div className="mt-2 flex items-center gap-2">
              <h3 className="text-xl font-semibold text-white">
                Reglas de capa de negocio
              </h3>
              <ConfigInfoButton info={ruleInfo.modulo} onOpen={setInfoModal} />
            </div>
            <p className="mt-2 text-sm text-zinc-500">
              Define cargos, recargos, descuentos y condiciones base para{" "}
              {capaNombre}. Las entidades pueden heredarlas o ajustarlas cuando
              su operacion lo requiera.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <MetricPill label="Total" value={reglas.length} tone="default" />
            <MetricPill label="Activas" value={reglasActivas} tone="green" />
            <MetricPill label="Globales" value={reglasGlobales} tone="cyan" />
          </div>
        </div>
      </div>

      <div className="space-y-5 p-5">
        {mensaje ? (
          <div className="rounded-2xl border border-cyan-500/25 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100">
            {mensaje}
          </div>
        ) : null}

        <div className="rounded-2xl border border-white/8 bg-zinc-950/65">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/8 px-4 py-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">
                Reglas predefinidas
              </p>
              <div className="mt-1 flex items-center gap-2">
                <h4 className="text-base font-semibold text-white">
                  Plantillas listas para activar
                </h4>
                <ConfigInfoButton info={ruleInfo.plantillas} onOpen={setInfoModal} />
              </div>
              <p className="mt-1 text-xs leading-5 text-zinc-500">
                Activa solo las reglas que usaras al inicio. Despues puedes ajustar
                montos, porcentajes y condiciones.
              </p>
            </div>
            {selectableSuggestedRules.length ? (
              <button
                type="button"
                onClick={openSuggestedRuleWizard}
                disabled={!selectedSuggestedRules.length || isSaving}
                className="rounded-2xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-100 transition hover:border-emerald-400/60 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {selectedSuggestedRules.length
                  ? `Crear seleccionadas (${selectedSuggestedRules.length})`
                  : "Selecciona reglas"}
              </button>
            ) : null}
          </div>

          <div className="divide-y divide-white/8">
            {suggestedRules.map((rule) => {
              const selected = selectedSuggestedRuleNames.includes(rule.nombre);
              return (
                <label
                  key={rule.nombre}
                  className={`grid gap-3 border-l-2 px-4 py-3 transition md:grid-cols-[minmax(0,1fr)_180px_140px_120px] md:items-center ${
                    rule.ya_existe
                      ? "cursor-default border-l-emerald-500/50 bg-emerald-500/5"
                      : selected
                        ? "cursor-pointer border-l-cyan-400/70 bg-cyan-500/10"
                        : "cursor-pointer border-l-amber-500/50 bg-zinc-900/45 hover:bg-zinc-900/75"
                  }`}
                >
                  <div className="flex min-w-0 gap-3">
                    <input
                      type="checkbox"
                      checked={selected}
                      disabled={rule.ya_existe}
                      onChange={() => toggleSuggestedRuleSelection(rule.nombre)}
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-zinc-700 bg-zinc-950 text-cyan-400 disabled:opacity-40"
                    />
                    <div className="min-w-0">
                      <p className="break-words text-sm font-semibold leading-5 text-white">
                        {rule.nombre}
                      </p>
                      <p className="mt-1 break-words text-xs leading-5 text-zinc-500">
                        {rule.descripcion}
                      </p>
                    </div>
                  </div>
                  <RuleSummary label="Calculo" value={LABELS_TIPO_CALCULO[rule.tipo_calculo] || rule.tipo_calculo} strong={formatRuleValue(rule)} />
                  <RuleSummary label="Frecuencia" value={LABELS_PERIODICIDAD[rule.periodicidad] || rule.periodicidad} />
                  <div className="flex md:justify-end">
                    <span
                      className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${
                        rule.ya_existe
                          ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-200"
                          : "border-amber-500/25 bg-amber-500/10 text-amber-200"
                      }`}
                    >
                      {rule.ya_existe ? "Activa" : "Pendiente"}
                    </span>
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-cyan-500/15 bg-cyan-500/5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.22em] text-cyan-200">
                Regla personalizada
              </p>
              <div className="mt-1 flex items-center gap-2">
                <h4 className="text-base font-semibold text-white">
                  Crear regla manual
                </h4>
                <ConfigInfoButton info={ruleInfo.manual} onOpen={setInfoModal} />
              </div>
              <p className="mt-1 text-sm leading-6 text-zinc-400">
                Abre el modal para capturar una regla heredable que no venga en
                las plantillas predefinidas.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setEditorError("");
                setEditorForm(EMPTY_RULE_FORM);
              }}
              disabled={isSaving}
              className="rounded-2xl bg-cyan-400 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Nueva regla
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-white/8 bg-zinc-950/65">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/8 px-4 py-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">
                Reglas heredables activas
              </p>
              <div className="mt-1 flex items-center gap-2">
                <h4 className="text-base font-semibold text-white">
                  Listado editable de la capa
                </h4>
                <ConfigInfoButton info={ruleInfo.listado} onOpen={setInfoModal} />
              </div>
              <p className="mt-1 text-xs leading-5 text-zinc-500">
                Revisa que la capa tenga solo reglas vigentes antes de importar
                clientes y espacios.
              </p>
            </div>
            <span className="rounded-full border border-white/8 bg-zinc-900 px-3 py-1 text-xs text-zinc-300">
              {reglas.length} reglas
            </span>
          </div>

          {isLoading ? (
            <div className="px-4 py-8 text-center text-sm text-zinc-500">
              Cargando reglas heredables...
            </div>
          ) : reglas.length ? (
            <div className="divide-y divide-white/8">
              {reglas.map((rule) => (
                <div
                  key={rule.id}
                  className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_180px_160px_160px]"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="break-words text-sm font-semibold text-white">
                        {rule.nombre}
                      </p>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] ${
                          rule.activo
                            ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-200"
                            : "border-zinc-700 bg-zinc-900 text-zinc-400"
                        }`}
                      >
                        {rule.activo ? "Activa" : "Inactiva"}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-zinc-500">
                      {ruleConditionLabel(rule)}
                    </p>
                  </div>
                  <div className="text-sm text-zinc-300">
                    <p>{LABELS_TIPO_CALCULO[rule.tipo_calculo] || rule.tipo_calculo}</p>
                    <p className="mt-1 font-semibold text-white">
                      {formatRuleValue(rule)}
                    </p>
                  </div>
                  <div className="text-sm text-zinc-400">
                    {LABELS_PERIODICIDAD[rule.periodicidad] || rule.periodicidad}
                  </div>
                  <div className="flex flex-wrap justify-start gap-2 md:justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        setEditorError("");
                        setEditorForm(mapRuleToForm(rule));
                      }}
                      className="rounded-xl border border-cyan-500/25 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-100 transition hover:border-cyan-400/60"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDeleteCandidate(rule);
                        setDeleteConfirmation("");
                      }}
                      className="rounded-xl border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-xs text-rose-100 transition hover:border-rose-400/60"
                    >
                      Borrar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-4 py-8 text-center text-sm text-zinc-500">
              Aun no hay reglas heredables. Crea las reglas base o agrega una
              personalizada.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function MetricPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "default" | "green" | "cyan";
}) {
  const classes =
    tone === "green"
      ? "border-green-500/20 bg-green-500/10 text-green-300"
      : tone === "cyan"
        ? "border-cyan-500/20 bg-cyan-500/10 text-cyan-300"
        : "border-zinc-800 bg-zinc-950/80 text-zinc-500";

  return (
    <div className={`rounded-xl border px-3 py-2 ${classes}`}>
      <p className="text-[10px] uppercase tracking-[0.16em]">{label}</p>
      <p className="mt-1 text-lg font-semibold text-white">{value}</p>
    </div>
  );
}

function RuleSummary({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: string;
}) {
  return (
    <div className="text-sm text-zinc-300">
      <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">
        {label}
      </p>
      <p className="mt-1 leading-5">{value}</p>
      {strong ? <p className="mt-1 font-semibold text-white">{strong}</p> : null}
    </div>
  );
}

function RuleFormFields({
  form,
  errors,
  onUpdate,
  onInfo,
}: {
  form: ReglaFormState;
  errors: Partial<Record<keyof ReglaFormState, string>>;
  onUpdate: (patch: Partial<ReglaFormState>) => void;
  onInfo: (info: ConfigInfoContent) => void;
}) {
  const valueLabel = ruleValueFieldLabel(form.tipo_calculo);

  return (
    <div className="mt-5 grid gap-3 md:grid-cols-2">
      <label>
        <ConfigFieldLabel required info={ruleInfo.nombre} onInfo={onInfo}>
          Nombre
        </ConfigFieldLabel>
        <input
          value={form.nombre}
          onChange={(event) => onUpdate({ nombre: sanitizeText(event.target.value) })}
          maxLength={80}
          placeholder="Ej. Interes moratorio"
          className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-500"
        />
        <FieldError error={errors.nombre} />
      </label>

      <label>
        <ConfigFieldLabel required info={ruleInfo.tipo} onInfo={onInfo}>
          Tipo de calculo
        </ConfigFieldLabel>
        <select
          value={form.tipo_calculo}
          onChange={(event) => onUpdate({ tipo_calculo: event.target.value })}
          className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-500"
        >
          {RULE_CATALOGS.tipos_calculo.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label>
        <ConfigFieldLabel required info={ruleInfo.valor} onInfo={onInfo}>
          {valueLabel}
        </ConfigFieldLabel>
        <input
          type="text"
          inputMode="decimal"
          value={form.valor}
          onChange={(event) => onUpdate({ valor: sanitizeMoneyInput(event.target.value) })}
          placeholder={isPercentageRuleType(form.tipo_calculo) ? "Ej. 5" : "Ej. 150.00"}
          className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-500"
        />
        <p className="mt-1 text-xs leading-5 text-zinc-500">
          {businessRuleValueHelper(form.tipo_calculo)}
        </p>
        <FieldError error={errors.valor} />
      </label>

      <label>
        <ConfigFieldLabel required info={ruleInfo.tipo} onInfo={onInfo}>
          Periodicidad
        </ConfigFieldLabel>
        <select
          value={form.periodicidad}
          onChange={(event) => onUpdate({ periodicidad: event.target.value })}
          className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-500"
        >
          {RULE_CATALOGS.periodicidades.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label>
        <ConfigFieldLabel optional info={ruleInfo.dias} onInfo={onInfo}>
          Dias condicion
        </ConfigFieldLabel>
        <input
          type="text"
          inputMode="numeric"
          maxLength={3}
          value={form.dias_condicion}
          onChange={(event) =>
            onUpdate({ dias_condicion: sanitizeIntegerInput(event.target.value) })
          }
          placeholder="Ej. 10"
          className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-500"
        />
        <p className="mt-1 text-xs leading-5 text-zinc-500">
          Opcional. Solo numeros enteros de 0 a 365.
        </p>
        <FieldError error={errors.dias_condicion} />
      </label>

      <div className="grid gap-2 sm:grid-cols-2">
        <CheckboxField
          label="Aplica a todos"
          checked={form.aplica_a_todos}
          onChange={(aplica_a_todos) => onUpdate({ aplica_a_todos })}
          info={ruleInfo.estado}
          onInfo={onInfo}
        />
        <CheckboxField
          label="Regla activa"
          checked={form.activo}
          onChange={(activo) => onUpdate({ activo })}
          info={ruleInfo.estado}
          onInfo={onInfo}
        />
      </div>
    </div>
  );
}

function CheckboxField({
  label,
  checked,
  onChange,
  info,
  onInfo,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  info?: ConfigInfoContent;
  onInfo?: (info: ConfigInfoContent) => void;
}) {
  return (
    <label className="flex gap-3 rounded-2xl border border-white/8 bg-zinc-950/70 p-4 text-sm text-zinc-200">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 h-4 w-4 rounded border-zinc-700 bg-zinc-950 text-cyan-400"
      />
      <span>
        <span className="flex items-center gap-2 font-medium text-white">
          <span>{label}</span>
          {info && onInfo ? (
            <ConfigInfoButton info={info} onOpen={onInfo} className="h-5 w-5 text-[10px]" />
          ) : null}
        </span>
      </span>
    </label>
  );
}

function FieldError({ error }: { error?: string }) {
  return error ? (
    <p className="mt-1 text-xs leading-5 text-rose-200">{error}</p>
  ) : null;
}

function SuggestedRuleWizardModal({
  rule,
  form,
  index,
  total,
  saving,
  error,
  onUpdate,
  onClose,
  onInfo,
  onSave,
}: {
  rule: SuggestedRule;
  form: ReglaFormState;
  index: number;
  total: number;
  saving: boolean;
  error: string;
  onUpdate: (patch: Partial<ReglaFormState>) => void;
  onClose: () => void;
  onInfo: (info: ConfigInfoContent) => void;
  onSave: () => void;
}) {
  const errors = validateRuleForm(form);
  const isLast = index >= total - 1;

  return (
    <div className="fixed inset-0 z-[170] flex items-center justify-center bg-black/75 px-4 py-6 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="suggested-rule-wizard-title"
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-[30px] border border-cyan-500/20 bg-zinc-950 p-5 shadow-2xl shadow-black/60"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-200">
              Regla seleccionada {index + 1} de {total}
            </p>
            <h3
              id="suggested-rule-wizard-title"
              className="mt-2 text-2xl font-semibold text-white"
            >
              {rule.nombre}
            </h3>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
              Revisa y completa la plantilla antes de crearla. Al guardar,
              BetterP pasara automaticamente a la siguiente regla seleccionada.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-2xl border border-white/10 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 transition hover:border-zinc-700 disabled:opacity-50"
          >
            Cerrar
          </button>
        </div>

        <div className="mt-4 rounded-2xl border border-white/8 bg-zinc-900/70 p-4">
          <p className="text-xs leading-5 text-zinc-400">{rule.descripcion}</p>
          <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-zinc-400">
            <span className="rounded-full border border-white/8 bg-zinc-950 px-2 py-1">
              {LABELS_TIPO_CALCULO[rule.tipo_calculo] || rule.tipo_calculo}
            </span>
            <span className="rounded-full border border-white/8 bg-zinc-950 px-2 py-1">
              {formatRuleValue(rule)}
            </span>
            <span className="rounded-full border border-white/8 bg-zinc-950 px-2 py-1">
              {LABELS_PERIODICIDAD[rule.periodicidad] || rule.periodicidad}
            </span>
          </div>
        </div>

        <RuleFormFields form={form} errors={errors} onUpdate={onUpdate} onInfo={onInfo} />

        {error ? (
          <div className="mt-4 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm leading-6 text-rose-100">
            {error}
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-white/8 pt-4">
          <p className="text-xs leading-5 text-zinc-500">
            {isLast
              ? "Esta es la ultima regla seleccionada."
              : "Al guardar, se abrira la siguiente regla seleccionada."}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-2xl border border-white/10 bg-zinc-900 px-4 py-2 text-sm text-zinc-200 transition hover:border-zinc-700 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={saving || hasValidationErrors(errors)}
              className="rounded-2xl bg-cyan-400 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Creando" : isLast ? "Crear y terminar" : "Crear y continuar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function RuleEditorModal({
  form,
  saving,
  error,
  onUpdate,
  onClose,
  onInfo,
  onSave,
}: {
  form: ReglaFormState;
  saving: boolean;
  error: string;
  onUpdate: (patch: Partial<ReglaFormState>) => void;
  onClose: () => void;
  onInfo: (info: ConfigInfoContent) => void;
  onSave: () => void;
}) {
  const errors = validateRuleForm(form);
  const isEditing = Boolean(form.id);

  return (
    <div className="fixed inset-0 z-[170] flex items-center justify-center bg-black/75 px-4 py-6 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="rule-editor-title"
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-[30px] border border-cyan-500/20 bg-zinc-950 p-5 shadow-2xl shadow-black/60"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-200">
              {isEditing ? "Editar regla heredable" : "Nueva regla heredable"}
            </p>
            <h3 id="rule-editor-title" className="mt-2 text-2xl font-semibold text-white">
              {isEditing ? form.nombre || "Ajustar regla" : "Crear regla personalizada"}
            </h3>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
              Define la regla que se heredara a nuevas unidades. Los montos y
              porcentajes deben ser mayores a cero; los dias solo aceptan enteros.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-2xl border border-white/10 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 transition hover:border-zinc-700 disabled:opacity-50"
          >
            Cerrar
          </button>
        </div>

        <RuleFormFields form={form} errors={errors} onUpdate={onUpdate} onInfo={onInfo} />

        {error ? (
          <div className="mt-4 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm leading-6 text-rose-100">
            {error}
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-white/8 pt-4">
          <p className="text-xs leading-5 text-zinc-500">
            {isEditing
              ? "Al guardar, se actualiza la regla heredable de la capa."
              : "Al crearla, quedara disponible para nuevas unidades y ocupaciones."}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-2xl border border-white/10 bg-zinc-900 px-4 py-2 text-sm text-zinc-200 transition hover:border-zinc-700 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={saving || hasValidationErrors(errors)}
              className="rounded-2xl bg-cyan-400 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Guardando" : isEditing ? "Guardar cambios" : "Crear regla"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DeleteRuleModal({
  rule,
  confirmation,
  onConfirmationChange,
  onClose,
  onDelete,
}: {
  rule: ReglaMarco;
  confirmation: string;
  onConfirmationChange: (value: string) => void;
  onClose: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[170] flex items-center justify-center bg-black/75 px-4 py-6 backdrop-blur-sm">
      <div className="w-full max-w-xl rounded-[30px] border border-rose-500/20 bg-zinc-950 p-5 shadow-2xl shadow-black/60">
        <p className="text-[11px] uppercase tracking-[0.24em] text-rose-200">
          Confirmacion
        </p>
        <h3 className="mt-2 text-2xl font-semibold text-white">
          Borrar regla heredable
        </h3>
        <p className="mt-3 text-sm leading-6 text-zinc-400">
          Vas a borrar <span className="font-semibold text-white">{rule.nombre}</span>.
          Esta regla dejara de estar disponible como base heredable de la capa.
        </p>
        <div className="mt-4 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
          Para confirmar, escribe BORRAR en el campo inferior.
        </div>
        <input
          value={confirmation}
          onChange={(event) => onConfirmationChange(event.target.value.toUpperCase())}
          placeholder="BORRAR"
          className="mt-4 w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm uppercase text-white outline-none transition focus:border-rose-400"
        />
        <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-white/8 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-white/10 bg-zinc-900 px-4 py-2 text-sm text-zinc-200 transition hover:border-zinc-700"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={confirmation !== "BORRAR"}
            className="rounded-2xl border border-rose-500/25 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-100 transition hover:border-rose-400/60 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Borrar regla
          </button>
        </div>
      </div>
    </div>
  );
}
