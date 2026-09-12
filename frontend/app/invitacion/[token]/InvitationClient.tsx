"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

import {
  type TwoFactorChallenge,
  useAuth,
} from "@/components/auth/AuthProvider";
import TwoFactorStep from "@/components/auth/TwoFactorStep";
import { buildApiUrl } from "@/lib/api";

interface InvitationDetail {
  email: string;
  nombre_sugerido?: string | null;
  rol: string;
  estatus: string;
  esta_vigente: boolean;
  usuario_existente: boolean;
  expira_en: string;
  capa_negocio: {
    id: number;
    nombre: string;
    tipo_capa: string;
  };
}

interface InvitationClientProps {
  token: string;
}

export default function InvitationClient({ token }: InvitationClientProps) {
  const { acceptInvitation, resendTwoFactor, verifyTwoFactor } = useAuth();
  const [detail, setDetail] = useState<InvitationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [twoFactorChallenge, setTwoFactorChallenge] =
    useState<TwoFactorChallenge | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [form, setForm] = useState({
    nombre: "",
    password: "",
    password_confirm: "",
  });

  useEffect(() => {
    let cancelled = false;

    const loadDetail = async () => {
      try {
        if (!token) {
          throw new Error("La invitacion no incluye un token valido.");
        }
        const response = await fetch(
          buildApiUrl(`/accounts/auth/invitaciones/${token}/`),
          { cache: "no-store" }
        );
        const body = (await response.json().catch(() => ({}))) as InvitationDetail & {
          detail?: string;
        };
        if (!response.ok) {
          throw new Error(body.detail || "No pudimos validar la invitacion.");
        }
        if (!cancelled) {
          setDetail(body);
          setForm((current) => ({
            ...current,
            nombre: body.nombre_sugerido ?? current.nombre,
          }));
        }
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(
            error instanceof Error
              ? error.message
              : "No pudimos cargar la invitacion."
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadDetail();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token) {
      return;
    }
    setSubmitting(true);
    setErrorMessage("");
    try {
      const result = await acceptInvitation(token, form);
      if (result.requiresTwoFactor && result.challenge) {
        setTwoFactorChallenge(result.challenge);
        setTwoFactorCode("");
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "No se pudo aceptar la invitacion."
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleTwoFactorSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!twoFactorChallenge) {
      return;
    }
    setSubmitting(true);
    setErrorMessage("");
    try {
      await verifyTwoFactor({
        challengeToken: twoFactorChallenge.challenge_token,
        codigo: twoFactorCode,
      });
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "No se pudo verificar el segundo paso."
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleTwoFactorResend = async () => {
    if (!twoFactorChallenge) {
      return;
    }
    setSubmitting(true);
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
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#12324b_0%,#09090b_40%,#020617_100%)] px-4 py-10 text-white">
      <div className="mx-auto max-w-3xl">
        <div className="rounded-[32px] border border-white/10 bg-zinc-950/85 p-6 shadow-2xl backdrop-blur-xl sm:p-8">
          <span className="inline-flex rounded-full border border-cyan-500/25 bg-cyan-500/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-cyan-200">
            Invitacion BettERP
          </span>
          <h1 className="mt-4 text-3xl font-semibold text-white">
            Activa tu acceso a la capa de negocio
          </h1>
          <p className="mt-3 text-sm leading-7 text-zinc-400">
            El correo invitado es tambien tu correo de acceso. Si es tu primera
            vez, defines la contrasena aqui; si ya tenias cuenta, conservas tu
            contrasena actual y solo confirmas el acceso.
          </p>

          {loading ? (
            <div className="mt-8 rounded-2xl border border-zinc-800 bg-zinc-900/60 px-4 py-4 text-sm text-zinc-400">
              Validando invitacion...
            </div>
          ) : detail ? (
            <>
              <div className="mt-8 grid gap-4 sm:grid-cols-3">
                <div className="rounded-2xl border border-white/6 bg-zinc-900/60 px-4 py-4">
                  <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">Capa</p>
                  <p className="mt-2 text-sm font-medium text-white">
                    {detail.capa_negocio.nombre}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/6 bg-zinc-900/60 px-4 py-4">
                  <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">Rol</p>
                  <p className="mt-2 text-sm font-medium text-white">
                    {detail.rol.replace("_", " ")}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/6 bg-zinc-900/60 px-4 py-4">
                  <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">Correo</p>
                  <p className="mt-2 text-sm font-medium text-white">{detail.email}</p>
                </div>
              </div>

              {!twoFactorChallenge ? (
              <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
                <label className="block">
                  <span className="mb-2 block text-sm text-zinc-400">Nombre para mostrar</span>
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

                {detail.usuario_existente ? (
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 px-4 py-4 text-sm text-zinc-300">
                    <p className="font-medium text-white">
                      Ya existe una cuenta con este correo
                    </p>
                    <p className="mt-2 leading-6 text-zinc-400">
                      Conservaremos la contrasena actual de <strong>{detail.email}</strong>.
                      Si no la recuerdas, puedes recuperarla despues desde login.
                    </p>
                  </div>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block">
                      <span className="mb-2 block text-sm text-zinc-400">Contrasena</span>
                      <input
                        type="password"
                        value={form.password}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            password: event.target.value,
                          }))
                        }
                        className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-500"
                        placeholder="Define tu contrasena"
                        required
                      />
                    </label>

                    <label className="block">
                      <span className="mb-2 block text-sm text-zinc-400">
                        Confirmar contrasena
                      </span>
                      <input
                        type="password"
                        value={form.password_confirm}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            password_confirm: event.target.value,
                          }))
                        }
                        className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-500"
                        placeholder="Repite tu contrasena"
                        required
                      />
                    </label>
                  </div>
                )}

                {errorMessage ? (
                  <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                    {errorMessage}
                  </div>
                ) : null}

                <button
                  type="submit"
                  disabled={submitting || !detail.esta_vigente}
                  className="w-full rounded-2xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting
                    ? "Activando..."
                    : detail.usuario_existente
                      ? "Aceptar invitacion y entrar"
                      : "Crear acceso y entrar"}
                </button>
              </form>
              ) : (
                <div className="mt-8">
                  <TwoFactorStep
                    challenge={twoFactorChallenge}
                    codigo={twoFactorCode}
                    submitting={submitting}
                    errorMessage={errorMessage}
                    onCodigoChange={setTwoFactorCode}
                    onSubmit={handleTwoFactorSubmit}
                    onResend={handleTwoFactorResend}
                    title="Valida tu acceso invitado"
                    description="La capa de negocio requiere un segundo paso. Captura el codigo enviado al correo invitado para terminar de activar tu acceso."
                  />
                </div>
              )}
            </>
          ) : (
            <div className="mt-8 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-4 text-sm text-rose-200">
              {errorMessage || "La invitacion ya no esta disponible."}
            </div>
          )}

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
