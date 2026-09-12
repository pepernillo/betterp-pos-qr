"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { posApi, type ReporteVenta, type Ticket } from "@/lib/pos-api";
import { POS_NAV } from "@/lib/pos-segment";
import {
  Alert,
  Card,
  Empty,
  PageHeader,
  fechaHora,
  mensajeDeError,
  money,
  usePosContexto,
} from "./ui";

function hoy() {
  return new Date().toISOString().slice(0, 10);
}

export default function Tablero() {
  const { contexto, cargando, error: errorContexto } = usePosContexto();
  const [reporte, setReporte] = useState<ReporteVenta | null>(null);
  const [abiertas, setAbiertas] = useState<Ticket[]>([]);
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    try {
      setError("");
      const [venta, cuentas] = await Promise.all([
        posApi.reporteVenta({ desde: hoy(), hasta: hoy() }),
        posApi.tickets({ estado: "ABIERTO", limit: 8 }),
      ]);
      setReporte(venta);
      setAbiertas(cuentas.items);
    } catch (err) {
      setError(mensajeDeError(err, "No pudimos cargar el resumen del dia."));
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (cargando) return <p className="text-sm text-zinc-400">Cargando el tablero...</p>;
  if (errorContexto) return <Alert>{errorContexto}</Alert>;

  const cajasAbiertas = (contexto?.puntos_venta ?? []).filter((p) => p.turno_abierto_id);

  return (
    <>
      <PageHeader
        title="Tablero de venta"
        description="Como va el dia: venta cobrada, cuentas abiertas y estado de las cajas."
      />

      {error ? <Alert>{error}</Alert> : null}

      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { etiqueta: "Venta de hoy", valor: money(reporte?.venta_total) },
          { etiqueta: "Tickets", valor: String(reporte?.tickets ?? 0) },
          { etiqueta: "Ticket promedio", valor: money(reporte?.ticket_promedio) },
          {
            etiqueta: "Cajas abiertas",
            valor: `${cajasAbiertas.length} / ${contexto?.puntos_venta.length ?? 0}`,
          },
        ].map((dato) => (
          <Card key={dato.etiqueta}>
            <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">{dato.etiqueta}</p>
            <p className="mt-2 text-2xl font-semibold text-white">{dato.valor}</p>
          </Card>
        ))}
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card
          title="Cuentas abiertas"
          action={
            <Link href={POS_NAV.caja} className="text-xs text-cyan-300 hover:text-cyan-200">
              Ir a la caja
            </Link>
          }
        >
          {abiertas.length === 0 ? (
            <Empty>Ninguna cuenta abierta en este momento.</Empty>
          ) : (
            <ul className="divide-y divide-white/6 text-sm">
              {abiertas.map((ticket) => (
                <li key={ticket.id} className="flex items-center justify-between gap-3 py-2.5">
                  <span>
                    <span className="block text-zinc-200">
                      {ticket.folio}
                      {ticket.mesa_nombre ? ` - mesa ${ticket.mesa_nombre}` : ""}
                    </span>
                    <span className="text-xs text-zinc-500">
                      {ticket.punto_venta_codigo} - {fechaHora(ticket.fecha_creacion)}
                    </span>
                  </span>
                  <span className="text-zinc-100">{money(ticket.total)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Mas vendido hoy"
          action={
            <Link href={POS_NAV.reportes} className="text-xs text-cyan-300 hover:text-cyan-200">
              Ver reportes
            </Link>
          }
        >
          {!reporte || reporte.por_producto.length === 0 ? (
            <Empty>Aun no hay ventas cobradas hoy.</Empty>
          ) : (
            <ul className="space-y-2 text-sm">
              {reporte.por_producto.slice(0, 8).map((fila) => (
                <li key={fila.producto_id} className="flex justify-between gap-3">
                  <span className="flex-1 text-zinc-300">{fila.producto}</span>
                  <span className="text-zinc-500">{Number(fila.cantidad)}</span>
                  <span className="text-zinc-100">{money(fila.importe)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {(contexto?.puntos_venta.length ?? 0) === 0 ? (
        <Card className="mt-5" title="Para empezar">
          <ol className="space-y-2 text-sm text-zinc-300">
            <li>
              1. Crea una bodega en{" "}
              <Link href={POS_NAV.inventario} className="text-cyan-300 hover:underline">
                Inventario
              </Link>
              .
            </li>
            <li>
              2. Da de alta tu caja en{" "}
              <Link href={POS_NAV.cajas} className="text-cyan-300 hover:underline">
                Puntos de venta
              </Link>
              .
            </li>
            <li>
              3. Carga tus{" "}
              <Link href={POS_NAV.productos} className="text-cyan-300 hover:underline">
                productos
              </Link>{" "}
              y abre turno.
            </li>
          </ol>
        </Card>
      ) : null}
    </>
  );
}
