"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

import GoogleMark from "@/components/auth/GoogleMark";
import { useAuth } from "@/components/auth/AuthProvider";
import { buildApiUrl } from "@/lib/api";
import {
  beginGoogleIdTokenRedirect,
  consumeGoogleIdTokenRedirect,
} from "@/lib/googleAuth";

interface PlanSaaS {
  id: number;
  clave: string;
  nombre: string;
  descripcion: string;
  precio_mensual: number;
  precio_anual: number;
  max_usuarios: number;
  max_entidades: number;
  max_espacios: number;
  modulos_habilitados: string[];
  funciones_habilitadas: string[];
}

interface BootstrapStatusResponse {
  google_enabled: boolean;
  google_client_id?: string;
}

interface PendingGoogleCheckout {
  nombre_capa: string;
  tipo_capa: string;
  telefono: string;
  plan_id: number;
  plan_clave: string;
  periodicidad: "MENSUAL" | "ANUAL";
}

const CAPA_TYPES = [
  { value: "OPERADORA", label: "Operadora" },
  { value: "ADMINISTRADORA", label: "Administradora" },
  { value: "EMPRESA", label: "Empresa" },
  { value: "HOTEL", label: "Hotel" },
  { value: "CONDOMINIO", label: "Condominio" },
  { value: "PORTAFOLIO", label: "Portafolio" },
];

const CHECKOUT_LIMITS = {
  nombre: 80,
  nombre_capa: 120,
  email: 254,
  telefono: 16,
  password: 128,
};

type CheckoutForm = {
  nombre: string;
  email: string;
  password: string;
  password_confirm: string;
  nombre_capa: string;
  tipo_capa: string;
  telefono: string;
};

type CheckoutField = keyof CheckoutForm | "terms";

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(value || 0);

const parseCheckoutBody = async (response: Response) => {
  const rawBody = await response.text();
  if (!rawBody) {
    return {} as { checkout_url?: string; detail?: string };
  }
  try {
    return JSON.parse(rawBody) as { checkout_url?: string; detail?: string };
  } catch {
    return { detail: rawBody };
  }
};

const friendlyCheckoutError = (detail?: string) => {
  const cleanDetail = (detail || "").trim();
  if (!cleanDetail || cleanDetail.startsWith("<") || cleanDetail.includes("<html")) {
    return "No se pudo iniciar el checkout. Solicita una demo y te ayudamos a completar la contratacion.";
  }
  return cleanDetail;
};

const trimToLength = (value: string, maxLength: number) => value.slice(0, maxLength);

const sanitizePersonName = (value: string) =>
  trimToLength(value.replace(/[^\p{L}\s]/gu, "").replace(/\s{2,}/g, " "), CHECKOUT_LIMITS.nombre);

