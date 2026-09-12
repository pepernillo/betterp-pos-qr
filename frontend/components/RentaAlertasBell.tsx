"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { buildApiUrl } from "@/lib/api";
import { useAuth } from "./auth/AuthProvider";

const EMPRESAS_API_BASE = buildApiUrl("/empresas");
const RENTA_API_BASE = buildApiUrl("/renta-espacios");
const REFRESH_INTERVAL_MS = 90_000;
const MAX_ALERTS = 30;

interface Entidad {
  id: number;
  nombre_comercial: string;
  activo: boolean;
}

interface PublicationTrace {
  traffic?: {
    views?: number;
    leads?: number;
    messages?: number;
    operations?: number;
    last_sync_at?: string;
  };
  webhooks?: {
    total?: number;
    last_topic?: string;
    last_at?: string;
  };
  sync?: {
    last_action?: string;
    last_at?: string;
    description_last_at?: string;
    last_error?: Record<string, unknown>;
  };
}

interface SpacePublication {
  canal: string;
  label: string;
  activo: boolean;
  estatus: string;
  url_publicacion: string | null;
  identificador_externo: string | null;
  mensaje_estado: string | null;
  estado_externo?: string | null;
  subestados_externos?: string[];
  tags_externos?: string[];
  fecha_ultima_validacion?: string | null;
  fecha_ultima_sincronizacion?: string | null;
  pausa?: {
    tipo?: "OCUPACION" | "PLATAFORMA" | string;
    label?: string;
    detalle?: string;
  } | null;
  metricas?: {
    vistas: number;
    leads: number;
    mensajes: number;
    eventos_webhook: number;
    ultimo_evento: string;
    ultimo_evento_fecha: string;
  };
  trazabilidad?: PublicationTrace;
  faltantes: string[];
}

interface DashboardSpace {
  id: number;
  codigo: string;
  estatus: string;
  titulo_publico: string;
  publicaciones: SpacePublication[];
}

interface DashboardResponse {
  entidad: {
    id: number;
    nombre_comercial: string;
  };
  spaces: DashboardSpace[];
}

type AlertTone = "danger" | "warning" | "info" | "success";

interface RentaAlert {
  id: string;
  tone: AlertTone;
  title: string;
  body: string;
  entityName: string;
  spaceCode: string;
  channelLabel: string;
  timestamp: string;
  externalUrl: string | null;
}

const toneStyles: Record<AlertTone, string> = {
  danger: "border-red-500/25 bg-red-500/10 text-red-100",
  warning: "border-amber-500/25 bg-amber-500/10 text-amber-100",
  info: "border-cyan-500/25 bg-cyan-500/10 text-cyan-100",
  success: "border-emerald-500/25 bg-emerald-500/10 text-emerald-100",
};

function BellIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
    >
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "Sin fecha";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function hasRecord(value: Record<string, unknown> | undefined) {
  return Boolean(value && Object.keys(value).length > 0);
}

function cleanPlatformMessage(message: string | null | undefined) {
  const value = (message || "").trim();
  const lower = value.toLowerCase();
  if (!value) {
    return "";
  }
  if (lower.includes("seller.unable_to_list")) {
    return "La cuenta conectada no tiene habilitada la publicacion de inmuebles. Revisa permisos, perfil o paquete del vendedor.";
  }
  if (
    lower.includes("validation_error") ||
    lower.includes("attribute") ||
    lower.includes("field") ||
    value.includes("{") ||
    value.includes("}")
  ) {
    return "La plataforma devolvio una observacion. Revisa la ficha comercial y completa los datos pendientes antes de volver a sincronizar.";
  }
  return value;
}

function humanizeWebhookTopic(topic: string | undefined) {
  const normalized = (topic || "").toLowerCase();
  if (normalized.includes("question")) return "Pregunta recibida";
  if (normalized.includes("message")) return "Mensaje recibido";
  if (normalized.includes("order")) return "Operacion detectada";
  if (normalized.includes("item")) return "Cambio en publicacion";
  if (normalized.includes("lead")) return "Lead recibido";
  return "Aviso de plataforma";
}

