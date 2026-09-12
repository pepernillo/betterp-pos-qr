"use client";

import { FormEvent, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import {
  buildApiUrl,
  readStoredAccessToken,
  readStoredSelectedCapaId,
} from "@/lib/api";

const EMPTY_FORM = {
  current_password: "",
  password: "",
  password_confirm: "",
};

export default function AccountSettingsManager() {
  const { user, currentMembership, changePassword, requestPasswordRecovery } =
    useAuth();
  const [form, setForm] = useState(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const [isSendingRecovery, setIsSendingRecovery] = useState(false);
  const [isExportingBackup, setIsExportingBackup] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [recoveryMessage, setRecoveryMessage] = useState("");
  const [backupMessage, setBackupMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const handlePasswordSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSaving(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const message = await changePassword(form);
      setSuccessMessage(message);
      setForm(EMPTY_FORM);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "No se pudo actualizar la contrasena."
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleRecoveryRequest = async () => {
    if (!user?.email) {
      setErrorMessage("Tu cuenta no tiene un correo disponible para recuperacion.");
      return;
    }

    setIsSendingRecovery(true);
    setErrorMessage("");
    setRecoveryMessage("");

    try {
      const message = await requestPasswordRecovery(user.email);
      setRecoveryMessage(
        `${message} Cuando completes el cambio desde ese enlace, por seguridad tendras que iniciar sesion nuevamente.`
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "No se pudo enviar el correo de recuperacion."
      );
    } finally {
      setIsSendingRecovery(false);
    }
  };

  const handleBackupExport = async () => {
    const token = readStoredAccessToken();
    if (!token) {
      setErrorMessage("Tu sesion ya no esta disponible. Vuelve a iniciar sesion.");
      return;
    }

    setIsExportingBackup(true);
    setBackupMessage("");
    setErrorMessage("");

    try {
      const selectedCapaId = readStoredSelectedCapaId();
      const response = await fetch(buildApiUrl("/empresas/capas/backup/exportar/"), {
        headers: {
          Authorization: `Bearer ${token}`,
          ...(selectedCapaId
            ? { "X-BettERP-Capa-ID": String(selectedCapaId) }
            : {}),
        },
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          detail?: string;
        };
        throw new Error(body.detail || "No se pudo generar el respaldo.");
      }

      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename="?([^"]+)"?/i);
      const filename = match?.[1] || "backup-betterp.xlsx";
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      setBackupMessage("Respaldo operativo generado correctamente.");
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "No se pudo generar el respaldo."
      );
    } finally {
      setIsExportingBackup(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <section className="rounded-3xl border border-zinc-800 bg-gradient-to-br from-zinc-950 via-zinc-950 to-zinc-900 p-6 shadow-xl">
        <div className="max-w-3xl space-y-3">
          <h1 className="text-3xl font-bold text-white">
            Configuracion de cuenta
          </h1>
          <p className="text-sm text-zinc-400">
            Administra la seguridad de tu acceso personal. Desde aqui puedes
            cambiar tu contrasena actual o pedir un enlace de recuperacion por
            correo si ya no la recuerdas.
          </p>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <article className="rounded-3xl border border-zinc-800 bg-zinc-950/70 p-5">
          <div className="border-b border-zinc-800 pb-4">
            <h2 className="text-xl font-semibold text-white">
              Cambio directo de contrasena
            </h2>
            <p className="mt-1 text-sm text-zinc-500">
              Si recuerdas tu contrasena actual, este es el camino mas rapido.
              Mantendremos esta sesion abierta y cerraremos las demas sesiones
              activas para reforzar seguridad.
            </p>
          </div>

          <form className="mt-5 space-y-4" onSubmit={handlePasswordSubmit}>
            <label className="block">
              <span className="mb-2 block text-sm text-zinc-400">
                Contrasena actual
              </span>
              <input
                type="password"
                value={form.current_password}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    current_password: event.target.value,
                  }))
                }
                className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-500"
                placeholder="Tu contrasena actual"
                required
              />
            </label>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-sm text-zinc-400">
                  Nueva contrasena
                </span>
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
                  Confirmar nueva contrasena
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
                  placeholder="Repite la nueva contrasena"
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
              disabled={isSaving}
              className="w-full rounded-2xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSaving ? "Actualizando..." : "Actualizar contrasena"}
            </button>
          </form>
        </article>

        <aside className="space-y-6">
          <article className="rounded-3xl border border-zinc-800 bg-zinc-950/70 p-5">
            <h2 className="text-xl font-semibold text-white">
              Recuperacion por correo
            </h2>
            <p className="mt-1 text-sm text-zinc-500">
              Si no recuerdas la contrasena actual, enviaremos un enlace seguro
              al correo de acceso. Ese flujo si te pedira volver a iniciar
              sesion una vez terminado.
            </p>

            <div className="mt-5 rounded-2xl border border-white/6 bg-zinc-900/60 px-4 py-4">
              <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">
                Correo de acceso
              </p>
              <p className="mt-2 text-sm font-medium text-white">
                {user?.email ?? "Sin correo configurado"}
              </p>
            </div>

            {recoveryMessage ? (
              <div className="mt-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
                {recoveryMessage}
              </div>
            ) : null}

            <button
              type="button"
              onClick={handleRecoveryRequest}
              disabled={isSendingRecovery || !user?.email}
              className="mt-4 w-full rounded-2xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm font-medium text-zinc-100 transition hover:border-zinc-600 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSendingRecovery
                ? "Enviando enlace..."
                : "Enviar enlace de recuperacion"}
            </button>
          </article>

          <article className="rounded-3xl border border-zinc-800 bg-zinc-950/70 p-5">
            <h2 className="text-lg font-semibold text-white">
              Estado actual de la cuenta
            </h2>
            <div className="mt-4 space-y-3 text-sm text-zinc-300">
              <div className="rounded-2xl border border-white/6 bg-zinc-900/60 px-4 py-3">
                <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">
                  Usuario
                </p>
                <p className="mt-1 font-medium text-white">
                  {user?.nombre ?? "Usuario"}
                </p>
              </div>

              <div className="rounded-2xl border border-white/6 bg-zinc-900/60 px-4 py-3">
                <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">
                  Capa activa
                </p>
                <p className="mt-1 font-medium text-white">
                  {currentMembership?.capa_negocio.nombre ?? "Sin capa activa"}
                </p>
              </div>

              <div className="rounded-2xl border border-white/6 bg-zinc-900/60 px-4 py-3">
                <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">
                  Recomendacion
                </p>
                <p className="mt-1 leading-6 text-zinc-300">
                  Para cambios normales conserva la sesion actual. Para
                  recuperacion por correo, lo correcto es pedir login de nuevo
                  despues del cambio para invalidar cualquier acceso previo.
                </p>
              </div>
            </div>
          </article>

          <article className="rounded-3xl border border-cyan-500/20 bg-cyan-500/10 p-5">
            <h2 className="text-lg font-semibold text-white">
              Respaldo operativo
            </h2>
            <p className="mt-1 text-sm leading-6 text-cyan-50/80">
              Descarga un archivo Excel con entidades, clientes, espacios,
              cartera, comprobantes y conciliacion de la capa activa.
            </p>

            {backupMessage ? (
              <div className="mt-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
                {backupMessage}
              </div>
            ) : null}

            <button
              type="button"
              onClick={handleBackupExport}
              disabled={
                isExportingBackup || currentMembership?.rol !== "OWNER_ADMIN"
              }
              className="mt-4 w-full rounded-2xl border border-cyan-400/30 bg-cyan-400/15 px-4 py-3 text-sm font-semibold text-cyan-50 transition hover:bg-cyan-400/25 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isExportingBackup ? "Generando respaldo..." : "Descargar respaldo"}
            </button>
          </article>
        </aside>
      </section>
    </div>
  );
}
