"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

import { type TwoFactorChallenge, useAuth } from "@/components/auth/AuthProvider";
import TwoFactorStep from "@/components/auth/TwoFactorStep";

export default function BackofficeLoginPage() {
  const { loginBackoffice, verifyTwoFactor, resendTwoFactor } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [codigo, setCodigo] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [twoFactorChallenge, setTwoFactorChallenge] =
    useState<TwoFactorChallenge | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage("");

    try {
      const result = await loginBackoffice(
        { email, password },
        { redirectTo: "/backoffice" }
      );
      if (result.requiresTwoFactor && result.challenge) {
        setTwoFactorChallenge(result.challenge);
        setCodigo("");
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "No se pudo iniciar sesion en el backoffice."
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
          codigo,
        },
        { redirectTo: "/backoffice" }
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "No se pudo validar el segundo paso del backoffice."
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
      setCodigo("");
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "No se pudo reenviar el codigo del backoffice."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#0e2233_0%,#09090b_38%,#020617_100%)] px-4 py-10 text-white">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-6xl items-center">
        <div className="grid w-full gap-6 lg:grid-cols-[1.05fr_0.95fr]">
          <section className="rounded-[32px] border border-white/10 bg-zinc-950/70 p-6 shadow-2xl backdrop-blur-xl sm:p-8">
            <div className="max-w-2xl">
              <span className="inline-flex rounded-full border border-cyan-500/25 bg-cyan-500/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-cyan-200">
                Backoffice SaaS
              </span>
              <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-5xl">
                Accede al control interno de BettERP.
              </h1>
              <p className="mt-4 max-w-xl text-sm leading-7 text-zinc-400 sm:text-base">
                Esta vista esta separada del acceso operativo del ERP. Aqui
                administras suscriptores, prospectos, solicitudes, cobranza SaaS
                y el seguimiento comercial del producto.
              </p>
            </div>

            <div className="mt-8 grid gap-4 sm:grid-cols-3">
              {[
                "Clientes, planes y renovaciones en una sola lectura.",
                "Prospectos web, solicitudes por WhatsApp y pagos en cola.",
                "Vista reservada solo para administracion de plataforma.",
              ].map((item) => (
                <div
                  key={item}
                  className="rounded-2xl border border-white/6 bg-zinc-900/60 px-4 py-4 text-sm leading-6 text-zinc-300"
                >
                  {item}
                </div>
              ))}
            </div>

            <div className="mt-8 flex flex-wrap gap-3 text-sm text-zinc-400">
              <Link
                href="/login"
                className="rounded-2xl border border-zinc-700 px-4 py-3 transition hover:border-zinc-600 hover:text-white"
              >
                Ir al acceso operativo
              </Link>
              <Link
                href="/"
                className="rounded-2xl border border-zinc-700 px-4 py-3 transition hover:border-zinc-600 hover:text-white"
              >
                Volver a la landing
              </Link>
            </div>
          </section>

          <section className="rounded-[32px] border border-white/10 bg-zinc-950/85 p-6 shadow-2xl backdrop-blur-xl sm:p-8">
            <p className="text-sm uppercase tracking-[0.22em] text-zinc-500">
              Acceso administrativo
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-white">
              Entrar al backoffice
            </h2>
            <p className="mt-3 text-sm leading-7 text-zinc-400">
              Usa la cuenta administradora de plataforma. Este acceso no esta
              pensado para usuarios operativos, clientes ni miembros de una sola
              capa de negocio.
            </p>

            {!twoFactorChallenge ? (
              <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
                <label className="block">
                  <span className="mb-2 block text-sm text-zinc-400">
                    Correo de acceso
                  </span>
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-500"
                    placeholder="admin@betterp.net"
                    required
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm text-zinc-400">
                    Contrasena
                  </span>
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-500"
                    placeholder="Tu contrasena de plataforma"
                    required
                  />
                </label>

                {errorMessage ? (
                  <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                    {errorMessage}
                  </div>
                ) : null}

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full rounded-2xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSubmitting ? "Entrando..." : "Iniciar sesion en backoffice"}
                </button>
              </form>
            ) : (
              <div className="mt-8">
                <TwoFactorStep
                  challenge={twoFactorChallenge}
                  codigo={codigo}
                  submitting={isSubmitting}
                  errorMessage={errorMessage}
                  onCodigoChange={setCodigo}
                  onSubmit={handleTwoFactorSubmit}
                  onResend={handleTwoFactorResend}
                  title="Verifica el acceso del backoffice"
                  description="La cuenta administradora de plataforma solicita un segundo paso para abrir el backoffice."
                />
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
