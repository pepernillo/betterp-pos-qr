"use client";

import { type FormEvent, useEffect, useState } from "react";

import { buildApiUrl } from "@/lib/api";

type PlatformBillingProfile = {
  capa_id: number;
  nombre: string;
  nombre_administrador: string;
  razon_social: string;
  rfc: string;
  regimen_fiscal: string;
  correo_contacto: string;
  telefono_contacto: string;
  logo_url: string;
  pais_fiscal: string;
  codigo_postal_fiscal: string;
  estado_fiscal: string;
  municipio_fiscal: string;
  colonia_fiscal: string;
  calle_fiscal: string;
  numero_exterior_fiscal: string;
  numero_interior_fiscal: string;
  facturacion_activa: boolean;
  facturacion_modo: string;
  facturacion_pac_proveedor: string;
  facturacion_serie_ingresos: string;
  facturacion_lugar_expedicion: string;
  facturacion_producto_servicio: string;
  facturacion_unidad: string;
  facturacion_uso_cfdi_default: string;
  facturacion_metodo_pago_default: string;
  facturacion_forma_pago_default: string;
  clabe_transferencias: string;
  banco_transferencias: string;
  beneficiario_transferencias: string;
  referencia_transferencia_prefijo: string;
};

type MessageTone = "success" | "error";

const EMPTY_PROFILE: PlatformBillingProfile = {
  capa_id: 0,
  nombre: "Better Business",
  nombre_administrador: "Backoffice BetterP",
  razon_social: "",
  rfc: "",
  regimen_fiscal: "",
  correo_contacto: "",
  telefono_contacto: "",
  logo_url: "",
  pais_fiscal: "Mexico",
  codigo_postal_fiscal: "",
  estado_fiscal: "",
  municipio_fiscal: "",
  colonia_fiscal: "",
  calle_fiscal: "",
  numero_exterior_fiscal: "",
  numero_interior_fiscal: "",
  facturacion_activa: false,
  facturacion_modo: "MANUAL",
  facturacion_pac_proveedor: "SIN_PROVEEDOR",
  facturacion_serie_ingresos: "BP",
  facturacion_lugar_expedicion: "",
  facturacion_producto_servicio: "81112100",
  facturacion_unidad: "E48",
  facturacion_uso_cfdi_default: "G03",
  facturacion_metodo_pago_default: "PUE",
  facturacion_forma_pago_default: "03",
  clabe_transferencias: "",
  banco_transferencias: "",
  beneficiario_transferencias: "",
  referencia_transferencia_prefijo: "BETTERP",
};

const FACTURACION_MODES = [
  { value: "MANUAL", label: "Manual" },
  { value: "SANDBOX", label: "PAC sandbox" },
  { value: "PRODUCCION", label: "PAC produccion" },
];

const PAC_PROVIDERS = [
  { value: "SIN_PROVEEDOR", label: "Sin proveedor" },
  { value: "FACTURAMA", label: "Facturama" },
  { value: "FACTURAPI", label: "Facturapi" },
  { value: "FISCALAPI", label: "FiscalAPI" },
  { value: "FINKOK", label: "Finkok" },
  { value: "SW", label: "SW Sapien" },
  { value: "OTRO", label: "Otro" },
];

function cleanProfile(profile: PlatformBillingProfile): PlatformBillingProfile {
  return {
    ...profile,
    nombre: profile.nombre.trim() || "Better Business",
    nombre_administrador: profile.nombre_administrador.trim(),
    razon_social: profile.razon_social.trim(),
    rfc: profile.rfc.trim().toUpperCase(),
    regimen_fiscal: profile.regimen_fiscal.trim(),
    correo_contacto: profile.correo_contacto.trim(),
    telefono_contacto: profile.telefono_contacto.trim(),
    logo_url: profile.logo_url.trim(),
    pais_fiscal: profile.pais_fiscal.trim() || "Mexico",
    codigo_postal_fiscal: profile.codigo_postal_fiscal.trim(),
    estado_fiscal: profile.estado_fiscal.trim(),
    municipio_fiscal: profile.municipio_fiscal.trim(),
    colonia_fiscal: profile.colonia_fiscal.trim(),
    calle_fiscal: profile.calle_fiscal.trim(),
    numero_exterior_fiscal: profile.numero_exterior_fiscal.trim(),
    numero_interior_fiscal: profile.numero_interior_fiscal.trim(),
    facturacion_serie_ingresos:
      profile.facturacion_serie_ingresos.trim().toUpperCase() || "BP",
    facturacion_lugar_expedicion: profile.facturacion_lugar_expedicion.trim(),
    facturacion_producto_servicio: profile.facturacion_producto_servicio.trim(),
    facturacion_unidad: profile.facturacion_unidad.trim().toUpperCase() || "E48",
    facturacion_uso_cfdi_default:
      profile.facturacion_uso_cfdi_default.trim().toUpperCase() || "G03",
    facturacion_metodo_pago_default:
      profile.facturacion_metodo_pago_default.trim().toUpperCase() || "PUE",
    facturacion_forma_pago_default:
      profile.facturacion_forma_pago_default.trim() || "03",
    clabe_transferencias: profile.clabe_transferencias.replace(/\D/g, "").slice(0, 18),
    banco_transferencias: profile.banco_transferencias.trim(),
    beneficiario_transferencias: profile.beneficiario_transferencias.trim(),
    referencia_transferencia_prefijo:
      profile.referencia_transferencia_prefijo.trim().toUpperCase() || "BETTERP",
  };
}

