"use client";

import { useCallback, useEffect, useState } from "react";

import { posApi, type ReporteVenta } from "@/lib/pos-api";
import {
  Alert,
  Button,
  Card,
  Empty,
  Field,
  PageHeader,
  inputClass,
  mensajeDeError,
  money,
  usePosContexto,
} from "./ui";

function hoy() {
  return new Date().toISOString().slice(0, 10);
}

function haceDias(dias: number) {
  const fecha = new Date();
  fecha.setDate(fecha.getDate() - dias);
  return fecha.toISOString().slice(0, 10);
}

export default function Reportes() {
  const { contexto } = usePosContexto();
  const [desde, setDesde] = useState(haceDias(30));
  const [hasta, setHasta] = useState(hoy());
  const [puntoVentaId, setPuntoVentaId] = useState("");
  const [reporte, setReporte] = useState<ReporteVenta | null>(null);
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    setOcupado(true);
    setError("");
    try {
      setReporte(
        await posApi.reporteVenta({
          desde,
          hasta,
          punto_venta_id: puntoVentaId || undefined,
        })
      );
    } catch (err) {
      setError(mensajeDeError(err, "No pudimos generar el reporte."));
    } finally {
      setOcupado(false);
    }
  }, [desde, hasta, puntoVentaId]);

  useEffect(() => {
    void cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <PageHeader
        title="Reportes de venta"
        description="Venta del periodo por forma de pago y por producto."
      />

      {error ? <Alert>{error}</Alert> : null}

      <Card className="mt-5">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void cargar();
          }}
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        >
          <Field label="Desde">
            <input
              type="date"
              className={inputClass}
              value={desde}
              onChange={(event) => setDesde(event.target.value)}
            />
          </Field>
          <Field label="Hasta">
            <input
              type="date"
              className={inputClass}
              value={hasta}
              onChange={(event) => setHasta(event.target.value)}
            />
          </Field>
          <Field label="Caja">
            <select
              className={inputClass}
              value={puntoVentaId}
              onChange={(event) => setPuntoVentaId(event.target.value)}
            >
              <option value="">Todas</option>
              {(contexto?.puntos_venta ?? []).map((punto) => (
                <option key={punto.id} value={punto.id}>
                  {punto.codigo} - {punto.nombre}
                </option>
              ))}
            </select>
          </Field>
          <div className="flex items-end">
            <Button type="submit" disabled={ocupado} className="w-full">
              Generar
            </Button>
          </div>
        </form>
      </Card>

      {reporte ? (
        <>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { etiqueta: "Tickets", valor: String(reporte.tickets) },
              { etiqueta: "Venta total", valor: money(reporte.venta_total) },
              { etiqueta: "Ticket promedio", valor: money(reporte.ticket_promedio) },
              { etiqueta: "Propinas", valor: money(reporte.propinas) },
            ].map((dato) => (
              <Card key={dato.etiqueta}>
                <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">{dato.etiqueta}</p>
                <p className="mt-2 text-2xl font-semibold text-white">{dato.valor}</p>
              </Card>
            ))}
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <Card title="Por forma de pago">
              {reporte.por_forma_pago.length === 0 ? (
                <Empty>Sin cobros en el periodo.</Empty>
              ) : (
                <ul className="space-y-2 text-sm">
                  {reporte.por_forma_pago.map((fila) => (
                    <li key={fila.forma} className="flex justify-between">
                      <span className="text-zinc-400">
                        {fila.forma} ({fila.operaciones})
                      </span>
                      <span className="text-zinc-100">{money(fila.monto)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="Productos mas vendidos">
              {reporte.por_producto.length === 0 ? (
                <Empty>Sin ventas en el periodo.</Empty>
              ) : (
                <ul className="space-y-2 text-sm">
                  {reporte.por_producto.slice(0, 12).map((fila) => (
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
        </>
      ) : null}
    </>
  );
}
