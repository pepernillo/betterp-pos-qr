"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/components/auth/AuthProvider";
import { buildApiUrl } from "@/lib/api";

interface PasswordRecoveryDetail {
  email: string;
  estatus: string;
  esta_vigente: boolean;
  expira_en: string;
}

interface ResetPasswordClientProps {
  token: string;
}

export default function ResetPasswordClient({
  token,
}: ResetPasswordClientProps) {
  const router = useRouter();
  const { confirmPasswordRecovery } = useAuth();
  const [detail, setDetail] = useState<PasswordRecoveryDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [form, setForm] = useState({
    password: "",
    password_confirm: "",
  });

  useEffect(() => {
    let cancelled = false;

    const loadDetail = async () => {
      try {
        const response = await fetch(
          buildApiUrl(`/accounts/auth/password-recovery/${token}/`),
          { cache: "no-store" }
        );
        const body = (await response.json().catch(() => ({}))) as PasswordRecoveryDetail & {
          detail?: string;
        };
        if (!response.ok) {
          throw new Error(body.detail || "No pudimos validar el enlace.");
        }
        if (!cancelled) {
          setDetail(body);
        }
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(
            error instanceof Error ? error.message : "No se pudo cargar el enlace."
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
    setSubmitting(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      const message = await confirmPasswordRecovery(token, form);
      setSuccessMessage(message);
      window.setTimeout(() => {
        router.replace("/login");
      }, 1200);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "No se pudo actualizar la contrasena."
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
            Restablecer acceso
          </span>
          <h1 className="mt-4 text-3xl font-semibold text-white">
            Define una nueva contrasena
          </h1>
          <p className="mt-3 text-sm leading-7 text-zinc-400">
            Este enlace esta ligado al correo de acceso invitado o principal del
            usuario. Una vez actualizado, el inicio de sesion seguira usando ese
            mismo correo.
          </p>

          {loading ? (
            <div className="mt-8 rounded-2xl border border-zinc-800 bg-zinc-900/60 px-4 py-4 text-sm text-zinc-400">
              Validando enlace...
            </div>
          ) : detail ? (
            <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
              <div className="rounded-2xl border border-white/6 bg-zinc-900/60 px-4 py-4">
                <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">
                  Correo de acceso
                </p>
                <p className="mt-2 text-sm font-medium text-white">{detail.email}</p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-2 block text-sm text-zinc-400">Nueva contrasena</span>
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
                    placeholder="Nueva contrasena"
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
                    placeholder="Repite la contrasena"
                    required
                  />
                </label>
              </div>

              {successMessage ? (
                <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
                  {successMessage}
                </div>
              ) : null}

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
                {submitting ? "Actualizando..." : "Guardar nueva contrasena"}
              </button>
            </form>
          ) : (
            <div className="mt-8 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-4 text-sm text-rose-200">
              {errorMessage || "El enlace ya no esta disponible."}
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
