"use client";

import { useCallback, useEffect, useState } from "react";

import { posPublicApi } from "@/lib/pos-api";
import { mensajeDeError, money } from "./ui";

type Cobro = Awaited<ReturnType<typeof posPublicApi.cobro>>;

const ESTADOS: Record<string, { titulo: string; detalle: string; clase: string }> = {
  PENDIENTE: {
    titulo: "Pago pendiente",
    detalle: "Completa la transferencia con la referencia de abajo.",
    clase: "border-amber-500/25 bg-amber-500/10 text-amber-100",
  },
  PAGADO: {
    titulo: "Pago recibido",
    detalle: "Tu cuenta quedo saldada. Gracias.",
    clase: "border-emerald-500/25 bg-emerald-500/10 text-emerald-100",
  },
  EXPIRADO: {
    titulo: "Cobro expirado",
    detalle: "Pide en caja que generen un codigo nuevo.",
    clase: "border-zinc-600/40 bg-zinc-800/40 text-zinc-300",
  },
  CANCELADO: {
    titulo: "Cobro cancelado",
    detalle: "Este cobro ya no esta vigente.",
    clase: "border-rose-500/25 bg-rose-500/10 text-rose-100",
  },
};

export default function CobroPublico({ referencia }: { referencia: string }) {
  const [cobro, setCobro] = useState<Cobro | null>(null);
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    try {
      setCobro(await posPublicApi.cobro(referencia));
    } catch (err) {
      setError(mensajeDeError(err, "No encontramos este cobro."));
    }
  }, [referencia]);

  useEffect(() => {
    void cargar();
    // el cliente deja la pantalla abierta mientras la caja confirma
    const intervalo = setInterval(() => void cargar(), 10000);
    return () => clearInterval(intervalo);
  }, [cargar]);

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-5 text-center text-sm text-zinc-300">
        {error}
      </main>
    );
  }

  if (!cobro) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 text-sm text-zinc-400">
        Consultando el cobro...
      </main>
    );
  }

  const estado = ESTADOS[cobro.estado] ?? ESTADOS.PENDIENTE;

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-5 py-10 text-zinc-100">
      <section className="w-full max-w-md rounded-3xl border border-white/10 bg-zinc-900/70 p-7 text-center">
        <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">{cobro.negocio}</p>
        <p className="mt-5 text-4xl font-semibold text-white">
          {money(cobro.monto, cobro.moneda)}
        </p>
        <p className="mt-2 text-sm text-zinc-400">Cuenta {cobro.folio}</p>

        <div className={`mt-6 rounded-2xl border px-4 py-4 text-sm ${estado.clase}`}>
          <p className="font-semibold">{estado.titulo}</p>
          <p className="mt-1 leading-6">{estado.detalle}</p>
        </div>

        {cobro.estado === "PENDIENTE" ? (
          <dl className="mt-6 space-y-2 text-left text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-zinc-500">Metodo</dt>
              <dd className="text-zinc-200">{cobro.metodo}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-zinc-500">Referencia</dt>
              <dd className="font-mono text-zinc-200">{cobro.referencia}</dd>
            </div>
          </dl>
        ) : null}

        <p className="mt-6 text-xs text-zinc-600">
          Esta pantalla se actualiza sola cuando la caja confirma el pago.
        </p>
      </section>
    </main>
  );
}
