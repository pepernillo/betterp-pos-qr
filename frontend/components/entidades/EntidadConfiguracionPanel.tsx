"use client";

import { buildApiUrl } from '@/lib/api';

import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";

const EMPRESAS_API_BASE = buildApiUrl("/empresas");

interface CapaNegocio {
  id: number;
  nombre: string;
  tipo_capa: string;
  nombre_administrador: string | null;
  razon_social: string | null;
  rfc: string | null;
  regimen_fiscal: string | null;
  correo_contacto: string | null;
  telefono_contacto: string | null;
  logo_url: string | null;
  plazo_meses_default: number;
  periodicidad_cobro_default: string;
  dia_vencimiento_default: number | null;
  dias_gracia_default: number;
  auto_renueva_default: boolean;
  aplicacion_pagos: string;
  activo: boolean;
  entidades_count: number;
}

interface EntidadConfigRecord {
  id: number;
  nombre_comercial: string;
  ciudad?: string | null;
  rfc?: string | null;
  regimen_fiscal?: string | null;
  logo_url?: string | null;
  tipo_fecha_corte: string;
  activo: boolean;
  fecha_pausa?: string | null;
  capa_negocio_id?: number | null;
  capa_negocio_nombre?: string | null;
  capa_negocio_tipo?: string | null;
}

interface CapaFormState {
  nombre: string;
  tipo_capa: string;
  nombre_administrador: string;
  razon_social: string;
  rfc: string;
  regimen_fiscal: string;
  correo_contacto: string;
  telefono_contacto: string;
  logo_url: string;
  plazo_meses_default: string;
  periodicidad_cobro_default: string;
  dia_vencimiento_default: string;
  dias_gracia_default: string;
  auto_renueva_default: boolean;
  aplicacion_pagos: string;
  activo: boolean;
}

interface EntidadConfiguracionPanelProps {
  entidad: EntidadConfigRecord;
  onEntidadUpdated: () => Promise<void> | void;
}

const EMPTY_FORM: CapaFormState = {
  nombre: "",
  tipo_capa: "OPERADORA",
  nombre_administrador: "",
  razon_social: "",
  rfc: "",
  regimen_fiscal: "",
  correo_contacto: "",
  telefono_contacto: "",
  logo_url: "",
  plazo_meses_default: "12",
  periodicidad_cobro_default: "MENSUAL",
  dia_vencimiento_default: "",
  dias_gracia_default: "0",
  auto_renueva_default: false,
  aplicacion_pagos: "ADEUDO_MAS_ANTIGUO",
  activo: true,
};

const TIPOS_CAPA = [
  { value: "OPERADORA", label: "Operadora" },
  { value: "ADMINISTRADORA", label: "Administradora" },
  { value: "EMPRESA", label: "Empresa" },
  { value: "HOTEL", label: "Hotel" },
  { value: "GRUPO", label: "Grupo" },
];

const PERIODICIDADES = [
  { value: "UNICO", label: "Unico" },
  { value: "SEMANAL", label: "Semanal" },
  { value: "QUINCENAL", label: "Quincenal" },
  { value: "MENSUAL", label: "Mensual" },
  { value: "BIMESTRAL", label: "Bimestral" },
  { value: "ANUAL", label: "Anual" },
];

const APLICACION_PAGOS = [
  { value: "ADEUDO_MAS_ANTIGUO", label: "Adeudo mas antiguo" },
  { value: "SALDO_A_FAVOR", label: "Saldo a favor" },
];

function getErrorMessage(body: unknown, fallback: string) {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail?: unknown }).detail;
    if (typeof detail === "string" && detail.trim()) {
      return detail;
    }
  }

  return fallback;
}