function alertTimestamp(publication: SpacePublication, fallback: string) {
  return (
    publication.trazabilidad?.webhooks?.last_at ||
    publication.fecha_ultima_sincronizacion ||
    publication.fecha_ultima_validacion ||
    fallback
  );
}

function buildAlertId(
  kind: string,
  entityId: number,
  spaceId: number,
  publication: SpacePublication,
  timestamp: string
) {
  return [
    kind,
    entityId,
    spaceId,
    publication.canal,
    publication.estatus,
    publication.estado_externo || "",
    publication.metricas?.eventos_webhook || 0,
    timestamp || "",
  ].join(":");
}

function buildPublicationAlerts(
  dashboard: DashboardResponse,
  space: DashboardSpace,
  publication: SpacePublication
) {
  const alerts: RentaAlert[] = [];
  const base = {
    entityName: dashboard.entidad.nombre_comercial,
    spaceCode: space.codigo,
    channelLabel: publication.label || publication.canal,
    externalUrl: publication.url_publicacion,
  };
  const timestamp = alertTimestamp(publication, new Date().toISOString());
  const message = cleanPlatformMessage(publication.mensaje_estado);

  if (publication.estatus === "ERROR") {
    alerts.push({
      ...base,
      id: buildAlertId("error", dashboard.entidad.id, space.id, publication, timestamp),
      tone: "danger",
      title: "Error al publicar",
      body:
        message ||
        "La plataforma rechazo el ultimo intento. Revisa la ficha, la cuenta conectada o los permisos del canal.",
      timestamp,
    });
  }

  if (publication.estatus === "PAUSADA") {
    alerts.push({
      ...base,
      id: buildAlertId("pause", dashboard.entidad.id, space.id, publication, timestamp),
      tone: publication.pausa?.tipo === "OCUPACION" ? "info" : "warning",
      title: publication.pausa?.label || "Anuncio pausado",
      body:
        publication.pausa?.detalle ||
        message ||
        "El anuncio esta pausado. Revisa si debe reactivarse o conservarse fuera de publicacion.",
      timestamp,
    });
  }

  if (publication.estatus === "EN_COLA" || publication.estatus === "LISTA") {
    alerts.push({
      ...base,
      id: buildAlertId("publication", dashboard.entidad.id, space.id, publication, timestamp),
      tone: "info",
      title:
        publication.estatus === "EN_COLA"
          ? "Publicacion en cola"
          : "Publicacion lista",
      body:
        publication.estatus === "EN_COLA"
          ? "El espacio quedo preparado para sincronizarse con el canal."
          : "El espacio ya tiene ficha suficiente para enviarse al canal.",
      timestamp,
    });
  }

  const webhooksTotal = publication.metricas?.eventos_webhook || 0;
  const lastWebhookAt =
    publication.metricas?.ultimo_evento_fecha ||
    publication.trazabilidad?.webhooks?.last_at ||
    "";
  if (webhooksTotal > 0 && lastWebhookAt) {
    alerts.push({
      ...base,
      id: buildAlertId("webhook", dashboard.entidad.id, space.id, publication, lastWebhookAt),
      tone: "info",
      title: humanizeWebhookTopic(
        publication.metricas?.ultimo_evento ||
          publication.trazabilidad?.webhooks?.last_topic
      ),
      body: "La plataforma envio actividad nueva para esta publicacion. Revisa preguntas, mensajes o cambios de estado.",
      timestamp: lastWebhookAt,
    });
  }

  const isPublished = publication.estatus === "PUBLICADA";
  const missingMetrics =
    isPublished &&
    !publication.trazabilidad?.traffic?.last_sync_at &&
    (publication.metricas?.vistas || 0) === 0 &&
    (publication.metricas?.leads || 0) === 0;
  if (missingMetrics) {
    alerts.push({
      ...base,
      id: buildAlertId("metrics", dashboard.entidad.id, space.id, publication, timestamp),
      tone: "warning",
      title: "Metricas pendientes",
      body: "El anuncio ya existe, pero todavia no tenemos vistas o preguntas confirmadas por el canal.",
      timestamp,
    });
  }

  if (
    hasRecord(publication.trazabilidad?.sync?.last_error) &&
    publication.estatus !== "ERROR"
  ) {
    alerts.push({
      ...base,
      id: buildAlertId("resolved", dashboard.entidad.id, space.id, publication, timestamp),
      tone: "success",
      title: "Incidencia resuelta",
      body: "La publicacion ya no requiere accion inmediata. Se conserva el antecedente para soporte.",
      timestamp,
    });
  }

  return alerts;
}

