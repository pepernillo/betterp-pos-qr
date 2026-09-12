"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { buildApiUrl } from "@/lib/api";
import { normalizeSolutionLaunchUrl, solutionLoginPath } from "@/lib/solution-launch";

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

const LOGIN_PATH = solutionLoginPath("renta_facil");

export default function RentaFacilEntryPage() {
  const router = useRouter();
  const { status, selectCapa } = useAuth();
  const [detail, setDetail] = useState("Preparando tu acceso a Renta Facil.");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (status === "loading") return;
    if (status === "anonymous") {
      router.replace(LOGIN_PATH);
      return;
    }

    let cancelled = false;
    const launch = async () => {
      try {
        setErrorMessage("");
        setDetail("Preparando tu espacio de trabajo de Renta Facil.");
        const response = await fetch(buildApiUrl("/billing/solution-launch/renta_facil/"), {
          cache: "no-store",
        });
        const body = (await response.json().catch(() => ({}))) as
          | SolutionLaunchResponse
          | { detail?: string };
        if (cancelled) return;
        if (!response.ok) {
          setErrorMessage(
            (body as { detail?: string }).detail ||
              "No encontramos Renta Facil disponible para tu usuario."
          );
          return;
        }
        const payload = body as SolutionLaunchResponse;
        selectCapa(payload.capa_negocio.id);
        if (!payload.launch.ready) {
          setErrorMessage(payload.launch.detail || "Renta Facil aun no esta lista para tu cuenta.");
          return;
        }
        setDetail(`Abriendo ${payload.solution.nombre} para ${payload.capa_negocio.nombre}.`);
        window.location.assign(normalizeSolutionLaunchUrl(payload.launch.url));
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(
            error instanceof Error
              ? error.message
              : "No pudimos preparar el acceso a Renta Facil."
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
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-200">
          BetterP | Renta Facil
        </p>
        <h1 className="mt-4 text-3xl font-semibold">Entrando a Renta Facil</h1>
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