function parseOptionalInteger(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function mapCapaToForm(capa: CapaNegocio): CapaFormState {
  return {
    nombre: capa.nombre,
    tipo_capa: capa.tipo_capa,
    nombre_administrador: capa.nombre_administrador || "",
    razon_social: capa.razon_social || "",
    rfc: capa.rfc || "",
    regimen_fiscal: capa.regimen_fiscal || "",
    correo_contacto: capa.correo_contacto || "",
    telefono_contacto: capa.telefono_contacto || "",
    logo_url: capa.logo_url || "",
    plazo_meses_default: String(capa.plazo_meses_default),
    periodicidad_cobro_default: capa.periodicidad_cobro_default,
    dia_vencimiento_default:
      capa.dia_vencimiento_default !== null &&
      capa.dia_vencimiento_default !== undefined
        ? String(capa.dia_vencimiento_default)
        : "",
    dias_gracia_default: String(capa.dias_gracia_default),
    auto_renueva_default: capa.auto_renueva_default,
    aplicacion_pagos: capa.aplicacion_pagos,
    activo: capa.activo,
  };
}

function buildCapaPayload(form: CapaFormState) {
  return {
    ...form,
    nombre: form.nombre.trim(),
    nombre_administrador: form.nombre_administrador.trim(),
    razon_social: form.razon_social.trim(),
    rfc: form.rfc.trim().toUpperCase(),
    regimen_fiscal: form.regimen_fiscal.trim(),
    correo_contacto: form.correo_contacto.trim(),
    telefono_contacto: form.telefono_contacto.trim(),
    logo_url: form.logo_url.trim(),
    plazo_meses_default: Math.max(
      parseOptionalInteger(form.plazo_meses_default) ?? 12,
      1
    ),
    dia_vencimiento_default: parseOptionalInteger(form.dia_vencimiento_default),
    dias_gracia_default: Math.max(
      parseOptionalInteger(form.dias_gracia_default) ?? 0,
      0
    ),
  };
}

export default function EntidadConfiguracionPanel({
  entidad,
  onEntidadUpdated,
}: EntidadConfiguracionPanelProps) {
  const [capas, setCapas] = useState<CapaNegocio[]>([]);
  const [selectedCapaId, setSelectedCapaId] = useState(
    entidad.capa_negocio_id ? String(entidad.capa_negocio_id) : ""
  );
  const [form, setForm] = useState<CapaFormState>(EMPTY_FORM);
  const [isLoadingCapas, setIsLoadingCapas] = useState(true);
  const [isSavingLink, setIsSavingLink] = useState(false);
  const [isSavingCapa, setIsSavingCapa] = useState(false);
  const [mensaje, setMensaje] = useState("");

  const selectedCapa = useMemo(
    () => capas.find((item) => String(item.id) === selectedCapaId) || null,
    [capas, selectedCapaId]
  );

  const flashMessage = (value: string) => {
    setMensaje(value);
    window.setTimeout(() => setMensaje(""), 3200);
  };

  const loadCapas = useCallback(async (preferredId?: string) => {
    setIsLoadingCapas(true);
    try {
      const response = await fetch(`${EMPRESAS_API_BASE}/capas/`, {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error("No se pudieron cargar las capas de negocio.");
      }

      const body = (await response.json()) as CapaNegocio[];
      setCapas(body);

      const targetId =
        preferredId !== undefined
          ? preferredId
          : entidad.capa_negocio_id
            ? String(entidad.capa_negocio_id)
            : "";
      setSelectedCapaId(targetId);

      const matched = body.find((item) => String(item.id) === targetId) || null;
      setForm(matched ? mapCapaToForm(matched) : EMPTY_FORM);
    } catch (error) {
      console.error("Error cargando capas en entidad:", error);
      setCapas([]);
      setSelectedCapaId("");
      setForm(EMPTY_FORM);
    } finally {
      setIsLoadingCapas(false);
    }
  }, [entidad.capa_negocio_id]);

  useEffect(() => {
    void loadCapas(entidad.capa_negocio_id ? String(entidad.capa_negocio_id) : "");
  }, [entidad.capa_negocio_id, entidad.id, loadCapas]);

  const handleSelectCapa = (value: string) => {
    setSelectedCapaId(value);
    const capa = capas.find((item) => String(item.id) === value) || null;
    setForm(capa ? mapCapaToForm(capa) : EMPTY_FORM);
  };

  const handleSaveLink = async () => {
    setIsSavingLink(true);

    const payload = {
      nombre_comercial: entidad.nombre_comercial,
      ciudad: entidad.ciudad || "",
      rfc: entidad.rfc || "",
      regimen_fiscal: entidad.regimen_fiscal || "",
      logo_url: entidad.logo_url || "",
      tipo_fecha_corte: entidad.tipo_fecha_corte,
      activo: entidad.activo,
      fecha_pausa: entidad.fecha_pausa || null,
      capa_negocio_id: selectedCapaId ? Number(selectedCapaId) : null,
      capa_negocio_nombre: "",
      desvincular_capa_negocio: !selectedCapaId,
    };

    try {
      const response = await fetch(`${EMPRESAS_API_BASE}/${entidad.id}/`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorBody = (await response.json()) as unknown;
        throw new Error(
          getErrorMessage(
            errorBody,
            "No se pudo actualizar la capa vinculada en la entidad."
          )
        );
      }

      await onEntidadUpdated();
      flashMessage(
        selectedCapaId
          ? "Capa vinculada a la entidad correctamente."
          : "La entidad ahora opera sin capa vinculada."
      );
    } catch (error) {
      console.error("Error vinculando capa:", error);
      alert(
        error instanceof Error
          ? error.message
          : "No se pudo actualizar la capa de negocio."
      );
    } finally {
      setIsSavingLink(false);
    }
  };

  const handleSaveCapa = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedCapaId) {
      alert("Selecciona una capa para poder modificarla.");
      return;
    }

    setIsSavingCapa(true);
    try {
      const response = await fetch(
        `${EMPRESAS_API_BASE}/capas/${selectedCapaId}/`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildCapaPayload(form)),
        }
      );

      if (!response.ok) {
        const errorBody = (await response.json()) as unknown;
        throw new Error(
          getErrorMessage(errorBody, "No se pudo guardar la capa de negocio.")
        );
      }

      await loadCapas(selectedCapaId);
      await onEntidadUpdated();
      flashMessage("Capa de negocio actualizada correctamente.");
    } catch (error) {
      console.error("Error guardando capa desde entidad:", error);
      alert(
        error instanceof Error
          ? error.message
          : "No se pudo guardar la capa de negocio."
      );
    } finally {
      setIsSavingCapa(false);
    }
  };

  return (
    <div className="space-y-6">
      {mensaje && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          {mensaje}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <section className="space-y-5 rounded-2xl border border-zinc-800 bg-zinc-950/70 p-5">
          <div>
            <h2 className="text-lg font-semibold text-white">
              Capa aplicada a esta entidad
            </h2>
            <p className="mt-1 text-sm text-zinc-500">
              Selecciona la base comercial que quieres usar en esta propiedad.
            </p>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-400">
              Capa vinculada
            </label>
            <select
              value={selectedCapaId}
              onChange={(event) => handleSelectCapa(event.target.value)}
              disabled={isLoadingCapas}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-zinc-200 outline-none focus:ring-1 focus:ring-cyan-500 disabled:opacity-60"
            >
              <option value="">Sin capa / entidad independiente</option>
              {capas.map((capa) => (
                <option key={capa.id} value={capa.id}>
                  {capa.nombre} - {capa.tipo_capa}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
              <p className="text-xs uppercase tracking-wide text-zinc-500">
                Entidad actual
              </p>
              <p className="mt-2 text-base font-semibold text-white">
                {entidad.nombre_comercial}
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                {entidad.ciudad || "Sin ciudad"}
              </p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
              <p className="text-xs uppercase tracking-wide text-zinc-500">
                Estado de la capa
              </p>
              <p className="mt-2 text-base font-semibold text-white">
                {selectedCapa ? selectedCapa.nombre : "Sin capa"}
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                {selectedCapa
                  ? `${selectedCapa.entidades_count} entidades comparten esta base`
                  : "Operacion independiente"}
              </p>
            </div>
          </div>

          {selectedCapa ? (
            <div className="space-y-3 rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-semibold text-white">
                  {selectedCapa.nombre}
                </h3>
                <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-1 text-xs font-medium text-cyan-300">
                  {selectedCapa.tipo_capa}
                </span>
              </div>

              <div className="grid grid-cols-1 gap-2 text-sm text-cyan-100/90">
                <p>
                  Periodicidad base:{" "}
                  <span className="font-semibold">
                    {selectedCapa.periodicidad_cobro_default}
                  </span>
                </p>
                <p>
                  Vencimiento:{" "}
                  <span className="font-semibold">
                    {selectedCapa.dia_vencimiento_default
                      ? `Dia ${selectedCapa.dia_vencimiento_default}`
                      : "Sin definir"}
                  </span>
                </p>
                <p>
                  Dias de gracia:{" "}
                  <span className="font-semibold">
                    {selectedCapa.dias_gracia_default}
                  </span>
                </p>
                <p>
                  Aplicacion de pagos:{" "}
                  <span className="font-semibold">
                    {selectedCapa.aplicacion_pagos}
                  </span>
                </p>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/30 px-4 py-8 text-center text-sm text-zinc-500">
              Esta entidad no tiene una capa vinculada. Puedes mantenerla
              independiente o asignarle una base compartida.
            </div>
          )}

          <div className="flex flex-col gap-3 border-t border-zinc-800 pt-4">
            <button
              type="button"
              onClick={() => void handleSaveLink()}
              disabled={isSavingLink || isLoadingCapas}
              className="rounded-lg bg-cyan-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:opacity-50"
            >
              {isSavingLink ? "Guardando..." : "Guardar vinculacion"}
            </button>
            <Link
              href="/configuracion"
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-center text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
            >
              Abrir configuracion global
            </Link>
          </div>
        </section>

        <section className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-5">
          <div className="flex flex-col gap-3 border-b border-zinc-800 pb-4 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-white">
                Edicion rapida de la capa
              </h2>
              <p className="mt-1 text-sm text-zinc-500">
                Los cambios aqui impactan a todas las entidades que usan esta capa.
              </p>
            </div>
            {selectedCapa && (
              <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-200">
                Compartida por {selectedCapa.entidades_count} entidades
              </span>
            )}
          </div>

          {!selectedCapa ? (
            <div className="mt-5 rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/30 px-4 py-12 text-center text-sm text-zinc-500">
              Selecciona una capa en la columna izquierda para revisar o modificar
              sus defaults.
            </div>
          ) : (
            <form onSubmit={handleSaveCapa} className="mt-5 space-y-5">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                <div className="xl:col-span-2">
                  <label className="mb-1 block text-sm font-medium text-zinc-400">
                    Nombre
                  </label>
                  <input
                    required
                    type="text"
                    value={form.nombre}
                    onChange={(event) =>
                      setForm({ ...form, nombre: event.target.value })
                    }
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-400">
                    Tipo
                  </label>
                  <select
                    value={form.tipo_capa}
                    onChange={(event) =>
                      setForm({ ...form, tipo_capa: event.target.value })
                    }
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-zinc-200 outline-none focus:ring-1 focus:ring-cyan-500"
                  >
                    {TIPOS_CAPA.map((tipo) => (
                      <option key={tipo.value} value={tipo.value}>
                        {tipo.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-400">
                    Administrador
                  </label>
                  <input
                    type="text"
                    value={form.nombre_administrador}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        nombre_administrador: event.target.value,
                      })
                    }
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-400">
                    Correo
                  </label>
                  <input
                    type="email"
                    value={form.correo_contacto}
                    onChange={(event) =>
                      setForm({ ...form, correo_contacto: event.target.value })
                    }
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-400">
                    Telefono
                  </label>
                  <input
                    type="text"
                    value={form.telefono_contacto}
                    onChange={(event) =>
                      setForm({ ...form, telefono_contacto: event.target.value })
                    }
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-400">
                    Razon social
                  </label>
                  <input
                    type="text"
                    value={form.razon_social}
                    onChange={(event) =>
                      setForm({ ...form, razon_social: event.target.value })
                    }
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-400">
                    RFC
                  </label>
                  <input
                    type="text"
                    value={form.rfc}
                    onChange={(event) =>
                      setForm({ ...form, rfc: event.target.value.toUpperCase() })
                    }
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm uppercase text-white outline-none focus:ring-1 focus:ring-cyan-500"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-400">
                    Regimen fiscal
                  </label>
                  <input
                    type="text"
                    value={form.regimen_fiscal}
                    onChange={(event) =>
                      setForm({ ...form, regimen_fiscal: event.target.value })
                    }
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-400">
                    Periodicidad
                  </label>
                  <select
                    value={form.periodicidad_cobro_default}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        periodicidad_cobro_default: event.target.value,
                      })
                    }
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-zinc-200 outline-none focus:ring-1 focus:ring-cyan-500"
                  >
                    {PERIODICIDADES.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-400">
                    Plazo (meses)
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={form.plazo_meses_default}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        plazo_meses_default: event.target.value,
                      })
                    }
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-400">
                    Dia vencimiento
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="31"
                    step="1"
                    value={form.dia_vencimiento_default}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        dia_vencimiento_default: event.target.value,
                      })
                    }
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-400">
                    Dias de gracia
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={form.dias_gracia_default}
                    onChange={(event) =>
                      setForm({ ...form, dias_gracia_default: event.target.value })
                    }
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-400">
                    Aplicacion pagos
                  </label>
                  <select
                    value={form.aplicacion_pagos}
                    onChange={(event) =>
                      setForm({ ...form, aplicacion_pagos: event.target.value })
                    }
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-zinc-200 outline-none focus:ring-1 focus:ring-cyan-500"
                  >
                    {APLICACION_PAGOS.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-end">
                  <label className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-300">
                    <input
                      type="checkbox"
                      checked={form.auto_renueva_default}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          auto_renueva_default: event.target.checked,
                        })
                      }
                      className="h-4 w-4 rounded border-zinc-700 bg-zinc-900 text-cyan-500 focus:ring-cyan-500"
                    />
                    Auto-renueva por default
                  </label>
                </div>
              </div>

              <div className="flex flex-col gap-3 border-t border-zinc-800 pt-4 md:flex-row md:items-center md:justify-between">
                <p className="text-xs text-zinc-500">
                  Si necesitas crear, borrar o clonar capas, usa la pantalla global
                  de configuracion.
                </p>
                <button
                  type="submit"
                  disabled={isSavingCapa}
                  className="rounded-lg bg-cyan-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:opacity-50"
                >
                  {isSavingCapa ? "Guardando..." : "Guardar cambios de la capa"}
                </button>
              </div>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}
