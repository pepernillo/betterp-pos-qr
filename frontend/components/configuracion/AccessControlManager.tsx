"use client";

import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { buildApiUrl } from "@/lib/api";
import {
  ConfigFieldLabel,
  ConfigInfoButton,
  ConfigInfoModal,
  type ConfigInfoContent,
} from "./ConfigInfo";

interface TeamPayload {
  capa_negocio: {
    id: number;
    nombre: string;
  };
  memberships: MembershipSummary[];
  invitations: Array<{
    id: number;
    email: string;
    nombre_sugerido?: string | null;
    rol: "OWNER_ADMIN" | "OPERADOR" | "CONSULTA";
    estatus: string;
    expira_en: string;
    accept_url: string;
  }>;
  permissions?: {
    current_role?: "OWNER_ADMIN" | "OPERADOR" | "CONSULTA" | null;
    matrix: RolePermission[];
  };
}

interface MembershipSummary {
  id: number;
  rol: "OWNER_ADMIN" | "OPERADOR" | "CONSULTA";
  activo: boolean;
  es_fundador?: boolean;
  user: {
    id: number;
    nombre: string;
    email: string;
    initials: string;
  };
}

interface RolePermission {
  rol: "OWNER_ADMIN" | "OPERADOR" | "CONSULTA";
  label: string;
  summary: string;
  capabilities: Record<string, boolean>;
}

const ROLE_OPTIONS = [
  { value: "OWNER_ADMIN", label: "Owner admin" },
  { value: "OPERADOR", label: "Operador" },
  { value: "CONSULTA", label: "Consulta" },
];

const CAPABILITY_LABELS: Record<string, string> = {
  leer: "Lectura",
  operar: "Operacion",
  administrar: "Administracion",
  auditoria: "Auditoria",
  backups: "Backups",
};

const accessInfo = {
  modulo: {
    eyebrow: "Seguridad",
    title: "Seguridad y accesos",
    summary:
      "Administra quienes pueden entrar a la capa activa y que nivel de operacion tienen dentro del negocio.",
    details: [
      "Owner admin puede administrar configuracion, usuarios y operaciones sensibles.",
      "Operador trabaja la operacion diaria. Consulta solo revisa informacion sin modificarla.",
      "Las invitaciones son por correo y quedan ligadas a la capa actual, no a otras cuentas.",
    ],
  },
  email: {
    eyebrow: "Invitacion",
    title: "Correo del usuario",
    summary:
      "Direccion a la que se enviara el enlace para activar el acceso a la capa.",
    details: [
      "Debe tener formato de correo valido y maximo 120 caracteres.",
      "Si ya existe una invitacion pendiente, el sistema permite reemplazarla para que solo quede un enlace vigente.",
    ],
  },
  nombre: {
    eyebrow: "Invitacion",
    title: "Nombre sugerido",
    summary:
      "Nombre visible propuesto para reconocer al usuario cuando acepte la invitacion.",
    details: [
      "Es opcional y admite hasta 120 caracteres.",
      "Evita telefonos, correos o notas internas en este campo; para eso ya existe auditoria y roles.",
    ],
  },
  rol: {
    eyebrow: "Permisos",
    title: "Rol de acceso",
    summary:
      "Define el nivel de permisos inicial del usuario dentro de esta capa.",
    details: [
      "Usa Consulta para perfiles que solo revisan informacion.",
      "Usa Operador para quien captura clientes, finanzas o cambios operativos.",
      "Reserva Owner admin para personas que deban administrar usuarios y configuracion.",
    ],
  },
};

function sanitizeAccessText(value: string, maxLength = 120) {
  return value.replace(/[<>]/g, "").slice(0, maxLength);
}

function isValidAccessEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export default function AccessControlManager() {
  const { isOwnerAdmin } = useAuth();
  const [data, setData] = useState<TeamPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [inviteForm, setInviteForm] = useState({
    email: "",
    nombre_sugerido: "",
    rol: "CONSULTA",
  });
  const [infoModal, setInfoModal] = useState<ConfigInfoContent | null>(null);
  const [membershipPendingDelete, setMembershipPendingDelete] =
    useState<MembershipSummary | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const response = await fetch(buildApiUrl("/accounts/miembros/"), {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error("No se pudieron cargar los accesos de la capa.");
      }
      const body = (await response.json()) as TeamPayload;
      setData(body);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "No se pudo cargar el equipo de trabajo."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const handleInvite = async (replaceExisting = false) => {
    const email = inviteForm.email.trim().toLowerCase();
    const nombre = inviteForm.nombre_sugerido.trim();
    if (!isValidAccessEmail(email)) {
      setMessage("Captura un correo valido para enviar la invitacion.");
      return;
    }
    if (email.length > 120) {
      setMessage("El correo no debe superar 120 caracteres.");
      return;
    }
    if (nombre.length > 120) {
      setMessage("El nombre sugerido no debe superar 120 caracteres.");
      return;
    }

    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(buildApiUrl("/accounts/miembros/invitar/"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...inviteForm,
          email,
          nombre_sugerido: nombre,
          replace_existing: replaceExisting,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        mensaje?: string;
        detail?: string;
        code?: string;
      };

      if (
        !response.ok &&
        response.status === 409 &&
        body.code === "INVITATION_ALREADY_PENDING"
      ) {
        const confirmed = window.confirm(
          "Ya existe una invitacion pendiente para este correo. Si continuas, se reemplazara la anterior y solo quedara la mas reciente. ¿Deseas continuar?"
        );
        if (confirmed) {
          await handleInvite(true);
        }
        return;
      }

      if (!response.ok) {
        throw new Error(body.detail || "No se pudo crear la invitacion.");
      }

      setInviteForm({ email: "", nombre_sugerido: "", rol: "CONSULTA" });
      setMessage(body.mensaje || "Invitacion creada correctamente.");
      await loadData();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "No se pudo invitar al usuario."
      );
    } finally {
      setSaving(false);
    }
  };

  const updateRole = async (membershipId: number, role: string) => {
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(
        buildApiUrl(`/accounts/miembros/${membershipId}/rol/`),
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rol: role }),
        }
      );
      const body = (await response.json().catch(() => ({}))) as {
        mensaje?: string;
        detail?: string;
      };
      if (!response.ok) {
        throw new Error(body.detail || "No se pudo actualizar el rol.");
      }
      setMessage(body.mensaje || "Rol actualizado.");
      await loadData();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "No se pudo actualizar el rol."
      );
    } finally {
      setSaving(false);
    }
  };

  const deleteMembership = async (membershipId: number) => {
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(
        buildApiUrl(`/accounts/miembros/${membershipId}/eliminar/`),
        {
          method: "DELETE",
        }
      );
      const body = (await response.json().catch(() => ({}))) as {
        mensaje?: string;
        detail?: string;
      };
      if (!response.ok) {
        throw new Error(body.detail || "No se pudo eliminar el acceso.");
      }
      setMembershipPendingDelete(null);
      setMessage(body.mensaje || "Usuario eliminado de esta capa.");
      await loadData();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "No se pudo eliminar el acceso."
      );
    } finally {
      setSaving(false);
    }
  };

  const revokeInvitation = async (invitationId: number) => {
    const confirmed = window.confirm(
      "¿Deseas revocar esta invitacion? El enlace dejara de funcionar."
    );
    if (!confirmed) {
      return;
    }

    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(
        buildApiUrl(`/accounts/invitaciones/${invitationId}/`),
        { method: "DELETE" }
      );
      const body = (await response.json().catch(() => ({}))) as {
        mensaje?: string;
        detail?: string;
      };
      if (!response.ok) {
        throw new Error(body.detail || "No se pudo revocar la invitacion.");
      }
      setMessage(body.mensaje || "Invitacion revocada.");
      await loadData();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "No se pudo revocar la invitacion."
      );
    } finally {
      setSaving(false);
    }
  };

  const deleteInvitation = async (invitationId: number) => {
    const confirmed = window.confirm(
      "¿Deseas eliminar esta invitacion definitivamente? Esta accion no se puede deshacer."
    );
    if (!confirmed) {
      return;
    }

    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(
        buildApiUrl(`/accounts/invitaciones/${invitationId}/eliminar/`),
        { method: "DELETE" }
      );
      const body = (await response.json().catch(() => ({}))) as {
        mensaje?: string;
        detail?: string;
      };
      if (!response.ok) {
        throw new Error(body.detail || "No se pudo eliminar la invitacion.");
      }
      setMessage(body.mensaje || "Invitacion eliminada.");
      await loadData();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "No se pudo eliminar la invitacion."
      );
    } finally {
      setSaving(false);
    }
  };

  const copyInvitationLink = async (acceptUrl: string) => {
    try {
      await navigator.clipboard.writeText(acceptUrl);
      setMessage("Enlace de invitacion copiado.");
    } catch {
      setMessage("No se pudo copiar el enlace de invitacion.");
    }
  };

  return (
    <>
      <ConfigInfoModal info={infoModal} onClose={() => setInfoModal(null)} />
      {membershipPendingDelete ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-[28px] border border-zinc-800 bg-zinc-950 shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
            <div className="border-b border-zinc-800 px-6 py-5">
              <p className="text-xs uppercase tracking-[0.24em] text-rose-300/80">
                Confirmacion
              </p>
              <h3 className="mt-2 text-xl font-semibold text-white">
                Eliminar acceso de la capa
              </h3>
            </div>
            <div className="space-y-4 px-6 py-5">
              <p className="text-sm leading-6 text-zinc-400">
                Vas a quitar a{" "}
                <span className="font-semibold text-white">
                  {membershipPendingDelete.user.nombre}
                </span>{" "}
                de la capa actual. Si despues necesitas volver a darle acceso,
                tendras que invitarlo otra vez.
              </p>
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 px-4 py-4">
                <p className="text-sm font-medium text-white">
                  {membershipPendingDelete.user.email}
                </p>
                <p className="mt-1 text-sm text-zinc-500">
                  Rol actual:{" "}
                  {ROLE_OPTIONS.find(
                    (option) => option.value === membershipPendingDelete.rol
                  )?.label ?? membershipPendingDelete.rol}
                </p>
              </div>
              <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                Esta accion elimina la vinculacion de esta capa. Si el usuario es
                owner admin, el sistema validara que quede al menos otro owner
                admin activo.
              </div>
            </div>
            <div className="flex flex-col-reverse gap-3 border-t border-zinc-800 px-6 py-5 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setMembershipPendingDelete(null)}
                disabled={saving}
                className="rounded-2xl border border-zinc-700 px-4 py-3 text-sm font-medium text-zinc-300 transition hover:border-zinc-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() =>
                  void deleteMembership(membershipPendingDelete.id)
                }
                disabled={saving}
                className="rounded-2xl border border-rose-500/30 bg-rose-500/15 px-4 py-3 text-sm font-semibold text-rose-100 transition hover:border-rose-400/50 hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? "Eliminando..." : "Si, eliminar acceso"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <section className="rounded-3xl border border-zinc-800 bg-zinc-950/70 p-5">
      <div className="flex flex-col gap-3 border-b border-zinc-800 pb-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-white">Seguridad y accesos</h2>
            <ConfigInfoButton info={accessInfo.modulo} onOpen={setInfoModal} />
          </div>
          <p className="mt-1 text-sm text-zinc-500">
            Invita usuarios, controla roles por capa y audita quien puede editar o solo consultar.
          </p>
        </div>
        <span className="text-xs uppercase tracking-[0.22em] text-zinc-500">
          {data?.capa_negocio.nombre ?? "Capa activa"}
        </span>
      </div>

      {!isOwnerAdmin ? (
        <div className="mt-5 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          Solo un usuario owner admin puede administrar accesos y membresias.
        </div>
      ) : null}

      {message ? (
        <div className="mt-5 rounded-2xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100">
          {message}
        </div>
      ) : null}

      <div className="mt-5 grid gap-5 xl:grid-cols-[0.92fr_1.08fr]">
        <div className="space-y-5">
          <div className="rounded-3xl border border-zinc-800 bg-zinc-900/40 p-4">
            <h3 className="text-lg font-semibold text-white">Invitar nuevo usuario</h3>
            <p className="mt-1 text-sm text-zinc-500">
              El enlace activa el acceso solo dentro de la capa actual.
            </p>

            <div className="mt-4 space-y-3">
              <ConfigFieldLabel required info={accessInfo.email} onInfo={setInfoModal}>
                Correo del usuario
              </ConfigFieldLabel>
              <input
                value={inviteForm.email}
                onChange={(event) =>
                  setInviteForm((current) => ({
                    ...current,
                    email: sanitizeAccessText(event.target.value.toLowerCase(), 120),
                  }))
                }
                type="email"
                maxLength={120}
                disabled={!isOwnerAdmin || saving}
                className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-500 disabled:opacity-60"
                placeholder="correo@equipo.com"
              />
              <ConfigFieldLabel optional info={accessInfo.nombre} onInfo={setInfoModal}>
                Nombre sugerido
              </ConfigFieldLabel>
              <input
                value={inviteForm.nombre_sugerido}
                onChange={(event) =>
                  setInviteForm((current) => ({
                    ...current,
                    nombre_sugerido: sanitizeAccessText(event.target.value, 120),
                  }))
                }
                maxLength={120}
                disabled={!isOwnerAdmin || saving}
                className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-500 disabled:opacity-60"
                placeholder="Nombre sugerido"
              />
              <ConfigFieldLabel required info={accessInfo.rol} onInfo={setInfoModal}>
                Rol inicial
              </ConfigFieldLabel>
              <select
                value={inviteForm.rol}
                onChange={(event) =>
                  setInviteForm((current) => ({ ...current, rol: event.target.value }))
                }
                disabled={!isOwnerAdmin || saving}
                className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-500 disabled:opacity-60"
              >
                {ROLE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => void handleInvite()}
                disabled={!isOwnerAdmin || saving}
                className="w-full rounded-2xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? "Guardando..." : "Enviar invitacion"}
              </button>
            </div>
          </div>

          <div className="rounded-3xl border border-zinc-800 bg-zinc-900/40 p-4">
            <h3 className="text-lg font-semibold text-white">Matriz de permisos</h3>
            <p className="mt-1 text-sm text-zinc-500">
              Referencia rapida de lo que puede hacer cada rol en la capa activa.
            </p>
            <div className="mt-4 space-y-3">
              {(data?.permissions?.matrix ?? []).map((permission) => (
                <div
                  key={permission.rol}
                  className={`rounded-2xl border px-4 py-4 ${
                    permission.rol === data?.permissions?.current_role
                      ? "border-cyan-500/30 bg-cyan-500/10"
                      : "border-zinc-800 bg-zinc-950/70"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold text-white">{permission.label}</p>
                    {permission.rol === data?.permissions?.current_role ? (
                      <span className="rounded-full border border-cyan-500/25 bg-cyan-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-100">
                        Tu rol
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-2 text-sm leading-6 text-zinc-500">
                    {permission.summary}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {Object.entries(permission.capabilities).map(([key, enabled]) => (
                      <span
                        key={key}
                        className={`rounded-full border px-3 py-1 text-xs font-medium ${
                          enabled
                            ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-100"
                            : "border-zinc-800 bg-zinc-950 text-zinc-500"
                        }`}
                      >
                        {CAPABILITY_LABELS[key] ?? key}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-5">
          <div className="rounded-3xl border border-zinc-800 bg-zinc-900/40 p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-lg font-semibold text-white">Miembros activos</h3>
              <button
                type="button"
                onClick={() => void loadData()}
                className="rounded-2xl border border-zinc-700 px-3 py-2 text-xs text-zinc-300 transition hover:border-zinc-600 hover:text-white"
              >
                Refrescar
              </button>
            </div>

            <div className="mt-4 space-y-3">
              {loading ? (
                <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 px-4 py-4 text-sm text-zinc-500">
                  Cargando usuarios...
                </div>
              ) : data?.memberships.length ? (
                data.memberships.map((membership) => (
                  <div
                    key={membership.id}
                    className="flex flex-col gap-3 rounded-2xl border border-zinc-800 bg-zinc-950/70 px-4 py-4 lg:flex-row lg:items-center lg:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-white">{membership.user.nombre}</p>
                        {membership.es_fundador ? (
                          <span className="rounded-full border border-cyan-500/25 bg-cyan-500/10 px-2 py-1 text-[10px] font-medium uppercase tracking-[0.18em] text-cyan-200">
                            Fundador
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-sm text-zinc-500">{membership.user.email}</p>
                      {membership.es_fundador ? (
                        <p className="mt-1 text-xs text-zinc-500">
                          Este owner admin aperturo la cuenta y conserva acceso base protegido.
                        </p>
                      ) : null}
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <select
                        value={membership.rol}
                        onChange={(event) =>
                          void updateRole(membership.id, event.target.value)
                        }
                        disabled={!isOwnerAdmin || saving || membership.es_fundador}
                        className="rounded-2xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-500 disabled:opacity-60"
                      >
                        {ROLE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => setMembershipPendingDelete(membership)}
                        disabled={!isOwnerAdmin || saving || membership.es_fundador}
                        className="rounded-2xl border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-sm text-rose-200 transition hover:border-rose-400/40 disabled:opacity-60"
                      >
                        Eliminar
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 px-4 py-4 text-sm text-zinc-500">
                  Todavia no hay usuarios vinculados a esta capa.
                </div>
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-zinc-800 bg-zinc-900/40 p-4">
            <h3 className="text-lg font-semibold text-white">Invitaciones pendientes</h3>
            <div className="mt-4 space-y-3">
              {data?.invitations.length ? (
                data.invitations.map((invitation) => (
                  <div
                    key={invitation.id}
                    className="flex flex-col gap-3 rounded-2xl border border-zinc-800 bg-zinc-950/70 px-4 py-4 lg:flex-row lg:items-center lg:justify-between"
                  >
                    <div>
                      <p className="font-medium text-white">{invitation.email}</p>
                      <p className="mt-1 text-sm text-zinc-500">
                        {invitation.rol.replace("_", " ")} · pendiente
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void copyInvitationLink(invitation.accept_url)}
                        disabled={saving}
                        className="rounded-2xl border border-cyan-500/25 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-100 transition hover:border-cyan-400/40 disabled:opacity-60"
                      >
                        Copiar enlace
                      </button>
                      <button
                        type="button"
                        onClick={() => void revokeInvitation(invitation.id)}
                        disabled={!isOwnerAdmin || saving}
                        className="rounded-2xl border border-zinc-700 px-3 py-2 text-sm text-zinc-300 transition hover:border-zinc-600 hover:text-white disabled:opacity-60"
                      >
                        Revocar
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteInvitation(invitation.id)}
                        disabled={!isOwnerAdmin || saving}
                        className="rounded-2xl border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-sm text-rose-200 transition hover:border-rose-400/40 disabled:opacity-60"
                      >
                        Eliminar
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 px-4 py-4 text-sm text-zinc-500">
                  No hay invitaciones abiertas en este momento.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      </section>
    </>
  );
}
