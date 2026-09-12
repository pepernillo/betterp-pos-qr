"use client";

import { useCallback, useEffect, useState } from "react";

import { posApi, type TicketItem } from "@/lib/pos-api";
import {
  Alert,
  Button,
  Card,
  Empty,
  PageHeader,
  fechaHora,
  inputClass,
  mensajeDeError,
  usePosContexto,
} from "./ui";

type Comanda = TicketItem & {
  ticket_id: number;
  folio: string;
  mesa: string | null;
  solicitado_en: string;
};

const SIGUIENTE: Record<string, { estado: string; etiqueta: string }> = {
  PENDIENTE: { estado: "EN_PREPARACION", etiqueta: "Empezar" },
  EN_PREPARACION: { estado: "SERVIDO", etiqueta: "Servido" },
};

export default function Comandas() {
  const { contexto, cargando } = usePosContexto();
  const [puntoVentaId, setPuntoVentaId] = useState<number | null>(null);
  const [comandas, setComandas] = useState<Comanda[]>([]);
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setError("");
      const { items } = await posApi.comandas(puntoVentaId ?? undefined);
      setComandas(items as Comanda[]);
    } catch (err) {
      setError(mensajeDeError(err, "No pudimos cargar las comandas."));
    }
  }, [puntoVentaId]);

  useEffect(() => {
    void cargar();
    // la cocina necesita ver los pedidos nuevos sin recargar a mano
    const intervalo = setInterval(() => void cargar(), 15000);
    return () => clearInterval(intervalo);
  }, [cargar]);

  const avanzar = async (comanda: Comanda) => {
    const siguiente = SIGUIENTE[comanda.estado];
    if (!siguiente) return;
    setOcupado(true);
    try {
      await posApi.actualizarItem(comanda.ticket_id, comanda.id, { estado: siguiente.estado });
      await cargar();
    } catch (err) {
      setError(mensajeDeError(err));
    } finally {
      setOcupado(false);
    }
  };

  if (cargando) return <p className="text-sm text-zinc-400">Cargando comandas...</p>;

  const restaurantes = (contexto?.puntos_venta ?? []).filter((punto) => punto.es_restaurante);

  return (
    <>
      <PageHeader
        title="Comandas"
        description="Lo que espera cocina, de lo mas antiguo a lo mas reciente. Se actualiza solo."
        action={
          restaurantes.length > 1 ? (
            <select
              value={puntoVentaId ?? ""}
              onChange={(event) =>
                setPuntoVentaId(event.target.value ? Number(event.target.value) : null)
              }
              className={`${inputClass} w-auto min-w-[200px]`}
              aria-label="Punto de venta"
            >
              <option value="">Todas las cajas</option>
              {restaurantes.map((punto) => (
                <option key={punto.id} value={punto.id}>
                  {punto.codigo} - {punto.nombre}
                </option>
              ))}
            </select>
          ) : null
        }
      />

      {error ? <Alert>{error}</Alert> : null}

      <div className="mt-5">
        {comandas.length === 0 ? (
          <Empty>Nada pendiente en cocina.</Empty>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {comandas.map((comanda) => {
              const siguiente = SIGUIENTE[comanda.estado];
              return (
                <Card key={comanda.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-base font-semibold text-white">
                        {Number(comanda.cantidad)} x {comanda.descripcion}
                      </h3>
                      <p className="mt-1 text-xs text-zinc-500">
                        {comanda.mesa ? `Mesa ${comanda.mesa}` : comanda.folio} -{" "}
                        {fechaHora(comanda.solicitado_en)}
                      </p>
                    </div>
                    <span
                      className={`rounded-full border px-2.5 py-1 text-[11px] ${
                        comanda.estado === "PENDIENTE"
                          ? "border-amber-500/25 bg-amber-500/10 text-amber-200"
                          : "border-cyan-500/25 bg-cyan-500/10 text-cyan-200"
                      }`}
                    >
                      {comanda.estado === "PENDIENTE" ? "Pendiente" : "En preparacion"}
                    </span>
                  </div>
                  {comanda.notas ? (
                    <p className="mt-3 rounded-xl bg-zinc-950/60 px-3 py-2 text-sm text-amber-100">
                      {comanda.notas}
                    </p>
                  ) : null}
                  {siguiente ? (
                    <Button className="mt-4" onClick={() => avanzar(comanda)} disabled={ocupado}>
                      {siguiente.etiqueta}
                    </Button>
                  ) : null}
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
