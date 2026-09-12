"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { buildApiUrl } from "@/lib/api";
import {
  posApi,
  type CobroQR,
  type PuntoVenta,
  type Ticket,
} from "@/lib/pos-api";
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
  money,
  usePosContexto,
} from "./ui";

type Producto = {
  id: number;
  nombre: string;
  internal_sku: string;
  precio_base: string;
  categoria: { id: number; nombre: string } | null;
};

const FORMAS_PAGO = [
  { valor: "EFECTIVO", etiqueta: "Efectivo" },
  { valor: "TARJETA", etiqueta: "Tarjeta" },
  { valor: "TRANSFERENCIA", etiqueta: "Transferencia" },
  { valor: "CORTESIA", etiqueta: "Cortesia" },
];

export default function Caja() {
  const { contexto, cargando, error: errorContexto, recargar } = usePosContexto();
  const [puntoVentaId, setPuntoVentaId] = useState<number | null>(null);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [fondoInicial, setFondoInicial] = useState("0");
  const [cobroQr, setCobroQr] = useState<CobroQR | null>(null);
  const [formaPago, setFormaPago] = useState("EFECTIVO");
  const [montoPago, setMontoPago] = useState("");
  const [recibido, setRecibido] = useState("");
  const [propina, setPropina] = useState("");

  const punto: PuntoVenta | null = useMemo(
    () => contexto?.puntos_venta.find((p) => p.id === puntoVentaId) ?? null,
    [contexto, puntoVentaId]
  );

  useEffect(() => {
    if (!contexto || puntoVentaId !== null) return;
    const activo = contexto.puntos_venta.find((p) => p.activo);
    setPuntoVentaId(activo?.id ?? contexto.puntos_venta[0]?.id ?? null);
  }, [contexto, puntoVentaId]);

  // catalogo disponible para la caja
  useEffect(() => {
    let cancelado = false;
    const cargar = async () => {
      try {
        const response = await fetch(buildApiUrl("/catalogo/catalogo/?page_size=100"), {
          cache: "no-store",
        });
        if (!response.ok) return;
        const body = (await response.json()) as { productos?: Producto[] };
        if (!cancelado) setProductos(body.productos ?? []);
      } catch {
        // el catalogo vacio no impide operar la caja
      }
    };
    void cargar();
    return () => {
      cancelado = true;
    };
  }, []);

  const cargarCuentaAbierta = useCallback(async (id: number) => {
    try {
      const { items } = await posApi.tickets({ punto_venta_id: id, estado: "ABIERTO", limit: 1 });
      if (items.length > 0) {
        setTicket(await posApi.ticket(items[0].id));
      } else {
        setTicket(null);
      }
    } catch (err) {
      setError(mensajeDeError(err));
    }
  }, []);

  useEffect(() => {
    if (puntoVentaId) void cargarCuentaAbierta(puntoVentaId);
  }, [cargarCuentaAbierta, puntoVentaId]);

  const ejecutar = async (accion: () => Promise<void>) => {
    setOcupado(true);
    setError("");
    try {
      await accion();
    } catch (err) {
      setError(mensajeDeError(err));
    } finally {
      setOcupado(false);
    }
  };

  const abrirTurno = () =>
    ejecutar(async () => {
      if (!puntoVentaId) return;
      await posApi.abrirTurno({ punto_venta_id: puntoVentaId, fondo_inicial: fondoInicial });
      setAviso("Turno abierto. Ya puedes cobrar.");
      await recargar();
    });

  const abrirCuenta = () =>
    ejecutar(async () => {
      if (!puntoVentaId) return;
      const nuevo = await posApi.crearTicket({ punto_venta_id: puntoVentaId });
      setTicket(nuevo);
      setCobroQr(null);
      setAviso("");
    });

  const agregar = (producto: Producto) =>
    ejecutar(async () => {
      if (!ticket) return;
      setTicket(await posApi.agregarItem(ticket.id, { producto_id: producto.id, cantidad: "1" }));
    });

  const quitar = (itemId: number) =>
    ejecutar(async () => {
      if (!ticket) return;
      setTicket(await posApi.quitarItem(ticket.id, itemId));
    });

  const aplicarPropina = () =>
    ejecutar(async () => {
      if (!ticket) return;
      setTicket(await posApi.ajustarTicket(ticket.id, { propina: propina || "0" }));
    });

  const generarQr = () =>
    ejecutar(async () => {
      if (!ticket) return;
      setCobroQr(await posApi.generarCobroQR(ticket.id, {}));
    });

  const confirmarQr = () =>
    ejecutar(async () => {
      if (!cobroQr || !ticket) return;
      await posApi.confirmarCobroQR(cobroQr.referencia, {});
      setCobroQr(null);
      const actualizado = await posApi.ticket(ticket.id);
      setTicket(actualizado.estado === "ABIERTO" ? actualizado : null);
      setAviso("Cobro por QR confirmado.");
      if (puntoVentaId) await cargarCuentaAbierta(puntoVentaId);
    });

  const cobrar = () =>
    ejecutar(async () => {
      if (!ticket) return;
      const monto = montoPago || ticket.saldo;
      const actualizado = await posApi.registrarPago(ticket.id, {
        forma: formaPago,
        monto,
        recibido: formaPago === "EFECTIVO" && recibido ? recibido : undefined,
      });
      setMontoPago("");
      setRecibido("");
      if (actualizado.estado === "COBRADO") {
        setAviso(`Cuenta ${actualizado.folio} cobrada por ${money(actualizado.total)}.`);
        setTicket(null);
        setCobroQr(null);
      } else {
        setTicket(actualizado);
      }
    });

  if (cargando) {
    return <p className="text-sm text-zinc-400">Cargando la caja...</p>;
  }
  if (errorContexto) {
    return <Alert>{errorContexto}</Alert>;
  }
  if (!contexto || contexto.puntos_venta.length === 0) {
    return (
      <>
        <PageHeader title="Caja" description="Aun no hay un punto de venta configurado." />
        <Empty>
          Da de alta tu primera caja en <strong>Puntos de venta</strong> para empezar a cobrar.
        </Empty>
      </>
    );
  }

  const productosFiltrados = productos.filter((producto) => {
    const texto = busqueda.trim().toLowerCase();
    if (!texto) return true;
    return (
      producto.nombre.toLowerCase().includes(texto) ||
      producto.internal_sku.toLowerCase().includes(texto)
    );
  });

  const turnoAbierto = Boolean(punto?.turno_abierto_id);

  return (
    <>
      <PageHeader
        title="Caja"
        description="Cobra en mostrador, genera el QR de pago y cierra la cuenta."
        action={
          <select
            value={puntoVentaId ?? ""}
            onChange={(event) => {
              setPuntoVentaId(Number(event.target.value));
              setTicket(null);
              setCobroQr(null);
            }}
            className={`${inputClass} w-auto min-w-[200px]`}
            aria-label="Punto de venta"
          >
            {contexto.puntos_venta.map((p) => (
              <option key={p.id} value={p.id}>
                {p.codigo} - {p.nombre}
              </option>
            ))}
          </select>
        }
      />

      {error ? <Alert>{error}</Alert> : null}
      {aviso && !error ? <Alert tone="info">{aviso}</Alert> : null}

      {!turnoAbierto ? (
        <Card title="Abrir turno" className="mt-5 max-w-md">
          <p className="mb-4 text-sm text-zinc-400">
            La caja necesita un turno abierto para registrar ventas. Captura el fondo con el que
            inicias.
          </p>
          <Field label="Fondo inicial">
            <input
              className={inputClass}
              value={fondoInicial}
              onChange={(event) => setFondoInicial(event.target.value)}
              inputMode="decimal"
            />
          </Field>
          <Button className="mt-4" onClick={abrirTurno} disabled={ocupado}>
            Abrir turno
          </Button>
        </Card>
      ) : (
        <div className="mt-5 grid gap-5 lg:grid-cols-[1.2fr_1fr]">
          <Card
            title="Productos"
            action={
              <input
                className={`${inputClass} w-48`}
                placeholder="Buscar"
                value={busqueda}
                onChange={(event) => setBusqueda(event.target.value)}
              />
            }
          >
            {!ticket ? (
              <div className="space-y-4">
                <Empty>No hay una cuenta abierta en esta caja.</Empty>
                <Button onClick={abrirCuenta} disabled={ocupado}>
                  Abrir cuenta
                </Button>
              </div>
            ) : productosFiltrados.length === 0 ? (
              <Empty>Sin productos en el catalogo.</Empty>
            ) : (
              <div className="grid max-h-[460px] gap-2 overflow-y-auto sm:grid-cols-2">
                {productosFiltrados.map((producto) => (
                  <button
                    key={producto.id}
                    type="button"
                    onClick={() => agregar(producto)}
                    disabled={ocupado}
                    className="rounded-2xl border border-white/8 bg-zinc-950/60 px-4 py-3 text-left transition hover:border-cyan-500/30 hover:bg-cyan-500/5 disabled:opacity-50"
                  >
                    <span className="block text-sm font-medium text-zinc-100">
                      {producto.nombre}
                    </span>
                    <span className="mt-1 block text-xs text-zinc-500">
                      {producto.categoria?.nombre || "Sin categoria"}
                    </span>
                    <span className="mt-2 block text-sm font-semibold text-cyan-300">
                      {money(producto.precio_base)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </Card>

          <div className="space-y-5">
            <Card title={ticket ? `Cuenta ${ticket.folio}` : "Cuenta"}>
              {!ticket ? (
                <Empty>Abre una cuenta para empezar a cobrar.</Empty>
              ) : (
                <>
                  {ticket.items && ticket.items.length > 0 ? (
                    <ul className="space-y-2">
                      {ticket.items.map((item) => (
                        <li
                          key={item.id}
                          className="flex items-center justify-between gap-3 rounded-2xl bg-zinc-950/50 px-3 py-2 text-sm"
                        >
                          <span className="flex-1">
                            <span className="block text-zinc-100">{item.descripcion}</span>
                            <span className="text-xs text-zinc-500">
                              {Number(item.cantidad)} x {money(item.precio_unitario)}
                            </span>
                          </span>
                          <span className="font-medium text-zinc-200">{money(item.importe)}</span>
                          <button
                            type="button"
                            onClick={() => quitar(item.id)}
                            disabled={ocupado}
                            className="text-xs text-rose-300 hover:text-rose-200 disabled:opacity-40"
                            aria-label={`Quitar ${item.descripcion}`}
                          >
                            Quitar
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <Empty>Sin productos en la cuenta.</Empty>
                  )}

                  <dl className="mt-4 space-y-1.5 border-t border-white/8 pt-4 text-sm">
                    <div className="flex justify-between text-zinc-400">
                      <dt>Subtotal</dt>
                      <dd>{money(ticket.subtotal)}</dd>
                    </div>
                    {Number(ticket.descuento) > 0 ? (
                      <div className="flex justify-between text-zinc-400">
                        <dt>Descuento</dt>
                        <dd>-{money(ticket.descuento)}</dd>
                      </div>
                    ) : null}
                    {Number(ticket.propina) > 0 ? (
                      <div className="flex justify-between text-zinc-400">
                        <dt>Propina</dt>
                        <dd>{money(ticket.propina)}</dd>
                      </div>
                    ) : null}
                    <div className="flex justify-between text-base font-semibold text-white">
                      <dt>Total</dt>
                      <dd>{money(ticket.total)}</dd>
                    </div>
                    {Number(ticket.pagado) > 0 ? (
                      <div className="flex justify-between text-cyan-300">
                        <dt>Saldo</dt>
                        <dd>{money(ticket.saldo)}</dd>
                      </div>
                    ) : null}
                  </dl>

                  {contexto.capacidades.propinas ? (
                    <div className="mt-4 flex items-end gap-2">
                      <Field label="Propina">
                        <input
                          className={inputClass}
                          value={propina}
                          onChange={(event) => setPropina(event.target.value)}
                          inputMode="decimal"
                          placeholder="0.00"
                        />
                      </Field>
                      <Button variant="ghost" onClick={aplicarPropina} disabled={ocupado}>
                        Aplicar
                      </Button>
                    </div>
                  ) : null}
                </>
              )}
            </Card>

            {ticket && Number(ticket.total) > 0 ? (
              <Card title="Cobrar">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Forma de pago">
                    <select
                      className={inputClass}
                      value={formaPago}
                      onChange={(event) => setFormaPago(event.target.value)}
                    >
                      {FORMAS_PAGO.map((forma) => (
                        <option key={forma.valor} value={forma.valor}>
                          {forma.etiqueta}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field
                    label="Monto"
                    hint={
                      contexto.capacidades.cuenta_dividida
                        ? "Dejalo vacio para cobrar el saldo completo."
                        : undefined
                    }
                  >
                    <input
                      className={inputClass}
                      value={montoPago}
                      onChange={(event) => setMontoPago(event.target.value)}
                      inputMode="decimal"
                      placeholder={ticket.saldo}
                    />
                  </Field>
                  {formaPago === "EFECTIVO" ? (
                    <Field label="Recibido" hint="Para calcular el cambio.">
                      <input
                        className={inputClass}
                        value={recibido}
                        onChange={(event) => setRecibido(event.target.value)}
                        inputMode="decimal"
                      />
                    </Field>
                  ) : null}
                </div>
                <div className="mt-4 flex flex-wrap gap-3">
                  <Button onClick={cobrar} disabled={ocupado}>
                    Registrar pago
                  </Button>
                  {punto?.acepta_cobro_qr ? (
                    <Button variant="ghost" onClick={generarQr} disabled={ocupado}>
                      Cobrar con QR
                    </Button>
                  ) : null}
                </div>
              </Card>
            ) : null}

            {cobroQr ? (
              <Card title="Cobro por QR">
                <div className="flex flex-col items-center gap-4">
                  <QrCode value={cobroQr.qr_payload} />
                  <p className="text-center text-sm text-zinc-400">
                    El cliente escanea y paga {money(cobroQr.monto)}. Referencia{" "}
                    <span className="font-mono text-zinc-300">{cobroQr.referencia}</span>.
                  </p>
                  <Button onClick={confirmarQr} disabled={ocupado}>
                    Confirmar pago recibido
                  </Button>
                </div>
              </Card>
            ) : null}
          </div>
        </div>
      )}
    </>
  );
}
