"use client";

import { useCallback, useEffect, useState } from "react";

import { posApi, type Corte as CorteData, type Turno } from "@/lib/pos-api";
import {
  Alert,
  Button,
  Card,
  Empty,
  Field,
  PageHeader,
  fechaHora,
  inputClass,
  mensajeDeError,
  money,
  usePosContexto,
} from "./ui";

export default function Corte() {
  const { contexto, cargando, error: errorContexto, recargar } = usePosContexto();
  const [puntoVentaId, setPuntoVentaId] = useState<number | null>(null);
  const [turno, setTurno] = useState<Turno | null>(null);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [efectivo, setEfectivo] = useState("");
  const [notas, setNotas] = useState("");

  useEffect(() => {
    if (!contexto || puntoVentaId !== null) return;
    const conTurno = contexto.puntos_venta.find((punto) => punto.turno_abierto_id);
    setPuntoVentaId(conTurno?.id ?? contexto.puntos_venta[0]?.id ?? null);
  }, [contexto, puntoVentaId]);

  const punto = contexto?.puntos_venta.find((p) => p.id === puntoVentaId) ?? null;

  const cargarCorte = useCallback(async (turnoId: number) => {
    try {
      setError("");
      setTurno(await posApi.corte(turnoId));
    } catch (err) {
      setError(mensajeDeError(err, "No pudimos cargar el corte."));
    }
  }, []);

  useEffect(() => {
    if (punto?.turno_abierto_id) {
      void cargarCorte(punto.turno_abierto_id);
    } else {
      setTurno(null);
    }
  }, [cargarCorte, punto]);

  const cerrar = async () => {
    if (!turno) return;
    setOcupado(true);
    setError("");
    try {
      const cerrado = await posApi.cerrarTurno(turno.id, {
        efectivo_declarado: efectivo || undefined,
        notas: notas || undefined,
      });
      setTurno(cerrado);
      setAviso("Turno cerrado. El corte quedo registrado.");
      await recargar();
    } catch (err) {
      setError(mensajeDeError(err));
    } finally {
      setOcupado(false);
    }
  };

  if (cargando) return <p className="text-sm text-zinc-400">Cargando corte...</p>;
  if (errorContexto) return <Alert>{errorContexto}</Alert>;

  const corte = (turno?.corte ?? {}) as Partial<CorteData>;
  const diferencia = corte.diferencia ? Number(corte.diferencia) : null;

  return (
    <>
      <PageHeader
        title="Corte de caja"
        description="Totales del turno por forma de pago y cuadre del efectivo."
        action={
          (contexto?.puntos_venta.length ?? 0) > 1 ? (
            <select
              value={puntoVentaId ?? ""}
              onChange={(event) => setPuntoVentaId(Number(event.target.value))}
              className={`${inputClass} w-auto min-w-[200px]`}
              aria-label="Punto de venta"
            >
              {contexto?.puntos_venta.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.codigo} - {p.nombre}
                </option>
              ))}
            </select>
          ) : null
        }
      />

      {error ? <Alert>{error}</Alert> : null}
      {aviso && !error ? <Alert tone="info">{aviso}</Alert> : null}

      {!turno ? (
        <Empty>
          Esta caja no tiene un turno abierto. Abre uno desde la caja para empezar a registrar
          ventas.
        </Empty>
      ) : (
        <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_340px]">
          <Card title={`Turno ${turno.id} - ${turno.estado === "ABIERTO" ? "abierto" : "cerrado"}`}>
            <dl className="grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs uppercase tracking-[0.14em] text-zinc-500">Apertura</dt>
                <dd className="mt-1 text-sm text-zinc-200">{fechaHora(turno.fecha_apertura)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-[0.14em] text-zinc-500">Cierre</dt>
                <dd className="mt-1 text-sm text-zinc-200">
                  {turno.fecha_cierre ? fechaHora(turno.fecha_cierre) : "En curso"}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-[0.14em] text-zinc-500">
                  Tickets cobrados
                </dt>
                <dd className="mt-1 text-sm text-zinc-200">{corte.tickets_cobrados ?? 0}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-[0.14em] text-zinc-500">
                  Cuentas abiertas
                </dt>
                <dd className="mt-1 text-sm text-zinc-200">{corte.tickets_abiertos ?? 0}</dd>
              </div>
            </dl>

            <div className="mt-6 border-t border-white/8 pt-5">
              <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-zinc-400">
                Por forma de pago
              </h3>
              {corte.por_forma_pago && Object.keys(corte.por_forma_pago).length > 0 ? (
                <ul className="mt-3 space-y-2 text-sm">
                  {Object.entries(corte.por_forma_pago).map(([forma, datos]) => (
                    <li key={forma} className="flex justify-between">
                      <span className="text-zinc-400">
                        {forma} ({datos.operaciones})
                      </span>
                      <span className="text-zinc-100">{money(datos.monto)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-zinc-500">Sin cobros en el turno.</p>
              )}
            </div>

            <dl className="mt-6 space-y-1.5 border-t border-white/8 pt-5 text-sm">
              <div className="flex justify-between text-zinc-400">
                <dt>Subtotal</dt>
                <dd>{money(corte.subtotal)}</dd>
              </div>
              <div className="flex justify-between text-zinc-400">
                <dt>Descuentos</dt>
                <dd>-{money(corte.descuentos)}</dd>
              </div>
              <div className="flex justify-between text-zinc-400">
                <dt>Propinas</dt>
                <dd>{money(corte.propinas)}</dd>
              </div>
              <div className="flex justify-between text-base font-semibold text-white">
                <dt>Venta total</dt>
                <dd>{money(corte.venta_total)}</dd>
              </div>
            </dl>
          </Card>

          <Card title="Cuadre de efectivo">
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between text-zinc-400">
                <dt>Fondo inicial</dt>
                <dd>{money(corte.fondo_inicial ?? turno.fondo_inicial)}</dd>
              </div>
              <div className="flex justify-between text-zinc-400">
                <dt>Efectivo esperado</dt>
                <dd>{money(corte.efectivo_esperado)}</dd>
              </div>
              {corte.efectivo_declarado ? (
                <div className="flex justify-between text-zinc-400">
                  <dt>Declarado</dt>
                  <dd>{money(corte.efectivo_declarado)}</dd>
                </div>
              ) : null}
              {diferencia !== null ? (
                <div
                  className={`flex justify-between font-semibold ${
                    diferencia === 0
                      ? "text-emerald-300"
                      : diferencia < 0
                        ? "text-rose-300"
                        : "text-amber-300"
                  }`}
                >
                  <dt>Diferencia</dt>
                  <dd>{money(diferencia)}</dd>
                </div>
              ) : null}
            </dl>

            {turno.estado === "ABIERTO" ? (
              <div className="mt-5 space-y-3 border-t border-white/8 pt-5">
                <Field label="Efectivo contado" hint="Lo que hay fisicamente en la caja.">
                  <input
                    className={inputClass}
                    value={efectivo}
                    onChange={(event) => setEfectivo(event.target.value)}
                    inputMode="decimal"
                  />
                </Field>
                <Field label="Notas">
                  <textarea
                    className={`${inputClass} min-h-[70px]`}
                    value={notas}
                    onChange={(event) => setNotas(event.target.value)}
                  />
                </Field>
                <Button onClick={cerrar} disabled={ocupado}>
                  Cerrar turno
                </Button>
                {(corte.tickets_abiertos ?? 0) > 0 ? (
                  <p className="text-xs text-amber-200">
                    Hay {corte.tickets_abiertos} cuenta(s) abierta(s); ciérralas antes del corte.
                  </p>
                ) : null}
              </div>
            ) : null}
          </Card>
        </div>
      )}
    </>
  );
}
