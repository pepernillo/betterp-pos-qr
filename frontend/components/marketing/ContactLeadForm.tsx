"use client";

import { FormEvent, useEffect, useState } from "react";

import { buildApiUrl } from "@/lib/api";

type ContactLeadFormProps = {
  variant?: "light" | "dark";
  solutionKey?: "renta_facil" | "tienda_facil" | "vende_facil" | "";
  solutionName?: string;
};

const attributionParamKeys = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
] as const;

type AttributionParamKey = (typeof attributionParamKeys)[number];

type LeadAttributionPayload = Partial<Record<AttributionParamKey, string>> & {
  landing_url?: string;
  landing_referrer?: string;
  first_touch_at?: string;
};

const attributionStorageKey = "betterp_marketing_attribution_v1";

type LeadQualificationOption = {
  value: string;
  label: string;
};

const operationTypeOptions: LeadQualificationOption[] = [
  { value: "condominios", label: "Condominios / conjuntos" },
  { value: "espacios_renta", label: "Espacios en renta" },
  { value: "coliving", label: "Coliving / habitaciones" },
  { value: "oficinas_cowork", label: "Oficinas / cowork" },
  { value: "bodegas_estacionamientos", label: "Bodegas / estacionamientos" },
  { value: "otro", label: "Otro" },
];

const spacesCountOptions: LeadQualificationOption[] = [
  { value: "1_10", label: "1 a 10 espacios" },
  { value: "11_50", label: "11 a 50 espacios" },
  { value: "51_150", label: "51 a 150 espacios" },
  { value: "150_plus", label: "Mas de 150 espacios" },
];

const collectionMethodOptions: LeadQualificationOption[] = [
  { value: "manual_calls_messages", label: "Llamadas, correos o mensajes" },
  { value: "sheets_bank", label: "Hojas de calculo y banco" },
  { value: "mixed_system", label: "Sistema actual con trabajo manual" },
  { value: "no_recurrent", label: "No cobro recurrentemente" },
];

const mainPainOptions: LeadQualificationOption[] = [
  { value: "overdue_accounts", label: "Cuentas vencidas" },
  { value: "pending_rents", label: "Rentas pendientes" },
  { value: "unregistered_payments", label: "Pagos no registrados" },
  { value: "self_service", label: "Autoservicio para clientes" },
  { value: "real_time_control", label: "Control en tiempo real" },
];

const urgencyOptions: LeadQualificationOption[] = [
  { value: "this_week", label: "Esta semana" },
  { value: "this_month", label: "Este mes" },
  { value: "this_quarter", label: "Este trimestre" },
  { value: "exploring", label: "Estoy explorando" },
];

function readAttributionParams(): LeadAttributionPayload {
  if (typeof window === "undefined") return {};
  const params = new URLSearchParams(window.location.search);
  const current = attributionParamKeys.reduce<LeadAttributionPayload>(
    (current, key) => {
      const value = (params.get(key) || "").trim();
      if (value) current[key] = value;
      return current;
    },
    {},
  );
  const hasCurrentCampaign = attributionParamKeys.some((key) => Boolean(current[key]));
  let stored: LeadAttributionPayload = {};
  try {
    const rawStored = window.sessionStorage.getItem(attributionStorageKey);
    if (rawStored) stored = JSON.parse(rawStored) as LeadAttributionPayload;
  } catch {
    stored = {};
  }

  const hasStoredCampaign = attributionParamKeys.some((key) => Boolean(stored[key]));
  const attribution = hasStoredCampaign && !hasCurrentCampaign
    ? stored
    : {
        ...(hasCurrentCampaign ? current : stored),
        landing_url: hasCurrentCampaign || !stored.landing_url
          ? window.location.href
          : stored.landing_url,
        landing_referrer: hasCurrentCampaign || !stored.landing_referrer
          ? document.referrer
          : stored.landing_referrer,
        first_touch_at: hasCurrentCampaign || !stored.first_touch_at
          ? new Date().toISOString()
          : stored.first_touch_at,
      };
  try {
    window.sessionStorage.setItem(attributionStorageKey, JSON.stringify(attribution));
  } catch {
    // El formulario sigue funcionando si el navegador bloquea sessionStorage.
  }
  return attribution;
}

