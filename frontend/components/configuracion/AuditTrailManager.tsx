"use client";

import { useEffect, useMemo, useState } from "react";

import { buildApiUrl } from "@/lib/api";
import {
  ConfigFieldLabel,
  ConfigInfoButton,
  ConfigInfoModal,
  type ConfigInfoContent,
} from "./ConfigInfo";

interface AuditEvent {
  id: number;
  accion: string;
  recurso_tipo: string;
  recurso_id?: string | null;
  actor_email?: string | null;
  capa_negocio_nombre?: string | null;
  metadata?: Record<string, unknown>;
  fecha_creacion: string;
}

interface AuditSummaryCategory {
  key: string;
  label: string;
  acciones: string[];
  count: number;
  latest: AuditEvent[];
}

interface AuditSignalBucket {
  value: string;
  label: string;
  count: number;
}

interface AuditSecuritySignals {
  riesgo: "BAJO" | "MEDIO" | "ALTO" | string;
  foco_recomendado: string;
  permisos_denegados: number;
  plan_denegado: number;
  cambios_acceso: number;
  permisos_mas_denegados: AuditSignalBucket[];
  rutas_mas_denegadas: AuditSignalBucket[];
  funciones_plan_bloqueadas: AuditSignalBucket[];
  primera_denegacion_id?: number | null;
  ultimas_denegaciones: AuditEvent[];
}

interface AuditSummary {
  dias: number;
  limit: number;
  total_eventos_criticos: number;
  categorias: AuditSummaryCategory[];
  senales_seguridad?: AuditSecuritySignals;
}

const PAGE_SIZE = 25;

const ACTION_OPTIONS = [
  { value: "", label: "Todas las acciones" },
  { value: "CLIENTE_CREADO", label: "Cliente creado" },
  { value: "CLIENTE_ACTUALIZADO", label: "Cliente editado" },
  { value: "CLIENTE_ELIMINADO", label: "Cliente eliminado" },
  { value: "ENTIDAD_CREADA", label: "Entidad creada" },
  { value: "ENTIDAD_ACTUALIZADA", label: "Entidad editada" },
  { value: "ENTIDAD_ELIMINADA", label: "Entidad eliminada" },
  { value: "ESPACIO_CREADO", label: "Espacio creado" },
  { value: "ESPACIO_ACTUALIZADO", label: "Espacio editado" },
  { value: "ESPACIO_ELIMINADO", label: "Espacio eliminado" },
  { value: "ESPACIO_ASIGNADO", label: "Espacio asignado" },
  { value: "ESPACIO_ASIGNACION_FINALIZADA", label: "Asignacion finalizada" },
  { value: "CXC_ESTATUS_ACTUALIZADO", label: "CxC actualizada" },
  { value: "CXC_PAGO_REGISTRADO", label: "Pago CxC registrado" },
  { value: "CXC_PAGO_VALIDADO", label: "Pago CxC validado" },
  { value: "CXP_CREADA", label: "CxP creada" },
  { value: "CXP_PROGRAMACION_CREADA", label: "CxP recurrente creada" },
  { value: "CXP_PROGRAMACION_ACTUALIZADA", label: "CxP recurrente editada" },
  { value: "CXP_PROGRAMACION_ELIMINADA", label: "CxP recurrente eliminada" },
  { value: "CXP_PAGO_REGISTRADO", label: "Pago CxP registrado" },
  { value: "CXP_PAGO_VALIDADO", label: "Pago CxP validado" },
  { value: "TRANSACCION_APLICADA_CXC", label: "Conciliacion CxC aplicada" },
  { value: "TRANSACCION_APLICADA_CXP", label: "Conciliacion CxP aplicada" },
  { value: "TRANSACCION_ESTATUS_ACTUALIZADO", label: "Estatus conciliacion actualizado" },
  { value: "ACCESO_DENEGADO", label: "Acceso denegado" },
  { value: "ACTUALIZAR_ROL_USUARIO", label: "Rol actualizado" },
  { value: "DESACTIVAR_USUARIO", label: "Usuario desactivado" },
  { value: "ELIMINAR_USUARIO_CAPA", label: "Usuario eliminado" },
  { value: "CAMBIAR_CONTRASENA", label: "Contrasena cambiada" },
  { value: "INVITAR_USUARIO", label: "Usuario invitado" },
  { value: "REVOCAR_INVITACION", label: "Invitacion revocada" },
  { value: "BACKOFFICE_BACKUP_CAPA_GENERADO", label: "Backup exportado" },
  { value: "BACKOFFICE_BACKUP_RESTORE_VALIDADO", label: "Restore validado" },
  { value: "PLAN_MODULO_DENEGADO", label: "Modulo bloqueado por plan" },
  { value: "PLAN_FUNCION_DENEGADA", label: "Funcion bloqueada por plan" },
  { value: "SUSCRIPCION_FUNCIONES_ACTUALIZADAS", label: "Funciones actualizadas" },
  { value: "SUSCRIPCION_CAMBIO_PLAN_SOLICITADO", label: "Cambio de plan solicitado" },
  { value: "SUSCRIPCION_CAMBIO_PLAN_PROGRAMADO", label: "Cambio de plan programado" },
];

