"use client";

import { useCallback, useEffect, useState } from "react";

import { catalogoApi, type CatalogoResponse, type Producto } from "@/lib/catalogo-api";
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
} from "./ui";

const VACIO = {
  internal_sku: "",
  nombre: "",
  descripcion: "",
  precio_base: "",
  categoria_id: "",
  activo: true,
};

export default function Productos() {
  const [datos, setDatos] = useState<CatalogoResponse | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [pagina, setPagina] = useState(1);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [form, setForm] = useState({ ...VACIO });
  const [editandoId, setEditandoId] = useState<number | null>(null);

  const cargar = useCallback(async () => {
    try {
      setError("");
      setDatos(await catalogoApi.catalogo({ search: busqueda, page: pagina, page_size: 20 }));
    } catch (err) {
      setError(mensajeDeError(err, "No pudimos cargar el catalogo."));
    }
  }, [busqueda, pagina]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const limpiar = () => {
    setForm({ ...VACIO });
    setEditandoId(null);
  };

  const guardar = async (event: React.FormEvent) => {
    event.preventDefault();
    setOcupado(true);
    setError("");
    try {
      const payload: Record<string, unknown> = {
        internal_sku: form.internal_sku.trim(),
        nombre: form.nombre.trim(),
        descripcion: form.descripcion.trim() || null,
        precio_base: form.precio_base || "0",
        activo: form.activo,
        categoria_id: form.categoria_id ? Number(form.categoria_id) : null,
      };
      if (editandoId) {
        await catalogoApi.actualizarProducto(editandoId, payload);
        setAviso(`Producto ${form.nombre} actualizado.`);
      } else {
        await catalogoApi.crearProducto(payload);
        setAviso(`Producto ${form.nombre} dado de alta.`);
      }
      limpiar();
      await cargar();
    } catch (err) {
      setError(mensajeDeError(err));
    } finally {
      setOcupado(false);
    }
  };

  const editar = (producto: Producto) => {
    setEditandoId(producto.id);
    setAviso("");
    setForm({
      internal_sku: producto.internal_sku,
      nombre: producto.nombre,
      descripcion: producto.descripcion ?? "",
      precio_base: producto.precio_base,
      categoria_id: producto.categoria ? String(producto.categoria.id) : "",
      activo: producto.activo,
    });
  };

  const alternarActivo = async (producto: Producto) => {
    setOcupado(true);
    try {
      await catalogoApi.actualizarProducto(producto.id, { activo: !producto.activo });
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
        title="Productos"
        description="Alta y edicion del catalogo que aparece en la caja y en el menu QR."
      />

      {error ? <Alert>{error}</Alert> : null}
      {aviso && !error ? <Alert tone="info">{aviso}</Alert> : null}

      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_380px]">
        <Card
          title={`Catalogo${datos ? ` (${datos.resumen.productos_total})` : ""}`}
          action={
            <input
              className={`${inputClass} w-52`}
              placeholder="Buscar por nombre o SKU"
              value={busqueda}
              onChange={(event) => {
                setPagina(1);
                setBusqueda(event.target.value);
              }}
            />
          }
        >
          {!datos ? (
            <p className="text-sm text-zinc-500">Cargando...</p>
          ) : datos.productos.length === 0 ? (
            <Empty>Sin productos. Da de alta el primero con el formulario de la derecha.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-[0.14em] text-zinc-500">
                  <tr>
                    <th className="pb-3">Producto</th>
                    <th className="pb-3">Categoria</th>
                    <th className="pb-3 text-right">Precio</th>
                    <th className="pb-3 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/6">
                  {datos.productos.map((producto) => (
                    <tr key={producto.id}>
                      <td className="py-3">
                        <span className="block text-zinc-100">{producto.nombre}</span>
                        <span className="text-xs text-zinc-500">{producto.internal_sku}</span>
                      </td>
                      <td className="py-3 text-zinc-400">
                        {producto.categoria?.nombre || "Sin categoria"}
                      </td>
                      <td className="py-3 text-right text-zinc-200">
                        {money(producto.precio_base)}
                      </td>
                      <td className="py-3 text-right">
                        <div className="flex justify-end gap-3 text-xs">
                          <button
                            type="button"
                            onClick={() => editar(producto)}
                            className="text-cyan-300 hover:text-cyan-200"
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => alternarActivo(producto)}
                            disabled={ocupado}
                            className="text-zinc-400 hover:text-zinc-200 disabled:opacity-40"
                          >
                            {producto.activo ? "Desactivar" : "Activar"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {datos.pagination.total_pages > 1 ? (
                <div className="mt-4 flex items-center justify-between text-sm text-zinc-400">
                  <Button
                    variant="ghost"
                    onClick={() => setPagina((p) => Math.max(1, p - 1))}
                    disabled={datos.pagination.page <= 1}
                  >
                    Anterior
                  </Button>
                  <span>
                    Pagina {datos.pagination.page} de {datos.pagination.total_pages}
                  </span>
                  <Button
                    variant="ghost"
                    onClick={() => setPagina((p) => p + 1)}
                    disabled={datos.pagination.page >= datos.pagination.total_pages}
                  >
                    Siguiente
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </Card>

        <Card title={editandoId ? "Editar producto" : "Nuevo producto"}>
          <form onSubmit={guardar} className="space-y-3">
            <Field label="SKU interno">
              <input
                className={inputClass}
                value={form.internal_sku}
                onChange={(event) => setForm({ ...form, internal_sku: event.target.value })}
                required
                disabled={Boolean(editandoId)}
              />
            </Field>
            <Field label="Nombre">
              <input
                className={inputClass}
                value={form.nombre}
                onChange={(event) => setForm({ ...form, nombre: event.target.value })}
                required
              />
            </Field>
            <Field label="Precio">
              <input
                className={inputClass}
                value={form.precio_base}
                onChange={(event) => setForm({ ...form, precio_base: event.target.value })}
                inputMode="decimal"
                required
              />
            </Field>
            <Field label="Categoria">
              <select
                className={inputClass}
                value={form.categoria_id}
                onChange={(event) => setForm({ ...form, categoria_id: event.target.value })}
              >
                <option value="">Sin categoria</option>
                {(datos?.categorias ?? []).map((categoria) => (
                  <option key={categoria.id} value={categoria.id}>
                    {categoria.nombre}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Descripcion" hint="Se muestra en el menu por QR.">
              <textarea
                className={`${inputClass} min-h-[80px]`}
                value={form.descripcion}
                onChange={(event) => setForm({ ...form, descripcion: event.target.value })}
              />
            </Field>
            <label className="flex items-center gap-2 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={form.activo}
                onChange={(event) => setForm({ ...form, activo: event.target.checked })}
                className="h-4 w-4 rounded border-zinc-700 bg-zinc-950"
              />
              Disponible para venta
            </label>
            <div className="flex gap-3 pt-1">
              <Button type="submit" disabled={ocupado}>
                {editandoId ? "Guardar cambios" : "Dar de alta"}
              </Button>
              {editandoId ? (
                <Button type="button" variant="ghost" onClick={limpiar}>
                  Cancelar
                </Button>
              ) : null}
            </div>
          </form>
        </Card>
      </div>
    </>
  );
}
