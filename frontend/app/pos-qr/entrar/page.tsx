"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import { buildApiUrl } from "@/lib/api";
import {
  CAJA_PATH,
  SEGMENT_ENTRY_PATH,
  SEGMENT_PATH,
  SOLUTION_KEY,
  normalizeLaunchUrl,
  requestedDeepLink,
  segmentLoginPath,
} from "@/lib/pos-segment";

type SolutionLaunchResponse = {
  solution: { clave: string; nombre: string };
  capa_negocio: { id: number; nombre: string };
  subscription: { id: number; estatus: string };
  launch: { mode: string; ready: boolean; url: string; detail: string };
};

/**
 * Entrada al segmento POS QR.
 *
 * Si no hay sesion manda al login conservando el destino; si la hay, pregunta
 * al backend por la capa y el plan del usuario y abre la caja correspondiente.
 */
export default function PosQrEntryPage() {
  const router = useRouter();
  const { status, selectCapa } = useAuth();
  const [detalle, setDetalle] = useState("Preparando tu acceso al punto de venta.");
  const [error, setError] = useState("");

  const loginPath = useCallback(() => {
    if (typeof window === "undefined") return segmentLoginPath();
    const deepLink = requestedDeepLink(window.location.search);
    const destino = deepLink
      ? `${SEGMENT_ENTRY_PATH}?next=${encodeURIComponent(deepLink)}`
      : SEGMENT_ENTRY_PATH;
    return segmentLoginPath(destino);
  }, []);

  useEffect(() => {
    if (status === "loading") return;
    if (status === "anonymous") {
      router.replace(loginPath());
      return;
    }

    let cancelado = false;
    const abrir = async () => {
      try {
        setError("");
        const response = await fetch(
          buildApiUrl(`/billing/solution-launch/${SOLUTION_KEY}/`),
          { cache: "no-store" }
        );
        const body = (await response.json().catch(() => ({}))) as
          | SolutionLaunchResponse
          | { detail?: string };
        if (cancelado) return;

        if (!response.ok) {
          setError(
            (body as { detail?: string }).detail ||
              "No encontramos una caja disponible para tu usuario."
          );
          return;
        }

        const payload = body as SolutionLaunchResponse;
        selectCapa(payload.capa_negocio.id);

        if (!payload.launch.ready) {
          setError(payload.launch.detail || "Tu plan aun no incluye el modulo de caja.");
          return;
        }

        const deepLink = requestedDeepLink(window.location.search);
        setDetalle(`Abriendo la caja de ${payload.capa_negocio.nombre}.`);
        router.replace(deepLink || normalizeLaunchUrl(payload.launch.url) || CAJA_PATH);
      } catch (err) {
        if (!cancelado) {
          setError(
            err instanceof Error ? err.message : "No pudimos preparar tu acceso al punto de venta."
          );
        }
      }
    };

    void abrir();
    return () => {
      cancelado = true;
    };
  }, [loginPath, router, selectCapa, status]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-5 text-white">
      <section className="w-full max-w-lg rounded-3xl border border-white/10 bg-zinc-900/70 p-8 shadow-2xl">
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-300">
          Punto de venta QR
        </p>
        <h1 className="mt-4 text-3xl font-semibold">Entrando a tu caja</h1>
        <p className="mt-4 text-sm leading-7 text-zinc-400">{error || detalle}</p>
        {error ? (
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => router.replace("/dashboard")}
              className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-3 text-sm font-semibold text-cyan-100 transition hover:border-cyan-400/40 hover:bg-cyan-500/15"
            >
              Ir al tablero
            </button>
            <button
              type="button"
              onClick={() => router.replace(SEGMENT_PATH)}
              className="rounded-2xl border border-white/10 px-4 py-3 text-sm font-semibold text-zinc-300 transition hover:border-white/25 hover:text-white"
            >
              Ver planes
            </button>
          </div>
        ) : null}
      </section>
    </main>
  );
}
