"use client";

import { useCallback, useEffect, useState } from "react";

import { catalogoApi, type InventarioResponse } from "@/lib/catalogo-api";
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
} from "./ui";

export default function Inventario() {
  const [datos, setDatos] = useState<InventarioResponse | null>(null);
  const [productos, setProductos] = useState<{ id: number; nombre: string }[]>([]);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [bodega, setBodega] = useState({ codigo: "", nombre: "" });
  const [ajuste, setAjuste] = useState({ producto_id: "", bodega_id: "", cantidad: "", nota: "" });

  const cargar = useCallback(async () => {
    try {
      setError("");
      setDatos(await catalogoApi.inventario({ page_size: 50 }));
      const catalogo = await catalogoApi.catalogo({ page_size: 100 });
      setProductos(catalogo.productos.map((p) => ({ id: p.id, nombre: p.nombre })));
    } catch (err) {
      setError(mensajeDeError(err, "No pudimos cargar el inventario."));
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const crearBodega = async (event: React.FormEvent) => {
    event.preventDefault();
    setOcupado(true);
    setError("");
    try {
      await catalogoApi.crearBodega({
        codigo: bodega.codigo.trim(),
        nombre: bodega.nombre.trim(),
      });
      setBodega({ codigo: "", nombre: "" });
      setAviso("Bodega creada.");
      await cargar();
    } catch (err) {
      setError(mensajeDeError(err));
    } finally {
      setOcupado(false);
    }
  };

  const registrarAjuste = async (event: React.FormEvent) => {
    event.preventDefault();
    setOcupado(true);
    setError("");
    try {
      await catalogoApi.ajustarInventario({
        producto_id: Number(ajuste.producto_id),
        bodega_id: Number(ajuste.bodega_id),
        cantidad: ajuste.cantidad,
        nota: ajuste.nota,
      });
      setAjuste({ producto_id: "", bodega_id: "", cantidad: "", nota: "" });
      setAviso("Ajuste aplicado.");
      await cargar();
    } catch (err) {
      setError(mensajeDeError(err));
    } finally {
      setOcupado(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Inventario"
        description="Bodegas, existencias y movimientos. Cada venta cobrada descuenta de aqui."
      />

      {error ? <Alert>{error}</Alert> : null}
      {aviso && !error ? <Alert tone="info">{aviso}</Alert> : null}

      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          <Card title="Existencias">
            {!datos ? (
              <p className="text-sm text-zinc-500">Cargando...</p>
            ) : datos.items.length === 0 ? (
              <Empty>Sin existencias registradas.</Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs uppercase tracking-[0.14em] text-zinc-500">
                    <tr>
                      <th className="pb-3">Producto</th>
                      <th className="pb-3">Bodega</th>
                      <th className="pb-3 text-right">Stock</th>
                      <th className="pb-3 text-right">Reservado</th>
                      <th className="pb-3 text-right">Disponible</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/6">
                    {datos.items.map((item) => (
                      <tr key={item.id}>
                        <td className="py-3 text-zinc-100">
                          {item.producto_nombre || `#${item.producto_id}`}
                        </td>
                        <td className="py-3 text-zinc-400">
                          {item.bodega_nombre || `#${item.bodega_id}`}
                        </td>
                        <td className="py-3 text-right text-zinc-200">{Number(item.stock)}</td>
                        <td className="py-3 text-right text-zinc-400">{Number(item.reservado)}</td>
                        <td className="py-3 text-right font-medium text-cyan-300">
                          {Number(item.disponible)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="Ultimos movimientos">
            {!datos || datos.movimientos.length === 0 ? (
              <Empty>Sin movimientos.</Empty>
            ) : (
              <ul className="divide-y divide-white/6 text-sm">
                {datos.movimientos.slice(0, 12).map((mov) => (
                  <li key={mov.id} className="flex items-center justify-between gap-3 py-2.5">
                    <span>
                      <span className="block text-zinc-200">
                        {mov.producto_nombre || "Producto"} - {mov.tipo}
                      </span>
                      <span className="text-xs text-zinc-500">
                        {fechaHora(mov.fecha_creacion)}
                        {mov.nota ? ` - ${mov.nota}` : ""}
                      </span>
                    </span>
                    <span
                      className={
                        Number(mov.cantidad) < 0 ? "text-rose-300" : "text-emerald-300"
                      }
                    >
                      {Number(mov.cantidad)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card title={`Bodegas (${datos?.bodegas.length ?? 0})`}>
            {datos && datos.bodegas.length > 0 ? (
              <ul className="mb-4 space-y-1.5 text-sm text-zinc-300">
                {datos.bodegas.map((b) => (
                  <li key={b.id} className="flex justify-between">
                    <span>
                      {b.codigo} - {b.nombre}
                    </span>
                    <span className="text-zinc-500">{b.items_count ?? 0}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <form onSubmit={crearBodega} className="space-y-3 border-t border-white/8 pt-4">
              <Field label="Codigo">
                <input
                  className={inputClass}
                  value={bodega.codigo}
                  onChange={(event) => setBodega({ ...bodega, codigo: event.target.value })}
                  placeholder="BAR"
                  required
                />
              </Field>
              <Field label="Nombre">
                <input
                  className={inputClass}
                  value={bodega.nombre}
                  onChange={(event) => setBodega({ ...bodega, nombre: event.target.value })}
                  required
                />
              </Field>
              <Button type="submit" variant="ghost" disabled={ocupado}>
                Crear bodega
              </Button>
            </form>
          </Card>

          <Card title="Ajustar existencias">
            <form onSubmit={registrarAjuste} className="space-y-3">
              <Field label="Producto">
                <select
                  className={inputClass}
                  value={ajuste.producto_id}
                  onChange={(event) => setAjuste({ ...ajuste, producto_id: event.target.value })}
                  required
                >
                  <option value="">Selecciona</option>
                  {productos.map((producto) => (
                    <option key={producto.id} value={producto.id}>
                      {producto.nombre}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Bodega">
                <select
                  className={inputClass}
                  value={ajuste.bodega_id}
                  onChange={(event) => setAjuste({ ...ajuste, bodega_id: event.target.value })}
                  required
                >
                  <option value="">Selecciona</option>
                  {(datos?.bodegas ?? []).map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.codigo} - {b.nombre}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Cantidad" hint="Positiva para entrada, negativa para salida.">
                <input
                  className={inputClass}
                  value={ajuste.cantidad}
                  onChange={(event) => setAjuste({ ...ajuste, cantidad: event.target.value })}
                  inputMode="decimal"
                  required
                />
              </Field>
              <Field label="Nota">
                <input
                  className={inputClass}
                  value={ajuste.nota}
                  onChange={(event) => setAjuste({ ...ajuste, nota: event.target.value })}
                  placeholder="Compra, merma, conteo..."
                />
              </Field>
              <Button type="submit" disabled={ocupado}>
                Aplicar ajuste
              </Button>
            </form>
          </Card>
        </div>
      </div>
    </>
  );
}