export default function ContactLeadForm({
  variant = "light",
  solutionKey = "",
  solutionName = "BetterP",
}: ContactLeadFormProps) {
  useEffect(() => {
    readAttributionParams();
  }, []);

  const isDark = variant === "dark";
  const normalizedSolutionName = solutionName.toLowerCase();
  const isRentaFacil =
    solutionKey === "renta_facil" || normalizedSolutionName.includes("renta");
  const isCommerce =
    solutionKey === "tienda_facil" ||
    solutionKey === "vende_facil" ||
    normalizedSolutionName.includes("commerce") ||
    normalizedSolutionName.includes("tienda") ||
    normalizedSolutionName.includes("vende");
  const darkIntroCopy = isCommerce
    ? "Cuentanos que vendes y en que canales operas. Te mostramos como unificar productos, inventario, catalogos, POS, tienda online, marketplaces, facturacion, envios y reportes."
    : "Cuentanos que administras y que proceso te urge ordenar. Te mostramos un recorrido enfocado en cobranza, ocupacion, gastos y reportes con ejemplos cercanos a tu negocio.";
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [leadEmail, setLeadEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [operationType, setOperationType] = useState("");
  const [spacesCount, setSpacesCount] = useState("");
  const [collectionMethod, setCollectionMethod] = useState("");
  const [mainPain, setMainPain] = useState("");
  const [urgency, setUrgency] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [statusTone, setStatusTone] = useState<"success" | "error" | "idle">(
    "idle",
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const leadSelectClass = isDark
    ? "w-full rounded-2xl border border-white/8 bg-white/[0.04] px-4 py-3 text-white outline-none transition focus:border-cyan-400 focus:bg-[#0b1629]"
    : "w-full rounded-md border border-slate-200 bg-white px-4 py-3 text-slate-950 outline-none transition focus:border-sky-400 focus:bg-sky-50";
  const leadLabelClass = isDark
    ? "mb-2 block text-sm font-medium text-zinc-300"
    : "mb-2 block text-sm font-medium text-slate-700";

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatusMessage("");
    setStatusTone("idle");

    if (!name.trim() || !leadEmail.trim()) {
      setStatusTone("error");
      setStatusMessage(
        "Compartenos al menos tu nombre y tu correo para darte seguimiento.",
      );
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(buildApiUrl("/billing/prospectos/contacto/"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          nombre: name.trim(),
          empresa: company.trim(),
          email: leadEmail.trim(),
          telefono: phone.trim(),
          mensaje:
            message.trim() ||
            `Quiero agendar una demo de ${solutionName} para revisar como se adapta a mi operacion.`,
          origen: "LANDING",
          solution_key: solutionKey,
          ...(isRentaFacil
            ? {
                operation_type: operationType,
                spaces_count: spacesCount,
                collection_method: collectionMethod,
                main_pain: mainPain,
                urgency,
              }
            : {}),
          ...readAttributionParams(),
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        mensaje?: string;
        detail?: string;
      };
      if (!response.ok) {
        throw new Error(
          body.detail || "No pudimos registrar tu solicitud de demo. Intentalo de nuevo.",
        );
      }

      setStatusTone("success");
      setStatusMessage(
        body.mensaje || "Gracias. Recibimos tu solicitud de demo y te contactaremos pronto.",
      );
      setName("");
      setCompany("");
      setLeadEmail("");
      setPhone("");
      setMessage("");
      setOperationType("");
      setSpacesCount("");
      setCollectionMethod("");
      setMainPain("");
      setUrgency("");
    } catch (error) {
      setStatusTone("error");
      setStatusMessage(
        error instanceof Error
          ? error.message
          : "No pudimos registrar tu solicitud de demo. Intentalo de nuevo.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section
      className={
        isDark
          ? "rounded-[34px] border border-white/8 bg-[linear-gradient(160deg,rgba(8,15,29,0.96),rgba(7,13,24,0.8))] p-6 text-white shadow-[0_28px_90px_rgba(0,0,0,0.24)] sm:p-8"
          : "rounded-lg border border-sky-100 bg-white p-6 text-slate-950 shadow-[0_18px_54px_rgba(14,165,233,0.08)] sm:p-8"
      }
    >
      <p
        className={
          isDark
            ? "text-[11px] uppercase tracking-[0.28em] text-cyan-200"
            : "text-[11px] uppercase tracking-[0.28em] text-sky-700"
        }
      >
        Solicita una demo
      </p>
      <h3 className={isDark ? "mt-4 text-3xl font-semibold text-white" : "mt-4 text-3xl font-semibold text-slate-950"}>
        Ve BetterP aplicado a tu operacion.
      </h3>
      <p className={isDark ? "mt-4 text-base leading-8 text-zinc-400" : "mt-4 text-base leading-8 text-slate-600"}>
        {isDark
          ? darkIntroCopy
          : "Cuentanos que administras y que proceso te urge ordenar. Te mostramos un recorrido enfocado en cobranza, ocupacion, gastos, ventas, inventario o reportes con ejemplos cercanos a tu negocio."}
      </p>
      <div className={isDark ? "mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm font-medium text-cyan-100" : "mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm font-medium text-sky-800"}>
        {["Demo guiada", "Revision de operacion", "Siguiente paso claro"].map((item) => (
          <span key={item} className="inline-flex items-center gap-2">
            <span className={isDark ? "h-1.5 w-1.5 rounded-full bg-cyan-300" : "h-1.5 w-1.5 rounded-full bg-sky-500"} />
            {item}
          </span>
        ))}
      </div>

      {statusTone !== "idle" ? (
        <div
          className={`mt-6 rounded-md border px-4 py-3 text-sm ${
            statusTone === "success"
              ? isDark
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
                : "border-emerald-200 bg-emerald-50 text-emerald-800"
              : isDark
                ? "border-rose-500/30 bg-rose-500/10 text-rose-100"
                : "border-rose-200 bg-rose-50 text-rose-800"
          }`}
        >
          {statusMessage}
        </div>
      ) : null}

      <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className={isDark ? "mb-2 block text-sm font-medium text-zinc-300" : "mb-2 block text-sm font-medium text-slate-700"}>
              Nombre
            </span>
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className={isDark ? "w-full rounded-2xl border border-white/8 bg-white/[0.04] px-4 py-3 text-white outline-none transition focus:border-cyan-400 focus:bg-[#0b1629]" : "w-full rounded-md border border-slate-200 bg-white px-4 py-3 text-slate-950 outline-none transition focus:border-sky-400 focus:bg-sky-50"}
              placeholder="Tu nombre"
            />
          </label>

          <label className="block">
            <span className={isDark ? "mb-2 block text-sm font-medium text-zinc-300" : "mb-2 block text-sm font-medium text-slate-700"}>
              Empresa o administracion
            </span>
            <input
              type="text"
              value={company}
              onChange={(event) => setCompany(event.target.value)}
              className={isDark ? "w-full rounded-2xl border border-white/8 bg-white/[0.04] px-4 py-3 text-white outline-none transition focus:border-cyan-400 focus:bg-[#0b1629]" : "w-full rounded-md border border-slate-200 bg-white px-4 py-3 text-slate-950 outline-none transition focus:border-sky-400 focus:bg-sky-50"}
              placeholder="Nombre de tu negocio"
            />
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className={isDark ? "mb-2 block text-sm font-medium text-zinc-300" : "mb-2 block text-sm font-medium text-slate-700"}>
              Correo de trabajo
            </span>
            <input
              type="email"
              value={leadEmail}
              onChange={(event) => setLeadEmail(event.target.value)}
              className={isDark ? "w-full rounded-2xl border border-white/8 bg-white/[0.04] px-4 py-3 text-white outline-none transition focus:border-cyan-400 focus:bg-[#0b1629]" : "w-full rounded-md border border-slate-200 bg-white px-4 py-3 text-slate-950 outline-none transition focus:border-sky-400 focus:bg-sky-50"}
              placeholder="tu@empresa.com"
            />
          </label>

          <label className="block">
            <span className={isDark ? "mb-2 block text-sm font-medium text-zinc-300" : "mb-2 block text-sm font-medium text-slate-700"}>
              WhatsApp o telefono
            </span>
            <input
              type="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              className={isDark ? "w-full rounded-2xl border border-white/8 bg-white/[0.04] px-4 py-3 text-white outline-none transition focus:border-cyan-400 focus:bg-[#0b1629]" : "w-full rounded-md border border-slate-200 bg-white px-4 py-3 text-slate-950 outline-none transition focus:border-sky-400 focus:bg-sky-50"}
              placeholder="Tu numero de contacto"
            />
          </label>
        </div>

        {isRentaFacil ? (
          <div className={isDark ? "rounded-[24px] border border-white/8 bg-white/[0.03] p-4" : "rounded-lg border border-sky-100 bg-sky-50/60 p-4"}>
            <p className={isDark ? "text-[11px] uppercase tracking-[0.2em] text-cyan-200" : "text-[11px] uppercase tracking-[0.2em] text-sky-700"}>
              Perfil para la demo
            </p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className={leadLabelClass}>Que administras</span>
                <select
                  value={operationType}
                  onChange={(event) => setOperationType(event.target.value)}
                  className={leadSelectClass}
                >
                  <option value="">Selecciona una opcion</option>
                  {operationTypeOptions.map((option) => (
                    <option key={`operation-${option.value}`} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className={leadLabelClass}>Volumen aproximado</span>
                <select
                  value={spacesCount}
                  onChange={(event) => setSpacesCount(event.target.value)}
                  className={leadSelectClass}
                >
                  <option value="">Selecciona una opcion</option>
                  {spacesCountOptions.map((option) => (
                    <option key={`spaces-${option.value}`} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className={leadLabelClass}>Como cobras hoy</span>
                <select
                  value={collectionMethod}
                  onChange={(event) => setCollectionMethod(event.target.value)}
                  className={leadSelectClass}
                >
                  <option value="">Selecciona una opcion</option>
                  {collectionMethodOptions.map((option) => (
                    <option key={`collection-${option.value}`} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className={leadLabelClass}>Problema principal</span>
                <select
                  value={mainPain}
                  onChange={(event) => setMainPain(event.target.value)}
                  className={leadSelectClass}
                >
                  <option value="">Selecciona una opcion</option>
                  {mainPainOptions.map((option) => (
                    <option key={`pain-${option.value}`} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block sm:col-span-2">
                <span className={leadLabelClass}>Cuando lo quieres resolver</span>
                <select
                  value={urgency}
                  onChange={(event) => setUrgency(event.target.value)}
                  className={leadSelectClass}
                >
                  <option value="">Selecciona una opcion</option>
                  {urgencyOptions.map((option) => (
                    <option key={`urgency-${option.value}`} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        ) : null}

        <label className="block">
          <span className={isDark ? "mb-2 block text-sm font-medium text-zinc-300" : "mb-2 block text-sm font-medium text-slate-700"}>
            Que quieres revisar en la demo
          </span>
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            rows={5}
            className={isDark ? "w-full rounded-[24px] border border-white/8 bg-white/[0.04] px-4 py-3 text-white outline-none transition focus:border-cyan-400 focus:bg-[#0b1629]" : "w-full rounded-md border border-slate-200 bg-white px-4 py-3 text-slate-950 outline-none transition focus:border-sky-400 focus:bg-sky-50"}
            placeholder={
              isCommerce
                ? "Ej. vendo en tienda fisica y Mercado Libre; quiero unificar inventario, precios, pedidos, envios y facturacion."
                : isDark
                ? "Ej. administro 80 espacios, quiero ordenar cobranza mensual, ocupacion, gastos, reportes o publicaciones."
                : "Ej. administro 80 espacios, quiero ordenar cobranza mensual, ocupacion, gastos, reportes, ventas o inventario."
            }
          />
        </label>

        <div className="pt-2">
          <button
            type="submit"
            disabled={isSubmitting}
            className={isDark ? "rounded-full bg-cyan-400 px-6 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-cyan-300 disabled:opacity-70" : "rounded-md border border-sky-300 bg-sky-500 px-6 py-3 text-sm font-semibold text-white transition hover:bg-sky-600 disabled:opacity-70"}
          >
            {isSubmitting ? "Enviando..." : "Solicitar demo"}
          </button>
        </div>
      </form>
    </section>
  );
}
