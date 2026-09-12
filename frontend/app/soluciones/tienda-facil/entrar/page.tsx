"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { buildApiUrl } from "@/lib/api";
import {
  TIENDA_FACIL_ENTRY_PATH,
  normalizeSolutionLaunchUrl,
  solutionLoginPath,
} from "@/lib/solution-launch";

type SolutionLaunchResponse = {
  solution: {
    clave: string;
    nombre: string;
  };
  capa_negocio: {
    id: number;
    nombre: string;
  };
  launch: {
    mode: string;
    ready: boolean;
    url: string;
    detail: string;
  };
};

const LOGIN_PATH = solutionLoginPath("tienda_facil");
const TIENDA_FACIL_DEEP_LINKS = new Set([
  "/dashboard",
  "/onboarding",
  "/tienda",
  "/productos",
  "/catalogos",
  "/mi-tiendita",
  "/conexiones-ecommerce",
  "/ventas",
  "/logistica",
  "/avisos",
  "/infraestructura",
  "/clientes",
  "/pagos",
  "/pruebas-ecommerce",
  "/settings",
]);

function requestedTiendaFacilPath() {
  if (typeof window === "undefined") return "";
  const requestedPath = new URLSearchParams(window.location.search).get("next")?.trim() || "";
  return TIENDA_FACIL_DEEP_LINKS.has(requestedPath) ? requestedPath : "";
}

function loginPathForRequestedSection() {
  const requestedPath = requestedTiendaFacilPath();
  if (!requestedPath) return LOGIN_PATH;
  const loginUrl = new URL(LOGIN_PATH, window.location.origin);
  const entryParams = new URLSearchParams({ next: requestedPath });
  loginUrl.searchParams.set("redirectTo", `${TIENDA_FACIL_ENTRY_PATH}?${entryParams.toString()}`);
  return `${loginUrl.pathname}${loginUrl.search}`;
}

function launchUrlForRequestedSection(value: string) {
  const normalizedUrl = normalizeSolutionLaunchUrl(value);
  const requestedPath = requestedTiendaFacilPath();
  if (!requestedPath) return normalizedUrl;
  const launchUrl = new URL(normalizedUrl, window.location.origin);
  launchUrl.pathname = requestedPath;
  return launchUrl.toString();
}

export default function TiendaFacilEntryPage() {
  const router = useRouter();
  const { status, selectCapa } = useAuth();
  const [detail, setDetail] = useState("Preparando tu acceso a BetterP Commerce.");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (status === "loading") return;
    if (status === "anonymous") {
      router.replace(loginPathForRequestedSection());
      return;
    }

    let cancelled = false;
    const launch = async () => {
      try {
        setErrorMessage("");
        setDetail("Preparando tu espacio de trabajo de BetterP Commerce.");
        const response = await fetch(buildApiUrl("/billing/solution-launch/tienda_facil/"), {
          cache: "no-store",
        });
        const body = (await response.json().catch(() => ({}))) as
          | SolutionLaunchResponse
          | { detail?: string };
        if (cancelled) return;
        if (!response.ok) {
          setErrorMessage(
            (body as { detail?: string }).detail ||
              "No encontramos BetterP Commerce disponible para tu usuario."
          );
          return;
        }
        const payload = body as SolutionLaunchResponse;
        selectCapa(payload.capa_negocio.id);
        if (!payload.launch.ready) {
          setErrorMessage(payload.launch.detail || "BetterP Commerce aun no esta listo para tu cuenta.");
          return;
        }
        setDetail(`Abriendo ${payload.solution.nombre} para ${payload.capa_negocio.nombre}.`);
        window.location.assign(launchUrlForRequestedSection(payload.launch.url));
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(
            error instanceof Error
              ? error.message
              : "No pudimos preparar el acceso a BetterP Commerce."
          );
        }
      }
    };

    void launch();
    return () => {
      cancelled = true;
    };
  }, [router, selectCapa, status]);

  return (
    <main className="auth-page solution-entry-page flex min-h-screen items-center justify-center bg-zinc-950 px-5 text-white">
      <section className="solution-entry-card w-full max-w-lg rounded-3xl border border-white/10 bg-zinc-900/70 p-8 shadow-2xl">
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-200">
          Sistema integral de ventas
        </p>
        <h1 className="mt-4 text-3xl font-semibold">Entrando a BetterP Commerce</h1>
        <p className="mt-4 text-sm leading-7 text-zinc-400">{errorMessage || detail}</p>
        {errorMessage ? (
          <button
            type="button"
            onClick={() => router.replace("/dashboard")}
            className="mt-6 rounded-2xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-3 text-sm font-semibold text-cyan-100 transition hover:border-cyan-400/40 hover:bg-cyan-500/15"
          >
            Volver a BetterP
          </button>
        ) : null}
      </section>
    </main>
  );
}