function inputClasses() {
  return "w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30";
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  inputMode,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  inputMode?: "numeric" | "email" | "url" | "text";
  maxLength?: number;
}) {
  return (
    <label className="space-y-2">
      <span className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
        {label}
      </span>
      <input
        type={type}
        inputMode={inputMode}
        maxLength={maxLength}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className={inputClasses()}
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="space-y-2">
      <span className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={inputClasses()}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function SectionHeader({ title, helper }: { title: string; helper: string }) {
  return (
    <div>
      <h3 className="text-base font-semibold text-white">{title}</h3>
      <p className="mt-1 text-xs leading-5 text-zinc-500">{helper}</p>
    </div>
  );
}

export default function PlatformBillingProfileManager() {
  const [profile, setProfile] = useState<PlatformBillingProfile>(EMPTY_PROFILE);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<MessageTone>("success");

  const updateProfile = <K extends keyof PlatformBillingProfile>(
    key: K,
    value: PlatformBillingProfile[K]
  ) => {
    setProfile((current) => ({ ...current, [key]: value }));
  };

  const loadProfile = async () => {
    setIsLoading(true);
    setMessage("");
    try {
      const response = await fetch(
        buildApiUrl("/billing/admin/plataforma/facturacion/"),
        { cache: "no-store" }
      );
      const body = (await response.json().catch(() => ({}))) as
        | PlatformBillingProfile
        | { detail?: string };
      if (!response.ok) {
        throw new Error(
          "detail" in body && body.detail
            ? body.detail
            : "No se pudo cargar la ficha fiscal de BetterP."
        );
      }
      setProfile({ ...EMPTY_PROFILE, ...(body as PlatformBillingProfile) });
    } catch (error) {
      setMessageTone("error");
      setMessage(
        error instanceof Error
          ? error.message
          : "No se pudo cargar la ficha fiscal de BetterP."
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadProfile();
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSaving(true);
    setMessage("");
    try {
      const response = await fetch(
        buildApiUrl("/billing/admin/plataforma/facturacion/"),
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(cleanProfile(profile)),
        }
      );
      const body = (await response.json().catch(() => ({}))) as
        | PlatformBillingProfile
        | { detail?: string };
      if (!response.ok) {
        throw new Error(
          "detail" in body && body.detail
            ? body.detail
            : "No se pudo guardar la ficha fiscal de BetterP."
        );
      }
      setProfile({ ...EMPTY_PROFILE, ...(body as PlatformBillingProfile) });
      setMessageTone("success");
      setMessage("Datos internos de facturacion actualizados.");
    } catch (error) {
      setMessageTone("error");
      setMessage(
        error instanceof Error
          ? error.message
          : "No se pudo guardar la ficha fiscal de BetterP."
      );
    } finally {
      setIsSaving(false);
    }
  };

  const readyForInvoice =
    profile.razon_social &&
    profile.rfc &&
    profile.regimen_fiscal &&
    profile.codigo_postal_fiscal &&
    profile.facturacion_producto_servicio;

  return (
    <section className="rounded-3xl border border-zinc-800 bg-zinc-950/70 p-5">
      <div className="flex flex-col gap-4 border-b border-zinc-800 pb-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl">
          <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-300">
            Datos fiscales BetterP
          </p>
          <h2 className="mt-2 text-xl font-bold text-white">
            Emisor interno para facturar suscripciones SaaS
          </h2>
          <p className="mt-2 text-sm leading-7 text-zinc-500">
            Esta ficha pertenece a BetterP/Better Business y se usa desde el
            backoffice para emitir comprobantes a clientes SaaS. No toma datos de
            Maya Coliving ni de la capa operativa seleccionada.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span
            className={`rounded-full border px-3 py-1.5 text-xs ${
              readyForInvoice
                ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-100"
                : "border-amber-500/25 bg-amber-500/10 text-amber-100"
            }`}
          >
            {readyForInvoice ? "Datos fiscales listos" : "Faltan datos fiscales"}
          </span>
          <button
            type="button"
            onClick={() => void loadProfile()}
            className="rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 transition hover:border-zinc-600"
          >
            {isLoading ? "Cargando..." : "Refrescar"}
          </button>
        </div>
      </div>

      {message ? (
        <div
          className={`mt-5 rounded-2xl border px-4 py-3 text-sm ${
            messageTone === "success"
              ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-100"
              : "border-rose-500/25 bg-rose-500/10 text-rose-100"
          }`}
        >
          {message}
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="mt-5 space-y-5">
        <div className="rounded-3xl border border-zinc-800 bg-zinc-900/30 p-4">
          <SectionHeader
            title="Identidad de BetterP"
            helper="Datos visibles como emisor y contacto administrativo de la plataforma."
          />
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <Field
              label="Nombre interno"
              value={profile.nombre}
              onChange={(value) => updateProfile("nombre", value)}
              placeholder="Better Business"
            />
            <Field
              label="Razon social"
              value={profile.razon_social}
              onChange={(value) => updateProfile("razon_social", value)}
              placeholder="Razon social legal"
            />
            <Field
              label="RFC"
              value={profile.rfc}
              onChange={(value) => updateProfile("rfc", value.toUpperCase())}
              placeholder="RFC emisor"
              maxLength={13}
            />
            <Field
              label="Regimen fiscal"
              value={profile.regimen_fiscal}
              onChange={(value) => updateProfile("regimen_fiscal", value)}
              placeholder="Ej. 601"
              maxLength={80}
            />
            <Field
              label="Correo facturacion"
              type="email"
              inputMode="email"
              value={profile.correo_contacto}
              onChange={(value) => updateProfile("correo_contacto", value)}
              placeholder="facturacion@betterp.net"
            />
            <Field
              label="Telefono"
              value={profile.telefono_contacto}
              onChange={(value) => updateProfile("telefono_contacto", value)}
              placeholder="Contacto administrativo"
            />
          </div>
        </div>

        <div className="rounded-3xl border border-zinc-800 bg-zinc-900/30 p-4">
          <SectionHeader
            title="Domicilio fiscal"
            helper="Campos SAT usados como emisor de comprobantes de suscripcion."
          />
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Field
              label="Codigo postal"
              inputMode="numeric"
              value={profile.codigo_postal_fiscal}
              onChange={(value) =>
                updateProfile("codigo_postal_fiscal", value.replace(/\D/g, ""))
              }
              placeholder="CP fiscal"
              maxLength={5}
            />
            <Field
              label="Pais"
              value={profile.pais_fiscal}
              onChange={(value) => updateProfile("pais_fiscal", value)}
              placeholder="Mexico"
            />
            <Field
              label="Estado"
              value={profile.estado_fiscal}
              onChange={(value) => updateProfile("estado_fiscal", value)}
            />
            <Field
              label="Municipio"
              value={profile.municipio_fiscal}
              onChange={(value) => updateProfile("municipio_fiscal", value)}
            />
            <Field
              label="Colonia"
              value={profile.colonia_fiscal}
              onChange={(value) => updateProfile("colonia_fiscal", value)}
            />
            <Field
              label="Calle"
              value={profile.calle_fiscal}
              onChange={(value) => updateProfile("calle_fiscal", value)}
            />
            <Field
              label="Num. exterior"
              value={profile.numero_exterior_fiscal}
              onChange={(value) => updateProfile("numero_exterior_fiscal", value)}
            />
            <Field
              label="Num. interior"
              value={profile.numero_interior_fiscal}
              onChange={(value) => updateProfile("numero_interior_fiscal", value)}
            />
          </div>
        </div>

        <div className="rounded-3xl border border-zinc-800 bg-zinc-900/30 p-4">
          <SectionHeader
            title="Facturacion SaaS"
            helper="Valores default para CFDI de planes, renovaciones y consumos extras."
          />
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <SelectField
              label="Modo CFDI"
              value={profile.facturacion_modo}
              onChange={(value) => updateProfile("facturacion_modo", value)}
              options={FACTURACION_MODES}
            />
            <SelectField
              label="PAC"
              value={profile.facturacion_pac_proveedor}
              onChange={(value) => updateProfile("facturacion_pac_proveedor", value)}
              options={PAC_PROVIDERS}
            />
            <Field
              label="Serie"
              value={profile.facturacion_serie_ingresos}
              onChange={(value) =>
                updateProfile("facturacion_serie_ingresos", value.toUpperCase())
              }
              placeholder="BP"
            />
            <Field
              label="Lugar expedicion"
              inputMode="numeric"
              value={profile.facturacion_lugar_expedicion}
              onChange={(value) =>
                updateProfile("facturacion_lugar_expedicion", value.replace(/\D/g, ""))
              }
              placeholder="CP emisor"
              maxLength={5}
            />
            <Field
              label="Clave producto SAT"
              inputMode="numeric"
              value={profile.facturacion_producto_servicio}
              onChange={(value) =>
                updateProfile("facturacion_producto_servicio", value.replace(/\D/g, ""))
              }
              placeholder="81112100"
            />
            <Field
              label="Unidad SAT"
              value={profile.facturacion_unidad}
              onChange={(value) =>
                updateProfile("facturacion_unidad", value.toUpperCase())
              }
              placeholder="E48"
            />
            <Field
              label="Uso CFDI default"
              value={profile.facturacion_uso_cfdi_default}
              onChange={(value) =>
                updateProfile("facturacion_uso_cfdi_default", value.toUpperCase())
              }
              placeholder="G03"
            />
            <Field
              label="Metodo pago"
              value={profile.facturacion_metodo_pago_default}
              onChange={(value) =>
                updateProfile("facturacion_metodo_pago_default", value.toUpperCase())
              }
              placeholder="PUE"
            />
            <Field
              label="Forma pago"
              value={profile.facturacion_forma_pago_default}
              onChange={(value) =>
                updateProfile("facturacion_forma_pago_default", value)
              }
              placeholder="03"
            />
            <label className="flex items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-300 xl:col-span-3">
              <input
                type="checkbox"
                checked={profile.facturacion_activa}
                onChange={(event) =>
                  updateProfile("facturacion_activa", event.target.checked)
                }
                className="h-4 w-4 rounded border-zinc-700 bg-zinc-900 text-cyan-500 focus:ring-cyan-500"
              />
              Facturacion SaaS activa para comprobantes emitidos desde backoffice.
            </label>
          </div>
        </div>

        <div className="rounded-3xl border border-zinc-800 bg-zinc-900/30 p-4">
          <SectionHeader
            title="Cobro por transferencia"
            helper="Datos de referencia cuando un cliente SaaS paga fuera de Stripe."
          />
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Field
              label="Beneficiario"
              value={profile.beneficiario_transferencias}
              onChange={(value) => updateProfile("beneficiario_transferencias", value)}
              placeholder="Nombre en banco"
            />
            <Field
              label="Banco"
              value={profile.banco_transferencias}
              onChange={(value) => updateProfile("banco_transferencias", value)}
            />
            <Field
              label="CLABE"
              inputMode="numeric"
              value={profile.clabe_transferencias}
              onChange={(value) =>
                updateProfile("clabe_transferencias", value.replace(/\D/g, ""))
              }
              maxLength={18}
            />
            <Field
              label="Prefijo referencia"
              value={profile.referencia_transferencia_prefijo}
              onChange={(value) =>
                updateProfile("referencia_transferencia_prefijo", value.toUpperCase())
              }
              placeholder="BETTERP"
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t border-zinc-800 pt-5">
          <button
            type="button"
            onClick={() => void loadProfile()}
            className="rounded-2xl border border-zinc-700 bg-zinc-900 px-5 py-3 text-sm font-medium text-zinc-300 transition hover:bg-zinc-800"
          >
            Cancelar cambios
          </button>
          <button
            type="submit"
            disabled={isSaving}
            className="rounded-2xl bg-cyan-500 px-6 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-cyan-400 disabled:opacity-50"
          >
            {isSaving ? "Guardando..." : "Guardar datos BetterP"}
          </button>
        </div>
      </form>
    </section>
  );
}
