"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";

export default function RecoverAccessPage() {
  const { requestPasswordRecovery } = useAuth();
  const [email, setEmail] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setErrorMessage("");
    setMensaje("");
    try {
      const responseMessage = await requestPasswordRecovery(email);
      setMensaje(responseMessage);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "No se pudo solicitar la recuperacion."
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#12324b_0%,#09090b_40%,#020617_100%)] px-4 py-10 text-white">
      <div className="mx-auto max-w-2xl">
        <div className="rounded-[32px] border border-white/10 bg-zinc-950/85 p-6 shadow-2xl backdrop-blur-xl sm:p-8">
          <span className="inline-flex rounded-full border border-cyan-500/25 bg-cyan-500/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-cyan-200">
            Recuperacion de acceso
          </span>
          <h1 className="mt-4 text-3xl font-semibold text-white">
            Restablece tu contrasena
          </h1>
          <p className="mt-3 text-sm leading-7 text-zinc-400">
            Captura el correo de acceso con el que entras a BetterP. Si existe una
            cuenta activa, enviaremos un enlace seguro para definir una nueva
            contrasena.
          </p>

          <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
            <label className="block">
              <span className="mb-2 block text-sm text-zinc-400">Correo de acceso</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-500"
                placeholder="tuacceso@empresa.com"
                required
              />
            </label>

            {mensaje ? (
              <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
                {mensaje}
              </div>
            ) : null}

            {errorMessage ? (
              <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                {errorMessage}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-2xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "Enviando..." : "Enviar enlace de recuperacion"}
            </button>
          </form>

          <div className="mt-8">
            <Link href="/login" className="text-sm text-cyan-300 hover:text-cyan-200">
              Volver a login
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