const sanitizeBusinessName = (value: string) =>
  trimToLength(
    value.replace(/[^\p{L}\p{N}\s.&'-]/gu, "").replace(/\s{2,}/g, " "),
    CHECKOUT_LIMITS.nombre_capa
  );

const sanitizePhone = (value: string) => {
  const trimmed = value.trim();
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "").slice(0, 15);
  return trimToLength(`${hasPlus ? "+" : ""}${digits}`, CHECKOUT_LIMITS.telefono);
};

const sanitizeEmail = (value: string) =>
  trimToLength(value.trim().toLowerCase(), CHECKOUT_LIMITS.email);

const sanitizePassword = (value: string) => trimToLength(value, CHECKOUT_LIMITS.password);

const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(value.trim());

const validateCommonCheckoutFields = (
  form: CheckoutForm,
  acceptedTerms: boolean,
  options: { requireBusinessName?: boolean; requirePhone?: boolean } = {}
) => {
  const errors: Partial<Record<CheckoutField, string>> = {};
  const requireBusinessName = options.requireBusinessName ?? true;
  const requirePhone = options.requirePhone ?? true;
  if (requireBusinessName) {
    const businessLength = form.nombre_capa.trim().length;
    if (businessLength < 3) {
      errors.nombre_capa = "Indica el nombre de tu negocio, minimo 3 caracteres.";
    } else if (businessLength > CHECKOUT_LIMITS.nombre_capa) {
      errors.nombre_capa = `Negocio no debe superar ${CHECKOUT_LIMITS.nombre_capa} caracteres.`;
    }
  }
  const phoneDigits = form.telefono.replace(/\D/g, "");
  if (requirePhone && !phoneDigits) {
    errors.telefono = "Indica un WhatsApp o telefono de contacto.";
  } else if (phoneDigits && (phoneDigits.length < 10 || phoneDigits.length > 15)) {
    errors.telefono = "El telefono debe tener entre 10 y 15 digitos.";
  }
  if (!acceptedTerms) {
    errors.terms = "Acepta los terminos y el aviso de privacidad para continuar.";
  }
  return errors;
};

const validateEmailCheckoutFields = (form: CheckoutForm, acceptedTerms: boolean) => {
  const errors = validateCommonCheckoutFields(form, acceptedTerms);
  const nameLength = form.nombre.trim().length;
  if (nameLength < 3) {
    errors.nombre = "Indica tu nombre, minimo 3 letras.";
  } else if (!/^[\p{L}\s]+$/u.test(form.nombre.trim())) {
    errors.nombre = "El nombre solo debe usar letras y espacios.";
  }
  if (!form.email.trim()) {
    errors.email = "Indica tu correo de trabajo.";
  } else if (!isValidEmail(form.email)) {
    errors.email = "Captura un correo valido, por ejemplo tu@empresa.com.";
  }
  if (form.password.length < 8) {
    errors.password = "La contrasena debe tener minimo 8 caracteres.";
  } else if (form.password.length > CHECKOUT_LIMITS.password) {
    errors.password = `La contrasena no debe superar ${CHECKOUT_LIMITS.password} caracteres.`;
  }
  if (!form.password_confirm) {
    errors.password_confirm = "Confirma tu contrasena.";
  } else if (form.password !== form.password_confirm) {
    errors.password_confirm = "Las contrasenas no coinciden.";
  }
  return errors;
};

const firstCheckoutError = (errors: Partial<Record<CheckoutField, string>>) =>
  Object.values(errors).find(Boolean) || "";

export default function PlanCheckoutRegistration() {
  const searchParams = useSearchParams();
  const { status, registerCheckout, registerCheckoutWithGoogle } = useAuth();
  const requestedPlanKey = searchParams.get("plan") || "growth";
  const requestedSolution = (searchParams.get("solution") || "")
    .trim()
    .toLowerCase()
    .replaceAll("-", "_");
  const solutionKey =
    requestedSolution === "tienda_facil" ||
    requestedSolution === "vende_facil" ||
    requestedPlanKey.startsWith("tienda_")
      ? "tienda_facil"
      : "renta_facil";
  const [plans, setPlans] = useState<PlanSaaS[]>([]);
  const [planKey, setPlanKey] = useState(requestedPlanKey);
  const [periodicidad, setPeriodicidad] = useState<"MENSUAL" | "ANUAL">(
    searchParams.get("periodicidad") === "ANUAL" ? "ANUAL" : "MENSUAL"
  );
  const [form, setForm] = useState({
    nombre: "",
    email: "",
    password: "",
    password_confirm: "",
    nombre_capa: "",
    tipo_capa: "OPERADORA",
    telefono: "",
  });
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [checkoutAttempted, setCheckoutAttempted] = useState(false);
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [bootStatus, setBootStatus] = useState<BootstrapStatusResponse | null>(null);
  const googleRedirectHandledRef = useRef(false);

  const selectedPlan = useMemo(() => {
    return plans.find((plan) => plan.clave === planKey) ?? plans[0] ?? null;
  }, [planKey, plans]);

  const selectedPrice = selectedPlan
    ? periodicidad === "ANUAL"
      ? selectedPlan.precio_anual
      : selectedPlan.precio_mensual
    : 0;

  const monthlyEquivalent =
    selectedPlan && periodicidad === "ANUAL"
      ? Math.round((selectedPlan.precio_anual || 0) / 12)
      : selectedPlan?.precio_mensual || 0;

  const emailCheckoutErrors = useMemo(
    () => validateEmailCheckoutFields(form, acceptedTerms),
    [acceptedTerms, form]
  );

  const commonCheckoutErrors = useMemo(
    () => validateCommonCheckoutFields(form, acceptedTerms),
    [acceptedTerms, form]
  );

  const visibleError = (field: CheckoutField) => {
    if (status === "authenticated") {
      if (field === "terms" && checkoutAttempted) {
        return commonCheckoutErrors.terms || "";
      }
      return "";
    }
    if (checkoutAttempted) {
      return emailCheckoutErrors[field] || "";
    }
    if (field === "terms") {
      return "";
    }
    const value = form[field as keyof CheckoutForm];
    return value ? emailCheckoutErrors[field] || "" : "";
  };

  const fieldNote = (field: CheckoutField, helper: string) => {
    const error = visibleError(field);
    return (
      <span className={`mt-2 block text-xs leading-5 ${error ? "text-rose-200" : "text-zinc-500"}`}>
        {error || helper}
      </span>
    );
  };

  const inputClassName = (field: CheckoutField) =>
    `w-full rounded-2xl border bg-white/[0.04] px-4 py-3 outline-none transition focus:border-cyan-300 ${
      visibleError(field) ? "border-rose-400/60" : "border-white/10"
    }`;

  const updateFormField = <K extends keyof CheckoutForm>(
    key: K,
    value: CheckoutForm[K]
  ) => {
    const nextValue =
      key === "nombre"
        ? sanitizePersonName(value)
        : key === "nombre_capa"
          ? sanitizeBusinessName(value)
          : key === "telefono"
            ? sanitizePhone(value)
            : key === "email"
              ? sanitizeEmail(value)
              : key === "password" || key === "password_confirm"
                ? sanitizePassword(value)
                : value;
    setForm((current) => ({ ...current, [key]: nextValue }));
  };

  useEffect(() => {
    let cancelled = false;
    const loadData = async () => {
      try {
        const [plansResponse, bootResponse] = await Promise.all([
          fetch(
            buildApiUrl(`/billing/planes/?solution=${encodeURIComponent(solutionKey)}`),
            { cache: "no-store" },
          ),
          fetch(buildApiUrl("/accounts/auth/bootstrap-status/"), {
            cache: "no-store",
          }),
        ]);
        const plansBody = (await plansResponse.json().catch(() => ({}))) as {
          items?: PlanSaaS[];
        };
        const bootBody = (await bootResponse.json().catch(() => ({}))) as BootstrapStatusResponse;
        if (!plansResponse.ok) {
          throw new Error("No se pudieron cargar los planes disponibles.");
        }
        if (!cancelled) {
          const nextPlans = plansBody.items ?? [];
          setPlans(nextPlans);
          if (!nextPlans.some((plan) => plan.clave === planKey) && nextPlans[0]) {
            setPlanKey(nextPlans[0].clave);
          }
          setBootStatus(bootBody);
        }
      } catch (error) {
        if (!cancelled) {
          setMessage(
            error instanceof Error
              ? error.message
              : "No se pudo preparar el checkout."
          );
        }
      }
    };

    void loadData();
    return () => {
      cancelled = true;
    };
  }, [planKey, solutionKey]);

  const launchCheckout = async (
    plan: PlanSaaS,
    checkoutPeriodicity: "MENSUAL" | "ANUAL" = periodicidad
  ) => {
    const origin = window.location.origin;
    const response = await fetch(buildApiUrl("/billing/suscripcion/checkout/"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plan_id: plan.id,
        periodicidad: checkoutPeriodicity,
        success_url: `${origin}/pago/exito?plan=${plan.clave}&periodicidad=${checkoutPeriodicity}`,
        cancel_url: `${origin}/pago/cancelado?plan=${plan.clave}&periodicidad=${checkoutPeriodicity}`,
      }),
    });
    const body = await parseCheckoutBody(response);
    if (!response.ok) {
      throw new Error(friendlyCheckoutError(body.detail));
    }
    if (!body.checkout_url) {
      throw new Error("La pasarela de pagos no regreso una liga para continuar.");
    }
    window.location.assign(body.checkout_url);
  };

  const validateCheckoutRequest = (options: { requireBusinessName?: boolean } = {}) => {
    const requireBusinessName = options.requireBusinessName ?? true;
    if (!selectedPlan) {
      throw new Error("Selecciona un plan para continuar.");
    }
    const errors = validateCommonCheckoutFields(form, acceptedTerms, {
      requireBusinessName,
      requirePhone: requireBusinessName,
    });
    const firstError = firstCheckoutError(errors);
    if (firstError) {
      throw new Error(firstError);
    }
    return selectedPlan;
  };

  const handleEmailRegistration = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCheckoutAttempted(true);
    setMessage("");
    try {
      const plan = validateCheckoutRequest();
      const firstError = firstCheckoutError(emailCheckoutErrors);
      if (firstError) {
        throw new Error(firstError);
      }
      setIsSubmitting(true);
      await registerCheckout(
        {
          ...form,
          plan_id: plan.id,
          periodicidad,
        },
        { skipRedirect: true }
      );
      await launchCheckout(plan);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "No se pudo preparar el pago."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleCredential = async (
    credential?: string,
    pending?: PendingGoogleCheckout
  ) => {
    setMessage("");
    try {
      const plan =
        plans.find((item) => item.id === pending?.plan_id) ??
        validateCheckoutRequest();
      const checkoutPeriodicity = pending?.periodicidad ?? periodicidad;
      if (!credential) {
        throw new Error("Google no regreso una credencial valida.");
      }
      setIsSubmitting(true);
      await registerCheckoutWithGoogle(
        {
          id_token: credential,
          nombre_capa: pending?.nombre_capa ?? form.nombre_capa,
          tipo_capa: pending?.tipo_capa ?? form.tipo_capa,
          telefono: pending?.telefono ?? form.telefono,
          plan_id: plan.id,
          periodicidad: checkoutPeriodicity,
        },
        { skipRedirect: true }
      );
      await launchCheckout(plan, checkoutPeriodicity);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "No se pudo crear la cuenta con Google."
      );
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    if (googleRedirectHandledRef.current || !bootStatus || plans.length === 0) {
      return;
    }

    const result = consumeGoogleIdTokenRedirect<PendingGoogleCheckout>("checkout");
    if (!result) {
      return;
    }

    googleRedirectHandledRef.current = true;
    if (result.pending) {
      setPlanKey(result.pending.plan_clave);
      setPeriodicidad(result.pending.periodicidad);
      setForm((current) => ({
        ...current,
        nombre_capa: result.pending?.nombre_capa ?? current.nombre_capa,
        tipo_capa: result.pending?.tipo_capa ?? current.tipo_capa,
        telefono: result.pending?.telefono ?? current.telefono,
      }));
      setAcceptedTerms(true);
    }

    if (result.error || !result.idToken) {
      setMessage(
        result.errorDescription ||
          result.error ||
          "Google no regreso una credencial valida."
      );
      return;
    }

    void handleGoogleCredential(result.idToken, result.pending);
  }, [bootStatus, plans]);

  const handleGoogleRegistration = () => {
    setMessage("");
    setCheckoutAttempted(true);
    try {
      const plan = validateCheckoutRequest();
      if (!bootStatus?.google_enabled || !bootStatus.google_client_id) {
        throw new Error("El registro con Google no esta disponible en esta instancia.");
      }
      beginGoogleIdTokenRedirect<PendingGoogleCheckout>({
        clientId: bootStatus.google_client_id,
        context: "checkout",
        redirectPath: window.location.pathname || "/registro",
        pending: {
          nombre_capa: form.nombre_capa,
          tipo_capa: form.tipo_capa,
          telefono: form.telefono,
          plan_id: plan.id,
          plan_clave: plan.clave,
          periodicidad,
        },
      });
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "No se pudo iniciar el registro con Google."
      );
    }
  };

  const handleAuthenticatedCheckout = async () => {
    setMessage("");
    setCheckoutAttempted(true);
    try {
      const plan = validateCheckoutRequest({ requireBusinessName: false });
      const firstError = firstCheckoutError(
        validateCommonCheckoutFields(form, acceptedTerms, {
          requireBusinessName: false,
          requirePhone: false,
        })
      );
      if (firstError) {
        throw new Error(firstError);
      }
      setIsSubmitting(true);
      await launchCheckout(plan);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "No se pudo preparar el pago."
      );
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.16),transparent_28%),linear-gradient(180deg,#04070f_0%,#060a14_100%)] px-5 py-8 text-white sm:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <Link
              href="https://betterp.net#planes"
              className="text-sm font-semibold text-cyan-200 hover:text-cyan-100"
            >
              Volver a planes
            </Link>
            <Link
              href="/login"
              className="rounded-full border border-white/10 px-4 py-2 text-sm text-zinc-200 hover:border-cyan-300/40 hover:bg-cyan-300/10"
            >
              Ya tengo cuenta
            </Link>
          </div>

          <section className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
            <aside className="rounded-[30px] border border-white/10 bg-zinc-950/75 p-6 shadow-2xl">
              <p className="text-[11px] uppercase tracking-[0.28em] text-cyan-200">
                Checkout BetterP
              </p>
              <h1 className="mt-4 text-3xl font-semibold leading-tight sm:text-4xl">
                Crea tu cuenta y activa tu plan.
              </h1>
              <p className="mt-4 text-sm leading-7 text-zinc-400">
                Primero registramos tu cuenta owner y despues te llevamos a Stripe
                para confirmar el pago recurrente del plan seleccionado.
              </p>

              <div className="mt-7 grid gap-3">
                {plans.map((plan) => (
                  <button
                    key={plan.clave}
                    type="button"
                    onClick={() => setPlanKey(plan.clave)}
                    className={`rounded-2xl border px-4 py-4 text-left transition ${
                      selectedPlan?.clave === plan.clave
                        ? "border-cyan-300/50 bg-cyan-300/12"
                        : "border-white/8 bg-white/[0.03] hover:border-cyan-300/25"
                    }`}
                  >
                    <span className="text-lg font-semibold text-white">
                      {plan.nombre}
                    </span>
                    <span className="mt-1 block text-sm leading-6 text-zinc-400">
                      {plan.descripcion}
                    </span>
                    <span className="mt-3 block text-sm text-cyan-100">
                      {formatCurrency(plan.precio_mensual)} / mes
                    </span>
                  </button>
                ))}
              </div>
            </aside>

            <section className="rounded-[30px] border border-white/10 bg-zinc-950/85 p-6 shadow-2xl">
              {selectedPlan ? (
                <div className="rounded-3xl border border-cyan-400/20 bg-cyan-400/10 p-5">
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.22em] text-cyan-200">
                        Plan seleccionado
                      </p>
                      <h2 className="mt-2 text-2xl font-semibold">
                        {selectedPlan.nombre}
                      </h2>
                      <p className="mt-2 text-sm leading-6 text-cyan-50/80">
                        {selectedPlan.max_usuarios} usuarios · {selectedPlan.max_entidades} entidades · {selectedPlan.max_espacios} espacios
                      </p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-zinc-950/60 px-4 py-3">
                      <p className="text-2xl font-semibold">
                        {formatCurrency(selectedPrice)}
                      </p>
                      <p className="mt-1 text-xs uppercase tracking-[0.16em] text-zinc-400">
                        {periodicidad === "ANUAL"
                          ? `${formatCurrency(monthlyEquivalent)} promedio mensual`
                          : "Facturacion mensual"}
                      </p>
                    </div>
                  </div>

                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => setPeriodicidad("MENSUAL")}
                      className={`rounded-2xl border px-4 py-3 text-sm font-semibold ${
                        periodicidad === "MENSUAL"
                          ? "border-cyan-300 bg-cyan-300 text-zinc-950"
                          : "border-white/10 bg-white/[0.03] text-zinc-200"
                      }`}
                    >
                      Mensual
                    </button>
                    <button
                      type="button"
                      onClick={() => setPeriodicidad("ANUAL")}
                      className={`rounded-2xl border px-4 py-3 text-sm font-semibold ${
                        periodicidad === "ANUAL"
                          ? "border-emerald-300 bg-emerald-300 text-zinc-950"
                          : "border-white/10 bg-white/[0.03] text-zinc-200"
                      }`}
                    >
                      Anual · pagas 10 meses y recibes 12
                    </button>
                  </div>
                </div>
              ) : null}

              <form className="mt-6 space-y-4" onSubmit={handleEmailRegistration}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-2 block text-sm text-zinc-300">
                      Nombre <span className="text-cyan-200">Obligatorio</span>
                    </span>
                    <input
                      value={form.nombre}
                      onChange={(event) =>
                        updateFormField("nombre", event.target.value)
                      }
                      maxLength={CHECKOUT_LIMITS.nombre}
                      required
                      aria-invalid={Boolean(visibleError("nombre"))}
                      className={inputClassName("nombre")}
                      placeholder="Tu nombre"
                    />
                    {fieldNote("nombre", "Solo letras y espacios. Maximo 80 caracteres.")}
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-sm text-zinc-300">
                      Negocio <span className="text-cyan-200">Obligatorio</span>
                    </span>
                    <input
                      value={form.nombre_capa}
                      onChange={(event) =>
                        updateFormField("nombre_capa", event.target.value)
                      }
                      maxLength={CHECKOUT_LIMITS.nombre_capa}
                      required
                      aria-invalid={Boolean(visibleError("nombre_capa"))}
                      className={inputClassName("nombre_capa")}
                      placeholder="Nombre de tu operacion"
                    />
                    {fieldNote("nombre_capa", "Maximo 120 caracteres. Puedes usar letras, numeros y & . ' -.")}
                  </label>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-2 block text-sm text-zinc-300">
                      Correo <span className="text-cyan-200">Obligatorio</span>
                    </span>
                    <input
                      type="email"
                      inputMode="email"
                      value={form.email}
                      onChange={(event) =>
                        updateFormField("email", event.target.value)
                      }
                      maxLength={CHECKOUT_LIMITS.email}
                      required
                      aria-invalid={Boolean(visibleError("email"))}
                      className={inputClassName("email")}
                      placeholder="tu@empresa.com"
                    />
                    {fieldNote("email", "Usaremos este correo para crear la cuenta owner.")}
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-sm text-zinc-300">
                      WhatsApp o telefono <span className="text-cyan-200">Obligatorio</span>
                    </span>
                    <input
                      type="tel"
                      inputMode="tel"
                      value={form.telefono}
                      onChange={(event) =>
                        updateFormField("telefono", event.target.value)
                      }
                      maxLength={CHECKOUT_LIMITS.telefono}
                      required
                      aria-invalid={Boolean(visibleError("telefono"))}
                      className={inputClassName("telefono")}
                      placeholder="Tu numero de contacto"
                    />
                    {fieldNote("telefono", "Solo numeros. 10 a 15 digitos; puedes iniciar con +.")}
                  </label>
                </div>

                <div className="grid gap-4 sm:grid-cols-3">
                  <label className="block">
                    <span className="mb-2 block text-sm text-zinc-300">Tipo de operacion</span>
                    <select
                      value={form.tipo_capa}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, tipo_capa: event.target.value }))
                      }
                      required
                      className="w-full rounded-2xl border border-white/10 bg-[#10141d] px-4 py-3 outline-none focus:border-cyan-300"
                    >
                      {CAPA_TYPES.map((type) => (
                        <option key={type.value} value={type.value}>
                          {type.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-sm text-zinc-300">
                      Contrasena <span className="text-cyan-200">Obligatorio</span>
                    </span>
                    <input
                      type="password"
                      value={form.password}
                      onChange={(event) =>
                        updateFormField("password", event.target.value)
                      }
                      minLength={8}
                      maxLength={CHECKOUT_LIMITS.password}
                      required
                      aria-invalid={Boolean(visibleError("password"))}
                      className={inputClassName("password")}
                      placeholder="Minimo 8 caracteres"
                    />
                    {fieldNote("password", "Minimo 8 y maximo 128 caracteres.")}
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-sm text-zinc-300">
                      Confirmar <span className="text-cyan-200">Obligatorio</span>
                    </span>
                    <input
                      type="password"
                      value={form.password_confirm}
                      onChange={(event) =>
                        updateFormField("password_confirm", event.target.value)
                      }
                      minLength={8}
                      maxLength={CHECKOUT_LIMITS.password}
                      required
                      aria-invalid={Boolean(visibleError("password_confirm"))}
                      className={inputClassName("password_confirm")}
                      placeholder="Repite tu contrasena"
                    />
                    {fieldNote("password_confirm", "Debe coincidir con la contrasena.")}
                  </label>
                </div>

                <label className="flex items-start gap-3 rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 text-sm leading-6 text-zinc-300">
                  <input
                    type="checkbox"
                    checked={acceptedTerms}
                    onChange={(event) => setAcceptedTerms(event.target.checked)}
                    className="mt-1 h-4 w-4 accent-cyan-300"
                  />
                  <span>
                    Acepto los{" "}
                    <Link href="https://betterp.net/terms" className="text-cyan-200">
                      terminos del servicio
                    </Link>{" "}
                    y el{" "}
                    <Link href="https://betterp.net/privacy" className="text-cyan-200">
                      aviso de privacidad
                    </Link>
                    .
                  </span>
                </label>
                {fieldNote("terms", "Debes aceptar los terminos para crear la cuenta y pasar a Stripe.")}

                {status === "authenticated" ? (
                  <div className="rounded-2xl border border-emerald-300/20 bg-emerald-300/10 px-4 py-3 text-sm leading-6 text-emerald-50">
                    <span className="block font-semibold">Cuenta lista.</span>
                    <span className="text-emerald-50/80">
                      Ya estas dentro con tu cuenta. El siguiente paso es completar el pago
                      del plan seleccionado.
                    </span>
                  </div>
                ) : null}

                {message ? (
                  <div className="rounded-2xl border border-amber-400/25 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
                    {message}
                  </div>
                ) : null}

                {status === "authenticated" ? (
                  <button
                    type="button"
                    onClick={handleAuthenticatedCheckout}
                    disabled={isSubmitting || !selectedPlan}
                    className="w-full rounded-full bg-cyan-300 px-5 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-cyan-200 disabled:opacity-60"
                  >
                    {isSubmitting ? "Abriendo checkout..." : "Continuar a pago con mi cuenta"}
                  </button>
                ) : (
                  <>
                    <button
                      type="submit"
                      disabled={isSubmitting || !selectedPlan}
                      className="w-full rounded-full bg-cyan-300 px-5 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-cyan-200 disabled:opacity-60"
                    >
                      {isSubmitting ? "Preparando pago..." : "Crear cuenta y pagar"}
                    </button>
                    {bootStatus?.google_enabled ? (
                      <div className="pt-2">
                        <div className="mb-3 flex items-center gap-3 text-xs uppercase tracking-[0.2em] text-zinc-500">
                          <span className="h-px flex-1 bg-zinc-800" />
                          <span>o registra con Google</span>
                          <span className="h-px flex-1 bg-zinc-800" />
                        </div>
                        <button
                          type="button"
                          onClick={handleGoogleRegistration}
                          disabled={isSubmitting || !selectedPlan}
                          className="flex w-full items-center justify-center gap-3 rounded-full border border-white/12 bg-white px-5 py-3 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <GoogleMark />
                          Continuar con Google
                        </button>
                      </div>
                    ) : null}
                  </>
                )}
              </form>
            </section>
          </section>
        </div>
      </main>
    </>
  );
}
