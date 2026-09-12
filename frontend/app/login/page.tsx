"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";

import GoogleMark from "@/components/auth/GoogleMark";
import { type TwoFactorChallenge, useAuth } from "@/components/auth/AuthProvider";
import TwoFactorStep from "@/components/auth/TwoFactorStep";
import ThemeToggle from "@/components/theme/ThemeToggle";
import { buildApiUrl } from "@/lib/api";
import {
  beginGoogleIdTokenRedirect,
  consumeGoogleIdTokenRedirect,
} from "@/lib/googleAuth";
import { resolveSolutionRedirectFromSearch } from "@/lib/pos-segment";

interface BootstrapStatusResponse {
  requires_bootstrap: boolean;
  google_enabled: boolean;
  google_client_id?: string;
  public_trial_enabled?: boolean;
}

type RequestedSolution = "pos_qr" | "";

const SOLUTION_LOGIN_CONTENT: Record<
  Exclude<RequestedSolution, "">,
  {
    badge: string;
    title: string;
    description: string;
    formEyebrow: string;
    formTitle: string;
    submitLabel: string;
    cards: string[];
  }
> = {
  pos_qr: {
    badge: "BetterP POS QR",
    title: "Entra a tu punto de venta.",
    description:
      "Abre la caja, cobra en mostrador o por codigo QR y lleva las mesas de tu restaurante.",
    formEyebrow: "BetterP POS QR",
    formTitle: "Entrar al punto de venta",
    submitLabel: "Entrar",
    cards: ["Caja y cobro por QR", "Mesas y comandas", "Productos e inventario"],
  },
};

const CAPA_TYPES = [
  { value: "OPERADORA", label: "Operadora" },
  { value: "ADMINISTRADORA", label: "Administradora" },
  { value: "EMPRESA", label: "Empresa" },
  { value: "HOTEL", label: "Hotel" },
  { value: "GRUPO", label: "Grupo" },
];

