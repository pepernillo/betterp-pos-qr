"use client";

import { useEffect, useMemo, useState } from "react";

import { posPublicApi } from "@/lib/pos-api";
import { SOURCE_URL } from "@/lib/pos-segment";
import { mensajeDeError, money } from "./ui";

type Menu = Awaited<ReturnType<typeof posPublicApi.menu>>;

export default function MenuPublico({ token }: { token: string }) {
  const [menu, setMenu] = useState<Menu | null>(null);
  const [cantidades, setCantidades] = useState<Record<number, number>>({});
  const [notas, setNotas] = useState<Record<number, string>>({});
  const [error, setError] = useState("");
  const [enviado, setEnviado] = useState<{ folio: string; total: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    let cancelado = false;
    posPublicApi
      .menu(token)
      .then((data) => {
        if (!cancelado) setMenu(data);
      })
      .catch((err) => {
        if (!cancelado) setError(mensajeDeError(err, "Este menu no esta disponible."));
      });
    return () => {
      cancelado = true;
    };
  }, [token]);

  const total = useMemo(() => {
    if (!menu) return 0;
    return menu.categorias
      .flatMap((categoria) => categoria.productos)
      .reduce(
        (suma, producto) => suma + (cantidades[producto.id] ?? 0) * Number(producto.precio),
        0
      );
  }, [cantidades, menu]);

  const cambiar = (productoId: number, delta: number) => {
    setCantidades((actual) => {
      const nuevo = Math.max(0, (actual[productoId] ?? 0) + delta);
      return { ...actual, [productoId]: nuevo };
    });
  };

  const enviar = async () => {
    if (!menu) return;
    const items = Object.entries(cantidades)
      .filter(([, cantidad]) => cantidad > 0)
      .map(([id, cantidad]) => ({
        producto_id: Number(id),
        cantidad: String(cantidad),
        notas: notas[Number(id)] || "",
      }));
    if (items.length === 0) return;
    setOcupado(true);
    setError("");
    try {
      const respuesta = await posPublicApi.pedido(token, { items });
      setEnviado({ folio: respuesta.folio, total: respuesta.total });
      setCantidades({});
      setNotas({});
    } catch (err) {
      setError(mensajeDeError(err, "No pudimos enviar tu pedido."));
    } finally {
      setOcupado(false);
    }
  };

  if (error && !menu) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-5 text-center text-zinc-300">
        <p className="max-w-sm text-sm">{error}</p>
      </main>
    );
  }

  if (!menu) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 text-sm text-zinc-400">
        Cargando el menu...
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-950 pb-32 text-zinc-100">
      <header className="border-b border-white/8 px-5 py-6">
        <h1 className="text-2xl font-semibold">{menu.negocio}</h1>
        {menu.mesa ? (
          <p className="mt-1 text-sm text-zinc-400">
            Mesa {menu.mesa.nombre}
            {menu.mesa.zona ? ` - ${menu.mesa.zona}` : ""}
          </p>
        ) : null}
      </header>

      {enviado ? (
        <div className="mx-5 mt-5 rounded-3xl border border-emerald-500/25 bg-emerald-500/10 px-5 py-4 text-sm text-emerald-100">
          Tu pedido <strong>{enviado.folio}</strong> se envio a cocina. Total acumulado{" "}
          {money(enviado.total, menu.moneda)}.
        </div>
      ) : null}
      {error ? (
        <div className="mx-5 mt-5 rounded-3xl border border-rose-500/25 bg-rose-500/10 px-5 py-4 text-sm text-rose-100">
          {error}
        </div>
      ) : null}

      <div className="space-y-8 px-5 py-6">
        {menu.categorias.map((categoria) => (
          <section key={categoria.nombre}>
            <h2 className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300">
              {categoria.nombre}
            </h2>
            <ul className="mt-3 space-y-3">
              {categoria.productos.map((producto) => {
                const cantidad = cantidades[producto.id] ?? 0;
                return (
                  <li
                    key={producto.id}
                    className="rounded-3xl border border-white/8 bg-zinc-900/50 p-4"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <h3 className="text-base font-medium text-white">{producto.nombre}</h3>
                        {producto.descripcion ? (
                          <p className="mt-1 text-sm leading-6 text-zinc-400">
                            {producto.descripcion}
                          </p>
                        ) : null}
                        <p className="mt-2 text-sm font-semibold text-cyan-300">
                          {money(producto.precio, menu.moneda)}
                        </p>
                      </div>
                      {menu.permite_pedido ? (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => cambiar(producto.id, -1)}
                            disabled={cantidad === 0}
                            className="h-9 w-9 rounded-full border border-white/12 text-lg text-zinc-300 disabled:opacity-30"
                            aria-label={`Quitar ${producto.nombre}`}
                          >
                            -
                          </button>
                          <span className="w-5 text-center text-sm">{cantidad}</span>
                          <button
                            type="button"
                            onClick={() => cambiar(producto.id, 1)}
                            className="h-9 w-9 rounded-full border border-cyan-500/30 bg-cyan-500/10 text-lg text-cyan-200"
                            aria-label={`Agregar ${producto.nombre}`}
                          >
                            +
                          </button>
                        </div>
                      ) : null}
                    </div>
                    {menu.permite_pedido && cantidad > 0 ? (
                      <input
                        value={notas[producto.id] ?? ""}
                        onChange={(event) =>
                          setNotas({ ...notas, [producto.id]: event.target.value })
                        }
                        placeholder="Indicaciones para cocina"
                        className="mt-3 w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-cyan-500"
                      />
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      <footer className="px-5 pb-6 pt-2 text-center">
        <a
          href={SOURCE_URL}
          target="_blank"
          rel="noreferrer"
          className="text-[11px] text-zinc-600 hover:text-zinc-400"
        >
          Hecho con BetterP POS QR - codigo fuente
        </a>
      </footer>

      {menu.permite_pedido && total > 0 ? (
        <div className="fixed inset-x-0 bottom-0 border-t border-white/10 bg-zinc-950/95 px-5 py-4 backdrop-blur">
          <div className="mx-auto flex max-w-lg items-center justify-between gap-4">
            <div>
              <p className="text-xs text-zinc-500">Total del pedido</p>
              <p className="text-lg font-semibold text-white">{money(total, menu.moneda)}</p>
            </div>
            <button
              type="button"
              onClick={enviar}
              disabled={ocupado}
              className="rounded-2xl bg-cyan-500 px-6 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-cyan-400 disabled:opacity-50"
            >
              Enviar a cocina
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
