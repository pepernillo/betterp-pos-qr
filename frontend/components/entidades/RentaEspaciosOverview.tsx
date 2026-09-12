"use client";

import { buildApiUrl } from "@/lib/api";
import { useSearchParams } from "next/navigation";

import { useCallback, useEffect, useMemo, useState } from "react";

import RentaCanalesConfigManager from "./RentaCanalesConfigManager";
import RentaEspaciosBatchPanel from "./RentaEspaciosBatchPanel";
import RentaEspaciosCatalogoGlobal from "./RentaEspaciosCatalogoGlobal";
import {
  RentaInfoButton,
  RentaInfoModal,
  type RentaInfoContent,
} from "./RentaInfo";
import RentaPublicacionPanel from "./RentaPublicacionPanel";
import {
  hasPlanFeature,
  type PlanAccessSubscription,
} from "@/lib/plan-access";

const EMPRESAS_API_BASE = buildApiUrl("/empresas");

interface Entidad {
  id: number;
  nombre_comercial: string;
  ciudad?: string | null;
  rfc?: string | null;
  tipo_fecha_corte: string;
  activo: boolean;
  clientes_count: number;
  espacios_total: number;
  espacios_ocupados: number;
  espacios_disponibles: number;
  espacios_reservados: number;
  espacios_mantenimiento: number;
  facturacion_activa: number;
}

type RentaWorkspaceTab =
  | "espacios"
  | "batch"
  | "conexiones"
  | "publicacion";

const workspaceTabs: {
  value: RentaWorkspaceTab;
  label: string;
  detail: string;
}[] = [
  {
    value: "espacios",
    label: "Espacios",
    detail: "Listado completo, filtros y fichas comerciales.",
  },
  {
    value: "batch",
    label: "Carga batch",
    detail: "Completa fichas por CSV sin capturar una por una.",
  },
  {
    value: "conexiones",
    label: "Conexiones",
    detail: "Cuentas, sandbox, APIs y reglas por plataforma.",
  },
  {
    value: "publicacion",
    label: "Publicacion",
    detail: "Disponibles, cola y estado de anuncios.",
  },
];

const workspaceTabInfo: Record<RentaWorkspaceTab, RentaInfoContent> = {
  espacios: {
    eyebrow: "Renta de espacios",
    title: "Pestana Espacios",
    summary:
      "Aqui se depuran las fichas comerciales que despues se usan en portales, publicaciones internas y canales conectados.",
    details: [
      "Usala para revisar precio publicable, fotos, resumen, descripcion, amenidades y reglas visibles.",
      "Una ficha completa no renta por si sola; solo deja el espacio listo para publicarse o compartirse.",
      "Los filtros ayudan a separar espacios disponibles, pendientes de informacion y espacios ya publicables.",
    ],
  },
  batch: {
    eyebrow: "Renta de espacios",
    title: "Pestana Carga batch",
    summary:
      "Permite completar o corregir fichas comerciales por CSV sin abrir espacio por espacio.",
    details: [
      "La carga actualiza espacios existentes usando entidad y codigo; no crea inventario nuevo.",
      "Las filas correctas se guardan y las filas con errores regresan en un archivo descargable para corregir.",
      "Es ideal cuando ya existe inventario y solo quieres completar precios, textos, caracteristicas o banderas publicables.",
    ],
  },
  conexiones: {
    eyebrow: "Renta de espacios",
    title: "Pestana Conexiones",
    summary:
      "Centraliza la conexion por unidad de negocio con plataformas externas y reglas comerciales por canal.",
    details: [
      "Aqui se activan canales, credenciales, automatizaciones y reglas como comision, temporada o promocion.",
      "Mercado Libre y Metros Cubicos comparten flujo tecnico; otros canales pueden operar como asistidos mientras se completa la integracion.",
      "La disponibilidad real del espacio manda: si se ocupa, la automatizacion puede pausar el anuncio para evitar dobles rentas.",
    ],
  },
  publicacion: {
    eyebrow: "Renta de espacios",
    title: "Pestana Publicacion",
    summary:
      "Muestra el estado operativo de publicaciones y permite sincronizar espacios listos con los canales conectados.",
    details: [
      "Sirve para ver que espacios estan listos, publicados, pausados o con errores.",
      "Desde aqui puedes sincronizar, preparar paquetes asistidos o revisar trazabilidad de canales.",
      "Los pendientes normalmente indican falta de ficha, fotos, conexion activa o una restriccion del proveedor.",
    ],
  },
};