function loadSeen(storageKey: string) {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    return JSON.parse(window.localStorage.getItem(storageKey) || "{}") as Record<
      string,
      boolean
    >;
  } catch {
    return {};
  }
}

function saveSeen(storageKey: string, value: Record<string, boolean>) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(storageKey, JSON.stringify(value));
}

export default function RentaAlertasBell() {
  const { currentMembership, status, user } = useAuth();
  const pathname = usePathname();
  const [alerts, setAlerts] = useState<RentaAlert[]>([]);
  const [seen, setSeen] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const menuRef = useRef<HTMLDetailsElement | null>(null);

  const storageKey = useMemo(() => {
    const userKey = user?.id ?? "anon";
    const capaKey = currentMembership?.capa_negocio.id ?? "sin-capa";
    return `betterp:renta-alertas:v1:${userKey}:${capaKey}`;
  }, [currentMembership?.capa_negocio.id, user?.id]);

  const loadAlerts = useCallback(async () => {
    if (status !== "authenticated" || pathname === "/onboarding") {
      setAlerts([]);
      setError("");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const entitiesResponse = await fetch(`${EMPRESAS_API_BASE}/lista/`, {
        cache: "no-store",
      });
      if (!entitiesResponse.ok) {
        throw new Error("No se pudieron cargar las entidades.");
      }
      const entities = ((await entitiesResponse.json()) as Entidad[]).filter(
        (entity) => entity.activo
      );
      const dashboards = await Promise.allSettled(
        entities.map(async (entity) => {
          const response = await fetch(
            `${RENTA_API_BASE}/entidades/${entity.id}/dashboard/`,
            { cache: "no-store" }
          );
          if (!response.ok) {
            throw new Error(`No se pudo cargar ${entity.nombre_comercial}.`);
          }
          return (await response.json()) as DashboardResponse;
        })
      );

      const nextAlerts = dashboards
        .flatMap((result) => (result.status === "fulfilled" ? [result.value] : []))
        .flatMap((dashboard) =>
          dashboard.spaces.flatMap((space) =>
            space.publicaciones.flatMap((publication) =>
              buildPublicationAlerts(dashboard, space, publication)
            )
          )
        )
        .sort(
          (a, b) =>
            new Date(b.timestamp || 0).getTime() -
            new Date(a.timestamp || 0).getTime()
        )
        .slice(0, MAX_ALERTS);

      setAlerts(nextAlerts);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "No se pudieron cargar las alertas."
      );
      setAlerts([]);
    } finally {
      setLoading(false);
    }
  }, [currentMembership?.capa_negocio.id, pathname, status]);

  useEffect(() => {
    setSeen(loadSeen(storageKey));
  }, [storageKey]);

  useEffect(() => {
    if (pathname === "/onboarding") {
      setAlerts([]);
      setError("");
      return;
    }
    void loadAlerts();
    const interval = window.setInterval(() => void loadAlerts(), REFRESH_INTERVAL_MS);
    const onFocus = () => void loadAlerts();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [loadAlerts, pathname]);

  const unseenCount = alerts.filter((alert) => !seen[alert.id]).length;
  const urgentCount = alerts.filter(
    (alert) => !seen[alert.id] && (alert.tone === "danger" || alert.tone === "warning")
  ).length;

  const markSeen = (alertId: string) => {
    const nextSeen = { ...seen, [alertId]: true };
    setSeen(nextSeen);
    saveSeen(storageKey, nextSeen);
  };

  const markAllSeen = () => {
    const nextSeen = alerts.reduce<Record<string, boolean>>((acc, alert) => {
      acc[alert.id] = true;
      return acc;
    }, { ...seen });
    setSeen(nextSeen);
    saveSeen(storageKey, nextSeen);
  };

  return (
    <details ref={menuRef} className="relative shrink-0">
      <summary
        title={
          unseenCount > 0
            ? `${unseenCount} alertas de renta por revisar`
            : "Sin alertas nuevas de renta"
        }
        className={`relative flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-2xl border transition-colors ${
          urgentCount > 0
            ? "border-amber-500/35 bg-amber-500/10 text-amber-200 hover:bg-amber-500/15"
            : unseenCount > 0
              ? "border-cyan-500/25 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/15"
              : "border-white/10 bg-zinc-900/80 text-zinc-400 hover:border-zinc-700 hover:text-white"
        }`}
      >
        <BellIcon />
        {unseenCount > 0 ? (
          <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-amber-300 px-1.5 py-0.5 text-center text-[10px] font-semibold text-black">
            {unseenCount > 9 ? "9+" : unseenCount}
          </span>
        ) : null}
      </summary>

      <div className="absolute right-0 z-20 mt-3 w-[min(92vw,420px)] rounded-3xl border border-white/10 bg-zinc-950/95 p-3 shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-zinc-800 pb-3">
          <div>
            <p className="text-sm font-semibold text-white">Alertas de renta</p>
            <p className="mt-1 text-xs text-zinc-500">
              Publicaciones, pausas, webhooks y metricas.
            </p>
          </div>
          <button
            type="button"
            onClick={markAllSeen}
            disabled={alerts.length === 0 || unseenCount === 0}
            className="rounded-xl border border-zinc-800 px-3 py-2 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-900 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            Todo visto
          </button>
        </div>

        {error ? (
          <div className="mt-3 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        <div className="mt-3 max-h-[60vh] space-y-2 overflow-y-auto pr-1">
          {loading && alerts.length === 0 ? (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 text-sm text-zinc-500">
              Cargando alertas...
            </div>
          ) : null}

          {!loading && alerts.length === 0 && !error ? (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-100">
              No hay alertas de publicaciones por revisar.
            </div>
          ) : null}

          {alerts.map((alert) => {
            const isSeen = Boolean(seen[alert.id]);
            return (
              <div
                key={alert.id}
                className={`rounded-2xl border p-3 transition-opacity ${
                  toneStyles[alert.tone]
                } ${isSeen ? "opacity-55" : "opacity-100"}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">{alert.title}</p>
                    <p className="mt-1 text-xs opacity-70">
                      {alert.entityName} - {alert.spaceCode} - {alert.channelLabel}
                    </p>
                  </div>
                  <span className="shrink-0 text-[11px] opacity-70">
                    {formatDateTime(alert.timestamp)}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-relaxed opacity-85">
                  {alert.body}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Link
                    href="/renta-espacios"
                    onClick={() => menuRef.current?.removeAttribute("open")}
                    className="rounded-lg border border-white/10 bg-zinc-950/55 px-3 py-1.5 text-xs font-medium text-white/85 transition-colors hover:bg-zinc-900 hover:text-white"
                  >
                    Revisar
                  </Link>
                  {alert.externalUrl ? (
                    <a
                      href={alert.externalUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-lg border border-white/10 bg-zinc-950/55 px-3 py-1.5 text-xs font-medium text-white/85 transition-colors hover:bg-zinc-900 hover:text-white"
                    >
                      Abrir anuncio
                    </a>
                  ) : null}
                  {!isSeen ? (
                    <button
                      type="button"
                      onClick={() => markSeen(alert.id)}
                      className="rounded-lg border border-white/10 bg-zinc-950/55 px-3 py-1.5 text-xs font-medium text-white/85 transition-colors hover:bg-zinc-900 hover:text-white"
                    >
                      Visto
                    </button>
                  ) : (
                    <span className="rounded-lg border border-white/10 bg-zinc-950/40 px-3 py-1.5 text-xs opacity-70">
                      Vista
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </details>
  );
}
