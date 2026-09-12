"use client";

import { type FormEvent } from "react";

import type { TwoFactorChallenge } from "./AuthProvider";

interface TwoFactorStepProps {
  challenge: TwoFactorChallenge;
  codigo: string;
  submitting: boolean;
  errorMessage: string;
  onCodigoChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onResend: () => void;
  title?: string;
  description?: string;
}

export default function TwoFactorStep({
  challenge,
  codigo,
  submitting,
  errorMessage,
  onCodigoChange,
  onSubmit,
  onResend,
  title = "Verifica tu acceso",
  description = "La capa activa solicita un segundo paso de seguridad. Captura el codigo recibido por correo para terminar de entrar.",
}: TwoFactorStepProps) {
  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-4 text-sm text-cyan-100">
        <p className="font-medium text-white">{title}</p>
        <p className="mt-2 leading-6 text-cyan-100/90">{description}</p>
        <p className="mt-3 text-xs uppercase tracking-[0.18em] text-cyan-200/80">
          Codigo enviado a {challenge.masked_email}
        </p>
      </div>

      <form className="space-y-4" onSubmit={onSubmit}>
        <label className="block">
          <span className="mb-2 block text-sm text-zinc-400">Codigo de verificacion</span>
          <input
            value={codigo}
            onChange={(event) =>
              onCodigoChange(event.target.value.replace(/\D/g, "").slice(0, 6))
            }
            inputMode="numeric"
            autoComplete="one-time-code"
            className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-center text-lg tracking-[0.4em] text-white outline-none transition focus:border-cyan-500"
            placeholder="123456"
            required
          />
        </label>

        {challenge.detail ? (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 px-4 py-3 text-sm text-zinc-400">
            {challenge.detail}
          </div>
        ) : null}

        {errorMessage ? (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {errorMessage}
          </div>
        ) : null}

        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            type="submit"
            disabled={submitting}
            className="flex-1 rounded-2xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Verificando..." : "Validar y entrar"}
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={onResend}
            className="rounded-2xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm font-medium text-zinc-200 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Reenviar codigo
          </button>
        </div>
      </form>
    </div>
  );
}