const connectionsInfo: RentaInfoContent = {
  eyebrow: "Conexiones",
  title: "Seleccion de unidad y reglas automaticas",
  summary:
    "Las conexiones se configuran por unidad de negocio porque cada propiedad puede tener canales, cuentas o reglas comerciales distintas.",
  details: [
    "Selecciona la unidad de negocio que quieres operar antes de activar un canal.",
    "El trigger automatico usa el estatus del espacio: disponible publica o reactiva; ocupado pausa o baja el anuncio si el canal lo permite.",
    "Esta separacion evita que una cuenta o politica comercial de una propiedad afecte otra unidad.",
  ],
};

function isRentaWorkspaceTab(value: string | null): value is RentaWorkspaceTab {
  return (
    value === "espacios" ||
    value === "batch" ||
    value === "conexiones" ||
    value === "publicacion"
  );
}

export default function RentaEspaciosOverview() {
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const [entidades, setEntidades] = useState<Entidad[]>([]);
  const [loadingEntidades, setLoadingEntidades] = useState(true);
  const [entidadesError, setEntidadesError] = useState("");
  const [selectedEntityId, setSelectedEntityId] = useState<number | null>(null);
  const [activeTab, setActiveTab] =
    useState<RentaWorkspaceTab>("espacios");
  const [subscriptionAccess, setSubscriptionAccess] =
    useState<PlanAccessSubscription>(null);
  const [infoModal, setInfoModal] = useState<RentaInfoContent | null>(null);

  const canUseFeature = useCallback(
    (featureKey: string) => hasPlanFeature(subscriptionAccess, featureKey),
    [subscriptionAccess]
  );

  const visibleWorkspaceTabs = useMemo(() => {
    return workspaceTabs.filter((tab) => {
      if (tab.value === "espacios") return true;
      if (tab.value === "batch") return canUseFeature("batch_import");
      return canUseFeature("social_publishing");
    });
  }, [canUseFeature]);

  const selectTab = (tab: RentaWorkspaceTab) => {
    setActiveTab(tab);
    if (typeof window !== "undefined") {
      window.history.replaceState({}, "", `/renta-espacios?tab=${tab}`);
      window.dispatchEvent(new CustomEvent("betterp-tab-change", { detail: { tab } }));
    }
  };

  useEffect(() => {
    if (isRentaWorkspaceTab(tabParam)) {
      setActiveTab(tabParam);
    }
  }, [tabParam]);

  useEffect(() => {
    if (visibleWorkspaceTabs.some((tab) => tab.value === activeTab)) {
      return;
    }
    setActiveTab("espacios");
    if (typeof window !== "undefined") {
      window.history.replaceState({}, "", "/renta-espacios?tab=espacios");
      window.dispatchEvent(
        new CustomEvent("betterp-tab-change", { detail: { tab: "espacios" } })
      );
    }
  }, [activeTab, visibleWorkspaceTabs]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const params = new URLSearchParams(window.location.search);
    if (params.has("code") || params.has("state") || params.has("error")) {
      setActiveTab("conexiones");
    }
  }, []);

  const loadEntidades = useCallback(async () => {
    setLoadingEntidades(true);
    setEntidadesError("");
    try {
      const response = await fetch(`${EMPRESAS_API_BASE}/lista/`, {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error("No se pudieron cargar las entidades.");
      }
      const body = (await response.json()) as Entidad[];
      setEntidades(body);
    } catch (error) {
      console.error("Error cargando overview de renta:", error);
      setEntidadesError(
        error instanceof Error
          ? error.message
          : "No se pudieron cargar las entidades."
      );
      setEntidades([]);
    } finally {
      setLoadingEntidades(false);
    }
  }, []);

  useEffect(() => {
    void loadEntidades();
  }, [loadEntidades]);

  useEffect(() => {
    let cancelled = false;
    const loadSubscriptionAccess = async () => {
      try {
        const response = await fetch(buildApiUrl("/billing/suscripcion/actual/"), {
          cache: "no-store",
        });
        if (!response.ok) return;
        const body = (await response.json()) as PlanAccessSubscription;
        if (!cancelled) {
          setSubscriptionAccess(body);
        }
      } catch {
        if (!cancelled) {
          setSubscriptionAccess(null);
        }
      }
    };
    void loadSubscriptionAccess();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (entidades.length === 0) {
      setSelectedEntityId(null);
      return;
    }
    if (
      selectedEntityId &&
      entidades.some((entidad) => entidad.id === selectedEntityId)
    ) {
      return;
    }
    const preferred =
      entidades.find(
        (entidad) => entidad.activo && (entidad.espacios_disponibles || 0) > 0
      ) ||
      entidades.find((entidad) => entidad.activo) ||
      entidades[0];
    setSelectedEntityId(preferred.id);
  }, [entidades, selectedEntityId]);

  const selectedEntidad = useMemo(() => {
    return entidades.find((entidad) => entidad.id === selectedEntityId) || null;
  }, [entidades, selectedEntityId]);

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <RentaInfoModal info={infoModal} onClose={() => setInfoModal(null)} />
      <section className="work-tab-bar">
          {visibleWorkspaceTabs.map((tab) => (
            <div key={tab.value} className="relative">
              <button
                type="button"
                onClick={() => selectTab(tab.value)}
                className={`work-tab pr-10 ${
                  activeTab === tab.value
                    ? "work-tab-active"
                    : "work-tab-idle"
                }`}
              >
                <span>{tab.label}</span>
                {activeTab === tab.value ? (
                  <span className="work-tab-helper">{tab.detail}</span>
                ) : null}
              </button>
              <RentaInfoButton
                info={workspaceTabInfo[tab.value]}
                onOpen={setInfoModal}
                className="absolute right-2 top-1/2 -translate-y-1/2"
              />
            </div>
          ))}
      </section>

      {activeTab === "espacios" ? (
        <RentaEspaciosCatalogoGlobal entidades={entidades} />
      ) : null}

      {activeTab === "batch" ? <RentaEspaciosBatchPanel /> : null}

      {activeTab === "publicacion" ? (
        <RentaPublicacionPanel
          entidades={entidades}
          onManageConnections={() => selectTab("conexiones")}
        />
      ) : null}

      {activeTab === "conexiones" ? (
        <div className="space-y-4">
          <section className="rounded-3xl border border-zinc-800 bg-zinc-950/70 p-5">
            <div className="grid gap-4 lg:grid-cols-[1fr_360px] lg:items-start">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs uppercase tracking-[0.18em] text-cyan-300">
                    Conexiones de plataformas
                  </p>
                  <RentaInfoButton info={connectionsInfo} onOpen={setInfoModal} />
                </div>
                <h2 className="mt-2 text-2xl font-bold text-white">
                  APIs, sandbox y reglas automaticas
                </h2>
                <p className="mt-1 text-sm text-zinc-500">
                  Conecta cuentas de Airbnb, Mercado Libre, Metros Cubicos,
                  Booking u otros canales. La regla operativa no depende de la
                  unidad: cada espacio disponible se prepara para publicar; si
                  pasa a ocupado, se pausa o baja en todos los canales activos.
                </p>
              </div>
              <div className="space-y-3">
                {entidades.length > 0 ? (
                  <label className="block rounded-2xl border border-zinc-800 bg-zinc-950/80 p-3">
                    <span className="text-xs uppercase tracking-[0.18em] text-zinc-500">
                      Unidad de negocio
                    </span>
                    <select
                      value={selectedEntityId ?? ""}
                      onChange={(event) =>
                        setSelectedEntityId(Number(event.target.value) || null)
                      }
                      className="mt-2 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                    >
                      {entidades.map((entidad) => (
                        <option key={entidad.id} value={entidad.id}>
                          {entidad.nombre_comercial}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-cyan-200/80">
                    Trigger automatico
                  </p>
                  <div className="mt-3 grid gap-2 text-sm">
                    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-emerald-200">
                      Disponible: publicar o reactivar.
                    </div>
                    <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-amber-200">
                      Ocupado: pausar o bajar anuncio.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
          {loadingEntidades ? (
            <section className="page-section">
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 py-16 text-center text-zinc-500">
                Cargando unidades para configurar conexiones...
              </div>
            </section>
          ) : selectedEntidad ? (
            <RentaCanalesConfigManager
              key={selectedEntidad.id}
              entidadId={String(selectedEntidad.id)}
              onEntidadSeleccionada={setSelectedEntityId}
            />
          ) : (
            <section className="page-section">
              <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/20 px-6 py-12 text-center">
                <p className="text-sm text-zinc-400">
                  {entidadesError ||
                    "Primero crea o activa una unidad de negocio para conectar canales de publicacion."}
                </p>
                <button
                  type="button"
                  onClick={() => void loadEntidades()}
                  className="mt-4 rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20"
                >
                  Reintentar
                </button>
              </div>
            </section>
          )}
        </div>
      ) : null}

    </div>
  );
}
