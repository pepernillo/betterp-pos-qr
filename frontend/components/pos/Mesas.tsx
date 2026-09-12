"use client";

import { useEffect, useMemo, useState } from "react";

import { posApi, type Mesa } from "@/lib/pos-api";
import {
  Alert,
  Button,
  Card,
  Empty,
  Field,
  PageHeader,
  QrCode,
  inputClass,
  mensajeDeError,
  usePosContexto,
} from "./ui";

const ESTADOS: Record<Mesa["estado"], { etiqueta: string; clase: string }> = {
  LIBRE: { etiqueta: "Libre", clase: "border-emerald-500/25 bg-emerald-500/10 text-emerald-200" },
  OCUPADA: { etiqueta: "Ocupada", clase: "border-amber-500/25 bg-amber-500/10 text-amber-200" },
  CUENTA: { etiqueta: "Pidio cuenta", clase: "border-cyan-500/25 bg-cyan-500/10 text-cyan-200" },
};

export default function Mesas() {
  const { contexto, cargando, error: errorContexto, recargar } = usePosContexto();
  const [puntoVentaId, setPuntoVentaId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [nombre, setNombre] = useState("");
  const [zona, setZona] = useState("");
  const [capacidad, setCapacidad] = useState("4");
  const [mesaQr, setMesaQr] = useState<Mesa | null>(null);
  const [origen, setOrigen] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined") setOrigen(window.location.origin);
  }, []);

  const restaurantes = useMemo(
    () => (contexto?.puntos_venta ?? []).filter((punto) => punto.es_restaurante),
    [contexto]
  );

  useEffect(() => {
    if (puntoVentaId === null && restaurantes.length > 0) {
      setPuntoVentaId(restaurantes[0].id);
    }
  }, [puntoVentaId, restaurantes]);

  const punto = restaurantes.find((p) => p.id === puntoVentaId) ?? null;

  const crear = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!puntoVentaId) return;
    setOcupado(true);
    setError("");
    try {
      await posApi.crearMesa(puntoVentaId, {
        nombre: nombre.trim(),
        zona: zona.trim(),
        capacidad: Number(capacidad) || 4,
      });
      setNombre("");
      setZona("");
      await recargar();
    } catch (err) {
      setError(mensajeDeError(err));
    } finally {
      setOcupado(false);
    }
  };

  const cambiarEstado = async (mesa: Mesa, estado: Mesa["estado"]) => {
    setOcupado(true);
    try {
      await posApi.actualizarMesa(mesa.id, { estado });
      await recargar();
    } catch (err) {
      setError(mensajeDeError(err));
    } finally {
      setOcupado(false);
    }
  };

  if (cargando) return <p className="text-sm text-zinc-400">Cargando mesas...</p>;
  if (errorContexto) return <Alert>{errorContexto}</Alert>;

  if (restaurantes.length === 0) {
    return (
      <>
        <PageHeader title="Mesas" description="Ningun punto de venta esta configurado como restaurante." />
        <Empty>
          Cambia el tipo de servicio de una caja a <strong>Restaurante</strong> en Puntos de venta
          para administrar mesas.
        </Empty>
      </>
    );
  }

  const mesas = punto?.mesas ?? [];
  const urlMenu = mesaQr && origen ? `${origen}/menu/${mesaQr.qr_token}` : "";

  return (
    <>
      <PageHeader
        title="Mesas"
        description="Estado de cada mesa y su codigo QR para que el comensal abra el menu."
        action={
          restaurantes.length > 1 ? (
            <select
              value={puntoVentaId ?? ""}
              onChange={(event) => {
                setPuntoVentaId(Number(event.target.value));
                setMesaQr(null);
              }}
              className={`${inputClass} w-auto min-w-[200px]`}
              aria-label="Punto de venta"
            >
              {restaurantes.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.codigo} - {p.nombre}
                </option>
              ))}
            </select>
          ) : null
        }
      />

      {error ? <Alert>{error}</Alert> : null}
      {punto && !punto.menu_qr_activo ? (
        <Alert tone="info">
          El menu por QR esta desactivado en esta caja. Actívalo en Puntos de venta para que los
          codigos funcionen.
        </Alert>
      ) : null}

      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_340px]">
        <Card title={`Mesas (${mesas.length})`}>
          {mesas.length === 0 ? (
            <Empty>Sin mesas dadas de alta.</Empty>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {mesas.map((mesa) => {
                const estado = ESTADOS[mesa.estado];
                return (
                  <article
                    key={mesa.id}
                    className="rounded-2xl border border-white/8 bg-zinc-950/50 p-4"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="text-base font-semibold text-white">{mesa.nombre}</h3>
                        <p className="text-xs text-zinc-500">
                          {mesa.zona || "Sin zona"} - {mesa.capacidad} lugares
                        </p>
                      </div>
                      <span
                        className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${estado.clase}`}
                      >
                        {estado.etiqueta}
                      </span>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2 text-xs">
                      <button
                        type="button"
                        onClick={() => setMesaQr(mesa)}
                        className="rounded-xl border border-cyan-500/25 bg-cyan-500/10 px-3 py-1.5 font-medium text-cyan-200"
                      >
                        Ver QR
                      </button>
                      {mesa.estado !== "LIBRE" ? (
                        <button
                          type="button"
                          onClick={() => cambiarEstado(mesa, "LIBRE")}
                          disabled={ocupado}
                          className="rounded-xl border border-white/10 px-3 py-1.5 text-zinc-300 disabled:opacity-40"
                        >
                          Liberar
                        </button>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </Card>

        <div className="space-y-5">
          {mesaQr ? (
            <Card title={`QR de ${mesaQr.nombre}`}>
              <div className="flex flex-col items-center gap-3">
                <QrCode value={urlMenu} />
                <p className="break-all text-center text-xs text-zinc-500">{urlMenu}</p>
                <p className="text-center text-xs text-zinc-400">
                  Imprime este codigo y colocalo en la mesa.
                </p>
              </div>
            </Card>
          ) : null}

          <Card title="Nueva mesa">
            <form onSubmit={crear} className="space-y-3">
              <Field label="Nombre">
                <input
                  className={inputClass}
                  value={nombre}
                  onChange={(event) => setNombre(event.target.value)}
                  placeholder="M1"
                  required
                />
              </Field>
              <Field label="Zona">
                <input
                  className={inputClass}
                  value={zona}
                  onChange={(event) => setZona(event.target.value)}
                  placeholder="Terraza"
                />
              </Field>
              <Field label="Capacidad">
                <input
                  className={inputClass}
                  value={capacidad}
                  onChange={(event) => setCapacidad(event.target.value)}
                  inputMode="numeric"
                />
              </Field>
              <Button type="submit" disabled={ocupado}>
                Agregar mesa
              </Button>
            </form>
          </Card>
        </div>
      </div>
    </>
  );
}
