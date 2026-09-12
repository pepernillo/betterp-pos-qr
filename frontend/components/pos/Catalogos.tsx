"use client";

import { useCallback, useEffect, useState } from "react";

import { catalogoApi, type CatalogoResponse, type Categoria } from "@/lib/catalogo-api";
import {
  Alert,
  Button,
  Card,
  Empty,
  Field,
  PageHeader,
  inputClass,
  mensajeDeError,
} from "./ui";

export default function Catalogos() {
  const [datos, setDatos] = useState<CatalogoResponse | null>(null);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [nombre, setNombre] = useState("");
  const [parentId, setParentId] = useState("");
  const [editandoId, setEditandoId] = useState<number | null>(null);

  const cargar = useCallback(async () => {
    try {
      setError("");
      setDatos(await catalogoApi.catalogo({ page_size: 1 }));
    } catch (err) {
      setError(mensajeDeError(err, "No pudimos cargar los catalogos."));
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const limpiar = () => {
    setNombre("");
    setParentId("");
    setEditandoId(null);
  };

  const guardar = async (event: React.FormEvent) => {
    event.preventDefault();
    setOcupado(true);
    setError("");
    try {
      const payload = {
        nombre: nombre.trim(),
        parent_id: parentId ? Number(parentId) : null,
      };
      if (editandoId) {
        await catalogoApi.actualizarCategoria(editandoId, payload);
        setAviso(`Catalogo ${payload.nombre} actualizado.`);
      } else {
        await catalogoApi.crearCategoria(payload);
        setAviso(`Catalogo ${payload.nombre} creado.`);
      }
      limpiar();
      await cargar();
    } catch (err) {
      setError(mensajeDeError(err));
    } finally {
      setOcupado(false);
    }
  };

  const editar = (categoria: Categoria) => {
    setEditandoId(categoria.id);
    setNombre(categoria.nombre);
    setParentId(categoria.parent_id ? String(categoria.parent_id) : "");
    setAviso("");
  };

  const alternar = async (categoria: Categoria) => {
    setOcupado(true);
    try {
      await catalogoApi.actualizarCategoria(categoria.id, { activo: !categoria.activo });
      await cargar();
    } catch (err) {
      setError(mensajeDeError(err));
    } finally {
      setOcupado(false);
    }
  };

  const categorias = datos?.categorias ?? [];

  return (
    <>
      <PageHeader
        title="Catalogos"
        description="Agrupa tus productos por categoria. El menu por QR se ordena con estos grupos."
      />

      {error ? <Alert>{error}</Alert> : null}
      {aviso && !error ? <Alert tone="info">{aviso}</Alert> : null}

      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_340px]">
        <Card title={`Categorias (${categorias.length})`}>
          {categorias.length === 0 ? (
            <Empty>Aun no hay categorias. Crea la primera para ordenar tu carta.</Empty>
          ) : (
            <ul className="divide-y divide-white/6">
              {categorias.map((categoria) => (
                <li key={categoria.id} className="flex items-center justify-between gap-3 py-3">
                  <div>
                    <span className="block text-sm text-zinc-100">{categoria.nombre}</span>
                    <span className="text-xs text-zinc-500">
                      {categoria.productos_count ?? 0} producto(s)
                      {categoria.activo ? "" : " - inactiva"}
                    </span>
                  </div>
                  <div className="flex gap-3 text-xs">
                    <button
                      type="button"
                      onClick={() => editar(categoria)}
                      className="text-cyan-300 hover:text-cyan-200"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => alternar(categoria)}
                      disabled={ocupado}
                      className="text-zinc-400 hover:text-zinc-200 disabled:opacity-40"
                    >
                      {categoria.activo ? "Desactivar" : "Activar"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={editandoId ? "Editar categoria" : "Nueva categoria"}>
          <form onSubmit={guardar} className="space-y-3">
            <Field label="Nombre">
              <input
                className={inputClass}
                value={nombre}
                onChange={(event) => setNombre(event.target.value)}
                required
              />
            </Field>
            <Field label="Depende de" hint="Opcional, para armar subcategorias.">
              <select
                className={inputClass}
                value={parentId}
                onChange={(event) => setParentId(event.target.value)}
              >
                <option value="">Sin categoria padre</option>
                {categorias
                  .filter((categoria) => categoria.id !== editandoId)
                  .map((categoria) => (
                    <option key={categoria.id} value={categoria.id}>
                      {categoria.nombre}
                    </option>
                  ))}
              </select>
            </Field>
            <div className="flex gap-3 pt-1">
              <Button type="submit" disabled={ocupado}>
                {editandoId ? "Guardar" : "Crear"}
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