export default function LoginPage() {
  const { bootstrap, login, registerTrial, loginWithGoogle, verifyTwoFactor, resendTwoFactor } =
    useAuth();
  const [bootStatus, setBootStatus] = useState<BootstrapStatusResponse | null>(null);
  const [accessMode, setAccessMode] = useState<"login" | "trial">("login");
  const [isLoadingStatus, setIsLoadingStatus] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [twoFactorChallenge, setTwoFactorChallenge] =
    useState<TwoFactorChallenge | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [postLoginRedirect, setPostLoginRedirect] = useState("");
  const [requestedSolution, setRequestedSolution] = useState<RequestedSolution>("");
  const googleRedirectHandledRef = useRef(false);

  const [form, setForm] = useState({
    nombre: "",
    email: "",
    password: "",
    password_confirm: "",
    nombre_capa: "Mi operadora",
    tipo_capa: "OPERADORA",
    telefono: "",
  });

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const solution = (params.get("solution") || "")
      .trim()
      .toLowerCase()
      .replaceAll("-", "_");
    setRequestedSolution(solution === "pos_qr" ? solution : "");
    setPostLoginRedirect(resolveSolutionRedirectFromSearch(window.location.search));
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadStatus = async () => {
      try {
        const response = await fetch(buildApiUrl("/accounts/auth/bootstrap-status/"), {
          cache: "no-store",
        });
        const body = (await response.json()) as BootstrapStatusResponse;
        if (!cancelled) {
          setBootStatus(body);
        }
      } catch {
        if (!cancelled) {
          setErrorMessage("No pudimos cargar el estado inicial del acceso.");
        }
      } finally {
        if (!cancelled) {
          setIsLoadingStatus(false);
        }
      }
    };

    void loadStatus();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const params = new URLSearchParams(window.location.search);
    if (params.get("modo") === "trial" && bootStatus?.public_trial_enabled) {
      setAccessMode("trial");
    }
    if (params.get("modo") === "trial" && bootStatus && !bootStatus.public_trial_enabled) {
      setAccessMode("login");
    }
  }, [bootStatus]);

  useEffect(() => {
    if (
      googleRedirectHandledRef.current ||
      !bootStatus?.google_enabled ||
      accessMode !== "login"
    ) {
      return;
    }

    const result = consumeGoogleIdTokenRedirect("login");
    if (!result) {
      return;
    }

    googleRedirectHandledRef.current = true;
    if (result.error || !result.idToken) {
      setErrorMessage(
        result.errorDescription ||
          result.error ||
          "Google no devolvio una credencial valida."
      );
      return;
    }

    const completeGoogleLogin = async () => {
      try {
        setIsSubmitting(true);
        setErrorMessage("");
        const redirectAfterLogin =
          typeof window === "undefined"
            ? postLoginRedirect
            : resolveSolutionRedirectFromSearch(window.location.search);
        const loginResult = await loginWithGoogle(
          result.idToken,
          redirectAfterLogin ? { redirectTo: redirectAfterLogin } : undefined
        );
        if (loginResult.requiresTwoFactor && loginResult.challenge) {
          setTwoFactorChallenge(loginResult.challenge);
          setTwoFactorCode("");
        }
      } catch (error) {
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "No se pudo iniciar sesion con Google."
        );
      } finally {
        setIsSubmitting(false);
      }
    };

    void completeGoogleLogin();
  }, [accessMode, bootStatus, loginWithGoogle, postLoginRedirect]);

  const handleGoogleLogin = () => {
    setErrorMessage("");
    if (!bootStatus?.google_enabled || !bootStatus.google_client_id) {
      setErrorMessage("El acceso con Google no esta disponible en esta instancia.");
      return;
    }
    const redirectPath =
      typeof window === "undefined"
        ? "/login"
        : `${window.location.pathname}${window.location.search}`;
    beginGoogleIdTokenRedirect({
      clientId: bootStatus.google_client_id,
      context: "login",
      redirectPath,
    });
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage("");

    try {
      if (bootStatus?.requires_bootstrap) {
        await bootstrap(form);
      } else if (isTrialRegistration) {
        await registerTrial(
          form,
          postLoginRedirect ? { redirectTo: postLoginRedirect } : undefined
        );
      } else {
        const result = await login(
          { email: form.email, password: form.password },
          postLoginRedirect ? { redirectTo: postLoginRedirect } : undefined
        );
        if (result.requiresTwoFactor && result.challenge) {
          setTwoFactorChallenge(result.challenge);
          setTwoFactorCode("");
        }
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "No se pudo completar el acceso."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTwoFactorSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!twoFactorChallenge) {
      return;
    }
    setIsSubmitting(true);
    setErrorMessage("");
    try {
      await verifyTwoFactor(
        {
          challengeToken: twoFactorChallenge.challenge_token,
          codigo: twoFactorCode,
        },
        postLoginRedirect ? { redirectTo: postLoginRedirect } : undefined
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "No se pudo verificar el segundo paso."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTwoFactorResend = async () => {
    if (!twoFactorChallenge) {
      return;
    }
    setIsSubmitting(true);
    setErrorMessage("");
    try {
      const refreshedChallenge = await resendTwoFactor(
        twoFactorChallenge.challenge_token
      );
      setTwoFactorChallenge(refreshedChallenge);
      setTwoFactorCode("");
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "No se pudo reenviar el codigo."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const isBootstrap = Boolean(bootStatus?.requires_bootstrap);
  const canCreatePublicTrial = Boolean(bootStatus?.public_trial_enabled);
  const isTrialRegistration = !isBootstrap && accessMode === "trial" && canCreatePublicTrial;
  const solutionLoginContent = requestedSolution
    ? SOLUTION_LOGIN_CONTENT[requestedSolution]
    : null;
  const loginHeroContent = isBootstrap
    ? {
        badge: "Configuracion inicial",
        title: "Configura el primer acceso de BetterP.",
        description:
          "Crea el usuario administrador inicial y registra el primer negocio para empezar a operar.",
        cards: ["Administrador inicial", "Negocio principal", "Entrada protegida"],
        formEyebrow: "Primer acceso",
        formTitle: "Inicializar sistema",
        submitLabel: "Activar sistema",
      }
    : isTrialRegistration
      ? {
          badge: "Prueba BetterP",
          title: "Crea tu cuenta y prueba BetterP 10 dias.",
          description:
            "Registra tu usuario, crea tu negocio y evalua el sistema antes de contratar.",
          cards: ["Prueba por 10 dias", "Negocio configurado", "Sin compromiso inicial"],
          formEyebrow: "Prueba",
          formTitle: "Crear prueba",
          submitLabel: "Crear prueba por 10 dias",
        }
      : solutionLoginContent || {
          badge: "Acceso BetterP",
          title: "Entra a tu panel de trabajo.",
          description:
            "Usa tu correo o Google para abrir las herramientas y negocios asignados a tu cuenta.",
          cards: ["Herramientas asignadas", "Permisos de tu usuario", "Entrada protegida"],
          formEyebrow: "Acceso seguro",
          formTitle: "Entrar a BetterP",
          submitLabel: "Iniciar sesion",
        };

  return (
    <>
      <main className="auth-page min-h-screen bg-[radial-gradient(circle_at_top,#0f3b52_0%,#09090b_35%,#020617_100%)] px-4 py-10 text-white">
        <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-6xl items-center">
          <div className="grid w-full gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <section className="rounded-[32px] border border-white/10 bg-zinc-950/75 p-6 shadow-2xl backdrop-blur-xl sm:p-8">
              <div className="max-w-2xl">
                <span className="inline-flex rounded-full border border-cyan-500/25 bg-cyan-500/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-cyan-200">
                  {loginHeroContent.badge}
                </span>
                <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-5xl">
                  {loginHeroContent.title}
                </h1>
                <p className="mt-4 max-w-xl text-sm leading-7 text-zinc-400 sm:text-base">
                  {loginHeroContent.description}
                </p>
              </div>

              <div className="mt-8 grid gap-4 sm:grid-cols-3">
                {loginHeroContent.cards.map((item) => (
                  <div
                    key={item}
                    className="rounded-2xl border border-white/6 bg-zinc-900/60 px-4 py-4 text-sm text-zinc-300"
                  >
                    {item}
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-[32px] border border-white/10 bg-zinc-950/85 p-6 shadow-2xl backdrop-blur-xl sm:p-8">
              <div className="mb-6 flex items-center justify-between gap-3">
                <Link
                  href="https://betterp.net"
                  className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm font-medium text-zinc-300 transition hover:border-cyan-400/40 hover:bg-cyan-400/10 hover:text-cyan-100"
                >
                  Regresar
                </Link>
                <ThemeToggle />
              </div>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm uppercase tracking-[0.22em] text-zinc-500">
                    {loginHeroContent.formEyebrow}
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold text-white">
                    {loginHeroContent.formTitle}
                  </h2>
                </div>
                {isLoadingStatus ? (
                  <span className="rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-400">
                    Cargando...
                  </span>
                ) : null}
              </div>

              {!twoFactorChallenge && !isBootstrap && canCreatePublicTrial ? (
                <div className="mt-6 grid grid-cols-2 rounded-2xl border border-white/8 bg-zinc-950 p-1">
                  {[
                    { id: "login", label: "Ya tengo cuenta" },
                    { id: "trial", label: "Probar 10 dias" },
                  ].map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setAccessMode(item.id as "login" | "trial");
                        setErrorMessage("");
                        setTwoFactorChallenge(null);
                      }}
                      className={`rounded-xl px-3 py-2 text-sm font-semibold transition ${
                        accessMode === item.id
                          ? "bg-cyan-500 text-zinc-950"
                          : "text-zinc-400 hover:bg-white/5 hover:text-white"
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              ) : null}

              {!twoFactorChallenge ? (
              <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
                {isBootstrap || isTrialRegistration ? (
                  <label className="block">
                    <span className="mb-2 block text-sm text-zinc-400">
                      {isBootstrap ? "Nombre del administrador" : "Tu nombre"}
                    </span>
                    <input
                      value={form.nombre}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, nombre: event.target.value }))
                      }
                      className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-500"
                      placeholder="Ej. Daniel Muller"
                      required
                    />
                  </label>
                ) : null}

                <label className="block">
                  <span className="mb-2 block text-sm text-zinc-400">Correo de acceso</span>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, email: event.target.value }))
                    }
                    className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-500"
                    placeholder="admin@tuempresa.com"
                    required
                  />
                  {!isBootstrap ? (
                    <span className="mt-2 block text-xs text-zinc-500">
                      {isTrialRegistration
                        ? "Este correo sera el administrador de la prueba. Si ya existe, inicia sesion o recupera tu contrasena."
                        : "Usa el mismo correo al que llego tu invitacion o tu correo principal de acceso."}
                    </span>
                  ) : null}
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm text-zinc-400">Contrasena</span>
                  <input
                    type="password"
                    value={form.password}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, password: event.target.value }))
                    }
                    className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-500"
                    placeholder={isBootstrap ? "Define la contrasena inicial" : "Tu contrasena"}
                    required
                  />
                </label>

                {isTrialRegistration ? (
                  <label className="block">
                    <span className="mb-2 block text-sm text-zinc-400">Confirmar contrasena</span>
                    <input
                      type="password"
                      value={form.password_confirm}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, password_confirm: event.target.value }))
                      }
                      className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-500"
                      placeholder="Repite tu contrasena"
                      required
                    />
                  </label>
                ) : null}

                {isBootstrap || isTrialRegistration ? (
                  <>
                    <label className="block">
                      <span className="mb-2 block text-sm text-zinc-400">
                        {isBootstrap ? "Nombre del negocio principal" : "Nombre del negocio"}
                      </span>
                      <input
                        value={form.nombre_capa}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            nombre_capa: event.target.value,
                          }))
                        }
                        className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-500"
                        placeholder="Ej. Maya Coliving"
                        required
                      />
                    </label>

                    <label className="block">
                      <span className="mb-2 block text-sm text-zinc-400">Tipo de negocio</span>
                      <select
                        value={form.tipo_capa}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            tipo_capa: event.target.value,
                          }))
                        }
                        className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-500"
                      >
                        {CAPA_TYPES.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    {isTrialRegistration ? (
                      <label className="block">
                        <span className="mb-2 block text-sm text-zinc-400">Telefono de contacto</span>
                        <input
                          value={form.telefono}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              telefono: event.target.value,
                            }))
                          }
                          className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-500"
                          placeholder="Opcional"
                        />
                      </label>
                    ) : null}
                  </>
                ) : null}

                {errorMessage ? (
                  <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                    {errorMessage}
                  </div>
                ) : null}

                <button
                  type="submit"
                  disabled={isSubmitting || isLoadingStatus}
                  className="w-full rounded-2xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSubmitting
                    ? "Procesando..."
                    : loginHeroContent.submitLabel}
                </button>
                {!isBootstrap ? (
                  isTrialRegistration ? (
                    <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm leading-6 text-emerald-100">
                      Al crear la prueba entras directo al sistema. Cuando pasen 10 dias,
                      podrás contratar un plan desde Configuracion para continuar.
                    </div>
                  ) : (
                    <div className="flex justify-between gap-4 text-sm text-zinc-400">
                      <span>Tu acceso principal siempre es por correo.</span>
                      <Link
                        href="/recuperar-acceso"
                        className="text-cyan-300 transition hover:text-cyan-200"
                      >
                        Recuperar contrasena
                      </Link>
                    </div>
                  )
                ) : null}
              </form>
              ) : (
                <div className="mt-8">
                  <TwoFactorStep
                    challenge={twoFactorChallenge}
                    codigo={twoFactorCode}
                    submitting={isSubmitting}
                    errorMessage={errorMessage}
                    onCodigoChange={setTwoFactorCode}
                    onSubmit={handleTwoFactorSubmit}
                    onResend={handleTwoFactorResend}
                  />
                </div>
              )}

              {!twoFactorChallenge && !isBootstrap && accessMode === "login" && bootStatus?.google_enabled ? (
                <div className="mt-6">
                  <div className="mb-4 flex items-center gap-3 text-xs uppercase tracking-[0.2em] text-zinc-500">
                    <span className="h-px flex-1 bg-zinc-800" />
                    <span>o entra con Google</span>
                    <span className="h-px flex-1 bg-zinc-800" />
                  </div>
                  <button
                    type="button"
                    onClick={handleGoogleLogin}
                    disabled={isSubmitting || isLoadingStatus}
                    className="flex w-full items-center justify-center gap-3 rounded-full border border-white/12 bg-white px-5 py-3 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <GoogleMark />
                    Continuar con Google
                  </button>
                </div>
              ) : null}
              {!twoFactorChallenge &&
              !isBootstrap &&
              accessMode === "login" &&
              !isLoadingStatus &&
              !bootStatus?.google_enabled ? (
                <div className="mt-6 rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 text-sm leading-6 text-zinc-400">
                  El acceso con Google aun no esta disponible en esta instancia.
                  Puedes entrar con correo y contrasena.
                </div>
              ) : null}
            </section>
          </div>
        </div>
      </main>
    </>
  );
}