const RESOURCE_OPTIONS = [
  { value: "", label: "Todos los recursos" },
  { value: "Cliente", label: "Clientes" },
  { value: "EntidadNegocio", label: "Entidades" },
  { value: "Espacio", label: "Espacios" },
  { value: "CuentaPorCobrar", label: "CxC" },
  { value: "CuentaPorPagar", label: "CxP" },
  { value: "PagoCuentaPorCobrar", label: "Pagos CxC" },
  { value: "PagoCuentaPorPagar", label: "Pagos CxP" },
  { value: "Transaccion", label: "Conciliacion" },
  { value: "BackupCapaExport", label: "Backups" },
  { value: "PlanSaaS", label: "Plan SaaS" },
  { value: "SuscripcionCapa", label: "Suscripcion" },
];

const auditInfo = {
  modulo: {
    eyebrow: "Trazabilidad",
    title: "Auditoria de acciones",
    summary:
      "La bitacora muestra cambios sensibles para soporte, conciliacion y revision operativa.",
    details: [
      "Filtra por accion o recurso para ubicar cambios de clientes, entidades, espacios, finanzas, conciliacion y backups.",
      "El buscador local limita la captura a 120 caracteres y limpia simbolos no operativos para evitar busquedas sucias.",
      "La vista es de consulta; no edita ni borra eventos registrados.",
    ],
  },
  filtros: {
    eyebrow: "Filtros",
    title: "Busqueda y filtros",
    summary:
      "Ayudan a encontrar eventos por actor, accion, recurso o datos resumidos del cambio.",
    details: [
      "Usa el buscador para correos, IDs, nombres de acciones o detalles del evento.",
      "Los selectores consultan el backend por tipo de accion y recurso.",
      "Si necesitas una revision amplia, deja accion y recurso en Todos y usa solo el texto de busqueda.",
    ],
  },
};

function sanitizeAuditQuery(value: string) {
  return value.replace(/[<>]/g, "").slice(0, 120);
}

function formatDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function humanize(value: string) {
  return value
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

function metadataSummary(metadata?: Record<string, unknown>) {
  if (!metadata || Object.keys(metadata).length === 0) {
    return "Sin detalles adicionales.";
  }
  return Object.entries(metadata)
    .slice(0, 4)
    .map(([key, value]) => `${humanize(key)}: ${String(value)}`)
    .join(" | ");
}

function compactText(value: string, maxLength = 95) {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 1).trim()}...`;
}

function formatMetadataValue(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return "Sin dato";
  }
  if (typeof value === "object") {
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}

function visiblePageNumbers(currentPage: number, totalPages: number) {
  const start = Math.max(1, currentPage - 2);
  const end = Math.min(totalPages, currentPage + 2);
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function getAuditRiskClass(risk?: string) {
  if (risk === "ALTO") {
    return "border-rose-500/30 bg-rose-500/10 text-rose-100";
  }
  if (risk === "MEDIO") {
    return "border-amber-500/30 bg-amber-500/10 text-amber-100";
  }
  return "border-emerald-500/30 bg-emerald-500/10 text-emerald-100";
}

export default function AuditTrailManager() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [summary, setSummary] = useState<AuditSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [accion, setAccion] = useState("");
  const [recursoTipo, setRecursoTipo] = useState("");
  const [recursoId, setRecursoId] = useState("");
  const [actorEmail, setActorEmail] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [query, setQuery] = useState("");
  const [infoModal, setInfoModal] = useState<ConfigInfoContent | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [detailEvent, setDetailEvent] = useState<AuditEvent | null>(null);

  const loadEvents = async () => {
    setLoading(true);
    setMessage("");
    try {
      const params = new URLSearchParams({ limit: "200" });
      if (accion) params.set("accion", accion);
      if (recursoTipo) params.set("recurso_tipo", recursoTipo);
      if (recursoId.trim()) params.set("recurso_id", recursoId.trim());
      if (actorEmail.trim()) params.set("actor_email", actorEmail.trim());
      if (desde) params.set("desde", desde);
      if (hasta) params.set("hasta", hasta);
      const response = await fetch(
        buildApiUrl(`/accounts/auditoria/?${params.toString()}`),
        { cache: "no-store" }
      );
      if (!response.ok) {
        throw new Error("No se pudo cargar la bitacora de auditoria.");
      }
      setEvents((await response.json()) as AuditEvent[]);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "No se pudo cargar la bitacora de auditoria."
      );
    } finally {
      setLoading(false);
    }
  };

  const loadSummary = async () => {
    setSummaryLoading(true);
    try {
      const response = await fetch(
        buildApiUrl("/accounts/auditoria/resumen/?dias=7&limit=2"),
        { cache: "no-store" }
      );
      if (!response.ok) {
        throw new Error("No se pudo cargar el resumen operativo.");
      }
      setSummary((await response.json()) as AuditSummary);
    } catch {
      setSummary(null);
    } finally {
      setSummaryLoading(false);
    }
  };

  useEffect(() => {
    void loadEvents();
  }, [accion, recursoTipo, recursoId, actorEmail, desde, hasta]);

  useEffect(() => {
    void loadSummary();
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [accion, recursoTipo, recursoId, actorEmail, desde, hasta, query]);

  const filteredEvents = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return events;
    return events.filter((event) => {
      const haystack = [
        event.accion,
        event.recurso_tipo,
        event.recurso_id || "",
        event.actor_email || "",
        metadataSummary(event.metadata),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [events, query]);

  const totalPages = Math.max(1, Math.ceil(filteredEvents.length / PAGE_SIZE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const pageStart = (safeCurrentPage - 1) * PAGE_SIZE;
  const paginatedEvents = filteredEvents.slice(pageStart, pageStart + PAGE_SIZE);
  const showingFrom = filteredEvents.length === 0 ? 0 : pageStart + 1;
  const showingTo = Math.min(pageStart + paginatedEvents.length, filteredEvents.length);
  const pages = visiblePageNumbers(safeCurrentPage, totalPages);
  const securitySignals = summary?.senales_seguridad;

  const handleChangePage = (page: number) => {
    setCurrentPage(Math.min(Math.max(page, 1), totalPages));
  };

  return (
    <section className="rounded-3xl border border-zinc-800 bg-zinc-950/70 p-5 shadow-xl">
      <ConfigInfoModal info={infoModal} onClose={() => setInfoModal(null)} />
      {detailEvent ? (
        <AuditDetailModal event={detailEvent} onClose={() => setDetailEvent(null)} />
      ) : null}
      <div className="flex flex-col gap-4 border-b border-zinc-800 pb-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-300">
            Bitacora operativa
          </p>
          <div className="mt-2 flex items-center gap-2">
            <h2 className="text-xl font-bold text-white">
              Auditoria de acciones criticas
            </h2>
            <ConfigInfoButton info={auditInfo.modulo} onOpen={setInfoModal} />
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-7 text-zinc-500">
            Consulta cambios relevantes de la capa: clientes, entidades, espacios,
            finanzas, comprobantes, conciliacion y respaldos.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void Promise.all([loadEvents(), loadSummary()])}
          className="inline-flex items-center justify-center rounded-2xl border border-cyan-500/25 bg-cyan-500/10 px-5 py-3 text-sm font-semibold text-cyan-100 transition-colors hover:bg-cyan-500/20"
        >
          Actualizar
        </button>
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-6">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-4 lg:col-span-1">
          <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Criticos</p>
          <p className="mt-2 text-3xl font-semibold text-white">
            {summaryLoading ? "..." : summary?.total_eventos_criticos ?? 0}
          </p>
          <p className="mt-1 text-xs text-zinc-500">Ultimos {summary?.dias ?? 7} dias</p>
        </div>
        {(summary?.categorias ?? []).map((category) => {
          const latest = category.latest[0];
          return (
            <div
              key={category.key}
              className="rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-4"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-white">{category.label}</p>
                <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-1 text-xs font-semibold text-cyan-100">
                  {category.count}
                </span>
              </div>
              <p className="mt-3 min-h-[36px] text-xs leading-5 text-zinc-500">
                {latest
                  ? `${humanize(latest.accion)} | ${formatDate(latest.fecha_creacion)}`
                  : "Sin eventos recientes."}
              </p>
            </div>
          );
        })}
      </div>

      {securitySignals ? (
        <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                Senales de permisos
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-semibold text-white">
                  Riesgo de acceso
                </h3>
                <span
                  className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${getAuditRiskClass(
                    securitySignals.riesgo
                  )}`}
                >
                  {securitySignals.riesgo}
                </span>
              </div>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-500">
                {securitySignals.foco_recomendado}
              </p>
            </div>
            <div className="grid min-w-full gap-2 sm:grid-cols-3 lg:min-w-[420px]">
              <AuditSignalMetric
                label="Permisos denegados"
                value={securitySignals.permisos_denegados}
              />
              <AuditSignalMetric
                label="Plan bloqueado"
                value={securitySignals.plan_denegado}
              />
              <AuditSignalMetric
                label="Cambios de acceso"
                value={securitySignals.cambios_acceso}
              />
            </div>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            <AuditSignalBucketList
              title="Permisos mas denegados"
              emptyLabel="Sin denegaciones."
              buckets={securitySignals.permisos_mas_denegados}
            />
            <AuditSignalBucketList
              title="Rutas con friccion"
              emptyLabel="Sin rutas bloqueadas."
              buckets={securitySignals.rutas_mas_denegadas}
            />
            <AuditSignalBucketList
              title="Funciones por plan"
              emptyLabel="Sin bloqueos por plan."
              buckets={securitySignals.funciones_plan_bloqueadas}
            />
          </div>
        </div>
      ) : null}

      <div className="mt-5 grid gap-3 lg:grid-cols-[1fr_0.45fr_0.45fr]">
        <label>
          <ConfigFieldLabel optional info={auditInfo.filtros} onInfo={setInfoModal}>
            Buscar
          </ConfigFieldLabel>
          <input
            value={query}
            onChange={(event) => setQuery(sanitizeAuditQuery(event.target.value))}
            maxLength={120}
            placeholder="Buscar por actor, accion, recurso o detalle"
            className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white outline-none transition-colors focus:border-cyan-400"
          />
        </label>
        <label>
          <ConfigFieldLabel optional info={auditInfo.filtros} onInfo={setInfoModal}>
            Accion
          </ConfigFieldLabel>
          <select
            value={accion}
            onChange={(event) => setAccion(event.target.value)}
            className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white outline-none transition-colors focus:border-cyan-400"
          >
          {ACTION_OPTIONS.map((option) => (
            <option key={option.value || "all-actions"} value={option.value}>
              {option.label}
            </option>
          ))}
          </select>
        </label>
        <label>
          <ConfigFieldLabel optional info={auditInfo.filtros} onInfo={setInfoModal}>
            Recurso
          </ConfigFieldLabel>
          <select
            value={recursoTipo}
            onChange={(event) => setRecursoTipo(event.target.value)}
            className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white outline-none transition-colors focus:border-cyan-400"
          >
          {RESOURCE_OPTIONS.map((option) => (
            <option key={option.value || "all-resources"} value={option.value}>
              {option.label}
            </option>
          ))}
          </select>
        </label>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-4">
        <label>
          <ConfigFieldLabel optional info={auditInfo.filtros} onInfo={setInfoModal}>
            Actor
          </ConfigFieldLabel>
          <input
            value={actorEmail}
            onChange={(event) => setActorEmail(sanitizeAuditQuery(event.target.value))}
            maxLength={120}
            placeholder="correo@empresa.com"
            className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white outline-none transition-colors focus:border-cyan-400"
          />
        </label>
        <label>
          <ConfigFieldLabel optional info={auditInfo.filtros} onInfo={setInfoModal}>
            ID recurso
          </ConfigFieldLabel>
          <input
            value={recursoId}
            onChange={(event) => setRecursoId(sanitizeAuditQuery(event.target.value))}
            maxLength={120}
            placeholder="ID exacto"
            className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white outline-none transition-colors focus:border-cyan-400"
          />
        </label>
        <label>
          <ConfigFieldLabel optional info={auditInfo.filtros} onInfo={setInfoModal}>
            Desde
          </ConfigFieldLabel>
          <input
            type="date"
            value={desde}
            onChange={(event) => setDesde(event.target.value)}
            className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white outline-none transition-colors focus:border-cyan-400"
          />
        </label>
        <label>
          <ConfigFieldLabel optional info={auditInfo.filtros} onInfo={setInfoModal}>
            Hasta
          </ConfigFieldLabel>
          <input
            type="date"
            value={hasta}
            onChange={(event) => setHasta(event.target.value)}
            className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white outline-none transition-colors focus:border-cyan-400"
          />
        </label>
      </div>

      {message ? (
        <div className="mt-4 rounded-2xl border border-rose-500/25 bg-rose-500/10 p-4 text-sm text-rose-100">
          {message}
        </div>
      ) : null}

      <div className="mt-5 overflow-hidden rounded-2xl border border-zinc-800">
        <div className="border-b border-zinc-800 bg-zinc-900/40 px-4 py-3">
          <div className="flex flex-col gap-2 text-sm text-zinc-500 md:flex-row md:items-center md:justify-between">
            <p>
              {filteredEvents.length
                ? `Mostrando ${showingFrom}-${showingTo} de ${filteredEvents.length} acciones`
                : "Sin acciones para mostrar"}
            </p>
            <p className="rounded-full border border-zinc-800 bg-zinc-950 px-3 py-1 text-xs text-zinc-400">
              25 acciones por pagina
            </p>
          </div>
        </div>

        <div className="overflow-x-auto px-3 py-2">
          <table className="min-w-full border-separate border-spacing-y-2 text-left text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Accion</th>
                <th className="px-3 py-2">Recurso</th>
                <th className="px-3 py-2">Actor</th>
                <th className="px-3 py-2">Resumen</th>
                <th className="px-3 py-2 text-right">Detalle</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className="rounded-2xl bg-zinc-950/80 px-4 py-8 text-zinc-500" colSpan={6}>
                    Cargando bitacora...
                  </td>
                </tr>
              ) : filteredEvents.length === 0 ? (
                <tr>
                  <td className="rounded-2xl bg-zinc-950/80 px-4 py-8 text-zinc-500" colSpan={6}>
                    No hay eventos de auditoria para los filtros seleccionados.
                  </td>
                </tr>
              ) : (
                paginatedEvents.map((event) => {
                  const summary = metadataSummary(event.metadata);
                  return (
                    <tr
                      key={event.id}
                      className="align-top text-zinc-300"
                    >
                      <td className="rounded-l-2xl bg-zinc-950/80 px-3 py-3 text-zinc-400">
                        <p className="whitespace-nowrap">{formatDate(event.fecha_creacion)}</p>
                        <p className="mt-1 text-xs text-zinc-600">Evento #{event.id}</p>
                      </td>
                      <td className="bg-zinc-950/80 px-3 py-3">
                        <span className="inline-flex max-w-[210px] rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-xs font-semibold leading-5 text-cyan-100">
                          <span className="break-words">{humanize(event.accion)}</span>
                        </span>
                      </td>
                      <td className="bg-zinc-950/80 px-3 py-3">
                        <p className="max-w-[190px] break-words font-medium text-white">
                          {humanize(event.recurso_tipo)}
                        </p>
                        <p className="mt-1 text-xs text-zinc-500">
                          ID {event.recurso_id || "N/A"}
                        </p>
                      </td>
                      <td className="bg-zinc-950/80 px-3 py-3">
                        <p className="max-w-[230px] break-words text-zinc-300">
                          {event.actor_email || "Sistema"}
                        </p>
                        <p className="mt-1 text-xs text-zinc-600">
                          {event.capa_negocio_nombre || "Sin capa"}
                        </p>
                      </td>
                      <td className="bg-zinc-950/80 px-3 py-3">
                        <p className="max-w-xl break-words leading-6 text-zinc-400">
                          {compactText(summary)}
                        </p>
                      </td>
                      <td className="rounded-r-2xl bg-zinc-950/80 px-3 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => setDetailEvent(event)}
                          className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-100 transition-colors hover:bg-cyan-500/20"
                        >
                          Ver detalle
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {!loading && filteredEvents.length > 0 ? (
          <div className="flex flex-col gap-3 border-t border-zinc-800 px-4 py-4 md:flex-row md:items-center md:justify-between">
            <div className="text-sm text-zinc-500">
              Pagina <span className="font-semibold text-white">{safeCurrentPage}</span>{" "}
              de <span className="font-semibold text-white">{totalPages}</span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => handleChangePage(1)}
                disabled={safeCurrentPage <= 1}
                className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                Inicio
              </button>
              <button
                type="button"
                onClick={() => handleChangePage(safeCurrentPage - 1)}
                disabled={safeCurrentPage <= 1}
                className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                Anterior
              </button>

              {pages.map((page) => (
                <button
                  key={page}
                  type="button"
                  onClick={() => handleChangePage(page)}
                  className={`rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
                    page === safeCurrentPage
                      ? "bg-cyan-600 text-white"
                      : "border border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 hover:text-white"
                  }`}
                >
                  {page}
                </button>
              ))}

              <button
                type="button"
                onClick={() => handleChangePage(safeCurrentPage + 1)}
                disabled={safeCurrentPage >= totalPages}
                className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                Siguiente
              </button>
              <button
                type="button"
                onClick={() => handleChangePage(totalPages)}
                disabled={safeCurrentPage >= totalPages}
                className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                Final
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function AuditDetailModal({
  event,
  onClose,
}: {
  event: AuditEvent;
  onClose: () => void;
}) {
  const metadataEntries = Object.entries(event.metadata || {});

  return (
    <div className="fixed inset-0 z-[170] flex items-center justify-center bg-black/75 px-4 py-6 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="audit-detail-title"
        className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-[30px] border border-cyan-500/20 bg-zinc-950 shadow-2xl shadow-black/60"
      >
        <div className="flex flex-col gap-3 border-b border-zinc-800 px-6 py-5 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-300">
              Bitacora operativa
            </p>
            <h3 id="audit-detail-title" className="mt-2 text-2xl font-semibold text-white">
              {humanize(event.accion)}
            </h3>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
              Vista completa del evento registrado para auditoria interna,
              soporte y trazabilidad de cambios sensibles.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="self-start rounded-2xl border border-white/10 bg-zinc-900 px-4 py-2 text-sm text-zinc-200 transition hover:border-zinc-700"
          >
            Cerrar
          </button>
        </div>

        <div className="space-y-5 px-6 py-5">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <AuditDetailCard label="Fecha" value={formatDate(event.fecha_creacion)} />
            <AuditDetailCard label="Actor" value={event.actor_email || "Sistema"} />
            <AuditDetailCard label="Recurso" value={humanize(event.recurso_tipo)} />
            <AuditDetailCard label="ID recurso" value={event.recurso_id || "N/A"} />
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4">
            <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">
              Capa de negocio
            </p>
            <p className="mt-2 text-sm font-semibold text-white">
              {event.capa_negocio_nombre || "Sin capa asociada"}
            </p>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80">
            <div className="border-b border-zinc-800 px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">
                Detalle del evento
              </p>
            </div>

            {metadataEntries.length === 0 ? (
              <div className="px-4 py-6 text-sm text-zinc-500">
                Este evento no trae metadata adicional.
              </div>
            ) : (
              <div className="divide-y divide-zinc-900">
                {metadataEntries.map(([key, value]) => (
                  <div
                    key={key}
                    className="grid gap-2 px-4 py-3 text-sm md:grid-cols-[240px_1fr]"
                  >
                    <p className="font-medium text-zinc-300">{humanize(key)}</p>
                    <pre className="whitespace-pre-wrap break-words rounded-xl border border-zinc-800 bg-black/25 px-3 py-2 font-sans text-sm leading-6 text-zinc-100">
                      {formatMetadataValue(value)}
                    </pre>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function AuditDetailCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4">
      <p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">{label}</p>
      <p className="mt-2 break-words text-sm font-semibold text-white">{value}</p>
    </div>
  );
}

function AuditSignalMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 px-3 py-3">
      <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-white">{value}</p>
    </div>
  );
}

function AuditSignalBucketList({
  title,
  emptyLabel,
  buckets,
}: {
  title: string;
  emptyLabel: string;
  buckets: AuditSignalBucket[];
}) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 px-3 py-3">
      <p className="text-sm font-semibold text-white">{title}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {buckets.length ? (
          buckets.map((bucket) => (
            <span
              key={`${bucket.value}-${bucket.count}`}
              className="rounded-full border border-zinc-700 bg-zinc-950 px-3 py-1 text-xs text-zinc-300"
            >
              {bucket.label} - {bucket.count}
            </span>
          ))
        ) : (
          <span className="text-xs text-zinc-500">{emptyLabel}</span>
        )}
      </div>
    </div>
  );
}
