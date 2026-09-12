"use client";

import { useEffect, useState } from "react";

import { catalogoApi, type Bodega } from "@/lib/catalogo-api";
import { posApi, type PuntoVenta } from "@/lib/pos-api";
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

const VACIO = {
  codigo: "",
  nombre: "",
  bodega_id: "",
  tipo_servicio: "MOSTRADOR",
  acepta_cobro_qr: true,
  menu_qr_activo: false,
  porcentaje_propina_sugerido: "10.00",
};

export default function PuntosVenta() {
  const { contexto, cargando, error: errorContexto, recargar } = usePosContexto();
  const [bodegas, setBodegas] = useState<Bodega[]>([]);
  const [form, setForm] = useState({ ...VACIO });
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [menuQr, setMenuQr] = useState<PuntoVenta | null>(null);
  const [origen, setOrigen] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined") setOrigen(window.location.origin);
  }, []);

  useEffect(() => {
    const cargarBodegas = async () => {
      try {
        const data = await catalogoApi.inventario({ page_size: 1 });
        setBodegas(data.bodegas ?? []);
      } catch {
        // sin inventario habilitado no se pueden crear cajas, se avisa al guardar
      }
    };
    void cargarBodegas();
  }, []);

  const crear = async (event: React.FormEvent) => {
    event.preventDefault();
    setOcupado(true);
    setError("");
    try {
      await posApi.crearPuntoVenta({
        codigo: form.codigo.trim(),
        nombre: form.nombre.trim(),
        bodega_id: Number(form.bodega_id),
        tipo_servicio: form.tipo_servicio,
        acepta_cobro_qr: form.acepta_cobro_qr,
        menu_qr_activo: form.menu_qr_activo,
        porcentaje_propina_sugerido: form.porcentaje_propina_sugerido,
      });
      setForm({ ...VACIO });
      setAviso("Punto de venta creado.");
      await recargar();
    } catch (err) {
      setError(mensajeDeError(err));
    } finally {
      setOcupado(false);
    }
  };

  const alternar = async (punto: PuntoVenta, campo: "activo" | "acepta_cobro_qr" | "menu_qr_activo") => {
    setOcupado(true);
    try {
      await posApi.actualizarPuntoVenta(punto.id, { [campo]: !punto[campo] });
      await recargar();
    } catch (err) {
      setError(mensajeDeError(err));
    } finally {
      setOcupado(false);
    }
  };

  if (cargando) return <p className="text-sm text-zinc-400">Cargando puntos de venta...</p>;
  if (errorContexto) return <Alert>{errorContexto}</Alert>;

  const puntos = contexto?.puntos_venta ?? [];
  const urlMenu = menuQr && origen ? `${origen}/menu/${menuQr.menu_token}` : "";

  return (
    <>
      <PageHeader
        title="Puntos de venta"
        description="Cada caja descuenta inventario de una bodega y tiene su propio menu por QR."
      />

      {error ? <Alert>{error}</Alert> : null}
      {aviso && !error ? <Alert tone="info">{aviso}</Alert> : null}
      {bodegas.length === 0 ? (
        <Alert tone="info">
          Necesitas al menos una bodega para crear una caja. Créala en Inventario.
        </Alert>
      ) : null}

      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_360px]">
        <Card title={`Cajas (${puntos.length})`}>
          {puntos.length === 0 ? (
            <Empty>Sin puntos de venta. Crea el primero para abrir caja.</Empty>
          ) : (
            <ul className="space-y-3">
              {puntos.map((punto) => (
                <li
                  key={punto.id}
                  className="rounded-2xl border border-white/8 bg-zinc-950/50 p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-base font-semibold text-white">
                        {punto.codigo} - {punto.nombre}
                      </h3>
                      <p className="mt-1 text-xs text-zinc-500">
                        {punto.es_restaurante ? "Restaurante" : "Mostrador"} - bodega{" "}
                        {punto.bodega_nombre || punto.bodega_id}
                        {punto.turno_abierto_id ? " - turno abierto" : ""}
                      </p>
                    </div>
                    <span
                      className={`rounded-full border px-2.5 py-1 text-[11px] ${
                        punto.activo
                          ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-200"
                          : "border-zinc-600/40 bg-zinc-800/40 text-zinc-400"
                      }`}
                    >
                      {punto.activo ? "Activa" : "Inactiva"}
                    </span>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => alternar(punto, "acepta_cobro_qr")}
                      disabled={ocupado}
                      className="rounded-xl border border-white/10 px-3 py-1.5 text-zinc-300 disabled:opacity-40"
                    >
                      Cobro QR: {punto.acepta_cobro_qr ? "si" : "no"}
                    </button>
                    <button
                      type="button"
                      onClick={() => alternar(punto, "menu_qr_activo")}
                      disabled={ocupado}
                      className="rounded-xl border border-white/10 px-3 py-1.5 text-zinc-300 disabled:opacity-40"
                    >
                      Menu QR: {punto.menu_qr_activo ? "publicado" : "oculto"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setMenuQr(punto)}
                      className="rounded-xl border border-cyan-500/25 bg-cyan-500/10 px-3 py-1.5 font-medium text-cyan-200"
                    >
                      Ver QR del menu
                    </button>
                    <button
                      type="button"
                      onClick={() => alternar(punto, "activo")}
                      disabled={ocupado}
                      className="rounded-xl border border-white/10 px-3 py-1.5 text-zinc-300 disabled:opacity-40"
                    >
                      {punto.activo ? "Desactivar" : "Activar"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-5">
          {menuQr ? (
            <Card title={`Menu de ${menuQr.nombre}`}>
              <div className="flex flex-col items-center gap-3">
                <QrCode value={urlMenu} />
                <p className="break-all text-center text-xs text-zinc-500">{urlMenu}</p>
              </div>
            </Card>
          ) : null}

          <Card title="Nuevo punto de venta">
            <form onSubmit={crear} className="space-y-3">
              <Field label="Codigo">
                <input
                  className={inputClass}
                  value={form.codigo}
                  onChange={(event) => setForm({ ...form, codigo: event.target.value })}
                  placeholder="CAJA1"
                  required
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
              <Field label="Bodega" hint="De aqui se descuenta el inventario en cada venta.">
                <select
                  className={inputClass}
                  value={form.bodega_id}
                  onChange={(event) => setForm({ ...form, bodega_id: event.target.value })}
                  required
                >
                  <option value="">Selecciona una bodega</option>
                  {bodegas.map((bodega) => (
                    <option key={bodega.id} value={bodega.id}>
                      {bodega.codigo} - {bodega.nombre}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Tipo de servicio">
                <select
                  className={inputClass}
                  value={form.tipo_servicio}
                  onChange={(event) => setForm({ ...form, tipo_servicio: event.target.value })}
                >
                  <option value="MOSTRADOR">Mostrador</option>
                  <option value="RESTAURANTE">Restaurante</option>
                </select>
              </Field>
              <Field label="Propina sugerida (%)">
                <input
                  className={inputClass}
                  value={form.porcentaje_propina_sugerido}
                  onChange={(event) =>
                    setForm({ ...form, porcentaje_propina_sugerido: event.target.value })
                  }
                  inputMode="decimal"
                />
              </Field>
              <label className="flex items-center gap-2 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  checked={form.acepta_cobro_qr}
                  onChange={(event) => setForm({ ...form, acepta_cobro_qr: event.target.checked })}
                  className="h-4 w-4 rounded border-zinc-700 bg-zinc-950"
                />
                Acepta cobro por QR
              </label>
              <label className="flex items-center gap-2 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  checked={form.menu_qr_activo}
                  onChange={(event) => setForm({ ...form, menu_qr_activo: event.target.checked })}
                  className="h-4 w-4 rounded border-zinc-700 bg-zinc-950"
                />
                Publicar menu por QR
              </label>
              <Button type="submit" disabled={ocupado || bodegas.length === 0}>
                Crear caja
              </Button>
            </form>
          </Card>
        </div>
      </div>
    </>
  );
}
